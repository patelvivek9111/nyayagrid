export type DiscoveryItemState = {
  id: string;
  reviewStatus: string;
  productionStatus: string;
  disclosureReviewStatus?: string | null;
  category: string;
  relatedEvidenceIds?: string[];
  relatedDocumentIds?: string[];
  receivedDate?: string | null;
  producedDate?: string | null;
};

export type DisclosureCandidateState = {
  id: string;
  category: string;
  status: string;
  origin:
    | "contradictory_evidence"
    | "witness_inconsistency"
    | "element_weakness"
    | "alternate_suspect"
    | "benefit_or_promise"
    | "prior_inconsistent_statement"
    | "other";
  notes?: string | null;
};

export type DiscoveryDashboard = {
  totalItems: number;
  unreviewed: number;
  flagged: number;
  potentialDisclosureReview: number;
  produced: number;
  pendingProduction: number;
  missingOrExpected: number;
  recentlyReceived: DiscoveryItemState[];
  legalConclusion: null;
};

export function buildDiscoveryDashboard(params: {
  items: DiscoveryItemState[];
  disclosureCandidates: DisclosureCandidateState[];
  now?: string;
}): DiscoveryDashboard {
  const items = params.items;
  return {
    totalItems: items.length,
    unreviewed: items.filter((item) => item.reviewStatus === "RECEIVED" || item.reviewStatus === "UNREVIEWED").length,
    flagged: items.filter((item) => item.reviewStatus === "FLAGGED").length,
    potentialDisclosureReview: params.disclosureCandidates.filter(
      (item) => item.status === "UNREVIEWED" || item.status === "REVIEW_REQUIRED",
    ).length,
    produced: items.filter((item) => item.productionStatus === "PRODUCED").length,
    pendingProduction: items.filter(
      (item) => item.productionStatus !== "PRODUCED" && item.reviewStatus !== "WITHHELD_FOR_ATTORNEY_REVIEW",
    ).length,
    missingOrExpected: items.filter((item) => item.category === "MISSING_EXPECTED" || item.reviewStatus === "UNKNOWN").length,
    recentlyReceived: [...items]
      .filter((item) => item.receivedDate)
      .sort((a, b) => (b.receivedDate ?? "").localeCompare(a.receivedDate ?? ""))
      .slice(0, 5),
    legalConclusion: null,
  };
}

export function suggestDisclosureCandidates(params: {
  contradictoryEvidenceIds: string[];
  witnessConflictKeys: string[];
  weakElementIds: string[];
}): Array<Omit<DisclosureCandidateState, "id" | "status"> & { status: "REVIEW_REQUIRED" }> {
  const out: Array<Omit<DisclosureCandidateState, "id" | "status"> & { status: "REVIEW_REQUIRED" }> = [];
  if (params.contradictoryEvidenceIds.length > 0) {
    out.push({
      category: "CONTRADICTORY_EVIDENCE",
      status: "REVIEW_REQUIRED",
      origin: "contradictory_evidence",
      notes: `Evidence ids: ${params.contradictoryEvidenceIds.join(", ")}`,
    });
  }
  if (params.witnessConflictKeys.length > 0) {
    out.push({
      category: "PRIOR_INCONSISTENT_STATEMENT",
      status: "REVIEW_REQUIRED",
      origin: "witness_inconsistency",
      notes: `Conflict keys: ${params.witnessConflictKeys.join(", ")}`,
    });
  }
  if (params.weakElementIds.length > 0) {
    out.push({
      category: "EVIDENCE_WEAKENING_ELEMENT",
      status: "REVIEW_REQUIRED",
      origin: "element_weakness",
      notes: `Element ids: ${params.weakElementIds.join(", ")}`,
    });
  }
  return out;
}
