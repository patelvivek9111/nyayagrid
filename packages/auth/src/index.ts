import { eq } from "drizzle-orm";
import type { Database } from "@nyayagrid/database";
import { users } from "@nyayagrid/database";

/**
 * Authentication identity only.
 * Authorization (org membership, roles, capabilities, matter access)
 * is owned by NyayaGrid server-side — never by IdP metadata alone.
 */
export type AuthIdentity = {
  subject: string;
  email: string;
  name?: string | null;
};

export interface AuthProvider {
  readonly name: string;
  getIdentity(requestHeaders: Headers): Promise<AuthIdentity | null>;
}

export class DevAuthProvider implements AuthProvider {
  readonly name = "dev";

  constructor(
    private readonly config: {
      userId: string;
      email: string;
      name: string;
    },
  ) {}

  async getIdentity(requestHeaders: Headers): Promise<AuthIdentity | null> {
    const override = requestHeaders.get("x-nyayagrid-dev-user");
    if (override === "anonymous") return null;
    if (override) {
      return {
        subject: override,
        email: `${override}@example.nyayagrid.local`,
        name: override,
      };
    }
    return {
      subject: this.config.userId,
      email: this.config.email,
      name: this.config.name,
    };
  }
}

/**
 * Clerk adapter placeholder for free-tier development.
 * Requires CLERK_SECRET_KEY + publishable key when AUTH_PROVIDER=clerk.
 * Does not grant authorization; only resolves identity.
 */
export class ClerkAuthProvider implements AuthProvider {
  readonly name = "clerk";

  constructor(private readonly getAuth: () => Promise<{ userId: string | null }>) {}

  async getIdentity(): Promise<AuthIdentity | null> {
    const auth = await this.getAuth();
    if (!auth.userId) return null;
    return {
      subject: auth.userId,
      email: `${auth.userId}@clerk.local`,
      name: null,
    };
  }
}

export function createAuthProviderFromEnv(): AuthProvider {
  const provider = process.env.AUTH_PROVIDER ?? "dev";
  if (provider === "clerk") {
    if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
      throw new Error(
        "AUTH_PROVIDER=clerk requires CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. Use AUTH_PROVIDER=dev for free local development.",
      );
    }
    throw new Error(
      "Clerk adapter is configured but must be wired from the Next.js app layer (see apps/web). Use AUTH_PROVIDER=dev for package-level tests.",
    );
  }
  return new DevAuthProvider({
    userId: process.env.DEV_AUTH_USER_ID ?? "dev_user_owner",
    email: process.env.DEV_AUTH_EMAIL ?? "owner@example.nyayagrid.local",
    name: process.env.DEV_AUTH_NAME ?? "Dev Owner",
  });
}

export async function ensureUserFromIdentity(db: Database, identity: AuthIdentity) {
  const existing = await db.query.users.findFirst({
    where: eq(users.authSubject, identity.subject),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(users)
    .values({
      authSubject: identity.subject,
      email: identity.email,
      name: identity.name ?? null,
    })
    .returning();
  return created!;
}

export class UnauthenticatedError extends Error {
  readonly code = "UNAUTHENTICATED";
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export * from "./invites";
