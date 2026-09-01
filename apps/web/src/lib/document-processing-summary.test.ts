import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("UX-DOCS-4 Case document processing summary", () => {
  const page = src("src/app/app/cases/[matterId]/documents/page.tsx");
  const route = src("src/app/api/v1/matters/[matterId]/documents/route.ts");
  const getHandler = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  const postHandler = route.slice(route.indexOf("export async function POST"));
  const list = src("src/lib/document-list.ts");

  it("A–C/G. summary groups match existing Ready / Processing / Needs attention filters", () => {
    expect(list).toContain("tallyDocumentProcessing");
    expect(getHandler).toContain("tallyDocumentProcessing");
    expect(getHandler).toContain("groupBy(documents.processingState)");
    expect(page).toContain('processingSummaryChip(key, processingSummary[key])');
    expect(page).toContain('"ready"');
    expect(page).toContain('"processing"');
    expect(page).toContain('"attention"');
  });

  it("D/N. counts are case-wide, not the cursor page", () => {
    expect(getHandler).toContain("processingSummary");
    expect(getHandler).not.toContain("tallyDocumentProcessing(page.items");
    expect(getHandler).toContain("eq(documents.matterId, matterId)");
    expect(getHandler).toContain("eq(documents.organizationId, matter.organizationId)");
  });

  it("E/F. grouped count is matter- and organization-scoped", () => {
    const grouped = getHandler.slice(getHandler.indexOf("groupedStates"));
    expect(grouped).toContain("eq(documents.matterId, matterId)");
    expect(grouped).toContain("eq(documents.organizationId, matter.organizationId)");
    expect(grouped.slice(0, grouped.indexOf("processingSummary"))).not.toContain("ilikeContainsPattern");
  });

  it("H. zero documents hides the summary", () => {
    expect(page).toContain("showProcessingSummary");
    expect(page).toContain("processingSummary.total > 0");
    expect(page).toContain("No documents uploaded");
  });

  it("I–M. chips reuse URL status filters and keep q/sort", () => {
    expect(page).toContain("replaceFindParams({ status: selected ? null : key })");
    expect(page).toContain("not limited to this search");
    expect(page).toContain("parseDocumentListSort");
    expect(page).toContain("Clear search");
  });

  it("O/P. summary comes from server payload after list refresh, not local Waiting rows", () => {
    expect(page).toContain("applyListPayload");
    expect(page).toContain("parseDocumentProcessingSummary(data.processingSummary)");
    expect(page).not.toContain("uploadQueue.filter((item) => item.phase === \"waiting\").length");
  });

  it("Q/R. no AI and no ingest mutations on GET summary", () => {
    expect(getHandler).not.toContain("generateText");
    expect(getHandler).not.toContain("enqueueDocumentIngest");
    expect(getHandler).not.toContain("processDocumentPipeline");
    expect(postHandler).toContain("enqueueDocumentIngest");
  });

  it("S/T/U. Review, Agents, and onboarding unchanged", () => {
    const reviewApi = src("src/app/api/v1/matters/[matterId]/intelligence/review/route.ts");
    expect(reviewApi).toContain("export async function GET");
    expect(reviewApi).not.toContain("export async function POST");
    const ask = src("src/app/api/v1/matters/[matterId]/ask/route.ts");
    expect(ask).toContain('isFeatureEnabled("agents")');
    const onboarding = src("src/app/app/onboarding/page.tsx");
    expect(onboarding).toContain('router.replace("/app/cases/new")');
  });

  it("V. search/filter list query is unchanged", () => {
    expect(page).toContain("Search by document name");
    expect(getHandler).toContain("ilikeContainsPattern");
    expect(page).not.toContain("% complete");
    expect(page).not.toContain("ETA");
    expect(page).not.toContain("Case analysis complete");
    expect(page).toContain("not that the Case is legally complete");
  });
});
