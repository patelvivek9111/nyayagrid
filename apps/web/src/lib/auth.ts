import {
  createAuthProviderFromEnv,
  ensureUserFromIdentity,
  ClerkHandshakeError,
  UnauthenticatedError,
  type AuthProvider,
} from "@nyayagrid/auth";
import { getDb } from "./db";

let authProvider: AuthProvider | null = null;

export function getAuthProvider(): AuthProvider {
  if (!authProvider) {
    authProvider = createAuthProviderFromEnv({
      resolveClerkSession: async (headers) => {
        const { resolveClerkSession } = await import("./clerk-session");
        return resolveClerkSession(headers);
      },
    });
  }
  return authProvider;
}

export async function requireUser(headers: Headers) {
  // Clerk mode: detect handshake before treating the caller as signed-out, and preserve
  // Set-Cookie so the browser can finish session rotation instead of a dead-end 401.
  if ((process.env.AUTH_PROVIDER ?? "dev") === "clerk") {
    const { resolveClerkApiAuth } = await import("./clerk-session");
    const resolved = await resolveClerkApiAuth(headers);
    if (resolved.status === "handshake") {
      throw new ClerkHandshakeError(resolved.headers);
    }
    if (resolved.status !== "signed-in" || !resolved.session.userId) {
      throw new UnauthenticatedError();
    }
    const email = resolved.session.email?.trim();
    if (!email) {
      throw new UnauthenticatedError();
    }
    const identity = {
      subject: resolved.session.userId,
      email,
      name: resolved.session.name ?? null,
    };
    const db = getDb();
    const user = await ensureUserFromIdentity(db, identity);
    return { db, user, identity };
  }

  const identity = await getAuthProvider().getIdentity(headers);
  if (!identity) {
    throw new UnauthenticatedError();
  }
  const db = getDb();
  const user = await ensureUserFromIdentity(db, identity);
  return { db, user, identity };
}
