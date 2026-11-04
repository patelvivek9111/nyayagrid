import { and, desc, eq } from "drizzle-orm";
import { auditEvents } from "@nyayagrid/database";
import { writeAuditEvent } from "@nyayagrid/permissions";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  buildLegalAcceptanceAuditAction,
  getCurrentLegalDocuments,
  isKnownLegalVersion,
  type LegalDocumentKind,
} from "@nyayagrid/platform";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

const acceptSchema = z.object({
  kind: z.enum(["terms", "privacy"]),
  version: z.string().min(1).max(120),
  organizationId: z.string().uuid().optional().nullable(),
});

/**
 * GET — current legal document versions + whether this user accepted each current version.
 * POST — record acknowledgment of a known draft version (audit event; attorney review still PENDING).
 */
export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const docs = getCurrentLegalDocuments();
    const acceptances = [];
    for (const doc of docs) {
      const action = buildLegalAcceptanceAuditAction(doc.kind);
      const [event] = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.actorUserId, user.id), eq(auditEvents.action, action)))
        .orderBy(desc(auditEvents.createdAt))
        .limit(1);
      const acceptedVersion =
        event && event.metadata && typeof event.metadata === "object"
          ? String((event.metadata as { version?: string }).version ?? "")
          : "";
      acceptances.push({
        kind: doc.kind,
        path: doc.path,
        currentVersion: doc.version,
        status: doc.status,
        attorneyReview: doc.attorneyReview,
        acceptedVersion: acceptedVersion || null,
        acceptedCurrent: acceptedVersion === doc.version,
      });
    }
    return jsonOk({ documents: docs, acceptances });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = acceptSchema.parse(await request.json());
    const kind = body.kind as LegalDocumentKind;
    if (!isKnownLegalVersion(kind, body.version)) {
      return jsonError(
        "LEGAL_VERSION_MISMATCH",
        `Unknown or stale ${kind} version. Current terms=${CURRENT_TERMS_VERSION}, privacy=${CURRENT_PRIVACY_VERSION}.`,
        409,
      );
    }

    const action = buildLegalAcceptanceAuditAction(kind);
    await writeAuditEvent(db, {
      organizationId: body.organizationId ?? null,
      actorUserId: user.id,
      action,
      targetType: "legal_document",
      targetId: kind,
      metadata: {
        version: body.version,
        attorneyReview: "PENDING",
        status: "DRAFT_PENDING_ATTORNEY_REVIEW",
      },
    });

    return jsonOk({
      ok: true,
      kind,
      version: body.version,
      attorneyReview: "PENDING" as const,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
