/**
 * Oct 19–25 Phase 5 — Cross-workflow conversational chaining + matter-intelligence deepening.
 * Deterministic transitions, "turn that into" resolution, readiness, what-changed.
 * No CourtListener. No shared schema.
 */

import type { ConversationWorkingState } from "./conversation-context";

export const WORKFLOW_KINDS = [
  "MATTER_ANALYSIS",
  "HEARING_PREP",
  "DEPOSITION_PREP",
  "DEPOSITION_ANALYSIS",
  "DRAFT",
  "RESEARCH",
  "INVESTIGATE_NEXT",
  "MOTION",
  "DISCOVERY",
  "COMMUNICATIONS",
  "TIMELINE",
  "EVIDENCE",
  "TASK",
  "UNKNOWN",
] as const;
export type WorkflowKind = (typeof WORKFLOW_KINDS)[number];

export const TRANSFORM_TARGETS = [
  "DRAFT",
  "TASK",
  "RESEARCH",
  "HEARING_OUTLINE",
  "DEPOSITION_OUTLINE",
  "INVESTIGATE_NEXT",
] as const;
export type TransformTarget = (typeof TRANSFORM_TARGETS)[number];

export const SOURCE_ARTIFACT_KINDS = [
  "hearingPrep",
  "depositionPrep",
  "depositionAnalysis",
  "research",
  "draft",
  "investigateNext",
  "wholeMatter",
  "motion",
  "document",
  "person",
  "gap",
] as const;
export type SourceArtifactKind = (typeof SOURCE_ARTIFACT_KINDS)[number];

export type ReadinessState =
  | "SUPPORTED"
  | "PARTIALLY_SUPPORTED"
  | "CONFLICTED"
  | "UNSUPPORTED"
  | "UNKNOWN";

export type ElementReadiness = {
  id: string;
  label: string;
  kind: "claim" | "defense";
  supportStatus: string;
  readiness: ReadinessState;
  openGaps: string[];
  sourceIds: string[];
};

export type MatterSynthesis = {
  coreIssues: string[];
  strongestSupported: string[];
  weakestAreas: string[];
  keyFacts: string[];
  keyEvidence: string[];
  keyPeople: string[];
  conflicts: string[];
  unknowns: string[];
  claimReadiness: ElementReadiness[];
  defenseReadiness: ElementReadiness[];
  recentChanges: string[];
  investigateNextTitles: string[];
  limitations: string[];
  credibilityScoring: 0;
  winProbability: 0;
};

export type WhatChangedResult = {
  available: boolean;
  unavailableReason: string | null;
  newFacts: string[];
  newEvidence: string[];
  newConflicts: string[];
  resolvedConflicts: string[];
  newGaps: string[];
  resolvedGaps: string[];
  claimImpact: string[];
  defenseImpact: string[];
  motionImpact: string[];
  researchImpact: string[];
};

export type TurnThatIntoResolution =
  | {
      status: "RESOLVED";
      sourceArtifact: SourceArtifactKind;
      sourceLabel: string;
      sourceIds: string[];
      target: TransformTarget;
      forceDomains: string[];
    }
  | {
      status: "AMBIGUOUS_SOURCE" | "AMBIGUOUS_TARGET" | "AMBIGUOUS_BOTH";
      sources: Array<{ kind: SourceArtifactKind; label: string }>;
      targets: TransformTarget[];
      clarificationPrompt: string;
    }
  | { status: "NOT_FOUND"; clarificationPrompt: string };

export type WorkflowTransition = {
  from: WorkflowKind;
  to: WorkflowKind;
  explicit: boolean;
};

export type ActiveContextFocus = {
  lastWorkflowKind: WorkflowKind;
  activeClaimIds: string[];
  activeDefenseIds: string[];
  activeMotionIds: string[];
  activePersonIds: string[];
  activeSourceIds: string[];
  activeAuthorityIds: string[];
  activeDraftIds: string[];
  activeResearchIssueIds: string[];
  activeInvestigateGapIds: string[];
  activeHearingMotionIds: string[];
  activeDepositionPersonIds: string[];
};

const GENERIC_WIN =
  /\b(win probability|likelihood of winning|chance we win|will we win|case score|credibility score)\b/i;

