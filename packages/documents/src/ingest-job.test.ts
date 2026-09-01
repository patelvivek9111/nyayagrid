import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_INGEST_RUNTIME,
  evaluateIngestGate,
  ingestIdempotencyKey,
  intelligenceJobIdempotencyKey,
  isPermanentIngestState,
  isRetryableProcessingError,
  RetryableProcessingError,
  canTransitionDocumentState,
} from "./index";

const identity = {
  organizationId: "org",
  matterId: "matter",
  documentId: "doc",
  documentVersionId: "ver",
};

describe("ingest gate", () => {
  it("rejects missing identity", () => {
    const gate = evaluateIngestGate({
      payload: {},
      document: null,
      version: null,
      latestVersionId: null,
    });
    expect(gate.action).toBe("skip");
    if (gate.action === "skip") expect(gate.code).toBe("MISSING_IDENTITY");
  });

  it("rejects deleted documents", () => {
    const gate = evaluateIngestGate({
      payload: identity,
      document: null,
      version: null,
      latestVersionId: null,
    });
    expect(gate.action).toBe("skip");
    if (gate.action === "skip") expect(gate.code).toBe("DOCUMENT_DELETED");
  });

  it("rejects tenant mismatch", () => {
    const gate = evaluateIngestGate({
      payload: identity,
      document: {
        id: "doc",
        organizationId: "other-org",
        matterId: "matter",
        processingState: "uploaded",
      },
      version: {
        id: "ver",
        documentId: "doc",
        organizationId: "org",
      },
      latestVersionId: "ver",
    });
    expect(gate.action).toBe("skip");
    if (gate.action === "skip") expect(gate.code).toBe("TENANT_MISMATCH");
  });

  it("rejects stale versions", () => {
    const gate = evaluateIngestGate({
      payload: identity,
      document: {
        id: "doc",
        organizationId: "org",
        matterId: "matter",
        processingState: "uploaded",
      },
      version: {
        id: "ver",
        documentId: "doc",
        organizationId: "org",
      },
      latestVersionId: "newer-ver",
    });
    expect(gate.action).toBe("skip");
    if (gate.action === "skip") expect(gate.code).toBe("STALE_VERSION");
  });

  it("allows a matching current version", () => {
    const gate = evaluateIngestGate({
      payload: identity,
      document: {
        id: "doc",
        organizationId: "org",
        matterId: "matter",
        processingState: "uploaded",
      },
      version: {
        id: "ver",
        documentId: "doc",
        organizationId: "org",
      },
      latestVersionId: "ver",
    });
    expect(gate).toEqual({ action: "run" });
  });
});

describe("ingest retry classification", () => {
  it("retries provider 429, 5xx, and timeouts", () => {
    expect(isRetryableProcessingError(new Error("OpenAI embeddings failed with status 429"))).toBe(
      true,
    );
    expect(isRetryableProcessingError(new Error("OpenAI request failed with status 503"))).toBe(
      true,
    );
    expect(isRetryableProcessingError(new Error("malware scan timed out after 30000ms"))).toBe(
      true,
    );
    expect(isRetryableProcessingError(new RetryableProcessingError("network"))).toBe(true);
  });

  it("does not retry malware or unsupported extraction", () => {
    expect(isRetryableProcessingError(new Error("Blocked by malware scanner"))).toBe(false);
    expect(isPermanentIngestState("scan_blocked")).toBe(true);
    expect(isPermanentIngestState("requires_ocr")).toBe(true);
    expect(isPermanentIngestState("ready")).toBe(false);
  });
});

describe("ingest resume transitions", () => {
  it("allows crashed chunk/embed stages to re-enter extraction", () => {
    expect(canTransitionDocumentState("chunking", "extracting_text")).toBe(true);
    expect(canTransitionDocumentState("embedding", "extracting_text")).toBe(true);
  });
});

describe("ingest runtime caps", () => {
  it("keeps controlled-beta concurrency below the DB pool", () => {
    expect(DOCUMENT_INGEST_RUNTIME.ingestConcurrencyGlobal).toBeLessThanOrEqual(3);
    expect(DOCUMENT_INGEST_RUNTIME.ingestConcurrencyPerOrganization).toBeLessThanOrEqual(2);
    expect(
      DOCUMENT_INGEST_RUNTIME.ingestConcurrencyGlobal +
        DOCUMENT_INGEST_RUNTIME.intelligenceConcurrencyGlobal,
    ).toBeLessThanOrEqual(10);
    expect(DOCUMENT_INGEST_RUNTIME.ingestRetries).toBe(4);
    expect(DOCUMENT_INGEST_RUNTIME.ingestRetries).toBeLessThanOrEqual(5);
    expect(ingestIdempotencyKey("ver")).toBe("document.ingest:ver");
    expect(intelligenceJobIdempotencyKey("ver")).toBe("matter.extract_intelligence:ver");
  });
});

describe("ingest idempotency", () => {
  it("already-ready documents skip without re-entering the pipeline", () => {
    const source = readFileSync(new URL("./ingest-job.ts", import.meta.url), "utf8");
    expect(source).toContain('code: "ALREADY_READY"');
    expect(source).toContain("shouldExtractIntelligence: true");
    expect(source.indexOf('code: "ALREADY_READY"')).toBeLessThan(
      source.lastIndexOf("processDocumentPipeline"),
    );
  });
});
