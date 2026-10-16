/**
 * Oct 19–25 Phase 4 — Conversational investigate-next (deterministic).
 * Unifies whole-matter + hearing + deposition + draft/research gaps.
 * No CourtListener. No shared schema — ai_artifacts.validation + working-state JSON only.
 */

export const INVESTIGATE_GAP_TYPES = [
  "MISSING_EVIDENCE",
  "WEAK_EVIDENCE",
  "CONFLICTING_EVIDENCE",
  "MISSING_DOCUMENT",
  "REFERENCED_BUT_UNLOCATED_DOCUMENT",
  "MISSING_COMMUNICATION",
  "TIMELINE_GAP",
  "UNIDENTIFIED_PERSON",
  "UNKNOWN_ROLE",
  "DISCOVERY_DEFICIENCY",
  "UNANSWERED_DISCOVERY",
  "CLAIM_ELEMENT_GAP",
  "DEFENSE_ELEMENT_GAP",
  "UNSUPPORTED_DRAFT_ASSERTION",
  "MISSING_AUTHORITY",
  "UNVERIFIED_AUTHORITY_TREATMENT",
  "CONTRARY_AUTHORITY",
  "MOTION_SUPPORT_GAP",
  "HEARING_PREP_GAP",
  "DEPOSITION_FOLLOWUP_GAP",
  "TRANSCRIPT_FOLLOWUP_GAP",
  "PROVENANCE_GAP",
  "SOURCE_QUALITY_GAP",
  "UNKNOWN_JURISDICTION",
  "UNKNOWN_PROCEDURAL_POSTURE",
  "TASK_OVERDUE",
  "GENERIC_UNKNOWN",
] as const;
export type InvestigateGapType = (typeof INVESTIGATE_GAP_TYPES)[number];

export const INVESTIGATE_DOMAINS = [
  "WHOLE_MATTER",
  "CLAIMS",
  "DEFENSES",
  "EVIDENCE",
  "DISCOVERY",
  "COMMUNICATIONS",
  "TIMELINE",
  "MOTIONS",
  "HEARING",
  "DEPOSITION",
  "DRAFT",
  "RESEARCH",
  "AUTHORITIES",
  "TASKS",
] as const;
export type InvestigateDomain = (typeof INVESTIGATE_DOMAINS)[number];

export type InvestigatePriority = "HIGH" | "MEDIUM" | "LOW";
export type InvestigateImpact = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
export type InvestigateEffort = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
export type InvestigateGapStatus = "OPEN" | "PARTIALLY_RESOLVED" | "RESOLVED" | "BLOCKED" | "UNKNOWN";
export type InvestigateFactuality =
  | "FACT"
  | "SUPPORTED_INFERENCE"
  | "UNKNOWN"
  | "CONFLICT"
  | "UNSUPPORTED";

export type InvestigateSourceRef = {
  kind: string;
  id: string;
  label?: string | null;
};

export type ConversationalGap = {
  id: string;
  gapType: InvestigateGapType;
  title: string;
  description: string;
  whyItMatters: string;
  relatedDomain: InvestigateDomain;
  relatedEntityIds: string[];
  sourceIds: string[];
  factuality: InvestigateFactuality;
  recommendedNextStep: string;
  expectedEvidenceType: string | null;
  priority: InvestigatePriority;
  priorityRationale: string;
  impact: InvestigateImpact;
  effort: InvestigateEffort;
  status: InvestigateGapStatus;
  sourceMap: InvestigateSourceRef[];
  provenanceDomains: InvestigateDomain[];
  dedupeKey: string;
  actionType:
    | "LOCATE_DOCUMENT"
    | "REVIEW_DOCUMENT"
    | "COMPARE_SOURCES"
    | "VERIFY_AUTHORITY"
    | "IDENTIFY_PERSON"
    | "CLARIFY_TIMELINE"
    | "FOLLOW_UP_DISCOVERY"
    | "PREPARE_WITNESS_QUESTION"
    | "RESEARCH_PROPOSITION"
    | "VERIFY_PROCEDURAL_STATUS"
    | "TRACE_COMMUNICATION"
    | "CHECK_SOURCE_PROVENANCE"
    | "OTHER";
};

export type InvestigateNextFilter = {
  topN: number | null;
  priorityOnly: InvestigatePriority | null;
  domains: InvestigateDomain[];
  personIds: string[];
  motionIds: string[];
  claimIds: string[];
  issueLabels: string[];
  ignoreAuthority: boolean;
  missingDocumentsOnly: boolean;
  twoHourConstraint: boolean;
};

export type InvestigateNextChangeSet = {
  newGaps: string[];
  resolvedGaps: string[];
  worsenedGaps: string[];
  unchangedGaps: string[];
};

export type InvestigateNextResult = {
  posture: "RESOLVED" | "AMBIGUOUS_REFERENT" | "NO_MATERIAL_GAP" | "FILTERED_EMPTY";
  scope: string;
  gaps: ConversationalGap[];
  candidateCount: number;
  dedupedCount: number;
  returnedCount: number;
  domainsConsidered: InvestigateDomain[];
  filters: InvestigateNextFilter;
  changeSet: InvestigateNextChangeSet | null;
  sourceMap: InvestigateSourceRef[];
  limitations: string[];
  genericChecklistLeakage: 0;
  inventedUrgency: 0;
};

export type InvestigateGapReferentResolution =
  | { status: "RESOLVED"; gap: ConversationalGap }
  | { status: "AMBIGUOUS"; candidates: ConversationalGap[]; clarificationPrompt: string }
  | { status: "NOT_FOUND"; clarificationPrompt: string };

export type InvestigateTaskPreview = {
  title: string;
  description: string;
  whyItMatters: string;
  relatedEntityIds: string[];
  linkedSourceIds: string[];
  gapId: string;
  gapType: InvestigateGapType;
  proposedDueAt: string | null;
  matterId: string;
};

