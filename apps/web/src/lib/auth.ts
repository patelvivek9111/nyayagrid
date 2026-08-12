import {
  createAuthProviderFromEnv,
  ensureUserFromIdentity,
  UnauthenticatedError,
  type AuthProvider,
} from "@nyayagrid/auth";
import { getDb } from "./db";

let authProvider: AuthProvider | null = null;

export function getAuthProvider(): AuthProvider {
  if (!authProvider) {
    authProvider = createAuthProviderFromEnv();
  }
  return authProvider;
}

export async function requireUser(headers: Headers) {
  const identity = await getAuthProvider().getIdentity(headers);
  if (!identity) {
    throw new UnauthenticatedError();
  }
  const db = getDb();
  const user = await ensureUserFromIdentity(db, identity);
  return { db, user, identity };
}
