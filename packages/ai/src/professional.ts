import { z } from "zod";
import { confidenceLevelSchema } from "./intelligence";
import {
  findDeterministicContradictionCandidates,
  refineContradictionCandidates,
  refineDepositionFindingClass,
} from "./contradiction-semantics";

export const DRAFT_GENERATION_PROMPT_VERSION = "draft-generation-v1";
export const CONTRACT_ANALYSIS_PROMPT_VERSION = "contract-analysis-v2";
export const REDLINE_SUGGESTIONS_PROMPT_VERSION = "redline-suggestions-v1";
export const DEPOSITION_ANALYSIS_PROMPT_VERSION = "deposition-analysis-v2";
export const CONTRADICTION_ANALYSIS_PROMPT_VERSION = "contradiction-analysis-v3";
export const DISCOVERY_CLASSIFICATION_PROMPT_VERSION = "discovery-classification-v1";

export const analysisAttentionSchema = z.enum(["informational", "review", "high_attention"]);

export const draftAssertionSchema = z.object({
  text: z.string().min(1).max(5000),
  chunkIds: z.array(z.string().uuid()).min(1),
});

export const draftGenerationSchema = z.object({
  content: z.string().min(1),
  assertions: z.array(draftAssertionSchema).default([]),
  assumptions: z.array(z.string()).default([]),
});

export const contractAnalysisItemSchema = z.object({
  category: z.string().min(1).max(120),
  title: z.string().min(1).max(300),
  originalText: z.string().max(5000).optional().nullable(),
  explanation: z.string().min(1).max(8000),
  attention: analysisAttentionSchema.default("informational"),
  sourceChunkIds: z.array(z.string().uuid()).min(1),
  supportingQuotes: z.array(z.string().min(1).max(800)).max(8).optional().default([]),
});

export const contractAnalysisSchema = z.object({
  summary: z.string().min(1).max(8000),
  items: z.array(contractAnalysisItemSchema).default([]),
});

export const redlineSuggestionProposalSchema = z.object({
  currentClause: z.string().min(1).max(8000),
  proposedClause: z.string().min(1).max(8000),
  reason: z.string().min(1).max(4000),
  issue: z.string().max(2000).optional().nullable(),
  chunkId: z.string().uuid().optional().nullable(),
});

export const redlineSuggestionsSchema = z.object({
  suggestions: z.array(redlineSuggestionProposalSchema).default([]),
});

export const depositionFindingSchema = z.object({
  findingType: z.string().min(1).max(120),
  title: z.string().min(1).max(300),
  explanation: z.string().max(8000).optional().nullable(),
  confidence: confidenceLevelSchema.default("medium"),
  attention: analysisAttentionSchema.default("review"),
  sourceChunkIds: z.array(z.string().uuid()).min(1),
  supportingQuotes: z.array(z.string().min(1).max(800)).max(8).optional().default([]),
});

const depositionAnalysisObjectSchema = z.object({
  summary: z.string().max(8000).optional().nullable(),
  findings: z.array(depositionFindingSchema).default([]),
});

/**
 * Live models sometimes emit attention as "High"/"Medium" (confidence-shaped labels)
 * instead of informational | review | high_attention.
 *
 * Mapping is representation-only:
 * - high / high_attention → high_attention
 * - medium / review → review (deposition default bucket)
 * - low / informational → informational
 *
 * Unknown values are left unchanged so Zod can reject that finding.
 */
export function normalizeAnalysisAttention(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  if (normalized === "high_attention" || normalized === "highattention" || normalized === "high") {
    return "high_attention";
  }
  if (normalized === "review" || normalized === "medium" || normalized === "moderate") {
    return "review";
  }
  if (
    normalized === "informational" ||
    normalized === "information" ||
    normalized === "info" ||
    normalized === "low"
  ) {
    return "informational";
  }
  return value;
}

function normalizeDepositionFindingType(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  return trimmed.toLowerCase().replace(/\s+/g, "_").slice(0, 120);
}

function asFindingList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

