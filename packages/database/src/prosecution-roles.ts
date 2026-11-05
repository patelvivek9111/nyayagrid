import { and, eq } from "drizzle-orm";
import type { Database } from "./index";
import { permissions, roles } from "./schema/index";
import { PROSECUTION_ROLE_DEFINITIONS } from "./system-roles";

const OWNER_PROSECUTION_CAPABILITIES = [
  "prosecution.view",
  "prosecution.edit",
  "prosecution.review",
] as const;

/**
 * Prosecution system-role policy:
 * - Keys in PROSECUTION_ROLE_DEFINITIONS are managed system roles (`isSystem: true`).
 * - Managed baseline capabilities are additive: missing caps may be inserted by an
 *   explicitly authorized administrative/operational provision call.
 * - Legal Support must never retain `prosecution.edit` (security hardening).
 * - Do not call this from read-only request paths (e.g. audit listing).
 */
export async function provisionProsecutionRoles(
  db: Database,
  organizationId: string,
): Promise<{ rolesCreated: number; capabilitiesAdded: number; legalSupportEditRemoved: boolean }> {
  let rolesCreated = 0;
  let capabilitiesAdded = 0;

  for (const def of PROSECUTION_ROLE_DEFINITIONS) {
    const [existing] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.key, def.key)))
      .limit(1);
    if (existing) {
      if (def.capabilities.length > 0) {
        const existingCaps = await db
          .select({ capability: permissions.capability })
          .from(permissions)
          .where(eq(permissions.roleId, existing.id));
        const have = new Set(existingCaps.map((row) => row.capability));
        const missing = def.capabilities.filter((capability) => !have.has(capability));
        if (missing.length > 0) {
          await db.insert(permissions).values(
            missing.map((capability) => ({
              roleId: existing.id,
              capability,
            })),
          );
          capabilitiesAdded += missing.length;
        }
      }
      continue;
    }
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
    rolesCreated += 1;
    if (def.capabilities.length > 0) {
      await db.insert(permissions).values(
        def.capabilities.map((capability) => ({
          roleId: created.id,
          capability,
        })),
      );
      capabilitiesAdded += def.capabilities.length;
    }
  }

  const [owner] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, organizationId), eq(roles.key, "owner")))
    .limit(1);
  if (owner) {
    const existingCaps = await db
      .select({ capability: permissions.capability })
      .from(permissions)
      .where(eq(permissions.roleId, owner.id));
    const have = new Set(existingCaps.map((row) => row.capability));
    const missing = OWNER_PROSECUTION_CAPABILITIES.filter((capability) => !have.has(capability));
    if (missing.length > 0) {
      await db
        .insert(permissions)
        .values(missing.map((capability) => ({ roleId: owner.id, capability })));
      capabilitiesAdded += missing.length;
    }
  }

  let legalSupportEditRemoved = false;
  const [legalSupport] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, organizationId), eq(roles.key, "legal_support")))
    .limit(1);
  if (legalSupport) {
    const removed = await db
      .delete(permissions)
      .where(
        and(
          eq(permissions.roleId, legalSupport.id),
          eq(permissions.capability, "prosecution.edit"),
        ),
      )
      .returning({ capability: permissions.capability });
    legalSupportEditRemoved = removed.length > 0;
  }

  return { rolesCreated, capabilitiesAdded, legalSupportEditRemoved };
}

/**
 * @deprecated Use {@link provisionProsecutionRoles} from an authorized admin/ops path only.
 * Kept as a named alias so older call sites fail review during migration.
 */
export async function ensureProsecutionRoles(db: Database, organizationId: string): Promise<void> {
  await provisionProsecutionRoles(db, organizationId);
}
