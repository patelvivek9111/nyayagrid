import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NormalizedTaskSchema, type NormalizedTask } from "../../schema/normalized-task.js";
import type { BenchmarkAdapter } from "../../adapters/types.js";

export const CASEFACTS_LABELS = ["Supported", "Refuted", "Overruled"] as const;
export type CaseFactsLabel = (typeof CASEFACTS_LABELS)[number];

function loadJsonArray(filePath: string): Record<string, unknown>[] {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)) {
    return (raw as { data: Record<string, unknown>[] }).data;
  }
  throw new Error(`CaseFacts file is not a JSON array: ${filePath}`);
}

export function normalizeCaseFactsRow(
  row: Record<string, unknown>,
  split: string,
  index: number,
): NormalizedTask {
  const claim =
    (typeof row.claim === "string" && row.claim) ||
    (typeof row.text === "string" && row.text) ||
    (typeof row.statement === "string" && row.statement) ||
    "";
  const labelRaw =
    (typeof row.label === "string" && row.label) ||
    (typeof row.verdict === "string" && row.verdict) ||
    "";
  const label =
    CASEFACTS_LABELS.find((l) => l.toLowerCase() === labelRaw.toLowerCase()) ?? labelRaw;
  const id =
    (typeof row.id === "string" && row.id) ||
    (typeof row.sample_id === "string" && row.sample_id) ||
    `${split}-${index}`;
  return NormalizedTaskSchema.parse({
    benchmarkId: "casefacts",
    taskId: `casefacts::${split}::${id}`,
    split,
    jurisdiction: "US_SUPREME_COURT",
    practiceArea: "precedent_fact_checking",
    taskType: "SUPPORTED_REFUTED_OVERRULED",
    input: row,
    conversation: [
      {
        role: "user",
        content: `Classify the legal claim as Supported, Refuted, or Overruled.\nClaim: ${claim}`,
      },
    ],
    expectedAnswer: label,
    metadata: {
      upstreamSource: "idirlab/CaseFacts",
      stratum: label,
      license: "CC-BY-NC-4.0",
      licenseClassification: "RESEARCH_ONLY",
      originalLabel: label,
      originalSourceIdentifier: id,
      cases: row.cases ?? row.case_names ?? null,
      evaluationIsolation: "EVAL_ONLY_NOT_PRODUCTION_CORPUS",
    },
    contaminationRisk: "PUBLIC_HIGH",
  });
}

export const CaseFactsAdapter: BenchmarkAdapter = {
  benchmarkId: "casefacts",
  async load(sourcePath: string): Promise<NormalizedTask[]> {
    if (!existsSync(sourcePath)) {
      throw new Error(`CaseFacts mount missing: ${sourcePath}`);
    }
    const candidates = [
      path.join(sourcePath, "dataset", "test.json"),
      path.join(sourcePath, "test.json"),
      path.join(sourcePath, "dataset", "test.jsonl"),
    ];
    const file = candidates.find((p) => existsSync(p));
    if (!file) {
      throw new Error(`CaseFacts test split not found under ${sourcePath}`);
    }
    if (file.endsWith(".jsonl")) {
      const rows = readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      return rows.map((r, i) => normalizeCaseFactsRow(r, "test", i));
    }
    return loadJsonArray(file).map((r, i) => normalizeCaseFactsRow(r, "test", i));
  },
};
