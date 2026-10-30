/**
 * Deterministic task → risk → tier classification.
 * Must not call an LLM to choose an LLM.
 */

import type { AiGenerateRequest, RouterSubsystem } from "../../provider-contract";
import { classifyRisk, classifyTask, deriveRiskSignalsFromRequest } from "../classifier";
import type {
  BenchmarkRouteClassification,
  BenchmarkTaskCategory,
  ClassificationReasonCode,
  RiskTier,
  RoutingTier,
} from "./types";

export type BenchmarkClassifyInput = {
  request: AiGenerateRequest;
  /** Explicit override from caller (admin/instrumentation). */
  taskCategory?: BenchmarkTaskCategory;
  highStakesLegal?: boolean;
  experimentalOptIn?: boolean;
  latencySensitive?: boolean;
  costSensitive?: boolean;
  background?: boolean;
  evaluationJudge?: boolean;
};

const TIER1_CATEGORIES = new Set<BenchmarkTaskCategory>([
  "HARD_LEGAL_REASONING",
  "AUTHORITY_ANALYSIS",
  "LEGAL_RESEARCH_ANSWER",
  "MATTER_SYNTHESIS_COMPLEX",
  "CONFLICT_ANALYSIS",
]);

const TIER3_CATEGORIES = new Set<BenchmarkTaskCategory>([
  "ROUTINE_MATTER_SYNTHESIS",
  "STRUCTURED_EXTRACTION",
  "STRUCTURED_TRANSFORMATION",
  "DRAFTING_REWRITE",
  "BACKGROUND_PROCESSING",
  "LATENCY_SENSITIVE_INTERACTION",
  "EVALUATION_JUDGE",
]);

function tierForCategory(category: BenchmarkTaskCategory): RoutingTier {
  if (category === "EXPERIMENTAL") return 4;
  if (TIER1_CATEGORIES.has(category)) return 1;
  if (TIER3_CATEGORIES.has(category)) return 3;
  return 3;
}

function riskForTier(tier: RoutingTier, experimental: boolean): RiskTier {
  if (experimental || tier === 4) return "EXPERIMENTAL";
  if (tier === 1 || tier === 2) return "HIGH_STAKES_LEGAL";
  if (tier === 3) return "LOW";
  return "STANDARD";
}

function mapSubsystemToCategory(
  subsystem: RouterSubsystem,
  signals: string[],
  draftType?: string,
): { category: BenchmarkTaskCategory; reasons: ClassificationReasonCode[] } {
  const reasons: ClassificationReasonCode[] = [];
  const highRisk =
    signals.includes("conflicting_authorities") ||
    signals.includes("conflicting_evidence") ||
    signals.includes("unsupported_proposition") ||
    signals.includes("critical_deadline") ||
    signals.includes("high_stakes_draft") ||
    signals.includes("contradiction_request");

  if (subsystem === "contradiction") {
    reasons.push("SUBSYSTEM_CONTRADICTION");
    return { category: "CONFLICT_ANALYSIS", reasons };
  }
  if (subsystem === "research") {
    reasons.push("SUBSYSTEM_RESEARCH");
    if (signals.includes("conflicting_authorities") || signals.includes("uncertain_currentness")) {
      return { category: "AUTHORITY_ANALYSIS", reasons };
    }
    return { category: "LEGAL_RESEARCH_ANSWER", reasons };
  }
  if (subsystem === "draft") {
    if (highRisk || draftType) {
      reasons.push("SUBSYSTEM_DRAFT_HIGH_STAKES");
      return { category: "HARD_LEGAL_REASONING", reasons };
    }
    reasons.push("SUBSYSTEM_DRAFT_ROUTINE");
    return { category: "DRAFTING_REWRITE", reasons };
  }
  if (
    subsystem === "timeline" ||
    subsystem === "graph" ||
    subsystem === "memory" ||
    subsystem === "evidence" ||
    subsystem === "compare" ||
    subsystem === "contract" ||
    subsystem === "deposition"
  ) {
    reasons.push("SUBSYSTEM_EXTRACTION");
    if (subsystem === "contract" && highRisk) {
      return { category: "HARD_LEGAL_REASONING", reasons };
    }
    if (subsystem === "deposition" && highRisk) {
      return { category: "MATTER_SYNTHESIS_COMPLEX", reasons };
    }
    return { category: "STRUCTURED_EXTRACTION", reasons };
  }
  if (subsystem === "ask" || subsystem === "agents" || subsystem === "professor" || subsystem === "guide") {
    if (highRisk) {
      reasons.push("SUBSYSTEM_ASK_HIGH_RISK");
      return { category: "HARD_LEGAL_REASONING", reasons };
    }
    reasons.push("SUBSYSTEM_ASK_ROUTINE");
    return { category: "ROUTINE_MATTER_SYNTHESIS", reasons };
  }
  reasons.push("DEFAULT_STANDARD");
  return { category: "ROUTINE_MATTER_SYNTHESIS", reasons };
}

