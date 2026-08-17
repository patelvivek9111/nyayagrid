import { createAIProviderFromEnv } from "@nyayagrid/ai";
import { jsonOk } from "@/lib/http";
import { getConfigBootstrapResult } from "@/lib/bootstrap";

/**
 * Liveness + readiness in one endpoint. Does not instantiate AUTH_PROVIDER=clerk (that requires
 * the Next.js session wiring). Provider names come from the configuration summary.
 */
export async function GET() {
  const ai = createAIProviderFromEnv();
  const config = getConfigBootstrapResult();
  return jsonOk({
    status: config.problems.length === 0 ? "ok" : "not_production_ready",
    product: "NyayaGrid",
    authProvider: config.summary.authProvider,
    aiProvider: ai.name,
    storageProvider: config.summary.storageProvider,
    appEnv: config.appEnv,
    config: config.summary,
    problems: config.problems,
    warnings: config.warnings,
    phase: 9,
  });
}
