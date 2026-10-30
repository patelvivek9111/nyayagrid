/**
 * Phase 3 — provider factory routing + correlation wiring regressions.
 * CourtListener: 0. No live DB.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAIProviderFromEnv, MockAIProvider } from "@nyayagrid/ai";
import {
  CORRELATION_ID_HEADER,
  withCorrelationId,
} from "@nyayagrid/observability";
import { beginRouteCorrelation } from "./request-correlation";

const webRoot = resolve(__dirname, "../..");

function source(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

const CRITICAL_AI_ROUTES = [
  "src/app/api/v1/matters/[matterId]/graph/extract/route.ts",
  "src/app/api/v1/matters/[matterId]/summary/route.ts",
  "src/app/api/v1/matters/[matterId]/intelligence/extract/route.ts",
  "src/app/api/v1/matters/[matterId]/drafts/route.ts",
  "src/app/api/v1/matters/[matterId]/research/query/route.ts",
  "src/app/api/v1/matters/[matterId]/analysis/contracts/route.ts",
  "src/app/api/v1/matters/[matterId]/analysis/depositions/route.ts",
  "src/server/document-ingest.ts",
] as const;

describe("Phase 3 silent Mock force removal", () => {
  it("Graph extract and critical AI routes use getAI() — never AI_PROVIDER===openai Mock ternary", () => {
    for (const rel of CRITICAL_AI_ROUTES) {
      const src = source(rel);
      expect(src, rel).toContain("getAI()");
      expect(src, rel).not.toMatch(
        /AI_PROVIDER\s*===\s*["']openai["']\s*\?\s*(?:undefined|getAI\(\))\s*:\s*new MockAIProvider\(\)/,
      );
    }
  });

  it("Ask route already uses getAI() and does not silent-Mock", () => {
    const src = source("src/app/api/v1/matters/[matterId]/ask/route.ts");
    expect(src).toContain("getAI()");
    expect(src).not.toContain("new MockAIProvider()");
  });
});

describe("Phase 3 createAIProviderFromEnv safety", () => {
  const prev = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in prev)) delete process.env[key];
    }
    Object.assign(process.env, prev);
    vi.restoreAllMocks();
  });

  it("explicit AI_PROVIDER=mock uses Mock (name mock)", () => {
    process.env.AI_PROVIDER = "mock";
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const provider = createAIProviderFromEnv();
    expect(provider.name).toBe("mock");
    expect(provider).not.toBeInstanceOf(MockAIProvider);
  });

  it("configured non-openai provider is NOT silently Mock", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key";
    delete process.env.OPENAI_API_KEY;
    const provider = createAIProviderFromEnv();
    expect(provider.name).toBe("anthropic");
    expect(provider.name).not.toBe("mock");
  });

  it("missing real provider key fails honestly", () => {
    process.env.AI_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    expect(() => createAIProviderFromEnv()).toThrow(/OPENAI_API_KEY/);
  });

  it("unsupported AI_PROVIDER fails closed when generate is attempted without adapters", async () => {
    process.env.AI_PROVIDER = "not-a-real-provider";
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const provider = createAIProviderFromEnv();
    expect(provider.name).toBe("not-a-real-provider");
    await expect(
      provider.generate({
        messages: [{ role: "user", content: "ping" }],
      }),
    ).rejects.toThrow();
  });
});

describe("Phase 3 correlation wiring", () => {
  it("Ask / Ask cancel / Graph extract / confirmation path wire correlation utilities", () => {
    const ask = source("src/app/api/v1/matters/[matterId]/ask/route.ts");
    const cancel = source("src/app/api/v1/matters/[matterId]/ask/cancel/route.ts");
    const graph = source("src/app/api/v1/matters/[matterId]/graph/extract/route.ts");
    const confirm = readFileSync(
      resolve(webRoot, "../../packages/search/src/conversational-workflow-actions.ts"),
      "utf8",
    );

    for (const [name, src] of [
      ["ask", ask],
      ["cancel", cancel],
      ["graph", graph],
    ] as const) {
      expect(src, name).toContain("beginRouteCorrelation");
      expect(src, name).toContain("corr.attach");
    }
    expect(cancel).toContain("singleInstance: true");
    expect(cancel).toContain("singleInstance: true");
    expect(confirm).toContain('createLogger("conversational-confirm")');
    expect(confirm).toContain("confirm.completed");
    expect(confirm).toContain("alreadyExecuted");
    expect(confirm).toContain("correlationId");
    expect(ask).toContain("correlationId: corr.correlationId");
  });

  it("beginRouteCorrelation reuses valid incoming id and attaches response header", () => {
    const request = new Request("http://localhost/api/test", {
      headers: { [CORRELATION_ID_HEADER]: "cid-phase3-fixed" },
    });
    const corr = beginRouteCorrelation(request, "test.phase3");
    expect(corr.correlationId).toBe("cid-phase3-fixed");
    expect(withCorrelationId(request.headers)).toBe("cid-phase3-fixed");

    const response = new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
    corr.attach(response);
    expect(response.headers.get(CORRELATION_ID_HEADER)).toBe("cid-phase3-fixed");
  });

  it("beginRouteCorrelation generates an id when absent", () => {
    const corr = beginRouteCorrelation(new Request("http://localhost/api/test"), "test.phase3");
    expect(corr.correlationId.length).toBeGreaterThan(8);
  });

  it("Ask/cancel/graph log lines do not reference question/prompt/content fields", () => {
    const ask = source("src/app/api/v1/matters/[matterId]/ask/route.ts");
    const cancel = source("src/app/api/v1/matters/[matterId]/ask/cancel/route.ts");
    const graph = source("src/app/api/v1/matters/[matterId]/graph/extract/route.ts");
    for (const src of [ask, cancel, graph]) {
      // Must not log user content keys in corr.log.* field objects.
      expect(src).not.toMatch(/corr\.log\.\w+\([^)]*question:/);
      expect(src).not.toMatch(/corr\.log\.\w+\([^)]*prompt:/);
      expect(src).not.toMatch(/corr\.log\.\w+\([^)]*content:/);
    }
  });
});
