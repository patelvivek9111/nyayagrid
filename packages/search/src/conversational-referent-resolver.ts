/**
 * Phase 3 — Deterministic conversational referent resolution + active entity binding.
 * Prefer structured working state / prior payload over fuzzy prose. No schema migration.
 */
import { and, asc, eq } from "drizzle-orm";
import {
  civilClaims,
  discoveryDeficiencies,
  documents,
  matterCommunications,
  matterMotions,
  type Database,
} from "@nyayagrid/database";
import type { ConversationalDomain } from "./conversational-context-router";
import {
  emptyWorkingState,
  type ConversationTurnForPrompt,
  type ConversationWorkingState,
} from "./conversation-context";

export const REFERENT_ENTITY_TYPES = [
  "claim",
  "defense",
  "element",
  "fact",
  "evidence",
  "document",
  "discovery_item",
  "discovery_deficiency",
  "communication",
  "motion",
  "ruling",
  "task",
  "deadline",
  "authority",
  "timeline_event",
  "person",
  "issue",
  "draft",
] as const;
export type ReferentEntityType = (typeof REFERENT_ENTITY_TYPES)[number];

export const RESOLUTION_METHODS = [
  "EXPLICIT_ID",
  "EXPLICIT_LABEL",
  "ACTIVE_CONTEXT",
  "PRIOR_STRUCTURED_TURN",
  "RECENT_ENTITY_REFERENCE",
  "UNIQUE_MATTER_MATCH",
  "MODEL_DISAMBIGUATED",
  "AMBIGUOUS",
  "UNRESOLVED",
] as const;
export type ResolutionMethod = (typeof RESOLUTION_METHODS)[number];

export type MatterEntityCandidate = {
  entityType: ReferentEntityType;
  entityId: string;
  label: string;
  organizationId: string;
  matterId: string;
  /** Optional ordering key (ISO date or sequence). */
  orderKey?: string | null;
  linkedIds?: Partial<Record<ReferentEntityType, string[]>>;
};

export type PriorStructuredPayload = {
  sourceRefs?: string[];
  authorityRefs?: string[];
  activeEntityRefs?: string[];
  selectedDomains?: string[];
  assertionTexts?: string[];
  messageId?: string | null;
};

export type ResolvedReferent = {
  entityType: ReferentEntityType;
  entityId: string | null;
  label: string;
  matterId: string;
  organizationId: string;
  resolutionMethod: ResolutionMethod;
  sourceMessageId: string | null;
  confidenceCategory: "deterministic" | "unique_match" | "ambiguous" | "unresolved";
  ambiguityStatus: "NONE" | "AMBIGUOUS" | "UNRESOLVED";
};

export type ReferentDiagnostics = {
  referentRequested: boolean;
  referentType: ReferentEntityType | "mixed" | null;
  resolutionMethod: ResolutionMethod | null;
  candidateCount: number;
  resolvedEntityId: string | null;
  ambiguity: boolean;
  activeContextBefore: Record<string, string[]>;
  activeContextAfter: Record<string, string[]>;
  routerDomainsAfterResolution: ConversationalDomain[];
  resolverLatencyMs: number;
  /** Optional DB candidate lookup latency (Ask path). */
  candidateLookupLatencyMs?: number;
};

export type ReferentResolutionResult = {
  referentRequested: boolean;
  status: "RESOLVED" | "AMBIGUOUS" | "UNRESOLVED" | "NOT_APPLICABLE";
  referents: ResolvedReferent[];
  candidates: Array<{ entityType: ReferentEntityType; entityId: string; label: string }>;
  userClarificationNeeded: boolean;
  clarificationPrompt: string | null;
  /** Question used for routing after binding (may append compact entity hints). */
  routingQuestion: string;
  forceDomains: ConversationalDomain[];
  activeStateAfter: ConversationWorkingState;
  diagnostics: ReferentDiagnostics;
  draftIntentPreview: { requested: boolean; targetLabel: string | null } | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACTIVE_BUCKET_CAPS: Record<keyof Pick<
  ConversationWorkingState,
  | "activeClaimIds"
  | "activeDefenseIds"
  | "activeMotionIds"
  | "activeDiscoveryIds"
  | "activeDeficiencyIds"
  | "activeCommunicationIds"
  | "activeAuthorityIds"
  | "activeSourceIds"
  | "activeTaskIds"
>, number> = {
  activeClaimIds: 3,
  activeDefenseIds: 3,
  activeMotionIds: 3,
  activeDiscoveryIds: 4,
  activeDeficiencyIds: 4,
  activeCommunicationIds: 4,
  activeAuthorityIds: 3,
  activeSourceIds: 8,
  activeTaskIds: 3,
};

function uniq(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^\w\s./-]+/g, " ").replace(/\s+/g, " ").trim();
}

function activeSnapshot(state: ConversationWorkingState): Record<string, string[]> {
  return {
    claims: [...state.activeClaimIds],
    defenses: [...state.activeDefenseIds],
    motions: [...state.activeMotionIds],
    discovery: [...state.activeDiscoveryIds],
    deficiencies: [...state.activeDeficiencyIds],
    communications: [...state.activeCommunicationIds],
    authorities: [...state.activeAuthorityIds],
    sources: [...state.activeSourceIds],
    tasks: [...state.activeTaskIds],
  };
}

function domainForType(type: ReferentEntityType): ConversationalDomain | null {
  switch (type) {
    case "claim":
    case "defense":
    case "element":
    case "evidence":
    case "fact":
      return "CLAIMS";
    case "discovery_item":
    case "discovery_deficiency":
      return "DISCOVERY";
    case "communication":
      return "COMMUNICATIONS";
    case "motion":
    case "ruling":
      return "MOTIONS";
    case "timeline_event":
      return "TIMELINE";
    case "task":
    case "deadline":
      return "TASKS";
    case "authority":
      return "AUTHORITIES";
    case "document":
      return "EVIDENCE";
    case "draft":
      return "DRAFT";
    case "person":
      return "EVIDENCE";
    default:
      return null;
  }
}

function bucketForType(
  type: ReferentEntityType,
): keyof typeof ACTIVE_BUCKET_CAPS | null {
  switch (type) {
    case "claim":
      return "activeClaimIds";
    case "defense":
      return "activeDefenseIds";
    case "motion":
    case "ruling":
      return "activeMotionIds";
    case "discovery_item":
      return "activeDiscoveryIds";
    case "discovery_deficiency":
      return "activeDeficiencyIds";
    case "communication":
      return "activeCommunicationIds";
    case "authority":
      return "activeAuthorityIds";
    case "document":
    case "evidence":
      return "activeSourceIds";
    case "task":
    case "deadline":
      return "activeTaskIds";
    default:
      return null;
  }
}

