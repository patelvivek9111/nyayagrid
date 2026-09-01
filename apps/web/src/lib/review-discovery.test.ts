import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("Review discovery (primary nav + Home CTA)", () => {
  it("places Review in the primary Case tab row after Documents", () => {
    const chrome = src("src/components/ux/case-chrome.tsx");
    const tabsBlock = chrome.slice(
      chrome.indexOf("export const CASE_TABS"),
      chrome.indexOf("export const CASE_WORK_SURFACES"),
    );
    expect(tabsBlock).toContain('segment: "review"');
    expect(tabsBlock.indexOf('segment: "documents"')).toBeLessThan(
      tabsBlock.indexOf('segment: "review"'),
    );
  });

  it("does not keep Review on the secondary work row", () => {
    const chrome = src("src/components/ux/case-chrome.tsx");
    const start = chrome.indexOf("export const CASE_WORK_SURFACES");
    const end = chrome.indexOf("] as const;", start);
    const workBlock = chrome.slice(start, end);
    expect(workBlock).toContain('segment: "draft"');
    expect(workBlock).toContain('segment: "analysis"');
    expect(workBlock).not.toContain('segment: "review"');
  });

  it("keeps Home, Chats, Documents, Timeline, and Work routes in primary nav", () => {
    const tabsBlock = src("src/components/ux/case-chrome.tsx");
    for (const segment of ['segment: ""', 'segment: "chats"', 'segment: "documents"', 'segment: "timeline"', 'segment: "work"']) {
      expect(tabsBlock).toContain(segment);
    }
  });

  it("Home CTA links to the Case Review page and does not call suggested items facts", () => {
    const home = src("src/app/app/cases/[matterId]/page.tsx");
    expect(home).toContain("`/app/cases/${matterId}/review`");
    expect(home).toContain("items waiting for review");
    expect(home).not.toContain("Nyaya found");
  });

  it("chrome count is matter-scoped proposed queues only", () => {
    const chromeRoute = src("src/app/api/v1/matters/[matterId]/chrome/route.ts");
    expect(chromeRoute).toContain("getReviewQueueCounts");
    expect(chromeRoute).toContain("matterId: matter.id");
    expect(chromeRoute).toContain("canReview");
    expect(chromeRoute).not.toContain("method: \"POST\"");
  });

  it("opening Review is GET-only for the queue", () => {
    const reviewApi = src("src/app/api/v1/matters/[matterId]/intelligence/review/route.ts");
    expect(reviewApi).toContain("export async function GET");
    expect(reviewApi).not.toContain("export async function POST");
    expect(reviewApi).toContain("listProposedIntelligence");
    expect(reviewApi).not.toContain("export async function POST");
  });

  it("view-only users do not see Approve on Review", () => {
    const reviewPage = src("src/app/app/cases/[matterId]/review/page.tsx");
    expect(reviewPage).toContain("canReview");
    expect(reviewPage).toContain("Approving or rejecting these suggestions requires review");
  });

  it("agent-disabled Ask gating remains in place", () => {
    const ask = src("src/app/api/v1/matters/[matterId]/ask/route.ts");
    expect(ask).toContain('isFeatureEnabled("agents")');
    expect(ask).toContain('assertFeatureEnabled("agents")');
    const work = src("src/app/app/cases/[matterId]/work/page.tsx");
    expect(work).toContain("FEATURE_DISABLED");
  });
});