/** Candidate input from whole-matter / hearing / depo / draft / research builders. */
export type InvestigateCandidateInput = {
  title: string;
  why: string;
  resolvesIf?: string;
  gapType?: InvestigateGapType;
  domain: InvestigateDomain;
  relatedEntityIds?: string[];
  sourceRefs?: InvestigateSourceRef[];
  factuality?: InvestigateFactuality;
  priority?: InvestigatePriority;
  priorityRationale?: string;
  impact?: InvestigateImpact;
  effort?: InvestigateEffort;
  expectedEvidenceType?: string | null;
  actionType?: ConversationalGap["actionType"];
  status?: InvestigateGapStatus;
};

const GENERIC_CHECKLIST =
  /\b(intake questionnaire|standard litigation checklist|usual discovery plan|generic next steps for any case)\b/i;

const CAPS = {
  candidatesPerDomain: 12,
  candidatesTotal: 80,
  returned: 12,
  sourceMap: 40,
} as const;

export function isInvestigateNextQuestion(question: string): boolean {
  const q = question.trim();
  return (
    /\bwhat should (i|we) investigate next\b/i.test(q) ||
    /\binvestigate next\b/i.test(q) ||
    /\bbiggest holes?\b/i.test(q) ||
    /\bwhat are we still missing\b/i.test(q) ||
    /\bwhat (evidence|authorit(?:y|ies)|discovery|documents?) (are|is) (we )?missing\b/i.test(q) ||
    /\bdiscovery gaps?\b/i.test(q) ||
    /\bwhat should (i|we) look for before the hearing\b/i.test(q) ||
    /\bwhat came out of the deposition\b/i.test(q) ||
    /\bfollow up on\b.+\bdeposition\b/i.test(q) ||
    /\bwhat facts in this draft are weak\b/i.test(q) ||
    /\bwhat (should i|to) do next if i only have (two|2) hours\b/i.test(q) ||
    /\btop\s*\d+\b.+\b(investigate|gap|hole|thing)/i.test(q) ||
    /\btop\s*\d+\b.+\bcould materially change\b/i.test(q) ||
    /\bdocuments? mentioned in emails?\b/i.test(q) ||
    /\bonly (the )?high priority\b/i.test(q) ||
    /\bignore (authority|research)\b/i.test(q) ||
    /\bonly discovery gaps?\b/i.test(q) ||
    /\bwhat changed since the deposition\b/i.test(q) ||
    /\bwhat new gaps\b/i.test(q) ||
    /\bdid (this|the) research resolve\b/i.test(q)
  );
}

export function isInvestigateNextFollowUp(question: string): boolean {
  const q = question.trim();
  return (
    /^#\d+\b/i.test(q) ||
    /\bwhy is #?\d+\b/i.test(q) ||
    /\bshow (me )?the sources?\b/i.test(q) ||
    /\bturn #?\d+ into a task\b/i.test(q) ||
    /\bwhat document would resolve #?\d+\b/i.test(q) ||
    /\b(the|that) (missing attachment|timeline issue|authority gap|discovery (gap|deficiency))\b/i.test(
      q,
    ) ||
    /\bonly (the )?high priority\b/i.test(q) ||
    /\bignores? (authority|research)\b/i.test(q)
  );
}

/** Router force domains — must be ConversationalDomain-compatible (no HEARING token). */
export function investigateNextForceDomains(): Array<
  | "WHOLE_MATTER"
  | "CLAIMS"
  | "DEFENSES"
  | "EVIDENCE"
  | "DISCOVERY"
  | "COMMUNICATIONS"
  | "TIMELINE"
  | "MOTIONS"
  | "DEPOSITION"
  | "DRAFT"
  | "RESEARCH"
  | "AUTHORITIES"
  | "TASKS"
> {
  return [
    "WHOLE_MATTER",
    "CLAIMS",
    "DEFENSES",
    "EVIDENCE",
    "DISCOVERY",
    "COMMUNICATIONS",
    "TIMELINE",
    "MOTIONS",
    "DEPOSITION",
    "DRAFT",
    "RESEARCH",
    "AUTHORITIES",
    "TASKS",
  ];
}

export function parseInvestigateFilters(question: string): InvestigateNextFilter {
  const top = question.match(/\btop\s*(\d+)\b/i);
  const topN = top ? Math.min(Math.max(Number(top[1]), 1), CAPS.returned) : null;
  const domains: InvestigateDomain[] = [];
  if (/\bonly discovery\b|\bdiscovery (gaps?|only)\b/i.test(question)) domains.push("DISCOVERY");
  if (/\bonly (claim|claims)\b|\bfor this claim\b|\bclaim only\b/i.test(question)) domains.push("CLAIMS");
  if (/\bonly (defense|defenses)\b|\bdefense only\b/i.test(question)) domains.push("DEFENSES");
  if (/\bonly hearing\b|\bfor (this )?hearing\b|\bbefore the hearing\b/i.test(question)) {
    domains.push("HEARING", "MOTIONS");
  }
  if (/\bonly deposition\b|\bfrom the deposition\b|\bdeposition follow/i.test(question)) {
    domains.push("DEPOSITION");
  }
  if (/\bonly draft\b|\bfacts in this draft\b/i.test(question)) domains.push("DRAFT");
  if (/\bonly research\b|\bauthorit(?:y|ies) (are|is) missing\b/i.test(question)) {
    domains.push("RESEARCH", "AUTHORITIES");
  }
  if (/\bonly (missing )?documents?\b|\bmissing attachment/i.test(question)) {
    domains.push("EVIDENCE", "COMMUNICATIONS");
  }
  return {
    topN,
    priorityOnly: /\bhigh priority\b|\bonly (the )?high\b/i.test(question) ? "HIGH" : null,
    domains,
    personIds: [],
    motionIds: [],
    claimIds: [],
    issueLabels: [],
    ignoreAuthority: /\bignores? (authority|research)\b/i.test(question),
    missingDocumentsOnly: /\bonly (missing )?documents?\b|\bmissing attachment/i.test(question),
    twoHourConstraint: /\b(two|2) hours?\b/i.test(question),
  };
}

function normalizeKeyPart(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 80);
}

