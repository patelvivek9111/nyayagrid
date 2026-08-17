/**
 * Per-workflow quality rates and numeric pass bars.
 *
 * Bars are the quality gate written in docs/AGENT_QUALITY.md. A workflow is not
 * "industrial" until a *measured* suite (recorded in AGENT_QUALITY_TRACKER.md)
 * meets these numbers. Mock rates are code-regression measurements only until
 * Section B (attorney review) is recorded.
 */
import { CONTRACT_COMPARE_CASES } from "./graded-cases-contract-compare";
import { LIVE_CONTRACT_COMPARE_SCENARIOS } from "./live-contract-compare";

export type WorkflowId = "case_qa" | "contract_compare" | "contradiction";

export type QualityBar = {
  /** Minimum valid-cite / attempted-cite percentage. */
  citationAccuracyPct: number;
  /** Maximum fabricated/unverifiable quote percentage. */
  hallucinationRatePct: number;
  /** Maximum rate of insufficient when a grounded/partial answer was required. */
  falseInsufficientRatePct: number;
  /** Maximum rate of answering when shouldRefuse / one-sided / decoy was expected. */
  falseConfidenceRatePct: number;
};

/** Written pass bars — keep in sync with docs/AGENT_QUALITY.md. Do not soften. */
export const QUALITY_BARS: Record<WorkflowId, QualityBar> = {
  case_qa: {
    citationAccuracyPct: 90,
    hallucinationRatePct: 5,
    falseInsufficientRatePct: 10,
    falseConfidenceRatePct: 0,
  },
  contract_compare: {
    citationAccuracyPct: 90,
    hallucinationRatePct: 5,
    falseInsufficientRatePct: 10,
    falseConfidenceRatePct: 0,
  },
  contradiction: {
    citationAccuracyPct: 90,
    hallucinationRatePct: 5,
    falseInsufficientRatePct: 10,
    falseConfidenceRatePct: 0,
  },
};

export type CaseQualityFlags = {
  workflow: WorkflowId;
  caseId: string;
  passed: boolean;
  attemptedCites: number;
  validCites: number;
  fabricatedCites: number;
  falseInsufficient: boolean;
  falseConfidence: boolean;
  /** True when the case rubric listed forbiddenChunkIds. */
  citationRelevanceChecked?: boolean;
  /** Count of cited chunk IDs that appear in forbiddenChunkIds. */
  citationRelevanceFailures?: number;
  /** Live/deterministic compare: summary scored for decoy-vs-material separation. */
  decoyDiscriminationChecked?: boolean;
  /** Count of decoy needles the summary treated as a reported change. */
  decoyDiscriminationFailures?: number;
};

export type WorkflowRateReport = {
  workflow: WorkflowId;
  caseCount: number;
  passedCount: number;
  citationAccuracyPct: number | null;
  hallucinationRatePct: number | null;
  falseInsufficientRatePct: number;
  falseConfidenceRatePct: number;
  citationRelevanceFailureRatePct: number | null;
  /** Decoy false-positive rate (contract_compare diff_decoy cases only). */
  decoyFalsePositiveRatePct: number | null;
  /** Miss rate on planted material needles (contract_compare diff_material). */
  materialRecallMissRatePct: number | null;
  decoyCaseCount: number;
  materialCaseCount: number;
  meetsBar: boolean;
  bar: QualityBar;
  misses: string[];
};

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