/** Detect whether the question is a follow-up / demonstrative / ordinal referent. */
export function detectReferentRequest(question: string): {
  requested: boolean;
  kinds: string[];
} {
  const q = question.trim();
  if (!q) return { requested: false, kinds: [] };
  const kinds: string[] = [];
  if (/\b(show me (the |those )?sources|those sources|open the document|where did that come from)\b/i.test(q)) {
    kinds.push("sources");
  }
  if (/\bwhat about claim\s*[a-z0-9]+\b/i.test(q) || /\bclaim\s*[a-z0-9]+\b/i.test(q)) {
    kinds.push("claim");
  }
  if (/^\s*why\??\s*$/i.test(q) || /\bwhy (?:was|did|is)\b/i.test(q)) {
    kinds.push("why");
  }
  if (/\bwhat happened after that\b|\bafter that\b|\bwhat happened next\b/i.test(q)) {
    kinds.push("timeline_after");
  }
  if (/\bdid they respond\b|\bwas it requested\b|\bdid we follow up\b/i.test(q)) {
    kinds.push("discovery_chain");
  }
  if (/\bwhat motion did that lead to\b/i.test(q)) {
    kinds.push("motion");
    kinds.push("discovery_chain");
  } else if (/\bthat motion\b|\bthe motion\b/i.test(q)) {
    kinds.push("motion");
  }
  if (/\bthat case\b|\bwhich case\b|\bthe first case\b|\bstill good law\b/i.test(q)) {
    kinds.push("authority");
  }
  if (/\bthe (first|second|third|previous|latest|earlier|other) (claim|motion|authority|communication|email|ruling)\b/i.test(q)) {
    kinds.push("ordinal");
  }
  if (/\b(the other one|same one|that one|this one)\b/i.test(q) || /^\s*(it|that|this|those|they|them)\b/i.test(q)) {
    kinds.push("demonstrative");
  }
  if (/\bdraft it\b|\bwrite the reply\b|\bturn that into\b/i.test(q)) {
    kinds.push("draft");
  }
  if (/\bthat deficiency\b|\bthat ruling\b|\bthe other witness\b|\bcompare that\b|\bcompare those\b/i.test(q)) {
    kinds.push("relational");
  }
  if (/\bwhat is still missing\b|\bconflicting evidence\b|\belement\s*\d+\b/i.test(q)) {
    kinds.push("claim_followup");
  }
  if (/\bwhat did the judge (rule|do)\b|\bthe judge rule\b/i.test(q)) {
    kinds.push("ruling");
  }
  return { requested: kinds.length > 0, kinds };
}

function filterMatterScope(
  candidates: MatterEntityCandidate[],
  organizationId: string,
  matterId: string,
): MatterEntityCandidate[] {
  return candidates.filter(
    (c) =>
      c.organizationId === organizationId &&
      c.matterId === matterId &&
      Boolean(c.entityId) &&
      (UUID_RE.test(c.entityId) || c.entityId.startsWith("auth:") || c.entityId.startsWith("label:")),
  );
}

function candidatesOfType(
  candidates: MatterEntityCandidate[],
  type: ReferentEntityType | ReferentEntityType[],
): MatterEntityCandidate[] {
  const types = new Set(Array.isArray(type) ? type : [type]);
  return candidates.filter((c) => types.has(c.entityType));
}

function matchExplicitClaimLabel(question: string, candidates: MatterEntityCandidate[]): MatterEntityCandidate[] {
  const m = question.match(/\bclaim\s*([a-z0-9]+)\b/i);
  if (!m) return [];
  const token = m[1]!.toLowerCase();
  const claims = candidatesOfType(candidates, "claim");
  return claims.filter((c) => {
    const n = normalizeLabel(c.label);
    return (
      n.includes(`claim ${token}`) ||
      n.startsWith(`claim ${token}`) ||
      n === `claim ${token}` ||
      n.includes(`claim-${token}`) ||
      (token === "a" && /claim a|breach/i.test(c.label)) ||
      (token === "b" && /claim b|warrant/i.test(c.label))
    );
  });
}

function dedupeByEntityId(list: MatterEntityCandidate[]): MatterEntityCandidate[] {
  const seen = new Set<string>();
  const out: MatterEntityCandidate[] = [];
  for (const c of list) {
    if (seen.has(c.entityId)) continue;
    seen.add(c.entityId);
    out.push(c);
  }
  return out;
}

function matchExplicitMotionLabel(question: string, candidates: MatterEntityCandidate[]): MatterEntityCandidate[] {
  // Prefer motion rows only — do not treat disposition/ruling projections as a second motion.
  const motions = candidatesOfType(candidates, "motion");
  if (/\bmotion to compel\b/i.test(question)) {
    return dedupeByEntityId(motions.filter((c) => /compel/i.test(c.label)));
  }
  if (/\bsummary[- ]judgment\b/i.test(question)) {
    return dedupeByEntityId(motions.filter((c) => /summary/i.test(c.label)));
  }
  const titled = question.match(/\b(?:the )?([A-Z][\w\s-]{2,40} motion)\b/);
  if (titled) {
    const needle = normalizeLabel(titled[1]!);
    return dedupeByEntityId(motions.filter((c) => normalizeLabel(c.label).includes(needle)));
  }
  return [];
}

