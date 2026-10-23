import { createHash } from "node:crypto";
import type { NormalizedTask } from "../schema/normalized-task.js";
import {
  isCommercialInternalEvalOk,
  loadLegalBenchTaskLicense,
  loadRagSourceLicense,
} from "../license/firewall.js";
import { classifyLegalBenchTask } from "../adapters/legalbench.js";
import { SCREENING_SEED, SCREENING_TARGETS } from "./screening.js";

export const COMMERCIAL_SCREENING_LICENSE_FILTER = "commercial_internal_eval_ok_only" as const;

const CLEARED_RAG_SOURCES = new Set(["cuad", "maud", "contractnli"]);

function stableHash(seed: string, id: string): string {
  return createHash("sha256").update(`${seed}:${id}`).digest("hex");
}

function upstreamTaskFromLegalBenchTaskId(taskId: string): string {
  return taskId.split("::")[0] ?? taskId;
}

function ragSourceFromTaskId(taskId: string): string {
  return taskId.split("::")[0] ?? taskId;
}

export function isLegalBenchTaskCommercialCleared(taskId: string): boolean {
  return isCommercialInternalEvalOk(loadLegalBenchTaskLicense(taskId));
}

export function isRagTaskProductionCleared(taskId: string): boolean {
  const source = ragSourceFromTaskId(taskId);
  if (!CLEARED_RAG_SOURCES.has(source)) return false;
  return isCommercialInternalEvalOk(loadRagSourceLicense(source));
}

export function isUsRelevantLegalBenchUpstreamTask(upstreamTask: string): boolean {
  const category = classifyLegalBenchTask(upstreamTask);
  return category !== "NON_US_OR_LOW_RELEVANCE";
}

function rankByHash(ids: readonly string[], seed: string): string[] {
  return [...ids].sort((a, b) => stableHash(seed, a).localeCompare(stableHash(seed, b)));
}

export function rebuildCommercialLegalBenchIds(input: {
  currentIds: readonly string[];
  poolTasks: readonly NormalizedTask[];
  targetCount?: number;
  seed?: string;
}): string[] {
  const target = input.targetCount ?? SCREENING_TARGETS.legalbench;
  const seed = input.seed ?? `${SCREENING_SEED}:lb-commercial`;

  const kept = input.currentIds.filter((id) => isLegalBenchTaskCommercialCleared(id));
  const keptUpstream = new Set(kept.map(upstreamTaskFromLegalBenchTaskId));

  const refillCandidates = input.poolTasks
    .filter((t) => {
      const up = upstreamTaskFromLegalBenchTaskId(t.taskId);
      if (keptUpstream.has(up)) return false;
      if (!isUsRelevantLegalBenchUpstreamTask(up)) return false;
      return isLegalBenchTaskCommercialCleared(t.taskId);
    })
    .map((t) => t.taskId);

  const rankedRefill = rankByHash(refillCandidates, seed);
  const need = Math.max(0, target - kept.length);
  const refilled = rankedRefill.slice(0, need);

  return rankByHash([...kept, ...refilled], `${seed}:final`).slice(0, target);
}

export function rebuildCommercialRagIds(input: {
  currentIds: readonly string[];
  poolTasks: readonly NormalizedTask[];
  targetCount?: number;
  seed?: string;
}): string[] {
  const target = input.targetCount ?? SCREENING_TARGETS.legalbenchRag;
  const seed = input.seed ?? `${SCREENING_SEED}:rag-commercial`;

  const kept = input.currentIds.filter((id) => isRagTaskProductionCleared(id));
  const keptSet = new Set(kept);

  const refillCandidates = input.poolTasks
    .filter((t) => isRagTaskProductionCleared(t.taskId))
    .map((t) => t.taskId)
    .filter((id) => !keptSet.has(id));

  const rankedRefill = rankByHash(refillCandidates, seed);
  const need = Math.max(0, target - kept.length);
  const refilled = rankedRefill.slice(0, need);

  return rankByHash([...kept, ...refilled], `${seed}:final`).slice(0, target);
}

export function buildCommercialScreeningSuite(input: {
  prbenchHardTaskIds: readonly string[];
  currentLegalbenchIds: readonly string[];
  currentRagIds: readonly string[];
  legalbenchPool: readonly NormalizedTask[];
  legalbenchRagPool: readonly NormalizedTask[];
  seed?: string;
}): {
  seed: string;
  license_filter: typeof COMMERCIAL_SCREENING_LICENSE_FILTER;
  prbenchHardTaskIds: string[];
  legalbenchTaskIds: string[];
  legalbenchRagTaskIds: string[];
  targets: typeof SCREENING_TARGETS;
  actual: { prbenchHard: number; legalbench: number; legalbenchRag: number };
  dropped: { legalbench_nc: string[]; legalbench_rag_privacy_qa: string[] };
} {
  const seed = input.seed ?? SCREENING_SEED;

  const droppedNc = input.currentLegalbenchIds.filter(
    (id) => !isLegalBenchTaskCommercialCleared(id),
  );
  const droppedPrivacy = input.currentRagIds.filter(
    (id) => ragSourceFromTaskId(id) === "privacy_qa" || !isRagTaskProductionCleared(id),
  );

  const legalbenchTaskIds = rebuildCommercialLegalBenchIds({
    currentIds: input.currentLegalbenchIds,
    poolTasks: input.legalbenchPool,
    seed,
  });

  const legalbenchRagTaskIds = rebuildCommercialRagIds({
    currentIds: input.currentRagIds,
    poolTasks: input.legalbenchRagPool,
    seed,
  });

  return {
    seed,
    license_filter: COMMERCIAL_SCREENING_LICENSE_FILTER,
    prbenchHardTaskIds: [...input.prbenchHardTaskIds],
    legalbenchTaskIds,
    legalbenchRagTaskIds,
    targets: SCREENING_TARGETS,
    actual: {
      prbenchHard: input.prbenchHardTaskIds.length,
      legalbench: legalbenchTaskIds.length,
      legalbenchRag: legalbenchRagTaskIds.length,
    },
    dropped: {
      legalbench_nc: droppedNc,
      legalbench_rag_privacy_qa: droppedPrivacy.filter(
        (id) => ragSourceFromTaskId(id) === "privacy_qa",
      ),
    },
  };
}
