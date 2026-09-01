import { and, asc, desc, eq, inArray } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { drafts, draftVersions, documentChunks, matters } from "@nyayagrid/database";
import {
  createAIProviderFromEnv,
  buildDraftGenerationSystemPrompt,
  buildDraftGenerationUserPrompt,
  draftGenerationSchema,
  DRAFT_GENERATION_PROMPT_VERSION,
  type AIProvider,
  type ProfessionalChunk,
  type RoutingMode,
} from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";
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
  return neutralizeUnsupportedQuotes(applySourceLimitationGuard(content, sourceText), sourceText);
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
  const matterTitle = await loadMatterTitle(params.db, params.organizationId, params.matterId);
  const verifiedContext = await buildDraftVerifiedContext({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    instructions: params.instructions,
  });
  const chunks = await loadDraftContextChunks({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    documentIds: params.documentIds,
  });
  const authorityContext =
    params.includeLegalAuthority === false
      ? { items: [], authorityIds: [], authorityChunkIds: [], warnings: [] }
      : await loadDraftLegalAuthorityContext({
          db: params.db,
          organizationId: params.organizationId,
          matterId: params.matterId,
        });
  const authorityBlock = formatDraftLegalAuthorityContext(authorityContext);

  const generation = await ai.generate({
    temperature: 0,
    schemaName: "draft_generation",
    routing: {
      subsystem: "draft",
      strategy: params.executionStrategy ?? "auto",
      modelId: params.modelId,
      organizationId: params.organizationId,
      matterId: params.matterId,
      userId: params.userId,
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

  return version;
}

export async function restoreDraftVersion(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  draftId: string;
  versionNumber: number;
  userId: string;
}) {
  const existing = await getDraftWithVersions(params);
  if (!existing) throw new Error("Draft not found in matter scope");

  const source = existing.versions.find((v) => v.versionNumber === params.versionNumber);
  if (!source) throw new Error("Draft version not found");

  const nextVersion = existing.draft.currentVersionNumber + 1;
  const version = await insertDraftVersion({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    draftId: params.draftId,
    userId: params.userId,
    content: source.content,
    versionNumber: nextVersion,
    origin: "manual",
    changeSummary: `Restored from version ${params.versionNumber}`,
    sourceAssertions: source.sourceAssertions ?? [],
    provider: source.provider,
    model: source.model,
    promptVersion: source.promptVersion,
  });

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "draft.version_restored",
    targetType: "draft_version",
    targetId: version.id,
    metadata: {
      draftId: params.draftId,
      restoredFrom: params.versionNumber,
      versionNumber: nextVersion,
    },
  });

  return version;
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

  const matterTitle = await loadMatterTitle(params.db, params.organizationId, params.matterId);
  const verifiedContext = await buildDraftVerifiedContext({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
  });
  const chunks = await loadDraftContextChunks({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    documentIds: Array.isArray(existing.draft.sourceContext?.documentIds)
      ? (existing.draft.sourceContext.documentIds as string[])
      : undefined,
  });
  const authorityContext =
    params.includeLegalAuthority === false
      ? { items: [], authorityIds: [], authorityChunkIds: [], warnings: [] }
      : await loadDraftLegalAuthorityContext({
          db: params.db,
          organizationId: params.organizationId,
          matterId: params.matterId,
        });
  const authorityBlock = formatDraftLegalAuthorityContext(authorityContext);

  const transformInstructions = [
    buildTransformInstructions(params.action, params.sectionHint),
    authorityBlock ? DRAFT_LEGAL_AUTHORITY_INSTRUCTION : "",
    "Current draft content:",
    current.content,
  ]
    .filter(Boolean)
    .join("\n\n");

  const generation = await ai.generate({
    temperature: 0,
    schemaName: "draft_generation",
    routing: {
      subsystem: "draft",
      strategy: "standard",
      organizationId: params.organizationId,
      matterId: params.matterId,
      userId: params.userId,
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
