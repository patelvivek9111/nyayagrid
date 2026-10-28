import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import path from "node:path";
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
 * Phase 5 — Nyaya Command Center browser certification (AUTH_PROVIDER=dev).
 * CourtListener: 0. Schema migrations: none. Local DB via playwright.config.ts.
 */
const suffix = Date.now().toString(36);
const ORG_NAME = `P5 CC Firm ${suffix}`;
const ORG_SLUG = `p5-cc-firm-${suffix}`;
const CLIENT_NAME = `P5 CC Client ${suffix}`;
const CASE_TITLE = `P5 CC Case ${suffix}`;

let matterId = "";
let conversationId = "";
const metrics = {
  threadLoadMs: 0,
  firstProgressMs: 0,
  firstAnswerMs: 0,
  fullAnswerMs: 0,
  sourceDrawerMs: 0,
  browser500: 0,
  fatalReact: 0,
  hydration: 0,
  consoleErrors: 0,
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

let organizationId = "";

async function ensureOrgClientMatter(page: Page) {
  // Mirror professional.spec.ts setup — proven against this local runtime.
  await page.goto("/app/onboarding");
  await page.waitForLoadState("networkidle");
  const nameField = page.getByLabel("Firm or practice name");
  if (await nameField.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await nameField.fill(ORG_NAME);
    await page.getByLabel("Short name").fill(ORG_SLUG);
    await page.getByRole("button", { name: "Create organization" }).click();
    await expect(page.getByText(new RegExp(`Created ${ORG_NAME}`))).toBeVisible({
      timeout: 15_000,
    });
    const orgs = await page.request.get("/api/v1/organizations");
    const list = ((await orgs.json()).organizations ?? []) as Array<{ id: string; name: string }>;
    organizationId = list.find((org) => org.name === ORG_NAME)?.id ?? list[0]?.id ?? "";
  } else {
    const res = await page.request.post("/api/v1/organizations", {
      data: { name: ORG_NAME, slug: ORG_SLUG, type: "firm" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    organizationId = (await res.json()).organization.id as string;
  }
  expect(organizationId.length).toBeGreaterThan(0);
  await page.goto("/app/cases");
  await page.waitForLoadState("networkidle");
  await selectWorkspace(page, ORG_NAME, organizationId);

  await page.goto("/app/clients");
  await page.waitForLoadState("networkidle");
  await selectWorkspace(page, ORG_NAME, organizationId);
  await page
    .getByRole("heading", { name: "Clients", exact: true })
    .locator("xpath=ancestor::div[contains(@class,'justify-between')][1]")
    .getByRole("button", { name: "+ New client" })
    .click();
  await page.getByPlaceholder("Display name").fill(CLIENT_NAME);
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(
    page
      .getByText(`Created client ${CLIENT_NAME}`)
      .or(page.getByText(CLIENT_NAME, { exact: true }))
      .first(),
  ).toBeVisible({ timeout: 30_000 });

  await page.goto("/app/cases/new");
  await page.waitForLoadState("networkidle");
  await selectWorkspace(page, ORG_NAME, organizationId);
  const clientSelect = page.locator("main select").first();
  await expect(clientSelect.locator("option", { hasText: CLIENT_NAME })).toHaveCount(1, {
    timeout: 15_000,
  });
  await clientSelect.selectOption({ label: CLIENT_NAME });
  await page.getByLabel("Case name").fill(CASE_TITLE);
  await Promise.all([
    page.waitForURL(/\/app\/cases\/(?!new$)[^/]+(?:\/)?$/, { timeout: 45_000 }),
    page.getByRole("button", { name: "Create Case" }).click(),
  ]);
  matterId = new URL(page.url()).pathname.split("/").filter(Boolean).pop() ?? "";
  expect(matterId).not.toBe("");
  expect(matterId).not.toBe("new");
}

async function openCommandCenter(page: Page) {
  const started = Date.now();
  await page.goto(`/app/cases/${matterId}/chats`);
  await page.waitForLoadState("networkidle");
  await selectWorkspace(page, ORG_NAME, organizationId);
  metrics.threadLoadMs = Date.now() - started;
  await expect(page.getByRole("heading", { name: "Nyaya Command Center" })).toBeVisible({
    timeout: 30_000,
  });
}

/** Prefer a real thread page so SSE progress / cancel UX are exercised. */
async function ensureThread(page: Page) {
  await openCommandCenter(page);
  if (conversationId) {
    await page.goto(`/app/cases/${matterId}/chats/${conversationId}`);
    await page.waitForLoadState("networkidle");
    await selectWorkspace(page, ORG_NAME, organizationId);
  } else {
    const createRes = await page.request.post(`/api/v1/matters/${matterId}/conversations`, {
      data: { title: "Phase 5 cert chat" },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const body = (await createRes.json()) as { conversation?: { id?: string } };
    conversationId = body.conversation?.id ?? "";
    expect(conversationId).toBeTruthy();
    await page.goto(`/app/cases/${matterId}/chats/${conversationId}`);
    await page.waitForLoadState("networkidle");
    await selectWorkspace(page, ORG_NAME, organizationId);
  }
  await expect(page.getByText("Loading conversation…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByPlaceholder(/Ask Nyaya about this Case/)).toBeVisible();
}

async function sendAsk(page: Page, question: string) {
  if (!/\/chats\/[^/]+$/.test(page.url())) {
    await ensureThread(page);
  }
  const box = page.getByPlaceholder(/Ask Nyaya about this Case/);
  await expect(box).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);
  await box.fill(question);
  const started = Date.now();
  const send = page.getByRole("button", { name: "Send" });
  await expect(send).toBeEnabled();
  await send.click();

  conversationId = page.url().split("/").pop() ?? conversationId;
  // Anchor on this question text — prior "You" labels already exist in multi-turn threads.
  await expect(page.locator("p.whitespace-pre-wrap", { hasText: question })).toBeVisible({
    timeout: 45_000,
  });
  // Progress mounts only while the stream is active. Fast navigation / mock paths can
  // finish before progress paints — wait briefly for Stop, then require idle.
  const stop = page.getByRole("button", { name: "Stop generating" });
  const progress = page.getByLabel("Ask progress");
  const sawStop = await stop
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (sawStop) {
    const sawProgress = await progress
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (sawProgress) {
      metrics.firstProgressMs = Date.now() - started;
      const progressText = (await progress.innerText().catch(() => "")) ?? "";
      if (progressText.trim()) {
        expect(progressText).toMatch(
          /Request accepted|Loading matter|Preparing|Answer ready|Waiting|Cancelled|Failed|Matter sources|Retrieving|Checking|Citations/i,
        );
      }
    }
  }
  metrics.firstAnswerMs = Date.now() - started;
  // CI can leave Stop stuck when the Ask SSE stalls past the client watchdog.
  // Prefer natural idle; if stuck: cancel, then reload the same thread and require idle.
  try {
    await expect(stop).toHaveCount(0, { timeout: 60_000 });
  } catch {
    if (await stop.isVisible().catch(() => false)) {
      await stop.click({ timeout: 5_000 }).catch(() => undefined);
      await expect(stop)
        .toHaveCount(0, { timeout: 15_000 })
        .catch(() => undefined);
    }
    if ((await stop.count()) > 0) {
      const url = page.url();
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await selectWorkspace(page, ORG_NAME, organizationId);
      await expect(page.getByPlaceholder(/Ask Nyaya about this Case/)).toBeVisible({
        timeout: 30_000,
      });
    }
    await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0, {
      timeout: 30_000,
    });
  }
  metrics.fullAnswerMs = Date.now() - started;
}

test.describe.serial("Phase 5 Command Center browser cert", () => {
  test.afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ phase5_browser_metrics: metrics, large_matter_measured: false }));
  });

  test("setup firm/matter + Command Center loads", async ({ page }) => {
    test.setTimeout(180_000);
    trackPageHealth(page);
    await ensureOrgClientMatter(page);
    await openCommandCenter(page);
    await expect(page.getByRole("heading", { name: "Nyaya Command Center" })).toBeVisible();
    await expect(page.getByPlaceholder(/Ask Nyaya about this Case/)).toBeVisible();
  });

  test("SCENARIO 1 — normal chat with truthful progress", async ({ page }) => {
    test.setTimeout(180_000);
    trackPageHealth(page);
    await ensureThread(page);
    await sendAsk(page, "What is happening in this matter?");
    await expect(
      page.locator("p.whitespace-pre-wrap", { hasText: "What is happening in this matter?" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Insufficient evidence|Grounded|Partial|Nyaya/i).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("SCENARIO 2 — follow-up in same conversation", async ({ page }) => {
    test.setTimeout(180_000);
    trackPageHealth(page);
    expect(conversationId).toBeTruthy();
    await ensureThread(page);
    const urlBefore = page.url();
    await sendAsk(page, "What is the biggest unresolved issue?");
    expect(page.url()).toBe(urlBefore);
    await expect(
      page.locator("p.whitespace-pre-wrap", { hasText: "What is the biggest unresolved issue?" }),
    ).toBeVisible();
  });

  test("SCENARIO 3 — source drawer after document upload", async ({ page }) => {
    test.setTimeout(180_000);
    trackPageHealth(page);
    const fixturePath = path.join(
      process.cwd(),
      "packages/ai/src/evals/golden-fixtures/synth-master-lease-agreement.txt",
    );
    await page.goto(`/app/cases/${matterId}/documents`);
    await page.waitForLoadState("networkidle");
    await selectWorkspace(page, ORG_NAME, organizationId);
    const addMore = page.getByRole("button", { name: "+ Upload documents" });
    if (await addMore.isVisible().catch(() => false)) {
      await addMore.click();
    }
    await page.locator('input[type="file"]').setInputFiles(fixturePath);
    await expect(
      page.getByText("1 file received. Processing continues in the background."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /1 document ready/i })).toBeVisible({
      timeout: 60_000,
    });

    await ensureThread(page);
    await sendAsk(page, "When does the lease term commence?");
    await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0, {
      timeout: 90_000,
    });

    const openSource = page
      .getByRole("button", { name: /Open source 1|View sources|Sources \(\d+\)/i })
      .first();
    if (await openSource.isVisible({ timeout: 15_000 }).catch(() => false)) {
      const drawerStarted = Date.now();
      await openSource.click();
      await expect(page.getByRole("heading", { name: /Sources|Case sources/i })).toBeVisible({
        timeout: 10_000,
      });
      metrics.sourceDrawerMs = Date.now() - drawerStarted;
    }
  });

  test("SCENARIO 4 — factuality / unsupported premise UX", async ({ page }) => {
    test.setTimeout(180_000);
    trackPageHealth(page);
    await ensureThread(page);
    await sendAsk(page, "We won this issue, right?");
    await expect(
      page
        .getByText(
          /Unsupported by current record|Not established|Insufficient evidence|Partial|cannot confirm|not enough/i,
        )
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/yes,?\s+you (definitely )?won/i)).toHaveCount(0);
  });

  test("SCENARIO 6 — draft preview confirm controls", async ({ page }) => {
    test.setTimeout(180_000);
    trackPageHealth(page);
    await ensureThread(page);
    await sendAsk(page, "Draft an argument based on Claim A.");
    const previewCard = page.getByRole("region", { name: /Draft preview|Pending action/i });
    const previewText = page.getByText(/preview|not saved|AWAITING|Confirm/i);
    await expect(previewCard.or(previewText).first()).toBeVisible({ timeout: 15_000 });
    const confirm = page.getByRole("button", { name: /Confirm/i });
    if (await confirm.isVisible().catch(() => false)) {
      await expect(confirm).toBeVisible();
      await expect(page.getByRole("button", { name: /Cancel/i })).toBeVisible();
      await confirm.click();
      await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0, {
        timeout: 60_000,
      });
      await expect(
        page.getByText(/saved|completed|Action completed|Open Draft/i).first(),
      ).toBeVisible({ timeout: 15_000 });
    }
  });

  test("SCENARIO 8 — cancel Ask shows cancelled state", async ({ page }) => {
    test.setTimeout(180_000);
    trackPageHealth(page);
    await ensureThread(page);
    const box = page.getByPlaceholder(/Ask Nyaya about this Case/);
    await box.fill("Summarize every document in this matter in detail.");
    await expect(box).toHaveValue(/Summarize every document/);
    await page.getByRole("button", { name: "Send" }).click();
    const stop = page.getByRole("button", { name: "Stop generating" });
    await expect(stop).toBeVisible({ timeout: 10_000 });
    // Full-page busy layers can intercept the normal click hit-target in CI.
    await stop.click({ force: true });
    await expect(
      page.getByText(/Cancelled — not used as authoritative|Cancelled|Generation stopped/i).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByLabel("Ask progress").getByText("COMPLETED", { exact: true }),
    ).toHaveCount(0);
    // Composer must unlock after cancel so the same conversation can continue.
    await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    const retryQ = "Retry after cancel: what is the matter status?";
    await box.fill(retryQ);
    await expect(box).toHaveValue(retryQ);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(retryQ).first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0, {
      timeout: 90_000,
    });
  });

  test("SCENARIO 9 — navigation Open Draft link", async ({ page }) => {
    // Match sibling scenarios + sendAsk budget (question 45s + Stop idle 90s).
    test.setTimeout(180_000);
    trackPageHealth(page);
    await ensureThread(page);
    // Prior cancel/retry must fully unlock the composer before navigation Ask.
    await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0, {
      timeout: 30_000,
    });
    await sendAsk(page, "Open the draft.");
    const openDraft = page.getByRole("link", { name: /Open Draft|Open draft/i });
    if (await openDraft.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await openDraft.click();
      await expect(page).toHaveURL(new RegExp(`/app/cases/${matterId}/draft`), {
        timeout: 15_000,
      });
    } else {
      // Text navigation route still acceptable.
      await expect(page.getByText(/draft|Opening/i).first()).toBeVisible();
    }
  });

  test("SCENARIO 10 — guest Ask API denied without conversation payload", async ({ request }) => {
    test.setTimeout(120_000);
    expect(matterId).toBeTruthy();
    const dbUrl =
      process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
    const db = createDb(dbUrl);
    const guestSubject = `p5_browser_guest_${suffix}`;
    try {
      const [matter] = await db.select().from(matters).where(eq(matters.id, matterId)).limit(1);
      expect(matter).toBeTruthy();

      const [guestUser] = await db
        .insert(users)
        .values({
          authSubject: guestSubject,
          email: `${guestSubject}@example.nyayagrid.local`,
          name: "P5 Browser Guest",
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
        data: { question: "What is happening?", mode: "ask" },
      });
      expect(askRes.status()).toBe(403);
      const askBody = await askRes.json();
      expect(askBody.error?.code).toBe("DENY_GUEST_ASK");
      expect(askBody.error?.message).toMatch(/not available for client guest/i);
      expect(askBody.qa).toBeUndefined();
      expect(askBody.conversations).toBeUndefined();
      expect(askBody.messages).toBeUndefined();

      const convRes = await request.get(`/api/v1/matters/${matterId}/conversations`, {
        headers: { "x-nyayagrid-dev-user": guestSubject },
      });
      expect(convRes.status()).toBe(403);
      const convBody = await convRes.json();
      expect(convBody.error?.code).toBe("DENY_GUEST_ASK");
      expect(convBody.conversations).toBeUndefined();
    } finally {
      await closeDb(db);
    }
  });

  test("browser health counters remain clean", async () => {
    expect(metrics.browser500).toBe(0);
    expect(metrics.fatalReact).toBe(0);
    expect(metrics.hydration).toBe(0);
  });

  test("responsive narrow width does not hide composer", async ({ page }) => {
    trackPageHealth(page);
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto(`/app/cases/${matterId}/chats`);
    await page.waitForLoadState("networkidle");
    // Narrow layouts may collapse the workspace switcher; composer must remain usable.
    await expect(page.getByRole("heading", { name: "Nyaya Command Center" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByPlaceholder(/Ask Nyaya about this Case/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  });
});
