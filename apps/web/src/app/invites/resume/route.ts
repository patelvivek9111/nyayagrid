import { NextRequest, NextResponse } from "next/server";
import {
  INVITE_RETURN_COOKIE,
  inviteReturnCookieValue,
} from "@/lib/auth-return";

function appOrigin(request: NextRequest): string {
  const proto =
    request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? request.nextUrl.origin;
}

/**
 * Handshake landing pad after Clerk invited sign-in/sign-up. Cookie is return intent only;
 * /invites/accept still validates token, email, org, and role.
 */
export async function GET(request: NextRequest) {
  const origin = appOrigin(request);
  const dest = inviteReturnCookieValue(request.cookies.get(INVITE_RETURN_COOKIE)?.value) ?? "/app";
  const response = NextResponse.redirect(new URL(dest, origin));
  response.cookies.set({
    name: INVITE_RETURN_COOKIE,
    value: "",
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
