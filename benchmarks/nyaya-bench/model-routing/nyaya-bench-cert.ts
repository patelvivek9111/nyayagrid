/**
 * Run nyaya-bench v2 overlay modes with a forced direct provider.
 * Does not write historical 6V/6W/C2A baselines.
 */
import { closeDb, createDb } from "@nyayagrid/database";
import {
  decideCertification,
  type CertificationSubsystem,
  type DirectProviderId,
  type SubsystemMeasurement,
} from "@nyayagrid/ai";
import { runBenchmark, type BenchCliOptions } from "../runner/run";
import type { ExecutionMode } from "../runner/routing";
import { scenarioIdForSubsystem } from "./scenario";

export { scenarioIdForSubsystem };

export const NYAYA_BENCH_MODE_MAP: Array<{
  subsystem: CertificationSubsystem;
  mode: ExecutionMode;
}> = [
  { subsystem: "research", mode: "research" },
  { subsystem: "draft", mode: "draft" },
  { subsystem: "contract", mode: "contract" },
  { subsystem: "deposition", mode: "deposition" },
  { subsystem: "evidence", mode: "evidence" },
  { subsystem: "compare", mode: "compare" },
  { subsystem: "timeline", mode: "timeline" },
  { subsystem: "graph", mode: "graph" },
  { subsystem: "memory", mode: "memory" },
];

