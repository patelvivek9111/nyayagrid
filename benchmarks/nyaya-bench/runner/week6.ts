import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCostOpsSuite } from "../datasets/week6/cost-ops-suite";
import { runLoadPerfSuite } from "../datasets/week6/load-perf-suite";
import { runReliabilitySuite } from "../datasets/week6/reliability-suite";
import { runSecuritySuite } from "../datasets/week6/security-suite";
import {
  WEEK6_AUDIT,
  WEEK6_DATASET_ID,
  WEEK6_DATASET_VERSION,
  WEEK6_GRADER_VERSION,
  WEEK6_THREAT_MODEL,
} from "../datasets/week6/taxonomy";
import { createRunDir, persistSummary } from "./persist";

function commitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export type Week6Check = {
  id: string;
  name: string;
  track: "security" | "reliability" | "load" | "cost_ops";
  passed: boolean;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  detail: string;
  metrics?: Record<string, number | string | null>;
};

export type Week6Classification =
  | "WEEK6_CONTINUE"
  | "WEEK6_PRODUCTION_HARDENING_MAJOR_COMPLETE"
  | "WEEK6_PASS_OPEN_WEEK7";

export type Week6RunSummary = {
  runId: string;
  datasetId: string;
  datasetVersion: string;
  graderVersion: string;
  commitSha: string;
  timestamp: string;
  modelProvider: "deterministic";
  model: "week6-hardening";
  externalLlmCalls: 0;
  courtListenerRequests: 0;
  courtListenerBroadAcquisition: false;
  paidModelCert: "PAID_MODEL_CERT_NOT_RUN";
  corpusHealth: "CORPUS_HEALTH_NOT_REMEASURED";
  totals: {
    checks: number;
    passed: number;
    failed: number;
    criticalFailed: number;
    highFailed: number;
    passRate: number;
  };
  byTrack: Record<string, { passed: number; failed: number }>;
  failedChecks: Array<{ id: string; name: string; severity: string; detail: string }>;
  threatModelCount: number;
  exitGates: Record<string, boolean>;
  classification: Week6Classification;
  audit: typeof WEEK6_AUDIT;
  week5Regression: "PENDING_EXTERNAL" | "PASS" | "FAIL";
};

function classify(
  checks: Week6Check[],
  week5Regression: "PENDING_EXTERNAL" | "PASS" | "FAIL",
): Week6Classification {
  const criticalFailed = checks.filter((c) => !c.passed && c.severity === "CRITICAL").length;
  const highFailed = checks.filter((c) => !c.passed && c.severity === "HIGH").length;
  const allPassed = checks.every((c) => c.passed);
  if (criticalFailed > 0 || week5Regression === "FAIL") return "WEEK6_CONTINUE";
  if (!allPassed || highFailed > 0 || week5Regression !== "PASS") {
    return "WEEK6_PRODUCTION_HARDENING_MAJOR_COMPLETE";
  }
  return "WEEK6_PASS_OPEN_WEEK7";
}

function buildExitGates(
  checks: Week6Check[],
  week5Regression: "PENDING_EXTERNAL" | "PASS" | "FAIL",
): Record<string, boolean> {
  const byId = Object.fromEntries(checks.map((c) => [c.id, c.passed]));
  return {
    authorizationAudit: byId["W6-SEC-THREAT-MATRIX"] === true && byId["W6-SEC-IDOR"] === true,
    crossTenantIsolation: byId["W6-LOAD-CONCURRENT-ISO"] === true && byId["W6-SEC-IDOR"] === true,
    uploadObjectSecurity: byId["W6-SEC-UPLOAD"] === true,
    promptInjection: byId["W6-SEC-INJECTION"] === true,
    rateLimits: byId["W6-SEC-RATE-LIMIT"] === true,
    largeMatter: byId["W6-LOAD-LF-MATTER"] === true,
    largeProsecution: byId["W6-LOAD-PROS-CASE"] === true,
    retrievalPerfMeasured: byId["W6-PERF-RETRIEVAL"] === true,
    noPathologicalQuery: byId["W6-PERF-BOUNDS"] === true,
    workerIdempotency: byId["W6-REL-DUP"] === true,
    crashRecovery: byId["W6-REL-CRASH"] === true,
    dbFailure: byId["W6-REL-DB"] === true,
    storageFailure: byId["W6-REL-STORAGE"] === true,
    providerFailure: byId["W6-REL-PROVIDER"] === true,
    backupRestore: byId["W6-BACKUP-STRATEGY"] === true,
    costInstrumentation: byId["W6-COST-INSTRUMENT"] === true,
    costGuardrails: byId["W6-COST-GUARDRAILS"] === true,
    observability: byId["W6-OBS-HEALTH"] === true,
    secretAudit: byId["W6-SEC-SECRET-SCAN"] === true,
    guideP1: byId["W6-GUIDE-P1"] === true,
    deploymentConfig: byId["W6-DEPLOY-CONFIG"] === true,
    week5Regression: week5Regression === "PASS",
    noUnresolvedP0: checks.every((c) => c.passed || c.severity !== "CRITICAL"),
  };
}

