import {
  detectLockedConflict,
  detectOptimisticConflict,
  detectProtectedConflict,
  detectUndoConflict,
} from "./conflict";
import { diffPayloads, diffTextLines } from "./diff";
import {
  LegalWorkConflictError,
  LegalWorkForbiddenError,
  LegalWorkIrreversibleError,
  LegalWorkLockedError,
  LegalWorkNotFoundError,
} from "./errors";
import {
  approvalAfterRestore,
  canBulkRestore,
  canRestoreLocked,
  canRestoreObject,
  canViewHistory,
  contentChanged,
  DOWNSTREAM_TYPES,
  isProtectedObjectType,
  lockStateFromPayload,
  protectedReason,
  sourceLabel,
  STALE_COPY,
} from "./policy";
import { emptyHead, type LegalWorkStore, type ObjectRef } from "./store";
import type {
  DiffChange,
  LegalWorkActionRecord,
  LegalWorkObjectType,
  LegalWorkPayload,
  LegalWorkRestorationRecord,
  LegalWorkRole,
  LegalWorkVersionRecord,
  RecordMutationInput,
  RestorePreview,
  RestorePreviewItem,
  RestoreVersionInput,
  UndoScope,
} from "./types";

export class LegalWorkEngine {
  constructor(
    private readonly store: LegalWorkStore,
    private readonly wrapTransactions = true,
  ) {}

  private async inTransaction<T>(fn: (engine: LegalWorkEngine) => Promise<T>): Promise<T> {
    if (!this.wrapTransactions || !this.store.withTransaction) return fn(this);
    return this.store.withTransaction((store) => fn(new LegalWorkEngine(store, false)));
  }

  async recordMutation(input: RecordMutationInput) {
    return this.inTransaction((engine) => engine.recordMutationInner(input));
  }

  private async recordMutationInner(input: RecordMutationInput) {
    const ref: ObjectRef = {
      organizationId: input.organizationId,
      matterId: input.matterId,
      objectType: input.objectType,
      objectId: input.objectId,
    };
    if (isProtectedObjectType(input.objectType) && input.operation !== "create") {
      throw new LegalWorkIrreversibleError(protectedReason(input.objectType));
    }

    const head = await this.store.getHead(ref);
    const optimistic = detectOptimisticConflict({
      head,
      expectedVersionId: input.expectedVersionId,
      expectedVersionNumber: input.expectedVersionNumber,
    });
    if (optimistic) {
      throw new LegalWorkConflictError(optimistic.message, optimistic);
    }

    const now = this.store.now();
    const prior = head ? await this.store.getVersion({ ...ref, versionId: head.currentVersionId }) : null;
    const versionNumber = (head?.currentVersionNumber ?? 0) + 1;
    const versionId = this.store.newId();
    const actionId = this.store.newId();
    const reversible =
      input.reversible ?? !isProtectedObjectType(input.objectType);
    const version: LegalWorkVersionRecord = {
      id: versionId,
      organizationId: input.organizationId,
      matterId: input.matterId,
      objectType: input.objectType,
      objectId: input.objectId,
      versionNumber,
      payload: input.afterPayload,
      actorUserId: input.actorUserId,
      source: input.source,
      priorVersionId: prior?.id ?? null,
      actionId,
      restorationOfVersionId: null,
      nativeVersionId: input.nativeVersionId ?? null,
      createdAt: now,
    };
    if (!input.skipApply) {
      await this.store.applyLive({ ...ref, payload: input.afterPayload });
      const nativeId = input.afterPayload.nativeVersionId ?? input.afterPayload.nativeSummaryId;
      if (typeof nativeId === "string") version.nativeVersionId = nativeId;
      version.payload = input.afterPayload;
    }
    await this.store.insertVersion(version);

    const action: LegalWorkActionRecord = {
      id: actionId,
      organizationId: input.organizationId,
      matterId: input.matterId,
      actorUserId: input.actorUserId,
      objectType: input.objectType,
      objectId: input.objectId,
      operation: input.operation,
      source: input.source,
      beforeVersionId: prior?.id ?? null,
      afterVersionId: versionId,
      sessionId: input.sessionId ?? null,
      checkpointId: input.checkpointId ?? null,
      parentActionId: input.parentActionId ?? null,
      reversible,
      irreversibleReason: reversible ? null : (input.irreversibleReason ?? protectedReason(input.objectType)),
      description: input.description ?? describeOperation(input.operation, input.objectType),
      aiArtifactId: input.aiArtifactId ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      createdAt: now,
    };
    await this.store.insertAction(action);

    const lockState = input.lockState ?? lockStateFromPayload(input.objectType, input.afterPayload);
    await this.store.upsertHead(
      emptyHead({
        id: head?.id ?? this.store.newId(),
        organizationId: input.organizationId,
        matterId: input.matterId,
        objectType: input.objectType,
        objectId: input.objectId,
        currentVersionId: versionId,
        currentVersionNumber: versionNumber,
        lockState,
        now,
      }),
    );

    return { action, version, beforeVersion: prior };
  }

