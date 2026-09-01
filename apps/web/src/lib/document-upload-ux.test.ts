import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("UX-DOCS-2 multi-file upload", () => {
  const page = src("src/app/app/cases/[matterId]/documents/page.tsx");
  const route = src("src/app/api/v1/matters/[matterId]/documents/route.ts");
  const postHandler = route.slice(route.indexOf("export async function POST"));
  const getHandler = route.slice(
    route.indexOf("export async function GET"),
    route.indexOf("export async function POST"),
  );
  const chrome = src("src/app/api/v1/matters/[matterId]/chrome/route.ts");
  const queue = src("src/lib/document-upload-queue.ts");

  it("A/B. picker accepts multiple and still works for one file", () => {
    expect(page).toContain('type="file"');
    expect(page).toContain("multiple");
    expect(page).toContain("Array.from(event.target.files");
  });

  it("C. each file uses the existing single-file POST", () => {
    expect(page).toContain("form.append(\"file\", file)");
    expect(page).toContain('method: "POST"');
    expect(page).toContain("`/api/v1/matters/${matterId}/documents`");
    expect(postHandler).toContain("form.get(\"file\")");
    expect(postHandler).not.toContain("form.getAll");
  });

  it("D. client concurrency is bounded and Inngest caps are untouched", () => {
    expect(queue).toContain("DOCUMENT_UPLOAD_CONCURRENCY = 4");
    expect(page).toContain("runWithConcurrency");
    expect(page).toContain("DOCUMENT_UPLOAD_CONCURRENCY");
    const ingest = src("src/inngest/functions.ts");
    expect(ingest).toContain("DOCUMENT_INGEST_RUNTIME.ingestConcurrencyGlobal");
    expect(ingest).toContain("DOCUMENT_INGEST_RUNTIME.ingestConcurrencyPerOrganization");
  });

  it("E/H. 202 is received and not auto-retried", () => {
    expect(page).toContain("interpretUploadHttpResult");
    expect(queue).toContain("status === 202");
    expect(queue).toContain("accepted: true");
    expect(page).toContain("if (!current || current.accepted) return");
  });

  it("F/G/I. failures are isolated; waiting can be removed; retry is manual", () => {
    expect(page).toContain("retryUpload");
    expect(page).toContain("cancelWaitingUpload");
    expect(page).toContain("canRetryUpload");
    expect(page).toContain("Remove");
    expect(page).toContain("Retry");
  });

  it("J/K. batch summary and list refresh after acceptance", () => {
    expect(page).toContain("summarizeUploadBatch");
    expect(page).toContain("scheduleListRefresh");
    expect(page).toContain("refreshDocs");
  });

  it("L. upload does not clear search/filter URL state", () => {
    expect(page).toContain("Current search and filters were kept.");
    expect(onUploadSlice(page)).not.toContain("clearFind");
    expect(onUploadSlice(page)).not.toContain("replaceFindParams");
    expect(onUploadSlice(page)).not.toContain("router.replace");
  });

  it("O. users without documents.upload do not get an active picker", () => {
    expect(chrome).toContain('membership.capabilities.has("documents.upload")');
    expect(page).toContain("canUpload");
    expect(page).toContain("You do not have permission to add documents to this Case.");
    expect(postHandler).toContain('capability: "documents.upload"');
  });

  it("P. upload path does not call AI", () => {
    expect(onUploadSlice(page)).not.toContain("/ask");
    expect(onUploadSlice(page)).not.toContain("generateText");
    expect(postHandler).not.toContain("processDocumentPipeline");
    expect(postHandler).not.toContain("extractMatterIntelligenceForDocument");
  });

  it("Q. Review semantics unchanged", () => {
    const reviewApi = src("src/app/api/v1/matters/[matterId]/intelligence/review/route.ts");
    expect(reviewApi).toContain("export async function GET");
    expect(reviewApi).not.toContain("export async function POST");
    expect(reviewApi).toContain("getReviewQueueCounts");
    expect(chrome).toContain("getReviewQueueCounts");
  });

  it("R. onboarding unchanged", () => {
    const onboarding = src("src/app/app/onboarding/page.tsx");
    expect(onboarding).toContain('router.replace("/app/cases/new")');
  });

  it("S. Agents-off gating unchanged", () => {
    const ask = src("src/app/api/v1/matters/[matterId]/ask/route.ts");
    expect(ask).toContain('isFeatureEnabled("agents")');
    expect(ask).toContain('assertFeatureEnabled("agents")');
  });

  it("T. ingest enqueue path unchanged", () => {
    expect(postHandler).toContain("enqueueDocumentIngest");
    expect(postHandler).toContain("status: 202");
    expect(postHandler).toContain("rejectZipBombsOrArchives");
    expect(postHandler).toContain('endpointClass: "upload"');
    expect(getHandler).not.toContain("enqueueDocumentIngest");
  });

  it("U. per-file matter/org scope remains on POST", () => {
    expect(postHandler).toContain("requireMatterAccess");
    expect(postHandler).toContain("organizationId: matter.organizationId");
    expect(postHandler).toContain("matterId,");
  });

  it("does not add folders, zip ingest, or bulk intelligence approve", () => {
    expect(page).not.toContain("webkitdirectory");
    expect(page).not.toContain("Approve all");
  });
});

function onUploadSlice(page: string): string {
  const start = page.indexOf("async function onUpload");
  const end = page.indexOf("async function selectComparison");
  return page.slice(start, end);
}
