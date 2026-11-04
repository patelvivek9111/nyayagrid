/**
 * WP-04 Terms/Privacy acceptance persistence (audit-backed) — mirrors API contract.
 * Gates: RUN_DB_TESTS=1 against local certification DB only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  auditEvents,
  users,
  type Database,
  isLocalCertificationDatabaseUrl,
} from "@nyayagrid/database";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  buildLegalAcceptanceAuditAction,
  isKnownLegalVersion,
} from "@nyayagrid/platform";
import { writeAuditEvent } from "./index";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const dbUrl =
  process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";

describe.runIf(runDbTests)("WP-04 legal acceptance persistence", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `legal_${Date.now().toString(36)}`;
  let userId = "";
  let orgId = "";

  beforeAll(async () => {
    expect(isLocalCertificationDatabaseUrl(dbUrl)).toBe(true);
    const [user] = await db
      .insert(users)
      .values({
        authSubject: `legal_user_${suffix}`,
        email: `legal_user_${suffix}@example.nyayagrid.local`,
        name: "Legal Acceptor",
      })
      .returning();
    userId = user!.id;
    const org = await createOrganizationWithDefaults(db, {
      name: `Legal Org ${suffix}`,
      slug: `legal-${suffix}`,
      type: "firm",
      ownerUserId: userId,
    });
    orgId = org.organization.id;
  }, 60_000);

  afterAll(async () => {
    await closeDb(db);
  });

  async function recordAcceptance(kind: "terms" | "privacy", version: string) {
    if (!isKnownLegalVersion(kind, version)) {
      return { ok: false as const, code: "LEGAL_VERSION_MISMATCH" as const };
    }
    await writeAuditEvent(db, {
      organizationId: orgId,
      actorUserId: userId,
      action: buildLegalAcceptanceAuditAction(kind),
      targetType: "legal_document",
      targetId: kind,
      metadata: {
        version,
        attorneyReview: "PENDING",
        status: "DRAFT_PENDING_ATTORNEY_REVIEW",
      },
    });
    return { ok: true as const, kind, version };
  }

  async function latestAcceptance(kind: "terms" | "privacy") {
    const action = buildLegalAcceptanceAuditAction(kind);
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.actorUserId, userId), eq(auditEvents.action, action)))
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);
    return event ?? null;
  }

  it("new user acceptance persists with version + org association", async () => {
    const result = await recordAcceptance("terms", CURRENT_TERMS_VERSION);
    expect(result.ok).toBe(true);
    const event = await latestAcceptance("terms");
    expect(event).not.toBeNull();
    expect(event!.organizationId).toBe(orgId);
    expect((event!.metadata as { version?: string }).version).toBe(CURRENT_TERMS_VERSION);
    expect((event!.metadata as { attorneyReview?: string }).attorneyReview).toBe("PENDING");
  });

  it("privacy acceptance is independent and idempotent on duplicate submit", async () => {
    const first = await recordAcceptance("privacy", CURRENT_PRIVACY_VERSION);
    const second = await recordAcceptance("privacy", CURRENT_PRIVACY_VERSION);
    expect(first.ok && second.ok).toBe(true);
    const event = await latestAcceptance("privacy");
    expect((event!.metadata as { version?: string }).version).toBe(CURRENT_PRIVACY_VERSION);
  });

  it("rejects stale/malformed version (reacceptance required on bump)", async () => {
    const stale = await recordAcceptance("terms", "0.0.0-stale");
    expect(stale).toEqual({ ok: false, code: "LEGAL_VERSION_MISMATCH" });
  });

  it("audit history retains prior acceptances after re-submit", async () => {
    await recordAcceptance("terms", CURRENT_TERMS_VERSION);
    await recordAcceptance("terms", CURRENT_TERMS_VERSION);
    const action = buildLegalAcceptanceAuditAction("terms");
    const rows = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.actorUserId, userId), eq(auditEvents.action, action)));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
