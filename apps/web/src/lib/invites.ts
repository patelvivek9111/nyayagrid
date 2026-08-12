import { and, eq } from "drizzle-orm";
import { roles, type Database } from "@nyayagrid/database";
import { createOrganizationInvite, type CreateOrganizationInviteResult } from "@nyayagrid/auth";
import { createEmailProviderFromEnv } from "@nyayagrid/platform";

export class InviteRoleNotFoundError extends Error {
  readonly code = "VALIDATION_ERROR";
  constructor(roleKey: string) {
    super(`Role "${roleKey}" not found in this organization`);
    this.name = "InviteRoleNotFoundError";
  }
}

/**
 * Shared by the members invite route and the dedicated invites route: resolves a role by its
 * stable key (never trust a client-supplied roleId directly) and creates the invite, dispatching
 * an email through whatever `EMAIL_PROVIDER` this deployment is configured with.
 */
export async function inviteMemberByRoleKey(params: {
  db: Database;
  organizationId: string;
  email: string;
  roleKey: string;
  invitedByUserId: string;
}): Promise<CreateOrganizationInviteResult> {
  const [role] = await params.db
    .select()
    .from(roles)
    .where(and(eq(roles.organizationId, params.organizationId), eq(roles.key, params.roleKey)))
    .limit(1);
  if (!role) throw new InviteRoleNotFoundError(params.roleKey);

  return createOrganizationInvite({
    db: params.db,
    organizationId: params.organizationId,
    email: params.email,
    roleId: role.id,
    invitedByUserId: params.invitedByUserId,
    emailProvider: createEmailProviderFromEnv(),
  });
}
