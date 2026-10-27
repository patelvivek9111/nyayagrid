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

export type RunUnknownQuarantine = {
  runId: string;
  status: "QUARANTINED";
  reason: string;
  providers: string[];
  createdAt: string;
  unverifiedProviderBillingExposure: "YES";
  automaticResendBlocked: true;
  operatorReconciliationRequired: true;
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
