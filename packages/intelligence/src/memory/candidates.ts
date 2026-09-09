import { rankByQuestionOverlap } from "@nyayagrid/ai";

export type MemorySourceChunk = { id: string; content: string };

export type GroundedMemoryCandidate = {
  title: string;
  content: string;
  sourceChunkId: string;
};

const INFORMAL_CHUNK =
  /\b(i think|i believe|recollect|my understanding|email from|internal note|still says)\b/i;

const OPERATIVE_QUESTION =
  /\b(notice|period|days|currently|operative|amendment|require|required|term applies|how many)\b/i;

function sentences(content: string): string[] {
  return content
    .split(/(?<=[.!?])\s+/)
    .map((row) => row.replace(/\s+/g, " ").trim())
    .filter((row) => row.length >= 12);
}

function hasNumericTerm(text: string): boolean {
  return /\b(\d+|thirty|sixty|ninety|fifteen|ten)\b/i.test(text);
}

/**
 * Rank matter chunks by question overlap so proposal generation sees the
 * relevant source text instead of an arbitrary first page of the table.
 */
export function selectMemoryProposalChunks(
  question: string | null | undefined,
  chunks: MemorySourceChunk[],
  limit = 12,
): MemorySourceChunk[] {
  if (chunks.length <= limit) return chunks;
  const ranked = rankByQuestionOverlap(
    question?.trim() || "matter memory",
    chunks.map((chunk) => ({ ...chunk, quote: chunk.content })),
  );
  return ranked.slice(0, limit).map((chunk) => ({ id: chunk.id, content: chunk.content }));
}

/**
 * Deterministic, source-backed proposal hints. Never approved.
 * Only extracts numeric/duration sentences that overlap an operative-term question.
 */
export function extractGroundedMemoryCandidates(params: {
  question?: string | null;
  chunks: MemorySourceChunk[];
}): GroundedMemoryCandidate[] {
  const question = params.question?.trim() ?? "";
  if (!question || !OPERATIVE_QUESTION.test(question)) return [];
  const out: GroundedMemoryCandidate[] = [];
  for (const chunk of params.chunks) {
    if (INFORMAL_CHUNK.test(chunk.content)) continue;
    for (const sentence of sentences(chunk.content)) {
      if (!hasNumericTerm(sentence)) continue;
      const scoreTokens = question.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
      const hay = sentence.toLowerCase();
      const hits = scoreTokens.filter((token) => hay.includes(token)).length;
      if (hits < Math.min(2, scoreTokens.length)) continue;
      out.push({
        title: sentence.slice(0, 80),
        content: sentence,
        sourceChunkId: chunk.id,
      });
      if (out.length >= 3) return out;
    }
  }
  return out;
}
