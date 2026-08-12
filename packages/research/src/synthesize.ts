import { and, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { matters, researchArtifacts, researchQueries, researchResults } from "@nyayagrid/database";
import type { ResearchProposition } from "@nyayagrid/database";
import {
  AUTHORITY_SUMMARY_PROMPT_VERSION,
  RESEARCH_SYNTHESIS_PROMPT_VERSION,
  authoritySummarySchema,
  buildAuthoritySummarySystemPrompt,
  buildAuthoritySummaryUserPrompt,
  buildContraryAuthoritySearchSystemPrompt,
  buildContraryAuthoritySearchUserPrompt,
  buildLegalIssueExtractionSystemPrompt,
  buildLegalIssueExtractionUserPrompt,
  buildResearchSynthesisSystemPrompt,
  buildResearchSynthesisUserPrompt,
  contraryAuthoritySearchSchema,
  createAIProviderFromEnv,
  createEmbeddingProviderFromEnv,
  legalIssueExtractionSchema,
  researchSynthesisSchema,
  type AIProvider,
  type AuthoritySummary,
  type EmbeddingProvider,
  type ResearchAuthorityChunk,
  type ResearchSynthesis,
} from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";
import {
  formatActiveMemoryForPrompt,
  formatVerifiedIntelligenceForPrompt,
  loadVerifiedGraphContext,
  loadVerifiedMatterIntelligence,
  retrieveActiveMatterMemories,
} from "@nyayagrid/intelligence";
import type {
  AuthoritySearchFilters,
  AuthoritySearchHit,
  LegalAuthorityProvider,
} from "./provider";
import { AuthorityHybridRetriever } from "./search";
import type { AuthoritySearchOptions } from "./search";
import { loadAuthorizedAuthorityChunks, type AuthorityChunkProvenance } from "./context";
import { validateQuoteAgainstText } from "./quotes";
import { TREATMENT_UNVERIFIED_NOTICE } from "./treatment";
import { ensureResearchSession, type ResearchSession } from "./sessions";

export const LIMITED_CORPUS_WARNING =
  "Search covered only the authorities imported into this NyayaGrid corpus; it is not a comprehensive survey of the law of any jurisdiction.";

export const NO_CONTRARY_SEARCH_WARNING =
  "No dedicated contrary-authority search was run; adverse or limiting authority may exist.";

export const JURISDICTION_UNSPECIFIED_WARNING =
  "No jurisdiction filter was applied, so retrieved authorities may not be binding in the relevant forum.";

export const NO_AUTHORITY_HITS_WARNING =
  "No legal authority passages were retrieved, so no answer can be grounded in authority.";

export const UNSUPPORTED_SYNTHESIS_ANSWER =
  "The retrieved legal authority passages do not support a synthesized answer to this question. No proposition survived citation validation, so nothing is asserted as law here.";

export const NO_CORPUS_SYNTHESIS_ANSWER =
  "No legal authority passages were retrieved for this question. Authoritative legal research has not been performed and model training knowledge is not a legal source.";

export type ResearchQueryOrigin = "primary" | "concept" | "contrary";

export type ResearchHit = AuthoritySearchHit & {
  /** Which retrieval pass surfaced this passage. */
  queryOrigin: ResearchQueryOrigin;
};

/** Anything that can retrieve authority passages: the hybrid retriever or a provider adapter. */
export type AuthorityRetrieverLike = {
  search(
    query: string,
    filters?: AuthoritySearchFilters,
    options?: AuthoritySearchOptions,
  ): Promise<AuthoritySearchHit[]>;
};

export type AuthorityRetrievalIndex = {
  authorityIds: Set<string>;
  chunkIds: Set<string>;
  authorityIdByChunkId: Map<string, string>;
  /** Full chunk text when available, otherwise the retrieval snippet. */
  textByChunkId: Map<string, string>;
  chunkIdsByAuthorityId: Map<string, string[]>;
};

/**
 * Build the allow-list every model citation is checked against. Only passages that came back from
 * authority retrieval may be cited; anything else is treated as fabricated.
 */
export function buildAuthorityRetrievalIndex(
  hits: AuthoritySearchHit[],
  chunkTexts?: Map<string, AuthorityChunkProvenance>,
): AuthorityRetrievalIndex {
  const index: AuthorityRetrievalIndex = {
    authorityIds: new Set(),
    chunkIds: new Set(),
    authorityIdByChunkId: new Map(),
    textByChunkId: new Map(),
    chunkIdsByAuthorityId: new Map(),
  };

  for (const hit of hits) {
    index.authorityIds.add(hit.authorityId);
    index.chunkIds.add(hit.chunkId);
    index.authorityIdByChunkId.set(hit.chunkId, hit.authorityId);
    const full = chunkTexts?.get(hit.chunkId)?.content;
    index.textByChunkId.set(hit.chunkId, full ?? hit.snippet);
    const list = index.chunkIdsByAuthorityId.get(hit.authorityId) ?? [];
    if (!list.includes(hit.chunkId)) list.push(hit.chunkId);
    index.chunkIdsByAuthorityId.set(hit.authorityId, list);
  }

  return index;
}

export type DroppedProposition = {
  text: string;
  reason: string;
  unknownAuthorityIds: string[];
};

export type RejectedQuote = {
  authorityId: string;
  chunkId: string | null;
  reason: string;
};

export type SynthesisValidation = {
  synthesis: ResearchSynthesis;
  /** True when at least one proposition or source survived validation. */
  grounded: boolean;
  droppedPropositions: DroppedProposition[];
  droppedSources: Array<{ authorityId: string; chunkId: string | null; reason: string }>;
  fabricatedAuthorityIds: string[];
  unknownChunkIds: string[];
  rejectedQuotes: RejectedQuote[];
  schemaValid: boolean;
};

function emptySynthesis(answer: string, warnings: string[]): ResearchSynthesis {
  return {
    conciseAnswer: answer,
    legalPropositions: [],
    supportingAuthorities: [],
    contraryAuthorities: [],
    importantDistinctions: [],
    jurisdictionCaveats: [],
    unresolvedIssues: [],
    coverageWarnings: warnings,
    sources: [],
  };
}

/** Filter model-supplied authority ids down to the ones that were actually retrieved. */
export function partitionAuthorityIds(
  ids: string[],
  index: AuthorityRetrievalIndex,
): { known: string[]; unknown: string[] } {
  const known: string[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    if (index.authorityIds.has(id)) {
      if (!known.includes(id)) known.push(id);
    } else if (!unknown.includes(id)) {
      unknown.push(id);
    }
  }
  return { known, unknown };
}

/**
 * Validate a raw synthesis payload against retrieval.
 *
 * Anything the model cited that was not retrieved is removed: unknown authority ids, unknown chunk
 * ids, propositions left with no supporting authority, and quotes that do not appear verbatim in
 * the cited passage. The result is only marked grounded when something survived.
 */
export function validateSynthesisAgainstRetrieval(
  raw: unknown,
  index: AuthorityRetrievalIndex,
): SynthesisValidation {
  const parsed = researchSynthesisSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      synthesis: emptySynthesis(UNSUPPORTED_SYNTHESIS_ANSWER, [
        "The model returned a research synthesis that did not match the required schema.",
      ]),
      grounded: false,
      droppedPropositions: [],
      droppedSources: [],
      fabricatedAuthorityIds: [],
      unknownChunkIds: [],
      rejectedQuotes: [],
      schemaValid: false,
    };
  }

  const synthesis = parsed.data;
  const fabricatedAuthorityIds = new Set<string>();
  const unknownChunkIds = new Set<string>();
  const droppedPropositions: DroppedProposition[] = [];
  const droppedSources: SynthesisValidation["droppedSources"] = [];
  const rejectedQuotes: RejectedQuote[] = [];

  const legalPropositions: ResearchSynthesis["legalPropositions"] = [];
  for (const proposition of synthesis.legalPropositions) {
    const authorities = partitionAuthorityIds(proposition.authorityIds, index);
    authorities.unknown.forEach((id) => fabricatedAuthorityIds.add(id));
    const chunkIds = proposition.chunkIds.filter((chunkId) => {
      if (index.chunkIds.has(chunkId)) return true;
      unknownChunkIds.add(chunkId);
      return false;
    });
    if (authorities.known.length === 0) {
      droppedPropositions.push({
        text: proposition.text,
        reason: "No cited authority was present in the retrieved passages.",
        unknownAuthorityIds: authorities.unknown,
      });
      continue;
    }
    legalPropositions.push({
      text: proposition.text,
      authorityIds: authorities.known,
      chunkIds,
    });
  }

  const sources: ResearchSynthesis["sources"] = [];
  for (const source of synthesis.sources) {
    if (!index.authorityIds.has(source.authorityId)) {
      fabricatedAuthorityIds.add(source.authorityId);
      droppedSources.push({
        authorityId: source.authorityId,
        chunkId: source.chunkId ?? null,
        reason: "Authority was not present in the retrieved passages.",
      });
      continue;
    }
    if (source.chunkId && !index.chunkIds.has(source.chunkId)) {
      unknownChunkIds.add(source.chunkId);
      droppedSources.push({
        authorityId: source.authorityId,
        chunkId: source.chunkId,
        reason: "Chunk was not present in the retrieved passages.",
      });
      continue;
    }
    if (source.chunkId && index.authorityIdByChunkId.get(source.chunkId) !== source.authorityId) {
      droppedSources.push({
        authorityId: source.authorityId,
        chunkId: source.chunkId,
        reason: "Chunk belongs to a different authority than the one cited.",
      });
      continue;
    }

    let quote = source.quote ?? null;
    const quoteText = quote?.trim() ?? "";
    if (quoteText) {
      const candidateChunkIds = source.chunkId
        ? [source.chunkId]
        : (index.chunkIdsByAuthorityId.get(source.authorityId) ?? []);
      const verified = candidateChunkIds.some((chunkId) => {
        const text = index.textByChunkId.get(chunkId);
        if (!text) return false;
        return validateQuoteAgainstText(quoteText, text).valid;
      });
      if (!verified) {
        rejectedQuotes.push({
          authorityId: source.authorityId,
          chunkId: source.chunkId ?? null,
          reason: "Quote does not appear verbatim in the cited authority passage.",
        });
        quote = null;
      }
    }

    sources.push({ ...source, quote });
  }

  const supporting = partitionAuthorityIds(synthesis.supportingAuthorities, index);
  supporting.unknown.forEach((id) => fabricatedAuthorityIds.add(id));
  const contrary = partitionAuthorityIds(synthesis.contraryAuthorities, index);
  contrary.unknown.forEach((id) => fabricatedAuthorityIds.add(id));

  const grounded = legalPropositions.length > 0 || sources.length > 0;
  const coverageWarnings = [...synthesis.coverageWarnings];
  if (droppedPropositions.length > 0) {
    coverageWarnings.push(
      `${droppedPropositions.length} generated proposition(s) were dropped because their cited authority was not retrieved.`,
    );
  }
  if (rejectedQuotes.length > 0) {
    coverageWarnings.push(
      `${rejectedQuotes.length} generated quote(s) were removed because they could not be verified verbatim against the cited passage.`,
    );
  }
  if (fabricatedAuthorityIds.size > 0) {
    coverageWarnings.push(
      `${fabricatedAuthorityIds.size} cited authority identifier(s) did not exist in the retrieved corpus results and were removed.`,
    );
  }

  const conciseAnswer =
    index.authorityIds.size === 0
      ? NO_CORPUS_SYNTHESIS_ANSWER
      : grounded
        ? synthesis.conciseAnswer
        : UNSUPPORTED_SYNTHESIS_ANSWER;

  return {
    synthesis: {
      ...synthesis,
      conciseAnswer,
      legalPropositions,
      sources,
      supportingAuthorities: supporting.known,
      contraryAuthorities: contrary.known,
      coverageWarnings,
    },
    grounded,
    droppedPropositions,
    droppedSources,
    fabricatedAuthorityIds: [...fabricatedAuthorityIds],
    unknownChunkIds: [...unknownChunkIds],
    rejectedQuotes,
    schemaValid: true,
  };
}

