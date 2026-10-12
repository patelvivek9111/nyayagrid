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
