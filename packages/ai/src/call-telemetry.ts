/**
 * Append-only provider-call ledger. Identifiers, tokens, and latency only.
 * Never stores prompts, document text, headers, or secrets.
 */

import type { RoutingAuditRecord } from "./router/audit";

export const LAST_AUDITS_RING = 50;

export type ProviderCallRecord = {
  runId: string;
  correlationId: string;
  organizationId?: string;
  matterId?: string;
  subsystem: string;
  provider: string;
  requestedModel: string | null;
  servedModel: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  fallbackCount: number;
  finalStatus: string;
  attemptKind?: "primary" | "fallback" | "verifier";
};

export type ProviderCallSummary = {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  fallbackCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  byProvider: Record<string, number>;
  bySubsystem: Record<string, number>;
};

export function callRecordFromAudit(
  audit: RoutingAuditRecord,
  requestedModel: string | null = null,
): ProviderCallRecord {
  return {
    runId: audit.runId,
    correlationId: audit.runId,
    organizationId: audit.organizationId,
    matterId: audit.matterId,
    subsystem: audit.subsystem,
    provider: audit.provider,
    requestedModel,
    servedModel: audit.model,
    inputTokens: audit.tokenUsage?.inputTokens ?? 0,
    outputTokens: audit.tokenUsage?.outputTokens ?? 0,
    latencyMs: audit.latencyMs,
    success: audit.finalStatus === "ok",
    fallbackCount: audit.fallbacks.length,
    finalStatus: audit.finalStatus,
  };
}

export function summarizeCallRecords(
  records: ProviderCallRecord[],
  estimateUsd: (record: ProviderCallRecord) => number = () => 0,
): ProviderCallSummary {
  const byProvider: Record<string, number> = {};
  const bySubsystem: Record<string, number> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedUsd = 0;
  let successCalls = 0;
  let failedCalls = 0;
  let fallbackCalls = 0;
  for (const record of records) {
    inputTokens += record.inputTokens;
    outputTokens += record.outputTokens;
    estimatedUsd += estimateUsd(record);
    byProvider[record.provider] = (byProvider[record.provider] ?? 0) + 1;
    bySubsystem[record.subsystem] = (bySubsystem[record.subsystem] ?? 0) + 1;
    if (record.success) successCalls += 1;
    else failedCalls += 1;
    if (record.fallbackCount > 0) fallbackCalls += 1;
  }
  return {
    totalCalls: records.length,
    successCalls,
    failedCalls,
    fallbackCalls,
    inputTokens,
    outputTokens,
    estimatedUsd: Math.round(estimatedUsd * 100) / 100,
    byProvider,
    bySubsystem,
  };
}

export class ProviderCallLedger {
  readonly records: ProviderCallRecord[] = [];

  record(record: ProviderCallRecord): void {
    this.records.push(record);
  }

  recordFromAudit(audit: RoutingAuditRecord, requestedModel: string | null = null): void {
    this.record(callRecordFromAudit(audit, requestedModel));
  }

  slice(from: number): ProviderCallRecord[] {
    return this.records.slice(from);
  }

  summarize(from = 0, estimateUsd?: (record: ProviderCallRecord) => number): ProviderCallSummary {
    return summarizeCallRecords(this.slice(from), estimateUsd);
  }
}
