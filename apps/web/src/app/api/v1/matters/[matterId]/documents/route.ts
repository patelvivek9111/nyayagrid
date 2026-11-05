import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, exists, gt, inArray, lt, or, sql } from "drizzle-orm";
import { documents, documentVersions } from "@nyayagrid/database";
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  cursorPaginationSchema,
} from "@nyayagrid/validation";
import { decodeCursor, paginate, type CursorPayload } from "@nyayagrid/platform";
import {
  requireMatterAccess,
  storageKeyForOrganization,
  writeAuditEvent,
} from "@nyayagrid/permissions";
import { sha256Buffer, rejectZipBombsOrArchives, UploadLimitError, ingestIdempotencyKey } from "@nyayagrid/documents";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { getStorage } from "@/lib/infra";
import { enforceRateLimit } from "@/lib/rate-limit";
import { enqueueDocumentIngest, latestIntelligenceStatus } from "@/server/document-ingest";
import {
  DOCUMENT_SEARCH_QUERY_MAX,
  ilikeContainsPattern,
  normalizeDocumentSearchQuery,
  parseDocumentListSort,
  parseDocumentListStatus,
  processingStatesForFilter,
  tallyDocumentProcessing,
} from "@/lib/document-list";

type Params = { params: Promise<{ matterId: string }> };

type DocumentCursor = { createdAt?: string; title?: string; id: string };

const documentListQuerySchema = cursorPaginationSchema.extend({
  q: z.string().max(DOCUMENT_SEARCH_QUERY_MAX).optional().nullable(),
  status: z.enum(["ready", "processing", "attention"]).optional().nullable(),
  sort: z.enum(["newest", "oldest", "name_asc", "name_desc"]).optional().nullable(),
});

