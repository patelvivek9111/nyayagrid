import {
  createMalwareScannerFromEnv,
  createOcrProviderFromEnv,
  createStorageProviderFromEnv,
} from "@nyayagrid/documents";
import { createAIProviderFromEnv, createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import { InMemoryJobDispatcher, domainHandlers } from "@nyayagrid/jobs";
import { PostgresHybridRetriever } from "@nyayagrid/search";
import type { AgentBudgets } from "@nyayagrid/agents";
import { getDb } from "./db";

const globalForInfra = globalThis as unknown as {
  __ngStorage?: ReturnType<typeof createStorageProviderFromEnv>;
  __ngJobs?: InMemoryJobDispatcher;
  __ngRetriever?: PostgresHybridRetriever;
};

export function getStorage() {
  if (!globalForInfra.__ngStorage) {
    globalForInfra.__ngStorage = createStorageProviderFromEnv();
  }
  return globalForInfra.__ngStorage;
}

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
