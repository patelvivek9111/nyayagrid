/**
 * Phase 5 Command Center UX helpers — pure, testable, no schema.
 * Progress labels map only to runtime-supported SSE stages.
 */

export const COMMAND_CENTER_PROGRESS_STAGES = [
  "REQUEST_ACCEPTED",
  "CONTEXT_LOADING",
  "RETRIEVING_MATTER",
  "RESEARCHING",
  "DRAFTING",
  "COMPARING",
  "WAITING_FOR_CONFIRMATION",
  "EXECUTING_ACTION",
  "FINALIZING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type CommandCenterProgressStage = (typeof COMMAND_CENTER_PROGRESS_STAGES)[number];

export const FACTUALITY_DISPLAY_LABELS: Record<string, string> = {
  FACT: "Record fact",
  SUPPORTED_INFERENCE: "Supported inference",
  CONFLICT: "Conflict",
  UNKNOWN: "Not established",
  UNSUPPORTED: "Unsupported by current record",
};

export const AUTHORITY_DISPLAY_LABELS = {
  identityUnresolved: "Identity unresolved",
  authorityIdentified: "Authority identified",
  fullTextAvailable: "Full text available",
  treatmentVerified: "Treatment verified",
  treatmentNotVerified: "Treatment not verified",
} as const;

export const STALE_ACTION_USER_MESSAGE =
  "The earlier action preview is no longer current.";

/** Confirm utterance bound to a pending action type — never auto-executes writes alone. */
export function confirmPhraseForActionType(actionType: string): string {
  switch (actionType) {
    case "DRAFT_GENERATE_PREVIEW":
    case "DRAFT_SAVE":
    case "DRAFT_REVISE_PREVIEW":
      return "save it";
    case "TASK_CREATE":
      return "create the task";
    case "MEMORY_SAVE":
      return "confirm";
    case "RESEARCH_SAVE":
    case "RESEARCH_READ":
      return "save this research";
    default:
      return "confirm";
  }
}

export function cancelPhraseForPendingAction(): string {
  return "cancel";
}

/**
 * Matter-scoped source filter for Command Center rendering.
 * Foreign / missing IDs fail closed (not shown).
 */
export function filterRenderableMatterSources<
  T extends { documentId?: string; chunkId?: string; category?: string; url?: string },
>(
  items: T[],
  params: { allowedDocumentIds?: Set<string> | null; matterId: string },
): T[] {
  return items.filter((item) => {
    if (item.category === "web") return Boolean(item.url);
    if (item.category === "legal_authority") {
      // Authorities may lack a matter document id; allow when chunk/authority id present.
      return Boolean(item.chunkId || item.documentId);
    }
    const docId = item.documentId?.trim();
    if (!docId || docId.startsWith("web:")) return false;
    if (params.allowedDocumentIds && params.allowedDocumentIds.size > 0) {
      return params.allowedDocumentIds.has(docId);
    }
    // Without an allow-list, still require a concrete document/chunk id from the answer.
    return Boolean(docId || item.chunkId);
  });
}

/** Validate navigation routes before rendering actionable links. */
export function isSafeMatterNavigationRoute(route: string, matterId: string): boolean {
  if (!route.startsWith("/")) return false;
  if (route.includes("://") || route.includes("..")) return false;
  const prefix = `/app/cases/${matterId}`;
  return route === prefix || route.startsWith(`${prefix}/`);
}

export function actionCardTitle(actionType: string, actionStatus: string): string {
  if (actionStatus === "ACTION_CONFIRMATION_STALE") {
    return "Preview outdated";
  }
  if (actionStatus === "COMPLETED") return "Action completed";
  if (actionStatus === "FAILED") return "Action failed";
  if (actionStatus === "PROHIBITED") return "Action not allowed";
  if (actionStatus === "CANCELLED") return "Action cancelled";
  switch (actionType) {
    case "DRAFT_GENERATE_PREVIEW":
    case "DRAFT_SAVE":
    case "DRAFT_REVISE_PREVIEW":
      return "Draft preview";
    case "TASK_CREATE":
      return "Task preview";
    case "MEMORY_SAVE":
      return "Memory proposal";
    case "RESEARCH_SAVE":
    case "RESEARCH_READ":
      return "Research result";
    case "NAVIGATE":
      return "Open in workspace";
    default:
      return "Pending action";
  }
}

/** Map SSE event types to truthful progress stage ids (no invented stages). */
export function stageFromAskStreamEventType(type: string): CommandCenterProgressStage | null {
  switch (type) {
    case "request_started":
      return "REQUEST_ACCEPTED";
    case "retrieval_started":
    case "related_retrieval_started":
      return "RETRIEVING_MATTER";
    case "retrieval_completed":
    case "related_retrieval_completed":
    case "amendment_check_started":
    case "amendment_check_completed":
    case "contradiction_check_started":
    case "contradiction_check_completed":
    case "citation_check_started":
    case "citation_check_completed":
      return "CONTEXT_LOADING";
    case "generation_started":
      return "FINALIZING";
    case "generation_completed":
      return "COMPLETED";
    case "generation_stopped":
      return "CANCELLED";
    case "generation_failed":
      return "FAILED";
    default:
      return null;
  }
}

export function userFacingAskErrorKind(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("deny_guest") || m.includes("client guest")) return "permission_denied";
  if (m.includes("permission") || m.includes("forbidden") || m.includes("not available")) {
    return "permission_denied";
  }
  if (m.includes("stale") || m.includes("no longer current")) return "stale_action";
  if (m.includes("ambiguous") || m.includes("which ")) return "ambiguous_referent";
  if (m.includes("cancel") || m.includes("stopped")) return "cancelled";
  if (m.includes("retriev") || m.includes("source unavailable")) return "retrieval_error";
  if (m.includes("authority")) return "authority_unavailable";
  return "model_error";
}

