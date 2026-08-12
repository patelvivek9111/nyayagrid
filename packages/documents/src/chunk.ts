import type { ExtractedSegment } from "./extract";

export type DocumentChunkDraft = {
  chunkIndex: number;
  content: string;
  pageStart?: number;
  pageEnd?: number;
  segmentRef: string;
  charStart: number;
  charEnd: number;
  tokenCount: number;
};

const MAX_CHARS = 1200;
const OVERLAP_CHARS = 150;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Paragraph-aware chunking that preserves page/segment provenance for citations. */
export function chunkSegments(segments: ExtractedSegment[]): DocumentChunkDraft[] {
  const chunks: DocumentChunkDraft[] = [];
  let buffer = "";
  let pageStart: number | undefined;
  let pageEnd: number | undefined;
  let segmentRefs: string[] = [];
  let charStart = 0;
  let charEnd = 0;
  let started = false;

  const flush = () => {
    const content = buffer.trim();
    if (!content) return;
    chunks.push({
      chunkIndex: chunks.length,
      content,
      pageStart,
      pageEnd,
      segmentRef: segmentRefs.join("|"),
      charStart,
      charEnd,
      tokenCount: estimateTokens(content),
    });
    if (content.length > OVERLAP_CHARS) {
      buffer = content.slice(-OVERLAP_CHARS);
      charStart = Math.max(0, charEnd - OVERLAP_CHARS);
      segmentRefs = segmentRefs.slice(-1);
      pageStart = pageEnd;
    } else {
      buffer = "";
      segmentRefs = [];
      pageStart = undefined;
      pageEnd = undefined;
      started = false;
    }
  };

  for (const segment of segments) {
    if (!started) {
      charStart = segment.charStart;
      pageStart = segment.page;
      started = true;
    }
    const next = buffer ? `${buffer}\n\n${segment.text}` : segment.text;
    if (buffer && next.length > MAX_CHARS) {
      flush();
      buffer = segment.text;
      charStart = segment.charStart;
      pageStart = segment.page;
      segmentRefs = [segment.segmentRef];
      pageEnd = segment.page;
      charEnd = segment.charEnd;
      continue;
    }
    buffer = next;
    pageEnd = segment.page ?? pageEnd;
    charEnd = segment.charEnd;
    segmentRefs.push(segment.segmentRef);
    if (buffer.length >= MAX_CHARS) {
      flush();
    }
  }
  flush();
  // Clear overlap leftover empty flush artifacts
  return chunks.filter((c) => c.content.length > 0);
}
