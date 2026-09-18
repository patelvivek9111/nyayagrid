import { randomUUID } from "node:crypto";
import { and, desc, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  legalWorkActions,
  legalWorkCheckpointItems,
  legalWorkCheckpoints,
  legalWorkHeads,
  legalWorkRestorations,
  legalWorkSessions,
  legalWorkStaleMarkers,
  legalWorkVersions,
} from "@nyayagrid/database";
import { applyLivePayload, listDownstreamRefs, loadLivePayload } from "./adapters";
import { DOWNSTREAM_TYPES } from "./policy";
import type { LegalWorkStore, ObjectRef } from "./store";
import type {
  LegalWorkActionRecord,
  LegalWorkCheckpointItemRecord,
  LegalWorkCheckpointRecord,
  LegalWorkHeadRecord,
  LegalWorkLockState,
  LegalWorkObjectType,
  LegalWorkRestorationRecord,
  LegalWorkSessionRecord,
  LegalWorkStaleMarkerRecord,
  LegalWorkVersionRecord,
} from "./types";

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapVersion(row: typeof legalWorkVersions.$inferSelect): LegalWorkVersionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    matterId: row.matterId,
    objectType: row.objectType as LegalWorkObjectType,
    objectId: row.objectId,
    versionNumber: row.versionNumber,
    payload: (row.payload ?? {}) as LegalWorkVersionRecord["payload"],
    actorUserId: row.actorUserId,
    source: (row.source as LegalWorkVersionRecord["source"]) ?? "user",
    priorVersionId: row.priorVersionId,
    actionId: row.actionId,
    restorationOfVersionId: row.restorationOfVersionId,
    nativeVersionId: row.nativeVersionId,
    createdAt: asDate(row.createdAt),
  };
}

function mapHead(row: typeof legalWorkHeads.$inferSelect): LegalWorkHeadRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    matterId: row.matterId,
    objectType: row.objectType as LegalWorkObjectType,
    objectId: row.objectId,
    currentVersionId: row.currentVersionId,
    currentVersionNumber: row.currentVersionNumber,
    lockState: (row.lockState as LegalWorkLockState) ?? "unlocked",
    lockedAt: row.lockedAt ? asDate(row.lockedAt) : null,
    lockedByUserId: row.lockedByUserId,
    updatedAt: asDate(row.updatedAt),
  };
}

function mapAction(row: typeof legalWorkActions.$inferSelect): LegalWorkActionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    matterId: row.matterId,
    actorUserId: row.actorUserId,
    objectType: row.objectType as LegalWorkObjectType,
    objectId: row.objectId,
    operation: row.operation as LegalWorkActionRecord["operation"],
    source: row.source as LegalWorkActionRecord["source"],
    beforeVersionId: row.beforeVersionId,
    afterVersionId: row.afterVersionId,
    sessionId: row.sessionId,
    checkpointId: row.checkpointId,
    parentActionId: row.parentActionId,
    reversible: row.reversible,
    irreversibleReason: row.irreversibleReason,
    description: row.description,
    aiArtifactId: row.aiArtifactId,
    provider: row.provider,
    model: row.model,
    createdAt: asDate(row.createdAt),
  };
}

export class PostgresLegalWorkStore implements LegalWorkStore {
  constructor(private readonly db: Database) {}

  now() {
    return new Date();
  }
  newId() {
    return randomUUID();
  }

  async getHead(ref: ObjectRef) {
    const [row] = await this.db
      .select()
      .from(legalWorkHeads)
      .where(
        and(
          eq(legalWorkHeads.organizationId, ref.organizationId),
          eq(legalWorkHeads.matterId, ref.matterId),
          eq(legalWorkHeads.objectType, ref.objectType),
          eq(legalWorkHeads.objectId, ref.objectId),
        ),
      )
      .limit(1);
    return row ? mapHead(row) : null;
  }

  async listHeads(params: { organizationId: string; matterId: string }) {
    const rows = await this.db
      .select()
      .from(legalWorkHeads)
      .where(
        and(
          eq(legalWorkHeads.organizationId, params.organizationId),
          eq(legalWorkHeads.matterId, params.matterId),
        ),
      );
    return rows.map(mapHead);
  }

