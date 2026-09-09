/**
 * Preserve document structural metadata that retrieval packets otherwise flatten:
 * chunk location (section/heading) vs in-text provision cross-references.
 */

const PROVISION_RE =
  /\b(?:Section|Sec\.|Article|Clause|Paragraph)\s+(\d+(?:\.\d+)*)\b/gi;
const SECTION_SYMBOL_RE = /§\s*(\d+(?:\.\d+)*)/g;

export function extractInTextProvisionRefs(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(PROVISION_RE)) {
    const n = match[1];
    if (!n) continue;
    const label = `Section ${n}`;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(label);
  }
  for (const match of text.matchAll(SECTION_SYMBOL_RE)) {
    const n = match[1];
    if (!n) continue;
    const label = `Section ${n}`;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(label);
  }
  return found;
}

export function asksProvisionIdentity(question: string): boolean {
  if (
    !/\b(where|which section|which provision|which clause|what section|what provision)\b/i.test(
      question,
    )
  ) {
    return false;
  }
  return /\b(notice|address|sent|section|provision|clause|terminate|termination)\b/i.test(
    question,
  );
}

type StructurePassage = {
  chunkId: string;
  quote: string;
  segmentRef?: string | null;
};

/** Prefer an in-text cross-reference whose local window matches the question topic. */
export function selectOperativeProvisionRef(
  question: string,
  passages: StructurePassage[],
): { label: string; chunkId: string } | null {
  if (!asksProvisionIdentity(question)) return null;
  const topicTokens = question
    .toLowerCase()
    .split(/\W+/)
    .filter((token) => token.length >= 4);
  const hits: Array<{ label: string; chunkId: string; score: number }> = [];
  for (const passage of passages) {
    for (const label of extractInTextProvisionRefs(passage.quote)) {
      const idx = passage.quote.toLowerCase().indexOf(label.toLowerCase());
      const window =
        idx >= 0
          ? passage.quote.slice(Math.max(0, idx - 80), idx + label.length + 80).toLowerCase()
          : passage.quote.toLowerCase();
      const score = topicTokens.reduce(
        (sum, token) => sum + (window.includes(token) ? 1 : 0),
        0,
      );
      hits.push({ label, chunkId: passage.chunkId, score });
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const best = hits[0]!;
  if (hits.length > 1 && hits[1]!.score === best.score && hits[1]!.label !== best.label) {
    return null;
  }
  return { label: best.label, chunkId: best.chunkId };
}

export function formatGroundingSourceLine(params: {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  page?: number | null;
  segmentRef?: string | null;
  quote: string;
}): string {
  const inText = extractInTextProvisionRefs(params.quote);
  const inTextField = inText.length > 0 ? ` | inTextRefs=${inText.join(",")}` : "";
  return `- chunkId=${params.chunkId} | documentId=${params.documentId} | documentVersionId=${params.documentVersionId} | page=${params.page ?? "null"} | segmentRef=${params.segmentRef ?? "null"}${inTextField} | quote=|${params.quote}|`;
}
