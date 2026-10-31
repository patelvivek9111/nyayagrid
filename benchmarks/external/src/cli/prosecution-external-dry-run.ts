import { isPaidCallsAuthorized } from "../guards/paid-call-guard.js";
import { runProsecutionExternalDryRun } from "../prosecution-external/dry-run.js";
import { planProsecutionExternalLiveCost } from "../prosecution-external/cost-plan.js";

async function main(): Promise<void> {
  if (process.argv.includes("--live") || process.env.EXTERNAL_BENCH_FORCE_LIVE === "1") {
    console.error("PAID_EXECUTION_NOT_AUTHORIZED_FOR_PROSECUTION_EXTERNAL_SUITE");
    process.exitCode = 2;
    return;
  }
  if (isPaidCallsAuthorized() && process.env.EXTERNAL_BENCH_FORCE_LIVE === "1") {
    console.error("PAID_CALLS_FORBIDDEN");
    process.exitCode = 2;
    return;
  }

  const report = await runProsecutionExternalDryRun();
  const costPlan = planProsecutionExternalLiveCost();
  console.log(
    JSON.stringify(
      {
        dryRun: {
          suiteId: report.suiteId,
          suiteVersion: report.suiteVersion,
          seed: report.seed,
          paidCalls: report.paidCalls,
          courtListener: report.courtListener,
          taskCount: report.tasks.length,
          groups: report.groups,
          gpt61SolLiveVerified: report.gpt61SolLiveVerified,
          selectionManifestHash: report.selectionManifestHash,
        },
        futureLivePlan: costPlan,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
