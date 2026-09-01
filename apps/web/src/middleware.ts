import { NextResponse, type NextRequest } from "next/server";
import { unauthenticatedProfessionalRedirect } from "@/lib/auth-return";

/**
 * Clerk-mode gate for professional surfaces. DevAuth (AUTH_PROVIDER=dev) is unchanged so local
 * e2e keeps working. Session cookies are presence-checked here; API routes still verify the JWT.
 */
function clerkSessionPresent(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((cookie) => cookie.name === "__session" || cookie.name.startsWith("__session_"));
}

export function middleware(request: NextRequest) {
  const gate = unauthenticatedProfessionalRedirect({
    authProvider: process.env.AUTH_PROVIDER,
    sessionPresent: clerkSessionPresent(request),
    pathnameWithSearch: `${request.nextUrl.pathname}${request.nextUrl.search}`,
  });
  if (!gate) return NextResponse.next();

  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("returnTo", gate.returnTo);
  signIn.searchParams.set("reason", gate.reason);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/app/:path*", "/app"],
};
