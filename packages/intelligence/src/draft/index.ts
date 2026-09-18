import { and, asc, desc, eq, inArray } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { drafts, draftVersions, documentChunks, matters } from "@nyayagrid/database";
import {
  createAIProviderFromEnv,
  buildDraftGenerationSystemPrompt,
  buildDraftGenerationUserPrompt,
  draftGenerationSchema,
  DRAFT_GENERATION_PROMPT_VERSION,
  constrainDraftUnsupportedClaims,
  newUsageActionId,
  type AIProvider,
  type ProfessionalChunk,
  type RoutingMode,
} from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { recordLegalWorkChange, restoreLegalWorkVersion, PostgresLegalWorkStore } from "../recovery";
import { loadAuthorizedChunks } from "../provenance";
import { formatVerifiedIntelligenceForPrompt, loadVerifiedMatterIntelligence } from "../verified";
import { loadVerifiedGraphContext } from "../graph/index";
import { formatActiveMemoryForPrompt, retrieveActiveMatterMemories } from "../memory/index";
import { resolveMatterJurisdictionContext } from "@nyayagrid/jurisdiction";
import {
  DRAFT_LEGAL_AUTHORITY_INSTRUCTION,
  formatDraftLegalAuthorityContext,
  loadDraftLegalAuthorityContext,
  type DraftLegalAuthorityContext,
} from "./authorities";
import {
  appendExternalResearchNoteIfNeeded,
  appendResearchDisclaimerIfNeeded,
  classifyDraftAssertions,
  countAssertionsByProvenance,
  extractUnresolvedPlaceholders,
  applySourceLimitationGuard,
  neutralizeUnsupportedQuotes,
  normalizeDraftGenerationRaw,
  withInsufficientSourceAssumption,
  type ClassifiedDraftAssertion,
} from "./helpers";

const HIGH_STAKES_DRAFTS = new Set([
  "complaint",
  "motion",
  "brief",
  "discovery_request",
  "settlement_agreement",
]);

function groundedDraftBody(
  content: string,
  chunks: ProfessionalChunk[],
  extraSource = "",
): string {
  const sourceText = [chunks.map((chunk) => chunk.content).join("\n"), extraSource]
    .filter((part) => part.trim())
    .join("\n\n");
  if (!sourceText.trim()) return content;
  return constrainDraftUnsupportedClaims(
    neutralizeUnsupportedQuotes(applySourceLimitationGuard(content, sourceText), sourceText),
    sourceText,
  );
}

async function loadMatterTitle(
  db: Database,
  organizationId: string,
  matterId: string,
): Promise<string> {
  const [matter] = await db
    .select({ title: matters.title })
    .from(matters)
    .where(and(eq(matters.id, matterId), eq(matters.organizationId, organizationId)))
    .limit(1);
  if (!matter) throw new Error("Matter not found");
  return matter.title;
}

async function loadDraftContextChunks(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentIds?: string[];
  limit?: number;
}): Promise<ProfessionalChunk[]> {
  const conditions = [
    eq(documentChunks.organizationId, params.organizationId),
    eq(documentChunks.matterId, params.matterId),
  ];
  if (params.documentIds?.length) {
    conditions.push(inArray(documentChunks.documentId, params.documentIds));
  }

  const rows = await params.db
    .select()
    .from(documentChunks)
    .where(and(...conditions))
    .orderBy(asc(documentChunks.chunkIndex))
    .limit(params.limit ?? 48);

  return rows.map((c) => ({
    chunkId: c.id,
    documentId: c.documentId,
    documentVersionId: c.documentVersionId,
    page: c.pageStart,
    segmentRef: c.segmentRef,
    content: c.content,
  }));
}

