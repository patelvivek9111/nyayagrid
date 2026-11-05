import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "./index";
import { permissions, roles } from "./schema/index";
import { SYSTEM_ROLE_DEFINITIONS } from "./system-roles";

/**
 * Professional system-role policy:
 * - Keys in SYSTEM_ROLE_DEFINITIONS are managed system roles (`isSystem: true`).
 * - Managed baseline capabilities must remain present (additive ensure/reconcile).
 * - Organization-specific *extra* capabilities on those roles are preserved by default
 *   (`mode: "additive"`). They are never silently deleted.
 * - `mode: "strict"` resets a system role to the exact definition set. That is an explicit
 *   administrative enforcement of immutable system-role definitions — call only from an
 *   authorized organization.manage path, never from invites or read requests.
 * - Owner may include prosecution.* as the organization bridge role (explicit in definitions).
 * - Other Professional system roles must not receive prosecution.* via these helpers.
 */

const PROSECUTION_CAPABILITY_PREFIX = "prosecution.";

function assertProfessionalRoleCapabilities(
  roleKey: string,
  capabilities: readonly string[],
): void {
  if (roleKey === "owner") return;
  const bad = capabilities.filter((c) => c.startsWith(PROSECUTION_CAPABILITY_PREFIX));
  if (bad.length > 0) {
    throw new Error(
      `Professional role "${roleKey}" must not grant prosecution capabilities: ${bad.join(", ")}`,
    );
  }
}

/**
 * Idempotently ensure Professional system roles (admin/partner/paralegal/…) exist
 * for an organization created before those keys were added. Creates missing roles only;
 * does not alter permissions on roles that already exist.
 */
export async function ensureProfessionalSystemRoles(
  db: Database,
  organizationId: string,
): Promise<void> {
  for (const def of SYSTEM_ROLE_DEFINITIONS) {
    assertProfessionalRoleCapabilities(def.key, def.capabilities);
    const [existing] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.key, def.key)))
      .limit(1);
    if (existing) continue;
    const [created] = await db
      .insert(roles)
      .values({
        organizationId,
        key: def.key,
        name: def.name,
        description: def.description,
        isSystem: true,
      })
      .returning();
    if (!created) continue;
    if (def.capabilities.length > 0) {
      await db.insert(permissions).values(
        def.capabilities.map((capability) => ({
          roleId: created.id,
          capability,
        })),
      );
    }
  }
}

export type ProfessionalReconcileMode = "additive" | "strict";

/**
 * Reconcile permissions for system Professional roles.
 * Default `additive`: insert missing managed capabilities; preserve org custom extras.
 * `strict`: enforce exact definition sets (immutable system-role policy) — admin only.
 */
export async function reconcileProfessionalSystemRolePermissions(
  db: Database,
  organizationId: string,
  options?: { mode?: ProfessionalReconcileMode },
): Promise<{
  mode: ProfessionalReconcileMode;
  capabilitiesAdded: number;
  capabilitiesRemoved: number;
}> {
  const mode = options?.mode ?? "additive";
  await ensureProfessionalSystemRoles(db, organizationId);
  let capabilitiesAdded = 0;
  let capabilitiesRemoved = 0;

  for (const def of SYSTEM_ROLE_DEFINITIONS) {
    assertProfessionalRoleCapabilities(def.key, def.capabilities);
    const [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.key, def.key)))
      .limit(1);
    if (!role) continue;
    const existing = await db
      .select({ capability: permissions.capability })
      .from(permissions)
      .where(eq(permissions.roleId, role.id));
    const have = new Set(existing.map((row) => row.capability));
    const want = new Set<string>(def.capabilities);
    const missing = def.capabilities.filter((capability) => !have.has(capability));
    if (missing.length > 0) {
      await db
        .insert(permissions)
        .values(missing.map((capability) => ({ roleId: role.id, capability })));
      capabilitiesAdded += missing.length;
    }
    if (mode === "strict") {
      const extras = [...have].filter((capability) => !want.has(capability));
      if (extras.length > 0) {
        await db
          .delete(permissions)
          .where(and(eq(permissions.roleId, role.id), inArray(permissions.capability, extras)));
        capabilitiesRemoved += extras.length;
      }
    }
  }

  return { mode, capabilitiesAdded, capabilitiesRemoved };
}
