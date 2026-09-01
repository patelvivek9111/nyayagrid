import { and, asc, eq, inArray } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  documentChunks,
  matters,
  researchArtifacts,
  researchQueries,
  researchResults,
} from "@nyayagrid/database";
import type { ResearchProposition } from "@nyayagrid/database";
import {
  RESEARCH_MEMO_PROMPT_VERSION,
  buildResearchMemoSystemPrompt,
  buildResearchMemoUserPrompt,
  createAIProviderFromEnv,
  createEmbeddingProviderFromEnv,
  researchMemoSchema,
  type AIProvider,
  type EmbeddingProvider,
  type ProfessionalChunk,
  type ResearchMemo,
} from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { loadMatterJurisdictionForResearch, labelResearchHits } from "./jurisdiction-layer";
import type { AuthoritySearchFilters, LegalAuthorityProvider } from "./provider";
import { loadAuthorizedAuthorityChunks } from "./context";
import { ensureResearchSession, type ResearchSession } from "./sessions";
import {
  buildAuthorityRetrievalIndex,
  buildCoverageWarnings,
  extractSearchConcepts,
  loadResearchMatterContext,
  partitionAuthorityIds,
  resolveAuthorityRetriever,
  retrieveResearchAuthorities,
  type AuthorityRetrievalIndex,
  type AuthorityRetrieverLike,
  type ResearchHit,
} from "./synthesize";
import { rewriteUnsupportedControllingClaims } from "./weight";
import { rewriteUnsourcedEditorialTreatment } from "./treatment";

export const MEMO_UNSUPPORTED_SHORT_ANSWER =
  "No retrieved legal authority supports a short answer to this question; the memo records the gap instead of asserting a rule.";

export const MEMO_ATTORNEY_REVIEW_NOTE =
  "This memo is AI-generated from the retrieved authority passages only. It is not attorney-authored work product and every citation, quote, and treatment signal requires independent verification.";

export type MemoValidation = {
  memo: ResearchMemo;
  grounded: boolean;
  droppedPropositions: Array<{ text: string; reason: string; unknownAuthorityIds: string[] }>;
  droppedUnsupportedAuthorityIds: string[];
  fabricatedAuthorityIds: string[];
  unknownChunkIds: string[];
  /** Authority-chunk citations kept per proposition, in the same order as memo.propositions. */
  propositionChunkIds: string[][];
  schemaValid: boolean;
};

function emptyMemo(issue: string, warnings: string[]): ResearchMemo {
  return {
    issue,
    shortAnswer: MEMO_UNSUPPORTED_SHORT_ANSWER,
    factsAssumptions: "No verified matter facts were available for this memo.",
    applicableAuthorities: [],
    analysis:
      "No analysis is stated because no retrieved authority passage survived citation validation.",
    counterarguments: "",
    conclusion: MEMO_UNSUPPORTED_SHORT_ANSWER,
    authorityVerificationNotes: [MEMO_ATTORNEY_REVIEW_NOTE],
    coverageWarnings: warnings,
    propositions: [],
  };
}

/**
 * Validate a generated memo against retrieval: unknown authority ids and chunk ids are removed, and
 * a proposition with no surviving authority is dropped rather than presented as supported law.
 */
