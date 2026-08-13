import { describe, expect, it, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  createOrganizationWithDefaults,
  users,
  auditEvents,
  type Database,
} from "@nyayagrid/database";
import { AuthorizationError, requireCapability, writeAuditEvent } from "./index";

const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDbTests)("authorization integration", () => {
  let db: Database;
  const suffix = Date.now().toString(36);

  let ownerId = "";
  let outsiderId = "";
  let orgId = "";

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL);
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `owner_${suffix}`,
        email: `owner_${suffix}@example.nyayagrid.local`,
        name: "Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `outsider_${suffix}`,
        email: `outsider_${suffix}@example.nyayagrid.local`,
        name: "Outsider",
      })
      .returning();
    ownerId = owner!.id;
    outsiderId = outsider!.id;

    const created = await createOrganizationWithDefaults(db, {
      name: `Firm ${suffix}`,
      slug: `firm-${suffix}`,
      type: "firm",
      ownerUserId: ownerId,
    });
    orgId = created.organization.id;
  });

  it("allows owner organization.manage", async () => {
    const membership = await requireCapability(db, {
      userId: ownerId,
      organizationId: orgId,
      capability: "organization.manage",
    });
    expect(membership.roleKey).toBe("owner");
  });

  it("rejects outsider capability checks", async () => {
    await expect(
      requireCapability(db, {
        userId: outsiderId,
        organizationId: orgId,
        capability: "organization.manage",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("writes audit events", async () => {
    const event = await writeAuditEvent(db, {
      organizationId: orgId,
      actorUserId: ownerId,
      action: "test.audit",
      targetType: "organization",
      targetId: orgId,
    });
    expect(event?.id).toBeTruthy();
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.id, event!.id));
    expect(rows).toHaveLength(1);
  });
});