function matchExplicitDiscovery(question: string, candidates: MatterEntityCandidate[]): MatterEntityCandidate[] {
  const m = question.match(/\b(?:rfp|rfa|interrogatory)\s*#?\s*(\d+)\b/i);
  if (!m) return [];
  const num = m[1]!;
  return candidatesOfType(candidates, ["discovery_item", "discovery_deficiency"]).filter((c) =>
    new RegExp(`\\b${num}\\b`).test(c.label),
  );
}

function matchExplicitAuthority(question: string, candidates: MatterEntityCandidate[]): MatterEntityCandidate[] {
  const cite = question.match(/\b(\d+\s+F\.\s*\d+d\s+\d+)\b/i);
  if (!cite) return [];
  const needle = normalizeLabel(cite[1]!);
  return candidatesOfType(candidates, "authority").filter((c) =>
    normalizeLabel(c.label).includes(needle.replace(/\s+/g, "")),
  );
}

function matchOrdinal(
  question: string,
  candidates: MatterEntityCandidate[],
): { matches: MatterEntityCandidate[]; ambiguous: boolean } {
  const m = question.match(
    /\bthe (first|second|third|previous|latest|earlier|other) (claim|motion|authority|communication|email|ruling)\b/i,
  );
  if (!m) return { matches: [], ambiguous: false };
  const ordinal = m[1]!.toLowerCase();
  const typeWord = m[2]!.toLowerCase();
  const typeMap: Record<string, ReferentEntityType[]> = {
    claim: ["claim"],
    motion: ["motion"],
    authority: ["authority"],
    communication: ["communication"],
    email: ["communication"],
    ruling: ["ruling", "motion"],
  };
  const pool = candidatesOfType(candidates, typeMap[typeWord] ?? ["motion"]).slice();
  const ordered = [...pool].sort((a, b) => {
    const ak = a.orderKey ?? a.label;
    const bk = b.orderKey ?? b.label;
    return ak.localeCompare(bk);
  });
  if (ordered.length === 0) return { matches: [], ambiguous: false };
  if (ordinal === "other") {
    return ordered.length === 1
      ? { matches: ordered, ambiguous: false }
      : { matches: [], ambiguous: true };
  }
  if (ordinal === "latest") return { matches: [ordered[ordered.length - 1]!], ambiguous: false };
  if (ordinal === "previous" || ordinal === "earlier") {
    return ordered.length >= 2
      ? { matches: [ordered[ordered.length - 2]!], ambiguous: false }
      : { matches: ordered.slice(0, 1), ambiguous: false };
  }
  const idx = ordinal === "first" ? 0 : ordinal === "second" ? 1 : 2;
  if (idx >= ordered.length) return { matches: [], ambiguous: false };
  return { matches: [ordered[idx]!], ambiguous: false };
}

function activeIdsForType(state: ConversationWorkingState, type: ReferentEntityType): string[] {
  const bucket = bucketForType(type);
  if (!bucket) return [];
  return state[bucket];
}

function pickUniqueActive(
  state: ConversationWorkingState,
  type: ReferentEntityType | ReferentEntityType[],
  candidates: MatterEntityCandidate[],
): { match: MatterEntityCandidate | null; ambiguous: MatterEntityCandidate[] } {
  const types = Array.isArray(type) ? type : [type];
  const ids = uniq(types.flatMap((t) => activeIdsForType(state, t)));
  // Collapse motion+ruling projections that share one entity id — not true ambiguity.
  const matches = dedupeByEntityId(
    candidatesOfType(candidates, types).filter((c) => ids.includes(c.entityId)),
  );
  // Fall back to ID-only synthetic candidates when labels unknown.
  if (matches.length === 0 && ids.length === 1) {
    return {
      match: {
        entityType: types[0]!,
        entityId: ids[0]!,
        label: `${types[0]} ${ids[0]!.slice(0, 8)}`,
        organizationId: candidates[0]?.organizationId ?? "",
        matterId: candidates[0]?.matterId ?? "",
      },
      ambiguous: [],
    };
  }
  if (matches.length === 1) return { match: matches[0]!, ambiguous: [] };
  if (matches.length > 1) return { match: null, ambiguous: matches };
  if (ids.length > 1) {
    return {
      match: null,
      ambiguous: ids.map((id) => ({
        entityType: types[0]!,
        entityId: id,
        label: `${types[0]} ${id.slice(0, 8)}`,
        organizationId: candidates[0]?.organizationId ?? "",
        matterId: candidates[0]?.matterId ?? "",
      })),
    };
  }
  return { match: null, ambiguous: [] };
}

function clarificationFor(
  type: ReferentEntityType,
  candidates: Array<{ label: string }>,
): string {
  const labels = candidates.map((c) => c.label).slice(0, 4);
  if (labels.length >= 2) {
    return `Do you mean ${labels[0]} or ${labels[1]}?`;
  }
  return `Which ${type} did you mean?`;
}

function resolvedFromCandidate(
  c: MatterEntityCandidate,
  method: ResolutionMethod,
  sourceMessageId: string | null,
): ResolvedReferent {
  return {
    entityType: c.entityType,
    entityId: c.entityId,
    label: c.label,
    matterId: c.matterId,
    organizationId: c.organizationId,
    resolutionMethod: method,
    sourceMessageId,
    confidenceCategory: method === "UNIQUE_MATTER_MATCH" ? "unique_match" : "deterministic",
    ambiguityStatus: "NONE",
  };
}

/**
 * Age/prune active entity buckets. Newer IDs (front) win; cap per bucket.
 * Explicit switches replace same-type actives instead of unbounded union.
 */
export function ageActiveWorkingState(params: {
  prior: ConversationWorkingState;
  promote: ResolvedReferent[];
  /** When true, replace the bucket for promoted types instead of merging ahead. */
  replaceTypes?: ReferentEntityType[];
  maxIssueLabels?: number;
}): ConversationWorkingState {
  const replace = new Set(params.replaceTypes ?? params.promote.map((p) => p.entityType));
  const next: ConversationWorkingState = {
    ...params.prior,
    activeClaimIds: [...params.prior.activeClaimIds],
    activeDefenseIds: [...params.prior.activeDefenseIds],
    activeMotionIds: [...params.prior.activeMotionIds],
    activeDiscoveryIds: [...params.prior.activeDiscoveryIds],
    activeDeficiencyIds: [...params.prior.activeDeficiencyIds],
    activeCommunicationIds: [...params.prior.activeCommunicationIds],
    activeAuthorityIds: [...params.prior.activeAuthorityIds],
    activeSourceIds: [...params.prior.activeSourceIds],
    activeTaskIds: [...params.prior.activeTaskIds],
    issueLabels: [...params.prior.issueLabels],
    updatedAt: new Date().toISOString(),
  };

  for (const ref of params.promote) {
    if (!ref.entityId) continue;
    const bucket = bucketForType(ref.entityType);
    if (!bucket) continue;
    const current = replace.has(ref.entityType) ? [] : next[bucket];
    next[bucket] = uniq([ref.entityId, ...current]).slice(0, ACTIVE_BUCKET_CAPS[bucket]);
    if (ref.entityType === "claim") {
      next.issueLabels = uniq([`Claim focus: ${ref.label}`, ...next.issueLabels]).slice(
        0,
        params.maxIssueLabels ?? 8,
      );
    }
  }

  for (const [bucket, cap] of Object.entries(ACTIVE_BUCKET_CAPS) as Array<
    [keyof typeof ACTIVE_BUCKET_CAPS, number]
  >) {
    next[bucket] = next[bucket].slice(0, cap);
  }
  return next;
}

/** Reject foreign org/matter / nonexistent IDs from a candidate allow-list. */
export function validateReferentAgainstMatter(params: {
  entityId: string;
  entityType: ReferentEntityType;
  organizationId: string;
  matterId: string;
  allowed: MatterEntityCandidate[];
}): boolean {
  if (!params.entityId) return false;
  if (
    !UUID_RE.test(params.entityId) &&
    !params.entityId.startsWith("auth:") &&
    !params.entityId.startsWith("label:")
  ) {
    return false;
  }
  return params.allowed.some(
    (c) =>
      c.entityId === params.entityId &&
      c.entityType === params.entityType &&
      c.organizationId === params.organizationId &&
      c.matterId === params.matterId,
  );
}

/**
 * Build matter candidates from working-state IDs when richer labels are unavailable.
 * Callers should pass DB-backed candidates when available.
 */
export function candidatesFromWorkingState(params: {
  workingState: ConversationWorkingState;
  organizationId: string;
  matterId: string;
}): MatterEntityCandidate[] {
  const out: MatterEntityCandidate[] = [];
  const push = (type: ReferentEntityType, ids: string[], labelPrefix: string) => {
    for (const id of ids) {
      out.push({
        entityType: type,
        entityId: id,
        label: `${labelPrefix} ${id.slice(0, 8)}`,
        organizationId: params.organizationId,
        matterId: params.matterId,
      });
    }
  };
  push("claim", params.workingState.activeClaimIds, "Claim");
  push("defense", params.workingState.activeDefenseIds, "Defense");
  push("motion", params.workingState.activeMotionIds, "Motion");
  push("discovery_item", params.workingState.activeDiscoveryIds, "Discovery");
  push("discovery_deficiency", params.workingState.activeDeficiencyIds, "Deficiency");
  push("communication", params.workingState.activeCommunicationIds, "Communication");
  push("authority", params.workingState.activeAuthorityIds, "Authority");
  push("document", params.workingState.activeSourceIds, "Source");
  push("task", params.workingState.activeTaskIds, "Task");
  return out;
}

function latestAuthoritativeAssistant(
  turns: ConversationTurnForPrompt[],
): ConversationTurnForPrompt | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const t = turns[i]!;
    if (t.role !== "assistant") continue;
    if (t.completionStatus === "cancelled" || t.completionStatus === "failed") continue;
    return t;
  }
  return null;
}

