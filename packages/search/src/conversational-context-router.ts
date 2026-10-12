/**
 * Phase 2 — Bounded conversational context router.
 * Selects which existing Pass 3–7 (and related) domains to load.
 * Does not create duplicate loaders; reuses intelligence package gates.
 */
import {
  isCivilClaimsAskQuestion,
  isDiscoveryAskQuestion,
  isMotionsCommunicationsAskQuestion,
  isWholeMatterAskQuestion,
} from "@nyayagrid/intelligence";

export const CONVERSATIONAL_DOMAINS = [
  "WHOLE_MATTER",
  "CLAIMS",
  "DEFENSES",
  "EVIDENCE",
  "DISCOVERY",
  "COMMUNICATIONS",
  "MOTIONS",
  "TIMELINE",
  "TASKS",
  "AUTHORITIES",
  "RESEARCH",
  "DRAFT",
  "COMPARE",
  "DEPOSITION",
  "CONTRACTS",
  "EVIDENCE_MATRIX",
  "GRAPH",
  "MEMORY",
] as const;

export type ConversationalDomain = (typeof CONVERSATIONAL_DOMAINS)[number];

/** Domains that whole-matter already assembles — suppress targeted loaders. */
export const WHOLE_MATTER_OVERLAP_DOMAINS: readonly ConversationalDomain[] = [
  "CLAIMS",
  "DEFENSES",
  "EVIDENCE",
  "DISCOVERY",
  "COMMUNICATIONS",
  "MOTIONS",
] as const;

export type RouterLoaderKey =
  | "whole_matter"
  | "civil"
  | "discovery"
  | "motions_comms"
  | "graph"
  | "memory"
  | "authorities"
  | "week4"
  | "draft_preview";

export type ConversationalRouterPlan = {
  selectedDomains: ConversationalDomain[];
  skippedDomains: ConversationalDomain[];
  reasonCodes: string[];
  wholeMatterUsed: boolean;
  /** Targeted loaders that would have run but were suppressed as duplicates. */
  duplicateLoaderSuppressed: ConversationalDomain[];
  loaders: {
    wholeMatter: boolean;
    civil: boolean;
    discovery: boolean;
    motionsComms: boolean;
    graph: boolean;
    memory: boolean;
    authorities: boolean;
    week4: boolean;
    draftPreview: boolean;
  };
  diagnostics: {
    routerLatencyMs: number;
    contextCharsEstimate: number;
    sourceCount: number;
    authorityCount: number;
  };
};

function uniqDomains(domains: ConversationalDomain[]): ConversationalDomain[] {
  return [...new Set(domains)];
}

function wantsTimeline(question: string): boolean {
  return /\b(timeline|what happened (after|before|next)|chronolog|sequence of events)\b/i.test(
    question,
  );
}

function wantsTasks(question: string): boolean {
  return /\b(task|tasks|to[- ]do|follow[- ]up items)\b/i.test(question);
}

function wantsAuthorities(question: string): boolean {
  return /\b(authorit|citation|case law|good law|overruled|controlling|precedent|statute)\b/i.test(
    question,
  );
}

function wantsResearch(question: string): boolean {
  return /\b(research|doctrine|legal standard|elements of the (claim|offense))\b/i.test(question);
}

function wantsDraft(question: string): boolean {
  return /\b(draft|write a (reply|letter|motion|brief)|prepare a (reply|letter))\b/i.test(question);
}

function wantsCompare(question: string): boolean {
  return /\b(compare|versus|vs\.?|difference between)\b/i.test(question);
}

function wantsDeposition(question: string): boolean {
  return /\b(deposition|deponent|transcript)\b/i.test(question);
}

function wantsContracts(question: string): boolean {
  return /\b(contract|lease|agreement|redline|clause)\b/i.test(question);
}

function wantsEvidenceMatrix(question: string): boolean {
  return /\b(evidence matrix|element[- ]by[- ]element|supports element)\b/i.test(question);
}

function wantsGraph(question: string): boolean {
  return /\b(graph|relationship|connected (to|parties)|who is linked)\b/i.test(question);
}

