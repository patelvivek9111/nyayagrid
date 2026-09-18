import { randomUUID } from "node:crypto";
import type {
  CheckpointKind,
  LegalWorkActionRecord,
  LegalWorkCheckpointItemRecord,
  LegalWorkCheckpointRecord,
  LegalWorkHeadRecord,
  LegalWorkLockState,
  LegalWorkObjectType,
  LegalWorkPayload,
  LegalWorkRestorationRecord,
  LegalWorkSessionRecord,
  LegalWorkStaleMarkerRecord,
  LegalWorkVersionRecord,
} from "./types";

export type ObjectRef = {
  organizationId: string;
  matterId: string;
  objectType: LegalWorkObjectType;
  objectId: string;
};

export interface LegalWorkStore {
  now(): Date;
  newId(): string;

  getHead(ref: ObjectRef): Promise<LegalWorkHeadRecord | null>;
  listHeads(params: { organizationId: string; matterId: string }): Promise<LegalWorkHeadRecord[]>;
  upsertHead(head: LegalWorkHeadRecord): Promise<void>;

  getVersion(params: {
    organizationId: string;
    matterId: string;
    versionId: string;
  }): Promise<LegalWorkVersionRecord | null>;
  listVersions(ref: ObjectRef): Promise<LegalWorkVersionRecord[]>;
  insertVersion(version: LegalWorkVersionRecord): Promise<void>;

  insertAction(action: LegalWorkActionRecord): Promise<void>;
  getAction(params: {
    organizationId: string;
    matterId: string;
    actionId: string;
  }): Promise<LegalWorkActionRecord | null>;
  listActions(params: {
    organizationId: string;
    matterId: string;
    actorUserId?: string;
    objectType?: LegalWorkObjectType;
    objectId?: string;
    sessionId?: string;
    checkpointId?: string;
    limit?: number;
  }): Promise<LegalWorkActionRecord[]>;

  insertCheckpoint(checkpoint: LegalWorkCheckpointRecord): Promise<void>;
  getCheckpoint(params: {
    organizationId: string;
    matterId: string;
    checkpointId: string;
  }): Promise<LegalWorkCheckpointRecord | null>;
  insertCheckpointItems(items: LegalWorkCheckpointItemRecord[]): Promise<void>;
  listCheckpointItems(params: {
    organizationId: string;
    matterId: string;
    checkpointId: string;
  }): Promise<LegalWorkCheckpointItemRecord[]>;

  insertRestoration(row: LegalWorkRestorationRecord): Promise<void>;
  getRestorationByIdempotency(params: {
    organizationId: string;
    idempotencyKey: string;
  }): Promise<LegalWorkRestorationRecord | null>;

  insertStaleMarker(row: LegalWorkStaleMarkerRecord): Promise<void>;
  listStaleMarkers(params: {
    organizationId: string;
    matterId: string;
    objectType?: LegalWorkObjectType;
    objectId?: string;
  }): Promise<LegalWorkStaleMarkerRecord[]>;

  insertSession(row: LegalWorkSessionRecord): Promise<void>;
  getSession(params: {
    organizationId: string;
    matterId: string;
    sessionId: string;
  }): Promise<LegalWorkSessionRecord | null>;

  loadLive(ref: ObjectRef): Promise<LegalWorkPayload | null>;
  applyLive(params: ObjectRef & { payload: LegalWorkPayload }): Promise<void>;
  listDownstream(params: ObjectRef): Promise<Array<{ objectType: LegalWorkObjectType; objectId: string }>>;
  withTransaction?<T>(fn: (store: LegalWorkStore) => Promise<T>): Promise<T>;
}

