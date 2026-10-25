/**
 * Local Stage-2 context-fit profile. Zero provider calls.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadPrbenchParquet, normalizePrbenchRow } from "../adapters/prbench.js";
import { loadLegalBenchTaskDir } from "../adapters/legalbench.js";
import { getCacheDir } from "../paths.js";
import type { NormalizedTask } from "../schema/normalized-task.js";
import { assessContextFit } from "./context-fit.js";
import {
  LEGALBENCH_REV,
  PRBENCH_REV,
  STAGE2_RESPONSE_MODELS,
  type Stage2SuitePlan,
} from "./stage2-task-planner.js";

const CONTEXT_WINDOWS: Record<(typeof STAGE2_RESPONSE_MODELS)[number], number> = {
  "gpt-6.1-sol": 1_050_000,
  "grok-4.7": 2_000_000,
};

const systemPrompt =
  "You are NyayaGrid external-bench Stage-2. Produce a careful legal analysis response.";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function buildUserPrompt(task: NormalizedTask): string {
  const conversation =
    task.conversation?.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join("\n\n") ??
    JSON.stringify(task.input ?? {});
  const docs =
    task.supportingDocuments
      ?.slice(0, 4)
      .map((d) => `DOCUMENT ${d.documentId}:\n${(d.text ?? "").slice(0, 6000)}`)
      .join("\n\n") ?? "";
  return [
    "You are assisting with a legal analysis benchmark task.",
    "Answer carefully using only the provided conversation and documents.",
    "Do not invent authorities or facts.",
    "",
    "CONVERSATION:",
    conversation,
    docs ? `\nSUPPORTING DOCUMENTS:\n${docs}` : "",
  ].join("\n");
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

async function loadPrbenchTasks(ids: string[]): Promise<NormalizedTask[]> {
  const parquet = path.join(
    getCacheDir(),
    "prbench",
    PRBENCH_REV,
    "data",
    "legal_hard-00000-of-00001.parquet",
  );
  const rows = await loadPrbenchParquet(parquet);
  const wanted = new Set(ids);
  return rows
    .map((row) => normalizePrbenchRow(row, { split: "legal_hard", hard: true }))
    .filter((t) => wanted.has(t.taskId));
}

function loadLegalbenchTasks(ids: string[]): NormalizedTask[] {
  const root = path.join(getCacheDir(), "legalbench", LEGALBENCH_REV, "tasks");
  const out: NormalizedTask[] = [];
  for (const taskId of ids) {
    const [taskName, split, index] = taskId.split("::");
    if (!taskName || !split) continue;
    const dir = path.join(root, taskName);
    if (!existsSync(dir)) continue;
    const tasks = loadLegalBenchTaskDir(dir, taskName, [split as "train" | "test"]);
    const match =
      tasks.find((t) => t.taskId === taskId) ??
      (index !== undefined ? tasks.find((t) => t.taskId.endsWith(`::${index}`)) : undefined);
    if (match) out.push(match);
  }
  return out;
}

export type Stage2ContextProfile = {
  paidCalls: 0;
  promptCount: number;
  inputTokens: { p50: number; p90: number; p95: number; max: number; mean: number };
  gptOverflows: number;
  grokOverflows: number;
  promptContentHash: string;
};

export async function buildStage2ContextProfile(
  suite: Stage2SuitePlan,
): Promise<Stage2ContextProfile> {
  const pr = await loadPrbenchTasks(suite.upstream_ids.prbench_legal_hard);
  const lb = loadLegalbenchTasks(suite.upstream_ids.legalbench);
  const tasks = [...pr, ...lb];
  const estimates: number[] = [];
  let gptOverflows = 0;
  let grokOverflows = 0;
  const hash = createHash("sha256");

  for (const task of tasks) {
    const userPrompt = buildUserPrompt(task);
    const est = estimateTokens(systemPrompt + userPrompt);
    estimates.push(est);
    hash.update(task.taskId);
    hash.update(String(est));
    for (const model of STAGE2_RESPONSE_MODELS) {
      const fit = assessContextFit({
        inputTokensEstimate: est,
        maxOutputTokens: 4096,
        contextWindow: CONTEXT_WINDOWS[model],
      });
      if (fit === "INELIGIBLE") {
        if (model === "gpt-6.1-sol") gptOverflows += 1;
        else grokOverflows += 1;
      }
    }
  }

  const sorted = [...estimates].sort((a, b) => a - b);
  const mean = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;

  return {
    paidCalls: 0,
    promptCount: estimates.length,
    inputTokens: {
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      max: sorted.length ? sorted[sorted.length - 1]! : 0,
      mean,
    },
    gptOverflows,
    grokOverflows,
    promptContentHash: hash.digest("hex"),
  };
}

/** Test helper: profile from in-memory tasks (no dataset IO). */
export function buildStage2ContextProfileFromTasks(tasks: NormalizedTask[]): Stage2ContextProfile {
  const estimates: number[] = [];
  let gptOverflows = 0;
  let grokOverflows = 0;
  const hash = createHash("sha256");
  for (const task of tasks) {
    const userPrompt = buildUserPrompt(task);
    const est = estimateTokens(systemPrompt + userPrompt);
    estimates.push(est);
    hash.update(task.taskId);
    hash.update(String(est));
    for (const model of STAGE2_RESPONSE_MODELS) {
      const fit = assessContextFit({
        inputTokensEstimate: est,
        maxOutputTokens: 4096,
        contextWindow: CONTEXT_WINDOWS[model],
      });
      if (fit === "INELIGIBLE") {
        if (model === "gpt-6.1-sol") gptOverflows += 1;
        else grokOverflows += 1;
      }
    }
  }
  const sorted = [...estimates].sort((a, b) => a - b);
  return {
    paidCalls: 0,
    promptCount: estimates.length,
    inputTokens: {
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      max: sorted.length ? sorted[sorted.length - 1]! : 0,
      mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
    },
    gptOverflows,
    grokOverflows,
    promptContentHash: hash.digest("hex"),
  };
}
