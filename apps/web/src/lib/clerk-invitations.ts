import { normalizeInviteEmail } from "@nyayagrid/auth";
import { createLogger } from "@nyayagrid/observability";

const logger = createLogger("web.clerk-invitations");

export type ClerkInvitationRecord = {
  id: string;
  emailAddress: string;
  url: string | null;
  status: string;
};

export type ClerkInvitationClient = {
  listUsersByEmail: (email: string) => Promise<{ id: string }[]>;
  listPendingInvitations: () => Promise<ClerkInvitationRecord[]>;
  createInvitation: (email: string, redirectUrl?: string) => Promise<{ url: string | null }>;
};

/**
 * Restricted Clerk mode: existing users sign in; new emails need an application invitation ticket.
 * Does not enable public registration.
 */
export async function resolveClerkInvitedSignup(
  email: string,
  client: ClerkInvitationClient,
  redirectUrl?: string,
): Promise<{ clerkUserExists: boolean; invitationUrl: string | null }> {
  const normalized = normalizeInviteEmail(email);
  const users = await client.listUsersByEmail(normalized);
  if (users.length > 0) return { clerkUserExists: true, invitationUrl: null };

  const resumeUrl = redirectUrl?.trim() || undefined;
  const created = await client.createInvitation(normalized, resumeUrl);
  if (created.url) return { clerkUserExists: false, invitationUrl: created.url };

  const pending = await client.listPendingInvitations();
  const existing = pending.find(
    (row) =>
      row.status === "pending" &&
      normalizeInviteEmail(row.emailAddress) === normalized &&
      Boolean(row.url),
  );
  return { clerkUserExists: false, invitationUrl: existing?.url ?? null };
}

type ClerkJson = Record<string, unknown>;

async function clerkFetch(
  path: string,
  init: { method?: string; body?: unknown },
  secretKey: string,
): Promise<{ status: number; json: ClerkJson | ClerkJson[] }> {
  const res = await fetch(`https://api.clerk.com${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await res.json().catch(() => ({}))) as ClerkJson | ClerkJson[];
  return { status: res.status, json };
}

function asRecords(json: ClerkJson | ClerkJson[]): ClerkJson[] {
  if (Array.isArray(json)) return json;
  const data = json.data;
  if (Array.isArray(data)) return data as ClerkJson[];
  return [];
}

export function createBackendClerkInvitationClient(
  secretKey: string,
): ClerkInvitationClient {
  return {
    async listUsersByEmail(email) {
      const result = await clerkFetch(
        `/v1/users?email_address=${encodeURIComponent(email)}&limit=5`,
        {},
        secretKey,
      );
      return asRecords(result.json)
        .map((row) => ({ id: typeof row.id === "string" ? row.id : "" }))
        .filter((row) => row.id);
    },
    async listPendingInvitations() {
      const result = await clerkFetch("/v1/invitations?status=pending&limit=100", {}, secretKey);
      return asRecords(result.json).map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        emailAddress: typeof row.email_address === "string" ? row.email_address : "",
        url: typeof row.url === "string" ? row.url : null,
        status: typeof row.status === "string" ? row.status : "pending",
      }));
    },
    async createInvitation(email, redirectUrl) {
      const result = await clerkFetch(
        "/v1/invitations",
        {
          method: "POST",
          body: {
            email_address: email,
            notify: false,
            ignore_existing: true,
            expires_in_days: 7,
            ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
          },
        },
        secretKey,
      );
      if (result.status >= 400) {
        logger.warn("Clerk application invitation was not created");
        return { url: null };
      }
      const json = Array.isArray(result.json) ? {} : result.json;
      return { url: typeof json.url === "string" ? json.url : null };
    },
  };
}

export async function resolveClerkInvitedSignupFromEnv(
  email: string,
  redirectUrl?: string,
): Promise<{ clerkUserExists: boolean; invitationUrl: string | null }> {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) return { clerkUserExists: false, invitationUrl: null };
  try {
    return await resolveClerkInvitedSignup(
      email,
      createBackendClerkInvitationClient(secretKey),
      redirectUrl,
    );
  } catch {
    logger.warn("Clerk invited signup lookup failed");
    return { clerkUserExists: false, invitationUrl: null };
  }
}
