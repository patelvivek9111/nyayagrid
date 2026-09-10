import { describe, expect, it } from "vitest";
import {
  DOGFOOD_MATTERS,
  RUBRIC_CATEGORIES,
  suggestedReviewerLoad,
} from "../dogfood/catalog";
import {
  aggregateDogfood,
  parseIssuesCsv,
  parseReviewsCsv,
  type IssueRecord,
  type ReviewRecord,
} from "../dogfood/aggregate";

const HEADER =
  "reviewer_id,reviewer_role,matter_id,task_id,score_A,score_B,score_C,score_D,score_E,score_F,score_G,score_H,score_I,score_J,score_K,score_L,fabricated_authority,fabricated_exhibit,unsupported_material_fact,misleading_certainty,missing_citation,dangerous_omission,would_rely_without_checking,would_use,time_minutes,observations";

function row(params: {
  id: string;
  role: string;
  matter: string;
  task: string;
  scores?: string;
  flags?: string;
  use?: string;
}): string {
  const scores = params.scores ?? "5,5,4,5,4,4,5,5,4,4,5,4";
  const flags = params.flags ?? "NO,NO,NO,NO,NO,NO,NO";
  return `${params.id},${params.role},${params.matter},${params.task},${scores},${flags},${params.use ?? "WITH_CHANGES"},20,ok`;
}

describe("dogfood catalog", () => {
  it("selects six synthetic matters without a criminal file that does not exist", () => {
    expect(DOGFOOD_MATTERS).toHaveLength(6);
    expect(DOGFOOD_MATTERS.map((m) => m.id)).toEqual(["DF-01", "DF-02", "DF-03", "DF-04", "DF-05", "DF-06"]);
    expect(DOGFOOD_MATTERS.some((m) => /criminal/i.test(m.domain))).toBe(false);
    expect(RUBRIC_CATEGORIES).toHaveLength(12);
    expect(suggestedReviewerLoad()).toHaveLength(5);
  });

  it("does not attach hidden-ground-truth paths to reviewer tasks", () => {
    const blob = JSON.stringify(DOGFOOD_MATTERS);
    expect(blob).not.toMatch(/hidden_ground_truth/);
    expect(blob).not.toMatch(/canonical_answer/);
  });
});

describe("dogfood aggregation", () => {
  it("stays READY-FOR-HUMAN-REVIEW with no completed reviews", () => {
    const report = aggregateDogfood([], []);
    expect(report.status).toBe("READY-FOR-HUMAN-REVIEW");
    expect(report.criticalCount).toBe(0);
  });

  it("refuses DOGFOOD PASS for operator-only scores even when bars are met", () => {
    const csv = [HEADER, row({ id: "op", role: "operator", matter: "DF-01", task: "ask", use: "YES" })].join("\n");
    const report = aggregateDogfood(parseReviewsCsv(csv), []);
    expect(report.status).toBe("READY-FOR-HUMAN-REVIEW");
    expect(report.attorneyReviewers).toBe(0);
  });

  it("HOLDs on a single CRITICAL and does not average it away", () => {
    const csv = [
      HEADER,
      row({ id: "a1", role: "attorney", matter: "DF-01", task: "ask", use: "YES" }),
      row({ id: "a1", role: "attorney", matter: "DF-01", task: "draft", use: "YES" }),
    ].join("\n");
    const issues = parseIssuesCsv(
      "reviewer_id,matter_id,task_id,severity,theme,text\na1,DF-01,ask,CRITICAL,fabricated authority,Invented 991 U.S. 4\n",
    );
    const report = aggregateDogfood(parseReviewsCsv(csv), issues);
    expect(report.status).toBe("HOLD");
    expect(report.criticalCount).toBe(1);
    expect(report.means.A).toBe(5);
  });

  it("treats fabricated-authority safety YES as CRITICAL even without issues.csv", () => {
    const csv = [
      HEADER,
      row({
        id: "a1",
        role: "attorney",
        matter: "DF-04",
        task: "research",
        flags: "YES,NO,NO,NO,NO,NO,NO",
        use: "NO",
      }),
    ].join("\n");
    const report = aggregateDogfood(parseReviewsCsv(csv), []);
    expect(report.status).toBe("HOLD");
    expect(report.criticalCount).toBe(1);
  });

  it("can PASS when an attorney set meets bars and has zero CRITICAL", () => {
    const csv = [
      HEADER,
      row({ id: "a1", role: "attorney", matter: "DF-01", task: "ask", use: "WITH CHANGES" }),
      row({ id: "a1", role: "attorney", matter: "DF-01", task: "draft", use: "YES" }),
    ].join("\n");
    const issues: IssueRecord[] = [];
    const reviews: ReviewRecord[] = parseReviewsCsv(csv);
    const report = aggregateDogfood(reviews, issues);
    expect(report.status).toBe("DOGFOOD PASS");
    expect(report.criticalCount).toBe(0);
    expect(report.trustScore).toBe(5);
  });
});
