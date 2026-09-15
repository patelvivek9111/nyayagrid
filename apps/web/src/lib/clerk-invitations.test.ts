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

  it("CASE A: new email reuses a pending Clerk invitation ticket", async () => {
    const result = await resolveClerkInvitedSignup(
      "invitee@example.com",
      client({
        listPendingInvitations: async () => [
          {
            id: "inv_1",
            emailAddress: "invitee@example.com",
            url: "https://accounts.example.com/sign-up?__clerk_ticket=ticket",
            status: "pending",
          },
        ],
      }),
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
    expect(createInvitation).toHaveBeenCalledWith("fresh@example.com");
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

  it("CASE A: invited signup keeps returnTo on the Clerk ticket URL", () => {
    const actions = buildInviteAuthActions({
      hostedSignInUrl: hosted,
      appOrigin: origin,
      returnTo,
      clerkUserExists: false,
      clerkInvitationUrl: "https://accounts.example.com/sign-up?__clerk_ticket=ticket",
    });
    expect(actions.createAccountHref).toBeTruthy();
    const href = decodeURIComponent(actions.createAccountHref ?? "");
    expect(href).toContain("__clerk_ticket=ticket");
    expect(href).toContain("https://staging.nyayagrid.com/invites/accept?token=invite-example");
    expect(href).not.toMatch(/sk_|whsec_/);
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
