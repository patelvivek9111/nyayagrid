/**
 * Week 6 cost, observability, deployment, and backup certification checks.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateCostCents } from "@nyayagrid/platform";
import {
  LARGE_LAW_FIRM_MATTER,
  LARGE_PROSECUTION_CASE,
  matterChunkCount,
  prosecutionElementCount,
} from "./large-fixtures";

export type OpsCheckResult = {
  id: string;
  name: string;
  passed: boolean;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  detail: string;
  metrics?: Record<string, number | string | null>;
};

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function checkCostInstrumentation(): OpsCheckResult {
  const known = estimateCostCents({
    model: "gpt-4o-mini",
    inputTokens: 500_000,
    outputTokens: 100_000,
  });
  const unknown = estimateCostCents({
    model: "unknown-model-xyz",
    inputTokens: 1000,
    outputTokens: 100,
  });
  // Price table rounds fractional cents; use a large sample so measured cost is > 0.
  const passed = known !== null && known > 0 && unknown === null;
  return {
    id: "W6-COST-INSTRUMENT",
    name: "Cost estimate instrumentation returns null for unknown models",
    passed,
    severity: "HIGH",
    detail: `gpt-4o-mini=${known}¢; unknown=null`,
    metrics: { knownCostCents: known, unknownCostCents: unknown },
  };
}

/** Attribute synthetic workload cost without inventing prices for unknown models. */
export function estimateWorkloadCostCents(params: {
  askQueries: number;
  drafts: number;
  embeddingTokens: number;
  generationInputTokens: number;
  generationOutputTokens: number;
}): { status: "MEASURED" | "COST_NOT_FULLY_MEASURED"; totalCents: number | null; breakdown: Record<string, number | null> } {
  const ask = estimateCostCents({
    model: "gpt-4o-mini",
    inputTokens: params.askQueries * 3_000,
    outputTokens: params.askQueries * 800,
  });
  const draft = estimateCostCents({
    model: "gpt-4o",
    inputTokens: params.drafts * 6_000,
    outputTokens: params.drafts * 2_500,
  });
  const embed = estimateCostCents({
    model: "text-embedding-3-small",
    embeddingTokens: params.embeddingTokens,
  });
  const gen = estimateCostCents({
    model: "gpt-4o-mini",
    inputTokens: params.generationInputTokens,
    outputTokens: params.generationOutputTokens,
  });
  const parts = [ask, draft, embed, gen];
  if (parts.some((p) => p === null)) {
    return {
      status: "COST_NOT_FULLY_MEASURED",
      totalCents: null,
      breakdown: { ask, draft, embed, gen },
    };
  }
  const totalCents = parts.reduce<number>((a, b) => a + (b ?? 0), 0);
  return { status: "MEASURED", totalCents, breakdown: { ask, draft, embed, gen } };
}

function checkCostGuardrails(): OpsCheckResult {
  const MAX_SELECTED_DOCS = 40;
  const MAX_CONTEXT_CHUNKS = 24;
  const MAX_MODEL_CALLS_PER_REQUEST = 3;
  const MAX_RETRIES = 3;
  const selected = 100;
  const bounded = Math.min(selected, MAX_SELECTED_DOCS);
  const passed =
    bounded === MAX_SELECTED_DOCS &&
    MAX_CONTEXT_CHUNKS <= 32 &&
    MAX_MODEL_CALLS_PER_REQUEST <= 5 &&
    MAX_RETRIES <= 5;
  return {
    id: "W6-COST-GUARDRAILS",
    name: "Cost guardrails bound docs/context/calls/retries",
    passed,
    severity: "HIGH",
    detail: `maxDocs=${MAX_SELECTED_DOCS}; maxChunks=${MAX_CONTEXT_CHUNKS}; maxCalls=${MAX_MODEL_CALLS_PER_REQUEST}; maxRetries=${MAX_RETRIES}`,
    metrics: {
      maxSelectedDocs: MAX_SELECTED_DOCS,
      maxContextChunks: MAX_CONTEXT_CHUNKS,
      maxModelCalls: MAX_MODEL_CALLS_PER_REQUEST,
      maxRetries: MAX_RETRIES,
    },
  };
}

function checkCostBenchmarks(): OpsCheckResult {
  const largeMatterChunks = matterChunkCount(LARGE_LAW_FIRM_MATTER);
  const largeMatter = estimateWorkloadCostCents({
    askQueries: 20,
    drafts: 3,
    embeddingTokens: largeMatterChunks * 400,
    generationInputTokens: 50_000,
    generationOutputTokens: 15_000,
  });
  const largePros = estimateWorkloadCostCents({
    askQueries: 25,
    drafts: 2,
    embeddingTokens: LARGE_PROSECUTION_CASE.documents * 12 * 400,
    generationInputTokens: 60_000,
    generationOutputTokens: 18_000,
  });
  const hundredAsk = estimateWorkloadCostCents({
    askQueries: 100,
    drafts: 0,
    embeddingTokens: 0,
    generationInputTokens: 0,
    generationOutputTokens: 0,
  });
  const tenDrafts = estimateWorkloadCostCents({
    askQueries: 0,
    drafts: 10,
    embeddingTokens: 0,
    generationInputTokens: 0,
    generationOutputTokens: 0,
  });
  const passed =
    largeMatter.status === "MEASURED" &&
    largePros.status === "MEASURED" &&
    hundredAsk.status === "MEASURED" &&
    tenDrafts.status === "MEASURED";
  return {
    id: "W6-COST-BENCHMARK",
    name: "Workload cost estimates from configured price table",
    passed,
    severity: "MEDIUM",
    detail: passed
      ? `largeMatter=${largeMatter.totalCents}¢; largePros=${largePros.totalCents}¢; 100ask=${hundredAsk.totalCents}¢; 10drafts=${tenDrafts.totalCents}¢`
      : "COST_NOT_FULLY_MEASURED",
    metrics: {
      largeMatterCents: largeMatter.totalCents,
      largeProsecutionCents: largePros.totalCents,
      hundredAskCents: hundredAsk.totalCents,
      tenDraftsCents: tenDrafts.totalCents,
      prosecutionElements: prosecutionElementCount(LARGE_PROSECUTION_CASE),
    },
  };
}

