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
import { runArtifactsDir, ensureRunDir } from "./persistence.js";

export const UNKNOWN_COMPLETION_KIND = "UNKNOWN_COMPLETION" as const;

export type UnknownCompletionRecord = {
  kind: typeof UNKNOWN_COMPLETION_KIND;
  runId: string;
  taskId: string;
  benchmarkId: string;
  provider: string;
  exactModelId: string;
  attemptNumber: number;
  requestStartTimestamp: string;
  dispatchTimestamp: string | null;
  failureTimestamp: string;
  failureClassification:
    "UNKNOWN_COMPLETION" | "TIMEOUT_POST_DISPATCH_UNKNOWN" | "TRANSPORT_POST_DISPATCH_UNKNOWN";
  providerRequestId: string | null;
  sanitizedErrorMessage: string;
  usageReceived: false;
  responseBodyReceived: false;
  safelyRetryable: false;
  potentialBillingExposure: "YES";
  resendBlocked: true;
  operatorOverrideRequired: true;
  cacheKeyHint?: string;
};

export const OPERATOR_ACKNOWLEDGED_FOR_SINGLE_RESEND =
  "OPERATOR_ACKNOWLEDGED_FOR_SINGLE_RESEND" as const;

export type RunUnknownQuarantineStatus =
  | "QUARANTINED"
  | typeof OPERATOR_ACKNOWLEDGED_FOR_SINGLE_RESEND
  | "CLEARED_AFTER_TASK_TERMINALIZATION";

export type RunUnknownQuarantine = {
  runId: string;
  status: RunUnknownQuarantineStatus;
  reason: string;
  providers: string[];
  createdAt: string;
  unverifiedProviderBillingExposure: "YES";
  automaticResendBlocked: true;
  operatorReconciliationRequired: true;
  /** Present after operator release; historical UNKNOWN artifacts remain on disk. */
  acknowledgedTaskIds?: string[];
  acknowledgedAt?: string;
  priorQuarantineReason?: string;
  clearedTaskId?: string;
  clearedProvider?: string;
  clearedAt?: string;
};

export type UnknownResendAttempt = {
  taskId: string;
  provider: string;
  attemptedAt: string;
};

export type UnknownResendLedger = {
  runId: string;
  attempts: UnknownResendAttempt[];
};

function unknownDir(runId: string): string {
  return path.join(runArtifactsDir(runId), "unknown");
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9._-]+/g, "[REDACTED_KEY]")
    .replace(/xai-[A-Za-z0-9._-]+/gi, "[REDACTED_KEY]")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

export function unknownArtifactPath(runId: string, taskId: string, provider: string): string {
  return path.join(unknownDir(runId), `${safeFilePart(provider)}__${safeFilePart(taskId)}.json`);
}

export function runQuarantinePath(runId: string): string {
  return path.join(runArtifactsDir(runId), "unknown-quarantine.json");
}

export function unknownResendLedgerPath(runId: string): string {
  return path.join(runArtifactsDir(runId), "unknown-resend-ledger.json");
}

export function isActiveUnknownQuarantine(
  quarantine: RunUnknownQuarantine | null | undefined,
): boolean {
  return quarantine?.status === "QUARANTINED";
}

/** Persist UNKNOWN completion atomically. Never marks as success / missing. */
export function persistUnknownCompletion(record: UnknownCompletionRecord): string {
  const dir = unknownDir(record.runId);
  mkdirSync(dir, { recursive: true });
  const finalPath = unknownArtifactPath(record.runId, record.taskId, record.provider);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  renameSync(tmpPath, finalPath);

  const jsonl = path.join(ensureRunDir(record.runId), "unknown-completions.jsonl");
  appendFileSync(jsonl, `${JSON.stringify(record)}\n`, "utf8");
  return finalPath;
}

