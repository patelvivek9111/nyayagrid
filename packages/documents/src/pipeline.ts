import { and, eq, type Database, documents, documentVersions, documentChunks } from "@nyayagrid/database";
import type { DocumentProcessingState } from "@nyayagrid/validation";
import type { EmbeddingProvider } from "@nyayagrid/ai";
import {
  assertNeverMarkedScannedWithoutScanner,
  enforceProductionScanPolicy,
  mapMalwareResultToProcessingState,
} from "./malware";
import { createDefaultTextExtractor, type ExtractedSegment, type TextExtractor } from "./extract";
import { chunkSegments } from "./chunk";
import { transitionDocumentState } from "./processing-states";
import type { MalwareScanner } from "./malware";
import type { StorageProvider } from "./storage";
import {
  assertPageCountAllowed,
  assertUploadSizeAllowed,
  DEFAULT_EXTRACTION_TIMEOUT_MS,
  DEFAULT_SCAN_TIMEOUT_MS,
  MAX_EXTRACTED_CHARS,
  rejectZipBombsOrArchives,
  withTimeout,
} from "./limits";
import { isRetryableProcessingError } from "./retry";

export type ProcessDocumentInput = {
  organizationId: string;
  matterId: string;
  documentId: string;
  documentVersionId: string;
};

async function setState(
  db: Database,
  documentId: string,
  from: DocumentProcessingState,
  to: DocumentProcessingState,
  extra?: { processingError?: string | null; malwareScanStatus?: string },
) {
  transitionDocumentState(from, to);
  await db
    .update(documents)
    .set({
      processingState: to,
      processingError: extra?.processingError ?? null,
      malwareScanStatus: (extra?.malwareScanStatus as never) ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, documentId));
}

function truncateSegmentsToCharLimit(
  segments: ExtractedSegment[],
  limit: number,
): ExtractedSegment[] {
  const result: ExtractedSegment[] = [];
  let used = 0;
  for (const segment of segments) {
    if (used >= limit) break;
    const remaining = limit - used;
    if (segment.text.length <= remaining) {
      result.push(segment);
      used += segment.text.length;
    } else {
      result.push({
        ...segment,
        text: segment.text.slice(0, remaining),
        charEnd: segment.charStart + remaining,
      });
      used = limit;
    }
  }
  return result;
}