export function buildDedupeKey(params: {
  gapType: InvestigateGapType;
  relatedEntityIds: string[];
  sourceIds: string[];
  title: string;
  why: string;
}): string {
  const entity = [...params.relatedEntityIds].sort().join(",") || "none";
  const sources = [...params.sourceIds].sort().slice(0, 4).join(",") || "none";
  const topic = normalizeKeyPart(`${params.title} ${params.why}`).split(" ").slice(0, 8).join(" ");
  return `${params.gapType}|${entity}|${sources}|${topic}`;
}

function inferGapType(title: string, why: string, domain: InvestigateDomain): InvestigateGapType {
  const blob = `${title} ${why}`.toLowerCase();
  if (/deficien/.test(blob)) return "DISCOVERY_DEFICIENCY";
  if (/unanswered|no response|interrogator/.test(blob)) return "UNANSWERED_DISCOVERY";
  if (/attachment|referenced.+missing|missing.+document|unlocated/.test(blob)) {
    return "REFERENCED_BUT_UNLOCATED_DOCUMENT";
  }
  if (/missing document|document not (found|located|produced)/.test(blob)) return "MISSING_DOCUMENT";
  if (/timeline|undated|date unknown|temporal/.test(blob)) return "TIMELINE_GAP";
  if (/unidentified|unknown person|who is/.test(blob)) return "UNIDENTIFIED_PERSON";
  if (/unknown role/.test(blob)) return "UNKNOWN_ROLE";
  if (/conflict|contradict/.test(blob)) return "CONFLICTING_EVIDENCE";
  if (/weak|single witness|one source only|partially supported/.test(blob)) return "WEAK_EVIDENCE";
  if (/treatment.*(not verified|unverified)|not verified/.test(blob)) {
    return "UNVERIFIED_AUTHORITY_TREATMENT";
  }
  if (/contrary|adverse authority/.test(blob)) return "CONTRARY_AUTHORITY";
  if (/missing authorit|no authorit|authority gap/.test(blob)) return "MISSING_AUTHORITY";
  if (/unsupported.+draft|draft assertion|unsupported assertion/.test(blob)) {
    return "UNSUPPORTED_DRAFT_ASSERTION";
  }
  if (/defense/.test(blob) || domain === "DEFENSES") return "DEFENSE_ELEMENT_GAP";
  if (/claim|element|evidence gap/.test(blob) || domain === "CLAIMS") return "CLAIM_ELEMENT_GAP";
  if (/hearing/.test(blob) || domain === "HEARING") return "HEARING_PREP_GAP";
  if (/deposition|follow-?up/.test(blob) || domain === "DEPOSITION") return "DEPOSITION_FOLLOWUP_GAP";
  if (/transcript/.test(blob)) return "TRANSCRIPT_FOLLOWUP_GAP";
  if (/motion/.test(blob) || domain === "MOTIONS") return "MOTION_SUPPORT_GAP";
  if (/overdue task/.test(blob) || domain === "TASKS") return "TASK_OVERDUE";
  if (/jurisdiction/.test(blob)) return "UNKNOWN_JURISDICTION";
  if (/procedural posture/.test(blob)) return "UNKNOWN_PROCEDURAL_POSTURE";
  if (/provenance/.test(blob)) return "PROVENANCE_GAP";
  if (domain === "DISCOVERY") return "DISCOVERY_DEFICIENCY";
  if (domain === "RESEARCH" || domain === "AUTHORITIES") return "MISSING_AUTHORITY";
  if (domain === "EVIDENCE") return "MISSING_EVIDENCE";
  return "MISSING_EVIDENCE";
}

function defaultPriority(gapType: InvestigateGapType): {
  priority: InvestigatePriority;
  rationale: string;
  impact: InvestigateImpact;
} {
  switch (gapType) {
    case "CLAIM_ELEMENT_GAP":
    case "DEFENSE_ELEMENT_GAP":
    case "CONFLICTING_EVIDENCE":
    case "DISCOVERY_DEFICIENCY":
    case "UNSUPPORTED_DRAFT_ASSERTION":
    case "TASK_OVERDUE":
      return {
        priority: "HIGH",
        rationale: "Required support or open conflict/deficiency remains unresolved on the record.",
        impact: "HIGH",
      };
    case "REFERENCED_BUT_UNLOCATED_DOCUMENT":
    case "MISSING_DOCUMENT":
    case "UNVERIFIED_AUTHORITY_TREATMENT":
    case "CONTRARY_AUTHORITY":
    case "HEARING_PREP_GAP":
    case "DEPOSITION_FOLLOWUP_GAP":
    case "MOTION_SUPPORT_GAP":
      return {
        priority: "HIGH",
        rationale: "Material workflow depends on locating/clarifying this record gap.",
        impact: "HIGH",
      };
    case "WEAK_EVIDENCE":
    case "MISSING_AUTHORITY":
    case "TIMELINE_GAP":
    case "UNANSWERED_DISCOVERY":
    case "UNIDENTIFIED_PERSON":
      return {
        priority: "MEDIUM",
        rationale: "Uncertainty affects analysis but is not currently an unsupported required element alone.",
        impact: "MEDIUM",
      };
    default:
      return {
        priority: "LOW",
        rationale: "Recorded uncertainty with limited demonstrated downstream impact.",
        impact: "LOW",
      };
  }
}

function inferEffort(gapType: InvestigateGapType, why: string): InvestigateEffort {
  if (/attachment|filename|already referenced|email refers/i.test(why)) return "LOW";
  if (
    gapType === "REFERENCED_BUT_UNLOCATED_DOCUMENT" ||
    gapType === "UNVERIFIED_AUTHORITY_TREATMENT"
  ) {
    return "LOW";
  }
  if (gapType === "UNIDENTIFIED_PERSON" || gapType === "UNKNOWN_ROLE") return "UNKNOWN";
  if (gapType === "TIMELINE_GAP" || gapType === "MISSING_AUTHORITY") return "MEDIUM";
  if (gapType === "DISCOVERY_DEFICIENCY" || gapType === "UNANSWERED_DISCOVERY") return "MEDIUM";
  return "UNKNOWN";
}

