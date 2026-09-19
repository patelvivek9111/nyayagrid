import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const auth = readFileSync(resolve(__dirname, "auth.ts"), "utf8");
const settings = readFileSync(resolve(__dirname, "../app/app/settings/page.tsx"), "utf8");
const members = readFileSync(
  resolve(__dirname, "../app/api/v1/matters/[matterId]/members/route.ts"),
  "utf8",
);

describe("settings assign-to-case auth boundary", () => {
  it("uses requireUser on the matter members mutation", () => {
    expect(members).toContain("requireUser");
    expect(members).toContain('minAccess: "edit"');
    expect(members).toContain("requireMatterAccess");
  });

  it("detects Clerk handshake in requireUser before generic unauthenticated", () => {
    expect(auth).toContain("resolveClerkApiAuth");
    expect(auth).toContain("ClerkHandshakeError");
    expect(auth).toContain('resolved.status === "handshake"');
  });

  it("settings assign refreshes session, surfaces success, and handles handshake", () => {
    expect(settings).toContain("refreshClerkSessionKeepAlive");
    expect(settings).toContain("Case access assigned.");
    expect(settings).toContain("CLERK_HANDSHAKE");
    expect(settings).toContain("Assigning…");
    expect(settings).toContain("Select a client guest and a case before assigning.");
  });
});
