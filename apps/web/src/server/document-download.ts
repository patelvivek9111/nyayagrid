import type { Database } from "@nyayagrid/database";
import {
  authorizeAndSignDocumentDownload,
  type AuthorizedDocumentDownload,
} from "@nyayagrid/documents";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { getStorage } from "@/lib/infra";

/**
 * Matter-document download signing, wired to the real `requireMatterAccess` capability check.
 * Lives in apps/web (not @nyayagrid/documents) because @nyayagrid/permissions' own test suite
 * depends on @nyayagrid/documents — a direct dependency the other way would create a package
 * cycle. @nyayagrid/documents only knows how to sign; this is where signing meets authorization.
 */
export async function signMatterDocumentDownload(params: {
  db: Database;
  userId: string;
  matterId: string;
  documentId: string;
  documentVersionId?: string;
  disposition?: "attachment" | "inline";
}): Promise<AuthorizedDocumentDownload> {
  const { matter } = await requireMatterAccess(params.db, {
    userId: params.userId,
    matterId: params.matterId,
    minAccess: "read",
    capability: "documents.view",
  });

  const signed = await authorizeAndSignDocumentDownload({
    db: params.db,
    storage: getStorage(),
    userId: params.userId,
    organizationId: matter.organizationId,
    matterId: params.matterId,
    documentId: params.documentId,
    documentVersionId: params.documentVersionId,
    disposition: params.disposition,
    // requireMatterAccess above already authorized this request.
    authCheck: () => {},
  });

  await writeAuditEvent(params.db, {
    organizationId: matter.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "document.download_signed",
    targetType: "document",
    targetId: signed.documentId,
    metadata: {
      documentVersionId: signed.documentVersionId,
      disposition: params.disposition ?? "attachment",
      filename: signed.filename,
    },
  });

  return signed;
}
