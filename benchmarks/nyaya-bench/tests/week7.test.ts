import { describe, expect, it } from "vitest";
import { runWeek7ProductSuite } from "../datasets/week7/product-suite";
import { runWeek7Certification } from "../runner/week7";

describe("week7 product completion", () => {
  it("passes deterministic product suite checks", () => {
    const checks = runWeek7ProductSuite();
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("classifies PASS only with regressions and build marked PASS", () => {
    const { summary } = runWeek7Certification({
      week5Regression: "PASS",
      week6Regression: "PASS",
      productionBuild: "PASS",
    });
    expect(summary.classification).toBe("WEEK7_PASS_READY_FOR_FINAL_CERTIFICATION");
    expect(summary.totals.failed).toBe(0);
    expect(summary.paidModelCert).toBe("PAID_MODEL_CERT_PENDING_FINAL_CERTIFICATION");
    expect(summary.corpusHealth).toBe("CORPUS_HEALTH_PENDING_FINAL_CERTIFICATION");
    expect(summary.pitr).toBe("PITR_ENVIRONMENT_DEPENDENT");
  });

  it("does not claim PASS while external gates pending", () => {
    const { summary } = runWeek7Certification({});
    expect(summary.classification).toBe("WEEK7_PRODUCT_STABILIZATION_MAJOR_COMPLETE");
  });
});
