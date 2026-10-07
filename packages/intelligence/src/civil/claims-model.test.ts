import { describe, expect, it } from "vitest";
import { runComplexCivilClaimsFixture } from "./claims-fixtures";
import {
  answerCivilClaimsQuestion,
  assertCivilElementStatus,
  buildCivilClaimMatrix,
  buildCivilWholeMatterView,
  checkCivilClaimsConsistency,
  evidenceRelationsForParty,
  findCivilLiabilityViolations,
  formatCivilClaimsAnswer,
  isCivilClaimsAskQuestion,
} from "./claims-model";

describe("civil claims application-layer model (Pass 3)", () => {
  const { review, matrix, whole, askText } = runComplexCivilClaimsFixture();

  it("builds a multi-claim fixture with counterclaim, defenses, parties, and amendment", () => {
    expect(review.parties.length).toBeGreaterThanOrEqual(3);
    expect(review.claims.filter((claim) => claim.isCurrent && claim.kind === "CLAIM").length).toBeGreaterThanOrEqual(2);
    expect(review.claims.some((claim) => claim.kind === "COUNTERCLAIM" && claim.isCurrent)).toBe(true);
    expect(review.defenses.filter((defense) => defense.kind === "AFFIRMATIVE").length).toBeGreaterThanOrEqual(1);
    expect(review.defenses.filter((defense) => defense.kind === "ELEMENT_NEGATING").length).toBeGreaterThanOrEqual(1);
    expect(review.pleadings.some((pleading) => pleading.isCurrent && /amended/i.test(pleading.label))).toBe(true);
    expect(review.liabilityConclusion).toBeNull();
    expect(review.outcomeConclusion).toBeNull();
  });

  it("keeps claim matrix rows separated by claim, element, defense, and counterclaim", () => {
    const claimRows = matrix.filter((row) => row.rowKind === "claim" && row.isCurrent);
    const defenseRows = matrix.filter((row) => row.rowKind === "defense");
    const counterRows = matrix.filter((row) => row.rowKind === "counterclaim");
    expect(new Set(claimRows.map((row) => row.parentId)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(claimRows.map((row) => row.elementId)).size).toBeGreaterThanOrEqual(3);
    expect(defenseRows.length).toBeGreaterThanOrEqual(3);
    expect(counterRows.length).toBeGreaterThanOrEqual(1);
    const breach = claimRows.find((row) => row.elementId === "el-breach-breach");
    expect(breach?.supportingEvidenceIds).toContain("ev-notice");
    expect(breach?.contraryEvidenceIds).toContain("ev-log");
    expect(breach?.missingEvidence.some((item) => item.id === "missing-delivery")).toBe(true);
    const dutyAuthorities = claimRows.find((row) => row.elementId === "el-breach-duty")?.bindingAuthorities.length ?? 0;
    expect((breach?.bindingAuthorities.length ?? 0) + dutyAuthorities).toBeGreaterThan(0);
  });

  it("preserves whole-matter claim-specific reasoning without liability", () => {
    expect(whole.currentClaims.map((claim) => claim.id)).toEqual(expect.arrayContaining(["claim-breach", "claim-unfair-trade"]));
    expect(whole.currentClaims.map((claim) => claim.id)).not.toContain("claim-negligent-misrep");
    expect(whole.currentClaims.map((claim) => claim.id)).not.toContain("claim-breach-v1");
    expect(whole.supersededClaims.map((claim) => claim.id)).toEqual(
      expect.arrayContaining(["claim-breach-v1", "claim-negligent-misrep"]),
    );
    expect(whole.counterclaims.map((claim) => claim.id)).toContain("claim-counter-invoice");
    expect(whole.defenses.map((defense) => defense.id)).toEqual(
      expect.arrayContaining(["def-no-breach", "def-waiver", "def-notice"]),
    );
    expect(whole.liabilityConclusion).toBeNull();
    expect(whole.outcomeConclusion).toBeNull();
    expect(findCivilLiabilityViolations(JSON.stringify(whole))).toEqual([]);
  });

  it("marks amended pleading changes: remove, add, and update without dual-current pleadings", () => {
    const currentPleadings = review.pleadings.filter((pleading) => pleading.isCurrent && /complaint/i.test(pleading.label));
    expect(currentPleadings).toHaveLength(1);
    expect(currentPleadings[0]?.id).toBe("plead-amended");
    expect(review.pleadings.find((pleading) => pleading.id === "plead-complaint")?.isCurrent).toBe(false);
    expect(review.claims.find((claim) => claim.id === "claim-negligent-misrep")?.isCurrent).toBe(false);
    expect(review.claims.find((claim) => claim.id === "claim-negligent-misrep")?.proceduralStatus).toBe("WITHDRAWN");
    expect(review.claims.find((claim) => claim.id === "claim-unfair-trade")?.isCurrent).toBe(true);
    expect(review.claims.find((claim) => claim.id === "claim-breach")?.supersedesClaimId).toBe("claim-breach-v1");
    expect(review.claims.find((claim) => claim.id === "claim-breach-v1")?.provenance.documentId).toBe("doc-complaint");
  });

  it("allows one evidence item to play different roles across claim and defense without duplicating the evidence record", () => {
    const noticeEvidence = review.evidence.filter((item) => item.id === "ev-notice");
    expect(noticeEvidence).toHaveLength(1);
    const roles = whole.sharedEvidenceRoles.find((row) => row.evidenceId === "ev-notice")?.roles ?? [];
    const roleTargets = new Set(roles.map((role) => `${role.role}@${role.targetId}`));
    expect(roleTargets.size).toBeGreaterThanOrEqual(2);
    expect(roles.some((role) => role.role === "SUPPORTS")).toBe(true);
    expect(roles.some((role) => role.role === "UNDERMINES" || role.role === "CONTRADICTS")).toBe(true);
  });

  it("keeps defendant-specific evidence from auto-supporting another defendant", () => {
    const betaElement = review.claims
      .find((claim) => claim.id === "claim-unfair-trade")
      ?.elements.find((element) => element.id === "el-utp-beta-only");
    expect(betaElement).toBeTruthy();
    const forAcme = evidenceRelationsForParty(betaElement!.supportingEvidence, "party-acme");
    const forBeta = evidenceRelationsForParty(betaElement!.supportingEvidence, "party-beta");
    expect(forAcme).toHaveLength(0);
    expect(forBeta.map((relation) => relation.evidenceId)).toContain("ev-beta-email");
    const shared = review.claims
      .find((claim) => claim.id === "claim-unfair-trade")
      ?.elements.find((element) => element.id === "el-utp-conduct");
    expect(evidenceRelationsForParty(shared!.supportingEvidence, "party-acme").length).toBeGreaterThan(0);
    expect(evidenceRelationsForParty(shared!.supportingEvidence, "party-beta").length).toBeGreaterThan(0);
  });

  it("answers Ask Nyaya claim questions without liability conclusions", () => {
    expect(isCivilClaimsAskQuestion("What claims are currently pleaded?")).toBe(true);
    expect(isCivilClaimsAskQuestion("What witnesses contradict each other?")).toBe(false);
    expect(askText).toContain("CLAIMS:");
    expect(askText).toContain("LIABILITY_CONCLUSION: null");
    expect(askText).toContain("OUTCOME_CONCLUSION: null");
    expect(askText).toMatch(/claim-breach/);
    expect(askText).not.toMatch(/claim-negligent-misrep.*current=true/);
    const amendment = formatCivilClaimsAnswer(
      answerCivilClaimsQuestion({
        review,
        question: "What changed between the complaint and amended complaint?",
      }),
    );
    expect(amendment).toMatch(/not current|SUPERSEDED|WITHDRAWN/i);
    expect(amendment).toContain("LIABILITY_CONCLUSION: null");
    const notice = formatCivilClaimsAnswer(
      answerCivilClaimsQuestion({
        review,
        question: "What evidence supports the notice defense?",
      }),
    );
    expect(notice).toMatch(/ev-log|Notice defense/);
  });

  it("rejects decisive element statuses and stays consistent across views", () => {
    expect(() => assertCivilElementStatus("LIABLE")).toThrow(/Decisive|Forbidden/);
    expect(() => assertCivilElementStatus("SUPPORTED")).not.toThrow();
    const consistency = checkCivilClaimsConsistency({
      review,
      matrix: buildCivilClaimMatrix(review),
      whole: buildCivilWholeMatterView(review),
    });
    expect(consistency.consistent).toBe(true);
  });
});
