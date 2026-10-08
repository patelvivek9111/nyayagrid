import {
  buildCivilClaimMatrix,
  buildCivilClaimStrengthAnalysis,
  buildCivilWholeMatterView,
  checkCivilClaimsConsistency,
  loadCivilClaimsReview,
} from "@nyayagrid/intelligence";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

/**
 * Production civil claims overview for the Claim Matrix and related panels.
 * Defaults to current pleadings/claims while retaining historical rows in the review.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const url = new URL(request.url);
    const includeHistory = url.searchParams.get("history") === "1";
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });

    const review = await loadCivilClaimsReview(db, {
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
    });

    const matrix = buildCivilClaimMatrix(review).filter((row) => includeHistory || row.isCurrent);
    const whole = buildCivilWholeMatterView(review);
    const consistency = checkCivilClaimsConsistency({ review, matrix: buildCivilClaimMatrix(review), whole });
    const strength = review.claims
      .filter((claim) => includeHistory || claim.isCurrent)
      .map((claim) => buildCivilClaimStrengthAnalysis(claim));

    const pleadings = includeHistory
      ? review.pleadings
      : review.pleadings.filter((pleading) => pleading.isCurrent);
    const claims = includeHistory ? review.claims : review.claims.filter((claim) => claim.isCurrent);
    const defenses = includeHistory
      ? review.defenses
      : review.defenses.filter((defense) => defense.isCurrent);

    return jsonOk({
      matterId,
      organizationId: matter.organizationId,
      jurisdiction: review.jurisdiction,
      forumCourtId: review.forumCourtId,
      parties: review.parties,
      pleadings,
      pleadingHistory: review.pleadings,
      claims,
      defenses,
      counterclaims: claims.filter((claim) => claim.kind === "COUNTERCLAIM"),
      evidence: review.evidence,
      facts: review.facts,
      legalIssues: review.legalIssues,
      matrix,
      whole,
      strength,
      consistency,
      coverageWarnings: review.coverageWarnings,
      liabilityConclusion: null,
      outcomeConclusion: null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
