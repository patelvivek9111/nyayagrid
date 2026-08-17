import { desc, eq, guideDocuments } from "@nyayagrid/database";
import { ingestGuideDocumentSchema } from "@nyayagrid/validation";
import { ingestGuideDocument } from "@nyayagrid/workspaces";
import { requireGuideUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getEmbeddings } from "@/lib/infra";

/**
 * Nyaya Guide document library. Every document is private to the uploading user — there is no
 * organization/matter scope, so `requireUser` is the whole authorization boundary.
 */
export async function GET(request: Request) {
  try {
    const { db, user } = await requireGuideUser(request.headers);
    const documents = await db
      .select()
      .from(guideDocuments)
      .where(eq(guideDocuments.userId, user.id))
      .orderBy(desc(guideDocuments.createdAt));
    return jsonOk({ documents });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireGuideUser(request.headers);
    const body = ingestGuideDocumentSchema.parse(await request.json());
    const result = await ingestGuideDocument({
      db,
      userId: user.id,
      title: body.title,
      documentKind: body.documentKind ?? "other",
      content: body.content,
      embeddings: getEmbeddings(),
    });
    return jsonOk(
      {
        document: result.document,
        version: result.version,
        chunkCount: result.chunkCount,
        processingState: result.processingState,
        message: result.message,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
