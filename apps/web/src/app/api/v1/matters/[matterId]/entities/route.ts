import { createMatterEntitySchema, mergeMatterEntitiesSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import {
  createManualMatterEntity,
  listMatterEntities,
  mergeMatterEntities,
} from "@nyayagrid/intelligence";
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
    const entities = await listMatterEntities({
      db,
      organizationId: matter.organizationId,
      matterId,
      status: url.searchParams.get("status"),
    });

    return jsonOk({ entities });
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
    const json = await request.json();
    if (json?.keepEntityId && json?.mergeEntityId) {
      const body = mergeMatterEntitiesSchema.parse(json);
      const entity = await mergeMatterEntities({
        db,
        organizationId: matter.organizationId,
        matterId,
        userId: user.id,
        ...body,
      });
      return jsonOk({ entity });
    }
    const body = createMatterEntitySchema.parse(json);
    const entity = await createManualMatterEntity({
      db,
      organizationId: matter.organizationId,
      matterId,
      userId: user.id,
      ...body,
    });
    return jsonOk({ entity }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
