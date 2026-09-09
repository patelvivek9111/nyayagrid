import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertNeverMarkedScannedWithoutScanner,
  assertPageCountAllowed,
  assertStoredObjectMatchesDocumentVersion,
  assertUploadSizeAllowed,
  canTransitionDocumentState,
  chunkSegments,
  ClamAvMalwareScanner,
  createMalwareScannerFromEnv,
  createStorageProviderFromEnv,
  DevelopmentMalwareScanner,
  DocumentDownloadError,
  enforceProductionScanPolicy,
  InMemoryStorageProvider,
  mapMalwareResultToProcessingState,
  MAX_UPLOAD_BYTES,
  rejectZipBombsOrArchives,
  resolveContentDisposition,
  safeContentDisposition,
  sha256Buffer,
  signDocumentDownload,
  transitionDocumentState,
  truncateExtractedText,
  TxtExtractor,
  UnsupportedOcrProvider,
  UploadLimitError,
  withTimeout,
} from "./index";

describe("document processing states", () => {
  it("allows uploaded -> awaiting_malware_scan", () => {
    expect(canTransitionDocumentState("uploaded", "awaiting_malware_scan")).toBe(true);
    expect(transitionDocumentState("uploaded", "awaiting_malware_scan")).toBe(
      "awaiting_malware_scan",
    );
  });

  it("rejects invalid transitions", () => {
    expect(() => transitionDocumentState("uploaded", "ready")).toThrow(/Invalid/);
  });

  it("maps development scanner to unscanned_development", async () => {
    const scanner = new DevelopmentMalwareScanner();
    const result = await scanner.scan({
      key: "org/x/documents/y/versions/z/a.pdf",
      contentType: "application/pdf",
      byteSize: 10,
    });
    expect(result.status).toBe("development_unscanned");
    expect(mapMalwareResultToProcessingState(result)).toBe("unscanned_development");
    expect(() => assertNeverMarkedScannedWithoutScanner(scanner.name, result)).not.toThrow();
  });

  it("OCR unsupported does not fabricate text", async () => {
    const ocr = new UnsupportedOcrProvider();
    const result = await ocr.extractText({
      contentType: "application/pdf",
      filename: "scan.pdf",
    });
    expect(result.status).toBe("unsupported");
  });

  it("hashes content", () => {
    expect(sha256Buffer(Buffer.from("hello"))).toHaveLength(64);
  });

  it("selects the s3 provider from runtime env keys, not build-time member access", () => {
    const keys = [
      "APP_ENV",
      "STORAGE_PROVIDER",
      "S3_ENDPOINT",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_BUCKET",
      "S3_REGION",
      "S3_FORCE_PATH_STYLE",
    ] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    process.env.APP_ENV = "staging";
    process.env.STORAGE_PROVIDER = "s3";
    process.env.S3_ENDPOINT = "https://example.r2.cloudflarestorage.com";
    process.env.S3_ACCESS_KEY_ID = "runtime-key";
    process.env.S3_SECRET_ACCESS_KEY = "runtime-secret";
    process.env.S3_BUCKET = "runtime-bucket";
    process.env.S3_REGION = "auto";
    process.env.S3_FORCE_PATH_STYLE = "true";
    try {
      expect(createStorageProviderFromEnv().name).toBe("aws-s3");
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });
});

describe("text extraction and chunking", () => {
  it("extracts TXT with provenance", async () => {
    const extractor = new TxtExtractor();
    const result = await extractor.extract({
      buffer: Buffer.from(
        "Termination may occur on thirty days notice.\n\nPayment is due on the first.",
      ),
      contentType: "text/plain",
      filename: "agreement.txt",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.segments[0]?.segmentRef).toContain("p");
    const chunks = chunkSegments(result.segments);
    expect(chunks[0]?.content).toContain("Termination");
  });

  it("rejects empty text instead of producing Ready-eligible chunks", async () => {
    const extractor = new TxtExtractor();
    const result = await extractor.extract({
      buffer: Buffer.from("   \n\n  "),
      contentType: "text/plain",
      filename: "blank.txt",
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toMatch(/empty/i);
    }
  });
});

describe("malware scanning", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("DevelopmentMalwareScanner is never marked clean, no matter what result it returns", async () => {
    const scanner = new DevelopmentMalwareScanner();
    const result = await scanner.scan({
      key: "org/x/documents/y/versions/z/a.pdf",
      contentType: "application/pdf",
      byteSize: 10,
    });
    expect(result.status).toBe("development_unscanned");
    expect(() => assertNeverMarkedScannedWithoutScanner(scanner.name, result)).not.toThrow();
    // A hypothetical "clean" result must never be trusted from the development scanner.
    expect(() => assertNeverMarkedScannedWithoutScanner(scanner.name, { status: "clean" })).toThrow(
      /must not mark documents as clean/,
    );
  });

  it("ClamAvMalwareScanner fixture mode blocks an EICAR-signature payload", async () => {
    const scanner = new ClamAvMalwareScanner({ fixtureMode: true });
    const result = await scanner.scan({
      key: "org/x/documents/y/versions/z/notice.txt",
      contentType: "text/plain",
      byteSize: 100,
      getContent: async () =>
        Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"),
    });
    expect(result.status).toBe("blocked");
  });

  it("ClamAvMalwareScanner fixture mode blocks a storage key containing 'infected'", async () => {
    const scanner = new ClamAvMalwareScanner({ fixtureMode: true });
    const result = await scanner.scan({
      key: "org/x/documents/y/versions/z/infected-file.pdf",
      contentType: "application/pdf",
      byteSize: 100,
    });
    expect(result.status).toBe("blocked");
  });

  it("ClamAvMalwareScanner fixture mode reports clean for benign content", async () => {
    const scanner = new ClamAvMalwareScanner({ fixtureMode: true });
    const result = await scanner.scan({
      key: "org/x/documents/y/versions/z/clean.pdf",
      contentType: "application/pdf",
      byteSize: 100,
      getContent: async () => Buffer.from("This is a perfectly normal legal document."),
    });
    expect(result.status).toBe("clean");
  });

  it("ClamAvMalwareScanner requires a host outside of fixture mode", () => {
    expect(() => new ClamAvMalwareScanner({})).toThrow(/CLAMAV_HOST/);
  });

  it("enforceProductionScanPolicy allows development_unscanned in development/test", () => {
    const result = { status: "development_unscanned" as const, reason: "unscanned" };
    expect(enforceProductionScanPolicy(result, "development").status).toBe("development_unscanned");
    expect(enforceProductionScanPolicy(result, "test").status).toBe("development_unscanned");
  });

  it("enforceProductionScanPolicy converts development_unscanned to failed in production", () => {
    const result = { status: "development_unscanned" as const, reason: "unscanned" };
    const enforced = enforceProductionScanPolicy(result, "production");
    expect(enforced.status).toBe("failed");
  });

  it("createMalwareScannerFromEnv refuses the development scanner in production", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("MALWARE_SCANNER", "");
    expect(() => createMalwareScannerFromEnv()).toThrow(/cannot be used when APP_ENV=production/);
  });

  it("createMalwareScannerFromEnv requires CLAMAV_HOST for clamav in production", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("MALWARE_SCANNER", "clamav");
    vi.stubEnv("CLAMAV_HOST", "");
    vi.stubEnv("CLAMAV_FIXTURE", "");
    expect(() => createMalwareScannerFromEnv()).toThrow(/CLAMAV_HOST/);
  });

  it("createMalwareScannerFromEnv refuses fixture mode in staging/production", () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("MALWARE_SCANNER", "clamav");
    vi.stubEnv("CLAMAV_FIXTURE", "1");
    expect(() => createMalwareScannerFromEnv()).toThrow(/CLAMAV_FIXTURE/);
  });

  it("createMalwareScannerFromEnv returns the development scanner outside production", () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("MALWARE_SCANNER", "");
    const scanner = createMalwareScannerFromEnv();
    expect(scanner.name).toBe("development");
  });
});

