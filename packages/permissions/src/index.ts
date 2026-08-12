import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@nyayagrid/database";
import {
  memberships,
  permissions,
  roles,
  auditEvents,
  matters,
  matterMembers,
} from "@nyayagrid/database";
import type { Capability } from "@nyayagrid/validation";

export class AuthorizationError extends Error {
  readonly code = "FORBIDDEN";
  constructor(message = "Forbidden") {
    super(message);
    this.name = "AuthorizationError";
  }
}

const ACCESS_RANK = {
  read: 1,
  comment: 2,
  edit: 3,
  manage: 4,
} as const;

export type MatterAccess = keyof typeof ACCESS_RANK;

export async function getMembershipCapabilities(
  db: Database,
  params: { userId: string; organizationId: string },
): Promise<{ membershipId: string; roleKey: string; capabilities: Set<Capability> } | null> {
  const rows = await db
    .select({
      membershipId: memberships.id,
      roleKey: roles.key,
      status: memberships.status,
      capability: permissions.capability,
    })
    .from(memberships)
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.roleId, roles.id))
    .where(
      and(
        eq(memberships.userId, params.userId),
        eq(memberships.organizationId, params.organizationId),
        eq(memberships.status, "active"),
      ),
    );

  if (rows.length === 0) return null;
  const first = rows[0];
  if (!first) return null;

  return {
    membershipId: first.membershipId,
    roleKey: first.roleKey,
    capabilities: new Set(rows.map((r) => r.capability as Capability)),
  };
}

export async function requireCapability(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    capability: Capability;
  },
) {
  const membership = await getMembershipCapabilities(db, params);
  if (!membership || !membership.capabilities.has(params.capability)) {
    throw new AuthorizationError(
      `Missing capability ${params.capability} for organization ${params.organizationId}`,
    );
  }
  return membership;
}

export async function requireAnyCapability(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    capabilities: Capability[];
  },
) {
  const membership = await getMembershipCapabilities(db, params);
  if (!membership) throw new AuthorizationError("Not a member of organization");
  const ok = params.capabilities.some((c) => membership.capabilities.has(c));
  if (!ok) throw new AuthorizationError("Missing required capability");
  return membership;
}

export async function assertSameOrganization(
  organizationId: string,
  resourceOrganizationId: string,
) {
  if (organizationId !== resourceOrganizationId) {
    throw new AuthorizationError("Cross-organization access denied");
  }
}

export async function requireMatterAccess(
  db: Database,
  params: {
    userId: string;
    matterId: string;
    minAccess: MatterAccess;
    capability?: Capability;
  },
) {
  const [matter] = await db.select().from(matters).where(eq(matters.id, params.matterId)).limit(1);
  if (!matter) throw new AuthorizationError("Matter not found");

  const membership = await getMembershipCapabilities(db, {
    userId: params.userId,
    organizationId: matter.organizationId,
  });
  if (!membership) throw new AuthorizationError("Not a member of organization");

  const capability = params.capability ?? "matters.view";
  if (
    !membership.capabilities.has(capability) &&
    !membership.capabilities.has("organization.manage")
  ) {
    throw new AuthorizationError(`Missing capability ${capability}`);
  }

  // Organization owners/admins with organization.manage may access all matters in-tenant.
  if (membership.capabilities.has("organization.manage")) {
    return { matter, membership, access: "manage" as MatterAccess };
  }

  const [member] = await db
    .select()
    .from(matterMembers)
    .where(
      and(eq(matterMembers.matterId, params.matterId), eq(matterMembers.userId, params.userId)),
    )
    .limit(1);

  if (!member) {
    throw new AuthorizationError("No matter membership — access denied by default");
  }

  if (ACCESS_RANK[member.access] < ACCESS_RANK[params.minAccess]) {
    throw new AuthorizationError(`Matter access ${params.minAccess} required`);
  }

  return { matter, membership, access: member.access as MatterAccess };
}

export async function listAuthorizedMatterIds(
  db: Database,
  params: { userId: string; organizationId: string },
): Promise<string[] | "all"> {
  const membership = await getMembershipCapabilities(db, params);
  if (!membership || !membership.capabilities.has("matters.view")) {
    return [];
  }
  if (membership.capabilities.has("organization.manage")) {
    return "all";
  }
  const rows = await db
    .select({ matterId: matterMembers.matterId })
    .from(matterMembers)
    .where(
      and(
        eq(matterMembers.organizationId, params.organizationId),
        eq(matterMembers.userId, params.userId),
      ),
    );
  return rows.map((r) => r.matterId);
}

export async function writeAuditEvent(
  db: Database,
  event: {
    organizationId?: string | null;
    actorUserId?: string | null;
    matterId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const [row] = await db
    .insert(auditEvents)
    .values({
      organizationId: event.organizationId ?? null,
      actorUserId: event.actorUserId ?? null,
      matterId: event.matterId ?? null,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: event.metadata ?? {},
    })
    .returning();
  return row;
}

export function storageKeyForOrganization(params: {
  organizationId: string;
  documentId: string;
  versionId: string;
  filename: string;
}) {
  const safeName = params.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `org/${params.organizationId}/documents/${params.documentId}/versions/${params.versionId}/${safeName}`;
}

export function assertStorageKeyBelongsToOrganization(storageKey: string, organizationId: string) {
  const prefix = `org/${organizationId}/`;
  if (!storageKey.startsWith(prefix)) {
    throw new AuthorizationError("Storage key is outside organization boundary");
  }
}

export async function listCapabilityRows(db: Database, roleIds: string[]): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const rows = await db
    .select({ capability: permissions.capability })
    .from(permissions)
    .where(inArray(permissions.roleId, roleIds));
  return rows.map((r) => r.capability);
}

export { sql };
