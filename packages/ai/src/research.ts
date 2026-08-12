import { z } from "zod";
import { formatProfessionalChunks, type ProfessionalChunk } from "./professional";

export const QUERY_DECOMPOSITION_PROMPT_VERSION = "query-decomposition-v1";
export const LEGAL_ISSUE_EXTRACTION_PROMPT_VERSION = "legal-issue-extraction-v1";
export const AUTHORITY_RELEVANCE_EXPLANATION_PROMPT_VERSION = "authority-relevance-explanation-v1";
export const AUTHORITY_SUMMARY_PROMPT_VERSION = "authority-summary-v1";
export const RESEARCH_SYNTHESIS_PROMPT_VERSION = "research-synthesis-v1";
export const CONTRARY_AUTHORITY_SEARCH_PROMPT_VERSION = "contrary-authority-search-v1";
export const QUOTE_CANDIDATES_PROMPT_VERSION = "quote-candidates-v1";
export const RESEARCH_MEMO_PROMPT_VERSION = "research-memo-v1";

export const RESEARCH_GROUNDING_RULES = [
  "Never fabricate authorities, citations, quotes, or legal propositions.",
  "Use ONLY provided LegalAuthority passages for rules, holdings, and quotations.",
  "MatterContext may inform issue formulation and factual framing only; it is NOT legal authority.",
  "Authority treatment and currentness are unknown unless explicitly provided in LegalAuthority metadata.",
  "If coverage is incomplete, state coverageWarnings clearly.",
  "Your training knowledge and external model memory are NOT legal sources.",
] as const;

export const relevanceTierSchema = z.enum([
  "highly_relevant",
  "relevant",
  "marginally_relevant",
  "not_relevant",
]);

export const queryDecompositionSubQuerySchema = z.object({
  query: z.string().min(1).max(2000),
  purpose: z.string().max(2000).optional().nullable(),
  priority: z.enum(["primary", "secondary"]).default("primary"),
});

export const queryDecompositionSchema = z.object({
  subQueries: z.array(queryDecompositionSubQuerySchema).min(1),
  jurisdictionHints: z.array(z.string().max(500)).default([]),
  coverageWarnings: z.array(z.string().max(2000)).default([]),
});

export const legalSearchConceptSchema = z.object({
  concept: z.string().min(1).max(1000),
  rationale: z.string().min(1).max(4000),
  matterChunkIds: z.array(z.string().uuid()).default([]),
});

export const legalIssueExtractionSchema = z.object({
  searchConcepts: z.array(legalSearchConceptSchema).min(1),
  jurisdictionCaveats: z.array(z.string().max(2000)).default([]),
  coverageWarnings: z.array(z.string().max(2000)).default([]),
});

export const authorityRelevanceExplanationSchema = z.object({
  authorityId: z.string().uuid(),
  relevanceScore: z.number().min(0).max(1).optional().nullable(),
  relevanceTier: relevanceTierSchema.default("relevant"),
  explanation: z.string().min(1).max(8000),
  supportingChunkIds: z.array(z.string().uuid()).min(1),
  limitations: z.array(z.string().max(2000)).default([]),
});

export const citedAuthorityFieldSchema = z.object({
  text: z.string().min(1).max(8000),
  chunkIds: z.array(z.string().uuid()).default([]),
});

export const authoritySummarySchema = z.object({
  authorityId: z.string().uuid(),
  facts: citedAuthorityFieldSchema,
  issue: citedAuthorityFieldSchema,
  rule: citedAuthorityFieldSchema,
  reasoning: citedAuthorityFieldSchema,
  holding: citedAuthorityFieldSchema,
  proceduralPosture: citedAuthorityFieldSchema.optional().nullable(),
  concurrenceDissent: citedAuthorityFieldSchema.optional().nullable(),
  relevance: citedAuthorityFieldSchema,
  treatmentUnknown: z.boolean().default(true),
  coverageWarnings: z.array(z.string().max(2000)).default([]),
});

