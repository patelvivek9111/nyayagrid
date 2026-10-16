import { randomUUID } from "node:crypto";
import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  closeDb,
  createDb,
  documentChunks,
  documentVersions,
  documents,
  graphNodes,
  users,
} from "@nyayagrid/database";
import { selectWorkspace } from "./select-workspace";

/**
 * Week 3 Slice 2 — Graph relevance + coverage honesty browser certification.
 * CourtListener: 0. Shared schema: none. Local product DB only.
 */
const suffix = Date.now().toString(36);
const ORG_NAME = `W3S2 Graph Firm ${suffix}`;
const ORG_SLUG = `w3s2-graph-firm-${suffix}`;
const CLIENT_NAME = `W3S2 Graph Client ${suffix}`;
const SMALL_CASE = `W3S2 Small Graph ${suffix}`;
const LARGE_CASE = `W3S2 Large Graph ${suffix}`;

let organizationId = "";
let smallMatterId = "";
let largeMatterId = "";
let largeFocusNodeId = "";

const metrics = {
  browser500: 0,
  fatalReact: 0,
  hydration: 0,
  consoleErrors: 0,
  securityErrors: 0,
};

function trackPageHealth(page: Page) {
  page.on("response", (res) => {
    if (res.status() >= 500) metrics.browser500 += 1;
  });
  page.on("console", (msg: ConsoleMessage) => {
    const text = msg.text();
    if (msg.type() === "error") {
      // Ignore Next.js / Chrome noise that is not product-attributable.
      if (/Download the React DevTools|favicon|net::ERR_FAILED/i.test(text)) return;
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

async function clickOverflowAction(page: Page, menuLabel: string, actionName: string) {
  const menu = page.locator("details").filter({
    has: page.locator("summary", { hasText: menuLabel }),
  });
  const action = menu.getByRole("button", { name: actionName, exact: true });
  if (!(await action.isVisible().catch(() => false))) {
    await menu.locator("summary").click();
  }
  await expect(action).toBeVisible();
  await action.click();
}

async function activateOrgAndOpenGraph(page: Page, matterId: string) {
  await page.goto("/app/cases");
  await page.evaluate((orgId) => {
    localStorage.setItem("nyayagrid.activeOrganizationId", orgId);
  }, organizationId);
  await selectWorkspace(page, ORG_NAME);
  await page.goto(`/app/cases/${matterId}/graph`);
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("heading", { name: "Graph", exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Loading case connections…")).toHaveCount(0, { timeout: 60_000 });
}

async function seedGraphFixture(params: {
  organizationId: string;
  matterId: string;
  userId: string;
  mode: "small" | "large";
}): Promise<{ focusNodeId?: string }> {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  try {
    if (params.mode === "small") {
      const [doc] = await db
        .insert(documents)
        .values({
          organizationId: params.organizationId,
          matterId: params.matterId,
          title: "Small Graph Memo",
          createdByUserId: params.userId,
        })
        .returning();
      const [version] = await db
        .insert(documentVersions)
        .values({
          organizationId: params.organizationId,
          documentId: doc!.id,
          versionNumber: 1,
          storageKey: `w3s2-e2e/${params.matterId}/${doc!.id}/v1`,
          contentType: "text/plain",
          byteSize: 32,
          sha256: `sha-e2e-small-${params.matterId}`,
          originalFilename: "small.txt",
          uploadedByUserId: params.userId,
        })
        .returning();
      await db.insert(documentChunks).values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        documentId: doc!.id,
        documentVersionId: version!.id,
        chunkIndex: 0,
        content: "Alice works with Acme.",
      });
      await db.insert(graphNodes).values([
        {
          organizationId: params.organizationId,
          matterId: params.matterId,
          nodeType: "person",
          canonicalEntityType: "matter_entity",
          canonicalEntityId: randomUUID(),
          displayName: "Alice",
          status: "approved",
          origin: "manual",
          createdByUserId: params.userId,
        },
        {
          organizationId: params.organizationId,
          matterId: params.matterId,
          nodeType: "organization",
          canonicalEntityType: "matter_entity",
          canonicalEntityId: randomUUID(),
          displayName: "Acme",
          status: "approved",
          origin: "manual",
          createdByUserId: params.userId,
        },
        {
          organizationId: params.organizationId,
          matterId: params.matterId,
          nodeType: "document",
          canonicalEntityType: "document",
          canonicalEntityId: doc!.id,
          displayName: "Small Graph Memo",
          status: "approved",
          origin: "manual",
          createdByUserId: params.userId,
        },
      ]);
      return {};
    }

    const filler = Array.from({ length: 50 }, (_, i) => ({
      organizationId: params.organizationId,
      matterId: params.matterId,
      nodeType: "other" as const,
      canonicalEntityType: "synthetic_other",
      canonicalEntityId: randomUUID(),
      displayName: `Filler ${i}`,
      status: "approved" as const,
      origin: "manual" as const,
      createdByUserId: params.userId,
    }));
    await db.insert(graphNodes).values(filler);

    const personId = randomUUID();
    const inserted = await db
      .insert(graphNodes)
      .values([
        {
          organizationId: params.organizationId,
          matterId: params.matterId,
          nodeType: "claim",
          canonicalEntityType: "civil_claim",
          canonicalEntityId: randomUUID(),
          displayName: "Browser Claim",
          status: "approved",
          origin: "manual",
          createdByUserId: params.userId,
        },
        {
          organizationId: params.organizationId,
          matterId: params.matterId,
          nodeType: "person",
          canonicalEntityType: "matter_entity",
          canonicalEntityId: personId,
          displayName: "Focus Person",
          status: "approved",
          origin: "manual",
          createdByUserId: params.userId,
        },
        {
          organizationId: params.organizationId,
          matterId: params.matterId,
          nodeType: "defense",
          canonicalEntityType: "civil_defense",
          canonicalEntityId: randomUUID(),
          displayName: "Browser Defense",
          status: "approved",
          origin: "manual",
          createdByUserId: params.userId,
        },
      ])
      .returning();

    // Enough chunks to truncate.
    for (let d = 0; d < 40; d++) {
      const [doc] = await db
        .insert(documents)
        .values({
          organizationId: params.organizationId,
          matterId: params.matterId,
          title: `Large Doc ${d}`,
          createdByUserId: params.userId,
        })
        .returning();
      const [version] = await db
        .insert(documentVersions)
        .values({
          organizationId: params.organizationId,
          documentId: doc!.id,
          versionNumber: 1,
          storageKey: `w3s2-e2e/${params.matterId}/${doc!.id}/v1`,
          contentType: "text/plain",
          byteSize: 32,
          sha256: `sha-e2e-large-${params.matterId}-${d}`,
          originalFilename: `large-${d}.txt`,
          uploadedByUserId: params.userId,
        })
        .returning();
      await db.insert(documentChunks).values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        documentId: doc!.id,
        documentVersionId: version!.id,
        chunkIndex: 0,
        content: `Chunk for large doc ${d}`,
      });
      await db.insert(graphNodes).values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        nodeType: "document",
        canonicalEntityType: "document",
        canonicalEntityId: doc!.id,
        displayName: `Large Doc ${d}`,
        status: "approved",
        origin: "manual",
        createdByUserId: params.userId,
      });
    }

    return {
      focusNodeId: inserted.find((n) => n.canonicalEntityId === personId)?.id,
    };
  } finally {
    await closeDb(db);
  }
}

