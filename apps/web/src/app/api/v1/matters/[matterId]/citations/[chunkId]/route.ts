import { eq } from "drizzle-orm";
import { documents } from "@nyayagrid/database";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { getChunkCitation } from "@/server/nyaya";

type Params = { params: Promise<{ matterId: string; chunkId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId, chunkId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "documents.view",
    });
    const chunk = await getChunkCitation({
      db,
      organizationId: matter.organizationId,
      matterId,
      chunkId,
    });
    if (!chunk) return jsonError("NOT_FOUND", "Citation source not found in matter scope", 404);

    const [document] = await db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(eq(documents.id, chunk.documentId))
      .limit(1);

    return jsonOk({
      chunk: {
        id: chunk.id,
        documentId: chunk.documentId,
        documentVersionId: chunk.documentVersionId,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        segmentRef: chunk.segmentRef,
        content: chunk.content,
      },
      document: document ?? { id: chunk.documentId, title: "Case document" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
