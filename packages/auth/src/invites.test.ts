import { describe, expect, it, vi } from "vitest";
import type { Database } from "@nyayagrid/database";
import {
  acceptOrganizationInvite,
  createOrganizationInvite,
  InviteError,
  listOrganizationInvites,
  revokeOrganizationInvite,
} from "./invites";

/**
 * Minimal drizzle query-builder stand-in: every chained method returns itself, and awaiting the
 * chain at any point resolves to `result`. Good enough here because these tests control exactly
 * what each call site expects back and never need to interpret a real `where` predicate.
 */
function chain(result: unknown) {
  const handler: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "orderBy", "set", "values", "returning"]) {
    handler[method] = vi.fn(() => handler);
  }
  handler.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return handler;
}

/** Queues one result per `select` call, in call order, regardless of which table is queried. */
function fakeDb(selectResults: unknown[][], overrides: Partial<Database> = {}): Database {
  let call = 0;
  return {
    select: vi.fn(() => chain(selectResults[call++] ?? [])),
    insert: vi.fn(() => chain([{ id: "audit_evt_1" }])),
    update: vi.fn(() => chain([])),
    ...overrides,
  } as unknown as Database;
}

const ORG_ROW = { id: "org_1", name: "Acme Legal" };
const ROLE_ROW = { id: "role_1", organizationId: "org_1", key: "member" };

