import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "./index";
import { permissions, roles } from "./schema/index";
import { SYSTEM_ROLE_DEFINITIONS } from "./system-roles";

/**
 * Idempotently ensure Professional system roles (admin/partner/paralegal/…) exist
 * for an organization created before those keys were added.
 */
export async function ensureProfessionalSystemRoles(
  db: Database,
  organizationId: string,
): Promise<void> {
  for (const def of SYSTEM_ROLE_DEFINITIONS) {
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

/**
 * Reconcile permissions for system Professional roles to match definitions.
 * Used to close capability drift (e.g. after adding admin/partner/paralegal).
 */
export async function reconcileProfessionalSystemRolePermissions(
  db: Database,
  organizationId: string,
): Promise<void> {
  await ensureProfessionalSystemRoles(db, organizationId);
  for (const def of SYSTEM_ROLE_DEFINITIONS) {
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
      await db.insert(permissions).values(
        missing.map((capability) => ({ roleId: role.id, capability })),
      );
    }
    const extras = [...have].filter((capability) => !want.has(capability));
    if (extras.length > 0) {
      await db
        .delete(permissions)
        .where(and(eq(permissions.roleId, role.id), inArray(permissions.capability, extras)));
    }
  }
}
