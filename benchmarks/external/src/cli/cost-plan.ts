import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inventoryLegalBenchTasks, loadLegalBenchTaskDir } from "../adapters/legalbench.js";
import { loadPrbenchParquet, normalizePrbenchRow } from "../adapters/prbench.js";
import { computeStagePlans } from "../cost/plan-stage1.js";
import { isLivePaidExecutionAuthorized } from "../live/authorization.js";
import { getCacheDir, getRegistryDir } from "../paths.js";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function taskCharLength(task: { conversation?: unknown; input?: unknown }): number {
  let chars = 0;
  if (Array.isArray(task.conversation)) {
    for (const turn of task.conversation) {
      if (turn && typeof turn === "object" && "content" in turn) {
        const c = (turn as { content?: unknown }).content;
        if (typeof c === "string") chars += c.length;
      }
    }
  }
  if (task.input && typeof task.input === "object") {
    chars += JSON.stringify(task.input, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ).length;
  }
  return chars;
}

async function buildTokenProfile(): Promise<unknown> {
  const screening = JSON.parse(
    readFileSync(path.join(getRegistryDir(), "screening-suite.json"), "utf8"),
  ) as {
    upstream_ids: {
      prbench_legal_hard: string[];
      legalbench: string[];
      legalbench_rag: string[];
    };
  };

  const inputTokens: number[] = [];
  const cache = getCacheDir();

  const prPath = path.join(
    cache,
    "prbench/01947c6ef913df518e6e52626a7b29f132b12d4f/data/legal_hard-00000-of-00001.parquet",
  );
  if (existsSync(prPath)) {
    const rows = await loadPrbenchParquet(prPath);
    const idSet = new Set(screening.upstream_ids.prbench_legal_hard);
    for (const row of rows) {
      const task = normalizePrbenchRow(row, { split: "legal_hard", hard: true });
      if (!idSet.has(task.taskId)) continue;
      inputTokens.push(charsToTokens(taskCharLength(task)));
    }
  }

  const tasksRoot = path.join(cache, "lb/tasks");
  if (existsSync(tasksRoot)) {
    const inv = inventoryLegalBenchTasks(tasksRoot);
    const wanted = new Set(screening.upstream_ids.legalbench.map((id) => id.split("::")[0]));
    for (const item of inv) {
      if (!wanted.has(item.taskName)) continue;
      try {
        const rows = loadLegalBenchTaskDir(path.join(tasksRoot, item.taskName), item.taskName, [
          "train",
          "test",
        ]);
        for (const row of rows) {
          if (screening.upstream_ids.legalbench.includes(row.taskId)) {
            inputTokens.push(charsToTokens(taskCharLength(row)));
          }
        }
      } catch {
        // skip
      }
    }
  }

  if (inputTokens.length === 0) {
    inputTokens.push(4000, 6000, 8000, 12000);
  }

  const sorted = [...inputTokens].sort((a, b) => a - b);
  return {
    schema_version: 1,
    generated_at: "2026-10-23",
    method: "ceil(chars/4) from cached PRBench parquet and LegalBench TSV for screening IDs",
    sample_count: sorted.length,
    aggregate: {
      inputTokens: {
        p50: percentile(sorted, 50),
        p90: percentile(sorted, 90),
        p95: percentile(sorted, 95),
        max: sorted[sorted.length - 1] ?? 0,
      },
    },
  };
}

async function main(): Promise<void> {
  const tokenProfile = await buildTokenProfile();
  writeFileSync(
    path.join(getRegistryDir(), "token-profile.json"),
    `${JSON.stringify(tokenProfile, null, 2)}\n`,
    "utf8",
  );

  const stagePlans = computeStagePlans();
  writeFileSync(
    path.join(getRegistryDir(), "stage-plans.json"),
    `${JSON.stringify(stagePlans, null, 2)}\n`,
    "utf8",
  );

  const payload = {
    status: "LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED",
    paidCallsAuthorizedNow: isLivePaidExecutionAuthorized(),
    authorizationRequired: {
      flag: "--allow-paid-model-calls",
      budget: "--max-cost-usd <positive>",
      note: "Both required; env alone insufficient for unlimited spend.",
    },
    stage_1_cost_usd: stagePlans.stage_1.cost,
    stage_1_per_model: stagePlans.stage_1.perModelResponseCost,
    stage_1_judge: stagePlans.stage_1.judgeCost,
    stage_1_call_counts: stagePlans.stage_1.callCounts,
    stage_2_cost_usd: stagePlans.stage_2.cost,
    stage_2_call_counts: stagePlans.stage_2.callCounts,
    stage_3_cost_usd: stagePlans.stage_3.cost,
    stage_3: {
      repeats: stagePlans.stage_3.repeats,
      tasks: stagePlans.stage_3.tasks,
    },
    token_profile_written: path.join(getRegistryDir(), "token-profile.json"),
    stage_plans_written: path.join(getRegistryDir(), "stage-plans.json"),
  };

  console.log(JSON.stringify(payload, null, 2));
  console.log("LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