  async getVersionHistory(params: ObjectRef & { role: LegalWorkRole }) {
    if (!canViewHistory(params.role)) {
      throw new LegalWorkForbiddenError("You can only view history for work you are allowed to see.");
    }
    const versions = await this.store.listVersions(params);
    const head = await this.store.getHead(params);
    const actions = await this.store.listActions(params);
    const actionByAfter = new Map(actions.map((a) => [a.afterVersionId, a]));
    return {
      head,
      versions: versions.map((version) => {
        const action = actionByAfter.get(version.id);
        return {
          id: version.id,
          versionNumber: version.versionNumber,
          createdAt: version.createdAt,
          actorUserId: version.actorUserId,
          source: sourceLabel(version.source),
          sourceKey: version.source,
          description: action?.description ?? "Updated",
          current: head?.currentVersionId === version.id,
          restorationOfVersionId: version.restorationOfVersionId,
          nativeVersionId: version.nativeVersionId,
          payload: version.payload,
          reversible: action?.reversible ?? true,
        };
      }),
    };
  }

  async compareVersions(params: ObjectRef & { fromVersionId: string; toVersionId: string; role: LegalWorkRole }) {
    if (!canViewHistory(params.role)) {
      throw new LegalWorkForbiddenError();
    }
    const from = await this.scopedVersion(params, params.fromVersionId);
    const to = await this.scopedVersion(params, params.toVersionId);
    const structured = diffPayloads(from.payload, to.payload);
    const textChanges = textDiffIfPresent(from.payload, to.payload);
    return {
      fromVersion: summarizeVersion(from),
      toVersion: summarizeVersion(to),
      changes: structured,
      textChanges,
    };
  }

  async createCheckpoint(params: {
    organizationId: string;
    matterId: string;
    actorUserId: string;
    kind: "object" | "bulk" | "session";
    reason?: string | null;
    sessionId?: string | null;
    objects: Array<{ objectType: LegalWorkObjectType; objectId: string }>;
  }) {
    const now = this.store.now();
    const checkpoint = {
      id: this.store.newId(),
      organizationId: params.organizationId,
      matterId: params.matterId,
      actorUserId: params.actorUserId,
      kind: params.kind,
      reason: params.reason ?? null,
      sessionId: params.sessionId ?? null,
      parentActionId: null,
      createdAt: now,
    };
    await this.store.insertCheckpoint(checkpoint);
    const items = [];
    for (const object of params.objects) {
      const head = await this.store.getHead({
        organizationId: params.organizationId,
        matterId: params.matterId,
        objectType: object.objectType,
        objectId: object.objectId,
      });
      if (!head) continue;
      items.push({
        id: this.store.newId(),
        organizationId: params.organizationId,
        matterId: params.matterId,
        checkpointId: checkpoint.id,
        objectType: object.objectType,
        objectId: object.objectId,
        versionId: head.currentVersionId,
        createdAt: now,
      });
    }
    await this.store.insertCheckpointItems(items);
    return { checkpoint, items };
  }

  async restoreVersion(input: RestoreVersionInput) {
    return this.inTransaction((engine) => engine.restoreVersionInner(input));
  }

