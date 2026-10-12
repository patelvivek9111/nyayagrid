import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { continueHref, genericAskRedirect, isClientGuestRole } from "./first-run";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("client guest portal navigation policy", () => {
  it("keeps client_guest portal-only (no professional workspace access)", () => {
    expect(isClientGuestRole("client_guest")).toBe(true);
    expect(isClientGuestRole("lawyer")).toBe(false);
    expect(
      continueHref({
        organizationCount: 1,
        caseCount: 1,
        canCreateMatter: false,
        roleKey: "client_guest",
      }),
    ).toBe("/portal");
    expect(
      genericAskRedirect({
        organizationCount: 1,
        roleKey: "client_guest",
      }),
    ).toBe("/portal");
    expect(
      genericAskRedirect({
        organizationCount: 1,
        roleKey: "lawyer",
      }),
    ).toBeNull();
  });

  it("portal does not offer a clickable Professional escape hatch for guests", () => {
    const portal = src("src/app/portal/page.tsx");
    expect(portal).toContain("isClientGuestRole");
    expect(portal).toContain("showProfessionalLink");
    expect(portal).toContain("Professional workspace unavailable");
    expect(portal).toContain("Ask about this case (optional)");
    expect(portal).toContain("you do not need it to continue");
    // Professional link remains for non-guest visitors of /portal only.
    expect(portal).toContain('href="/app"');
    expect(portal).toContain("!guestPortalOnly");
  });

  it("professional /app shell redirects guests without rendering firm chrome", () => {
    const layout = src("src/app/app/layout.tsx");
    const shell = src("src/components/client-guest-app-shell.tsx");
    expect(layout).toContain("ClientGuestAppShell");
    expect(shell).toContain('router.replace("/portal")');
    expect(shell).toContain("Opening your client portal");
    expect(shell).toContain("not available for client guest access");
    expect(shell).toContain("isClientGuestRole");
    expect(shell).toContain("GlobalSidebar");
  });

  it("M — Ask and conversation APIs deny client_guest at server level", () => {
    const ask = src("src/app/api/v1/matters/[matterId]/ask/route.ts");
    const chats = src("src/app/api/v1/matters/[matterId]/conversations/route.ts");
    const thread = src(
      "src/app/api/v1/matters/[matterId]/conversations/[conversationId]/route.ts",
    );
    expect(ask).toContain("assertProfessionalCommandCenterAccess");
    expect(chats).toContain("assertProfessionalCommandCenterAccess");
    expect(thread).toContain("assertProfessionalCommandCenterAccess");
  });

  it("cases routes still bounce guests to portal", () => {
    const cases = src("src/app/app/cases/page.tsx");
    const newCase = src("src/app/app/cases/new/page.tsx");
    expect(cases).toContain('router.replace("/portal")');
    expect(newCase).toContain('router.replace("/portal")');
  });
});
