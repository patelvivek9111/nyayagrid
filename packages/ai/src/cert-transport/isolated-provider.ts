/**
 * Cert-only generate wrapper: one isolated child per live call.
 * Used when NYAYA_CERT_FORCE_PROVIDER is set in the parent. The child itself
 * must not wrap (NYAYA_CERT_ISOLATED=1).
 */
import type { AIProvider, AiGenerateRequest, AiGenerateResult } from "../provider-contract";
import type { DirectProviderId } from "../router/direct-provider";
import { ProviderError } from "../router/errors";
import { CertProviderCircuit } from "./circuit";
import { LiveAttemptGate } from "./lifecycle";
import { runIsolatedProviderCall } from "./spawn-call";

const gate = new LiveAttemptGate();
const circuit = new CertProviderCircuit();
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function wrapIsolatedCertProvider(params: {
  inner: AIProvider;
  providerId: DirectProviderId;
  modelId: string;
}): AIProvider {
  const { inner, providerId, modelId } = params;
  return {
    name: inner.name,
    async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
      return enqueue(async () => {
        const outcome = await runIsolatedProviderCall({
          provider: providerId,
          modelId,
          taskId: request.schemaName ?? "nyaya-bench",
          messages: request.messages,
          temperature: request.temperature ?? 0,
          circuit,
          gate,
        });
        if (outcome.normalizedError === "NOT_RUN_PROVIDER_UNSTABLE") {
          throw new ProviderError({
            provider: providerId,
            code: "unavailable",
            modelId,
            message: "NOT_RUN_PROVIDER_UNSTABLE",
          });
        }
        if (outcome.status !== "ok" || !outcome.result?.text) {
          throw new ProviderError({
            provider: providerId,
            code: outcome.status === "PROVIDER_REQUEST_TIMEOUT" ||
              outcome.status === "PROVIDER_HARD_TIMEOUT"
              ? "timeout"
              : "unknown",
            modelId,
            message: outcome.normalizedError ?? outcome.status,
          });
        }
        return {
          provider: providerId,
          model: outcome.result.model ?? modelId,
          text: outcome.result.text,
          usage: outcome.usage,
          latencyMs: outcome.latencyMs,
        };
      });
    },
  };
}