function inferAction(gapType: InvestigateGapType): ConversationalGap["actionType"] {
  switch (gapType) {
    case "MISSING_DOCUMENT":
    case "REFERENCED_BUT_UNLOCATED_DOCUMENT":
      return "LOCATE_DOCUMENT";
    case "CONFLICTING_EVIDENCE":
    case "WEAK_EVIDENCE":
      return "COMPARE_SOURCES";
    case "UNVERIFIED_AUTHORITY_TREATMENT":
    case "MISSING_AUTHORITY":
    case "CONTRARY_AUTHORITY":
      return "VERIFY_AUTHORITY";
    case "UNIDENTIFIED_PERSON":
    case "UNKNOWN_ROLE":
      return "IDENTIFY_PERSON";
    case "TIMELINE_GAP":
      return "CLARIFY_TIMELINE";
    case "DISCOVERY_DEFICIENCY":
    case "UNANSWERED_DISCOVERY":
      return "FOLLOW_UP_DISCOVERY";
    case "DEPOSITION_FOLLOWUP_GAP":
    case "TRANSCRIPT_FOLLOWUP_GAP":
      return "PREPARE_WITNESS_QUESTION";
    case "UNSUPPORTED_DRAFT_ASSERTION":
      return "RESEARCH_PROPOSITION";
    case "UNKNOWN_PROCEDURAL_POSTURE":
    case "MOTION_SUPPORT_GAP":
      return "VERIFY_PROCEDURAL_STATUS";
    case "MISSING_COMMUNICATION":
      return "TRACE_COMMUNICATION";
    case "PROVENANCE_GAP":
    case "SOURCE_QUALITY_GAP":
      return "CHECK_SOURCE_PROVENANCE";
    default:
      return "OTHER";
  }
}

export function normalizeCandidate(input: InvestigateCandidateInput, index: number): ConversationalGap {
  const gapType = input.gapType ?? inferGapType(input.title, input.why, input.domain);
  const defaults = defaultPriority(gapType);
  const relatedEntityIds = [...new Set(input.relatedEntityIds ?? [])].filter(Boolean);
  const sourceIds = [
    ...new Set((input.sourceRefs ?? []).map((s) => s.id).filter(Boolean)),
  ];
  const priority = input.priority ?? defaults.priority;
  const priorityRationale =
    input.priorityRationale ??
    (priority === "HIGH"
      ? defaults.rationale
      : defaults.rationale);
  return {
    id: `gap-${index + 1}`,
    gapType,
    title: input.title.slice(0, 200),
    description: input.why.slice(0, 600),
    whyItMatters: input.why.slice(0, 600),
    relatedDomain: input.domain,
    relatedEntityIds,
    sourceIds,
    factuality: input.factuality ?? "UNKNOWN",
    recommendedNextStep: (input.resolvesIf ?? "Locate or record source-backed support that closes this gap.").slice(
      0,
      400,
    ),
    expectedEvidenceType: input.expectedEvidenceType ?? null,
    priority,
    priorityRationale:
      priority === "HIGH" && !input.priorityRationale
        ? defaults.rationale
        : priorityRationale,
    impact: input.impact ?? defaults.impact,
    effort: input.effort ?? inferEffort(gapType, input.why),
    status: input.status ?? "OPEN",
    sourceMap: (input.sourceRefs ?? []).slice(0, 8),
    provenanceDomains: [input.domain],
    dedupeKey: buildDedupeKey({
      gapType,
      relatedEntityIds,
      sourceIds,
      title: input.title,
      why: input.why,
    }),
    actionType: input.actionType ?? inferAction(gapType),
  };
}

export function dedupeGaps(gaps: ConversationalGap[]): ConversationalGap[] {
  const byKey = new Map<string, ConversationalGap>();
  for (const gap of gaps) {
    const existing = byKey.get(gap.dedupeKey);
    if (!existing) {
      byKey.set(gap.dedupeKey, gap);
      continue;
    }
    const priorityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
    const preferNew = priorityRank[gap.priority] < priorityRank[existing.priority];
    const merged: ConversationalGap = {
      ...(preferNew ? gap : existing),
      relatedEntityIds: [...new Set([...existing.relatedEntityIds, ...gap.relatedEntityIds])],
      sourceIds: [...new Set([...existing.sourceIds, ...gap.sourceIds])],
      sourceMap: [...existing.sourceMap, ...gap.sourceMap]
        .filter((s, i, arr) => arr.findIndex((x) => x.kind === s.kind && x.id === s.id) === i)
        .slice(0, 12),
      provenanceDomains: [
        ...new Set([...existing.provenanceDomains, ...gap.provenanceDomains]),
      ],
      priority: preferNew ? gap.priority : existing.priority,
      priorityRationale: preferNew ? gap.priorityRationale : existing.priorityRationale,
      whyItMatters: preferNew ? gap.whyItMatters : existing.whyItMatters,
    };
    byKey.set(gap.dedupeKey, merged);
  }
  return [...byKey.values()];
}

function prioritySort(a: ConversationalGap, b: ConversationalGap): number {
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
  const impact = { HIGH: 0, MEDIUM: 1, LOW: 2, UNKNOWN: 3 } as const;
  if (impact[a.impact] !== impact[b.impact]) return impact[a.impact] - impact[b.impact];
  return a.title.localeCompare(b.title);
}

