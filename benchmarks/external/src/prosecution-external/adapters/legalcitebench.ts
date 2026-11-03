import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { NormalizedTaskSchema, type NormalizedTask } from "../../schema/normalized-task.js";
import type { BenchmarkAdapter } from "../../adapters/types.js";
import { citationKeysMatch, extractReporterCitations } from "../scorers/citation-utils.js";

export const LEGALCITE_TASK_FILES = {
  cat1_citation_retrieval: "CITATION_RETRIEVAL",
  cat2_citation_completion: "CITATION_COMPLETION",
  cat3_citation_error_detection: "CITATION_ERROR_DETECTION",
  cat4_1_case_matching: "CASE_MATCHING",
  cat4_2_case_verification: "CASE_VERIFICATION_CORRECTION",
} as const;

export type LegalCiteTaskType = (typeof LEGALCITE_TASK_FILES)[keyof typeof LEGALCITE_TASK_FILES];

function parseJsonl(content: string): Record<string, unknown>[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Upstream HF rows use `ground_truth` (string | string[] | object | [k,v][]). */
export function extractLegalCiteExpectedAnswer(row: Record<string, unknown>): unknown {
  const direct =
    row.answer ??
    row.label ??
    row.gold ??
    row.expected ??
    row.reference_citations ??
    row.ground_truth;
  if (direct == null) return null;
  if (typeof direct === "string" || typeof direct === "number" || typeof direct === "boolean") {
    return direct;
  }
  if (Array.isArray(direct)) {
    if (direct.every((x) => typeof x === "string")) return direct;
    // cat4_2 stores [[field, value], ...]
    if (direct.every((x) => Array.isArray(x) && x.length >= 2 && typeof x[0] === "string")) {
      return Object.fromEntries(direct as Array<[string, unknown]>);
    }
    return direct;
  }
  if (typeof direct === "object") return direct;
  return null;
}

function rowToTask(
  taskType: LegalCiteTaskType,
  fileStem: string,
  row: Record<string, unknown>,
  index: number,
): NormalizedTask {
  const id =
    (typeof row.id === "string" && row.id) ||
    (typeof row.sample_id === "string" && row.sample_id) ||
    `${fileStem}-${index}`;
  const qaStyle = typeof row.qa_style === "string" ? row.qa_style : "unknown";
  const fakeType = typeof row.fake_type === "string" ? row.fake_type : "none";
  // Upstream reuses numeric ids across qa_style / fake_type variants; keep ids unique.
  const taskId = `legalcitebench::${taskType}::${id}::${qaStyle}::${fakeType}::${index}`;
  const prompt =
    (typeof row.prompt === "string" && row.prompt) ||
    (typeof row.question === "string" && row.question) ||
    (typeof row.input === "string" && row.input) ||
    JSON.stringify(row);
  const expected = extractLegalCiteExpectedAnswer(row);
  const jurisdiction = (typeof row.jurisdiction === "string" && row.jurisdiction.trim()) || "US";
  return NormalizedTaskSchema.parse({
    benchmarkId: "legalcitebench",
    taskId,
    split: "eval",
    jurisdiction,
    practiceArea: "citation_reliability",
    taskType,
    input: row,
    conversation: [{ role: "user", content: prompt }],
    expectedAnswer: expected,
    metadata: {
      upstreamSource: "legalcitebench/LegalCiteBench",
      upstreamTaskFile: fileStem,
      citationTaskType: taskType,
      stratum: taskType,
      license: "MIT",
      huggingfaceCardLicense: "cc0-1.0",
      originalLabel: expected,
      originalSourceIdentifier: id,
      legacyTaskId: `legalcitebench::${taskType}::${id}`,
      qaStyle,
      fakeType: row.fake_type ?? null,
      rowIndex: index,
      evaluationIsolation: "EVAL_ONLY_NOT_PRODUCTION_CORPUS",
    },
    contaminationRisk: "PUBLIC_HIGH",
  });
}

export function normalizeLegalCiteBenchRow(
  taskType: LegalCiteTaskType,
  fileStem: string,
  row: Record<string, unknown>,
  index: number,
): NormalizedTask {
  return rowToTask(taskType, fileStem, row, index);
}

export const LegalCiteBenchAdapter: BenchmarkAdapter = {
  benchmarkId: "legalcitebench",
  async load(sourcePath: string): Promise<NormalizedTask[]> {
    if (!existsSync(sourcePath)) {
      throw new Error(`LegalCiteBench mount missing: ${sourcePath}`);
    }
    const dataDir = existsSync(path.join(sourcePath, "data"))
      ? path.join(sourcePath, "data")
      : sourcePath;
    const files = readdirSync(dataDir).filter((f) => f.endsWith(".jsonl"));
    const out: NormalizedTask[] = [];
    for (const file of files) {
      const stem = file.replace(/\.jsonl$/i, "");
      const mapped = Object.entries(LEGALCITE_TASK_FILES).find(([prefix]) => stem.includes(prefix));
      if (!mapped) continue;
      const taskType = mapped[1];
      const rows = parseJsonl(readFileSync(path.join(dataDir, file), "utf8"));
      rows.forEach((row, i) => out.push(rowToTask(taskType, stem, row, i)));
    }
    return out;
  },
};

/**
 * Resolve a historical or current LegalCite task id to the best matching loaded task.
 * Historical live runs used `legalcitebench::<TYPE>::<numericId>` which collides across
 * qa_style / fake_type variants; disambiguate by prompt↔response citation overlap.
 */
export function resolveLegalCiteTaskForReplay(
  loaded: readonly NormalizedTask[],
  sampleId: string,
  responseText: string,
): NormalizedTask | undefined {
  const exact = loaded.find((t) => t.taskId === sampleId);
  if (exact) return exact;

  const legacy = loaded.filter((t) => t.metadata?.legacyTaskId === sampleId);
  if (legacy.length === 1) return legacy[0];
  if (legacy.length === 0) {
    // Prefix match for partially migrated ids.
    const prefix = loaded.filter(
      (t) => t.taskId === sampleId || t.taskId.startsWith(`${sampleId}::`),
    );
    if (prefix.length === 1) return prefix[0];
    if (prefix.length === 0) return undefined;
    return pickBestLegalCiteVariant(prefix, responseText);
  }
  return pickBestLegalCiteVariant(legacy, responseText);
}

function pickBestLegalCiteVariant(
  candidates: readonly NormalizedTask[],
  responseText: string,
): NormalizedTask {
  const outCites = extractReporterCitations(responseText);
  let best = candidates[0]!;
  let bestScore = -1;
  for (const c of candidates) {
    const prompt = c.conversation?.[0]?.content ?? "";
    const inputCites = extractReporterCitations(prompt);
    let overlap = 0;
    for (const o of outCites) {
      if (inputCites.some((i) => citationKeysMatch(o, i))) overlap += 1;
    }
    // Prefer fake variants when the response identifies an incorrect citation.
    const identifiesError = /\b(incorrect|error|wrong|erroneous)\b/i.test(responseText);
    const fakeBonus =
      identifiesError && c.metadata?.qaStyle === "3-fake"
        ? 2
        : !identifiesError && c.metadata?.qaStyle === "3-true"
          ? 2
          : 0;
    const score = overlap * 10 + fakeBonus;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

export const PRIORITY_LEGALCITE_TASK_TYPES: LegalCiteTaskType[] = [
  "CITATION_ERROR_DETECTION",
  "CASE_MATCHING",
  "CASE_VERIFICATION_CORRECTION",
  "CITATION_RETRIEVAL",
  "CITATION_COMPLETION",
];
