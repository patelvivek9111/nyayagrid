import { createClerkClient } from "@clerk/backend";
import { NextResponse, type NextRequest } from "next/server";
import { unauthenticatedProfessionalRedirect } from "./lib/auth-return";

export type ClerkBrowserAuthStatus = "signed-in" | "signed-out" | "handshake";

export type ClerkBrowserAuth = {
  status: ClerkBrowserAuthStatus;
  headers: Headers;
};

export type AuthenticateClerkBrowserRequest = (
  request: NextRequest,
) => Promise<ClerkBrowserAuth | null>;

/**
 * Clerk query params that must never be copied into NyayaGrid returnTo URLs.
 * Handshake/session tokens belong in Clerk's own response, not application links.
 */
function pathWithoutClerkTokens(request: NextRequest): string {
  const url = request.nextUrl.clone();
  for (const key of [...url.searchParams.keys()]) {
    if (key === "__session" || key.startsWith("__clerk")) {
      url.searchParams.delete(key);
    }
  }
  return `${url.pathname}${url.search}`;
}

function copyClerkHeaders(from: Headers, to: Headers): void {
  const setCookies = typeof from.getSetCookie === "function" ? from.getSetCookie() : [];
  from.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    to.append(key, value);
  });
  if (setCookies.length > 0) {
    for (const cookie of setCookies) {
      to.append("Set-Cookie", cookie);
    }
    return;
  }
  from.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      to.append(key, value);
    }
  });
}

/** Return Clerk's handshake redirect unchanged (Location + Set-Cookie). */
export function clerkHandshakeResponse(headers: Headers): NextResponse {
  const response = new NextResponse(null, { status: 307 });
  copyClerkHeaders(headers, response.headers);
  return response;
}

function signedInResponse(headers: Headers): NextResponse {
  const response = NextResponse.next();
  copyClerkHeaders(headers, response.headers);
  return response;
}

function signInRedirect(request: NextRequest, authProvider: string | undefined): NextResponse {
  const gate = unauthenticatedProfessionalRedirect({
    authProvider,
    sessionPresent: false,
    pathnameWithSearch: pathWithoutClerkTokens(request),
  });
  if (!gate) return NextResponse.next();
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("returnTo", gate.returnTo);
  signIn.searchParams.set("reason", gate.reason);
  return NextResponse.redirect(signIn);
}

export async function authenticateClerkBrowserRequest(
  request: NextRequest,
): Promise<ClerkBrowserAuth | null> {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  if (!secretKey || !publishableKey) return null;

  const clerk = createClerkClient({ secretKey, publishableKey });
  const state = await clerk.authenticateRequest(request, {
    secretKey,
    publishableKey,
    signInUrl: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
  });
  if (state.status === "handshake") {
    return { status: "handshake", headers: state.headers };
  }
  if (state.status === "signed-in") {
    return { status: "signed-in", headers: state.headers };
  }
  return { status: "signed-out", headers: state.headers };
}

export async function runProfessionalMiddleware(
  request: NextRequest,
  options: {
    authProvider: string | undefined;
    authenticate: AuthenticateClerkBrowserRequest;
  },
): Promise<NextResponse> {
  if ((options.authProvider ?? "dev") !== "clerk") {
    return NextResponse.next();
  }

  let clerk: ClerkBrowserAuth | null = null;
  try {
    clerk = await options.authenticate(request);
  } catch {
    clerk = null;
  }

  if (clerk?.status === "handshake") {
    return clerkHandshakeResponse(clerk.headers);
  }
  if (clerk?.status === "signed-in") {
    return signedInResponse(clerk.headers);
  }
  return signInRedirect(request, options.authProvider);
}

/**
 * Clerk-mode gate for professional surfaces. DevAuth (AUTH_PROVIDER=dev) is unchanged.
 * Session cookies are never trusted by name; Clerk's authenticateRequest decides signed-in,
 * signed-out, or handshake. API routes are outside this matcher and keep Bearer verification.
 */
export async function middleware(request: NextRequest) {
  return runProfessionalMiddleware(request, {
    authProvider: process.env.AUTH_PROVIDER,
    authenticate: authenticateClerkBrowserRequest,
  });
}

export const config = {
  matcher: ["/app/:path*", "/app"],
};
