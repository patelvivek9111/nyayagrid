import { desc, eq } from "drizzle-orm";
import { dataDeletionRequests } from "@nyayagrid/database";
import { placeLegalHoldSchema, requestDataDeletionSchema } from "@nyayagrid/validation";
import { requireCapability } from "@nyayagrid/permissions";
import {
  listLegalHolds,
  placeLegalHold,
  requestDataDeletion,
} from "@nyayagrid/platform";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { organizationId } = await params;
    const { db, user } = await requireUser(request.headers);
    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "compliance.manage",
    });
    const url = new URL(request.url);
    const matterId = url.searchParams.get("matterId");
    const holds = await listLegalHolds({
      db,
      organizationId,
      matterId: matterId || null,
    });
    const deletions = await db
      .select()
      .from(dataDeletionRequests)
      .where(eq(dataDeletionRequests.organizationId, organizationId))
      .orderBy(desc(dataDeletionRequests.createdAt))
      .limit(50);
    return jsonOk({ holds, deletionRequests: deletions });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { organizationId } = await params;
    const { db, user } = await requireUser(request.headers);
    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "compliance.manage",
    });
    const body = (await request.json()) as { kind?: string };
    if (body.kind === "deletion") {
      const parsed = requestDataDeletionSchema.parse(body);
      if (parsed.scopeType === "user_personal_data") {
        return jsonError("VALIDATION_ERROR", "Use GET /api/v1/me/export for personal data", 400);
      }
      if (parsed.scopeType === "matter" && !parsed.matterId) {
        return jsonError("VALIDATION_ERROR", "matterId is required for a matter deletion request", 400);
      }
      const requestRow = await requestDataDeletion({
        db,
        userId: user.id,
        workspace: "professional",
        organizationId,
        scope: {
          matterIds: parsed.matterId ? [parsed.matterId] : undefined,
          note: parsed.reason ?? undefined,
        },
        scheduledFor: parsed.scheduledAt ? new Date(parsed.scheduledAt) : null,
      });
      return jsonOk({ deletionRequest: requestRow }, { status: 201 });
    }

    const parsed = placeLegalHoldSchema.parse(body);
    const hold = await placeLegalHold({
      db,
      organizationId,
      userId: user.id,
      matterId: parsed.matterId,
      documentId: parsed.documentId,
      reason: parsed.reason,
    });
    return jsonOk({ hold }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
