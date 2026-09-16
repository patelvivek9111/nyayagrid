import { setRoutingAuditSink, type RoutingAuditRecord } from "@nyayagrid/ai";
import { recordUsage } from "@nyayagrid/platform";
import { getDb } from "./db";
import { featureFromRouterSubsystem } from "./usage-feature";

function estimatedCostCentsFromAudit(audit: RoutingAuditRecord): number | null {
  if (!audit.estimatedCost.known) return null;
  return Math.max(0, Math.round(audit.estimatedCost.amountUsd * 100));
}

/** Metadata only: no prompts, retrieval text, or document content. */
export function persistRoutingAudit(audit: RoutingAuditRecord): void {
  if (!audit.userId) return;
  void recordUsage(getDb(), {
    organizationId: audit.organizationId,
    userId: audit.userId,
    matterId: audit.matterId ?? null,
    feature: featureFromRouterSubsystem(audit.subsystem),
    provider: audit.provider,
    model: audit.model,
    inputTokens: audit.tokenUsage?.inputTokens ?? 0,
    outputTokens: audit.tokenUsage?.outputTokens ?? 0,
    estimatedCostCents: estimatedCostCentsFromAudit(audit),
    latencyMs: audit.latencyMs,
    success: audit.finalStatus === "ok",
    usageActionId: audit.usageActionId ?? null,
    metadata: {
      fallbackCount: audit.fallbacks.length,
      finalStatus: audit.finalStatus,
      runId: audit.runId,
    },
  });
}

let registered = false;

export function registerRoutingUsagePersistence(): void {
  if (registered) return;
  registered = true;
  setRoutingAuditSink(persistRoutingAudit);
}
