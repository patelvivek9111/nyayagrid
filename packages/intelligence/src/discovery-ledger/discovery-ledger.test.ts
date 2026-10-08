import { describe, expect, it } from "vitest";
import { parseBatesRangeText } from "./bates";
import { runComplexDiscoveryLedgerFixture, runLargeDiscoveryLedgerFixture } from "./fixtures";
import {
  answerDiscoveryQuestion,
  assertMatterScopedLink,
  assertOrgScopedReview,
  buildDiscoveryWholeMatterView,
  findDiscoveryLedgerViolations,
  formatDiscoveryAnswer,
  objectionOnlyItems,
  unansweredItems,
} from "./model";

describe("discovery ledger prototype", () => {
  it("parses common Bates patterns conservatively", () => {
    expect(parseBatesRangeText("ACME000100–ACME000180")).toEqual({
      prefix: "ACME",
      start: 100,
      end: 180,
      rawText: "ACME000100–ACME000180",
    });
    expect(parseBatesRangeText("ABC-000001")).toEqual({
      prefix: "ABC",
      start: 1,
      end: 1,
      rawText: "ABC-000001",
    });
    expect(parseBatesRangeText("not a bates string")).toBeNull();
  });

  it("tracks unanswered, objection-only, productions, and Bates review signals", () => {
    const { review } = runComplexDiscoveryLedgerFixture();
    expect(unansweredItems(review).some((item) => item.id === "item-rog-3")).toBe(true);
    expect(objectionOnlyItems(review).some((item) => item.id === "item-rfp-14")).toBe(true);
    expect(review.productions.some((row) => row.isSupplemental && row.producedAt === "2026-09-18")).toBe(true);
    expect(review.batesSignals.some((row) => row.kind === "OVERLAP")).toBe(true);
    expect(review.batesSignals.every((row) => row.legalDeficiencyConclusion === null)).toBe(true);
    expect(review.sanctionsConclusion).toBeNull();
    expect(review.privilegeLegalConclusion).toBeNull();
  });

  it("answers discovery Ask questions without sanctions or privilege legal conclusions", () => {
    const { review } = runComplexDiscoveryLedgerFixture();
    const unanswered = formatDiscoveryAnswer(
      answerDiscoveryQuestion({
        review,
        question: "Which discovery requests are still unanswered?",
      }),
    );
    expect(unanswered).toContain("item-rog-3");
    expect(unanswered).toContain("SANCTIONS_CONCLUSION: null");

    const rfp12 = formatDiscoveryAnswer(
      answerDiscoveryQuestion({
        review,
        question: "What did Acme produce in response to Request No. 12?",
      }),
    );
    expect(rfp12).toMatch(/prod-1|prod-2|ACME000/);

    const bates = formatDiscoveryAnswer(
      answerDiscoveryQuestion({
        review,
        question: "What Bates ranges were produced on September 18?",
      }),
    );
    expect(bates).toContain("ACME000200–ACME000220");

    const compel = formatDiscoveryAnswer(
      answerDiscoveryQuestion({
        review,
        question: "Which discovery issues are tied to the motion to compel?",
      }),
    );
    expect(compel).toContain("motion-compel-1");
    expect(findDiscoveryLedgerViolations(compel)).toEqual([]);
  });

  it("preserves privilege assertion as review state, not a legal conclusion", () => {
    const { review } = runComplexDiscoveryLedgerFixture();
    const answer = answerDiscoveryQuestion({
      review,
      question: "What privilege assertions are under review?",
    });
    expect(answer.privilegeNotes.some((note) => /ASSERTED/.test(note))).toBe(true);
    expect(answer.privilegeLegalConclusion).toBeNull();
    expect(review.privilegeAssertions.every((row) => row.courtRulingReferenced === false)).toBe(true);
  });

  it("builds whole-matter discovery view without flattening to counts alone", () => {
    const { review } = runComplexDiscoveryLedgerFixture();
    const whole = buildDiscoveryWholeMatterView(review);
    expect(whole.unansweredCount).toBeGreaterThan(0);
    expect(whole.outstandingItemIds).toContain("item-rog-3");
    expect(whole.motionLinks.length).toBeGreaterThan(0);
    expect(whole.claimSupportGapsNoted.length).toBeGreaterThan(0);
    expect(whole.sanctionsConclusion).toBeNull();
  });

  it("detects cross-production Bates gap as review signal only", () => {
    const { review } = runComplexDiscoveryLedgerFixture();
    expect(review.batesSignals.some((row) => row.kind === "APPARENT_GAP")).toBe(true);
    expect(review.batesSignals.every((row) => row.legalDeficiencyConclusion === null)).toBe(true);
  });

  it("denies cross-org and cross-matter linkage at the application layer", () => {
    const { review } = runComplexDiscoveryLedgerFixture();
    expect(() =>
      assertOrgScopedReview({
        organizationId: review.organizationId,
        foreignOrganizationId: "org-foreign",
      }),
    ).toThrow(/Cross-org/);
    expect(() =>
      assertMatterScopedLink({
        matterId: review.matterId,
        foreignMatterId: "matter-foreign",
        linkKind: "production",
      }),
    ).toThrow(/Cross-matter/);
    expect(() =>
      assertMatterScopedLink({
        matterId: review.matterId,
        foreignMatterId: review.matterId,
        linkKind: "production",
      }),
    ).not.toThrow();
  });

  it("handles 100+ request items without collapsing Ask answers", () => {
    const started = Date.now();
    const { review } = runLargeDiscoveryLedgerFixture(120);
    expect(review.items.length).toBeGreaterThanOrEqual(120);
    const unanswered = unansweredItems(review);
    expect(unanswered.length).toBeGreaterThan(0);
    const answer = formatDiscoveryAnswer(
      answerDiscoveryQuestion({
        review,
        question: "Which discovery requests are still unanswered?",
      }),
    );
    expect(answer).toContain("REQUEST_ITEMS:");
    expect(findDiscoveryLedgerViolations(answer)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
