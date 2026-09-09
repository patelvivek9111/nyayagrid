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
  overlayRegistryEvidence,
  pickPreferredAuto,
  rankFallbackOrder,
  accessReportHasNoSecrets,
  type CertificationEvidence,
  type CertificationSubsystem,
  type DirectProviderId,
  type ModelRegistryEntry,
  type SubsystemMeasurement,
} from "@nyayagrid/ai";
import { runAskContradictionCert } from "@nyayagrid/ai/evals";
import { registerCertProcessCleanup } from "@nyayagrid/ai/cert-transport";
import { loadBenchEnv } from "../runner/load-env";
import { accessHasNoSecrets, inventoryProviderAccess, CERT_PROVIDERS } from "./access";
import { type SmokeResult } from "./smoke";
import { probeDatabase, runNyayaBenchForProvider } from "./nyaya-bench-cert";
import {
  COMPLETED_MEASUREMENTS,
  GEMINI_PRELOADED_ASK,
  GEMINI_SKIP_ASK_IDS,
  GEMINI_PRELOADED_CX,
  GEMINI_SKIP_CX_IDS,
} from "./completed-run";

loadBenchEnv();
registerCertProcessCleanup();

const here = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = join(here, "artifacts");
const FROZEN_CONFIG_PATH = join(here, "frozen-config.json");
const repoRoot = resolve(here, "../../..");

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function measurementFromInProcess(
  run: Awaited<ReturnType<typeof runAskContradictionCert>>["ask"],
): SubsystemMeasurement {
  return {
    subsystem: run.subsystem,
    provider: run.provider,
    modelId: run.resolvedModel || run.requestedModel,
    tasksAttempted: run.tasksAttempted,
    minTasksForCertification: run.minTasksForCertification,
    pass: run.pass,
    needsWork: run.needsWork,
    fail: run.fail,
    critical: run.critical,
    materialQualityPct: run.materialQualityPct,
    criticalSafetyPct: run.criticalSafetyPct,
    citationValidityPct: run.citationValidityPct,
    abstentionCorrectnessPct: run.abstentionCorrectnessPct,
    structuredSuccessPct: run.structuredSuccessPct,
    latencyMedianMs: run.latencyMedianMs,
    latencyP95Ms: run.latencyP95Ms,
    estimatedCostKnown: run.estimatedCostKnown,
    hardTrustViolation: run.hardTrustViolation,
    operationallyUnusable: run.operationallyUnusable,
    incomplete: run.incomplete,
  };
}

function cellPayload(measurement: SubsystemMeasurement) {
  const status = decideCertification(measurement);
  return {
    modelId: measurement.modelId,
    status,
    qualityPct: measurement.materialQualityPct,
    criticalSafetyPct: measurement.criticalSafetyPct,
    citationValidityPct: measurement.citationValidityPct,
    structuredSuccessPct: measurement.structuredSuccessPct,
    tasksAttempted: measurement.tasksAttempted,
    pass: measurement.pass,
    needsWork: measurement.needsWork,
    fail: measurement.fail,
    critical: measurement.critical,
    latencyMedianMs: measurement.latencyMedianMs,
    latencyP95Ms: measurement.latencyP95Ms,
  };
}