/** Week 3 Slice 3 — structured Command Center card helpers (no client recomputation). */

export type InvestigateGapCardModel = {
  id: string;
  /** 1-based display index matching backend gaps[] order (gap-N / #N). */
  displayIndex: number;
  priority?: string;
  priorityRationale?: string;
  gapType?: string;
  title: string;
  description?: string;
  whyItMatters?: string;
  recommendedNextStep?: string;
  relatedDomain?: string;
  expectedEvidenceType?: string;
  impact?: string;
  effort?: string;
  status?: string;
  factuality?: string;
  sourceMap: Array<{ kind: string; id: string; label?: string | null }>;
};

export type MatterSynthesisCardModel = {
  coreIssues: string[];
  strongestSupported: string[];
  weakestAreas: string[];
  keyFacts: string[];
  keyEvidence: string[];
  keyPeople: string[];
  conflicts: string[];
  unknowns: string[];
  claimReadiness: Array<{ label: string; readiness: string; openGaps?: string[] }>;
  defenseReadiness: Array<{ label: string; readiness: string; openGaps?: string[] }>;
  recentChanges: string[];
  investigateNextTitles: string[];
  limitations: string[];
  postureNote?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length ? t : undefined;
}

function stringList(value: unknown, cap = 24): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, cap);
}

/**
 * Parse validation.investigateNext / ux.investigateNext into card models.
 * Preserves backend gaps[] order exactly — never re-sorts.
 */
export function parseInvestigateNextForCards(raw: unknown): {
  posture?: string;
  gaps: InvestigateGapCardModel[];
  limitations: string[];
} | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = asRecord(raw);
  const gapsRaw = Array.isArray(obj.gaps) ? obj.gaps : [];
  const gaps: InvestigateGapCardModel[] = [];
  gapsRaw.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const g = asRecord(row);
    const title = nonEmptyString(g.title);
    if (!title) return;
    const id = nonEmptyString(g.id) ?? `gap-${index + 1}`;
    const sourceMap = Array.isArray(g.sourceMap)
      ? g.sourceMap
          .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
          .map((s) => ({
            kind: typeof s.kind === "string" ? s.kind : "source",
            id: typeof s.id === "string" ? s.id : "",
            label: typeof s.label === "string" ? s.label : null,
          }))
          .filter((s) => s.id.length > 0)
      : [];
    gaps.push({
      id,
      displayIndex: index + 1,
      priority: nonEmptyString(g.priority),
      priorityRationale: nonEmptyString(g.priorityRationale),
      gapType: nonEmptyString(g.gapType),
      title,
      description: nonEmptyString(g.description),
      whyItMatters: nonEmptyString(g.whyItMatters),
      recommendedNextStep: nonEmptyString(g.recommendedNextStep),
      relatedDomain: nonEmptyString(g.relatedDomain),
      expectedEvidenceType: nonEmptyString(g.expectedEvidenceType),
      impact: nonEmptyString(g.impact),
      effort: nonEmptyString(g.effort),
      status: nonEmptyString(g.status),
      factuality: nonEmptyString(g.factuality),
      sourceMap,
    });
  });
  const posture = nonEmptyString(obj.posture);
  const limitations = stringList(obj.limitations, 12);
  if (!gaps.length && !posture && !limitations.length) return null;
  return { posture, gaps, limitations };
}