function findingWasNormalized(raw: unknown, next: Record<string, unknown>): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const original = raw as Record<string, unknown>;
  return (
    original.confidence !== next.confidence ||
    original.attention !== next.attention ||
    original.findingType !== next.findingType
  );
}

export function normalizeDepositionFindingCandidate(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const next = { ...(raw as Record<string, unknown>) };
  if (next.findingType !== undefined) {
    next.findingType = normalizeDepositionFindingType(next.findingType);
  }
  if (next.confidence !== undefined) {
    next.confidence = normalizeConfidenceLevel(next.confidence);
  }
  if (next.attention !== undefined) {
    next.attention = normalizeAnalysisAttention(next.attention);
  }
  if (next.supportingQuotes !== undefined && !Array.isArray(next.supportingQuotes)) {
    next.supportingQuotes =
      typeof next.supportingQuotes === "string" && next.supportingQuotes.trim()
        ? [next.supportingQuotes]
        : [];
  }
  return next;
}

export function normalizeDepositionRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  obj.findings = asFindingList(obj.findings).map((finding) =>
    normalizeDepositionFindingCandidate(finding),
  );
  return obj;
}

export type ParsedDepositionAnalysis = {
  analysis: z.infer<typeof depositionAnalysisObjectSchema>;
  rejectedMalformed: number;
  normalizedCount: number;
};

/**
 * Normalize representation variants, then keep only findings that match the
 * canonical schema. One malformed row does not fail the envelope.
 */
export function parseDepositionAnalysis(raw: unknown): ParsedDepositionAnalysis {
  const normalized = normalizeDepositionRaw(raw);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    return {
      analysis: { summary: null, findings: [] },
      rejectedMalformed: 1,
      normalizedCount: 0,
    };
  }
  const obj = normalized as Record<string, unknown>;
  const incoming = asFindingList(obj.findings);
  const originalIncoming = asFindingList(
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).findings
      : incoming,
  );
  const findings: z.infer<typeof depositionFindingSchema>[] = [];
  let rejectedMalformed = 0;
  let normalizedCount = 0;
  incoming.forEach((candidate, index) => {
    const parsed = depositionFindingSchema.safeParse(candidate);
    if (!parsed.success) {
      rejectedMalformed += 1;
      return;
    }
    if (findingWasNormalized(originalIncoming[index], candidate as Record<string, unknown>)) {
      normalizedCount += 1;
    }
    const refined = refineDepositionFindingClass(parsed.data);
    if (refined.findingType !== parsed.data.findingType) {
      normalizedCount += 1;
    }
    findings.push(refined);
  });
  const summary =
    typeof obj.summary === "string"
      ? obj.summary.slice(0, 8000)
      : obj.summary === null
        ? null
        : undefined;
  return {
    analysis: { summary: summary ?? null, findings },
    rejectedMalformed,
    normalizedCount,
  };
}

export const depositionAnalysisSchema = z.preprocess(
  (raw) => parseDepositionAnalysis(raw).analysis,
  depositionAnalysisObjectSchema,
);

function normalizeContractItemCandidate(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const next = { ...(raw as Record<string, unknown>) };
  if (next.attention !== undefined) {
    next.attention = normalizeAnalysisAttention(next.attention);
  }
  if (next.supportingQuotes !== undefined && !Array.isArray(next.supportingQuotes)) {
    next.supportingQuotes =
      typeof next.supportingQuotes === "string" && next.supportingQuotes.trim()
        ? [next.supportingQuotes]
        : [];
  }
  return next;
}

function contractItemWasNormalized(raw: unknown, next: Record<string, unknown>): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const original = raw as Record<string, unknown>;
  return original.attention !== next.attention;
}

export type ParsedContractAnalysis = {
  analysis: z.infer<typeof contractAnalysisSchema>;
  rejectedMalformed: number;
  normalizedCount: number;
};

/**
 * Normalize attention representation variants, then keep only items that match
 * the canonical schema. One malformed row does not fail the envelope.
 */
