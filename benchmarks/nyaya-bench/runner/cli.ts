import { loadBenchEnv } from "./load-env";
import { runBenchmark, parseArgs } from "./run";

loadBenchEnv();

const appEnv = (process.env.APP_ENV ?? "").trim().toLowerCase();
if (appEnv === "production" && process.env.ALLOW_PRODUCTION_SYNTHETIC_WRITE !== "1") {
  throw new Error(
    "nyaya-bench refuses APP_ENV=production. Point DATABASE_URL at a non-production database, or set ALLOW_PRODUCTION_SYNTHETIC_WRITE=1 after review.",
  );
}

const options = parseArgs(process.argv.slice(2));
if (process.argv.includes("replay") && !options.replayRunDir) {
  throw new Error("Pass the persisted run directory: npm run bench -- replay reports/runs/<id>");
}

try {
  await runBenchmark(options);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
}