  private async restoreVersionInner(input: RestoreVersionInput) {
    if (input.idempotencyKey) {
      const existing = await this.store.getRestorationByIdempotency({
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
      });
      if (existing) {
        const version = await this.store.getVersion({
          organizationId: input.organizationId,
          matterId: input.matterId,
          versionId: existing.restoredVersionId,
        });
        return { restoration: existing, version, idempotent: true as const };
      }
    }

    const ref: ObjectRef = {
      organizationId: input.organizationId,
      matterId: input.matterId,
      objectType: input.objectType,
      objectId: input.objectId,
    };
    const protectedConflict = detectProtectedConflict(input.objectType);
    if (protectedConflict) {
      throw new LegalWorkIrreversibleError(protectedConflict.message);
    }

    const target = await this.scopedVersion(ref, input.targetVersionId);
    const head = await this.store.getHead(ref);
    if (!head) throw new LegalWorkNotFoundError("Nothing to restore — no current version exists.");
    const current = await this.scopedVersion(ref, head.currentVersionId);

    if (head.lockState !== "unlocked") {
      throw new LegalWorkLockedError(
        head.lockState === "finalized"
          ? "This record is finalized. Restore is disabled; create an amended working version instead."
          : "This record is locked and cannot be changed with Undo or Restore.",
      );
    }
    if (!canRestoreObject(input.role, head.lockState)) {
      throw new LegalWorkForbiddenError();
    }

    const optimistic = detectOptimisticConflict({
      head,
      expectedVersionId: input.expectedCurrentVersionId,
    });
    if (input.mode === "undo" && optimistic) {
      throw new LegalWorkConflictError(optimistic.message, {
        ...optimistic,
        options: ["view_diff", "restore_as_new_version", "cancel"],
      });
    }

    if (input.mode === "preview") {
      return {
        preview: this.previewItem({
          objectType: input.objectType,
          objectId: input.objectId,
          target,
          current,
          head,
          restoreApprovals: input.restoreApprovals ?? false,
        }),
      };
    }

    if (input.mode === "undo") {
      const last = (
        await this.store.listActions({ ...ref, actorUserId: input.actorUserId, limit: 1 })
      )[0];
      if (last) {
        const conflict = detectUndoConflict({
          head,
          lastAction: last,
          currentVersion: current,
          actorUserId: input.actorUserId,
        });
        if (conflict) {
          throw new LegalWorkConflictError(conflict.message, {
            ...conflict,
            options: ["view_diff", "restore_as_new_version", "cancel"],
          });
        }
      }
    }

    const payload = approvalAfterRestore({
      objectType: input.objectType,
      currentPayload: current.payload,
      targetPayload: target.payload,
      restoreApprovals: input.restoreApprovals ?? false,
    });
    const now = this.store.now();
    const versionNumber = head.currentVersionNumber + 1;
    const restoredId = this.store.newId();
    const actionId = this.store.newId();
    const restorationId = this.store.newId();

    const version: LegalWorkVersionRecord = {
      id: restoredId,
      organizationId: input.organizationId,
      matterId: input.matterId,
      objectType: input.objectType,
      objectId: input.objectId,
      versionNumber,
      payload,
      actorUserId: input.actorUserId,
      source: "restore",
      priorVersionId: current.id,
      actionId,
      restorationOfVersionId: target.id,
      nativeVersionId: null,
      createdAt: now,
    };
    await this.store.applyLive({ ...ref, payload });
    const nativeId = payload.nativeVersionId ?? payload.nativeSummaryId;
    if (typeof nativeId === "string") version.nativeVersionId = nativeId;
    await this.store.insertVersion(version);

    const action: LegalWorkActionRecord = {
      id: actionId,
      organizationId: input.organizationId,
      matterId: input.matterId,
      actorUserId: input.actorUserId,
      objectType: input.objectType,
      objectId: input.objectId,
      operation: input.mode === "undo" ? "undo" : "restore",
      source: "restore",
      beforeVersionId: current.id,
      afterVersionId: restoredId,
      sessionId: input.sessionId ?? null,
      checkpointId: input.checkpointId ?? null,
      parentActionId: null,
      reversible: true,
      irreversibleReason: null,
      description:
        input.mode === "undo"
          ? "Undid last change"
          : `Restored version ${target.versionNumber} as a new version`,
      aiArtifactId: null,
      provider: null,
      model: null,
      createdAt: now,
    };
    await this.store.insertAction(action);

    const restoration: LegalWorkRestorationRecord = {
      id: restorationId,
      organizationId: input.organizationId,
      matterId: input.matterId,
      actorUserId: input.actorUserId,
      objectType: input.objectType,
      objectId: input.objectId,
      targetVersionId: target.id,
      previousCurrentVersionId: current.id,
      restoredVersionId: restoredId,
      actionId,
      sessionId: input.sessionId ?? null,
      checkpointId: input.checkpointId ?? null,
      reason: input.reason ?? null,
      conflicts: {},
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: now,
    };
    await this.store.insertRestoration(restoration);

    await this.store.upsertHead({
      ...head,
      currentVersionId: restoredId,
      currentVersionNumber: versionNumber,
      lockState: payload.status === "final" ? "finalized" : "unlocked",
      lockedAt: null,
      lockedByUserId: null,
      updatedAt: now,
    });
    await this.markDownstreamStale(ref, restoredId);

    return { restoration, version, action, idempotent: false as const };
  }

