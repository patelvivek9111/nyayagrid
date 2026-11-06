import { and, asc, eq, isNull } from "drizzle-orm";
import { documentFolders } from "@nyayagrid/database";
import { createDocumentFolderSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "documents.view",
    });
    const rows = await db
      .select()
      .from(documentFolders)
      .where(
        and(
          eq(documentFolders.matterId, matterId),
          eq(documentFolders.organizationId, matter.organizationId),
        ),
      )
      .orderBy(asc(documentFolders.name));
    return jsonOk({ folders: rows });
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
      capability: "documents.edit",
    });
    const body = createDocumentFolderSchema.parse(await request.json());

    if (body.parentFolderId) {
      const [parent] = await db
        .select()
        .from(documentFolders)
        .where(
          and(
            eq(documentFolders.id, body.parentFolderId),
            eq(documentFolders.matterId, matterId),
            eq(documentFolders.organizationId, matter.organizationId),
          ),
        )
        .limit(1);
      if (!parent) return jsonError("NOT_FOUND", "Parent folder not found in matter", 404);
    }

    const siblingWhere = body.parentFolderId
      ? and(
          eq(documentFolders.matterId, matterId),
          eq(documentFolders.organizationId, matter.organizationId),
          eq(documentFolders.parentFolderId, body.parentFolderId),
          eq(documentFolders.name, body.name),
        )
      : and(
          eq(documentFolders.matterId, matterId),
          eq(documentFolders.organizationId, matter.organizationId),
          isNull(documentFolders.parentFolderId),
          eq(documentFolders.name, body.name),
        );
    const [duplicate] = await db.select().from(documentFolders).where(siblingWhere).limit(1);
    if (duplicate) {
      return jsonError("CONFLICT", "A folder with this name already exists under the parent", 409);
    }

    const [created] = await db
      .insert(documentFolders)
      .values({
        organizationId: matter.organizationId,
        matterId,
        parentFolderId: body.parentFolderId ?? null,
        name: body.name,
        createdByUserId: user.id,
      })
      .returning();

    await writeAuditEvent(db, {
      organizationId: matter.organizationId,
      actorUserId: user.id,
      matterId,
      action: "document_folder.created",
      targetType: "document_folder",
      targetId: created!.id,
      metadata: { parentFolderId: body.parentFolderId ?? null, name: body.name },
    });
    return jsonOk({ folder: created }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
