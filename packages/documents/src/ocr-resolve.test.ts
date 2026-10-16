import { describe, expect, it, vi } from "vitest";
import type { ExtractionResult } from "./extract";
import type { OcrProvider, OcrResult } from "./ocr";
import { UnsupportedOcrProvider } from "./ocr";
import {
  canAttemptOcr,
  isOcrFeatureEnabled,
  isOcrProviderConfigured,
  resolveTextWithOptionalOcr,
} from "./ocr-resolve";

const scannedExtraction: ExtractionResult = {
  status: "requires_ocr",
  reason: "PDF has no useful native text layer",
  extractor: "pdf",
};

const nativeExtraction: ExtractionResult = {
  status: "ok",
  extractor: "pdf",
  segments: [
    {
      text: "Native selectable PDF text with enough characters.",
      page: 1,
      segmentRef: "pdf-p1-1",
      charStart: 0,
      charEnd: 48,
    },
  ],
};

function mockOcr(result: OcrResult, name = "mock-ocr"): OcrProvider {
  return {
    name,
    extractText: vi.fn(async () => result),
  };
}

describe("OCR feature / provider readiness", () => {
  it("FEATURE_OCR flag alone does not imply a configured provider", () => {
    expect(isOcrFeatureEnabled({ FEATURE_OCR: "1" })).toBe(true);
    expect(isOcrFeatureEnabled({})).toBe(false);
    expect(isOcrProviderConfigured(new UnsupportedOcrProvider())).toBe(false);
    expect(canAttemptOcr({ ocrEnabled: true, provider: new UnsupportedOcrProvider() })).toBe(false);
    expect(
      canAttemptOcr({ ocrEnabled: true, provider: mockOcr({ status: "completed", provider: "x", segments: [] }) }),
    ).toBe(true);
    expect(canAttemptOcr({ ocrEnabled: false, provider: mockOcr({ status: "unsupported", reason: "x" }) })).toBe(
      false,
    );
  });
});

