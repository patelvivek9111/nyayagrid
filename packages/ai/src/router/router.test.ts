import { describe, expect, it } from "vitest";
import { MockAIProvider } from "../index";
import { CERTIFICATION_SUBSYSTEMS } from "../provider-contract";
import { NyayaRouter } from "./router";
import { FakeProvider } from "./providers/fake";
import { classifyRisk, classifyTask, deriveRiskSignalsFromRequest } from "./classifier";
import { selectStrategy } from "./strategy";
import { analyzeDisagreement } from "./disagreement";
import { ProviderHealthTracker } from "./health";
import {
  buildDefaultModelRegistry,
  isAutoEligible,
  PINNED_MODEL_IDS,
  type ModelLifecycle,
  type ModelRegistryEntry,
} from "./registry";
import { RouterUnavailableError } from "./errors";
import { parseJsonObject } from "./structured";
import {
  normalizePromptMessages,
  sanitizeMessageContent,
  toAnthropicBody,
  toGoogleContents,
} from "./messages";
import { estimateCostUsd } from "./pricing";
import { budgetFor } from "./budget";
import { listValidatedRoutingOptions } from "./options";
import { auditHasNoSecrets } from "./audit";

function allCert(status: ModelLifecycle): ModelRegistryEntry["certification"] {
  return Object.fromEntries(CERTIFICATION_SUBSYSTEMS.map((s) => [s, status])) as ModelRegistryEntry["certification"];
}

function entry(overrides: Partial<ModelRegistryEntry> & Pick<ModelRegistryEntry, "provider" | "modelId">): ModelRegistryEntry {
  return {
    id: `${overrides.provider}:${overrides.modelId}`,
    displayName: overrides.displayName ?? overrides.modelId,
    status: overrides.status ?? "VALIDATED",
    capabilities: {
      textGeneration: true,
      structuredOutput: true,
      toolUse: false,
      streaming: false,
    },
    contextWindowTokens: overrides.contextWindowTokens ?? 128_000,
    structuredOutputSupport: true,
    toolUseSupport: false,
    streamingSupport: false,
    certification: overrides.certification ?? allCert("VALIDATED"),
    qualityScore: overrides.qualityScore ?? null,
    safetyScore: overrides.safetyScore ?? null,
    citationReliability: overrides.citationReliability ?? null,
    structuredReliability: overrides.structuredReliability ?? null,
    notes: overrides.notes ?? "",
    ...overrides,
  };
}

const ping = {
  messages: [
    { role: "system" as const, content: "You are Nyaya, the matter-document assistant inside NyayaGrid." },
    { role: "user" as const, content: "Question: ping\nSources:\n(none)" },
  ],
};

describe("task classifier", () => {
  it("uses calling subsystem when provided and does not call an LLM", () => {
    expect(
      classifyTask({
        messages: [{ role: "user", content: "hello" }],
        routing: { subsystem: "research" },
      }),
    ).toBe("research");
  });

  it("maps schemaName without semantic classification", () => {
    expect(classifyTask({ messages: [], schemaName: "draft_generation" })).toBe("draft");
    expect(classifyTask({ messages: [], schemaName: "research_synthesis" })).toBe("research");
    expect(classifyTask({ messages: [], schemaName: "contract_analysis" })).toBe("contract");
    expect(classifyTask({ messages: [], schemaName: "deposition_analysis" })).toBe("deposition");
    expect(classifyTask({ messages: [], schemaName: "contradiction_analysis" })).toBe("contradiction");
    expect(classifyTask({ messages: [], schemaName: "document_comparison_summary" })).toBe("compare");
    expect(classifyTask({ messages: [], schemaName: "graph_relationship_extraction" })).toBe("graph");
    expect(classifyTask({ messages: [], schemaName: "matter_memory_proposal" })).toBe("memory");
    expect(classifyTask({ messages: [], schemaName: "matter_intelligence_extraction" })).toBe("timeline");
  });

  it("infers Ask from the Nyaya system prompt when schema is absent", () => {
    expect(classifyTask(ping)).toBe("ask");
  });
});

