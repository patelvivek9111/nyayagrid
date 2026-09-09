import { createClerkClient } from "@clerk/backend";
import { NextRequest, NextResponse } from "next/server";
import { clerkCookieExpireSetCookieHeaders } from "../../lib/clerk-sign-out-cookies";

function appOrigin(request: NextRequest): string {
  const proto =
    request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? request.nextUrl.origin;
}

function expireClerkCookies(request: NextRequest, response: NextResponse): void {
  const host =
    (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "")
      .split(",")[0]
      ?.trim() ?? "";
  for (const header of clerkCookieExpireSetCookieHeaders(request.headers.get("cookie"), host)) {
    response.headers.append("Set-Cookie", header);
  }
}

async function revokeClerkSession(request: NextRequest): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  if (!secretKey || !publishableKey) return;
  const clerk = createClerkClient({ secretKey, publishableKey });
  const state = await clerk.authenticateRequest(request, {
    secretKey,
    publishableKey,
    signInUrl: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
  });
  if (state.status !== "signed-in") return;
  const auth = state.toAuth();
  if (auth.sessionId) {
    await clerk.sessions.revokeSession(auth.sessionId);
  }
}

/**
 * Ends the Clerk session via the backend SDK, clears Clerk cookies, and returns to /sign-in.
 * Does not depend on the Account Portal /sign-out page.
 */
export async function GET(request: NextRequest) {
  const origin = appOrigin(request);
  const response = NextResponse.redirect(new URL("/sign-in", origin));
  try {
    await revokeClerkSession(request);
  } catch {
    // Always finish sign-out locally even if Clerk revoke fails.
  }
  expireClerkCookies(request, response);
  return response;
}