export async function runWeek6Certification(options?: {
  week5Regression?: "PENDING_EXTERNAL" | "PASS" | "FAIL";
}): Promise<{ runDir: string; summary: Week6RunSummary; checks: Week6Check[] }> {
  const week5Regression = options?.week5Regression ?? "PENDING_EXTERNAL";

  const runId = `week6-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = createRunDir(runId);

  const security = runSecuritySuite().map((c) => ({ ...c, track: "security" as const }));
  const reliability = (await runReliabilitySuite()).map((c) => ({
    ...c,
    track: "reliability" as const,
  }));
  const load = runLoadPerfSuite().map((c) => ({ ...c, track: "load" as const }));
  const costOps = runCostOpsSuite().map((c) => ({ ...c, track: "cost_ops" as const }));
  const checks: Week6Check[] = [...security, ...reliability, ...load, ...costOps];

  for (const check of checks) {
    writeFileSync(join(runDir, "grades", `${check.id}.json`), `${JSON.stringify(check, null, 2)}\n`, "utf8");
  }

  writeFileSync(
    join(runDir, "threat-control-matrix.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        threats: WEEK6_THREAT_MODEL.map((t) => ({
          ...t,
          relatedChecks: checks
            .filter(
              (c) =>
                c.id.startsWith("W6-SEC") ||
                c.id.startsWith("W6-REL") ||
                c.id === "W6-LOAD-CONCURRENT-ISO",
            )
            .map((c) => ({ id: c.id, passed: c.passed })),
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const failed = checks.filter((c) => !c.passed);
  const byTrack: Record<string, { passed: number; failed: number }> = {};
  for (const check of checks) {
    byTrack[check.track] ??= { passed: 0, failed: 0 };
    if (check.passed) byTrack[check.track]!.passed += 1;
    else byTrack[check.track]!.failed += 1;
  }

  const classification = classify(checks, week5Regression);
  const exitGates = buildExitGates(checks, week5Regression);

  const summary: Week6RunSummary = {
    runId,
    datasetId: WEEK6_DATASET_ID,
    datasetVersion: WEEK6_DATASET_VERSION,
    graderVersion: WEEK6_GRADER_VERSION,
    commitSha: commitSha(),
    timestamp: new Date().toISOString(),
    modelProvider: "deterministic",
    model: "week6-hardening",
    externalLlmCalls: 0,
    courtListenerRequests: 0,
    courtListenerBroadAcquisition: false,
    paidModelCert: "PAID_MODEL_CERT_NOT_RUN",
    corpusHealth: "CORPUS_HEALTH_NOT_REMEASURED",
    totals: {
      checks: checks.length,
      passed: checks.filter((c) => c.passed).length,
      failed: failed.length,
      criticalFailed: failed.filter((c) => c.severity === "CRITICAL").length,
      highFailed: failed.filter((c) => c.severity === "HIGH").length,
      passRate: checks.length === 0 ? 0 : checks.filter((c) => c.passed).length / checks.length,
    },
    byTrack,
    failedChecks: failed.map((c) => ({
      id: c.id,
      name: c.name,
      severity: c.severity,
      detail: c.detail,
    })),
    threatModelCount: WEEK6_THREAT_MODEL.length,
    exitGates,
    classification,
    audit: WEEK6_AUDIT,
    week5Regression,
  };

  persistSummary(runDir, summary);
  writeFileSync(join(runDir, "checks.json"), `${JSON.stringify(checks, null, 2)}\n`, "utf8");
  return { runDir, summary, checks };
}

function parseWeek5Regression(
  argv: string[],
): "PENDING_EXTERNAL" | "PASS" | "FAIL" {
  const eq = argv.find((a) => a.startsWith("--week5="));
  if (eq) {
    const value = eq.slice("--week5=".length).toUpperCase();
    if (value === "PASS" || value === "FAIL" || value === "PENDING_EXTERNAL") return value;
  }
  const flagIdx = argv.indexOf("--week5");
  if (flagIdx >= 0) {
    const value = (argv[flagIdx + 1] ?? "").toUpperCase();
    if (value === "PASS" || value === "FAIL" || value === "PENDING_EXTERNAL") return value;
  }
  // Environment override for CI / npm script quirks on Windows.
  const env = (process.env.WEEK6_WEEK5_REGRESSION ?? "").toUpperCase();
  if (env === "PASS" || env === "FAIL" || env === "PENDING_EXTERNAL") return env;
  return "PENDING_EXTERNAL";
}

async function main() {
  const week5Regression = parseWeek5Regression(process.argv);
  const { runDir, summary } = await runWeek6Certification({ week5Regression });
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        runDir,
        classification: summary.classification,
        totals: summary.totals,
        failedChecks: summary.failedChecks,
        exitGates: summary.exitGates,
        paidModelCert: summary.paidModelCert,
        corpusHealth: summary.corpusHealth,
        courtListenerBroadAcquisition: summary.courtListenerBroadAcquisition,
      },
      null,
      2,
    ),
  );
  if (summary.totals.criticalFailed > 0 || summary.classification === "WEEK6_CONTINUE") {
    process.exitCode = 1;
  }
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith("week6.ts") || process.argv[1].endsWith("week6.js"));
if (isDirect) {
  void main();
}
