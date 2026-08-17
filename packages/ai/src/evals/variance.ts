/**
 * Repeat-run variance for live evals.
 *
 * A single live pass is a point estimate. Repeating each model case N times
 * yields a min/mean/max per metric so the next recorded rates are a range,
 * not a lucky (or unlucky) draw.
 */
import {
  QUALITY_BARS,
  aggregateWorkflowRates,
  type CaseQualityFlags,
  type WorkflowId,
} from "./metrics";

export type MetricRange = {
  mean: number | null;
  min: number | null;
  max: number | null;
};

export type RepeatVarianceReport = {
  workflow: WorkflowId;
  repeats: number;
  caseCount: number;
  citationAccuracy: MetricRange;
  hallucination: MetricRange;
  falseInsufficient: MetricRange;
  falseConfidence: MetricRange;
  citationRelevanceFail: MetricRange;
  meetsBarOnMean: boolean;
  rangeStraddlesBar: boolean;
  misses: string[];
};

function range(values: Array<number | null>): MetricRange {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return { mean: null, min: null, max: null };
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    mean: Number((sum / nums.length).toFixed(1)),
    min: Number(Math.min(...nums).toFixed(1)),
    max: Number(Math.max(...nums).toFixed(1)),
  };
}

function straddles(metric: MetricRange, bar: number, kind: "min" | "max_exclusive" | "max_zero"): boolean {
  if (metric.min == null || metric.max == null || metric.mean == null) return false;
  if (kind === "min") return metric.min < bar && metric.max >= bar;
  if (kind === "max_zero") return metric.min <= 0 && metric.max > 0;
  return metric.min < bar && metric.max >= bar;
}

export function summarizeRepeatVariance(
  perRepeatFlags: CaseQualityFlags[][],
): RepeatVarianceReport[] {
  const repeats = perRepeatFlags.length;
  const workflows: WorkflowId[] = ["case_qa", "contradiction", "contract_compare"];
  const reports: RepeatVarianceReport[] = [];

  for (const workflow of workflows) {
    const perRepeat = perRepeatFlags
      .map((flags) => aggregateWorkflowRates(workflow, flags))
      .filter((r) => r.caseCount > 0);
    if (perRepeat.length === 0) continue;

    const bar = QUALITY_BARS[workflow];
    const citationAccuracy = range(perRepeat.map((r) => r.citationAccuracyPct));
    const hallucination = range(perRepeat.map((r) => r.hallucinationRatePct));
    const falseInsufficient = range(perRepeat.map((r) => r.falseInsufficientRatePct));
    const falseConfidence = range(perRepeat.map((r) => r.falseConfidenceRatePct));
    const citationRelevanceFail = range(perRepeat.map((r) => r.citationRelevanceFailureRatePct));

    // Bar against the mean of suite-level rates (same n as a single pass).
    const meanMisses: string[] = [];
    if (citationAccuracy.mean != null && citationAccuracy.mean < bar.citationAccuracyPct) {
      meanMisses.push(`citation accuracy ${citationAccuracy.mean}% < ${bar.citationAccuracyPct}%`);
    }
    if (hallucination.mean != null && hallucination.mean >= bar.hallucinationRatePct) {
      meanMisses.push(`hallucination ${hallucination.mean}% ≥ ${bar.hallucinationRatePct}%`);
    }
    if ((falseInsufficient.mean ?? 0) >= bar.falseInsufficientRatePct) {
      meanMisses.push(
        `false-insufficient ${falseInsufficient.mean}% ≥ ${bar.falseInsufficientRatePct}%`,
      );
    }
    if ((falseConfidence.mean ?? 0) > bar.falseConfidenceRatePct) {
      meanMisses.push(`false-confidence ${falseConfidence.mean}% > ${bar.falseConfidenceRatePct}%`);
    }

    const rangeStraddlesBar =
      straddles(citationAccuracy, bar.citationAccuracyPct, "min") ||
      straddles(hallucination, bar.hallucinationRatePct, "max_exclusive") ||
      straddles(falseInsufficient, bar.falseInsufficientRatePct, "max_exclusive") ||
      straddles(falseConfidence, bar.falseConfidenceRatePct, "max_zero");

    reports.push({
      workflow,
      repeats,
      caseCount: perRepeat[0]!.caseCount,
      citationAccuracy,
      hallucination,
      falseInsufficient,
      falseConfidence,
      citationRelevanceFail,
      meetsBarOnMean: meanMisses.length === 0,
      rangeStraddlesBar,
      misses: meanMisses,
    });
  }

  return reports;
}

function fmt(metric: MetricRange, unit = "%"): string {
  if (metric.mean == null) return "n/a";
  return `${metric.mean.toFixed(1)}${unit}  (min ${metric.min?.toFixed(1)}–max ${metric.max?.toFixed(1)}${unit})`;
}

export function formatRepeatVarianceReport(report: RepeatVarianceReport): string {
  const overall = report.meetsBarOnMean ? "PASS" : "FAIL";
  const straddle = report.rangeStraddlesBar ? "  RANGE STRADDLES BAR" : "";
  const miss = report.misses.length > 0 ? ` (${report.misses.join("; ")})` : "";
  return [
    `${report.workflow}  n=${report.caseCount} repeats=${report.repeats}  MEAN BAR: ${overall}${straddle}${miss}`,
    `  citation accuracy            ${fmt(report.citationAccuracy)}`,
    `  hallucination                ${fmt(report.hallucination)}`,
    `  false-insufficient           ${fmt(report.falseInsufficient)}`,
    `  false-confidence             ${fmt(report.falseConfidence)}`,
    `  citation-relevance fail      ${fmt(report.citationRelevanceFail)}`,
  ].join("\n");
}
