/**
 * NYAYA_PROSECUTION_BENCH runner — deterministic product validation, zero paid calls.
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProsecutionBenchFixtures } from "../datasets/prosecution-bench/fixtures";
import {
  buildProsecutionFeatureInventory,
  summarizeInventory,
} from "../datasets/prosecution-bench/inventory";
import { runProsecutionBenchScenarios } from "../datasets/prosecution-bench/scenarios";
import {
  auditCjisTechnicalGaps,
  auditStagingReadiness,
  liveCanaryPlan,
  pilotAcceptanceChecklist,
} from "../datasets/prosecution-bench/staging-audit";
import {
  PROSECUTION_BENCH_CATEGORIES,
  PROSECUTION_BENCH_GRADER_VERSION,
  PROSECUTION_BENCH_ID,
  PROSECUTION_BENCH_VERSION,
  type CriticalFailureCode,
  type ScenarioResult,
} from "../datasets/prosecution-bench/taxonomy";
import { createRunDir, persistSummary } from "./persist";

function commitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export type ProsecutionBenchClassification =
  | "NYAYA_PROSECUTION_DESIGN_PARTNER_READY_ZERO_PAID"
  | "PAID_VALIDATION_AUTHORIZATION_REQUIRED"
  | "PROSECUTION_STAGE7_BENCHMARK_BLOCKED"
  | "PROSECUTION_STAGE7_SECURITY_BLOCKED";

export type ProsecutionBenchSummary = {
  runId: string;
  benchmarkId: typeof PROSECUTION_BENCH_ID;
  datasetVersion: typeof PROSECUTION_BENCH_VERSION;
  graderVersion: typeof PROSECUTION_BENCH_GRADER_VERSION;
  commitSha: string;
  timestamp: string;
  paidCalls: 0;
  courtListener: 0;
  syntheticCases: number;
  totals: {
    scenarios: number;
    passed: number;
    failed: number;
    criticalFailures: number;
    passRate: number;
  };
  criticalFailureCodes: CriticalFailureCode[];
  failedScenarios: Array<{ id: string; name: string; detail: string; critical: boolean }>;
  categoryResults: Record<string, { passed: number; failed: number }>;
  inventory: ReturnType<typeof summarizeInventory>;
  inventoryRows: ReturnType<typeof buildProsecutionFeatureInventory>;
  performance: {
    scenarioCount: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    errorRate: number;
  };
  staging: ReturnType<typeof auditStagingReadiness>;
  cjis: {
    certified: false;
    gaps: ReturnType<typeof auditCjisTechnicalGaps>;
  };
  liveCanary: ReturnType<typeof liveCanaryPlan>;
  pilotChecklist: string[];
  classification: ProsecutionBenchClassification;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function classify(scenarios: ScenarioResult[]): ProsecutionBenchClassification {
  const criticalFailed = scenarios.filter((s) => s.critical && !s.passed);
  const isolationFailed = scenarios.filter(
    (s) =>
      !s.passed &&
      (s.criticalCodes.includes("CROSS_TENANT_LEAK") ||
        s.criticalCodes.includes("CROSS_CASE_LEAK") ||
        s.criticalCodes.includes("UNAUTHORIZED_ROLE_ESCALATION")),
  );
  if (isolationFailed.length > 0) return "PROSECUTION_STAGE7_SECURITY_BLOCKED";
  if (criticalFailed.length > 0 || scenarios.some((s) => !s.passed && s.critical)) {
    return "PROSECUTION_STAGE7_BENCHMARK_BLOCKED";
  }
  if (scenarios.some((s) => !s.passed)) return "PROSECUTION_STAGE7_BENCHMARK_BLOCKED";
  // Software/security gates green — live provider canary still required.
  return "PAID_VALIDATION_AUTHORIZATION_REQUIRED";
}

export function runProsecutionBench(): { runDir: string; summary: ProsecutionBenchSummary } {
  const runId = `prosecution-bench-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = createRunDir(runId);
  const fixtures = buildProsecutionBenchFixtures();
  const scenarios = runProsecutionBenchScenarios();
  for (const scenario of scenarios) {
    writeFileSync(
      join(runDir, "grades", `${scenario.id}.json`),
      `${JSON.stringify(scenario, null, 2)}\n`,
      "utf8",
    );
  }

  const passMap = new Map(scenarios.map((s) => [s.id, s.passed] as const));
  const inventoryRows = buildProsecutionFeatureInventory(passMap);
  const inventory = summarizeInventory(inventoryRows);
  const failed = scenarios.filter((s) => !s.passed);
  const criticalCodes = [
    ...new Set(failed.flatMap((s) => s.criticalCodes)),
  ] as CriticalFailureCode[];

  const categoryResults: Record<string, { passed: number; failed: number }> = {};
  for (const cat of PROSECUTION_BENCH_CATEGORIES) {
    categoryResults[cat] = { passed: 0, failed: 0 };
  }
  for (const s of scenarios) {
    const bucket = categoryResults[s.category] ?? { passed: 0, failed: 0 };
    if (s.passed) bucket.passed += 1;
    else bucket.failed += 1;
    categoryResults[s.category] = bucket;
  }

  const durations = scenarios.map((s) => s.durationMs).sort((a, b) => a - b);
  const summary: ProsecutionBenchSummary = {
    runId,
    benchmarkId: PROSECUTION_BENCH_ID,
    datasetVersion: PROSECUTION_BENCH_VERSION,
    graderVersion: PROSECUTION_BENCH_GRADER_VERSION,
    commitSha: commitSha(),
    timestamp: new Date().toISOString(),
    paidCalls: 0,
    courtListener: 0,
    syntheticCases: Object.keys(fixtures).length,
    totals: {
      scenarios: scenarios.length,
      passed: scenarios.filter((s) => s.passed).length,
      failed: failed.length,
      criticalFailures: scenarios.filter((s) => s.critical && !s.passed).length,
      passRate:
        scenarios.length === 0 ? 0 : scenarios.filter((s) => s.passed).length / scenarios.length,
    },
    criticalFailureCodes: criticalCodes,
    failedScenarios: failed.map((s) => ({
      id: s.id,
      name: s.name,
      detail: s.detail,
      critical: s.critical,
    })),
    categoryResults,
    inventory,
    inventoryRows,
    performance: {
      scenarioCount: scenarios.length,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      maxMs: durations[durations.length - 1] ?? 0,
      errorRate: scenarios.length === 0 ? 1 : failed.length / scenarios.length,
    },
    staging: auditStagingReadiness(),
    cjis: {
      certified: false,
      gaps: auditCjisTechnicalGaps(),
    },
    liveCanary: liveCanaryPlan(),
    pilotChecklist: pilotAcceptanceChecklist(),
    classification: classify(scenarios),
  };

  persistSummary(runDir, summary);
  return { runDir, summary };
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith("prosecution-bench.ts") ||
    process.argv[1].endsWith("prosecution-bench.js"));

if (isDirect) {
  const { summary } = runProsecutionBench();
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        classification: summary.classification,
        totals: summary.totals,
        criticalFailureCodes: summary.criticalFailureCodes,
        paidCalls: summary.paidCalls,
        courtListener: summary.courtListener,
        liveCanary: summary.liveCanary.status,
      },
      null,
      2,
    ),
  );
  if (
    summary.classification === "PROSECUTION_STAGE7_BENCHMARK_BLOCKED" ||
    summary.classification === "PROSECUTION_STAGE7_SECURITY_BLOCKED"
  ) {
    process.exitCode = 1;
  }
}
