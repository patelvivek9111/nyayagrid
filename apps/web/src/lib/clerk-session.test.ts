import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendClerkAuthHeaders,
  clerkRequestFromHeaders,
  refreshClerkBrowserSession,
  resolveClerkApiAuth,
  resolveClerkSession,
  resolveClerkSessionFromState,
  sessionKeepAliveResponse,
} from "./clerk-session";

const source = readFileSync(resolve(__dirname, "clerk-session.ts"), "utf8");
const webhook = readFileSync(resolve(__dirname, "../app/api/webhooks/clerk/route.ts"), "utf8");

const user = {
  primaryEmailAddressId: "idn_1",
  firstName: "Patel",
  lastName: "Owner",
  emailAddresses: [{ id: "idn_1", emailAddress: "lawyer@example.nyayagrid.local" }],
};

describe("Clerk secret handling", () => {
  it("does not log session tokens or secret keys", () => {
    expect(source).not.toContain("console.log");
    expect(source).not.toContain("console.error");
    expect(source).toContain("return { userId: null }");
    expect(source).toContain("authenticateRequest");
    expect(source).toContain("bearer ");
    expect(source).not.toContain('startsWith("__session_")');
    expect(webhook).not.toContain("console.log");
    expect(webhook).toContain("NOT_CONFIGURED");
    expect(webhook).toContain("503");
    expect(webhook).not.toContain("secretKey");
  });
});

describe("clerkRequestFromHeaders", () => {
  it("does not copy session tokens into the request URL", () => {
    const request = clerkRequestFromHeaders(
      new Headers({
        host: "staging.nyayagrid.com",
        cookie: "__session=SHOULD_NOT_APPEAR_IN_URL",
        authorization: "bearer also-not-in-url",
      }),
    );
    expect(request.url).toBe("https://staging.nyayagrid.com/");
    expect(request.url).not.toContain("SHOULD_NOT");
    expect(request.headers.get("authorization")).toBe("Bearer also-not-in-url");
  });
});

describe("resolveClerkSessionFromState", () => {
  it("allows a Clerk signed-in session and loads the user email", async () => {
    const session = await resolveClerkSessionFromState(
      { status: "signed-in", toAuth: () => ({ userId: "user_abc" }) },
      async () => user,
    );
    expect(session).toEqual({
      userId: "user_abc",
      email: "lawyer@example.nyayagrid.local",
      name: "Patel Owner",
    });
  });

  it("does not authenticate handshake, signed-out, or __client_uat-only states", async () => {
    const getUser = async () => user;
    expect(
      await resolveClerkSessionFromState({ status: "handshake", toAuth: () => null }, getUser),
    ).toEqual({ userId: null });
    expect(
      await resolveClerkSessionFromState(
        { status: "signed-out", toAuth: () => ({ userId: null }) },
        getUser,
      ),
    ).toEqual({ userId: null });
  });

  it("resolveClerkApiAuth preserves handshake headers for API callers", async () => {
    const clerkHeaders = new Headers();
    clerkHeaders.append("Set-Cookie", "__session=rotated; Path=/; HttpOnly; Secure");
    const resolved = await resolveClerkApiAuth(
      new Headers({ host: "staging.nyayagrid.com", cookie: "__client_uat=1" }),
      {
        authenticateRequest: async () => ({
          status: "handshake",
          headers: clerkHeaders,
          toAuth: () => null,
        }),
        getUser: async () => user,
      },
    );
    expect(resolved.status).toBe("handshake");
    expect(resolved.headers.getSetCookie?.()[0] ?? resolved.headers.get("set-cookie")).toMatch(
      /__session=rotated/,
    );
  });
});