async function buildDraftVerifiedContext(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  instructions?: string | null;
}): Promise<string> {
  const verified = await loadVerifiedMatterIntelligence(params);
  const graph = await loadVerifiedGraphContext({
    ...params,
    question: params.instructions ?? undefined,
    limit: 12,
  });
  const memories = await retrieveActiveMatterMemories({
    ...params,
    question: params.instructions ?? undefined,
    limit: 8,
  });
  const jurisdiction = await resolveMatterJurisdictionContext({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
  });

  return [
    jurisdiction?.promptBlock ?? "",
    formatVerifiedIntelligenceForPrompt(verified),
    graph.text,
    formatActiveMemoryForPrompt(memories),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Split model assertions into fact-supported and authority-supported citations.
 *
 * Matter chunk ids are looked up in the matter's own document chunks; authority chunk ids must come
 * from the matter's saved legal authorities. A citation in neither set is dropped, so a draft can
 * never present a matter document as legal authority or cite an authority nobody saved.
 */
async function resolveDraftAssertions(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  assertions: Array<{ text: string; chunkIds: string[] }>;
  authorityContext: DraftLegalAuthorityContext;
}): Promise<{
  sourceAssertions: ClassifiedDraftAssertion[];
  counts: Record<"FACT_SOURCE" | "LEGAL_AUTHORITY", number>;
}> {
  const citedChunkIds = params.assertions.flatMap((assertion) => assertion.chunkIds);
  const authorityChunkIds = new Set(params.authorityContext.authorityChunkIds);
  const authorizedFactChunks = await loadAuthorizedChunks(params.db, {
    organizationId: params.organizationId,
    matterId: params.matterId,
    chunkIds: citedChunkIds.filter((chunkId) => !authorityChunkIds.has(chunkId)),
  });

  const sourceAssertions = classifyDraftAssertions(params.assertions, {
    factChunkIds: new Set(authorizedFactChunks.keys()),
    authorityChunkIds,
  });

  return { sourceAssertions, counts: countAssertionsByProvenance(sourceAssertions) };
}

async function insertDraftVersion(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  draftId: string;
  userId: string;
  content: string;
  versionNumber: number;
  origin: "manual" | "ai" | "ai_edited";
  changeSummary?: string | null;
  sourceAssertions?: Array<{
    text: string;
    chunkIds: string[];
    provenanceClass?: "FACT_SOURCE" | "LEGAL_AUTHORITY";
    authorityIds?: string[];
  }>;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
}) {
  const [version] = await params.db
    .insert(draftVersions)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      draftId: params.draftId,
      versionNumber: params.versionNumber,
      content: params.content,
      changeSummary: params.changeSummary ?? null,
      origin: params.origin,
      sourceAssertions: params.sourceAssertions ?? [],
      provider: params.provider ?? null,
      model: params.model ?? null,
      promptVersion: params.promptVersion ?? null,
      createdByUserId: params.userId,
    })
    .returning();

  await params.db
    .update(drafts)
    .set({
      currentVersionNumber: params.versionNumber,
      updatedByUserId: params.userId,
      updatedAt: new Date(),
    })
    .where(eq(drafts.id, params.draftId));

  return version!;
}

async function trackDraftVersion(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  draftId: string;
  version: {
    id: string;
    versionNumber: number;
    content: string;
    changeSummary: string | null;
    origin: "manual" | "ai" | "ai_edited";
    sourceAssertions?: unknown;
  };
  operation: "create" | "update" | "restore" | "status";
  source: "user" | "ai" | "restore";
  description: string;
  sessionId?: string | null;
  expectedVersionNumber?: number | null;
  provider?: string | null;
  model?: string | null;
}) {
  const [draft] = await params.db
    .select()
    .from(drafts)
    .where(eq(drafts.id, params.draftId))
    .limit(1);
  await recordLegalWorkChange(params.db, {
    organizationId: params.organizationId,
    matterId: params.matterId,
    actorUserId: params.userId,
    objectType: "draft",
    objectId: params.draftId,
    operation: params.operation,
    source: params.source,
    afterPayload: {
      title: draft?.title ?? "",
      status: draft?.status ?? "draft",
      draftType: draft?.draftType ?? "other",
      content: params.version.content,
      changeSummary: params.version.changeSummary,
      origin: params.version.origin,
      sourceAssertions: params.version.sourceAssertions ?? [],
      nativeVersionId: params.version.id,
    },
    description: params.description,
    sessionId: params.sessionId,
    expectedVersionNumber: params.expectedVersionNumber,
    nativeVersionId: params.version.id,
    provider: params.provider,
    model: params.model,
    skipApply: true,
  });
}

