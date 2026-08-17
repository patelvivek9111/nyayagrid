import { NextResponse } from "next/server";
import {
  clerkWebhookAction,
  clerkWebhookHeadersFromRequest,
  ensureUserFromIdentity,
  verifyClerkWebhookSignature,
  type ClerkWebhookEvent,
} from "@nyayagrid/auth";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { getDb } from "@/lib/db";

/**
 * Clerk identity lifecycle webhook. Signature-verified. Does not grant capabilities from IdP
 * organization metadata — authorization stays in `@nyayagrid/permissions`.
 */
export async function POST(request: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: { code: "NOT_CONFIGURED" } }, { status: 503 });
  }

  const payload = await request.text();
  try {
    verifyClerkWebhookSignature({
      payload,
      secret,
      headers: clerkWebhookHeadersFromRequest(request.headers),
    });
  } catch {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }

  let event: ClerkWebhookEvent;
  try {
    event = JSON.parse(payload) as ClerkWebhookEvent;
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON" } }, { status: 400 });
  }

  const action = clerkWebhookAction(event);
  const db = getDb();

  if (action.kind === "upsert_identity") {
    await ensureUserFromIdentity(db, {
      subject: action.subject,
      email: action.email,
      name: action.name,
    });
    await writeAuditEvent(db, {
      action: "identity.clerk_user_upserted",
      targetType: "user",
      targetId: action.subject,
      metadata: { eventType: event.type },
    });
  } else if (action.kind === "user_deleted") {
    await writeAuditEvent(db, {
      action: "identity.clerk_user_deleted",
      targetType: "user",
      targetId: action.subject,
      metadata: {
        eventType: event.type,
        note: "NyayaGrid user row is retained; legal records are not cascade-deleted from an IdP event",
      },
    });
  }

  return NextResponse.json({ ok: true, action: action.kind });
}