export function parseContractAnalysis(raw: unknown): ParsedContractAnalysis {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      analysis: { summary: "Contract analysis could not be parsed from model output.", items: [] },
      rejectedMalformed: 1,
      normalizedCount: 0,
    };
  }
  const obj = raw as Record<string, unknown>;
  const incoming = asFindingList(obj.items);
  const findings: z.infer<typeof contractAnalysisItemSchema>[] = [];
  let rejectedMalformed = 0;
  let normalizedCount = 0;
  incoming.forEach((candidate, index) => {
    const normalized = normalizeContractItemCandidate(candidate);
    const parsed = contractAnalysisItemSchema.safeParse(normalized);
    if (!parsed.success) {
      rejectedMalformed += 1;
      return;
    }
    if (
      normalized &&
      typeof normalized === "object" &&
      !Array.isArray(normalized) &&
      contractItemWasNormalized(incoming[index], normalized as Record<string, unknown>)
    ) {
      normalizedCount += 1;
    }
    findings.push(parsed.data);
  });
  const summary =
    typeof obj.summary === "string" && obj.summary.trim()
      ? obj.summary.slice(0, 8000)
      : "Contract analysis produced no usable summary.";
  return {
    analysis: { summary, items: findings },
    rejectedMalformed,
    normalizedCount,
  };
}

export const contradictionSideSchema = z.object({
  chunkIds: z.array(z.string().uuid()).min(1),
  summary: z.string().min(1).max(4000),
});

export const contradictionCandidateSchema = z.object({
  title: z.string().min(1).max(300),
  explanation: z.string().min(1).max(8000),
  confidence: confidenceLevelSchema.default("medium"),
  relation: z.enum(["contradiction", "tension"]).optional(),
  sideA: contradictionSideSchema,
  sideB: contradictionSideSchema,
});

/** Live models sometimes return `"High"` or `0.9` instead of the enum. */
export function normalizeConfidenceLevel(value: unknown): unknown {
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim();
    if (normalized === "low" || normalized === "medium" || normalized === "high") {
      return normalized;
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.75) return "high";
    if (value >= 0.4) return "medium";
    if (value >= 0) return "low";
  }
  return value;
}

export function normalizeContradictionRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  if (!Array.isArray(obj.candidates)) return obj;
  obj.candidates = obj.candidates.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
    const next = { ...(candidate as Record<string, unknown>) };
    if (next.confidence !== undefined) {
      next.confidence = normalizeConfidenceLevel(next.confidence);
    }
    if (typeof next.relation === "string") {
      const relation = next.relation.toLowerCase().trim();
      if (relation === "contradiction" || relation === "tension") {
        next.relation = relation;
      } else {
        delete next.relation;
      }
    }
    return next;
  });
  return obj;
}

export const contradictionCandidatesSchema = z.preprocess(
  normalizeContradictionRaw,
  z.object({
    candidates: z.array(contradictionCandidateSchema).default([]),
  }),
);

export const relevanceStatusSchema = z.enum(["unknown", "relevant", "not_relevant"]);
export const privilegeStatusSchema = z.enum([
  "unknown",
  "potentially_privileged",
  "privileged",
  "not_privileged",
]);
export const responsivenessStatusSchema = z.enum(["unknown", "responsive", "not_responsive"]);
export const confidentialityStatusSchema = z.enum(["unknown", "confidential", "not_confidential"]);

export const discoveryClassificationSchema = z.object({
  relevance: relevanceStatusSchema.default("unknown"),
  privilege: privilegeStatusSchema.default("unknown"),
  responsiveness: responsivenessStatusSchema.default("unknown"),
  confidentiality: confidentialityStatusSchema.default("unknown"),
  proposalNote: z.string().max(4000).optional().nullable(),
});

export type DraftGeneration = z.infer<typeof draftGenerationSchema>;
export type DraftAssertion = z.infer<typeof draftAssertionSchema>;
export type ContractAnalysis = z.infer<typeof contractAnalysisSchema>;
export type ContractAnalysisItem = z.infer<typeof contractAnalysisItemSchema>;
export type RedlineSuggestions = z.infer<typeof redlineSuggestionsSchema>;
export type RedlineSuggestionProposal = z.infer<typeof redlineSuggestionProposalSchema>;
export type DepositionAnalysis = z.infer<typeof depositionAnalysisSchema>;
export type DepositionFinding = z.infer<typeof depositionFindingSchema>;
export type ContradictionCandidates = z.infer<typeof contradictionCandidatesSchema>;
export type ContradictionCandidate = z.infer<typeof contradictionCandidateSchema>;
export type DiscoveryClassification = z.infer<typeof discoveryClassificationSchema>;

