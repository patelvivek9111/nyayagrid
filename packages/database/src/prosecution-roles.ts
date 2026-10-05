import { and, eq } from "drizzle-orm";
import type { Database } from "./index";
import { permissions, roles } from "./schema/index";
import { PROSECUTION_ROLE_DEFINITIONS } from "./system-roles";

const OWNER_PROSECUTION_CAPABILITIES = ["prosecution.view", "prosecution.edit", "prosecution.review"];

/** Idempotently add prosecution roles and owner capabilities to an existing organization. */
export async function ensureProsecutionRoles(db: Database, organizationId: string): Promise<void> {
  for (const def of PROSECUTION_ROLE_DEFINITIONS) {
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

  const [owner] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, organizationId), eq(roles.key, "owner")))
    .limit(1);
  if (!owner) return;
  const existingCaps = await db
    .select({ capability: permissions.capability })
    .from(permissions)
    .where(eq(permissions.roleId, owner.id));
  const have = new Set(existingCaps.map((row) => row.capability));
  const missing = OWNER_PROSECUTION_CAPABILITIES.filter((capability) => !have.has(capability));
  if (missing.length === 0) return;
  await db.insert(permissions).values(missing.map((capability) => ({ roleId: owner.id, capability })));
}
