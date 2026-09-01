import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ClerkAuthProvider,
  DevAuthProvider,
  UnavailableAuthProvider,
  clerkWebhookAction,
  createAuthProviderFromEnv,
  verifyClerkWebhookSignature,
} from "./index";

function signClerkPayload(secret: string, id: string, timestamp: string, payload: string): string {
  const trimmed = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const key = Buffer.from(trimmed, "base64");
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  return `v1,${signature}`;
}

describe("DevAuthProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns configured identity by default", async () => {
    vi.stubEnv("APP_ENV", "development");
    const provider = new DevAuthProvider({
      userId: "dev_user_owner",
      email: "owner@example.nyayagrid.local",
      name: "Dev Owner",
    });
    const identity = await provider.getIdentity(new Headers());
    expect(identity?.subject).toBe("dev_user_owner");
  });

  it("supports anonymous override for tests", async () => {
    vi.stubEnv("APP_ENV", "development");
    const provider = new DevAuthProvider({
      userId: "dev_user_owner",
      email: "owner@example.nyayagrid.local",
      name: "Dev Owner",
    });
    const identity = await provider.getIdentity(
      new Headers({ "x-nyayagrid-dev-user": "anonymous" }),
    );
    expect(identity).toBeNull();
  });

  it("refuses the header-trusted identity on staging and production", async () => {
    const provider = new DevAuthProvider({
      userId: "dev_user_owner",
      email: "owner@example.nyayagrid.local",
      name: "Dev Owner",
    });
    vi.stubEnv("APP_ENV", "staging");
    expect(
      await provider.getIdentity(new Headers({ "x-nyayagrid-dev-user": "attacker" })),
    ).toBeNull();
    vi.stubEnv("APP_ENV", "production");
    expect(await provider.getIdentity(new Headers())).toBeNull();
  });

  it("refuses DevAuth when APP_ENV is missing even if NODE_ENV is development", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.APP_ENV;
    const provider = new DevAuthProvider({
      userId: "dev_user_owner",
      email: "owner@example.nyayagrid.local",
      name: "Dev Owner",
    });
    expect(await provider.getIdentity(new Headers())).toBeNull();
    expect(
      await provider.getIdentity(new Headers({ "x-nyayagrid-dev-user": "attacker" })),
    ).toBeNull();
  });
});

describe("ClerkAuthProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("uses the Clerk email and refuses a missing email placeholder", async () => {
    const withEmail = new ClerkAuthProvider(async () => ({
      userId: "user_abc",
      email: "lawyer@example.nyayagrid.local",
      name: "Patel",
    }));
    expect(await withEmail.getIdentity(new Headers())).toEqual({
      subject: "user_abc",
      email: "lawyer@example.nyayagrid.local",
      name: "Patel",
    });

    const missingEmail = new ClerkAuthProvider(async () => ({ userId: "user_abc" }));
    expect(await missingEmail.getIdentity(new Headers())).toBeNull();
  });

  it("createAuthProviderFromEnv returns ClerkAuthProvider when the app layer injects a resolver", () => {
    vi.stubEnv("AUTH_PROVIDER", "clerk");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test");
    const provider = createAuthProviderFromEnv({
      resolveClerkSession: async () => ({ userId: null }),
    });
    expect(provider.name).toBe("clerk");
    vi.unstubAllEnvs();
  });

  it("returns no identity instead of throwing when Clerk keys are missing", async () => {
    vi.stubEnv("AUTH_PROVIDER", "clerk");
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    const provider = createAuthProviderFromEnv({
      resolveClerkSession: async () => ({ userId: "user_abc", email: "a@example.nyayagrid.local" }),
    });
    expect(provider).toBeInstanceOf(UnavailableAuthProvider);
    expect(await provider.getIdentity(new Headers())).toBeNull();
  });

  it("does not fall back to DevAuth when Clerk is requested or the host is not explicit local", async () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("AUTH_PROVIDER", "dev");
    expect(createAuthProviderFromEnv().name).toBe("unavailable");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("AUTH_PROVIDER", "clerk");
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    expect(createAuthProviderFromEnv().name).toBe("unavailable");
  });
});

describe("Clerk webhooks", () => {
  const secret = `whsec_${Buffer.from("webhook-secret").toString("base64")}`;

  it("accepts a valid Svix signature and rejects a forged one", () => {
    const payload = JSON.stringify({ type: "user.updated", data: { id: "user_1" } });
    const svixId = "msg_1";
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const svixSignature = signClerkPayload(secret, svixId, svixTimestamp, payload);
    expect(() =>
      verifyClerkWebhookSignature({
        payload,
        secret,
        headers: { svixId, svixTimestamp, svixSignature },
      }),
    ).not.toThrow();
    expect(() =>
      verifyClerkWebhookSignature({
        payload,
        secret,
        headers: { svixId, svixTimestamp, svixSignature: "v1,forged" },
      }),
    ).toThrow(/invalid/i);
  });

  it("upserts identity from user.created and ignores organization membership", () => {
    expect(
      clerkWebhookAction({
        type: "user.created",
        data: {
          id: "user_1",
          primary_email_address_id: "em_1",
          email_addresses: [{ id: "em_1", email_address: "a@example.nyayagrid.local" }],
          first_name: "Ada",
          last_name: "Lawyer",
        },
      }),
    ).toEqual({
      kind: "upsert_identity",
      subject: "user_1",
      email: "a@example.nyayagrid.local",
      name: "Ada Lawyer",
    });
    expect(
      clerkWebhookAction({
        type: "organizationMembership.created",
        data: { id: "orgmem_1" },
      }).kind,
    ).toBe("ignored");
  });

  it("records user.deleted without treating it as a data-deletion command", () => {
    expect(
      clerkWebhookAction({ type: "user.deleted", data: { id: "user_1", deleted: true } }),
    ).toEqual({
      kind: "user_deleted",
      subject: "user_1",
    });
  });
});
