import { redactEnvSecrets } from "../load-local-env";
import type { DirectProviderId } from "../router/direct-provider";
import type { CertCallStatus } from "./errors";

export type CertChildRequest = {
  provider: DirectProviderId;
  modelId: string;
  taskId: string;
  attempt: number;
  requestTimeoutMs: number;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature: number;
  fault?: CertChildFault;
};

export type CertChildFault =
  | "never-resolves"
  | "ignore-abort"
  | "sleep-past-timeout"
  | "429"
  | "500"
  | "malformed"
  | "ok";

export type CertChildResult = {
  provider: string;
  model: string;
  taskId: string;
  attempt: number;
  status: CertCallStatus;
  result?: { text: string; model?: string; usage?: { inputTokens?: number; outputTokens?: number } };
  usage?: { inputTokens?: number; outputTokens?: number };
  latencyMs?: number;
  costKnown: boolean;
  normalizedError?: string;
};

export function sanitizeChildText(text: string): string {
  return redactEnvSecrets(text).slice(0, 400);
}

export function emptyUsageCostUnknown(result: CertChildResult): CertChildResult {
  if (result.status === "PROVIDER_HARD_TIMEOUT") {
    return { ...result, costKnown: false, usage: undefined };
  }
  return result;
}
