import { createClerkClient } from "@clerk/backend";
import type { ClerkSession } from "@nyayagrid/auth";
import { USER_FACING_AUTH } from "@nyayagrid/auth/user-facing";

type ClerkUserRecord = {
  primaryEmailAddressId: string | null;
  firstName: string | null;
  lastName: string | null;
  emailAddresses: Array<{ id: string; emailAddress: string }>;
};

export type ClerkRequestAuthState = {
  status: string;
  headers?: Headers;
  toAuth: () => { userId: string | null } | null;
};

export type ClerkBrowserSessionRefresh = {
  status: "signed-in" | "signed-out" | "handshake" | "unavailable";
  headers: Headers;
};

export type ClerkSessionDeps = {
  authenticateRequest: (request: Request) => Promise<ClerkRequestAuthState>;
  getUser: (userId: string) => Promise<ClerkUserRecord>;
};

function firstHeader(headers: Headers, name: string): string | null {
  const raw = headers.get(name);
  if (!raw) return null;
  const value = raw.split(",")[0]?.trim();
  return value || null;
}

/**
 * Build a Request for Clerk authenticateRequest from incoming headers (cookie + Bearer).
 * Does not copy tokens into the URL.
 */
export function clerkRequestFromHeaders(headers: Headers): Request {
  const forwardedProto = firstHeader(headers, "x-forwarded-proto");
  const proto = forwardedProto === "http" ? "http" : "https";
  const host =
    firstHeader(headers, "x-forwarded-host") ?? firstHeader(headers, "host") ?? "localhost";
  const copy = new Headers(headers);
  const authorization = copy.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    copy.set("authorization", `Bearer ${authorization.slice(7).trim()}`);
  }
  return new Request(`${proto}://${host}/`, { method: "GET", headers: copy });
}

function clerkEmail(user: ClerkUserRecord): string | null {
  const primary = user.emailAddresses.find((row) => row.id === user.primaryEmailAddressId);
  return primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
}

export async function resolveClerkSessionFromState(
  state: ClerkRequestAuthState,
  getUser: ClerkSessionDeps["getUser"],
): Promise<ClerkSession> {
  if (state.status !== "signed-in") return { userId: null };
  const auth = state.toAuth();
  const userId = auth?.userId ?? null;
  if (!userId) return { userId: null };
  try {
    const user = await getUser(userId);
    return {
      userId,
      email: clerkEmail(user),
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
    };
  } catch {
    return { userId: null };
  }
}

function createClerkSessionDeps(): ClerkSessionDeps | null {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  if (!secretKey || !publishableKey) return null;
  const clerk = createClerkClient({ secretKey, publishableKey });
  return {
    authenticateRequest: (request) =>
      clerk.authenticateRequest(request, {
        secretKey,
        publishableKey,
        signInUrl: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
      }),
    getUser: (userId) => clerk.users.getUser(userId),
  };
}

/**
 * Resolves a Clerk session from the incoming request using Clerk's request authentication.
 * Suffixed session cookies, the unsuffixed __session cookie, and Bearer session tokens are all
 * verified by the SDK. Handshake or signed-out is unauthenticated for APIs (no redirect).
 */
export async function resolveClerkSession(
  requestHeaders: Headers,
  deps: ClerkSessionDeps | null = createClerkSessionDeps(),
): Promise<ClerkSession> {
  if (!deps) return { userId: null };
  try {
    const state = await deps.authenticateRequest(clerkRequestFromHeaders(requestHeaders));
    return resolveClerkSessionFromState(state, deps.getUser);
  } catch {
    return { userId: null };
  }
}

/** Copy Clerk Set-Cookie onto a response so a keep-alive can rotate a short-lived session JWT. */
export function appendClerkAuthHeaders(from: Headers | undefined, to: Headers): void {
  if (!from) return;
  const setCookies = typeof from.getSetCookie === "function" ? from.getSetCookie() : [];
  if (setCookies.length > 0) {
    for (const cookie of setCookies) {
      to.append("Set-Cookie", cookie);
    }
    return;
  }
  from.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") to.append("Set-Cookie", value);
  });
}

/**
 * Re-run Clerk authenticateRequest so refreshed session cookies can be written.
 * Handshake is not treated as signed-out; the browser must reload to finish it.
 */
export async function refreshClerkBrowserSession(
  requestHeaders: Headers,
  deps: ClerkSessionDeps | null = createClerkSessionDeps(),
): Promise<ClerkBrowserSessionRefresh> {
  if (!deps) return { status: "unavailable", headers: new Headers() };
  try {
    const state = await deps.authenticateRequest(clerkRequestFromHeaders(requestHeaders));
    const headers = state.headers instanceof Headers ? state.headers : new Headers();
    if (state.status === "handshake") return { status: "handshake", headers };
    if (state.status === "signed-in") return { status: "signed-in", headers };
    return { status: "signed-out", headers };
  } catch {
    return { status: "unavailable", headers: new Headers() };
  }
}

export function sessionKeepAliveResponse(refresh: ClerkBrowserSessionRefresh): Response {
  if (refresh.status === "signed-in") {
    const response = new Response(JSON.stringify({ ok: true, provider: "clerk" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    appendClerkAuthHeaders(refresh.headers, response.headers);
    return response;
  }
  const code = refresh.status === "handshake" ? "CLERK_HANDSHAKE" : "UNAUTHENTICATED";
  const message =
    refresh.status === "handshake" ? "Refreshing your session." : USER_FACING_AUTH.unauthenticated;
  const response = new Response(JSON.stringify({ error: { code, message } }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
  appendClerkAuthHeaders(refresh.headers, response.headers);
  return response;
}
