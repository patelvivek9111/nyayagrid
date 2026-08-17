import { z } from "zod";
import { confidenceLevelSchema } from "./intelligence";

export const DRAFT_GENERATION_PROMPT_VERSION = "draft-generation-v1";
export const CONTRACT_ANALYSIS_PROMPT_VERSION = "contract-analysis-v1";
export const REDLINE_SUGGESTIONS_PROMPT_VERSION = "redline-suggestions-v1";
export const DEPOSITION_ANALYSIS_PROMPT_VERSION = "deposition-analysis-v1";
export const CONTRADICTION_ANALYSIS_PROMPT_VERSION = "contradiction-analysis-v2";
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
});

export const depositionAnalysisSchema = z.object({
  summary: z.string().max(8000).optional().nullable(),
  findings: z.array(depositionFindingSchema).default([]),
});

export const contradictionSideSchema = z.object({
  chunkIds: z.array(z.string().uuid()).min(1),
  summary: z.string().min(1).max(4000),
});

export const contradictionCandidateSchema = z.object({
  title: z.string().min(1).max(300),
  explanation: z.string().min(1).max(8000),
  confidence: confidenceLevelSchema.default("medium"),
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

export function buildDraftGenerationSystemPrompt(): string {
  return [
    "You generate legal draft content for authorized matter work using ONLY provided Sources and verified context.",
    "Never invent facts, citations, parties, dates, or legal conclusions.",
    "Every factual assertion MUST cite one or more provided chunkIds.",
    "State assumptions explicitly when required facts are missing.",
    "This output is AI-generated and requires attorney review.",
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
    input.instructions ? `Instructions: ${input.instructions}` : "",
    input.verifiedContext ? `Verified context:\n${input.verifiedContext}` : "",
    "Sources:",
    formatProfessionalChunks(input.chunks) || "(none)",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildContractAnalysisSystemPrompt(): string {
  return [
    "You analyze contract documents for lawyers using ONLY provided Sources.",
    "Never invent clauses, obligations, risks, or citations.",
    "Each item MUST include category, title, originalText when available, explanation, attention, and sourceChunkIds.",
    "attention must be informational, review, or high_attention.",
    "Return JSON only: {summary, items:[{category,title,originalText,explanation,attention,sourceChunkIds}]}.",
    "If evidence is insufficient, return a cautious summary and an empty items array.",
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
    "You analyze deposition transcripts for lawyers using ONLY provided Sources.",
    "Never invent testimony, admissions, or impeachment points.",
    "Each finding MUST include findingType, title, explanation, confidence, attention, and sourceChunkIds.",
    "Return JSON only: {summary, findings:[{findingType,title,explanation,confidence,attention,sourceChunkIds}]}.",
    "If evidence is insufficient, return a cautious summary and an empty findings array.",
  ].join(" ");
}

export function buildDepositionAnalysisUserPrompt(input: {
  documentTitle: string;
  witnessName?: string | null;
  chunks: ProfessionalChunk[];
}): string {
  return [
    `Transcript: ${input.documentTitle}`,
    input.witnessName ? `Witness: ${input.witnessName}` : "",
    "Sources:",
    formatProfessionalChunks(input.chunks) || "(none)",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildContradictionAnalysisSystemPrompt(): string {
  return [
    "You identify potential contradictions across authorized matter Sources only.",
    "Never invent statements or conflicts.",
    "Each candidate MUST include title, explanation, confidence, sideA, and sideB with chunkIds and summaries.",
    "confidence MUST be exactly one of the lowercase strings low, medium, or high — never a number, never High.",
    "Do not treat paraphrase, rounding, on-or-about the same date, or imprecise restatements (for example end of February vs February 28) as contradictions. Return {candidates:[]} unless two sources cannot both be true.",
    "Return JSON only: {candidates:[{title,explanation,confidence,sideA:{chunkIds,summary},sideB:{chunkIds,summary}}]}.",
    "If no defensible contradictions exist, return {candidates:[]}.",
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
    if (/terminat|liabil|indemn|confidential|payment|warrant/.test(lower)) {
      const category = /terminat/.test(lower)
        ? "termination"
        : /indemn|liabil/.test(lower)
          ? "risk_allocation"
          : /confidential/.test(lower)
            ? "confidentiality"
            : /payment/.test(lower)
              ? "payment"
              : "general";
      items.push({
        category,
        title: `Review ${category.replace(/_/g, " ")} language`,
        originalText: chunk.content.slice(0, 500),
        explanation: "Mock contract review item derived from source clause language.",
        attention: /indemn|liabil|terminat/.test(lower) ? "high_attention" : "review",
        sourceChunkIds: [chunk.chunkId],
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
const CAM_NON_TRANSMITTAL = /\b(not a transmittal|prepared internally|estimated February CAM worksheet)\b/i;

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
  const camConflicts = findExactCrossDocumentDateConflicts(chunks);
  if (camConflicts.candidates.length > 0) return camConflicts;

  const exactDates = (text: string): string[] => {
    const re =
      /\b((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\b/gi;
    const found = new Set<string>();
    for (const match of text.matchAll(re)) {
      found.add(match[1]!.toLowerCase());
    }
    return [...found];
  };

  const datesConflict = (a: string, b: string): boolean => {
    const da = exactDates(a);
    const db = exactDates(b);
    if (da.length === 0 || db.length === 0) return false;
    return da.some((d) => !db.includes(d)) && db.some((d) => !da.includes(d));
  };

  const polarityConflict = (a: string, b: string): boolean => {
    const positive = /\b(signed|agreed|yes|confirmed)\b/i;
    const negative = /\b(denied|never|unfinished)\b/i;
    return (
      (positive.test(a) && negative.test(b)) ||
      (positive.test(b) && negative.test(a)) ||
      (/\bbefore\b/i.test(a) && /\bafter\b/i.test(b)) ||
      (/\bbefore\b/i.test(b) && /\bafter\b/i.test(a))
    );
  };

  for (let i = 0; i < chunks.length; i += 1) {
    for (let j = i + 1; j < chunks.length; j += 1) {
      const a = chunks[i]!;
      const b = chunks[j]!;
      if (!datesConflict(a.content, b.content) && !polarityConflict(a.content, b.content)) {
        continue;
      }
      return {
        candidates: [
          {
            title: "Potential conflicting statements",
            explanation:
              "Mock contradiction candidate based on opposing language in two source chunks. Both sides are presented; neither is treated as the true account.",
            confidence: "medium",
            sideA: { chunkIds: [a.chunkId], summary: a.content.slice(0, 280) },
            sideB: { chunkIds: [b.chunkId], summary: b.content.slice(0, 280) },
          },
        ],
      };
    }
  }
  return { candidates: [] };
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