export function validateMemoAgainstRetrieval(
  raw: unknown,
  index: AuthorityRetrievalIndex,
  issueFallback = "Research memo",
): MemoValidation {
  const parsed = researchMemoSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      memo: emptyMemo(issueFallback, [
        "The model returned a research memo that did not match the required schema.",
      ]),
      grounded: false,
      droppedPropositions: [],
      droppedUnsupportedAuthorityIds: [],
      fabricatedAuthorityIds: [],
      unknownChunkIds: [],
      propositionChunkIds: [],
      schemaValid: false,
    };
  }

  const memo = parsed.data;
  const fabricated = new Set<string>();
  const unknownChunkIds = new Set<string>();
  const droppedPropositions: MemoValidation["droppedPropositions"] = [];
  const propositions: ResearchMemo["propositions"] = [];
  const propositionChunkIds: string[][] = [];

  for (const proposition of memo.propositions) {
    const authorities = partitionAuthorityIds(proposition.authorityIds, index);
    authorities.unknown.forEach((id) => fabricated.add(id));
    if (authorities.known.length === 0) {
      droppedPropositions.push({
        text: proposition.text,
        reason: "No cited authority was present in the retrieved passages.",
        unknownAuthorityIds: authorities.unknown,
      });
      continue;
    }
    const chunkIds = proposition.chunkIds.filter((chunkId) => {
      if (index.chunkIds.has(chunkId)) return true;
      unknownChunkIds.add(chunkId);
      return false;
    });
    propositions.push({ text: proposition.text, authorityIds: authorities.known, chunkIds });
    propositionChunkIds.push(chunkIds);
  }

  const applicable = partitionAuthorityIds(memo.applicableAuthorities, index);
  applicable.unknown.forEach((id) => fabricated.add(id));

  const grounded = propositions.length > 0 && index.authorityIds.size > 0;
  const coverageWarnings = [...memo.coverageWarnings];
  if (droppedPropositions.length > 0) {
    coverageWarnings.push(
      `${droppedPropositions.length} memo proposition(s) were dropped because their cited authority was not retrieved.`,
    );
  }
  if (fabricated.size > 0) {
    coverageWarnings.push(
      `${fabricated.size} cited authority identifier(s) did not exist in the retrieved corpus results and were removed.`,
    );
  }

  const publishedIds = new Set<string>([
    ...applicable.known,
    ...propositions.flatMap((row) => row.authorityIds),
  ]);
  const remainingUnsourced = [...publishedIds].filter((id) => !index.authorityIds.has(id));

  return {
    memo: {
      ...memo,
      applicableAuthorities: applicable.known,
      propositions,
      shortAnswer: grounded ? memo.shortAnswer : MEMO_UNSUPPORTED_SHORT_ANSWER,
      conclusion: grounded ? memo.conclusion : MEMO_UNSUPPORTED_SHORT_ANSWER,
      authorityVerificationNotes: [
        ...new Set([...memo.authorityVerificationNotes, MEMO_ATTORNEY_REVIEW_NOTE]),
      ],
      coverageWarnings,
    },
    grounded,
    droppedPropositions,
    droppedUnsupportedAuthorityIds: [...fabricated],
    fabricatedAuthorityIds: remainingUnsourced,
    unknownChunkIds: [...unknownChunkIds],
    propositionChunkIds,
    schemaValid: true,
  };
}

