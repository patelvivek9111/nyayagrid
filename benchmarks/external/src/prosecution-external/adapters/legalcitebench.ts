import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { NormalizedTaskSchema, type NormalizedTask } from "../../schema/normalized-task.js";
import type { BenchmarkAdapter } from "../../adapters/types.js";

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
  const prompt =
    (typeof row.prompt === "string" && row.prompt) ||
    (typeof row.question === "string" && row.question) ||
    (typeof row.input === "string" && row.input) ||
    JSON.stringify(row);
  const expected = extractLegalCiteExpectedAnswer(row);
  const jurisdiction = (typeof row.jurisdiction === "string" && row.jurisdiction.trim()) || "US";
  return NormalizedTaskSchema.parse({
    benchmarkId: "legalcitebench",
    taskId: `legalcitebench::${taskType}::${id}`,
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
      qaStyle: row.qa_style ?? null,
      fakeType: row.fake_type ?? null,
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

export const PRIORITY_LEGALCITE_TASK_TYPES: LegalCiteTaskType[] = [
  "CITATION_ERROR_DETECTION",
  "CASE_MATCHING",
  "CASE_VERIFICATION_CORRECTION",
  "CITATION_RETRIEVAL",
  "CITATION_COMPLETION",
];
