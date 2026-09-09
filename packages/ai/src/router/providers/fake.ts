import type { AiGenerateRequest, AiGenerateResult, AIProvider } from "../../provider-contract";
import { ProviderError, type ProviderErrorCode } from "../errors";

export type FakeProviderBehavior =
  | { type: "json"; payload: unknown; latencyMs?: number }
  | { type: "text"; text: string }
  | { type: "throw"; code: ProviderErrorCode; status?: number; message?: string }
  | { type: "timeout"; delayMs?: number };

/**
 * Deterministic adapter for Router tests. Never calls a network.
 */
export class FakeProvider implements AIProvider {
  readonly name: string;
  calls = 0;
  requests: AiGenerateRequest[] = [];

  constructor(
    private readonly options: {
      name?: string;
      model?: string;
      behavior: FakeProviderBehavior | ((request: AiGenerateRequest) => FakeProviderBehavior);
    },
  ) {
    this.name = options.name ?? "fake";
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    this.calls += 1;
    this.requests.push(request);
    if (request.signal?.aborted) {
      throw new ProviderError({
        provider: this.name,
        code: "aborted",
        message: `${this.name} aborted`,
        retryable: false,
      });
    }
    const behavior =
      typeof this.options.behavior === "function"
        ? this.options.behavior(request)
        : this.options.behavior;
    if (behavior.type === "timeout") {
      const delay = behavior.delayMs ?? 50;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        const onAbort = () => {
          clearTimeout(timer);
          reject(
            new ProviderError({
              provider: this.name,
              code: "aborted",
              message: `${this.name} aborted`,
              retryable: false,
            }),
          );
        };
        if (request.signal) {
          if (request.signal.aborted) {
            onAbort();
            return;
          }
          request.signal.addEventListener("abort", onAbort, { once: true });
        }
      });
      throw new ProviderError({
        provider: this.name,
        code: "timeout",
        message: `${this.name} timed out`,
      });
    }
    if (behavior.type === "throw") {
      throw new ProviderError({
        provider: this.name,
        code: behavior.code,
        status: behavior.status,
        message: behavior.message ?? `${this.name} ${behavior.code}`,
      });
    }
    const text = behavior.type === "text" ? behavior.text : JSON.stringify(behavior.payload);
    if (behavior.type === "json" && behavior.latencyMs) {
      await new Promise((resolve) => setTimeout(resolve, behavior.latencyMs));
    }
    return {
      provider: this.name,
      model: this.options.model ?? "fake-1",
      text,
      usage: { inputTokens: 10, outputTokens: 10 },
      finishReason: "stop",
      latencyMs: behavior.type === "json" ? (behavior.latencyMs ?? 1) : 1,
    };
  }
}
