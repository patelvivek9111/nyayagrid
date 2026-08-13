/** Shared attorney-facing review status. Proposed must never be treated as verified. */

export function isVerifiedReviewStatus(status: string): boolean {
  return status === "approved" || status === "edited_and_approved";
}

export type AttorneyBadgeKind = "verified" | "suggested" | "historical";

export function attorneyBadgeKind(status: string): AttorneyBadgeKind {
  if (isVerifiedReviewStatus(status)) return "verified";
  if (status === "proposed") return "suggested";
  return "historical";
}
