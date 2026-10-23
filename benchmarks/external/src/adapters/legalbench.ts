import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { NormalizedTaskSchema, type NormalizedTask } from "../schema/normalized-task.js";
import type { BenchmarkAdapter } from "./types.js";

export type LegalBenchCategory =
  | "US_RELEVANT"
  | "GENERAL_LEGAL_REASONING"
  | "CONTRACT"
  | "STATUTORY"
  | "CASE_LAW"
  | "PROCEDURAL"
  | "NON_US_OR_LOW_RELEVANCE";

export function classifyLegalBenchTask(taskName: string): LegalBenchCategory {
  const n = taskName.toLowerCase();
  if (
    n.startsWith("canada_") ||
    n.includes("uk_") ||
    n.includes("indian_") ||
    n.includes("eu_") ||
    n.includes("chinese") ||
    n.includes("international_citizenship")
  ) {
    return "NON_US_OR_LOW_RELEVANCE";
  }
  if (
    n.includes("contract") ||
    n.startsWith("cuad") ||
    n.startsWith("maud") ||
    n.includes("nli_")
  ) {
    return "CONTRACT";
  }
  if (n.includes("statute") || n.includes("sara") || n.includes("ucc_") || n.includes("tax")) {
    return "STATUTORY";
  }
  if (
    n.includes("citation") ||
    n.includes("casehold") ||
    n.includes("overruling") ||
    n.includes("scotus") ||
    n.includes("judicial")
  ) {
    return "CASE_LAW";
  }
  if (
    n.includes("hearsay") ||
    n.includes("evidence") ||
    n.includes("procedure") ||
    n.includes("civil_procedure") ||
    n.includes("personal_jurisdiction") ||
    n.includes("diversity")
  ) {
    return "PROCEDURAL";
  }
  if (
    n.includes("privacy") ||
    n.includes("opp115") ||
    n.includes("consumer") ||
    n.includes("insurance") ||
    n.includes("employment") ||
    n.includes("corporate") ||
    n.includes("securities")
  ) {
    return "US_RELEVANT";
  }
  return "GENERAL_LEGAL_REASONING";
}

function parseTsv(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headerLine = lines[0];
  if (!headerLine) return [];
  const headers = headerLine.split("\t");
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split("\t");
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      row[key] = cols[c] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function rowToTask(
  taskName: string,
  split: "train" | "test",
  row: Record<string, string>,
  rowIndex: number,
): NormalizedTask {
  const index = row.index || row.Index || String(rowIndex);
  const answer = row.answer ?? row.Answer ?? null;
  const question = row.question ?? row.text ?? row.Text ?? null;
  const inputParts: Record<string, string> = { ...row };
  delete inputParts.answer;
  delete inputParts.Answer;
  const category = classifyLegalBenchTask(taskName);
  return NormalizedTaskSchema.parse({
    benchmarkId: "legalbench",
    taskId: `${taskName}::${split}::${index}`,
    split,
    jurisdiction: null,
    practiceArea: null,
    difficulty: null,
    taskType: taskName,
    input: inputParts,
    conversation:
      typeof question === "string" && question.length > 0
        ? [{ role: "user", content: question }]
        : null,
    supportingDocuments: null,
    expectedAnswer: answer,
    rubric: null,
    goldEvidence: null,
    metadata: {
      upstreamTask: taskName,
      upstreamLabelsIntact: true,
      nyayaCategory: category,
      tsvColumns: Object.keys(row),
    },
    contaminationRisk: "PUBLIC_HIGH",
  });
}

export function inventoryLegalBenchTasks(tasksRoot: string): Array<{
  taskName: string;
  category: LegalBenchCategory;
  hasTrain: boolean;
  hasTest: boolean;
}> {
  if (!existsSync(tasksRoot)) {
    throw new Error(`LegalBench tasks root missing: ${tasksRoot}`);
  }
  return readdirSync(tasksRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(tasksRoot, d.name);
      return {
        taskName: d.name,
        category: classifyLegalBenchTask(d.name),
        hasTrain: existsSync(path.join(dir, "train.tsv")),
        hasTest: existsSync(path.join(dir, "test.tsv")),
      };
    })
    .sort((a, b) => a.taskName.localeCompare(b.taskName));
}

function readTsvLongPathAware(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  const candidates = [filePath, resolved, `\\\\?\\${resolved}`];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        return readFileSync(candidate, "utf8");
      }
    } catch {
      // continue
    }
  }
  return null;
}

export function loadLegalBenchTaskDir(
  taskDir: string,
  taskName: string,
  splits: Array<"train" | "test"> = ["test", "train"],
): NormalizedTask[] {
  const loadedBySplit = new Map<"train" | "test", NormalizedTask[]>();
  for (const split of splits) {
    const raw = readTsvLongPathAware(path.join(taskDir, `${split}.tsv`));
    if (!raw) continue;
    const rows = parseTsv(raw);
    loadedBySplit.set(
      split,
      rows.map((row, idx) => rowToTask(taskName, split, row, idx)),
    );
  }
  // Prefer test when present; otherwise fall back to train (GitHub pin often ships train-only).
  const preferred = loadedBySplit.get("test") ?? loadedBySplit.get("train") ?? [];
  if (preferred.length === 0) {
    throw new Error(`LegalBench task has no loadable TSV rows: ${taskName}`);
  }
  // If caller asked for both and both exist, return test then train.
  if (
    loadedBySplit.has("test") &&
    loadedBySplit.has("train") &&
    splits.includes("train") &&
    splits.includes("test")
  ) {
    return [...(loadedBySplit.get("test") ?? []), ...(loadedBySplit.get("train") ?? [])];
  }
  return preferred;
}

export const LegalBenchAdapter: BenchmarkAdapter = {
  benchmarkId: "legalbench",
  async load(sourcePath: string): Promise<NormalizedTask[]> {
    // sourcePath may be tasks root or a single task directory
    const base = path.basename(sourcePath);
    if (
      existsSync(path.join(sourcePath, "test.tsv")) ||
      existsSync(path.join(sourcePath, "train.tsv"))
    ) {
      return loadLegalBenchTaskDir(sourcePath, base);
    }
    const inventory = inventoryLegalBenchTasks(sourcePath);
    const all: NormalizedTask[] = [];
    for (const item of inventory) {
      all.push(...loadLegalBenchTaskDir(path.join(sourcePath, item.taskName), item.taskName));
    }
    return all;
  },
};