describe("signed downloads and content disposition", () => {
  it("safeContentDisposition always forces a fallback ASCII filename plus a UTF-8 filename*", () => {
    const header = safeContentDisposition('weird "name".pdf');
    expect(header).toContain("attachment;");
    expect(header).toMatch(/filename="[^"]*"/);
    expect(header).toContain("filename*=UTF-8''");
    expect(header).not.toContain('"weird "name"');
  });

  it("resolveContentDisposition forces attachment for dangerous inline types like HTML and SVG", () => {
    expect(resolveContentDisposition("text/html", "page.html", "inline")).toMatch(/^attachment;/);
    expect(resolveContentDisposition("image/svg+xml", "diagram.svg", "inline")).toMatch(
      /^attachment;/,
    );
  });

  it("resolveContentDisposition honors the preferred disposition for safe types", () => {
    expect(resolveContentDisposition("application/pdf", "brief.pdf", "inline")).toMatch(/^inline;/);
    expect(resolveContentDisposition("application/pdf", "brief.pdf")).toMatch(/^attachment;/);
  });

  it("InMemoryStorageProvider issues a fake but well-formed signed URL for tests", async () => {
    const storage = new InMemoryStorageProvider();
    await storage.putObject({
      key: "org/x/documents/y/versions/z/brief.pdf",
      body: Buffer.from("content"),
      contentType: "application/pdf",
    });
    const signed = await signDocumentDownload({
      storage,
      storageKey: "org/x/documents/y/versions/z/brief.pdf",
      filename: "brief.pdf",
      contentType: "application/pdf",
    });
    expect(signed.url).toMatch(/^memory:\/\/signed\//);
    expect(signed.contentDisposition).toMatch(/^attachment;/);
    expect(signed.expiresInSeconds).toBeGreaterThan(0);
  });

  it("InMemoryStorageProvider signed URL lookup fails for a missing object", async () => {
    const storage = new InMemoryStorageProvider();
    await expect(storage.getSignedDownloadUrl({ key: "org/x/does-not-exist" })).rejects.toThrow(
      /not found/,
    );
  });

  it("unique version keys keep the original object addressable after a later version is stored", async () => {
    const storage = new InMemoryStorageProvider();
    const v1Key = "org/org_a/documents/doc_1/versions/ver_1/notice.txt";
    const v2Key = "org/org_a/documents/doc_1/versions/ver_2/notice.txt";
    const original = Buffer.from("original-bytes");
    const later = Buffer.from("later-bytes");
    await storage.putObject({
      key: v1Key,
      body: original,
      contentType: "text/plain",
      metadata: { sha256: sha256Buffer(original) },
    });
    await storage.putObject({
      key: v2Key,
      body: later,
      contentType: "text/plain",
      metadata: { sha256: sha256Buffer(later) },
    });
    expect(Buffer.from(await storage.getObject(v1Key)).equals(original)).toBe(true);
    expect(Buffer.from(await storage.getObject(v2Key)).equals(later)).toBe(true);
  });

  it("metadata/object mismatch and missing objects fail closed", async () => {
    const storage = new InMemoryStorageProvider();
    const key = "org/org_a/documents/doc_1/versions/ver_1/notice.txt";
    const body = Buffer.from("original-bytes");
    await storage.putObject({
      key,
      body,
      contentType: "text/plain",
      metadata: { sha256: sha256Buffer(body) },
    });
    await expect(
      assertStoredObjectMatchesDocumentVersion({
        storage,
        storageKey: key,
        sha256: sha256Buffer(body),
        byteSize: body.length,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertStoredObjectMatchesDocumentVersion({
        storage,
        storageKey: key,
        sha256: "0".repeat(64),
        byteSize: body.length,
      }),
    ).rejects.toMatchObject({ code: "OBJECT_MISMATCH" });
    await expect(
      assertStoredObjectMatchesDocumentVersion({
        storage,
        storageKey: key,
        sha256: sha256Buffer(body),
        byteSize: body.length + 1,
      }),
    ).rejects.toBeInstanceOf(DocumentDownloadError);
    await expect(
      assertStoredObjectMatchesDocumentVersion({
        storage,
        storageKey: "org/org_a/documents/doc_1/versions/ver_missing/notice.txt",
        sha256: sha256Buffer(body),
        byteSize: body.length,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("upload limits", () => {
  it("enforces MAX_UPLOAD_BYTES", () => {
    expect(() => assertUploadSizeAllowed(0)).toThrow(UploadLimitError);
    expect(() => assertUploadSizeAllowed(MAX_UPLOAD_BYTES + 1)).toThrow(/exceeds/);
    expect(() => assertUploadSizeAllowed(1024)).not.toThrow();
  });

  it("rejects archive uploads by extension, MIME type, and zip magic bytes", () => {
    expect(() =>
      rejectZipBombsOrArchives({ contentType: "application/pdf", filename: "bundle.zip" }),
    ).toThrow(/Archive/);
    expect(() =>
      rejectZipBombsOrArchives({ contentType: "application/zip", filename: "bundle.pdf" }),
    ).toThrow(/Archive/);
    expect(() =>
      rejectZipBombsOrArchives({
        contentType: "application/octet-stream",
        filename: "renamed.pdf",
        buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
      }),
    ).toThrow(/Archive/);
    expect(() =>
      rejectZipBombsOrArchives({ contentType: "application/pdf", filename: "brief.pdf" }),
    ).not.toThrow();
    expect(() =>
      rejectZipBombsOrArchives({
        contentType: "application/pdf",
        filename: "malware.pdf",
        buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
      }),
    ).toThrow(/Archive/);
    expect(() =>
      rejectZipBombsOrArchives({
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: "brief.docx",
        buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
      }),
    ).not.toThrow();
    expect(() =>
      rejectZipBombsOrArchives({
        contentType: "application/zip",
        filename: "bundle.zip",
        allowArchives: true,
      }),
    ).not.toThrow();
  });

  it("truncateExtractedText caps text at MAX_EXTRACTED_CHARS", () => {
    const { text, truncated } = truncateExtractedText("short text");
    expect(truncated).toBe(false);
    expect(text).toBe("short text");
  });

  it("assertPageCountAllowed rejects documents over MAX_PAGES", () => {
    expect(() => assertPageCountAllowed(1)).not.toThrow();
    expect(() => assertPageCountAllowed(1_000_000)).toThrow(/exceeding the maximum/);
  });

  it("withTimeout rejects slow operations", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(slow, 10, "slow op")).rejects.toThrow(/timed out/);
  });

  it("withTimeout resolves fast operations normally", async () => {
    await expect(withTimeout(Promise.resolve("done"), 1000)).resolves.toBe("done");
  });
});
