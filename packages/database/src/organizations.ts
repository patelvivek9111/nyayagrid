import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index";
import { memberships, organizations, permissions, roles } from "./schema/index";
import { SYSTEM_ROLE_DEFINITIONS } from "./system-roles";

type Db = PostgresJsDatabase<typeof schema>;

export async function createOrganizationWithDefaults(
  db: Db,
  input: {
    name: string;
    slug: string;
    type: "firm" | "solo";
    ownerUserId: string;
  },
) {
  return db.transaction(async (tx) => {
    const existing = await tx.query.organizations.findFirst({
      where: eq(organizations.slug, input.slug),
    });
    if (existing) {
      throw new Error("Organization slug already exists");
    }

    const [org] = await tx
      .insert(organizations)
      .values({
        name: input.name,
        slug: input.slug,
        type: input.type,
        createdByUserId: input.ownerUserId,
      })
      .returning();
    if (!org) throw new Error("Failed to create organization");

    const roleIdByKey = new Map<string, string>();
    for (const def of SYSTEM_ROLE_DEFINITIONS) {
      const [role] = await tx
        .insert(roles)
        .values({
          organizationId: org.id,
          key: def.key,
          name: def.name,
          description: def.description,
          isSystem: true,
        })
        .returning();
      if (!role) throw new Error(`Failed to create role ${def.key}`);
      roleIdByKey.set(def.key, role.id);
      if (def.capabilities.length > 0) {
        await tx.insert(permissions).values(
          def.capabilities.map((capability) => ({
            roleId: role.id,
            capability,
          })),
        );
      }
    }

    const ownerRoleId = roleIdByKey.get("owner");
    if (!ownerRoleId) throw new Error("Owner role missing");

    const [membership] = await tx
      .insert(memberships)
      .values({
        organizationId: org.id,
        userId: input.ownerUserId,
        roleId: ownerRoleId,
        status: "active",
      })
      .returning();

    return { organization: org, membership, roleIdByKey };
  });
}
