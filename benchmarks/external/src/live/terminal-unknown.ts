/**
 * Stage-2 terminal provider-unknown policy (execution/reliability only).
 * Not part of frozen benchmark configHash — does not alter prompts/models/scoring semantics.
 *
 * After two uncertain paid attempts on the same task, the task becomes
 * TERMINAL_PROVIDER_UNKNOWN and Stage-2 continues. A provider-wide circuit
 * breaker still stops spend on systemic outages.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { ensureRunDir, runArtifactsDir } from "./persistence.js";
import {
  listUnknownCompletions,
  readRunUnknownQuarantine,
  runQuarantinePath,
  type RunUnknownQuarantine,
} from "./unknown-completion.js";

export const TERMINAL_PROVIDER_UNKNOWN_KIND = "TERMINAL_PROVIDER_UNKNOWN" as const;

/** Distinct NEW terminal/unknown tasks in one session before provider-wide stop. */
export const PROVIDER_UNKNOWN_CIRCUIT_BREAKER_THRESHOLD = 3;

export const QUARANTINE_CLEARED_AFTER_TASK_TERMINAL = "CLEARED_AFTER_TASK_TERMINALIZATION" as const;

export type TerminalProviderUnknownRecord = {
  kind: typeof TERMINAL_PROVIDER_UNKNOWN_KIND;
  runId: string;
  taskId: string;
  benchmarkId: string;
  provider: string;
  exactModelId: string;
  uncertainAttemptCount: number;
  terminalizedAt: string;
  priorFailureClassifications: string[];
  responseSuccess: false;
  semanticScore: "NO_SCORE";
  providerReliabilityFailure: true;
  retryable: false;
  futurePaidResend: false;
  potentialBillingExposure: "YES";
  unverifiedProviderBillingExposure: "YES";
  cacheKeyHint?: string;
};

function terminalDir(runId: string): string {
  return path.join(runArtifactsDir(runId), "terminal-unknown");
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

export function terminalUnknownArtifactPath(
  runId: string,
  taskId: string,
  provider: string,
): string {
  return path.join(terminalDir(runId), `${safeFilePart(provider)}__${safeFilePart(taskId)}.json`);
}

export function hasTerminalProviderUnknown(
  runId: string,
  taskId: string,
  provider: string,
): boolean {
  return existsSync(terminalUnknownArtifactPath(runId, taskId, provider));
}

export function readTerminalProviderUnknown(
  runId: string,
  taskId: string,
  provider: string,
): TerminalProviderUnknownRecord | null {
  const p = terminalUnknownArtifactPath(runId, taskId, provider);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as TerminalProviderUnknownRecord;
}

export function listTerminalProviderUnknowns(runId: string): TerminalProviderUnknownRecord[] {
  const dir = terminalDir(runId);
  if (!existsSync(dir)) return [];
  const out: TerminalProviderUnknownRecord[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const rec = JSON.parse(
        readFileSync(path.join(dir, f), "utf8"),
      ) as TerminalProviderUnknownRecord;
      if (rec.kind === TERMINAL_PROVIDER_UNKNOWN_KIND) out.push(rec);
    } catch {
      /* skip corrupt */
    }
  }
  return out.sort((a, b) => a.terminalizedAt.localeCompare(b.terminalizedAt));
}

/** Count durable UNKNOWN audit rows for a task (jsonl + current artifact). */
export function countUnknownAttemptsForTask(
  runId: string,
  taskId: string,
  provider: string,
): number {
  const fromList = listUnknownCompletions(runId).filter(
    (r) => r.taskId === taskId && r.provider === provider,
  ).length;
  // listUnknownCompletions reads the latest per-file artifact only (one file per task).
  // Prefer jsonl for full attempt history.
  const jsonlPath = path.join(runArtifactsDir(runId), "unknown-completions.jsonl");
  if (!existsSync(jsonlPath)) return fromList;
  let n = 0;
  for (const line of readFileSync(jsonlPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { taskId?: string; provider?: string };
      if (row.taskId === taskId && row.provider === provider) n += 1;
    } catch {
      /* skip */
    }
  }
  return Math.max(n, fromList);
}

export function persistTerminalProviderUnknown(record: TerminalProviderUnknownRecord): string {
  const dir = terminalDir(record.runId);
  mkdirSync(dir, { recursive: true });
  const finalPath = terminalUnknownArtifactPath(record.runId, record.taskId, record.provider);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  renameSync(tmpPath, finalPath);

  const jsonl = path.join(ensureRunDir(record.runId), "terminal-unknown.jsonl");
  appendFileSync(jsonl, `${JSON.stringify(record)}\n`, "utf8");
  return finalPath;
}

