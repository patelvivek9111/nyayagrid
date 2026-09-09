/**
 * Post-sign-in return paths and Clerk hosted-account URLs.
 * Only NEXT_PUBLIC values are read here — never secret keys.
 */

const DEFAULT_AFTER_SIGN_IN = "/app";

export function safeAuthReturnTo(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AFTER_SIGN_IN;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return DEFAULT_AFTER_SIGN_IN;
  if (trimmed.startsWith("//")) return DEFAULT_AFTER_SIGN_IN;
  if (trimmed.includes("://")) return DEFAULT_AFTER_SIGN_IN;
  if (trimmed.startsWith("/sign-in") || trimmed.startsWith("/sign-up")) return DEFAULT_AFTER_SIGN_IN;
  if (
    trimmed.startsWith("/app") ||
    trimmed.startsWith("/invites/accept") ||
    trimmed.startsWith("/portal") ||
    trimmed.startsWith("/professor")
  ) {
    return trimmed;
  }
  return DEFAULT_AFTER_SIGN_IN;
}

type PublicEnv = Record<string, string | undefined>;

export function clerkHostedSignInUrl(
  env: PublicEnv = process.env,
): string | null {
  const url = env.NEXT_PUBLIC_CLERK_SIGN_IN_URL?.trim();
  if (!url || url.startsWith("/")) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function clerkHostedSignUpUrl(
  env: PublicEnv = process.env,
): string | null {
  const url = env.NEXT_PUBLIC_CLERK_SIGN_UP_URL?.trim();
  if (!url || url.startsWith("/")) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isClerkPublishableConfigured(
  env: PublicEnv = process.env,
): boolean {
  const key = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  return key.startsWith("pk_");
}

export function isClerkUiConfigured(env: PublicEnv = process.env): boolean {
  return Boolean(clerkHostedSignInUrl(env) && isClerkPublishableConfigured(env));
}

export function clerkContinueHref(hostedSignInUrl: string, returnTo: string, appOrigin: string): string {
  const redirectUrl = new URL(safeAuthReturnTo(returnTo), appOrigin).toString();
  const url = new URL(hostedSignInUrl);
  url.searchParams.set("redirect_url", redirectUrl);
  return url.toString();
}

export function clerkSignOutHref(
  hostedSignInUrl: string | null,
  appOrigin: string,
  env: PublicEnv = process.env,
): string {
  const after = new URL("/sign-in", appOrigin).toString();
  const explicit = env.NEXT_PUBLIC_CLERK_SIGN_OUT_URL?.trim();
  if (explicit && !explicit.startsWith("/")) {
    try {
      const url = new URL(explicit);
      if (url.protocol === "https:" || url.protocol === "http:") {
        url.search = "";
        url.searchParams.set("redirect_url", after);
        return url.toString();
      }
    } catch {
      // fall through to the hosted sign-in derivation
    }
  }
  if (!hostedSignInUrl) return "/sign-in";
  try {
    const url = new URL(hostedSignInUrl);
    url.pathname = url.pathname.replace(/\/sign-in\/?$/, "/sign-out");
    if (!url.pathname.includes("sign-out")) url.pathname = "/sign-out";
    url.search = "";
    url.searchParams.set("redirect_url", after);
    return url.toString();
  } catch {
    return "/sign-in";
  }
}

export const ACTIVE_ORG_STORAGE_KEY = "nyayagrid.activeOrganizationId";

/** Clerk-mode gate for `/app`. DevAuth does not redirect. */
export function unauthenticatedProfessionalRedirect(input: {
  authProvider: string | undefined;
  sessionPresent: boolean;
  pathnameWithSearch: string;
}): { returnTo: string; reason: "session" } | null {
  if ((input.authProvider ?? "dev") !== "clerk") return null;
  if (input.sessionPresent) return null;
  return {
    returnTo: safeAuthReturnTo(input.pathnameWithSearch),
    reason: "session",
  };
}
