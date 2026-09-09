/**
 * Isolated cert provider-call child. ONE provider, ONE model, ONE task, ONE attempt, then exit.
 * Result JSON is written only to the --result file. Stderr is redacted. No secrets.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createDirectProvider, redactEnvSecrets } from "../index";
import { loadCanonicalLocalEnv, repoRootFromHere } from "../load-local-env";
import { classifyThrownError } from "../router/errors";
import type { CertChildRequest, CertChildResult } from "./protocol";
import { sanitizeChildText } from "./protocol";
import type { CertCallStatus } from "./errors";

loadCanonicalLocalEnv({ repoRoot: repoRootFromHere(import.meta.url, 4) });
process.env.NYAYA_CERT_ISOLATED = "1";

function writeResult(path: string, value: CertChildResult): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

function mapError(error: unknown, provider: string): CertCallStatus {
  const classified = classifyThrownError(provider, error);
  if (classified.code === "auth") return "PROVIDER_AUTH";
  if (classified.code === "rate_limit") return "PROVIDER_RATE_LIMIT";
  if (classified.code === "timeout" || classified.code === "aborted") {
    return "PROVIDER_REQUEST_TIMEOUT";
  }
  if (classified.code === "server_error") return "PROVIDER_5XX";
  if (classified.code === "malformed") return "PROVIDER_MALFORMED_RESPONSE";
  if (/insufficient_quota|quota exceeded|billing|resource.?exhausted/i.test(classified.message)) {
    return "PROVIDER_QUOTA";
  }
  if (classified.code === "unavailable") return "PROVIDER_MODEL_UNAVAILABLE";
  return "PROVIDER_TRANSPORT";
}

function parseArgs(argv: string[]): { requestPath: string; resultPath: string } {
  const requestIdx = argv.indexOf("--request");
  const resultIdx = argv.indexOf("--result");
  const requestPath = requestIdx >= 0 ? argv[requestIdx + 1] : undefined;
  const resultPath = resultIdx >= 0 ? argv[resultIdx + 1] : undefined;
  if (!requestPath || !resultPath) {
    throw new Error("provider-call-child requires --request <file> --result <file>");
  }
  return { requestPath, resultPath };
}

async function runFault(req: CertChildRequest, resultPath: string): Promise<void> {
  const base: CertChildResult = {
    provider: req.provider,
    model: req.modelId,
    taskId: req.taskId,
    attempt: req.attempt,
    status: "ok",
    costKnown: false,
    latencyMs: 0,
  };
  if (req.fault === "ok") {
    writeResult(resultPath, {
      ...base,
      status: "ok",
      result: { text: "{\"ok\":true}", model: req.modelId },
      costKnown: true,
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    return;
  }
  if (req.fault === "429") {
    writeResult(resultPath, { ...base, status: "PROVIDER_RATE_LIMIT", normalizedError: "429" });
    return;
  }
  if (req.fault === "500") {
    writeResult(resultPath, { ...base, status: "PROVIDER_5XX", normalizedError: "500" });
    return;
  }
  if (req.fault === "malformed") {
    writeResult(resultPath, {
      ...base,
      status: "PROVIDER_MALFORMED_RESPONSE",
      result: { text: "not-json" },
    });
    return;
  }
  if (req.fault === "sleep-past-timeout") {
    await new Promise((r) => setTimeout(r, req.requestTimeoutMs + 30_000));
    writeResult(resultPath, { ...base, status: "ok", result: { text: "{\"late\":true}" } });
    return;
  }
  if (req.fault === "never-resolves" || req.fault === "ignore-abort") {
    process.on("SIGTERM", () => {
      /* ignore graceful abort so parent hard-kill is required */
    });
    await new Promise(() => {
      /* hang */
    });
  }
}

async function main(): Promise<void> {
  const { requestPath, resultPath } = parseArgs(process.argv.slice(2));
  const req = JSON.parse(readFileSync(requestPath, "utf8")) as CertChildRequest;
  const started = Date.now();
  try {
    if (req.fault) {
      await runFault(req, resultPath);
      return;
    }
    const { provider, modelId } = createDirectProvider({ provider: req.provider });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.requestTimeoutMs);
    try {
      const generated = await provider.generate({
        messages: req.messages,
        temperature: req.temperature,
        signal: controller.signal,
      });
      writeResult(resultPath, {
        provider: req.provider,
        model: generated.model || modelId,
        taskId: req.taskId,
        attempt: req.attempt,
        status: "ok",
        result: {
          text: generated.text,
          model: generated.model,
          usage: generated.usage,
        },
        usage: generated.usage,
        latencyMs: generated.latencyMs ?? Date.now() - started,
        costKnown: Boolean(
          generated.usage?.inputTokens != null || generated.usage?.outputTokens != null,
        ),
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const message = sanitizeChildText(error instanceof Error ? error.message : String(error));
    process.stderr.write(`${redactEnvSecrets(message)}\n`);
    writeResult(resultPath, {
      provider: req.provider,
      model: req.modelId,
      taskId: req.taskId,
      attempt: req.attempt,
      status: mapError(error, req.provider),
      latencyMs: Date.now() - started,
      costKnown: false,
      normalizedError: message,
    });
    process.exitCode = 0;
  }
}

await main();
