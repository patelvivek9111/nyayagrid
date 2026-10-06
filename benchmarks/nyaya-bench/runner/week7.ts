import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWeek7ProductSuite } from "../datasets/week7/product-suite";
import {
  WEEK7_AUDIT,
  WEEK7_DATASET_ID,
  WEEK7_DATASET_VERSION,
  WEEK7_GRADER_VERSION,
  WEEK7_SURFACES,
} from "../datasets/week7/taxonomy";
import { createRunDir, persistSummary } from "./persist";

function commitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export type Week7Classification =
  | "WEEK7_CONTINUE"
  | "WEEK7_PRODUCT_STABILIZATION_MAJOR_COMPLETE"
  | "WEEK7_PASS_READY_FOR_FINAL_CERTIFICATION";

export type Week7RunSummary = {
  runId: string;
  datasetId: string;
  datasetVersion: string;
  graderVersion: string;
  commitSha: string;
  timestamp: string;
  externalLlmCalls: 0;
  courtListenerBroadAcquisition: false;
  paidModelCert: "PAID_MODEL_CERT_PENDING_FINAL_CERTIFICATION";
  corpusHealth: "CORPUS_HEALTH_PENDING_FINAL_CERTIFICATION";
  pitr: "PITR_ENVIRONMENT_DEPENDENT";
  surfaces: typeof WEEK7_SURFACES;
  totals: {
    checks: number;
    passed: number;
    failed: number;
    criticalFailed: number;
    highFailed: number;
    passRate: number;
  };
  failedChecks: Array<{ id: string; name: string; severity: string; detail: string }>;
  exitGates: Record<string, boolean>;
  week5Regression: "PASS" | "FAIL" | "PENDING_EXTERNAL";
  week6Regression: "PASS" | "FAIL" | "PENDING_EXTERNAL";
  productionBuild: "PASS" | "FAIL" | "PENDING_EXTERNAL";
  classification: Week7Classification;
  audit: typeof WEEK7_AUDIT;
};

function classify(
  allPassed: boolean,
  criticalFailed: number,
  week5: string,
  week6: string,
  build: string,
): Week7Classification {
  if (criticalFailed > 0 || week5 === "FAIL" || week6 === "FAIL" || build === "FAIL") {
    return "WEEK7_CONTINUE";
  }
  if (!allPassed || week5 !== "PASS" || week6 !== "PASS" || build !== "PASS") {
    return "WEEK7_PRODUCT_STABILIZATION_MAJOR_COMPLETE";
  }
  return "WEEK7_PASS_READY_FOR_FINAL_CERTIFICATION";
}

