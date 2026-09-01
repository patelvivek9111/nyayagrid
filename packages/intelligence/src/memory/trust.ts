import { chunkIdsFromSourceReference } from "./present";
import { isVerifiedReviewStatus } from "../review-status";

export type MemoryCreateStatus = "proposed" | "approved";

/**
 * STORAGE != VERIFICATION.
 * Approval is never inferred from origin, memoryType, confidence, or create route.
 */
export function resolveMemoryCreateStatus(params: {
  status?: MemoryCreateStatus;
  origin?: string | null;
  memoryType?: string | null;
  confidence?: string | null;
}): MemoryCreateStatus {
  void params.origin;
  void params.memoryType;
  void params.confidence;
  return params.status ?? "proposed";
}

export function resolveMemoryCreateConfidence(params: {
  confidence?: "low" | "medium" | "high" | null;
  origin?: string | null;
}): "low" | "medium" | "high" | null {
  void params.origin;
  if (params.confidence !== undefined) return params.confidence;
  return "medium";
}

export function isDownstreamEligibleMemory(row: {
  status?: string | null;
  supersededBy?: string | null;
}): boolean {
  if (!isVerifiedReviewStatus(row.status ?? "")) return false;
  return !row.supersededBy;
}

export function memoriesEligibleForDownstreamPrompt<
  T extends { status?: string | null; supersededBy?: string | null },
>(memories: T[]): T[] {
  return memories.filter((row) => {
    if (!row.status) return true;
    return isDownstreamEligibleMemory(row);
  });
}

export function memoryPromptTrustLabel(row: {
  origin?: string | null;
  sourceReference?: Record<string, unknown> | null;
}): string {
  const origin = row.origin ?? "unknown";
  const cited = chunkIdsFromSourceReference(row.sourceReference).length > 0;
  if (origin === "manual") return "reviewed user-provided information";
  if (origin === "ai" && cited) return "reviewed AI-derived memory with cited sources";
  if (origin === "ai") return "reviewed AI-derived memory";
  return "reviewed matter memory";
}

const UNIVERSAL_ABSENCE =
  /\b(never|ever issued|was ever|were ever|no \w[\w\s]{0,40} (?:was|were) ever)\b/i;
const PHYSICAL_ENTRY = /\b(entered|enters|enter the|went into|walked into)\b/i;
const BADGE_ACTIVITY = /\b(access granted|badge|card reader|keycard|swipe)\b/i;

function fold(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function significantTokens(text: string): string[] {
  return fold(text)
    .split(/\W+/)
    .filter((token) => token.length >= 5);
}

export function propositionChunkOverlap(proposition: string, chunk: string): number {
  const tokens = significantTokens(proposition);
  if (tokens.length === 0) return 0;
  const hay = fold(chunk);
  return tokens.filter((token) => hay.includes(token)).length / tokens.length;
}

export function chunkSupportsMemoryProposition(proposition: string, chunk: string): boolean {
  if (propositionChunkOverlap(proposition, chunk) < 0.3) return false;
  if (UNIVERSAL_ABSENCE.test(proposition) && !UNIVERSAL_ABSENCE.test(chunk)) return false;
  if (PHYSICAL_ENTRY.test(proposition) && BADGE_ACTIVITY.test(chunk) && !PHYSICAL_ENTRY.test(chunk)) {
    return false;
  }
  return true;
}

/** Unknown provenance stays empty. Never attach an unrelated first chunk. */
export function filterSupportingMemoryChunkIds(params: {
  title: string;
  content: string;
  claimedChunkIds: string[];
  chunks: Array<{ id: string; content: string }>;
}): string[] {
  const proposition = `${params.title}\n${params.content}`;
  const allowed = new Set(params.claimedChunkIds.filter(Boolean));
  if (allowed.size === 0) return [];
  return params.chunks
    .filter((chunk) => allowed.has(chunk.id) && chunkSupportsMemoryProposition(proposition, chunk.content))
    .map((chunk) => chunk.id);
}

export function memoryTypeForUnsupportedAiClaim<T extends string>(
  memoryType: T,
  supportingChunkIds: string[],
): T | "other" {
  if (memoryType === "verified_context" && supportingChunkIds.length === 0) return "other";
  return memoryType;
}
