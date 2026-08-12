import type { ExtractedSegment } from "./extract";

export type OcrResult =
  | { status: "unsupported"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "completed"; provider: string; segments: ExtractedSegment[] };

export type OcrExtractParams = {
  contentType: string;
  filename: string;
  /** Required by providers that actually perform OCR; optional so the interface stays stable
   * for callers (like UnsupportedOcrProvider) that never inspect content. */
  buffer?: Buffer;
};

export interface OcrProvider {
  readonly name: string;
  extractText(params: OcrExtractParams): Promise<OcrResult>;
}

export class UnsupportedOcrProvider implements OcrProvider {
  readonly name = "unsupported";

  async extractText(_params: OcrExtractParams): Promise<OcrResult> {
    return {
      status: "unsupported",
      reason: "OCR is not configured. Document requires OCR before text extraction.",
    };
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export type HttpOcrConfig = {
  endpoint: string;
  apiKey?: string;
  timeoutMs?: number;
};

type HttpOcrResponseSegment = {
  text: string;
  page?: number;
  segmentRef?: string;
  charStart?: number;
  charEnd?: number;
};

/**
 * OCR provider that delegates to an external HTTP OCR service (e.g. a managed OCR API or an
 * in-house worker). Posts the raw file bytes and expects back JSON `{ segments: [...] }`, so
 * page/segment provenance from the OCR engine is preserved end to end for citations.
 */
export class HttpOcrProvider implements OcrProvider {
  readonly name = "http";
  private readonly config: HttpOcrConfig;

  constructor(config: HttpOcrConfig) {
    if (!config.endpoint) {
      throw new Error("HttpOcrProvider requires an OCR_ENDPOINT");
    }
    this.config = config;
  }

  async extractText(params: OcrExtractParams): Promise<OcrResult> {
    if (!params.buffer) {
      return { status: "failed", reason: "HttpOcrProvider requires file content to OCR" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 60_000);
    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "content-type": params.contentType || "application/octet-stream",
          "x-filename": encodeURIComponent(params.filename),
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Buffer is a valid
        // fetch body at runtime (Node/undici); DOM lib types differ between package tsconfigs.
        body: params.buffer as any,
        signal: controller.signal,
      });
      if (!response.ok) {
        return { status: "failed", reason: `OCR endpoint returned HTTP ${response.status}` };
      }
      const data = (await response.json()) as { segments?: HttpOcrResponseSegment[] };
      const segments: ExtractedSegment[] = (data.segments ?? [])
        .filter((s) => typeof s.text === "string" && s.text.trim().length > 0)
        .map((s, index) => ({
          text: s.text.trim(),
          page: s.page,
          segmentRef: s.segmentRef ?? `ocr-p${index + 1}`,
          charStart: s.charStart ?? 0,
          charEnd: s.charEnd ?? s.text.trim().length,
        }));
      if (segments.length === 0) {
        return { status: "failed", reason: "OCR endpoint returned no text" };
      }
      return { status: "completed", provider: this.name, segments };
    } catch (error) {
      return {
        status: "failed",
        reason: error instanceof Error ? error.message : "OCR request failed",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Optional local OCR stub backed by tesseract.js. The dependency is not installed by default —
 * if it is unavailable this behaves like UnsupportedOcrProvider rather than fabricating text.
 * Install `tesseract.js` and set OCR_PROVIDER=tesseract to enable it.
 */
export class TesseractOcrProvider implements OcrProvider {
  readonly name = "tesseract";

  async extractText(params: OcrExtractParams): Promise<OcrResult> {
    if (!params.buffer) {
      return { status: "failed", reason: "TesseractOcrProvider requires file content to OCR" };
    }

    let tesseractModule: {
      recognize: (buffer: Buffer, lang: string) => Promise<{ data: { text?: string } }>;
    };
    try {
      // Loaded via a computed specifier so the (optional, not-installed-by-default) dependency
      // does not need to resolve at type-check time.
      const moduleName = "tesseract.js";
      tesseractModule = await import(moduleName);
    } catch {
      return {
        status: "unsupported",
        reason:
          "Tesseract OCR is not installed. Add the tesseract.js dependency, or configure OCR_ENDPOINT for HttpOcrProvider.",
      };
    }

    try {
      const { data } = await tesseractModule.recognize(params.buffer, "eng");
      const text = (data.text ?? "").trim();
      if (!text) {
        return { status: "failed", reason: "Tesseract OCR produced no text" };
      }
      return {
        status: "completed",
        provider: this.name,
        segments: [{ text, segmentRef: "ocr-p1", charStart: 0, charEnd: text.length }],
      };
    } catch (error) {
      return {
        status: "failed",
        reason: error instanceof Error ? error.message : "Tesseract OCR failed",
      };
    }
  }
}

export function createOcrProviderFromEnv(): OcrProvider {
  const endpoint = process.env.OCR_ENDPOINT;
  if (endpoint) {
    return new HttpOcrProvider({
      endpoint,
      apiKey: process.env.OCR_API_KEY,
      timeoutMs: envInt("OCR_TIMEOUT_MS", 60_000),
    });
  }
  if (process.env.OCR_PROVIDER === "tesseract") {
    return new TesseractOcrProvider();
  }
  return new UnsupportedOcrProvider();
}
