import { and, desc, eq, type Database, documents, documentChunks, documentVersions } from "@nyayagrid/database";
import type { EmbeddingProvider } from "@nyayagrid/ai";
import { evaluateIngestGate, type IngestIdentity } from "./ingest-gate";
import { processDocumentPipeline } from "./pipeline";
import type { MalwareScanner } from "./malware";
import type { StorageProvider } from "./storage";
import { isPermanentIngestState } from "./retry";

export type DocumentIngestJobResult = {
  ok: boolean;
  skipped: boolean;
  code?: string;
  message: string;
  state?: string;
  shouldExtractIntelligence: boolean;
  attempt?: number;
};

export type DocumentIngestDeps = {
  db: Database;
  storage: StorageProvider;
  scanner: MalwareScanner;
  embeddings: EmbeddingProvider;
};

/**
 * Conservative Inngest concurrency for controlled beta (DB pool max=10).
 * Global ingest + per-org caps prevent a 100-document drop from firing 100 model calls at once.
 */
export const DOCUMENT_INGEST_RUNTIME = {
  ingestRetries: 4,
  intelligenceRetries: 4,
  ingestConcurrencyGlobal: 3,
  ingestConcurrencyPerOrganization: 2,
  intelligenceConcurrencyGlobal: 2,
  intelligenceConcurrencyPerOrganization: 1,
} as const;

export async function loadIngestTarget(db: Database, payload: IngestIdentity) {
  if (!payload.documentId || !payload.organizationId || !payload.documentVersionId) {
    return { document: null, version: null, latestVersionId: null as string | null };
  }

  const [document] = await db
    .select()
    .from(documents)
    .where(
      and(eq(documents.id, payload.documentId), eq(documents.organizationId, payload.organizationId)),
    )
    .limit(1);

  const [version] = await db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.id, payload.documentVersionId),
        eq(documentVersions.organizationId, payload.organizationId),
      ),
    )
    .limit(1);

  const [latest] = await db
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, payload.documentId),
        eq(documentVersions.organizationId, payload.organizationId),
      ),
    )
    .orderBy(desc(documentVersions.versionNumber))
    .limit(1);

  return {
    document: document ?? null,
    version: version ?? null,
    latestVersionId: latest?.id ?? null,
  };
}

export async function countChunksForVersion(
  db: Database,
  params: { organizationId: string; documentVersionId: string },
): Promise<number> {
  const rows = await db
    .select({ id: documentChunks.id })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.organizationId, params.organizationId),
        eq(documentChunks.documentVersionId, params.documentVersionId),
      ),
    );
  return rows.length;
}

/**
 * Scan → extract → chunk → embed → persist. Does not run intelligence extraction.
 * Duplicate delivery is safe: ready documents no-op; mid-flight chunk/embed states resume.
 */
export async function runDocumentIngestJob(
  deps: DocumentIngestDeps,
  payload: IngestIdentity & { idempotencyKey?: string },
  options: { attempt?: number } = {},
): Promise<DocumentIngestJobResult> {
  const loaded = await loadIngestTarget(deps.db, payload);
  const gate = evaluateIngestGate({
    payload,
    document: loaded.document,
    version: loaded.version,
    latestVersionId: loaded.latestVersionId,
  });

  if (gate.action === "skip") {
    return {
      ok: true,
      skipped: true,
      code: gate.code,
      message: gate.message,
      state: loaded.document?.processingState,
      shouldExtractIntelligence: false,
      attempt: options.attempt,
    };
  }

  const document = loaded.document!;
  if (document.processingState === "malware_scan_failed") {
    await deps.db
      .update(documents)
      .set({
        processingState: "awaiting_malware_scan",
        processingError: null,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, document.id));
  }

  if (isPermanentIngestState(document.processingState)) {
    return {
      ok: false,
      skipped: true,
      code: "PERMANENT_STATE",
      message: `Document is in permanent state ${document.processingState}`,
      state: document.processingState,
      shouldExtractIntelligence: false,
      attempt: options.attempt,
    };
  }

  if (document.processingState === "ready") {
    return {
      ok: true,
      skipped: true,
      code: "ALREADY_READY",
      message: "Document already processed",
      state: "ready",
      shouldExtractIntelligence: true,
      attempt: options.attempt,
    };
  }

  const processed = await processDocumentPipeline(deps, {
    organizationId: payload.organizationId!,
    matterId: payload.matterId!,
    documentId: payload.documentId!,
    documentVersionId: payload.documentVersionId!,
  });

  if (isPermanentIngestState(processed.state) || processed.state === "failed") {
    return {
      ok: false,
      skipped: false,
      code: processed.state,
      message: processed.message,
      state: processed.state,
      shouldExtractIntelligence: false,
      attempt: options.attempt,
    };
  }

  const searchable = processed.state === "ready" || processed.state === "indexed";
  return {
    ok: processed.ok,
    skipped: false,
    message: processed.message,
    state: processed.state,
    shouldExtractIntelligence: searchable && processed.ok,
    attempt: options.attempt,
  };
}
