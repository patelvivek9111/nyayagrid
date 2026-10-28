/**
 * Stage-2 finalist task planner.
 * Freezes PRBench Legal Hard 250 + ~80 commercial LegalBench + 150 RAG IDs.
 * Selection is deterministic and independent of Stage-1 outcome scores.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadPrbenchParquet, normalizePrbenchRow } from "../adapters/prbench.js";
import { loadLegalBenchTaskDir } from "../adapters/legalbench.js";
import { loadLegalBenchRagBenchmarkFile } from "../adapters/legalbench-rag.js";
import { isCommercialInternalEvalOk, loadRagSourceLicense } from "../license/firewall.js";
import { getCacheDir, getRegistryDir } from "../paths.js";
import type { NormalizedTask } from "../schema/normalized-task.js";
import {
  COMMERCIAL_SCREENING_LICENSE_FILTER,
  isLegalBenchTaskCommercialCleared,
  isRagTaskProductionCleared,
  isUsRelevantLegalBenchUpstreamTask,
  rebuildCommercialLegalBenchIds,
  rebuildCommercialRagIds,
} from "../selectors/commercial-screening.js";

export const STAGE2_SUITE_SEED = "nyayagrid-external-stage2-finalists-v1";
export const STAGE2_TARGETS = {
  prbenchHard: 250,
  legalbench: 80,
  legalbenchRag: 150,
} as const;

export const PRBENCH_REV = "01947c6ef913df518e6e52626a7b29f132b12d4f";
export const LEGALBENCH_REV = "b46bf4ffae90524b2b72aaa30e7745fe9db64481";
export const RAG_REV = "2b9c248bc8179ef0908fd6ba01d50b156facd48b";

export const STAGE2_RESPONSE_MODELS = ["gpt-6.1-sol", "grok-4.7"] as const;
/** Finalist models only. Claude challenger is additive and never a silent substitute. */
export const STAGE2_CLAUDE_CHALLENGER_MODEL = "claude-opus-5-5" as const;
export type Stage2FinalistModelId = (typeof STAGE2_RESPONSE_MODELS)[number];
export type Stage2ResponseModelId = Stage2FinalistModelId | typeof STAGE2_CLAUDE_CHALLENGER_MODEL;

export const STAGE2_JUDGE_A = "claude-sonnet-5-5" as const;
export const STAGE2_JUDGE_B = "gpt-6.1-sol" as const;

function stableHash(seed: string, id: string): string {
  return createHash("sha256").update(`${seed}:${id}`).digest("hex");
}

function rankByHash(ids: readonly string[], seed: string): string[] {
  return [...ids].sort((a, b) => stableHash(seed, a).localeCompare(stableHash(seed, b)));
}

export async function loadAllPrbenchLegalHardIds(): Promise<string[]> {
  const parquet = path.join(
    getCacheDir(),
    "prbench",
    PRBENCH_REV,
    "data",
    "legal_hard-00000-of-00001.parquet",
  );
  if (!existsSync(parquet)) {
    throw new Error(`PRBench Legal Hard parquet missing: ${parquet}`);
  }
  const rows = await loadPrbenchParquet(parquet);
  const ids = rows
    .map((row) => normalizePrbenchRow(row, { split: "legal_hard", hard: true }).taskId)
    .filter((id) => id.length > 0);
  if (ids.length !== STAGE2_TARGETS.prbenchHard) {
    throw new Error(
      `PRBench Legal Hard expected ${STAGE2_TARGETS.prbenchHard} tasks, found ${ids.length}`,
    );
  }
  return rankByHash(ids, `${STAGE2_SUITE_SEED}:prbench`);
}

export function loadLegalBenchPoolTasks(): NormalizedTask[] {
  const root = path.join(getCacheDir(), "legalbench", LEGALBENCH_REV, "tasks");
  if (!existsSync(root)) {
    throw new Error(`LegalBench tasks missing: ${root}`);
  }
  const out: NormalizedTask[] = [];
  for (const taskName of readdirSync(root)) {
    const dir = path.join(root, taskName);
    for (const split of ["train", "test"] as const) {
      try {
        const tasks = loadLegalBenchTaskDir(dir, taskName, [split]);
        out.push(...tasks);
      } catch {
        /* skip incomplete dirs */
      }
    }
  }
  return out;
}

export function loadRagPoolTasks(): NormalizedTask[] {
  const ragRoot = path.join(getCacheDir(), "legalbench-rag", RAG_REV);
  const benchmarksDir = path.join(ragRoot, "benchmarks");
  const out: NormalizedTask[] = [];
  for (const source of ["cuad", "maud", "contractnli"] as const) {
    if (!isCommercialInternalEvalOk(loadRagSourceLicense(source))) continue;
    const file = path.join(benchmarksDir, `${source}.json`);
    if (!existsSync(file)) continue;
    out.push(...loadLegalBenchRagBenchmarkFile(file, source));
  }
  return out;
}

export type Stage2SuitePlan = {
  suite_id: string;
  selection_method: string;
  seed: string;
  frozen: boolean;
  license_filter: typeof COMMERCIAL_SCREENING_LICENSE_FILTER;
  targets: typeof STAGE2_TARGETS;
  actual: { prbenchHard: number; legalbench: number; legalbenchRag: number };
  response_models: readonly Stage2ResponseModelId[];
  judges: { judge_a: typeof STAGE2_JUDGE_A; judge_b: typeof STAGE2_JUDGE_B };
  call_counts: {
    prbenchResponses: number;
    legalbenchResponses: number;
    totalResponses: number;
    judgeCalls: number;
    ragRetrievalOnly: number;
    ragGenerationCalls: number;
  };
  upstream_ids: {
    prbench_legal_hard: string[];
    legalbench: string[];
    legalbench_rag: string[];
  };
  dropped: {
    legalbench_nc_or_non_us: string[];
    legalbench_rag_excluded: string[];
  };
  dataset_revisions: {
    prbench: typeof PRBENCH_REV;
    legalbench: typeof LEGALBENCH_REV;
    legalbench_rag: typeof RAG_REV;
  };
};

