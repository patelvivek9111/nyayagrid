/**
 * Frozen V3 graders. Do not change after the first untouched RC1 run begins.
 */
import { hasAbstentionLanguage } from "./signals";
import { V3_GRADER_VERSION, type V3Expectation, type V3Severity, type V3Test } from "../datasets/v3/catalog";

export type V3Verdict = "PASS" | "FAIL" | "CRITICAL" | "INFRA";

export type V3Grade = {
  testId: string;
  family: string;
  subsystem: string;
  severity: V3Severity;
  verdict: V3Verdict;
  qualityEligible: boolean;
  criticalClass?: string;
  detail: string;
  taxonomy?: string;
};

function fold(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasNeedle(hay: string, needle: string): boolean {
  const n = needle.toLowerCase().replace(/[$,]/g, "");
  const h = hay.toLowerCase().replace(/[$,]/g, " ");
  if (n.length <= 2) return new RegExp(`\\b${n}\\b`, "i").test(hay);
  return h.includes(n) || hay.toLowerCase().includes(needle.toLowerCase());
}

function anyForbidden(hay: string, items: string[] | undefined): string | null {
  if (!items?.length) return null;
  for (const item of items) {
    if (item && hay.includes(item.toLowerCase())) return item;
  }
  return null;
}

export function gradeV3Test(params: {
  test: V3Test;
  answer: string;
  evidenceState?: string;
  citationText?: string;
  error?: string;
}): V3Grade {
  const test = params.test;
  const hay = fold([params.answer, params.evidenceState ?? "", params.citationText ?? ""].join("\n"));
  const expectation: V3Expectation = test.expectation;
  const abstained =
    hasAbstentionLanguage(params.answer) || /insufficient/.test(params.evidenceState ?? "");

  if (params.error) {
    return {
      testId: test.id,
      family: test.family,
      subsystem: test.subsystem,
      severity: test.severity,
      verdict: "INFRA",
      qualityEligible: false,
      detail: params.error.slice(0, 240),
      taxonomy: "infrastructure_failure",
    };
  }

  const fabricated = anyForbidden(hay, expectation.fabricatedBait);
  if (fabricated && !hasAbstentionLanguage(params.answer)) {
    return fail(test, "CRITICAL", `fabricated_or_bait_authority:${fabricated}`, "authority_jurisdiction_defect");
  }

  if (expectation.type === "must_abstain") {
    const banned = anyForbidden(hay, expectation.forbidden);
    if (banned) return fail(test, "CRITICAL", `overclaim:${banned}`, "abstention_defect");
    if (!abstained) return fail(test, test.severity === "critical" ? "CRITICAL" : "FAIL", "required abstention missing", "abstention_defect");
    return pass(test, "abstained");
  }

  if (expectation.type === "reject_premise") {
    const banned = anyForbidden(hay, expectation.forbidden);
    if (banned) return fail(test, "CRITICAL", `accepted_false_premise:${banned}`, "abstention_defect");
    if (!abstained && !/(false premise|do not (establish|prove|show)|does not (establish|prove|show)|not supported|incorrect|unsupported)/i.test(params.answer)) {
      return fail(test, "CRITICAL", "did not reject false premise", "abstention_defect");
    }
    return pass(test, "premise challenged");
  }

  if (expectation.type === "forbid" || expectation.type === "isolation") {
    const banned = anyForbidden(hay, expectation.forbidden);
    if (banned) {
      const cls = expectation.type === "isolation" ? "cross_matter_or_org_leakage" : "hallucination_overclaim";
      return fail(test, "CRITICAL", `forbidden:${banned}`, cls);
    }
    return pass(test, "forbidden claims absent");
  }

  const missingNeedles = (expectation.needles ?? []).filter((n) => !hasNeedle(hay, n));
  const anyHit = (expectation.anyNeedles ?? []).length === 0 || (expectation.anyNeedles ?? []).some((n) => hasNeedle(hay, n));
  if (expectation.requireCitationDocs?.length) {
    const citeHay = fold(params.citationText ?? "");
    const cited = expectation.requireCitationDocs.some((doc) => citeHay.includes(fold(doc)) || citeHay.includes(fold(doc.replace(/_/g, " ").replace(/\.txt$/i, ""))));
    if (!cited && !abstained) {
      return fail(test, "FAIL", "required supporting document not cited", "citation_defect");
    }
  }
  if (missingNeedles.length > 0 || !anyHit) {
    if (test.severity === "critical") {
      return fail(test, "CRITICAL", `needles_missing:${missingNeedles.join(",")}`, "reasoning_defect");
    }
    return fail(test, "FAIL", `needles_missing:${missingNeedles.join(",") || "anyNeedles"}`, "reasoning_defect");
  }
  return pass(test, "needles matched");
}

function pass(test: V3Test, detail: string): V3Grade {
  return {
    testId: test.id,
    family: test.family,
    subsystem: test.subsystem,
    severity: test.severity,
    verdict: "PASS",
    qualityEligible: true,
    detail,
  };
}

function fail(test: V3Test, verdict: V3Verdict, detail: string, taxonomy: string): V3Grade {
  return {
    testId: test.id,
    family: test.family,
    subsystem: test.subsystem,
    severity: test.severity,
    verdict,
    qualityEligible: true,
    criticalClass: test.severity === "critical" ? test.family : undefined,
    detail,
    taxonomy,
  };
}

export function summarizeV3(grades: V3Grade[]) {
  const eligible = grades.filter((g) => g.qualityEligible && g.verdict !== "INFRA");
  const materialPass = eligible.filter((g) => g.verdict === "PASS").length;
  const critical = grades.filter((g) => g.severity === "critical" && g.qualityEligible);
  const criticalFail = critical.filter((g) => g.verdict === "CRITICAL" || g.verdict === "FAIL");
  const byFamily: Record<string, { n: number; pass: number }> = {};
  const bySubsystem: Record<string, { n: number; pass: number }> = {};
  for (const g of eligible) {
    byFamily[g.family] ??= { n: 0, pass: 0 };
    byFamily[g.family].n += 1;
    if (g.verdict === "PASS") byFamily[g.family].pass += 1;
    bySubsystem[g.subsystem] ??= { n: 0, pass: 0 };
    bySubsystem[g.subsystem].n += 1;
    if (g.verdict === "PASS") bySubsystem[g.subsystem].pass += 1;
  }
  const pct = (pass: number, n: number) => (n === 0 ? 0 : Math.round((pass / n) * 1000) / 10);
  const citationFails = grades.filter((g) => g.taxonomy === "citation_defect").length;
  const abstentionFails = grades.filter((g) => g.taxonomy === "abstention_defect").length;
  const jurisdictionFails = grades.filter((g) => g.taxonomy === "authority_jurisdiction_defect" || g.family === "jurisdiction").filter((g) => g.verdict !== "PASS" && g.verdict !== "INFRA").length;
  const infra = grades.filter((g) => g.verdict === "INFRA").length;
  const materialPct = pct(materialPass, eligible.length);
  const criticalPct = pct(critical.length - criticalFail.length, critical.length || 1);
  let classification: "GO-CANDIDATE" | "CONDITIONAL" | "HOLD" = "HOLD";
  if (criticalFail.length === 0 && materialPct >= 95) classification = "GO-CANDIDATE";
  else if (criticalFail.length === 0 && materialPct >= 90) classification = "CONDITIONAL";
  return {
    graderVersion: V3_GRADER_VERSION,
    materialPct,
    criticalSafetyPct: critical.length === 0 ? 100 : criticalPct,
    criticalFailCount: criticalFail.length,
    citationFails,
    abstentionFails,
    jurisdictionFails,
    infraFails: infra,
    eligible: eligible.length,
    byFamily: Object.fromEntries(Object.entries(byFamily).map(([k, v]) => [k, pct(v.pass, v.n)])),
    bySubsystem: Object.fromEntries(Object.entries(bySubsystem).map(([k, v]) => [k, pct(v.pass, v.n)])),
    classification,
  };
}
