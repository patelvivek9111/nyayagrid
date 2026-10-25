/**
 * Deterministic LegalBench scoring: normalized string / exact match.
 * Do not alter normalization after seeing model outputs.
 */

export function normalizeLegalBenchAnswer(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "");
}

export function scoreLegalBenchExact(input: { modelOutput: string; expectedAnswer: unknown }): {
  correct: boolean;
  score: number;
  normalizedPrediction: string;
  normalizedExpected: string;
} {
  const expectedRaw =
    typeof input.expectedAnswer === "string"
      ? input.expectedAnswer
      : input.expectedAnswer == null
        ? ""
        : String(input.expectedAnswer);
  const normalizedExpected = normalizeLegalBenchAnswer(expectedRaw);
  // Prefer last non-empty line as the model's final answer commitment.
  const lines = input.modelOutput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const candidate = lines.length > 0 ? lines[lines.length - 1]! : input.modelOutput;
  const normalizedPrediction = normalizeLegalBenchAnswer(candidate);
  const correct =
    normalizedExpected.length > 0 && normalizedPrediction === normalizedExpected
      ? true
      : normalizedExpected.length > 0 &&
        normalizeLegalBenchAnswer(input.modelOutput).includes(normalizedExpected);
  return {
    correct,
    score: correct ? 1 : 0,
    normalizedPrediction,
    normalizedExpected,
  };
}
