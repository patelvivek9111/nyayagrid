import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("usageActionId customer-action wiring", () => {
  it("originates usageActionId at Ask / Research / Draft / Analysis / Compare boundaries", () => {
    const ask = read("packages/search/src/nyaya.ts");
    expect(ask).toContain("newUsageActionId");
    expect(ask).toContain("usageActionId");

    const research = read("packages/research/src/synthesize.ts");
    expect(research).toContain("const usageActionId = newUsageActionId()");
    expect(research).toContain("usageActionId,");
    expect(research).toMatch(/extractSearchConcepts\([\s\S]*usageActionId/);
    expect(research).toMatch(/generateContraryQueries\([\s\S]*usageActionId/);

    const draft = read("packages/intelligence/src/draft/index.ts");
    expect(draft).toContain("newUsageActionId");
    expect(draft).toContain("usageActionId");

    const contract = read("packages/intelligence/src/analysis/contract.ts");
    expect(contract).toContain("usageActionId: newUsageActionId()");

    const compare = read("packages/intelligence/src/analysis/compare.ts");
    expect(compare).toContain("usageActionId: newUsageActionId()");
  });

  it("streams reuse one usageActionId (no per-chunk customer actions)", () => {
    const ask = read("packages/search/src/nyaya.ts");
    const mintCount = (ask.match(/newUsageActionId\(\)/g) ?? []).length;
    expect(mintCount).toBe(1);
    expect(ask).toContain("One usageActionId for the whole customer Ask action");
    expect(ask).toContain("sourceScope");
  });
});
