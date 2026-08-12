import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  createOrganizationWithDefaults,
  users,
  clients,
  matters,
  matterMembers,
  organizations,
  aiUsageEvents,
  dataDeletionRequests,
  type Database,
} from "@nyayagrid/database";
import {
  ConfigurationError,
  collectProductionConfigProblems,
  validateProductionConfig,
  placeLegalHold,
  releaseLegalHold,
  assertNotOnLegalHold,
  requestDataDeletion,
  cancelDeletion,
  exportOrganizationData,
  LegalHoldActiveError,
  InMemoryRateLimiter,
  checkEndpointRateLimit,
  recordAiUsageEvent,
} from "@nyayagrid/platform";
import { ClamAvMalwareScanner, mapMalwareResultToProcessingState } from "@nyayagrid/documents";

/**
 * Phase 9 — production readiness integration tests.
 *
 * Two kinds of coverage live in this file:
 *
 * 1. Pure/unit-level checks (configuration gate, rate limiting, ClamAV fixture mode) that need no
 *    database at all. These always run, regardless of RUN_DB_TESTS, so this file's core guarantees
 *    are checked even on a machine with no Postgres available.
 * 2. Real-database integration checks (legal hold vs. deletion, organization-scoped export, AI
 *    usage accounting), gated by RUN_DB_TESTS=1 like every other `phase*.integration.test.ts` in
 *    this package.
 */
const runDbTests = process.env.RUN_DB_TESTS === "1";

describe("production configuration gate (pure, no database required)", () => {
  it("collects every known blocker for an unconfigured production environment", () => {
    const problems = collectProductionConfigProblems({ APP_ENV: "production" });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes("AUTH_PROVIDER"))).toBe(true);
    expect(problems.some((p) => p.includes("AI_PROVIDER"))).toBe(true);
    expect(problems.some((p) => p.includes("MALWARE_SCANNER"))).toBe(true);
    expect(problems.some((p) => p.includes("DATABASE_URL"))).toBe(true);
  });

  it("refuses to start production with development stand-ins active", () => {
    expect(() =>
      validateProductionConfig({
        APP_ENV: "production",
        AUTH_PROVIDER: "dev",
        AI_PROVIDER: "mock",
      }),
    ).toThrow(ConfigurationError);
  });

  it("is satisfied once every provider is configured for production", () => {
    const fullyConfiguredEnv = {
      APP_ENV: "production",
      AUTH_PROVIDER: "clerk",
      CLERK_SECRET_KEY: "sk_live_x",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_x",
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-x",
      EMBEDDING_PROVIDER: "openai",
      MALWARE_SCANNER: "clamav",
      CLAMAV_HOST: "clamav.internal",
      STORAGE_PROVIDER: "s3",
      OCR_PROVIDER: "none",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.internal",
      SMTP_PORT: "587",
      EMAIL_FROM: "noreply@example.com",
      BILLING_PROVIDER: "database",
      RATE_LIMIT_PROVIDER: "redis",
      DATABASE_URL: "postgresql://user:pass@db.internal:5432/nyayagrid",
      S3_BUCKET: "nyayagrid-prod-documents",
    };
    expect(collectProductionConfigProblems(fullyConfiguredEnv)).toEqual([]);
    expect(() => validateProductionConfig(fullyConfiguredEnv)).not.toThrow();
  });

  it("does not gate development or test environments", () => {
    expect(() => validateProductionConfig({ APP_ENV: "development" })).not.toThrow();
    expect(() => validateProductionConfig({ NODE_ENV: "test" })).not.toThrow();
  });
});

describe("rate limiting (pure, no database required)", () => {
  it("trips once the limit is exceeded within the window, and recovers after it resets", async () => {
    let now = 1_000_000;
    const limiter = new InMemoryRateLimiter({ now: () => now });
    const identity = { endpointClass: "ask_nyaya" as const, userId: "rate-limit-test-user" };
    const overrides = { limit: 3, windowMs: 1000 };

    for (let i = 0; i < 3; i++) {
      const decision = await checkEndpointRateLimit(limiter, identity, overrides);
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(2 - i);
    }

    const blocked = await checkEndpointRateLimit(limiter, identity, overrides);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);

    // Advancing past the window resets the count rather than compounding it.
    now += overrides.windowMs + 1;
    const recovered = await checkEndpointRateLimit(limiter, identity, overrides);
    expect(recovered.allowed).toBe(true);
  });

  it("scopes limits per key so one organization's traffic cannot exhaust another's budget", async () => {
    const limiter = new InMemoryRateLimiter();
    const overrides = { limit: 1, windowMs: 60_000 };
    const orgA = { endpointClass: "research" as const, organizationId: "org-a" };
    const orgB = { endpointClass: "research" as const, organizationId: "org-b" };

    expect((await checkEndpointRateLimit(limiter, orgA, overrides)).allowed).toBe(true);
    expect((await checkEndpointRateLimit(limiter, orgA, overrides)).allowed).toBe(false);
    // A different organization's identical endpoint class is a separate bucket.
    expect((await checkEndpointRateLimit(limiter, orgB, overrides)).allowed).toBe(true);
  });
});