function wantsMemory(question: string): boolean {
  return /\b(memory|what (do|did) we (know|establish)|confirmed facts)\b/i.test(question);
}

function wantsEvidence(question: string): boolean {
  return /\b(evidence|exhibit|what supports|contradict|witness)\b/i.test(question);
}

function wantsClaims(question: string): boolean {
  return /\b(claim|counterclaim|cause of action|element)\b/i.test(question);
}

function wantsDefenses(question: string): boolean {
  return /\b(defense|affirmative defense|waiver|estoppel)\b/i.test(question);
}

function splitMotionsVsComms(question: string): {
  motions: boolean;
  communications: boolean;
} {
  const motions = /\b(motion|motions|compel|ruling|disposition|hearing|opposition|reply brief)\b/i.test(
    question,
  );
  const communications =
    /\b(communication|correspondence|meet[- ]and[- ]confer|MAC|letter|email to counsel|opposing counsel|promise)\b/i.test(
      question,
    );
  // Broad MC gate may fire for either; keep both if only the combined gate hits.
  if (!motions && !communications && isMotionsCommunicationsAskQuestion(question)) {
    return { motions: true, communications: true };
  }
  return { motions, communications };
}

/**
 * Plan which domain loaders to invoke for this turn.
 * Routing reduces context — does not expand it.
 */
