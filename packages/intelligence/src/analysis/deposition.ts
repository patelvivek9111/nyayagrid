import { and, desc, eq, inArray } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  analysisFindingSources,
  analysisFindings,
  analysisRuns,
  documentChunks,
  documents,
  matters,
} from "@nyayagrid/database";
import {
  createAIProviderFromEnv,
  buildDepositionAnalysisSystemPrompt,
  buildDepositionAnalysisUserPrompt,
  buildContradictionAnalysisSystemPrompt,
  buildContradictionAnalysisUserPrompt,
  depositionAnalysisSchema,
  contradictionCandidatesSchema,
  DEPOSITION_ANALYSIS_PROMPT_VERSION,
  CONTRADICTION_ANALYSIS_PROMPT_VERSION,
  type AIProvider,
  type ProfessionalChunk,
} from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { loadAuthorizedChunks, resolveValidatedSources } from "../provenance";
import {
  linkContradictionToTimelineEvents,
  type TimelineLinkCandidate,
} from "./link-contradiction-timeline";

export async function analyzeDeposition(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentId: string;
  documentVersionId: string;
  userId: string;
  ai?: AIProvider;
  force?: boolean;
}) {
  const ai = params.ai ?? createAIProviderFromEnv();
  const idempotencyKey = `deposition:${params.documentVersionId}`;

  const [existingRun] = await params.db
    .select()
    .from(analysisRuns)
    .where(eq(analysisRuns.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existingRun && !params.force) {
    const findings = await loadFindingsForRun(params.db, existingRun.id);
    return { skipped: true as const, run: existingRun, findings };
  }

  const [doc] = await params.db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, params.documentId),
        eq(documents.organizationId, params.organizationId),
        eq(documents.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!doc || doc.processingState !== "ready") {
    throw new Error("Document must be ready before deposition analysis");
  }

  const chunks = await params.db
    .select()
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.organizationId, params.organizationId),
        eq(documentChunks.matterId, params.matterId),
        eq(documentChunks.documentVersionId, params.documentVersionId),
      ),
    )
    .orderBy(documentChunks.chunkIndex);

  const professionalChunks: ProfessionalChunk[] = chunks.map((c) => ({
    chunkId: c.id,
    documentId: c.documentId,
    documentVersionId: c.documentVersionId,
    page: c.pageStart,
    segmentRef: c.segmentRef,
    content: c.content,
  }));

  const generation = await ai.generate({
    temperature: 0,
    schemaName: "deposition_analysis",
    messages: [
      { role: "system", content: buildDepositionAnalysisSystemPrompt() },
      {
        role: "user",
        content: buildDepositionAnalysisUserPrompt({
          documentTitle: doc.title,
          chunks: professionalChunks,
        }),
      },
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(generation.text);
  } catch {
    raw = { summary: null, findings: [] };
  }
  const parsed = depositionAnalysisSchema.parse(raw);

  const allChunkIds = parsed.findings.flatMap((f) => f.sourceChunkIds);
  const authorized = await loadAuthorizedChunks(params.db, {
    organizationId: params.organizationId,
    matterId: params.matterId,
    chunkIds: allChunkIds,
  });

  const now = new Date();
  let run = existingRun;
  if (run && params.force) {
    await params.db.delete(analysisFindings).where(eq(analysisFindings.analysisRunId, run.id));
    const [updated] = await params.db
      .update(analysisRuns)
      .set({
        summary: parsed.summary ?? null,
        provider: generation.provider,
        model: generation.model,
        promptVersion: DEPOSITION_ANALYSIS_PROMPT_VERSION,
        updatedAt: now,
      })
      .where(eq(analysisRuns.id, run.id))
      .returning();
    run = updated!;
  } else if (!run) {
    const [created] = await params.db
      .insert(analysisRuns)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        runType: "deposition",
        documentId: params.documentId,
        documentVersionId: params.documentVersionId,
        status: "proposed",
        summary: parsed.summary ?? null,
        idempotencyKey,
        provider: generation.provider,
        model: generation.model,
        promptVersion: DEPOSITION_ANALYSIS_PROMPT_VERSION,
        createdByUserId: params.userId,
      })
      .returning();
    run = created!;
  }

  const createdFindings = [];
  let rejectedNoSource = 0;

  for (const proposal of parsed.findings) {
    const sources = resolveValidatedSources({
      organizationId: params.organizationId,
      matterId: params.matterId,
      sourceChunkIds: proposal.sourceChunkIds,
      sourceQuotes: proposal.sourceChunkIds.map(
        (id) => authorized.get(id)?.content.slice(0, 400) ?? "",
      ),
      authorized,
    });
    if (sources.length === 0) {
      rejectedNoSource += 1;
      continue;
    }

    const [finding] = await params.db
      .insert(analysisFindings)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        analysisRunId: run.id,
        findingType: proposal.findingType,
        title: proposal.title,
        explanation: proposal.explanation ?? null,
        confidence: proposal.confidence,
        attention: proposal.attention,
        status: "proposed",
      })
      .returning();

    await params.db.insert(analysisFindingSources).values(
      sources.map((s) => ({
        organizationId: params.organizationId,
        matterId: params.matterId,
        findingId: finding!.id,
        documentId: s.documentId,
        documentVersionId: s.documentVersionId,
        chunkId: s.chunkId,
        page: s.page,
        segmentRef: s.segmentRef,
        supportingText: s.supportingText,
        side: null,
      })),
    );
    createdFindings.push(finding!);
  }

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "deposition.analyzed",
    targetType: "analysis_run",
    targetId: run.id,
    metadata: {
      documentId: params.documentId,
      findingsCreated: createdFindings.length,
      rejectedNoSource,
      provider: generation.provider,
    },
  });

  return {
    skipped: false as const,
    run,
    findings: createdFindings,
    rejectedNoSource,
    provider: generation.provider,
    model: generation.model,
  };
}