  async undoLastAction(params: {
    organizationId: string;
    matterId: string;
    actorUserId: string;
    role: LegalWorkRole;
    scope: UndoScope;
    objectType?: LegalWorkObjectType;
    objectId?: string;
    sessionId?: string;
    idempotencyKey?: string | null;
  }) {
    const actions = await this.store.listActions({
      organizationId: params.organizationId,
      matterId: params.matterId,
      actorUserId: params.actorUserId,
      objectType: params.scope === "object" ? params.objectType : undefined,
      objectId: params.scope === "object" ? params.objectId : undefined,
      sessionId: params.scope === "session" ? params.sessionId : undefined,
      limit: 20,
    });
    const last = actions.find(
      (a) => a.operation !== "restore" && a.operation !== "undo" && a.reversible && a.beforeVersionId,
    );
    if (!last?.beforeVersionId) {
      const irreversible = actions.find((a) => a.operation !== "restore" && a.operation !== "undo");
      if (irreversible && !irreversible.reversible) {
        throw new LegalWorkIrreversibleError(
          irreversible.irreversibleReason ?? "This change cannot be undone.",
        );
      }
      throw new LegalWorkNotFoundError("There is no recent change of yours to undo.");
    }
    return this.restoreVersion({
      organizationId: params.organizationId,
      matterId: params.matterId,
      actorUserId: params.actorUserId,
      objectType: last.objectType,
      objectId: last.objectId,
      targetVersionId: last.beforeVersionId,
      mode: "undo",
      role: params.role,
      sessionId: last.sessionId,
      idempotencyKey: params.idempotencyKey,
    });
  }