/**
 * Coverage warnings are mandatory output: a research answer must always say what it did not cover.
 * Treatment is never verified by NyayaGrid, so that warning is always present.
 */
export function buildCoverageWarnings(input: {
  hitCount: number;
  authorityCount: number;
  contrarySearchPerformed: boolean;
  jurisdictionFilter?: string | null;
  jurisdictionFilters?: string[];
  treatmentVerified?: boolean;
  extra?: string[];
}): string[] {
  const warnings: string[] = [LIMITED_CORPUS_WARNING];

  if (input.hitCount === 0) {
    warnings.push(NO_AUTHORITY_HITS_WARNING);
  } else if (input.authorityCount <= 2) {
    warnings.push(
      `Only ${input.authorityCount} distinct authority record(s) matched; corpus coverage for this question is thin.`,
    );
  }

  if (!input.treatmentVerified) {
    warnings.push(TREATMENT_UNVERIFIED_NOTICE);
  }

  const hasJurisdiction =
    Boolean(input.jurisdictionFilter?.trim()) || (input.jurisdictionFilters?.length ?? 0) > 0;
  if (!hasJurisdiction) {
    warnings.push(JURISDICTION_UNSPECIFIED_WARNING);
  }

  if (!input.contrarySearchPerformed) {
    warnings.push(NO_CONTRARY_SEARCH_WARNING);
  }

  for (const warning of input.extra ?? []) {
    if (warning.trim()) warnings.push(warning.trim());
  }

  return [...new Set(warnings)];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toResearchAuthorityChunks(
  hits: ResearchHit[],
  chunkTexts: Map<string, AuthorityChunkProvenance>,
): ResearchAuthorityChunk[] {
  return hits.map((hit) => ({
    authorityId: hit.authorityId,
    chunkId: hit.chunkId,
    citation: hit.citation,
    court: hit.court,
    date: hit.decisionDate,
    content: chunkTexts.get(hit.chunkId)?.content ?? hit.snippet,
  }));
}

/** Authority retrieval is always corpus-only: the hybrid retriever, or a caller-supplied provider. */
export function resolveAuthorityRetriever(params: {
  db: Database;
  embeddings: EmbeddingProvider;
  retriever?: AuthorityRetrieverLike;
  provider?: LegalAuthorityProvider;
}): AuthorityRetrieverLike {
  if (params.retriever) return params.retriever;
  if (params.provider) {
    const provider = params.provider;
    return {
      search: (query, filters, options) => provider.search(query, filters, options?.limit),
    };
  }
  const retriever = new AuthorityHybridRetriever(params.db, params.embeddings);
  return {
    search: (query, filters, options) => retriever.search(query, filters, options),
  };
}

function mergeHits(
  target: Map<string, ResearchHit>,
  hits: AuthoritySearchHit[],
  origin: ResearchQueryOrigin,
) {
  for (const hit of hits) {
    const existing = target.get(hit.chunkId);
    if (existing && existing.score >= hit.score) continue;
    target.set(hit.chunkId, { ...hit, queryOrigin: existing?.queryOrigin ?? origin });
  }
}

export type ResearchRetrievalQuery = {
  text: string;
  origin: ResearchQueryOrigin;
  limit?: number;
};

/** Run every retrieval pass over the authority corpus and merge results, best score per passage. */
export async function retrieveResearchAuthorities(params: {
  search: AuthorityRetrieverLike;
  queries: ResearchRetrievalQuery[];
  filters?: AuthoritySearchFilters;
  limit?: number;
}): Promise<ResearchHit[]> {
  const limit = params.limit ?? DEFAULT_HIT_LIMIT;
  const merged = new Map<string, ResearchHit>();
  for (const query of params.queries) {
    const text = query.text.trim();
    if (!text) continue;
    const hits = await params.search.search(text, params.filters ?? {}, {
      limit: query.limit ?? limit,
    });
    mergeHits(merged, hits, query.origin);
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
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
  if (!matter) throw new Error("Matter not found in organization scope");
  return matter.title;
}

/**
 * Verified matter context for issue formulation only.
 *
 * The returned text describes matter facts, timeline, graph, and approved memory. It must never be
 * presented to a model as legal authority, and callers pass it in a clearly separated block.
 */
export async function loadResearchMatterContext(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  question?: string;
}): Promise<{
  text: string | null;
  usedVerifiedIntelligence: boolean;
  usedGraph: boolean;
  usedMemory: boolean;
}> {
  const verified = await loadVerifiedMatterIntelligence({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
  });
  const verifiedText = formatVerifiedIntelligenceForPrompt(verified);

  const graph = await loadVerifiedGraphContext({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    question: params.question,
    limit: 10,
  });

  const memories = await retrieveActiveMatterMemories({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    question: params.question,
    limit: 6,
  });
  const memoryText = formatActiveMemoryForPrompt(memories);

  const blocks = [verifiedText, graph.text, memoryText].filter((block) => Boolean(block?.trim()));
  return {
    text: blocks.length > 0 ? blocks.join("\n\n") : null,
    usedVerifiedIntelligence: Boolean(verifiedText?.trim()),
    usedGraph: Boolean(graph.text?.trim()),
    usedMemory: Boolean(memoryText?.trim()),
  };
}

/** Extract search concepts from verified matter context. Concepts drive retrieval, never answers. */
export async function extractSearchConcepts(params: {
  ai: AIProvider;
  matterTitle: string;
  question: string;
  matterContextText?: string | null;
}): Promise<{ concepts: string[]; jurisdictionCaveats: string[]; coverageWarnings: string[] }> {
  const basePrompt = buildLegalIssueExtractionUserPrompt({
    matterTitle: params.matterTitle,
    researchQuestion: params.question,
    matterChunks: [],
  });
  const userPrompt = params.matterContextText?.trim()
    ? `${basePrompt}\nVerifiedMatterContext (issue framing only, NOT legal authority):\n${params.matterContextText.trim()}`
    : basePrompt;

  const generation = await params.ai.generate({
    temperature: 0,
    schemaName: "legal_issue_extraction",
    messages: [
      { role: "system", content: buildLegalIssueExtractionSystemPrompt() },
      { role: "user", content: userPrompt },
    ],
  });

  const parsed = legalIssueExtractionSchema.safeParse(parseJson(generation.text));
  if (!parsed.success) {
    return {
      concepts: [],
      jurisdictionCaveats: [],
      coverageWarnings: [
        "Legal issue extraction output was unusable; retrieval used the raw question only.",
      ],
    };
  }
  return {
    concepts: parsed.data.searchConcepts.map((concept) => concept.concept).filter(Boolean),
    jurisdictionCaveats: parsed.data.jurisdictionCaveats,
    coverageWarnings: parsed.data.coverageWarnings,
  };
}

/**
 * Ask the model for secondary searches aimed at contrary or limiting authority. Only the query
 * strings are used; the model never gets to assert what the contrary authority says.
 */
export async function generateContraryQueries(params: {
  ai: AIProvider;
  question: string;
  proposition?: string | null;
  authorityIds?: string[];
}): Promise<string[]> {
  const generation = await params.ai.generate({
    temperature: 0,
    schemaName: "contrary_authority_search",
    messages: [
      { role: "system", content: buildContraryAuthoritySearchSystemPrompt() },
      {
        role: "user",
        content: buildContraryAuthoritySearchUserPrompt({
          researchQuestion: params.question,
          proposition: params.proposition ?? null,
          authorityIds: params.authorityIds ?? [],
        }),
      },
    ],
  });
  const parsed = contraryAuthoritySearchSchema.safeParse(parseJson(generation.text));
  if (!parsed.success) return [];
  return parsed.data.queries.map((query) => query.query).filter((query) => query.trim().length > 0);
}

export type RunResearchQueryParams = {
  db: Database;
  organizationId: string;
  userId: string;
  sessionId?: string | null;
  matterId?: string | null;
  question: string;
  filters?: AuthoritySearchFilters;
  ai?: AIProvider;
  embeddings?: EmbeddingProvider;
  includeContrary?: boolean;
  /** Load verified matter context for issue formulation. Defaults to true when matterId is set. */
  includeMatterContext?: boolean;
  limit?: number;
  /** Override retrieval. Defaults to AuthorityHybridRetriever over the corpus. */
  retriever?: AuthorityRetrieverLike;
  /** Alternative to retriever: any LegalAuthorityProvider (e.g. LocalImportedAuthorityProvider). */
  provider?: LegalAuthorityProvider;
};

export type RunResearchQueryResult = {
  session: ResearchSession;
  queryId: string;
  artifactId: string | null;
  synthesis: ResearchSynthesis;
  hits: ResearchHit[];
  coverageWarnings: string[];
  grounded: boolean;
  validation: Omit<SynthesisValidation, "synthesis">;
  usedMatterContext: boolean;
  contrarySearchPerformed: boolean;
  provider: string;
  model: string;
};

const MAX_CONCEPT_QUERIES = 3;
const MAX_CONTRARY_QUERIES = 2;
const DEFAULT_HIT_LIMIT = 12;

/**
 * Run one legal research question end to end.
 *
 * Retrieval reads only the legal authority corpus; matter documents are never searched here and
 * verified matter context is used exclusively to formulate the issue. Every authority id, chunk id,
 * and quote in the synthesis is validated against what retrieval actually returned, and anything
 * unsupported is dropped before the answer is persisted.
 */
export async function runResearchQuery(
  params: RunResearchQueryParams,
): Promise<RunResearchQueryResult> {
  const question = params.question.trim();
  if (!question) throw new Error("Research question is required");

  const ai = params.ai ?? createAIProviderFromEnv();
  const embeddings = params.embeddings ?? createEmbeddingProviderFromEnv();
  const limit = params.limit ?? DEFAULT_HIT_LIMIT;

  const session = await ensureResearchSession({
    db: params.db,
    organizationId: params.organizationId,
    userId: params.userId,
    sessionId: params.sessionId ?? null,
    matterId: params.matterId ?? null,
    title: question.slice(0, 200),
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
  let matterContextText: string | null = null;
  let concepts: string[] = [];

  if (matterId && params.includeMatterContext !== false) {
    const matterContext = await loadResearchMatterContext({
      db: params.db,
      organizationId: params.organizationId,
      matterId,
      question,
    });
    matterContextText = matterContext.text;

    const matterTitle = await loadMatterTitle(params.db, params.organizationId, matterId);
    const extraction = await extractSearchConcepts({
      ai,
      matterTitle,
      question,
      matterContextText,
    });
    concepts = extraction.concepts.slice(0, MAX_CONCEPT_QUERIES);
    extraWarnings.push(...extraction.coverageWarnings, ...extraction.jurisdictionCaveats);
  }

  const search = resolveAuthorityRetriever({
    db: params.db,
    embeddings,
    retriever: params.retriever,
    provider: params.provider,
  });

  const secondaryLimit = Math.max(4, Math.floor(limit / 2));
  const primaryHits = await retrieveResearchAuthorities({
    search,
    filters,
    limit,
    queries: [
      { text: question, origin: "primary" },
      ...concepts.map((concept) => ({
        text: concept,
        origin: "concept" as const,
        limit: secondaryLimit,
      })),
    ],
  });

  let contrarySearchPerformed = false;
  let contraryHits: ResearchHit[] = [];
  if (params.includeContrary) {
    const contraryQueries = await generateContraryQueries({
      ai,
      question,
      authorityIds: [...new Set(primaryHits.map((hit) => hit.authorityId))].slice(0, 10),
    });
    if (contraryQueries.length > 0) {
      contrarySearchPerformed = true;
      contraryHits = await retrieveResearchAuthorities({
        search,
        filters,
        limit,
        queries: contraryQueries.slice(0, MAX_CONTRARY_QUERIES).map((text) => ({
          text,
          origin: "contrary" as const,
          limit: secondaryLimit,
        })),
      });
    } else {
      extraWarnings.push("Contrary-authority query generation failed; no contrary search was run.");
    }
  }

  const combined = new Map<string, ResearchHit>();
  for (const hit of [...primaryHits, ...contraryHits]) {
    const existing = combined.get(hit.chunkId);
    if (existing && existing.score >= hit.score) continue;
    combined.set(hit.chunkId, existing ? { ...hit, queryOrigin: existing.queryOrigin } : hit);
  }
  const hits = [...combined.values()].sort((a, b) => b.score - a.score).slice(0, limit);

  const chunkTexts = await loadAuthorizedAuthorityChunks({
    db: params.db,
    chunkIds: hits.map((hit) => hit.chunkId),
  });
  const index = buildAuthorityRetrievalIndex(hits, chunkTexts);

  const generation = await ai.generate({
    temperature: 0,
    schemaName: "research_synthesis",
    messages: [
      { role: "system", content: buildResearchSynthesisSystemPrompt() },
      {
        role: "user",
        content: buildResearchSynthesisUserPrompt({
          question,
          jurisdiction: filters.jurisdiction ?? null,
          authorityChunks: toResearchAuthorityChunks(hits, chunkTexts),
          matterContextSummary: matterContextText,
        }),
      },
    ],
  });

  const validated = validateSynthesisAgainstRetrieval(parseJson(generation.text), index);
  const coverageWarnings = buildCoverageWarnings({
    hitCount: hits.length,
    authorityCount: index.authorityIds.size,
    contrarySearchPerformed,
    jurisdictionFilter: filters.jurisdiction ?? null,
    jurisdictionFilters: session.jurisdictionFilters ?? [],
    extra: [...validated.synthesis.coverageWarnings, ...extraWarnings],
  });

  const [queryRow] = await params.db
    .insert(researchQueries)
    .values({
      organizationId: params.organizationId,
      sessionId: session.id,
      queryText: question,
      normalizedQuery: question.toLowerCase().replace(/\s+/g, " ").trim(),
      filters: { ...filters, includeContrary: Boolean(params.includeContrary) },
      createdByUserId: params.userId,
    })
    .returning();
  if (!queryRow) throw new Error("Failed to persist research query");

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
        relevanceExplanation: null,
        rank: rank + 1,
      })),
    );
  }

  const propositions: ResearchProposition[] = validated.synthesis.legalPropositions.map(
    (proposition) => ({
      text: proposition.text,
      authorityIds: proposition.authorityIds,
      chunkIds: proposition.chunkIds,
      provenanceClass: "LEGAL_AUTHORITY" as const,
    }),
  );

  const [artifact] = await params.db
    .insert(researchArtifacts)
    .values({
      organizationId: params.organizationId,
      sessionId: session.id,
      matterId,
      artifactType: "synthesis",
      issue: question,
      answer: validated.synthesis.conciseAnswer,
      propositions,
      supportingAuthorities: validated.synthesis.supportingAuthorities,
      contraryAuthorities: validated.synthesis.contraryAuthorities,
      jurisdictionAssumptions: validated.synthesis.jurisdictionCaveats,
      coverageWarnings,
      provider: generation.provider,
      model: generation.model,
      promptVersion: RESEARCH_SYNTHESIS_PROMPT_VERSION,
      createdByUserId: params.userId,
    })
    .returning();

  // Audit records counts and identifiers only: question text, authority text, and the generated
  // answer stay in the research tables rather than the audit trail.
  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId,
    action: "research.query_executed",
    targetType: "research_query",
    targetId: queryRow.id,
    metadata: {
      sessionId: session.id,
      artifactId: artifact?.id ?? null,
      questionChars: question.length,
      hitCount: hits.length,
      authorityCount: index.authorityIds.size,
      conceptQueryCount: concepts.length,
      contrarySearchPerformed,
      grounded: validated.grounded,
      propositionCount: validated.synthesis.legalPropositions.length,
      droppedPropositionCount: validated.droppedPropositions.length,
      fabricatedAuthorityIdCount: validated.fabricatedAuthorityIds.length,
      rejectedQuoteCount: validated.rejectedQuotes.length,
      usedMatterContext: Boolean(matterContextText),
      provider: generation.provider,
      model: generation.model,
      promptVersion: RESEARCH_SYNTHESIS_PROMPT_VERSION,
    },
  });

  const { synthesis, ...validationRest } = validated;

  return {
    session,
    queryId: queryRow.id,
    artifactId: artifact?.id ?? null,
    synthesis: { ...synthesis, coverageWarnings },
    hits,
    coverageWarnings,
    grounded: validated.grounded,
    validation: validationRest,
    usedMatterContext: Boolean(matterContextText),
    contrarySearchPerformed,
    provider: generation.provider,
    model: generation.model,
  };
}

