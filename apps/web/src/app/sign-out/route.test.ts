import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { clerkCookieExpireSetCookieHeaders } from "../../lib/clerk-sign-out-cookies";

const source = readFileSync(resolve(__dirname, "route.ts"), "utf8");

describe("sign-out", () => {
  it("revokes the Clerk session with the backend SDK and returns to /sign-in", () => {
    expect(source).toContain("authenticateRequest");
    expect(source).toContain("revokeSession");
    expect(source).toContain('"/sign-in"');
    expect(source).not.toContain("console.log");
    expect(source).not.toContain("console.error");
  });

  it("clears Clerk cookie names rather than trusting their values", () => {
    const headers = clerkCookieExpireSetCookieHeaders(
      "__session_abc=VALUE_MUST_NOT_APPEAR; __client_uat=1; ignore=1",
      "staging.nyayagrid.com",
    );
    expect(headers.some((header) => header.startsWith("__session_abc=;"))).toBe(true);
    expect(headers.some((header) => header.startsWith("__client_uat=;"))).toBe(true);
    expect(headers.every((header) => header.includes("Max-Age=0"))).toBe(true);
    expect(headers.some((header) => header.includes("SameSite=None"))).toBe(true);
    expect(headers.some((header) => header.includes("Domain=.nyayagrid.com"))).toBe(true);
    expect(headers.join("\n")).not.toContain("VALUE_MUST_NOT_APPEAR");
    expect(headers.some((header) => header.startsWith("ignore="))).toBe(false);
  });
});
