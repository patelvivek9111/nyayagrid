/**
 * Build + write Stage-2 suite registry + context/cost plan locally.
 * Zero paid model calls. Does not freeze an immutable run manifest (that waits for CI green).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { getRegistryDir } from "../paths.js";
import { buildStage2SuitePlan } from "../live/stage2-task-planner.js";
import { buildStage2ContextProfile } from "../live/stage2-context-profile.js";
import { computeStage2ExactCostPlan } from "../cost/plan-stage2.js";
import { checkCredentialPresence } from "../live/credentials.js";
import { loadExternalBenchLocalEnv } from "../live/load-local-env.js";

async function main(): Promise<void> {
  loadExternalBenchLocalEnv();
  const suite = await buildStage2SuitePlan();
  const contextProfile = await buildStage2ContextProfile(suite);
  const costPlan = computeStage2ExactCostPlan({
    suite,
    measuredInputTokens: contextProfile.inputTokens,
  });
  const creds = checkCredentialPresence();

  const registry = getRegistryDir();
  writeFileSync(path.join(registry, "stage2-suite.json"), `${JSON.stringify(suite, null, 2)}\n`);
  writeFileSync(
    path.join(registry, "stage2-context-profile.json"),
    `${JSON.stringify(contextProfile, null, 2)}\n`,
  );
  writeFileSync(
    path.join(registry, "stage2-cost-plan.json"),
    `${JSON.stringify(costPlan, null, 2)}\n`,
  );

  // Update budget recommended cap placeholder from recomputed HIGH
  writeFileSync(
    path.join(registry, "stage2-budget.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        policy_version: "stage2-budget-v1",
        currency: "USD",
        note: "Recommended hard cap from frozen Stage-2 HIGH + ~10% contingency; not authorized until explicit paid authorization.",
        authorized_now: false,
        recommended_total_max_usd: costPlan.recommendedHardCapUsd,
        provider_subcaps_usd: costPlan.providerSubcapsUsd,
        global_overrides_provider_caps: true,
        batching: {
          preferred_batch_size: 5,
          max_batch_size: 10,
          default_concurrency: 1,
          provider_concurrency: { openai: 1, xai: 1, anthropic: 1 },
        },
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    JSON.stringify(
      {
        paidCalls: 0,
        suite: {
          prbench: suite.actual.prbenchHard,
          legalbench: suite.actual.legalbench,
          rag: suite.actual.legalbenchRag,
          responseCalls: suite.call_counts.totalResponses,
          judgeCalls: suite.call_counts.judgeCalls,
          ragGenerationCalls: 0,
        },
        context: contextProfile.inputTokens,
        overflows: {
          gpt: contextProfile.gptOverflows,
          grok: contextProfile.grokOverflows,
        },
        cost: {
          low: costPlan.cost.lowUsd,
          expected: costPlan.cost.expectedUsd,
          high: costPlan.cost.highUsd,
          recommendedHardCap: costPlan.recommendedHardCapUsd,
          oldExpected: costPlan.oldPlanComparison.oldExpectedUsd,
          oldHigh: costPlan.oldPlanComparison.oldHighUsd,
          note: costPlan.oldPlanComparison.materialDifferenceNote,
        },
        credentials: {
          ...creds,
          openaiGenerationAccess: "OPENAI_GENERATION_ACCESS_NOT_YET_CONFIRMED",
          googleMustNotBeUsed: true,
          valuesPrinted: false,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