export function applyInvestigateFilters(
  gaps: ConversationalGap[],
  filters: InvestigateNextFilter,
): ConversationalGap[] {
  let out = gaps;
  if (filters.domains.length) {
    const set = new Set(filters.domains);
    out = out.filter(
      (g) => set.has(g.relatedDomain) || g.provenanceDomains.some((d) => set.has(d)),
    );
  }
  if (filters.priorityOnly) {
    out = out.filter((g) => g.priority === filters.priorityOnly);
  }
  if (filters.ignoreAuthority) {
    out = out.filter(
      (g) =>
        g.relatedDomain !== "AUTHORITIES" &&
        g.relatedDomain !== "RESEARCH" &&
        g.gapType !== "MISSING_AUTHORITY" &&
        g.gapType !== "UNVERIFIED_AUTHORITY_TREATMENT" &&
        g.gapType !== "CONTRARY_AUTHORITY",
    );
  }
  if (filters.missingDocumentsOnly) {
    out = out.filter(
      (g) =>
        g.gapType === "MISSING_DOCUMENT" ||
        g.gapType === "REFERENCED_BUT_UNLOCATED_DOCUMENT",
    );
  }
  if (filters.personIds.length) {
    const set = new Set(filters.personIds);
    out = out.filter((g) => g.relatedEntityIds.some((id) => set.has(id)));
  }
  if (filters.motionIds.length) {
    const set = new Set(filters.motionIds);
    out = out.filter((g) => g.relatedEntityIds.some((id) => set.has(id)));
  }
  if (filters.claimIds.length) {
    const set = new Set(filters.claimIds);
    out = out.filter((g) => g.relatedEntityIds.some((id) => set.has(id)));
  }
  if (filters.twoHourConstraint) {
    // Prefer grounded LOW effort; do not invent effort or pad with unsupported gaps.
    const lowEffort = out.filter((g) => g.effort === "LOW");
    out = lowEffort.length ? lowEffort : out.filter((g) => g.priority === "HIGH").slice(0, 3);
  }
  const limit = filters.topN ?? CAPS.returned;
  return out.slice(0, limit);
}

export function candidatesFromWholeMatter(wm: {
  investigateNext: Array<{
    id: string;
    priority: "high" | "medium" | "low";
    title: string;
    why: string;
    triggeredBy: Array<{ kind: string; id: string; label?: string | null }>;
    resolvesIf: string;
  }>;
  claims?: Array<{ claimId: string; label: string; openGaps: string[] }>;
  defenses?: Array<{ defenseId: string; label: string; openGaps: string[] }>;
  timeline?: Array<{ id: string; title: string; eventDate: string | null }>;
}): InvestigateCandidateInput[] {
  const out: InvestigateCandidateInput[] = [];
  for (const item of wm.investigateNext.slice(0, CAPS.candidatesPerDomain)) {
    const kinds = item.triggeredBy.map((t) => t.kind);
    let domain: InvestigateDomain = "WHOLE_MATTER";
    if (kinds.includes("defense")) domain = "DEFENSES";
    else if (kinds.includes("claim")) domain = "CLAIMS";
    else if (kinds.includes("discovery_deficiency")) domain = "DISCOVERY";
    else if (kinds.includes("motion")) domain = "MOTIONS";
    else if (kinds.includes("authority")) domain = "AUTHORITIES";
    else if (kinds.includes("task")) domain = "TASKS";
    else if (kinds.includes("communication")) domain = "COMMUNICATIONS";
    out.push({
      title: item.title,
      why: item.why,
      resolvesIf: item.resolvesIf,
      domain,
      relatedEntityIds: item.triggeredBy.map((t) => t.id),
      sourceRefs: item.triggeredBy.map((t) => ({
        kind: t.kind,
        id: t.id,
        label: t.label ?? null,
      })),
      priority: item.priority.toUpperCase() as InvestigatePriority,
      priorityRationale:
        item.priority === "high"
          ? item.why.slice(0, 240) || "High because the record shows an unresolved material gap."
          : undefined,
      factuality: "UNKNOWN",
    });
  }
  for (const ev of (wm.timeline ?? []).filter((e) => e.eventDate == null).slice(0, 4)) {
    out.push({
      title: `Clarify undated timeline event: ${ev.title}`,
      why: "Timeline event exists without an eventDate on the record.",
      resolvesIf: "Locate a source-backed date or mark the date unknown explicitly.",
      gapType: "TIMELINE_GAP",
      domain: "TIMELINE",
      relatedEntityIds: [ev.id],
      sourceRefs: [{ kind: "timeline_event", id: ev.id, label: ev.title }],
      expectedEvidenceType: "calendar entry / message / document version",
      effort: "MEDIUM",
    });
  }
  return out.slice(0, CAPS.candidatesPerDomain);
}

export function candidatesFromHearing(items: Array<{
  id: string;
  whyThisGapMatters: string;
  whatToLookFor: string;
  relatedEntity: { kind: string; id: string; label?: string } | null;
  gapBasis: Array<{ kind: string; id: string; label?: string }>;
  priority: "high" | "medium" | "low";
}>): InvestigateCandidateInput[] {
  return items.slice(0, CAPS.candidatesPerDomain).map((i) => ({
    title: i.whatToLookFor.slice(0, 160) || "Hearing preparation gap",
    why: i.whyThisGapMatters,
    resolvesIf: i.whatToLookFor,
    domain: "HEARING" as const,
    gapType: "HEARING_PREP_GAP" as const,
    relatedEntityIds: [
      ...(i.relatedEntity ? [i.relatedEntity.id] : []),
      ...i.gapBasis.map((g) => g.id),
    ],
    sourceRefs: [
      ...(i.relatedEntity
        ? [{ kind: i.relatedEntity.kind, id: i.relatedEntity.id, label: i.relatedEntity.label }]
        : []),
      ...i.gapBasis.map((g) => ({ kind: g.kind, id: g.id, label: g.label })),
    ],
    priority: i.priority.toUpperCase() as InvestigatePriority,
    priorityRationale:
      i.priority === "high"
        ? i.whyThisGapMatters.slice(0, 240)
        : undefined,
  }));
}