export async function processDocumentPipeline(
  deps: {
    db: Database;
    storage: StorageProvider;
    scanner: MalwareScanner;
    embeddings: EmbeddingProvider;
    extractor?: TextExtractor;
  },
  input: ProcessDocumentInput,
): Promise<{ ok: boolean; state: DocumentProcessingState; message: string }> {
  const extractor = deps.extractor ?? createDefaultTextExtractor();

  const [doc] = await deps.db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, input.documentId),
        eq(documents.organizationId, input.organizationId),
        eq(documents.matterId, input.matterId),
      ),
    )
    .limit(1);
  if (!doc) return { ok: false, state: "failed", message: "Document not found in scope" };

  const [version] = await deps.db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.id, input.documentVersionId),
        eq(documentVersions.documentId, input.documentId),
        eq(documentVersions.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!version) return { ok: false, state: "failed", message: "Document version not found" };

  let state = doc.processingState as DocumentProcessingState;

  try {
    if (state === "chunking" || state === "embedding") {
      await setState(deps.db, doc.id, state, "extracting_text");
      state = "extracting_text";
    }
    if (state === "indexed") {
      await setState(deps.db, doc.id, state, "ready");
      return { ok: true, state: "ready", message: "Document ready" };
    }

    assertUploadSizeAllowed(version.byteSize);
    const objectBytes = await deps.storage.getObject(version.storageKey);
    rejectZipBombsOrArchives({
      contentType: version.contentType,
      filename: version.originalFilename,
      buffer: objectBytes,
    });

    if (state === "uploaded") {
      await setState(deps.db, doc.id, state, "awaiting_malware_scan");
      state = "awaiting_malware_scan";
    }

    if (state === "awaiting_malware_scan") {
      const scan = await withTimeout(
        deps.scanner.scan({
          key: version.storageKey,
          contentType: version.contentType,
          byteSize: version.byteSize,
          getContent: async () => objectBytes,
        }),
        DEFAULT_SCAN_TIMEOUT_MS,
        "malware scan",
      );
      // Production defense-in-depth: an unscanned document must never proceed past this point
      // outside development/test, even if a caller mistakenly wires up the development scanner.
      const enforced = enforceProductionScanPolicy(scan);
      assertNeverMarkedScannedWithoutScanner(deps.scanner.name, enforced);
      const next = mapMalwareResultToProcessingState(enforced);
      await setState(deps.db, doc.id, state, next, {
        malwareScanStatus:
          enforced.status === "development_unscanned"
            ? "development_unscanned"
            : enforced.status === "clean"
              ? "clean"
              : enforced.status === "blocked"
                ? "blocked"
                : "failed",
      });
      state = next;
      if (state === "scan_blocked") {
        return {
          ok: false,
          state,
          message: enforced.status === "blocked" ? enforced.reason : "Blocked by malware scanner",
        };
      }
      if (state === "malware_scan_failed") {
        return {
          ok: false,
          state,
          message: enforced.status === "failed" ? enforced.reason : "Malware scan failed",
        };
      }
    }

    if (state === "unscanned_development" || state === "scan_clean") {
      await setState(deps.db, doc.id, state, "extracting_text");
      state = "extracting_text";
    }

    if (state === "extracting_text") {
      const bytes = objectBytes;
      const extraction = await withTimeout(
        extractor.extract({
          buffer: bytes,
          contentType: version.contentType,
          filename: version.originalFilename,
        }),
        DEFAULT_EXTRACTION_TIMEOUT_MS,
        "text extraction",
      );

      if (extraction.status === "requires_ocr") {
        await setState(deps.db, doc.id, state, "requires_ocr", {
          processingError: extraction.reason,
        });
        return { ok: false, state: "requires_ocr", message: extraction.reason };
      }
      if (extraction.status === "failed") {
        await setState(deps.db, doc.id, state, "extraction_failed", {
          processingError: extraction.reason,
        });
        return { ok: false, state: "extraction_failed", message: extraction.reason };
      }

      const maxPage = extraction.segments.reduce((max, s) => Math.max(max, s.page ?? 0), 0);
      try {
        assertPageCountAllowed(maxPage);
      } catch (limitError) {
        const message = limitError instanceof Error ? limitError.message : "Page limit exceeded";
        await setState(deps.db, doc.id, state, "extraction_failed", { processingError: message });
        return { ok: false, state: "extraction_failed", message };
      }

      const totalChars = extraction.segments.reduce((sum, s) => sum + s.text.length, 0);
      const truncatedText = totalChars > MAX_EXTRACTED_CHARS;
      const segments = truncatedText
        ? truncateSegmentsToCharLimit(extraction.segments, MAX_EXTRACTED_CHARS)
        : extraction.segments;

      await setState(deps.db, doc.id, state, "chunking");
      state = "chunking";

      const drafts = chunkSegments(segments);
      await deps.db.delete(documentChunks).where(eq(documentChunks.documentVersionId, version.id));

      if (drafts.length === 0) {
        await setState(deps.db, doc.id, state, "extraction_failed", {
          processingError: "No chunks produced",
        });
        return { ok: false, state: "extraction_failed", message: "No chunks produced" };
      }

      const embeddings = await deps.embeddings.embed(drafts.map((d) => d.content));
      await setState(deps.db, doc.id, state, "embedding");
      state = "embedding";

      for (let i = 0; i < drafts.length; i++) {
        const draft = drafts[i]!;
        const embedding = embeddings[i];
        await deps.db.insert(documentChunks).values({
          organizationId: input.organizationId,
          matterId: input.matterId,
          documentId: input.documentId,
          documentVersionId: version.id,
          chunkIndex: draft.chunkIndex,
          content: draft.content,
          pageStart: draft.pageStart,
          pageEnd: draft.pageEnd,
          segmentRef: draft.segmentRef,
          charStart: draft.charStart,
          charEnd: draft.charEnd,
          tokenCount: draft.tokenCount,
          embedding: embedding ?? null,
          embeddingModel: deps.embeddings.model,
        });
      }

      await setState(deps.db, doc.id, state, "indexed");
      state = "indexed";
      await setState(deps.db, doc.id, state, "ready");
      state = "ready";
      return {
        ok: true,
        state,
        message: truncatedText
          ? "Document ready (extracted text truncated to configured limit)"
          : "Document ready",
      };
    }

    return { ok: true, state, message: `No-op at state ${state}` };
  } catch (error) {
    if (isRetryableProcessingError(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Processing failed";
    try {
      await deps.db
        .update(documents)
        .set({
          processingState: "failed",
          processingError: message,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, doc.id));
    } catch {
      // ignore secondary failure
    }
    return { ok: false, state: "failed", message };
  }
}
