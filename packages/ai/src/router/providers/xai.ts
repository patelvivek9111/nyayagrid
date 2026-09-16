import type { AiGenerateRequest, AiGenerateResult, AIProvider } from "../../provider-contract";
import { ProviderError } from "../errors";
import { fetchProviderWithRetry, requestAbortSignal, readResponseJson } from "../http";
import { systemPlusUserMessages } from "../messages";
import { assertNoSilentWebTools } from "../../provider-web-guard";

const DEFAULT_BASE = "https://api.x.ai/v1";

export function buildXaiChatCompletionsBody(params: {
  model: string;
  messages: AiGenerateRequest["messages"];
  temperature?: number;
}) {
  const body = {
    model: params.model,
    messages: systemPlusUserMessages(params.messages),
    temperature: params.temperature ?? 0,
    response_format: { type: "json_object" as const },
  };
  assertNoSilentWebTools({ provider: "xai", body });
  return body;
}

export class XaiProvider implements AIProvider {
  readonly name = "xai";

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
        message: "xAI model id is not configured",
      });
    }
    const baseUrl = this.config.baseUrl ?? DEFAULT_BASE;
    const response = await fetchProviderWithRetry(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildXaiChatCompletionsBody({
            model,
            messages: request.messages,
            temperature: request.temperature,
          }),
        ),
        signal: requestAbortSignal(request),
      },
      { provider: this.name, fetchImpl: this.config.fetchImpl },
    );
    const data = (await readResponseJson(response, request.signal)) as {
      model?: string;
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new ProviderError({
        provider: this.name,
        code: "malformed",
        modelId: model,
        message: "xAI response missing content",
      });
    }
    return {
      provider: this.name,
      model: data.model?.trim() || model,
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      },
      finishReason: data.choices?.[0]?.finish_reason,
      latencyMs: Date.now() - started,
    };
  }
}