export function planConversationalContext(params: {
  question: string;
  workspaceType?: string | null;
  /** Prior active source/authority counts for diagnostics only. */
  priorSourceCount?: number;
  priorAuthorityCount?: number;
  /** Estimated chars already reserved for conversation context. */
  conversationContextChars?: number;
  /**
   * Phase 3 — domains forced by deterministic referent resolution.
   * Does not expand whole-matter; only enables targeted loaders when narrow.
   */
  forceDomains?: readonly ConversationalDomain[];
}): ConversationalRouterPlan {
  const started = Date.now();
  const q = params.question;
  const prosecution = params.workspaceType === "prosecution";
  const forced = new Set(params.forceDomains ?? []);

  const selected: ConversationalDomain[] = [];
  const skipped: ConversationalDomain[] = [];
  const reasonCodes: string[] = [];
  const duplicateLoaderSuppressed: ConversationalDomain[] = [];

  const wholeMatterCandidate =
    !prosecution && isWholeMatterAskQuestion(q);
  const civilCandidate =
    !prosecution &&
    (isCivilClaimsAskQuestion(q) ||
      forced.has("CLAIMS") ||
      forced.has("DEFENSES") ||
      forced.has("EVIDENCE") ||
      forced.has("EVIDENCE_MATRIX"));
  const mcCandidate =
    !prosecution &&
    (isMotionsCommunicationsAskQuestion(q) ||
      forced.has("MOTIONS") ||
      forced.has("COMMUNICATIONS"));
  const { motions: motionsHit, communications: commsHit } = splitMotionsVsComms(q);
  const motionsForced = forced.has("MOTIONS") || motionsHit;
  const commsForced = forced.has("COMMUNICATIONS") || commsHit;

  // Discovery gate shares "compel" / meet-and-confer with motions. Prefer motions when
  // the question is ruling/motion-centric and lacks discovery-specific vocabulary.
  const discoverySpecific =
    /\b(discovery|interrogator|request for production|\brfp\b|\brfa\b|bates|unanswered|supplemental production|deficiency|deficiencies)\b/i.test(
      q,
    ) || forced.has("DISCOVERY");
  const discoveryCandidate =
    !prosecution &&
    (forced.has("DISCOVERY") ||
      (isDiscoveryAskQuestion(q) && (discoverySpecific || !(motionsForced || mcCandidate))));

  let wholeMatterUsed = false;
  let loadCivil = false;
  let loadDiscovery = false;
  let loadMotionsComms = false;

  if (wholeMatterCandidate) {
    wholeMatterUsed = true;
    selected.push("WHOLE_MATTER");
    reasonCodes.push("WHOLE_MATTER_GATE");

    // Suppress overlapping Pass 3/4/6 loaders even if their gates also match.
    for (const d of WHOLE_MATTER_OVERLAP_DOMAINS) {
      const wouldLoad =
        (d === "CLAIMS" || d === "DEFENSES" || d === "EVIDENCE") && civilCandidate
          ? true
          : d === "DISCOVERY" && discoveryCandidate
            ? true
            : (d === "MOTIONS" || d === "COMMUNICATIONS") && mcCandidate
              ? true
              : false;
      if (wouldLoad) {
        duplicateLoaderSuppressed.push(d);
        skipped.push(d);
        reasonCodes.push(`SUPPRESS_DUPLICATE_${d}`);
      } else {
        skipped.push(d);
      }
    }
  } else {
    skipped.push("WHOLE_MATTER");
    reasonCodes.push("NARROW_ROUTE");

    if (civilCandidate || wantsClaims(q) || wantsDefenses(q) || wantsEvidence(q) || wantsEvidenceMatrix(q)) {
      loadCivil = civilCandidate;
      if (wantsClaims(q) || civilCandidate || forced.has("CLAIMS")) selected.push("CLAIMS");
      if (wantsDefenses(q) || forced.has("DEFENSES") || (civilCandidate && /\bdefense\b/i.test(q))) {
        selected.push("DEFENSES");
      }
      if (wantsEvidence(q) || wantsEvidenceMatrix(q) || civilCandidate || forced.has("EVIDENCE")) {
        selected.push("EVIDENCE");
      }
      if (wantsEvidenceMatrix(q) || forced.has("EVIDENCE_MATRIX")) selected.push("EVIDENCE_MATRIX");
      if (civilCandidate) reasonCodes.push("CIVIL_GATE");
      if (forced.has("CLAIMS") || forced.has("EVIDENCE")) reasonCodes.push("REFERENT_FORCE_CIVIL");
    }

    if (discoveryCandidate) {
      loadDiscovery = true;
      selected.push("DISCOVERY");
      reasonCodes.push(forced.has("DISCOVERY") ? "REFERENT_FORCE_DISCOVERY" : "DISCOVERY_GATE");
    }

    if (mcCandidate || motionsForced || commsForced) {
      loadMotionsComms = mcCandidate || forced.has("MOTIONS") || forced.has("COMMUNICATIONS");
      if (motionsForced || mcCandidate) selected.push("MOTIONS");
      if (commsForced || (mcCandidate && !motionsForced)) selected.push("COMMUNICATIONS");
      if (mcCandidate) reasonCodes.push("MOTIONS_COMMS_GATE");
      if (forced.has("MOTIONS") || forced.has("COMMUNICATIONS")) {
        reasonCodes.push("REFERENT_FORCE_MOTIONS_COMMS");
      }
    }
  }

  // Secondary domains — advisory selection; loaders may already be elsewhere in Ask.
  if (wantsTimeline(q) || forced.has("TIMELINE")) {
    selected.push("TIMELINE");
    reasonCodes.push(forced.has("TIMELINE") ? "REFERENT_FORCE_TIMELINE" : "TIMELINE_HINT");
  } else {
    skipped.push("TIMELINE");
  }

  if (wantsTasks(q) || (wholeMatterUsed && /\bdeadline|task\b/i.test(q))) {
    selected.push("TASKS");
    reasonCodes.push("TASKS_HINT");
  } else {
    skipped.push("TASKS");
  }

  const auth = wantsAuthorities(q) || wholeMatterUsed || forced.has("AUTHORITIES");
  if (auth) {
    selected.push("AUTHORITIES");
    reasonCodes.push(
      forced.has("AUTHORITIES")
        ? "REFERENT_FORCE_AUTHORITIES"
        : wantsAuthorities(q)
          ? "AUTHORITIES_HINT"
          : "AUTHORITIES_WITH_WHOLE_MATTER",
    );
  } else {
    skipped.push("AUTHORITIES");
  }

  if (wantsResearch(q) || forced.has("RESEARCH")) {
    selected.push("RESEARCH");
    reasonCodes.push(forced.has("RESEARCH") ? "REFERENT_FORCE_RESEARCH" : "RESEARCH_HINT");
  } else {
    skipped.push("RESEARCH");
  }

  let draftPreview = false;
  if (wantsDraft(q) || forced.has("DRAFT")) {
    selected.push("DRAFT");
    draftPreview = true;
    reasonCodes.push("DRAFT_PREVIEW_ONLY");
  } else {
    skipped.push("DRAFT");
  }

  if (wantsCompare(q)) {
    selected.push("COMPARE");
    reasonCodes.push("COMPARE_HINT");
  } else {
    skipped.push("COMPARE");
  }

  if (wantsDeposition(q)) {
    selected.push("DEPOSITION");
    reasonCodes.push("DEPOSITION_HINT");
  } else {
    skipped.push("DEPOSITION");
  }

  if (wantsContracts(q)) {
    selected.push("CONTRACTS");
    reasonCodes.push("CONTRACTS_HINT");
  } else {
    skipped.push("CONTRACTS");
  }

  const loadGraph = wantsGraph(q);
  if (loadGraph) {
    selected.push("GRAPH");
    reasonCodes.push("GRAPH_HINT");
  } else {
    skipped.push("GRAPH");
  }

  const loadMemory = wantsMemory(q);
  if (loadMemory) {
    selected.push("MEMORY");
    reasonCodes.push("MEMORY_HINT");
  } else {
    skipped.push("MEMORY");
  }

  // Narrow motion-only: ensure we didn't also select whole matter.
  if (!wholeMatterUsed && motionsHit && !commsHit && !discoveryCandidate && !civilCandidate) {
    reasonCodes.push("NARROW_MOTIONS_ONLY");
  }

  const selectedDomains = uniqDomains(selected);
  const skippedDomains = uniqDomains(
    skipped.filter((d) => !selectedDomains.includes(d)),
  );

  // Rough context budget estimate — conversation + ~2–4k per primary loader.
  const primaryLoaderCount =
    (wholeMatterUsed ? 1 : 0) +
    (loadCivil ? 1 : 0) +
    (loadDiscovery ? 1 : 0) +
    (loadMotionsComms ? 1 : 0);
  const contextCharsEstimate =
    (params.conversationContextChars ?? 0) + primaryLoaderCount * 3_500;

  return {
    selectedDomains,
    skippedDomains,
    reasonCodes: [...new Set(reasonCodes)],
    wholeMatterUsed,
    duplicateLoaderSuppressed: uniqDomains(duplicateLoaderSuppressed),
    loaders: {
      wholeMatter: wholeMatterUsed,
      civil: loadCivil && !wholeMatterUsed,
      discovery: loadDiscovery && !wholeMatterUsed,
      motionsComms: loadMotionsComms && !wholeMatterUsed,
      graph: loadGraph,
      memory: loadMemory,
      authorities: auth,
      week4: !wholeMatterUsed && (loadCivil || wantsEvidence(q)),
      draftPreview,
    },
    diagnostics: {
      routerLatencyMs: Math.max(0, Date.now() - started),
      contextCharsEstimate,
      sourceCount: params.priorSourceCount ?? 0,
      authorityCount: params.priorAuthorityCount ?? 0,
    },
  };
}

export function formatRouterDiagnosticsForDev(plan: ConversationalRouterPlan): string {
  return [
    "CONTEXT_ROUTER_DIAGNOSTICS",
    `selected=${plan.selectedDomains.join(",") || "(none)"}`,
    `skipped=${plan.skippedDomains.slice(0, 12).join(",")}`,
    `reasons=${plan.reasonCodes.join(",")}`,
    `wholeMatter=${plan.wholeMatterUsed}`,
    `duplicateSuppressed=${plan.duplicateLoaderSuppressed.join(",") || "(none)"}`,
    `contextCharsEstimate=${plan.diagnostics.contextCharsEstimate}`,
    `sources=${plan.diagnostics.sourceCount}`,
    `authorities=${plan.diagnostics.authorityCount}`,
    `routerLatencyMs=${plan.diagnostics.routerLatencyMs}`,
  ].join("\n");
}
