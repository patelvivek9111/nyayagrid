/**
 * Four-provider certification runner.
 *
 * Forces one model at a time. Does not let Auto choose the provider.
 * Does not overwrite historical 6V/6W/C2A baselines.
 * Does not print API keys.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CERTIFICATION_SUBSYSTEMS,
  MODEL_REGISTRY_VERSION,
  buildDefaultModelRegistry,
  decideCertification,
  blockedExternalMeasurement,
  type CertificationSubsystem,
} from "@nyayagrid/ai";
import { loadBenchEnv } from "../runner/load-env";
import { accessHasNoSecrets, inventoryProviderAccess, CERT_PROVIDERS } from "./access";
import { smokeProvider, type SmokeResult } from "./smoke";

loadBenchEnv();

const here = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = join(here, "artifacts");
const FROZEN_CONFIG_PATH = join(here, "frozen-config.json");
const repoRoot = resolve(here, "../../..");

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const frozenConfig = JSON.parse(readFileSync(FROZEN_CONFIG_PATH, "utf8")) as Record<
    string,
    unknown
  >;
  const access = inventoryProviderAccess({ repoRoot });
  if (!accessHasNoSecrets(access)) {
    throw new Error("Access inventory unexpectedly contained a secret-shaped value");
  }

  const registryBefore = buildDefaultModelRegistry();
  const smoke: SmokeResult[] = [];
  for (const row of access.providers) {
    smoke.push(
      await smokeProvider({
        provider: row.provider,
        keyAvailable: row.keyAvailable,
      }),
    );
  }

  const available = access.providers.filter((p) => p.keyAvailable);
  const blocked = available.length === 0;

  const matrix = CERTIFICATION_SUBSYSTEMS.map((subsystem: CertificationSubsystem) => {
    const cells: Record<string, ReturnType<typeof cellFor>> = {};
    for (const provider of CERT_PROVIDERS) {
      const modelId =
        access.providers.find((p) => p.provider === provider)?.modelId ?? provider;
      cells[provider] = cellFor(subsystem, provider, modelId, !access.providers.find((p) => p.provider === provider)?.keyAvailable);
    }
    return { subsystem, ...cells };
  });

  const artifact = {
    id: "FOUR_PROVIDER_CERTIFICATION_V1",
    generatedAt: new Date().toISOString(),
    overall: blocked ? "BLOCKED" : "IN_PROGRESS",
    reason: blocked
      ? "No provider API keys were available in process environment or repo-local dotenv. Live legal benchmarking was not run. Results were not fabricated."
      : "Keys available; live certification continues.",
    registryVersion: MODEL_REGISTRY_VERSION,
    frozenConfig,
    access: {
      files: access.files,
      dotenv: access.dotenv,
      process: access.process,
      databaseUrl: access.databaseUrl,
      providers: access.providers,
    },
    smoke,
    registryBefore: registryBefore.map((entry) => ({
      id: entry.id,
      provider: entry.provider,
      modelId: entry.modelId,
      status: entry.status,
      certification: entry.certification,
      qualityScore: entry.qualityScore,
      safetyScore: entry.safetyScore,
      notes: entry.notes,
    })),
    registryAfter: "unchanged",
    registryUpdateApplied: false,
    matrix,
    autoBenchmark: "not_run",
    deepReview: "not_run",
    featureAgents: "OFF",
    trustArchitectureChanged: false,
    nextPhaseIfBlocked: "PROVIDER ACCESS & CERTIFICATION CLOSEOUT",
  };

  writeJson(join(ARTIFACTS, "access.json"), artifact.access);
  writeJson(join(ARTIFACTS, "registry-snapshot.json"), artifact.registryBefore);
  writeJson(join(ARTIFACTS, "smoke.json"), smoke);
  writeJson(join(ARTIFACTS, "BLOCKED_EXTERNAL.json"), artifact);

  console.log(`overall=${artifact.overall}`);
  for (const row of access.providers) {
    console.log(`provider=${row.provider} model=${row.modelId} access=${row.status}`);
  }
  for (const row of smoke) {
    console.log(`smoke ${row.provider}: ${row.result}`);
  }
  if (blocked) {
    console.log("Certification stopped: BLOCKED_EXTERNAL for all four providers.");
    console.log(`Wrote ${join(ARTIFACTS, "BLOCKED_EXTERNAL.json")}`);
    process.exitCode = 2;
  }
}

function cellFor(
  subsystem: CertificationSubsystem,
  provider: string,
  modelId: string,
  blocked: boolean,
) {
  const measurement = blockedExternalMeasurement({
    subsystem,
    provider,
    modelId,
  });
  return {
    modelId,
    status: decideCertification(measurement),
    qualityPct: null,
    criticalSafetyPct: null,
    access: blocked ? "BLOCKED_EXTERNAL" : "AVAILABLE",
  };
}

await main();