  async upsertHead(head: LegalWorkHeadRecord) {
    const existing = await this.getHead(head);
    if (existing) {
      await this.db
        .update(legalWorkHeads)
        .set({
          currentVersionId: head.currentVersionId,
          currentVersionNumber: head.currentVersionNumber,
          lockState: head.lockState,
          lockedAt: head.lockedAt,
          lockedByUserId: head.lockedByUserId,
          updatedAt: head.updatedAt,
        })
        .where(eq(legalWorkHeads.id, existing.id));
      return;
    }
    await this.db.insert(legalWorkHeads).values({
      id: head.id,
      organizationId: head.organizationId,
      matterId: head.matterId,
      objectType: head.objectType,
      objectId: head.objectId,
      currentVersionId: head.currentVersionId,
      currentVersionNumber: head.currentVersionNumber,
      lockState: head.lockState,
      lockedAt: head.lockedAt,
      lockedByUserId: head.lockedByUserId,
      updatedAt: head.updatedAt,
    });
  }

  async getVersion(params: { organizationId: string; matterId: string; versionId: string }) {
    const [row] = await this.db
      .select()
      .from(legalWorkVersions)
      .where(
        and(
          eq(legalWorkVersions.id, params.versionId),
          eq(legalWorkVersions.organizationId, params.organizationId),
          eq(legalWorkVersions.matterId, params.matterId),
        ),
      )
      .limit(1);
    return row ? mapVersion(row) : null;
  }

  async listVersions(ref: ObjectRef) {
    const rows = await this.db
      .select()
      .from(legalWorkVersions)
      .where(
        and(
          eq(legalWorkVersions.organizationId, ref.organizationId),
          eq(legalWorkVersions.matterId, ref.matterId),
          eq(legalWorkVersions.objectType, ref.objectType),
          eq(legalWorkVersions.objectId, ref.objectId),
        ),
      );
    return rows.map(mapVersion).sort((a, b) => a.versionNumber - b.versionNumber);
  }

  async insertVersion(version: LegalWorkVersionRecord) {
    await this.db.insert(legalWorkVersions).values({
      id: version.id,
      organizationId: version.organizationId,
      matterId: version.matterId,
      objectType: version.objectType,
      objectId: version.objectId,
      versionNumber: version.versionNumber,
      payload: version.payload,
      actorUserId: version.actorUserId,
      source: version.source,
      priorVersionId: version.priorVersionId,
      actionId: version.actionId,
      restorationOfVersionId: version.restorationOfVersionId,
      nativeVersionId: version.nativeVersionId,
      createdAt: version.createdAt,
    });
  }

  async insertAction(action: LegalWorkActionRecord) {
    await this.db.insert(legalWorkActions).values({
      id: action.id,
      organizationId: action.organizationId,
      matterId: action.matterId,
      actorUserId: action.actorUserId,
      objectType: action.objectType,
      objectId: action.objectId,
      operation: action.operation,
      source: action.source,
      beforeVersionId: action.beforeVersionId,
      afterVersionId: action.afterVersionId,
      sessionId: action.sessionId,
      checkpointId: action.checkpointId,
      parentActionId: action.parentActionId,
      reversible: action.reversible,
      irreversibleReason: action.irreversibleReason,
      description: action.description,
      aiArtifactId: action.aiArtifactId,
      provider: action.provider,
      model: action.model,
      createdAt: action.createdAt,
    });
  }

  async getAction(params: { organizationId: string; matterId: string; actionId: string }) {
    const [row] = await this.db
      .select()
      .from(legalWorkActions)
      .where(
        and(
          eq(legalWorkActions.id, params.actionId),
          eq(legalWorkActions.organizationId, params.organizationId),
          eq(legalWorkActions.matterId, params.matterId),
        ),
      )
      .limit(1);
    return row ? mapAction(row) : null;
  }

