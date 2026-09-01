import { describe, expect, it, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, createOrganizationWithDefaults, memberships, users } from "@nyayagrid/database";
import {
  acceptOrganizationInvite,
  createOrganizationInvite,
  InviteError,
  listOrganizationInvites,
  revokeOrganizationInvite,
} from "./invites";

const runDbTests = process.env.RUN_DB_TESTS === "1";

/**
 * Exercises the invite lifecycle against a real Postgres database: creation revokes any prior
 * pending invite for the same address, acceptance is transactional and creates exactly one
 * membership, and a stale/expired/revoked/accepted token is never honored twice.
 */
describe.runIf(runDbTests)("organization invites integration", () => {
  const suffix = Date.now().toString(36);
  let db: ReturnType<typeof createDb>;

  let ownerId = "";
  let inviteeId = "";
  let organizationId = "";
  let staffRoleId = "";

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL);
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `invite_owner_${suffix}`,
        email: `invite_owner_${suffix}@example.nyayagrid.local`,
        name: "Invite Owner",
      })
      .returning();
    const [invitee] = await db
      .insert(users)
      .values({
        authSubject: `invite_invitee_${suffix}`,
        email: `invite_invitee_${suffix}@example.nyayagrid.local`,
        name: "Invite Invitee",
      })
      .returning();
    ownerId = owner!.id;
    inviteeId = invitee!.id;

    const org = await createOrganizationWithDefaults(db, {
      name: `Invite Test Firm ${suffix}`,
      slug: `invite-test-firm-${suffix}`,
      type: "firm",
      ownerUserId: ownerId,
    });
    organizationId = org.organization.id;
    staffRoleId = org.roleIdByKey.get("staff")!;
    expect(staffRoleId).toBeTruthy();
  }, 60000);

  it("creates an invite, revokes a prior pending invite for the same address, and lists it without the token hash", async () => {
    const inviteeEmail = `staff_${suffix}@example.nyayagrid.local`;

    const first = await createOrganizationInvite({
      db,
      organizationId,
      email: inviteeEmail,
      roleId: staffRoleId,
      invitedByUserId: ownerId,
    });
    expect(first.token).toBeTruthy();
    expect(first.token.length).toBeGreaterThan(20);

    const second = await createOrganizationInvite({
      db,
      organizationId,
      email: inviteeEmail.toUpperCase(), // case-insensitive: same address, different casing
      roleId: staffRoleId,
      invitedByUserId: ownerId,
    });
    expect(second.inviteId).not.toBe(first.inviteId);

    const invites = await listOrganizationInvites(db, { organizationId });
    const firstRow = invites.find((invite) => invite.id === first.inviteId);
    const secondRow = invites.find((invite) => invite.id === second.inviteId);
    expect(firstRow?.revokedAt).toBeTruthy(); // superseded by the re-invite
    expect(secondRow?.revokedAt).toBeNull();
    for (const invite of invites) {
      expect(invite).not.toHaveProperty("tokenHash");
    }

    // The revoked first invite can no longer be accepted.
    await expect(
      acceptOrganizationInvite({ db, token: first.token, userId: inviteeId }),
    ).rejects.toMatchObject({
      code: "REVOKED",
    });
  });

  it("accepts a pending invite exactly once, creating one membership with the invited role", async () => {
    const inviteeEmail = `invite_invitee_${suffix}@example.nyayagrid.local`;
    const { token, inviteId } = await createOrganizationInvite({
      db,
      organizationId,
      email: inviteeEmail,
      roleId: staffRoleId,
      invitedByUserId: ownerId,
    });

    const result = await acceptOrganizationInvite({ db, token, userId: inviteeId });
    expect(result.organizationId).toBe(organizationId);
    expect(result.roleId).toBe(staffRoleId);
    expect(result.membershipCreated).toBe(true);

    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, inviteeId));
    expect(membershipRows).toHaveLength(1);
    expect(membershipRows[0]?.roleId).toBe(staffRoleId);

    // Re-accepting the same (now-accepted) token is rejected, and does not create a second membership.
    await expect(acceptOrganizationInvite({ db, token, userId: inviteeId })).rejects.toMatchObject({
      code: "ALREADY_ACCEPTED",
    });
    const membershipRowsAfter = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, inviteeId));
    expect(membershipRowsAfter).toHaveLength(1);

    const invites = await listOrganizationInvites(db, { organizationId });
    expect(invites.find((invite) => invite.id === inviteId)?.acceptedAt).toBeTruthy();
  });

  it("refuses to revoke an accepted invite and is idempotent revoking a pending one", async () => {
    const acceptedEmail = `invite_accepted_user_${suffix}@example.nyayagrid.local`;
    const accepted = await createOrganizationInvite({
      db,
      organizationId,
      email: acceptedEmail,
      roleId: staffRoleId,
      invitedByUserId: ownerId,
    });
    const acceptingUser = await db
      .insert(users)
      .values({
        authSubject: `invite_accepted_user_${suffix}`,
        email: `invite_accepted_user_${suffix}@example.nyayagrid.local`,
        name: "Accepted User",
      })
      .returning();
    await acceptOrganizationInvite({ db, token: accepted.token, userId: acceptingUser[0]!.id });

    await expect(
      revokeOrganizationInvite({
        db,
        organizationId,
        inviteId: accepted.inviteId,
        revokedByUserId: ownerId,
      }),
    ).rejects.toBeInstanceOf(InviteError);

    const pendingEmail = `revoke_pending_${suffix}@example.nyayagrid.local`;
    const pending = await createOrganizationInvite({
      db,
      organizationId,
      email: pendingEmail,
      roleId: staffRoleId,
      invitedByUserId: ownerId,
    });
    const firstRevoke = await revokeOrganizationInvite({
      db,
      organizationId,
      inviteId: pending.inviteId,
      revokedByUserId: ownerId,
    });
    expect(firstRevoke.revokedAt).toBeTruthy();
    const secondRevoke = await revokeOrganizationInvite({
      db,
      organizationId,
      inviteId: pending.inviteId,
      revokedByUserId: ownerId,
    });
    expect(secondRevoke.revokedAt?.getTime()).toBe(firstRevoke.revokedAt?.getTime());
  });

  it("rejects an expired invite", async () => {
    // Fabricate an already-expired invite directly (createOrganizationInvite always sets a 7-day
    // expiry), then confirm acceptOrganizationInvite honors expiresAt rather than trusting the
    // caller's clock.
    const { createHash, randomBytes } = await import("node:crypto");
    const { organizationInvites } = await import("@nyayagrid/database");
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await db.insert(organizationInvites).values({
      organizationId,
      email: `expired_${suffix}@example.nyayagrid.local`,
      roleId: staffRoleId,
      tokenHash,
      expiresAt: new Date(Date.now() - 1000),
      invitedByUserId: ownerId,
    });

    await expect(acceptOrganizationInvite({ db, token, userId: inviteeId })).rejects.toMatchObject({
      code: "EXPIRED",
    });
  });
});
