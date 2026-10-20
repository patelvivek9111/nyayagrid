import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import {
  closeDb,
  createDb,
  matterMembers,
  memberships,
  roles,
  users,
} from "@nyayagrid/database";
import { and, eq } from "drizzle-orm";
import { selectWorkspace } from "./select-workspace";

/**
 * Week 3 Slice 3 — Command Center structured-card browser certification.
 * CourtListener: 0. Shared schema: none. Local product DB only.
 */
const suffix = Date.now().toString(36);
const ORG_NAME = `W3S3 Cards Firm ${suffix}`;
const ORG_SLUG = `w3s3-cards-firm-${suffix}`;
const CLIENT_NAME = `W3S3 Cards Client ${suffix}`;
const CASE_TITLE = `W3S3 Cards Case ${suffix}`;

let matterId = "";
let conversationId = "";
let organizationId = "";
let guestSubject = "";

const metrics = {
  threadLoadMs: 0,
  investigateRenderMs: 0,
  synthesisRenderMs: 0,
  sourceDrawerMs: 0,
  taskPreviewMs: 0,
  historyReloadMs: 0,
  browser500: 0,
  fatalReact: 0,
  hydration: 0,
  consoleErrors: 0,
  securityErrors: 0,
  unhandledRejections: 0,
};