export function composeMemoText(memo: ResearchMemo): string {
  return [
    `ISSUE\n${memo.issue}`,
    `SHORT ANSWER\n${memo.shortAnswer}`,
    `FACTS AND ASSUMPTIONS (from matter evidence, not legal authority)\n${memo.factsAssumptions}`,
    `ANALYSIS (from legal authority passages only)\n${memo.analysis}`,
    memo.counterarguments.trim() ? `COUNTERARGUMENTS\n${memo.counterarguments}` : "",
    `CONCLUSION\n${memo.conclusion}`,
    memo.authorityVerificationNotes.length
      ? `AUTHORITY VERIFICATION\n- ${memo.authorityVerificationNotes.join("\n- ")}`
      : "",
    memo.coverageWarnings.length
      ? `COVERAGE WARNINGS\n- ${memo.coverageWarnings.join("\n- ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Split memo support into the two provenance classes that must never be conflated: matter evidence
 * (FACT_SOURCE) and corpus authority (LEGAL_AUTHORITY).
 */
export function buildMemoPropositions(input: {
  memo: ResearchMemo;
  matterChunkIds: string[];
}): ResearchProposition[] {
  const propositions: ResearchProposition[] = input.memo.propositions.map((proposition) => ({
    text: proposition.text,
    authorityIds: proposition.authorityIds,
    chunkIds: proposition.chunkIds,
    provenanceClass: "LEGAL_AUTHORITY" as const,
  }));

  if (input.matterChunkIds.length > 0) {
    propositions.push({
      text: input.memo.factsAssumptions,
      authorityIds: [],
      chunkIds: [],
      provenanceClass: "FACT_SOURCE" as const,
      matterChunkIds: input.matterChunkIds,
    });
  }

  return propositions;
}

const DEFAULT_MEMO_HIT_LIMIT = 14;
const DEFAULT_MATTER_CHUNK_LIMIT = 24;
const MAX_CONCEPT_QUERIES = 3;

async function loadMemoMatterChunks(params: {
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
    .limit(params.limit ?? DEFAULT_MATTER_CHUNK_LIMIT);

  return rows.map((row) => ({
    chunkId: row.id,
    documentId: row.documentId,
    documentVersionId: row.documentVersionId,
    page: row.pageStart,
    segmentRef: row.segmentRef,
    content: row.content,
  }));
}

export type GenerateResearchMemoParams = {
  db: Database;
  organizationId: string;
  userId: string;
  sessionId?: string | null;
  matterId?: string | null;
  question: string;
  filters?: AuthoritySearchFilters;
  ai?: AIProvider;
  embeddings?: EmbeddingProvider;
  includeMatterFacts?: boolean;
  documentIds?: string[];
  limit?: number;
  retriever?: AuthorityRetrieverLike;
  provider?: LegalAuthorityProvider;
};

export type GenerateResearchMemoResult = {
  session: ResearchSession;
  queryId: string;
  artifactId: string | null;
  memo: ResearchMemo;
  memoText: string;
  hits: ResearchHit[];
  coverageWarnings: string[];
  grounded: boolean;
  validation: Omit<MemoValidation, "memo">;
  matterChunkIds: string[];
  provider: string;
  model: string;
};

/**
 * Generate a research memo for a question, grounded in corpus authority passages.
 *
 * Matter document chunks feed only the facts-and-assumptions section and are recorded with
 * FACT_SOURCE provenance; legal analysis may cite corpus authorities only. Coverage warnings are
 * always persisted so a memo can never read as a complete survey of the law.
 */
export async function generateResearchMemo(
  params: GenerateResearchMemoParams,
): Promise<GenerateResearchMemoResult> {
  const question = params.question.trim();
  if (!question) throw new Error("Research question is required");

  const ai = params.ai ?? createAIProviderFromEnv();
  const embeddings = params.embeddings ?? createEmbeddingProviderFromEnv();
  const limit = params.limit ?? DEFAULT_MEMO_HIT_LIMIT;

  const session = await ensureResearchSession({
    db: params.db,
    organizationId: params.organizationId,
    userId: params.userId,
    sessionId: params.sessionId ?? null,
    matterId: params.matterId ?? null,
    title: `Memo: ${question.slice(0, 180)}`,
    jurisdictionFilters: params.filters?.jurisdiction ? [params.filters.jurisdiction] : [],
    authorityTypeFilters: params.filters?.authorityType ? [params.filters.authorityType] : [],
  });
  const matterId = params.matterId ?? session.matterId ?? null;

  const sessionJurisdiction = (session.jurisdictionFilters ?? [])[0];
  const sessionAuthorityType = (session.authorityTypeFilters ?? [])[0];
  const filters: AuthoritySearchFilters = {
    ...(sessionJurisdiction ? { jurisdiction: sessionJurisdiction } : {}),
    ...(sessionAuthorityType ? { authorityType: sessionAuthorityType } : {}),
    ...params.filters,
  };

  const extraWarnings: string[] = [];
  let matterTitle = "(no matter)";
  let matterContextText: string | null = null;
  let matterChunks: ProfessionalChunk[] = [];
  let concepts: string[] = [];

  const jurisdictionLayer = await loadMatterJurisdictionForResearch({
    db: params.db,
    organizationId: params.organizationId,
    matterId,
    question,
  });
  extraWarnings.push(...jurisdictionLayer.warnings);

  if (matterId) {
    const [matter] = await params.db
      .select({ title: matters.title })
      .from(matters)
      .where(and(eq(matters.id, matterId), eq(matters.organizationId, params.organizationId)))
      .limit(1);
    if (!matter) throw new Error("Matter not found in organization scope");
    matterTitle = matter.title;

    const matterContext = await loadResearchMatterContext({
      db: params.db,
      organizationId: params.organizationId,
      matterId,
      question,
    });
    matterContextText = matterContext.text;

    const extraction = await extractSearchConcepts({
      ai,
      matterTitle,
      question,
      matterContextText,
    });
    concepts = extraction.concepts.slice(0, MAX_CONCEPT_QUERIES);
    extraWarnings.push(...extraction.coverageWarnings, ...extraction.jurisdictionCaveats);

    if (params.includeMatterFacts !== false) {
      matterChunks = await loadMemoMatterChunks({
        db: params.db,
        organizationId: params.organizationId,
        matterId,
        documentIds: params.documentIds,
      });
    }
  } else {
    extraWarnings.push(
      "Memo was generated without a matter, so the facts and assumptions section is not grounded in matter evidence.",
    );
  }

  const search = resolveAuthorityRetriever({
    db: params.db,
    embeddings,
    retriever: params.retriever,
    provider: params.provider,
  });

  const hits = labelResearchHits(
    jurisdictionLayer.context,
    await retrieveResearchAuthorities({
      search,
      filters,
      limit,
      searchOptions: jurisdictionLayer.searchOptions,
      queries: [
        { text: question, origin: "primary" },
        ...concepts.map((concept) => ({
          text: concept,
          origin: "concept" as const,
          limit: Math.max(4, Math.floor(limit / 2)),
        })),
      ],
    }),
  ).slice(0, limit);

  const chunkTexts = await loadAuthorizedAuthorityChunks({
    db: params.db,
    chunkIds: hits.map((hit) => hit.chunkId),
  });
  const index = buildAuthorityRetrievalIndex(hits, chunkTexts);

  const generation = await ai.generate({
    temperature: 0,
    schemaName: "research_memo",
    routing: {
      subsystem: "research",
      strategy: "standard",
      organizationId: params.organizationId,
      matterId: matterId ?? undefined,
    },
    messages: [
      { role: "system", content: buildResearchMemoSystemPrompt() },
      {
        role: "user",
        content: buildResearchMemoUserPrompt({
          matterTitle,
          researchQuestion: question,
          matterChunks,
          authorityChunks: hits.map((hit) => ({
            authorityId: hit.authorityId,
            chunkId: hit.chunkId,
            citation: hit.citation,
            court: hit.court,
            date: hit.decisionDate,
            content: chunkTexts.get(hit.chunkId)?.content ?? hit.snippet,
            hierarchyRelationship: hit.hierarchyRelationship ?? "unknown",
            jurisdiction: hit.jurisdiction,
            temporalApplicability: hit.temporalApplicability ?? "unknown",
          })),
        }),
      },
    ],
  });

  let raw: unknown = null;
  try {
    raw = JSON.parse(generation.text);
  } catch {
    raw = null;
  }

  const validatedRaw = validateMemoAgainstRetrieval(raw, index, question);
  const forumLabels = [
    filters.jurisdiction,
    jurisdictionLayer.context?.primaryState,
    jurisdictionLayer.context?.governingLawState,
  ].filter((value): value is string => Boolean(value));
  const guard = (text: string) =>
    rewriteUnsourcedEditorialTreatment(
      rewriteUnsupportedControllingClaims({
        text,
        hits,
        queryJurisdiction: filters.jurisdiction ?? null,
        forumLabels,
      }),
    );
  const validated = {
    ...validatedRaw,
    memo: {
      ...validatedRaw.memo,
      shortAnswer: guard(validatedRaw.memo.shortAnswer),
      analysis: guard(validatedRaw.memo.analysis),
      conclusion: guard(validatedRaw.memo.conclusion),
    },
  };
  const coverageWarnings = buildCoverageWarnings({
    hitCount: hits.length,
    authorityCount: index.authorityIds.size,
    contrarySearchPerformed: false,
    jurisdictionFilter: filters.jurisdiction ?? null,
    jurisdictionFilters: session.jurisdictionFilters ?? [],
    jurisdictionKnown: Boolean(
      jurisdictionLayer.context && jurisdictionLayer.context.jurisdictionMode !== "unknown",
    ),
    extra: [
      ...validated.memo.coverageWarnings,
      ...extraWarnings,
      ...(matterChunks.length === 0 && matterId
        ? ["No matter document chunks were available for the facts and assumptions section."]
        : []),
    ],
  });

  const memo: ResearchMemo = { ...validated.memo, coverageWarnings };
  const memoText = composeMemoText(memo);
  const matterChunkIds = matterChunks.map((chunk) => chunk.chunkId);

  const [queryRow] = await params.db
    .insert(researchQueries)
    .values({
      organizationId: params.organizationId,
      sessionId: session.id,
      queryText: question,
      normalizedQuery: question.toLowerCase().replace(/\s+/g, " ").trim(),
      filters: { ...filters, artifact: "memo" },
      createdByUserId: params.userId,
    })
    .returning();
  if (!queryRow) throw new Error("Failed to persist research query for memo");

  if (hits.length > 0) {
    await params.db.insert(researchResults).values(
      hits.map((hit, rank) => ({
        organizationId: params.organizationId,
        sessionId: session.id,
        queryId: queryRow.id,
        authorityId: hit.authorityId,
        authorityVersionId: hit.authorityVersionId,
        chunkId: hit.chunkId,
        score: hit.score,
        snippet: hit.snippet,
        rank: rank + 1,
      })),
    );
  }

  const [artifact] = await params.db
    .insert(researchArtifacts)
    .values({
      organizationId: params.organizationId,
      sessionId: session.id,
      matterId,
      artifactType: "memo",
      issue: memo.issue,
      answer: memoText,
      propositions: buildMemoPropositions({ memo, matterChunkIds }),
      supportingAuthorities: memo.applicableAuthorities,
      contraryAuthorities: [],
      jurisdictionAssumptions: filters.jurisdiction
        ? [`Jurisdiction assumed for retrieval: ${filters.jurisdiction}`]
        : ["No jurisdiction was specified for retrieval."],
      coverageWarnings,
      provider: generation.provider,
      model: generation.model,
      promptVersion: RESEARCH_MEMO_PROMPT_VERSION,
      createdByUserId: params.userId,
    })
    .returning();

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId,
    action: "research.memo_generated",
    targetType: "research_artifact",
    targetId: artifact?.id ?? queryRow.id,
    metadata: {
      sessionId: session.id,
      queryId: queryRow.id,
      questionChars: question.length,
      hitCount: hits.length,
      authorityCount: index.authorityIds.size,
      matterChunkCount: matterChunkIds.length,
      propositionCount: memo.propositions.length,
      droppedPropositionCount: validated.droppedPropositions.length,
      fabricatedAuthorityIdCount: validated.fabricatedAuthorityIds.length,
      grounded: validated.grounded,
      coverageWarningCount: coverageWarnings.length,
      provider: generation.provider,
      model: generation.model,
      promptVersion: RESEARCH_MEMO_PROMPT_VERSION,
    },
  });

  const { memo: _validatedMemo, ...validationRest } = validated;

  return {
    session,
    queryId: queryRow.id,
    artifactId: artifact?.id ?? null,
    memo,
    memoText,
    hits,
    coverageWarnings,
    grounded: validated.grounded,
    validation: validationRest,
    matterChunkIds,
    provider: generation.provider,
    model: generation.model,
  };
}
