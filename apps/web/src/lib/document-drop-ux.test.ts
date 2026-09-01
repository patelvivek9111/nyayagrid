import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("UX-DOCS-3 drag-and-drop upload", () => {
  const page = src("src/app/app/cases/[matterId]/documents/page.tsx");
  const route = src("src/app/api/v1/matters/[matterId]/documents/route.ts");
  const postHandler = route.slice(route.indexOf("export async function POST"));
  const queue = src("src/lib/document-upload-queue.ts");
  const chrome = src("src/app/api/v1/matters/[matterId]/chrome/route.ts");

  it("A/B/C. drop and picker share enqueueIncomingFiles", () => {
    expect(page).toContain("enqueueIncomingFiles");
    expect(page).toContain("onAddDocumentsDrop");
    expect(page).toContain("onChange={onUpload}");
    expect(page).toContain("enqueueIncomingFiles(picked)");
    expect(page).toContain("enqueueIncomingFiles(collected.files, collected.note)");
    expect(page).toContain("buildUploadItemsFromFiles");
  });

  it("D/E. drop uses the same 50-file cap and client validation", () => {
    expect(page).toContain("takeFileSelection(files, DOCUMENT_UPLOAD_BATCH_MAX)");
    expect(queue).toContain("DOCUMENT_UPLOAD_BATCH_MAX = 50");
    expect(queue).toContain("clientRejectReason");
    expect(page).toContain("buildUploadItemsFromFiles");
  });

  it("F/L. concurrency remains 4 with a single drain lock", () => {
    expect(page).toContain("DOCUMENT_UPLOAD_CONCURRENCY");
    expect(page).toContain("drainLockRef");
    expect(page).toContain("runWithConcurrency");
    expect(queue).toContain("DOCUMENT_UPLOAD_CONCURRENCY = 4");
  });

  it("G–J. retry rules are unchanged for dropped files", () => {
    expect(queue).toContain("status === 202");
    expect(queue).toContain("status === 503");
    expect(queue).toContain("retryable: false");
    expect(page).toContain("canRetryUpload");
  });

  it("K. multiple drops append to the same queue", () => {
    expect(page).toContain("[...uploadQueueRef.current, ...added]");
  });

  it("M/N. folders and non-file drags are not uploaded", () => {
    expect(page).toContain("collectDroppedFiles");
    expect(page).not.toContain("createReader");
    expect(page).not.toContain("webkitdirectory");
    expect(queue).toContain("Folder upload is not supported");
    expect(queue).toContain("Text and links are not uploaded");
  });

  it("O. drop prevents the browser from navigating to the file", () => {
    expect(page).toContain("onAddDocumentsDrop");
    expect(page).toContain("event.preventDefault()");
    expect(page).toContain("event.stopPropagation()");
    expect(page).toContain('event.dataTransfer.dropEffect = "copy"');
  });

  it("P. view-only users have no active drop target", () => {
    expect(page).toContain("onDrop={canUpload ? onAddDocumentsDrop : undefined}");
    expect(page).toContain("if (!canUpload) return");
    expect(chrome).toContain('membership.capabilities.has("documents.upload")');
  });

  it("Q. drop does not clear search/filter URL state", () => {
    const drop = page.slice(page.indexOf("function onAddDocumentsDrop"), page.indexOf("function patchUploadItem"));
    expect(drop).not.toContain("clearFind");
    expect(drop).not.toContain("replaceFindParams");
    expect(drop).not.toContain("router.replace");
    expect(page).toContain("Current search and filters were kept.");
  });

  it("R/S. no AI and ingest POST unchanged", () => {
    expect(page).not.toContain("generateText");
    expect(postHandler).toContain("enqueueDocumentIngest");
    expect(postHandler).toContain("form.get(\"file\")");
    expect(postHandler).not.toContain("form.getAll");
    expect(postHandler).toContain("rejectZipBombsOrArchives");
  });

  it("T/U. Review and Agents-off unchanged", () => {
    const reviewApi = src("src/app/api/v1/matters/[matterId]/intelligence/review/route.ts");
    expect(reviewApi).toContain("export async function GET");
    expect(reviewApi).not.toContain("export async function POST");
    const ask = src("src/app/api/v1/matters/[matterId]/ask/route.ts");
    expect(ask).toContain('isFeatureEnabled("agents")');
  });

  it("picker remains available; drop is optional and desktop-hinted", () => {
    expect(page).toContain('type="file"');
    expect(page).toContain("Or drop files onto this area");
    expect(page).toContain("hidden text-xs font-normal text-ink/55 sm:block");
    expect(page).toContain("Drop files to add to this Case");
  });
});
