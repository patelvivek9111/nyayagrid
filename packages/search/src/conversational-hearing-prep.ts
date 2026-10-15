/**
 * Oct 19–25 Phase 1 — Conversational hearing preparation (deterministic).
 * Reuses motion/claim/discovery/authority matter records. No shared schema.
 * CourtListener: 0.
 */

export const HEARING_PREP_SUPPORT_STATES = [
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "CONFLICTED",
  "UNSUPPORTED",
  "UNKNOWN",
] as const;
export type HearingPrepSupportState = (typeof HEARING_PREP_SUPPORT_STATES)[number];

export const HEARING_PREP_FACTUALITY = [
  "FACT",
  "SUPPORTED_INFERENCE",
  "CONFLICT",
  "UNKNOWN",
  "UNSUPPORTED",
] as const;
export type HearingPrepFactuality = (typeof HEARING_PREP_FACTUALITY)[number];

export type HearingPrepMotionInput = {
  id: string;
  title: string;
  motionType: string;
  status: string;
  disposition: string | null;
  filedAt: string | null;
  hearingAt: string | null;
  rulingAt: string | null;
  rulingSummary: string | null;
  relatedClaimIds: string[];
  relatedDeficiencyIds: string[];
  relatedEvidenceIds: string[];
  relatedCommunicationIds: string[];
  matterId?: string;
};

export type HearingPrepClaimInput = {
  id: string;
  label: string;
  supportStatus?: string | null;
  description?: string | null;
};

export type HearingPrepEvidenceInput = {
  id: string;
  label: string;
  supportsClaimIds?: string[];
  contradictsClaimIds?: string[];
  documentId?: string | null;
};

export type HearingPrepAuthorityInput = {
  id: string;
  label: string;
  resolution: "IDENTITY_UNRESOLVED" | "AUTHORITY_RESOLVED" | "CORPUS_COMPLETE" | string;
  treatmentVerified: boolean;
  citationText?: string | null;
};

export type HearingPrepCommunicationInput = {
  id: string;
  subject: string;
  summary: string | null;
  relatedMotionIds?: string[];
};

export type HearingPrepTimelineInput = {
  id: string;
  title: string;
  eventDate: string | null;
  eventType?: string | null;
};

export type HearingPrepDeficiencyInput = {
  id: string;
  description: string;
  status: string;
  motionId?: string | null;
};

export type HearingPrepSourceRef = {
  kind:
    | "document"
    | "motion"
    | "claim"
    | "evidence"
    | "authority"
    | "communication"
    | "timeline"
    | "deficiency"
    | "task";
  id: string;
  label: string;
};

export type HearingPrepIssue = {
  id: string;
  label: string;
  supportState: HearingPrepSupportState;
  factuality: HearingPrepFactuality;
  ourPosition: string;
  opposingPositionFromRecord: string | null;
  opposingFactuality: HearingPrepFactuality | null;
  sources: HearingPrepSourceRef[];
};

export type HearingPrepInvestigateItem = {
  id: string;
  whyThisGapMatters: string;
  whatToLookFor: string;
  relatedEntity: HearingPrepSourceRef | null;
  gapBasis: HearingPrepSourceRef[];
  priority: "high" | "medium" | "low";
};

export type HearingPrepResult = {
  hearingTarget: {
    motionId: string | null;
    label: string;
    status: string | null;
    disposition: string | null;
    hearingAt: string | null;
    filedAt: string | null;
    rulingAt: string | null;
    posture:
      | "NO_MOTION"
      | "MOTION_FILED_NO_HEARING_DATE"
      | "HEARING_SCHEDULED"
      | "MOTION_DECIDED"
      | "AMBIGUOUS"
      | "UNKNOWN";
  };
  issuesBeforeCourt: HearingPrepIssue[];
  strongestFacts: Array<{ text: string; factuality: HearingPrepFactuality; sources: HearingPrepSourceRef[] }>;
  weakestPoints: Array<{ text: string; supportState: HearingPrepSupportState; sources: HearingPrepSourceRef[] }>;
  keyEvidence: HearingPrepSourceRef[];
  conflictsInRecord: Array<{ text: string; factuality: "CONFLICT"; sources: HearingPrepSourceRef[] }>;
  authorities: Array<{
    id: string;
    label: string;
    resolution: string;
    treatmentStatus: "VERIFIED" | "NOT_VERIFIED";
    note: string;
  }>;
  possibleJudgeQuestions: Array<{ question: string; groundedIn: string; sources: HearingPrepSourceRef[] }>;
  unsupportedOrUnknown: Array<{ text: string; factuality: HearingPrepFactuality }>;
  investigateBeforeHearing: HearingPrepInvestigateItem[];
  sourceMap: HearingPrepSourceRef[];
  limitations: string[];
  outlinePreview: string | null;
  compressedOralArgument: string | null;
};

