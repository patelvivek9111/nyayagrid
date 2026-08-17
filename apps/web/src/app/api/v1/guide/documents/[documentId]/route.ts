import {
  asc,
  desc,
  eq,
  guideDocumentChunks,
  guideDocumentExplanations,
  guideDocumentVersions,
} from "@nyayagrid/database";
import { assertGuideDocumentOwnership } from "@nyayagrid/workspaces";
import { requireGuideUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ documentId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { documentId } = await params;
    const { db, user } = await requireGuideUser(request.headers);
    const document = await assertGuideDocumentOwnership(db, { documentId, userId: user.id });

    const [version] = await db
      .select()
      .from(guideDocumentVersions)
      .where(eq(guideDocumentVersions.documentId, document.id))
      .orderBy(desc(guideDocumentVersions.versionNumber))
      .limit(1);

    const chunks = await db
      .select()
      .from(guideDocumentChunks)
      .where(eq(guideDocumentChunks.documentId, document.id))
      .orderBy(asc(guideDocumentChunks.chunkIndex));

    const [explanation] = await db
      .select()
      .from(guideDocumentExplanations)
      .where(eq(guideDocumentExplanations.documentId, document.id))
      .orderBy(desc(guideDocumentExplanations.createdAt))
      .limit(1);

    return jsonOk({ document, version: version ?? null, chunks, explanation: explanation ?? null });
  } catch (error) {
    return handleRouteError(error);
  }
}
