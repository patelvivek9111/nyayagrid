import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("versioned legal-work recovery UX", () => {
  it("uses professional restore copy and keeps history visible", () => {
    const panel = src("src/components/ux/version-history.tsx");
    expect(panel).toContain("Restore this version");
    expect(panel).toContain("Restore as a new version");
    expect(panel).toContain("Newer changes exist");
    expect(panel).toContain("Undo last change");
    expect(panel).toContain("Compare versions");
    expect(panel).toContain("won't be overwritten");
    expect(panel).not.toContain("database rollback");
    expect(panel).not.toContain("git reset");
  });

  it("exposes history on draft, timeline, evidence, memory, and graph", () => {
    expect(src("src/app/app/cases/[matterId]/draft/page.tsx")).toContain("VersionHistoryPanel");
    expect(src("src/app/app/cases/[matterId]/timeline/page.tsx")).toContain("VersionHistoryPanel");
    expect(src("src/app/app/cases/[matterId]/evidence/page.tsx")).toContain("VersionHistoryPanel");
    expect(src("src/app/app/cases/[matterId]/memory/page.tsx")).toContain("VersionHistoryPanel");
    expect(src("src/app/app/cases/[matterId]/graph/page.tsx")).toContain("VersionHistoryPanel");
    expect(src("src/app/app/cases/[matterId]/work/page.tsx")).toContain("SessionRestoreControl");
    expect(src("src/app/app/cases/[matterId]/page.tsx")).toContain("VersionHistoryPanel");
  });
});
