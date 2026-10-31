import { describe, expect, it } from "vitest";
import {
  anthropicModelSupportsTemperature,
  buildAnthropicMessagesBody,
} from "./anthropic";

describe("Anthropic temperature compatibility", () => {
  it("omits temperature for Claude Opus 5.x (deprecated by provider)", () => {
    expect(anthropicModelSupportsTemperature("claude-opus-5-5")).toBe(false);
    const body = buildAnthropicMessagesBody({
      model: "claude-opus-5-5",
      messages: [{ role: "user", content: "ping" }],
      temperature: 0,
    });
    expect(body).not.toHaveProperty("temperature");
  });

  it("keeps temperature for Claude Sonnet pins", () => {
    expect(anthropicModelSupportsTemperature("claude-sonnet-4-5-20250929")).toBe(true);
    const body = buildAnthropicMessagesBody({
      model: "claude-sonnet-4-5-20250929",
      messages: [{ role: "user", content: "ping" }],
    });
    expect(body.temperature).toBe(0);
  });
});
