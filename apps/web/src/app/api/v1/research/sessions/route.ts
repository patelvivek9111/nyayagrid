import { createResearchSessionSchema } from "@nyayagrid/validation";
import { requireAnyCapability } from "@nyayagrid/permissions";
import { createResearchSession, listResearchSessions } from "@nyayagrid/research";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

const RESEARCH_CAPABILITIES = ["research.run", "matters.view"] as const;

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return jsonError("VALIDATION_ERROR", "organizationId is required", 400);
    }
    await requireAnyCapability(db, {
      userId: user.id,
      organizationId,
      capabilities: [...RESEARCH_CAPABILITIES],
    });
    const statusParam = url.searchParams.get("status");
    const sessions = await listResearchSessions({
      db,
      organizationId,
      matterId: url.searchParams.get("matterId") ?? undefined,
      status: statusParam === "active" || statusParam === "archived" ? statusParam : undefined,
    });
    return jsonOk({ sessions });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = createResearchSessionSchema.parse(await request.json());
    await requireAnyCapability(db, {
      userId: user.id,
      organizationId: body.organizationId,
      capabilities: [...RESEARCH_CAPABILITIES],
    });
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
