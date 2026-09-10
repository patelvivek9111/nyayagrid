/**
 * V3.1 measurement catalog. Same matters/questions as V3 except objectively
 * broken T13 acceptable-wording. Does not overwrite v3-hard-unseen.
 */
import { createHash } from "node:crypto";
import {
  V3_AS_OF,
  V3_FROZEN_AT,
  V3_MATTERS,
  allTests as v3AllTests,
  documentsFor,
  type V3Expectation,
  type V3Family,
  type V3MatterSeed,
  type V3Severity,
  type V3Test,
} from "../v3/catalog";

export const V31_DATASET_ID = "v3.1-hard-unseen";
export const V31_FROZEN_AT = "2026-09-09T16:00:00.000Z";
export const V31_GRADER_VERSION = "v3.1-grade-2026-09-09";
export { V3_AS_OF, V3_MATTERS, documentsFor };
export type { V3Expectation, V3Family, V3MatterSeed, V3Severity, V3Test };

const T13_ANY_NEEDLES = [
  "not inconsistent",
  "not a conflict",
  "consistent",
  "compatible",
  "does not conflict",
  "do not conflict",
  "no conflict",
  "not in conflict",
  "not contradictory",
  "not a contradiction",
  "no contradiction",
  "not establish that the statements are contradictory",
];

export function allTests(): V3Test[] {
  return v3AllTests().map((test) => {
    if (test.family !== "contradiction") return test;
    return {
      ...test,
      expectation: {
        ...test.expectation,
        anyNeedles: T13_ANY_NEEDLES,
      },
    };
  });
}

export function catalogFingerprint(): string {
  const payload = JSON.stringify({
    id: V31_DATASET_ID,
    frozenAt: V31_FROZEN_AT,
    grader: V31_GRADER_VERSION,
    parent: "v3-hard-unseen",
    matters: V3_MATTERS,
    tests: allTests(),
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function catalogStats() {
  const tests = allTests();
  const families: Record<string, number> = {};
  for (const test of tests) families[test.family] = (families[test.family] ?? 0) + 1;
  return {
    datasetId: V31_DATASET_ID,
    matterCount: V3_MATTERS.length,
    testCount: tests.length,
    criticalCount: tests.filter((t) => t.severity === "critical").length,
    families,
    fingerprint: catalogFingerprint(),
    parentDataset: "v3-hard-unseen",
    graderVersion: V31_GRADER_VERSION,
  };
}
