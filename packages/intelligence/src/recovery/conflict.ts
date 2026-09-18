import type {
  LegalWorkActionRecord,
  LegalWorkHeadRecord,
  LegalWorkLockState,
  LegalWorkVersionRecord,
  RestoreConflict,
  RestoreMode,
} from "./types";
import { isProtectedObjectType, protectedReason } from "./policy";

export function detectOptimisticConflict(params: {
  head: LegalWorkHeadRecord | null;
  expectedVersionId?: string | null;
  expectedVersionNumber?: number | null;
}): RestoreConflict | null {
  if (!params.head) return null;
  if (params.expectedVersionId && params.head.currentVersionId !== params.expectedVersionId) {
    return {
      kind: "expected_mismatch",
      message: "Newer changes exist. This work was updated since you last loaded it.",
      currentVersionId: params.head.currentVersionId,
      currentVersionNumber: params.head.currentVersionNumber,
      currentActorUserId: null,
    };
  }
  if (
    params.expectedVersionNumber != null &&
    params.head.currentVersionNumber !== params.expectedVersionNumber
  ) {
    return {
      kind: "expected_mismatch",
      message: "Newer changes exist. This work was updated since you last loaded it.",
      currentVersionId: params.head.currentVersionId,
      currentVersionNumber: params.head.currentVersionNumber,
      currentActorUserId: null,
    };
  }
  return null;
}

export function detectUndoConflict(params: {
  head: LegalWorkHeadRecord;
  lastAction: LegalWorkActionRecord;
  currentVersion: LegalWorkVersionRecord;
  actorUserId: string;
}): RestoreConflict | null {
  if (params.lastAction.actorUserId !== params.actorUserId) {
    return {
      kind: "foreign_actor",
      message: "Undo last change only reverses your own work, not another person's edits.",
      currentVersionId: params.head.currentVersionId,
      currentVersionNumber: params.head.currentVersionNumber,
      currentActorUserId: params.currentVersion.actorUserId,
    };
  }
  if (params.head.currentVersionId !== params.lastAction.afterVersionId) {
    return {
      kind: "newer_edit",
      message:
        "Newer changes exist. Undo will not overwrite later work. You can compare versions or restore the earlier state as a new version.",
      currentVersionId: params.head.currentVersionId,
      currentVersionNumber: params.head.currentVersionNumber,
      currentActorUserId: params.currentVersion.actorUserId,
      targetVersionId: params.lastAction.beforeVersionId,
    };
  }
  if (
    params.currentVersion.actorUserId &&
    params.currentVersion.actorUserId !== params.actorUserId
  ) {
    return {
      kind: "foreign_actor",
      message: "Newer changes exist from another person and will not be overwritten.",
      currentVersionId: params.head.currentVersionId,
      currentVersionNumber: params.head.currentVersionNumber,
      currentActorUserId: params.currentVersion.actorUserId,
      targetVersionId: params.lastAction.beforeVersionId,
    };
  }
  return null;
}

export function detectLockedConflict(lockState: LegalWorkLockState): RestoreConflict | null {
  if (lockState === "unlocked") return null;
  return {
    kind: "locked",
    message:
      lockState === "finalized"
        ? "This record is finalized. Undo is disabled. You can create an amended working version instead."
        : "This record is locked. Restore requires an administrator and creates a new working version.",
    currentVersionId: null,
    currentVersionNumber: null,
    currentActorUserId: null,
  };
}

export function detectProtectedConflict(objectType: LegalWorkVersionRecord["objectType"]): RestoreConflict | null {
  if (!isProtectedObjectType(objectType)) return null;
  return {
    kind: "irreversible",
    message: protectedReason(objectType),
    currentVersionId: null,
    currentVersionNumber: null,
    currentActorUserId: null,
  };
}

export function decideRestoreMode(params: {
  requested: RestoreMode;
  conflict: RestoreConflict | null;
}): { mode: RestoreMode; conflict: RestoreConflict | null } {
  if (params.requested === "preview") {
    return { mode: "preview", conflict: params.conflict };
  }
  if (params.requested === "as_new_version") {
    return { mode: "as_new_version", conflict: null };
  }
  return { mode: "undo", conflict: params.conflict };
}