  async listActions(params: {
    organizationId: string;
    matterId: string;
    actorUserId?: string;
    objectType?: LegalWorkObjectType;
    objectId?: string;
    sessionId?: string;
    checkpointId?: string;
    limit?: number;
  }) {
    const filters = [
      eq(legalWorkActions.organizationId, params.organizationId),
      eq(legalWorkActions.matterId, params.matterId),
    ];
    if (params.actorUserId) filters.push(eq(legalWorkActions.actorUserId, params.actorUserId));
    if (params.objectType) filters.push(eq(legalWorkActions.objectType, params.objectType));
    if (params.objectId) filters.push(eq(legalWorkActions.objectId, params.objectId));
    if (params.sessionId) filters.push(eq(legalWorkActions.sessionId, params.sessionId));
    if (params.checkpointId) filters.push(eq(legalWorkActions.checkpointId, params.checkpointId));
    const query = this.db
      .select()
      .from(legalWorkActions)
      .where(and(...filters))
      .orderBy(desc(legalWorkActions.createdAt));
    const rows = params.limit ? await query.limit(params.limit) : await query;
    return rows.map(mapAction);
  }

  async insertCheckpoint(checkpoint: LegalWorkCheckpointRecord) {
    await this.db.insert(legalWorkCheckpoints).values({
      id: checkpoint.id,
      organizationId: checkpoint.organizationId,
      matterId: checkpoint.matterId,
      actorUserId: checkpoint.actorUserId,
      kind: checkpoint.kind,
      reason: checkpoint.reason,
      sessionId: checkpoint.sessionId,
      parentActionId: checkpoint.parentActionId,
      createdAt: checkpoint.createdAt,
    });
  }

