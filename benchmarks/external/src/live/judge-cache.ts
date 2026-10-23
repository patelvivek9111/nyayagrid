import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runArtifactsDir } from "./persistence.js";

export type CachedJudgeResult = {
  cacheKey: string;
  judgeModelId: string;
  result: unknown;
  cachedAt: string;
};

export function judgeCachePath(runId: string, cacheKey: string): string {
  return path.join(runArtifactsDir(runId), "judge", `${cacheKey}.json`);
}

export function readJudgeCache(runId: string, cacheKey: string): CachedJudgeResult | null {
  const filePath = judgeCachePath(runId, cacheKey);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8")) as CachedJudgeResult;
}

export function isJudgeCacheHit(runId: string, cacheKey: string): boolean {
  return existsSync(judgeCachePath(runId, cacheKey));
}