describe("risk classifier", () => {
  it("stays LOW for plain Ask with no signals", () => {
    expect(classifyRisk({ subsystem: "ask" }).level).toBe("LOW");
  });

  it("raises HIGH for multi-jurisdiction and contradiction, CRITICAL for missing exhibit", () => {
    expect(
      classifyRisk({ subsystem: "ask", signals: ["multiple_jurisdictions"] }).level,
    ).toBe("HIGH");
    expect(classifyRisk({ subsystem: "contradiction" }).level).toBe("HIGH");
    expect(classifyRisk({ subsystem: "ask", signals: ["missing_exhibit"] }).level).toBe(
      "CRITICAL",
    );
  });

  it("derives missing-instrument and weak retrieval from the request text", () => {
    const missing = deriveRiskSignalsFromRequest({
      messages: [
        {
          role: "user",
          content:
            "Question: How does the amendment change the indemnity obligation?\nSources:\n- chunkId=chunk_lease | documentId=doc_lease | quote=|The lease term commences on January 1, 2024.|",
        },
      ],
    });
    expect(missing).toContain("missing_exhibit");
    const present = deriveRiskSignalsFromRequest({
      messages: [
        {
          role: "user",
          content:
            "Question: How does the amendment change the indemnity obligation?\nSources:\n- chunkId=chunk_amend | documentId=doc_amendment | quote=|Section 9 is deleted and replaced.|",
        },
      ],
    });
    expect(present).not.toContain("missing_exhibit");
    const empty = deriveRiskSignalsFromRequest({
      messages: [{ role: "user", content: "Question: ping\nSources:\n(none)" }],
    });
    expect(empty).toContain("weak_retrieval");
    const assessmentDoesNotCountAsSource = deriveRiskSignalsFromRequest({
      messages: [
        {
          role: "user",
          content:
            "Question: How does the amendment change the indemnity obligation?\nSources:\n- chunkId=chunk_lease | documentId=doc_lease | quote=|The lease term commences on January 1, 2024.|\n\nEvidenceAssessment:\nallowedClaim=The retrieved documents do not include the amendment needed to determine that.",
        },
      ],
    });
    expect(assessmentDoesNotCountAsSource).toContain("missing_exhibit");
  });
});

describe("strategy selection", () => {
  it("Auto selects Fast for low-risk Ask and Standard for HIGH/CRITICAL (Deep stays manual)", () => {
    expect(selectStrategy({ requested: "auto", subsystem: "ask", risk: "LOW" }).selected).toBe(
      "fast",
    );
    expect(selectStrategy({ requested: "auto", subsystem: "ask", risk: "NORMAL" }).selected).toBe(
      "standard",
    );
    expect(selectStrategy({ requested: "auto", subsystem: "research", risk: "HIGH" }).selected).toBe(
      "standard",
    );
    expect(selectStrategy({ requested: "auto", subsystem: "ask", risk: "CRITICAL" }).selected).toBe(
      "standard",
    );
    expect(
      selectStrategy({ requested: "auto", subsystem: "contradiction", risk: "HIGH" }).selected,
    ).toBe("deep");
  });

  it("escalates Fast to Standard/Deep when risk is high and respects Deep kill switch", () => {
    expect(
      selectStrategy({ requested: "fast", subsystem: "ask", risk: "HIGH" }).escalated,
    ).toBe(true);
    expect(selectStrategy({ requested: "fast", subsystem: "ask", risk: "HIGH" }).selected).toBe(
      "standard",
    );
    expect(
      selectStrategy({
        requested: "auto",
        subsystem: "ask",
        risk: "CRITICAL",
        deepDisabled: true,
      }).selected,
    ).toBe("standard");
  });
});

