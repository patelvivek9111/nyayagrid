import { createHash } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Database } from "@nyayagrid/database";
import { guideDocuments, guideDocumentVersions, guideDocumentChunks } from "@nyayagrid/database";
import type { GuideDocument, GuideDocumentVersion } from "@nyayagrid/database";
import type { EmbeddingProvider } from "@nyayagrid/ai";
import { chunkSegments, createDefaultTextExtractor } from "@nyayagrid/documents";
import type { ExtractedSegment, TextExtractor } from "@nyayagrid/documents";
import { writeAuditEvent } from "@nyayagrid/permissions";

/**
 * Mirrors the exact TypeScript union accepted by guideDocuments.documentKind in
 * packages/database/src/schema/phase8.ts. Kept as a single source of truth here so ingest input
 * validation can never drift from what the column actually accepts.
 */
export const GUIDE_DOCUMENT_KINDS = [
  "lease",
  "employment",
  "court_notice",
  "demand",
  "settlement",
  "other",
] as const;

export type GuideDocumentKind = (typeof GUIDE_DOCUMENT_KINDS)[number];

export const ingestGuideDocumentInputSchema = z
  .object({
    userId: z.string().uuid(),
    title: z.string().trim().min(1).max(300),
    documentKind: z.enum(GUIDE_DOCUMENT_KINDS).optional().default("other"),
    content: z.string().min(1).optional(),
    buffer: z.instanceof(Buffer).optional(),
    filename: z.string().trim().min(1).max(300).optional(),
    contentType: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((input, ctx) => {
    if (!input.content && !input.buffer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "Either content or buffer must be provided.",
      });
    }
    if (input.buffer && (!input.filename || !input.contentType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filename"],
        message: "filename and contentType are required when ingesting a buffer.",
      });
    }
  });

export type IngestGuideDocumentInput = z.infer<typeof ingestGuideDocumentInputSchema> & {
  db: Database;
  embeddings: EmbeddingProvider;
  extractor?: TextExtractor;
};

export type IngestGuideDocumentResult = {
  document: GuideDocument;
  version: GuideDocumentVersion | null;
  chunkCount: number;
  processingState: string;
  message: string;
};

const MAX_PARAGRAPH_CHARS = 1200;

function toSegmentsFromText(text: string): ExtractedSegment[] {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const segments: ExtractedSegment[] = [];
  let cursor = 0;
  paragraphs.forEach((paragraph, index) => {
    const charStart = cursor;
    const charEnd = cursor + paragraph.length;
    segments.push({
      text: paragraph.slice(0, MAX_PARAGRAPH_CHARS),
      segmentRef: `p${index + 1}`,
      charStart,
      charEnd,
    });
    cursor = charEnd + 2;
  });
  return segments;
}

async function markFailed(db: Database, documentId: string, reason: string) {
  await db
    .update(guideDocuments)
    .set({ processingState: "failed", processingError: reason, updatedAt: new Date() })
    .where(eq(guideDocuments.id, documentId));
}

/**
 * Ingest a single Guide document for one user. Deliberately narrow: no storage/malware-scan
 * dependencies — Guide documents are either raw text or a buffer extracted in-process. This never
 * touches documents/document_chunks/matters; it only ever writes guide_documents* rows.
 */
export async function ingestGuideDocument(
  params: IngestGuideDocumentInput,
): Promise<IngestGuideDocumentResult> {
  const input = ingestGuideDocumentInputSchema.parse(params);
  const { db, embeddings } = params;
  const extractor = params.extractor ?? createDefaultTextExtractor();

  const [document] = await db
    .insert(guideDocuments)
    .values({
      userId: input.userId,
      title: input.title,
      documentKind: input.documentKind,
      processingState: "extracting",
    })
    .returning();
  if (!document) throw new Error("Failed to create guide document");

  let segments: ExtractedSegment[];
  let byteSize: number;
  let sha256: string;
  let mimeType = input.contentType ?? "text/plain";
  let fullText: string;

  if (input.buffer) {
    const extraction = await extractor.extract({
      buffer: input.buffer,
      contentType: input.contentType!,
      filename: input.filename!,
    });
    if (extraction.status === "requires_ocr" || extraction.status === "failed") {
      await markFailed(db, document.id, extraction.reason);
      return {
        document: { ...document, processingState: "failed" },
        version: null,
        chunkCount: 0,
        processingState: extraction.status === "requires_ocr" ? "requires_ocr" : "failed",
        message: extraction.reason,
      };
    }
    segments = extraction.segments;
    byteSize = input.buffer.byteLength;
    sha256 = createHash("sha256").update(input.buffer).digest("hex");
    fullText = segments.map((s) => s.text).join("\n\n");
  } else {
    const text = input.content!;
    segments = toSegmentsFromText(text);
    byteSize = Buffer.byteLength(text, "utf8");
    sha256 = createHash("sha256").update(text).digest("hex");
    mimeType = input.contentType ?? "text/plain";
    fullText = text;
  }

  const drafts = chunkSegments(segments);
  if (drafts.length === 0) {
    await markFailed(db, document.id, "No text content could be extracted");
    return {
      document: { ...document, processingState: "failed" },
      version: null,
      chunkCount: 0,
      processingState: "failed",
      message: "No text content could be extracted",
    };
  }

  await db
    .update(guideDocuments)
    .set({
      processingState: "chunking",
      storageKey: null,
      mimeType,
      sha256,
      byteSize,
      updatedAt: new Date(),
    })
    .where(eq(guideDocuments.id, document.id));

  const [version] = await db
    .insert(guideDocumentVersions)
    .values({
      documentId: document.id,
      userId: input.userId,
      versionNumber: 1,
      content: fullText,
      sha256,
    })
    .returning();
  if (!version) throw new Error("Failed to create guide document version");

  const vectors = await embeddings.embed(drafts.map((d) => d.content));
  await db
    .update(guideDocuments)
    .set({ processingState: "embedding", updatedAt: new Date() })
    .where(eq(guideDocuments.id, document.id));

  await db.insert(guideDocumentChunks).values(
    drafts.map((draft, index) => ({
      userId: input.userId,
      documentId: document.id,
      documentVersionId: version.id,
      chunkIndex: draft.chunkIndex,
      content: draft.content,
      pageStart: draft.pageStart ?? null,
      pageEnd: draft.pageEnd ?? null,
      segmentRef: draft.segmentRef || null,
      charStart: draft.charStart,
      charEnd: draft.charEnd,
      embedding: vectors[index] ?? null,
      embeddingModel: vectors[index] ? embeddings.model : null,
    })),
  );

  const [ready] = await db
    .update(guideDocuments)
    .set({ processingState: "ready", processingError: null, updatedAt: new Date() })
    .where(eq(guideDocuments.id, document.id))
    .returning();

  await writeAuditEvent(db, {
    organizationId: null,
    actorUserId: input.userId,
    action: "guide_document.ingested",
    targetType: "guide_document",
    targetId: document.id,
    metadata: { chunkCount: drafts.length, documentKind: input.documentKind },
  });

  return {
    document: ready ?? document,
    version,
    chunkCount: drafts.length,
    processingState: "ready",
    message: "Guide document ready",
  };
}