describe("malware scanning: ClamAV fixture mode (pure, no real clamd required)", () => {
  const scanner = new ClamAvMalwareScanner({ fixtureMode: true });

  it("blocks a storage key that names an infected fixture", async () => {
    const result = await scanner.scan({
      key: "org/test-org/documents/doc1/versions/v1/infected-sample.txt",
      contentType: "text/plain",
      byteSize: 42,
    });
    expect(result.status).toBe("blocked");
    expect(mapMalwareResultToProcessingState(result)).toBe("scan_blocked");
  });

  it("blocks content containing the EICAR test signature regardless of filename", async () => {
    const result = await scanner.scan({
      key: "org/test-org/documents/doc2/versions/v1/looks-clean.txt",
      contentType: "text/plain",
      byteSize: 68,
      getContent: async () =>
        Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"),
    });
    expect(result.status).toBe("blocked");
  });

  it("reports a genuinely clean upload as clean", async () => {
    const result = await scanner.scan({
      key: "org/test-org/documents/doc3/versions/v1/lease.txt",
      contentType: "text/plain",
      byteSize: 11,
      getContent: async () => Buffer.from("Hello world"),
    });
    expect(result.status).toBe("clean");
    expect(mapMalwareResultToProcessingState(result)).toBe("scan_clean");
  });
});

