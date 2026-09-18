import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("recovery API RBAC wiring", () => {
  it("mutation routes require restore/bulk access; history/compare use view", () => {
    const restore = src("src/app/api/v1/matters/[matterId]/recovery/restore/route.ts");
    const undo = src("src/app/api/v1/matters/[matterId]/recovery/undo/route.ts");
    const bulk = src("src/app/api/v1/matters/[matterId]/recovery/bulk/restore/route.ts");
    const session = src("src/app/api/v1/matters/[matterId]/recovery/session/restore/route.ts");
    const history = src("src/app/api/v1/matters/[matterId]/recovery/history/route.ts");
    const compare = src("src/app/api/v1/matters/[matterId]/recovery/compare/route.ts");
    const gate = src("src/server/legal-work.ts");

    expect(restore).toContain('mode: "restore"');
    expect(undo).toContain('mode: "restore"');
    expect(bulk).toContain('mode: "bulk"');
    expect(session).toContain('mode: "restore"');
    expect(history).toContain('mode: "view"');
    expect(compare).toContain('mode: "view"');
    expect(gate).toContain('params.mode === "view" ? "read"');
    expect(gate).toContain('params.mode === "bulk" ? "edit" : "edit"');
    expect(gate).toContain("roleFromAccess");
  });
});
