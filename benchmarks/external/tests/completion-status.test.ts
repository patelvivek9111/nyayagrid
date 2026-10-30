import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { getCacheDir } from "../src/paths.js";
import {
  PAID_CALL_COMPLETION_STATUSES,
  TERMINAL_INCOMPLETE_STATUS,
  allowsBlindRetryForCompletionStatus,
  countsTowardTerminalCoverage,
  isPaidCallCompletionStatus,
  isTerminalPaidCallCompletionStatus,
  isValidSuccessCompletionStatus,
  type PaidCallCompletionStatus,
} from "../src/live/completion-status.js";
import {
  persistPaidCallImmediately,
  type PersistedPaidCallRecord,
} from "../src/live/persistence.js";

function baseRecord(completionStatus: PaidCallCompletionStatus): PersistedPaidCallRecord {
  return {
    runId: "test-terminal-incomplete-status",
    benchmarkId: "prbench",
    taskId: "task-1::gemini-4-argon",
    provider: "google",
    exactModelId: "gemini-4-argon",
    modelConfiguration: { max_output_tokens: 4096 },
    promptVersionHash: "prompt-hash",
    datasetRevision: "rev",
    inputHash: "input-hash",
    response: { status: "incomplete" },
    structuredParsedResponse: {
      text: "",
      terminalReason: "OUTPUT_BUDGET_INCOMPLETE_NO_USABLE_TEXT",
    },
    usage: { inputTokens: 10, outputTokens: 0 },
    inputTokens: 10,
    outputTokens: 0,
    latencyMs: 1,
    providerRequestId: null,
    timestamp: new Date().toISOString(),
    attemptNumber: 1,
    costEstimateUsd: 0,
    completionStatus,
    cacheKey: `cache-${completionStatus}`,
    kind: "response",
  };
}

describe("paid-call completionStatus terminal_incomplete", () => {
  it("accepts terminal_incomplete on the canonical status union", () => {
    expect(isPaidCallCompletionStatus(TERMINAL_INCOMPLETE_STATUS)).toBe(true);
    expect(PAID_CALL_COMPLETION_STATUSES).toContain("terminal_incomplete");
    const status: PaidCallCompletionStatus = "terminal_incomplete";
    const record: PersistedPaidCallRecord = baseRecord(status);
    expect(record.completionStatus).toBe("terminal_incomplete");
  });

  it("persists terminal_incomplete without rewriting status", () => {
    const record = baseRecord("terminal_incomplete");
    const runDir = path.join(getCacheDir(), "runs", record.runId);
    rmSync(runDir, { recursive: true, force: true });
    try {
      const cachePath = persistPaidCallImmediately(record);
      expect(existsSync(cachePath)).toBe(true);
      const loaded = JSON.parse(readFileSync(cachePath, "utf8")) as PersistedPaidCallRecord;
      expect(loaded.completionStatus).toBe("terminal_incomplete");
      const jsonlPath = path.join(runDir, "response-calls.jsonl");
      const line = readFileSync(jsonlPath, "utf8").trim().split("\n").at(-1)!;
      const envelope = JSON.parse(line) as { payload: PersistedPaidCallRecord };
      expect(envelope.payload.completionStatus).toBe("terminal_incomplete");
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("treats terminal_incomplete as terminal, not success, and not blind-retryable", () => {
    expect(isTerminalPaidCallCompletionStatus("terminal_incomplete")).toBe(true);
    expect(isValidSuccessCompletionStatus("terminal_incomplete")).toBe(false);
    expect(allowsBlindRetryForCompletionStatus("terminal_incomplete")).toBe(false);
    expect(countsTowardTerminalCoverage("terminal_incomplete")).toBe(true);
  });

  it("keeps existing status semantics unchanged", () => {
    expect(isValidSuccessCompletionStatus("success")).toBe(true);
    expect(isTerminalPaidCallCompletionStatus("success")).toBe(true);
    expect(allowsBlindRetryForCompletionStatus("success")).toBe(false);
    expect(countsTowardTerminalCoverage("success")).toBe(true);

    expect(isValidSuccessCompletionStatus("failed")).toBe(false);
    expect(isTerminalPaidCallCompletionStatus("failed")).toBe(true);
    expect(allowsBlindRetryForCompletionStatus("failed")).toBe(false);
    expect(countsTowardTerminalCoverage("failed")).toBe(true);

    expect(isValidSuccessCompletionStatus("unknown_completion_review_required")).toBe(false);
    expect(isTerminalPaidCallCompletionStatus("unknown_completion_review_required")).toBe(false);
    expect(allowsBlindRetryForCompletionStatus("unknown_completion_review_required")).toBe(false);
    expect(countsTowardTerminalCoverage("unknown_completion_review_required")).toBe(false);
  });
});
