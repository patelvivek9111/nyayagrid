import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type LexicalDoc = {
  documentId: string;
  text: string;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 2);
}

function scoreQueryAgainstDoc(queryTokens: string[], docTokens: string[]): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of docTokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  let score = 0;
  for (const qt of queryTokens) {
    score += counts.get(qt) ?? 0;
  }
  return score / Math.sqrt(docTokens.length);
}

export function loadCorpusDocuments(corpusRoot: string, source: string): LexicalDoc[] {
  const dir = path.join(corpusRoot, source);
  if (!existsSync(dir)) return [];
  const docs: LexicalDoc[] = [];
  const walk = (current: string, rel: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, nextRel);
      } else if (entry.isFile() && /\.(txt|md|html?)$/i.test(entry.name)) {
        docs.push({
          documentId: `${source}/${nextRel}`.replace(/\\/g, "/"),
          text: readFileSync(abs, "utf8"),
        });
      }
    }
  };
  walk(dir, "");
  return docs;
}

export function retrieveTopKDocuments(
  query: string,
  docs: readonly LexicalDoc[],
  k: number,
): string[] {
  const qTokens = tokenize(query);
  const scored = docs.map((d) => ({
    id: d.documentId,
    score: scoreQueryAgainstDoc(qTokens, tokenize(d.text)),
  }));
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored
    .filter((s) => s.score > 0)
    .slice(0, k)
    .map((s) => s.id);
}

export function hashRetrievalConfig(): string {
  return createHash("sha256")
    .update(JSON.stringify({ method: "lexical_term_frequency_v1", k: 5 }))
    .digest("hex");
}
