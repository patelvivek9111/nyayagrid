import { NextRequest, NextResponse } from "next/server";
import {
  InviteError,
  lookupLiveOrganizationInviteByToken,
} from "@nyayagrid/auth";
import {
  INVITE_RESUME_PATH,
  INVITE_RETURN_COOKIE,
  INVITE_RETURN_COOKIE_MAX_AGE_SEC,
  buildInviteAuthActions,
  clerkContinueHref,
  clerkHostedSignInUrl,
  clerkHostedSignUpUrl,
  inviteReturnCookieValue,
  inviteTokenFromReturnTo,
  isClerkAccountPortalUrl,
  isClerkUiConfigured,
  safeAuthReturnTo,
} from "@/lib/auth-return";
import { resolveClerkInvitedSignupFromEnv } from "@/lib/clerk-invitations";
import { getDb } from "@/lib/db";

function firstQuery(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function appOrigin(request: NextRequest): string {
  const proto =
    request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? request.nextUrl.origin;
}

/**
 * Stores invite return intent in an httpOnly cookie, then sends the browser to Clerk.
 * Membership is still accepted only after server-side token + email checks.
 */
export async function GET(request: NextRequest) {
  const origin = appOrigin(request);
  const returnTo = safeAuthReturnTo(firstQuery(request.nextUrl.searchParams.get("returnTo")));
  const intent = request.nextUrl.searchParams.get("intent") === "signup" ? "signup" : "signin";
  const hosted = clerkHostedSignInUrl();
  const configured = isClerkUiConfigured();
  const cookieValue = inviteReturnCookieValue(returnTo);
  const clerkReturnTo = cookieValue ? INVITE_RESUME_PATH : returnTo;

  let location =
    configured && hosted ? clerkContinueHref(hosted, clerkReturnTo, origin) : "/sign-in";

  if (intent === "signup" && hosted && cookieValue) {
    const token = inviteTokenFromReturnTo(returnTo);
    if (token) {
      try {
        const invite = await lookupLiveOrganizationInviteByToken(getDb(), token);
        const portal = clerkHostedSignUpUrl();
        const portalRedirect =
          portal && isClerkAccountPortalUrl(portal, hosted) ? portal : undefined;
        const clerkState = await resolveClerkInvitedSignupFromEnv(invite.email, portalRedirect);
        location =
          buildInviteAuthActions({
            hostedSignInUrl: hosted,
            hostedSignUpUrl: portal,
            appOrigin: origin,
            returnTo: clerkReturnTo,
            clerkUserExists: clerkState.clerkUserExists,
            clerkInvitationUrl: clerkState.invitationUrl,
          }).createAccountHref ?? location;
      } catch (error) {
        if (!(error instanceof InviteError)) {
          location = clerkContinueHref(hosted, clerkReturnTo, origin);
        }
      }
    }
  }

  const target = location.startsWith("http://") || location.startsWith("https://")
    ? location
    : new URL(location, origin).toString();
  const response = NextResponse.redirect(target);
  if (cookieValue) {
    response.cookies.set({
      name: INVITE_RETURN_COOKIE,
      value: cookieValue,
      httpOnly: true,
      secure: origin.startsWith("https"),
      sameSite: "lax",
      path: "/",
      maxAge: INVITE_RETURN_COOKIE_MAX_AGE_SEC,
    });
  }
  return response;
}
