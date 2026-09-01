import { and, eq, inArray } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { documentIntelligenceRuns, documents } from "@nyayagrid/database";
import { createLogger } from "@nyayagrid/observability";
import {
  DOCUMENT_INGEST_RUNTIME,
  evaluateIngestGate,
  intelligenceJobIdempotencyKey,
  isRetryableProcessingError,
  loadIngestTarget,
  runDocumentIngestJob,
  type IngestIdentity,
} from "@nyayagrid/documents";
import { extractMatterIntelligenceForDocument } from "@nyayagrid/intelligence";
import { MockAIProvider } from "@nyayagrid/ai";
import { getAI, getEmbeddings, getMalwareScanner, getStorage } from "@/lib/infra";
import { getDb } from "@/lib/db";
import { inngest } from "@/inngest/client";
import type { JobPayload } from "@nyayagrid/jobs";

const log = createLogger("document-ingest");

export { DOCUMENT_INGEST_RUNTIME };

/** Fail fast when the Inngest dev/cloud endpoint is down instead of hanging the upload request. */
export const INGEST_ENQUEUE_TIMEOUT_MS = 8_000;

async function sendWithTimeout(
  payload: Parameters<typeof inngest.send>[0],
  timeoutMs = INGEST_ENQUEUE_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      inngest.send(payload),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Inngest enqueue timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function asIdentity(payload: JobPayload): IngestIdentity {
  return {
    organizationId: payload.organizationId,
    matterId: payload.matterId,
    documentId: payload.documentId,
    documentVersionId: payload.documentVersionId,
  };
}

export async function enqueueDocumentIngest(payload: JobPayload): Promise<{ id: string }> {
  await sendWithTimeout({
    name: "nyayagrid/document.malware_scan",
    id: payload.idempotencyKey,
    data: payload,
  });
  return { id: payload.idempotencyKey };
}

export async function enqueueDocumentIntelligence(payload: JobPayload): Promise<{ id: string }> {
  await sendWithTimeout({
    name: "nyayagrid/matter.extract_intelligence",
    id: payload.idempotencyKey,
    data: payload,
  });
  return { id: payload.idempotencyKey };
}

export async function handleDocumentIngestEvent(params: { payload: JobPayload; attempt?: number }) {
  const startedAt = Date.now();
  const identity = asIdentity(params.payload);
  log.info("ingest.started", {
    organizationId: identity.organizationId,
    matterId: identity.matterId,
    documentId: identity.documentId,
    documentVersionId: identity.documentVersionId,
    attempt: params.attempt ?? 0,
    stage: "ingest",
  });

  const result = await runDocumentIngestJob(
    {
      db: getDb(),
      storage: getStorage(),
      scanner: getMalwareScanner(),
      embeddings: getEmbeddings(),
    },
    { ...identity, idempotencyKey: params.payload.idempotencyKey },
    { attempt: params.attempt },
  );

  log.info("ingest.finished", {
    organizationId: identity.organizationId,
    documentId: identity.documentId,
    documentVersionId: identity.documentVersionId,
    attempt: params.attempt ?? 0,
    stage: result.state ?? "unknown",
    skipped: result.skipped,
    ok: result.ok,
    elapsedMs: Date.now() - startedAt,
  });

  if (result.shouldExtractIntelligence && identity.documentVersionId) {
    await enqueueDocumentIntelligence({
      ...params.payload,
      idempotencyKey: intelligenceJobIdempotencyKey(identity.documentVersionId),
    });
  }

  return result;
}

export async function handleDocumentIntelligenceEvent(params: {
  payload: JobPayload;
  attempt?: number;
}) {
  const db = getDb();
  const identity = asIdentity(params.payload);
  const loaded = await loadIngestTarget(db, identity);
  const gate = evaluateIngestGate({
    payload: identity,
    document: loaded.document,
    version: loaded.version,
    latestVersionId: loaded.latestVersionId,
  });
  if (gate.action === "skip") {
    log.info("intelligence.skipped", {
      code: gate.code,
      documentId: identity.documentId,
      documentVersionId: identity.documentVersionId,
    });
    return { ok: true, skipped: true, message: gate.message, code: gate.code };
  }

  const document = loaded.document!;
  if (document.processingState === "scan_blocked" || document.processingState === "quarantined") {
    return {
      ok: false,
      skipped: true,
      message: "Intelligence extraction blocked because malware scanning rejected the file",
    };
  }
  if (document.processingState !== "ready" && document.processingState !== "indexed") {
    return {
      ok: false,
      skipped: true,
      message: `Intelligence extraction requires indexed or ready documents; found ${document.processingState}`,
    };
  }

  const startedAt = Date.now();
  try {
    const intelligence = await extractMatterIntelligenceForDocument({
      db,
      organizationId: identity.organizationId!,
      matterId: identity.matterId!,
      documentId: identity.documentId!,
      documentVersionId: identity.documentVersionId!,
      userId: params.payload.userId ?? null,
      ai: process.env.AI_PROVIDER === "openai" ? getAI() : new MockAIProvider(),
    });

    if (loaded.document && loaded.document.processingState === "indexed") {
      await db
        .update(documents)
        .set({ processingState: "ready", processingError: null, updatedAt: new Date() })
        .where(eq(documents.id, identity.documentId!));
    }

    log.info("intelligence.finished", {
      organizationId: identity.organizationId,
      documentId: identity.documentId,
      documentVersionId: identity.documentVersionId,
      attempt: params.attempt ?? 0,
      skipped: "skipped" in intelligence ? Boolean(intelligence.skipped) : false,
      elapsedMs: Date.now() - startedAt,
    });
    return { ok: true, skipped: false, intelligence };
  } catch (error) {
    if (isRetryableProcessingError(error)) throw error;
    log.error("intelligence.failed", {
      documentId: identity.documentId,
      documentVersionId: identity.documentVersionId,
      attempt: params.attempt ?? 0,
    });
    throw error;
  }
}

export async function markIngestFailedAfterRetries(payload: JobPayload, errorMessage: string) {
  if (!payload.documentId || !payload.organizationId) return;
  const db = getDb();
  const [document] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, payload.documentId),
        eq(documents.organizationId, payload.organizationId),
      ),
    )
    .limit(1);
  if (!document) return;
  if (document.processingState === "scan_blocked" || document.processingState === "quarantined") {
    return;
  }
  if (document.processingState === "ready") return;
  await db
    .update(documents)
    .set({
      processingState: "failed",
      processingError: errorMessage.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(documents.id, payload.documentId));
}

export async function latestIntelligenceStatus(params: {
  db: Database;
  organizationId: string;
  documentVersionIds: string[];
}): Promise<Map<string, string>> {
  const statuses = new Map<string, string>();
  if (params.documentVersionIds.length === 0) return statuses;
  const rows = await params.db
    .select({
      documentVersionId: documentIntelligenceRuns.documentVersionId,
      status: documentIntelligenceRuns.status,
      updatedAt: documentIntelligenceRuns.updatedAt,
    })
    .from(documentIntelligenceRuns)
    .where(
      and(
        eq(documentIntelligenceRuns.organizationId, params.organizationId),
        inArray(documentIntelligenceRuns.documentVersionId, params.documentVersionIds),
      ),
    );
  const latest = new Map<string, { status: string; updatedAt: Date }>();
  for (const row of rows) {
    if (!params.documentVersionIds.includes(row.documentVersionId)) continue;
    const current = latest.get(row.documentVersionId);
    if (!current || row.updatedAt > current.updatedAt) {
      latest.set(row.documentVersionId, { status: row.status, updatedAt: row.updatedAt });
    }
  }
  for (const [id, value] of latest) statuses.set(id, value.status);
  return statuses;
}
