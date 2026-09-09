/**
 * AUTO selects FAST / STANDARD / DEEP. Escalation is risk-triggered, not every question.
 */

import type { ExecutionStrategy, RiskLevel, RouterSubsystem, RoutingMode } from "../provider-contract";

export const STRATEGY_LABELS: Record<RoutingMode, { label: string; helper: string }> = {
  auto: {
    label: "Auto",
    helper: "Nyaya selects a validated model and verification strategy for this task.",
  },
  fast: {
    label: "Fast",
    helper: "Lower latency. Still uses citations, jurisdiction, provenance, and abstention.",
  },
  standard: {
    label: "Standard",
    helper: "Default professional workflow with structured and citation validation.",
  },
  deep: {
    label: "Deep Review",
    helper: "Uses additional verification for higher-stakes work and may take longer.",
  },
};

export function selectStrategy(params: {
  requested: RoutingMode;
  subsystem: RouterSubsystem;
  risk: RiskLevel;
  deepDisabled?: boolean;
}): { selected: ExecutionStrategy; reason: string; escalated: boolean } {
  const requested = params.requested;
  if (requested === "deep") {
    if (params.deepDisabled) {
      return {
        selected: "standard",
        reason: "Deep Review disabled by kill switch; using Standard",
        escalated: false,
      };
    }
    return { selected: "deep", reason: "user requested Deep Review", escalated: false };
  }
  if (requested === "fast") {
    if (params.risk === "CRITICAL" || params.risk === "HIGH") {
      return {
        selected: "standard",
        reason: `Fast requested but risk is ${params.risk}; escalated to standard`,
        escalated: true,
      };
    }
    return { selected: "fast", reason: "user requested Fast", escalated: false };
  }
  if (requested === "standard") {
    if (params.risk === "CRITICAL" && !params.deepDisabled) {
      return {
        selected: "standard",
        reason: "Standard requested; Deep stays manual unless contradiction or user-requested Deep",
        escalated: false,
      };
    }
    return { selected: "standard", reason: "user requested Standard", escalated: false };
  }

  // AUTO: Deep stays manual except contradiction. HIGH/CRITICAL leave Fast.
  if (params.subsystem === "contradiction" && !params.deepDisabled) {
    return {
      selected: "deep",
      reason: "Auto selected Deep Review for contradiction analysis",
      escalated: true,
    };
  }
  if (params.risk === "LOW" && params.subsystem === "ask") {
    return { selected: "fast", reason: "Auto selected Fast for low-risk Ask", escalated: false };
  }
  return {
    selected: "standard",
    reason:
      params.risk === "HIGH" || params.risk === "CRITICAL"
        ? `Auto selected Standard because risk is ${params.risk}`
        : "Auto selected Standard as the default professional workflow",
    escalated: params.risk === "HIGH" || params.risk === "CRITICAL",
  };
}