export type AuthoritySummaryValidation = {
  summary: AuthoritySummary;
  droppedChunkIds: string[];
  coverageWarnings: string[];
  schemaValid: boolean;
};

const SUMMARY_FIELDS = [
  "facts",
  "issue",
  "rule",
  "reasoning",
  "holding",
  "proceduralPosture",
  "concurrenceDissent",
  "relevance",
] as const;

/** Strip chunk citations the summary invented; a field with no valid citation keeps its text but loses the citation. */
export function validateAuthoritySummaryCitations(
  raw: unknown,
  allowedChunkIds: Set<string>,
  authorityId: string,
): AuthoritySummaryValidation {
  const parsed = authoritySummarySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      summary: {
        authorityId,
        facts: { text: "Summary unavailable.", chunkIds: [] },
        issue: { text: "Summary unavailable.", chunkIds: [] },
        rule: { text: "Summary unavailable.", chunkIds: [] },
        reasoning: { text: "Summary unavailable.", chunkIds: [] },
        holding: { text: "Summary unavailable.", chunkIds: [] },
        proceduralPosture: null,
        concurrenceDissent: null,
        relevance: { text: "Summary unavailable.", chunkIds: [] },
        treatmentUnknown: true,
        coverageWarnings: [
          "The model returned an authority summary that failed schema validation.",
        ],
      },
      droppedChunkIds: [],
      coverageWarnings: ["The model returned an authority summary that failed schema validation."],
      schemaValid: false,
    };
  }

  const dropped = new Set<string>();
  const sanitize = <T extends { text: string; chunkIds: string[] }>(value: T): T => ({
    ...value,
    chunkIds: value.chunkIds.filter((chunkId) => {
      if (allowedChunkIds.has(chunkId)) return true;
      dropped.add(chunkId);
      return false;
    }),
  });

  const data = parsed.data;
  const summary: AuthoritySummary = {
    ...data,
    authorityId,
    facts: sanitize(data.facts),
    issue: sanitize(data.issue),
    rule: sanitize(data.rule),
    reasoning: sanitize(data.reasoning),
    holding: sanitize(data.holding),
    proceduralPosture: data.proceduralPosture ? sanitize(data.proceduralPosture) : null,
    concurrenceDissent: data.concurrenceDissent ? sanitize(data.concurrenceDissent) : null,
    relevance: sanitize(data.relevance),
  };

  const coverageWarnings = [...summary.coverageWarnings, TREATMENT_UNVERIFIED_NOTICE];
  if (dropped.size > 0) {
    coverageWarnings.push(
      `${dropped.size} chunk citation(s) in the summary did not match the authority's stored passages and were removed.`,
    );
  }

  return {
    summary: {
      ...summary,
      treatmentUnknown: true,
      coverageWarnings: [...new Set(coverageWarnings)],
    },
    droppedChunkIds: [...dropped],
    coverageWarnings: [...new Set(coverageWarnings)],
    schemaValid: true,
  };
}