/**
 * Promote a repeated UNKNOWN task to TERMINAL_PROVIDER_UNKNOWN.
 * Preserves historical UNKNOWN artifacts; never marks success.
 */
export function terminalizeRepeatedUnknownTask(input: {
  runId: string;
  taskId: string;
  benchmarkId: string;
  provider: string;
  exactModelId: string;
  cacheKeyHint?: string;
}): TerminalProviderUnknownRecord {
  if (hasTerminalProviderUnknown(input.runId, input.taskId, input.provider)) {
    return readTerminalProviderUnknown(input.runId, input.taskId, input.provider)!;
  }
  const unknowns = listUnknownCompletions(input.runId).filter(
    (r) => r.taskId === input.taskId && r.provider === input.provider,
  );
  const attemptCount = Math.max(
    countUnknownAttemptsForTask(input.runId, input.taskId, input.provider),
    unknowns.length,
    2,
  );
  const priorFailureClassifications: string[] = [];
  const jsonlPath = path.join(runArtifactsDir(input.runId), "unknown-completions.jsonl");
  if (existsSync(jsonlPath)) {
    for (const line of readFileSync(jsonlPath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as {
          taskId?: string;
          provider?: string;
          failureClassification?: string;
        };
        if (
          row.taskId === input.taskId &&
          row.provider === input.provider &&
          row.failureClassification
        ) {
          priorFailureClassifications.push(row.failureClassification);
        }
      } catch {
        /* skip */
      }
    }
  }
  if (priorFailureClassifications.length === 0) {
    priorFailureClassifications.push(...unknowns.map((u) => u.failureClassification));
  }
  const record: TerminalProviderUnknownRecord = {
    kind: TERMINAL_PROVIDER_UNKNOWN_KIND,
    runId: input.runId,
    taskId: input.taskId,
    benchmarkId: input.benchmarkId,
    provider: input.provider,
    exactModelId: input.exactModelId,
    uncertainAttemptCount: attemptCount,
    terminalizedAt: new Date().toISOString(),
    priorFailureClassifications,
    responseSuccess: false,
    semanticScore: "NO_SCORE",
    providerReliabilityFailure: true,
    retryable: false,
    futurePaidResend: false,
    potentialBillingExposure: "YES",
    unverifiedProviderBillingExposure: "YES",
    cacheKeyHint: input.cacheKeyHint ?? unknowns[0]?.cacheKeyHint,
  };
  persistTerminalProviderUnknown(record);
  clearRunQuarantineAfterTaskTerminalization({
    runId: input.runId,
    taskId: input.taskId,
    provider: input.provider,
  });
  return record;
}

/**
 * Release provider-wide active quarantine after a task is terminalized so
 * Stage-2 can continue. Historical UNKNOWN artifacts remain on disk.
 */
export function clearRunQuarantineAfterTaskTerminalization(input: {
  runId: string;
  taskId: string;
  provider: string;
}): RunUnknownQuarantine | null {
  ensureRunDir(input.runId);
  const prior = readRunUnknownQuarantine(input.runId);
  const payload: RunUnknownQuarantine = {
    runId: input.runId,
    status: QUARANTINE_CLEARED_AFTER_TASK_TERMINAL,
    reason: `CLEARED_AFTER_TASK_TERMINALIZATION: ${input.provider} ${input.taskId}`,
    providers: prior?.providers ?? [input.provider, "openai", "xai"],
    createdAt: prior?.createdAt ?? new Date().toISOString(),
    unverifiedProviderBillingExposure: "YES",
    automaticResendBlocked: true,
    operatorReconciliationRequired: true,
    priorQuarantineReason: prior?.reason,
    acknowledgedTaskIds: prior?.acknowledgedTaskIds,
    acknowledgedAt: prior?.acknowledgedAt,
    clearedTaskId: input.taskId,
    clearedProvider: input.provider,
    clearedAt: new Date().toISOString(),
  };
  const finalPath = runQuarantinePath(input.runId);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmpPath, finalPath);
  return payload;
}

export function isProviderCircuitBroken(
  sessionTerminalOrUnknownTaskIds: ReadonlySet<string>,
): boolean {
  return sessionTerminalOrUnknownTaskIds.size >= PROVIDER_UNKNOWN_CIRCUIT_BREAKER_THRESHOLD;
}
