import { describe, expect, it } from "vitest";
import { buildOpenAIChatCompletionsBody } from "./index";
import { buildXaiChatCompletionsBody } from "./router/providers/xai";
import { buildGoogleGenerateContentBody } from "./router/providers/google";
import { buildAnthropicMessagesBody } from "./router/providers/anthropic";
import {
  anthropicBodyWebEnabled,
  assertNoSilentWebTools,
  googleBodyWebEnabled,
  openaiBodyWebEnabled,
  xaiBodyWebEnabled,
} from "./provider-web-guard";

const messages = [
  { role: "system" as const, content: "Return JSON." },
  { role: "user" as const, content: "Hello" },
];

describe("no silent web on provider generate bodies", () => {
  it("OpenAI body has webEnabled=false (no tools/search)", () => {
    const body = buildOpenAIChatCompletionsBody({ model: "gpt-4o-mini", messages });
    expect(openaiBodyWebEnabled(body)).toBe(false);
    expect(body).not.toHaveProperty("tools");
    expect(body.store).toBe(false);
  });

  it("xAI body has no live_search/tools", () => {
    const body = buildXaiChatCompletionsBody({ model: "grok-test", messages });
    expect(xaiBodyWebEnabled(body)).toBe(false);
    expect(body).not.toHaveProperty("live_search");
  });

  it("Gemini body has no googleSearch grounding", () => {
    const body = buildGoogleGenerateContentBody({ messages });
    expect(googleBodyWebEnabled(body)).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/googleSearch/i);
  });

  it("Claude body has no web_search tools", () => {
    const body = buildAnthropicMessagesBody({ model: "claude-test", messages });
    expect(anthropicBodyWebEnabled(body)).toBe(false);
    expect(body).not.toHaveProperty("tools");
  });

  it("assertNoSilentWebTools throws if tools are smuggled in", () => {
    expect(() =>
      assertNoSilentWebTools({
        provider: "openai",
        body: { model: "x", tools: [{ type: "web_search" }] },
      }),
    ).toThrow(/Silent web/);
  });
});