describe("NyayaRouter certification and policy", () => {
  it("Auto uses only VALIDATED/ACTIVE routes and prefers certified Grok for Ask", async () => {
    const openai = new FakeProvider({
      name: "openai",
      model: "gpt-4o-mini",
      behavior: { type: "json", payload: { ok: true, via: "openai" } },
    });
    const claude = new FakeProvider({
      name: "anthropic",
      model: PINNED_MODEL_IDS.anthropic,
      behavior: { type: "json", payload: { ok: true, via: "claude" } },
    });
    const grok = new FakeProvider({
      name: "xai",
      model: "grok-3",
      behavior: { type: "json", payload: { ok: true, via: "grok" } },
    });
    const router = new NyayaRouter({
      envProvider: "openai",
      env: { AI_PROVIDER: "openai" },
      providers: { openai, anthropic: claude, xai: grok },
      health: new ProviderHealthTracker(),
    });
    const result = await router.generate(ping);
    expect(result.provider).toBe("xai");
    expect(claude.calls).toBe(0);
    expect(openai.calls).toBe(0);
    expect(JSON.parse(result.text).via).toBe("grok");
  });

  it("env provider preference is a tie-break and does not outrank a higher-quality Contract route", async () => {
    const openai = new FakeProvider({
      name: "openai",
      model: "gpt-4o-mini",
      behavior: { type: "json", payload: { via: "openai" } },
    });
    const grok = new FakeProvider({
      name: "xai",
      model: "grok-3",
      behavior: { type: "json", payload: { via: "grok" } },
    });
    const router = new NyayaRouter({
      envProvider: "openai",
      env: { AI_PROVIDER: "openai" },
      providers: { openai, xai: grok },
      health: new ProviderHealthTracker(),
    });
    const result = await router.generate({
      ...ping,
      schemaName: "contract_analysis",
      routing: { subsystem: "contract", strategy: "auto" },
    });
    expect(result.provider).toBe("xai");
    expect(openai.calls).toBe(0);
  });

  it("Auto selects Standard, not Fast, when the question names a missing instrument", async () => {
    const grok = new FakeProvider({
      name: "xai",
      model: "grok-3",
      behavior: { type: "json", payload: { ok: true } },
    });
    const router = new NyayaRouter({
      envProvider: "openai",
      env: { AI_PROVIDER: "openai" },
      providers: { xai: grok },
      health: new ProviderHealthTracker(),
    });
    await router.generate({
      messages: [
        { role: "system", content: "You are Nyaya." },
        {
          role: "user",
          content:
            "Question: How does the amendment change the indemnity obligation?\nSources:\n- chunkId=chunk_lease | documentId=doc_lease | quote=|The lease term commences on January 1, 2024.|",
        },
      ],
      routing: { strategy: "auto", subsystem: "ask" },
    });
    expect(router.lastAudits.at(-1)?.strategySelected).toBe("standard");
    expect(router.lastAudits.at(-1)?.riskLevel).toBe("CRITICAL");
  });

  it("will not Auto-select a CANDIDATE Claude route for Research", async () => {
    const claude = new FakeProvider({
      name: "anthropic",
      model: PINNED_MODEL_IDS.anthropic,
      behavior: { type: "json", payload: { answer: "should not run" } },
    });
    const router = new NyayaRouter({
      envProvider: "anthropic",
      env: { AI_PROVIDER: "anthropic" },
      providers: { anthropic: claude },
      health: new ProviderHealthTracker(),
    });
    await expect(
      router.generate({
        ...ping,
        schemaName: "research_synthesis",
        routing: { subsystem: "research", strategy: "auto" },
      }),
    ).rejects.toBeInstanceOf(RouterUnavailableError);
    expect(claude.calls).toBe(0);
  });

  it("blocks manual CANDIDATE selection in production-like env", async () => {
    const claude = new FakeProvider({
      name: "anthropic",
      model: PINNED_MODEL_IDS.anthropic,
      behavior: { type: "json", payload: { ok: true } },
    });
    const router = new NyayaRouter({
      envProvider: "openai",
      env: { APP_ENV: "staging", AI_PROVIDER: "openai" },
      providers: { anthropic: claude },
      health: new ProviderHealthTracker(),
    });
    await expect(
      router.generate({
        ...ping,
        routing: { modelId: `anthropic:${PINNED_MODEL_IDS.anthropic}`, strategy: "auto" },
      }),
    ).rejects.toBeInstanceOf(RouterUnavailableError);
  });

  it("enforces org/env provider policy before ranking", async () => {
    const grok = new FakeProvider({
      name: "xai",
      model: "grok-3",
      behavior: { type: "json", payload: { via: "grok" } },
    });
    const openai = new FakeProvider({
      name: "openai",
      model: "gpt-4o-mini",
      behavior: { type: "json", payload: { via: "openai" } },
    });
    const registry: ModelRegistryEntry[] = [
      entry({
        provider: "xai",
        modelId: "grok-3",
        qualityScore: 0.99,
        certification: allCert("VALIDATED"),
      }),
      entry({ provider: "openai", modelId: "gpt-4o-mini", qualityScore: 0.1 }),
    ];
    const router = new NyayaRouter({
      envProvider: "openai",
      env: { AI_PROVIDER: "openai", NYAYA_BLOCKED_PROVIDERS: "xai" },
      providers: { openai, xai: grok },
      registry,
      health: new ProviderHealthTracker(),
    });
    const result = await router.generate({
      ...ping,
      routing: { providerPolicy: { blockedProviders: ["xai"] } },
    });
    expect(result.provider).toBe("openai");
    expect(grok.calls).toBe(0);
  });
});

