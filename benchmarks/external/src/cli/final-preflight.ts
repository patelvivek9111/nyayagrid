import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkCredentialPresence, allCredentialsPresent } from "../live/credentials.js";
import { loadExternalBenchLocalEnv } from "../live/load-local-env.js";
import { classifyModelAccessFromCredentials } from "../live/model-access.js";
import { buildStage1RunId, hashFileContents } from "../live/stage1-manifest-builder.js";
import { getRegistryDir, getCacheDir } from "../paths.js";
import { computeStagePlans } from "../cost/plan-stage1.js";

function gitSha(): string {
  try {
    return execSync(
      "git -c safe.directory=c:/Users/patel/Documents/nyayagrid-integration rev-parse HEAD",
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "UNKNOWN_SHA";
  }
}

function main(): void {
  loadExternalBenchLocalEnv();
  const credentials = checkCredentialPresence();
  const access = classifyModelAccessFromCredentials(credentials);
  const sha = gitSha();
  const runId = buildStage1RunId(sha);
  const stagePlans = computeStagePlans();
  const screening = JSON.parse(
    readFileSync(path.join(getRegistryDir(), "screening-suite.json"), "utf8"),
  ) as {
    actual: { prbenchHard: number; legalbench: number; legalbenchRag: number };
    frozen: boolean;
  };

  const freeRagPath = path.join(getRegistryDir(), "free-rag-preflight-result.json");
  const freeRag = existsSync(freeRagPath) ? JSON.parse(readFileSync(freeRagPath, "utf8")) : null;

  const manifestPath = path.join(getCacheDir(), "runs", runId, "manifest.json");
  const manifestFrozen = existsSync(manifestPath);

  const ready =
    allCredentialsPresent(credentials) &&
    screening.frozen === true &&
    screening.actual.prbenchHard === 32 &&
    screening.actual.legalbench === 24 &&
    screening.actual.legalbenchRag === 150 &&
    manifestFrozen;

  const decision = ready
    ? "LIVE_CANARY_READY"
    : !allCredentialsPresent(credentials)
      ? "LIVE_CANARY_BLOCKED"
      : "LIVE_PREFLIGHT_PARTIAL";

  const report = {
    status: decision,
    classification: "LIVE_MODEL_BENCHMARK_PREFLIGHT",
    gitSha: sha,
    runId,
    manifestFrozen,
    credentials,
    valuesPrinted: false,
    modelAccess: access,
    dataset: screening.actual,
    datasetHashes: {
      screeningSuite: hashFileContents("screening-suite.json"),
    },
    callCounts: stagePlans.stage_1.callCounts,
    cost: stagePlans.stage_1.cost,
    freeRag: freeRag
      ? {
          executed: true,
          queries: freeRag.queries,
          documentHitRate: freeRag.documentHitRate,
          meanRecallAtK: freeRag.meanRecallAtK,
        }
      : { executed: false },
    paidCalls: { openai: 0, anthropic: 0, google: 0, xai: 0, judge: 0, courtlistener: 0 },
    blockedReasons: ready
      ? []
      : [
          ...(!allCredentialsPresent(credentials) ? (["credentials_missing"] as const) : []),
          ...(!manifestFrozen ? (["manifest_not_frozen"] as const) : []),
        ],
  };

  writeFileSync(
    path.join(getRegistryDir(), "final-preflight-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  if (decision !== "LIVE_CANARY_READY") process.exitCode = 2;
}

main();