export async function createDraft(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  title: string;
  draftType: string;
  content?: string;
  aiGenerated?: boolean;
}) {
  const content = params.content ?? "";
  const [draft] = await params.db
    .insert(drafts)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      title: params.title,
      draftType: params.draftType,
      aiGenerated: params.aiGenerated ?? false,
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();

  const version = await insertDraftVersion({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    draftId: draft!.id,
    userId: params.userId,
    content,
    versionNumber: 1,
    origin: params.aiGenerated ? "ai" : "manual",
    changeSummary: "Initial version",
  });

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "draft.created",
    targetType: "draft",
    targetId: draft!.id,
    metadata: { draftType: params.draftType, aiGenerated: params.aiGenerated ?? false },
  });
  await trackDraftVersion({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    userId: params.userId,
    draftId: draft!.id,
    version,
    operation: "create",
    source: params.aiGenerated ? "ai" : "user",
    description: "Created draft",
  });

  return { draft: draft!, version };
}

export async function generateDraft(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  title: string;
  draftType: string;
  instructions?: string;
  documentIds?: string[];
  ai?: AIProvider;
  /** Include the matter's saved legal authorities as LEGAL_AUTHORITY context. Defaults to true. */
  includeLegalAuthority?: boolean;
  executionStrategy?: RoutingMode;
  modelId?: string;
}) {
  const ai = params.ai ?? createAIProviderFromEnv();
  const emptyAuthority = { items: [], authorityIds: [], authorityChunkIds: [], warnings: [] as string[] };
  const [matterTitle, verifiedContext, chunks, authorityContext] = await Promise.all([
    loadMatterTitle(params.db, params.organizationId, params.matterId),
    buildDraftVerifiedContext({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      instructions: params.instructions,
    }),
    loadDraftContextChunks({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      documentIds: params.documentIds,
    }),
    params.includeLegalAuthority === false
      ? Promise.resolve(emptyAuthority)
      : loadDraftLegalAuthorityContext({
          db: params.db,
          organizationId: params.organizationId,
          matterId: params.matterId,
        }),
  ]);
  const authorityBlock = formatDraftLegalAuthorityContext(authorityContext);

  const usageActionId = newUsageActionId();
  const generation = await ai.generate({
    temperature: 0,
    schemaName: "draft_generation",
    timeoutMs: 90_000,
    routing: {
      subsystem: "draft",
      strategy: params.executionStrategy ?? "auto",
      modelId: params.modelId,
      organizationId: params.organizationId,
      matterId: params.matterId,
      userId: params.userId,
      usageActionId,
      promptVersion: DRAFT_GENERATION_PROMPT_VERSION,
      draftType: params.draftType,
      riskSignals: HIGH_STAKES_DRAFTS.has(params.draftType) ? ["high_stakes_draft"] : undefined,
    },
    messages: [
      { role: "system", content: buildDraftGenerationSystemPrompt() },
      {
        role: "user",
        content: buildDraftGenerationUserPrompt({
          matterTitle,
          draftType: params.draftType,
          instructions: authorityBlock
            ? [params.instructions, DRAFT_LEGAL_AUTHORITY_INSTRUCTION].filter(Boolean).join("\n")
            : params.instructions,
          verifiedContext: [verifiedContext, authorityBlock].filter(Boolean).join("\n\n"),
          chunks,
        }),
      },
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(generation.text);
  } catch {
    raw = { content: generation.text, assertions: [], assumptions: [] };
  }
  const parsed = draftGenerationSchema.parse(normalizeDraftGenerationRaw(raw));

  const honesty = withInsufficientSourceAssumption({
    chunkCount: chunks.length,
    assumptions: parsed.assumptions,
  });
  const { sourceAssertions, counts } = await resolveDraftAssertions({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    assertions: parsed.assertions,
    authorityContext,
  });
  const content = appendResearchDisclaimerIfNeeded(
    appendExternalResearchNoteIfNeeded(
      groundedDraftBody(parsed.content, chunks, [verifiedContext, authorityBlock].filter(Boolean).join("\n\n")),
      honesty.assumptions,
    ),
    {
      savedAuthorityCount: authorityContext.authorityIds.length,
      legalAuthorityAssertionCount: counts.LEGAL_AUTHORITY,
      authorityWarningCount: authorityContext.warnings.filter(
        (warning) => !warning.startsWith("No legal authorities"),
      ).length,
    },
  );
  const unresolvedPlaceholders = extractUnresolvedPlaceholders(content, honesty.assumptions);

  const [draft] = await params.db
    .insert(drafts)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      title: params.title,
      draftType: params.draftType,
      aiGenerated: true,
      sourceContext: {
        documentIds: params.documentIds ?? [],
        instructions: params.instructions ?? null,
        assumptions: honesty.assumptions,
        unresolvedPlaceholders,
        insufficientSourceMaterial: honesty.insufficientSourceMaterial,
        legalAuthority: {
          authorityIds: authorityContext.authorityIds,
          authorityChunkCount: authorityContext.authorityChunkIds.length,
          warnings: authorityContext.warnings,
          factAssertionCount: counts.FACT_SOURCE,
          legalAuthorityAssertionCount: counts.LEGAL_AUTHORITY,
        },
      },
      promptVersion: DRAFT_GENERATION_PROMPT_VERSION,
      provider: generation.provider,
      model: generation.model,
      createdByUserId: params.userId,
      updatedByUserId: params.userId,
    })
    .returning();

  const version = await insertDraftVersion({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    draftId: draft!.id,
    userId: params.userId,
    content,
    versionNumber: 1,
    origin: "ai",
    changeSummary: "AI-generated initial draft",
    sourceAssertions,
    provider: generation.provider,
    model: generation.model,
    promptVersion: DRAFT_GENERATION_PROMPT_VERSION,
  });

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "draft.generated",
    targetType: "draft",
    targetId: draft!.id,
    metadata: {
      draftType: params.draftType,
      assertionCount: sourceAssertions.length,
      factAssertionCount: counts.FACT_SOURCE,
      legalAuthorityAssertionCount: counts.LEGAL_AUTHORITY,
      savedAuthorityCount: authorityContext.authorityIds.length,
      provider: generation.provider,
      promptVersion: DRAFT_GENERATION_PROMPT_VERSION,
    },
  });
  await trackDraftVersion({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    userId: params.userId,
    draftId: draft!.id,
    version,
    operation: "create",
    source: "ai",
    description: "AI-generated draft",
    provider: generation.provider,
    model: generation.model,
  });

  return {
    draft: draft!,
    version,
    assumptions: honesty.assumptions,
    unresolvedPlaceholders,
    insufficientSourceMaterial: honesty.insufficientSourceMaterial,
    legalAuthorityIds: authorityContext.authorityIds,
    authorityWarnings: authorityContext.warnings,
    assertionCounts: counts,
  };
}