export function candidatesFromDeposition(items: Array<{
  id?: string;
  whatGap?: string;
  whyItMatters?: string;
  whyThisGapMatters?: string;
  whatToLookFor?: string;
  why?: string;
  title?: string;
  relatedEntity?: { kind: string; id: string; label?: string } | null;
  relatedEntityIds?: string[];
  sourceBasis?: Array<{ kind: string; id: string; label?: string }>;
  sources?: Array<{ kind: string; id: string; label?: string }>;
  priority?: "high" | "medium" | "low";
}>): InvestigateCandidateInput[] {
  return items.slice(0, CAPS.candidatesPerDomain).map((i) => ({
    title: (i.whatGap ?? i.title ?? i.whatToLookFor ?? "Deposition follow-up").slice(0, 160),
    why: i.whyItMatters ?? i.whyThisGapMatters ?? i.why ?? "Deposition-related gap on the record.",
    resolvesIf: i.whatToLookFor ?? "Locate corroborating record support.",
    domain: "DEPOSITION" as const,
    gapType: "DEPOSITION_FOLLOWUP_GAP" as const,
    relatedEntityIds: [
      ...(i.relatedEntity ? [i.relatedEntity.id] : []),
      ...(i.relatedEntityIds ?? []),
      ...(i.sourceBasis ?? i.sources ?? []).map((s) => s.id),
    ],
    sourceRefs: [
      ...(i.relatedEntity
        ? [{ kind: i.relatedEntity.kind, id: i.relatedEntity.id, label: i.relatedEntity.label }]
        : []),
      ...(i.sourceBasis ?? i.sources ?? []),
    ],
    priority: ((i.priority ?? "medium").toUpperCase() as InvestigatePriority),
    priorityRationale:
      i.priority === "high"
        ? (i.whyItMatters ?? i.whyThisGapMatters ?? i.why ?? "").slice(0, 240)
        : undefined,
  }));
}

export function candidatesFromResearch(items: Array<{
  whatIsMissing: string;
  whyItMatters: string;
  relatedDraftOrIssue?: string | null;
  relatedIssue?: string | null;
  sourceBasis: Array<{ kind: string; id: string; label?: string }>;
}>): InvestigateCandidateInput[] {
  return items.slice(0, CAPS.candidatesPerDomain).map((i) => ({
    title: i.whatIsMissing.slice(0, 160),
    why: i.whyItMatters,
    resolvesIf: `Obtain or verify: ${i.whatIsMissing}`,
    domain: "RESEARCH" as const,
    relatedEntityIds: i.sourceBasis.map((s) => s.id),
    sourceRefs: i.sourceBasis,
    gapType: /treatment/i.test(i.whatIsMissing)
      ? ("UNVERIFIED_AUTHORITY_TREATMENT" as const)
      : /contrary/i.test(i.whatIsMissing)
        ? ("CONTRARY_AUTHORITY" as const)
        : ("MISSING_AUTHORITY" as const),
  }));
}

export function candidatesFromDraft(params: {
  unsupportedRemoved?: string[];
  paragraphs?: Array<{
    id: string;
    text: string;
    assertionSupport: string;
    sources: Array<{ kind: string; id: string; label?: string }>;
  }>;
}): InvestigateCandidateInput[] {
  const out: InvestigateCandidateInput[] = [];
  for (const text of (params.unsupportedRemoved ?? []).slice(0, 6)) {
    out.push({
      title: `Unsupported draft assertion removed`,
      why: text.slice(0, 400),
      resolvesIf: "Locate source support before reintroducing the assertion.",
      gapType: "UNSUPPORTED_DRAFT_ASSERTION",
      domain: "DRAFT",
      priority: "HIGH",
      priorityRationale: "Draft assertion lacked source support and was removed.",
      factuality: "UNSUPPORTED",
    });
  }
  for (const p of (params.paragraphs ?? []).filter((x) => x.assertionSupport === "UNSUPPORTED").slice(0, 6)) {
    out.push({
      title: `Unsupported draft paragraph ${p.id}`,
      why: p.text.slice(0, 400),
      resolvesIf: "Add source-backed facts or remove the assertion.",
      gapType: "UNSUPPORTED_DRAFT_ASSERTION",
      domain: "DRAFT",
      relatedEntityIds: [p.id],
      sourceRefs: p.sources,
      priority: "HIGH",
      priorityRationale: "Draft paragraph is marked UNSUPPORTED on the record.",
      factuality: "UNSUPPORTED",
    });
  }
  return out.slice(0, CAPS.candidatesPerDomain);
}

export function detectChangeSet(
  current: ConversationalGap[],
  prior: ConversationalGap[] | null | undefined,
): InvestigateNextChangeSet | null {
  if (!prior || prior.length === 0) return null;
  const priorKeys = new Map(prior.map((g) => [g.dedupeKey, g]));
  const currentKeys = new Map(current.map((g) => [g.dedupeKey, g]));
  const newGaps: string[] = [];
  const unchangedGaps: string[] = [];
  const worsenedGaps: string[] = [];
  for (const [key, gap] of currentKeys) {
    const old = priorKeys.get(key);
    if (!old) {
      newGaps.push(gap.id);
      continue;
    }
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
    if (rank[gap.priority] < rank[old.priority]) worsenedGaps.push(gap.id);
    else unchangedGaps.push(gap.id);
  }
  const resolvedGaps = [...priorKeys.keys()]
    .filter((k) => !currentKeys.has(k))
    .map((k) => priorKeys.get(k)!.id);
  return { newGaps, resolvedGaps, worsenedGaps, unchangedGaps };
}

