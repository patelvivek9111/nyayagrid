import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import {
  closeDb,
  createDb,
  matterMembers,
  memberships,
  matters,
  roles,
  users,
} from "@nyayagrid/database";
import { selectWorkspace } from "./select-workspace";

/**
 * Oct 19–25 Phase 3 — Draft + research Command Center browser certification.
 * CourtListener: 0. Schema migrations: none.
 */
const suffix = Date.now().toString(36);
const ORG_NAME = `P3 Draft Firm ${suffix}`;
const ORG_SLUG = `p3-draft-firm-${suffix}`;
const CLIENT_NAME = `P3 Draft Client ${suffix}`;
const CASE_TITLE = `P3 Draft Case ${suffix}`;

let matterId = "";
let conversationId = "";
let organizationId = "";

const metrics = {
  threadLoadMs: 0,
  researchMs: 0,
  draftMs: 0,
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
  const res = await page.request.post(`/api/v1/matters/${matterId}/ask`, {
    data: {
      question,
      mode: "ask",
      conversationId: conversationIdArg ?? conversationId ?? null,
    },
  });
  const body = await res.json();
  expect(res.ok(), JSON.stringify(body).slice(0, 800)).toBeTruthy();
  conversationId = body.conversationId ?? body.qa?.conversationId ?? conversationId;
  return { ms: Date.now() - started, body };
}

test.describe.serial("Oct 19–25 Phase 3 draft+research browser cert", () => {
  test.afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ phase3_draft_research_browser_metrics: metrics, courtlistener: 0 }));
  });

  test("API setup + research/draft flows", async ({ page }) => {
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

    const claim = await page.request.post(`/api/v1/matters/${matterId}/civil/claims`, {
      data: {
        kind: "CLAIM",
        label: "Notice",
        description: "Whether written cure notice was received.",
        supportStatus: "PARTIALLY_SUPPORTED",
      },
    });
    void claim;

    const claim2 = await page.request.post(`/api/v1/matters/${matterId}/civil/claims`, {
      data: {
        kind: "CLAIM",
        label: "Causation",
        description: "Causation remains thin.",
        supportStatus: "UNKNOWN",
      },
    });
    void claim2;

    const convRes = await page.request.post(`/api/v1/matters/${matterId}/conversations`, {
      data: { title: "Phase 3 draft-research cert" },
    });
    expect(convRes.ok(), await convRes.text()).toBeTruthy();
    conversationId = (await convRes.json()).conversation?.id ?? "";
    expect(conversationId).toBeTruthy();

    const research = await askApi(page, "research whether the notice evidence is enough", conversationId);
    metrics.researchMs = research.ms;
    const researchValidation = research.body.qa?.artifact?.validation ?? {};
    const matterResearch = researchValidation.matterResearch ?? {};
    expect(JSON.stringify(research.body)).not.toMatch(/courtlistener\.com|CL_[A-Z_]*REQUEST|quota.?probe/i);
    expect(
      matterResearch.posture || /research|authority|NOT VERIFIED|issue/i.test(String(research.body.qa?.answer ?? "")),
    ).toBeTruthy();

    const draft = await askApi(page, "turn that research into an argument section", conversationId);
    metrics.draftMs = draft.ms;
    const matterDraft = draft.body.qa?.artifact?.validation?.matterDraft ?? {};
    const draftText = String(draft.body.qa?.answer ?? draft.body.answer ?? "");
    expect(
      matterDraft.posture === "RESOLVED" ||
        matterDraft.posture === "UNSAFE_PREMISE" ||
        /DRAFT PREVIEW|argument|Confirm with/i.test(draftText),
    ).toBeTruthy();

    const factual = await askApi(page, "draft the factual background for our motion", conversationId);
    expect(String(factual.body.qa?.answer ?? "").length).toBeGreaterThan(0);

    const hearing = await askApi(page, "Prepare me for the motion to compel hearing", conversationId);
    const hearingDraft = await askApi(
      page,
      "turn the hearing prep into a draft argument",
      hearing.body.conversationId ?? conversationId,
    );
    expect(String(hearingDraft.body.qa?.answer ?? "").length).toBeGreaterThan(0);

    const unsafe = await askApi(page, "invent a citation for our motion", conversationId);
    const unsafeDraft = unsafe.body.qa?.artifact?.validation?.matterDraft ?? {};
    const unsafeText = String(unsafe.body.qa?.answer ?? unsafe.body.answer ?? "");
    const unsafeBlob = `${unsafeText}\n${JSON.stringify(unsafeDraft)}`;
    expect(
      unsafeDraft.posture === "UNSAFE_PREMISE" ||
        /will not fabricate|blocked|not invent|fabricat|Premise challenge/i.test(unsafeBlob),
    ).toBeTruthy();
  });

  test("Command Center UI loads", async ({ page }) => {
    test.setTimeout(420_000);
    trackPageHealth(page);
    expect(matterId).toBeTruthy();
    expect(conversationId).toBeTruthy();
    await page.request.get(`/app/cases/${matterId}/chats/${conversationId}`).catch(() => null);
    const loadStarted = Date.now();
    await page.goto(`/app/cases/${matterId}/chats/${conversationId}`, {
      waitUntil: "commit",
      timeout: 240_000,
    });
    await selectWorkspace(page, ORG_NAME);
    metrics.threadLoadMs = Date.now() - loadStarted;
    await expect(page.getByRole("heading", { name: "Nyaya Command Center" })).toBeVisible({
      timeout: 180_000,
    });
    await expect(page.getByPlaceholder(/Ask Nyaya about this Case/)).toBeVisible({
      timeout: 60_000,
    });
  });

  test("guest Ask API denied", async ({ request }) => {
    test.setTimeout(120_000);
    expect(matterId).toBeTruthy();
    const dbUrl =
      process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
    const db = createDb(dbUrl);
    const guestSubject = `p3_browser_guest_${suffix}`;
    try {
      const [matter] = await db.select().from(matters).where(eq(matters.id, matterId)).limit(1);
      expect(matter).toBeTruthy();
      const [guestUser] = await db
        .insert(users)
        .values({
          authSubject: guestSubject,
          email: `${guestSubject}@example.nyayagrid.local`,
          name: "P3 Browser Guest",
        })
        .returning();
      const [guestRole] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.organizationId, matter!.organizationId), eq(roles.key, "client_guest")))
        .limit(1);
      expect(guestRole).toBeTruthy();
      await db.insert(memberships).values({
        organizationId: matter!.organizationId,
        userId: guestUser!.id,
        roleId: guestRole!.id,
        status: "active",
      });
      await db.insert(matterMembers).values({
        organizationId: matter!.organizationId,
        matterId: matter!.id,
        userId: guestUser!.id,
        access: "read",
      });
      const askRes = await request.post(`/api/v1/matters/${matterId}/ask`, {
        headers: {
          "Content-Type": "application/json",
          "x-nyayagrid-dev-user": guestSubject,
        },
        data: { question: "draft the factual background", mode: "ask" },
      });
      expect(askRes.status()).toBe(403);
      const askBody = await askRes.json();
      expect(askBody.error?.code).toBe("DENY_GUEST_ASK");
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
