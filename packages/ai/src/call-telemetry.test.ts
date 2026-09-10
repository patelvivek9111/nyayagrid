import { describe, expect, it } from "vitest";
import { LAST_AUDITS_RING, ProviderCallLedger, summarizeCallRecords } from "./call-telemetry";
import { CachedEmbeddingProvider } from "./embedding-cache";
import { MockEmbeddingProvider } from "./index";
import { FakeProvider } from "./router/providers/fake";
import { NyayaRouter } from "./router/router";
import { ProviderHealthTracker } from "./router/health";
import { CERTIFICATION_SUBSYSTEMS } from "./provider-contract";
import { PINNED_MODEL_IDS, type ModelRegistryEntry } from "./router/registry";

function allCert(): ModelRegistryEntry["certification"] {
  return Object.fromEntries(CERTIFICATION_SUBSYSTEMS.map((s) => [s, "VALIDATED"])) as ModelRegistryEntry["certification"];
}

describe("provider call ledger", () => {
  it("keeps every call after lastAudits rings off, without storing content keys", () => {
    const grok = new FakeProvider({
      name: "xai",
      model: PINNED_MODEL_IDS.xai,
      behavior: { type: "json", payload: { ok: true } },
    });
    const router = new NyayaRouter({
      envProvider: "xai",
      env: { AI_PROVIDER: "xai", FEATURE_AGENTS: "0" },
      providers: { xai: grok },
      health: new ProviderHealthTracker(),
      registry: [
        {
          id: `xai:${PINNED_MODEL_IDS.xai}`,
          provider: "xai",
          modelId: PINNED_MODEL_IDS.xai,
          displayName: PINNED_MODEL_IDS.xai,
          status: "VALIDATED",
          capabilities: {
            textGeneration: true,
            structuredOutput: true,
            toolUse: false,
            streaming: false,
          },
          contextWindowTokens: 128_000,
          structuredOutputSupport: true,
          toolUseSupport: false,
          streamingSupport: false,
          certification: allCert(),
          qualityScore: null,
          safetyScore: null,
          citationReliability: null,
          structuredReliability: null,
          notes: "",
        },
      ],
    });
    const n = LAST_AUDITS_RING + 10;
    const ping = {
      messages: [
        { role: "system" as const, content: "You are Nyaya." },
        { role: "user" as const, content: "Question: ping\nSources:\n(none)" },
      ],
      routing: { subsystem: "ask" as const, strategy: "standard" as const, organizationId: "org_t", matterId: "m_t" },
    };
    return (async () => {
      for (let i = 0; i < n; i += 1) {
        await router.generate(ping);
      }
      expect(grok.calls).toBe(n);
      expect(router.lastAudits.length).toBe(LAST_AUDITS_RING);
      expect(router.callLedger.records.length).toBe(n);
      const summary = router.callLedger.summarize();
      expect(summary.totalCalls).toBe(n);
      expect(summary.successCalls).toBe(n);
      expect(summary.byProvider.xai).toBe(n);
      expect(JSON.stringify(router.callLedger.records)).not.toMatch(/sk-|Bearer |Authorization/);
      expect(Object.keys(router.callLedger.records[0]!)).not.toContain("prompt");
      expect(Object.keys(router.callLedger.records[0]!)).not.toContain("text");
    })();
  });

  it("summarizes tokens without inventing unknown spend", () => {
    const summary = summarizeCallRecords([
      {
        runId: "a",
        correlationId: "a",
        subsystem: "ask",
        provider: "xai",
        requestedModel: "grok-3",
        servedModel: "grok-4.3",
        inputTokens: 100,
        outputTokens: 20,
        latencyMs: 12,
        success: true,
        fallbackCount: 0,
        finalStatus: "ok",
      },
    ]);
    expect(summary.inputTokens).toBe(100);
    expect(summary.outputTokens).toBe(20);
    expect(summary.estimatedUsd).toBe(0);
  });
});

describe("cached embeddings", () => {
  it("reuses identical inputs without a second inner embed", async () => {
    const inner = new MockEmbeddingProvider();
    const cached = new CachedEmbeddingProvider(inner, 8);
    const first = await cached.embed(["notice period currently applies"]);
    const second = await cached.embed(["notice period currently applies"]);
    expect(first[0]).toEqual(second[0]);
    expect(cached.hits).toBe(1);
    expect(cached.misses).toBe(1);
  });
});
