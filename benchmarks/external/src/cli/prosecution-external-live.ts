/**
 * Live NYAYA_PIPELINE external prosecution executor CLI.
 *
 * Dry-run (default / --dry-run): zero paid provider calls.
 * Paid mode requires BOTH:
 *   --allow-paid-model-calls
 *   --max-cost-usd 25
 *
 * This CLI does NOT authorize spend by itself — operators must pass both flags
 * after explicit renewed authorization.
 */

import { isLivePaidExecutionAuthorized } from "../live/authorization.js";
import { planProsecutionExternalLiveCost } from "../prosecution-external/cost-plan.js";
import {
  DEFAULT_HARD_CAP_USD,
  DEFAULT_REQUEST_CAP,
  runProsecutionExternalLive,
} from "../prosecution-external/live-executor.js";
import {
  loadLegalBenchProsecutionSliceAsync,
  loadLegalCiteBenchProsecutionSliceAsync,
  resolveLegalCiteBenchMount,
} from "../prosecution-external/suite.js";

function parseExamples(argv: readonly string[], name: string): number | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) {
      const n = Number(argv[i + 1]);
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const argv = process.argv;
  const dryRun = argv.includes("--dry-run") || !argv.includes("--allow-paid-model-calls");
  const wantPaid = argv.includes("--allow-paid-model-calls");

  if (wantPaid && !isLivePaidExecutionAuthorized({ argv })) {
    console.error(
      JSON.stringify(
        {
          exitClassification: "AUTHORIZATION_REQUIRED",
          message:
            "Paid prosecution external live requires --allow-paid-model-calls AND --max-cost-usd > 0",
          paidExecutionStarted: false,
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }

  // Preflight mounts for non-fixture paid runs.
  const lbCount = parseExamples(argv, "--legalbench-examples");
  const citeCount = parseExamples(argv, "--legalcite-examples");
  if (!dryRun) {
    const lb = await loadLegalBenchProsecutionSliceAsync({
      fixtureFallback: false,
      count: lbCount ?? 37,
    });
    const citeMount = resolveLegalCiteBenchMount();
    const cite = await loadLegalCiteBenchProsecutionSliceAsync({
      fixtureFallback: false,
      count: citeCount ?? 80,
    });
    if (lb.selectedCount === 0 || cite.selectedCount === 0 || !citeMount) {
      console.error(
        JSON.stringify(
          {
            exitClassification: "DATASET_UNAVAILABLE",
            legalbench: { mount: lb.mountStatus, selected: lb.selectedCount },
            legalcitebench: {
              mount: cite.mountStatus,
              selected: cite.selectedCount,
              path: citeMount,
            },
            paidExecutionStarted: false,
          },
          null,
          2,
        ),
      );
      process.exitCode = 3;
      return;
    }
  }

  const costPlan = planProsecutionExternalLiveCost({
    legalbenchExamples: lbCount ?? 37,
    legalciteExamples: citeCount ?? 80,
    commercialOnly: true,
    hardCapUsd: DEFAULT_HARD_CAP_USD,
    maxProviderRequests: DEFAULT_REQUEST_CAP,
  });

  if (!dryRun && !costPlan.withinHardCap) {
    console.error(
      JSON.stringify(
        {
          exitClassification: "BUDGET_BLOCKED",
          costPlan,
          paidExecutionStarted: false,
        },
        null,
        2,
      ),
    );
    process.exitCode = 4;
    return;
  }

  const report = await runProsecutionExternalLive({
    argv,
    dryRun,
    commercialOnly: true,
    useFixturesOnly: dryRun,
    maxExamples: parseExamples(argv, "--max-examples"),
    hardCapUsd: DEFAULT_HARD_CAP_USD,
    requestCap: DEFAULT_REQUEST_CAP,
  });

  console.log(
    JSON.stringify(
      {
        exitClassification: report.exitClassification,
        dryRun: report.dryRun,
        paidCalls: report.paidCalls,
        providerRequests: report.providerRequests,
        actualSpendUsd: report.actualSpendUsd,
        selectedExamples: report.selectedExamples,
        executedExamples: report.executedExamples,
        legalbench: {
          selected: report.legalbenchSelected,
          executed: report.legalbenchExecuted,
          accuracy: report.legalbenchAccuracy,
        },
        legalcitebench: {
          selected: report.legalciteSelected,
          executed: report.legalciteExecuted,
          accuracy: report.legalciteAccuracy,
        },
        criticalFailures: report.criticalFailures,
        unsupportedAnswers: report.unsupportedAnswers,
        fabricatedCitations: report.fabricatedCitations,
        substitutions: report.substitutions,
        fallbacks: report.fallbacks,
        gpt61SolLiveVerified: report.gpt61SolLiveVerified,
        costPlanPreview: dryRun
          ? {
              estimatedSpendUsd: costPlan.estimatedSpendUsd,
              conservativeUpperBoundUsd: costPlan.conservativeUpperBoundUsd,
              registryLinearUsd: costPlan.registryLinearUsd,
              estimateReconciliation: costPlan.estimateReconciliation,
              withinHardCap: costPlan.withinHardCap,
            }
          : undefined,
        courtListener: report.courtListener,
        paidExecutionStarted: !report.dryRun && report.paidCalls > 0,
      },
      null,
      2,
    ),
  );

  if (
    report.exitClassification === "AUTHORIZATION_REQUIRED" ||
    report.exitClassification === "BUDGET_BLOCKED" ||
    report.exitClassification === "DATASET_UNAVAILABLE" ||
    report.exitClassification === "ROUTING_BLOCKED" ||
    report.exitClassification === "CRITICAL_GROUNDING_FAILURE" ||
    report.exitClassification === "PROVIDER_FAILURE"
  ) {
    process.exitCode = 5;
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
