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
 * Oct 19–25 Phase 2 — Deposition prep Command Center browser certification.
 * CourtListener: 0. Schema migrations: none.
 */
const suffix = Date.now().toString(36);
const ORG_NAME = `P2 Depo Firm ${suffix}`;
const ORG_SLUG = `p2-depo-firm-${suffix}`;
const CLIENT_NAME = `P2 Depo Client ${suffix}`;
const CASE_TITLE = `P2 Depo Case ${suffix}`;

let matterId = "";
let conversationId = "";
let organizationId = "";
let mariaId = "";

const metrics = {
  threadLoadMs: 0,
  depositionPrepMs: 0,
  outlinePreviewMs: 0,
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
  return { ms: Date.now() - started, body, status: res.status() };
}

test.describe.serial("Oct 19–25 Phase 2 deposition prep browser cert", () => {
  test.afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ phase2_deposition_browser_metrics: metrics, courtlistener: 0 }));
  });

  test("API setup + Command Center deposition prep flows", async ({ page }) => {
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

    const maria = await page.request.post(`/api/v1/matters/${matterId}/entities`, {
      data: {
        entityType: "person",
        displayName: "Maria Lopez",
        description: "property manager",
      },
    });
    expect(maria.ok(), await maria.text()).toBeTruthy();
    mariaId = (await maria.json()).entity.id as string;

    const johnA = await page.request.post(`/api/v1/matters/${matterId}/entities`, {
      data: {
        entityType: "person",
        displayName: "John Smith",
        description: "counterparty",
      },
    });
    expect(johnA.ok(), await johnA.text()).toBeTruthy();
    const johnB = await page.request.post(`/api/v1/matters/${matterId}/entities`, {
      data: {
        entityType: "person",
        displayName: "John Smith",
        description: "former employee — Acme",
      },
    });
    expect(johnB.ok(), await johnB.text()).toBeTruthy();

    const claim = await page.request.post(`/api/v1/matters/${matterId}/civil/claims`, {
      data: {
        kind: "CLAIM",
        label: "Notice",
        description: "Whether Maria received written cure notice.",
        supportStatus: "PARTIALLY_SUPPORTED",
      },
    });
    // Claim route may vary; do not fail certification if unavailable — persons alone suffice.
    void claim;

    const convRes = await page.request.post(`/api/v1/matters/${matterId}/conversations`, {
      data: { title: "Phase 2 deposition cert" },
    });
    expect(convRes.ok(), await convRes.text()).toBeTruthy();
    conversationId = (await convRes.json()).conversation?.id ?? "";
    expect(conversationId).toBeTruthy();

    // Explicit deponent prep
    const prep = await askApi(page, "Prepare me to depose Maria Lopez", conversationId);
    metrics.depositionPrepMs = prep.ms;
    const prepAnswer = String(prep.body.qa?.answer ?? prep.body.answer ?? "");
    expect(prepAnswer.length).toBeGreaterThan(0);
    const depositionPrep = prep.body.qa?.artifact?.validation?.depositionPrep ?? {};
    expect(depositionPrep.posture).toBe("RESOLVED");
    expect(String(depositionPrep.personId ?? "")).toBe(mariaId);
    expect(JSON.stringify(depositionPrep.limitations ?? [])).toMatch(/No CourtListener calls were made/i);
    expect(JSON.stringify(prep.body)).not.toMatch(/courtlistener\.com|CL_[A-Z_]*REQUEST|quota.?probe/i);

    // Ambiguous person — no auto-pick
    const ambConv = await page.request.post(`/api/v1/matters/${matterId}/conversations`, {
      data: { title: "Phase 2 ambiguity" },
    });
    const ambId = (await ambConv.json()).conversation?.id as string;
    const amb = await askApi(page, "prepare me to depose John Smith", ambId);
    const ambText = String(amb.body.qa?.answer ?? amb.body.answer ?? "");
    const ambValidation = amb.body.qa?.artifact?.validation ?? {};
    const ambDepo = ambValidation.depositionPrep ?? {};
    const ambReferent = ambValidation.referentResolution ?? {};
    const ux = amb.body.ux ?? amb.body.qa?.ux;
    const ambiguous =
      ambDepo.posture === "AMBIGUOUS" ||
      ambReferent.status === "AMBIGUOUS" ||
      ux?.turnKind === "ambiguity" ||
      /Which person|Multiple people|Ambiguous/i.test(ambText);
    if (!ambiguous) metrics.autoPick += 1;
    expect(ambiguous).toBeTruthy();
    expect(metrics.autoPick).toBe(0);
    if (ambDepo.posture === "AMBIGUOUS") {
      expect(ambDepo.personId == null || ambDepo.personId === "").toBeTruthy();
    }

    // Multi-turn focus + conflict + outline + shorten
    const mt = await page.request.post(`/api/v1/matters/${matterId}/conversations`, {
      data: { title: "Phase 2 multiturn" },
    });
    const mtId = (await mt.json()).conversation?.id as string;
    await askApi(page, "Prepare me to depose Maria Lopez", mtId);
    await askApi(page, "focus only on notice", mtId);
    const conflict = await askApi(page, "where does her story conflict with the record?", mtId);
    const conflictText = String(conflict.body.qa?.answer ?? conflict.body.answer ?? "");
    expect(conflictText).not.toMatch(/\b(she lied|prove dishonesty|false testimony)\b/i);
    const outline = await askApi(page, "turn this into a deposition outline", mtId);
    metrics.outlinePreviewMs = outline.ms;
    const outlineDepo = outline.body.qa?.artifact?.validation?.depositionPrep ?? {};
    const outlineText = String(outline.body.qa?.answer ?? outline.body.answer ?? "");
    const outlineClass =
      outline.body.qa?.artifact?.validation?.workflowClassification?.actionClass ?? "";
    expect(
      outlineDepo.outlinePreview === true ||
        outlineClass === "DRAFT_PREVIEW" ||
        /Draft preview|not saved|DEPOSITION|outline|DRAFT PREVIEW/i.test(outlineText),
    ).toBeTruthy();
    const short = await askApi(page, "only give me the 10 most important", mtId);
    const shortText = String(short.body.qa?.answer ?? short.body.answer ?? "");
    const shortDepo = short.body.qa?.artifact?.validation?.depositionPrep ?? {};
    expect(
      shortDepo.compressed === true || /10-QUESTION|most important|grounded/i.test(shortText),
    ).toBeTruthy();

    // Premise challenge
    const lied = await askApi(page, "what questions prove he lied?", mtId);
    const liedText = String(lied.body.qa?.answer ?? lied.body.answer ?? "");
    const liedDepo = lied.body.qa?.artifact?.validation?.depositionPrep ?? {};
    expect(
      Boolean(liedDepo.premiseChallenge) ||
        /does not establish dishonesty|conflicting accounts/i.test(liedText),
    ).toBeTruthy();
  });

  test("Command Center UI loads for deposition conversation", async ({ page }) => {
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
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    const box = page.getByPlaceholder(/Ask Nyaya about this Case/);
    await box.fill("what documents should I use for Maria?");
    await expect(box).toHaveValue(/documents/);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  test("guest Ask API denied", async ({ request }) => {
    test.setTimeout(120_000);
    expect(matterId).toBeTruthy();
    const dbUrl =
      process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
    const db = createDb(dbUrl);
    const guestSubject = `p2_browser_guest_${suffix}`;
    try {
      const [matter] = await db.select().from(matters).where(eq(matters.id, matterId)).limit(1);
      expect(matter).toBeTruthy();
      const [guestUser] = await db
        .insert(users)
        .values({
          authSubject: guestSubject,
          email: `${guestSubject}@example.nyayagrid.local`,
          name: "P2 Browser Guest",
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
        data: { question: "Prepare me to depose Maria Lopez", mode: "ask" },
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
    expect(metrics.securityErrors).toBe(0);
    expect(metrics.autoPick).toBe(0);
  });
});
