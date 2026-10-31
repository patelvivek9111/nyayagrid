import { planProsecutionExternalLiveCost } from "../prosecution-external/cost-plan.js";

function main(): void {
  const plan = planProsecutionExternalLiveCost();
  console.log(JSON.stringify({ ...plan, paidExecutionAuthorized: false }, null, 2));
}

main();
