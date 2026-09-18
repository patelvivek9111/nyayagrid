/**
 * Objective broader_corpus gating — hard criteria, no weighted override of critical gaps.
 */

import type { CorpusCoverageClass } from "./inventory";
import { MINIMUM_SUBJECT_BUNDLE_TARGET } from "./subject-bundle";

export type BroaderCorpusCriteria = {
  minAuthorities: number;
  minStatutes: number;
  minCases: number;
  minRegsOrRules: number;
  requireHighCourtOrAppellate: boolean;
  minCanonicalUrlPercent: number;
  minCurrentnessKnownPercent: number;
  minStatuteSubjectFamilies: number;
};

/** Hard gate — every field is required; none may be traded off via a score. */
export const BROADER_CORPUS_CRITERIA: BroaderCorpusCriteria = {
  minAuthorities: 100,
  minStatutes: 15,
  minCases: 20,
  minRegsOrRules: 1,
  requireHighCourtOrAppellate: true,
  minCanonicalUrlPercent: 80,
  minCurrentnessKnownPercent: 40,
  minStatuteSubjectFamilies: MINIMUM_SUBJECT_BUNDLE_TARGET,
};

export type BroaderRequirementKey =
  | "authority_count"
  | "statute_count"
  | "case_count"
  | "reg_or_rule"
  | "high_court_or_appellate"
  | "canonical_url_pct"
  | "currentness_pct"
  | "statute_subject_breadth";

export type BroaderRequirementResult = {
  key: BroaderRequirementKey;
  required: string;
  actual: string;
  satisfied: boolean;
  critical: boolean;
};

export type BroaderGateInput = {
  authorityCount: number;
  statuteCount: number;
  caseCount: number;
  regulationCount: number;
  ruleCount: number;
  highCourtCaseCount: number;
  appellateCaseCount: number;
  withCanonicalUrlPercent: number;
  currentnessKnownPercent: number;
  /** Distinct subject families with at least partial coverage. */
  statuteSubjectFamilyCount: number;
};

export function evaluateBroaderCorpusRequirements(
  input: BroaderGateInput,
  criteria: BroaderCorpusCriteria = BROADER_CORPUS_CRITERIA,
): BroaderRequirementResult[] {
  return [
    {
      key: "authority_count",
      required: `>${criteria.minAuthorities}`,
      actual: String(input.authorityCount),
      satisfied: input.authorityCount > criteria.minAuthorities,
      critical: true,
    },
    {
      key: "statute_count",
      required: `>=${criteria.minStatutes}`,
      actual: String(input.statuteCount),
      satisfied: input.statuteCount >= criteria.minStatutes,
      critical: true,
    },
    {
      key: "case_count",
      required: `>=${criteria.minCases}`,
      actual: String(input.caseCount),
      satisfied: input.caseCount >= criteria.minCases,
      critical: true,
    },
    {
      key: "reg_or_rule",
      required: `>=${criteria.minRegsOrRules} regulation or rule`,
      actual: `regs=${input.regulationCount}, rules=${input.ruleCount}`,
      satisfied: input.regulationCount + input.ruleCount >= criteria.minRegsOrRules,
      critical: true,
    },
    {
      key: "high_court_or_appellate",
      required: ">=1 high-court or appellate case",
      actual: `high=${input.highCourtCaseCount}, app=${input.appellateCaseCount}`,
      satisfied:
        !criteria.requireHighCourtOrAppellate ||
        input.highCourtCaseCount > 0 ||
        input.appellateCaseCount > 0,
      critical: true,
    },
    {
      key: "canonical_url_pct",
      required: `>=${criteria.minCanonicalUrlPercent}%`,
      actual: `${input.withCanonicalUrlPercent}%`,
      satisfied: input.withCanonicalUrlPercent >= criteria.minCanonicalUrlPercent,
      critical: true,
    },
    {
      key: "currentness_pct",
      required: `>=${criteria.minCurrentnessKnownPercent}%`,
      actual: `${input.currentnessKnownPercent}%`,
      satisfied: input.currentnessKnownPercent >= criteria.minCurrentnessKnownPercent,
      critical: true,
    },
    {
      key: "statute_subject_breadth",
      required: `>=${criteria.minStatuteSubjectFamilies} subject families`,
      actual: String(input.statuteSubjectFamilyCount),
      satisfied: input.statuteSubjectFamilyCount >= criteria.minStatuteSubjectFamilies,
      critical: true,
    },
  ];
}

export function meetsBroaderCorpus(input: BroaderGateInput): boolean {
  return evaluateBroaderCorpusRequirements(input).every((r) => r.satisfied);
}

/**
 * Classify using hard broader gate first; otherwise fall back to limited/seed/no_corpus heuristics
 * aligned with inventory.classifyJurisdictionCoverage (without claiming broader via authority count alone).
 */
export function classifyWithBroaderGate(
  input: BroaderGateInput,
): { coverageClass: CorpusCoverageClass; requirements: BroaderRequirementResult[] } {
  const requirements = evaluateBroaderCorpusRequirements(input);
  if (requirements.every((r) => r.satisfied)) {
    return { coverageClass: "broader_corpus", requirements };
  }

  const { authorityCount, statuteCount, caseCount, regulationCount, ruleCount } = input;
  if (authorityCount === 0) {
    return { coverageClass: "no_corpus", requirements };
  }
  if (
    authorityCount <= 2 ||
    (statuteCount <= 2 && caseCount === 0 && regulationCount === 0 && ruleCount === 0 && authorityCount <= 5)
  ) {
    return { coverageClass: "seed_corpus", requirements };
  }
  if (
    statuteCount >= 3 ||
    (statuteCount >= 1 && caseCount >= 1) ||
    regulationCount >= 3 ||
    ruleCount >= 3 ||
    authorityCount >= 6
  ) {
    return { coverageClass: "limited_corpus", requirements };
  }
  return { coverageClass: "seed_corpus", requirements };
}

export type SourceDependencyClass =
  | "A_internally_solvable_now"
  | "B_requires_courtlistener"
  | "C_official_source_difficult_but_solvable"
  | "D_proprietary_public_source_limitation"
  | "E_external_limitation_unsolvable";

export function classifyGapDependency(params: {
  missingRequirement: BroaderRequirementKey;
  regulationBlocked?: boolean;
  officialStatuteUrlKnown?: boolean;
}): SourceDependencyClass {
  if (params.missingRequirement === "case_count" || params.missingRequirement === "high_court_or_appellate") {
    return "B_requires_courtlistener";
  }
  if (params.missingRequirement === "reg_or_rule" && params.regulationBlocked) {
    return "D_proprietary_public_source_limitation";
  }
  if (
    params.missingRequirement === "statute_count" ||
    params.missingRequirement === "statute_subject_breadth"
  ) {
    return params.officialStatuteUrlKnown === false
      ? "C_official_source_difficult_but_solvable"
      : "A_internally_solvable_now";
  }
  if (
    params.missingRequirement === "canonical_url_pct" ||
    params.missingRequirement === "currentness_pct"
  ) {
    return "A_internally_solvable_now";
  }
  if (params.missingRequirement === "authority_count") {
    return "B_requires_courtlistener";
  }
  return "C_official_source_difficult_but_solvable";
}
