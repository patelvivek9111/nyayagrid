import { describe, expect, it } from "vitest";
import { WEEK5_ASSIGNMENTS, countByCategory } from "../datasets/week5/catalog";
import { HOLDOUT_CONTAMINATION_CONTROLS, WEEK5_HOLDOUTS } from "../datasets/week5/holdouts";
import { WEEK5_AUDIT, WEEK5_CATEGORIES, WEEK5_CRITICAL_FAILURES, WEEK5_RUBRIC_DIMENSIONS } from "../datasets/week5/taxonomy";
import { auditHallucination, auditTraceability } from "../graders/week5-auditors";
import { gradeWeek5Assignment } from "../graders/week5-grade";
import { executeWeek5Assignment } from "../runner/week5-execute";
import { runWeek5Certification } from "../runner/week5";

describe("week5 taxonomy", () => {
  it("covers required categories and rubric dimensions", () => {
    expect(WEEK5_CATEGORIES).toContain("LAW_FIRM_FULL_MATTER");
    expect(WEEK5_CATEGORIES).toContain("PROSECUTION_FULL_CASE");
    expect(WEEK5_RUBRIC_DIMENSIONS).toContain("NO_HALLUCINATION");
    expect(WEEK5_CRITICAL_FAILURES).toContain("GUILT_CONCLUSION");
    expect(WEEK5_AUDIT.NEW.length).toBeGreaterThan(0);
    expect(Object.keys(countByCategory()).length).toBeGreaterThan(5);
  });

  it("keeps holdouts separate from development/certification", () => {
    expect(WEEK5_HOLDOUTS.every((row) => row.lane === "hidden_holdout")).toBe(true);
    expect(WEEK5_ASSIGNMENTS.every((row) => row.lane !== "hidden_holdout")).toBe(true);
    expect(HOLDOUT_CONTAMINATION_CONTROLS.expectedAnswersFedIntoProductionPrompts).toBe(false);
  });
});

describe("week5 auditors", () => {
  it("flags nonexistent authorities and untraceable claims", () => {
    const hallu = auditHallucination({
      authorityIds: ["missing-auth"],
      documentIds: ["doc-1"],
      citations: ["FAKE-CITE"],
      knownAuthorityIds: ["real-auth"],
      knownDocumentIds: ["doc-1"],
      knownCitations: ["REAL-CITE"],
      textBlob: "analysis",
      forbidPatterns: [],
    });
    expect(hallu.some((row) => row.code === "NONEXISTENT_AUTHORITY")).toBe(true);
    const trace = auditTraceability([
      { id: "c1", kind: "fact", text: "unsupported", sourceIds: [] },
      { id: "c2", kind: "fact", text: "supported", sourceIds: ["doc-1"] },
    ]);
    expect(trace.find((row) => row.claimId === "c1")?.code).toBe("UNTRACEABLE_CLAIM");
    expect(trace.find((row) => row.claimId === "c2")?.code).toBe("GROUNDED");
  });
});

describe("week5 assignment execution", () => {
  it("runs Ask Nyaya structured context fixture", () => {
    const assignment = WEEK5_ASSIGNMENTS.find((row) => row.id === "W5-ASK-01")!;
    const answer = executeWeek5Assignment(assignment);
    expect(answer.extras.usedWeek4CombinedContext).toBe(true);
    expect(answer.structured?.GUILT_CONCLUSION).toBeNull();
    expect(answer.structured?.BINDING_AUTHORITY.length).toBeGreaterThan(0);
    const grade = gradeWeek5Assignment(assignment, answer);
    expect(grade.criticalCount).toBe(0);
    expect(grade.passed).toBe(true);
  });

  it("keeps prosecution answers free of guilt and truthfulness labels", () => {
    const assignment = WEEK5_ASSIGNMENTS.find((row) => row.id === "W5-PR-01")!;
    const answer = executeWeek5Assignment(assignment);
    expect(answer.structured?.GUILT_CONCLUSION).toBeNull();
    expect(answer.textBlob).not.toMatch(/\b(GUILTY|NOT_GUILTY|LIAR|UNTRUTHFUL)\b/);
    const grade = gradeWeek5Assignment(assignment, answer);
    expect(grade.criticalCount).toBe(0);
  });

  it("blocks cross-tenant leakage", () => {
    const assignment = WEEK5_ASSIGNMENTS.find((row) => row.id === "W5-SEC-01")!;
    const answer = executeWeek5Assignment(assignment);
    expect(answer.extras.leakedOrgB).toBe(false);
    expect(gradeWeek5Assignment(assignment, answer).passed).toBe(true);
  });
});

describe("week5 certification suite", () => {
  it("passes with no unresolved critical or high failures", () => {
    const { summary, grades } = runWeek5Certification({ includeHoldouts: true });
    expect(summary.totals.critical).toBe(0);
    expect(summary.totals.high).toBe(0);
    expect(summary.criticalFailures).toEqual([]);
    expect(summary.holdout.critical).toBe(0);
    expect(summary.externalLlmCalls).toBe(0);
    expect(summary.courtListenerRequests).toBe(0);
    expect(summary.classification).toBe("WEEK5_PASS_OPEN_WEEK6");
    expect(grades.every((grade) => grade.passed)).toBe(true);
  });
});
