import { and, eq, isNull, ne } from "drizzle-orm";
import { documentFolders, documents } from "@nyayagrid/database";
import { buildFolderParentMap, wouldCreateFolderCycle } from "@nyayagrid/documents";
import { updateDocumentFolderSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; folderId: string }> };

async function loadFolder(
  db: Awaited<ReturnType<typeof requireUser>>["db"],
  matterId: string,
  organizationId: string,
  folderId: string,
) {
  const [folder] = await db
    .select()
    .from(documentFolders)
    .where(
      and(
        eq(documentFolders.id, folderId),
        eq(documentFolders.matterId, matterId),
        eq(documentFolders.organizationId, organizationId),
      ),
    )
    .limit(1);
  return folder ?? null;
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId, folderId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "documents.view",
    });
    const folder = await loadFolder(db, matterId, matter.organizationId, folderId);
    if (!folder) return jsonError("NOT_FOUND", "Folder not found", 404);
    return jsonOk({ folder });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { matterId, folderId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "documents.edit",
    });
    const existing = await loadFolder(db, matterId, matter.organizationId, folderId);
    if (!existing) return jsonError("NOT_FOUND", "Folder not found", 404);

    const body = updateDocumentFolderSchema.parse(await request.json());
    const nextName = body.name ?? existing.name;
    const nextParent =
      body.parentFolderId === undefined ? existing.parentFolderId : body.parentFolderId;

    if (body.parentFolderId !== undefined && body.parentFolderId !== null) {
      const parent = await loadFolder(db, matterId, matter.organizationId, body.parentFolderId);
      if (!parent) return jsonError("NOT_FOUND", "Parent folder not found in matter", 404);
    }

    if (body.parentFolderId !== undefined) {
      const siblings = await db
        .select({ id: documentFolders.id, parentFolderId: documentFolders.parentFolderId })
        .from(documentFolders)
        .where(
          and(
            eq(documentFolders.matterId, matterId),
            eq(documentFolders.organizationId, matter.organizationId),
          ),
        );
      const parentById = buildFolderParentMap(siblings);
      if (wouldCreateFolderCycle(folderId, nextParent, parentById)) {
        return jsonError("VALIDATION_ERROR", "Folder move would create a cycle", 400);
      }
    }

    const siblingWhere =
      nextParent == null
        ? and(
            eq(documentFolders.matterId, matterId),
            eq(documentFolders.organizationId, matter.organizationId),
            isNull(documentFolders.parentFolderId),
            eq(documentFolders.name, nextName),
            ne(documentFolders.id, folderId),
          )
        : and(
            eq(documentFolders.matterId, matterId),
            eq(documentFolders.organizationId, matter.organizationId),
            eq(documentFolders.parentFolderId, nextParent),
            eq(documentFolders.name, nextName),
            ne(documentFolders.id, folderId),
          );
    const [duplicate] = await db.select().from(documentFolders).where(siblingWhere).limit(1);
    if (duplicate) {
      return jsonError("CONFLICT", "A folder with this name already exists under the parent", 409);
    }

    const [updated] = await db
      .update(documentFolders)
      .set({
        name: nextName,
        parentFolderId: nextParent,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documentFolders.id, folderId),
          eq(documentFolders.matterId, matterId),
          eq(documentFolders.organizationId, matter.organizationId),
        ),
      )
      .returning();

    await writeAuditEvent(db, {
      organizationId: matter.organizationId,
      actorUserId: user.id,
      matterId,
      action: "document_folder.updated",
      targetType: "document_folder",
      targetId: folderId,
      metadata: {
        name: nextName,
        parentFolderId: nextParent,
        previousParentFolderId: existing.parentFolderId,
      },
    });
    return jsonOk({ folder: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { matterId, folderId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "documents.edit",
    });
    const existing = await loadFolder(db, matterId, matter.organizationId, folderId);
    if (!existing) return jsonError("NOT_FOUND", "Folder not found", 404);

    const [child] = await db
      .select({ id: documentFolders.id })
      .from(documentFolders)
      .where(
        and(
          eq(documentFolders.parentFolderId, folderId),
          eq(documentFolders.matterId, matterId),
          eq(documentFolders.organizationId, matter.organizationId),
        ),
      )
      .limit(1);
    if (child) {
      return jsonError("CONFLICT", "Folder has child folders; move or delete children first", 409);
    }

    // Documents keep their rows; folder_id is set null by ON DELETE SET NULL — clear explicitly for audit clarity.
    await db
      .update(documents)
      .set({ folderId: null, updatedAt: new Date() })
      .where(
        and(
          eq(documents.folderId, folderId),
          eq(documents.matterId, matterId),
          eq(documents.organizationId, matter.organizationId),
        ),
      );

    await db
      .delete(documentFolders)
      .where(
        and(
          eq(documentFolders.id, folderId),
          eq(documentFolders.matterId, matterId),
          eq(documentFolders.organizationId, matter.organizationId),
        ),
      );

    await writeAuditEvent(db, {
      organizationId: matter.organizationId,
      actorUserId: user.id,
      matterId,
      action: "document_folder.deleted",
      targetType: "document_folder",
      targetId: folderId,
      metadata: { name: existing.name },
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