export type HearingPrepBuildParams = {
  question: string;
  matterId: string;
  motions: HearingPrepMotionInput[];
  claims?: HearingPrepClaimInput[];
  evidence?: HearingPrepEvidenceInput[];
  authorities?: HearingPrepAuthorityInput[];
  communications?: HearingPrepCommunicationInput[];
  timeline?: HearingPrepTimelineInput[];
  deficiencies?: HearingPrepDeficiencyInput[];
  /** Resolved motion id from referent layer; null if none. */
  resolvedMotionId?: string | null;
  /** Ambiguous motion candidates — must not auto-pick. */
  ambiguousMotionIds?: string[];
  /** Foreign matter ids that must be rejected if present on inputs. */
  foreignMatterId?: string | null;
  focusIssue?: string | null;
  outlineRequested?: boolean;
  compressMinutes?: number | null;
};

const TERMINAL = new Set(["GRANTED", "DENIED", "GRANTED_IN_PART", "WITHDRAWN", "MOOT"]);

export function isHearingPrepQuestion(question: string): boolean {
  const q = question.trim();
  return (
    /\b(prepare|prep)\b.+\b(hearing|oral argument|argument)\b/i.test(q) ||
    /\bhearing prep(aration)?\b/i.test(q) ||
    /\b(prepare me for|prep me for)\b.+\b(hearing|tomorrow|court)\b/i.test(q) ||
    /\b(strongest|weakest)\b.+\b(motion|argument|hearing)\b/i.test(q) ||
    /\bwhat (facts|evidence) will opposing counsel attack\b/i.test(q) ||
    /\bquestions?\b.+\b(judge|court)\b/i.test(q) ||
    /\b(hearing outline|oral argument version|5-minute version|2-minute version)\b/i.test(q) ||
    /\binvestigate before (the )?hearing\b/i.test(q)
  );
}

export function isHearingOutlineRequest(question: string): boolean {
  return /\b(hearing outline|turn (this|that) into an outline|outline for (the )?hearing)\b/i.test(
    question,
  );
}

export function isHearingCompressionRequest(question: string): number | null {
  const m = question.match(/\b(\d+)\s*[- ]?\s*minute\b/i);
  if (m) return Number(m[1]);
  if (/\b(bullet version|just the points|shorter oral argument)\b/i.test(question)) return 5;
  return null;
}

export function motionPosture(motion: HearingPrepMotionInput | null): HearingPrepResult["hearingTarget"]["posture"] {
  if (!motion) return "NO_MOTION";
  if (motion.disposition || TERMINAL.has(motion.status) || motion.rulingAt) return "MOTION_DECIDED";
  if (motion.hearingAt) return "HEARING_SCHEDULED";
  if (motion.filedAt || motion.status) return "MOTION_FILED_NO_HEARING_DATE";
  return "UNKNOWN";
}

function supportFromClaim(status: string | null | undefined): HearingPrepSupportState {
  const s = String(status ?? "").toUpperCase();
  if (s.includes("FULL") || s === "SUPPORTED") return "SUPPORTED";
  if (s.includes("PARTIAL")) return "PARTIALLY_SUPPORTED";
  if (s.includes("CONFLICT")) return "CONFLICTED";
  if (s.includes("UNSUPPORT")) return "UNSUPPORTED";
  return "UNKNOWN";
}

function factualityFromSupport(state: HearingPrepSupportState): HearingPrepFactuality {
  if (state === "SUPPORTED") return "FACT";
  if (state === "PARTIALLY_SUPPORTED") return "SUPPORTED_INFERENCE";
  if (state === "CONFLICTED") return "CONFLICT";
  if (state === "UNSUPPORTED") return "UNSUPPORTED";
  return "UNKNOWN";
}