describe("NyayaRouter fallback and circuit breaker", () => {
  const twoValidated = (): ModelRegistryEntry[] => [
    entry({ provider: "openai", modelId: "gpt-4o-mini" }),
    entry({ provider: "anthropic", modelId: "claude-test", certification: allCert("VALIDATED") }),
  ];

  it("falls back on timeout/429 only to a VALIDATED model", async () => {
    const openai = new FakeProvider({
      name: "openai",
      model: "gpt-4o-mini",
      behavior: { type: "throw", code: "rate_limit", status: 429 },
    });
    const anthropic = new FakeProvider({
      name: "anthropic",
      model: "claude-test",
      behavior: { type: "json", payload: { via: "claude" } },
    });
    const router = new NyayaRouter({
      envProvider: "openai",
      env: { AI_PROVIDER: "openai" },
      providers: { openai, anthropic },
      registry: twoValidated(),
      health: new ProviderHealthTracker(),
    });
    const result = await router.generate({
      ...ping,
      routing: { strategy: "standard", subsystem: "ask" },
    });
    expect(result.provider).toBe("anthropic");
    expect(router.lastAudits.at(-1)?.fallbacks.length).toBe(1);
  });

  it("does not fallback when no validated alternative exists", async () => {
    const openai = new FakeProvider({
      name: "openai",
      model: "gpt-4o-mini",
      behavior: { type: "throw", code: "timeout" },
    });
    const claude = new FakeProvider({
      name: "anthropic",
      model: PINNED_MODEL_IDS.anthropic,
      behavior: { type: "json", payload: { via: "claude" } },
    });
    const router = new NyayaRouter({
      envProvider: "openai",
      env: { AI_PROVIDER: "openai" },
      providers: { openai, anthropic: claude },
      registry: [
        entry({ provider: "openai", modelId: "gpt-4o-mini" }),
        entry({
          provider: "anthropic",
          modelId: PINNED_MODEL_IDS.anthropic,
          status: "CANDIDATE",
          certification: allCert("CANDIDATE"),
        }),
      ],
      health: new ProviderHealthTracker(),
    });
    await expect(
      router.generate({ ...ping, routing: { strategy: "standard" } }),
    ).rejects.toMatchObject({ name: "RouterUnavailableError" });
    expect(claude.calls).toBe(0);
  });

  it("does not fallback Fast (budget) and opens a circuit after repeated failures", async () => {
    const health = new ProviderHealthTracker({
      failureThreshold: 3,
      windowMs: 60_000,
      cooldownMs: 30_000,
    });
    const openai = new FakeProvider({
      name: "openai",
      model: "gpt-4o-mini",
      behavior: { type: "throw", code: "server_error", status: 503 },
    });
    const router = new NyayaRouter({
      envProvider: "openai",
      env: { AI_PROVIDER: "openai" },
      providers: { openai },
      registry: [entry({ provider: "openai", modelId: "gpt-4o-mini" })],
      health,
    });
    for (let i = 0; i < 3; i += 1) {
      await expect(router.generate({ ...ping, routing: { strategy: "fast" } })).rejects.toBeInstanceOf(
        RouterUnavailableError,
      );
    }
    expect(health.state("openai", "gpt-4o-mini")).toBe("UNAVAILABLE");
    expect(openai.calls).toBe(3);
  });

  it("does not cycle models because an answer is disliked (auth is non-operational)", async () => {
    const openai = new FakeProvider({
      name: "openai",
      model: "gpt-4o-mini",
      behavior: { type: "throw", code: "auth", status: 401 },
    });
    const anthropic = new FakeProvider({
      name: "anthropic",
      model: "claude-test",
      behavior: { type: "json", payload: { via: "claude" } },
    });
    const router = new NyayaRouter({
      envProvider: "openai",
      env: { AI_PROVIDER: "openai" },
      providers: { openai, anthropic },
      registry: twoValidated(),
      health: new ProviderHealthTracker(),
    });
    await expect(
      router.generate({ ...ping, routing: { strategy: "standard" } }),
    ).rejects.toBeInstanceOf(RouterUnavailableError);
    expect(anthropic.calls).toBe(0);
  });
});

