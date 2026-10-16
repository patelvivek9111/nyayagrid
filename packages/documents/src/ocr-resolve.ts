/**
 * Week 3 Slice 1 — decide whether OCR may run and resolve text for the ingest pipeline.
 * Does not invent text. Does not add processing-state enum values (pgEnum shared schema).
 */
import type { ExtractionResult, ExtractedSegment } from "./extract";
import type { OcrProvider } from "./ocr";
import { UnsupportedOcrProvider } from "./ocr";

export type OcrTextResolution =
  | {
      status: "ok";
      segments: ExtractedSegment[];
      source: "native" | "ocr";
      provider: string;
    }
  | {
      /** OCR not attempted or not available — park at requires_ocr. */
      status: "requires_ocr";
      reason: string;
    }
  | {
      /** OCR was attempted and failed/empty — do not mark complete. */
      status: "ocr_failed";
      reason: string;
    }
  | {
      status: "extraction_failed";
      reason: string;
    };

/** FEATURE_OCR alone must not imply a working provider. */
export function isOcrFeatureEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.FEATURE_OCR?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function isOcrProviderConfigured(provider: OcrProvider | null | undefined): boolean {
  return Boolean(provider && provider.name !== "unsupported");
}

/**
 * OCR may run only when the feature flag is on AND a real provider is wired.
 * Flag-on + UnsupportedOcrProvider → unavailable (honest requires_ocr).
 */
export function canAttemptOcr(params: {
  ocrEnabled: boolean;
  provider: OcrProvider | null | undefined;
}): boolean {
  return params.ocrEnabled && isOcrProviderConfigured(params.provider);
}

export async function resolveTextWithOptionalOcr(params: {
  extraction: ExtractionResult;
  ocr: OcrProvider | null | undefined;
  ocrEnabled: boolean;
  buffer: Buffer;
  contentType: string;
  filename: string;
}): Promise<OcrTextResolution> {
  const { extraction } = params;

  if (extraction.status === "ok") {
    return {
      status: "ok",
      segments: extraction.segments,
      source: "native",
      provider: extraction.extractor,
    };
  }

  if (extraction.status === "failed") {
    return { status: "extraction_failed", reason: extraction.reason };
  }

  // extraction.status === "requires_ocr"
  if (!params.ocrEnabled) {
    return {
      status: "requires_ocr",
      reason:
        extraction.reason +
        " OCR is not enabled (FEATURE_OCR). Document left at requires_ocr — no text fabricated.",
    };
  }

  const provider = params.ocr ?? new UnsupportedOcrProvider();
  if (!isOcrProviderConfigured(provider)) {
    return {
      status: "requires_ocr",
      reason:
        extraction.reason +
        " FEATURE_OCR is on but no OCR provider is configured (set OCR_ENDPOINT or OCR_PROVIDER=tesseract).",
    };
  }

  const ocrResult = await provider.extractText({
    buffer: params.buffer,
    contentType: params.contentType,
    filename: params.filename,
  });

  if (ocrResult.status === "unsupported") {
    return {
      status: "requires_ocr",
      reason: ocrResult.reason,
    };
  }

  if (ocrResult.status === "failed") {
    return {
      status: "ocr_failed",
      reason: `OCR failed (${provider.name}): ${ocrResult.reason}`,
    };
  }

  const segments = ocrResult.segments.filter((s) => s.text.trim().length > 0);
  if (segments.length === 0) {
    return {
      status: "ocr_failed",
      reason: `OCR provider ${provider.name} returned empty text — document not marked complete.`,
    };
  }

  return {
    status: "ok",
    segments,
    source: "ocr",
    provider: ocrResult.provider,
  };
}
