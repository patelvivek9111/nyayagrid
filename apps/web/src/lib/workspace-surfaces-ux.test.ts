import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("Home / Chats / Documents / Review workspace UX", () => {
  const home = src("src/app/app/cases/[matterId]/page.tsx");
  const chats = src("src/app/app/cases/[matterId]/chats/page.tsx");
  const thread = src("src/app/app/cases/[matterId]/chats/[conversationId]/page.tsx");
  const documents = src("src/app/app/cases/[matterId]/documents/page.tsx");
  const review = src("src/app/app/cases/[matterId]/review/page.tsx");

  it("Home is a command center with attention, facts, and a note dialog", () => {
    expect(home).toContain("Needs attention");
    expect(home).toContain("Key facts");
    expect(home).toContain("No verified deadlines");
    expect(home).toContain("+ Add note");
    expect(home).toContain("taskStatusLabel");
    expect(home).toContain("activityKindLabel");
    expect(home).not.toContain("AI Insights");
  });

  it("Chats render a thread workspace with an anchored composer", () => {
    expect(chats).toContain("Ask Nyaya about this Case");
    expect(chats).toContain("SUGGESTED_CHAT_PROMPTS");
    expect(chats).toContain('mode: runTask ? "task" : "ask"');
    expect(thread).toContain("View source");
    expect(thread).toContain("View evidence");
    expect(thread).toContain('placeholder="Ask Nyaya about this Case…"');
    expect(thread).toContain("Nyaya");
    expect(thread).toContain("You");
  });

  it("Documents uses compact rows and keeps upload/compare/open", () => {
    expect(documents).toContain("Open original");
    expect(documents).toContain("Search by document name");
    expect(documents).toContain("Compare versions");
    expect(documents).toContain("+ Upload documents");
    expect(documents).toContain("compactStatus");
    expect(documents).toContain("onAddDocumentsDrop");
  });

  it("Review is a unified decision inbox with inspector actions preserved", () => {
    expect(review).toContain("flattenReviewQueue");
    expect(review).toContain("items need your review");
    expect(review).toContain('review("approve")');
    expect(review).toContain("Mark reviewed");
    expect(review).toContain("Nyaya does not choose which account is true");
    expect(review).toContain("Side A");
    expect(review).toContain("Side B");
    expect(review).toContain("Refresh case intelligence");
    expect(review).not.toContain("Run extraction");
  });
});
