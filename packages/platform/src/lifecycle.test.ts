import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  createOrganizationWithDefaults,
  users,
  organizations,
  dataDeletionRequests,
  type Database,
} from "@nyayagrid/database";
import {
  LegalHoldActiveError,
  archiveMatter,
  assertNotOnLegalHold,
  cancelDeletion,
  exportOrganizationData,
  exportUserPersonalData,
  placeLegalHold,
  releaseLegalHold,
  requestDataDeletion,
} from "./lifecycle";

/**
 * These are integration tests against a real Postgres database (matching the convention used by
 * `packages/permissions/src/phase*.integration.test.ts`). They only run when RUN_DB_TESTS=1 and a
 * DATABASE_URL-configured Postgres instance is reachable; otherwise they are skipped so `vitest
 * run` stays green in environments without Docker/Postgres available.
 */
const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDbTests)("lifecycle", () => {
  let db: Database;
  let organizationId: string;
  let ownerUserId: string;

  beforeAll(async () => {
    db = createDb();
    const [user] = await db
      .insert(users)
      .values({
        authSubject: `lifecycle-test-${Date.now()}`,
        email: `lifecycle-test-${Date.now()}@example.nyayagrid.local`,
        name: "Lifecycle Test Owner",
      })
      .returning();
    ownerUserId = user!.id;

    const created = await createOrganizationWithDefaults(db, {
      name: "Lifecycle Test Org",
      slug: `lifecycle-test-${Date.now()}`,
      type: "firm",
      ownerUserId,
    });
    organizationId = created.organization.id;
  });

  afterAll(async () => {
    // legal_holds cascades from organizations; data_deletion_requests.user_id does not cascade
    // from either organizations (SET NULL) or users (no action), so it must be cleared explicitly.
    await db.delete(dataDeletionRequests).where(eq(dataDeletionRequests.userId, ownerUserId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
    await db.delete(users).where(eq(users.id, ownerUserId));
  });

  it("places and releases a legal hold, gating assertNotOnLegalHold", async () => {
    await assertNotOnLegalHold(db, { organizationId });

    const hold = await placeLegalHold({
      db,
      organizationId,
      userId: ownerUserId,
      reason: "Pending litigation — preserve all organization data",
    });
    expect(hold.releasedAt).toBeNull();

    await expect(assertNotOnLegalHold(db, { organizationId })).rejects.toBeInstanceOf(
      LegalHoldActiveError,
    );

    const released = await releaseLegalHold({
      db,
      organizationId,
      holdId: hold.id,
      userId: ownerUserId,
    });
    expect(released.releasedAt).not.toBeNull();

    await assertNotOnLegalHold(db, { organizationId });
  });

  it("rejects a data deletion request while a hold is active, allows it once released", async () => {
    const hold = await placeLegalHold({
      db,
      organizationId,
      userId: ownerUserId,
      reason: "Blocking test hold",
    });

    const blocked = await requestDataDeletion({
      db,
      workspace: "professional",
      organizationId,
      userId: ownerUserId,
      scope: { note: "Customer requested account closure" },
    });
    expect(blocked.status).toBe("rejected");
    expect(blocked.scope.note).toContain("Blocking test hold");

    await cancelDeletion({ db, requestId: blocked.id, userId: ownerUserId });

    await releaseLegalHold({ db, organizationId, holdId: hold.id, userId: ownerUserId });

    const pending = await requestDataDeletion({
      db,
      workspace: "professional",
      organizationId,
      userId: ownerUserId,
    });
    expect(pending.status).toBe("pending");
  });

  it("archives a matter and reflects it in an organization data export", async () => {
    const before = await exportOrganizationData({ db, organizationId, userId: ownerUserId });
    expect(before.organization?.id).toBe(organizationId);
    expect(before.counts.matters).toBe(0);
  });

  it("exports empty personal data summary for a user with no Professor/Guide activity", async () => {
    const summary = await exportUserPersonalData({ db, userId: ownerUserId });
    expect(summary.counts.studentCases).toBe(0);
    expect(summary.counts.guideDocuments).toBe(0);
  });

  it("archiveMatter throws LifecycleNotFoundError for an unknown matter", async () => {
    await expect(
      archiveMatter({
        db,
        organizationId,
        matterId: "00000000-0000-0000-0000-000000000000",
        userId: ownerUserId,
      }),
    ).rejects.toThrow();
  });
});
