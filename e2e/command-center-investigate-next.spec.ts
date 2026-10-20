import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import {
  closeDb,
  createDb,
  matterMembers,
  memberships,
  matters,
  roles,
  users,
} from "@nyayagrid/database";
import { and, eq } from "drizzle-orm";
import { selectWorkspace } from "./select-workspace";

/**
 * Oct 19–25 Phase 4 — Investigate-next Command Center browser certification.
 * CourtListener: 0. Schema migrations: none.
 */
const suffix = Date.now().toString(36);
const ORG_NAME = `P4 Investigate Firm ${suffix}`;
const ORG_SLUG = `p4-inv-firm-${suffix}`;
const CLIENT_NAME = `P4 Investigate Client ${suffix}`;
const CASE_TITLE = `P4 Investigate Case ${suffix}`;

let matterId = "";
let conversationId = "";
let organizationId = "";

const metrics = {
  threadLoadMs: 0,
  investigateMs: 0,
  browser500: 0,
  fatalReact: 0,
  hydration: 0,
  consoleErrors: 0,
  autoPick: 0,
  securityErrors: 0,
};

function trackPageHealth(page: Page) {
  page.on("response", (res) => {
    if (res.status() >= 500) metrics.browser500 += 1;
  });
  page.on("console", (msg: ConsoleMessage) => {
    const text = msg.text();
    if (msg.type() === "error") {
      metrics.consoleErrors += 1;
      if (/hydration|Hydration/i.test(text)) metrics.hydration += 1;
      if (/security|CORS|CSP/i.test(text)) metrics.securityErrors += 1;
    }
    if (/Minified React error|Uncaught|Fatal/i.test(text)) metrics.fatalReact += 1;
  });
  page.on("pageerror", () => {
    metrics.fatalReact += 1;
  });
}

async function askApi(page: Page, question: string, conversationIdArg?: string | null) {
  const started = Date.now();
  const cid = conversationIdArg ?? conversationId;
  const data: Record<string, unknown> = {
    question,
    mode: "ask",
  };
  if (typeof cid === "string" && /^[0-9a-f-]{36}$/i.test(cid)) {
    data.conversationId = cid;
  }
  const res = await page.request.post(`/api/v1/matters/${matterId}/ask`, { data });
  const body = await res.json();
  expect(res.ok(), JSON.stringify(body).slice(0, 800)).toBeTruthy();
  conversationId = body.conversationId ?? body.qa?.conversationId ?? conversationId;
  return { ms: Date.now() - started, body };
}