  async previewSessionRestore(params: {
    organizationId: string;
    matterId: string;
    actorUserId: string;
    sessionId: string;
    role: LegalWorkRole;
  }): Promise<RestorePreview> {
    const session = await this.store.getSession({
      organizationId: params.organizationId,
      matterId: params.matterId,
      sessionId: params.sessionId,
    });
    if (!session) throw new LegalWorkNotFoundError("Work session not found.");
    if (session.actorUserId !== params.actorUserId && params.role !== "admin") {
      throw new LegalWorkForbiddenError("You can only restore your own session.");
    }
    const actions = (
      await this.store.listActions({
        organizationId: params.organizationId,
        matterId: params.matterId,
        sessionId: params.sessionId,
      })
    ).filter((action) => action.operation !== "restore" && action.operation !== "undo");
    const byObject = new Map<string, LegalWorkActionRecord[]>();
    for (const action of actions) {
      const key = `${action.objectType}:${action.objectId}`;
      const list = byObject.get(key) ?? [];
      list.push(action);
      byObject.set(key, list);
    }
    const items: RestorePreviewItem[] = [];
    for (const objectActions of byObject.values()) {
      const chronological = [...objectActions].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const first = chronological[0]!;
      if (!first.beforeVersionId) {
        items.push({
          objectType: first.objectType,
          objectId: first.objectId,
          targetVersionId: null,
          targetVersionNumber: null,
          currentVersionId: first.afterVersionId,
          currentVersionNumber: null,
          conflict: null,
          irreversible: objectActions.some((action) => !action.reversible),
          irreversibleReason:
            objectActions.find((action) => action.irreversibleReason)?.irreversibleReason ??
            "Created during this session",
          approvalReset: false,
          description: first.description ?? "Created during this session",
        });
        continue;
      }
      const head = await this.store.getHead({
        organizationId: params.organizationId,
        matterId: params.matterId,
        objectType: first.objectType,
        objectId: first.objectId,
      });
      const target = await this.store.getVersion({
        organizationId: params.organizationId,
        matterId: params.matterId,
        versionId: first.beforeVersionId,
      });
      const current = head
        ? await this.store.getVersion({
            organizationId: params.organizationId,
            matterId: params.matterId,
            versionId: head.currentVersionId,
          })
        : null;
      items.push(
        this.previewItem({
          objectType: first.objectType,
          objectId: first.objectId,
          target,
          current,
          head,
          restoreApprovals: false,
          actorUserId: params.actorUserId,
        }),
      );
    }
    return summarizePreview(items);
  }

  async restoreSession(params: {
    organizationId: string;
    matterId: string;
    actorUserId: string;
    sessionId: string;
    role: LegalWorkRole;
    idempotencyKey?: string | null;
  }) {
    const preview = await this.previewSessionRestore(params);
    const restored = [];
    const skipped = [];
    for (const item of preview.items) {
      if (item.irreversible || !item.targetVersionId) {
        skipped.push(item);
        continue;
      }
      if (item.conflict) {
        skipped.push(item);
        continue;
      }
      const result = await this.restoreVersion({
        organizationId: params.organizationId,
        matterId: params.matterId,
        actorUserId: params.actorUserId,
        objectType: item.objectType,
        objectId: item.objectId,
        targetVersionId: item.targetVersionId,
        mode: "as_new_version",
        role: params.role,
        sessionId: params.sessionId,
        idempotencyKey: params.idempotencyKey
          ? `${params.idempotencyKey}:${item.objectType}:${item.objectId}`
          : null,
      });
      restored.push(result);
    }
    return { preview, restored, skipped };
  }

