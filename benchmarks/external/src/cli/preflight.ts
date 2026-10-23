import { runPaidBenchmarkPreflight, PAID_BENCHMARK_PREFLIGHT_PASS } from "../live/preflight.js";

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const result = runPaidBenchmarkPreflight({ dryRun });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === PAID_BENCHMARK_PREFLIGHT_PASS) {
    console.log(PAID_BENCHMARK_PREFLIGHT_PASS);
  } else {
    process.exitCode = 2;
  }
}

main();
