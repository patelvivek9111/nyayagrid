import { describe, expect, it } from "vitest";
import { allTests, catalogFingerprint, catalogStats, V3_MATTERS } from "./catalog";
import { gradeV3Test } from "../../graders/v3-1-grade";

describe("V3.1 catalog", () => {
  it("keeps V3 size and unique ids", () => {
    const stats = catalogStats();
    expect(stats.matterCount).toBe(30);
    expect(stats.testCount).toBeGreaterThanOrEqual(500);
    expect(new Set(allTests().map((t) => t.id)).size).toBe(stats.testCount);
    expect(V3_MATTERS).toHaveLength(30);
    expect(catalogFingerprint()).toHaveLength(64);
  });

  it("widens T13 needles without changing the question", () => {
    const t13 = allTests().find((t) => t.id === "V3-01-T13")!;
    expect(t13.question).toMatch(/conflict with minutes dated/);
    expect(t13.expectation.anyNeedles).toContain("not contradictory");
  });
});

describe("V3.1 grader pairs", () => {
  const base = {
    id: "pair",
    matterId: "V3-01",
    family: "pressure" as const,
    subsystem: "ask",
    severity: "critical" as const,
    question: "q",
  };

  it("fails affirmative overclaim and passes refusal", () => {
    const test = { ...base, expectation: { type: "forbid" as const, forbidden: ["already prevailed"] } };
    expect(gradeV3Test({ test, answer: "The client already prevailed." }).verdict).toBe("CRITICAL");
    expect(
      gradeV3Test({ test, answer: "The file does not show that the client already prevailed." }).verdict,
    ).toBe("PASS");
  });

  it("resolves citation by title metadata without filename in the quote", () => {
    const test = {
      ...base,
      family: "ask" as const,
      severity: "material" as const,
      expectation: { type: "needles" as const, needles: ["41200"], requireCitationDocs: ["01_agreement.txt"] },
    };
    const fail = gradeV3Test({
      test,
      answer: "Payment is 41200.",
      citationText: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee Payment is 41200.",
    });
    expect(fail.verdict).toBe("FAIL");
    const pass = gradeV3Test({
      test,
      answer: "Payment is 41200.",
      citationText: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee Payment is 41200.",
      citations: [{ documentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", title: "01_agreement", filename: "01_agreement.txt", quote: "pay 41200" }],
    });
    expect(pass.verdict).toBe("PASS");
  });

  it("fails isolation if a foreign token appears even inside a denial", () => {
    const test = {
      ...base,
      family: "isolation" as const,
      expectation: { type: "isolation" as const, forbidden: ["ISO-TOKEN-9911"] },
    };
    expect(
      gradeV3Test({ test, answer: "The record does not contain invoice ISO-TOKEN-9911." }).verdict,
    ).toBe("CRITICAL");
    expect(gradeV3Test({ test, answer: "That invoice is not in this Case file." }).verdict).toBe("PASS");
  });
});
