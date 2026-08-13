import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { documents, documentVersions } from "@nyayagrid/database";
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  cursorPaginationSchema,
} from "@nyayagrid/validation";
import { decodeCursor, paginate } from "@nyayagrid/platform";
import {
  requireMatterAccess,
  storageKeyForOrganization,
  writeAuditEvent,
} from "@nyayagrid/permissions";
import { sha256Buffer } from "@nyayagrid/documents";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { getEmbeddings, getMalwareScanner, getStorage } from "@/lib/infra";
import { enforceRateLimit } from "@/lib/rate-limit";
import { processDocumentPipeline } from "@/server/document-pipeline";

type Params = { params: Promise<{ matterId: string }> };

type DocumentCursor = { createdAt: string; id: string };

/**
 * Cursor-paginated (see `@nyayagrid/platform`'s pagination module for the general pattern): a
 * matter can hold thousands of documents, so this list is fetched `limit + 1` rows at a time,
 * ordered by `(createdAt, id)` descending for a stable sort even when two documents share a
 * timestamp, and the extra row (if present) becomes the opaque `nextCursor` in the response.
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
    const { limit, cursor } = cursorPaginationSchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    const after = decodeCursor<DocumentCursor>(cursor);
    const afterCreatedAt = after ? new Date(after.createdAt) : null;

    const rows = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.matterId, matterId),
          eq(documents.organizationId, matter.organizationId),
          afterCreatedAt
            ? or(
                lt(documents.createdAt, afterCreatedAt),
                and(eq(documents.createdAt, afterCreatedAt), lt(documents.id, after!.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(documents.createdAt), desc(documents.id))
      .limit(limit + 1);

    const page = paginate(rows, limit, (row) => ({
      createdAt: row.createdAt.toISOString(),
      id: row.id,
    }));

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

    const documentsWithVersion = page.items.map((doc) => {
      const latest = latestVersionByDocument.get(doc.id);
      return {
        ...doc,
        latestVersionId: latest?.id ?? null,
        latestVersionNumber: latest?.versionNumber ?? null,
      };
    });

    return jsonOk({ documents: documentsWithVersion, nextCursor: page.nextCursor });
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

    // Process synchronously for local/dev reliability (domain pipeline; Inngest can wrap later).
    const processed = await processDocumentPipeline(
      {
        db,
        storage,
        scanner: getMalwareScanner(),
        embeddings: getEmbeddings(),
      },
      {
        organizationId: matter.organizationId,
        matterId,
        documentId,
        documentVersionId: versionId,
      },
    );

    let intelligence = null;
    if (processed.ok && processed.state === "ready") {
      try {
        const { extractMatterIntelligenceForDocument } = await import("@nyayagrid/intelligence");
        const { MockAIProvider } = await import("@nyayagrid/ai");
        intelligence = await extractMatterIntelligenceForDocument({
          db,
          organizationId: matter.organizationId,
          matterId,
          documentId,
          documentVersionId: versionId,
          userId: user.id,
          ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
        });
      } catch (error) {
        intelligence = {
          skipped: false,
          error: error instanceof Error ? error.message : "Intelligence extraction failed",
        };
      }
    }

    const [fresh] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);

    return jsonOk(
      {
        document: fresh ?? document,
        version,
        processing: processed,
        intelligence,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
