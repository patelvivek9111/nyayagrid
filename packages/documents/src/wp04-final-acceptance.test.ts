/**
 * WP-04 final acceptance — real local ClamAV + OCR HTTP harness + download quarantine.
 *
 * Gates:
 *   RUN_DB_TESTS=1          — local product certification DB
 *   CLAMAV_LIVE=1           — real clamd (docker nyayagrid-clamav)
 *
 * OCR: spins a local HTTP OCR endpoint (deterministic gold text). System tesseract is not required.
 * CourtListener: 0. Paid AI: 0. Neon corpus: untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
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
  ClamAvMalwareScanner,
  DocumentDownloadError,
  HttpOcrProvider,
  InMemoryStorageProvider,
  assertPdfIntegrity,
  authorizeAndSignDocumentDownload,
  isDocumentDownloadBlockedByProcessingState,
  processDocumentPipeline,
  probeClamAvConnectivity,
  sha256Buffer,
  type TextExtractor,
  type ExtractionResult,
  type ProcessDocumentPipelineDeps,
} from "./index";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const clamavLive = process.env.CLAMAV_LIVE === "1";
const dbUrl =
  process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
const clamHost = process.env.CLAMAV_HOST ?? "127.0.0.1";
const clamPort = process.env.CLAMAV_PORT ? Number(process.env.CLAMAV_PORT) : 3310;

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const GOLD_OCR_TEXT =
  "SYNTH OCR GOLD: The notice of hearing was served on March 1, 2025 in County Court.";

const scannedExtractor: TextExtractor = {
  name: "wp04-scanned-fixture",
  supports: () => true,
  async extract(): Promise<ExtractionResult> {
    return {
      status: "requires_ocr",
      reason: "PDF has no useful native text layer",
      extractor: "wp04-scanned-fixture",
    };
  },
};

const nativeExtractor: TextExtractor = {
  name: "wp04-native-fixture",
  supports: () => true,
  async extract(): Promise<ExtractionResult> {
    return {
      status: "ok",
      extractor: "wp04-native-fixture",
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

describe.runIf(runDbTests && clamavLive)("WP-04 final acceptance (ClamAV + OCR harness)", () => {
  const db: Database = createDb(dbUrl);
  const storage = new InMemoryStorageProvider();
  const embeddings = new MockEmbeddingProvider();
  const scanner = new ClamAvMalwareScanner({
    host: clamHost,
    port: clamPort,
    timeoutMs: 20_000,
  });
  const suffix = `wp04_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const metrics: Record<string, number> = {
    cleanUploadMs: 0,
    eicarUploadMs: 0,
    ocrHttpMs: 0,
    ocrLoadP50: 0,
    ocrLoadP95: 0,
    concurrentScans: 0,
  };

  let ocrServer: Server | null = null;
  let ocrEndpoint = "";
  let ocrCalls = 0;

  function baseDeps(
    overrides: Partial<ProcessDocumentPipelineDeps> = {},
  ): ProcessDocumentPipelineDeps {
    return {
      db,
      storage,
      scanner,
      embeddings,
      ocrEnabled: false,
      extractor: nativeExtractor,
      ...overrides,
    };
  }

  function pipelineInput(documentId: string, documentVersionId: string) {
    return {
      organizationId: ids.org!,
      matterId: ids.matter!,
      documentId,
      documentVersionId,
    };
  }

  beforeAll(async () => {
    expect(isLocalCertificationDatabaseUrl(dbUrl)).toBe(true);
    const probe = await probeClamAvConnectivity({
      host: clamHost,
      port: clamPort,
      timeoutMs: 15_000,
    });
    expect(probe.ok).toBe(true);

    ocrServer = createServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(Buffer.from(c)));
      req.on("end", () => {
        ocrCalls += 1;
        const body = Buffer.concat(chunks);
        if (body.length === 0) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "empty" }));
          return;
        }
        const filename = decodeURIComponent(String(req.headers["x-filename"] ?? ""));
        if (filename.includes("ocr-timeout")) {
          // hang until client aborts — do not respond
          return;
        }
        if (filename.includes("ocr-fail")) {
          res.writeHead(500);
          res.end("OCR boom");
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            segments: [
              {
                text: GOLD_OCR_TEXT,
                page: 1,
                segmentRef: "ocr-p1",
                charStart: 0,
                charEnd: GOLD_OCR_TEXT.length,
              },
            ],
          }),
        );
      });
    });
    await new Promise<void>((resolve) => {
      ocrServer!.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = ocrServer.address();
    if (!addr || typeof addr === "string") throw new Error("OCR mock server failed to bind");
    ocrEndpoint = `http://127.0.0.1:${addr.port}/ocr`;

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `wp04_owner_${suffix}`,
        email: `wp04_owner_${suffix}@example.nyayagrid.local`,
        name: "WP04 Owner",
      })
      .returning();
    ids.owner = owner!.id;
    const org = await createOrganizationWithDefaults(db, {
      name: `WP04 Firm ${suffix}`,
      slug: `wp04-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    ids.org = org.organization.id;
    const [client] = await db
      .insert(clients)
      .values({
        organizationId: ids.org!,
        displayName: "WP04 Client",
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
        matterNumber: `WP04-${suffix}`,
        title: `WP04 Acceptance ${suffix}`,
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
    console.log(JSON.stringify({ wp04_final_acceptance_metrics: metrics, ocrCalls }));
    await new Promise<void>((resolve) => {
      if (!ocrServer) return resolve();
      ocrServer.close(() => resolve());
    });
    await closeDb(db);
  });

  async function seedDocument(params: {
    filename: string;
    body: Buffer;
    contentType?: string;
    state?: string;
  }) {
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
      metadata: { sha256: sha256Buffer(params.body) },
    });
    await db.insert(documents).values({
      id: documentId,
      organizationId: ids.org!,
      matterId: ids.matter!,
      title: params.filename,
      createdByUserId: ids.owner!,
      processingState: (params.state as never) ?? "uploaded",
      malwareScanStatus: "not_scanned",
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

  async function docRow(documentId: string) {
    const [row] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, ids.org!)))
      .limit(1);
    return row!;
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

  it("blocks download before malware scan completes", () => {
    expect(isDocumentDownloadBlockedByProcessingState("uploaded")).toBe(true);
    expect(isDocumentDownloadBlockedByProcessingState("awaiting_malware_scan")).toBe(true);
    expect(isDocumentDownloadBlockedByProcessingState("scan_blocked")).toBe(true);
    expect(isDocumentDownloadBlockedByProcessingState("ready")).toBe(false);
    expect(isDocumentDownloadBlockedByProcessingState("scan_clean")).toBe(false);
  });

  it("rejects PDF integrity spoof before ingest", () => {
    expect(() =>
      assertPdfIntegrity({
        contentType: "application/pdf",
        filename: "spoof.pdf",
        buffer: Buffer.from("MZ-not-a-pdf"),
      }),
    ).toThrow(/PDF_INTEGRITY_FAILED|valid PDF header/i);
  });

  it("clean PDF upload: live ClamAV clean → extract → ready path", async () => {
    const t0 = Date.now();
    const { documentId, versionId } = await seedDocument({
      filename: `clean-${suffix}.pdf`,
      body: Buffer.from("%PDF-1.4\n% clean synth notice\n"),
    });
    await expect(
      authorizeAndSignDocumentDownload({
        db,
        storage,
        userId: ids.owner!,
        organizationId: ids.org!,
        matterId: ids.matter!,
        documentId,
        authCheck: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_BLOCKED" });

    const result = await processDocumentPipeline(
      baseDeps({ ocrEnabled: false, extractor: nativeExtractor }),
      pipelineInput(documentId, versionId),
    );
    metrics.cleanUploadMs = Date.now() - t0;
    expect(result.ok).toBe(true);
    const row = await docRow(documentId);
    expect(row.processingState).toBe("ready");
    expect(row.malwareScanStatus).toBe("clean");
    expect(await chunkCount(documentId)).toBeGreaterThan(0);

    const signed = await authorizeAndSignDocumentDownload({
      db,
      storage,
      userId: ids.owner!,
      organizationId: ids.org!,
      matterId: ids.matter!,
      documentId,
      authCheck: async () => undefined,
    });
    expect(signed.documentId).toBe(documentId);
  }, 60_000);

  it("EICAR upload: live ClamAV blocks + download remains quarantined", async () => {
    const t0 = Date.now();
    // Standard EICAR COM string as its own object (not PDF-wrapped — clamd matches the
    // canonical signature; MIME spoof is covered separately via assertPdfIntegrity).
    const eicarBody = Buffer.from(EICAR);
    const { documentId, versionId } = await seedDocument({
      filename: `eicar-${suffix}.txt`,
      body: eicarBody,
      contentType: "text/plain",
    });
    const result = await processDocumentPipeline(
      baseDeps({ ocrEnabled: false, extractor: nativeExtractor }),
      pipelineInput(documentId, versionId),
    );
    metrics.eicarUploadMs = Date.now() - t0;
    expect(result.ok).toBe(false);
    expect(result.state).toBe("scan_blocked");
    const row = await docRow(documentId);
    expect(row.malwareScanStatus).toBe("blocked");
    expect(await chunkCount(documentId)).toBe(0);
    await expect(
      authorizeAndSignDocumentDownload({
        db,
        storage,
        userId: ids.owner!,
        organizationId: ids.org!,
        matterId: ids.matter!,
        documentId,
        authCheck: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(DocumentDownloadError);
  }, 60_000);

  it("scanner unavailable fails closed (no ready, no chunks)", async () => {
    const badScanner = new ClamAvMalwareScanner({
      host: "127.0.0.1",
      port: 1,
      timeoutMs: 800,
    });
    const { documentId, versionId } = await seedDocument({
      filename: `scan-down-${suffix}.pdf`,
      body: Buffer.from("%PDF-1.4\n% down\n"),
    });
    const result = await processDocumentPipeline(
      baseDeps({ scanner: badScanner, ocrEnabled: false, extractor: nativeExtractor }),
      pipelineInput(documentId, versionId),
    );
    expect(result.ok).toBe(false);
    expect(["malware_scan_failed", "failed"]).toContain(result.state);
    expect(await chunkCount(documentId)).toBe(0);
  }, 30_000);

  it("scanned PDF + local HTTP OCR extracts gold text with provenance", async () => {
    const t0 = Date.now();
    const ocr = new HttpOcrProvider({ endpoint: ocrEndpoint, timeoutMs: 10_000 });
    const { documentId, versionId } = await seedDocument({
      filename: `scanned-${suffix}.pdf`,
      body: Buffer.from("%PDF-1.4\n% image-only synth\n"),
    });
    const before = ocrCalls;
    const result = await processDocumentPipeline(
      baseDeps({ ocr, ocrEnabled: true, extractor: scannedExtractor }),
      pipelineInput(documentId, versionId),
    );
    metrics.ocrHttpMs = Date.now() - t0;
    expect(result.ok).toBe(true);
    expect(ocrCalls).toBeGreaterThan(before);
    const row = await docRow(documentId);
    expect(row.processingState).toBe("ready");
    expect(await chunkCount(documentId)).toBeGreaterThan(0);

    const [chunk] = await db
      .select()
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.organizationId, ids.org!),
          eq(documentChunks.documentId, documentId),
        ),
      )
      .limit(1);
    expect(chunk?.content ?? "").toContain("SYNTH OCR GOLD");
    expect(chunk?.segmentRef ?? chunk?.pageStart ?? null).not.toBeNull();
  }, 60_000);

  it("OCR failure does not mark document ready", async () => {
    const ocr = new HttpOcrProvider({ endpoint: ocrEndpoint, timeoutMs: 5_000 });
    const { documentId, versionId } = await seedDocument({
      filename: `ocr-fail-${suffix}.pdf`,
      body: Buffer.from("%PDF-1.4\n% fail\n"),
    });
    const result = await processDocumentPipeline(
      baseDeps({ ocr, ocrEnabled: true, extractor: scannedExtractor }),
      pipelineInput(documentId, versionId),
    );
    expect(result.ok).toBe(false);
    expect(result.state).not.toBe("ready");
    const row = await docRow(documentId);
    expect(row.processingState).not.toBe("ready");
    expect(await chunkCount(documentId)).toBe(0);
  }, 60_000);

  it("native searchable PDF skips OCR and stays ready", async () => {
    const ocr = new HttpOcrProvider({ endpoint: ocrEndpoint, timeoutMs: 10_000 });
    const before = ocrCalls;
    const { documentId, versionId } = await seedDocument({
      filename: `native-${suffix}.pdf`,
      body: Buffer.from("%PDF-1.4\n% searchable\n"),
    });
    const result = await processDocumentPipeline(
      baseDeps({ ocr, ocrEnabled: true, extractor: nativeExtractor }),
      pipelineInput(documentId, versionId),
    );
    expect(result.ok).toBe(true);
    expect(ocrCalls).toBe(before);
    expect((await docRow(documentId)).processingState).toBe("ready");
  }, 60_000);

  it("unauthorized cross-org download denied", async () => {
    const { documentId } = await seedDocument({
      filename: `xorg-${suffix}.pdf`,
      body: Buffer.from("%PDF-1.4\n% xorg\n"),
      state: "ready",
    });
    await db
      .update(documents)
      .set({ processingState: "ready", malwareScanStatus: "clean" })
      .where(eq(documents.id, documentId));
    await expect(
      authorizeAndSignDocumentDownload({
        db,
        storage,
        userId: ids.owner!,
        organizationId: crypto.randomUUID(),
        matterId: ids.matter!,
        documentId,
        authCheck: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(DocumentDownloadError);
  }, 30_000);

  it("bounded OCR load: 8 sequential scanned docs — measure p50/p95", async () => {
    const ocr = new HttpOcrProvider({ endpoint: ocrEndpoint, timeoutMs: 10_000 });
    const latencies: number[] = [];
    for (let i = 0; i < 8; i++) {
      const { documentId, versionId } = await seedDocument({
        filename: `load-${i}-${suffix}.pdf`,
        body: Buffer.from(`%PDF-1.4\n% load ${i}\n`),
      });
      const t0 = Date.now();
      const result = await processDocumentPipeline(
        baseDeps({ ocr, ocrEnabled: true, extractor: scannedExtractor }),
        pipelineInput(documentId, versionId),
      );
      latencies.push(Date.now() - t0);
      expect(result.ok).toBe(true);
    }
    const sorted = [...latencies].sort((a, b) => a - b);
    metrics.ocrLoadP50 = sorted[Math.floor(sorted.length * 0.5)]!;
    metrics.ocrLoadP95 = sorted[Math.floor(sorted.length * 0.95)]!;
    expect(metrics.ocrLoadP50).toBeGreaterThan(0);
  }, 180_000);

  it("concurrent ClamAV scans of clean payloads", async () => {
    const t0 = Date.now();
    const jobs = Array.from({ length: 4 }, async (_, i) => {
      const { documentId, versionId } = await seedDocument({
        filename: `conc-${i}-${suffix}.pdf`,
        body: Buffer.from(`%PDF-1.4\n% concurrent ${i}\n`),
      });
      return processDocumentPipeline(
        baseDeps({ ocrEnabled: false, extractor: nativeExtractor }),
        pipelineInput(documentId, versionId),
      );
    });
    const results = await Promise.all(jobs);
    metrics.concurrentScans = Date.now() - t0;
    expect(results.every((r) => r.ok)).toBe(true);
  }, 90_000);
});

describe("WP-04 download quarantine policy (unit)", () => {
  it("pre-scan and blocked states refuse download", () => {
    for (const state of [
      "uploaded",
      "awaiting_malware_scan",
      "quarantined",
      "scan_blocked",
      "malware_scan_failed",
    ]) {
      expect(isDocumentDownloadBlockedByProcessingState(state)).toBe(true);
    }
  });
});
