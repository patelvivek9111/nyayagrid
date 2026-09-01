import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "./providers/anthropic";
import { XaiProvider } from "./providers/xai";
import { GoogleProvider } from "./providers/google";
import { PINNED_MODEL_IDS } from "./registry";

function loadLocalEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "../../../../.env");
  try {
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && value && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    /* no local .env */
  }
}

loadLocalEnv();

const PING = {
  messages: [
    { role: "system" as const, content: "Reply with JSON only." },
    { role: "user" as const, content: '{"task":"ping"} Return {"ok":true} and nothing else.' },
  ],
  temperature: 0,
};

function present(name: string): boolean {
  const value = process.env[name];
  return Boolean(value && value.trim().length > 0);
}

function googleKey(): string | undefined {
  return (
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    undefined
  );
}

/**
 * Live reachability only. Does not certify quality. Skips when the key is absent.
 */
describe("live provider smoke (optional)", () => {
  it.skipIf(!present("OPENAI_API_KEY"))("OpenAI responds with normalized JSON-capable text", async () => {
    const { OpenAIProvider } = await import("../index");
    const provider = new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: process.env.OPENAI_MODEL ?? PINNED_MODEL_IDS.openai,
    });
    const result = await provider.generate(PING);
    expect(result.provider).toBe("openai");
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.model.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(process.env.OPENAI_API_KEY);
  }, 25_000);

  it.skipIf(!present("ANTHROPIC_API_KEY"))("Anthropic responds with normalized text", async () => {
    const provider = new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: process.env.ANTHROPIC_MODEL ?? PINNED_MODEL_IDS.anthropic,
    });
    const result = await provider.generate(PING);
    expect(result.provider).toBe("anthropic");
    expect(result.text.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(process.env.ANTHROPIC_API_KEY);
  }, 25_000);

  it.skipIf(!present("XAI_API_KEY"))("xAI responds with normalized text", async () => {
    const provider = new XaiProvider({
      apiKey: process.env.XAI_API_KEY!,
      model: process.env.XAI_MODEL ?? PINNED_MODEL_IDS.xai,
    });
    const result = await provider.generate(PING);
    expect(result.provider).toBe("xai");
    expect(result.text.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(process.env.XAI_API_KEY);
  }, 25_000);

  it.skipIf(!googleKey())("Google Gemini responds with normalized text", async () => {
    const provider = new GoogleProvider({
      apiKey: googleKey()!,
      model: process.env.GOOGLE_MODEL ?? PINNED_MODEL_IDS.google,
    });
    const result = await provider.generate(PING);
    expect(result.provider).toBe("google");
    expect(result.text.length).toBeGreaterThan(0);
  }, 25_000);
});