  async restoreBulkAction(params: {
    organizationId: string;
    matterId: string;
    actorUserId: string;
    checkpointId: string;
    role: LegalWorkRole;
    idempotencyKey?: string | null;
  }) {
    if (!canBulkRestore(params.role)) {
      throw new LegalWorkForbiddenError("Bulk restore requires edit access.");
    }
    const checkpoint = await this.store.getCheckpoint({
      organizationId: params.organizationId,
      matterId: params.matterId,
      checkpointId: params.checkpointId,
    });
    if (!checkpoint) throw new LegalWorkNotFoundError("Bulk checkpoint not found.");
    const items = await this.store.listCheckpointItems({
      organizationId: params.organizationId,
      matterId: params.matterId,
      checkpointId: params.checkpointId,
    });
    const restored = [];
    const conflicts = [];
    const skipped = [];
    const irreversible = [];
    for (const item of items) {
      const ref = {
        organizationId: params.organizationId,
        matterId: params.matterId,
        objectType: item.objectType,
        objectId: item.objectId,
      };
      if (isProtectedObjectType(item.objectType)) {
        irreversible.push({
          objectType: item.objectType,
          objectId: item.objectId,
          message: protectedReason(item.objectType),
        });
        continue;
      }
      const head = await this.store.getHead(ref);
      const checkpointVersion = await this.store.getVersion({
        organizationId: params.organizationId,
        matterId: params.matterId,
        versionId: item.versionId,
      });
      const current = head
        ? await this.store.getVersion({
            organizationId: params.organizationId,
            matterId: params.matterId,
            versionId: head.currentVersionId,
          })
        : null;
      if (!head || !checkpointVersion || !current) {
        skipped.push({
          objectType: item.objectType,
          objectId: item.objectId,
          message: "No recoverable version is available for this item.",
        });
        continue;
      }
      if (head.lockState !== "unlocked") {
        irreversible.push({
          objectType: item.objectType,
          objectId: item.objectId,
          message:
            head.lockState === "finalized"
              ? "This record is finalized and will not be overwritten."
              : "This record is locked and will not be overwritten.",
        });
        continue;
      }
      if (current.id === item.versionId) {
        skipped.push({
          objectType: item.objectType,
          objectId: item.objectId,
          message: "Already at the checkpoint state.",
        });
        continue;
      }
      if (current.versionNumber > checkpointVersion.versionNumber + 1) {
        conflicts.push({
          objectType: item.objectType,
          objectId: item.objectId,
          message:
            current.actorUserId && current.actorUserId !== params.actorUserId
              ? "Newer changes exist from another person and will not be overwritten."
              : "Later changes exist and will not be overwritten.",
        });
        continue;
      }
      const result = await this.restoreVersion({
        organizationId: params.organizationId,
        matterId: params.matterId,
        actorUserId: params.actorUserId,
        objectType: item.objectType,
        objectId: item.objectId,
        targetVersionId: item.versionId,
        mode: "as_new_version",
        role: params.role,
        checkpointId: params.checkpointId,
        idempotencyKey: params.idempotencyKey
          ? `${params.idempotencyKey}:${item.objectType}:${item.objectId}`
          : null,
      });
      restored.push(result);
    }
    const conflictCount = conflicts.length;
    return {
      restored,
      conflicts,
      skipped,
      irreversible,
      summary:
        conflictCount === 0 && irreversible.length === 0
          ? `Restored ${restored.length} item${restored.length === 1 ? "" : "s"} as new versions.`
          : `${conflictCount + irreversible.length} item${
              conflictCount + irreversible.length === 1 ? "" : "s"
            } changed after this action and won't be overwritten.`,
    };
  }

  async startSession(params: {
    organizationId: string;
    matterId: string;
    actorUserId: string;
    reason?: string | null;
  }) {
    const row = {
      id: this.store.newId(),
      organizationId: params.organizationId,
      matterId: params.matterId,
      actorUserId: params.actorUserId,
      reason: params.reason ?? null,
      startedAt: this.store.now(),
      endedAt: null,
      createdAt: this.store.now(),
    };
    await this.store.insertSession(row);
    return row;
  }

  async listStaleMarkers(params: {
    organizationId: string;
    matterId: string;
    objectType?: LegalWorkObjectType;
    objectId?: string;
  }) {
    return this.store.listStaleMarkers(params);
  }

  private async scopedVersion(ref: ObjectRef, versionId: string) {
    const version = await this.store.getVersion({
      organizationId: ref.organizationId,
      matterId: ref.matterId,
      versionId,
    });
    if (
      !version ||
      version.objectType !== ref.objectType ||
      version.objectId !== ref.objectId ||
      version.organizationId !== ref.organizationId ||
      version.matterId !== ref.matterId
    ) {
      throw new LegalWorkNotFoundError("Version not found in this case.");
    }
    return version;
  }

  private previewItem(params: {
    objectType: LegalWorkObjectType;
    objectId: string;
    target: LegalWorkVersionRecord | null;
    current: LegalWorkVersionRecord | null;
    head: Awaited<ReturnType<LegalWorkStore["getHead"]>>;
    restoreApprovals: boolean;
    actorUserId?: string;
  }): RestorePreviewItem {
    const locked = params.head ? detectLockedConflict(params.head.lockState) : null;
    const protectedConflict = detectProtectedConflict(params.objectType);
    const foreign =
      params.current &&
      params.actorUserId &&
      params.current.actorUserId &&
      params.current.actorUserId !== params.actorUserId &&
      params.target &&
      params.current.id !== params.target.id
        ? {
            kind: "newer_edit" as const,
            message: "Newer changes exist and will not be overwritten.",
            currentVersionId: params.current.id,
            currentVersionNumber: params.current.versionNumber,
            currentActorUserId: params.current.actorUserId,
            targetVersionId: params.target.id,
          }
        : null;
    const conflict = protectedConflict ?? locked ?? foreign;
    const approvalReset = Boolean(
      params.current &&
        params.target &&
        contentChanged(params.objectType, params.current.payload, params.target.payload) &&
        !params.restoreApprovals,
    );
    return {
      objectType: params.objectType,
      objectId: params.objectId,
      targetVersionId: params.target?.id ?? null,
      targetVersionNumber: params.target?.versionNumber ?? null,
      currentVersionId: params.current?.id ?? params.head?.currentVersionId ?? null,
      currentVersionNumber: params.current?.versionNumber ?? params.head?.currentVersionNumber ?? null,
      conflict,
      irreversible: Boolean(protectedConflict) || !params.target,
      irreversibleReason: protectedConflict?.message ?? null,
      approvalReset,
      description: params.target
        ? `Restore version ${params.target.versionNumber} as a new version`
        : "Created in this session and has no earlier version to restore",
    };
  }

