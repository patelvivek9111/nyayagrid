import type { AiGenerateRequest, AiGenerateResult, AIProvider } from "../../provider-contract";
import { ProviderError } from "../errors";
import { fetchProviderWithRetry, requestAbortSignal, readResponseJson } from "../http";
import { toGoogleContents } from "../messages";
import { assertNoSilentWebTools } from "../../provider-web-guard";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

export function buildGoogleGenerateContentBody(params: {
  messages: AiGenerateRequest["messages"];
  temperature?: number;
}) {
  const { systemInstruction, contents } = toGoogleContents(params.messages);
  const body = {
    ...(systemInstruction ? { systemInstruction } : {}),
    contents,
    generationConfig: {
      temperature: params.temperature ?? 0,
      responseMimeType: "application/json",
    },
  };
  assertNoSilentWebTools({ provider: "google", body });
  return body;
}

export class GoogleProvider implements AIProvider {
  readonly name = "google";

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
        message: "Google model id is not configured",
      });
    }
    const baseUrl = this.config.baseUrl ?? DEFAULT_BASE;
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetchProviderWithRetry(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.config.apiKey,
        },
        body: JSON.stringify(
          buildGoogleGenerateContentBody({
            messages: request.messages,
            temperature: request.temperature,
          }),
        ),
        signal: requestAbortSignal(request),
      },
      { provider: this.name, fetchImpl: this.config.fetchImpl },
    );
    const data = (await readResponseJson(response, request.signal)) as {
      modelVersion?: string;
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      throw new ProviderError({
        provider: this.name,
        code: "malformed",
        modelId: model,
        message: "Google response missing content",
      });
    }
    return {
      provider: this.name,
      model: data.modelVersion?.trim() || model,
      text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount,
        outputTokens: data.usageMetadata?.candidatesTokenCount,
      },
      finishReason: data.candidates?.[0]?.finishReason,
      latencyMs: Date.now() - started,
    };
  }
}
