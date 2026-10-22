/**
 * Week 3 Slice 1 — OCR ingest LIVE certification (local product DB).
 * Requires SHARED_RUNTIME_LOCK + RUN_DB_TESTS=1. CourtListener: 0. No schema migration.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, count, eq } from "drizzle-orm";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  documentChunks,
  documents,
  documentVersions,
  matterMembers,
  matters,
  users,
  type Database,
  isLocalCertificationDatabaseUrl,
} from "@nyayagrid/database";
import { storageKeyForOrganization } from "@nyayagrid/permissions";
import { MockEmbeddingProvider } from "@nyayagrid/ai";
import {
  DevelopmentMalwareScanner,
  InMemoryStorageProvider,
  processDocumentPipeline,
  runDocumentIngestJob,
  sha256Buffer,
  UnsupportedOcrProvider,
  type OcrProvider,
  type OcrResult,
  type TextExtractor,
  type ExtractionResult,
} from "./index";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const dbUrl =
  process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";

const scannedExtractor: TextExtractor = {
  name: "live-scanned-fixture",
  supports: () => true,
  async extract(): Promise<ExtractionResult> {
    return {
      status: "requires_ocr",
      reason: "PDF has no useful native text layer",
      extractor: "live-scanned-fixture",
    };
  },
};

const nativeExtractor: TextExtractor = {
  name: "live-native-fixture",
  supports: () => true,
  async extract(): Promise<ExtractionResult> {
    return {
      status: "ok",
      extractor: "live-native-fixture",
      segments: [
        {
          text: "Native selectable PDF text about cure notice receipt on March 1, 2025.",
          page: 1,
          segmentRef: "pdf-p1-1",
          charStart: 0,
          charEnd: 72,
        },
      ],
    };
  },
};

function mockOcr(result: OcrResult, name = "live-mock-ocr"): OcrProvider {
  return {
    name,
    extractText: vi.fn(async () => result),
  };
}

describe.runIf(runDbTests)("Week 3 Slice 1 OCR ingest live certification", () => {
  const db: Database = createDb(dbUrl);
  const storage = new InMemoryStorageProvider();
  const embeddings = new MockEmbeddingProvider();
  const scanner = new DevelopmentMalwareScanner();
  const suffix = `ocr_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const metrics = {
    inventedText: 0,
    falseReady: 0,
    clRequests: 0,
    ocrInvocationsOnNative: 0,
  };

  beforeAll(async () => {
    const host = new URL(dbUrl).host;
    expect(isLocalCertificationDatabaseUrl(dbUrl)).toBe(true);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `ocr_owner_${suffix}`,
        email: `ocr_owner_${suffix}@example.nyayagrid.local`,
        name: "OCR Cert Owner",
      })
      .returning();
    ids.owner = owner!.id;

    const org = await createOrganizationWithDefaults(db, {
      name: `OCR Cert Firm ${suffix}`,
      slug: `ocr-cert-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    ids.org = org.organization.id;

    const [client] = await db
      .insert(clients)
      .values({
        organizationId: ids.org!,
        displayName: "OCR Client",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.owner!,
      })
      .returning();

    const [matter] = await db
      .insert(matters)
      .values({
        organizationId: ids.org!,
        clientId: client!.id,
        matterNumber: `OCR-${suffix}`,
        title: `OCR Ingest Cert ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.matter = matter!.id;

    await db.insert(matterMembers).values({
      organizationId: ids.org!,
      matterId: ids.matter!,
      userId: ids.owner!,
      access: "manage",
    });
  }, 120_000);

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        week3_slice1_ocr_live_metrics: metrics,
        courtlistener_requests: metrics.clRequests,
      }),
    );
    await closeDb(db);
  });

  async function seedDocument(params: { filename: string; body: Buffer; contentType?: string }) {
    const documentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const key = storageKeyForOrganization({
      organizationId: ids.org!,
      documentId,
      versionId,
      filename: params.filename,
    });
    await storage.putObject({
      key,
      body: params.body,
      contentType: params.contentType ?? "application/pdf",
    });
    await db.insert(documents).values({
      id: documentId,
      organizationId: ids.org!,
      matterId: ids.matter!,
      title: params.filename,
      createdByUserId: ids.owner!,
      processingState: "uploaded",
    });
    await db.insert(documentVersions).values({
      id: versionId,
      documentId,
      organizationId: ids.org!,
      versionNumber: 1,
      storageKey: key,
      contentType: params.contentType ?? "application/pdf",
      byteSize: params.body.length,
      sha256: sha256Buffer(params.body),
      originalFilename: params.filename,
      uploadedByUserId: ids.owner!,
    });
    return { documentId, versionId };
  }

  async function chunkCount(documentId: string) {
    const [row] = await db
      .select({ n: count() })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.organizationId, ids.org!),
          eq(documentChunks.matterId, ids.matter!),
          eq(documentChunks.documentId, documentId),
        ),
      );
    return Number(row?.n ?? 0);
  }

  async function docState(documentId: string) {
    const [row] = await db
      .select({
        processingState: documents.processingState,
        processingError: documents.processingError,
      })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, ids.org!)))
      .limit(1);
    return row!;
  }

  it("1 — scanned PDF + OCR disabled → requires_ocr, no invent, not ready", async () => {
    const { documentId, versionId } = await seedDocument({
      filename: `scan-disabled-${suffix}.pdf`,
      body: Buffer.from("%PDF-1.4 scanned disabled"),
    });
    const ocr = mockOcr({
      status: "completed",
      provider: "mock",
      segments: [{ text: "INVENTED", segmentRef: "x", charStart: 0, charEnd: 8 }],
    });
    const result = await processDocumentPipeline(
      {
        db,
        storage,
        scanner,
        embeddings,
        extractor: scannedExtractor,
        ocr,
        ocrEnabled: false,
      },
      {
        organizationId: ids.org!,
        matterId: ids.matter!,
        documentId,
        documentVersionId: versionId,
      },
    );
    expect(result.state).toBe("requires_ocr");
    expect(result.ok).toBe(false);
    expect(ocr.extractText).not.toHaveBeenCalled();
    const state = await docState(documentId);
    expect(state.processingState).toBe("requires_ocr");
    expect(state.processingError ?? "").toMatch(/FEATURE_OCR|not enabled/i);
    expect(await chunkCount(documentId)).toBe(0);
    if (state.processingState === "ready") metrics.falseReady += 1;
    expect(metrics.falseReady).toBe(0);
    expect(metrics.clRequests).toBe(0);
  });

  it("2 — scanned PDF + provider unavailable → requires_ocr", async () => {
    const { documentId, versionId } = await seedDocument({
      filename: `scan-unavail-${suffix}.pdf`,
      body: Buffer.from("%PDF-1.4 scanned unavail"),
    });
    const result = await processDocumentPipeline(
      {
        db,
        storage,
        scanner,
        embeddings,
        extractor: scannedExtractor,
        ocr: new UnsupportedOcrProvider(),
        ocrEnabled: true,
      },
      {
        organizationId: ids.org!,
        matterId: ids.matter!,
        documentId,
        documentVersionId: versionId,
      },
    );
    expect(result.state).toBe("requires_ocr");
    const state = await docState(documentId);
    expect(state.processingState).toBe("requires_ocr");
    expect(state.processingError ?? "").toMatch(/no OCR provider|OCR_ENDPOINT|not configured/i);
    expect(await chunkCount(documentId)).toBe(0);
  });

  it("3 — scanned PDF + OCR success → ready with OCR provenance chunks", async () => {
    const { documentId, versionId } = await seedDocument({
      filename: `scan-success-${suffix}.pdf`,
      body: Buffer.from("%PDF-1.4 scanned success"),
    });
    const ocr = mockOcr({
      status: "completed",
      provider: "http",
      segments: [
        {
          text: "OCR recovered cure notice emailed March 1, 2025.",
          page: 3,
          segmentRef: "ocr-p3-live",
          charStart: 0,
          charEnd: 48,
        },
      ],
    });
    const result = await processDocumentPipeline(
      {
        db,
        storage,
        scanner,
        embeddings,
        extractor: scannedExtractor,
        ocr,
        ocrEnabled: true,
      },
      {
        organizationId: ids.org!,
        matterId: ids.matter!,
        documentId,
        documentVersionId: versionId,
      },
    );
    expect(result.ok).toBe(true);
    expect(result.state).toBe("ready");
    expect(result.message).toMatch(/OCR via http/i);
    expect(ocr.extractText).toHaveBeenCalledTimes(1);
    const state = await docState(documentId);
    expect(state.processingState).toBe("ready");
    const chunks = await db
      .select()
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.documentId, documentId),
          eq(documentChunks.organizationId, ids.org!),
          eq(documentChunks.matterId, ids.matter!),
        ),
      );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => /cure notice/i.test(c.content))).toBe(true);
    expect(chunks.some((c) => c.segmentRef === "ocr-p3-live")).toBe(true);
    expect(chunks.some((c) => c.pageStart === 3)).toBe(true);
    expect(chunks.every((c) => c.organizationId === ids.org! && c.matterId === ids.matter!)).toBe(
      true,
    );
  });

  it("4 — scanned PDF + OCR empty → extraction_failed, not ready", async () => {
    const { documentId, versionId } = await seedDocument({
      filename: `scan-empty-${suffix}.pdf`,
      body: Buffer.from("%PDF-1.4 scanned empty"),
    });
    const result = await processDocumentPipeline(
      {
        db,
        storage,
        scanner,
        embeddings,
        extractor: scannedExtractor,
        ocr: mockOcr({
          status: "completed",
          provider: "http",
          segments: [{ text: "   ", segmentRef: "ocr-p1", charStart: 0, charEnd: 3 }],
        }),
        ocrEnabled: true,
      },
      {
        organizationId: ids.org!,
        matterId: ids.matter!,
        documentId,
        documentVersionId: versionId,
      },
    );
    expect(result.state).toBe("extraction_failed");
    expect(result.ok).toBe(false);
    const state = await docState(documentId);
    expect(state.processingState).toBe("extraction_failed");
    expect(state.processingError ?? "").toMatch(/empty/i);
    expect(await chunkCount(documentId)).toBe(0);
    if (state.processingState === "ready") metrics.falseReady += 1;
    expect(metrics.falseReady).toBe(0);
  });

  it("5 — scanned PDF + OCR provider error → extraction_failed", async () => {
    const { documentId, versionId } = await seedDocument({
      filename: `scan-error-${suffix}.pdf`,
      body: Buffer.from("%PDF-1.4 scanned error"),
    });
    const result = await processDocumentPipeline(
      {
        db,
        storage,
        scanner,
        embeddings,
        extractor: scannedExtractor,
        ocr: mockOcr({ status: "failed", reason: "HTTP 503" }),
        ocrEnabled: true,
      },
      {
        organizationId: ids.org!,
        matterId: ids.matter!,
        documentId,
        documentVersionId: versionId,
      },
    );
    expect(result.state).toBe("extraction_failed");
    const state = await docState(documentId);
    expect(state.processingState).toBe("extraction_failed");
    expect(state.processingError ?? "").toMatch(/503|OCR failed/i);
    expect(await chunkCount(documentId)).toBe(0);
  });

  it("6 — normal text PDF → OCR not invoked; ready", async () => {
    const { documentId, versionId } = await seedDocument({
      filename: `native-text-${suffix}.pdf`,
      body: Buffer.from("%PDF-1.4 native text layer"),
    });
    const ocr = mockOcr({
      status: "completed",
      provider: "http",
      segments: [{ text: "SHOULD_NOT_APPEAR", segmentRef: "x", charStart: 0, charEnd: 16 }],
    });
    const result = await processDocumentPipeline(
      {
        db,
        storage,
        scanner,
        embeddings,
        extractor: nativeExtractor,
        ocr,
        ocrEnabled: true,
      },
      {
        organizationId: ids.org!,
        matterId: ids.matter!,
        documentId,
        documentVersionId: versionId,
      },
    );
    expect(result.ok).toBe(true);
    expect(result.state).toBe("ready");
    expect(ocr.extractText).not.toHaveBeenCalled();
    metrics.ocrInvocationsOnNative += (
      ocr.extractText as ReturnType<typeof vi.fn>
    ).mock.calls.length;
    expect(metrics.ocrInvocationsOnNative).toBe(0);
    const chunks = await db
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId));
    expect(chunks.some((c) => /Native selectable/i.test(c.content))).toBe(true);
    expect(chunks.some((c) => /SHOULD_NOT_APPEAR/i.test(c.content))).toBe(false);
    if (chunks.some((c) => /SHOULD_NOT_APPEAR/i.test(c.content))) metrics.inventedText += 1;
    expect(metrics.inventedText).toBe(0);
  });

  it("7 — mixed path selection: scanned uses OCR; text skips OCR", async () => {
    const scanned = await seedDocument({
      filename: `mixed-scan-${suffix}.pdf`,
      body: Buffer.from("%PDF mixed scan"),
    });
    const textDoc = await seedDocument({
      filename: `mixed-text-${suffix}.pdf`,
      body: Buffer.from("%PDF mixed text"),
    });
    const ocr = mockOcr({
      status: "completed",
      provider: "http",
      segments: [
        {
          text: "Mixed-case OCR paragraph with provenance.",
          page: 1,
          segmentRef: "ocr-mixed-1",
          charStart: 0,
          charEnd: 41,
        },
      ],
    });
    const scanResult = await processDocumentPipeline(
      {
        db,
        storage,
        scanner,
        embeddings,
        extractor: scannedExtractor,
        ocr,
        ocrEnabled: true,
      },
      {
        organizationId: ids.org!,
        matterId: ids.matter!,
        documentId: scanned.documentId,
        documentVersionId: scanned.versionId,
      },
    );
    const textResult = await processDocumentPipeline(
      {
        db,
        storage,
        scanner,
        embeddings,
        extractor: nativeExtractor,
        ocr,
        ocrEnabled: true,
      },
      {
        organizationId: ids.org!,
        matterId: ids.matter!,
        documentId: textDoc.documentId,
        documentVersionId: textDoc.versionId,
      },
    );
    expect(scanResult.state).toBe("ready");
    expect(textResult.state).toBe("ready");
    // OCR invoked once for scanned only
    expect(ocr.extractText).toHaveBeenCalledTimes(1);
  });

  it("8+9 — provenance already checked; duplicate ingest does not duplicate chunks", async () => {
    const { documentId, versionId } = await seedDocument({
      filename: `dup-${suffix}.pdf`,
      body: Buffer.from("%PDF dup"),
    });
    const ocr = mockOcr({
      status: "completed",
      provider: "http",
      segments: [
        {
          text: "Duplicate-prevention OCR body for chunk uniqueness.",
          page: 5,
          segmentRef: "ocr-dup-5",
          charStart: 0,
          charEnd: 52,
        },
      ],
    });
    const deps = {
      db,
      storage,
      scanner,
      embeddings,
      extractor: scannedExtractor,
      ocr,
      ocrEnabled: true,
    };
    const first = await processDocumentPipeline(deps, {
      organizationId: ids.org!,
      matterId: ids.matter!,
      documentId,
      documentVersionId: versionId,
    });
    expect(first.state).toBe("ready");
    const afterFirst = await chunkCount(documentId);
    expect(afterFirst).toBeGreaterThan(0);

    const second = await runDocumentIngestJob(deps, {
      organizationId: ids.org!,
      matterId: ids.matter!,
      documentId,
      documentVersionId: versionId,
    });
    expect(second.ok).toBe(true);
    expect(second.skipped).toBe(true);
    expect(second.code).toBe("ALREADY_READY");
    expect(await chunkCount(documentId)).toBe(afterFirst);

    const chunks = await db
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId));
    expect(chunks.some((c) => c.segmentRef === "ocr-dup-5" && c.pageStart === 5)).toBe(true);
    expect(metrics.clRequests).toBe(0);
  });
});