export function detectWorkflowIntent(question: string): WorkflowKind {
  const q = question.trim();
  if (/\b(what should (i|we) investigate|investigate next|biggest holes|still missing)\b/i.test(q)) {
    return "INVESTIGATE_NEXT";
  }
  if (/\b(prepare|prep).+\b(hearing|oral argument)\b|\bhearing prep\b/i.test(q)) return "HEARING_PREP";
  if (
    /\b(prepare|prep)\b.+\b(deposition|depose|witness)\b|\bdepose\b|\bdeposition prep\b/i.test(q)
  ) {
    return "DEPOSITION_PREP";
  }
  if (/\b(admission|testimony|what came out of the deposition)\b/i.test(q)) {
    return "DEPOSITION_ANALYSIS";
  }
  if (/\b(research|what authority|authorities? (for|support))\b/i.test(q)) return "RESEARCH";
  if (/\b(draft|rewrite|factual (background|section)|argument section)\b/i.test(q)) return "DRAFT";
  if (/\b(create|add|make|turn .+ into)\b.+\btask\b|\bturn #?\d+ into a task\b/i.test(q)) {
    return "TASK";
  }
  if (/\b(motion|ruling|disposition)\b/i.test(q) && !/\bhearing\b/i.test(q)) return "MOTION";
  if (/\b(discovery|deficienc|interrogator|RFP)\b/i.test(q)) return "DISCOVERY";
  if (/\b(email|communication|message)\b/i.test(q)) return "COMMUNICATIONS";
  if (/\b(timeline|what happened after)\b/i.test(q)) return "TIMELINE";
  if (/\b(evidence|exhibit|document)\b/i.test(q)) return "EVIDENCE";
  if (
    /\b(what is the case|whole matter|strongest|weakest|core issue|what changed|matter status)\b/i.test(
      q,
    )
  ) {
    return "MATTER_ANALYSIS";
  }
  return "UNKNOWN";
}