describe("cost budget and Deep verifier", () => {
  it("DEEP cannot exceed configured call limits", async () => {
    expect(budgetFor("deep").maxModelCalls).toBe(4);
    expect(budgetFor("deep").maxVerifierCalls).toBe(1);
    expect(budgetFor("fast").maxFallbackAttempts).toBe(0);
  });

  it("runs at most one certified verifier and prefers evidence-supported claims", async () => {
    const primary = new FakeProvider({
      name: "openai",
      model: "gpt-4o-mini",
      behavior: {
        type: "json",
        payload: {
          claims: [{ text: "The rent is $4,000", supportSources: [] }],
        },
      },
    });
    const verifier = new FakeProvider({
      name: "anthropic",
      model: "claude-test",
      behavior: {
        type: "json",
        payload: {
          claims: [{ text: "The rent is not $4,000", supportSources: ["chunk-rent"] }],
        },
      },
    });
    const router = new NyayaRouter({
      envProvider: "openai",
      env: { AI_PROVIDER: "openai" },
      providers: { openai: primary, anthropic: verifier },
      registry: [
        entry({ provider: "openai", modelId: "gpt-4o-mini" }),
        entry({ provider: "anthropic", modelId: "claude-test" }),
      ],
      health: new ProviderHealthTracker(),
    });
    const result = await router.generate({
      ...ping,
      routing: {
        strategy: "deep",
        subsystem: "ask",
        evidenceChunkIds: ["chunk-rent"],
      },
    });
    expect(primary.calls).toBe(1);
    expect(verifier.calls).toBe(1);
    expect(JSON.parse(result.text).claims[0].supportSources).toContain("chunk-rent");
  });

  it("surfaces unresolved when evidence supports neither side", async () => {
    const primary = new FakeProvider({
      name: "openai",
      model: "gpt-4o-mini",
      behavior: {
        type: "json",
        payload: { claims: [{ text: "Claim X holds", supportSources: [] }] },
      },
    });
    const verifier = new FakeProvider({
      name: "anthropic",
      model: "claude-test",
      behavior: {
        type: "json",
        payload: { claims: [{ text: "Claim X does not hold", supportSources: [] }] },
      },
    });
    const router = new NyayaRouter({
      envProvider: "openai",
      env: { AI_PROVIDER: "openai" },
      providers: { openai: primary, anthropic: verifier },
      registry: [
        entry({ provider: "openai", modelId: "gpt-4o-mini" }),
        entry({ provider: "anthropic", modelId: "claude-test" }),
      ],
      health: new ProviderHealthTracker(),
    });
    await router.generate({
      ...ping,
      routing: { strategy: "deep", subsystem: "ask", evidenceChunkIds: ["chunk-other"] },
    });
    expect(router.lastAudits.at(-1)?.disagreementUnresolved).toBe(true);
    expect(JSON.parse((await primary.generate(ping)).text)).toMatchObject({
      claims: [{ text: "Claim X holds" }],
    });
  });
});

