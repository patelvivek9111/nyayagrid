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
    trimmed.startsWith("/invites/resume") ||
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

/** Clerk Account Portal user profile. Password, email, and devices stay on Clerk. */
export function clerkHostedUserProfileUrl(
  env: PublicEnv = process.env,
): string | null {
  const hosted = clerkHostedSignInUrl(env);
  if (!hosted) return null;
  try {
    const url = new URL(hosted);
    url.pathname = "/user";
    url.search = "";
    url.hash = "";
    return url.toString();
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

export const INVITE_RETURN_COOKIE = "ng_invite_return";
export const INVITE_RESUME_PATH = "/invites/resume";
export const INVITE_RETURN_COOKIE_MAX_AGE_SEC = 30 * 60;

/**
 * Account Portal after_sign_up is the site origin (`/`), which is not a professional
 * handshake route. Clerk reads these query keys on hosted sign-up/sign-in; force beats
 * the dropped `redirect_url` on `/sign-up/continue`.
 */
export function applyClerkAfterAuthRedirect(targetUrl: string, redirectUrl: string): string {
  const url = new URL(targetUrl);
  url.searchParams.set("redirect_url", redirectUrl);
  url.searchParams.set("sign_in_force_redirect_url", redirectUrl);
  url.searchParams.set("sign_up_force_redirect_url", redirectUrl);
  return url.toString();
}

export function clerkContinueHref(hostedSignInUrl: string, returnTo: string, appOrigin: string): string {
  return applyClerkAfterAuthRedirect(hostedSignInUrl, absoluteInviteResumeUrl(returnTo, appOrigin));
}

/**
 * Absolute URL Clerk should return to after invited signup. Same-origin invite accept only.
 * Callers must not log the value (it includes the invite token).
 */
export function absoluteInviteResumeUrl(returnTo: string, appOrigin: string): string {
  return new URL(safeAuthReturnTo(returnTo), appOrigin).toString();
}

/** True when Clerk can be told to resume a live NyayaGrid invite after account creation. */
export function isSafeInviteResumeUrl(url: string, appOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    const origin = new URL(appOrigin);
    if (parsed.origin !== origin.origin) return false;
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return parsed.pathname === "/invites/accept" && Boolean(parsed.searchParams.get("token")?.trim());
  } catch {
    return false;
  }
}

/**
 * Clerk Account Portal origin only. Passing an app URL as invitation redirect_url starts Clerk's
 * custom ticket flow and drops the hosted after-auth redirect.
 */
export function isClerkAccountPortalUrl(url: string, hostedSignInUrl: string): boolean {
  try {
    const parsed = new URL(url);
    const hosted = new URL(hostedSignInUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return parsed.origin === hosted.origin;
  } catch {
    return false;
  }
}

/** Path-only invite return stored in an httpOnly cookie. Never log the value. */
export function inviteReturnCookieValue(returnTo: string | null | undefined): string | null {
  const path = safeAuthReturnTo(returnTo);
  if (!inviteTokenFromReturnTo(path)) return null;
  return path;
}

export function inviteAuthContinueHref(
  returnTo: string,
  intent: "signin" | "signup",
): string {
  const params = new URLSearchParams();
  params.set("returnTo", safeAuthReturnTo(returnTo));
  params.set("intent", intent);
  return `/invites/continue?${params.toString()}`;
}

/** Token from a safe invite returnTo. Never logs the value; callers must not either. */
export function inviteTokenFromReturnTo(returnTo: string | null | undefined): string | null {
  const path = safeAuthReturnTo(returnTo);
  if (!path.startsWith("/invites/accept")) return null;
  try {
    const url = new URL(path, "https://nyayagrid.invalid");
    const token = url.searchParams.get("token")?.trim() ?? "";
    return token || null;
  } catch {
    return null;
  }
}

export type InviteAuthActions = {
  signInHref: string;
  createAccountHref: string | null;
};

/**
 * Existing Clerk users sign in. Users without a Clerk account use the application invitation
 * ticket URL (restricted mode). Public hosted sign-up is never returned.
 */
export function buildInviteAuthActions(input: {
  hostedSignInUrl: string;
  hostedSignUpUrl?: string | null;
  appOrigin: string;
  returnTo: string;
  clerkUserExists: boolean;
  clerkInvitationUrl: string | null;
}): InviteAuthActions {
  const signInHref = clerkContinueHref(input.hostedSignInUrl, input.returnTo, input.appOrigin);
  if (input.clerkUserExists) return { signInHref, createAccountHref: null };
  const invitationUrl = input.clerkInvitationUrl?.trim() ?? "";
  if (!invitationUrl) return { signInHref, createAccountHref: null };
  let ticketSource = invitationUrl;
  try {
    const parsed = new URL(invitationUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { signInHref, createAccountHref: null };
    }
    const originHost = new URL(input.appOrigin).host;
    if (parsed.host === originHost) {
      const ticket = parsed.searchParams.get("__clerk_ticket")?.trim();
      const hostedSignUp = input.hostedSignUpUrl?.trim() ?? "";
      if (!ticket || !hostedSignUp) return { signInHref, createAccountHref: null };
      const hosted = new URL(hostedSignUp);
      if (hosted.protocol !== "https:" && hosted.protocol !== "http:") {
        return { signInHref, createAccountHref: null };
      }
      hosted.searchParams.set("__clerk_ticket", ticket);
      ticketSource = hosted.toString();
    }
  } catch {
    return { signInHref, createAccountHref: null };
  }
  return {
    signInHref,
    createAccountHref: clerkContinueHref(ticketSource, input.returnTo, input.appOrigin),
  };
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

/** Path Clerk should return to after sign-in so invite acceptance can resume. */
export function inviteAcceptReturnPath(token: string | null | undefined): string {
  const trimmed = token?.trim() ?? "";
  if (!trimmed) return "/invites/accept";
  return `/invites/accept?token=${encodeURIComponent(trimmed)}`;
}

/** Clerk-mode gate for `/app` and `/invites/accept`. DevAuth does not redirect. */
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