function uniqSources(refs: HearingPrepSourceRef[]): HearingPrepSourceRef[] {
  const seen = new Set<string>();
  const out: HearingPrepSourceRef[] = [];
  for (const r of refs) {
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function selectHearingMotionTarget(params: {
  motions: HearingPrepMotionInput[];
  resolvedMotionId?: string | null;
  ambiguousMotionIds?: string[];
  question: string;
}): { motion: HearingPrepMotionInput | null; ambiguous: HearingPrepMotionInput[]; posture: HearingPrepResult["hearingTarget"]["posture"] } {
  if (params.ambiguousMotionIds && params.ambiguousMotionIds.length > 1) {
    const amb = params.motions.filter((m) => params.ambiguousMotionIds!.includes(m.id));
    return { motion: null, ambiguous: amb, posture: "AMBIGUOUS" };
  }
  if (params.resolvedMotionId) {
    const hit = params.motions.find((m) => m.id === params.resolvedMotionId) ?? null;
    return { motion: hit, ambiguous: [], posture: motionPosture(hit) };
  }

  const q = params.question.toLowerCase();
  let pool = [...params.motions];
  if (/\bcompel\b/.test(q)) pool = pool.filter((m) => /compel/i.test(m.motionType) || /compel/i.test(m.title));
  if (/\bsummary judgment\b|\bsj hearing\b/.test(q)) {
    pool = pool.filter((m) => /summary/i.test(m.motionType) || /summary/i.test(m.title));
  }
  if (/\btomorrow|upcoming hearing|this hearing\b/.test(q)) {
    const withHearing = pool.filter((m) => m.hearingAt);
    if (withHearing.length === 1) {
      return { motion: withHearing[0]!, ambiguous: [], posture: motionPosture(withHearing[0]!) };
    }
    if (withHearing.length > 1) {
      return { motion: null, ambiguous: withHearing, posture: "AMBIGUOUS" };
    }
  }
  // Outline / compression transforms require an already-resolved target — do not auto-pick.
  if (
    (/\boutline\b/i.test(q) || /\bminute\b/i.test(q) || /\bbullet version\b/i.test(q)) &&
    !params.resolvedMotionId
  ) {
    if (pool.length === 1) return { motion: pool[0]!, ambiguous: [], posture: motionPosture(pool[0]!) };
    if (pool.length > 1) return { motion: null, ambiguous: pool, posture: "AMBIGUOUS" };
  }
  if (pool.length === 1) return { motion: pool[0]!, ambiguous: [], posture: motionPosture(pool[0]!) };
  if (pool.length > 1) return { motion: null, ambiguous: pool, posture: "AMBIGUOUS" };
  return { motion: null, ambiguous: [], posture: "NO_MOTION" };
}

export function buildHearingPrepResult(params: HearingPrepBuildParams): HearingPrepResult {
  const foreignId = params.foreignMatterId ?? null;
  const motions = params.motions.filter((m) => !foreignId || m.matterId !== foreignId);
  const claims = params.claims ?? [];
  const evidence = (params.evidence ?? []).filter((e) => !String(e.id).startsWith("foreign:"));
  const authorities = params.authorities ?? [];
  const communications = params.communications ?? [];
  const timeline = params.timeline ?? [];
  const deficiencies = params.deficiencies ?? [];

  const selected = selectHearingMotionTarget({
    motions,
    resolvedMotionId: params.resolvedMotionId,
    ambiguousMotionIds: params.ambiguousMotionIds,
    question: params.question,
  });

  const limitations = [
    "Hearing preparation evaluates the matter record; it does not advocate for the user's assumption.",
    "Questions the record suggests you should be prepared to address — not predictions of what any judge will ask.",
    "Authority treatment remains NOT VERIFIED unless treatmentVerified=true on the matter record.",
    "No CourtListener calls were made for this preparation.",
  ];

  if (selected.posture === "AMBIGUOUS") {
    return {
      hearingTarget: {
        motionId: null,
        label: "Ambiguous hearing/motion target",
        status: null,
        disposition: null,
        hearingAt: null,
        filedAt: null,
        rulingAt: null,
        posture: "AMBIGUOUS",
      },
      issuesBeforeCourt: [],
      strongestFacts: [],
      weakestPoints: [],
      keyEvidence: [],
      conflictsInRecord: [],
      authorities: [],
      possibleJudgeQuestions: [],
      unsupportedOrUnknown: [
        {
          text: "Multiple motions/hearings match. Clarify which motion or hearing to prepare.",
          factuality: "UNKNOWN",
        },
      ],
      investigateBeforeHearing: [],
      sourceMap: selected.ambiguous.map((m) => ({
        kind: "motion" as const,
        id: m.id,
        label: m.title,
      })),
      limitations,
      outlinePreview: null,
      compressedOralArgument: null,
    };
  }

  const motion = selected.motion;
  const focus = (params.focusIssue ?? "").trim().toLowerCase();
  // Focus overrides related-claim filter so multi-turn "focus only on X" can narrow across claims.
  let relatedClaims = claims;
  if (focus) {
    relatedClaims = claims.filter((c) => c.label.toLowerCase().includes(focus));
  } else if (motion && motion.relatedClaimIds.length > 0) {
    relatedClaims = claims.filter((c) => motion.relatedClaimIds.includes(c.id));
    if (relatedClaims.length === 0) relatedClaims = claims;
  }

  const issues: HearingPrepIssue[] = relatedClaims.map((c) => {
    const supportState = supportFromClaim(c.supportStatus);
    const supportingEv = evidence.filter((e) => (e.supportsClaimIds ?? []).includes(c.id));
    const contradictingEv = evidence.filter((e) => (e.contradictsClaimIds ?? []).includes(c.id));
    const sources: HearingPrepSourceRef[] = [
      { kind: "claim", id: c.id, label: c.label },
      ...supportingEv.map((e) => ({
        kind: "evidence" as const,
        id: e.id,
        label: e.label,
      })),
      ...(motion
        ? [{ kind: "motion" as const, id: motion.id, label: motion.title }]
        : []),
    ];
    let opposing: string | null = null;
    let opposingFactuality: HearingPrepFactuality | null = null;
    if (contradictingEv.length) {
      opposing = `Record conflict: ${contradictingEv.map((e) => e.label).join("; ")}`;
      opposingFactuality = "CONFLICT";
      sources.push(
        ...contradictingEv.map((e) => ({ kind: "evidence" as const, id: e.id, label: e.label })),
      );
    } else {
      const oppComms = communications.filter((c0) =>
        (c0.relatedMotionIds ?? []).includes(motion?.id ?? ""),
      );
      if (oppComms.length) {
        opposing = oppComms[0]!.summary || oppComms[0]!.subject;
        opposingFactuality = "SUPPORTED_INFERENCE";
        sources.push({
          kind: "communication",
          id: oppComms[0]!.id,
          label: oppComms[0]!.subject,
        });
      }
    }
    return {
      id: c.id,
      label: c.label,
      supportState: contradictingEv.length ? "CONFLICTED" : supportState,
      factuality: contradictingEv.length ? "CONFLICT" : factualityFromSupport(supportState),
      ourPosition: c.description?.trim() || `Record support status: ${supportState}.`,
      opposingPositionFromRecord: opposing,
      opposingFactuality,
      sources: uniqSources(sources),
    };
  });

  if (motion && issues.length === 0) {
    issues.push({
      id: motion.id,
      label: motion.title,
      supportState: "UNKNOWN",
      factuality: "UNKNOWN",
      ourPosition: `Motion status ${motion.status}` + (motion.disposition ? `; disposition ${motion.disposition}` : ""),
      opposingPositionFromRecord: null,
      opposingFactuality: null,
      sources: [{ kind: "motion", id: motion.id, label: motion.title }],
    });
  }

  const strongestFacts = issues
    .filter((i) => i.supportState === "SUPPORTED" || i.supportState === "PARTIALLY_SUPPORTED")
    .map((i) => ({
      text: i.label,
      factuality: i.factuality,
      sources: i.sources,
    }));

  const weakestPoints = issues
    .filter((i) =>
      ["PARTIALLY_SUPPORTED", "CONFLICTED", "UNSUPPORTED", "UNKNOWN"].includes(i.supportState),
    )
    .map((i) => ({
      text: `${i.label} is ${i.supportState.replace(/_/g, " ").toLowerCase()}.`,
      supportState: i.supportState,
      sources: i.sources,
    }));

  const conflictsInRecord = issues
    .filter((i) => i.factuality === "CONFLICT")
    .map((i) => ({
      text: i.opposingPositionFromRecord || `Conflict affecting ${i.label}`,
      factuality: "CONFLICT" as const,
      sources: i.sources,
    }));

  const keyEvidence = uniqSources(
    evidence.map((e) => ({ kind: "evidence" as const, id: e.id, label: e.label })),
  );

  const authorityRows = authorities.map((a) => ({
    id: a.id,
    label: a.label,
    resolution: a.resolution,
    treatmentStatus: (a.treatmentVerified ? "VERIFIED" : "NOT_VERIFIED") as "VERIFIED" | "NOT_VERIFIED",
    note:
      a.resolution === "IDENTITY_UNRESOLVED"
        ? "Identity unresolved — not a verified authority."
        : a.resolution === "AUTHORITY_RESOLVED"
          ? "Identity resolved; full-opinion analysis is not implied."
          : a.resolution === "CORPUS_COMPLETE"
            ? "Corpus-complete text may support full-text-grounded analysis."
            : "Authority state taken from matter record.",
  }));

  const relatedDefs = motion
    ? deficiencies.filter((d) => d.motionId === motion.id || motion.relatedDeficiencyIds.includes(d.id))
    : deficiencies;

  const investigate: HearingPrepInvestigateItem[] = [];
  for (const issue of issues) {
    if (issue.supportState === "UNSUPPORTED" || issue.supportState === "UNKNOWN") {
      investigate.push({
        id: `gap-claim-${issue.id}`,
        whyThisGapMatters: `${issue.label} lacks clear record support for hearing argument.`,
        whatToLookFor: "Supporting documents, admissions, or verified facts tied to this issue.",
        relatedEntity: { kind: "claim", id: issue.id, label: issue.label },
        gapBasis: issue.sources,
        priority: "high",
      });
    }
    if (issue.supportState === "CONFLICTED") {
      investigate.push({
        id: `gap-conflict-${issue.id}`,
        whyThisGapMatters: `Record conflict on ${issue.label} creates argument pressure.`,
        whatToLookFor: "Reconcile or explain conflicting evidence without credibility leaps.",
        relatedEntity: { kind: "claim", id: issue.id, label: issue.label },
        gapBasis: issue.sources,
        priority: "high",
      });
    }
  }
  for (const d of relatedDefs.filter((x) => /open|partial|pending/i.test(x.status))) {
    investigate.push({
      id: `gap-def-${d.id}`,
      whyThisGapMatters: "Open discovery deficiency may undermine hearing readiness.",
      whatToLookFor: d.description,
      relatedEntity: { kind: "deficiency", id: d.id, label: d.description.slice(0, 80) },
      gapBasis: [{ kind: "deficiency", id: d.id, label: d.description.slice(0, 80) }],
      priority: "high",
    });
  }
  for (const a of authorityRows.filter((x) => x.treatmentStatus === "NOT_VERIFIED")) {
    investigate.push({
      id: `gap-auth-${a.id}`,
      whyThisGapMatters: "Authority treatment is not verified on the matter record.",
      whatToLookFor: "Verified treatment status or alternative controlling authority with treatmentVerified=true.",
      relatedEntity: { kind: "authority", id: a.id, label: a.label },
      gapBasis: [{ kind: "authority", id: a.id, label: a.label }],
      priority: "medium",
    });
  }
  if (motion && !motion.hearingAt && selected.posture === "MOTION_FILED_NO_HEARING_DATE") {
    investigate.push({
      id: `gap-hearing-date-${motion.id}`,
      whyThisGapMatters: "Motion is on the record but no hearing date is stored.",
      whatToLookFor: "Confirm hearing scheduling from a source-backed calendar/order — do not invent a date.",
      relatedEntity: { kind: "motion", id: motion.id, label: motion.title },
      gapBasis: [{ kind: "motion", id: motion.id, label: motion.title }],
      priority: "medium",
    });
  }

  const possibleJudgeQuestions = [
    ...issues
      .filter((i) => i.supportState !== "SUPPORTED")
      .slice(0, 4)
      .map((i) => ({
        question: `How does the record support ${i.label}, given its ${i.supportState.replace(/_/g, " ").toLowerCase()} posture?`,
        groundedIn: `Gap/support state for ${i.label}`,
        sources: i.sources,
      })),
    ...relatedDefs.slice(0, 2).map((d) => ({
      question: `What is the status of outstanding discovery (${d.description.slice(0, 60)})?`,
      groundedIn: "Open discovery deficiency on the matter record",
      sources: [{ kind: "deficiency" as const, id: d.id, label: d.description.slice(0, 80) }],
    })),
    ...authorityRows
      .filter((a) => a.treatmentStatus === "NOT_VERIFIED")
      .slice(0, 2)
      .map((a) => ({
        question: `What is the verified treatment status of ${a.label}?`,
        groundedIn: "treatmentVerified=false on matter authority",
        sources: [{ kind: "authority" as const, id: a.id, label: a.label }],
      })),
  ];

  const unsupportedOrUnknown = [
    ...issues
      .filter((i) => i.supportState === "UNSUPPORTED" || i.supportState === "UNKNOWN")
      .map((i) => ({
        text: i.label,
        factuality: i.factuality,
      })),
    ...(motion?.disposition
      ? []
      : motion && TERMINAL.has(motion.status)
        ? []
        : [
            {
              text: "Hearing outcome is unknown; motion is not described as granted or denied without a disposition.",
              factuality: "UNKNOWN" as const,
            },
          ]),
  ];

  if (selected.posture === "MOTION_DECIDED") {
    limitations.push(
      "This motion already has a disposition/ruling on the record — preparation must not rewrite that ruling.",
    );
  }

  const sourceMap = uniqSources([
    ...(motion ? [{ kind: "motion" as const, id: motion.id, label: motion.title }] : []),
    ...issues.flatMap((i) => i.sources),
    ...keyEvidence,
    ...authorityRows.map((a) => ({ kind: "authority" as const, id: a.id, label: a.label })),
    ...timeline.slice(0, 8).map((t) => ({ kind: "timeline" as const, id: t.id, label: t.title })),
  ]);

  let outlinePreview: string | null = null;
  if (params.outlineRequested || isHearingOutlineRequest(params.question)) {
    outlinePreview = buildHearingOutlineText({
      motion,
      issues,
      possibleJudgeQuestions,
      weakestPoints,
      authorities: authorityRows,
    });
  }

  let compressedOralArgument: string | null = null;
  const minutes = params.compressMinutes ?? isHearingCompressionRequest(params.question);
  if (minutes != null) {
    compressedOralArgument = compressHearingPrep({
      minutes,
      motion,
      issues,
      strongestFacts,
      weakestPoints,
    });
  }

  return {
    hearingTarget: {
      motionId: motion?.id ?? null,
      label: motion?.title ?? "No hearing/motion target resolved",
      status: motion?.status ?? null,
      disposition: motion?.disposition ?? null,
      hearingAt: motion?.hearingAt ?? null,
      filedAt: motion?.filedAt ?? null,
      rulingAt: motion?.rulingAt ?? null,
      posture: selected.posture,
    },
    issuesBeforeCourt: issues,
    strongestFacts,
    weakestPoints,
    keyEvidence,
    conflictsInRecord,
    authorities: authorityRows,
    possibleJudgeQuestions,
    unsupportedOrUnknown,
    investigateBeforeHearing: investigate,
    sourceMap,
    limitations,
    outlinePreview,
    compressedOralArgument,
  };
}

export function buildHearingOutlineText(params: {
  motion: HearingPrepMotionInput | null;
  issues: HearingPrepIssue[];
  possibleJudgeQuestions: HearingPrepResult["possibleJudgeQuestions"];
  weakestPoints: HearingPrepResult["weakestPoints"];
  authorities: HearingPrepResult["authorities"];
}): string {
  const lines: string[] = [
    "HEARING OUTLINE (DRAFT PREVIEW — not saved)",
    params.motion ? `Target: ${params.motion.title} (${params.motion.status})` : "Target: unresolved",
    "",
    "Opening framing:",
    `- Address the issues actually presented by ${params.motion?.title ?? "the motion/hearing target"}.`,
    "",
    "Issues:",
    ...params.issues.map((i) => `- ${i.label} [${i.supportState}]`),
    "",
    "Key factual points:",
    ...params.issues
      .filter((i) => i.supportState === "SUPPORTED" || i.supportState === "PARTIALLY_SUPPORTED")
      .map((i) => `- ${i.label}: ${i.ourPosition}`),
    "",
    "Authority (treatment honesty):",
    ...params.authorities.map(
      (a) => `- ${a.label}: ${a.resolution}; treatment ${a.treatmentStatus}`,
    ),
    "",
    "Anticipated counterarguments from the record:",
    ...params.issues
      .filter((i) => i.opposingPositionFromRecord)
      .map((i) => `- ${i.opposingPositionFromRecord} [${i.opposingFactuality}]`),
    "",
    "Questions to be prepared for:",
    ...params.possibleJudgeQuestions.map((q) => `- ${q.question}`),
    "",
    "Weak points to address:",
    ...params.weakestPoints.map((w) => `- ${w.text}`),
  ];
  return lines.join("\n");
}

export function compressHearingPrep(params: {
  minutes: number;
  motion: HearingPrepMotionInput | null;
  issues: HearingPrepIssue[];
  strongestFacts: HearingPrepResult["strongestFacts"];
  weakestPoints: HearingPrepResult["weakestPoints"];
}): string {
  const limit = params.minutes <= 2 ? 3 : params.minutes <= 5 ? 5 : 8;
  const lines = [
    `${params.minutes}-MINUTE ORAL ARGUMENT POINTS (compressed from hearing prep; no new facts)`,
    params.motion ? `Motion: ${params.motion.title}` : "Motion: unresolved",
    ...params.strongestFacts.slice(0, limit).map((f, i) => `${i + 1}. ${f.text} [${f.factuality}]`),
    ...params.weakestPoints.slice(0, 2).map((w) => `Address: ${w.text}`),
  ];
  // Compression must not invent relief or outcomes.
  if (params.motion?.disposition) {
    lines.push(`Record disposition (do not rewrite): ${params.motion.disposition}`);
  }
  return lines.join("\n");
}

export function formatHearingPrepForPrompt(result: HearingPrepResult): string {
  const lines = [
    "HEARING_PREPARATION_RECORD (deterministic; evaluate the record — do not advocate)",
    `Target: ${result.hearingTarget.label}`,
    `Posture: ${result.hearingTarget.posture}`,
    `Status: ${result.hearingTarget.status ?? "UNKNOWN"}`,
    `Disposition: ${result.hearingTarget.disposition ?? "none"}`,
    `HearingAt: ${result.hearingTarget.hearingAt ?? "UNKNOWN (do not invent)"}`,
    "",
    "Issues:",
    ...result.issuesBeforeCourt.map(
      (i) =>
        `- ${i.label} | support=${i.supportState} | factuality=${i.factuality}` +
        (i.opposingPositionFromRecord
          ? ` | opposing_from_record=${i.opposingPositionFromRecord} (${i.opposingFactuality})`
          : " | opposing_from_record=NONE"),
    ),
    "",
    "Investigate before hearing:",
    ...result.investigateBeforeHearing.map(
      (g) => `- [${g.priority}] ${g.whyThisGapMatters} → ${g.whatToLookFor}`,
    ),
    "",
    "Possible questions to prepare for (not predictions of what the judge will ask):",
    ...result.possibleJudgeQuestions.map((q) => `- ${q.question} (grounded: ${q.groundedIn})`),
    "",
    "Authorities:",
    ...result.authorities.map(
      (a) => `- ${a.label} | ${a.resolution} | treatment=${a.treatmentStatus} | ${a.note}`,
    ),
    "",
    "Limitations:",
    ...result.limitations.map((l) => `- ${l}`),
  ];
  if (result.outlinePreview) {
    lines.push("", "Outline preview:", result.outlinePreview);
  }
  if (result.compressedOralArgument) {
    lines.push("", "Compressed oral argument:", result.compressedOralArgument);
  }
  return lines.join("\n");
}

export function hearingPrepRejectsGenericChecklist(result: HearingPrepResult): boolean {
  const text = result.investigateBeforeHearing.map((i) => i.whyThisGapMatters).join(" ");
  return !/always review local rules|generic checklist|brainstorm unrelated/i.test(text);
}

/** Extract multi-turn issue focus from conversational follow-ups. */
export function extractHearingFocusIssue(question: string): string | null {
  const m =
    question.match(/\bfocus (?:only )?on\s+(.+?)(?:[.?!]|$)/i) ||
    question.match(/\bonly (?:about|on)\s+(.+?)(?:[.?!]|$)/i);
  if (!m?.[1]) return null;
  return m[1].trim().replace(/^the\s+/i, "").slice(0, 80) || null;
}

/** Domains hearing prep should force into the bounded context router. */
export function hearingPrepForceDomains(): Array<
  "MOTIONS" | "CLAIMS" | "DISCOVERY" | "COMMUNICATIONS" | "AUTHORITIES" | "EVIDENCE"
> {
  return ["MOTIONS", "CLAIMS", "DISCOVERY", "COMMUNICATIONS", "AUTHORITIES", "EVIDENCE"];
}
