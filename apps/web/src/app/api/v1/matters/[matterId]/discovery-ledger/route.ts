import {
  buildDiscoveryWholeMatterView,
  enrichLedgerWithBatesSignals,
  loadDiscoveryLedgerReview,
  objectionOnlyItems,
  openDeficiencies,
  unansweredItems,
} from "@nyayagrid/intelligence";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

/**
 * Production Discovery / Production Ledger overview.
 * Operational tracking only — does not decide sanctions, privilege, or legal deficiency.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });

    const review = enrichLedgerWithBatesSignals(
      await loadDiscoveryLedgerReview(db, {
        userId: user.id,
        organizationId: matter.organizationId,
        matterId,
      }),
    );
    const whole = buildDiscoveryWholeMatterView(review);

    return jsonOk({
      matterId,
      organizationId: matter.organizationId,
      parties: review.parties,
      requestSets: review.requestSets,
      items: review.items,
      responses: review.responses,
      objections: review.objections,
      productions: review.productions,
      deficiencies: review.deficiencies,
      privilegeAssertions: review.privilegeAssertions,
      meetAndConferIssues: review.meetAndConferIssues,
      motionLinks: review.motionLinks,
      batesSignals: review.batesSignals,
      unanswered: unansweredItems(review),
      objectionOnly: objectionOnlyItems(review),
      openDeficiencies: openDeficiencies(review),
      whole,
      coverageWarnings: review.coverageWarnings,
      sanctionsConclusion: null,
      privilegeLegalConclusion: null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
