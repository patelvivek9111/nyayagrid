import { readFileSync } from "node:fs";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { NormalizedTaskSchema, type NormalizedTask } from "../schema/normalized-task.js";
import type { BenchmarkAdapter } from "./types.js";

export type PrbenchSourceRow = Record<string, unknown>;

const WEIGHT_FIELDS = [
  "critically_important_weight",
  "important_weight",
  "slightly_important_weight",
  "slightly_detrimental_weight",
  "detrimental_weight",
  "critically_detrimental_weight",
] as const;

function weightFromAnnotations(annotations: unknown): number | null {
  if (!annotations || typeof annotations !== "object") return null;
  const a = annotations as Record<string, unknown>;
  for (const field of WEIGHT_FIELDS) {
    const v = a[field];
    if (typeof v === "number" && v !== 0) return v;
  }
  const wc = a.weight_class;
  return typeof wc === "string" ? null : null;
}

function buildConversation(row: PrbenchSourceRow): NormalizedTask["conversation"] {
  const turns: NonNullable<NormalizedTask["conversation"]> = [];
  for (let i = 0; i < 10; i++) {
    const prompt = row[`prompt_${i}`];
    if (typeof prompt === "string" && prompt.trim().length > 0) {
      turns.push({ role: "user", content: prompt });
    }
    const response = row[`response_${i}`];
    if (typeof response === "string" && response.trim().length > 0) {
      turns.push({ role: "assistant", content: response });
    }
  }
  return turns.length > 0 ? turns : null;
}

function buildRubric(row: PrbenchSourceRow): NormalizedTask["rubric"] {
  const rubric = row.rubric;
  if (!Array.isArray(rubric)) return null;
  const criteria = rubric.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new Error(`PRBench malformed rubric item at index ${idx}`);
    }
    const r = item as Record<string, unknown>;
    const annotations = r.annotations;
    const description =
      annotations &&
      typeof annotations === "object" &&
      typeof (annotations as Record<string, unknown>).criteria_description === "string"
        ? ((annotations as Record<string, unknown>).criteria_description as string)
        : typeof r.title === "string"
          ? r.title
          : null;
    return {
      id: typeof r.id === "string" ? r.id : `criterion-${idx}`,
      description,
      weight: weightFromAnnotations(annotations),
      maxScore: null,
      // Preserve full upstream criterion payload without semantic change.
      upstream: r,
    };
  });
  return {
    criteria: criteria.map((c) => ({
      id: c.id,
      description: c.description,
      weight: c.weight,
      maxScore: c.maxScore,
    })),
    notes: null,
  };
}

function supportingFromRow(row: PrbenchSourceRow): NormalizedTask["supportingDocuments"] {
  const docs: NonNullable<NormalizedTask["supportingDocuments"]> = [];
  for (let i = 0; i < 10; i++) {
    const refs = row[`reference_texts_${i}`];
    if (!Array.isArray(refs)) continue;
    for (let j = 0; j < refs.length; j++) {
      const text = refs[j];
      if (typeof text !== "string" || text.length === 0) continue;
      docs.push({
        documentId: `reference_${i}_${j}`,
        title: null,
        uri: null,
        mimeType: "text/plain",
        text,
      });
    }
  }
  return docs.length > 0 ? docs : null;
}

export function normalizePrbenchRow(
  row: PrbenchSourceRow,
  options: { split: string; hard?: boolean },
): NormalizedTask {
  const taskId = row.task;
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new Error("PRBench row missing task id");
  }
  const topic = typeof row.topic === "string" ? row.topic : null;
  const field = typeof row.field === "string" ? row.field : null;
  const raw = {
    benchmarkId: "prbench",
    taskId,
    split: options.split,
    jurisdiction: null,
    practiceArea: topic ?? field,
    difficulty: options.hard ? "hard" : null,
    taskType: typeof row.decision_type === "string" ? row.decision_type : field,
    input: {
      turns: row.turns ?? null,
      scratchpad: row.scratchpad ?? null,
      canary: row.canary ?? null,
    },
    conversation: buildConversation(row),
    supportingDocuments: supportingFromRow(row),
    expectedAnswer: null,
    rubric: buildRubric(row),
    goldEvidence: null,
    metadata: {
      upstreamField: field,
      upstreamTopic: topic,
      upstreamExpert: row.expert ?? null,
      upstreamEconomicPathway: row.economic_pathway ?? null,
      upstreamDecisionType: row.decision_type ?? null,
      legalHard: options.hard === true,
      sourceSplit: options.split,
    },
    contaminationRisk: "PUBLIC_HIGH" as const,
  };
  return NormalizedTaskSchema.parse(raw);
}

export async function loadPrbenchParquet(filePath: string): Promise<PrbenchSourceRow[]> {
  const file = await asyncBufferFromFile(filePath);
  const rows = await parquetReadObjects({ file });
  return rows as PrbenchSourceRow[];
}

export function loadPrbenchJson(filePath: string): PrbenchSourceRow[] {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (Array.isArray(parsed)) return parsed as PrbenchSourceRow[];
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows)) {
    return (parsed as { rows: PrbenchSourceRow[] }).rows;
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { tasks?: unknown }).tasks)
  ) {
    // Fixture normalized tasks are already normalized — adapter of source rows only.
    throw new Error("PRBench JSON looks like normalized fixtures; use fixture loader instead");
  }
  throw new Error(`Unrecognized PRBench JSON shape: ${filePath}`);
}

export const PRBenchAdapter: BenchmarkAdapter = {
  benchmarkId: "prbench",
  async load(sourcePath: string): Promise<NormalizedTask[]> {
    if (sourcePath.endsWith(".parquet")) {
      const rows = await loadPrbenchParquet(sourcePath);
      const hard = sourcePath.includes("legal_hard");
      const split = hard ? "legal_hard" : "legal";
      return rows.map((row) => normalizePrbenchRow(row, { split, hard }));
    }
    if (sourcePath.endsWith(".json") || sourcePath.endsWith(".jsonl")) {
      const rows = loadPrbenchJson(sourcePath);
      return rows.map((row) =>
        normalizePrbenchRow(row, {
          split: typeof row.split === "string" ? row.split : "legal",
          hard: row.legal_hard === true || row.split === "legal_hard",
        }),
      );
    }
    throw new Error(`PRBenchAdapter unsupported source: ${sourcePath}`);
  },
};
