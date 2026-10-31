import {
  loadCanonicalLocalEnv,
  AnthropicProvider,
  PINNED_BENCHMARK_MODEL_IDS,
  PINNED_MODEL_IDS,
} from "@nyayagrid/ai";

async function main() {
  loadCanonicalLocalEnv({ repoRoot: process.cwd() });

  // After temperature-omit fix, Opus 5.5 should succeed first.
  const candidates = [
    PINNED_BENCHMARK_MODEL_IDS.claude,
    PINNED_MODEL_IDS.anthropic,
    "claude-sonnet-4-5-20250929",
  ];

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.log(JSON.stringify({ ok: false, err: "ANTHROPIC_ABSENT" }));
    process.exit(1);
  }

  const out: Array<Record<string, unknown>> = [];
  for (const model of candidates) {
    try {
      const p = new AnthropicProvider({ apiKey: key, model });
      const r = await p.generate({
        messages: [{ role: "user", content: "Reply with exactly OK" }],
        temperature: 0,
      });
      out.push({
        modelTried: model,
        ok: true,
        served: r.model,
        textLen: (r.text || "").length,
        in: r.usage?.inputTokens ?? null,
        outTok: r.usage?.outputTokens ?? null,
      });
      break;
    } catch (e) {
      out.push({
        modelTried: model,
        ok: false,
        err: String(e instanceof Error ? e.message : e).slice(0, 220),
      });
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
