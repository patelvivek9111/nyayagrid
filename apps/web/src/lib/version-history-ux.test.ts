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
    expect(panel).toContain("won&apos;t be overwritten");
    expect(panel).not.toContain("database rollback");
    expect(panel).not.toContain("git reset");
  });

  it("fails closed for restore mutations until chrome proves edit access", () => {
    const panel = src("src/components/ux/version-history.tsx");
    const chrome = src("src/components/use-matter-chrome.tsx");
    const chromeRoute = src("src/app/api/v1/matters/[matterId]/chrome/route.ts");
    expect(panel).not.toMatch(/canRestore\s*=\s*true/);
    expect(panel).toContain("canRestoreProp ?? chromeCanRestore");
    expect(panel).toContain("if (!canRestore)");
    expect(panel).toContain("Restoring a work session requires edit access");
    expect(chrome).toContain("useState(false)");
    expect(chrome).toContain("setCanRestore(data.canRestore === true)");
    expect(chromeRoute).toContain('const canRestore = access === "edit" || access === "manage"');
  });

  it("keeps compare available for viewers while gating restore/undo/session", () => {
    const panel = src("src/components/ux/version-history.tsx");
    expect(panel).toContain("Compare versions");
    expect(panel).toMatch(/\{canRestore \? \([\s\S]*Undo last change/);
    expect(panel).toMatch(/\{canRestore \? \([\s\S]*Restore this version/);
    expect(panel).toMatch(/\{canRestore && current \?/);
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