  async getCheckpoint(params: { organizationId: string; matterId: string; checkpointId: string }) {
    const [row] = await this.db
      .select()
      .from(legalWorkCheckpoints)
      .where(
        and(
          eq(legalWorkCheckpoints.id, params.checkpointId),
          eq(legalWorkCheckpoints.organizationId, params.organizationId),
          eq(legalWorkCheckpoints.matterId, params.matterId),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      matterId: row.matterId,
      actorUserId: row.actorUserId,
      kind: row.kind as LegalWorkCheckpointRecord["kind"],
      reason: row.reason,
      sessionId: row.sessionId,
      parentActionId: row.parentActionId,
      createdAt: asDate(row.createdAt),
    };
  }

  async insertCheckpointItems(items: LegalWorkCheckpointItemRecord[]) {
    if (items.length === 0) return;
    await this.db.insert(legalWorkCheckpointItems).values(
      items.map((item) => ({
        id: item.id,
        organizationId: item.organizationId,
        matterId: item.matterId,
        checkpointId: item.checkpointId,
        objectType: item.objectType,
        objectId: item.objectId,
        versionId: item.versionId,
        createdAt: item.createdAt,
      })),
    );
  }

  async listCheckpointItems(params: {
    organizationId: string;
    matterId: string;
    checkpointId: string;
  }) {
    const rows = await this.db
      .select()
      .from(legalWorkCheckpointItems)
      .where(
        and(
          eq(legalWorkCheckpointItems.checkpointId, params.checkpointId),
          eq(legalWorkCheckpointItems.organizationId, params.organizationId),
          eq(legalWorkCheckpointItems.matterId, params.matterId),
        ),
      );
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      matterId: row.matterId,
      checkpointId: row.checkpointId,
      objectType: row.objectType as LegalWorkObjectType,
      objectId: row.objectId,
      versionId: row.versionId,
      createdAt: asDate(row.createdAt),
    }));
  }

  async insertRestoration(row: LegalWorkRestorationRecord) {
    await this.db.insert(legalWorkRestorations).values({
      id: row.id,
      organizationId: row.organizationId,
      matterId: row.matterId,
      actorUserId: row.actorUserId,
      objectType: row.objectType,
      objectId: row.objectId,
      targetVersionId: row.targetVersionId,
      previousCurrentVersionId: row.previousCurrentVersionId,
      restoredVersionId: row.restoredVersionId,
      actionId: row.actionId,
      sessionId: row.sessionId,
      checkpointId: row.checkpointId,
      reason: row.reason,
      conflicts: row.conflicts,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt,
    });
  }

  async getRestorationByIdempotency(params: { organizationId: string; idempotencyKey: string }) {
    const [row] = await this.db
      .select()
      .from(legalWorkRestorations)
      .where(
        and(
          eq(legalWorkRestorations.organizationId, params.organizationId),
          eq(legalWorkRestorations.idempotencyKey, params.idempotencyKey),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      matterId: row.matterId,
      actorUserId: row.actorUserId,
      objectType: row.objectType as LegalWorkObjectType,
      objectId: row.objectId,
      targetVersionId: row.targetVersionId,
      previousCurrentVersionId: row.previousCurrentVersionId,
      restoredVersionId: row.restoredVersionId,
      actionId: row.actionId,
      sessionId: row.sessionId,
      checkpointId: row.checkpointId,
      reason: row.reason,
      conflicts: (row.conflicts ?? {}) as Record<string, unknown>,
      idempotencyKey: row.idempotencyKey,
      createdAt: asDate(row.createdAt),
    };
  }

  async insertStaleMarker(row: LegalWorkStaleMarkerRecord) {
    const existing = await this.listStaleMarkers({
      organizationId: row.organizationId,
      matterId: row.matterId,
      objectType: row.objectType,
      objectId: row.objectId,
    });
    if (
      existing.some(
        (marker) =>
          marker.sourceObjectType === row.sourceObjectType && marker.sourceObjectId === row.sourceObjectId,
      )
    ) {
      return;
    }
    await this.db.insert(legalWorkStaleMarkers).values({
      id: row.id,
      organizationId: row.organizationId,
      matterId: row.matterId,
      objectType: row.objectType,
      objectId: row.objectId,
      sourceObjectType: row.sourceObjectType,
      sourceObjectId: row.sourceObjectId,
      sourceVersionId: row.sourceVersionId,
      reason: row.reason,
      createdAt: row.createdAt,
    });
  }

  async listStaleMarkers(params: {
    organizationId: string;
    matterId: string;
    objectType?: LegalWorkObjectType;
    objectId?: string;
  }) {
    const filters = [
      eq(legalWorkStaleMarkers.organizationId, params.organizationId),
      eq(legalWorkStaleMarkers.matterId, params.matterId),
    ];
    if (params.objectType) filters.push(eq(legalWorkStaleMarkers.objectType, params.objectType));
    if (params.objectId) filters.push(eq(legalWorkStaleMarkers.objectId, params.objectId));
    const rows = await this.db
      .select()
      .from(legalWorkStaleMarkers)
      .where(and(...filters));
    return rows
      .filter((row) => !row.resolvedAt)
      .map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        matterId: row.matterId,
        objectType: row.objectType as LegalWorkObjectType,
        objectId: row.objectId,
        sourceObjectType: row.sourceObjectType as LegalWorkObjectType,
        sourceObjectId: row.sourceObjectId,
        sourceVersionId: row.sourceVersionId,
        reason: row.reason,
        createdAt: asDate(row.createdAt),
        resolvedAt: row.resolvedAt ? asDate(row.resolvedAt) : null,
        resolvedByUserId: row.resolvedByUserId,
      }));
  }

  async insertSession(row: LegalWorkSessionRecord) {
    await this.db.insert(legalWorkSessions).values({
      id: row.id,
      organizationId: row.organizationId,
      matterId: row.matterId,
      actorUserId: row.actorUserId,
      reason: row.reason,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      createdAt: row.createdAt,
    });
  }

  async getSession(params: { organizationId: string; matterId: string; sessionId: string }) {
    const [row] = await this.db
      .select()
      .from(legalWorkSessions)
      .where(
        and(
          eq(legalWorkSessions.id, params.sessionId),
          eq(legalWorkSessions.organizationId, params.organizationId),
          eq(legalWorkSessions.matterId, params.matterId),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      matterId: row.matterId,
      actorUserId: row.actorUserId,
      reason: row.reason,
      startedAt: asDate(row.startedAt),
      endedAt: row.endedAt ? asDate(row.endedAt) : null,
      createdAt: asDate(row.createdAt),
    };
  }

  async loadLive(ref: ObjectRef) {
    return loadLivePayload(this.db, ref);
  }

  async applyLive(params: ObjectRef & { payload: LegalWorkVersionRecord["payload"] }) {
    await applyLivePayload(this.db, params, params.payload);
  }

  async listDownstream(params: ObjectRef) {
    return listDownstreamRefs(this.db, params, DOWNSTREAM_TYPES[params.objectType] ?? []);
  }

  async withTransaction<T>(fn: (store: LegalWorkStore) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => fn(new PostgresLegalWorkStore(tx as unknown as Database)));
  }
}
