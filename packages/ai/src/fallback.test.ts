import { describe, expect, it, vi } from "vitest";
import {
  MockAIProvider,
  ResilientAIProvider,
  type AIProvider,
  type AiGenerateResult,
} from "./index";

class SlowProvider implements AIProvider {
  readonly name = "slow";
  constructor(private readonly delayMs: number) {}

  async generate(): Promise<AiGenerateResult> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return { provider: this.name, model: "slow-1", text: "{}" };
  }
}

class FailingProvider implements AIProvider {
  readonly name = "failing";
  async generate(): Promise<AiGenerateResult> {
    throw new Error("primary provider is down");
  }
}

describe("ResilientAIProvider", () => {
  it("returns the primary result when it succeeds within the timeout", async () => {
    const primary = new MockAIProvider();
    const resilient = new ResilientAIProvider(primary, { timeoutMs: 5000 });
    const result = await resilient.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.provider).toBe("mock");
  });

  it("falls back when the primary throws", async () => {
    const resilient = new ResilientAIProvider(new FailingProvider(), {
      timeoutMs: 5000,
      fallback: new MockAIProvider(),
    });
    const result = await resilient.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.provider).toBe("mock");
  });

  it("falls back when the primary exceeds the timeout", async () => {
    const resilient = new ResilientAIProvider(new SlowProvider(200), {
      timeoutMs: 20,
      fallback: new MockAIProvider(),
    });
    const result = await resilient.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.provider).toBe("mock");
  });

  it("rejects when there is no fallback and the primary fails", async () => {
    const resilient = new ResilientAIProvider(new FailingProvider(), { timeoutMs: 5000 });
    await expect(
      resilient.generate({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow("primary provider is down");
  });

  it("propagates an AbortSignal so cancellable providers can stop early", async () => {
    const generate = vi.fn(async (request: { signal?: AbortSignal }) => {
      expect(request.signal).toBeInstanceOf(AbortSignal);
      return { provider: "cancellable", model: "m1", text: "{}" };
    });
    const provider: AIProvider = { name: "cancellable", generate };
    const resilient = new ResilientAIProvider(provider, { timeoutMs: 5000 });
    await resilient.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
