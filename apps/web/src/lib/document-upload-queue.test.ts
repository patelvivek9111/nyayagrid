import { describe, expect, it } from "vitest";
import {
  DOCUMENT_UPLOAD_BATCH_MAX,
  DOCUMENT_UPLOAD_CONCURRENCY,
  DOCUMENT_UPLOAD_MAX_BYTES,
  FOLDER_UPLOAD_UNSUPPORTED,
  NON_FILE_DROP_IGNORED,
  buildUploadItemsFromFiles,
  canCancelWaitingUpload,
  canRetryUpload,
  clientRejectReason,
  collectDroppedFiles,
  interpretUploadHttpResult,
  omittedSelectionNote,
  runWithConcurrency,
  summarizeUploadBatch,
  takeFileSelection,
  uploadPhaseLabel,
} from "./document-upload-queue";

describe("multi-file upload queue helpers", () => {
  it("A/B. batch cap is per selection; one file still fits", () => {
    expect(takeFileSelection(["a"], DOCUMENT_UPLOAD_BATCH_MAX).selected).toEqual(["a"]);
    const many = Array.from({ length: 60 }, (_, i) => `f${i}`);
    const taken = takeFileSelection(many);
    expect(taken.selected).toHaveLength(50);
    expect(taken.omitted).toBe(10);
  });

  it("D. concurrency is bounded", async () => {
    expect(DOCUMENT_UPLOAD_CONCURRENCY).toBeGreaterThanOrEqual(3);
    expect(DOCUMENT_UPLOAD_CONCURRENCY).toBeLessThanOrEqual(5);
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 25 }, () => async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });
    const result = await runWithConcurrency(DOCUMENT_UPLOAD_CONCURRENCY, tasks);
    expect(result.peakInFlight).toBeLessThanOrEqual(DOCUMENT_UPLOAD_CONCURRENCY);
    expect(peak).toBeLessThanOrEqual(DOCUMENT_UPLOAD_CONCURRENCY);
  });

  it("E. 202 marks received and is not retryable", () => {
    const result = interpretUploadHttpResult(202);
    expect(result.phase).toBe("received");
    expect(result.accepted).toBe(true);
    expect(result.retryable).toBe(false);
    expect(canRetryUpload({ phase: "received", retryable: false, accepted: true })).toBe(false);
  });

  it("F/N. one failure does not rewrite other outcomes", () => {
    const items = [
      { phase: "received" as const },
      { phase: "failed" as const },
      { phase: "received" as const },
    ];
    const summary = summarizeUploadBatch(items);
    expect(summary.received).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.summary).toBe("2 files received · 1 failed");
  });

  it("G/H. only non-accepted HTTP failures may retry", () => {
    expect(canRetryUpload({ phase: "failed", retryable: true, accepted: false })).toBe(true);
    expect(canRetryUpload({ phase: "failed", retryable: false, accepted: false })).toBe(false);
    expect(canRetryUpload({ phase: "received", retryable: true, accepted: true })).toBe(false);
  });

  it("I. waiting files can be cancelled; accepted cannot", () => {
    expect(canCancelWaitingUpload({ phase: "waiting", accepted: false })).toBe(true);
    expect(canCancelWaitingUpload({ phase: "uploading", accepted: false })).toBe(false);
    expect(canCancelWaitingUpload({ phase: "received", accepted: true })).toBe(false);
  });

  it("J. batch summary does not claim processing is finished", () => {
    expect(summarizeUploadBatch([{ phase: "received" }, { phase: "received" }]).summary).toBe(
      "2 files received. Processing continues in the background.",
    );
    expect(summarizeUploadBatch([{ phase: "failed" }]).summary).toContain("failed");
    expect(uploadPhaseLabel("uploading")).toBe("Uploading");
  });

  it("429 is retryable with a named limit message; 503 is not auto-retried", () => {
    const limited = interpretUploadHttpResult(429, "Too many requests");
    expect(limited.retryable).toBe(true);
    expect(limited.error).toBe("Upload temporarily limited. Retry this file.");
    const enqueue = interpretUploadHttpResult(503, "Upload stored but processing could not be queued");
    expect(enqueue.retryable).toBe(false);
    expect(enqueue.accepted).toBe(false);
    expect(enqueue.error).toContain("processing could not be queued");
  });

  it("400 validation failures are retryable without marking accepted", () => {
    const bad = interpretUploadHttpResult(400, "Unsupported file type");
    expect(bad.accepted).toBe(false);
    expect(bad.retryable).toBe(true);
    expect(canRetryUpload({ phase: "failed", retryable: true, accepted: false })).toBe(true);
  });

  it("collects dropped files without walking directories", () => {
    const pdf = { name: "a.pdf", size: 12 } as File;
    const fromFolder = collectDroppedFiles([
      { kind: "file", isDirectory: true },
      { kind: "file", isDirectory: false, file: pdf },
    ]);
    expect(fromFolder.files).toEqual([pdf]);
    expect(fromFolder.hasDirectory).toBe(true);
    expect(fromFolder.note).toBe(FOLDER_UPLOAD_UNSUPPORTED);

    const onlyFolder = collectDroppedFiles([{ kind: "file", isDirectory: true }]);
    expect(onlyFolder.files).toEqual([]);
    expect(onlyFolder.note).toBe(FOLDER_UPLOAD_UNSUPPORTED);

    const text = collectDroppedFiles([{ kind: "string", file: null }]);
    expect(text.files).toEqual([]);
    expect(text.hasNonFile).toBe(true);
    expect(text.note).toBe(NON_FILE_DROP_IGNORED);
  });

  it("picker and drop share the same item builder and 50-file cap", () => {
    const files = Array.from({ length: 3 }, (_, i) => ({ name: `f${i}.pdf`, size: 8 }) as File);
    let n = 0;
    const items = buildUploadItemsFromFiles(files, () => `id-${n++}`);
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.phase === "waiting")).toBe(true);
    const capped = takeFileSelection(Array.from({ length: 52 }, (_, i) => `x${i}`));
    expect(capped.selected).toHaveLength(50);
    expect(omittedSelectionNote(capped.omitted)).toContain("50");
  });

  it("client size check does not raise the backend limit", () => {
    expect(clientRejectReason({ name: "ok.pdf", size: 10 })).toBeNull();
    expect(clientRejectReason({ name: "empty.pdf", size: 0 })).toBeTruthy();
    expect(clientRejectReason({ name: "huge.pdf", size: DOCUMENT_UPLOAD_MAX_BYTES + 1 })).toMatch(/MB/);
  });

  it("C. independent tasks all run (simulated per-file POSTs)", async () => {
    const hits: string[] = [];
    await runWithConcurrency(2, [
      async () => {
        hits.push("a");
      },
      async () => {
        hits.push("b");
      },
      async () => {
        hits.push("c");
      },
    ]);
    expect(hits.sort()).toEqual(["a", "b", "c"]);
  });
});