describe("structured output, audit, pinning, secrets, kill switches", () => {
  it("fails closed on malformed JSON when a schema is required", async () => {
    const openai = new FakeProvider({
      name: "openai",
      model: "gpt-4o-mini",
      behavior: { type: "text", text: "not-json" },
    });
    const router = new NyayaRouter({
      envProvider: "openai",
      env: { AI_PROVIDER: "openai" },
      providers: { openai },
      registry: [entry({ provider: "openai", modelId: "gpt-4o-mini" })],
      health: new ProviderHealthTracker(),
    });
    await expect(
      router.generate({
        ...ping,
        schemaName: "draft_generation",
        routing: { strategy: "fast", subsystem: "draft" },
      }),
    ).rejects.toBeInstanceOf(RouterUnavailableError);
  });

  it("repairs fenced JSON locally", () => {
    const parsed = parseJsonObject("```json\n{\"answer\":\"ok\"}\n```");
    expect(parsed.ok).toBe(true);
  });

  it("records an audit without secrets or prompt text", async () => {
    const openai = new FakeProvider({
      name: "openai",
      model: "gpt-4o-mini",
      behavior: { type: "json", payload: { answer: "confidential should not be audited" } },
    });
    const router = new NyayaRouter({
      envProvider: "openai",
      env: { AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-secret-should-not-appear" },
      providers: { openai },
      registry: [entry({ provider: "openai", modelId: "gpt-4o-mini" })],
      health: new ProviderHealthTracker(),
    });
    await router.generate({
      ...ping,
      routing: {
        organizationId: "org-1",
        matterId: "matter-1",
        strategy: "auto",
        promptVersion: "nyaya-matter-qa-v11",
      },
    });
    const audit = router.lastAudits.at(-1)!;
    expect(auditHasNoSecrets(audit)).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("sk-secret");
    expect(JSON.stringify(audit)).not.toContain("confidential should not be audited");
    expect(audit.provider).toBe("openai");
    expect(audit.modelRegistryVersion).toBeTruthy();
    expect(audit.routingReason).toMatch(/VALIDATED/);
  });

  it("does not silently substitute an unknown model id", async () => {
    const openai = new FakeProvider({
      name: "openai",
      model: "gpt-4o-mini",
      behavior: { type: "json", payload: { ok: true } },
    });
    const router = new NyayaRouter({
      envProvider: "openai",
      env: { AI_PROVIDER: "openai" },
      providers: { openai },
      registry: [entry({ provider: "openai", modelId: "gpt-4o-mini" })],
      health: new ProviderHealthTracker(),
    });
    await expect(
      router.generate({
        ...ping,
        routing: { modelId: "openai:gpt-not-a-real-model" },
      }),
    ).rejects.toBeInstanceOf(RouterUnavailableError);
  });

  it("honors model and Deep kill switches", async () => {
    const openai = new FakeProvider({
      name: "openai",
      model: "gpt-4o-mini",
      behavior: { type: "json", payload: { ok: true } },
    });
    const router = new NyayaRouter({
      envProvider: "openai",
      env: {
        AI_PROVIDER: "openai",
        NYAYA_DISABLED_PROVIDERS: "openai",
        NYAYA_DISABLE_DEEP: "1",
      },
      providers: { openai },
      registry: [entry({ provider: "openai", modelId: "gpt-4o-mini" })],
      health: new ProviderHealthTracker(),
    });
    await expect(router.generate(ping)).rejects.toBeInstanceOf(RouterUnavailableError);
    const options = listValidatedRoutingOptions({
      subsystem: "ask",
      env: { NYAYA_DISABLED_MODELS: "gpt-4o-mini" },
    });
    expect(options.models.some((m) => m.modelId === "gpt-4o-mini")).toBe(false);
  });

  it("unknown pricing stays unknown", () => {
    expect(estimateCostUsd({ modelId: "claude-sonnet-4-5-20250929", inputTokens: 10, outputTokens: 10 }).known).toBe(
      false,
    );
    expect(estimateCostUsd({ modelId: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 0 })).toEqual({
      known: true,
      amountUsd: 0.15,
    });
  });
});

describe("prompt portability", () => {
  it("does not drop system safety messages for Anthropic or Google", () => {
    const messages = [
      { role: "system" as const, content: "Never invent citations." },
      { role: "system" as const, content: "Return JSON only." },
      { role: "user" as const, content: "Question?" },
    ];
    const normalized = normalizePromptMessages(messages);
    expect(normalized.system).toContain("Never invent citations.");
    expect(normalized.system).toContain("Return JSON only.");
    const anthropic = toAnthropicBody(messages);
    expect(anthropic.system?.map((block) => block.text).join(" ")).toContain("Never invent citations.");
    expect(anthropic.messages[0]?.role).toBe("user");
    expect(
      anthropic.messages.every((m) => m.content.every((block) => block.text.trim().length > 0)),
    ).toBe(true);
    expect(anthropic.messages[0]?.content[0]?.type).toBe("text");
    const google = toGoogleContents(messages);
    expect(google.systemInstruction?.parts[0]?.text).toContain("Never invent citations.");
    expect(google.contents[0]?.role).toBe("user");
  });

  it("strips NUL and unpaired surrogates from provider-bound text", () => {
    expect(sanitizeMessageContent("ok\u0000end")).toBe("okend");
    expect(sanitizeMessageContent("lead\uD800tail")).toBe("lead\uFFFDtail");
  });
});

describe("disagreement engine", () => {
  it("prefers the evidence-supported proposition and does not majority-vote", () => {
    const result = analyzeDisagreement({
      primaryText: JSON.stringify({
        claims: [{ text: "X is true", supportSources: [] }],
      }),
      verifierText: JSON.stringify({
        claims: [{ text: "X is not true", supportSources: ["chunk-a"] }],
      }),
      evidenceChunkIds: ["chunk-a"],
    });
    expect(result.findings[0]?.evidenceWinner).toBe("verifier");
    expect(result.preferredClaims[0]?.claim).toMatch(/not true/);
  });

  it("marks unresolved when neither side has evidence", () => {
    const result = analyzeDisagreement({
      primaryText: JSON.stringify({ claims: [{ text: "X is true", supportSources: [] }] }),
      verifierText: JSON.stringify({ claims: [{ text: "X is not true", supportSources: [] }] }),
      evidenceChunkIds: ["unrelated"],
    });
    expect(result.unresolved).toBe(true);
    expect(result.findings[0]?.evidenceWinner).toBe("unresolved");
  });
});

describe("OpenAI baseline through Router (mock path)", () => {
  it("preserves MockAIProvider answers when AI_PROVIDER is mock", async () => {
    const mock = new MockAIProvider();
    const router = new NyayaRouter({
      envProvider: "mock",
      env: { AI_PROVIDER: "mock" },
      providers: { mock },
      health: new ProviderHealthTracker(),
    });
    const request = {
      messages: [
        {
          role: "user" as const,
          content:
            "Question: When was the agreement signed?\nSources:\n- chunkId=c1 | documentId=d1 | documentVersionId=v1 | page=1 | segmentRef=p1 | quote=|The agreement was signed on January 15, 2024.|",
        },
      ],
    };
    const direct = await mock.generate(request);
    const routed = await router.generate(request);
    expect(JSON.parse(routed.text).evidenceState).toBe(JSON.parse(direct.text).evidenceState);
    expect(routed.provider).toBe("mock");
  });
});

describe("registry", () => {
  it("does not Auto-select Claude or Gemini Ask after four-provider cert", () => {
    const registry = buildDefaultModelRegistry({});
    const claude = registry.find((e) => e.provider === "anthropic");
    const grok = registry.find((e) => e.provider === "xai");
    const gemini = registry.find((e) => e.provider === "google");
    const openai = registry.find((e) => e.provider === "openai" && e.modelId === "gpt-4o-mini");
    const gpt4o = registry.find((e) => e.provider === "openai" && e.modelId === "gpt-4o");
    expect(claude && isAutoEligible(claude, "ask")).toBe(false);
    expect(gemini && isAutoEligible(gemini, "ask")).toBe(false);
    expect(grok && isAutoEligible(grok, "ask")).toBe(true);
    expect(grok && isAutoEligible(grok, "research")).toBe(true);
    expect(openai && isAutoEligible(openai, "ask")).toBe(false);
    expect(openai && isAutoEligible(openai, "research")).toBe(false);
    expect(openai && isAutoEligible(openai, "memory")).toBe(true);
    expect(openai && isAutoEligible(openai, "evidence")).toBe(true);
    expect(openai && isAutoEligible(openai, "deposition")).toBe(true);
    expect(gpt4o && isAutoEligible(gpt4o, "ask")).toBe(false);
  });

  it("exposes only evidence-validated models to the Advanced selector", () => {
    const research = listValidatedRoutingOptions({
      subsystem: "research",
      env: { OPENAI_API_KEY: "x", XAI_API_KEY: "x" },
    });
    expect(research.defaultStrategy).toBe("auto");
    expect(research.models.map((m) => m.provider)).toEqual(["xai"]);
    const ask = listValidatedRoutingOptions({
      subsystem: "ask",
      env: { OPENAI_API_KEY: "x", XAI_API_KEY: "x" },
    });
    expect(ask.models.map((m) => m.provider)).toEqual(["xai"]);
  });
});
