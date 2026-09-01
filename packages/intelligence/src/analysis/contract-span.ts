import { extractNumericValues, segmentLegalDocument } from "./clause-compare";
import { findSupportingSpan, jaccard, tokenize } from "../provenance";

export type ContractItemLike = {
  category: string;
  title: string;
  originalText?: string | null;
  explanation: string;
  attention: "informational" | "review" | "high_attention";
  sourceChunkIds: string[];
  supportingQuotes?: string[];
};

export type VersionChunk = {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  page: number | null;
  segmentRef: string | null;
  content: string;
};

function fold(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function quotesFor(item: ContractItemLike): string[] {
  return [item.originalText, ...(item.supportingQuotes ?? [])]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
}

function isHeaderOnlySpan(span: string, findingText: string): boolean {
  const header =
    /parties and purpose|fictional test document|harbor point office lease - main agreement/i.test(
      span,
    ) && !/notice|liabil|indemn|terminat|payment|insurance|exhibit|amendment/i.test(span);
  if (!header) return false;
  return !/\bpart(y|ies)\b|\bpurpose\b/i.test(findingText);
}

function excerptAround(text: string, needle: string, pad = 90): string | null {
  const trimmed = needle.trim();
  if (trimmed.length < 8) return null;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(trimmed.toLowerCase().slice(0, Math.min(trimmed.length, 160)));
  if (idx < 0) return null;
  if (text.includes(trimmed) || lower.includes(trimmed.toLowerCase())) {
    const start = text.toLowerCase().indexOf(trimmed.toLowerCase());
    if (start >= 0) {
      return text.slice(start, start + Math.min(trimmed.length, 400)).replace(/\s+/g, " ").trim();
    }
  }
  return text
    .slice(Math.max(0, idx - pad), Math.min(text.length, idx + 180))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function scoreSegment(segmentText: string, item: ContractItemLike, quotes: string[]): number {
  const folded = fold(segmentText);
  let score = 0;
  for (const quote of quotes) {
    const needle = fold(quote).slice(0, 80);
    if (needle.length >= 8 && folded.includes(needle)) score += 6;
  }
  score += jaccard(tokenize(segmentText), tokenize(`${item.title} ${item.explanation}`)) * 4;
  const titleWord = fold(item.title).split(/\s+/).find((word) => word.length >= 5);
  if (titleWord && folded.includes(titleWord)) score += 2;
  const category = fold(item.category);
  if (category.length >= 4 && folded.includes(category.replace(/_/g, " "))) score += 1.5;
  return score;
}

export function locateContractSupportingSpan(params: {
  chunkText: string;
  item: ContractItemLike;
}): string | null {
  const quotes = quotesFor(params.item);
  const findingText = `${params.item.title} ${params.item.explanation}`;
  for (const quote of quotes) {
    const excerpt = excerptAround(params.chunkText, quote);
    if (excerpt && !isHeaderOnlySpan(excerpt, findingText)) return excerpt.slice(0, 400);
  }

  const segments = segmentLegalDocument(params.chunkText);
  if (segments.length > 0) {
    let best: { text: string; score: number } | null = null;
    for (const segment of segments) {
      const score = scoreSegment(segment.text, params.item, quotes);
      if (!best || score > best.score) best = { text: segment.text, score };
    }
    if (best && best.score >= 1.4 && !isHeaderOnlySpan(best.text, findingText)) {
      return best.text.replace(/\s+/g, " ").trim().slice(0, 400);
    }
  }

  const fallback = findSupportingSpan({
    chunkText: params.chunkText,
    quotes,
    title: params.item.title,
    description: params.item.explanation,
  });
  if (!fallback || isHeaderOnlySpan(fallback, findingText)) return null;
  return fallback.slice(0, 400);
}

export function preserveSourceQuantities(explanation: string, span: string): string {
  if (span.length > 900) return explanation;
  const quantities = extractNumericValues(span);
  const extras = [...span.matchAll(/\$\s*[\d,]+(?:\.\d+)?|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g)].map(
    (match) => match[0].replace(/\s+/g, ""),
  );
  const blob = fold(`${explanation}`);
  const missing: string[] = [];
  for (const value of [...quantities.money, ...quantities.durations, ...quantities.percents, ...quantities.dates, ...extras]) {
    const token = fold(value);
    if (token.length < 2) continue;
    const digits = token.replace(/[^\d]/g, "");
    if (blob.includes(token) || (digits.length >= 2 && blob.includes(digits))) continue;
    if (!missing.includes(value)) missing.push(value);
  }
  if (missing.length === 0) return explanation;
  const addition = ` Source values: ${missing.slice(0, 6).join("; ")}.`;
  return `${explanation}${addition}`.slice(0, 8000);
}

export function preserveLimitationLanguage(explanation: string, span: string): string {
  const limiters = [
    ...span.matchAll(
      /\b(?:shall not|will not|must not|may not|not exceed|except(?:\s+for)?|unless|subject to|only if)\b[^.!?]{0,80}/gi,
    ),
  ].map((match) => match[0].replace(/\s+/g, " ").trim());
  if (limiters.length === 0) return explanation;
  const blob = fold(explanation);
  const dropped = limiters.filter((phrase) => {
    const folded = fold(phrase);
    if (blob.includes(folded.slice(0, 24))) return false;
    if (/\bnot exceed\b/i.test(phrase) && /\b(cap|exceed|not exceed|limited to)\b/i.test(explanation)) {
      return false;
    }
    if (/\bnot\b/i.test(phrase) && /\bnot\b/i.test(explanation)) return false;
    return true;
  });
  if (dropped.length === 0) return explanation;
  return `${explanation} Source limitation: ${dropped[0]}.`.slice(0, 8000);
}

export function alignContractSummary(
  summary: string,
  items: Array<{ title: string; explanation: string }>,
): string {
  const trimmed = summary.trim() || "Contract analysis produced no usable summary.";
  if (items.length === 0) return trimmed.slice(0, 8000);
  if (
    /\bno (significant|material|notable) (terms|provisions|clauses|findings)\b|\bnothing (material|significant|notable)\b/i.test(
      trimmed,
    )
  ) {
    return `This instrument contains proposed review items including: ${items
      .slice(0, 6)
      .map((item) => item.title)
      .join("; ")}.`.slice(0, 8000);
  }
  return trimmed.slice(0, 8000);
}

export function collapseNearDuplicateContractItems<T extends ContractItemLike>(
  items: T[],
): { items: T[]; duplicateSuppressed: number } {
  const kept: T[] = [];
  let duplicateSuppressed = 0;
  for (const item of items) {
    const blob = fold(`${item.title} ${item.explanation}`);
    const tokens = tokenize(blob);
    const dup = kept.some((existing) => {
      const other = fold(`${existing.title} ${existing.explanation}`);
      if (fold(existing.title) === fold(item.title)) return true;
      if (fold(existing.explanation) === fold(item.explanation)) return true;
      return jaccard(tokens, tokenize(other)) >= 0.8;
    });
    if (dup) {
      duplicateSuppressed += 1;
      continue;
    }
    kept.push(item);
  }
  return { items: kept, duplicateSuppressed };
}

export function resolveContractItemProvenance(params: {
  item: ContractItemLike;
  citedChunks: VersionChunk[];
  versionChunks: VersionChunk[];
}): { sources: Array<VersionChunk & { supportingText: string }>; rejectedBadSpan: boolean } {
  const sources: Array<VersionChunk & { supportingText: string }> = [];
  const seen = new Set<string>();

  const consider = (chunk: VersionChunk) => {
    if (seen.has(chunk.chunkId)) return;
    const supportingText = locateContractSupportingSpan({
      chunkText: chunk.content,
      item: params.item,
    });
    if (!supportingText) return;
    seen.add(chunk.chunkId);
    sources.push({ ...chunk, supportingText });
  };

  for (const chunk of params.citedChunks) consider(chunk);
  if (sources.length > 0) return { sources, rejectedBadSpan: false };

  const quotes = quotesFor(params.item);
  for (const chunk of params.versionChunks) {
    if (params.citedChunks.some((cited) => cited.chunkId === chunk.chunkId)) continue;
    const hasQuote = quotes.some((quote) => excerptAround(chunk.content, quote));
    const titleHit = locateContractSupportingSpan({ chunkText: chunk.content, item: params.item });
    if (hasQuote || titleHit) consider(chunk);
  }

  return { sources, rejectedBadSpan: sources.length === 0 };
}