/**
 * Cursor-paginated (see `@nyayagrid/platform`'s pagination module for the general pattern): a
 * matter can hold thousands of documents, so this list is fetched `limit + 1` rows at a time.
 * Optional `q` / `status` filter the full matter (org-scoped), not only the current page.
 */
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

    const url = new URL(request.url);
    const parsed = documentListQuerySchema.parse({
      limit: url.searchParams.get("limit") || undefined,
      cursor: url.searchParams.get("cursor") || undefined,
      q: (url.searchParams.get("q") ?? "").slice(0, DOCUMENT_SEARCH_QUERY_MAX) || undefined,
      status: parseDocumentListStatus(url.searchParams.get("status")),
      sort: parseDocumentListSort(url.searchParams.get("sort")),
    });
    const { limit, cursor } = parsed;
    const query = normalizeDocumentSearchQuery(parsed.q);
    const status = parseDocumentListStatus(parsed.status);
    const sort = parseDocumentListSort(parsed.sort);
    const after = decodeCursor<DocumentCursor>(cursor);
    const afterCreatedAt = after?.createdAt ? new Date(after.createdAt) : null;
    const pattern = query ? ilikeContainsPattern(query) : null;
    const statusStates = processingStatesForFilter(status);

    const scope = [
      eq(documents.matterId, matterId),
      eq(documents.organizationId, matter.organizationId),
    ];
    if (statusStates) {
      scope.push(
        inArray(
          documents.processingState,
          statusStates as Array<(typeof documents.processingState.enumValues)[number]>,
        ),
      );
    }
    if (pattern) {
      scope.push(
        or(
          sql`${documents.title} ILIKE ${pattern} ESCAPE '\\'`,
          exists(
            db
              .select({ id: documentVersions.id })
              .from(documentVersions)
              .where(
                and(
                  eq(documentVersions.documentId, documents.id),
                  eq(documentVersions.organizationId, matter.organizationId),
                  sql`${documentVersions.originalFilename} ILIKE ${pattern} ESCAPE '\\'`,
                ),
              ),
          ),
        )!,
      );
    }

    let cursorClause;
    if (sort === "oldest" && afterCreatedAt && after?.id) {
      cursorClause = or(
        gt(documents.createdAt, afterCreatedAt),
        and(eq(documents.createdAt, afterCreatedAt), gt(documents.id, after.id)),
      );
    } else if (sort === "name_asc" && after?.title != null && after.id) {
      cursorClause = or(
        gt(documents.title, after.title),
        and(eq(documents.title, after.title), gt(documents.id, after.id)),
      );
    } else if (sort === "name_desc" && after?.title != null && after.id) {
      cursorClause = or(
        lt(documents.title, after.title),
        and(eq(documents.title, after.title), lt(documents.id, after.id)),
      );
    } else if (sort === "newest" && afterCreatedAt && after?.id) {
      cursorClause = or(
        lt(documents.createdAt, afterCreatedAt),
        and(eq(documents.createdAt, afterCreatedAt), lt(documents.id, after.id)),
      );
    }

    const orderBy =
      sort === "oldest"
        ? [asc(documents.createdAt), asc(documents.id)]
        : sort === "name_asc"
          ? [asc(documents.title), asc(documents.id)]
          : sort === "name_desc"
            ? [desc(documents.title), desc(documents.id)]
            : [desc(documents.createdAt), desc(documents.id)];

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(...scope));

    const groupedStates = await db
      .select({
        processingState: documents.processingState,
        count: sql<number>`count(*)::int`,
      })
      .from(documents)
      .where(
        and(eq(documents.matterId, matterId), eq(documents.organizationId, matter.organizationId)),
      )
      .groupBy(documents.processingState);
    const processingSummary = tallyDocumentProcessing(groupedStates);

    const rows = await db
      .select()
      .from(documents)
      .where(cursorClause ? and(...scope, cursorClause) : and(...scope))
      .orderBy(...orderBy)
      .limit(limit + 1);

    const page = paginate(rows, limit, (row): CursorPayload => {
      if (sort === "name_asc" || sort === "name_desc") {
        return { title: row.title, id: row.id };
      }
      return { createdAt: row.createdAt.toISOString(), id: row.id };
    });

    const versions = page.items.length
      ? await db
          .select()
          .from(documentVersions)
          .where(
            and(
              eq(documentVersions.organizationId, matter.organizationId),
              inArray(
                documentVersions.documentId,
                page.items.map((doc) => doc.id),
              ),
            ),
          )
      : [];
    const latestVersionByDocument = new Map<string, (typeof versions)[number]>();
    for (const version of versions) {
      const current = latestVersionByDocument.get(version.documentId);
      if (!current || version.versionNumber > current.versionNumber) {
        latestVersionByDocument.set(version.documentId, version);
      }
    }

    const intelByVersion = await latestIntelligenceStatus({
      db,
      organizationId: matter.organizationId,
      documentVersionIds: [...latestVersionByDocument.values()].map((row) => row.id),
    });

    const documentsWithVersion = page.items.map((doc) => {
      const latest = latestVersionByDocument.get(doc.id);
      return {
        ...doc,
        latestVersionId: latest?.id ?? null,
        latestVersionNumber: latest?.versionNumber ?? null,
        intelligenceStatus: latest?.id ? (intelByVersion.get(latest.id) ?? null) : null,
      };
    });

    return jsonOk({
      documents: documentsWithVersion,
      nextCursor: page.nextCursor,
      total: countRow?.count ?? page.items.length,
      processingSummary,
    });
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
      capability: "documents.upload",
    });

    const limited = await enforceRateLimit(request, {
      endpointClass: "upload",
      organizationId: matter.organizationId,
      userId: user.id,
    });
    if (limited) return limited;

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError("VALIDATION_ERROR", "file is required", 400);
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      return jsonError("VALIDATION_ERROR", "Invalid file size", 400);
    }
    const contentType = file.type || "application/octet-stream";
    const allowed = (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(contentType);
    const lower = file.name.toLowerCase();
    const allowedExt =
      lower.endsWith(".pdf") ||
      lower.endsWith(".docx") ||
      lower.endsWith(".txt") ||
      lower.endsWith(".md");
    if (!allowed && !allowedExt) {
      return jsonError("VALIDATION_ERROR", "Unsupported file type", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      rejectZipBombsOrArchives({
        contentType,
        filename: file.name,
        buffer,
      });
    } catch (error) {
      if (error instanceof UploadLimitError) {
        return jsonError(error.code, error.message, 400);
      }
      throw error;
    }
    const hash = sha256Buffer(buffer);
    const documentId = randomUUID();
    const versionId = randomUUID();
    const storageKey = storageKeyForOrganization({
      organizationId: matter.organizationId,
      documentId,
      versionId,
      filename: file.name,
    });

    const storage = getStorage();
    await storage.ensureBucket();
    await storage.putObject({
      key: storageKey,
      body: buffer,
      contentType,
      metadata: {
        organizationId: matter.organizationId,
        matterId,
        sha256: hash,
      },
    });

    const [document] = await db
      .insert(documents)
      .values({
        id: documentId,
        organizationId: matter.organizationId,
        matterId,
        createdByUserId: user.id,
        title: file.name,
        processingState: "uploaded",
        malwareScanStatus: "not_scanned",
      })
      .returning();

    const [version] = await db
      .insert(documentVersions)
      .values({
        id: versionId,
        documentId,
        organizationId: matter.organizationId,
        versionNumber: 1,
        storageKey,
        contentType,
        byteSize: buffer.length,
        sha256: hash,
        originalFilename: file.name,
        uploadedByUserId: user.id,
      })
      .returning();

    await writeAuditEvent(db, {
      organizationId: matter.organizationId,
      actorUserId: user.id,
      matterId,
      action: "document.uploaded",
      targetType: "document",
      targetId: documentId,
      metadata: { filename: file.name, sha256: hash, byteSize: buffer.length },
    });

    const ingestPayload = {
      organizationId: matter.organizationId,
      matterId,
      documentId,
      documentVersionId: versionId,
      userId: user.id,
      idempotencyKey: ingestIdempotencyKey(versionId),
    };

    try {
      await enqueueDocumentIngest(ingestPayload);
    } catch {
      await db
        .update(documents)
        .set({
          processingState: "failed",
          processingError: "Failed to enqueue background processing",
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));
      return jsonError("INGEST_ENQUEUE_FAILED", "Upload stored but processing could not be queued", 503);
    }

    const [fresh] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);

    return jsonOk(
      {
        document: fresh ?? document,
        version,
        processing: {
          accepted: true,
          state: fresh?.processingState ?? "uploaded",
          queued: true,
        },
      },
      { status: 202 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
