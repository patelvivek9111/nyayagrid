/**
 * Trivial live smoke. Reachability only — never quality certification.
 * Synthetic non-confidential prompt.
 */
import {
  createDirectProvider,
  classifyCredentialFailure,
  parseJsonObject,
  redactEnvSecrets,
  type DirectProviderId,
} from "@nyayagrid/ai";

const PING = {
  messages: [
    { role: "system" as const, content: "Reply with JSON only." },
    {
      role: "user" as const,
      content: '{"task":"ping"} Return {"ok":true} and nothing else.',
    },
  ],
  temperature: 0,
};

export type SmokeResult = {
  provider: DirectProviderId;
  modelId: string;
  result: "PASS" | "FAIL" | "BLOCKED_EXTERNAL";
  normalized: boolean;
  structuredOk: boolean;
  usageCaptured: boolean;
  modelCaptured: boolean;
  timeoutWorks: boolean;
  latencyMs: number | null;
  errorClass: string | null;
  errorDetail?: string;
};

async function generateWithBudget(
  generate: (req: typeof PING & { signal?: AbortSignal }) => Promise<{
    text: string;
    provider: string;
    model: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    latencyMs?: number;
  }>,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await generate({ ...PING, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function smokeProvider(params: {
  provider: DirectProviderId;
  keyAvailable: boolean;
  timeoutMs?: number;
}): Promise<SmokeResult> {
  if (!params.keyAvailable) {
    return {
      provider: params.provider,
      modelId: "unresolved",
      result: "BLOCKED_EXTERNAL",
      normalized: false,
      structuredOk: false,
      usageCaptured: false,
      modelCaptured: false,
      timeoutWorks: false,
      latencyMs: null,
      errorClass: "BLOCKED_EXTERNAL",
    };
  }

  const timeoutMs = params.timeoutMs ?? 45_000;
  const started = Date.now();
  try {
    const { provider, modelId } = createDirectProvider({ provider: params.provider });
    const result = await generateWithBudget((req) => provider.generate(req), timeoutMs);
    const parsed = parseJsonObject(result.text);
    const aborted = new AbortController();
    aborted.abort();
    let timeoutWorks = false;
    try {
      await provider.generate({ ...PING, signal: aborted.signal });
    } catch {
      timeoutWorks = true;
    }
    return {
      provider: params.provider,
      modelId: result.model || modelId,
      result: "PASS",
      normalized: Boolean(result.text && result.provider),
      structuredOk: parsed.ok,
      usageCaptured: Boolean(result.usage?.inputTokens || result.usage?.outputTokens),
      modelCaptured: Boolean(result.model),
      timeoutWorks,
      latencyMs: result.latencyMs ?? Date.now() - started,
      errorClass: null,
    };
  } catch (error) {
    const message = redactEnvSecrets(error instanceof Error ? error.message : String(error));
    return {
      provider: params.provider,
      modelId: "unresolved",
      result: "FAIL",
      normalized: false,
      structuredOk: false,
      usageCaptured: false,
      modelCaptured: false,
      timeoutWorks: false,
      latencyMs: Date.now() - started,
      errorClass: classifyCredentialFailure(error, params.provider),
      errorDetail: message.slice(0, 180),
    };
  }
}
