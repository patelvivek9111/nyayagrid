import { describe, expect, it } from "vitest";
import { CONTRACT_COMPARE_CASES } from "@nyayagrid/ai/evals";
import { PLANTED_MATERIAL_NEEDLES } from "@nyayagrid/ai/evals";
import { gradeAllContractCompareCases } from "./grade-contract-compare";

describe("contract-compare graded suite", () => {
  it("has at least 20 cases covering CC-01 through CC-05", () => {
    expect(CONTRACT_COMPARE_CASES.length).toBeGreaterThanOrEqual(20);
    const criteria = new Set(CONTRACT_COMPARE_CASES.map((c) => c.criterion));
    expect(criteria).toEqual(new Set(["CC-01", "CC-02", "CC-03", "CC-04", "CC-05"]));
    expect(PLANTED_MATERIAL_NEEDLES.length).toBeGreaterThanOrEqual(8);
    expect(CONTRACT_COMPARE_CASES.filter((c) => c.adversarial).length).toBeGreaterThanOrEqual(1);
  });

  it("grades the deterministic suite without false-confidence on decoys", () => {
    const grades = gradeAllContractCompareCases();
    const failed = grades.filter((g) => !g.passed);
    expect(failed, failed.map((f) => `${f.caseId}: ${f.details}`).join("\n")).toEqual([]);
  });
});