export const legalPropositionSchema = z.object({
  text: z.string().min(1).max(4000),
  authorityIds: z.array(z.string().uuid()).min(1),
  chunkIds: z.array(z.string().uuid()).default([]),
});

export const researchSourceSchema = z.object({
  authorityId: z.string().uuid(),
  chunkId: z.string().uuid().optional().nullable(),
  quote: z.string().max(4000).optional().nullable(),
  pinpoint: z.string().max(500).optional().nullable(),
});

export const researchSynthesisSchema = z.object({
  conciseAnswer: z.string().min(1).max(8000),
  legalPropositions: z.array(legalPropositionSchema).default([]),
  supportingAuthorities: z.array(z.string().uuid()).default([]),
  contraryAuthorities: z.array(z.string().uuid()).default([]),
  importantDistinctions: z.array(z.string().max(2000)).default([]),
  jurisdictionCaveats: z.array(z.string().max(2000)).default([]),
  unresolvedIssues: z.array(z.string().max(2000)).default([]),
  coverageWarnings: z.array(z.string().max(2000)).default([]),
  sources: z.array(researchSourceSchema).default([]),
});

export const contraryAuthoritySearchQuerySchema = z.object({
  query: z.string().min(1).max(2000),
  rationale: z.string().min(1).max(4000),
  targetAuthorityIds: z.array(z.string().uuid()).default([]),
});

export const contraryAuthoritySearchSchema = z.object({
  queries: z.array(contraryAuthoritySearchQuerySchema).default([]),
});

export const quoteCandidateSchema = z.object({
  authorityId: z.string().uuid(),
  chunkId: z.string().uuid(),
  quote: z.string().min(1).max(4000),
  pinpoint: z.string().max(500).optional().nullable(),
  propositionSupport: z.string().max(2000).optional().nullable(),
});

export const quoteCandidatesSchema = z.object({
  candidates: z.array(quoteCandidateSchema).default([]),
});

export const memoPropositionSchema = z.object({
  text: z.string().min(1).max(4000),
  authorityIds: z.array(z.string().uuid()).min(1),
  chunkIds: z.array(z.string().uuid()).default([]),
});

export const researchMemoSchema = z.object({
  issue: z.string().min(1).max(4000),
  shortAnswer: z.string().min(1).max(4000),
  factsAssumptions: z.string().min(1).max(8000),
  applicableAuthorities: z.array(z.string().uuid()).default([]),
  analysis: z.string().min(1).max(12000),
  counterarguments: z.string().max(8000).default(""),
  conclusion: z.string().min(1).max(4000),
  authorityVerificationNotes: z.array(z.string().max(2000)).default([]),
  coverageWarnings: z.array(z.string().max(2000)).default([]),
  propositions: z.array(memoPropositionSchema).default([]),
});

export type QueryDecomposition = z.infer<typeof queryDecompositionSchema>;
export type LegalIssueExtraction = z.infer<typeof legalIssueExtractionSchema>;
export type AuthorityRelevanceExplanation = z.infer<typeof authorityRelevanceExplanationSchema>;
export type AuthoritySummary = z.infer<typeof authoritySummarySchema>;
export type ResearchSynthesis = z.infer<typeof researchSynthesisSchema>;
export type ContraryAuthoritySearch = z.infer<typeof contraryAuthoritySearchSchema>;
export type QuoteCandidates = z.infer<typeof quoteCandidatesSchema>;
export type ResearchMemo = z.infer<typeof researchMemoSchema>;
export type LegalProposition = z.infer<typeof legalPropositionSchema>;
export type ResearchAuthorityChunk = {
  authorityId: string;
  chunkId: string;
  citation?: string | null;
  court?: string | null;
  date?: string | null;
  content: string;
};

function researchGroundingRulesText(): string {
  return RESEARCH_GROUNDING_RULES.join(" ");
}

