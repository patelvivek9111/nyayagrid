import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("UX-DOCS-1 Case document search / filter", () => {
  const page = src("src/app/app/cases/[matterId]/documents/page.tsx");
  const route = src("src/app/api/v1/matters/[matterId]/documents/route.ts");
  const download = src("src/app/api/v1/matters/[matterId]/documents/[documentId]/download/route.ts");
  const getHandler = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));

  it("A–D. search is name metadata via parameterized ILIKE, not page-local only", () => {
    expect(page).toContain("Search by document name");
    expect(page).toContain('sp.set("q"');
    expect(getHandler).toContain("ilikeContainsPattern");
    expect(getHandler).toContain("ILIKE");
    expect(getHandler).toContain("ESCAPE");
    expect(getHandler).toContain("eq(documents.matterId, matterId)");
    expect(getHandler).toContain("eq(documents.organizationId, matter.organizationId)");
  });

  it("E/M/N. zero-result state differs from zero-document empty state and can be cleared", () => {
    expect(page).toContain("No documents uploaded");
    expect(page).toContain("No documents match");
    expect(page).toContain("Clear search");
    expect(page).toContain("zeroDocuments");
    expect(page).toContain("noMatches");
  });

  it("F/G. list query is matter- and organization-scoped", () => {
    expect(getHandler).toContain("eq(documents.matterId, matterId)");
    expect(getHandler).toContain("eq(documents.organizationId, matter.organizationId)");
    expect(getHandler.split("eq(documents.matterId, matterId)").length).toBeGreaterThan(1);
  });

  it("H. search uses server filters plus Load more, not the visible page only", () => {
    expect(page).toContain("Load more");
    expect(page).toContain("nextCursor");
    expect(getHandler).toContain("and(...scope)");
    expect(getHandler).toContain("total:");
  });

  it("I/J/K/L. Ready / Processing / Needs attention combine with query", () => {
    expect(page).toContain('option value="ready"');
    expect(page).toContain('option value="processing"');
    expect(page).toContain('option value="attention"');
    expect(getHandler).toContain("processingStatesForFilter");
    expect(page).toContain("replaceFindParams");
  });

  it("O. filtered rows keep the existing authorized open/download actions", () => {
    expect(page).toContain("openMatterDocument");
    expect(page).toContain("Open original");
    expect(download).toContain("signMatterDocumentDownload");
    expect(src("src/server/document-download.ts")).toContain('capability: "documents.view"');
  });

  it("R. zero-document empty copy is unchanged", () => {
    expect(page).toContain("Upload a PDF, DOCX, or text file so Nyaya can read this Case");
  });

  it("S. GET search/filter does not call AI providers", () => {
    expect(getHandler).not.toContain("generateText");
    expect(getHandler).not.toContain("embed");
    expect(getHandler).not.toContain("openai");
    expect(getHandler).not.toContain("anthropic");
    expect(getHandler).not.toContain("enqueueDocumentIngest");
    expect(getHandler).not.toContain("processDocumentPipeline");
  });

  it("T. Agents-off gating is unchanged", () => {
    const ask = src("src/app/api/v1/matters/[matterId]/ask/route.ts");
    expect(ask).toContain('isFeatureEnabled("agents")');
    expect(ask).toContain('assertFeatureEnabled("agents")');
  });

  it("U. Review queue remains GET-only proposed counts", () => {
    const reviewApi = src("src/app/api/v1/matters/[matterId]/intelligence/review/route.ts");
    expect(reviewApi).toContain("export async function GET");
    expect(reviewApi).not.toContain("export async function POST");
    expect(reviewApi).toContain("getReviewQueueCounts");
  });

  it("V. onboarding still continues to Case creation after firm create", () => {
    const onboarding = src("src/app/app/onboarding/page.tsx");
    expect(onboarding).toContain('router.replace("/app/cases/new")');
  });

  it("does not add Ask-from-search or document tags", () => {
    expect(page).not.toContain("Ask this search");
    expect(page).not.toContain("Ask this");
    expect(page).not.toContain("user tags");
    expect(page).toContain("Search by document name");
  });
});
