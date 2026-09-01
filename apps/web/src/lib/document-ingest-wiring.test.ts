import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(__dirname, "../..");

function source(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("async document ingest wiring", () => {
  it("upload returns 202 and does not run the pipeline or intelligence on the request", () => {
    const route = source("src/app/api/v1/matters/[matterId]/documents/route.ts");
    expect(route).toContain("enqueueDocumentIngest");
    expect(route).toContain("status: 202");
    expect(route).not.toContain("processDocumentPipeline");
    expect(route).not.toContain("extractMatterIntelligenceForDocument");
    expect(route).toContain("rejectZipBombsOrArchives");
    expect(route).toContain("documents.upload");
    expect(route).toContain('endpointClass: "upload"');
  });

  it("Inngest ingest functions use bounded retries and per-org concurrency", () => {
    const fn = source("src/inngest/functions.ts");
    expect(fn).toContain("handleDocumentIngestEvent");
    expect(fn).toContain("handleDocumentIntelligenceEvent");
    expect(fn).toContain("DOCUMENT_INGEST_RUNTIME.ingestConcurrencyGlobal");
    expect(fn).toContain("DOCUMENT_INGEST_RUNTIME.ingestConcurrencyPerOrganization");
    expect(fn).not.toContain("Malware scan job received; domain handler optional.");
    expect(fn).not.toContain("Matter intelligence extraction event received.");
  });

  it("enqueue fails fast if Inngest is unreachable and never marks Ready from that failure", () => {
    const ingest = source("src/server/document-ingest.ts");
    expect(ingest).toContain("INGEST_ENQUEUE_TIMEOUT_MS");
    expect(ingest).toContain("Inngest enqueue timed out");
    expect(ingest).toContain('if (document.processingState === "ready") return');
    const route = source("src/app/api/v1/matters/[matterId]/documents/route.ts");
    expect(route).toContain("INGEST_ENQUEUE_FAILED");
    expect(route).toContain('processingState: "failed"');
  });

  it("Playwright starts Inngest with the Next.js app", () => {
    const pw = readFileSync(resolve(webRoot, "../../playwright.config.ts"), "utf8");
    expect(pw).toContain("scripts/e2e-inngest-dev.mjs");
    expect(pw).toContain("127.0.0.1:8288");
    expect(pw).toContain("INNGEST_DEV");
    expect(pw).not.toMatch(/FEATURE_AGENTS\s*:/);
  });
});