export async function listDrafts(params: {
  db: Database;
  organizationId: string;
  matterId: string;
}) {
  return params.db
    .select()
    .from(drafts)
    .where(
      and(eq(drafts.organizationId, params.organizationId), eq(drafts.matterId, params.matterId)),
    )
    .orderBy(desc(drafts.updatedAt));
}

export async function getDraftWithVersions(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  draftId: string;
}) {
  const [draft] = await params.db
    .select()
    .from(drafts)
    .where(
      and(
        eq(drafts.id, params.draftId),
        eq(drafts.organizationId, params.organizationId),
        eq(drafts.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!draft) return null;

  const versions = await params.db
    .select()
    .from(draftVersions)
    .where(
      and(
        eq(draftVersions.draftId, params.draftId),
        eq(draftVersions.organizationId, params.organizationId),
        eq(draftVersions.matterId, params.matterId),
      ),
    )
    .orderBy(asc(draftVersions.versionNumber));

  return { draft, versions };
}

export async function saveDraftVersion(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  draftId: string;
  userId: string;
  content: string;
  changeSummary?: string;
  expectedVersionNumber?: number;
  sessionId?: string | null;
}) {
  const existing = await getDraftWithVersions(params);
  if (!existing) throw new Error("Draft not found in matter scope");

  const nextVersion = existing.draft.currentVersionNumber + 1;
  const origin = existing.draft.aiGenerated ? "ai_edited" : "manual";
  const version = await insertDraftVersion({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    draftId: params.draftId,
    userId: params.userId,
    content: params.content,
    versionNumber: nextVersion,
    origin,
    changeSummary: params.changeSummary ?? "Manual edit",
  });

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "draft.version_saved",
    targetType: "draft_version",
    targetId: version.id,
    metadata: { draftId: params.draftId, versionNumber: nextVersion },
  });
  await trackDraftVersion({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    userId: params.userId,
    draftId: params.draftId,
    version,
    operation: "update",
    source: "user",
    description: params.changeSummary ?? "Manual edit",
    expectedVersionNumber: params.expectedVersionNumber,
    sessionId: params.sessionId,
  });

  return version;
}

