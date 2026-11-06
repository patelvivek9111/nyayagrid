import {
  provisionProsecutionRoles,
  reconcileProfessionalSystemRolePermissions,
  type Database,
  type ProfessionalReconcileMode,
} from "@nyayagrid/database";
import { requireCapability, writeAuditEvent } from "@nyayagrid/permissions";

/**
 * Authorized administrative path for prosecution system-role provisioning.
 * Requires organization.manage. Safe to call idempotently; not used by audit reads.
 */
export async function provisionProsecutionRolesAsAdmin(
  db: Database,
  params: { userId: string; organizationId: string },
) {
  await requireCapability(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    capability: "organization.manage",
  });
  const result = await provisionProsecutionRoles(db, params.organizationId);
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: "prosecution.roles_provisioned",
    targetType: "organization",
    targetId: params.organizationId,
    metadata: result,
  });
  return result;
}

/**
 * Authorized administrative path for Professional system-role reconciliation.
 * Default additive mode preserves organization custom extras on system roles.
 * Strict mode enforces immutable system-role definitions (explicit admin choice).
 */
export async function reconcileProfessionalRolesAsAdmin(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    mode?: ProfessionalReconcileMode;
  },
) {
  await requireCapability(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    capability: "organization.manage",
  });
  const mode = params.mode ?? "additive";
  const result = await reconcileProfessionalSystemRolePermissions(db, params.organizationId, {
    mode,
  });
  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: "professional.roles_reconciled",
    targetType: "organization",
    targetId: params.organizationId,
    metadata: result,
  });
  return result;
}
