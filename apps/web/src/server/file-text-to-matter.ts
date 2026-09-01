import { randomUUID } from "node:crypto";
import type { Database } from "@nyayagrid/database";
import { documents, documentVersions } from "@nyayagrid/database";
import { ingestIdempotencyKey, sha256Buffer } from "@nyayagrid/documents";
import { storageKeyForOrganization, writeAuditEvent } from "@nyayagrid/permissions";
import { getStorage } from "@/lib/infra";
import { enqueueDocumentIngest } from "@/server/document-ingest";

export async function filePlainTextToMatter(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  filename: string;
  title: string;
  text: string;
  auditAction: string;
}) {
  const buffer = Buffer.from(params.text, "utf8");
  const hash = sha256Buffer(buffer);
  const documentId = randomUUID();
  const versionId = randomUUID();
  const storageKey = storageKeyForOrganization({
    organizationId: params.organizationId,
    documentId,
    versionId,
    filename: params.filename,
  });

  const storage = getStorage();
  await storage.ensureBucket();
  await storage.putObject({
    key: storageKey,
    body: buffer,
    contentType: "text/plain",
    metadata: {
      organizationId: params.organizationId,
      matterId: params.matterId,
      sha256: hash,
    },
  });

  await params.db.insert(documents).values({
    id: documentId,
    organizationId: params.organizationId,
    matterId: params.matterId,
    createdByUserId: params.userId,
    title: params.title,
    processingState: "uploaded",
    malwareScanStatus: "not_scanned",
  });

  await params.db.insert(documentVersions).values({
    id: versionId,
    documentId,
    organizationId: params.organizationId,
    versionNumber: 1,
    storageKey,
    contentType: "text/plain",
    byteSize: buffer.length,
    sha256: hash,
    originalFilename: params.filename,
    uploadedByUserId: params.userId,
  });

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: params.auditAction,
    targetType: "document",
    targetId: documentId,
    metadata: { filename: params.filename, sha256: hash },
  });

  await enqueueDocumentIngest({
    organizationId: params.organizationId,
    matterId: params.matterId,
    documentId,
    documentVersionId: versionId,
    userId: params.userId,
    idempotencyKey: ingestIdempotencyKey(versionId),
  });

  return { documentId, versionId };
}
