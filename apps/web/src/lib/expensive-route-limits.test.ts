import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(__dirname, "../..");

function routeSource(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("expensive route rate-limit wiring", () => {
  it("research query and import enforce the research preset", () => {
    expect(
      routeSource("src/app/api/v1/research/sessions/[sessionId]/query/route.ts"),
    ).toContain('endpointClass: "research"');
    expect(routeSource("src/app/api/v1/research/import/route.ts")).toContain(
      'endpointClass: "research"',
    );
  });

  it("ask-or-task does not start agent runs when agents are disabled", () => {
    const src = routeSource("src/app/api/v1/matters/[matterId]/ask/route.ts");
    expect(src).toContain('isFeatureEnabled("agents")');
    expect(src).toContain('assertFeatureEnabled("agents")');
  });

  it("extract and analysis POST routes enforce expensive_ai", () => {
    expect(
      routeSource("src/app/api/v1/matters/[matterId]/intelligence/extract/route.ts"),
    ).toContain('endpointClass: "expensive_ai"');
    expect(
      routeSource("src/app/api/v1/matters/[matterId]/analysis/contracts/route.ts"),
    ).toContain('endpointClass: "expensive_ai"');
    expect(
      routeSource("src/app/api/v1/matters/[matterId]/analysis/depositions/route.ts"),
    ).toContain('endpointClass: "expensive_ai"');
  });
});