export async function restoreDraftVersion(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  draftId: string;
  versionNumber: number;
  userId: string;
  expectedVersionNumber?: number;
  sessionId?: string | null;
  idempotencyKey?: string | null;
}) {
  const existing = await getDraftWithVersions(params);
  if (!existing) throw new Error("Draft not found in matter scope");
  if (existing.draft.status === "final" || existing.draft.status === "archived") {
    throw new Error(
      existing.draft.status === "final"
        ? "This draft is finalized. Restore is disabled; create an amended working version instead."
        : "This draft is archived. Restore is disabled; duplicate it as a new working draft instead.",
    );
  }

  const source = existing.versions.find((v) => v.versionNumber === params.versionNumber);
  if (!source) throw new Error("Draft version not found");

  const store = new PostgresLegalWorkStore(params.db);
  const generic = await store.listVersions({
    organizationId: params.organizationId,
    matterId: params.matterId,
    objectType: "draft",
    objectId: params.draftId,
  });
  const haveNative = new Set(generic.map((row) => row.nativeVersionId).filter(Boolean));
  const haveNumber = new Set(generic.map((row) => row.versionNumber));
  for (const native of existing.versions) {
    if (haveNative.has(native.id) || haveNumber.has(native.versionNumber)) continue;
    await trackDraftVersion({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      userId: native.createdByUserId ?? params.userId,
      draftId: params.draftId,
      version: native,
      operation: native.versionNumber === 1 ? "create" : "update",
      source: native.origin === "ai" || native.origin === "ai_edited" ? "ai" : "user",
      description: native.changeSummary ?? `Version ${native.versionNumber}`,
      provider: native.provider,
      model: native.model,
    });
    haveNative.add(native.id);
    haveNumber.add(native.versionNumber);
  }

  const synced = await store.listVersions({
    organizationId: params.organizationId,
    matterId: params.matterId,
    objectType: "draft",
    objectId: params.draftId,
  });
  const target =
    synced.find((row) => row.nativeVersionId === source.id) ??
    synced.find((row) => row.versionNumber === params.versionNumber);
  if (!target) throw new Error("Draft version not found");

  await restoreLegalWorkVersion(params.db, {
    organizationId: params.organizationId,
    matterId: params.matterId,
    actorUserId: params.userId,
    objectType: "draft",
    objectId: params.draftId,
    targetVersionId: target.id,
    mode: "as_new_version",
    role: "editor",
    sessionId: params.sessionId,
    idempotencyKey: params.idempotencyKey,
  });

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "draft.version_restored",
    targetType: "draft_version",
    targetId: params.draftId,
    metadata: {
      draftId: params.draftId,
      restoredFrom: params.versionNumber,
      restorationOfVersionId: target.id,
    },
  });

  const after = await getDraftWithVersions(params);
  return after!.versions[after!.versions.length - 1]!;
}

