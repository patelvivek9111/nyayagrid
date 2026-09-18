import type { Capability } from "@nyayagrid/validation";
import type {
  LegalWorkLockState,
  LegalWorkObjectType,
  LegalWorkPayload,
  LegalWorkRole,
} from "./types";

export const PROTECTED_OBJECT_TYPES = new Set<LegalWorkObjectType>([
  "document",
  "document_version",
  "audit_event",
]);

export const PROTECTED_REASON: Record<string, string> = {
  document: "Original uploaded evidence cannot be changed by Undo or Restore.",
  document_version: "Original source files are kept as uploaded. Restore cannot replace them.",
  audit_event: "Compliance and audit records cannot be altered or restored.",
};

export const CONTENT_FIELDS: Partial<Record<LegalWorkObjectType, string[]>> = {
  draft: ["content", "title"],
  note: ["content", "title"],
  summary: ["summary"],
  analysis: ["summary", "title", "explanation"],
  analysis_item: ["title", "summary", "explanation", "attention"],
  timeline_event: ["title", "description", "eventDate", "eventType", "actors"],
  memory: ["title", "content"],
  fact: ["label", "value", "normalizedValue"],
  entity: ["displayName", "description"],
  deadline: ["title", "description", "dueAt"],
  graph_node: ["displayName", "metadata"],
  graph_edge: ["label", "relationshipType", "metadata"],
  task: ["title", "description"],
};

export const APPROVAL_FIELDS = [
  "status",
  "approvedByUserId",
  "approvedAt",
  "rejectedByUserId",
  "rejectedAt",
  "rejectionReason",
  "reviewedByUserId",
  "reviewedAt",
] as const;

export const DOWNSTREAM_TYPES: Partial<Record<LegalWorkObjectType, LegalWorkObjectType[]>> = {
  timeline_event: ["evidence_review", "draft", "analysis", "graph_node"],
  evidence_review: ["draft", "analysis"],
  memory: ["draft", "analysis"],
  graph_node: ["draft", "graph_edge"],
  graph_edge: ["draft", "graph_node"],
  fact: ["graph_node", "draft", "memory"],
  entity: ["graph_node", "draft", "memory"],
  deadline: ["draft", "task"],
};

export const STALE_COPY: Partial<Record<LegalWorkObjectType, string>> = {
  timeline_event: "Source timeline item changed after this work was generated.",
  evidence_review: "Evidence classification changed after this work was generated.",
  memory: "A memory item this work relied on was restored to an earlier state.",
  graph_node: "Graph details changed after this work was generated.",
  graph_edge: "A graph relationship changed after this work was generated.",
  fact: "A recorded fact changed after this work was generated.",
  entity: "A person or organization record changed after this work was generated.",
  deadline: "A deadline changed after this work was generated.",
};

export function isProtectedObjectType(objectType: LegalWorkObjectType): boolean {
  return PROTECTED_OBJECT_TYPES.has(objectType);
}

export function protectedReason(objectType: LegalWorkObjectType): string {
  return PROTECTED_REASON[objectType] ?? "This record cannot be restored.";
}

export function capabilityForObject(
  objectType: LegalWorkObjectType,
  action: "view" | "restore" | "bulk",
): Capability {
  if (action === "view") return "matters.view";
  if (action === "bulk") return "matters.edit";
  if (objectType === "draft") return "drafts.create";
  if (objectType === "timeline_event") return "timeline.manage";
  return "matters.edit";
}

export function canViewHistory(role: LegalWorkRole): boolean {
  return role === "viewer" || role === "editor" || role === "admin";
}

export function canRestoreObject(role: LegalWorkRole, lockState: LegalWorkLockState): boolean {
  if (role === "viewer") return false;
  if (lockState === "finalized" || lockState === "locked") return false;
  return role === "editor" || role === "admin";
}

export function canBulkRestore(role: LegalWorkRole): boolean {
  return role === "editor" || role === "admin";
}

export function canRestoreLocked(role: LegalWorkRole): boolean {
  return role === "admin";
}

export function contentChanged(
  objectType: LegalWorkObjectType,
  before: LegalWorkPayload,
  after: LegalWorkPayload,
): boolean {
  const fields = CONTENT_FIELDS[objectType] ?? Object.keys({ ...before, ...after });
  return fields.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

export function approvalAfterRestore(params: {
  objectType: LegalWorkObjectType;
  currentPayload: LegalWorkPayload;
  targetPayload: LegalWorkPayload;
  restoreApprovals: boolean;
}): LegalWorkPayload {
  const next = { ...params.targetPayload };
  if (params.restoreApprovals) return next;
  if (!contentChanged(params.objectType, params.currentPayload, params.targetPayload)) {
    return next;
  }
  if (typeof next.status === "string") {
    const status = next.status;
    if (
      status === "approved" ||
      status === "edited_and_approved" ||
      status === "reviewed" ||
      status === "accepted"
    ) {
      if (
        params.objectType === "analysis" ||
        params.objectType === "analysis_item" ||
        params.objectType === "redline"
      ) {
        next.status = "proposed";
      } else if (params.objectType === "draft") {
        if (next.status === "final") next.status = "in_review";
      } else {
        next.status = "proposed";
      }
    }
  }
  next.approvedByUserId = null;
  next.approvedAt = null;
  next.reviewedByUserId = null;
  next.reviewedAt = null;
  next.rejectedByUserId = null;
  next.rejectedAt = null;
  next.rejectionReason = null;
  return next;
}

export function sourceLabel(source: string): string {
  switch (source) {
    case "ai":
      return "AI";
    case "bulk":
      return "Bulk";
    case "restore":
      return "Restore";
    case "system":
      return "System";
    default:
      return "User";
  }
}

export function lockStateFromPayload(
  objectType: LegalWorkObjectType,
  payload: LegalWorkPayload,
): LegalWorkLockState {
  if (objectType === "draft" && payload.status === "final") return "finalized";
  if (objectType === "draft" && payload.status === "archived") return "locked";
  if (objectType === "evidence_review" && payload.humanPrivilegeFinal === true) return "locked";
  if (payload.lockState === "locked" || payload.lockState === "finalized") {
    return payload.lockState;
  }
  return "unlocked";
}
