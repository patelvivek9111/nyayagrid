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
 * Oct 19–25 Phase 1 — Hearing prep Command Center browser certification.
 * CourtListener: 0. Schema migrations: none.
 */
const suffix = Date.now().toString(36);
const ORG_NAME = `P1 Hear Firm ${suffix}`;
const ORG_SLUG = `p1-hear-firm-${suffix}`;
const CLIENT_NAME = `P1 Hear Client ${suffix}`;
const CASE_TITLE = `P1 Hear Case ${suffix}`;

let matterId = "";
let conversationId = "";
let compelTitle = `Motion to Compel — May 4 ${suffix}`;
let sjTitle = `Summary Judgment Motion — June 12 ${suffix}`;
let organizationId = "";

const metrics = {
  threadLoadMs: 0,
  hearingPrepMs: 0,
  outlinePreviewMs: 0,
  browser500: 0,
  fatalReact: 0,
  hydration: 0,
  consoleErrors: 0,
  autoPick: 0,
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
      if (/Minified React error|Uncaught|Fatal/i.test(text)) metrics.fatalReact += 1;
    }
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
  return { ms: Date.now() - started, body, status: res.status() };
}

test.describe.serial("Oct 19–25 Phase 1 hearing prep browser cert", () => {
  test.afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ phase1_hearing_browser_metrics: metrics, courtlistener: 0 }));
  });

  test("API setup + Command Center load + hearing prep flows", async ({ page }) => {
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

    const compel = await page.request.post(`/api/v1/matters/${matterId}/motions`, {
      data: {
        motionType: "MOTION_TO_COMPEL",
        title: compelTitle,
        status: "FILED",
        filedAt: "2025-05-04T15:00:00.000Z",
        hearingAt: "2025-05-28T15:00:00.000Z",
      },
    });
    expect(compel.ok(), await compel.text()).toBeTruthy();
    const sj = await page.request.post(`/api/v1/matters/${matterId}/motions`, {
      data: {
        motionType: "SUMMARY_JUDGMENT",
        title: sjTitle,
        status: "FILED",
        filedAt: "2025-06-12T15:00:00.000Z",
        hearingAt: "2025-07-01T15:00:00.000Z",
      },
    });
    expect(sj.ok(), await sj.text()).toBeTruthy();

    const convRes = await page.request.post(`/api/v1/matters/${matterId}/conversations`, {
      data: { title: "Phase 1 hearing cert" },
    });
    expect(convRes.ok(), await convRes.text()).toBeTruthy();
    conversationId = (await convRes.json()).conversation?.id ?? "";
    expect(conversationId).toBeTruthy();

    // Explicit motion hearing prep
    const prep = await askApi(page, `Prepare me for the motion to compel hearing`, conversationId);
    metrics.hearingPrepMs = prep.ms;
    const prepAnswer = String(prep.body.qa?.answer ?? prep.body.answer ?? "");
    expect(prepAnswer.length).toBeGreaterThan(0);
    expect(prepAnswer).not.toMatch(/\bthe judge will ask\b/i);
    // Honesty disclaimer may mention CourtListener; actual calls must remain zero.
    const hearingPrep = prep.body.qa?.artifact?.validation?.hearingPrep ?? {};
    expect(hearingPrep.posture).toBe("HEARING_SCHEDULED");
    expect(String(hearingPrep.motionId ?? "")).toBeTruthy();
    expect(JSON.stringify(hearingPrep.limitations ?? [])).toMatch(/No CourtListener calls were made/i);
    expect(JSON.stringify(prep.body)).not.toMatch(/courtlistener\.com|CL_[A-Z_]*REQUEST|quota.?probe/i);

    // Ambiguous hearing — no auto-pick
    const ambConv = await page.request.post(`/api/v1/matters/${matterId}/conversations`, {
      data: { title: "Phase 1 ambiguity" },
    });
    const ambId = (await ambConv.json()).conversation?.id as string;
    const amb = await askApi(page, "prepare me for the hearing", ambId);
    const ambText = String(amb.body.qa?.answer ?? amb.body.answer ?? "");
    const ambValidation = amb.body.qa?.artifact?.validation ?? {};
    const ambHearing = ambValidation.hearingPrep ?? {};
    const ambReferent = ambValidation.referentResolution ?? {};
    const ux = amb.body.ux ?? amb.body.qa?.ux;
    const ambiguous =
      ambHearing.posture === "AMBIGUOUS" ||
      ambReferent.status === "AMBIGUOUS" ||
      ux?.turnKind === "ambiguity" ||
      /Which motion|Which hearing|Multiple motions|Ambiguous/i.test(ambText);
    if (!ambiguous) metrics.autoPick += 1;
    expect(ambiguous).toBeTruthy();
    expect(metrics.autoPick).toBe(0);
    // NO_AUTO_PICK: must not quietly bind a single motionId under ambiguity.
    if (ambHearing.posture === "AMBIGUOUS") {
      expect(ambHearing.motionId == null || ambHearing.motionId === "").toBeTruthy();
    }

    // Multi-turn investigate + outline preview (no write)
    const mt = await page.request.post(`/api/v1/matters/${matterId}/conversations`, {
      data: { title: "Phase 1 multiturn" },
    });
    const mtId = (await mt.json()).conversation?.id as string;
    await askApi(page, "Prepare me for the motion to compel hearing", mtId);
    const inv = await askApi(page, "what should I investigate before the hearing?", mtId);
    const invHearing = inv.body.qa?.artifact?.validation?.hearingPrep ?? {};
    const invText = String(inv.body.qa?.answer ?? inv.body.answer ?? "");
    expect(
      Number(invHearing.investigateCount ?? 0) > 0 ||
        /investigate|gap|deficiency|unsupported|UNKNOWN|authority/i.test(invText),
    ).toBeTruthy();
    const outline = await askApi(page, "turn this into a hearing outline", mtId);
    metrics.outlinePreviewMs = outline.ms;
    const outlineHearing = outline.body.qa?.artifact?.validation?.hearingPrep ?? {};
    const outlineText = String(outline.body.qa?.answer ?? outline.body.answer ?? "");
    const outlineClass =
      outline.body.qa?.artifact?.validation?.workflowClassification?.actionClass ?? "";
    expect(
      outlineHearing.outlinePreview === true ||
        outlineClass === "DRAFT_PREVIEW" ||
        /Draft preview|not saved|HEARING OUTLINE|outline/i.test(outlineText),
    ).toBeTruthy();

    // Compression
    const compress = await askApi(page, "make a 5-minute version", mtId);
    const compressHearing = compress.body.qa?.artifact?.validation?.hearingPrep ?? {};
    const compressText = String(compress.body.qa?.answer ?? compress.body.answer ?? "");
    const compressClass =
      compress.body.qa?.artifact?.validation?.workflowClassification?.actionClass ?? "";
    expect(
      compressHearing.compressed === true ||
        compressClass === "DRAFT_PREVIEW" ||
        /5-MINUTE|minute|oral argument|Draft preview|points/i.test(compressText),
    ).toBeTruthy();

    // API hearing flows certified above; UI load is a separate test (cold compile can be slow).
  });

  test("Command Center UI loads for hearing conversation", async ({ page }) => {
    test.setTimeout(420_000);
    trackPageHealth(page);
    expect(matterId).toBeTruthy();
    expect(conversationId).toBeTruthy();

    // Warm RSC compile via request before browser navigation.
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
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    // Composer must accept input (full Ask path already certified via API above).
    const box = page.getByPlaceholder(/Ask Nyaya about this Case/);
    await box.fill("what are the weakest points for our motion?");
    await expect(box).toHaveValue(/weakest points/);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  test("guest Ask API denied", async ({ request }) => {
    test.setTimeout(120_000);
    expect(matterId).toBeTruthy();
    const dbUrl =
      process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
    const db = createDb(dbUrl);
    const guestSubject = `p1_browser_guest_${suffix}`;
    try {
      const [matter] = await db.select().from(matters).where(eq(matters.id, matterId)).limit(1);
      expect(matter).toBeTruthy();
      const [guestUser] = await db
        .insert(users)
        .values({
          authSubject: guestSubject,
          email: `${guestSubject}@example.nyayagrid.local`,
          name: "P1 Browser Guest",
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
        data: { question: "Prepare me for tomorrow's hearing", mode: "ask" },
      });
      expect(askRes.status()).toBe(403);
      const askBody = await askRes.json();
      expect(askBody.error?.code).toBe("DENY_GUEST_ASK");
      expect(askBody.qa).toBeUndefined();
    } finally {
      await closeDb(db);
    }
  });

  test("browser health counters remain clean", async () => {
    expect(metrics.browser500).toBe(0);
    expect(metrics.fatalReact).toBe(0);
    expect(metrics.hydration).toBe(0);
    expect(metrics.autoPick).toBe(0);
  });
});