/**
 * Pure classification. Prefer explicit caller inputs; otherwise derive from existing
 * deterministic subsystem/risk classifiers (no LLM).
 */
export function classifyBenchmarkTask(
  input: BenchmarkClassifyInput,
): BenchmarkRouteClassification {
  const reasonCodes: ClassificationReasonCode[] = [];

  if (input.experimentalOptIn) {
    reasonCodes.push("EXPERIMENTAL_OPT_IN");
    return {
      taskCategory: "EXPERIMENTAL",
      riskTier: "EXPERIMENTAL",
      routingTier: 4,
      reasonCodes,
    };
  }

  if (input.evaluationJudge) {
    reasonCodes.push("EVALUATION_JUDGE");
    return {
      taskCategory: "EVALUATION_JUDGE",
      riskTier: "LOW",
      routingTier: 3,
      reasonCodes,
    };
  }

  if (input.taskCategory) {
    reasonCodes.push("EXPLICIT_TASK_CATEGORY");
    if (input.highStakesLegal) reasonCodes.push("EXPLICIT_HIGH_STAKES_FLAG");
    let tier = tierForCategory(input.taskCategory);
    if (input.highStakesLegal && tier !== 1 && input.taskCategory !== "EXPERIMENTAL") {
      tier = 1;
    }
    return {
      taskCategory: input.taskCategory,
      riskTier: riskForTier(tier, false),
      routingTier: tier,
      reasonCodes,
    };
  }

  const subsystem = classifyTask(input.request);
  const derived = deriveRiskSignalsFromRequest(input.request);
  const risk = classifyRisk({
    subsystem,
    signals: [...derived, ...(input.request.routing?.riskSignals ?? [])],
    contextTokensEstimate: input.request.routing?.contextTokensEstimate,
    draftType: input.request.routing?.draftType,
  });

  if (input.highStakesLegal) {
    reasonCodes.push("EXPLICIT_HIGH_STAKES_FLAG");
    return {
      taskCategory: "HARD_LEGAL_REASONING",
      riskTier: "HIGH_STAKES_LEGAL",
      routingTier: 1,
      reasonCodes,
    };
  }

  if (input.background) {
    reasonCodes.push("BACKGROUND");
    return {
      taskCategory: "BACKGROUND_PROCESSING",
      riskTier: "LOW",
      routingTier: 3,
      reasonCodes,
    };
  }

  if (input.latencySensitive) {
    reasonCodes.push("LATENCY_SENSITIVE");
    // Latency-sensitive never silently upgrades to Tier-1; high-stakes flag wins above.
    return {
      taskCategory: "LATENCY_SENSITIVE_INTERACTION",
      riskTier: "LOW",
      routingTier: 3,
      reasonCodes,
    };
  }

  if (input.costSensitive && risk.level === "LOW") {
    reasonCodes.push("COST_SENSITIVE");
    return {
      taskCategory: "STRUCTURED_TRANSFORMATION",
      riskTier: "LOW",
      routingTier: 3,
      reasonCodes,
    };
  }

  const mapped = mapSubsystemToCategory(
    subsystem,
    risk.signals,
    input.request.routing?.draftType,
  );
  reasonCodes.push(...mapped.reasons);

  let tier = tierForCategory(mapped.category);
  if (
    (risk.level === "HIGH" || risk.level === "CRITICAL") &&
    !TIER1_CATEGORIES.has(mapped.category)
  ) {
    // Escalate routine categories when risk classifier marks HIGH/CRITICAL.
    tier = 1;
    mapped.category =
      mapped.category === "DRAFTING_REWRITE"
        ? "HARD_LEGAL_REASONING"
        : "MATTER_SYNTHESIS_COMPLEX";
  }

  return {
    taskCategory: mapped.category,
    riskTier: riskForTier(tier, false),
    routingTier: tier,
    reasonCodes,
  };
}
