import { linkGuideSituationDocumentSchema } from "@nyayagrid/validation";
import { linkDocument } from "@nyayagrid/workspaces";
import { requireGuideUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

/** Links an already-ingested Guide document to a situation. Both must be owned by this user. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireGuideUser(request.headers);
    const body = linkGuideSituationDocumentSchema.parse(await request.json());
    const link = await linkDocument(db, {
      situationId: id,
      documentId: body.documentId,
      userId: user.id,
    });
    return jsonOk({ link }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
