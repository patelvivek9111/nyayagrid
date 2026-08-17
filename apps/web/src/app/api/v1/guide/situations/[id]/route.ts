import {
  desc,
  eq,
  guideDocuments,
  guideSituationDocuments,
  guideSituationEvents,
} from "@nyayagrid/database";
import { updateGuideSituationSchema } from "@nyayagrid/validation";
import { assertGuideSituationOwnership, updateSituation } from "@nyayagrid/workspaces";
import { requireGuideUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireGuideUser(request.headers);
    const situation = await assertGuideSituationOwnership(db, { situationId: id, userId: user.id });

    const events = await db
      .select()
      .from(guideSituationEvents)
      .where(eq(guideSituationEvents.situationId, id))
      .orderBy(desc(guideSituationEvents.eventDate));

    const links = await db
      .select({ documentId: guideSituationDocuments.guideDocumentId })
      .from(guideSituationDocuments)
      .where(eq(guideSituationDocuments.situationId, id));

    const documentIds = links.map((link) => link.documentId);
    const documents =
      documentIds.length > 0
        ? await db
            .select()
            .from(guideDocuments)
            .where(eq(guideDocuments.userId, user.id))
            .then((rows) => rows.filter((row) => documentIds.includes(row.id)))
        : [];

    return jsonOk({ situation, events, documents });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireGuideUser(request.headers);
    const body = updateGuideSituationSchema.parse(await request.json());
    const situation = await updateSituation(db, { situationId: id, userId: user.id, input: body });
    return jsonOk({ situation });
  } catch (error) {
    return handleRouteError(error);
  }
}