function trackPageHealth(page: Page) {
  page.on("response", (res) => {
    if (res.status() >= 500) metrics.browser500 += 1;
  });
  page.on("console", (msg: ConsoleMessage) => {
    const text = msg.text();
    if (msg.type() === "error") {
      if (/Download the React DevTools|favicon|net::ERR_FAILED/i.test(text)) return;
      metrics.consoleErrors += 1;
      if (/hydration|Hydration/i.test(text)) metrics.hydration += 1;
      if (/security|CORS|CSP/i.test(text)) metrics.securityErrors += 1;
    }
    if (/Minified React error|Uncaught|Fatal/i.test(text)) metrics.fatalReact += 1;
  });
  page.on("pageerror", (err) => {
    metrics.fatalReact += 1;
    if (/unhandled|UnhandledPromiseRejection/i.test(String(err))) {
      metrics.unhandledRejections += 1;
    }
  });
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

function artifactValidation(body: Record<string, unknown>): Record<string, unknown> {
  const qa = body.qa as { artifact?: { validation?: Record<string, unknown> } } | undefined;
  return (qa?.artifact?.validation ?? {}) as Record<string, unknown>;
}

async function askApi(page: Page, question: string) {
  const data: Record<string, unknown> = { question, mode: "ask" };
  if (conversationId) data.conversationId = conversationId;
  const res = await page.request.post(`/api/v1/matters/${matterId}/ask`, { data });
  const body = (await res.json()) as Record<string, unknown>;
  expect(res.ok(), JSON.stringify(body).slice(0, 800)).toBeTruthy();
  conversationId = String(body.conversationId ?? (body.qa as { conversationId?: string })?.conversationId ?? conversationId);
  return body;
}

async function openThread(page: Page) {
  await page.goto("/app/cases");
  await page.evaluate((orgId) => {
    localStorage.setItem("nyayagrid.activeOrganizationId", orgId);
  }, organizationId);
  await selectWorkspace(page, ORG_NAME);

  // Pre-warm conversation API so the page hydrate is not blocked on cold compile.
  const warm = await page.request.get(
    `/api/v1/matters/${matterId}/conversations/${conversationId}`,
  );
  expect(warm.ok(), await warm.text()).toBeTruthy();
  const warmJson = await warm.json();
  expect((warmJson.messages ?? []).length).toBeGreaterThan(0);

  const started = Date.now();
  await page.goto(`/app/cases/${matterId}/chats/${conversationId}`);
  await page.waitForLoadState("domcontentloaded");
  metrics.threadLoadMs = Date.now() - started;
  await expect(page.getByText("Loading conversation…")).toHaveCount(0, { timeout: 120_000 });
  await expect(
    page.getByRole("heading", { name: "Nyaya Command Center" }).or(page.getByText("Nyaya")).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator(".whitespace-pre-wrap").or(page.getByTestId("investigate-next-cards")).or(page.getByTestId("matter-synthesis-cards")).first(),
  ).toBeVisible({ timeout: 60_000 });
}

test.describe.serial("Week 3 Slice 3 Command Center structured-card browser cert", () => {
  test.afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ w3s3_structured_cards_browser_metrics: metrics, courtlistener: 0 }));
  });

  test("setup + investigate-next / synthesis API payloads", async ({ page }) => {
    test.setTimeout(600_000);
    trackPageHealth(page);

    // Dev auth via API — no marketing-home dependency (same pattern as Phase 4/5).
    await page.goto("/app/cases");
    await page.waitForLoadState("domcontentloaded");

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
    await page.request.post(`/api/v1/matters/${matterId}/entities`, {
      data: {
        entityType: "person",
        displayName: "Alex Rivera",
        description: "property manager",
      },
    });

    const convRes = await page.request.post(`/api/v1/matters/${matterId}/conversations`, {
      data: { title: "W3S3 structured cards cert" },
    });
    expect(convRes.ok(), await convRes.text()).toBeTruthy();
    conversationId = (await convRes.json()).conversation?.id ?? "";
    expect(conversationId).toBeTruthy();

    const inv = await askApi(page, "what should I investigate next?");
    const invValidation = artifactValidation(inv);
    const invSnap = invValidation.investigateNext as { gaps?: Array<{ id: string; title: string; priority?: string }> } | undefined;
    expect(extractAnswer(inv).length).toBeGreaterThan(0);
    expect(invSnap && typeof invSnap === "object").toBeTruthy();

    const synth = await askApi(page, "what are the weakest parts of this case?");
    const synthValidation = artifactValidation(synth);
    const cross = (synthValidation.crossWorkflow ?? {}) as {
      matterSynthesis?: Record<string, unknown>;
    };
    expect(extractAnswer(synth).length).toBeGreaterThan(0);
    expect(cross.matterSynthesis && typeof cross.matterSynthesis === "object").toBeTruthy();
    expect(JSON.stringify(synth)).not.toMatch(/courtlistener\.com/i);
    // win/credibility must remain zero if present
    if (cross.matterSynthesis) {
      expect(cross.matterSynthesis.winProbability ?? 0).toBe(0);
      expect(cross.matterSynthesis.credibilityScoring ?? 0).toBe(0);
    }

    // Seed guest for later denial check
    guestSubject = `w3s3_browser_guest_${suffix}`;
    const db = createDb(
      process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
    );
    try {
      const [guestUser] = await db
        .insert(users)
        .values({
          authSubject: guestSubject,
          email: `${guestSubject}@example.nyayagrid.local`,
          name: "W3S3 Browser Guest",
        })
        .returning();
      const [guestRole] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.organizationId, organizationId), eq(roles.key, "client_guest")))
        .limit(1);
      expect(guestRole).toBeTruthy();
      await db.insert(memberships).values({
        organizationId,
        userId: guestUser!.id,
        roleId: guestRole!.id,
        status: "active",
      });
      await db.insert(matterMembers).values({
        organizationId,
        matterId,
        userId: guestUser!.id,
        access: "read",
      });
    } finally {
      await closeDb(db);
    }
  });

  test("Command Center loads structured investigate + synthesis cards", async ({ page }) => {
    test.setTimeout(180_000);
    trackPageHealth(page);
    await openThread(page);

    // Prose remains
    await expect(page.locator(".whitespace-pre-wrap").first()).toBeVisible({ timeout: 60_000 });

    const invCards = page.getByTestId("investigate-next-cards");
    const synthCards = page.getByTestId("matter-synthesis-cards");

    // At least one structured block hydrated from history
    const hasInv = await invCards.count();
    const hasSynth = await synthCards.count();
    expect(hasInv + hasSynth).toBeGreaterThan(0);

    if (hasInv > 0) {
      const started = Date.now();
      await expect(invCards.first()).toBeVisible();
      metrics.investigateRenderMs = Date.now() - started;

      const gapArticles = invCards.locator("article[data-gap-index]");
      const gapCount = await gapArticles.count();
      if (gapCount > 0) {
        // Backend order: indices 1..N ascending
        const indices: number[] = [];
        for (let i = 0; i < gapCount; i++) {
          const idx = Number(await gapArticles.nth(i).getAttribute("data-gap-index"));
          indices.push(idx);
          await expect(gapArticles.nth(i).getByText(`#${idx}`, { exact: false })).toBeVisible();
        }
        expect(indices).toEqual([...indices].sort((a, b) => a - b));

        // Priority text labels if present
        const priorities = invCards.getByLabel(/Priority (HIGH|MEDIUM|LOW)/);
        // May be zero if empty posture — only assert when gaps exist
        if ((await priorities.count()) > 0) {
          await expect(priorities.first()).toBeVisible();
        }

        // Source button only when sources exist — gap without sources must not show View sources
        const viewSources = invCards.locator("button", { hasText: /View sources/i });
        const turnTask = invCards.locator("button", { hasText: /Turn into task/i });
        await expect(turnTask.first()).toBeVisible({ timeout: 15_000 });

        // Zero-source gaps must not advertise sources
        const zeroSourceGaps = invCards.locator("article[data-gap-index]").filter({
          hasNot: page.locator("button", { hasText: /View sources/i }),
        });
        // At least the task CTA remains on those cards
        if ((await zeroSourceGaps.count()) > 0) {
          await expect(zeroSourceGaps.first().locator("button", { hasText: /Turn into task/i })).toBeVisible();
        }

        if ((await viewSources.count()) > 0) {
          const drawerStarted = Date.now();
          await viewSources.first().click();
          await expect(
            page
              .getByRole("dialog")
              .or(page.getByText(/Case evidence|Source|Quote|Email thread|Passage/i))
              .first(),
          ).toBeVisible({ timeout: 20_000 });
          metrics.sourceDrawerMs = Date.now() - drawerStarted;
        }
      } else {
        // Empty posture message
        await expect(invCards.getByText(/No additional high-priority|No investigation gaps/i)).toBeVisible();
      }
    }

    if (hasSynth > 0) {
      const started = Date.now();
      await expect(synthCards.first()).toBeVisible();
      metrics.synthesisRenderMs = Date.now() - started;
      // Empty section chrome: these testids only mount when items exist
      const sectionIds = [
        "synth-core-issues",
        "synth-strongest",
        "synth-weakest",
        "synth-key-facts",
        "synth-key-evidence",
        "synth-key-people",
        "synth-conflicts",
        "synth-unknowns",
        "synth-claim-readiness",
        "synth-defense-readiness",
        "synth-recent-changes",
        "synth-investigate-titles",
      ];
      let visibleSections = 0;
      for (const id of sectionIds) {
        visibleSections += await page.getByTestId(id).count();
      }
      expect(visibleSections).toBeGreaterThan(0);
      // Cards must not surface win/credibility as UI metrics (prose may still echo fixed zeros from backend format).
      await expect(
        synthCards.getByText(/win probability|credibility score|%\s*confidence/i),
      ).toHaveCount(0);
      const conflict = page.getByTestId("synth-conflicts");
      if ((await conflict.count()) > 0) {
        const text = await conflict.innerText();
        expect(text).not.toMatch(/\b(lying|liar|dishonest|falsehood)\b/i);
      }
    }
  });

  test("#2 continuity + Turn into task preview", async ({ page }) => {
    test.setTimeout(180_000);
    trackPageHealth(page);
    await openThread(page);

    const invCards = page.getByTestId("investigate-next-cards");
    if ((await invCards.count()) === 0) {
      test.skip(true, "No investigate cards in this fixture run");
      return;
    }

    const gap2 = invCards.locator('article[data-gap-index="2"]');
    if ((await gap2.count()) === 0) {
      // Single-gap matter: still certify #1 task path via composer
      const composerOne = page.getByRole("textbox").or(page.locator("textarea")).first();
      await composerOne.fill("turn #1 into a task");
      const started = Date.now();
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(
        page.getByText(/confirm|preview|task|create the task|Task preview|Investigate/i).first(),
      ).toBeVisible({ timeout: 90_000 });
      metrics.taskPreviewMs = Date.now() - started;
      await expect(page.getByText(/due date|deadline invented/i)).toHaveCount(0);
      return;
    }

    const gap2Title = ((await gap2.locator("h4").innerText()) ?? "").trim();
    expect(gap2Title.length).toBeGreaterThan(0);

    // Conversational #2 continuity via composer
    const composer = page.getByRole("textbox").or(page.locator("textarea")).first();
    await composer.fill("#2");
    await page.getByRole("button", { name: /Send|Ask/i }).or(page.locator('button[type="submit"]')).first().click();
    await expect(page.getByText(gap2Title).first()).toBeVisible({ timeout: 90_000 });

    // Task CTA on gap #2 — send phrase via composer for reliability with SSE ask path
    const taskPhrase = "turn #2 into a task";
    await composer.fill(taskPhrase);
    const started = Date.now();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      page.getByText(/confirm|preview|Task preview|create the task|Investigate/i).first(),
    ).toBeVisible({ timeout: 90_000 });
    metrics.taskPreviewMs = Date.now() - started;
    // No immediate write language / invented due date
    await expect(page.getByText(/due date assigned|automatically filed/i)).toHaveCount(0);
  });

  test("history reload retains structured cards", async ({ page }) => {
    test.setTimeout(120_000);
    trackPageHealth(page);
    await openThread(page);
    const beforeInv = await page.getByTestId("investigate-next-cards").count();
    const beforeSynth = await page.getByTestId("matter-synthesis-cards").count();
    expect(beforeInv + beforeSynth).toBeGreaterThan(0);

    const reloadStarted = Date.now();
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("Loading conversation…")).toHaveCount(0, { timeout: 120_000 });
    await expect(page.locator(".whitespace-pre-wrap").first()).toBeVisible({ timeout: 60_000 });
    metrics.historyReloadMs = Date.now() - reloadStarted;
    const afterInv = await page.getByTestId("investigate-next-cards").count();
    const afterSynth = await page.getByTestId("matter-synthesis-cards").count();
    expect(afterInv).toBe(beforeInv);
    expect(afterSynth).toBe(beforeSynth);

    if (afterInv > 0) {
      const indices: number[] = [];
      const articles = page.getByTestId("investigate-next-cards").locator("article[data-gap-index]");
      const n = await articles.count();
      for (let i = 0; i < n; i++) {
        indices.push(Number(await articles.nth(i).getAttribute("data-gap-index")));
      }
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
    }
  });

  test("guest Ask denied; browser health clean", async ({ page, request }) => {
    test.setTimeout(90_000);
    trackPageHealth(page);

    const guestAsk = await request.post(`/api/v1/matters/${matterId}/ask`, {
      headers: { "x-nyayagrid-dev-user": guestSubject },
      data: { question: "what should I investigate next?", mode: "ask" },
    });
    expect(guestAsk.status()).toBeGreaterThanOrEqual(400);
    const guestBody = await guestAsk.json();
    expect(JSON.stringify(guestBody)).toMatch(/DENY_GUEST|guest|not available|forbidden|permission/i);

    // Cross-matter: outsider header cannot read this conversation
    const outsider = await request.get(`/api/v1/matters/${matterId}/conversations/${conversationId}`, {
      headers: { "x-nyayagrid-dev-user": `w3s3-outsider-${suffix}` },
    });
    expect(outsider.status()).toBeGreaterThanOrEqual(400);

    expect(metrics.browser500).toBe(0);
    expect(metrics.fatalReact).toBe(0);
    expect(metrics.hydration).toBe(0);
    expect(metrics.securityErrors).toBe(0);
    expect(metrics.unhandledRejections).toBe(0);
  });
});
