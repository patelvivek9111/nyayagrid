import { describe, expect, it, vi } from "vitest";
import { buildInviteAuthActions } from "./auth-return";
import { resolveClerkInvitedSignup, type ClerkInvitationClient } from "./clerk-invitations";

function client(overrides: Partial<ClerkInvitationClient>): ClerkInvitationClient {
  return {
    listUsersByEmail: vi.fn(async () => []),
    listPendingInvitations: vi.fn(async () => []),
    createInvitation: vi.fn(async () => ({ url: null })),
    ...overrides,
  };
}

describe("resolveClerkInvitedSignup", () => {
  it("CASE B: existing Clerk user is sign-in only", async () => {
    const result = await resolveClerkInvitedSignup(
      "invitee@example.com",
      client({ listUsersByEmail: async () => [{ id: "user_1" }] }),
    );
    expect(result).toEqual({ clerkUserExists: true, invitationUrl: null });
  });

  it("CASE A: new email creates a Clerk invitation bound to the Account Portal, not the app accept URL", async () => {
    const createInvitation = vi.fn(async () => ({
      url: "https://accounts.example.com/sign-up?__clerk_ticket=new",
    }));
    const result = await resolveClerkInvitedSignup(
      "fresh@example.com",
      client({ createInvitation }),
      "https://accounts.example.com/sign-up",
    );
    expect(createInvitation).toHaveBeenCalledWith(
      "fresh@example.com",
      "https://accounts.example.com/sign-up",
    );
    expect(result.clerkUserExists).toBe(false);
    expect(result.invitationUrl).toContain("__clerk_ticket=new");
  });

  it("CASE A fallback: reuses a pending Clerk ticket if create returns no URL", async () => {
    const result = await resolveClerkInvitedSignup(
      "invitee@example.com",
      client({
        createInvitation: async () => ({ url: null }),
        listPendingInvitations: async () => [
          {
            id: "inv_1",
            emailAddress: "invitee@example.com",
            url: "https://accounts.example.com/sign-up?__clerk_ticket=ticket",
            status: "pending",
          },
        ],
      }),
      "https://staging.nyayagrid.com/invites/accept?token=invite-example",
    );
    expect(result.clerkUserExists).toBe(false);
    expect(result.invitationUrl).toContain("/sign-up");
  });

  it("creates a Clerk application invitation when none exists", async () => {
    const createInvitation = vi.fn(async () => ({
      url: "https://accounts.example.com/sign-up?__clerk_ticket=new",
    }));
    const result = await resolveClerkInvitedSignup(
      "fresh@example.com",
      client({ createInvitation }),
    );
    expect(createInvitation).toHaveBeenCalledWith("fresh@example.com", undefined);
    expect(result.invitationUrl).toContain("__clerk_ticket=new");
  });
});

describe("buildInviteAuthActions", () => {
  const hosted = "https://accounts.example.com/sign-in";
  const origin = "https://staging.nyayagrid.com";
  const returnTo = "/invites/accept?token=invite-example";

  it("never returns public signup when the invitee already has a Clerk user", () => {
    const actions = buildInviteAuthActions({
      hostedSignInUrl: hosted,
      appOrigin: origin,
      returnTo,
      clerkUserExists: true,
      clerkInvitationUrl: "https://accounts.example.com/sign-up",
    });
    expect(actions.createAccountHref).toBeNull();
    expect(decodeURIComponent(actions.signInHref)).toContain("/invites/accept?token=invite-example");
  });

  it("CASE A: invited signup sends Clerk after-auth to /invites/resume, not the accept token URL", () => {
    const actions = buildInviteAuthActions({
      hostedSignInUrl: hosted,
      appOrigin: origin,
      returnTo: "/invites/resume",
      clerkUserExists: false,
      clerkInvitationUrl: "https://accounts.example.com/sign-up?__clerk_ticket=ticket",
    });
    expect(actions.createAccountHref).toBeTruthy();
    const href = decodeURIComponent(actions.createAccountHref ?? "");
    expect(href).toContain("__clerk_ticket=ticket");
    expect(href).toContain("https://staging.nyayagrid.com/invites/resume");
    expect(href).toContain("sign_up_force_redirect_url=");
    expect(href).not.toContain("/invites/accept?token=");
    expect(href).not.toMatch(/sk_|whsec_/);
  });

  it("CASE A: same-origin Clerk ticket is sent through hosted sign-up, not public /sign-up", () => {
    const actions = buildInviteAuthActions({
      hostedSignInUrl: hosted,
      hostedSignUpUrl: "https://accounts.example.com/sign-up",
      appOrigin: origin,
      returnTo,
      clerkUserExists: false,
      clerkInvitationUrl: "https://staging.nyayagrid.com/invites/accept?token=invite-example&__clerk_ticket=ticket",
    });
    const href = decodeURIComponent(actions.createAccountHref ?? "");
    expect(href.startsWith("https://accounts.example.com/sign-up")).toBe(true);
    expect(href).toContain("__clerk_ticket=ticket");
    expect(href).toContain("https://staging.nyayagrid.com/invites/accept?token=invite-example");
    expect(href).not.toContain("https://staging.nyayagrid.com/sign-up");
  });

  it("CASE H: no Clerk invitation means no create-account href", () => {
    const actions = buildInviteAuthActions({
      hostedSignInUrl: hosted,
      appOrigin: origin,
      returnTo: "/app",
      clerkUserExists: false,
      clerkInvitationUrl: null,
    });
    expect(actions.createAccountHref).toBeNull();
  });
});
