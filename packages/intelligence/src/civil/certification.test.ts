/**
 * Civil claims schema coordination certification gates.
 * Rollback: apply packages/database/drizzle/0020_civil_claims.down.sql on local/test DBs only.
 * Production Neon must not receive this migration without separate authorization.
 */

import { describe, expect, it } from "vitest";
import {
  CIVIL_ELEMENT_STATUSES,
  buildCivilClaimMatrix,
  buildCivilWholeMatterView,
  runComplexCivilClaimsFixture,
} from "./index";

describe("civil claims schema certification", () => {
  it("certifies non-deciding statuses and D3 reconstruction contract", () => {
    expect(CIVIL_ELEMENT_STATUSES).not.toEqual(expect.arrayContaining(["WIN", "LOSE", "LIABLE"]));
    const { review, matrix, whole } = runComplexCivilClaimsFixture();
    expect(review.liabilityConclusion).toBeNull();
    expect(buildCivilClaimMatrix(review)).toHaveLength(matrix.length);
    expect(buildCivilWholeMatterView(review).liabilityConclusion).toBeNull();
    expect(whole.outcomeConclusion).toBeNull();
  });
});
