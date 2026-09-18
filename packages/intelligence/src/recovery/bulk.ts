import { writeAuditEvent } from "@nyayagrid/permissions";
import type { Database } from "@nyayagrid/database";
import { loadLivePayload } from "./adapters";
import { LegalWorkEngine } from "./engine";
import { PostgresLegalWorkStore } from "./postgres";
import type { LegalWorkObjectType, LegalWorkOperation, LegalWorkPayload } from "./types";

export type BulkLegalWorkOperation = {
  objectType: LegalWorkObjectType;
  objectId: string;
  operation: LegalWorkOperation;
  afterPayload: LegalWorkPayload;
};

/**
 * Auto-creates a bulk checkpoint, then applies each mutation as a versioned change.
 * Callers do not create the checkpoint themselves. Partial failures leave the
 * checkpoint usable for restore of objects that did change.
 *
 * Graph recovery versions semantic node/edge attributes only. Derived graph
 * materialization is marked stale and rematerialize skips semanticOverride fields.
 */
export async function runBulkLegalWorkMutations(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  actorUserId: string;
  reason?: string | null;
  sessionId?: string | null;
  operations: BulkLegalWorkOperation[];
}) {
  const store = new PostgresLegalWorkStore(params.db);
  const engine = new LegalWorkEngine(store);
  const objects = params.operations.map((operation) => ({
    objectType: operation.objectType,
    objectId: operation.objectId,
  }));
  for (const object of objects) {
    const head = await store.getHead({
      organizationId: params.organizationId,
      matterId: params.matterId,
      objectType: object.objectType,
      objectId: object.objectId,
    });
    if (head) continue;
    const live = await loadLivePayload(params.db, {
      organizationId: params.organizationId,
      matterId: params.matterId,
      objectType: object.objectType,
      objectId: object.objectId,
    });
    if (!live) continue;
    await engine.recordMutation({
      organizationId: params.organizationId,
      matterId: params.matterId,
      actorUserId: params.actorUserId,
      objectType: object.objectType,
      objectId: object.objectId,
      operation: "create",
      source: "system",
      afterPayload: live,
      description: "Baseline version",
      skipApply: true,
    });
  }
  const checkpoint = await engine.createCheckpoint({
    organizationId: params.organizationId,
    matterId: params.matterId,
    actorUserId: params.actorUserId,
    kind: "bulk",
    objects,
    reason: params.reason,
    sessionId: params.sessionId,
  });

  const applied = [];
  const errors = [];
  for (const operation of params.operations) {
    try {
      const recorded = await engine.recordMutation({
        organizationId: params.organizationId,
        matterId: params.matterId,
        actorUserId: params.actorUserId,
        objectType: operation.objectType,
        objectId: operation.objectId,
        operation: operation.operation,
        source: "bulk",
        afterPayload: operation.afterPayload,
        checkpointId: checkpoint.checkpoint.id,
        sessionId: params.sessionId,
        skipApply: false,
      });
      await writeAuditEvent(params.db, {
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        matterId: params.matterId,
        action: "legal_work.bulk_update",
        targetType: operation.objectType,
        targetId: operation.objectId,
        metadata: {
          checkpointId: checkpoint.checkpoint.id,
          actionId: recorded.action.id,
          afterVersionId: recorded.version.id,
        },
      });
      applied.push({
        objectType: operation.objectType,
        objectId: operation.objectId,
        actionId: recorded.action.id,
        versionId: recorded.version.id,
      });
    } catch (error) {
      errors.push({
        objectType: operation.objectType,
        objectId: operation.objectId,
        message: error instanceof Error ? error.message : "Bulk change failed.",
      });
    }
  }

  return {
    checkpoint: checkpoint.checkpoint,
    items: checkpoint.items,
    applied,
    errors,
    summary:
      errors.length === 0
        ? `Updated ${applied.length} item${applied.length === 1 ? "" : "s"}.`
        : `Updated ${applied.length} item${applied.length === 1 ? "" : "s"}; ${errors.length} could not be changed.`,
  };
}
