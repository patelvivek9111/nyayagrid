import { markImportantSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { markDocumentImportant } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; documentId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, documentId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "documents.edit",
    });
    const body = markImportantSchema.parse(await request.json());
    const reviewState = await markDocumentImportant({
      db,
      organizationId: matter.organizationId,
      matterId,
      documentId,
      important: body.important,
      userId: user.id,
    });
    return jsonOk({ reviewState });
  } catch (error) {
    return handleRouteError(error);
  }
}