/**
 * Parse validation.crossWorkflow.matterSynthesis / ux.matterSynthesis.
 * Omits empty sections. Never surfaces winProbability/credibility as scores.
 */
export function parseMatterSynthesisForCards(raw: unknown): MatterSynthesisCardModel | null {
  if (!raw || typeof raw !== "object") return null;
  const s = asRecord(raw);
  const claimReadiness = Array.isArray(s.claimReadiness)
    ? s.claimReadiness
        .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
        .map((r) => ({
          label: nonEmptyString(r.label) ?? "Claim",
          readiness: nonEmptyString(r.readiness) ?? "UNKNOWN",
          openGaps: stringList(r.openGaps, 6),
        }))
        .slice(0, 16)
    : [];
  const defenseReadiness = Array.isArray(s.defenseReadiness)
    ? s.defenseReadiness
        .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
        .map((r) => ({
          label: nonEmptyString(r.label) ?? "Defense",
          readiness: nonEmptyString(r.readiness) ?? "UNKNOWN",
          openGaps: stringList(r.openGaps, 6),
        }))
        .slice(0, 16)
    : [];
  const model: MatterSynthesisCardModel = {
    coreIssues: stringList(s.coreIssues),
    strongestSupported: stringList(s.strongestSupported),
    weakestAreas: stringList(s.weakestAreas),
    keyFacts: stringList(s.keyFacts),
    keyEvidence: stringList(s.keyEvidence),
    keyPeople: stringList(s.keyPeople),
    conflicts: stringList(s.conflicts),
    unknowns: stringList(s.unknowns),
    claimReadiness,
    defenseReadiness,
    recentChanges: stringList(s.recentChanges),
    investigateNextTitles: stringList(s.investigateNextTitles),
    limitations: stringList(s.limitations, 12),
  };
  const hasContent =
    model.coreIssues.length +
      model.strongestSupported.length +
      model.weakestAreas.length +
      model.keyFacts.length +
      model.keyEvidence.length +
      model.keyPeople.length +
      model.conflicts.length +
      model.unknowns.length +
      model.claimReadiness.length +
      model.defenseReadiness.length +
      model.recentChanges.length +
      model.investigateNextTitles.length +
      model.limitations.length >
    0;
  return hasContent ? model : null;
}

/** Map InvestigateSourceRef → drawer items (on-demand; no eager hydrate). */
export function investigateSourceMapToDrawerItems(
  refs: Array<{ kind: string; id: string; label?: string | null }>,
): Array<{
  id: string;
  title: string;
  classLabel: string;
  category: "case_evidence" | "legal_authority" | "web";
  documentId?: string;
  chunkId?: string;
  subtitle?: string;
}> {
  return refs.map((ref, i) => {
    const kind = ref.kind.toLowerCase();
    const isChunk = kind.includes("chunk");
    const isAuthority = kind.includes("authority") || kind.includes("legal");
    const isWeb = kind.includes("web") || ref.id.startsWith("web:");
    return {
      id: ref.id || `src-${i}`,
      title: (ref.label && ref.label.trim()) || ref.id || "Source",
      classLabel: isWeb ? "Web" : isAuthority ? "Legal authority" : "Case evidence",
      category: isWeb ? ("web" as const) : isAuthority ? ("legal_authority" as const) : ("case_evidence" as const),
      documentId: !isChunk && !isWeb ? ref.id : undefined,
      chunkId: isChunk ? ref.id : undefined,
      subtitle: ref.kind.replace(/_/g, " "),
    };
  });
}

/** Phrase that drives existing TASK_CREATE preview path (WRITE_CONFIRMATION_REQUIRED). */
export function turnGapIntoTaskPhrase(displayIndex: number): string {
  return `turn #${displayIndex} into a task`;
}

export function investigateEmptyMessage(posture: string | undefined): string | null {
  if (posture === "NO_MATERIAL_GAP") {
    return "No additional high-priority investigation gaps are supported by the current record.";
  }
  if (posture === "FILTERED_EMPTY") {
    return "No investigation gaps matched the current filters.";
  }
  return null;
}
