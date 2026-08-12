import { createTagSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { createTag, listTags } from "@nyayagrid/intelligence";
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
    const tags = await listTags({
      db,
      organizationId: matter.organizationId,
      matterId,
      documentId: url.searchParams.get("documentId") ?? undefined,
    });
    return jsonOk({ tags });
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
      capability: "matters.edit",
    });
    const body = createTagSchema.parse(await request.json());
    const tag = await createTag({
      db,
      organizationId: matter.organizationId,
      matterId,
      userId: user.id,
      key: body.key ?? body.label,
      label: body.label,
    });
    return jsonOk({ tag }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