export class MemoryLegalWorkStore implements LegalWorkStore {
  heads = new Map<string, LegalWorkHeadRecord>();
  versions: LegalWorkVersionRecord[] = [];
  actions: LegalWorkActionRecord[] = [];
  checkpoints: LegalWorkCheckpointRecord[] = [];
  checkpointItems: LegalWorkCheckpointItemRecord[] = [];
  restorations: LegalWorkRestorationRecord[] = [];
  stale: LegalWorkStaleMarkerRecord[] = [];
  sessions: LegalWorkSessionRecord[] = [];
  live = new Map<string, LegalWorkPayload>();
  clock = new Date("2026-09-18T15:00:00.000Z");

  now() {
    this.clock = new Date(this.clock.getTime() + 1000);
    return new Date(this.clock);
  }
  newId() {
    return randomUUID();
  }

  private key(ref: ObjectRef) {
    return `${ref.organizationId}:${ref.matterId}:${ref.objectType}:${ref.objectId}`;
  }

  async getHead(ref: ObjectRef) {
    return this.heads.get(this.key(ref)) ?? null;
  }
  async listHeads(params: { organizationId: string; matterId: string }) {
    return [...this.heads.values()].filter(
      (h) => h.organizationId === params.organizationId && h.matterId === params.matterId,
    );
  }
  async upsertHead(head: LegalWorkHeadRecord) {
    this.heads.set(
      this.key({
        organizationId: head.organizationId,
        matterId: head.matterId,
        objectType: head.objectType,
        objectId: head.objectId,
      }),
      head,
    );
  }
  async getVersion(params: { organizationId: string; matterId: string; versionId: string }) {
    return (
      this.versions.find(
        (v) =>
          v.id === params.versionId &&
          v.organizationId === params.organizationId &&
          v.matterId === params.matterId,
      ) ?? null
    );
  }
  async listVersions(ref: ObjectRef) {
    return this.versions
      .filter(
        (v) =>
          v.organizationId === ref.organizationId &&
          v.matterId === ref.matterId &&
          v.objectType === ref.objectType &&
          v.objectId === ref.objectId,
      )
      .sort((a, b) => a.versionNumber - b.versionNumber);
  }
  async insertVersion(version: LegalWorkVersionRecord) {
    this.versions.push(version);
  }
  async insertAction(action: LegalWorkActionRecord) {
    this.actions.push(action);
  }
  async getAction(params: { organizationId: string; matterId: string; actionId: string }) {
    return (
      this.actions.find(
        (a) =>
          a.id === params.actionId &&
          a.organizationId === params.organizationId &&
          a.matterId === params.matterId,
      ) ?? null
    );
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
    const rows = this.actions
      .filter((a) => a.organizationId === params.organizationId && a.matterId === params.matterId)
      .filter((a) => (params.actorUserId ? a.actorUserId === params.actorUserId : true))
      .filter((a) => (params.objectType ? a.objectType === params.objectType : true))
      .filter((a) => (params.objectId ? a.objectId === params.objectId : true))
      .filter((a) => (params.sessionId ? a.sessionId === params.sessionId : true))
      .filter((a) => (params.checkpointId ? a.checkpointId === params.checkpointId : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return params.limit ? rows.slice(0, params.limit) : rows;
  }
  async insertCheckpoint(checkpoint: LegalWorkCheckpointRecord) {
    this.checkpoints.push(checkpoint);
  }
  async getCheckpoint(params: { organizationId: string; matterId: string; checkpointId: string }) {
    return (
      this.checkpoints.find(
        (c) =>
          c.id === params.checkpointId &&
          c.organizationId === params.organizationId &&
          c.matterId === params.matterId,
      ) ?? null
    );
  }
  async insertCheckpointItems(items: LegalWorkCheckpointItemRecord[]) {
    this.checkpointItems.push(...items);
  }
  async listCheckpointItems(params: {
    organizationId: string;
    matterId: string;
    checkpointId: string;
  }) {
    return this.checkpointItems.filter(
      (i) =>
        i.checkpointId === params.checkpointId &&
        i.organizationId === params.organizationId &&
        i.matterId === params.matterId,
    );
  }
  async insertRestoration(row: LegalWorkRestorationRecord) {
    this.restorations.push(row);
  }
  async getRestorationByIdempotency(params: { organizationId: string; idempotencyKey: string }) {
    return (
      this.restorations.find(
        (r) => r.organizationId === params.organizationId && r.idempotencyKey === params.idempotencyKey,
      ) ?? null
    );
  }
  async insertStaleMarker(row: LegalWorkStaleMarkerRecord) {
    const existing = this.stale.findIndex(
      (m) =>
        m.objectType === row.objectType &&
        m.objectId === row.objectId &&
        m.sourceObjectType === row.sourceObjectType &&
        m.sourceObjectId === row.sourceObjectId &&
        m.resolvedAt === null,
    );
    if (existing >= 0) this.stale[existing] = row;
    else this.stale.push(row);
  }
  async listStaleMarkers(params: {
    organizationId: string;
    matterId: string;
    objectType?: LegalWorkObjectType;
    objectId?: string;
  }) {
    return this.stale.filter(
      (m) =>
        m.organizationId === params.organizationId &&
        m.matterId === params.matterId &&
        (params.objectType ? m.objectType === params.objectType : true) &&
        (params.objectId ? m.objectId === params.objectId : true) &&
        m.resolvedAt === null,
    );
  }
  async insertSession(row: LegalWorkSessionRecord) {
    this.sessions.push(row);
  }
  async getSession(params: { organizationId: string; matterId: string; sessionId: string }) {
    return (
      this.sessions.find(
        (s) =>
          s.id === params.sessionId &&
          s.organizationId === params.organizationId &&
          s.matterId === params.matterId,
      ) ?? null
    );
  }
  async loadLive(ref: ObjectRef) {
    return this.live.get(this.key(ref)) ?? null;
  }
  async applyLive(params: ObjectRef & { payload: LegalWorkPayload }) {
    this.live.set(this.key(params), { ...params.payload });
  }
  async listDownstream(params: ObjectRef) {
    return [...this.live.entries()]
      .filter(([key]) => key.startsWith(`${params.organizationId}:${params.matterId}:`))
      .map(([key]) => {
        const parts = key.split(":");
        return { objectType: parts[2] as LegalWorkObjectType, objectId: parts[3]! };
      })
      .filter((item) => !(item.objectType === params.objectType && item.objectId === params.objectId));
  }

  private snapshot() {
    return {
      heads: new Map(this.heads),
      versions: [...this.versions],
      actions: [...this.actions],
      checkpoints: [...this.checkpoints],
      checkpointItems: [...this.checkpointItems],
      restorations: [...this.restorations],
      stale: [...this.stale],
      sessions: [...this.sessions],
      live: new Map(this.live),
    };
  }

  async withTransaction<T>(fn: (store: LegalWorkStore) => Promise<T>): Promise<T> {
    const snap = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      this.heads = snap.heads;
      this.versions = snap.versions;
      this.actions = snap.actions;
      this.checkpoints = snap.checkpoints;
      this.checkpointItems = snap.checkpointItems;
      this.restorations = snap.restorations;
      this.stale = snap.stale;
      this.sessions = snap.sessions;
      this.live = snap.live;
      throw error;
    }
  }
}

export function emptyHead(params: {
  id: string;
  organizationId: string;
  matterId: string;
  objectType: LegalWorkObjectType;
  objectId: string;
  currentVersionId: string;
  currentVersionNumber: number;
  lockState?: LegalWorkLockState;
  now: Date;
}): LegalWorkHeadRecord {
  return {
    id: params.id,
    organizationId: params.organizationId,
    matterId: params.matterId,
    objectType: params.objectType,
    objectId: params.objectId,
    currentVersionId: params.currentVersionId,
    currentVersionNumber: params.currentVersionNumber,
    lockState: params.lockState ?? "unlocked",
    lockedAt: params.lockState && params.lockState !== "unlocked" ? params.now : null,
    lockedByUserId: null,
    updatedAt: params.now,
  };
}
