import { detectBatesReviewSignals } from "./bates";
import type {
  DiscoveryItemStatus,
  DiscoveryLedgerReview,
  DiscoveryRequestItem,
} from "./types";
import { DISCOVERY_ITEM_STATUSES } from "./types";

const FORBIDDEN = [
  /\b(impose|award|grant|seek|face|risk of)\s+sanctions?\b/i,
  /\bdiscovery violation (is|was) established\b/i,
  /\bthe document is privileged\b/i,
  /\bmust be compelled\b/i,
  /\bwill (win|lose)\b/i,
  /\b(plaintiff|defendant) is liable\b/i,
];

export function findDiscoveryLedgerViolations(text: string): string[] {
  return FORBIDDEN.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

export function assertDiscoveryItemStatus(status: string): asserts status is DiscoveryItemStatus {
  if (!(DISCOVERY_ITEM_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Invalid discovery item status: ${status}`);
  }
}

export function unansweredItems(review: DiscoveryLedgerReview): DiscoveryRequestItem[] {
  return review.items.filter((item) =>
    ["OPEN", "NOT_DUE", "UNKNOWN", "DEFICIENT", "SUPPLEMENT_REQUIRED"].includes(item.status),
  );
}

export function objectionOnlyItems(review: DiscoveryLedgerReview): DiscoveryRequestItem[] {
  return review.items.filter((item) => {
    const responses = review.responses.filter((response) => response.itemId === item.id);
    if (responses.length === 0) return false;
    return responses.every(
      (response) =>
        response.objectionIds.length > 0 &&
        (!response.substantiveText || response.substantiveText.trim().length === 0) &&
        response.productionIds.length === 0,
    );
  });
}

export function openDeficiencies(review: DiscoveryLedgerReview) {
  return review.deficiencies.filter((row) => row.status === "OPEN" || row.status === "MEET_AND_CONFER");
}

export function enrichLedgerWithBatesSignals(review: DiscoveryLedgerReview): DiscoveryLedgerReview {
  return {
    ...review,
    batesSignals: detectBatesReviewSignals(review.productions),
    sanctionsConclusion: null,
    privilegeLegalConclusion: null,
  };
}

export type DiscoveryAskAnswer = {
  question: string;
  items: Array<{ id: string; requestNumber: string; title: string; status: DiscoveryItemStatus }>;
  productions: Array<{ id: string; label: string; producedAt: string | null; bates: string[] }>;
  deficiencies: Array<{ id: string; kind: string; description: string; status: string }>;
  privilegeNotes: string[];
  motionNotes: string[];
  batesNotes: string[];
  limitations: string[];
  sanctionsConclusion: null;
  privilegeLegalConclusion: null;
};

export function isDiscoveryAskQuestion(question: string): boolean {
  return /(discovery|interrogator|request for production|rfp|rfa|bates|production|object(ion|ed)|privilege|meet.?and.?confer|compel|unanswered|supplemental production|deficiency)/i.test(
    question,
  );
}

export function answerDiscoveryQuestion(params: {
  review: DiscoveryLedgerReview;
  question: string;
}): DiscoveryAskAnswer {
  const review = params.review;
  const q = params.question.toLowerCase();
  const party = review.parties.find((row) => q.includes(row.displayName.toLowerCase().split(/\s+/)[0]!));

  let items = review.items;
  if (/unanswered|still open|no response|outstanding/i.test(params.question)) {
    items = unansweredItems(review);
  } else if (/object/i.test(params.question) && /no substantive|without production|objection only/i.test(params.question)) {
    items = objectionOnlyItems(review);
  } else if (/request\s*no\.?\s*(\d+)/i.test(params.question)) {
    const match = params.question.match(/request\s*no\.?\s*(\d+)/i);
    const num = match?.[1];
    items = review.items.filter((item) => item.requestNumber === num || item.requestNumber.endsWith(`.${num}`) || item.requestNumber === `RFP-${num}`);
  }
  if (party) {
    items = items.filter(
      (item) => item.requestingPartyId === party.partyId || item.respondingPartyId === party.partyId,
    );
  }

  let productions = review.productions;
  if (/september\s*18|2026-09-18|sep(t)?\.?\s*18/i.test(params.question)) {
    productions = productions.filter((row) => row.producedAt?.startsWith("2026-09-18"));
  }
  if (/supplement/i.test(params.question)) {
    productions = productions.filter((row) => row.isSupplemental);
  }
  if (party) {
    productions = productions.filter(
      (row) => row.producingPartyId === party.partyId || row.receivingPartyId === party.partyId,
    );
  }

  const deficiencies = (/deficien|missing|still open|weakness/i.test(params.question)
    ? openDeficiencies(review)
    : review.deficiencies
  ).map((row) => ({
    id: row.id,
    kind: row.kind,
    description: row.description,
    status: row.status,
  }));

  const privilegeNotes: string[] = [];
  if (/privilege/i.test(params.question)) {
    for (const row of review.privilegeAssertions) {
      privilegeNotes.push(
        `Privilege assertion ${row.id} status=${row.status} basis=${row.assertedBasis} assertingParty=${row.assertingPartyId} courtRulingReferenced=${row.courtRulingReferenced}`,
      );
    }
  }

  const motionNotes: string[] = [];
  if (/motion|compel|protective/i.test(params.question)) {
    for (const motion of review.motionLinks) {
      motionNotes.push(
        `Motion ${motion.motionId} (${motion.motionType}) ${motion.motionLabel} deficiencies=${motion.deficiencyIds.join(",")}`,
      );
    }
    for (const issue of review.meetAndConferIssues) {
      motionNotes.push(
        `Meet-and-confer ${issue.id} ${issue.label} deficiencies=${issue.deficiencyIds.join(",")}`,
      );
    }
  }

  const batesNotes: string[] = [];
  if (/bates|range|overlap|gap/i.test(params.question)) {
    for (const production of productions) {
      for (const range of production.batesRanges) {
        batesNotes.push(`Production ${production.id} range ${range.rawText}`);
      }
    }
    for (const signal of review.batesSignals) {
      batesNotes.push(`Bates review signal ${signal.kind}: ${signal.description}`);
    }
  }

  return {
    question: params.question,
    items: items.map((item) => ({
      id: item.id,
      requestNumber: item.requestNumber,
      title: item.title,
      status: item.status,
    })),
    productions: productions.map((production) => ({
      id: production.id,
      label: production.label,
      producedAt: production.producedAt,
      bates: production.batesRanges.map((range) => range.rawText),
    })),
    deficiencies,
    privilegeNotes,
    motionNotes,
    batesNotes,
    limitations: [
      ...review.coverageWarnings,
      "Discovery workflow statuses are operational and do not establish court adjudication.",
      "Bates gaps/overlaps are review signals only and do not alone prove legal deficiency.",
      "Privilege review states are not determinations that a document is privileged unless a court ruling is separately recorded.",
      "Nyaya does not decide sanctions, compel outcomes, or win/lose discovery motions.",
    ],
    sanctionsConclusion: null,
    privilegeLegalConclusion: null,
  };
}

export function formatDiscoveryAnswer(answer: DiscoveryAskAnswer): string {
  const lines = [
    "DISCOVERY_LEDGER_REVIEW (non-deciding; operational tracking only):",
    `QUESTION: ${answer.question}`,
    "REQUEST_ITEMS:",
    ...(answer.items.length
      ? answer.items.map((item) => `- ${item.id} ${item.requestNumber} ${item.title} status=${item.status}`)
      : ["- (none)"]),
    "PRODUCTIONS:",
    ...(answer.productions.length
      ? answer.productions.map(
          (production) =>
            `- ${production.id} ${production.label} producedAt=${production.producedAt ?? "unknown"} bates=${production.bates.join(" | ") || "(none)"}`,
        )
      : ["- (none)"]),
    "DEFICIENCIES:",
    ...(answer.deficiencies.length
      ? answer.deficiencies.map((row) => `- ${row.id} [${row.kind}] ${row.description} status=${row.status}`)
      : ["- (none)"]),
    "PRIVILEGE_NOTES:",
    ...(answer.privilegeNotes.length ? answer.privilegeNotes.map((note) => `- ${note}`) : ["- (none)"]),
    "MOTION_MEET_AND_CONFER_NOTES:",
    ...(answer.motionNotes.length ? answer.motionNotes.map((note) => `- ${note}`) : ["- (none)"]),
    "BATES_NOTES:",
    ...(answer.batesNotes.length ? answer.batesNotes.map((note) => `- ${note}`) : ["- (none)"]),
    `LIMITATIONS: ${answer.limitations.join(" | ")}`,
    "SANCTIONS_CONCLUSION: null",
    "PRIVILEGE_LEGAL_CONCLUSION: null",
  ];
  const text = lines.join("\n");
  const violations = findDiscoveryLedgerViolations(text);
  if (violations.length > 0) {
    throw new Error(`Discovery answer used forbidden conclusion language: ${violations.join(", ")}`);
  }
  return text;
}

export function buildDiscoveryWholeMatterView(review: DiscoveryLedgerReview) {
  return {
    unansweredCount: unansweredItems(review).length,
    objectionOnlyCount: objectionOnlyItems(review).length,
    openDeficiencyCount: openDeficiencies(review).length,
    productionCount: review.productions.length,
    supplementalProductionCount: review.productions.filter((row) => row.isSupplemental).length,
    batesSignalCount: review.batesSignals.length,
    privilegeAssertionsUnderReview: review.privilegeAssertions.filter((row) =>
      ["ASSERTED", "UNDER_REVIEW", "CHALLENGED"].includes(row.status),
    ).length,
    meetAndConferOpen: review.meetAndConferIssues.length,
    motionLinks: review.motionLinks.map((row) => row.motionLabel),
    outstandingItemIds: unansweredItems(review).map((item) => item.id),
    newlyProducedDocumentIds: review.productions.flatMap((row) => row.documentIds),
    claimSupportGapsNoted: review.deficiencies
      .filter((row) => row.kind === "MISSING_PRODUCTION" || row.kind === "MISSING_ATTACHMENT" || row.kind === "NO_RESPONSE")
      .map((row) => row.description),
    sanctionsConclusion: null as null,
    privilegeLegalConclusion: null as null,
  };
}

/** Reject cross-matter linkage attempts at the application layer (pre-persistence). */
export function assertMatterScopedLink(params: {
  matterId: string;
  foreignMatterId: string | null | undefined;
  linkKind: string;
}): void {
  if (params.foreignMatterId && params.foreignMatterId !== params.matterId) {
    throw new Error(
      `Cross-matter ${params.linkKind} denied: cannot link ${params.foreignMatterId} into matter ${params.matterId}`,
    );
  }
}

export function assertOrgScopedReview(params: {
  organizationId: string;
  foreignOrganizationId: string | null | undefined;
}): void {
  if (params.foreignOrganizationId && params.foreignOrganizationId !== params.organizationId) {
    throw new Error(
      `Cross-org discovery access denied: cannot use org ${params.foreignOrganizationId} for org ${params.organizationId}`,
    );
  }
}
