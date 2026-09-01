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
      const selected: ExecutionStrategy =
        params.risk === "CRITICAL" && !params.deepDisabled ? "deep" : "standard";
      return {
        selected,
        reason: `Fast requested but risk is ${params.risk}; escalated to ${selected}`,
        escalated: true,
      };
    }
    return { selected: "fast", reason: "user requested Fast", escalated: false };
  }
  if (requested === "standard") {
    if (params.risk === "CRITICAL" && !params.deepDisabled) {
      return {
        selected: "deep",
        reason: "Standard requested but risk is CRITICAL; escalated to Deep Review",
        escalated: true,
      };
    }
    return { selected: "standard", reason: "user requested Standard", escalated: false };
  }

  // AUTO
  if ((params.risk === "CRITICAL" || params.risk === "HIGH") && !params.deepDisabled) {
    return {
      selected: "deep",
      reason: `Auto selected Deep Review because risk is ${params.risk}`,
      escalated: true,
    };
  }
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
    reason: "Auto selected Standard as the default professional workflow",
    escalated: false,
  };
}