export function formatResearchAuthorityChunks(chunks: ResearchAuthorityChunk[]): string {
  return chunks
    .map(
      (c) =>
        `- authorityId=${c.authorityId} | chunkId=${c.chunkId} | citation=${c.citation ?? "null"} | court=${c.court ?? "null"} | date=${c.date ?? "null"} | text=|${c.content}|`,
    )
    .join("\n");
}

export function extractResearchAuthorityChunksFromPrompt(prompt: string): ResearchAuthorityChunk[] {
  const block =
    prompt
      .split(/LegalAuthority:\s*/i)[1]
      ?.split(/MatterContext:|Question:|Research question:/i)[0] ??
    prompt.split(/LegalAuthority:\s*/i)[1] ??
    prompt;
  return block
    .split(/\n?- authorityId=/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((part) => {
      const authorityId = part.match(/^([^\s|]+)/)?.[1] ?? "";
      const chunkId = part.match(/chunkId=([^\s|]+)/)?.[1] ?? "";
      const citation = part.match(/citation=([^\s|]+)/)?.[1];
      const court = part.match(/court=([^\s|]+)/)?.[1];
      const date = part.match(/date=([^\s|]+)/)?.[1];
      const content = part.match(/text=\|(.*)\|$/s)?.[1] ?? part;
      return {
        authorityId,
        chunkId,
        citation: citation && citation !== "null" ? citation : null,
        court: court && court !== "null" ? court : null,
        date: date && date !== "null" ? date : null,
        content: content.trim(),
      };
    })
    .filter((c) => c.authorityId && c.chunkId);
}

export function extractMatterContextFromPrompt(prompt: string): ProfessionalChunk[] {
  const block = prompt
    .split(/MatterContext:\s*/i)[1]
    ?.split(/LegalAuthority:|Question:|Research question:/i)[0];
  if (!block) return [];
  return block
    .split(/\n?- chunkId=/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((part) => {
      const chunkId = part.match(/^([^\s|]+)/)?.[1] ?? "";
      const documentId = part.match(/documentId=([^\s|]+)/)?.[1] ?? "";
      const documentVersionId = part.match(/documentVersionId=([^\s|]+)/)?.[1] ?? "";
      const pageRaw = part.match(/page=([^\s|]+)/)?.[1];
      const segmentRef = part.match(/segmentRef=([^\s|]+)/)?.[1];
      const content = part.match(/text=\|(.*)\|$/s)?.[1] ?? part;
      return {
        chunkId,
        documentId,
        documentVersionId,
        page: pageRaw && pageRaw !== "null" ? Number(pageRaw) : null,
        segmentRef: segmentRef && segmentRef !== "null" ? segmentRef : null,
        content: content.trim(),
      };
    })
    .filter((c) => c.chunkId && c.documentId);
}

export function buildQueryDecompositionSystemPrompt(): string {
  return [
    "You decompose legal research queries into focused sub-queries.",
    researchGroundingRulesText(),
    "Return JSON only: {subQueries:[{query,purpose,priority}], jurisdictionHints:[], coverageWarnings:[]}.",
    "If the question is too broad or jurisdiction is unclear, add coverageWarnings.",
  ].join(" ");
}

export function buildQueryDecompositionUserPrompt(input: {
  question: string;
  jurisdiction?: string | null;
  practiceArea?: string | null;
}): string {
  return [
    `Research question: ${input.question}`,
    input.jurisdiction ? `Jurisdiction: ${input.jurisdiction}` : "",
    input.practiceArea ? `Practice area: ${input.practiceArea}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildLegalIssueExtractionSystemPrompt(): string {
  return [
    "You extract legal search concepts from MatterContext for research planning only.",
    researchGroundingRulesText(),
    "Output search concepts and research angles — NOT legal conclusions drawn from matter documents alone.",
    "Each searchConcept may cite matterChunkIds from MatterContext when the concept is grounded in matter facts.",
    "Return JSON only: {searchConcepts:[{concept,rationale,matterChunkIds}], jurisdictionCaveats:[], coverageWarnings:[]}.",
  ].join(" ");
}

export function buildLegalIssueExtractionUserPrompt(input: {
  matterTitle: string;
  researchQuestion?: string | null;
  matterChunks: ProfessionalChunk[];
}): string {
  return [
    `Matter: ${input.matterTitle}`,
    input.researchQuestion ? `Research question: ${input.researchQuestion}` : "",
    "MatterContext:",
    formatProfessionalChunks(input.matterChunks) || "(none)",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildAuthorityRelevanceExplanationSystemPrompt(): string {
  return [
    "You explain authority relevance for legal research using ONLY provided LegalAuthority passages.",
    researchGroundingRulesText(),
    "Each explanation MUST cite supportingChunkIds from LegalAuthority.",
    "Return JSON only: {authorityId, relevanceScore, relevanceTier, explanation, supportingChunkIds, limitations}.",
  ].join(" ");
}

export function buildAuthorityRelevanceExplanationUserPrompt(input: {
  authorityId: string;
  researchQuestion: string;
  authorityChunks: ResearchAuthorityChunk[];
}): string {
  return [
    `AuthorityId: ${input.authorityId}`,
    `Research question: ${input.researchQuestion}`,
    "LegalAuthority:",
    formatResearchAuthorityChunks(input.authorityChunks) || "(none)",
  ].join("\n");
}

export function buildAuthoritySummarySystemPrompt(): string {
  return [
    "You summarize legal authority using ONLY provided LegalAuthority passages.",
    researchGroundingRulesText(),
    "Populate facts, issue, rule, reasoning, holding, proceduralPosture, concurrenceDissent, and relevance.",
    "Each field is {text, chunkIds} and chunkIds must reference provided LegalAuthority chunks when citing passages.",
    "Set treatmentUnknown true unless treatment metadata is explicitly provided.",
    "Return JSON only matching the authority summary schema.",
  ].join(" ");
}

export function buildAuthoritySummaryUserPrompt(input: {
  authorityId: string;
  researchQuestion?: string | null;
  authorityChunks: ResearchAuthorityChunk[];
}): string {
  return [
    `AuthorityId: ${input.authorityId}`,
    input.researchQuestion ? `Research question: ${input.researchQuestion}` : "",
    "LegalAuthority:",
    formatResearchAuthorityChunks(input.authorityChunks) || "(none)",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildResearchSynthesisSystemPrompt(): string {
  return [
    "You synthesize legal research answers using ONLY provided LegalAuthority passages.",
    researchGroundingRulesText(),
    "Each legalProposition MUST include at least one authorityId from LegalAuthority.",
    "List supportingAuthorities, contraryAuthorities, distinctions, caveats, unresolvedIssues, and coverageWarnings.",
    "sources must map authorityId and optional chunkId, quote, and pinpoint from provided passages only.",
    "Return JSON only matching the research synthesis schema.",
  ].join(" ");
}

export function buildResearchSynthesisUserPrompt(input: {
  question: string;
  jurisdiction?: string | null;
  authorityChunks: ResearchAuthorityChunk[];
  matterContextSummary?: string | null;
}): string {
  return [
    `Research question: ${input.question}`,
    input.jurisdiction ? `Jurisdiction: ${input.jurisdiction}` : "",
    input.matterContextSummary
      ? `MatterContext (issue framing only, not legal authority):\n${input.matterContextSummary}`
      : "",
    "LegalAuthority:",
    formatResearchAuthorityChunks(input.authorityChunks) || "(none)",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildContraryAuthoritySearchSystemPrompt(): string {
  return [
    "You generate contrary-authority search queries to test research propositions.",
    researchGroundingRulesText(),
    "Queries should target potentially conflicting or limiting authorities.",
    "Return JSON only: {queries:[{query,rationale,targetAuthorityIds}]}.",
  ].join(" ");
}

export function buildContraryAuthoritySearchUserPrompt(input: {
  researchQuestion: string;
  proposition?: string | null;
  authorityIds?: string[];
}): string {
  return [
    `Research question: ${input.researchQuestion}`,
    input.proposition ? `Proposition to test: ${input.proposition}` : "",
    input.authorityIds?.length ? `Known authorities: ${input.authorityIds.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildQuoteCandidatesSystemPrompt(): string {
  return [
    "You generate quote candidates from provided LegalAuthority passages only.",
    researchGroundingRulesText(),
    "Each candidate MUST include authorityId, chunkId, and quote copied from LegalAuthority.",
    "Return JSON only: {candidates:[{authorityId,chunkId,quote,pinpoint,propositionSupport}]}.",
  ].join(" ");
}

export function buildQuoteCandidatesUserPrompt(input: {
  proposition: string;
  authorityChunks: ResearchAuthorityChunk[];
}): string {
  return [
    `Proposition: ${input.proposition}`,
    "LegalAuthority:",
    formatResearchAuthorityChunks(input.authorityChunks) || "(none)",
  ].join("\n");
}

export function buildResearchMemoSystemPrompt(): string {
  return [
    "You generate a legal research memo using ONLY provided LegalAuthority passages.",
    researchGroundingRulesText(),
    "MatterContext may inform factsAssumptions and issue framing only.",
    "Each proposition MUST map to authorityIds from LegalAuthority.",
    "Include authorityVerificationNotes and coverageWarnings when support is partial.",
    "Return JSON only matching the research memo schema.",
  ].join(" ");
}

export function buildResearchMemoUserPrompt(input: {
  matterTitle: string;
  researchQuestion: string;
  authorityChunks: ResearchAuthorityChunk[];
  matterChunks?: ProfessionalChunk[];
}): string {
  const matterBlock =
    input.matterChunks && input.matterChunks.length > 0
      ? `MatterContext:\n${formatProfessionalChunks(input.matterChunks)}`
      : "";
  return [
    `Matter: ${input.matterTitle}`,
    `Research question: ${input.researchQuestion}`,
    matterBlock,
    "LegalAuthority:",
    formatResearchAuthorityChunks(input.authorityChunks) || "(none)",
  ]
    .filter(Boolean)
    .join("\n");
}

export function mockQueryDecomposition(userPrompt: string): QueryDecomposition {
  const question = userPrompt.match(/Research question:\s*(.+)/i)?.[1]?.trim() ?? userPrompt.trim();
  const jurisdiction = userPrompt.match(/Jurisdiction:\s*(.+)/i)?.[1]?.trim();
  const subQueries: QueryDecomposition["subQueries"] = [
    {
      query: question.slice(0, 500) || "General legal research query",
      purpose: "Primary research angle derived from the user question.",
      priority: "primary",
    },
  ];
  if (/compare|distinction|versus|vs\.?/i.test(question)) {
    subQueries.push({
      query: `Distinguishing authorities for: ${question.slice(0, 280)}`,
      purpose: "Identify potentially distinguishable precedent.",
      priority: "secondary",
    });
  }
  return {
    subQueries,
    jurisdictionHints: jurisdiction ? [jurisdiction] : [],
    coverageWarnings: jurisdiction
      ? []
      : ["Jurisdiction not specified; research coverage may be incomplete."],
  };
}

export function mockLegalIssueExtraction(userPrompt: string): LegalIssueExtraction {
  const matterChunks = extractMatterContextFromPrompt(userPrompt);
  const question = userPrompt.match(/Research question:\s*(.+)/i)?.[1]?.trim();
  const concepts: LegalIssueExtraction["searchConcepts"] = [];
  for (const chunk of matterChunks) {
    const lower = chunk.content.toLowerCase();
    if (/terminat|breach|liabil|contract|neglig|damages|jurisdiction/.test(lower)) {
      const concept = /terminat/.test(lower)
        ? "Contract termination standards"
        : /breach/.test(lower)
          ? "Material breach elements"
          : /liabil|damages/.test(lower)
            ? "Liability and damages framework"
            : /jurisdiction/.test(lower)
              ? "Personal jurisdiction requirements"
              : "Contract interpretation principles";
      concepts.push({
        concept,
        rationale: "Mock search concept derived from matter context for research planning only.",
        matterChunkIds: [chunk.chunkId],
      });
    }
  }
  if (concepts.length === 0 && question) {
    concepts.push({
      concept: question.slice(0, 280),
      rationale: "Mock search concept from stated research question; not a legal conclusion.",
      matterChunkIds: [],
    });
  }
  if (concepts.length === 0) {
    concepts.push({
      concept: "General legal research concepts",
      rationale: "Insufficient matter context; broaden research query.",
      matterChunkIds: [],
    });
  }
  return {
    searchConcepts: concepts.slice(0, 5),
    jurisdictionCaveats: ["Mock extraction does not determine binding jurisdiction."],
    coverageWarnings:
      matterChunks.length === 0
        ? ["No matter context provided; search concepts are not grounded in matter documents."]
        : [],
  };
}

export function mockAuthorityRelevanceExplanation(
  userPrompt: string,
): AuthorityRelevanceExplanation {
  const authorityId =
    userPrompt.match(/AuthorityId:\s*([0-9a-f-]{36})/i)?.[1] ??
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const chunks = extractResearchAuthorityChunksFromPrompt(userPrompt);
  const first = chunks[0];
  const fallbackChunkId = userPrompt.match(/chunkId=([0-9a-f-]{36})/i)?.[1];
  const supportingChunkIds = first
    ? [first.chunkId]
    : fallbackChunkId
      ? [fallbackChunkId]
      : ["11111111-1111-1111-1111-111111111111"];
  return {
    authorityId,
    relevanceScore: first ? 0.82 : 0.35,
    relevanceTier: first ? "highly_relevant" : "not_relevant",
    explanation: first
      ? `Mock relevance explanation based on authority passage: ${first.content.slice(0, 280)}`
      : "Mock relevance explanation with insufficient authority passages.",
    supportingChunkIds,
    limitations: first ? [] : ["No LegalAuthority passages were provided."],
  };
}

export function mockAuthoritySummary(userPrompt: string): AuthoritySummary {
  const authorityId =
    userPrompt.match(/AuthorityId:\s*([0-9a-f-]{36})/i)?.[1] ??
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const chunks = extractResearchAuthorityChunksFromPrompt(userPrompt);
  const first = chunks[0];
  const excerpt = first?.content.slice(0, 400) ?? "No authority text available.";
  const field = (text: string) => ({
    text,
    chunkIds: first ? [first.chunkId] : [],
  });
  return {
    authorityId,
    facts: field(`Facts: ${excerpt.slice(0, 240)}`),
    issue: field("Mock issue derived from provided authority passages only."),
    rule: field(`Rule: ${excerpt.slice(0, 240)}`),
    reasoning: field("Mock reasoning grounded in provided authority text."),
    holding: field(`Holding: ${excerpt.slice(0, 240)}`),
    proceduralPosture: field("Procedural posture not fully stated in provided passages."),
    concurrenceDissent: null,
    relevance: field("Mock relevance to the stated research question."),
    treatmentUnknown: true,
    coverageWarnings: first
      ? ["Treatment and currentness unknown unless separately verified."]
      : ["No LegalAuthority passages provided; summary is incomplete."],
  };
}

export function mockResearchSynthesis(userPrompt: string): ResearchSynthesis {
  const chunks = extractResearchAuthorityChunksFromPrompt(userPrompt);
  const first = chunks[0];
  const authorityId = first?.authorityId ?? "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const excerpt = first?.content.slice(0, 280) ?? "";
  if (!first) {
    return {
      conciseAnswer:
        "Insufficient LegalAuthority passages were provided to synthesize a grounded research answer.",
      legalPropositions: [],
      supportingAuthorities: [],
      contraryAuthorities: [],
      importantDistinctions: [],
      jurisdictionCaveats: [],
      unresolvedIssues: ["No authority passages available for synthesis."],
      coverageWarnings: ["Research coverage is incomplete."],
      sources: [],
    };
  }
  return {
    conciseAnswer: `Mock synthesis based on provided authority: ${excerpt}`,
    legalPropositions: [
      {
        text: "Mock legal proposition supported by the provided authority passage.",
        authorityIds: [authorityId],
        chunkIds: [first.chunkId],
      },
    ],
    supportingAuthorities: [authorityId],
    contraryAuthorities: [],
    importantDistinctions: [],
    jurisdictionCaveats: ["Binding effect depends on jurisdiction and court level."],
    unresolvedIssues: [],
    coverageWarnings: ["Treatment and currentness unknown unless separately verified."],
    sources: [
      {
        authorityId,
        chunkId: first.chunkId,
        quote: excerpt,
        pinpoint: null,
      },
    ],
  };
}

export function mockContraryAuthoritySearch(userPrompt: string): ContraryAuthoritySearch {
  const question = userPrompt.match(/Research question:\s*(.+)/i)?.[1]?.trim() ?? userPrompt.trim();
  const proposition = userPrompt.match(/Proposition to test:\s*(.+)/i)?.[1]?.trim();
  const targetIds = [...userPrompt.matchAll(/([0-9a-f-]{36})/gi)].map((m) => m[1]!);
  return {
    queries: [
      {
        query: proposition
          ? `Contrary authority limiting: ${proposition.slice(0, 240)}`
          : `Contrary authority for: ${question.slice(0, 240)}`,
        rationale: "Mock query to surface potentially limiting or conflicting precedent.",
        targetAuthorityIds: targetIds.slice(0, 3),
      },
    ],
  };
}

export function mockQuoteCandidates(userPrompt: string): QuoteCandidates {
  const chunks = extractResearchAuthorityChunksFromPrompt(userPrompt);
  const proposition = userPrompt.match(/Proposition:\s*(.+)/i)?.[1]?.trim() ?? "";
  return {
    candidates: chunks.slice(0, 3).map((chunk) => ({
      authorityId: chunk.authorityId,
      chunkId: chunk.chunkId,
      quote: chunk.content.slice(0, 400),
      pinpoint: null,
      propositionSupport: proposition
        ? `Mock support for proposition: ${proposition.slice(0, 180)}`
        : "Mock quote candidate from authority passage.",
    })),
  };
}

export function mockResearchMemo(userPrompt: string): ResearchMemo {
  const chunks = extractResearchAuthorityChunksFromPrompt(userPrompt);
  const first = chunks[0];
  const authorityId = first?.authorityId ?? "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const question =
    userPrompt.match(/Research question:\s*(.+)/i)?.[1]?.trim() ?? "Research question not stated.";
  const matterChunks = extractMatterContextFromPrompt(userPrompt);
  const matterFact =
    matterChunks[0]?.content.slice(0, 280) ??
    "Facts and assumptions based on available matter context only.";
  return {
    issue: question.slice(0, 500),
    shortAnswer: first
      ? "Mock short answer grounded in provided LegalAuthority passages."
      : "Insufficient authority support for a grounded short answer.",
    factsAssumptions: matterFact,
    applicableAuthorities: first ? [authorityId] : [],
    analysis: first
      ? `Mock analysis citing authority passage: ${first.content.slice(0, 400)}`
      : "Mock analysis cannot proceed without LegalAuthority passages.",
    counterarguments: "Mock counterarguments require additional contrary-authority research.",
    conclusion: first
      ? "Mock conclusion based solely on provided authority passages; attorney verification required."
      : "Conclusion withheld pending additional authority coverage.",
    authorityVerificationNotes: [
      "Verify citation metadata, quotes, and treatment independently before reliance.",
    ],
    coverageWarnings: first
      ? ["Treatment and currentness unknown unless separately verified."]
      : ["No LegalAuthority passages provided."],
    propositions: first
      ? [
          {
            text: "Mock memo proposition supported by provided authority.",
            authorityIds: [authorityId],
            chunkIds: [first.chunkId],
          },
        ]
      : [],
  };
}
