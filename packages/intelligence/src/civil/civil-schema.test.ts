import { describe, expect, it } from "vitest";
import {
  CIVIL_CLAIM_KINDS,
  CIVIL_ELEMENT_STATUSES,
  CIVIL_PARTY_ROLES,
  CIVIL_PROCEDURAL_STATUSES,
  assertCivilElementStatus,
  buildCivilClaimMatrix,
  buildCivilWholeMatterView,
  runComplexCivilClaimsFixture,
} from "./index";

describe("civil claims schema contract", () => {
  it("exposes non-deciding support and procedural statuses only", () => {
    expect(CIVIL_ELEMENT_STATUSES).toEqual([
      "SUPPORTED",
      "PARTIALLY_SUPPORTED",
      "CONFLICTED",
      "NO_EVIDENCE_FOUND",
      "UNKNOWN",
    ]);
    for (const forbidden of ["WIN", "LOSE", "LIABLE", "NOT_LIABLE", "LIKELY_WIN"]) {
      expect(CIVIL_ELEMENT_STATUSES).not.toContain(forbidden);
    }
    expect(CIVIL_PROCEDURAL_STATUSES).toContain("SUPERSEDED");
    expect(CIVIL_PROCEDURAL_STATUSES).toContain("AMENDED");
    expect(CIVIL_CLAIM_KINDS).toContain("COUNTERCLAIM");
    expect(CIVIL_CLAIM_KINDS).toContain("CROSSCLAIM");
    expect(CIVIL_PARTY_ROLES).toEqual(
      expect.arrayContaining([
        "PLAINTIFF",
        "DEFENDANT",
        "COUNTERCLAIMANT",
        "COUNTERCLAIM_DEFENDANT",
        "THIRD_PARTY_PLAINTIFF",
        "THIRD_PARTY_DEFENDANT",
        "OTHER",
      ]),
    );
  });

  it("rejects decisive statuses", () => {
    expect(() => assertCivilElementStatus("LIABLE")).toThrow();
    expect(() => assertCivilElementStatus("WIN")).toThrow();
  });

  it("keeps D3 prototype semantics without liability conclusions", () => {
    const { review, matrix, whole } = runComplexCivilClaimsFixture();
    expect(review.liabilityConclusion).toBeNull();
    expect(whole.liabilityConclusion).toBeNull();
    expect(buildCivilClaimMatrix(review).length).toBe(matrix.length);
    expect(buildCivilWholeMatterView(review).currentClaims.length).toBe(whole.currentClaims.length);
    expect(matrix.every((row) => !/LIABLE|WIN|LOSE/i.test(row.supportStatus))).toBe(true);
  });
});
