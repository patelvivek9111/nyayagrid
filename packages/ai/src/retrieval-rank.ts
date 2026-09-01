/**
 * Lexical question–passage overlap used to rerank an already-retrieved set so
 * the answering chunk outranks a near-miss decoy. Does not drop passages.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "be",
  "by",
  "does",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "under",
  "was",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9$\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function bigrams(tokens: string[]): string[] {
  const grams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    grams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return grams;
}

export function questionOverlapScore(question: string, passageText: string): number {
  const qTokens = tokenize(question);
  const pTokens = tokenize(passageText);
  if (qTokens.length === 0 || pTokens.length === 0) return 0;
  const passageSet = new Set(pTokens);
  const passageBigrams = new Set(bigrams(pTokens));
  let score = 0;
  for (const token of qTokens) {
    if (passageSet.has(token)) score += 1;
  }
  for (const gram of bigrams(qTokens)) {
    if (passageBigrams.has(gram)) score += 2;
  }
  return score;
}

export function rankByQuestionOverlap<T extends { quote?: string; content?: string }>(
  question: string,
  items: T[],
): T[] {
  return [...items].sort((left, right) => {
    const leftScore = questionOverlapScore(question, left.quote ?? left.content ?? "");
    const rightScore = questionOverlapScore(question, right.quote ?? right.content ?? "");
    if (rightScore !== leftScore) return rightScore - leftScore;
    const leftId =
      left && typeof left === "object" && "chunkId" in left ? String(left.chunkId ?? "") : "";
    const rightId =
      right && typeof right === "object" && "chunkId" in right ? String(right.chunkId ?? "") : "";
    return leftId.localeCompare(rightId);
  });
}
