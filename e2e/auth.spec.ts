import { test, expect } from "@playwright/test";

/**
 * Auth contract tests. Local DevAuth is not treated as Clerk staging proof.
 * Live Clerk sign-in is skipped unless CLERK_E2E=1 and Clerk keys are present.
 */
test.describe("Auth contract", () => {
  test("sign-in is a NyayaGrid page without developer or DevAuth copy", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/sign-in");
    await expect(page.getByText("NyayaGrid").first()).toBeVisible();
    await expect(page.getByText("Legal intelligence for your practice.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText(/AUTH_PROVIDER|DevAuth|Clerk is not configured/i)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Accept invitation" })).toBeVisible();

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.setViewportSize({ width: 768, height: 900 });
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    );
    expect(overflow).toBe(false);
  });

  test("sign-up is invitation-first and has no developer copy", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
    await expect(page.getByText(/invitation-only/i)).toBeVisible();
    await expect(page.getByText(/AUTH_PROVIDER|NEXT_PUBLIC_CLERK/i)).toHaveCount(0);
  });

  test("invite acceptance is labeled and maps failures without token jargon", async ({ page }) => {
    await page.goto("/invites/accept");
    await expect(page.getByRole("heading", { name: "Accept invitation" })).toBeVisible();
    await expect(page.getByLabel("Invitation")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept invitation" })).toBeVisible();
    await expect(page.getByText(/cannot be recovered/i)).toHaveCount(0);
  });

  test("unauthenticated APIs return 401 with sign-in copy", async ({ request }) => {
    const res = await request.get("/api/v1/organizations", {
      headers: { "x-nyayagrid-dev-user": "anonymous" },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe("UNAUTHENTICATED");
    expect(body.error?.message).toBe("Please sign in to continue.");
  });

  test("session-ended notice is user-facing, not a stack trace", async ({ page }) => {
    await page.goto("/sign-in?reason=session");
    await expect(page.getByText("Your session has ended. Please sign in to continue.")).toBeVisible();
    await expect(page.getByText(/TypeError|CLERK_SECRET|stack/i)).toHaveCount(0);
  });

  test("invalid invitation shows administrator copy", async ({ page }) => {
    await page.goto("/invites/accept");
    await page.getByLabel("Invitation").fill("not-a-real-invitation");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page.locator("#invite-error")).toContainText(/no longer valid/i);
    await expect(page.locator("#invite-error")).toContainText(/administrator/i);
    await expect(page.locator("#invite-error")).not.toContainText(/token/i);
  });

  test("Sign out is reachable and returns to sign-in", async ({ page }) => {
    await page.goto("/app/settings");
    await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("outsider identity cannot read another tenant's case", async ({ request }) => {
    const orgsRes = await request.get("/api/v1/organizations");
    expect(orgsRes.ok()).toBeTruthy();
    const orgs = ((await orgsRes.json()).organizations ?? []) as Array<{ id: string }>;
    test.skip(orgs.length === 0, "no organization for the default identity");
    const mattersRes = await request.get(`/api/v1/matters?organizationId=${orgs[0]!.id}`);
    expect(mattersRes.ok()).toBeTruthy();
    const matters = ((await mattersRes.json()).matters ?? []) as Array<{ id: string; title?: string }>;
    test.skip(matters.length === 0, "no case for cross-org proof");
    const matter = matters[0]!;
    const outsider = { "x-nyayagrid-dev-user": "e2e-auth-outsider" };
    const foreign = await request.get(`/api/v1/matters/${matter.id}`, {
      headers: outsider,
    });
    expect([403, 404]).toContain(foreign.status());
    const body = await foreign.json();
    expect(body.matter).toBeUndefined();
    expect(body.error?.code).not.toBe("UNAUTHENTICATED");
    expect(foreign.status()).not.toBe(500);
    if (foreign.status() === 403) {
      expect(body.error?.message).toBe("You don’t have access to this workspace or case.");
    }
    if (matter.title) expect(JSON.stringify(body)).not.toContain(matter.title);

    const edit = await request.patch(`/api/v1/matters/${matter.id}`, {
      headers: { ...outsider, "Content-Type": "application/json" },
      data: { title: "Should not apply" },
    });
    expect([403, 404]).toContain(edit.status());
    expect(edit.status()).not.toBe(401);
    expect(edit.status()).not.toBe(500);

    const upload = await request.post(`/api/v1/matters/${matter.id}/documents`, {
      headers: outsider,
    });
    expect([403, 404]).toContain(upload.status());
    expect(upload.status()).not.toBe(401);
    expect(upload.status()).not.toBe(500);

    const review = await request.post(
      `/api/v1/matters/${matter.id}/facts/00000000-0000-0000-0000-000000000000/review`,
      {
        headers: { ...outsider, "Content-Type": "application/json" },
        data: { action: "approve" },
      },
    );
    expect([403, 404]).toContain(review.status());
    expect(review.status()).not.toBe(401);
    expect(review.status()).not.toBe(500);
  });
});

test.describe("Clerk live sign-in", () => {
  test.skip(
    !process.env.CLERK_E2E || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Requires Clerk staging credentials (CLERK_E2E=1 plus publishable/secret keys).",
  );

  test("real Clerk session is not faked in this suite", async () => {
    expect(process.env.AUTH_PROVIDER).toBe("clerk");
  });
});
