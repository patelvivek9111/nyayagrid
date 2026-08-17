import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

export type ClerkWebhookHeaders = {
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
};

export class ClerkWebhookSignatureError extends Error {
  readonly code = "CLERK_WEBHOOK_INVALID";
  constructor(message = "Clerk webhook signature is invalid") {
    super(message);
    this.name = "ClerkWebhookSignatureError";
  }
}

function decodeWhsec(secret: string): Buffer {
  const trimmed = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(trimmed, "base64");
}

/**
 * Verifies a Clerk/Svix webhook signature. Identity lifecycle only — callers must not grant
 * capabilities from the payload.
 */
export function verifyClerkWebhookSignature(params: {
  payload: string;
  headers: ClerkWebhookHeaders;
  secret: string;
  nowMs?: number;
  toleranceMs?: number;
}): void {
  const now = params.nowMs ?? Date.now();
  const tolerance = params.toleranceMs ?? DEFAULT_TOLERANCE_MS;
  const timestampMs = Number(params.headers.svixTimestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > tolerance) {
    throw new ClerkWebhookSignatureError(
      "Clerk webhook timestamp is outside the allowed tolerance",
    );
  }

  const signed = `${params.headers.svixId}.${params.headers.svixTimestamp}.${params.payload}`;
  const expected = createHmac("sha256", decodeWhsec(params.secret)).update(signed).digest("base64");
  const signatures = params.headers.svixSignature
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .map((part) => part.slice(3));

  const expectedBuf = Buffer.from(expected);
  const matches = signatures.some((signature) => {
    const candidate = Buffer.from(signature);
    return candidate.length === expectedBuf.length && timingSafeEqual(candidate, expectedBuf);
  });
  if (!matches) {
    throw new ClerkWebhookSignatureError();
  }
}

export function clerkWebhookHeadersFromRequest(headers: Headers): ClerkWebhookHeaders {
  const svixId = headers.get("svix-id") ?? "";
  const svixTimestamp = headers.get("svix-timestamp") ?? "";
  const svixSignature = headers.get("svix-signature") ?? "";
  if (!svixId || !svixTimestamp || !svixSignature) {
    throw new ClerkWebhookSignatureError("Clerk webhook is missing Svix signature headers");
  }
  return { svixId, svixTimestamp, svixSignature };
}

type ClerkEmail = { id?: string; email_address?: string };

export type ClerkWebhookUserData = {
  id?: string;
  email_addresses?: ClerkEmail[];
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  deleted?: boolean;
};

export type ClerkWebhookEvent = {
  type: string;
  data: ClerkWebhookUserData;
};

export type ClerkWebhookAction =
  | { kind: "upsert_identity"; subject: string; email: string; name: string | null }
  | { kind: "user_deleted"; subject: string }
  | { kind: "ignored"; reason: string };

function emailFromClerkUser(data: ClerkWebhookUserData): string | null {
  const emails = data.email_addresses ?? [];
  const primary = emails.find((row) => row.id && row.id === data.primary_email_address_id);
  const chosen = primary?.email_address ?? emails[0]?.email_address;
  const trimmed = chosen?.trim();
  return trimmed ? trimmed : null;
}

function nameFromClerkUser(data: ClerkWebhookUserData): string | null {
  const name = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : null;
}

/**
 * Maps a verified Clerk webhook to an identity-only action. Organization membership events are
 * ignored: authorization stays in `@nyayagrid/permissions`.
 */
export function clerkWebhookAction(event: ClerkWebhookEvent): ClerkWebhookAction {
  if (event.type === "user.created" || event.type === "user.updated") {
    const subject = event.data.id?.trim();
    const email = emailFromClerkUser(event.data);
    if (!subject || !email) {
      return { kind: "ignored", reason: "user event is missing id or email" };
    }
    return {
      kind: "upsert_identity",
      subject,
      email,
      name: nameFromClerkUser(event.data),
    };
  }
  if (event.type === "user.deleted") {
    const subject = event.data.id?.trim();
    if (!subject) return { kind: "ignored", reason: "user.deleted is missing id" };
    return { kind: "user_deleted", subject };
  }
  if (event.type.startsWith("organization") || event.type.startsWith("organizationMembership")) {
    return {
      kind: "ignored",
      reason: "IdP organization membership does not grant NyayaGrid capabilities",
    };
  }
  return { kind: "ignored", reason: `unhandled Clerk event type ${event.type}` };
}
