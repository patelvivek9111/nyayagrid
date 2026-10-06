/** Turn stored keys into short labels a lawyer can read without guessing. */
const LABELS: Record<string, string> = {
  verified_context: "Confirmed fact",
  strategic_note: "Strategy note",
  entity_resolution: "Who this is",
  document_significance: "Why this file matters",
  factual_caveat: "Caution",
  user_instruction: "Your instruction",
  matter_preference: "Case preference",
  procedural_context: "Procedure",
  other: "Other",
  related_to: "Related to",
  works_for: "Works for",
  party_to: "Party to",
  signed: "Signed",
  sent: "Sent",
  received: "Received",
  attended: "Attended",
  mentioned_in: "Mentioned in",
  supports: "Supports",
  contradicts: "Conflicts with",
  occurred_before: "Occurred before",
  occurred_after: "Occurred after",
  represents: "Represents",
  assigned_to: "Assigned to",
  alleges: "Alleges",
  paid: "Paid",
  owns: "Owns",
  communicates_with: "Communicates with",
  supported_by: "Supported by",
  participated_in: "Participated in",
  contains_fact: "Contains fact",
  party: "Party",
  counsel: "Counsel",
  witness: "Witness",
  matter_entity: "Person or organization",
  timeline_event: "Event",
  matter_fact: "Fact",
  manual_note: "Note",
  communication: "Communication",
  communications: "Communications",
  deadline: "Deadline",
  meeting: "Meeting",
  testimony: "Testimony",
  person: "Person",
  organization: "Organization",
  event: "Event",
  fact: "Fact",
  client: "Client",
  matter: "Case",
  exact: "Exact date",
  approximate: "Approximate date",
  unknown: "Date unknown",
  range: "Date range",
  document: "Document",
  task: "Task",
  deadline_candidate: "Deadline",
  low: "Low",
  normal: "Normal",
  high: "High",
  critical: "Critical",
  uploaded: "Uploaded",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
  proposed: "Suggested",
  approved: "Confirmed",
  edited_and_approved: "Edited and confirmed",
  rejected: "Rejected",
  superseded: "Replaced",
  archived: "Archived",
  open: "Open",
  in_progress: "In progress",
  completed: "Done",
  awaiting_approval: "Needs your OK",
  planned: "Queued",
  running: "Working",
  draft: "Draft",
  in_review: "In review",
  individual: "Individual",
  active: "Active",
  posted: "Posted",
  issued: "Issued",
  void: "Void",
  pending: "Pending",
  filed: "Filed",
  discarded: "Discarded",
  released: "Released",
  owner: "Firm owner",
  lawyer: "Lawyer",
  staff: "Staff",
  client_guest: "Client guest",
  suggested: "Suggested",
  manual: "Entered by you",
  verified_deadline: "Verified",
  controlling: "Controlling",
  persuasive: "Persuasive",
  out_of_jurisdiction: "Other jurisdiction",
  // Evidence / charge-element statuses (uppercase enums from intelligence)
  SUPPORTED: "Supported",
  PARTIALLY_SUPPORTED: "Partially supported",
  CONFLICTED: "Conflicted",
  NO_EVIDENCE_FOUND: "No evidence found",
  UNKNOWN: "Unknown",
  REVIEW_REQUIRED: "Review required",
  UNREVIEWED: "Unreviewed",
  REVIEWED_DISCLOSE: "Reviewed — disclose",
  REVIEWED_NOT_DISCLOSE: "Reviewed — do not disclose",
  RECEIVED: "Received",
  FLAGGED: "Flagged",
  PRODUCED: "Produced",
  PENDING: "Pending",
  WITHHELD_FOR_ATTORNEY_REVIEW: "Withheld for attorney review",
  MISSING_EXPECTED: "Missing / expected",
  STANDARD_NOT_EXTRACTED: "Legal standard not extracted",
  // Coverage / retrieval warning codes
  NO_BINDING_AUTHORITY_FOUND: "No binding authority found for this issue",
  CURRENTNESS_UNCERTAIN: "Currentness of this authority is uncertain",
  MISSING_DOCUMENT: "A referenced document is missing",
  MISSING_EVIDENCE: "Evidence needed for this issue is missing",
  TREATMENT_UNVERIFIED: "Treatment status has not been verified",
  CONTEXT_LIMIT_REACHED: "Context limit reached — review may be incomplete",
  SOURCE_UNAVAILABLE: "Source is unavailable",
  PARTIAL_ANSWER: "Partial answer — verify before relying on it",
  // Prosecution case statuses
  investigation: "Investigation",
  charged: "Charged",
  pretrial: "Pretrial",
  trial: "Trial",
  post_disposition: "Post-disposition",
  closed: "Closed",
  open_case: "Open",
};

/** Prefer mapped labels; otherwise title-case spaced tokens (never leak SCREAMING_SNAKE). */
export function humanizeKey(value: string | null | undefined): string {
  if (!value) return "";
  const mapped = LABELS[value] ?? LABELS[value.toLowerCase()] ?? LABELS[value.toUpperCase()];
  if (mapped) return mapped;
  const spaced = value.replace(/[_-]+/g, " ").trim();
  if (!spaced) return "";
  // Title-case for all-caps enums; leave mixed-case mostly intact with spaces.
  if (/^[A-Z0-9_ -]+$/.test(value)) {
    return spaced
      .toLowerCase()
      .split(/\s+/)
      .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
      .join(" ");
  }
  return spaced;
}

/** User-facing coverage / warning copy for research and Ask Nyaya surfaces. */
export function formatCoverageWarning(code: string | null | undefined): string {
  if (!code) return "";
  const mapped = LABELS[code] ?? LABELS[code.toUpperCase()];
  if (mapped) return mapped;
  return humanizeKey(code);
}