export async function detectContradictionCandidates(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentId?: string;
  userId: string;
  ai?: AIProvider;
  force?: boolean;
}) {
  const ai = params.ai ?? createAIProviderFromEnv();
  const scopeKey = params.documentId ?? "matter";
  const idempotencyKey = `contradiction:${params.matterId}:${scopeKey}`;

  const [existingRun] = await params.db
    .select()
    .from(analysisRuns)
    .where(eq(analysisRuns.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existingRun && !params.force) {
    const findings = await loadFindingsForRun(params.db, existingRun.id);
    return { skipped: true as const, run: existingRun, findings };
  }

  const [matter] = await params.db
    .select()
    .from(matters)
    .where(and(eq(matters.id, params.matterId), eq(matters.organizationId, params.organizationId)))
    .limit(1);
  if (!matter) throw new Error("Matter not found");

  const chunkConditions = [
    eq(documentChunks.organizationId, params.organizationId),
    eq(documentChunks.matterId, params.matterId),
  ];
  if (params.documentId) {
    chunkConditions.push(eq(documentChunks.documentId, params.documentId));
  }

  const chunks = await params.db
    .select()
    .from(documentChunks)
    .where(and(...chunkConditions))
    .orderBy(documentChunks.documentId, documentChunks.chunkIndex)
    .limit(48);

  const professionalChunks: ProfessionalChunk[] = chunks.map((c) => ({
    chunkId: c.id,
    documentId: c.documentId,
    documentVersionId: c.documentVersionId,
    page: c.pageStart,
    segmentRef: c.segmentRef,
    content: c.content,
  }));

  const generation = await ai.generate({
    temperature: 0,
    schemaName: "contradiction_analysis",
    messages: [
      { role: "system", content: buildContradictionAnalysisSystemPrompt() },
      {
        role: "user",
        content: buildContradictionAnalysisUserPrompt({
          matterTitle: matter.title,
          chunks: professionalChunks,
        }),
      },
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(generation.text);
  } catch {
    raw = { candidates: [] };
  }
  const parsed = contradictionCandidatesSchema.parse(raw);

  const allChunkIds = parsed.candidates.flatMap((c) => [...c.sideA.chunkIds, ...c.sideB.chunkIds]);
  const authorized = await loadAuthorizedChunks(params.db, {
    organizationId: params.organizationId,
    matterId: params.matterId,
    chunkIds: allChunkIds,
  });

  const now = new Date();
  let run = existingRun;
  if (run && params.force) {
    await params.db.delete(analysisFindings).where(eq(analysisFindings.analysisRunId, run.id));
    const [updated] = await params.db
      .update(analysisRuns)
      .set({
        provider: generation.provider,
        model: generation.model,
        promptVersion: CONTRADICTION_ANALYSIS_PROMPT_VERSION,
        updatedAt: now,
      })
      .where(eq(analysisRuns.id, run.id))
      .returning();
    run = updated!;
  } else if (!run) {
    const [created] = await params.db
      .insert(analysisRuns)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        runType: "contradiction",
        documentId: params.documentId ?? null,
        status: "proposed",
        idempotencyKey,
        provider: generation.provider,
        model: generation.model,
        promptVersion: CONTRADICTION_ANALYSIS_PROMPT_VERSION,
        createdByUserId: params.userId,
      })
      .returning();
    run = created!;
  }

  const createdFindings = [];
  let rejectedIncomplete = 0;

  for (const candidate of parsed.candidates) {
    const sideASources = resolveValidatedSources({
      organizationId: params.organizationId,
      matterId: params.matterId,
      sourceChunkIds: candidate.sideA.chunkIds,
      sourceQuotes: [candidate.sideA.summary],
      authorized,
    });
    const sideBSources = resolveValidatedSources({
      organizationId: params.organizationId,
      matterId: params.matterId,
      sourceChunkIds: candidate.sideB.chunkIds,
      sourceQuotes: [candidate.sideB.summary],
      authorized,
    });
    if (sideASources.length === 0 || sideBSources.length === 0) {
      rejectedIncomplete += 1;
      continue;
    }

    const findingType =
      sideASources.some((s) => s.documentId !== sideBSources[0]!.documentId) ||
      sideBSources.some((s) => s.documentId !== sideASources[0]!.documentId)
        ? "contradiction"
        : "tension";

    const [finding] = await params.db
      .insert(analysisFindings)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        analysisRunId: run.id,
        findingType,
        title: candidate.title,
        explanation: candidate.explanation,
        confidence: candidate.confidence,
        attention: "review",
        status: "proposed",
      })
      .returning();

    await params.db.insert(analysisFindingSources).values([
      ...sideASources.map((s) => ({
        organizationId: params.organizationId,
        matterId: params.matterId,
        findingId: finding!.id,
        documentId: s.documentId,
        documentVersionId: s.documentVersionId,
        chunkId: s.chunkId,
        page: s.page,
        segmentRef: s.segmentRef,
        supportingText: s.supportingText,
        side: "A",
      })),
      ...sideBSources.map((s) => ({
        organizationId: params.organizationId,
        matterId: params.matterId,
        findingId: finding!.id,
        documentId: s.documentId,
        documentVersionId: s.documentVersionId,
        chunkId: s.chunkId,
        page: s.page,
        segmentRef: s.segmentRef,
        supportingText: s.supportingText,
        side: "B",
      })),
    ]);
    createdFindings.push(finding!);
  }

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "contradiction.detected",
    targetType: "analysis_run",
    targetId: run.id,
    metadata: {
      documentId: params.documentId ?? null,
      findingsCreated: createdFindings.length,
      rejectedIncomplete,
      provider: generation.provider,
    },
  });

  return {
    skipped: false as const,
    run,
    findings: createdFindings,
    rejectedIncomplete,
    provider: generation.provider,
    model: generation.model,
  };
}

