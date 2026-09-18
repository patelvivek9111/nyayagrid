import { writeAuditEvent } from "@nyayagrid/permissions";
import type { Database } from "@nyayagrid/database";
import type { MatterAccess } from "@nyayagrid/permissions";
import type { Capability } from "@nyayagrid/validation";
import { LegalWorkEngine } from "./engine";
import { PostgresLegalWorkStore } from "./postgres";
import { loadLivePayload } from "./adapters";
import { capabilityForObject } from "./policy";
import type {
  LegalWorkObjectType,
  LegalWorkRole,
  RecordMutationInput,
  RestoreVersionInput,
} from "./types";

export * from "./types";
export * from "./errors";
export * from "./policy";
export * from "./diff";
export * from "./conflict";
export * from "./engine";
export * from "./store";
export { PostgresLegalWorkStore } from "./postgres";
export { runBulkLegalWorkMutations } from "./bulk";
export { loadLivePayload } from "./adapters";

export function createLegalWorkEngine(db: Database) {
  return new LegalWorkEngine(new PostgresLegalWorkStore(db));
}

export function roleFromAccess(params: {
  access: MatterAccess;
  capabilities: Set<Capability>;
}): LegalWorkRole {
  if (params.capabilities.has("organization.manage")) return "admin";
  if (params.access === "manage") return "admin";
  if (params.access === "edit") return "editor";
  return "viewer";
}

export function restoreCapability(objectType: LegalWorkObjectType): Capability {
  return capabilityForObject(objectType, "restore");
}

export async function recordLegalWorkChange(
  db: Database,
  input: RecordMutationInput & { skipApply?: boolean },
) {
  const engine = createLegalWorkEngine(db);
  const result = await engine.recordMutation({ ...input, skipApply: input.skipApply ?? true });
  await writeAuditEvent(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    matterId: input.matterId,
    action: `legal_work.${input.operation}`,
    targetType: input.objectType,
    targetId: input.objectId,
    metadata: {
      actionId: result.action.id,
      beforeVersionId: result.action.beforeVersionId,
      afterVersionId: result.action.afterVersionId,
      source: input.source,
      sessionId: input.sessionId ?? null,
      reversible: result.action.reversible,
    },
  });
  return result;
}

export async function restoreLegalWorkVersion(db: Database, input: RestoreVersionInput) {
  const engine = createLegalWorkEngine(db);
  const result = await engine.restoreVersion(input);
  if (!result.idempotent && "restoration" in result && result.restoration) {
    await writeAuditEvent(db, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      matterId: input.matterId,
      action: "legal_work.restored",
      targetType: input.objectType,
      targetId: input.objectId,
      metadata: {
        targetVersionId: result.restoration.targetVersionId,
        previousCurrentVersionId: result.restoration.previousCurrentVersionId,
        restoredVersionId: result.restoration.restoredVersionId,
        sessionId: result.restoration.sessionId,
        checkpointId: result.restoration.checkpointId,
        reason: result.restoration.reason,
        conflicts: result.restoration.conflicts,
      },
    });
  }
  return result;
}

export async function trackLiveChange(
  db: Database,
  input: Omit<RecordMutationInput, "afterPayload"> & { afterPayload?: RecordMutationInput["afterPayload"] },
) {
  const payload =
    input.afterPayload ??
    (await loadLivePayload(db, {
      organizationId: input.organizationId,
      matterId: input.matterId,
      objectType: input.objectType,
      objectId: input.objectId,
    }));
  if (!payload) return null;
  return recordLegalWorkChange(db, { ...input, afterPayload: payload, skipApply: true });
}

export async function snapshotIfNeeded(
  db: Database,
  params: {
    organizationId: string;
    matterId: string;
    actorUserId: string;
    objectType: LegalWorkObjectType;
    objectId: string;
    source?: RecordMutationInput["source"];
  },
) {
  const engine = createLegalWorkEngine(db);
  const store = new PostgresLegalWorkStore(db);
  const head = await store.getHead(params);
  if (head) return head;
  const live = await loadLivePayload(db, params);
  if (!live) return null;
  const recorded = await engine.recordMutation({
    organizationId: params.organizationId,
    matterId: params.matterId,
    actorUserId: params.actorUserId,
    objectType: params.objectType,
    objectId: params.objectId,
    operation: "create",
    source: params.source ?? "system",
    afterPayload: live,
    description: "Baseline version",
    skipApply: true,
  });
  return store.getHead(params).then((h) => h ?? recorded);
}
