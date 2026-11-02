import { planProsecutionExternalLiveCost } from "../prosecution-external/cost-plan.js";
import {
  loadLegalBenchProsecutionSliceAsync,
  loadLegalCiteBenchProsecutionSliceAsync,
} from "../prosecution-external/suite.js";

async function main(): Promise<void> {
  const lb = await loadLegalBenchProsecutionSliceAsync({ fixtureFallback: false });
  const cite = await loadLegalCiteBenchProsecutionSliceAsync({ fixtureFallback: false });
  const legalbenchExamples = lb.selectedCount;
  const legalciteExamples = cite.selectedCount;
  const plan = planProsecutionExternalLiveCost({
    commercialOnly: true,
    legalbenchExamples,
    legalciteExamples,
    hardCapUsd: 25,
    preferredSpendUsd: 20,
    maxProviderRequests: 220,
  });
  console.log(
    JSON.stringify(
      {
        ...plan,
        paidExecutionAuthorized: false,
        mounts: {
          legalbench: {
            mountStatus: lb.mountStatus,
            planned: lb.plannedCount,
            selected: lb.selectedCount,
          },
          legalcitebench: {
            mountStatus: cite.mountStatus,
            planned: cite.plannedCount,
            selected: cite.selectedCount,
          },
        },
      },
      null,
      2,
    ),
  );
  if (!plan.withinHardCap) {
    console.error("COST_PLAN_EXCEEDS_HARD_CAP");
    process.exitCode = 2;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