/** Strip `#repeat` suffixes from live export ids. */
export function compareCaseIdBase(caseId: string): string {
  return caseId.replace(/#\d+$/, "");
}

export function isContractCompareDecoyFprId(caseId: string): boolean {
  const base = compareCaseIdBase(caseId);
  if (CONTRACT_COMPARE_CASES.some((c) => c.kind === "diff_decoy" && c.id === base)) return true;
  const live = LIVE_CONTRACT_COMPARE_SCENARIOS.find((s) => s.id === base);
  return live?.kind === "decoy" || live?.kind === "mixed";
}

export function isContractCompareMaterialRecallId(caseId: string): boolean {
  const base = compareCaseIdBase(caseId);
  if (CONTRACT_COMPARE_CASES.some((c) => c.kind === "diff_material" && c.id === base)) return true;
  const live = LIVE_CONTRACT_COMPARE_SCENARIOS.find((s) => s.id === base);
  return live?.kind === "material" || live?.kind === "mixed";
}

export function aggregateWorkflowRates(
  workflow: WorkflowId,
  cases: CaseQualityFlags[],
): WorkflowRateReport {
  const bar = QUALITY_BARS[workflow];
  const scoped = cases.filter((c) => c.workflow === workflow);
  const caseCount = scoped.length;
  const passedCount = scoped.filter((c) => c.passed).length;
  const attempted = scoped.reduce((n, c) => n + c.attemptedCites, 0);
  const valid = scoped.reduce((n, c) => n + c.validCites, 0);
  const fabricated = scoped.reduce((n, c) => n + c.fabricatedCites, 0);
  const falseInsufficient = scoped.filter((c) => c.falseInsufficient).length;
  const falseConfidence = scoped.filter((c) => c.falseConfidence).length;

  const citationAccuracyPct = attempted > 0 ? (valid / attempted) * 100 : null;
  const hallucinationRatePct = attempted > 0 ? (fabricated / attempted) * 100 : null;
  const falseInsufficientRatePct = caseCount > 0 ? pct(falseInsufficient, caseCount) : 0;
  const falseConfidenceRatePct = caseCount > 0 ? pct(falseConfidence, caseCount) : 0;

  const relevanceChecked = scoped.filter((c) => c.citationRelevanceChecked);
  const citationRelevanceFailureRatePct =
    relevanceChecked.length > 0
      ? pct(
          relevanceChecked.filter((c) => (c.citationRelevanceFailures ?? 0) > 0).length,
          relevanceChecked.length,
        )
      : null;

  let decoyFalsePositiveRatePct: number | null = null;
  let materialRecallMissRatePct: number | null = null;
  let decoyCaseCount = 0;
  let materialCaseCount = 0;
  if (workflow === "contract_compare") {
    const decoyFlags = scoped.filter(
      (c) => isContractCompareDecoyFprId(c.caseId) || c.decoyDiscriminationChecked,
    );
    const materialFlags = scoped.filter((c) => isContractCompareMaterialRecallId(c.caseId));
    decoyCaseCount = decoyFlags.length;
    materialCaseCount = materialFlags.length;
    if (decoyFlags.length > 0) {
      decoyFalsePositiveRatePct = pct(
        decoyFlags.filter((c) => c.falseConfidence || (c.decoyDiscriminationFailures ?? 0) > 0).length,
        decoyFlags.length,
      );
    }
    if (materialFlags.length > 0) {
      materialRecallMissRatePct = pct(
        materialFlags.filter((c) => c.falseInsufficient || !c.passed).length,
        materialFlags.length,
      );
    }
  }

  const misses: string[] = [];
  if (citationAccuracyPct != null && citationAccuracyPct < bar.citationAccuracyPct) {
    misses.push(
      `citation accuracy ${citationAccuracyPct.toFixed(1)}% < ${bar.citationAccuracyPct}%`,
    );
  }
  if (hallucinationRatePct != null && hallucinationRatePct >= bar.hallucinationRatePct) {
    misses.push(`hallucination ${hallucinationRatePct.toFixed(1)}% ≥ ${bar.hallucinationRatePct}%`);
  }
  if (falseInsufficientRatePct >= bar.falseInsufficientRatePct) {
    misses.push(
      `false-insufficient ${falseInsufficientRatePct.toFixed(1)}% ≥ ${bar.falseInsufficientRatePct}%`,
    );
  }
  if (falseConfidenceRatePct > bar.falseConfidenceRatePct) {
    misses.push(
      `false-confidence ${falseConfidenceRatePct.toFixed(1)}% > ${bar.falseConfidenceRatePct}%`,
    );
  }

  return {
    workflow,
    caseCount,
    passedCount,
    citationAccuracyPct,
    hallucinationRatePct,
    falseInsufficientRatePct,
    falseConfidenceRatePct,
    citationRelevanceFailureRatePct,
    decoyFalsePositiveRatePct,
    materialRecallMissRatePct,
    decoyCaseCount,
    materialCaseCount,
    meetsBar: caseCount > 0 && misses.length === 0,
    bar,
    misses,
  };
}

export function formatRate(value: number | null, digits = 1): string {
  if (value == null) return "n/a";
  return `${value.toFixed(digits)}%`;
}

function line(
  label: string,
  value: number | null,
  verdict: string,
  barNote: string,
): string {
  return `  ${label.padEnd(28)} ${formatRate(value).padStart(6)}  ${barNote.padEnd(12)} ${verdict}`;
}

function metricVerdict(
  value: number | null,
  bar: number,
  kind: "min" | "max_exclusive" | "max_zero",
): string {
  if (value == null) return "n/a";
  if (kind === "min") return value >= bar ? "PASS" : "FAIL";
  if (kind === "max_zero") return value <= bar ? "PASS" : "FAIL";
  return value < bar ? "PASS" : "FAIL";
}

export function formatWorkflowRateReport(report: WorkflowRateReport): string {
  const overall = report.meetsBar ? "PASS" : "FAIL";
  const bar = report.bar;
  const lines = [
    `${report.workflow}  n=${report.caseCount} passed=${report.passedCount}  WORKFLOW BAR: ${overall}` +
      (report.misses.length > 0 ? ` (${report.misses.join("; ")})` : ""),
    line(
      "citation accuracy",
      report.citationAccuracyPct,
      metricVerdict(report.citationAccuracyPct, bar.citationAccuracyPct, "min"),
      `bar ≥${bar.citationAccuracyPct}%`,
    ),
    line(
      "hallucination",
      report.hallucinationRatePct,
      metricVerdict(report.hallucinationRatePct, bar.hallucinationRatePct, "max_exclusive"),
      `bar <${bar.hallucinationRatePct}%`,
    ),
    line(
      "false-insufficient",
      report.falseInsufficientRatePct,
      metricVerdict(report.falseInsufficientRatePct, bar.falseInsufficientRatePct, "max_exclusive"),
      `bar <${bar.falseInsufficientRatePct}%`,
    ),
    line(
      "false-confidence",
      report.falseConfidenceRatePct,
      metricVerdict(report.falseConfidenceRatePct, bar.falseConfidenceRatePct, "max_zero"),
      `bar ${bar.falseConfidenceRatePct}%`,
    ),
    line(
      "citation-relevance fail",
      report.citationRelevanceFailureRatePct,
      report.citationRelevanceFailureRatePct == null
        ? "n/a"
        : report.citationRelevanceFailureRatePct > 0
          ? "FAIL"
          : "PASS",
      "reported",
    ),
  ];
  if (report.workflow === "contract_compare") {
    lines.push(
      line(
        `decoy false-positive (n=${report.decoyCaseCount})`,
        report.decoyFalsePositiveRatePct,
        report.decoyFalsePositiveRatePct == null
          ? "n/a"
          : report.decoyFalsePositiveRatePct > 0
            ? "FAIL"
            : "PASS",
        "separate FPR",
      ),
      line(
        `material recall miss (n=${report.materialCaseCount})`,
        report.materialRecallMissRatePct,
        report.materialRecallMissRatePct == null
          ? "n/a"
          : report.materialRecallMissRatePct > 0
            ? "FAIL"
            : "PASS",
        "separate recall",
      ),
    );
  }
  return lines.join("\n");
}
