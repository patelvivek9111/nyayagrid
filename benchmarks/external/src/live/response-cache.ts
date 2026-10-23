import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runArtifactsDir } from "./persistence.js";

export type CachedResponse = {
  cacheKey: string;
  provider: string;
  modelId: string;
  response: unknown;
  cachedAt: string;
};

export function responseCachePath(runId: string, cacheKey: string): string {
  return path.join(runArtifactsDir(runId), "response", `${cacheKey}.json`);
}

export function readResponseCache(runId: string, cacheKey: string): CachedResponse | null {
  const filePath = responseCachePath(runId, cacheKey);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8")) as CachedResponse;
}

export function isResponseCacheHit(runId: string, cacheKey: string): boolean {
  return existsSync(responseCachePath(runId, cacheKey));
}
