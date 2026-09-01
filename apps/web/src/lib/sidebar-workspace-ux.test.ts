import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("Sidebar workspace switcher presentation", () => {
  const sidebar = src("src/components/ux/global-sidebar.tsx");
  const orgHook = src("src/components/use-active-organization.tsx");
  const onboarding = src("src/app/app/onboarding/page.tsx");
  const clients = src("src/app/app/clients/page.tsx");
  const calendar = src("src/app/app/calendar/page.tsx");
  const billing = src("src/app/app/billing/page.tsx");
  const casesPage = src("src/app/app/cases/page.tsx");

  it("hides the permanent Firm select; switcher is gated on org count > 1", () => {
    expect(sidebar).toContain("shouldShowWorkspaceSwitcher(organizations.length)");
    expect(sidebar).toContain("showWorkspaceSwitcher && activeOrg");
    expect(sidebar).toContain("Switch workspace");
    expect(sidebar).not.toContain("<select");
    expect(sidebar).toContain("Other workspaces");
    expect(sidebar).toContain('href="/app"');
    expect(sidebar).toContain('href="/app/clients"');
    expect(sidebar).toContain('href="/app/calendar"');
    expect(sidebar).toContain('href="/app/time"');
    expect(sidebar).toContain('href="/app/billing"');
    expect(sidebar).toContain('href="/app/inbox"');
    expect(sidebar).toContain('href="/app/research"');
    expect(sidebar).toContain('href="/app/compliance"');
    expect(sidebar).toContain('href="/app/settings"');
  });

  it("keeps active org in local storage and membership-scoped GET /organizations", () => {
    expect(orgHook).toContain("ACTIVE_ORG_STORAGE_KEY");
    expect(orgHook).toContain("resolveActiveOrganizationId");
    expect(orgHook).toContain('fetch("/api/v1/organizations")');
    expect(orgHook).toContain("selectOrganization");
    const orgsApi = src("src/app/api/v1/organizations/route.ts");
    expect(orgsApi).toContain("eq(memberships.userId, user.id)");
  });

  it("keeps cases, clients, calendar, and billing scoped to organizationId", () => {
    expect(sidebar).toContain("`/api/v1/matters?organizationId=${organizationId}`");
    expect(clients).toContain("`/api/v1/clients?organizationId=${orgId}`");
    expect(calendar).toContain("`/api/v1/calendar?organizationId=${organizationId}`");
    expect(billing).toContain("`/api/v1/invoices?organizationId=${orgId}`");
    expect(casesPage).toContain("organizationId");
  });

  it("preserves no-org onboarding", () => {
    expect(onboarding).toContain("continueHref");
    expect(onboarding).toContain('router.replace("/app/cases/new")');
    expect(onboarding).toContain("selectOrganization");
    expect(onboarding).toContain("organizations.length > 0");
    expect(sidebar).toContain('href="/app/onboarding"');
  });

  it("does not change Agents gating", () => {
    const ask = src("src/app/api/v1/matters/[matterId]/ask/route.ts");
    expect(ask).toContain('isFeatureEnabled("agents")');
    expect(ask).toContain('assertFeatureEnabled("agents")');
  });

  it("keeps the workspace footer with nav instead of stretching with page content", () => {
    const shell = src("src/components/ux/workspace-sidebar.tsx");
    expect(shell).toContain("lg:sticky lg:top-0 lg:self-start");
    expect(shell).toContain("h-screen w-[260px]");
    expect(shell).toContain('data-open={mobileOpen ? "true" : "false"}');
    expect(shell).toContain("{children}");
    expect(shell).toContain(
      '{footer ? <div className="mt-3 border-t border-line px-1 pt-3">{footer}</div> : null}',
    );
    const navBlockStart = shell.indexOf("min-h-0 flex-1 overflow-y-auto");
    const footerInScroll = shell.indexOf("{footer ?", navBlockStart);
    const navBlockParentClose = shell.indexOf("</aside>");
    expect(navBlockStart).toBeGreaterThan(-1);
    expect(footerInScroll).toBeGreaterThan(navBlockStart);
    expect(footerInScroll).toBeLessThan(navBlockParentClose);
  });
});