export type ProfessionalChunk = {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  page?: number | null;
  segmentRef?: string | null;
  content: string;
};

export function formatProfessionalChunks(chunks: ProfessionalChunk[]): string {
  return chunks
    .map(
      (c) =>
        `- chunkId=${c.chunkId} | documentId=${c.documentId} | documentVersionId=${c.documentVersionId} | page=${c.page ?? "null"} | segmentRef=${c.segmentRef ?? "null"} | text=|${c.content}|`,
    )
    .join("\n");
}

/** Round-robin by document so one long contract cannot crowd out related evidence. */
export function selectRelatedChunksForDeposition(
  chunks: ProfessionalChunk[],
  limit = 32,
): ProfessionalChunk[] {
  if (chunks.length <= limit) return chunks;
  const lists: ProfessionalChunk[][] = [];
  const byDoc = new Map<string, ProfessionalChunk[]>();
  for (const chunk of chunks) {
    const list = byDoc.get(chunk.documentId) ?? [];
    list.push(chunk);
    byDoc.set(chunk.documentId, list);
  }
  for (const list of byDoc.values()) lists.push(list);
  const selected: ProfessionalChunk[] = [];
  let index = 0;
  while (selected.length < limit) {
    let added = false;
    for (const list of lists) {
      const chunk = list[index];
      if (!chunk) continue;
      selected.push(chunk);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
    index += 1;
  }
  return selected;
}

export function buildDraftGenerationSystemPrompt(): string {
  return [
    "You generate legal draft content for authorized matter work using ONLY provided Sources and verified context.",
    "Never invent facts, citations, parties, dates, or legal conclusions.",
    "Instructions are drafting goals, not evidence. Do not treat requested facts as true unless they appear in Sources.",
    "Advocacy tone is allowed. Do not state physical entry, missing-exhibit contents, or admissions as established facts unless Sources contain those facts.",
    "Every factual assertion MUST cite one or more provided chunkIds.",
    "State assumptions explicitly when required facts are missing.",
    "This output is AI-generated and requires attorney review.",
    "CaseJurisdictionMetadata, when present, is user Case metadata — not evidence and not verified governing law. Do not convert related jurisdictions into governing law.",
    "Return JSON only: {content, assertions:[{text,chunkIds}], assumptions:[]}.",
  ].join(" ");
}

export function buildDraftGenerationUserPrompt(input: {
  matterTitle: string;
  draftType: string;
  instructions?: string | null;
  verifiedContext?: string | null;
  chunks: ProfessionalChunk[];
}): string {
  return [
    `Matter: ${input.matterTitle}`,
    `Draft type: ${input.draftType}`,
    input.instructions
      ? `Instructions (drafting goals only; not Case facts):\n${input.instructions}`
      : "",
    input.verifiedContext ? `Verified context:\n${input.verifiedContext}` : "",
    "Sources:",
    formatProfessionalChunks(input.chunks) || "(none)",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildContractAnalysisSystemPrompt(): string {
  return [
    "You analyze THIS instrument only, using ONLY provided Sources.",
    "Report what this document states. Do not treat it as the matter-wide current operative contract unless Sources include a later signed instrument and its effective date.",
    "Never invent clauses, exhibits, schedules, amounts, dates, parties, or citations.",
    "Copy legally meaningful numbers, durations, percentages, and dates from Sources into title and explanation (for example, days, dollar amounts, effective dates). Do not write a generic notice finding that omits the stated period.",
    "originalText and supportingQuotes must be verbatim spans from Sources that support that item.",
    "sourceChunkIds must identify the chunk containing that span. Do not cite an unrelated header chunk.",
    "Preserve limiting language: not, except, unless, subject to, only if, may, shall, must, will not exceed.",
    "If Sources are informal correspondence (email), findings may describe communication or belief, but must not treat the email as a signed or controlling contract instrument.",
    "If a referenced exhibit or schedule is not in Sources, say it is missing or unavailable. Do not invent its contents from other clauses, emails, or other contracts.",
    "Do not elevate spelling, formatting, headings, or exhibit-letter/renumbering-only changes as material legal risk.",
    "One item per distinct obligation. Do not repeat the same proposition in different wording.",
    "summary must reflect the items. If items exist, do not claim there are no significant terms. Do not invent claims absent from items.",
    "Each item MUST include category, title, originalText, explanation, attention, sourceChunkIds, and optional supportingQuotes.",
    "attention must be exactly informational, review, or high_attention.",
    "Return JSON only: {summary, items:[{category,title,originalText,explanation,attention,sourceChunkIds,supportingQuotes}]}.",
    "If evidence is insufficient, return a cautious summary and an empty items array rather than inventing findings.",
  ].join(" ");
}

export function buildContractAnalysisUserPrompt(input: {
  documentTitle: string;
  chunks: ProfessionalChunk[];
}): string {
  return [
    `Document: ${input.documentTitle}`,
    "Sources:",
    formatProfessionalChunks(input.chunks) || "(none)",
  ].join("\n");
}

export function buildRedlineSuggestionsSystemPrompt(): string {
  return [
    "You propose contract redline suggestions using ONLY provided Sources.",
    "Never invent clauses or business terms.",
    "Each suggestion MUST include currentClause, proposedClause, reason, optional issue, and optional chunkId from Sources.",
    "Return JSON only: {suggestions:[{currentClause,proposedClause,reason,issue,chunkId}]}.",
    "If no defensible redlines exist, return {suggestions:[]}.",
  ].join(" ");
}

export function buildRedlineSuggestionsUserPrompt(input: {
  documentTitle: string;
  focus?: string | null;
  chunks: ProfessionalChunk[];
}): string {
  return [
    `Document: ${input.documentTitle}`,
    input.focus ? `Focus: ${input.focus}` : "",
    "Sources:",
    formatProfessionalChunks(input.chunks) || "(none)",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildDepositionAnalysisSystemPrompt(): string {
  return [
    "You analyze deposition transcripts for lawyers using ONLY provided Sources and Related matter evidence.",
    "Never invent testimony, admissions, denials, quotes, dates, actors, or impeachment points.",
    "Return no finding rather than inventing one. If nothing material is in the transcript, return findings:[].",
    "Each finding MUST include findingType, title, explanation, confidence, attention, sourceChunkIds, and supportingQuotes.",
    "findingType is a short label. Prefer one of admission, denial, inconsistency, tension, uncertainty, testimony_statement, credibility_issue, date_discrepancy when those labels fit. Other short labels are allowed. Do not invent a finding merely to fill a type.",
    "confidence MUST be exactly one of the lowercase strings low, medium, or high — never a number, never High.",
    "attention MUST be exactly informational, review, or high_attention — never High, Medium, or Low.",
    "supportingQuotes MUST be copied verbatim from the cited chunk text and must actually support the finding. Do not quote document headers or boilerplate general provisions unless that text is the testimony.",
    "Attribute testimony to the speaker (the witness testified / stated / admitted / denied). Testimony about an event is not an established matter fact that the event occurred.",
    "Do not invert a denial into a positive fact.",
    "Preserve uncertainty and approximation (I think, I believe, I do not recall, around, near, maybe). Do not convert uncertain or approximate testimony into an exact fact.",
    "Use inconsistency only when two testimony propositions cannot reasonably both be true in the same scope, time, and context.",
    "Use tension when evidence points in different directions but can coexist (for example, a denial of physical entry and a credential log for an assigned badge).",
    "Recorded credential or system activity (badge, login, swipe, assigned access) is not independent proof of a named person's physical conduct. Do not assert that a named person physically performed the act, and do not assert that the person lied, solely from credential activity.",
    "Do not treat paraphrase, rounding, on-or-about the same date, or imprecise restatements (for example near the middle of a month vs an exact date in that month, or around a date vs that date) as inconsistency or contradiction.",
    "Do not treat unrelated contract or amendment differences as deposition findings unless they are genuinely about the testimony under analysis.",
    "Return JSON only: {summary, findings:[{findingType,title,explanation,confidence,attention,sourceChunkIds,supportingQuotes}]}.",
  ].join(" ");
}

export function buildDepositionAnalysisUserPrompt(input: {
  documentTitle: string;
  witnessName?: string | null;
  chunks: ProfessionalChunk[];
  relatedChunks?: ProfessionalChunk[];
}): string {
  const related = input.relatedChunks?.length
    ? [
        "Related matter evidence (not testimony). Use only when it bears on the testimony. Do not flag unrelated contract or amendment differences as deposition findings.",
        formatProfessionalChunks(input.relatedChunks),
      ]
    : [];
  return [
    `Transcript: ${input.documentTitle}`,
    input.witnessName ? `Witness: ${input.witnessName}` : "",
    "Sources:",
    formatProfessionalChunks(input.chunks) || "(none)",
    ...related,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildContradictionAnalysisSystemPrompt(): string {
  return [
    "You identify potential contradictions and evidentiary tensions across authorized matter Sources only.",
    "Never invent statements or conflicts.",
    "Each candidate MUST include title, explanation, confidence, relation, sideA, and sideB with chunkIds and summaries.",
    "confidence MUST be exactly one of the lowercase strings low, medium, or high — never a number, never High.",
    "relation MUST be exactly contradiction or tension.",
    "Use contradiction only when two propositions cannot reasonably both be true in the same scope, time, and context.",
    "Use tension when evidence points in different directions but does not logically prove an impossible conflict.",
    "Recorded credential or system activity (badge, login, swipe, assigned access) is not independent proof of a named person's physical conduct. If testimony denies an act and a credential log records related activity, classify relation as tension.",
    "Do not treat paraphrase, rounding, on-or-about the same date, or imprecise restatements (for example end of February vs February 28, or near the middle of a month vs an exact date in that month) as contradictions.",
    "Do not treat sequenced contract amendments (an original term later replaced or superseded) as contradictions.",
    "Return JSON only: {candidates:[{title,explanation,confidence,relation,sideA:{chunkIds,summary},sideB:{chunkIds,summary}}]}.",
    "If no defensible contradiction or tension exists, return {candidates:[]}.",
  ].join(" ");
}

export function buildContradictionAnalysisUserPrompt(input: {
  matterTitle: string;
  chunks: ProfessionalChunk[];
}): string {
  return [
    `Matter: ${input.matterTitle}`,
    "Sources:",
    formatProfessionalChunks(input.chunks) || "(none)",
  ].join("\n");
}

export function buildDiscoveryClassificationSystemPrompt(): string {
  return [
    "You propose e-discovery review classifications using ONLY the provided document metadata and excerpt.",
    "Never invent privilege holders, recipients, or responsiveness bases.",
    "Return JSON only: {relevance, privilege, responsiveness, confidentiality, proposalNote}.",
    "Use unknown when evidence is insufficient.",
    "Privilege requires human review; do not mark privileged unless clearly supported.",
  ].join(" ");
}

export function buildDiscoveryClassificationUserPrompt(input: {
  matterTitle: string;
  documentTitle: string;
  requestSummary?: string | null;
  excerpt: string;
}): string {
  return [
    `Matter: ${input.matterTitle}`,
    `Document: ${input.documentTitle}`,
    input.requestSummary ? `Discovery request context: ${input.requestSummary}` : "",
    "Excerpt:",
    input.excerpt,
  ]
    .filter(Boolean)
    .join("\n");
}

export function extractProfessionalChunksFromPrompt(prompt: string): ProfessionalChunk[] {
  const block = prompt.split(/Sources:\s*/i)[1] ?? prompt;
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

export function mockDraftGeneration(userPrompt: string): DraftGeneration {
  const chunks = extractProfessionalChunksFromPrompt(userPrompt);
  const draftType = userPrompt.match(/Draft type:\s*(.+)/i)?.[1]?.trim() ?? "document";
  const first = chunks[0];
  const excerpt = first?.content.slice(0, 400) ?? "No source text available.";
  return {
    content: [
      `[AI-generated ${draftType} draft — attorney review required]`,
      "",
      excerpt,
      "",
      "Based on the available matter sources, this draft summarizes the operative language for further editing.",
    ].join("\n"),
    assertions: first ? [{ text: excerpt.slice(0, 280), chunkIds: [first.chunkId] }] : [],
    assumptions: first
      ? []
      : ["Insufficient source material was provided for a fully grounded draft."],
  };
}

export function mockContractAnalysis(userPrompt: string): ContractAnalysis {
  const chunks = extractProfessionalChunksFromPrompt(userPrompt);
  const items: ContractAnalysisItem[] = [];
  for (const chunk of chunks) {
    const lower = chunk.content.toLowerCase();
    if (/terminat|liabil|indemn|confidential|payment|warrant|notice|insur|exhibit/.test(lower)) {
      const category = /notice/.test(lower)
        ? "notice"
        : /terminat/.test(lower)
          ? "termination"
          : /indemn|liabil/.test(lower)
            ? "risk_allocation"
            : /confidential/.test(lower)
              ? "confidentiality"
              : /payment/.test(lower)
                ? "payment"
                : /insur/.test(lower)
                  ? "insurance"
                  : "general";
      items.push({
        category,
        title: `Review ${category.replace(/_/g, " ")} language`,
        originalText: chunk.content.slice(0, 500),
        explanation: `Mock contract review item derived from source clause language. ${chunk.content.slice(0, 280)}`,
        attention: /indemn|liabil|terminat/.test(lower) ? "high_attention" : "review",
        sourceChunkIds: [chunk.chunkId],
        supportingQuotes: [chunk.content.slice(0, 280)],
      });
    }
  }
  return {
    summary:
      items.length > 0
        ? "Mock contract analysis identified clauses requiring attorney review."
        : "Mock contract analysis found no notable clause patterns in the provided sources.",
    items: items.slice(0, 5),
  };
}

export function mockRedlineSuggestions(userPrompt: string): RedlineSuggestions {
  const chunks = extractProfessionalChunksFromPrompt(userPrompt);
  const suggestions: RedlineSuggestionProposal[] = [];
  for (const chunk of chunks) {
    const lower = chunk.content.toLowerCase();
    if (/without limitation|sole discretion|as is|best efforts/.test(lower)) {
      const currentClause = chunk.content.slice(0, 280);
      suggestions.push({
        currentClause,
        proposedClause: currentClause.replace(/sole discretion/gi, "reasonable discretion"),
        reason: "Mock redline narrows overly broad discretion language.",
        issue: /sole discretion/i.test(chunk.content) ? "Broad discretion" : "Risk language",
        chunkId: chunk.chunkId,
      });
    }
  }
  return { suggestions: suggestions.slice(0, 3) };
}

export function mockDepositionAnalysis(userPrompt: string): DepositionAnalysis {
  const chunks = extractProfessionalChunksFromPrompt(userPrompt);
  const findings: DepositionFinding[] = [];
  for (const chunk of chunks) {
    const lower = chunk.content.toLowerCase();
    if (/i don't recall|cannot remember|not sure|deny|admit/.test(lower)) {
      findings.push({
        findingType: /don't recall|cannot remember|not sure/.test(lower)
          ? "memory_gap"
          : /deny/.test(lower)
            ? "denial"
            : "admission",
        title: "Notable testimony segment",
        explanation: chunk.content.slice(0, 400),
        confidence: "medium",
        attention: /admit|deny/.test(lower) ? "high_attention" : "review",
        sourceChunkIds: [chunk.chunkId],
        supportingQuotes: [chunk.content.slice(0, 280)],
      });
    }
  }
  return {
    summary:
      findings.length > 0
        ? "Mock deposition analysis flagged testimony segments for review."
        : "Mock deposition analysis found no notable testimony patterns.",
    findings: findings.slice(0, 5),
  };
}

const EXACT_CALENDAR_DATE =
  /\b((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\b/gi;
const CAM_TOKEN = /\bCAM\b/;
const CAM_SEND_VERB = /\b(send|sent|emailed|uploaded|transmitted|transmission)\b/i;
const CAM_NON_TRANSMITTAL =
  /\b(not a transmittal|prepared internally|estimated February CAM worksheet)\b/i;

function exactCalendarDates(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(EXACT_CALENDAR_DATE)) {
    found.add(match[1]!.toLowerCase());
  }
  return [...found];
}

function isCamSendAccount(text: string): boolean {
  return CAM_TOKEN.test(text) && CAM_SEND_VERB.test(text) && !CAM_NON_TRANSMITTAL.test(text);
}

/**
 * Deterministic dual-sided CAM send-date conflicts (depo Feb 28 vs PM email March 3).
 * Uses exact month-name dates only; does not invent a single true date.
 */
export function findExactCrossDocumentDateConflicts(
  chunks: ProfessionalChunk[],
): ContradictionCandidates {
  const accounts = chunks.filter(
    (chunk) => isCamSendAccount(chunk.content) && exactCalendarDates(chunk.content).length > 0,
  );
  const candidates: ContradictionCandidate[] = [];
  for (let i = 0; i < accounts.length; i += 1) {
    for (let j = i + 1; j < accounts.length; j += 1) {
      const a = accounts[i]!;
      const b = accounts[j]!;
      if (a.documentId === b.documentId) continue;
      const datesA = exactCalendarDates(a.content);
      const datesB = exactCalendarDates(b.content);
      const conflict =
        datesA.some((d) => !datesB.includes(d)) && datesB.some((d) => !datesA.includes(d));
      if (!conflict) continue;
      candidates.push({
        title: "Conflicting CAM send dates",
        explanation:
          "Two Case documents give different exact dates for when the CAM package was sent or uploaded. Both sides are presented; neither is treated as the true account.",
        confidence: "medium",
        relation: "contradiction",
        sideA: { chunkIds: [a.chunkId], summary: a.content.slice(0, 400) },
        sideB: { chunkIds: [b.chunkId], summary: b.content.slice(0, 400) },
      });
    }
  }
  return { candidates };
}

export function mergeContradictionCandidates(
  primary: ContradictionCandidate[],
  extra: ContradictionCandidate[],
): ContradictionCandidate[] {
  const seen = new Set<string>();
  const merged: ContradictionCandidate[] = [];
  for (const candidate of [...extra, ...primary]) {
    const key = [...candidate.sideA.chunkIds, ...candidate.sideB.chunkIds].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
  }
  return merged.slice(0, 8);
}

export function mockContradictionCandidates(userPrompt: string): ContradictionCandidates {
  const chunks = extractProfessionalChunksFromPrompt(userPrompt);
  if (chunks.length < 2) return { candidates: [] };
  const chunkTextById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk.content]));
  const merged = mergeContradictionCandidates(
    findDeterministicContradictionCandidates(chunks),
    findExactCrossDocumentDateConflicts(chunks).candidates,
  );
  return { candidates: refineContradictionCandidates(merged, chunkTextById) };
}

export function mockDiscoveryClassification(userPrompt: string): DiscoveryClassification {
  const excerpt = userPrompt.match(/Excerpt:\s*([\s\S]+)/i)?.[1]?.trim() ?? userPrompt;
  const lower = excerpt.toLowerCase();
  return {
    relevance: /responsive|relevant|pertain|request/.test(lower) ? "relevant" : "unknown",
    privilege: /attorney|privileged|work product|counsel/.test(lower)
      ? "potentially_privileged"
      : "unknown",
    responsiveness: /request|production|interrogator/.test(lower) ? "responsive" : "unknown",
    confidentiality: /confidential|trade secret|proprietary/.test(lower)
      ? "confidential"
      : "not_confidential",
    proposalNote: "Mock discovery classification for attorney review.",
  };
}
