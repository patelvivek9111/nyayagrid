/**
 * Phase 9 — organization invites.
 *
 * An invite is a single-use, time-boxed credential that lets someone who is not yet a member join
 * an organization with a specific role. The database only ever stores a SHA-256 of the token
 * (`organization_invites.token_hash`); the plaintext token exists only in memory here and in the
 * one email/response it is handed back in, so nothing that later reads the database — a backup, a
 * support query, a log — can mint a working invitation.
 *
 * Authorization for *creating* an invite (the `members.invite` capability) is enforced by the
 * caller (an API route), not by this module: these functions assume the caller has already checked
 * that the actor may act on `organizationId`.
 */
import { randomBytes, createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "@nyayagrid/database";
import { memberships, organizationInvites, organizations, roles, users } from "@nyayagrid/database";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { sendInviteEmail, type EmailProvider } from "@nyayagrid/platform";

export const INVITEABLE_ROLE_KEYS = ["lawyer", "staff", "client_guest"] as const;
export type InviteableRoleKey = (typeof INVITEABLE_ROLE_KEYS)[number];

export function isInviteableRoleKey(roleKey: string): roleKey is InviteableRoleKey {
  return (INVITEABLE_ROLE_KEYS as readonly string[]).includes(roleKey);
}

export function assertInviteableRoleKey(roleKey: string): InviteableRoleKey {
  if (!isInviteableRoleKey(roleKey)) {
    throw new InviteError(
      "ROLE_NOT_INVITEABLE",
      `Role "${roleKey}" cannot be invited through the organization invitation flow`,
    );
  }
  return roleKey;
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class InviteError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InviteError";
    this.code = code;
  }
}

function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const INVITE_TOKEN_BYTES = 32;
export const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Public row shape: never carries `tokenHash`, which is the whole point of hashing it. */
export type OrganizationInviteView = {
  id: string;
  organizationId: string;
  email: string;
  roleId: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  invitedByUserId: string | null;
  createdAt: Date;
};

function toInviteView(row: typeof organizationInvites.$inferSelect): OrganizationInviteView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    roleId: row.roleId,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    invitedByUserId: row.invitedByUserId,
    createdAt: row.createdAt,
  };
}

export type CreateOrganizationInviteParams = {
  db: Database;
  organizationId: string;
  email: string;
  roleId: string;
  invitedByUserId: string;
  /** When provided, an invite email is dispatched. Omit in tests that don't need delivery. */
  emailProvider?: EmailProvider;
  /** Base URL used to build the accept link. Defaults to NEXT_PUBLIC_APP_URL, then localhost. */
  appUrl?: string;
};

export type CreateOrganizationInviteResult = {
  inviteId: string;
  /**
   * The plaintext token. Only ever returned here and, when `emailProvider` is set, inside the
   * dispatched email — it cannot be recovered from the database afterward, so a caller must hand it
   * to the invitee (email and/or a one-time API response) or it is lost and the invite must be
   * revoked and recreated.
   */
  token: string;
  expiresAt: Date;
};

/**
 * Creates a pending invite. Any prior pending (not accepted, not revoked) invite for the same
 * organization + email is revoked first, so a re-invite always supersedes rather than piling up
 * live tokens for one address — see the schema comment on `organization_invites` for why that is a
 * revoke-and-replace rather than an upsert.
 */
export async function createOrganizationInvite(
  params: CreateOrganizationInviteParams,
): Promise<CreateOrganizationInviteResult> {
  const { db } = params;
  const email = normalizeInviteEmail(params.email);

  const [organization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, params.organizationId))
    .limit(1);
  if (!organization) throw new InviteError("NOT_FOUND", "Organization not found");

  const [role] = await db.select().from(roles).where(eq(roles.id, params.roleId)).limit(1);
  if (!role || role.organizationId !== params.organizationId) {
    throw new InviteError("NOT_FOUND", "Role not found in this organization");
  }
  assertInviteableRoleKey(role.key);

  const token = randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);

  const invite = await db.transaction(async (tx) => {
    await tx
      .update(organizationInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(organizationInvites.organizationId, params.organizationId),
          eq(organizationInvites.email, email),
          isNull(organizationInvites.acceptedAt),
          isNull(organizationInvites.revokedAt),
        ),
      );

    const [created] = await tx
      .insert(organizationInvites)
      .values({
        organizationId: params.organizationId,
        email,
        roleId: params.roleId,
        tokenHash,
        expiresAt,
        invitedByUserId: params.invitedByUserId,
      })
      .returning();
    if (!created) throw new InviteError("INTERNAL", "Failed to create invite");
    return created;
  });

  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.invitedByUserId,
    action: "members.invite.created",
    targetType: "organization_invite",
    targetId: invite.id,
    metadata: { email, roleId: params.roleId },
  });

  if (params.emailProvider) {
    const [inviter] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, params.invitedByUserId))
      .limit(1);
    const appUrl = (
      params.appUrl ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000"
    ).replace(/\/+$/, "");
    await sendInviteEmail(params.emailProvider, {
      to: email,
      organizationName: organization.name,
      invitedByName: inviter?.name ?? null,
      acceptUrl: `${appUrl}/invites/accept?token=${encodeURIComponent(token)}`,
      expiresAt,
    });
  }

  return { inviteId: invite.id, token, expiresAt };
}