export async function reviewFinding(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  findingId: string;
  userId: string;
  action: "reviewed" | "dismissed";
  note?: string | null;
}) {
  const now = new Date();
  const status = params.action === "dismissed" ? "dismissed" : "reviewed";

  const [updated] = await params.db
    .update(analysisFindings)
    .set({
      status,
      reviewedByUserId: params.userId,
      reviewedAt: now,
      reviewNote: params.note ?? null,
      updatedAt: now,
    })
    .where(
      and(
        eq(analysisFindings.id, params.findingId),
        eq(analysisFindings.organizationId, params.organizationId),
        eq(analysisFindings.matterId, params.matterId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Analysis finding not found in matter scope");

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: `analysis_finding.${params.action}`,
    targetType: "analysis_finding",
    targetId: params.findingId,
    metadata: { note: params.note ?? null },
  });

  return updated;
}

export async function listFindings(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  runType?: string;
  status?: string | string[];
  findingType?: string;
  documentId?: string;
  includeSources?: boolean;
  /** Attach related timeline event IDs (read-only; never merges sides). Default true when sources included. */
  includeTimelineLinks?: boolean;
}) {
  const runConditions = [
    eq(analysisRuns.organizationId, params.organizationId),
    eq(analysisRuns.matterId, params.matterId),
  ];
  if (params.runType) {
    const types = params.runType
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean) as Array<
      | "contract"
      | "deposition"
      | "evidence"
      | "contradiction"
      | "document_review"
      | "discovery"
      | "comparison"
    >;
    if (types.length === 1) {
      runConditions.push(eq(analysisRuns.runType, types[0]!));
    } else if (types.length > 1) {
      runConditions.push(inArray(analysisRuns.runType, types));
    }
  }
  if (params.documentId) runConditions.push(eq(analysisRuns.documentId, params.documentId));

  const runs = await params.db
    .select()
    .from(analysisRuns)
    .where(and(...runConditions));
  const runIds = runs.map((r) => r.id);
  if (runIds.length === 0) return [];

  const statuses = params.status
    ? Array.isArray(params.status)
      ? params.status
      : params.status.split(",")
    : undefined;

  const findingConditions = [
    eq(analysisFindings.organizationId, params.organizationId),
    eq(analysisFindings.matterId, params.matterId),
    inArray(analysisFindings.analysisRunId, runIds),
  ];
  if (statuses?.length) {
    findingConditions.push(
      inArray(analysisFindings.status, statuses as Array<"proposed" | "reviewed" | "dismissed">),
    );
  }
  if (params.findingType) {
    findingConditions.push(eq(analysisFindings.findingType, params.findingType));
  }

  const findings = await params.db
    .select()
    .from(analysisFindings)
    .where(and(...findingConditions))
    .orderBy(desc(analysisFindings.createdAt));

  const includeSources = params.includeSources !== false;
  let sources: Array<(typeof analysisFindingSources)["$inferSelect"]> = [];
  if (includeSources && findings.length > 0) {
    sources = await params.db
      .select()
      .from(analysisFindingSources)
      .where(
        inArray(
          analysisFindingSources.findingId,
          findings.map((f) => f.id),
        ),
      );
  }

  const base = findings.map((f) => ({
    ...f,
    run: runs.find((r) => r.id === f.analysisRunId) ?? null,
    sources: sources.filter((s) => s.findingId === f.id),
    relatedTimelineEventIds: [] as string[],
    sideAEventIds: [] as string[],
    sideBEventIds: [] as string[],
    timelineLinks: [] as ReturnType<typeof linkContradictionToTimelineEvents>["links"],
  }));

  const wantsLinks = params.includeTimelineLinks ?? includeSources;
  if (!wantsLinks) return base;

  const { listTimelineEvents } = await import("../queries");
  const events = await listTimelineEvents({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    status: ["proposed", "approved", "edited_and_approved"],
    includeSources: true,
    includeContradictionLinks: false,
  });
  const candidates: TimelineLinkCandidate[] = events.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    eventDate: e.eventDate,
    actors: e.actors,
    status: e.status,
    sources: (e.sources as TimelineLinkCandidate["sources"]) ?? [],
  }));

  return base.map((finding) => {
    const type = (finding.findingType ?? "").toLowerCase();
    if (type !== "contradiction" && type !== "tension") return finding;
    const linked = linkContradictionToTimelineEvents({
      finding: {
        title: finding.title,
        explanation: finding.explanation,
        findingType: finding.findingType,
        sources: finding.sources,
      },
      events: candidates,
    });
    return {
      ...finding,
      relatedTimelineEventIds: linked.relatedTimelineEventIds,
      sideAEventIds: linked.sideAEventIds,
      sideBEventIds: linked.sideBEventIds,
      timelineLinks: linked.links,
    };
  });
}

async function loadFindingsForRun(db: Database, runId: string) {
  return db
    .select()
    .from(analysisFindings)
    .where(eq(analysisFindings.analysisRunId, runId))
    .orderBy(desc(analysisFindings.createdAt));
}
