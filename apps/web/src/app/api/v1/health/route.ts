import { createAIProviderFromEnv } from "@nyayagrid/ai";
import { createAuthProviderFromEnv } from "@nyayagrid/auth";
import { jsonOk } from "@/lib/http";
import { getConfigBootstrapResult } from "@/lib/bootstrap";

/**
 * Liveness + readiness in one endpoint. `validateConfigForEnv` is re-run on every call (it's pure
 * and cheap) rather than only at process boot, so an orchestrator's readiness probe reflects the
 * configuration this process is *actually* running with, not just what it started with.
 */
export async function GET() {
  const auth = createAuthProviderFromEnv();
  const ai = createAIProviderFromEnv();
  const config = getConfigBootstrapResult();
  return jsonOk({
    status: config.problems.length === 0 ? "ok" : "not_production_ready",
    product: "NyayaGrid",
    authProvider: auth.name,
    aiProvider: ai.name,
    storageProvider: process.env.STORAGE_PROVIDER ?? "minio",
    appEnv: config.appEnv,
    config: config.summary,
    problems: config.problems,
    warnings: config.warnings,
    phase: 9,
  });
}
