import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export type ExtractedSegment = {
  text: string;
  page?: number;
  segmentRef: string;
  charStart: number;
  charEnd: number;
};

export type ExtractionResult =
  | {
      status: "ok";
      segments: ExtractedSegment[];
      extractor: string;
    }
  | {
      status: "requires_ocr";
      reason: string;
      extractor: string;
    }
  | {
      status: "failed";
      reason: string;
      extractor: string;
    };

export interface TextExtractor {
  readonly name: string;
  supports(contentType: string, filename: string): boolean;
  extract(params: {
    buffer: Buffer;
    contentType: string;
    filename: string;
  }): Promise<ExtractionResult>;
}

function splitParagraphs(text: string, page?: number, prefix = "p"): ExtractedSegment[] {
  const parts = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const segments: ExtractedSegment[] = [];
  let cursor = 0;
  parts.forEach((part, index) => {
    const charStart = cursor;
    const charEnd = cursor + part.length;
    segments.push({
      text: part,
      page,
      segmentRef: page ? `${prefix}${index + 1}-page${page}` : `${prefix}${index + 1}`,
      charStart,
      charEnd,
    });
    cursor = charEnd + 2;
  });
  return segments;
}

export class TxtExtractor implements TextExtractor {
  readonly name = "txt";

  supports(contentType: string, filename: string): boolean {
    return (
      contentType === "text/plain" ||
      contentType === "text/markdown" ||
      filename.toLowerCase().endsWith(".txt") ||
      filename.toLowerCase().endsWith(".md")
    );
  }

  async extract(params: {
    buffer: Buffer;
    contentType: string;
    filename: string;
  }): Promise<ExtractionResult> {
    const text = params.buffer.toString("utf8").trim();
    if (!text) {
      return { status: "failed", reason: "Empty text file", extractor: this.name };
    }
    return {
      status: "ok",
      extractor: this.name,
      segments: splitParagraphs(text),
    };
  }
}

export class DocxExtractor implements TextExtractor {
  readonly name = "docx";

  supports(contentType: string, filename: string): boolean {
    return (
      contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      filename.toLowerCase().endsWith(".docx")
    );
  }

  async extract(params: {
    buffer: Buffer;
    contentType: string;
    filename: string;
  }): Promise<ExtractionResult> {
    const result = await mammoth.extractRawText({ buffer: params.buffer });
    const text = (result.value ?? "").trim();
    if (!text) {
      return {
        status: "failed",
        reason: "DOCX contained no extractable text",
        extractor: this.name,
      };
    }
    return {
      status: "ok",
      extractor: this.name,
      segments: splitParagraphs(text, undefined, "docx-p"),
    };
  }
}

export class PdfNativeExtractor implements TextExtractor {
  readonly name = "pdf-native";

  supports(contentType: string, filename: string): boolean {
    return contentType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
  }

  async extract(params: {
    buffer: Buffer;
    contentType: string;
    filename: string;
  }): Promise<ExtractionResult> {
    const parser = new PDFParse({ data: params.buffer });
    try {
      const textResult = await parser.getText();
      const pages = textResult.pages ?? [];
      const segments: ExtractedSegment[] = [];
      if (pages.length > 0) {
        for (const page of pages) {
          const pageText = (page.text ?? "").trim();
          if (!pageText) continue;
          segments.push(...splitParagraphs(pageText, page.num, "pdf-p"));
        }
      } else {
        const text = (textResult.text ?? "").trim();
        if (text) segments.push(...splitParagraphs(text, 1, "pdf-p"));
      }

      const joined = segments
        .map((s) => s.text)
        .join(" ")
        .replace(/\s+/g, "");
      if (!joined || joined.length < 20) {
        return {
          status: "requires_ocr",
          reason: "PDF has no useful native text layer",
          extractor: this.name,
        };
      }
      return { status: "ok", extractor: this.name, segments };
    } catch (error) {
      return {
        status: "failed",
        reason: error instanceof Error ? error.message : "PDF extraction failed",
        extractor: this.name,
      };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }
}

export class CompositeTextExtractor implements TextExtractor {
  readonly name = "composite";
  constructor(private readonly extractors: TextExtractor[]) {}

  supports(contentType: string, filename: string): boolean {
    return this.extractors.some((e) => e.supports(contentType, filename));
  }

  async extract(params: {
    buffer: Buffer;
    contentType: string;
    filename: string;
  }): Promise<ExtractionResult> {
    const extractor = this.extractors.find((e) => e.supports(params.contentType, params.filename));
    if (!extractor) {
      return {
        status: "failed",
        reason: `Unsupported file type: ${params.contentType}`,
        extractor: this.name,
      };
    }
    return extractor.extract(params);
  }
}

export function createDefaultTextExtractor(): TextExtractor {
  return new CompositeTextExtractor([
    new TxtExtractor(),
    new DocxExtractor(),
    new PdfNativeExtractor(),
  ]);
}
