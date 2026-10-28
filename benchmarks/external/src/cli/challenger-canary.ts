/**
 * Exactly one Claude PRBench + one Gemini PRBench canary on the frozen challenger run.
 * Verifies usable final text under corrected Claude max_tokens=8192 before the full 56-task screen.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadPrbenchParquet, normalizePrbenchRow } from "../adapters/prbench.js";
import { loadExternalBenchLocalEnv } from "../live/load-local-env.js";
import { runStage1Screening } from "../live/stage1-executor.js";
import { getCacheDir, getRegistryDir } from "../paths.js";
import type { NormalizedTask } from "../schema/normalized-task.js";

const PRBENCH_REV = "01947c6ef913df518e6e52626a7b29f132b12d4f";

function parseArgValue(argv: readonly string[], name: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1] ?? null;
    if (argv[i]?.startsWith(`${name}=`)) return argv[i]!.slice(name.length + 1) || null;
  }
  return null;
}

async function loadFirstPrbenchTask(): Promise<NormalizedTask> {
  const suite = JSON.parse(
    readFileSync(path.join(getRegistryDir(), "screening-suite.json"), "utf8"),
  ) as { upstream_ids: { prbench_legal_hard: string[] } };
  const taskId = suite.upstream_ids.prbench_legal_hard[0];
  if (!taskId) throw new Error("screening suite missing PRBench IDs");
  const parquet = path.join(
    getCacheDir(),
    "prbench",
    PRBENCH_REV,
    "data",
    "legal_hard-00000-of-00001.parquet",
  );
  if (!existsSync(parquet)) throw new Error(`PRBench parquet missing: ${parquet}`);
  const rows = await loadPrbenchParquet(parquet);
  for (const row of rows) {
    const n = normalizePrbenchRow(row, { split: "legal_hard", hard: true });
    if (n.taskId === taskId) return n;
  }
  throw new Error(`PRBench task not found: ${taskId}`);
}

function latestResponseText(runId: string, modelNeedle: string): string | null {
  const dir = path.join(getCacheDir(), "runs", runId, "response");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  let best: { ts: string; text: string } | null = null;
  for (const f of files) {
    const rec = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as {
      exactModelId?: string;
      timestamp?: string;
      structuredParsedResponse?: { text?: string };
      response?: { text?: string } | string;
    };
    if (!String(rec.exactModelId ?? "").includes(modelNeedle)) continue;
    const text =
      rec.structuredParsedResponse?.text ??
      (typeof rec.response === "string"
        ? rec.response
        : typeof rec.response?.text === "string"
          ? rec.response.text
          : "");
    const ts = rec.timestamp ?? "";
    if (!best || ts > best.ts) best = { ts, text: String(text ?? "") };
  }
  return best?.text ?? null;
}

async function main(): Promise<void> {
  loadExternalBenchLocalEnv();
  const runId = parseArgValue(process.argv, "--run-id");
  if (!runId) throw new Error("Missing --run-id");
  const task = await loadFirstPrbenchTask();

  const argv = [
    "node",
    "challenger-canary",
    "--run-id",
    runId,
    "--allow-paid-model-calls",
    "--max-cost-usd",
    "20",
    "--concurrency",
    "1",
    "--batch-size",
    "1",
    "--max-openai-usd",
    "6",
    "--max-anthropic-usd",
    "10",
    "--max-google-usd",
    "5",
    "--max-judge-usd",
    "10",
  ];

  const sharedDeps = {
    prbenchTasks: [task],
    legalbenchTasks: [] as NormalizedTask[],
    skipRag: true as const,
    requireOnlySelectedProviderKeys: true,
    interleaveModelsPerTask: true,
    claudeMaxTokens: 8192,
    geminiMaxOutputTokens: 4096,
    maxCostUsdCeiling: 20,
  };

  const claude = await runStage1Screening({
    argv,
    deps: { ...sharedDeps, responseModels: ["claude-opus-5-5"] },
  });
  const claudeText = latestResponseText(runId, "claude-opus");
  const claudeUsable = Boolean(claudeText && claudeText.trim().length >= 20);

  const gemini = await runStage1Screening({
    argv,
    deps: { ...sharedDeps, responseModels: ["gemini-4-argon"] },
  });
  const geminiText = latestResponseText(runId, "gemini");
  const geminiUsable = Boolean(geminiText && geminiText.trim().length >= 20);

  const out = {
    runId,
    taskId: task.taskId,
    claude: {
      status: claude.status,
      paidCalls: claude.paidCalls,
      completedResponses: claude.progress.completedResponses,
      spendUsd: claude.cost.totalUsd,
      usableFinalText: claudeUsable,
      textLen: claudeText?.trim().length ?? 0,
      note: claude.note ?? null,
    },
    gemini: {
      status: gemini.status,
      paidCalls: gemini.paidCalls,
      completedResponses: gemini.progress.completedResponses,
      spendUsd: gemini.cost.totalUsd,
      usableFinalText: geminiUsable,
      textLen: geminiText?.trim().length ?? 0,
      note: gemini.note ?? null,
    },
    claudeMaxTokens: 8192,
    valuesPrinted: false,
  };
  writeFileSync(
    path.join(getCacheDir(), "runs", runId, "challenger-canary.json"),
    `${JSON.stringify(out, null, 2)}\n`,
  );
  console.log(JSON.stringify(out, null, 2));
  if (!claudeUsable || !geminiUsable) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 2;
});