describe.runIf(runDbTests)("phase 9 production readiness (database-backed)", () => {
  const db = createDb(process.env.DATABASE_URL);
  const suffix = Date.now().toString(36);

  let ownerAId = "";
  let orgAId = "";
  let matterAId = "";
  let ownerBId = "";
  let orgBId = "";
  let matterBId = "";

  beforeAll(async () => {
    const [ownerA] = await db
      .insert(users)
      .values({
        authSubject: `p9_ownerA_${suffix}`,
        email: `p9_ownerA_${suffix}@example.nyayagrid.local`,
        name: "P9 Owner A",
      })
      .returning();
    const [ownerB] = await db
      .insert(users)
      .values({
        authSubject: `p9_ownerB_${suffix}`,
        email: `p9_ownerB_${suffix}@example.nyayagrid.local`,
        name: "P9 Owner B",
      })
      .returning();
    ownerAId = ownerA!.id;
    ownerBId = ownerB!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `P9 Firm A ${suffix}`,
      slug: `p9-firm-a-${suffix}`,
      type: "firm",
      ownerUserId: ownerAId,
    });
    orgAId = orgA.organization.id;
    const orgB = await createOrganizationWithDefaults(db, {
      name: `P9 Firm B ${suffix}`,
      slug: `p9-firm-b-${suffix}`,
      type: "firm",
      ownerUserId: ownerBId,
    });
    orgBId = orgB.organization.id;

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: orgAId,
        clientType: "individual",
        displayName: "P9 Client A",
        createdByUserId: ownerAId,
      })
      .returning();
    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: orgBId,
        clientType: "individual",
        displayName: "P9 Client B",
        createdByUserId: ownerBId,
      })
      .returning();

    const [matterA] = await db
      .insert(matters)
      .values({
        organizationId: orgAId,
        clientId: clientA!.id,
        matterNumber: `P9A-${suffix}`,
        title: "P9 Matter A",
        createdByUserId: ownerAId,
      })
      .returning();
    matterAId = matterA!.id;
    await db.insert(matterMembers).values({
      organizationId: orgAId,
      matterId: matterAId,
      userId: ownerAId,
      access: "manage",
    });

    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: orgBId,
        clientId: clientB!.id,
        matterNumber: `P9B-${suffix}`,
        title: "P9 Matter B",
        createdByUserId: ownerBId,
      })
      .returning();
    matterBId = matterB!.id;
    await db.insert(matterMembers).values({
      organizationId: orgBId,
      matterId: matterBId,
      userId: ownerBId,
      access: "manage",
    });
  }, 60_000);

  afterAll(async () => {
    await db.delete(dataDeletionRequests).where(eq(dataDeletionRequests.userId, ownerAId));
    await db.delete(dataDeletionRequests).where(eq(dataDeletionRequests.userId, ownerBId));
    await db.delete(aiUsageEvents).where(eq(aiUsageEvents.userId, ownerAId));
    await db.delete(organizations).where(eq(organizations.id, orgAId));
    await db.delete(organizations).where(eq(organizations.id, orgBId));
    await db.delete(users).where(eq(users.id, ownerAId));
    await db.delete(users).where(eq(users.id, ownerBId));
  });

  describe("legal hold blocks the deletion path", () => {
    it("rejects a matter-scoped deletion request while a hold covers that matter, allows it once released", async () => {
      const hold = await placeLegalHold({
        db,
        organizationId: orgAId,
        matterId: matterAId,
        userId: ownerAId,
        reason: "Pending litigation — preserve this matter's records",
      });

      await expect(
        assertNotOnLegalHold(db, { organizationId: orgAId, matterId: matterAId }),
      ).rejects.toBeInstanceOf(LegalHoldActiveError);

      const blocked = await requestDataDeletion({
        db,
        userId: ownerAId,
        workspace: "professional",
        organizationId: orgAId,
        scope: { matterIds: [matterAId] },
      });
      expect(blocked.status).toBe("rejected");
      expect(blocked.scope.note).toMatch(/legal hold/i);

      await cancelDeletion({ db, requestId: blocked.id, userId: ownerAId });
      await releaseLegalHold({ db, organizationId: orgAId, holdId: hold.id, userId: ownerAId });

      const allowed = await requestDataDeletion({
        db,
        userId: ownerAId,
        workspace: "professional",
        organizationId: orgAId,
        scope: { matterIds: [matterAId] },
      });
      expect(allowed.status).toBe("pending");
      await cancelDeletion({ db, requestId: allowed.id, userId: ownerAId });
    });

    it("an organization-wide hold blocks a whole-organization deletion request too", async () => {
      const hold = await placeLegalHold({
        db,
        organizationId: orgAId,
        userId: ownerAId,
        reason: "Regulatory inquiry — preserve the entire organization",
      });

      const blocked = await requestDataDeletion({
        db,
        userId: ownerAId,
        workspace: "professional",
        organizationId: orgAId,
      });
      expect(blocked.status).toBe("rejected");

      await releaseLegalHold({ db, organizationId: orgAId, holdId: hold.id, userId: ownerAId });
      await cancelDeletion({ db, requestId: blocked.id, userId: ownerAId });
    });

    it("a hold on organization A never blocks a deletion request for organization B", async () => {
      await placeLegalHold({
        db,
        organizationId: orgAId,
        userId: ownerAId,
        reason: "Org A only — must not leak into org B's requests",
      });

      const requestForB = await requestDataDeletion({
        db,
        userId: ownerBId,
        workspace: "professional",
        organizationId: orgBId,
      });
      expect(requestForB.status).toBe("pending");
      await cancelDeletion({ db, requestId: requestForB.id, userId: ownerBId });
    });
  });

  describe("organization data export is scoped, never cross-tenant", () => {
    it("exports only organization A's clients and matters, never organization B's", async () => {
      const exportA = await exportOrganizationData({
        db,
        organizationId: orgAId,
        userId: ownerAId,
      });

      expect(exportA.organization?.id).toBe(orgAId);
      expect(exportA.matters.some((m) => m.id === matterAId)).toBe(true);
      expect(exportA.matters.some((m) => m.id === matterBId)).toBe(false);
      expect(exportA.clients.some((c) => c.displayName === "P9 Client B")).toBe(false);
      expect(exportA.counts.matters).toBe(exportA.matters.length);

      const exportB = await exportOrganizationData({
        db,
        organizationId: orgBId,
        userId: ownerBId,
      });
      expect(exportB.matters.some((m) => m.id === matterAId)).toBe(false);
      expect(exportB.clients.some((c) => c.displayName === "P9 Client A")).toBe(false);
    });
  });

  describe("AI usage accounting", () => {
    it("records a usage event when the helper is called, stripping content-bearing metadata", async () => {
      const row = await recordAiUsageEvent(db, {
        organizationId: orgAId,
        userId: ownerAId,
        matterId: matterAId,
        workspace: "professional",
        capability: "qa",
        provider: "mock",
        model: "mock-model",
        inputTokens: 120,
        outputTokens: 45,
        metadata: {
          requestId: "req-123",
          // Must never survive into the stored row — see CONTENT_KEY_PATTERN in
          // packages/platform/src/usage.ts.
          prompt: "What happened in this confidential matter?",
          answer: "The confidential answer text.",
        },
      });

      expect(row?.id).toBeTruthy();
      const [stored] = await db
        .select()
        .from(aiUsageEvents)
        .where(eq(aiUsageEvents.id, row!.id))
        .limit(1);

      expect(stored).toBeDefined();
      expect(stored!.organizationId).toBe(orgAId);
      expect(stored!.matterId).toBe(matterAId);
      expect(stored!.workspace).toBe("professional");
      expect(stored!.capability).toBe("qa");
      expect(stored!.inputTokens).toBe(120);
      expect(stored!.outputTokens).toBe(45);
      expect(stored!.metadata.requestId).toBe("req-123");
      expect(stored!.metadata.prompt).toBeUndefined();
      expect(stored!.metadata.answer).toBeUndefined();
    });
  });
});
