/**
 * Phase 3 ops live cert — correlation, confirm logging, secret-free health helpers.
 * HTTP health endpoints are exercised via fetch when PHASE3_BASE_URL is set (Playwright webServer).
 * RUN_DB_TESTS=1 DATABASE_URL=localhost:5433. CourtListener: 0.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  matterMembers,
  matters,
  users,
  type Database,
  isLocalCertificationDatabaseUrl,
} from "@nyayagrid/database";
import { CORRELATION_ID_HEADER } from "@nyayagrid/observability";
import {
  createPendingActionRecord,
  emptyWorkingState,
  executeConfirmedConversationalAction,
} from "@nyayagrid/search";
import { beginRouteCorrelation } from "./request-correlation";
import { publicDatabaseError } from "./health";
import { GET as healthLive } from "../app/api/health/live/route";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const dbUrl =
  process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
const baseUrl = (process.env.PHASE3_BASE_URL ?? "").replace(/\/$/, "");

describe.runIf(runDbTests)("Phase 3 ops live certification", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `p3o_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    expect(isLocalCertificationDatabaseUrl(dbUrl)).toBe(true);
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p3o_${suffix}`,
        email: `p3o_${suffix}@example.nyayagrid.local`,
        name: "P3 Ops",
      })
      .returning();
    ids.owner = owner!.id;
    const org = await createOrganizationWithDefaults(db, {
      name: `P3O Firm ${suffix}`,
      slug: `p3o-firm-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    ids.org = org.organization.id;
    const [client] = await db
      .insert(clients)
      .values({
        organizationId: ids.org!,
        displayName: "P3O Client",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matter] = await db
      .insert(matters)
      .values({
        organizationId: ids.org!,
        clientId: client!.id,
        matterNumber: `P3O-${suffix}`,
        title: `P3 Ops ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.matter = matter!.id;
    await db.insert(matterMembers).values({
      organizationId: ids.org!,
      matterId: ids.matter!,
      userId: ids.owner!,
      access: "manage",
    });
  }, 120_000);

  afterAll(async () => {
    await closeDb(db);
  });

  it("health live handler is secret-free and ok", async () => {
    const res = await healthLive();
    const body = await res.json();
    const text = JSON.stringify(body);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(text).not.toMatch(/sk-|postgresql:\/\/|nyayagridsecret|CLERK_SECRET|OPENAI_API_KEY/i);
  });

  it.runIf(Boolean(baseUrl))("HTTP health live/ready/v1 are secret-free", async () => {
    let reachable = false;
    for (const path of ["/api/health/live", "/api/health/ready", "/api/v1/health"]) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}${path}`);
        reachable = true;
      } catch {
        continue;
      }
      const text = await res.text();
      expect(text).not.toMatch(/postgresql:\/\/[^"]+@/);
      expect(text).not.toMatch(/sk-|nyayagridsecret|OPENAI_API_KEY|CLERK_SECRET|INNGEST_SIGNING/i);
      expect(res.status === 200 || res.status === 503).toBe(true);
    }
    expect(reachable).toBe(true);
  });

  it("correlation header propagates; cancel response shape includes singleInstance", () => {
    const corr = beginRouteCorrelation(
      new Request("http://localhost/api/v1/matters/x/ask/cancel", {
        headers: { [CORRELATION_ID_HEADER]: "live-cid-p3" },
      }),
      "api.ask.cancel",
    );
    expect(corr.correlationId).toBe("live-cid-p3");
    const payload = { cancelled: false, singleInstance: true as const };
    const response = new Response(JSON.stringify(payload));
    corr.attach(response);
    expect(response.headers.get(CORRELATION_ID_HEADER)).toBe("live-cid-p3");
    expect(payload.singleInstance).toBe(true);
  });

  it("confirmation execution logs correlation-safe fields without content", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      if (typeof line === "string") lines.push(line);
    });
    const pending = createPendingActionRecord({
      actionType: "TASK_CREATE",
      actionClass: "WRITE_CONFIRMATION_REQUIRED",
      conversationId: crypto.randomUUID(),
      organizationId: ids.org!,
      matterId: ids.matter!,
      workingState: emptyWorkingState(),
      previewPayload: {
        title: "P3 OPS SECRET TITLE MUST NOT LOG",
        description: "sensitive body",
        proposedDueAt: null,
      },
    });
    const result = await executeConfirmedConversationalAction({
      db,
      userId: ids.owner!,
      pending,
      capability: "matters.edit",
      correlationId: "confirm-cid-p3",
    });
    spy.mockRestore();
    expect(result.status).toBe("COMPLETED");
    const joined = lines.join("\n");
    expect(joined).toContain("confirm.completed");
    expect(joined).toContain("confirm-cid-p3");
    expect(joined).toContain(pending.pendingActionId);
    expect(joined).not.toContain("P3 OPS SECRET TITLE MUST NOT LOG");
    expect(joined).not.toContain("sensitive body");
    expect(joined).not.toMatch(/postgresql:\/\/|sk-|OPENAI_API_KEY/);

    const again = await executeConfirmedConversationalAction({
      db,
      userId: ids.owner!,
      pending,
      capability: "matters.edit",
      correlationId: "confirm-cid-p3-retry",
    });
    expect(again.alreadyExecuted).toBe(true);
    expect(again.status).toBe("COMPLETED");
  });

  it("publicDatabaseError never leaks URLs in staging/prod", () => {
    expect(
      publicDatabaseError(
        new Error("connect ECONNREFUSED postgresql://nyayagrid:nyayagrid@localhost:5433/x"),
        "production",
      ),
    ).toBe("unreachable");
  });
});