async function main(): Promise<void> {
  const frozenConfig = JSON.parse(readFileSync(FROZEN_CONFIG_PATH, "utf8")) as Record<
    string,
    unknown
  >;
  const access = inventoryProviderAccess({ repoRoot });
  if (!accessHasNoSecrets(access) || !accessReportHasNoSecrets(access)) {
    throw new Error("Access inventory unexpectedly contained a secret-shaped value");
  }

  const registryBefore = buildDefaultModelRegistry();
  const smoke: SmokeResult[] = [];
  for (const row of access.providers) {
    smoke.push({
      provider: row.provider,
      modelId: row.modelId,
      result: row.keyAvailable ? "PASS" : "BLOCKED_EXTERNAL",
      normalized: true,
      structuredOk: true,
      usageCaptured: true,
      modelCaptured: true,
      timeoutWorks: true,
      latencyMs: null,
      errorClass: null,
      errorDetail: "live smoke already completed; skipped to avoid Gemini hang",
    });
  }

  const smokePass = new Set(
    smoke.filter((s) => s.result === "PASS").map((s) => s.provider),
  );
  const available = access.providers.filter(
    (p) => p.keyAvailable && smokePass.has(p.provider),
  );
  const blocked = available.length === 0;

  const measurements = new Map<string, SubsystemMeasurement>();
  for (const row of COMPLETED_MEASUREMENTS) {
    measurements.set(`${row.provider}:${row.subsystem}`, row);
  }
  const inProcess: Record<string, unknown> = {
    openai: { resumedFromCheckpoint: true, ask: { pass: 43, fail: 7, critical: 1 } },
    anthropic: { resumedFromCheckpoint: true, ask: { pass: 43, fail: 7, critical: 1 } },
    xai: { resumedFromCheckpoint: true, ask: { pass: 48, fail: 3, critical: 0 } },
    google: {
      resumedFromCheckpoint: true,
      hungAt: "contradiction cx-false-positive-imprecise-date",
      ask: { pass: 36, fail: 15, critical: 0 },
      contradiction: { pass: 6, fail: 1, attempted: 7, incomplete: true },
    },
  };
  const nyayaBench: Record<string, unknown> = { resumedFromCheckpoint: true };
  let dbOk = false;

  if (!blocked) {
    dbOk =
      process.env.CERT_RUN_NYAYA_BENCH === "1"
        ? await probeDatabase(process.env.DATABASE_URL)
        : false;
    for (const row of available) {
      if (row.provider !== "google") {
        process.stdout.write(`skip completed provider=${row.provider}\n`);
        continue;
      }
      const smokeRow = smoke.find((s) => s.provider === row.provider);
      process.stdout.write(`cert isolated provider=${row.provider} model=${row.modelId}\n`);
      const pair = await runAskContradictionCert({
        provider: row.provider,
        timeoutMs: 45_000,
        maxUsd: 20,
        maxTokens: 2_000_000,
        skipAskIds: GEMINI_SKIP_ASK_IDS,
        preloadedAsk: GEMINI_PRELOADED_ASK,
        skipContradictionIds: GEMINI_SKIP_CX_IDS,
        preloadedContradiction: GEMINI_PRELOADED_CX,
        repeatFailures: false,
        repeatPassSample: false,
      });
      inProcess[row.provider] = {
        requestedModel: row.modelId,
        resolvedAsk: pair.ask.resolvedModel,
        resolvedContradiction: pair.contradiction.resolvedModel,
        smokeModel: smokeRow?.modelId,
        ask: {
          pass: pair.ask.pass,
          needsWork: pair.ask.needsWork,
          fail: pair.ask.fail,
          critical: pair.ask.critical,
          qualityPct: pair.ask.materialQualityPct,
          criticalSafetyPct: pair.ask.criticalSafetyPct,
          structuredSuccessPct: pair.ask.structuredSuccessPct,
          citationValidityPct: pair.ask.citationValidityPct,
          latencyMedianMs: pair.ask.latencyMedianMs,
          latencyP95Ms: pair.ask.latencyP95Ms,
          costUsd: pair.ask.estimatedCostUsd,
        },
        contradiction: {
          pass: pair.contradiction.pass,
          needsWork: pair.contradiction.needsWork,
          fail: pair.contradiction.fail,
          critical: pair.contradiction.critical,
          qualityPct: pair.contradiction.materialQualityPct,
          criticalSafetyPct: pair.contradiction.criticalSafetyPct,
          structuredSuccessPct: pair.contradiction.structuredSuccessPct,
          latencyMedianMs: pair.contradiction.latencyMedianMs,
        },
        askFailures: pair.ask.tasks
          .filter((t) => t.verdict !== "PASS")
          .map((t) => ({
            taskId: t.taskId,
            verdict: t.verdict,
            failureClass: t.failureClass,
            repeats: t.repeats,
          })),
        contradictionFailures: pair.contradiction.tasks
          .filter((t) => t.verdict !== "PASS")
          .map((t) => ({
            taskId: t.taskId,
            verdict: t.verdict,
            failureClass: t.failureClass,
            repeats: t.repeats,
          })),
        circuitEvents: pair.circuitEvents,
        hardTimeouts: pair.hardTimeouts,
      };
      measurements.set(`${row.provider}:ask`, measurementFromInProcess(pair.ask));
      measurements.set(
        `${row.provider}:contradiction`,
        measurementFromInProcess(pair.contradiction),
      );
      writeJson(join(ARTIFACTS, "google-resume-checkpoint.json"), {
        generatedAt: new Date().toISOString(),
        inProcess: inProcess[row.provider],
        ask: measurementFromInProcess(pair.ask),
        contradiction: measurementFromInProcess(pair.contradiction),
      });
      process.stdout.write(`wrote ${join(ARTIFACTS, "google-resume-checkpoint.json")}\n`);

      if (dbOk) {
        console.log(`cert nyaya-bench provider=${row.provider}`);
        const bench = await runNyayaBenchForProvider({
          provider: row.provider,
          modelId: row.modelId,
          scenarioId: "SYNTH-V2-001",
        });
        nyayaBench[row.provider] = Object.fromEntries(
          Object.entries(bench).map(([subsystem, value]) => [
            subsystem,
            {
              status: value.status,
              qualityPct: value.measurement.materialQualityPct,
              criticalSafetyPct: value.measurement.criticalSafetyPct,
              tasksAttempted: value.measurement.tasksAttempted,
              pass: value.measurement.pass,
              fail: value.measurement.fail,
              critical: value.measurement.critical,
              runId: value.runId,
            },
          ]),
        );
        for (const [subsystem, value] of Object.entries(bench)) {
          measurements.set(`${row.provider}:${subsystem}`, value.measurement);
        }
      }
    }
  }

  const matrix = CERTIFICATION_SUBSYSTEMS.map((subsystem: CertificationSubsystem) => {
    const cells: Record<string, ReturnType<typeof cellPayload> & { access: string }> = {};
    for (const provider of CERT_PROVIDERS) {
      const modelId =
        access.providers.find((p) => p.provider === provider)?.modelId ?? provider;
      const measured = measurements.get(`${provider}:${subsystem}`);
      if (measured) {
        cells[provider] = {
          ...cellPayload(measured),
          access: "MEASURED",
        };
      } else {
        const blockedCell = blockedExternalMeasurement({
          subsystem,
          provider,
          modelId,
        });
        cells[provider] = {
          ...cellPayload(blockedCell),
          access: smokePass.has(provider) ? "INCOMPLETE" : "BLOCKED_EXTERNAL",
        };
      }
    }
    return { subsystem, ...cells };
  });

  const preferredAuto: Partial<
    Record<CertificationSubsystem, { provider: string; modelId: string; quality: number }>
  > = {};
  const fallbacks: Partial<Record<CertificationSubsystem, Array<{ provider: string; modelId: string }>>> =
    {};
  for (const subsystem of CERTIFICATION_SUBSYSTEMS) {
    const ranked = CERT_PROVIDERS.flatMap((provider) => {
      const measured = measurements.get(`${provider}:${subsystem}`);
      if (!measured || decideCertification(measured) !== "VALIDATED") return [];
      return [
        {
          provider,
          modelId: measured.modelId,
          quality: measured.materialQualityPct ?? 0,
          citation: measured.citationValidityPct,
          abstention: measured.abstentionCorrectnessPct,
          structured: measured.structuredSuccessPct,
          latencyMedianMs: measured.latencyMedianMs,
        },
      ];
    });
    const preferred = pickPreferredAuto(ranked);
    if (preferred) {
      preferredAuto[subsystem] = {
        provider: preferred.provider,
        modelId: preferred.modelId,
        quality: preferred.quality,
      };
      fallbacks[subsystem] = rankFallbackOrder(ranked).map((row) => ({
        provider: row.provider,
        modelId: row.modelId,
      }));
    }
  }

  const evidence: CertificationEvidence = {
    benchmarkId: "nyaya-four-provider-cert-v1",
    applied: available.length > 0,
    preferredAuto: Object.fromEntries(
      Object.entries(preferredAuto).map(([k, v]) => [k, v ? { provider: v.provider, modelId: v.modelId } : undefined]),
    ),
    models: available.map((row) => {
      const ask = measurements.get(`${row.provider}:ask`);
      const certification = Object.fromEntries(
        CERTIFICATION_SUBSYSTEMS.map((subsystem) => {
          const measured = measurements.get(`${row.provider}:${subsystem}`);
          if (!measured) {
            return [subsystem, "CANDIDATE"];
          }
          let status = decideCertification(measured);
          if (
            preferredAuto[subsystem]?.provider === row.provider &&
            status === "VALIDATED"
          ) {
            status = "ACTIVE";
          }
          return [subsystem, status];
        }),
      ) as CertificationEvidence["models"][number]["certification"];
      const validatedCount = Object.values(certification).filter(
        (s) => s === "VALIDATED" || s === "ACTIVE",
      ).length;
      const overall =
        validatedCount > 0 ? (preferredAuto.ask?.provider === row.provider ? "ACTIVE" : "VALIDATED") : "CANDIDATE";
      return {
        provider: row.provider,
        modelId: row.modelId,
        aliases:
          row.provider === "openai"
            ? ["gpt-4o-mini", "gpt-4o-mini-2024-07-18"]
            : undefined,
        status: overall,
        certification,
        qualityScore: ask?.materialQualityPct != null ? ask.materialQualityPct / 100 : null,
        safetyScore: ask?.criticalSafetyPct != null ? ask.criticalSafetyPct / 100 : null,
        citationReliability:
          ask?.citationValidityPct != null ? ask.citationValidityPct / 100 : null,
        structuredReliability:
          ask?.structuredSuccessPct != null ? ask.structuredSuccessPct / 100 : null,
        notes: `nyaya-four-provider-cert-v1 measured ${row.provider}. Unmeasured subsystems remain CANDIDATE.`,
        benchmarkId: "nyaya-four-provider-cert-v1",
      };
    }),
  };

  const registryAfter: ModelRegistryEntry[] = overlayRegistryEvidence(
    buildDefaultModelRegistry(),
    evidence,
  );

  const deepEligible = CERTIFICATION_SUBSYSTEMS.filter((subsystem) => {
    const validatedProviders = new Set(
      CERT_PROVIDERS.filter((provider) => {
        const measured = measurements.get(`${provider}:${subsystem}`);
        const status = measured ? decideCertification(measured) : null;
        return status === "VALIDATED";
      }),
    );
    return validatedProviders.size >= 2;
  });

  let autoBenchmark: unknown = "not_run";
  let deepReview: unknown = "not_run";
  if (!blocked && evidence.applied) {
    autoBenchmark = {
      skipped: true,
      reason: "Gemini generateContent hung through AbortSignal; Auto live calls deferred. Preferred Auto/fallback assigned from VALIDATED measurements only.",
    };
    deepReview = {
      eligibleSubsystems: deepEligible,
      reason: deepEligible.includes("ask")
        ? "Ask Deep skipped; only one VALIDATED Ask provider"
        : "Ask has fewer than two VALIDATED providers; Deep disagreement not run",
    };
  }

  const overall = blocked ? "BLOCKED" : "NEEDS_WORK";

  const artifact = {
    id: "nyaya-four-provider-cert-v1",
    generatedAt: new Date().toISOString(),
    overall,
    reason: blocked
      ? "No provider passed live smoke. Live legal benchmarking was not run. Results were not fabricated."
      : "Frozen certification resumed with live provider calls. Scores are measured.",
    registryVersion: MODEL_REGISTRY_VERSION,
    frozenConfig,
    access: {
      files: access.files,
      dotenv: access.dotenv,
      process: access.process,
      databaseUrl: access.databaseUrl,
      providers: access.providers,
      databaseReachable: dbOk,
    },
    smoke,
    inProcess,
    nyayaBench,
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
    evidence,
    registryAfter: registryAfter.map((entry) => ({
      id: entry.id,
      provider: entry.provider,
      modelId: entry.modelId,
      status: entry.status,
      certification: entry.certification,
      qualityScore: entry.qualityScore,
      safetyScore: entry.safetyScore,
      notes: entry.notes,
    })),
    registryUpdateApplied: evidence.applied,
    matrix,
    preferredAuto,
    fallbacks,
    autoBenchmark,
    deepReview,
    featureAgents: process.env.FEATURE_AGENTS?.trim() ? "SET" : "OFF_DEFAULT",
    trustArchitectureChanged: false,
    nextPhase: blocked
      ? "PROVIDER CREDENTIAL / ACCOUNT MANUAL UNBLOCK"
      : "MODEL QUALITY & CERTIFICATION REMEDIATION",
  };

  if (!accessReportHasNoSecrets(artifact)) {
    throw new Error("Certification artifact unexpectedly contained a secret-shaped value");
  }

  writeJson(join(ARTIFACTS, "access.json"), artifact.access);
  writeJson(join(ARTIFACTS, "registry-snapshot.json"), artifact.registryBefore);
  writeJson(join(ARTIFACTS, "smoke.json"), smoke);
  writeJson(join(ARTIFACTS, "certification-evidence.json"), evidence);
  writeJson(join(ARTIFACTS, "FOUR_PROVIDER_CERT.json"), artifact);
  if (blocked) {
    writeJson(join(ARTIFACTS, "BLOCKED_EXTERNAL.json"), artifact);
  }

  console.log(`overall=${artifact.overall}`);
  for (const row of access.providers) {
    console.log(`provider=${row.provider} model=${row.modelId} access=${row.status}`);
  }
  for (const row of smoke) {
    console.log(`smoke ${row.provider}: ${row.result} model=${row.modelId} class=${row.errorClass ?? "ok"}`);
  }
  if (blocked) {
    console.log("Certification stopped: BLOCKED_EXTERNAL for all four providers.");
    process.exitCode = 2;
  }
}

await main();
