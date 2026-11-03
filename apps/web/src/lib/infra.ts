import { createMalwareScannerFromEnv, createOcrProviderFromEnv } from "@nyayagrid/documents";
import { createAIProviderFromEnv, createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import { InMemoryJobDispatcher, domainHandlers } from "@nyayagrid/jobs";
import { PostgresHybridRetriever } from "@nyayagrid/search";
import type { AgentBudgets } from "@nyayagrid/agents";
import { createGuardedAuthorityRetriever } from "@nyayagrid/research";
import { getDb } from "./db";
import { getStorage } from "./storage";
import { registerRoutingUsagePersistence } from "./persist-routing-usage";

registerRoutingUsagePersistence();

export { getStorage };

const globalForInfra = globalThis as unknown as {
  __ngJobs?: InMemoryJobDispatcher;
  __ngRetriever?: PostgresHybridRetriever;
  __ngAuthorityRetriever?: ReturnType<typeof createGuardedAuthorityRetriever>;
};

export function getMalwareScanner() {
  return createMalwareScannerFromEnv();
}

export function getOcrProvider() {
  return createOcrProviderFromEnv();
}

export function getAI() {
  return createAIProviderFromEnv();
}

export function getEmbeddings() {
  return createEmbeddingProviderFromEnv();
}

export function getRetriever() {
  if (!globalForInfra.__ngRetriever) {
    globalForInfra.__ngRetriever = new PostgresHybridRetriever(getDb(), getEmbeddings());
  }
  return globalForInfra.__ngRetriever;
}

/**
 * Legal corpus retriever (WP-03D). Uses CORPUS_DATABASE_URL when
 * FEATURE_NEON_CORPUS_RESEARCH=1; otherwise product DATABASE_URL.
 * Never redirects getDb() / product auth to Neon.
 */
export function getAuthorityRetriever() {
  if (!globalForInfra.__ngAuthorityRetriever) {
    globalForInfra.__ngAuthorityRetriever = createGuardedAuthorityRetriever({
      productDb: getDb(),
      embeddings: getEmbeddings(),
    });
  }
  return globalForInfra.__ngAuthorityRetriever;
}

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

/** Optional agent run budget overrides from the environment; unset fields use package defaults. */
export function getAgentBudgetsFromEnv(): Partial<AgentBudgets> | null {
  const overrides: Partial<AgentBudgets> = {};
  const maxSteps = envInt("AGENT_MAX_STEPS");
  const maxToolCalls = envInt("AGENT_MAX_TOOL_CALLS");
  const timeoutMs = envInt("AGENT_TIMEOUT_MS");
  if (maxSteps !== undefined) overrides.maxSteps = maxSteps;
  if (maxToolCalls !== undefined) overrides.maxToolCalls = maxToolCalls;
  if (timeoutMs !== undefined) overrides.timeoutMs = timeoutMs;
  return Object.keys(overrides).length > 0 ? overrides : null;
}

export function getJobDispatcher() {
  if (!globalForInfra.__ngJobs) {
    globalForInfra.__ngJobs = new InMemoryJobDispatcher(domainHandlers);
  }
  return globalForInfra.__ngJobs;
}