export function writeRunUnknownQuarantine(input: {
  runId: string;
  reason: string;
  providers: string[];
}): RunUnknownQuarantine {
  ensureRunDir(input.runId);
  const payload: RunUnknownQuarantine = {
    runId: input.runId,
    status: "QUARANTINED",
    reason: sanitizeMessage(input.reason),
    providers: [...new Set(input.providers)],
    createdAt: new Date().toISOString(),
    unverifiedProviderBillingExposure: "YES",
    automaticResendBlocked: true,
    operatorReconciliationRequired: true,
  };
  const finalPath = runQuarantinePath(input.runId);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmpPath, finalPath);
  return payload;
}

export function readRunUnknownQuarantine(runId: string): RunUnknownQuarantine | null {
  const p = runQuarantinePath(runId);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as RunUnknownQuarantine;
}

/**
 * Operator release of an active UNKNOWN quarantine for exactly one resend of
 * listed missing tasks. Preserves historical UNKNOWN artifacts and audit fields.
 * Does not authorize repeated retries of the same task.
 */
export function acknowledgeQuarantineForSingleResend(input: {
  runId: string;
  taskIds: string[];
  note?: string;
}): RunUnknownQuarantine {
  ensureRunDir(input.runId);
  const prior = readRunUnknownQuarantine(input.runId);
  const taskIds = [...new Set(input.taskIds.filter((t) => t.trim().length > 0))];
  if (taskIds.length === 0) {
    throw new Error("acknowledgeQuarantineForSingleResend requires at least one taskId");
  }
  const payload: RunUnknownQuarantine = {
    runId: input.runId,
    status: OPERATOR_ACKNOWLEDGED_FOR_SINGLE_RESEND,
    reason: sanitizeMessage(
      input.note ?? `OPERATOR_ACKNOWLEDGED_FOR_SINGLE_RESEND for ${taskIds.join(", ")}`,
    ),
    providers: prior?.providers ?? ["openai", "xai"],
    createdAt: prior?.createdAt ?? new Date().toISOString(),
    unverifiedProviderBillingExposure: "YES",
    automaticResendBlocked: true,
    operatorReconciliationRequired: true,
    acknowledgedTaskIds: taskIds,
    acknowledgedAt: new Date().toISOString(),
    priorQuarantineReason: prior?.reason,
  };
  const finalPath = runQuarantinePath(input.runId);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmpPath, finalPath);
  return payload;
}

export function readUnknownResendLedger(runId: string): UnknownResendLedger {
  const p = unknownResendLedgerPath(runId);
  if (!existsSync(p)) return { runId, attempts: [] };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as UnknownResendLedger;
    return {
      runId,
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
    };
  } catch {
    return { runId, attempts: [] };
  }
}

export function hasConsumedSingleUnknownResend(
  runId: string,
  taskId: string,
  provider: string,
): boolean {
  return readUnknownResendLedger(runId).attempts.some(
    (a) => a.taskId === taskId && a.provider === provider,
  );
}

/** Record that operator-authorized single resend was consumed for this task. */
export function recordUnknownResendAttempt(input: {
  runId: string;
  taskId: string;
  provider: string;
}): UnknownResendLedger {
  ensureRunDir(input.runId);
  const ledger = readUnknownResendLedger(input.runId);
  if (ledger.attempts.some((a) => a.taskId === input.taskId && a.provider === input.provider)) {
    return ledger;
  }
  ledger.attempts.push({
    taskId: input.taskId,
    provider: input.provider,
    attemptedAt: new Date().toISOString(),
  });
  const finalPath = unknownResendLedgerPath(input.runId);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  renameSync(tmpPath, finalPath);
  return ledger;
}

export function hasUnknownCompletionArtifact(
  runId: string,
  taskId: string,
  provider: string,
): boolean {
  return existsSync(unknownArtifactPath(runId, taskId, provider));
}

export function readUnknownCompletion(
  runId: string,
  taskId: string,
  provider: string,
): UnknownCompletionRecord | null {
  const p = unknownArtifactPath(runId, taskId, provider);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as UnknownCompletionRecord;
}