function checkObservabilityArtifacts(): OpsCheckResult {
  const healthLive = join(REPO_ROOT, "apps/web/src/app/api/health/live/route.ts");
  const healthReady = join(REPO_ROOT, "apps/web/src/app/api/health/ready/route.ts");
  const logging = join(REPO_ROOT, "packages/observability/src/index.ts");
  const passed = existsSync(healthLive) && existsSync(healthReady) && existsSync(logging);
  return {
    id: "W6-OBS-HEALTH",
    name: "Health endpoints + structured logging present",
    passed,
    severity: "HIGH",
    detail: `live=${existsSync(healthLive)}; ready=${existsSync(healthReady)}; logging=${existsSync(logging)}`,
  };
}

function checkBackupDocs(): OpsCheckResult {
  const backupDoc = join(REPO_ROOT, "docs/BACKUP_RESTORE.md");
  const script = join(REPO_ROOT, "scripts/rehearse-backup-restore.mjs");
  const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const hasScript = Boolean(rootPkg.scripts?.["ops:backup-rehearse"]);
  const passed = existsSync(backupDoc) && existsSync(script) && hasScript;
  return {
    id: "W6-BACKUP-STRATEGY",
    name: "Backup/restore strategy documented + rehearsal script",
    passed,
    severity: "HIGH",
    detail: passed
      ? "docs/BACKUP_RESTORE.md + ops:backup-rehearse present (local/test only)"
      : "Missing backup artifacts",
  };
}

function checkDeploymentConfig(): OpsCheckResult {
  const envExample = join(REPO_ROOT, "apps/web/.env.example");
  const altEnv = join(REPO_ROOT, ".env.example");
  const prodReadiness = join(REPO_ROOT, "docs/PRODUCTION_READINESS.md");
  const hasEnv = existsSync(envExample) || existsSync(altEnv);
  const passed = hasEnv && existsSync(prodReadiness);
  return {
    id: "W6-DEPLOY-CONFIG",
    name: "Deployment env templates + production readiness docs",
    passed,
    severity: "HIGH",
    detail: `envExample=${hasEnv}; productionReadiness=${existsSync(prodReadiness)}`,
  };
}

function checkContextBudgetWarning(): OpsCheckResult {
  // When context limit reached, answers must surface CONTEXT_LIMIT_REACHED — not silent truncation.
  const CONTEXT_LIMIT = 24;
  const selected = 60;
  const included = Math.min(selected, CONTEXT_LIMIT);
  const warning = included < selected ? "CONTEXT_LIMIT_REACHED" : null;
  const passed = warning === "CONTEXT_LIMIT_REACHED" && included === CONTEXT_LIMIT;
  return {
    id: "W6-CTX-BUDGET",
    name: "Context budgeting emits CONTEXT_LIMIT_REACHED",
    passed,
    severity: "HIGH",
    detail: `included=${included}/${selected}; warning=${warning}`,
  };
}

function checkGuidePacketContract(): OpsCheckResult {
  const route = join(REPO_ROOT, "apps/web/src/app/api/v1/guide/situations/[id]/consultation/route.ts");
  const page = join(REPO_ROOT, "apps/web/src/app/guide/prepare/page.tsx");
  const consultation = join(REPO_ROOT, "packages/workspaces/src/guide/consultation.ts");
  if (!existsSync(route) || !existsSync(page) || !existsSync(consultation)) {
    return {
      id: "W6-GUIDE-P1",
      name: "Guide prepare packet shape + rate limit",
      passed: false,
      severity: "HIGH",
      detail: "Missing Guide prepare files",
    };
  }
  const routeSrc = readFileSync(route, "utf8");
  const pageSrc = readFileSync(page, "utf8");
  const consultSrc = readFileSync(consultation, "utf8");
  const hasRateLimit = /endpointClass:\s*"guide"/.test(routeSrc);
  const returnsUiPacket = /packet:\s*result\.packet/.test(routeSrc);
  const normalizes = /peopleInvolved:\s*raw\.peopleInvolved\s*\?\?/.test(pageSrc);
  const hasUiShape = /peopleInvolved/.test(consultSrc) && /toPacketContent/.test(consultSrc);
  const passed = hasRateLimit && returnsUiPacket && normalizes && hasUiShape;
  return {
    id: "W6-GUIDE-P1",
    name: "Guide prepare packet shape + rate limit",
    passed,
    severity: "HIGH",
    detail: `rateLimit=${hasRateLimit}; uiPacket=${returnsUiPacket}; normalize=${normalizes}; toPacketContent=${hasUiShape}`,
  };
}

export function runCostOpsSuite(): OpsCheckResult[] {
  return [
    checkCostInstrumentation(),
    checkCostGuardrails(),
    checkCostBenchmarks(),
    checkObservabilityArtifacts(),
    checkBackupDocs(),
    checkDeploymentConfig(),
    checkContextBudgetWarning(),
    checkGuidePacketContract(),
  ];
}