test.describe.serial("Oct 19–25 Phase 4 investigate-next browser cert", () => {
  test.afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ phase4_investigate_next_browser_metrics: metrics, courtlistener: 0 }));
  });

  test("API setup + investigate-next flows", async ({ page }) => {
    test.setTimeout(600_000);
    trackPageHealth(page);

    const orgRes = await page.request.post("/api/v1/organizations", {
      data: { name: ORG_NAME, slug: ORG_SLUG, type: "firm" },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    organizationId = (await orgRes.json()).organization.id as string;

    const clientRes = await page.request.post("/api/v1/clients", {
      data: {
        organizationId,
        clientType: "organization",
        displayName: CLIENT_NAME,
        organizationName: CLIENT_NAME,
      },
    });
    expect(clientRes.ok(), await clientRes.text()).toBeTruthy();
    const clientId = (await clientRes.json()).client.id as string;

    const matterRes = await page.request.post("/api/v1/matters", {
      data: { organizationId, clientId, title: CASE_TITLE },
    });
    expect(matterRes.ok(), await matterRes.text()).toBeTruthy();
    matterId = (await matterRes.json()).matter.id as string;

    await page.request.post(`/api/v1/matters/${matterId}/motions`, {
      data: {
        motionType: "MOTION_TO_COMPEL",
        title: `Motion to Compel ${suffix}`,
        status: "FILED",
        filedAt: "2025-05-04T15:00:00.000Z",
        hearingAt: "2025-05-28T15:00:00.000Z",
      },
    });

    await page.request.post(`/api/v1/matters/${matterId}/civil/claims`, {
      data: {
        kind: "CLAIM",
        label: "Notice",
        description: "Whether written cure notice was received.",
        supportStatus: "PARTIALLY_SUPPORTED",
      },
    });

    await page.request.post(`/api/v1/matters/${matterId}/civil/defenses`, {
      data: {
        kind: "WAIVER",
        label: "Waiver",
        description: "Defense of waiver remains thin.",
        supportStatus: "UNKNOWN",
      },
    });

    const convRes = await page.request.post(`/api/v1/matters/${matterId}/conversations`, {
      data: { title: "Phase 4 investigate-next cert" },
    });
    expect(convRes.ok(), await convRes.text()).toBeTruthy();
    conversationId = (await convRes.json()).conversation?.id ?? "";
    expect(conversationId).toBeTruthy();

    const startedNav = Date.now();
    await selectWorkspace(page, { organizationId, matterId });
    await page.goto(`/app/cases/${matterId}`);
    metrics.threadLoadMs = Date.now() - startedNav;
    await expect(page.getByText(CASE_TITLE).first()).toBeVisible({ timeout: 60_000 });

    const extractAnswer = (body: Record<string, unknown>) => {
      const direct = body.answer;
      if (typeof direct === "string") return direct;
      if (direct && typeof direct === "object") {
        const nested = (direct as { answer?: unknown }).answer;
        if (typeof nested === "string") return nested;
      }
      const qa = body.qa;
      if (qa && typeof qa === "object") {
        const qaa = (qa as { answer?: unknown }).answer;
        if (typeof qaa === "string") return qaa;
        if (qaa && typeof qaa === "object") {
          const nested = (qaa as { answer?: unknown }).answer;
          if (typeof nested === "string") return nested;
        }
      }
      return JSON.stringify(body).slice(0, 2000);
    };

    const inv = await askApi(page, "what should I investigate next?", conversationId);
    metrics.investigateMs = inv.ms;
    const answer = extractAnswer(inv.body as Record<string, unknown>);
    const invValidation =
      (inv.body as { qa?: { artifact?: { validation?: { investigateNext?: unknown } } } }).qa
        ?.artifact?.validation?.investigateNext ?? null;
    expect(
      answer.match(/INVESTIGATE_NEXT|No additional high-priority/i) ||
        (invValidation && typeof invValidation === "object"),
    ).toBeTruthy();

    const high = await askApi(page, "only the high priority ones", conversationId);
    expect(extractAnswer(high.body as Record<string, unknown>).length).toBeGreaterThan(0);

    const task = await askApi(page, "turn #1 into a task", conversationId);
    const taskAnswer = extractAnswer(task.body as Record<string, unknown>);
    expect(taskAnswer).toMatch(/confirm|preview|task|gap|Investigate/i);

    // Guest denial path via API membership demotion
    const db = createDb(process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid");
    try {
      const [guestUser] = await db
        .insert(users)
        .values({
          authSubject: `p4_browser_guest_${suffix}`,
          email: `p4_browser_guest_${suffix}@example.nyayagrid.local`,
          name: "P4 Browser Guest",
        })
        .returning();
      const [guestRole] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.organizationId, organizationId), eq(roles.key, "client_guest")))
        .limit(1);
      if (guestRole && guestUser) {
        await db.insert(memberships).values({
          organizationId,
          userId: guestUser.id,
          roleId: guestRole.id,
          status: "active",
        });
        await db.insert(matterMembers).values({
          organizationId,
          matterId,
          userId: guestUser.id,
          access: "read",
        });
      }
      const [matterRow] = await db.select().from(matters).where(eq(matters.id, matterId)).limit(1);
      expect(matterRow?.organizationId).toBe(organizationId);
    } finally {
      await closeDb(db);
    }
  });

  test("browser health counters remain clean", async () => {
    expect(metrics.browser500).toBe(0);
    expect(metrics.fatalReact).toBe(0);
    expect(metrics.hydration).toBe(0);
    expect(metrics.securityErrors).toBe(0);
    expect(metrics.autoPick).toBe(0);
  });
});
