import { createResearchSessionSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { createResearchSession, listResearchSessions } from "@nyayagrid/research";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

const matterResearchSessionSchema = createResearchSessionSchema.omit({
  organizationId: true,
  matterId: true,
});

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
    const sessions = await listResearchSessions({
      db,
      organizationId: matter.organizationId,
      matterId,
    });
    return jsonOk({ sessions });
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
      capability: "research.run",
    });
    const body = matterResearchSessionSchema.parse(await request.json());
    const session = await createResearchSession({
      db,
      organizationId: matter.organizationId,
      matterId,
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