export function listUnknownCompletions(runId: string): UnknownCompletionRecord[] {
  const dir = unknownDir(runId);
  if (!existsSync(dir)) return [];
  const out: UnknownCompletionRecord[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const rec = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as UnknownCompletionRecord;
      if (rec.kind === UNKNOWN_COMPLETION_KIND) out.push(rec);
    } catch {
      /* skip corrupt */
    }
  }
  return out.sort((a, b) => a.failureTimestamp.localeCompare(b.failureTimestamp));
}

export type UnknownCompletionAuditRow = {
  provider: string;
  taskId: string;
  timestamp: string;
  requestId: string | null;
  possibleBillableStatus: "UNVERIFIED_PROVIDER_BILLING_EXPOSURE";
  laterSuccessArtifactExists: boolean;
  resendBlocked: true;
  failureClassification: string;
};

/** Local-only audit; zero provider calls. */
export function auditUnknownCompletions(input: {
  runId: string;
  successTaskIds?: Set<string>;
}): UnknownCompletionAuditRow[] {
  const success = input.successTaskIds ?? new Set<string>();
  return listUnknownCompletions(input.runId).map((r) => ({
    provider: r.provider,
    taskId: r.taskId,
    timestamp: r.failureTimestamp,
    requestId: r.providerRequestId,
    possibleBillableStatus: "UNVERIFIED_PROVIDER_BILLING_EXPOSURE",
    laterSuccessArtifactExists: success.has(r.taskId),
    resendBlocked: true,
    failureClassification: r.failureClassification,
  }));
}

export function isPostDispatchUnknownCode(code: string): boolean {
  return (
    code === "UNKNOWN_COMPLETION" ||
    code === "TIMEOUT_POST_DISPATCH_UNKNOWN" ||
    code === "TRANSPORT_POST_DISPATCH_UNKNOWN"
  );
}

export function allowUnknownResend(argv: readonly string[]): boolean {
  return argv.includes("--allow-unknown-resend");
}

export function acknowledgeUnverifiedBillingExposure(argv: readonly string[]): boolean {
  return argv.includes("--acknowledge-unverified-billing-exposure");
}

/**
 * If a prior STAGE2_PARTIAL summary indicates post-dispatch uncertainty,
 * ensure a run-level quarantine marker exists (no per-task invention).
 */
export function ensureQuarantineFromPartialSummary(runId: string): RunUnknownQuarantine | null {
  const summaryPath = path.join(runArtifactsDir(runId), "stage2-summary.json");
  if (!existsSync(summaryPath)) return null;
  let summary: { status?: string; note?: string };
  try {
    summary = JSON.parse(readFileSync(summaryPath, "utf8")) as {
      status?: string;
      note?: string;
    };
  } catch {
    return null;
  }
  const note = summary.note ?? "";
  const looksUnknown =
    /transport failure after dispatch|UNKNOWN_COMPLETION|TIMEOUT_POST_DISPATCH|fetch failed/i.test(
      note,
    ) ||
    summary.status === "STAGE2_PAUSED_UNKNOWN_COMPLETION" ||
    summary.status === "STAGE2_PARTIAL";
  if (!looksUnknown) return null;
  const existing = readRunUnknownQuarantine(runId);
  if (existing) return existing;
  // Do not re-seed provider-wide quarantine once tasks were terminalized / cleared.
  if (
    summary.status === "STAGE2_COMPLETE" ||
    summary.status === "STAGE2_PROVIDER_CIRCUIT_BREAKER"
  ) {
    return null;
  }
  // Only auto-seed quarantine when note clearly indicates post-dispatch uncertainty.
  if (
    !/transport failure after dispatch|UNKNOWN_COMPLETION|TIMEOUT_POST_DISPATCH|fetch failed/i.test(
      note,
    ) &&
    summary.status !== "STAGE2_PAUSED_UNKNOWN_COMPLETION"
  ) {
    return null;
  }
  return writeRunUnknownQuarantine({
    runId,
    reason: note || "prior STAGE2_PARTIAL with post-dispatch uncertainty",
    providers: ["openai", "xai"],
  });
}