describe("resolveTextWithOptionalOcr", () => {
  it("1 — scanned PDF + OCR disabled → requires_ocr (no fabricate)", async () => {
    const ocr = mockOcr({
      status: "completed",
      provider: "mock",
      segments: [{ text: "should not be used", segmentRef: "ocr-p1", charStart: 0, charEnd: 18 }],
    });
    const result = await resolveTextWithOptionalOcr({
      extraction: scannedExtraction,
      ocr,
      ocrEnabled: false,
      buffer: Buffer.from("%PDF"),
      contentType: "application/pdf",
      filename: "scan.pdf",
    });
    expect(result.status).toBe("requires_ocr");
    expect(ocr.extractText).not.toHaveBeenCalled();
    if (result.status === "requires_ocr") {
      expect(result.reason).toMatch(/FEATURE_OCR|not enabled/i);
    }
  });

  it("2 — scanned PDF + OCR enabled but provider unavailable → requires_ocr", async () => {
    const result = await resolveTextWithOptionalOcr({
      extraction: scannedExtraction,
      ocr: new UnsupportedOcrProvider(),
      ocrEnabled: true,
      buffer: Buffer.from("%PDF"),
      contentType: "application/pdf",
      filename: "scan.pdf",
    });
    expect(result.status).toBe("requires_ocr");
    if (result.status === "requires_ocr") {
      expect(result.reason).toMatch(/no OCR provider|OCR_ENDPOINT|not configured/i);
    }
  });

  it("3 — scanned PDF + OCR success → segments with provenance", async () => {
    const ocr = mockOcr({
      status: "completed",
      provider: "http",
      segments: [
        {
          text: "OCR recovered paragraph about cure notice.",
          page: 2,
          segmentRef: "ocr-p2",
          charStart: 0,
          charEnd: 42,
        },
      ],
    });
    const result = await resolveTextWithOptionalOcr({
      extraction: scannedExtraction,
      ocr,
      ocrEnabled: true,
      buffer: Buffer.from("%PDF-scan"),
      contentType: "application/pdf",
      filename: "scan.pdf",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("ocr");
      expect(result.provider).toBe("http");
      expect(result.segments[0]?.page).toBe(2);
      expect(result.segments[0]?.segmentRef).toBe("ocr-p2");
      expect(result.segments[0]?.text).toMatch(/cure notice/);
    }
    expect(ocr.extractText).toHaveBeenCalledTimes(1);
  });

  it("4 — OCR empty output → ocr_failed (not complete)", async () => {
    const ocr = mockOcr({
      status: "completed",
      provider: "http",
      segments: [{ text: "   ", segmentRef: "ocr-p1", charStart: 0, charEnd: 3 }],
    });
    const result = await resolveTextWithOptionalOcr({
      extraction: scannedExtraction,
      ocr,
      ocrEnabled: true,
      buffer: Buffer.from("%PDF"),
      contentType: "application/pdf",
      filename: "scan.pdf",
    });
    expect(result.status).toBe("ocr_failed");
    if (result.status === "ocr_failed") {
      expect(result.reason).toMatch(/empty/i);
    }
  });

  it("5 — OCR provider error → ocr_failed", async () => {
    const ocr = mockOcr({ status: "failed", reason: "HTTP 503" });
    const result = await resolveTextWithOptionalOcr({
      extraction: scannedExtraction,
      ocr,
      ocrEnabled: true,
      buffer: Buffer.from("%PDF"),
      contentType: "application/pdf",
      filename: "scan.pdf",
    });
    expect(result.status).toBe("ocr_failed");
    if (result.status === "ocr_failed") {
      expect(result.reason).toMatch(/503|OCR failed/i);
    }
  });

  it("6 — normal text PDF → OCR not invoked", async () => {
    const ocr = mockOcr({
      status: "completed",
      provider: "http",
      segments: [{ text: "should not appear", segmentRef: "x", charStart: 0, charEnd: 1 }],
    });
    const result = await resolveTextWithOptionalOcr({
      extraction: nativeExtraction,
      ocr,
      ocrEnabled: true,
      buffer: Buffer.from("%PDF-text"),
      contentType: "application/pdf",
      filename: "native.pdf",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("native");
      expect(result.segments[0]?.text).toMatch(/Native selectable/);
    }
    expect(ocr.extractText).not.toHaveBeenCalled();
  });

  it("7 — mixed: native failure path still fails without inventing OCR text when disabled", async () => {
    const result = await resolveTextWithOptionalOcr({
      extraction: { status: "failed", reason: "parser crash", extractor: "pdf" },
      ocr: mockOcr({
        status: "completed",
        provider: "http",
        segments: [{ text: "invented", segmentRef: "x", charStart: 0, charEnd: 8 }],
      }),
      ocrEnabled: false,
      buffer: Buffer.from("%PDF"),
      contentType: "application/pdf",
      filename: "bad.pdf",
    });
    expect(result.status).toBe("extraction_failed");
  });

  it("8 — provenance: page + segmentRef preserved from OCR provider", async () => {
    const result = await resolveTextWithOptionalOcr({
      extraction: scannedExtraction,
      ocr: mockOcr({
        status: "completed",
        provider: "http",
        segments: [
          { text: "Page one OCR", page: 1, segmentRef: "ocr-custom-1", charStart: 0, charEnd: 12 },
          { text: "Page two OCR", page: 2, segmentRef: "ocr-custom-2", charStart: 0, charEnd: 12 },
        ],
      }),
      ocrEnabled: true,
      buffer: Buffer.from("%PDF"),
      contentType: "application/pdf",
      filename: "scan.pdf",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.segments.map((s) => s.segmentRef)).toEqual(["ocr-custom-1", "ocr-custom-2"]);
      expect(result.segments.map((s) => s.page)).toEqual([1, 2]);
    }
  });

  it("9 — provider unsupported status after attempt → requires_ocr (not complete)", async () => {
    const result = await resolveTextWithOptionalOcr({
      extraction: scannedExtraction,
      ocr: mockOcr({ status: "unsupported", reason: "tesseract.js missing" }, "tesseract"),
      ocrEnabled: true,
      buffer: Buffer.from("%PDF"),
      contentType: "application/pdf",
      filename: "scan.pdf",
    });
    expect(result.status).toBe("requires_ocr");
  });

  it("10 — feature flag on + omitted provider → requires_ocr (no silent enable)", async () => {
    const result = await resolveTextWithOptionalOcr({
      extraction: scannedExtraction,
      ocr: null,
      ocrEnabled: true,
      buffer: Buffer.from("%PDF"),
      contentType: "application/pdf",
      filename: "scan.pdf",
    });
    expect(result.status).toBe("requires_ocr");
    if (result.status === "requires_ocr") {
      expect(result.reason).toMatch(/FEATURE_OCR|no OCR provider/i);
    }
  });
});
