import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  absoluteInviteResumeUrl,
  clerkContinueHref,
  clerkHostedSignInUrl,
  clerkHostedUserProfileUrl,
  clerkSignOutHref,
  inviteAcceptReturnPath,
  inviteAuthContinueHref,
  inviteReturnCookieValue,
  inviteTokenFromReturnTo,
  isClerkAccountPortalUrl,
  isClerkUiConfigured,
  isSafeInviteResumeUrl,
  safeAuthReturnTo,
  unauthenticatedProfessionalRedirect,
} from "./auth-return";

describe("safeAuthReturnTo", () => {
  it("allows in-app paths and rejects open redirects", () => {
    expect(safeAuthReturnTo("/app/cases/abc/documents")).toBe("/app/cases/abc/documents");
    expect(safeAuthReturnTo("/invites/accept?token=x")).toBe("/invites/accept?token=x");
    expect(safeAuthReturnTo("/invites/resume")).toBe("/invites/resume");
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
    expect(
      clerkHostedUserProfileUrl({
        NEXT_PUBLIC_CLERK_SIGN_IN_URL: "https://accounts.staging.nyayagrid.com/sign-in",
      }),
    ).toBe("https://accounts.staging.nyayagrid.com/user");
  });

  it("builds continue and sign-out URLs without leaking secrets", () => {
    const hosted = "https://accounts.example.clerk.accounts.dev/sign-in";
    const continueHref = clerkContinueHref(hosted, "/app/cases/m1", "https://app.nyayagrid.example");
    expect(continueHref).toContain("redirect_url=");
    expect(continueHref).toContain("sign_up_force_redirect_url=");
    expect(continueHref).toContain("sign_in_force_redirect_url=");
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
    expect(inviteTokenFromReturnTo(inviteAcceptReturnPath("abc+def"))).toBe("abc+def");
    expect(inviteTokenFromReturnTo("/app")).toBeNull();
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
    const resume = absoluteInviteResumeUrl(
      inviteAcceptReturnPath("abc"),
      "https://staging.nyayagrid.com",
    );
    expect(isSafeInviteResumeUrl(resume, "https://staging.nyayagrid.com")).toBe(true);
    expect(isSafeInviteResumeUrl("https://evil.example/invites/accept?token=abc", "https://staging.nyayagrid.com")).toBe(false);
    expect(isSafeInviteResumeUrl("https://staging.nyayagrid.com/app", "https://staging.nyayagrid.com")).toBe(false);
    expect(inviteReturnCookieValue("/invites/accept?token=abc")).toBe("/invites/accept?token=abc");
    expect(inviteReturnCookieValue("/app")).toBeNull();
    expect(inviteAuthContinueHref("/invites/accept?token=abc", "signup")).toContain("/invites/continue?");
    expect(inviteAuthContinueHref("/invites/accept?token=abc", "signup")).toContain("intent=signup");
    expect(
      isClerkAccountPortalUrl(
        "https://accounts.example.com/sign-up",
        "https://accounts.example.com/sign-in",
      ),
    ).toBe(true);
    expect(
      isClerkAccountPortalUrl(
        "https://staging.nyayagrid.com/invites/accept?token=abc",
        "https://accounts.example.com/sign-in",
      ),
    ).toBe(false);
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

describe("sign-in page offers invited Clerk signup only with a live invite", () => {
  it("builds create-account from a Clerk invitation ticket, not public hosted sign-up", () => {
    const src = readFileSync(resolve(__dirname, "../app/sign-in/page.tsx"), "utf8");
    expect(src).toContain("lookupLiveOrganizationInviteByToken");
    expect(src).toContain("resolveClerkInvitedSignupFromEnv");
    expect(src).toContain("inviteAuthContinueHref");
    expect(src).toContain("Create account");
    expect(src).toContain("isClerkAccountPortalUrl");
    const continueSrc = readFileSync(resolve(__dirname, "../app/invites/continue/route.ts"), "utf8");
    expect(continueSrc).toContain("INVITE_RETURN_COOKIE");
    expect(continueSrc).toContain("INVITE_RESUME_PATH");
    expect(continueSrc).not.toMatch(/console\.(log|info|debug|warn|error)/);
    const resumeSrc = readFileSync(resolve(__dirname, "../app/invites/resume/route.ts"), "utf8");
    expect(resumeSrc).toContain("inviteReturnCookieValue");
    expect(resumeSrc).toContain("INVITE_RETURN_COOKIE");
  });
});

describe("invite accept page resumes after Clerk", () => {
  it("posts the query token after authentication and keeps a 401 returnTo", () => {
    const src = readFileSync(resolve(__dirname, "../app/invites/accept/page.tsx"), "utf8");
    expect(src).toContain("inviteAcceptReturnPath");
    expect(src).toContain('fetch("/api/v1/invites/accept"');
    expect(src).toContain("autoStarted");
    expect(src).toContain("res.status === 401");
    expect(src).toContain("Sign in or create account");
    expect(src).not.toContain("requireUser");
  });
});
