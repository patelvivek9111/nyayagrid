/**
 * Routing audit record. Identifiers and scores only — never prompt/document text.
 */

import type {
  ExecutionStrategy,
  RiskLevel,
  RouterSubsystem,
  RoutingMode,
} from "../provider-contract";
import type { HealthState } from "./health";
import type { EstimatedCost } from "../provider-contract";

export const ROUTING_AUDIT_VERSION = "nyaya-routing-audit-v1";

export type RoutingAuditRecord = {
  auditVersion: typeof ROUTING_AUDIT_VERSION;
  runId: string;
  organizationId?: string;
  matterId?: string;
  subsystem: RouterSubsystem;
  strategyRequested: RoutingMode;
  strategySelected: ExecutionStrategy;
  riskLevel: RiskLevel;
  provider: string;
  model: string;
  modelRegistryVersion: string;
  certificationStatus: string;
  routingReason: string;
  fallbacks: Array<{ provider: string; model: string; reason: string }>;
  healthState: HealthState;
  promptVersion?: string;
  retrievalIds?: string[];
  jurisdictionSummary?: string;
  tokenUsage?: { inputTokens?: number; outputTokens?: number };
  estimatedCost: EstimatedCost;
  latencyMs: number;
  providerLatencyMs?: number;
  verificationLatencyMs?: number;
  fallbackOverheadMs?: number;
  decisionLatencyMs: number;
  validationResult?: string;
  finalStatus: "ok" | "unavailable" | "policy_blocked" | "budget_exceeded";
  verifierProvider?: string;
  verifierModel?: string;
  disagreementUnresolved?: boolean;
};

const CONTENT_KEY =
  /(prompt|completion|answer|message|content|text|body|quote|excerpt|passage|chunk|document|transcript|api[_-]?key|secret)/i;

export function sanitizeAudit(record: RoutingAuditRecord): RoutingAuditRecord {
  const out = { ...record };
  if (out.jurisdictionSummary && out.jurisdictionSummary.length > 240) {
    out.jurisdictionSummary = out.jurisdictionSummary.slice(0, 240);
  }
  return out;
}

export function auditHasNoSecrets(record: RoutingAuditRecord): boolean {
  const json = JSON.stringify(record);
  if (/sk-[a-zA-Z0-9]{10,}/.test(json)) return false;
  if (/Bearer\s+\S+/.test(json)) return false;
  for (const key of Object.keys(record)) {
    if (CONTENT_KEY.test(key) && key !== "promptVersion") return false;
  }
  return true;
}

export function newRunId(): string {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