/**
 * Resolve referents for the current question against structured conversational state.
 * Never auto-picks among multiple plausible same-type candidates.
 */
export function resolveConversationalReferents(params: {
  question: string;
  organizationId: string;
  matterId: string;
  workingState: ConversationWorkingState;
  recentTurns?: ConversationTurnForPrompt[];
  matterCandidates?: MatterEntityCandidate[];
  priorStructured?: PriorStructuredPayload | null;
  /** Allowed org/matter document IDs already revalidated. */
  allowedSourceIds?: readonly string[];
}): ReferentResolutionResult {
  const started = Date.now();
  const detection = detectReferentRequest(params.question);
  let prior = params.workingState ?? emptyWorkingState();
  const before = activeSnapshot(prior);

  const provided = params.matterCandidates ?? [];
  // When DB/matter candidates are supplied, scrub working-state IDs that are not among them
  // so foreign/nonexistent IDs cannot be re-homed onto the current matter.
  if (provided.length > 0) {
    const allowedIds = new Set(
      provided
        .filter((c) => c.organizationId === params.organizationId && c.matterId === params.matterId)
        .map((c) => c.entityId),
    );
    prior = {
      ...prior,
      activeClaimIds: prior.activeClaimIds.filter((id) => allowedIds.has(id)),
      activeDefenseIds: prior.activeDefenseIds.filter((id) => allowedIds.has(id)),
      activeMotionIds: prior.activeMotionIds.filter((id) => allowedIds.has(id)),
      activeDiscoveryIds: prior.activeDiscoveryIds.filter((id) => allowedIds.has(id)),
      activeDeficiencyIds: prior.activeDeficiencyIds.filter((id) => allowedIds.has(id)),
      activeCommunicationIds: prior.activeCommunicationIds.filter((id) => allowedIds.has(id)),
      activeAuthorityIds: prior.activeAuthorityIds.filter((id) => allowedIds.has(id)),
      activeSourceIds: prior.activeSourceIds.filter(
        (id) => allowedIds.has(id) || (params.allowedSourceIds ?? []).includes(id),
      ),
      activeTaskIds: prior.activeTaskIds.filter((id) => allowedIds.has(id)),
    };
  }

  const seeded =
    provided.length > 0
      ? provided
      : candidatesFromWorkingState({
          workingState: prior,
          organizationId: params.organizationId,
          matterId: params.matterId,
        });
  const candidates = filterMatterScope(seeded, params.organizationId, params.matterId);

  if (!detection.requested) {
    // Still bind explicit claim/motion mentions on non-follow-up questions.
    const explicitClaims = matchExplicitClaimLabel(params.question, candidates);
    if (explicitClaims.length === 1) {
      const ref = resolvedFromCandidate(explicitClaims[0]!, "EXPLICIT_LABEL", null);
      const after = ageActiveWorkingState({
        prior,
        promote: [ref],
        replaceTypes: ["claim"],
      });
      return {
        referentRequested: true,
        status: "RESOLVED",
        referents: [ref],
        candidates: [],
        userClarificationNeeded: false,
        clarificationPrompt: null,
        routingQuestion: params.question,
        forceDomains: ["CLAIMS", "EVIDENCE"],
        activeStateAfter: after,
        draftIntentPreview: null,
        diagnostics: {
          referentRequested: true,
          referentType: "claim",
          resolutionMethod: "EXPLICIT_LABEL",
          candidateCount: 1,
          resolvedEntityId: ref.entityId,
          ambiguity: false,
          activeContextBefore: before,
          activeContextAfter: activeSnapshot(after),
          routerDomainsAfterResolution: ["CLAIMS", "EVIDENCE"],
          resolverLatencyMs: Math.max(0, Date.now() - started),
        },
      };
    }
    return {
      referentRequested: false,
      status: "NOT_APPLICABLE",
      referents: [],
      candidates: [],
      userClarificationNeeded: false,
      clarificationPrompt: null,
      routingQuestion: params.question,
      forceDomains: [],
      activeStateAfter: prior,
      draftIntentPreview: null,
      diagnostics: {
        referentRequested: false,
        referentType: null,
        resolutionMethod: null,
        candidateCount: 0,
        resolvedEntityId: null,
        ambiguity: false,
        activeContextBefore: before,
        activeContextAfter: before,
        routerDomainsAfterResolution: [],
        resolverLatencyMs: Math.max(0, Date.now() - started),
      },
    };
  }

  const kinds = new Set(detection.kinds);
  const latestAssistant = latestAuthoritativeAssistant(params.recentTurns ?? []);
  const priorStructured = params.priorStructured ?? null;
  const forceDomains: ConversationalDomain[] = [];
  const referents: ResolvedReferent[] = [];
  let status: ReferentResolutionResult["status"] = "UNRESOLVED";
  let clarificationPrompt: string | null = null;
  let userClarificationNeeded = false;
  let method: ResolutionMethod | null = null;
  let draftIntentPreview: ReferentResolutionResult["draftIntentPreview"] = null;
  const ambiguityCandidates: Array<{
    entityType: ReferentEntityType;
    entityId: string;
    label: string;
  }> = [];

  const finishAmbiguous = (
    type: ReferentEntityType,
    pool: Array<{ entityType: ReferentEntityType; entityId: string; label: string }>,
  ): ReferentResolutionResult => {
    const after = prior;
    const domains = [domainForType(type)].filter(Boolean) as ConversationalDomain[];
    return {
      referentRequested: true,
      status: "AMBIGUOUS",
      referents: [
        {
          entityType: type,
          entityId: null,
          label: type,
          matterId: params.matterId,
          organizationId: params.organizationId,
          resolutionMethod: "AMBIGUOUS",
          sourceMessageId: latestAssistant?.messageId ?? null,
          confidenceCategory: "ambiguous",
          ambiguityStatus: "AMBIGUOUS",
        },
      ],
      candidates: pool,
      userClarificationNeeded: true,
      clarificationPrompt: clarificationFor(type, pool),
      routingQuestion: params.question,
      forceDomains: domains,
      activeStateAfter: after,
      draftIntentPreview: null,
      diagnostics: {
        referentRequested: true,
        referentType: type,
        resolutionMethod: "AMBIGUOUS",
        candidateCount: pool.length,
        resolvedEntityId: null,
        ambiguity: true,
        activeContextBefore: before,
        activeContextAfter: activeSnapshot(after),
        routerDomainsAfterResolution: domains,
        resolverLatencyMs: Math.max(0, Date.now() - started),
      },
    };
  };

  // --- Explicit labels / IDs (highest priority) ---
  const explicitClaim = matchExplicitClaimLabel(params.question, candidates);
  if (explicitClaim.length > 1) return finishAmbiguous("claim", explicitClaim);
  if (explicitClaim.length === 1) {
    referents.push(resolvedFromCandidate(explicitClaim[0]!, "EXPLICIT_LABEL", null));
    method = "EXPLICIT_LABEL";
    forceDomains.push("CLAIMS", "EVIDENCE");
    status = "RESOLVED";
  }

  const explicitMotion = dedupeByEntityId(matchExplicitMotionLabel(params.question, candidates));
  if (explicitMotion.length > 1) return finishAmbiguous("motion", explicitMotion);
  if (explicitMotion.length === 1 && !referents.some((r) => r.entityType === "motion")) {
    referents.push(resolvedFromCandidate(explicitMotion[0]!, "EXPLICIT_LABEL", null));
    method = "EXPLICIT_LABEL";
    forceDomains.push("MOTIONS");
    status = "RESOLVED";
  }

  const explicitDiscovery = matchExplicitDiscovery(params.question, candidates);
  if (explicitDiscovery.length > 1) return finishAmbiguous("discovery_item", explicitDiscovery);
  if (explicitDiscovery.length === 1) {
    referents.push(resolvedFromCandidate(explicitDiscovery[0]!, "EXPLICIT_LABEL", null));
    method = "EXPLICIT_LABEL";
    forceDomains.push("DISCOVERY");
    status = "RESOLVED";
  }

  const ordinal = matchOrdinal(params.question, candidates);
  if (ordinal.ambiguous) {
    const type = (ordinal.matches[0]?.entityType ?? "motion") as ReferentEntityType;
    const pool = candidatesOfType(candidates, type).map((c) => ({
      entityType: c.entityType,
      entityId: c.entityId,
      label: c.label,
    }));
    return finishAmbiguous(type, pool.length ? pool : ambiguityCandidates);
  }
  if (ordinal.matches.length === 1) {
    referents.push(resolvedFromCandidate(ordinal.matches[0]!, "UNIQUE_MATTER_MATCH", null));
    method = "UNIQUE_MATTER_MATCH";
    const d = domainForType(ordinal.matches[0]!.entityType);
    if (d) forceDomains.push(d);
    status = "RESOLVED";
  }

  // --- Sources: "show me those sources" ---
  if (kinds.has("sources")) {
    const sourceIds = uniq([
      ...(priorStructured?.sourceRefs ?? []),
      ...(latestAssistant?.sourceIds ?? []),
      ...prior.activeSourceIds,
    ]).filter((id) => (params.allowedSourceIds ?? prior.activeSourceIds).includes(id) || !params.allowedSourceIds);
    const allowed = params.allowedSourceIds
      ? sourceIds.filter((id) => params.allowedSourceIds!.includes(id))
      : sourceIds.filter((id) => UUID_RE.test(id));
    if (allowed.length === 0) {
      status = "UNRESOLVED";
      method = "UNRESOLVED";
    } else {
      for (const id of allowed.slice(0, 8)) {
        referents.push({
          entityType: "document",
          entityId: id,
          label: `Source ${id.slice(0, 8)}`,
          matterId: params.matterId,
          organizationId: params.organizationId,
          resolutionMethod: priorStructured?.sourceRefs?.includes(id)
            ? "PRIOR_STRUCTURED_TURN"
            : "ACTIVE_CONTEXT",
          sourceMessageId: latestAssistant?.messageId ?? null,
          confidenceCategory: "deterministic",
          ambiguityStatus: "NONE",
        });
      }
      method = "PRIOR_STRUCTURED_TURN";
      forceDomains.push("EVIDENCE", "CLAIMS");
      status = "RESOLVED";
    }
  }

  // --- Why / claim follow-ups attach to active claim ---
  if ((kinds.has("why") || kinds.has("claim_followup")) && !referents.some((r) => r.entityType === "claim")) {
    const { match, ambiguous } = pickUniqueActive(prior, "claim", candidates);
    if (ambiguous.length > 1) return finishAmbiguous("claim", ambiguous);
    if (match) {
      referents.push(resolvedFromCandidate(match, "ACTIVE_CONTEXT", latestAssistant?.messageId ?? null));
      method = "ACTIVE_CONTEXT";
      forceDomains.push("CLAIMS", "EVIDENCE");
      status = "RESOLVED";
    }
  }

  // --- Timeline after that ---
  if (kinds.has("timeline_after")) {
    const { match: motion, ambiguous: ambMotion } = pickUniqueActive(prior, ["motion", "ruling"], candidates);
    if (ambMotion.length > 1) return finishAmbiguous("motion", ambMotion);
    if (motion) {
      referents.push(resolvedFromCandidate(motion, "ACTIVE_CONTEXT", latestAssistant?.messageId ?? null));
      method = "ACTIVE_CONTEXT";
      forceDomains.push("MOTIONS", "TIMELINE");
      status = "RESOLVED";
    } else {
      const { match: comm, ambiguous: ambComm } = pickUniqueActive(prior, "communication", candidates);
      if (ambComm.length > 1) return finishAmbiguous("communication", ambComm);
      if (comm) {
        referents.push(resolvedFromCandidate(comm, "ACTIVE_CONTEXT", latestAssistant?.messageId ?? null));
        method = "ACTIVE_CONTEXT";
        forceDomains.push("COMMUNICATIONS", "TIMELINE");
        status = "RESOLVED";
      } else {
        status = "UNRESOLVED";
        method = "UNRESOLVED";
        clarificationPrompt = "Which event or motion should I use as the timeline anchor?";
        userClarificationNeeded = true;
      }
    }
  }

  // --- Discovery chain ---
  if (kinds.has("discovery_chain")) {
    const { match: def, ambiguous: ambDef } = pickUniqueActive(
      prior,
      ["discovery_deficiency", "discovery_item"],
      candidates,
    );
    if (ambDef.length > 1) return finishAmbiguous(ambDef[0]!.entityType, ambDef);
    if (def) {
      referents.push(resolvedFromCandidate(def, "ACTIVE_CONTEXT", latestAssistant?.messageId ?? null));
      // Linked motion/communication only if candidate declares links.
      const linkedMotions = def.linkedIds?.motion ?? [];
      const linkedComms = def.linkedIds?.communication ?? [];
      for (const mid of linkedMotions.slice(0, 2)) {
        const linked = candidates.find((c) => c.entityId === mid && c.entityType === "motion");
        if (linked) referents.push(resolvedFromCandidate(linked, "PRIOR_STRUCTURED_TURN", null));
      }
      for (const cid of linkedComms.slice(0, 2)) {
        const linked = candidates.find((c) => c.entityId === cid && c.entityType === "communication");
        if (linked) referents.push(resolvedFromCandidate(linked, "PRIOR_STRUCTURED_TURN", null));
      }
      method = "ACTIVE_CONTEXT";
      forceDomains.push("DISCOVERY", "COMMUNICATIONS");
      status = "RESOLVED";
    } else {
      status = "UNRESOLVED";
      method = "UNRESOLVED";
    }
  }

  // --- Motion demonstrative / "that motion" ---
  if (kinds.has("motion") && !referents.some((r) => r.entityType === "motion" || r.entityType === "ruling")) {
    const { match, ambiguous } = pickUniqueActive(prior, ["motion", "ruling"], candidates);
    if (ambiguous.length > 1 || (kinds.has("demonstrative") && prior.activeMotionIds.length > 1)) {
      const pool =
        ambiguous.length > 0
          ? ambiguous
          : candidatesOfType(candidates, "motion").filter((c) =>
              prior.activeMotionIds.includes(c.entityId),
            );
      return finishAmbiguous(
        "motion",
        pool.map((c) => ({ entityType: c.entityType, entityId: c.entityId, label: c.label })),
      );
    }
    if (match) {
      referents.push(resolvedFromCandidate(match, "ACTIVE_CONTEXT", latestAssistant?.messageId ?? null));
      method = "ACTIVE_CONTEXT";
      forceDomains.push("MOTIONS");
      if (/\blead to\b/i.test(params.question)) forceDomains.push("DISCOVERY", "COMMUNICATIONS");
      status = "RESOLVED";
    }
  }

  // --- Ruling follow-up ---
  if (kinds.has("ruling") && !referents.some((r) => r.entityType === "motion" || r.entityType === "ruling")) {
    const { match, ambiguous } = pickUniqueActive(prior, ["motion", "ruling"], candidates);
    if (ambiguous.length > 1) return finishAmbiguous("motion", ambiguous);
    if (match) {
      referents.push(resolvedFromCandidate(match, "ACTIVE_CONTEXT", latestAssistant?.messageId ?? null));
      method = "ACTIVE_CONTEXT";
      forceDomains.push("MOTIONS");
      status = "RESOLVED";
    }
  }

  // --- Authority: that case / first case ---
  if (kinds.has("authority")) {
    const auths = candidatesOfType(candidates, "authority").filter((c) =>
      prior.activeAuthorityIds.includes(c.entityId) ||
      (priorStructured?.authorityRefs ?? []).includes(c.entityId) ||
      (latestAssistant?.authorityIds ?? []).includes(c.entityId),
    );
    const uniquePool =
      auths.length > 0
        ? auths
        : prior.activeAuthorityIds.map((id) => ({
            entityType: "authority" as const,
            entityId: id,
            label: `Authority ${id.slice(0, 8)}`,
            organizationId: params.organizationId,
            matterId: params.matterId,
          }));
    if (/\bthe first case\b/i.test(params.question) && uniquePool.length >= 1) {
      const ordered = [...uniquePool].sort((a, b) => a.label.localeCompare(b.label));
      referents.push(resolvedFromCandidate(ordered[0]!, "UNIQUE_MATTER_MATCH", latestAssistant?.messageId ?? null));
      method = "UNIQUE_MATTER_MATCH";
      forceDomains.push("AUTHORITIES", "RESEARCH");
      status = "RESOLVED";
    } else if (uniquePool.length > 1 && /\bthat case\b/i.test(params.question)) {
      return finishAmbiguous(
        "authority",
        uniquePool.map((c) => ({ entityType: c.entityType, entityId: c.entityId, label: c.label })),
      );
    } else if (uniquePool.length === 1) {
      referents.push(resolvedFromCandidate(uniquePool[0]!, "ACTIVE_CONTEXT", latestAssistant?.messageId ?? null));
      method = "ACTIVE_CONTEXT";
      forceDomains.push("AUTHORITIES");
      status = "RESOLVED";
    } else if (
      uniquePool.length > 1 &&
      /\b(still good law|good law|that hold)\b/i.test(params.question) &&
      prior.activeAuthorityIds.length === 1
    ) {
      const focus = uniquePool.find((c) => c.entityId === prior.activeAuthorityIds[0]!) ?? uniquePool[0]!;
      referents.push(resolvedFromCandidate(focus, "ACTIVE_CONTEXT", latestAssistant?.messageId ?? null));
      method = "ACTIVE_CONTEXT";
      forceDomains.push("AUTHORITIES");
      status = "RESOLVED";
    } else if (uniquePool.length === 0) {
      status = "UNRESOLVED";
      method = "UNRESOLVED";
    } else if (uniquePool.length > 1 && /\bstill good law\b/i.test(params.question)) {
      // After ordinal focus, activeAuthorityIds should already be pruned to one; if not, clarify.
      return finishAmbiguous(
        "authority",
        uniquePool.map((c) => ({ entityType: c.entityType, entityId: c.entityId, label: c.label })),
      );
    }
  }

  // --- Demonstrative "the other one" without type ---
  if (kinds.has("demonstrative") && referents.length === 0) {
    const liveTypes: ReferentEntityType[] = [];
    if (prior.activeMotionIds.length) liveTypes.push("motion");
    if (prior.activeClaimIds.length) liveTypes.push("claim");
    if (prior.activeAuthorityIds.length) liveTypes.push("authority");
    if (liveTypes.length !== 1) {
      // Multiple live types or none — fail closed.
      userClarificationNeeded = true;
      clarificationPrompt = "Which item did you mean?";
      status = "AMBIGUOUS";
      method = "AMBIGUOUS";
    } else {
      const { match, ambiguous } = pickUniqueActive(prior, liveTypes[0]!, candidates);
      if (ambiguous.length > 1) return finishAmbiguous(liveTypes[0]!, ambiguous);
      if (match) {
        referents.push(resolvedFromCandidate(match, "ACTIVE_CONTEXT", latestAssistant?.messageId ?? null));
        method = "ACTIVE_CONTEXT";
        const d = domainForType(match.entityType);
        if (d) forceDomains.push(d);
        status = "RESOLVED";
      }
    }
  }

  // --- Draft preview ---
  if (kinds.has("draft")) {
    draftIntentPreview = {
      requested: true,
      targetLabel: referents[0]?.label ?? prior.issueLabels[0] ?? null,
    };
    forceDomains.push("DRAFT");
    if (status === "UNRESOLVED" && referents.length === 0) {
      const { match } = pickUniqueActive(prior, ["communication", "motion", "claim"], candidates);
      if (match) {
        referents.push(resolvedFromCandidate(match, "ACTIVE_CONTEXT", latestAssistant?.messageId ?? null));
        status = "RESOLVED";
        method = "ACTIVE_CONTEXT";
      }
    }
  }

  // Validate all resolved IDs against matter scope when candidates include them.
  const validatedReferents = referents.filter((r) => {
    if (!r.entityId) return true;
    if (r.entityType === "document" || r.entityType === "evidence") {
      if (params.allowedSourceIds && !params.allowedSourceIds.includes(r.entityId)) return false;
      return UUID_RE.test(r.entityId);
    }
    // If we have typed candidates, require membership; synthetic working-state IDs are allowed.
    const typed = candidates.filter((c) => c.entityType === r.entityType);
    if (typed.length === 0) {
      return r.organizationId === params.organizationId && r.matterId === params.matterId;
    }
    return validateReferentAgainstMatter({
      entityId: r.entityId,
      entityType: r.entityType,
      organizationId: params.organizationId,
      matterId: params.matterId,
      allowed: typed,
    });
  });

  if (validatedReferents.length === 0 && status === "RESOLVED") {
    status = "UNRESOLVED";
    method = "UNRESOLVED";
  }

  const replaceTypes = validatedReferents
    .filter(
      (r) =>
        r.resolutionMethod === "EXPLICIT_LABEL" ||
        r.resolutionMethod === "UNIQUE_MATTER_MATCH" ||
        /\bwhat about claim\b/i.test(params.question) ||
        (r.entityType === "authority" && /\b(first case|that case)\b/i.test(params.question)),
    )
    .map((r) => r.entityType);

  const after =
    status === "RESOLVED"
      ? ageActiveWorkingState({
          prior,
          promote: validatedReferents,
          replaceTypes: replaceTypes.length ? replaceTypes : undefined,
        })
      : prior;

  const domains = uniq([
    ...forceDomains,
    ...validatedReferents
      .map((r) => domainForType(r.entityType))
      .filter((d): d is ConversationalDomain => Boolean(d)),
  ]) as ConversationalDomain[];

  const routingHints = validatedReferents
    .filter((r) => r.entityId && r.label)
    .slice(0, 4)
    .map((r) => `${r.entityType}:${r.label}`);
  const routingQuestion =
    routingHints.length > 0
      ? `${params.question}\n[ResolvedReferents: ${routingHints.join("; ")}]`
      : params.question;

  if (status === "AMBIGUOUS") {
    userClarificationNeeded = true;
    clarificationPrompt = clarificationPrompt ?? "Which item did you mean?";
  }

  return {
    referentRequested: true,
    status,
    referents: validatedReferents.length
      ? validatedReferents
      : status === "AMBIGUOUS"
        ? [
            {
              entityType: (ambiguityCandidates[0]?.entityType ?? "motion") as ReferentEntityType,
              entityId: null,
              label: "ambiguous",
              matterId: params.matterId,
              organizationId: params.organizationId,
              resolutionMethod: "AMBIGUOUS",
              sourceMessageId: latestAssistant?.messageId ?? null,
              confidenceCategory: "ambiguous",
              ambiguityStatus: "AMBIGUOUS",
            },
          ]
        : [],
    candidates: ambiguityCandidates,
    userClarificationNeeded,
    clarificationPrompt,
    routingQuestion,
    forceDomains: domains,
    activeStateAfter: after,
    draftIntentPreview,
    diagnostics: {
      referentRequested: true,
      referentType:
        validatedReferents.length === 0
          ? null
          : validatedReferents.every((r) => r.entityType === validatedReferents[0]!.entityType)
            ? validatedReferents[0]!.entityType
            : "mixed",
      resolutionMethod: method,
      candidateCount: Math.max(ambiguityCandidates.length, validatedReferents.length),
      resolvedEntityId: validatedReferents[0]?.entityId ?? null,
      ambiguity: status === "AMBIGUOUS",
      activeContextBefore: before,
      activeContextAfter: activeSnapshot(after),
      routerDomainsAfterResolution: domains,
      resolverLatencyMs: Math.max(0, Date.now() - started),
    },
  };
}