export async function probeDatabase(databaseUrl: string | undefined): Promise<boolean> {
  if (!databaseUrl?.trim()) return false;
  const db = createDb(databaseUrl);
  try {
    const client = (db as { $client?: { unsafe?: (q: string) => Promise<unknown> } }).$client;
    if (!client?.unsafe) return false;
    await Promise.race([
      client.unsafe("select 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("db probe timeout")), 5000)),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    await closeDb(db);
  }
}

function measurementFromTally(params: {
  subsystem: CertificationSubsystem;
  provider: DirectProviderId;
  modelId: string;
  tally: {
    pass: number;
    needs_work: number;
    fail: number;
    criticalFails: number;
    infrastructure?: number;
  };
}): SubsystemMeasurement {
  // criticalFails is a subset of fail; do not add it again.
  const qualityEligible = params.tally.pass + params.tally.needs_work + params.tally.fail;
  const incomplete = qualityEligible === 0;
  return {
    subsystem: params.subsystem,
    provider: params.provider,
    modelId: params.modelId,
    tasksAttempted: qualityEligible,
    minTasksForCertification: 1,
    pass: params.tally.pass,
    needsWork: params.tally.needs_work,
    fail: params.tally.fail,
    critical: params.tally.criticalFails,
    materialQualityPct: qualityEligible > 0 ? (params.tally.pass / qualityEligible) * 100 : null,
    criticalSafetyPct:
      qualityEligible > 0
        ? ((qualityEligible - params.tally.criticalFails) / qualityEligible) * 100
        : null,
    citationValidityPct: null,
    abstentionCorrectnessPct: null,
    structuredSuccessPct: null,
    latencyMedianMs: null,
    latencyP95Ms: null,
    estimatedCostKnown: false,
    hardTrustViolation: false,
    operationallyUnusable: false,
    incomplete,
  };
}

export async function runNyayaBenchAuto(params: {
  modes?: ExecutionMode[];
}): Promise<Record<string, { measurement: SubsystemMeasurement; status: string; runId: string | null }>> {
  const previousForce = process.env.NYAYA_CERT_FORCE_PROVIDER;
  const previousModel = process.env.NYAYA_CERT_MODEL_ID;
  const previousAi = process.env.AI_PROVIDER;
  const previousEmbed = process.env.EMBEDDING_PROVIDER;
  delete process.env.NYAYA_CERT_FORCE_PROVIDER;
  delete process.env.NYAYA_CERT_MODEL_ID;
  // Preference only. Do not force a provider — NyayaRouter Auto must select VALIDATED routes.
  if (!previousAi || previousAi === "mock") {
    process.env.AI_PROVIDER = "openai";
  }
  if (!previousEmbed) {
    process.env.EMBEDDING_PROVIDER = "mock";
  }
  console.log(
    `nyaya-bench auto router envProvider=${process.env.AI_PROVIDER} force=${process.env.NYAYA_CERT_FORCE_PROVIDER ?? "none"}`,
  );
  const out: Record<string, { measurement: SubsystemMeasurement; status: string; runId: string | null }> =
    {};
  const rows = params.modes
    ? NYAYA_BENCH_MODE_MAP.filter((row) => params.modes?.includes(row.mode))
    : NYAYA_BENCH_MODE_MAP;
  try {
    for (const row of rows) {
      const options: BenchCliOptions = {
        dataset: "v2",
        scenarioId: scenarioIdForSubsystem(row.subsystem, "SYNTH-V2-001"),
        executionMode: row.mode,
        listOnly: false,
        extractIntelligence:
          row.mode === "timeline" || row.mode === "graph" || row.mode === "memory",
      };
      try {
        const result = await runBenchmark(options);
        const tally = (result.summary as { counts?: Record<string, number> } | null)?.counts ?? {
          pass: 0,
          needs_work: 0,
          fail: 0,
          criticalFails: 0,
        };
        const measurement = measurementFromTally({
          subsystem: row.subsystem,
          provider: "openai",
          modelId: "auto",
          tally: {
            pass: Number(tally.pass ?? 0),
            needs_work: Number(tally.needs_work ?? 0),
            fail: Number(tally.fail ?? 0),
            criticalFails: Number(tally.criticalFails ?? 0),
            infrastructure: Number(tally.infrastructure ?? 0),
          },
        });
        out[row.subsystem] = {
          measurement,
          status: decideCertification(measurement),
          runId: result.runId,
        };
        console.log(
          `nyaya-bench auto ${row.subsystem}: pass=${measurement.pass} fail=${measurement.fail} critical=${measurement.critical} n=${measurement.tasksAttempted}`,
        );
      } catch (error) {
        const measurement = measurementFromTally({
          subsystem: row.subsystem,
          provider: "openai",
          modelId: "auto",
          tally: { pass: 0, needs_work: 0, fail: 0, criticalFails: 0, infrastructure: 1 },
        });
        measurement.incomplete = true;
        out[row.subsystem] = {
          measurement,
          status: decideCertification(measurement),
          runId: null,
        };
        console.log(
          `nyaya-bench auto ${row.subsystem}: INFRA ${error instanceof Error ? error.message.slice(0, 160) : "error"}`,
        );
      }
    }
  } finally {
    if (previousForce === undefined) delete process.env.NYAYA_CERT_FORCE_PROVIDER;
    else process.env.NYAYA_CERT_FORCE_PROVIDER = previousForce;
    if (previousModel === undefined) delete process.env.NYAYA_CERT_MODEL_ID;
    else process.env.NYAYA_CERT_MODEL_ID = previousModel;
    if (previousAi === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousAi;
    if (previousEmbed === undefined) delete process.env.EMBEDDING_PROVIDER;
    else process.env.EMBEDDING_PROVIDER = previousEmbed;
  }
  return out;
}

export async function runNyayaBenchForProvider(params: {
  provider: DirectProviderId;
  modelId: string;
  scenarioId?: string;
  modes?: ExecutionMode[];
}): Promise<Record<string, { measurement: SubsystemMeasurement; status: string; runId: string | null }>> {
  const previousForce = process.env.NYAYA_CERT_FORCE_PROVIDER;
  const previousModel = process.env.NYAYA_CERT_MODEL_ID;
  process.env.NYAYA_CERT_FORCE_PROVIDER = params.provider;
  process.env.NYAYA_CERT_MODEL_ID = params.modelId;
  const out: Record<string, { measurement: SubsystemMeasurement; status: string; runId: string | null }> =
    {};
  const rows = params.modes
    ? NYAYA_BENCH_MODE_MAP.filter((row) => params.modes?.includes(row.mode))
    : NYAYA_BENCH_MODE_MAP;
  try {
    for (const row of rows) {
      const options: BenchCliOptions = {
        dataset: "v2",
        scenarioId: scenarioIdForSubsystem(row.subsystem, params.scenarioId ?? "SYNTH-V2-001"),
        executionMode: row.mode,
        listOnly: false,
        extractIntelligence:
          row.mode === "timeline" || row.mode === "graph" || row.mode === "memory",
      };
      try {
        const result = await runBenchmark(options);
        const tally = (result.summary as { counts?: Record<string, number> } | null)?.counts ?? {
          pass: 0,
          needs_work: 0,
          fail: 0,
          criticalFails: 0,
        };
        const measurement = measurementFromTally({
          subsystem: row.subsystem,
          provider: params.provider,
          modelId: params.modelId,
          tally: {
            pass: Number(tally.pass ?? 0),
            needs_work: Number(tally.needs_work ?? 0),
            fail: Number(tally.fail ?? 0),
            criticalFails: Number(tally.criticalFails ?? 0),
            infrastructure: Number(tally.infrastructure ?? 0),
          },
        });
        out[row.subsystem] = {
          measurement,
          status: decideCertification(measurement),
          runId: result.runId,
        };
      } catch (error) {
        const measurement = measurementFromTally({
          subsystem: row.subsystem,
          provider: params.provider,
          modelId: params.modelId,
          tally: { pass: 0, needs_work: 0, fail: 0, criticalFails: 0, infrastructure: 1 },
        });
        measurement.incomplete = true;
        out[row.subsystem] = {
          measurement,
          status: decideCertification(measurement),
          runId: null,
        };
        console.log(
          `nyaya-bench ${params.provider} ${row.subsystem}: INFRA ${error instanceof Error ? error.message.slice(0, 160) : "error"}`,
        );
      }
    }
  } finally {
    if (previousForce === undefined) delete process.env.NYAYA_CERT_FORCE_PROVIDER;
    else process.env.NYAYA_CERT_FORCE_PROVIDER = previousForce;
    if (previousModel === undefined) delete process.env.NYAYA_CERT_MODEL_ID;
    else process.env.NYAYA_CERT_MODEL_ID = previousModel;
  }
  return out;
}