export function resolveInvestigateGapReferent(params: {
  question: string;
  priorGaps: ConversationalGap[];
}): InvestigateGapReferentResolution {
  const q = params.question.trim();
  const numbered = q.match(/#(\d+)\b/);
  if (numbered) {
    const n = Number(numbered[1]);
    const hit = params.priorGaps.find((g) => g.id === `gap-${n}`) ?? params.priorGaps[n - 1];
    if (hit) return { status: "RESOLVED", gap: hit };
    return {
      status: "NOT_FOUND",
      clarificationPrompt: `Gap #${n} is not available in the prior investigate-next result.`,
    };
  }
  const attachment = /\bmissing attachment\b/i.test(q);
  const timeline = /\btimeline issue\b/i.test(q);
  const authority = /\bauthority gap\b/i.test(q);
  const discovery = /\bdiscovery (gap|deficiency)\b/i.test(q);
  let pool = params.priorGaps;
  if (attachment) {
    pool = pool.filter(
      (g) =>
        g.gapType === "REFERENCED_BUT_UNLOCATED_DOCUMENT" ||
        /attachment/i.test(g.title + g.description),
    );
  } else if (timeline) {
    pool = pool.filter((g) => g.gapType === "TIMELINE_GAP" || /timeline/i.test(g.title));
  } else if (authority) {
    pool = pool.filter(
      (g) =>
        g.gapType === "MISSING_AUTHORITY" ||
        g.gapType === "UNVERIFIED_AUTHORITY_TREATMENT" ||
        g.gapType === "CONTRARY_AUTHORITY",
    );
  } else if (discovery) {
    pool = pool.filter(
      (g) => g.gapType === "DISCOVERY_DEFICIENCY" || g.gapType === "UNANSWERED_DISCOVERY",
    );
  } else if (!/\b(the|that)\b/i.test(q)) {
    return {
      status: "NOT_FOUND",
      clarificationPrompt: "No gap referent matched the prior investigate-next result.",
    };
  }
  if (pool.length === 1) return { status: "RESOLVED", gap: pool[0]! };
  if (pool.length > 1) {
    return {
      status: "AMBIGUOUS",
      candidates: pool.slice(0, 6),
      clarificationPrompt:
        "Multiple gaps match. Which one?\n" +
        pool
          .slice(0, 6)
          .map((g, i) => `${i + 1}. ${g.id} ${g.title}`)
          .join("\n"),
    };
  }
  return {
    status: "NOT_FOUND",
    clarificationPrompt: "That gap referent was not found in the prior investigate-next result.",
  };
}

export function buildInvestigateTaskPreview(params: {
  gap: ConversationalGap;
  matterId: string;
  question: string;
  explicitDueAt?: string | null;
}): InvestigateTaskPreview {
  return {
    title: `Investigate: ${params.gap.title}`.slice(0, 200),
    description: params.gap.recommendedNextStep,
    whyItMatters: params.gap.whyItMatters,
    relatedEntityIds: params.gap.relatedEntityIds.slice(0, 8),
    linkedSourceIds: params.gap.sourceIds.slice(0, 8),
    gapId: params.gap.id,
    gapType: params.gap.gapType,
    proposedDueAt: params.explicitDueAt ?? null,
    matterId: params.matterId,
  };
}

export function buildInvestigateNextResult(params: {
  question: string;
  matterId: string;
  candidates: InvestigateCandidateInput[];
  filters?: Partial<InvestigateNextFilter>;
  priorGaps?: ConversationalGap[] | null;
  personIds?: string[];
  motionIds?: string[];
  claimIds?: string[];
}): InvestigateNextResult {
  const limitations = [
    "Investigate-next is derived from the matter record only — no generic litigation checklist.",
    "No CourtListener calls. No invented documents, people, deadlines, or authorities.",
    "Priority rationale is record-grounded; effort is UNKNOWN unless a concrete path is known.",
    "Creating a task does not resolve a gap.",
  ];
  const parsed = parseInvestigateFilters(params.question);
  const filters: InvestigateNextFilter = {
    ...parsed,
    ...params.filters,
    personIds: params.filters?.personIds ?? params.personIds ?? parsed.personIds,
    motionIds: params.filters?.motionIds ?? params.motionIds ?? parsed.motionIds,
    claimIds: params.filters?.claimIds ?? params.claimIds ?? parsed.claimIds,
    domains: params.filters?.domains ?? parsed.domains,
  };

  if (GENERIC_CHECKLIST.test(params.question)) {
    return {
      posture: "NO_MATERIAL_GAP",
      scope: `matter:${params.matterId}`,
      gaps: [],
      candidateCount: 0,
      dedupedCount: 0,
      returnedCount: 0,
      domainsConsidered: [],
      filters,
      changeSet: null,
      sourceMap: [],
      limitations: [
        ...limitations,
        "Rejected generic checklist request — recommendations require matter-grounded gaps.",
      ],
      genericChecklistLeakage: 0,
      inventedUrgency: 0,
    };
  }

  const capped = params.candidates.slice(0, CAPS.candidatesTotal);
  const normalized = capped.map((c, i) => normalizeCandidate(c, i));
  // Reject HIGH without rationale
  for (const g of normalized) {
    if (g.priority === "HIGH" && !g.priorityRationale.trim()) {
      g.priorityRationale = defaultPriority(g.gapType).rationale;
    }
  }
  const deduped = dedupeGaps(normalized).sort(prioritySort);
  // Re-number stable display ids after dedupe/sort
  const numbered = deduped.map((g, i) => ({ ...g, id: `gap-${i + 1}` }));
  const filtered = applyInvestigateFilters(numbered, filters);
  const domainsConsidered = [
    ...new Set(normalized.map((g) => g.relatedDomain)),
  ] as InvestigateDomain[];

  const changeSet = detectChangeSet(numbered, params.priorGaps);

  if (numbered.length === 0) {
    return {
      posture: "NO_MATERIAL_GAP",
      scope: `matter:${params.matterId}`,
      gaps: [],
      candidateCount: capped.length,
      dedupedCount: 0,
      returnedCount: 0,
      domainsConsidered,
      filters,
      changeSet,
      sourceMap: [],
      limitations: [
        ...limitations,
        "No additional high-priority investigation gap is supported by the current record.",
      ],
      genericChecklistLeakage: 0,
      inventedUrgency: 0,
    };
  }

  if (filtered.length === 0) {
    return {
      posture: "FILTERED_EMPTY",
      scope: `matter:${params.matterId}`,
      gaps: [],
      candidateCount: capped.length,
      dedupedCount: numbered.length,
      returnedCount: 0,
      domainsConsidered,
      filters,
      changeSet,
      sourceMap: numbered.flatMap((g) => g.sourceMap).slice(0, CAPS.sourceMap),
      limitations: [
        ...limitations,
        "Filters removed all grounded gaps; no replacement gaps were invented.",
      ],
      genericChecklistLeakage: 0,
      inventedUrgency: 0,
    };
  }

  const sourceMap = filtered
    .flatMap((g) => g.sourceMap)
    .filter((s, i, arr) => arr.findIndex((x) => x.kind === s.kind && x.id === s.id) === i)
    .slice(0, CAPS.sourceMap);

  return {
    posture: "RESOLVED",
    scope: `matter:${params.matterId}`,
    gaps: filtered,
    candidateCount: capped.length,
    dedupedCount: numbered.length,
    returnedCount: filtered.length,
    domainsConsidered,
    filters,
    changeSet,
    sourceMap,
    limitations,
    genericChecklistLeakage: 0,
    inventedUrgency: 0,
  };
}

export function formatInvestigateNextForPrompt(result: InvestigateNextResult): string {
  if (result.posture === "NO_MATERIAL_GAP") {
    return [
      "INVESTIGATE_NEXT:",
      "No additional high-priority investigation gap is supported by the current record.",
      ...result.limitations.map((l) => `LIMITATION: ${l}`),
    ].join("\n");
  }
  if (result.posture === "FILTERED_EMPTY") {
    return [
      "INVESTIGATE_NEXT:",
      "Filters removed all grounded gaps; no unsupported recommendations were added.",
      ...result.limitations.map((l) => `LIMITATION: ${l}`),
    ].join("\n");
  }
  const lines = [
    "INVESTIGATE_NEXT:",
    `SCOPE: ${result.scope}`,
    `CANDIDATES: ${result.candidateCount} DEDUPED: ${result.dedupedCount} RETURNED: ${result.returnedCount}`,
    `DOMAINS: ${result.domainsConsidered.join(",") || "none"}`,
    ...result.gaps.map(
      (g, i) =>
        `${i + 1}. ${g.id} [${g.priority}/${g.gapType}] ${g.title} WHY=${g.whyItMatters} LOOK_FOR=${g.recommendedNextStep} IMPACT=${g.impact} EFFORT=${g.effort} RATIONALE=${g.priorityRationale} SOURCES=${g.sourceIds.slice(0, 4).join(",") || "none"} DOMAINS=${g.provenanceDomains.join(",")}`,
    ),
  ];
  if (result.changeSet) {
    lines.push(
      `CHANGE_DETECTION: NEW=${result.changeSet.newGaps.join(",") || "none"} RESOLVED=${result.changeSet.resolvedGaps.join(",") || "none"} WORSENED=${result.changeSet.worsenedGaps.join(",") || "none"} UNCHANGED=${result.changeSet.unchangedGaps.length}`,
    );
  }
  lines.push(...result.limitations.map((l) => `LIMITATION: ${l}`));
  return lines.join("\n");
}

export function formatInvestigateNextAnswer(result: InvestigateNextResult): string {
  return formatInvestigateNextForPrompt(result);
}

/** Snapshot stored under ai_artifacts.validation.investigateNext (no schema migration). */
export function toInvestigateNextValidationSnapshot(result: InvestigateNextResult): Record<string, unknown> {
  return {
    posture: result.posture,
    candidateCount: result.candidateCount,
    dedupedCount: result.dedupedCount,
    returnedCount: result.returnedCount,
    domainsConsidered: result.domainsConsidered,
    filters: result.filters,
    changeSet: result.changeSet,
    genericChecklistLeakage: 0,
    inventedUrgency: 0,
    gaps: result.gaps.map((g) => ({
      id: g.id,
      gapType: g.gapType,
      title: g.title,
      description: g.description,
      whyItMatters: g.whyItMatters,
      relatedDomain: g.relatedDomain,
      relatedEntityIds: g.relatedEntityIds,
      sourceIds: g.sourceIds,
      factuality: g.factuality,
      recommendedNextStep: g.recommendedNextStep,
      expectedEvidenceType: g.expectedEvidenceType,
      priority: g.priority,
      priorityRationale: g.priorityRationale,
      impact: g.impact,
      effort: g.effort,
      status: g.status,
      sourceMap: g.sourceMap,
      provenanceDomains: g.provenanceDomains,
      dedupeKey: g.dedupeKey,
      actionType: g.actionType,
    })),
    sourceMap: result.sourceMap,
    limitations: result.limitations,
  };
}

export function parsePriorInvestigateGaps(raw: unknown): ConversationalGap[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const gaps = Array.isArray(obj.gaps) ? obj.gaps : [];
  const out: ConversationalGap[] = [];
  for (const row of gaps) {
    if (!row || typeof row !== "object") continue;
    const g = row as Record<string, unknown>;
    if (typeof g.id !== "string" || typeof g.title !== "string") continue;
    out.push({
      id: g.id,
      gapType: (typeof g.gapType === "string" ? g.gapType : "MISSING_EVIDENCE") as InvestigateGapType,
      title: g.title,
      description: typeof g.description === "string" ? g.description : g.title,
      whyItMatters: typeof g.whyItMatters === "string" ? g.whyItMatters : "",
      relatedDomain: (typeof g.relatedDomain === "string"
        ? g.relatedDomain
        : "WHOLE_MATTER") as InvestigateDomain,
      relatedEntityIds: Array.isArray(g.relatedEntityIds)
        ? g.relatedEntityIds.filter((x): x is string => typeof x === "string")
        : [],
      sourceIds: Array.isArray(g.sourceIds)
        ? g.sourceIds.filter((x): x is string => typeof x === "string")
        : [],
      factuality: (typeof g.factuality === "string" ? g.factuality : "UNKNOWN") as InvestigateFactuality,
      recommendedNextStep:
        typeof g.recommendedNextStep === "string" ? g.recommendedNextStep : "",
      expectedEvidenceType:
        typeof g.expectedEvidenceType === "string" ? g.expectedEvidenceType : null,
      priority: (typeof g.priority === "string" ? g.priority : "MEDIUM") as InvestigatePriority,
      priorityRationale: typeof g.priorityRationale === "string" ? g.priorityRationale : "",
      impact: (typeof g.impact === "string" ? g.impact : "UNKNOWN") as InvestigateImpact,
      effort: (typeof g.effort === "string" ? g.effort : "UNKNOWN") as InvestigateEffort,
      status: (typeof g.status === "string" ? g.status : "OPEN") as InvestigateGapStatus,
      sourceMap: Array.isArray(g.sourceMap)
        ? (g.sourceMap as InvestigateSourceRef[])
        : [],
      provenanceDomains: Array.isArray(g.provenanceDomains)
        ? (g.provenanceDomains as InvestigateDomain[])
        : [],
      dedupeKey: typeof g.dedupeKey === "string" ? g.dedupeKey : g.id,
      actionType: (typeof g.actionType === "string" ? g.actionType : "OTHER") as ConversationalGap["actionType"],
    });
  }
  return out;
}
