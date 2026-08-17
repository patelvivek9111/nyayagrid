import { createClerkClient, verifyToken } from "@clerk/backend";
import type { ClerkSession } from "@nyayagrid/auth";

function sessionCookie(headers: Headers): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith("__session=")) {
      return decodeURIComponent(trimmed.slice("__session=".length));
    }
  }
  const bearer = headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    return bearer.slice("Bearer ".length).trim();
  }
  return null;
}

function clerkEmail(user: {
  primaryEmailAddressId: string | null;
  emailAddresses: Array<{ id: string; emailAddress: string }>;
}): string | null {
  const primary = user.emailAddresses.find((row) => row.id === user.primaryEmailAddressId);
  return primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
}

/**
 * Resolves a Clerk session from the incoming request. Returns `{ userId: null }` when the session
 * is missing or invalid so callers become 401 rather than 500.
 */
export async function resolveClerkSession(requestHeaders: Headers): Promise<ClerkSession> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey) return { userId: null };

  const token = sessionCookie(requestHeaders);
  if (!token) return { userId: null };

  try {
    const payload = await verifyToken(token, { secretKey });
    const userId = typeof payload.sub === "string" ? payload.sub : null;
    if (!userId) return { userId: null };
    const clerk = createClerkClient({ secretKey, publishableKey });
    const user = await clerk.users.getUser(userId);
    return {
      userId,
      email: clerkEmail(user),
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
    };
  } catch {
    return { userId: null };
  }
}
