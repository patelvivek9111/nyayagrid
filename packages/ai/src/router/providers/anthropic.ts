import type { AiGenerateRequest, AiGenerateResult, AIProvider } from "../../provider-contract";
import { ProviderError } from "../errors";
import { fetchProviderWithRetry, requestAbortSignal, readResponseJson } from "../http";
import { toAnthropicBody } from "../messages";

const DEFAULT_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";

  constructor(
    private readonly config: {
      apiKey: string;
      model?: string;
      baseUrl?: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    const started = Date.now();
    const model = this.config.model;
    if (!model) {
      throw new ProviderError({
        provider: this.name,
        code: "unavailable",
        message: "Anthropic model id is not configured",
      });
    }
    const { system, messages } = toAnthropicBody(request.messages);
    const baseUrl = this.config.baseUrl ?? DEFAULT_BASE;
    const response = await fetchProviderWithRetry(
      `${baseUrl}/v1/messages`,
      {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: DEFAULT_MAX_TOKENS,
          temperature: request.temperature ?? 0,
          ...(system ? { system } : {}),
          messages,
        }),
        signal: requestAbortSignal(request),
      },
      { provider: this.name, fetchImpl: this.config.fetchImpl },
    );
    const data = (await readResponseJson(response, request.signal)) as {
      model?: string;
      stop_reason?: string;
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content ?? [])
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (!text) {
      throw new ProviderError({
        provider: this.name,
        code: "malformed",
        modelId: model,
        message: "Anthropic response missing text content",
      });
    }
    return {
      provider: this.name,
      model: data.model?.trim() || model,
      text,
      usage: {
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
      },
      finishReason: data.stop_reason,
      latencyMs: Date.now() - started,
    };
  }
}
