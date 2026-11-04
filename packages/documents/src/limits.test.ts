import { describe, expect, it } from "vitest";
import { assertPdfIntegrity, UploadLimitError } from "./limits";

describe("assertPdfIntegrity", () => {
  it("allows non-PDF uploads without header check", () => {
    expect(() =>
      assertPdfIntegrity({
        contentType: "text/plain",
        filename: "notes.txt",
        buffer: Buffer.from("hello"),
      }),
    ).not.toThrow();
  });

  it("accepts a PDF magic header", () => {
    expect(() =>
      assertPdfIntegrity({
        contentType: "application/pdf",
        filename: "brief.pdf",
        buffer: Buffer.from("%PDF-1.7\n%âãÏÓ\n"),
      }),
    ).not.toThrow();
  });

  it("rejects MIME spoofed PDF without magic bytes", () => {
    expect(() =>
      assertPdfIntegrity({
        contentType: "application/pdf",
        filename: "malware.bin",
        buffer: Buffer.from("MZ-this-is-not-a-pdf"),
      }),
    ).toThrow(UploadLimitError);
    try {
      assertPdfIntegrity({
        contentType: "application/pdf",
        filename: "malware.bin",
        buffer: Buffer.from("MZ-this-is-not-a-pdf"),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(UploadLimitError);
      expect((error as UploadLimitError).code).toBe("PDF_INTEGRITY_FAILED");
    }
  });

  it("rejects .pdf extension spoof without magic bytes", () => {
    expect(() =>
      assertPdfIntegrity({
        contentType: "application/octet-stream",
        filename: "invoice.pdf",
        buffer: Buffer.from("not a pdf"),
      }),
    ).toThrow(/PDF_INTEGRITY_FAILED|valid PDF header/i);
  });
});