function buildTransformInstructions(
  action: "shorten" | "expand" | "change_tone" | "regenerate",
  sectionHint?: string | null,
): string {
  const section = sectionHint ? ` Focus on the section matching: ${sectionHint}.` : "";
  switch (action) {
    case "shorten":
      return `Shorten the draft while preserving legal meaning and grounded assertions.${section}`;
    case "expand":
      return `Expand the draft with additional detail grounded in provided sources only.${section}`;
    case "change_tone":
      return `Revise the draft tone to be more professional and precise without changing grounded facts.${section}`;
    case "regenerate":
      return `Regenerate the draft content using the same sources and verified context.${section}`;
  }
}

export async function transformDraftSection(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  draftId: string;
  userId: string;
  action: "shorten" | "expand" | "change_tone" | "regenerate";
  sectionHint?: string;
  ai?: AIProvider;
  includeLegalAuthority?: boolean;
}) {
  const ai = params.ai ?? createAIProviderFromEnv();
  const existing = await getDraftWithVersions(params);
  if (!existing) throw new Error("Draft not found in matter scope");

  const current = existing.versions.find(
    (v) => v.versionNumber === existing.draft.currentVersionNumber,
  );
  if (!current) throw new Error("Current draft version not found");

  const emptyAuthority = { items: [], authorityIds: [], authorityChunkIds: [], warnings: [] as string[] };
  const [matterTitle, verifiedContext, chunks, authorityContext] = await Promise.all([
    loadMatterTitle(params.db, params.organizationId, params.matterId),
    buildDraftVerifiedContext({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
    }),
    loadDraftContextChunks({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      documentIds: Array.isArray(existing.draft.sourceContext?.documentIds)
        ? (existing.draft.sourceContext.documentIds as string[])
        : undefined,
    }),
    params.includeLegalAuthority === false
      ? Promise.resolve(emptyAuthority)
      : loadDraftLegalAuthorityContext({
          db: params.db,
          organizationId: params.organizationId,
          matterId: params.matterId,
        }),
  ]);
  const authorityBlock = formatDraftLegalAuthorityContext(authorityContext);

  const transformInstructions = [
    buildTransformInstructions(params.action, params.sectionHint),
    authorityBlock ? DRAFT_LEGAL_AUTHORITY_INSTRUCTION : "",
    "Current draft content:",
    current.content,
  ]
    .filter(Boolean)
    .join("\n\n");

  const usageActionId = newUsageActionId();
  const generation = await ai.generate({
    temperature: 0,
    schemaName: "draft_generation",
    timeoutMs: 90_000,
    routing: {
      subsystem: "draft",
      strategy: "standard",
      organizationId: params.organizationId,
      matterId: params.matterId,
      userId: params.userId,
      usageActionId,
      promptVersion: DRAFT_GENERATION_PROMPT_VERSION,
      draftType: existing.draft.draftType,
    },
    messages: [
      { role: "system", content: buildDraftGenerationSystemPrompt() },
      {
        role: "user",
        content: buildDraftGenerationUserPrompt({
          matterTitle,
          draftType: existing.draft.draftType,
          instructions: transformInstructions,
          verifiedContext: [verifiedContext, authorityBlock].filter(Boolean).join("\n\n"),
          chunks,
        }),
      },
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(generation.text);
  } catch {
    raw = { content: generation.text, assertions: [], assumptions: [] };
  }
  const parsed = draftGenerationSchema.parse(normalizeDraftGenerationRaw(raw));

  const honesty = withInsufficientSourceAssumption({
    chunkCount: chunks.length,
    assumptions: parsed.assumptions,
  });
  const { sourceAssertions, counts } = await resolveDraftAssertions({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    assertions: parsed.assertions,
    authorityContext,
  });
  const content = appendResearchDisclaimerIfNeeded(
    appendExternalResearchNoteIfNeeded(
      groundedDraftBody(parsed.content, chunks, [verifiedContext, authorityBlock].filter(Boolean).join("\n\n")),
      honesty.assumptions,
    ),
    {
      savedAuthorityCount: authorityContext.authorityIds.length,
      legalAuthorityAssertionCount: counts.LEGAL_AUTHORITY,
      authorityWarningCount: authorityContext.warnings.filter(
        (warning) => !warning.startsWith("No legal authorities"),
      ).length,
    },
  );
  const unresolvedPlaceholders = extractUnresolvedPlaceholders(content, honesty.assumptions);

  const nextVersion = existing.draft.currentVersionNumber + 1;
  const version = await insertDraftVersion({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    draftId: params.draftId,
    userId: params.userId,
    content,
    versionNumber: nextVersion,
    origin: "ai_edited",
    changeSummary: `AI ${params.action}${params.sectionHint ? `: ${params.sectionHint}` : ""}`,
    sourceAssertions,
    provider: generation.provider,
    model: generation.model,
    promptVersion: DRAFT_GENERATION_PROMPT_VERSION,
  });

  await params.db
    .update(drafts)
    .set({
      provider: generation.provider,
      model: generation.model,
      promptVersion: DRAFT_GENERATION_PROMPT_VERSION,
      sourceContext: {
        ...(existing.draft.sourceContext ?? {}),
        assumptions: honesty.assumptions,
        unresolvedPlaceholders,
        insufficientSourceMaterial: honesty.insufficientSourceMaterial,
      },
      updatedByUserId: params.userId,
      updatedAt: new Date(),
    })
    .where(eq(drafts.id, params.draftId));

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "draft.section_transformed",
    targetType: "draft_version",
    targetId: version.id,
    metadata: {
      draftId: params.draftId,
      action: params.action,
      sectionHint: params.sectionHint ?? null,
      factAssertionCount: counts.FACT_SOURCE,
      legalAuthorityAssertionCount: counts.LEGAL_AUTHORITY,
      savedAuthorityCount: authorityContext.authorityIds.length,
    },
  });
  await trackDraftVersion({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    userId: params.userId,
    draftId: params.draftId,
    version,
    operation: "update",
    source: "ai",
    description: `AI ${params.action}`,
    provider: generation.provider,
    model: generation.model,
  });

  return version;
}

