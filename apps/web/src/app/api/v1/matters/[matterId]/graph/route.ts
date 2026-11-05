import { materializeGraphSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { listGraph, materializeVerifiedGraph } from "@nyayagrid/intelligence";
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
    const data = await listGraph({
      db,
      organizationId: matter.organizationId,
      matterId,
      nodeType: url.searchParams.get("nodeType") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      edgeStatus: url.searchParams.get("edgeStatus") ?? undefined,
    });
    return jsonOk(data);
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
    const body = materializeGraphSchema.parse(await request.json().catch(() => ({})));
    const result = await materializeVerifiedGraph({
      db,
      organizationId: matter.organizationId,
      matterId,
      userId: user.id,
      force: body.force ?? true,
    });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