describe("resolveClerkSession", () => {
  it("uses Clerk authenticateRequest for suffixed cookies and Bearer tokens", async () => {
    const seen = { cookie: "", authorization: "" };
    const session = await resolveClerkSession(
      new Headers({
        host: "staging.nyayagrid.com",
        cookie: "__client_uat=1; __session_Ii1zme2P=suffixed-session-token",
        authorization: "Bearer header-session-token",
      }),
      {
        authenticateRequest: async (request) => {
          seen.cookie = request.headers.get("cookie") ?? "";
          seen.authorization = request.headers.get("authorization") ?? "";
          return { status: "signed-in", toAuth: () => ({ userId: "user_abc" }) };
        },
        getUser: async () => user,
      },
    );
    expect(session.userId).toBe("user_abc");
    expect(seen.cookie).toContain("__session_Ii1zme2P=");
    expect(seen.authorization).toBe("Bearer header-session-token");
  });

  it("does not authenticate __client_uat alone", async () => {
    const session = await resolveClerkSession(
      new Headers({ host: "staging.nyayagrid.com", cookie: "__client_uat=1710000000" }),
      {
        authenticateRequest: async () => ({ status: "handshake", toAuth: () => null }),
        getUser: async () => user,
      },
    );
    expect(session.userId).toBeNull();
  });

  it("does not authenticate a forged session token", async () => {
    const session = await resolveClerkSession(
      new Headers({ host: "staging.nyayagrid.com", cookie: "__session=forged.not-a-clerk-jwt" }),
      {
        authenticateRequest: async () => ({
          status: "signed-out",
          toAuth: () => ({ userId: null }),
        }),
        getUser: async () => user,
      },
    );
    expect(session.userId).toBeNull();
  });

  it("keeps Bearer-without-Cookie working when Clerk reports signed-in", async () => {
    const session = await resolveClerkSession(
      new Headers({
        host: "staging.nyayagrid.com",
        authorization: "Bearer session-jwt",
      }),
      {
        authenticateRequest: async (request) => {
          expect(request.headers.get("cookie")).toBeNull();
          expect(request.headers.get("authorization")).toBe("Bearer session-jwt");
          return { status: "signed-in", toAuth: () => ({ userId: "user_abc" }) };
        },
        getUser: async () => user,
      },
    );
    expect(session.userId).toBe("user_abc");
  });

  it("returns unauthenticated when Clerk keys are missing", async () => {
    const session = await resolveClerkSession(new Headers({ authorization: "Bearer x" }), null);
    expect(session.userId).toBeNull();
  });
});

describe("Clerk session keep-alive refresh", () => {
  it("copies Set-Cookie on a signed-in refresh and does not log it", async () => {
    const clerkHeaders = new Headers();
    clerkHeaders.append("Set-Cookie", "__session=rotated; Path=/; HttpOnly; Secure");
    const refresh = await refreshClerkBrowserSession(
      new Headers({ host: "staging.nyayagrid.com", cookie: "__session=old" }),
      {
        authenticateRequest: async () => ({
          status: "signed-in",
          headers: clerkHeaders,
          toAuth: () => ({ userId: "user_abc" }),
        }),
        getUser: async () => user,
      },
    );
    expect(refresh.status).toBe("signed-in");
    const response = sessionKeepAliveResponse(refresh);
    expect(response.status).toBe(200);
    const cookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")];
    expect(cookies.some((cookie) => cookie?.startsWith("__session=rotated"))).toBe(true);
    expect(source).toContain("appendClerkAuthHeaders");
    expect(source).not.toContain("console.log");
  });

  it("does not treat handshake as a signed-out session", async () => {
    const refresh = await refreshClerkBrowserSession(
      new Headers({ host: "staging.nyayagrid.com" }),
      {
        authenticateRequest: async () => ({
          status: "handshake",
          headers: new Headers(),
          toAuth: () => null,
        }),
        getUser: async () => user,
      },
    );
    expect(refresh.status).toBe("handshake");
    const response = sessionKeepAliveResponse(refresh);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CLERK_HANDSHAKE");
  });

  it("forwards Set-Cookie from a lone header when getSetCookie is empty", () => {
    const from = new Headers();
    from.set("Set-Cookie", "__session=one; Path=/");
    const to = new Headers();
    appendClerkAuthHeaders(from, to);
    expect(to.get("set-cookie")).toContain("__session=one");
  });
});