export function runWeek7Certification(options?: {
  week5Regression?: "PASS" | "FAIL" | "PENDING_EXTERNAL";
  week6Regression?: "PASS" | "FAIL" | "PENDING_EXTERNAL";
  productionBuild?: "PASS" | "FAIL" | "PENDING_EXTERNAL";
}): { runDir: string; summary: Week7RunSummary } {
  const week5Regression = options?.week5Regression ?? "PENDING_EXTERNAL";
  const week6Regression = options?.week6Regression ?? "PENDING_EXTERNAL";
  const productionBuild = options?.productionBuild ?? "PENDING_EXTERNAL";

  const runId = `week7-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = createRunDir(runId);
  const checks = runWeek7ProductSuite();
  for (const check of checks) {
    writeFileSync(join(runDir, "grades", `${check.id}.json`), `${JSON.stringify(check, null, 2)}\n`, "utf8");
  }
  const failed = checks.filter((c) => !c.passed);
  const byId = Object.fromEntries(checks.map((c) => [c.id, c.passed]));
  const exitGates = {
    surfacesAudited: byId["W7-SURFACES"] === true,
    prosecutionNav: byId["W7-PROS-NAV"] === true,
    statusLabels: byId["W7-STATUS-LABELS"] === true,
    askUx: byId["W7-ASK-UX"] === true,
    guidePrepare: byId["W7-GUIDE-PREPARE"] === true,
    emptyLoadingError: byId["W7-EMPTY-LOAD-ERR"] === true,
    noGuiltUi: byId["W7-NO-GUILT"] === true,
    p1Dispositioned: byId["W7-P1-DISPOSITION"] === true,
    week5Regression: week5Regression === "PASS",
    week6Regression: week6Regression === "PASS",
    productionBuild: productionBuild === "PASS",
    noP0: failed.every((c) => c.severity !== "CRITICAL"),
  };
  const allPassed = failed.length === 0;
  const summary: Week7RunSummary = {
    runId,
    datasetId: WEEK7_DATASET_ID,
    datasetVersion: WEEK7_DATASET_VERSION,
    graderVersion: WEEK7_GRADER_VERSION,
    commitSha: commitSha(),
    timestamp: new Date().toISOString(),
    externalLlmCalls: 0,
    courtListenerBroadAcquisition: false,
    paidModelCert: "PAID_MODEL_CERT_PENDING_FINAL_CERTIFICATION",
    corpusHealth: "CORPUS_HEALTH_PENDING_FINAL_CERTIFICATION",
    pitr: "PITR_ENVIRONMENT_DEPENDENT",
    surfaces: WEEK7_SURFACES,
    totals: {
      checks: checks.length,
      passed: checks.filter((c) => c.passed).length,
      failed: failed.length,
      criticalFailed: failed.filter((c) => c.severity === "CRITICAL").length,
      highFailed: failed.filter((c) => c.severity === "HIGH").length,
      passRate: checks.length === 0 ? 0 : checks.filter((c) => c.passed).length / checks.length,
    },
    failedChecks: failed.map((c) => ({
      id: c.id,
      name: c.name,
      severity: c.severity,
      detail: c.detail,
    })),
    exitGates,
    week5Regression,
    week6Regression,
    productionBuild,
    classification: classify(
      allPassed,
      failed.filter((c) => c.severity === "CRITICAL").length,
      week5Regression,
      week6Regression,
      productionBuild,
    ),
    audit: WEEK7_AUDIT,
  };
  persistSummary(runDir, summary);
  writeFileSync(join(runDir, "checks.json"), `${JSON.stringify(checks, null, 2)}\n`, "utf8");
  return { runDir, summary };
}

function parseFlag(name: string): "PASS" | "FAIL" | "PENDING_EXTERNAL" {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) {
    const value = eq.slice(name.length + 1).toUpperCase();
    if (value === "PASS" || value === "FAIL" || value === "PENDING_EXTERNAL") return value;
  }
  const envKey =
    name === "--week5"
      ? "WEEK7_WEEK5_REGRESSION"
      : name === "--week6"
        ? "WEEK7_WEEK6_REGRESSION"
        : "WEEK7_PRODUCTION_BUILD";
  const env = (process.env[envKey] ?? "").toUpperCase();
  if (env === "PASS" || env === "FAIL" || env === "PENDING_EXTERNAL") return env;
  return "PENDING_EXTERNAL";
}

function main() {
  const summary = runWeek7Certification({
    week5Regression: parseFlag("--week5"),
    week6Regression: parseFlag("--week6"),
    productionBuild: parseFlag("--build"),
  }).summary;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        classification: summary.classification,
        totals: summary.totals,
        failedChecks: summary.failedChecks,
        exitGates: summary.exitGates,
        paidModelCert: summary.paidModelCert,
        corpusHealth: summary.corpusHealth,
        pitr: summary.pitr,
      },
      null,
      2,
    ),
  );
  if (summary.totals.criticalFailed > 0 || summary.classification === "WEEK7_CONTINUE") {
    process.exitCode = 1;
  }
}

const isDirect = process.argv[1] && (process.argv[1].endsWith("week7.ts") || process.argv[1].endsWith("week7.js"));
if (isDirect) main();