  private async markDownstreamStale(ref: ObjectRef, sourceVersionId: string) {
    const types = DOWNSTREAM_TYPES[ref.objectType] ?? [];
    if (types.length === 0) return;
    const downstream = await this.store.listDownstream(ref);
    const reason =
      STALE_COPY[ref.objectType] ?? "A related record was restored to an earlier state.";
    for (const item of downstream) {
      if (!types.includes(item.objectType)) continue;
      await this.store.insertStaleMarker({
        id: this.store.newId(),
        organizationId: ref.organizationId,
        matterId: ref.matterId,
        objectType: item.objectType,
        objectId: item.objectId,
        sourceObjectType: ref.objectType,
        sourceObjectId: ref.objectId,
        sourceVersionId,
        reason,
        createdAt: this.store.now(),
        resolvedAt: null,
        resolvedByUserId: null,
      });
    }
  }
}

function describeOperation(operation: string, objectType: LegalWorkObjectType): string {
  const label = objectType.replace(/_/g, " ");
  switch (operation) {
    case "create":
      return `Created ${label}`;
    case "review":
      return `Reviewed ${label}`;
    case "approve":
      return `Approved ${label}`;
    case "reject":
      return `Rejected ${label}`;
    case "retire":
      return `Retired ${label}`;
    case "restore":
      return `Restored ${label}`;
    case "undo":
      return `Undid last ${label} change`;
    case "tag":
      return `Updated ${label} tags`;
    default:
      return `Updated ${label}`;
  }
}

function summarizeVersion(version: LegalWorkVersionRecord) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    actorUserId: version.actorUserId,
    source: sourceLabel(version.source),
    createdAt: version.createdAt,
    restorationOfVersionId: version.restorationOfVersionId,
  };
}

function textDiffIfPresent(before: LegalWorkPayload, after: LegalWorkPayload): DiffChange[] {
  const fields = ["content", "summary", "title", "description", "explanation"] as const;
  const out: DiffChange[] = [];
  for (const field of fields) {
    if (typeof before[field] === "string" && typeof after[field] === "string") {
      out.push(
        ...diffTextLines(String(before[field]), String(after[field])).map((change) => ({
          ...change,
          path: `${field}:${change.path}`,
        })),
      );
    }
  }
  return out;
}

function summarizePreview(items: RestorePreviewItem[]): RestorePreview {
  const restorableCount = items.filter((i) => !i.conflict && !i.irreversible && i.targetVersionId).length;
  const conflictCount = items.filter((i) => i.conflict).length;
  const irreversibleCount = items.filter((i) => i.irreversible).length;
  const summaryParts = [`${restorableCount} item${restorableCount === 1 ? "" : "s"} can be restored as new versions.`];
  if (conflictCount) {
    summaryParts.push(
      `${conflictCount} item${conflictCount === 1 ? "" : "s"} changed after this action and won't be overwritten.`,
    );
  }
  if (irreversibleCount) {
    summaryParts.push(
      `${irreversibleCount} item${irreversibleCount === 1 ? "" : "s"} cannot be undone.`,
    );
  }
  return { items, restorableCount, conflictCount, irreversibleCount, summary: summaryParts.join(" ") };
}