export function isTurnThatIntoRequest(question: string): boolean {
  return /\bturn (that|this|it|those|#?\d+)\b.+\binto\b/i.test(question) || /\bturn that into\b/i.test(question);
}

export function detectTransformTargets(question: string): TransformTarget[] {
  const q = question.trim();
  const targets: TransformTarget[] = [];
  if (/\binto (an? )?(draft|argument|factual|section|memo)\b/i.test(q) || /\bdraft\b/i.test(q) && /\binto\b/i.test(q)) {
    targets.push("DRAFT");
  }
  if (/\binto (a )?task\b|\bturn #?\d+ into a task\b/i.test(q)) targets.push("TASK");
  if (/\binto (a )?research\b|\bresearch (it|that|this)\b/i.test(q)) targets.push("RESEARCH");
  if (/\binto (a )?hearing (prep |outline )?|hearing outline\b/i.test(q)) targets.push("HEARING_OUTLINE");
  if (/\binto (a )?deposition (prep |outline )?|deposition outline\b/i.test(q)) {
    targets.push("DEPOSITION_OUTLINE");
  }
  if (/\binto (an? )?investigate|investigate(-| )?next\b/i.test(q)) targets.push("INVESTIGATE_NEXT");
  // Bare "turn that into..." with no target → empty (ambiguous target)
  if (/\bturn that into\s*\.?$/i.test(q) || /\bturn that into\s*$/i.test(q)) {
    return [];
  }
  return [...new Set(targets)];
}

export function collectAvailableSourceArtifacts(params: {
  workingState: ConversationWorkingState;
  priorValidation?: Record<string, unknown> | null;
}): Array<{ kind: SourceArtifactKind; label: string; ids: string[] }> {
  const out: Array<{ kind: SourceArtifactKind; label: string; ids: string[] }> = [];
  const v = params.priorValidation ?? {};
  const ws = params.workingState;

  if (v.hearingPrep && typeof v.hearingPrep === "object") {
    const hp = v.hearingPrep as Record<string, unknown>;
    out.push({
      kind: "hearingPrep",
      label: typeof hp.motionId === "string" ? `Hearing prep (${hp.motionId})` : "Hearing prep",
      ids: typeof hp.motionId === "string" ? [hp.motionId] : ws.activeMotionIds.slice(0, 1),
    });
  } else if (ws.activeMotionIds.length && ws.lastWorkflowKind === "HEARING_PREP") {
    out.push({
      kind: "hearingPrep",
      label: "Active hearing/motion",
      ids: ws.activeMotionIds.slice(0, 1),
    });
  }

  if (v.depositionPrep && typeof v.depositionPrep === "object") {
    const dp = v.depositionPrep as Record<string, unknown>;
    out.push({
      kind: "depositionPrep",
      label: typeof dp.personId === "string" ? `Deposition prep (${dp.personId})` : "Deposition prep",
      ids: typeof dp.personId === "string" ? [dp.personId] : ws.activePersonIds.slice(0, 1),
    });
  } else if (ws.activePersonIds.length && (ws.lastWorkflowKind === "DEPOSITION_PREP" || ws.lastWorkflowKind === "DEPOSITION_ANALYSIS")) {
    out.push({
      kind: "depositionPrep",
      label: "Active deponent",
      ids: ws.activePersonIds.slice(0, 1),
    });
  }

  if (v.matterResearch && typeof v.matterResearch === "object") {
    const mr = v.matterResearch as Record<string, unknown>;
    out.push({
      kind: "research",
      label: typeof mr.issueLabel === "string" ? `Research: ${mr.issueLabel}` : "Research result",
      ids: typeof mr.issueId === "string" ? [mr.issueId] : ws.activeResearchIssueIds.slice(0, 1),
    });
  } else if (ws.activeResearchIssueIds.length) {
    out.push({ kind: "research", label: "Active research issue", ids: ws.activeResearchIssueIds.slice(0, 1) });
  }

  if (v.matterDraft && typeof v.matterDraft === "object") {
    const md = v.matterDraft as Record<string, unknown>;
    out.push({
      kind: "draft",
      label: typeof md.draftId === "string" ? `Draft ${md.draftId}` : "Draft preview",
      ids: typeof md.draftId === "string" ? [md.draftId] : ws.activeDraftIds.slice(0, 1),
    });
  } else if (ws.activeDraftIds.length) {
    out.push({ kind: "draft", label: "Active draft", ids: ws.activeDraftIds.slice(0, 1) });
  }

  if (v.investigateNext && typeof v.investigateNext === "object") {
    const inv = v.investigateNext as Record<string, unknown>;
    const gaps = Array.isArray(inv.gaps) ? inv.gaps : [];
    out.push({
      kind: "investigateNext",
      label: `Investigate-next (${gaps.length} gaps)`,
      ids: ws.activeInvestigateGapIds.slice(0, 4),
    });
  } else if (ws.activeInvestigateGapIds.length) {
    out.push({
      kind: "investigateNext",
      label: "Active investigation gaps",
      ids: ws.activeInvestigateGapIds.slice(0, 4),
    });
  }

  if (ws.activeSourceIds.length === 1) {
    out.push({ kind: "document", label: "Active document", ids: ws.activeSourceIds.slice(0, 1) });
  }
  if (ws.activePersonIds.length === 1 && !out.some((o) => o.kind === "depositionPrep")) {
    out.push({ kind: "person", label: "Active person", ids: ws.activePersonIds.slice(0, 1) });
  }
  if (ws.activeMotionIds.length === 1 && !out.some((o) => o.kind === "hearingPrep")) {
    out.push({ kind: "motion", label: "Active motion", ids: ws.activeMotionIds.slice(0, 1) });
  }

  return out;
}

export function resolveTurnThatInto(params: {
  question: string;
  workingState: ConversationWorkingState;
  priorValidation?: Record<string, unknown> | null;
}): TurnThatIntoResolution {
  if (!isTurnThatIntoRequest(params.question)) {
    return { status: "NOT_FOUND", clarificationPrompt: "No turn-that-into transform requested." };
  }

  const targets = detectTransformTargets(params.question);
  const sources = collectAvailableSourceArtifacts({
    workingState: params.workingState,
    priorValidation: params.priorValidation,
  });

  // Gap ordinal: turn #2 into a task
  const gapOrdinal = params.question.match(/#(\d+)/);
  if (gapOrdinal && targets.includes("TASK")) {
    const n = Number(gapOrdinal[1]);
    const gapId =
      params.workingState.activeInvestigateGapIds.find((id) => id === `gap-${n}`) ??
      params.workingState.activeInvestigateGapIds[n - 1];
    if (gapId) {
      return {
        status: "RESOLVED",
        sourceArtifact: "gap",
        sourceLabel: gapId,
        sourceIds: [gapId],
        target: "TASK",
        forceDomains: ["TASKS", "CLAIMS", "EVIDENCE"],
      };
    }
  }

  const uniqueSource = sources.length === 1 ? sources[0]! : null;
  const uniqueTarget = targets.length === 1 ? targets[0]! : null;

  const targetCompatible: Partial<Record<TransformTarget, SourceArtifactKind[]>> = {
    HEARING_OUTLINE: ["hearingPrep", "motion"],
    DEPOSITION_OUTLINE: ["depositionPrep", "person"],
    TASK: ["investigateNext", "gap", "hearingPrep", "depositionPrep"],
    DRAFT: ["research", "draft", "hearingPrep", "depositionPrep", "investigateNext"],
    RESEARCH: ["research", "motion", "hearingPrep", "depositionPrep", "document"],
    INVESTIGATE_NEXT: ["investigateNext", "hearingPrep", "motion", "depositionPrep", "document"],
  };

  // Prefer last workflow artifact when multiple sources
  let preferredSource = uniqueSource;
  if (!preferredSource && sources.length > 1) {
    // Explicit target wins: narrow to compatible sources (NO_AUTO_PICK only if still >1).
    if (uniqueTarget) {
      const allowed = targetCompatible[uniqueTarget] ?? [];
      const compatible = sources.filter((s) => allowed.includes(s.kind));
      if (compatible.length === 1) preferredSource = compatible[0]!;
      else if (compatible.length > 1) {
        const last = params.workingState.lastWorkflowKind as WorkflowKind | null;
        const map: Partial<Record<WorkflowKind, SourceArtifactKind>> = {
          HEARING_PREP: "hearingPrep",
          DEPOSITION_PREP: "depositionPrep",
          DEPOSITION_ANALYSIS: "depositionPrep",
          RESEARCH: "research",
          DRAFT: "draft",
          INVESTIGATE_NEXT: "investigateNext",
          MOTION: "motion",
        };
        const want = last && last in map ? map[last] : undefined;
        const hit = want ? compatible.filter((s) => s.kind === want) : [];
        if (hit.length === 1) preferredSource = hit[0]!;
        else if (compatible[0] && allowed[0] && compatible.filter((s) => s.kind === allowed[0]).length === 1) {
          preferredSource = compatible.find((s) => s.kind === allowed[0])!;
        }
      }
    }
    if (!preferredSource) {
      const last = params.workingState.lastWorkflowKind as WorkflowKind | null;
      const map: Partial<Record<WorkflowKind, SourceArtifactKind>> = {
        HEARING_PREP: "hearingPrep",
        DEPOSITION_PREP: "depositionPrep",
        DEPOSITION_ANALYSIS: "depositionPrep",
        RESEARCH: "research",
        DRAFT: "draft",
        INVESTIGATE_NEXT: "investigateNext",
        MOTION: "motion",
      };
      const want = last && last in map ? map[last] : undefined;
      const hit = want ? sources.filter((s) => s.kind === want) : [];
      if (hit.length === 1) preferredSource = hit[0]!;
    }
  }

  if ((!preferredSource && sources.length !== 1) || (targets.length !== 1 && !uniqueTarget)) {
    const status =
      sources.length > 1 && targets.length !== 1
        ? "AMBIGUOUS_BOTH"
        : sources.length > 1 || !preferredSource
          ? "AMBIGUOUS_SOURCE"
          : "AMBIGUOUS_TARGET";
    const targetChoices: TransformTarget[] =
      targets.length > 0 ? targets : ["DRAFT", "TASK", "RESEARCH", "HEARING_OUTLINE", "DEPOSITION_OUTLINE", "INVESTIGATE_NEXT"];
    return {
      status,
      sources: sources.map((s) => ({ kind: s.kind, label: s.label })),
      targets: targetChoices,
      clarificationPrompt: [
        "Ambiguous transform — which source and target?",
        "Sources:",
        ...(sources.length
          ? sources.map((s, i) => `${i + 1}. ${s.kind}: ${s.label}`)
          : ["(none active)"]),
        "Targets:",
        ...targetChoices.map((t, i) => `${i + 1}. ${t}`),
      ].join("\n"),
    };
  }

  if (!preferredSource || !uniqueTarget) {
    return {
      status: "NOT_FOUND",
      clarificationPrompt: "Could not resolve source artifact and target workflow for this transform.",
    };
  }

  const forceByTarget: Record<TransformTarget, string[]> = {
    DRAFT: ["DRAFT", "CLAIMS", "EVIDENCE", "AUTHORITIES"],
    TASK: ["TASKS", "CLAIMS", "EVIDENCE"],
    RESEARCH: ["RESEARCH", "AUTHORITIES", "CLAIMS"],
    HEARING_OUTLINE: ["MOTIONS", "CLAIMS", "DISCOVERY", "COMMUNICATIONS"],
    DEPOSITION_OUTLINE: ["DEPOSITION", "EVIDENCE", "CLAIMS", "TIMELINE"],
    INVESTIGATE_NEXT: ["WHOLE_MATTER", "CLAIMS", "EVIDENCE", "DISCOVERY"],
  };

  return {
    status: "RESOLVED",
    sourceArtifact: preferredSource.kind,
    sourceLabel: preferredSource.label,
    sourceIds: preferredSource.ids,
    target: uniqueTarget,
    forceDomains: forceByTarget[uniqueTarget],
  };
}

export function detectWorkflowTransition(params: {
  question: string;
  priorWorkflow: WorkflowKind | null | undefined;
}): WorkflowTransition | null {
  const to = detectWorkflowIntent(params.question);
  const from = params.priorWorkflow ?? "UNKNOWN";
  if (to === "UNKNOWN" || from === to) return null;
  const allowed: Array<[WorkflowKind, WorkflowKind]> = [
    ["HEARING_PREP", "INVESTIGATE_NEXT"],
    ["INVESTIGATE_NEXT", "DEPOSITION_PREP"],
    ["INVESTIGATE_NEXT", "TASK"],
    ["DEPOSITION_PREP", "DRAFT"],
    ["DEPOSITION_PREP", "RESEARCH"],
    ["DEPOSITION_ANALYSIS", "DRAFT"],
    ["DEPOSITION_ANALYSIS", "RESEARCH"],
    ["RESEARCH", "DRAFT"],
    ["DRAFT", "RESEARCH"],
    ["DRAFT", "INVESTIGATE_NEXT"],
    ["MOTION", "HEARING_PREP"],
    ["DISCOVERY", "DEPOSITION_PREP"],
    ["COMMUNICATIONS", "INVESTIGATE_NEXT"],
    ["TIMELINE", "DEPOSITION_PREP"],
    ["EVIDENCE", "DRAFT"],
    ["MATTER_ANALYSIS", "INVESTIGATE_NEXT"],
    ["MATTER_ANALYSIS", "HEARING_PREP"],
  ];
  const explicit = allowed.some(([a, b]) => a === from && b === to);
  return { from, to, explicit };
}

export function applyFocusInvalidation(params: {
  question: string;
  state: ConversationWorkingState;
}): ConversationWorkingState {
  const q = params.question;
  let next = { ...params.state };

  const switchPerson = /\b(switch to|focus on|prepare)\b.+\b(witness|deponent|person)\b|\bprepare (him|her)\b|\babout (john|jordan|alex)\b/i.test(
    q,
  );
  const switchMotion = /\b(switch to|focus on|prepare)\b.+\bmotion\b|\bdifferent motion\b|\binstead .+ motion\b/i.test(
    q,
  );
  const switchIssue =
    /\b(switch to|focus on|instead)\b.+\b(claim|issue|defense)\b/i.test(q) ||
    /\bwhat about claim\b/i.test(q) ||
    /\bclaim [bB]\b/i.test(q);
  const switchDoc = /\b(switch to|focus on|open)\b.+\b(document|email|exhibit)\b/i.test(q);

  if (switchPerson) {
    // Clear deposition-adjacent continuity that would wrongly bind the old person
    next = { ...next, activePersonIds: [] };
  }
  if (switchMotion) {
    next = { ...next, activeMotionIds: [] };
  }
  if (switchIssue) {
    next = {
      ...next,
      activeClaimIds: [],
      activeDefenseIds: [],
      activeResearchIssueIds: [],
    };
  }
  if (switchDoc) {
    next = { ...next, activeSourceIds: [] };
  }
  return next;
}

export function detectMaterialCrossWorkflowFocusChange(params: {
  priorPending: {
    activeSnapshot: Record<string, string[]>;
    previewPayload: Record<string, unknown>;
  } | null;
  question: string;
  workingState: ConversationWorkingState;
}): boolean {
  if (!params.priorPending) return false;
  if (/\b(instead|different|never ?mind|switch to|focus on)\b/i.test(params.question)) {
    return true;
  }
  const snap = params.priorPending.activeSnapshot;
  const drift = (key: string, active: string[]) => {
    const prior = snap[key]?.[0];
    if (!prior) return false;
    if (active.length === 0) return true;
    return active[0] !== prior || !active.includes(prior);
  };
  return (
    drift("persons", params.workingState.activePersonIds) ||
    drift("drafts", params.workingState.activeDraftIds) ||
    drift("researchIssues", params.workingState.activeResearchIssueIds) ||
    drift("investigateGaps", params.workingState.activeInvestigateGapIds) ||
    drift("claims", params.workingState.activeClaimIds) ||
    drift("motions", params.workingState.activeMotionIds)
  );
}

export function mapSupportToReadiness(supportStatus: string, openGaps: string[]): ReadinessState {
  const s = supportStatus.toUpperCase();
  if (/CONFLICT|CONTRADICT/.test(s) || openGaps.some((g) => /conflict/i.test(g))) return "CONFLICTED";
  if (s === "SUPPORTED" || s === "ESTABLISHED") return "SUPPORTED";
  if (s === "PARTIALLY_SUPPORTED" || s === "PARTIAL") return "PARTIALLY_SUPPORTED";
  if (s === "NO_EVIDENCE_FOUND" || s === "UNSUPPORTED") return "UNSUPPORTED";
  return "UNKNOWN";
}

export function projectClaimDefenseReadiness(params: {
  claims?: Array<{ claimId: string; label: string; supportStatus: string; openGaps: string[]; supportingEvidenceIds?: string[] }>;
  defenses?: Array<{ defenseId: string; label: string; supportStatus: string; openGaps: string[]; supportingEvidenceIds?: string[] }>;
}): { claims: ElementReadiness[]; defenses: ElementReadiness[] } {
  const claims = (params.claims ?? []).slice(0, 12).map((c) => ({
    id: c.claimId,
    label: c.label,
    kind: "claim" as const,
    supportStatus: c.supportStatus,
    readiness: mapSupportToReadiness(c.supportStatus, c.openGaps),
    openGaps: c.openGaps.slice(0, 5),
    sourceIds: (c.supportingEvidenceIds ?? []).slice(0, 8),
  }));
  const defenses = (params.defenses ?? []).slice(0, 12).map((d) => ({
    id: d.defenseId,
    label: d.label,
    kind: "defense" as const,
    supportStatus: d.supportStatus,
    readiness: mapSupportToReadiness(d.supportStatus, d.openGaps),
    openGaps: d.openGaps.slice(0, 5),
    sourceIds: (d.supportingEvidenceIds ?? []).slice(0, 8),
  }));
  return { claims, defenses };
}

export function buildMatterSynthesis(params: {
  question: string;
  claims?: Array<{ claimId: string; label: string; supportStatus: string; openGaps: string[]; supportingEvidenceIds?: string[] }>;
  defenses?: Array<{ defenseId: string; label: string; supportStatus: string; openGaps: string[]; supportingEvidenceIds?: string[] }>;
  contradictions?: Array<{ description: string }>;
  investigateNext?: Array<{ title: string; why: string }>;
  parties?: Array<{ displayName: string }>;
  propositions?: Array<{ text?: string; kind?: string }>;
  priorChangeLines?: string[];
}): MatterSynthesis {
  const readiness = projectClaimDefenseReadiness({
    claims: params.claims,
    defenses: params.defenses,
  });
  const strongest = readiness.claims
    .filter((c) => c.readiness === "SUPPORTED" || c.readiness === "PARTIALLY_SUPPORTED")
    .map((c) => `${c.label}: ${c.readiness}`)
    .slice(0, 6);
  const weakest = [
    ...readiness.claims.filter((c) => c.readiness === "UNSUPPORTED" || c.readiness === "UNKNOWN" || c.openGaps.length),
    ...readiness.defenses.filter((d) => d.readiness === "UNSUPPORTED" || d.readiness === "UNKNOWN" || d.openGaps.length),
  ]
    .map((x) => `${x.label}: ${x.readiness}${x.openGaps[0] ? ` — ${x.openGaps[0]}` : ""}`)
    .slice(0, 8);

  const limitations = [
    "Matter synthesis is derived from structured matter records only.",
    "No credibility scores, win probabilities, or invented legal elements.",
    "Primary matter sources outrank Memory when they conflict.",
  ];
  if (GENERIC_WIN.test(params.question)) {
    limitations.push("Win-probability / credibility scoring requests are refused.");
  }

  return {
    coreIssues: (params.claims ?? []).slice(0, 8).map((c) => c.label),
    strongestSupported: strongest,
    weakestAreas: weakest,
    keyFacts: (params.propositions ?? [])
      .filter((p) => p.text)
      .slice(0, 8)
      .map((p) => p.text!),
    keyEvidence: readiness.claims.flatMap((c) => c.sourceIds).slice(0, 10),
    keyPeople: (params.parties ?? []).slice(0, 8).map((p) => p.displayName),
    conflicts: (params.contradictions ?? []).slice(0, 8).map((c) => c.description),
    unknowns: weakest.filter((w) => /UNKNOWN|UNSUPPORTED/i.test(w)).slice(0, 8),
    claimReadiness: readiness.claims,
    defenseReadiness: readiness.defenses,
    recentChanges: (params.priorChangeLines ?? []).slice(0, 8),
    investigateNextTitles: (params.investigateNext ?? []).slice(0, 8).map((i) => i.title),
    limitations,
    credibilityScoring: 0,
    winProbability: 0,
  };
}

export function formatMatterSynthesisForPrompt(s: MatterSynthesis): string {
  return [
    "MATTER_INTELLIGENCE_SYNTHESIS:",
    `CORE_ISSUES: ${s.coreIssues.join(" | ") || "none"}`,
    `STRONGEST_SUPPORTED: ${s.strongestSupported.join(" | ") || "none"}`,
    `WEAKEST_AREAS: ${s.weakestAreas.join(" | ") || "none"}`,
    `CONFLICTS: ${s.conflicts.join(" | ") || "none"}`,
    `UNKNOWNS: ${s.unknowns.join(" | ") || "none"}`,
    `CLAIM_READINESS: ${s.claimReadiness.map((c) => `${c.label}=${c.readiness}`).join("; ") || "none"}`,
    `DEFENSE_READINESS: ${s.defenseReadiness.map((d) => `${d.label}=${d.readiness}`).join("; ") || "none"}`,
    `INVESTIGATE_NEXT: ${s.investigateNextTitles.join(" | ") || "none"}`,
    `RECENT_CHANGES: ${s.recentChanges.join(" | ") || "none"}`,
    "CREDIBILITY_SCORING: 0",
    "WIN_PROBABILITY: 0",
    ...s.limitations.map((l) => `LIMITATION: ${l}`),
  ].join("\n");
}

export function detectWhatChanged(params: {
  question: string;
  priorValidation?: Record<string, unknown> | null;
  currentInvestigateGaps?: string[];
  currentConflictCount?: number;
  currentAuthorityCount?: number;
}): WhatChangedResult {
  if (!/\b(what changed|new gaps|since the deposition|did .+ resolve|recent changes)\b/i.test(params.question)) {
    return emptyWhatChanged("Not a what-changed question.");
  }
  const prior = params.priorValidation;
  if (!prior) {
    return emptyWhatChanged("No trustworthy prior artifact snapshot is available for comparison.");
  }

  const priorInv = prior.investigateNext && typeof prior.investigateNext === "object"
    ? (prior.investigateNext as Record<string, unknown>)
    : null;
  const priorGaps = Array.isArray(priorInv?.gaps)
    ? (priorInv!.gaps as Array<Record<string, unknown>>).map((g) => String(g.id ?? g.title ?? ""))
    : [];
  const current = params.currentInvestigateGaps ?? [];
  const newGaps = current.filter((g) => !priorGaps.includes(g));
  const resolvedGaps = priorGaps.filter((g) => g && !current.includes(g));

  const priorDepo = prior.depositionPrep && typeof prior.depositionPrep === "object"
    ? (prior.depositionPrep as Record<string, unknown>)
    : null;
  const priorConflict = Number(priorDepo?.conflictCount ?? 0);
  const curConflict = params.currentConflictCount ?? priorConflict;
  const newConflicts =
    curConflict > priorConflict ? [`Conflict count increased ${priorConflict} → ${curConflict}`] : [];
  const resolvedConflicts =
    curConflict < priorConflict ? [`Conflict count decreased ${priorConflict} → ${curConflict}`] : [];

  const priorResearch = prior.matterResearch && typeof prior.matterResearch === "object"
    ? (prior.matterResearch as Record<string, unknown>)
    : null;
  const researchImpact =
    priorResearch && params.currentAuthorityCount != null
      ? [
          `Prior research authorities=${Number(priorResearch.authorityCount ?? 0)}; current context authorities=${params.currentAuthorityCount}`,
        ]
      : [];

  return {
    available: true,
    unavailableReason: null,
    newFacts: [],
    newEvidence: [],
    newConflicts,
    resolvedConflicts,
    newGaps,
    resolvedGaps,
    claimImpact: [],
    defenseImpact: [],
    motionImpact: [],
    researchImpact,
  };
}

function emptyWhatChanged(reason: string): WhatChangedResult {
  return {
    available: false,
    unavailableReason: reason,
    newFacts: [],
    newEvidence: [],
    newConflicts: [],
    resolvedConflicts: [],
    newGaps: [],
    resolvedGaps: [],
    claimImpact: [],
    defenseImpact: [],
    motionImpact: [],
    researchImpact: [],
  };
}

export function formatWhatChangedForPrompt(w: WhatChangedResult): string {
  if (!w.available) {
    return `WHAT_CHANGED: unavailable — ${w.unavailableReason}`;
  }
  return [
    "WHAT_CHANGED:",
    `NEW_GAPS: ${w.newGaps.join(",") || "none"}`,
    `RESOLVED_GAPS: ${w.resolvedGaps.join(",") || "none"}`,
    `NEW_CONFLICTS: ${w.newConflicts.join(" | ") || "none"}`,
    `RESOLVED_CONFLICTS: ${w.resolvedConflicts.join(" | ") || "none"}`,
    `RESEARCH_IMPACT: ${w.researchImpact.join(" | ") || "none"}`,
  ].join("\n");
}

/** Continuity guards — never escalate. */
export function assertNoFactualityEscalation(
  from: string,
  to: string,
): { ok: boolean; reason: string | null } {
  const rank: Record<string, number> = {
    UNSUPPORTED: 0,
    UNKNOWN: 1,
    CONFLICT: 2,
    SUPPORTED_INFERENCE: 3,
    FACT: 4,
  };
  const a = rank[from.toUpperCase()] ?? 1;
  const b = rank[to.toUpperCase()] ?? 1;
  if (b > a && !(from.toUpperCase() === "CONFLICT" && to.toUpperCase() === "CONFLICT")) {
    // Escalation only blocked when moving toward higher certainty without new evidence path
    if (to.toUpperCase() === "FACT" && from.toUpperCase() !== "FACT") {
      return { ok: false, reason: `Factuality escalation blocked: ${from} → ${to}` };
    }
    if (to.toUpperCase() === "SUPPORTED_INFERENCE" && (from.toUpperCase() === "UNKNOWN" || from.toUpperCase() === "UNSUPPORTED")) {
      return { ok: false, reason: `Factuality escalation blocked: ${from} → ${to}` };
    }
  }
  return { ok: true, reason: null };
}

export function assertNoAuthorityEscalation(params: {
  fromResolution: string;
  toResolution: string;
  fromTreatmentVerified: boolean;
  toTreatmentVerified: boolean;
}): { ok: boolean; reason: string | null } {
  const order = ["IDENTITY_UNRESOLVED", "AUTHORITY_RESOLVED", "CORPUS_COMPLETE", "FULL_TEXT_READY"];
  const fi = order.indexOf(params.fromResolution);
  const ti = order.indexOf(params.toResolution);
  if (fi >= 0 && ti > fi) {
    return {
      ok: false,
      reason: `Authority-state escalation blocked: ${params.fromResolution} → ${params.toResolution}`,
    };
  }
  if (!params.fromTreatmentVerified && params.toTreatmentVerified) {
    return { ok: false, reason: "Treatment escalation blocked: NOT_VERIFIED → VERIFIED" };
  }
  return { ok: true, reason: null };
}

export function isMatterSynthesisQuestion(question: string): boolean {
  return /\b(what is the case|core issues?|strongest supported|weakest|what facts matter|key evidence|key people|material conflicts|what is still unknown|what changed|claim readiness|defense readiness|matter overview|complete status)\b/i.test(
    question,
  );
}

export function crossWorkflowForceDomains(
  kind: WorkflowKind,
): Array<
  | "WHOLE_MATTER"
  | "CLAIMS"
  | "DEFENSES"
  | "EVIDENCE"
  | "DISCOVERY"
  | "COMMUNICATIONS"
  | "MOTIONS"
  | "TIMELINE"
  | "TASKS"
  | "AUTHORITIES"
  | "RESEARCH"
  | "DRAFT"
  | "DEPOSITION"
> {
  switch (kind) {
    case "HEARING_PREP":
      return ["MOTIONS", "CLAIMS", "DISCOVERY", "COMMUNICATIONS", "AUTHORITIES"];
    case "DEPOSITION_PREP":
    case "DEPOSITION_ANALYSIS":
      return ["DEPOSITION", "EVIDENCE", "CLAIMS", "COMMUNICATIONS", "TIMELINE"];
    case "DRAFT":
      return ["DRAFT", "CLAIMS", "EVIDENCE", "AUTHORITIES"];
    case "RESEARCH":
      return ["RESEARCH", "AUTHORITIES", "CLAIMS"];
    case "INVESTIGATE_NEXT":
      return ["WHOLE_MATTER", "CLAIMS", "DEFENSES", "DISCOVERY", "EVIDENCE"];
    case "MATTER_ANALYSIS":
      return ["WHOLE_MATTER", "CLAIMS", "DEFENSES", "MOTIONS", "DISCOVERY"];
    case "MOTION":
      return ["MOTIONS", "CLAIMS", "DISCOVERY"];
    case "DISCOVERY":
      return ["DISCOVERY", "COMMUNICATIONS"];
    case "COMMUNICATIONS":
      return ["COMMUNICATIONS", "EVIDENCE"];
    case "TIMELINE":
      return ["TIMELINE", "EVIDENCE"];
    case "EVIDENCE":
      return ["EVIDENCE", "CLAIMS"];
    case "TASK":
      return ["TASKS"];
    default:
      return [];
  }
}
