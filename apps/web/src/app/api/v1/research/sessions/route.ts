import { createResearchSessionSchema } from "@nyayagrid/validation";
import { filterVisibleResearchSessions, createResearchSession, listResearchSessions } from "@nyayagrid/research";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  authorizedMatterIdsForResearch,
  requireResearchMatterAccess,
  requireResearchRunCapability,
} from "@/server/research-access";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return jsonError("VALIDATION_ERROR", "organizationId is required", 400);
    }
    await requireResearchRunCapability(db, { userId: user.id, organizationId });
    const limited = await enforceRateLimit(request, {
      endpointClass: "research",
      organizationId,
      userId: user.id,
    });
    if (limited) return limited;

    const matterId = url.searchParams.get("matterId");
    if (matterId) {
      await requireResearchMatterAccess(db, { userId: user.id, organizationId, matterId });
    }

    const statusParam = url.searchParams.get("status");
    const sessions = await listResearchSessions({
      db,
      organizationId,
      matterId: matterId ?? undefined,
      status: statusParam === "active" || statusParam === "archived" ? statusParam : undefined,
    });
    const authorizedMatterIds = await authorizedMatterIdsForResearch(db, {
      userId: user.id,
      organizationId,
    });
    return jsonOk({ sessions: filterVisibleResearchSessions(sessions, authorizedMatterIds) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = createResearchSessionSchema.parse(await request.json());
    await requireResearchRunCapability(db, {
      userId: user.id,
      organizationId: body.organizationId,
    });
    const limited = await enforceRateLimit(request, {
      endpointClass: "research",
      organizationId: body.organizationId,
      userId: user.id,
    });
    if (limited) return limited;

    if (body.matterId) {
      await requireResearchMatterAccess(db, {
        userId: user.id,
        organizationId: body.organizationId,
        matterId: body.matterId,
      });
    }

    const session = await createResearchSession({
      db,
      organizationId: body.organizationId,
      matterId: body.matterId ?? null,
      userId: user.id,
      title: body.title,
      jurisdictionFilters: body.jurisdictionFilters,
      authorityTypeFilters: body.authorityTypeFilters,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
    });
    return jsonOk({ session }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