export type AcceptOrganizationInviteParams = {
  db: Database;
  token: string;
  userId: string;
};

export type AcceptOrganizationInviteResult = {
  organizationId: string;
  roleId: string;
  membershipId: string;
  /** False when the user already held a membership in this organization (invite still consumed). */
  membershipCreated: boolean;
};

/**
 * Accepts an invite: verifies the token hash resolves to a live (unexpired, unrevoked, unaccepted)
 * invite, creates the membership if one doesn't already exist, and marks the invite accepted.
 * Accepting an invite is idempotent with respect to membership — a user who is already a member
 * simply consumes the invite without a duplicate row or a role downgrade/upgrade.
 */
export async function acceptOrganizationInvite(
  params: AcceptOrganizationInviteParams,
): Promise<AcceptOrganizationInviteResult> {
  const tokenHash = hashInviteToken(params.token);
  const [invite] = await params.db
    .select()
    .from(organizationInvites)
    .where(eq(organizationInvites.tokenHash, tokenHash))
    .limit(1);
  if (!invite) throw new InviteError("NOT_FOUND", "Invite not found");
  if (invite.revokedAt) throw new InviteError("REVOKED", "This invite has been revoked");
  if (invite.acceptedAt)
    throw new InviteError("ALREADY_ACCEPTED", "This invite has already been accepted");
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new InviteError("EXPIRED", "This invite has expired");
  }

  const [actor] = await params.db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, params.userId))
    .limit(1);
  if (!actor) throw new InviteError("INTERNAL", "Authenticated user was not found");
  if (normalizeInviteEmail(actor.email) !== normalizeInviteEmail(invite.email)) {
    throw new InviteError(
      "EMAIL_MISMATCH",
      "This invitation was issued to a different email address",
    );
  }

  const result = await params.db.transaction(async (tx) => {
    const [existingMembership] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, invite.organizationId),
          eq(memberships.userId, params.userId),
        ),
      )
      .limit(1);

    let membershipId: string;
    let membershipCreated: boolean;
    if (existingMembership) {
      membershipId = existingMembership.id;
      membershipCreated = false;
    } else {
      const [created] = await tx
        .insert(memberships)
        .values({
          organizationId: invite.organizationId,
          userId: params.userId,
          roleId: invite.roleId,
          status: "active",
        })
        .returning();
      if (!created) throw new InviteError("INTERNAL", "Failed to create membership");
      membershipId = created.id;
      membershipCreated = true;
    }

    await tx
      .update(organizationInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(organizationInvites.id, invite.id));

    return { membershipId, membershipCreated };
  });

  await writeAuditEvent(params.db, {
    organizationId: invite.organizationId,
    actorUserId: params.userId,
    action: "members.invite.accepted",
    targetType: "organization_invite",
    targetId: invite.id,
    metadata: { email: invite.email, membershipCreated: result.membershipCreated },
  });

  return {
    organizationId: invite.organizationId,
    roleId: invite.roleId,
    membershipId: result.membershipId,
    membershipCreated: result.membershipCreated,
  };
}

export type RevokeOrganizationInviteParams = {
  db: Database;
  organizationId: string;
  inviteId: string;
  revokedByUserId: string;
};

/** Revoking an already-revoked invite is a no-op; revoking an accepted invite is refused. */
export async function revokeOrganizationInvite(
  params: RevokeOrganizationInviteParams,
): Promise<OrganizationInviteView> {
  const [invite] = await params.db
    .select()
    .from(organizationInvites)
    .where(
      and(
        eq(organizationInvites.id, params.inviteId),
        eq(organizationInvites.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!invite) throw new InviteError("NOT_FOUND", "Invite not found");
  if (invite.acceptedAt)
    throw new InviteError("ALREADY_ACCEPTED", "Cannot revoke an accepted invite");
  if (invite.revokedAt) return toInviteView(invite);

  const [revoked] = await params.db
    .update(organizationInvites)
    .set({ revokedAt: new Date() })
    .where(eq(organizationInvites.id, invite.id))
    .returning();
  if (!revoked) throw new InviteError("INTERNAL", "Failed to revoke invite");

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.revokedByUserId,
    action: "members.invite.revoked",
    targetType: "organization_invite",
    targetId: invite.id,
    metadata: { email: invite.email },
  });

  return toInviteView(revoked);
}

/** Newest first. Never includes `tokenHash` — see `OrganizationInviteView`. */
export async function listOrganizationInvites(
  db: Database,
  params: { organizationId: string },
): Promise<OrganizationInviteView[]> {
  const rows = await db
    .select()
    .from(organizationInvites)
    .where(eq(organizationInvites.organizationId, params.organizationId))
    .orderBy(desc(organizationInvites.createdAt));
  return rows.map(toInviteView);
}
