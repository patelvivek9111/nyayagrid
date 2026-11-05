import { createTimelineEventSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { createManualTimelineEvent, listTimelineEvents } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const events = await listTimelineEvents({
      db,
      organizationId: matter.organizationId,
      matterId,
      status: statusParam ? statusParam.split(",") : undefined,
      includeSources: true,
      includeContradictionLinks: url.searchParams.get("includeContradictionLinks") !== "false",
    });
    return jsonOk({ events });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "timeline.manage",
    });
    const body = createTimelineEventSchema.parse(await request.json());
    const event = await createManualTimelineEvent({
      db,
      organizationId: matter.organizationId,
      matterId,
      userId: user.id,
      ...body,
    });
    return jsonOk({ event }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
