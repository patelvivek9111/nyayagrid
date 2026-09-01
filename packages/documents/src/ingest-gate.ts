import type { DocumentProcessingState } from "@nyayagrid/validation";

export type IngestIdentity = {
  organizationId?: string;
  matterId?: string;
  documentId?: string;
  documentVersionId?: string;
};

export type IngestDocumentRow = {
  id: string;
  organizationId: string;
  matterId: string | null;
  processingState: DocumentProcessingState | string;
};

export type IngestVersionRow = {
  id: string;
  documentId: string;
  organizationId: string;
};

export type IngestGateDecision =
  | { action: "run" }
  | { action: "skip"; code: string; message: string };

/**
 * Tenant, deletion, and stale-version checks for a background ingest event.
 * Callers must load rows from the database; this function never trusts payload IDs alone.
 */
export function evaluateIngestGate(params: {
  payload: IngestIdentity;
  document: IngestDocumentRow | null;
  version: IngestVersionRow | null;
  latestVersionId: string | null;
}): IngestGateDecision {
  const { payload, document, version, latestVersionId } = params;
  if (
    !payload.organizationId ||
    !payload.matterId ||
    !payload.documentId ||
    !payload.documentVersionId
  ) {
    return {
      action: "skip",
      code: "MISSING_IDENTITY",
      message: "Ingest job is missing organization, matter, document, or version identity",
    };
  }

  if (!document) {
    return {
      action: "skip",
      code: "DOCUMENT_DELETED",
      message: "Document no longer exists; ingest will not run",
    };
  }

  if (
    document.organizationId !== payload.organizationId ||
    document.matterId !== payload.matterId ||
    document.id !== payload.documentId
  ) {
    return {
      action: "skip",
      code: "TENANT_MISMATCH",
      message: "Ingest payload does not match the stored document identity",
    };
  }

  if (!version) {
    return {
      action: "skip",
      code: "VERSION_DELETED",
      message: "Document version no longer exists; ingest will not run",
    };
  }

  if (
    version.id !== payload.documentVersionId ||
    version.documentId !== payload.documentId ||
    version.organizationId !== payload.organizationId
  ) {
    return {
      action: "skip",
      code: "TENANT_MISMATCH",
      message: "Ingest payload does not match the stored version identity",
    };
  }

  if (latestVersionId && latestVersionId !== payload.documentVersionId) {
    return {
      action: "skip",
      code: "STALE_VERSION",
      message: "A newer document version exists; this job will not mutate document state",
    };
  }

  return { action: "run" };
}

export function ingestIdempotencyKey(documentVersionId: string): string {
  return `document.ingest:${documentVersionId}`;
}

export function intelligenceJobIdempotencyKey(documentVersionId: string): string {
  return `matter.extract_intelligence:${documentVersionId}`;
}