test.describe.serial("Week 3 Slice 2 Graph relevance browser cert", () => {
  test.afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ w3s2_graph_browser_metrics: metrics, courtlistener: 0 }));
  });

  test("setup org, matters, and graph fixtures", async ({ page }) => {
    test.setTimeout(180_000);
    trackPageHealth(page);

    await page.goto("/app");
    await expect(
      page.getByRole("heading", { name: /What can Nyaya help you with/i }),
    ).toBeVisible({ timeout: 30_000 });

    const orgRes = await page.request.post("/api/v1/organizations", {
      data: { name: ORG_NAME, slug: ORG_SLUG, type: "firm" },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    organizationId = (await orgRes.json()).organization.id as string;

    const meRes = await page.request.get("/api/v1/me");
    expect(meRes.ok()).toBeTruthy();
    const me = await meRes.json();
    const email = (me.email as string) || "owner@example.nyayagrid.local";
    const lookupDb = createDb(
      process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
    );
    let userId = "";
    try {
      const [row] = await lookupDb
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      userId = row?.id ?? "";
    } finally {
      await closeDb(lookupDb);
    }
    expect(userId).toBeTruthy();

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

    const smallRes = await page.request.post("/api/v1/matters", {
      data: {
        organizationId,
        clientId,
        title: SMALL_CASE,
        matterNumber: `S-${suffix}`,
        status: "open",
      },
    });
    expect(smallRes.ok(), await smallRes.text()).toBeTruthy();
    smallMatterId = (await smallRes.json()).matter.id as string;

    const largeRes = await page.request.post("/api/v1/matters", {
      data: {
        organizationId,
        clientId,
        title: LARGE_CASE,
        matterNumber: `L-${suffix}`,
        status: "open",
      },
    });
    expect(largeRes.ok(), await largeRes.text()).toBeTruthy();
    largeMatterId = (await largeRes.json()).matter.id as string;

    await seedGraphFixture({
      organizationId,
      matterId: smallMatterId,
      userId,
      mode: "small",
    });
    const largeSeed = await seedGraphFixture({
      organizationId,
      matterId: largeMatterId,
      userId,
      mode: "large",
    });
    largeFocusNodeId = largeSeed.focusNodeId ?? "";
    expect(largeFocusNodeId).toBeTruthy();

    await page.goto("/app/cases");
    await page.evaluate((orgId) => {
      localStorage.setItem("nyayagrid.activeOrganizationId", orgId);
    }, organizationId);
    await page.reload();
    await selectWorkspace(page, ORG_NAME);
  });

  test("small matter: Graph load, extract, no coverage notice", async ({ page }) => {
    test.setTimeout(120_000);
    trackPageHealth(page);
    await activateOrgAndOpenGraph(page, smallMatterId);

    const extractWait = page.waitForResponse(
      (res) => res.url().includes("/graph/extract") && res.request().method() === "POST",
    );
    await clickOverflowAction(page, "Update graph", "Suggest connections");
    const extractRes = await extractWait;
    expect(extractRes.ok(), `extract ${extractRes.status()}`).toBeTruthy();
    const body = await extractRes.json();
    expect(body.coverage?.coverageLimited).toBe(false);
    expect(body.coverage?.truncated).toBe(false);
    await expect(page.getByTestId("graph-coverage-notice")).toHaveCount(0);
  });

  test("large matter: whole-matter extract shows coverage notice", async ({ page }) => {
    test.setTimeout(120_000);
    trackPageHealth(page);
    await activateOrgAndOpenGraph(page, largeMatterId);

    const extractWait = page.waitForResponse(
      (res) => res.url().includes("/graph/extract") && res.request().method() === "POST",
    );
    await clickOverflowAction(page, "Update graph", "Suggest connections");
    const extractRes = await extractWait;
    expect(extractRes.ok()).toBeTruthy();
    const body = await extractRes.json();
    expect(body.coverage?.selectionMode).toBe("WHOLE_MATTER");
    expect(body.coverage?.coverageLimited).toBe(true);
    await expect(page.getByTestId("graph-coverage-notice")).toBeVisible();
    await expect(page.getByTestId("graph-coverage-notice")).toContainText(
      "relevance-ranked bounded subset",
    );
  });

  test("large matter: focused extract when a node is selected", async ({ page }) => {
    test.setTimeout(120_000);
    trackPageHealth(page);
    await activateOrgAndOpenGraph(page, largeMatterId);

    const focusNode = page.locator(`[data-node-id="${largeFocusNodeId}"]`);
    const anyNode = page.locator("[data-node-id]").first();
    if (await focusNode.isVisible({ timeout: 15_000 }).catch(() => false)) {
      await focusNode.click();
    } else {
      await expect(anyNode).toBeVisible({ timeout: 30_000 });
      await anyNode.click();
    }

    const extractWait = page.waitForResponse(
      (res) => res.url().includes("/graph/extract") && res.request().method() === "POST",
    );
    await clickOverflowAction(page, "Update graph", "Suggest connections");
    const extractRes = await extractWait;
    expect(extractRes.ok()).toBeTruthy();
    const reqBody = extractRes.request().postDataJSON() as { focusNodeId?: string } | null;
    expect(reqBody?.focusNodeId).toBeTruthy();
    const body = await extractRes.json();
    expect(body.coverage?.selectionMode).toBe("FOCUSED");
    expect(body.coverage?.selectedNodeIds?.[0]).toBe(reqBody!.focusNodeId);

    await page.getByRole("button", { name: "Connections", exact: true }).click();
    const proposed = page.getByRole("list", { name: "Proposed graph edges" });
    await expect(proposed).toBeVisible();
    const suggestedItems = proposed.locator("li").filter({ hasNotText: "No suggested connections" });
    if ((await suggestedItems.count()) > 0) {
      await suggestedItems.first().click();
      const inspect = page.getByRole("button", { name: /View source/i });
      const noSources = page.getByText(
        /cannot confirm this connection until it points to a quote/i,
      );
      await expect(inspect.or(noSources).first()).toBeVisible();
    }

    expect(metrics.browser500).toBe(0);
    expect(metrics.fatalReact).toBe(0);
    expect(metrics.hydration).toBe(0);
    expect(metrics.securityErrors).toBe(0);
  });
});