export async function updateDraftStatus(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  draftId: string;
  userId: string;
  status: "draft" | "in_review" | "archived";
}) {
  const existing = await getDraftWithVersions(params);
  if (!existing) throw new Error("Draft not found in matter scope");

  const [updated] = await params.db
    .update(drafts)
    .set({
      status: params.status,
      updatedByUserId: params.userId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(drafts.id, params.draftId),
        eq(drafts.organizationId, params.organizationId),
        eq(drafts.matterId, params.matterId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Draft not found in matter scope");

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "draft.status_updated",
    targetType: "draft",
    targetId: params.draftId,
    metadata: { status: params.status, previousStatus: existing.draft.status },
  });
  const current = existing.versions.find((v) => v.versionNumber === existing.draft.currentVersionNumber);
  if (current) {
    await trackDraftVersion({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      userId: params.userId,
      draftId: params.draftId,
      version: current,
      operation: "status",
      source: "user",
      description: `Status changed to ${params.status}`,
    });
  }

  return updated;
}

export {
  appendExternalResearchNoteIfNeeded,
  appendResearchDisclaimerIfNeeded,
  applyComparisonSummaryAlignmentPolicy,
  buildDiffDigestCorpus,
  classifyDraftAssertions,
  countAssertionsByProvenance,
  needsExternalResearchNote,
  needsResearchDisclaimer,
  scoreComparisonSummaryAgainstDiffs,
  extractUnresolvedPlaceholders,
  neutralizeUnsupportedQuotes,
  applySourceLimitationGuard,
  normalizeDraftGenerationRaw,
  validateDraftAssertions,
  withInsufficientSourceAssumption,
  COMPARISON_SUMMARY_MISALIGN_NOTE,
  EXTERNAL_RESEARCH_NOTE,
  INSUFFICIENT_SOURCE_MATERIAL,
  RESEARCH_AUTHORITY_INCOMPLETE_NOTE,
} from "./helpers";
export type {
  ClassifiedDraftAssertion,
  ComparisonSummaryAlignment,
  ComparisonSummaryScore,
  DraftProvenanceClass,
} from "./helpers";
export * from "./authorities";