export function formatReferentResolutionForPrompt(result: ReferentResolutionResult): string | null {
  if (!result.referentRequested) return null;
  const lines = [
    "REFERENT_RESOLUTION",
    `status=${result.status}`,
    result.clarificationPrompt ? `clarification=${result.clarificationPrompt}` : null,
    ...result.referents.slice(0, 8).map(
      (r) =>
        `- ${r.entityType} id=${r.entityId ?? "none"} label=${r.label} method=${r.resolutionMethod}`,
    ),
  ].filter(Boolean);
  return lines.join("\n");
}

/** Ambiguity-safe user-facing answer when resolution fails closed. */
export function ambiguityAnswerText(result: ReferentResolutionResult): string {
  return (
    result.clarificationPrompt ??
    "I need a clarification before answering — more than one item in this matter could match that reference."
  );
}

/**
 * Lightweight matter-scoped candidate lookup for referent resolution.
 * Reuses existing tables; does not invoke Pass 3–7 full loaders.
 */
export async function loadMatterReferentCandidates(
  db: Database,
  params: { organizationId: string; matterId: string },
): Promise<{ candidates: MatterEntityCandidate[]; lookupLatencyMs: number }> {
  const started = Date.now();
  const scope = and(
    eq(civilClaims.organizationId, params.organizationId),
    eq(civilClaims.matterId, params.matterId),
  );
  void scope;

  const [claims, motions, deficiencies, communications, docs] = await Promise.all([
    db
      .select({
        id: civilClaims.id,
        label: civilClaims.label,
        createdAt: civilClaims.createdAt,
      })
      .from(civilClaims)
      .where(
        and(
          eq(civilClaims.organizationId, params.organizationId),
          eq(civilClaims.matterId, params.matterId),
        ),
      )
      .orderBy(asc(civilClaims.createdAt))
      .limit(40),
    db
      .select({
        id: matterMotions.id,
        title: matterMotions.title,
        filedAt: matterMotions.filedAt,
        createdAt: matterMotions.createdAt,
        disposition: matterMotions.disposition,
      })
      .from(matterMotions)
      .where(
        and(
          eq(matterMotions.organizationId, params.organizationId),
          eq(matterMotions.matterId, params.matterId),
        ),
      )
      .orderBy(asc(matterMotions.filedAt), asc(matterMotions.createdAt))
      .limit(40),
    db
      .select({
        id: discoveryDeficiencies.id,
        description: discoveryDeficiencies.description,
        kind: discoveryDeficiencies.kind,
        motionId: discoveryDeficiencies.motionId,
        communicationId: discoveryDeficiencies.communicationId,
        createdAt: discoveryDeficiencies.createdAt,
      })
      .from(discoveryDeficiencies)
      .where(
        and(
          eq(discoveryDeficiencies.organizationId, params.organizationId),
          eq(discoveryDeficiencies.matterId, params.matterId),
        ),
      )
      .orderBy(asc(discoveryDeficiencies.createdAt))
      .limit(40),
    db
      .select({
        id: matterCommunications.id,
        subject: matterCommunications.subject,
        occurredAt: matterCommunications.occurredAt,
        createdAt: matterCommunications.createdAt,
      })
      .from(matterCommunications)
      .where(
        and(
          eq(matterCommunications.organizationId, params.organizationId),
          eq(matterCommunications.matterId, params.matterId),
        ),
      )
      .orderBy(asc(matterCommunications.occurredAt), asc(matterCommunications.createdAt))
      .limit(40),
    db
      .select({ id: documents.id, title: documents.title, createdAt: documents.createdAt })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, params.organizationId),
          eq(documents.matterId, params.matterId),
        ),
      )
      .orderBy(asc(documents.createdAt))
      .limit(40),
  ]);

  const candidates: MatterEntityCandidate[] = [];
  for (const c of claims) {
    candidates.push({
      entityType: "claim",
      entityId: c.id,
      label: c.label,
      organizationId: params.organizationId,
      matterId: params.matterId,
      orderKey: c.createdAt?.toISOString?.() ?? null,
    });
  }
  for (const m of motions) {
    const orderKey = (m.filedAt ?? m.createdAt)?.toISOString?.() ?? null;
    candidates.push({
      entityType: "motion",
      entityId: m.id,
      label: m.title,
      organizationId: params.organizationId,
      matterId: params.matterId,
      orderKey,
    });
    // Ruling focus reuses the motion id as the structured anchor (no duplicate candidate row).
    if (m.disposition) {
      candidates.push({
        entityType: "ruling",
        entityId: m.id,
        label: `${m.title} (${m.disposition})`,
        organizationId: params.organizationId,
        matterId: params.matterId,
        orderKey,
      });
    }
  }
  for (const d of deficiencies) {
    const linked: MatterEntityCandidate["linkedIds"] = {};
    if (d.motionId) linked.motion = [d.motionId];
    if (d.communicationId) linked.communication = [d.communicationId];
    candidates.push({
      entityType: "discovery_deficiency",
      entityId: d.id,
      label: d.description || d.kind,
      organizationId: params.organizationId,
      matterId: params.matterId,
      orderKey: d.createdAt?.toISOString?.() ?? null,
      linkedIds: linked,
    });
  }
  for (const c of communications) {
    candidates.push({
      entityType: "communication",
      entityId: c.id,
      label: c.subject || "Communication",
      organizationId: params.organizationId,
      matterId: params.matterId,
      orderKey: (c.occurredAt ?? c.createdAt)?.toISOString?.() ?? null,
    });
  }
  for (const d of docs) {
    candidates.push({
      entityType: "document",
      entityId: d.id,
      label: d.title || "Document",
      organizationId: params.organizationId,
      matterId: params.matterId,
      orderKey: d.createdAt?.toISOString?.() ?? null,
    });
  }

  return { candidates, lookupLatencyMs: Math.max(0, Date.now() - started) };
}
