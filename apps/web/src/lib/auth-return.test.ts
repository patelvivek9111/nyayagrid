import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  clerkContinueHref,
  clerkHostedSignInUrl,
  clerkSignOutHref,
  inviteAcceptReturnPath,
  isClerkUiConfigured,
  safeAuthReturnTo,
  unauthenticatedProfessionalRedirect,
} from "./auth-return";

describe("safeAuthReturnTo", () => {
  it("allows in-app paths and rejects open redirects", () => {
    expect(safeAuthReturnTo("/app/cases/abc/documents")).toBe("/app/cases/abc/documents");
    expect(safeAuthReturnTo("/invites/accept?token=x")).toBe("/invites/accept?token=x");
    expect(safeAuthReturnTo("https://evil.example/phish")).toBe("/app");
    expect(safeAuthReturnTo("//evil.example")).toBe("/app");
    expect(safeAuthReturnTo("/sign-in")).toBe("/app");
    expect(safeAuthReturnTo("/settings")).toBe("/app");
  });
});

describe("Clerk UI configuration", () => {
  it("requires a publishable key and hosted sign-in URL", () => {
    expect(
      isClerkUiConfigured({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_example",
        NEXT_PUBLIC_CLERK_SIGN_IN_URL: "https://accounts.example.clerk.accounts.dev/sign-in",
      }),
    ).toBe(true);
    expect(
      isClerkUiConfigured({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_example",
        NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
      }),
    ).toBe(false);
    expect(clerkHostedSignInUrl({ NEXT_PUBLIC_CLERK_SIGN_IN_URL: "not a url" })).toBeNull();
  });

  it("builds continue and sign-out URLs without leaking secrets", () => {
    const hosted = "https://accounts.example.clerk.accounts.dev/sign-in";
    const continueHref = clerkContinueHref(hosted, "/app/cases/m1", "https://app.nyayagrid.example");
    expect(continueHref).toContain("redirect_url=");
    expect(decodeURIComponent(continueHref)).toContain("https://app.nyayagrid.example/app/cases/m1");
    expect(continueHref).not.toMatch(/sk_|whsec_/);
    const signOut = clerkSignOutHref(hosted, "https://app.nyayagrid.example");
    expect(signOut).toContain("sign-out");
    expect(signOut).toContain("redirect_url=");
    const explicit = clerkSignOutHref(hosted, "https://nyayagrid-staging.fly.dev", {
      NEXT_PUBLIC_CLERK_SIGN_OUT_URL: "https://ethical-emu-7146.accounts.dev/sign-out",
    });
    expect(explicit.startsWith("https://ethical-emu-7146.accounts.dev/sign-out")).toBe(true);
    expect(decodeURIComponent(explicit)).toContain("https://nyayagrid-staging.fly.dev/sign-in");
  });
});

describe("unauthenticatedProfessionalRedirect", () => {
  it("is a no-op for DevAuth and for a present Clerk session", () => {
    expect(
      unauthenticatedProfessionalRedirect({
        authProvider: "dev",
        sessionPresent: false,
        pathnameWithSearch: "/app/cases",
      }),
    ).toBeNull();
    expect(
      unauthenticatedProfessionalRedirect({
        authProvider: "clerk",
        sessionPresent: true,
        pathnameWithSearch: "/app/cases",
      }),
    ).toBeNull();
  });

  it("sends Clerk-mode visitors to sign-in with a safe returnTo", () => {
    expect(
      unauthenticatedProfessionalRedirect({
        authProvider: "clerk",
        sessionPresent: false,
        pathnameWithSearch: "/app/cases/abc/documents",
      }),
    ).toEqual({ returnTo: "/app/cases/abc/documents", reason: "session" });
    expect(
      unauthenticatedProfessionalRedirect({
        authProvider: "clerk",
        sessionPresent: false,
        pathnameWithSearch: "https://evil.example/phish",
      }),
    ).toEqual({ returnTo: "/app", reason: "session" });
    expect(
      unauthenticatedProfessionalRedirect({
        authProvider: "clerk",
        sessionPresent: false,
        pathnameWithSearch: "/invites/accept?token=invite-example",
      }),
    ).toEqual({ returnTo: "/invites/accept?token=invite-example", reason: "session" });
  });
});

describe("inviteAcceptReturnPath", () => {
  it("resumes acceptance with the invite query and does not invent a token", () => {
    expect(inviteAcceptReturnPath("abc+def")).toBe("/invites/accept?token=abc%2Bdef");
    expect(inviteAcceptReturnPath("  ")).toBe("/invites/accept");
    expect(clerkContinueHref(
      "https://accounts.example.clerk.accounts.dev/sign-in",
      inviteAcceptReturnPath("abc"),
      "https://staging.nyayagrid.com",
    )).toContain("redirect_url=");
    expect(
      decodeURIComponent(
        clerkContinueHref(
          "https://accounts.example.clerk.accounts.dev/sign-in",
          inviteAcceptReturnPath("abc"),
          "https://staging.nyayagrid.com",
        ),
      ),
    ).toContain("https://staging.nyayagrid.com/invites/accept?token=abc");
  });
});

describe("sign-up page is invitation-only", () => {
  it("does not link Clerk hosted public registration", () => {
    const src = readFileSync(resolve(__dirname, "../app/sign-up/page.tsx"), "utf8");
    expect(src).toContain("Invitation only");
    expect(src).toContain("/invites/accept");
    expect(src).not.toContain("clerkHostedSignUpUrl");
    expect(src).not.toContain("Continue");
  });
});

describe("invite accept page resumes after Clerk", () => {
  it("posts the query token after authentication and keeps a 401 returnTo", () => {
    const src = readFileSync(resolve(__dirname, "../app/invites/accept/page.tsx"), "utf8");
    expect(src).toContain("inviteAcceptReturnPath");
    expect(src).toContain('fetch("/api/v1/invites/accept"');
    expect(src).toContain("autoStarted");
    expect(src).toContain("res.status === 401");
    expect(src).not.toContain("requireUser");
  });
});
