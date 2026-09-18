export const LEGAL_WORK_OBJECT_TYPES = [
  "draft",
  "note",
  "timeline_event",
  "evidence_review",
  "evidence_tag",
  "memory",
  "graph_node",
  "graph_edge",
  "review_status",
  "fact",
  "entity",
  "deadline",
  "summary",
  "analysis",
  "analysis_item",
  "redline",
  "task",
  "document",
  "document_version",
  "audit_event",
] as const;

export type LegalWorkObjectType = (typeof LEGAL_WORK_OBJECT_TYPES)[number];

export const LEGAL_WORK_SOURCES = ["user", "ai", "bulk", "system", "restore"] as const;
export type LegalWorkSource = (typeof LEGAL_WORK_SOURCES)[number];

export const LEGAL_WORK_OPERATIONS = [
  "create",
  "update",
  "review",
  "approve",
  "reject",
  "retire",
  "restore",
  "undo",
  "status",
  "tag",
  "lock",
  "unlock",
] as const;
export type LegalWorkOperation = (typeof LEGAL_WORK_OPERATIONS)[number];

export const LEGAL_WORK_LOCK_STATES = ["unlocked", "locked", "finalized"] as const;
export type LegalWorkLockState = (typeof LEGAL_WORK_LOCK_STATES)[number];

export const CHECKPOINT_KINDS = ["object", "bulk", "session"] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

export type RestoreMode = "undo" | "as_new_version" | "preview";
export type UndoScope = "object" | "matter" | "session";

export type LegalWorkRole = "viewer" | "editor" | "admin";

export type LegalWorkPayload = Record<string, unknown>;

export type LegalWorkVersionRecord = {
  id: string;
  organizationId: string;
  matterId: string;
  objectType: LegalWorkObjectType;
  objectId: string;
  versionNumber: number;
  payload: LegalWorkPayload;
  actorUserId: string | null;
  source: LegalWorkSource;
  priorVersionId: string | null;
  actionId: string | null;
  restorationOfVersionId: string | null;
  nativeVersionId: string | null;
  createdAt: Date;
};

export type LegalWorkHeadRecord = {
  id: string;
  organizationId: string;
  matterId: string;
  objectType: LegalWorkObjectType;
  objectId: string;
  currentVersionId: string;
  currentVersionNumber: number;
  lockState: LegalWorkLockState;
  lockedAt: Date | null;
  lockedByUserId: string | null;
  updatedAt: Date;
};

export type LegalWorkActionRecord = {
  id: string;
  organizationId: string;
  matterId: string;
  actorUserId: string;
  objectType: LegalWorkObjectType;
  objectId: string;
  operation: LegalWorkOperation;
  source: LegalWorkSource;
  beforeVersionId: string | null;
  afterVersionId: string | null;
  sessionId: string | null;
  checkpointId: string | null;
  parentActionId: string | null;
  reversible: boolean;
  irreversibleReason: string | null;
  description: string | null;
  aiArtifactId: string | null;
  provider: string | null;
  model: string | null;
  createdAt: Date;
};

export type LegalWorkCheckpointRecord = {
  id: string;
  organizationId: string;
  matterId: string;
  actorUserId: string | null;
  kind: CheckpointKind;
  reason: string | null;
  sessionId: string | null;
  parentActionId: string | null;
  createdAt: Date;
};

export type LegalWorkCheckpointItemRecord = {
  id: string;
  organizationId: string;
  matterId: string;
  checkpointId: string;
  objectType: LegalWorkObjectType;
  objectId: string;
  versionId: string;
  createdAt: Date;
};

export type LegalWorkRestorationRecord = {
  id: string;
  organizationId: string;
  matterId: string;
  actorUserId: string;
  objectType: LegalWorkObjectType;
  objectId: string;
  targetVersionId: string;
  previousCurrentVersionId: string;
  restoredVersionId: string;
  actionId: string;
  sessionId: string | null;
  checkpointId: string | null;
  reason: string | null;
  conflicts: Record<string, unknown>;
  idempotencyKey: string | null;
  createdAt: Date;
};

export type LegalWorkStaleMarkerRecord = {
  id: string;
  organizationId: string;
  matterId: string;
  objectType: LegalWorkObjectType;
  objectId: string;
  sourceObjectType: LegalWorkObjectType;
  sourceObjectId: string;
  sourceVersionId: string | null;
  reason: string;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
};

export type LegalWorkSessionRecord = {
  id: string;
  organizationId: string;
  matterId: string;
  actorUserId: string;
  reason: string | null;
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
};

export type RestoreConflict = {
  kind: "newer_edit" | "expected_mismatch" | "locked" | "irreversible" | "foreign_actor";
  message: string;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  currentActorUserId: string | null;
  targetVersionId?: string | null;
};

export type RestorePreviewItem = {
  objectType: LegalWorkObjectType;
  objectId: string;
  targetVersionId: string | null;
  targetVersionNumber: number | null;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  conflict: RestoreConflict | null;
  irreversible: boolean;
  irreversibleReason: string | null;
  approvalReset: boolean;
  description: string;
};

export type RestorePreview = {
  items: RestorePreviewItem[];
  restorableCount: number;
  conflictCount: number;
  irreversibleCount: number;
  summary: string;
};

export type RecordMutationInput = {
  organizationId: string;
  matterId: string;
  actorUserId: string;
  objectType: LegalWorkObjectType;
  objectId: string;
  operation: LegalWorkOperation;
  source: LegalWorkSource;
  afterPayload: LegalWorkPayload;
  expectedVersionId?: string | null;
  expectedVersionNumber?: number | null;
  sessionId?: string | null;
  checkpointId?: string | null;
  parentActionId?: string | null;
  reversible?: boolean;
  irreversibleReason?: string | null;
  description?: string | null;
  aiArtifactId?: string | null;
  provider?: string | null;
  model?: string | null;
  nativeVersionId?: string | null;
  lockState?: LegalWorkLockState;
  skipApply?: boolean;
};

export type RestoreVersionInput = {
  organizationId: string;
  matterId: string;
  actorUserId: string;
  objectType: LegalWorkObjectType;
  objectId: string;
  targetVersionId: string;
  mode: RestoreMode;
  expectedCurrentVersionId?: string | null;
  restoreApprovals?: boolean;
  reason?: string | null;
  sessionId?: string | null;
  checkpointId?: string | null;
  idempotencyKey?: string | null;
  role: LegalWorkRole;
};

export type DiffChange = {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
};