describe("createOrganizationInvite", () => {
  it("throws NOT_FOUND when the organization does not exist", async () => {
    const db = fakeDb([[]]);
    await expect(
      createOrganizationInvite({
        db,
        organizationId: "org_missing",
        email: "person@example.com",
        roleId: "role_1",
        invitedByUserId: "user_1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND when the role does not belong to the organization", async () => {
    const db = fakeDb([[ORG_ROW], [{ ...ROLE_ROW, organizationId: "org_other" }]]);
    await expect(
      createOrganizationInvite({
        db,
        organizationId: "org_1",
        email: "person@example.com",
        roleId: "role_1",
        invitedByUserId: "user_1",
      }),
    ).rejects.toBeInstanceOf(InviteError);
  });

  it("refuses to invite the owner role through the normal invite flow", async () => {
    const db = fakeDb([[ORG_ROW], [{ id: "role_owner", organizationId: "org_1", key: "owner" }]]);
    await expect(
      createOrganizationInvite({
        db,
        organizationId: "org_1",
        email: "person@example.com",
        roleId: "role_owner",
        invitedByUserId: "user_1",
      }),
    ).rejects.toMatchObject({ code: "ROLE_NOT_INVITEABLE" });
  });

  it("still returns the one-time token when invite email delivery throws", async () => {
    const inviteRow = {
      id: "inv_1",
      organizationId: "org_1",
      email: "person@example.com",
      roleId: "role_1",
      invitedByUserId: "user_1",
      expiresAt: new Date(),
      createdAt: new Date(),
    };
    const tx = {
      update: vi.fn(() => chain([])),
      insert: vi.fn(() => chain([inviteRow])),
    };
    const db = fakeDb(
      [[ORG_ROW], [{ ...ROLE_ROW, key: "staff" }], [{ name: "Ada" }]],
      {
      transaction: vi.fn(async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx)),
    });
    const emailProvider = {
      name: "smtp",
      send: vi.fn(async () => {
        throw new Error("smtp_down");
      }),
    };
    const result = await createOrganizationInvite({
      db,
      organizationId: "org_1",
      email: "person@example.com",
      roleId: "role_1",
      invitedByUserId: "user_1",
      emailProvider,
    });
    expect(result.inviteId).toBe("inv_1");
    expect(result.token.length).toBeGreaterThan(16);
    expect(emailProvider.send).toHaveBeenCalledTimes(1);
  });
});

describe("acceptOrganizationInvite", () => {
  it("throws NOT_FOUND when no invite matches the token", async () => {
    const db = fakeDb([[]]);
    await expect(
      acceptOrganizationInvite({ db, token: "bogus-token", userId: "user_1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws REVOKED for a revoked invite", async () => {
    const db = fakeDb([
      [
        {
          id: "inv_1",
          revokedAt: new Date(),
          acceptedAt: null,
          expiresAt: new Date(Date.now() + 1000),
        },
      ],
    ]);
    await expect(
      acceptOrganizationInvite({ db, token: "t", userId: "user_1" }),
    ).rejects.toMatchObject({
      code: "REVOKED",
    });
  });

  it("throws ALREADY_ACCEPTED for an already-accepted invite", async () => {
    const db = fakeDb([
      [
        {
          id: "inv_1",
          revokedAt: null,
          acceptedAt: new Date(),
          expiresAt: new Date(Date.now() + 1000),
        },
      ],
    ]);
    await expect(
      acceptOrganizationInvite({ db, token: "t", userId: "user_1" }),
    ).rejects.toMatchObject({
      code: "ALREADY_ACCEPTED",
    });
  });

  it("throws EXPIRED for an invite past its expiry", async () => {
    const db = fakeDb([
      [{ id: "inv_1", revokedAt: null, acceptedAt: null, expiresAt: new Date(Date.now() - 1000) }],
    ]);
    await expect(
      acceptOrganizationInvite({ db, token: "t", userId: "user_1" }),
    ).rejects.toMatchObject({
      code: "EXPIRED",
    });
  });

  it("throws EMAIL_MISMATCH when the authenticated user email does not match the invite", async () => {
    const db = fakeDb([
      [
        {
          id: "inv_1",
          email: "invitee@example.com",
          revokedAt: null,
          acceptedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
      [{ email: "attacker@example.com" }],
    ]);
    await expect(
      acceptOrganizationInvite({ db, token: "t", userId: "user_1" }),
    ).rejects.toMatchObject({ code: "EMAIL_MISMATCH" });
  });
});

describe("revokeOrganizationInvite", () => {
  it("is a no-op when the invite is already revoked", async () => {
    const revokedAt = new Date();
    const db = fakeDb([
      [
        {
          id: "inv_1",
          organizationId: "org_1",
          email: "person@example.com",
          acceptedAt: null,
          revokedAt,
        },
      ],
    ]);
    const result = await revokeOrganizationInvite({
      db,
      organizationId: "org_1",
      inviteId: "inv_1",
      revokedByUserId: "user_1",
    });
    expect(result.revokedAt).toBe(revokedAt);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses to revoke an accepted invite", async () => {
    const db = fakeDb([
      [
        {
          id: "inv_1",
          organizationId: "org_1",
          email: "person@example.com",
          acceptedAt: new Date(),
          revokedAt: null,
        },
      ],
    ]);
    await expect(
      revokeOrganizationInvite({
        db,
        organizationId: "org_1",
        inviteId: "inv_1",
        revokedByUserId: "user_1",
      }),
    ).rejects.toMatchObject({ code: "ALREADY_ACCEPTED" });
  });

  it("revokes a pending invite and writes an audit event", async () => {
    const db = fakeDb([
      [
        {
          id: "inv_1",
          organizationId: "org_1",
          email: "person@example.com",
          acceptedAt: null,
          revokedAt: null,
        },
      ],
    ]);
    const updateReturning = { id: "inv_1", organizationId: "org_1", revokedAt: new Date() };
    (db.update as ReturnType<typeof vi.fn>).mockReturnValueOnce(chain([updateReturning]));

    const result = await revokeOrganizationInvite({
      db,
      organizationId: "org_1",
      inviteId: "inv_1",
      revokedByUserId: "user_1",
    });

    expect(result.revokedAt).toEqual(updateReturning.revokedAt);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1); // audit event
  });
});

describe("listOrganizationInvites", () => {
  it("never exposes the token hash", async () => {
    const db = fakeDb([
      [
        {
          id: "inv_1",
          organizationId: "org_1",
          email: "person@example.com",
          roleId: "role_1",
          tokenHash: "super-secret-hash",
          expiresAt: new Date(),
          acceptedAt: null,
          revokedAt: null,
          invitedByUserId: "user_1",
          createdAt: new Date(),
        },
      ],
    ]);

    const invites = await listOrganizationInvites(db, { organizationId: "org_1" });
    expect(invites).toHaveLength(1);
    expect(invites[0]).not.toHaveProperty("tokenHash");
  });
});
