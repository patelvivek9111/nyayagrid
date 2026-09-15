import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLERK_SESSION_KEEPALIVE_MS,
  interpretClerkKeepAliveResponse,
} from "./clerk-session-keepalive";

describe("Clerk session keep-alive", () => {
  it("refreshes more often than a 60s Clerk JWT", () => {
    expect(CLERK_SESSION_KEEPALIVE_MS).toBeLessThan(60_000);
    expect(CLERK_SESSION_KEEPALIVE_MS).toBeGreaterThan(15_000);
  });

  it("reloads on handshake instead of treating it as a signed-out session", () => {
    expect(interpretClerkKeepAliveResponse({ ok: true })).toBe("ok");
    expect(interpretClerkKeepAliveResponse({ ok: false, errorCode: "CLERK_HANDSHAKE" })).toBe(
      "handshake",
    );
    expect(interpretClerkKeepAliveResponse({ ok: false, errorCode: "UNAUTHENTICATED" })).toBe(
      "signed-out",
    );
  });

  it("is wired into the professional shell and does not log tokens", () => {
    const layout = readFileSync(resolve(__dirname, "../app/app/layout.tsx"), "utf8");
    const keepAlive = readFileSync(resolve(__dirname, "../components/clerk-session-keep-alive.tsx"), "utf8");
    const ask = readFileSync(resolve(__dirname, "../app/app/page.tsx"), "utf8");
    expect(layout).toContain("ClerkSessionKeepAlive");
    expect(ask).toContain("refreshClerkSessionKeepAlive");
    expect(keepAlive).not.toContain("console.log");
    expect(keepAlive).not.toContain("console.error");
  });
});
