import { and, eq } from "drizzle-orm";
import { documentFolders, documents } from "@nyayagrid/database";
import { moveDocumentToFolderSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; documentId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { matterId, documentId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "documents.edit",
    });
    const body = moveDocumentToFolderSchema.parse(await request.json());

    const [doc] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.matterId, matterId),
          eq(documents.organizationId, matter.organizationId),
        ),
      )
      .limit(1);
    if (!doc) return jsonError("NOT_FOUND", "Document not found in matter", 404);

    if (body.folderId !== null) {
      const [folder] = await db
        .select()
        .from(documentFolders)
        .where(
          and(
            eq(documentFolders.id, body.folderId),
            eq(documentFolders.matterId, matterId),
            eq(documentFolders.organizationId, matter.organizationId),
          ),
        )
        .limit(1);
      if (!folder) return jsonError("NOT_FOUND", "Folder not found in matter", 404);
    }

    const [updated] = await db
      .update(documents)
      .set({ folderId: body.folderId, updatedAt: new Date() })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.matterId, matterId),
          eq(documents.organizationId, matter.organizationId),
        ),
      )
      .returning();

    await writeAuditEvent(db, {
      organizationId: matter.organizationId,
      actorUserId: user.id,
      matterId,
      action: "document.moved_to_folder",
      targetType: "document",
      targetId: documentId,
      metadata: {
        folderId: body.folderId,
        previousFolderId: doc.folderId,
      },
    });
    return jsonOk({ document: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}
