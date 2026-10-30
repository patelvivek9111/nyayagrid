import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getCacheDir } from "../paths.js";
import type { PaidCallCompletionStatus } from "./completion-status.js";

export type { PaidCallCompletionStatus } from "./completion-status.js";

/** Full paid-call persistence schema (A). Persist immediately after each successful call. */
export type PersistedPaidCallRecord = {
  runId: string;
  benchmarkId: string;
  taskId: string;
  provider: string;
  exactModelId: string;
  modelConfiguration: unknown;
  promptVersionHash: string;
  datasetRevision: string;
  inputHash: string;
  response: unknown;
  structuredParsedResponse: unknown;
  usage: unknown;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  providerRequestId: string | null;
  timestamp: string;
  attemptNumber: number;
  costEstimateUsd: number;
  completionStatus: PaidCallCompletionStatus;
  cacheKey: string;
  kind: "response" | "judge";
};

export type PersistedCallRecord = {
  cacheKey: string;
  runId: string;
  kind: "response" | "judge";
  recordedAt: string;
  payload: PersistedPaidCallRecord | unknown;
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

/** Persist a full paid-call record immediately (temp cache file + JSONL). */
export function persistPaidCallImmediately(record: PersistedPaidCallRecord): string {
  const cachePath = writeCacheEntryFile(record.runId, record.kind, record.cacheKey, record);
  appendCompletedCall({
    cacheKey: record.cacheKey,
    runId: record.runId,
    kind: record.kind,
    recordedAt: record.timestamp,
    payload: record,
  });
  return cachePath;
}

/** Write one cache entry atomically (temp + rename). Never delete raw responses. */
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