function composeAuthoritySummaryText(summary: AuthoritySummary): string {
  return [
    `Facts: ${summary.facts.text}`,
    `Issue: ${summary.issue.text}`,
    `Rule: ${summary.rule.text}`,
    `Reasoning: ${summary.reasoning.text}`,
    `Holding: ${summary.holding.text}`,
    summary.proceduralPosture?.text ? `Procedural posture: ${summary.proceduralPosture.text}` : "",
    summary.concurrenceDissent?.text
      ? `Concurrence/dissent: ${summary.concurrenceDissent.text}`
      : "",
    `Relevance: ${summary.relevance.text}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const MAX_SUMMARY_CHUNKS = 24;

/**
 * Summarize one authority from its own stored passages.
 *
 * The summary is persisted as a research artifact only when an organization scope is supplied,
 * because artifacts are tenant-scoped records.
 */
export async function summarizeAuthority(params: {
  db: Database;
  authorityId: string;
  userId: string;
  organizationId?: string | null;
  sessionId?: string | null;
  matterId?: string | null;
  researchQuestion?: string | null;
  ai?: AIProvider;
  maxChunks?: number;
}): Promise<{
  summary: AuthoritySummary;
  artifactId: string | null;
  coverageWarnings: string[];
  droppedChunkIds: string[];
  chunkCount: number;
  provider: string;
  model: string;
}> {
  const ai = params.ai ?? createAIProviderFromEnv();
  const chunks = await loadAuthorizedAuthorityChunks({
    db: params.db,
    authorityIds: [params.authorityId],
  });
  const ordered = [...chunks.values()].slice(0, params.maxChunks ?? MAX_SUMMARY_CHUNKS);
  if (ordered.length === 0) {
    throw new Error("Authority has no current-version passages to summarize");
  }

  const generation = await ai.generate({
    temperature: 0,
    schemaName: "authority_summary",
    messages: [
      { role: "system", content: buildAuthoritySummarySystemPrompt() },
      {
        role: "user",
        content: buildAuthoritySummaryUserPrompt({
          authorityId: params.authorityId,
          researchQuestion: params.researchQuestion ?? null,
          authorityChunks: ordered.map((chunk) => ({
            authorityId: chunk.authorityId,
            chunkId: chunk.chunkId,
            citation: chunk.citation,
            court: chunk.court,
            date: chunk.decisionDate,
            content: chunk.content,
          })),
        }),
      },
    ],
  });

  const validated = validateAuthoritySummaryCitations(
    parseJson(generation.text),
    new Set(ordered.map((chunk) => chunk.chunkId)),
    params.authorityId,
  );

  let artifactId: string | null = null;
  if (params.organizationId) {
    const first = ordered[0]!;
    const citedChunkIds = [
      ...new Set(SUMMARY_FIELDS.flatMap((field) => validated.summary[field]?.chunkIds ?? [])),
    ];
    const [artifact] = await params.db
      .insert(researchArtifacts)
      .values({
        organizationId: params.organizationId,
        sessionId: params.sessionId ?? null,
        matterId: params.matterId ?? null,
        artifactType: "authority_summary",
        issue: `Authority summary: ${first.citation ?? first.title}`,
        answer: composeAuthoritySummaryText(validated.summary),
        propositions: [
          {
            text: validated.summary.rule.text,
            authorityIds: [params.authorityId],
            chunkIds: validated.summary.rule.chunkIds,
            provenanceClass: "LEGAL_AUTHORITY" as const,
          },
        ],
        supportingAuthorities: [params.authorityId],
        contraryAuthorities: [],
        jurisdictionAssumptions: [],
        coverageWarnings: validated.coverageWarnings,
        provider: generation.provider,
        model: generation.model,
        promptVersion: AUTHORITY_SUMMARY_PROMPT_VERSION,
        createdByUserId: params.userId,
      })
      .returning();
    artifactId = artifact?.id ?? null;

    await writeAuditEvent(params.db, {
      organizationId: params.organizationId,
      actorUserId: params.userId,
      matterId: params.matterId ?? null,
      action: "research.authority_summarized",
      targetType: "legal_authority",
      targetId: params.authorityId,
      metadata: {
        artifactId,
        sessionId: params.sessionId ?? null,
        chunkCount: ordered.length,
        citedChunkCount: citedChunkIds.length,
        droppedChunkIdCount: validated.droppedChunkIds.length,
        provider: generation.provider,
        model: generation.model,
        promptVersion: AUTHORITY_SUMMARY_PROMPT_VERSION,
      },
    });
  }

  return {
    summary: validated.summary,
    artifactId,
    coverageWarnings: validated.coverageWarnings,
    droppedChunkIds: validated.droppedChunkIds,
    chunkCount: ordered.length,
    provider: generation.provider,
    model: generation.model,
  };
}
