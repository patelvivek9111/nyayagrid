import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getCacheDir } from "../paths.js";

export type PersistedCallRecord = {
  cacheKey: string;
  runId: string;
  kind: "response" | "judge";
  recordedAt: string;
  payload: unknown;
};

export function runArtifactsDir(runId: string): string {
  return path.join(getCacheDir(), "runs", runId);
}

export function ensureRunDir(runId: string): string {
  const dir = runArtifactsDir(runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Append one completed call atomically via JSONL line. */
export function appendCompletedCall(record: PersistedCallRecord): void {
  const dir = ensureRunDir(record.runId);
  const jsonlPath = path.join(dir, `${record.kind}-calls.jsonl`);
  appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`, "utf8");
}

/** Write one cache entry atomically (temp + rename). */
export function writeCacheEntryFile(
  runId: string,
  kind: "response" | "judge",
  cacheKey: string,
  payload: unknown,
): string {
  const dir = path.join(ensureRunDir(runId), kind);
  mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, `${cacheKey}.json`);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmpPath, finalPath);
  return finalPath;
}
