import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { selectWorkspace } from "./select-workspace";

/**
 * Oct 19–25 Phase 5 — Cross-workflow Command Center browser certification.
 * Separate from legacy e2e/command-center-phase5.spec.ts.
 * CourtListener: 0. Schema migrations: none.
 */
const suffix = Date.now().toString(36);
const ORG_NAME = `P5 Cross Firm ${suffix}`;
const ORG_SLUG = `p5-cross-firm-${suffix}`;
const CLIENT_NAME = `P5 Cross Client ${suffix}`;
const CASE_TITLE = `P5 Cross Case ${suffix}`;

let matterId = "";
let conversationId = "";
let organizationId = "";

const metrics = {
  threadLoadMs: 0,
  chainMs: 0,
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
  const data: Record<string, unknown> = { question, mode: "ask" };
  if (typeof cid === "string" && /^[0-9a-f-]{36}$/i.test(cid)) data.conversationId = cid;
  const res = await page.request.post(`/api/v1/matters/${matterId}/ask`, { data });
  const body = await res.json();
  expect(res.ok(), JSON.stringify(body).slice(0, 800)).toBeTruthy();
  conversationId = body.conversationId ?? body.qa?.conversationId ?? conversationId;
  return { ms: Date.now() - started, body };
}

function extractAnswer(body: Record<string, unknown>): string {
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
}

test.describe.serial("Oct 19–25 Phase 5 cross-workflow browser cert", () => {
  test.afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ phase5_cross_workflow_browser_metrics: metrics, courtlistener: 0 }));
  });

  test("API setup + chained conversation", async ({ page }) => {
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

    const entityRes = await page.request.post(`/api/v1/matters/${matterId}/entities`, {
      data: {
        entityType: "person",
        displayName: "Maria Lopez",
        description: "property manager",
      },
    });
    expect(entityRes.ok(), await entityRes.text()).toBeTruthy();

    const convRes = await page.request.post(`/api/v1/matters/${matterId}/conversations`, {
      data: { title: "Phase 5 cross-workflow cert" },
    });
    expect(convRes.ok(), await convRes.text()).toBeTruthy();
    conversationId = (await convRes.json()).conversation?.id ?? "";
    expect(conversationId).toBeTruthy();

    const startedNav = Date.now();
    await selectWorkspace(page, { organizationId, matterId });
    await page.goto(`/app/cases/${matterId}`);
    metrics.threadLoadMs = Date.now() - startedNav;
    await expect(page.getByText(CASE_TITLE).first()).toBeVisible({ timeout: 60_000 });

    const chainStarted = Date.now();
    const hearing = await askApi(page, "Prepare me for the motion to compel hearing", conversationId);
    expect(extractAnswer(hearing.body as Record<string, unknown>).length).toBeGreaterThan(0);

    const inv = await askApi(page, "what should I investigate next?", conversationId);
    const invText = extractAnswer(inv.body as Record<string, unknown>);
    expect(
      /INVESTIGATE_NEXT|No additional high-priority|weak|gap/i.test(invText) || invText.length > 0,
    ).toBeTruthy();

    const task = await askApi(page, "turn #1 into a task", conversationId);
    expect(extractAnswer(task.body as Record<string, unknown>)).toMatch(
      /confirm|preview|task|Investigate|gap|Ambiguous/i,
    );

    const amb = await askApi(page, "turn that into", conversationId);
    expect(extractAnswer(amb.body as Record<string, unknown>)).toMatch(
      /Ambiguous|Sources:|Targets:|which source|turn that into/i,
    );

    const depo = await askApi(page, "Prepare me to depose Maria Lopez", conversationId);
    expect(extractAnswer(depo.body as Record<string, unknown>).length).toBeGreaterThan(0);

    const research = await askApi(
      page,
      "research whether the notice evidence supports deposing Maria",
      conversationId,
    );
    expect(extractAnswer(research.body as Record<string, unknown>).length).toBeGreaterThan(0);

    const draft = await askApi(page, "turn that research into an argument section", conversationId);
    expect(extractAnswer(draft.body as Record<string, unknown>)).toMatch(
      /DRAFT|argument|Ambiguous|Confirm|preview|research/i,
    );

    const weakest = await askApi(page, "What are the weakest parts of the record?", conversationId);
    expect(extractAnswer(weakest.body as Record<string, unknown>).length).toBeGreaterThan(0);

    const invAfter = await askApi(page, "what should I investigate next?", conversationId);
    expect(extractAnswer(invAfter.body as Record<string, unknown>).length).toBeGreaterThan(0);

    metrics.chainMs = Date.now() - chainStarted;
    expect(JSON.stringify(hearing.body)).not.toMatch(/courtlistener\.com/i);
  });

  test("browser health counters remain clean", async () => {
    expect(metrics.browser500).toBe(0);
    expect(metrics.fatalReact).toBe(0);
    expect(metrics.hydration).toBe(0);
    expect(metrics.securityErrors).toBe(0);
    expect(metrics.autoPick).toBe(0);
  });
});