/**
 * Build Stage-2 suite. LegalBench selection is independent of Stage-1 task outcomes:
 * deterministic commercial+US-relevant hash ranking to target ~80.
 * Prefer one representative example per upstream task when possible.
 */
export async function buildStage2SuitePlan(input?: {
  seed?: string;
  legalbenchTarget?: number;
}): Promise<Stage2SuitePlan> {
  const seed = input?.seed ?? STAGE2_SUITE_SEED;
  const lbTarget = input?.legalbenchTarget ?? STAGE2_TARGETS.legalbench;

  const prbenchIds = await loadAllPrbenchLegalHardIds();

  const screeningPath = path.join(getRegistryDir(), "screening-suite.json");
  const screening = existsSync(screeningPath)
    ? (JSON.parse(readFileSync(screeningPath, "utf8")) as {
        upstream_ids?: { legalbench?: string[]; legalbench_rag?: string[] };
      })
    : {};

  const pool = loadLegalBenchPoolTasks();
  // Prefer one example per upstream task for breadth (~80 distinct tasks).
  const byUpstream = new Map<string, NormalizedTask[]>();
  for (const t of pool) {
    const up = t.taskId.split("::")[0] ?? t.taskId;
    if (!isUsRelevantLegalBenchUpstreamTask(up)) continue;
    if (!isLegalBenchTaskCommercialCleared(t.taskId)) continue;
    const list = byUpstream.get(up) ?? [];
    list.push(t);
    byUpstream.set(up, list);
  }
  const onePerUpstream = rankByHash([...byUpstream.keys()], `${seed}:lb-upstream`)
    .map((up) => {
      const candidates = byUpstream.get(up) ?? [];
      const ranked = rankByHash(
        candidates.map((c) => c.taskId),
        `${seed}:lb-ex:${up}`,
      );
      return ranked[0]!;
    })
    .filter(Boolean);

  const currentIds = screening.upstream_ids?.legalbench ?? [];
  // Start from breadth set, then fill via commercial rebuild helper if short.
  let legalbenchIds = onePerUpstream.slice(0, lbTarget);
  if (legalbenchIds.length < lbTarget) {
    legalbenchIds = rebuildCommercialLegalBenchIds({
      currentIds: [...new Set([...legalbenchIds, ...currentIds])],
      poolTasks: pool,
      targetCount: lbTarget,
      seed: `${seed}:lb-commercial`,
    });
  } else {
    legalbenchIds = rankByHash(legalbenchIds, `${seed}:lb-final`).slice(0, lbTarget);
  }

  const ragPool = loadRagPoolTasks();
  const ragIds = rebuildCommercialRagIds({
    currentIds: screening.upstream_ids?.legalbench_rag ?? [],
    poolTasks: ragPool,
    targetCount: STAGE2_TARGETS.legalbenchRag,
    seed: `${seed}:rag-commercial`,
  });

  const droppedNc = pool
    .map((t) => t.taskId)
    .filter((id) => {
      const up = id.split("::")[0] ?? id;
      return !isLegalBenchTaskCommercialCleared(id) || !isUsRelevantLegalBenchUpstreamTask(up);
    })
    .slice(0, 50);

  const droppedRag = ragPool
    .map((t) => t.taskId)
    .filter((id) => !isRagTaskProductionCleared(id))
    .slice(0, 20);

  const responseModels = STAGE2_RESPONSE_MODELS;
  const prbenchResponses = prbenchIds.length * responseModels.length;
  const legalbenchResponses = legalbenchIds.length * responseModels.length;

  return {
    suite_id: "external-stage2-finalists-v1",
    selection_method: "deterministic_commercial_hash_independent_of_stage1_scores",
    seed,
    frozen: false,
    license_filter: COMMERCIAL_SCREENING_LICENSE_FILTER,
    targets: STAGE2_TARGETS,
    actual: {
      prbenchHard: prbenchIds.length,
      legalbench: legalbenchIds.length,
      legalbenchRag: ragIds.length,
    },
    response_models: responseModels,
    judges: { judge_a: STAGE2_JUDGE_A, judge_b: STAGE2_JUDGE_B },
    call_counts: {
      prbenchResponses,
      legalbenchResponses,
      totalResponses: prbenchResponses + legalbenchResponses,
      judgeCalls: prbenchIds.length * responseModels.length * 2,
      ragRetrievalOnly: ragIds.length,
      ragGenerationCalls: 0,
    },
    upstream_ids: {
      prbench_legal_hard: prbenchIds,
      legalbench: legalbenchIds,
      legalbench_rag: ragIds,
    },
    dropped: {
      legalbench_nc_or_non_us: droppedNc,
      legalbench_rag_excluded: droppedRag,
    },
    dataset_revisions: {
      prbench: PRBENCH_REV,
      legalbench: LEGALBENCH_REV,
      legalbench_rag: RAG_REV,
    },
  };
}

export function plannedStage2ResponseCount(suite: Stage2SuitePlan): number {
  return suite.call_counts.totalResponses;
}

export function plannedStage2JudgeCount(suite: Stage2SuitePlan): number {
  return suite.call_counts.judgeCalls;
}
