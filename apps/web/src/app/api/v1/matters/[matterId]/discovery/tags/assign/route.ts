import { assignTagSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { assignTag } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

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
    const body = assignTagSchema.parse(await request.json());
    const assignment = await assignTag({
      db,
      organizationId: matter.organizationId,
      matterId,
      documentId: body.documentId,
      tagId: body.tagId,
      userId: user.id,
    });
    return jsonOk({ assignment }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
