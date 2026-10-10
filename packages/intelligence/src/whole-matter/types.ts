/**
 * Shared whole-matter intelligence contract (Deepening Pass 7).
 * Derived read model — no separate persistence / migration.
 */

export type EvidenceRelationKind = "SUPPORTS" | "CONTRADICTS" | "RELATED" | "UNKNOWN";

export type ContradictionKind = "DIRECT_CONFLICT" | "POTENTIAL_TENSION" | "DIFFERENT_SCOPE" | "UNKNOWN";

export type AuthorityResolutionBucket =
  | "IDENTITY_UNRESOLVED"
  | "AUTHORITY_RESOLVED"
  | "CORPUS_COMPLETE"
  | "TREATMENT_VERIFIED"
  | "TREATMENT_UNKNOWN";

export type MatterStatusFlag =
  | "CLAIMS_ACTIVE"
  | "DISCOVERY_OPEN"
  | "DEFICIENCIES_OUTSTANDING"
  | "MOTION_PENDING"
  | "MOTION_RULED"
  | "SUPPLEMENT_PROMISED"
  | "TASK_OVERDUE"
  | "AUTHORITY_UNRESOLVED"
  | "EVIDENCE_GAP"
  | "COMMUNICATION_FOLLOW_UP";

export type SourceRef = {
  kind:
    | "document"
    | "fact"
    | "evidence"
    | "claim"
    | "defense"
    | "discovery_deficiency"
    | "communication"
    | "motion"
    | "order"
    | "task"
    | "deadline"
    | "authority"
    | "timeline_event";
  id: string;
  label?: string | null;
};

export type ClaimCentricView = {
  claimId: string;
  label: string;
  kind: string;
  supportStatus: string;
  proceduralStatus: string;
  partyIds: string[];
  elementIds: string[];
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  relatedFactIds: string[];
  relatedDeficiencyIds: string[];
  relatedCommunicationIds: string[];
  relatedMotionIds: string[];
  relatedAuthorityIds: string[];
  relatedTaskIds: string[];
  relatedDeadlineIds: string[];
  openGaps: string[];
  /** Explicitly never means the claim is disposed. */
  wholeClaimDisposedByMotion: false;
};

export type DefenseCentricView = {
  defenseId: string;
  label: string;
  kind: string;
  supportStatus: string;
  againstClaimIds: string[];
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  relatedDeficiencyIds: string[];
  relatedMotionIds: string[];
  relatedAuthorityIds: string[];
  openGaps: string[];
  established: false;
};

export type DiscoveryChainView = {
  requestItemId: string | null;
  responseIds: string[];
  deficiencyId: string | null;
  meetAndConferId: string | null;
  communicationIds: string[];
  motionId: string | null;
  rulingDisposition: string | null;
  followUpTaskIds: string[];
  followUpDeadlineIds: string[];
  open: boolean;
};

export type MotionConvergenceView = {
  motionId: string;
  title: string;
  status: string;
  disposition: string | null;
  pending: boolean;
  relatedClaimIds: string[];
  relatedDefenseIds: string[];
  relatedDeficiencyIds: string[];
  relatedCommunicationIds: string[];
  relatedEvidenceIds: string[];
  documentRoles: string[];
  hearingAt: string | null;
  rulingAt: string | null;
  rulingSummary: string | null;
  relatedTaskIds: string[];
  relatedDeadlineIds: string[];
  /** Motion-claim link does not dispose the claim. */
  disposesEntireClaim: false;
};

export type FactEvidenceProposition = {
  id: string;
  kind: "fact" | "evidence" | "element_gap";
  label: string;
  supportingSourceIds: string[];
  contradictingSourceIds: string[];
  relationHints: EvidenceRelationKind[];
  relatedClaimIds: string[];
  relatedDefenseIds: string[];
  status: string;
};

export type ContradictionRecord = {
  id: string;
  kind: ContradictionKind;
  leftId: string;
  rightId: string;
  description: string;
  sources: SourceRef[];
  credibilityConclusion: null;
};

export type AuthorityContextItem = {
  id: string;
  citation: string | null;
  title: string | null;
  resolution: AuthorityResolutionBucket;
  treatmentVerified: boolean;
  relatedClaimIds: string[];
  relatedIssueIds: string[];
};

export type InvestigateNextItem = {
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  why: string;
  triggeredBy: SourceRef[];
  resolvesIf: string;
  predictiveOutcome: null;
};

export type WholeMatterStatus = {
  flags: MatterStatusFlag[];
  summaryLines: string[];
  liabilityConclusion: null;
  outcomeConclusion: null;
  predictiveOutcome: null;
};

export type WholeMatterIntelligence = {
  organizationId: string;
  matterId: string;
  assembledAt: string;
  status: WholeMatterStatus;
  parties: Array<{ id: string; displayName: string }>;
  claims: ClaimCentricView[];
  defenses: DefenseCentricView[];
  propositions: FactEvidenceProposition[];
  contradictions: ContradictionRecord[];
  discoveryChains: DiscoveryChainView[];
  openDeficiencyIds: string[];
  motions: MotionConvergenceView[];
  communications: Array<{
    id: string;
    subject: string;
    communicationType: string;
    occurredAt: string | null;
    relatedMotionIds: string[];
    relatedDeficiencyIds: string[];
    followUpDueAt: string | null;
  }>;
  tasks: Array<{ id: string; title: string; status: string; dueAt: string | null; overdue: boolean }>;
  deadlines: Array<{ id: string; title: string; dueAt: string | null; explicit: boolean; overdue: boolean }>;
  timeline: Array<{
    id: string;
    title: string;
    eventType: string;
    eventDate: string | null;
    dateKind: "event" | "filing" | "document" | "due" | "unknown";
  }>;
  authorities: AuthorityContextItem[];
  investigateNext: InvestigateNextItem[];
  limitations: string[];
  sourceRefs: SourceRef[];
  liabilityConclusion: null;
  outcomeConclusion: null;
  predictiveOutcome: null;
};
