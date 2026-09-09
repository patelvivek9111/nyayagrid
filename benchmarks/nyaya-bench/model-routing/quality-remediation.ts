/**
 * Quality remediation runner for nyaya-four-provider-cert-v1.
 * Isolated live calls. Does not overwrite 6V/6W/C2A baselines.
 * Does not print secrets or prompt bodies.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CERTIFICATION_SUBSYSTEMS,
  MODEL_REGISTRY_VERSION,
  PINNED_MODEL_IDS,
  buildDefaultModelRegistry,
  decideCertification,
  overlayRegistryEvidence,
  pickPreferredAuto,
  rankFallbackOrder,
  accessReportHasNoSecrets,
  CERTIFICATION_EVIDENCE,
  type CertificationEvidence,
  type CertificationSubsystem,
  type DirectProviderId,
  type ModelRegistryEntry,
  type SubsystemMeasurement,
} from "@nyayagrid/ai";
import { runAskContradictionCert } from "@nyayagrid/ai/evals";
import {
  registerCertProcessCleanup,
  runIsolatedProviderCall,
} from "@nyayagrid/ai/cert-transport";
import { loadBenchEnv } from "../runner/load-env";
import { CERT_PROVIDERS, inventoryProviderAccess, accessHasNoSecrets } from "./access";
import { COMPLETED_MEASUREMENTS } from "./completed-run";
import { probeDatabase, runNyayaBenchAuto, runNyayaBenchForProvider } from "./nyaya-bench-cert";
import { STARTING_FAILURE_INVENTORY, GEMINI_ASK_FAIL_IDS } from "./failure-inventory";
import {
  runAutoBenchmark,
  runDeepSubsystemPair,
  runFastVsStandardComparison,
  runMixedAutoBenchmark,
  runSafetyFloorBenchmark,
  OPENAI_ASK_VARIANCE_IDS,
} from "./auto-cert";
import { GRADED_CASES, gradedCaseToPrompt } from "@nyayagrid/ai/evals";

loadBenchEnv();
registerCertProcessCleanup();

const here = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = join(here, "artifacts");
const CHECKPOINT = join(ARTIFACTS, "quality-phase-checkpoint.json");
const INVENTORY_PATH = join(ARTIFACTS, "FAILURE_INVENTORY.json");
const EVIDENCE_TS = join(here, "../../../packages/ai/src/router/certification-evidence.ts");

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function steps(): Set<string> {
  const raw = process.env.CERT_QUALITY_STEPS?.trim();
  if (!raw) {
    if (process.env.CERT_QUALITY_ROUND === "3") {
      return new Set([
        "safety-floor",
        "ask-51",
        "openai-ask-current-term",
        "mixed-auto",
        "mixed-nyaya-bench",
        "freeze",
      ]);
    }
    if (process.env.CERT_QUALITY_ROUND === "2") {
      return new Set([
        "claude-probe",
        "research-r2",
        "memory-r2",
        "openai-ask-variance",
        "fast-standard",
        "auto-r2",
        "gemini-cells",
        "freeze",
      ]);
    }
    return new Set([
      "inventory",
      "criticals",
      "openai-ask-repeat2",
      "claude-probe",
      "claude-retry",
      "deposition",
      "gemini",
      "deep",
      "auto",
      "freeze",
    ]);
  }
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

type Checkpoint = Record<string, unknown>;

function loadCheckpoint(): Checkpoint {
  if (!existsSync(CHECKPOINT)) return {};
  try {
    return JSON.parse(readFileSync(CHECKPOINT, "utf8")) as Checkpoint;
  } catch {
    return {};
  }
}

function saveCheckpoint(value: Checkpoint): void {
  writeJson(CHECKPOINT, { ...value, updatedAt: new Date().toISOString() });
}

function writeEvidenceTs(evidence: CertificationEvidence): void {
  const body = `/**
 * Frozen four-provider certification overlay from nyaya-four-provider-cert-v1.
 * Scores are measured. Unmeasured subsystems remain CANDIDATE.
 * Never put secrets here.
 */
import type { CertificationSubsystem } from "../provider-contract";
import type { ModelLifecycle, SubsystemCertification } from "./registry";

export type CertificationEvidenceModel = {
  provider: string;
  modelId: string;
  aliases?: string[];
  status: ModelLifecycle;
  certification: Partial<SubsystemCertification>;
  qualityScore: number | null;
  safetyScore: number | null;
  citationReliability: number | null;
  structuredReliability: number | null;
  notes: string;
  benchmarkId: string;
};

export type CertificationEvidence = {
  benchmarkId: "nyaya-four-provider-cert-v1";
  applied: boolean;
  preferredAuto: Partial<Record<CertificationSubsystem, { provider: string; modelId: string }>>;
  models: CertificationEvidenceModel[];
};

export const CERTIFICATION_EVIDENCE: CertificationEvidence = ${JSON.stringify(evidence, null, 2)} as CertificationEvidence;
`;
  writeFileSync(EVIDENCE_TS, body.replace(/\r\n/g, "\n"));
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
  const wanted = steps();
  process.stdout.write(`quality steps=${[...wanted].join(",")}\n`);
  const checkpoint = loadCheckpoint();
  const access = inventoryProviderAccess({ repoRoot: join(here, "../../..") });
  if (!accessHasNoSecrets(access) || !accessReportHasNoSecrets(access)) {
    throw new Error("Access inventory unexpectedly contained a secret-shaped value");
  }

  if (wanted.has("inventory")) {
    writeJson(INVENTORY_PATH, {
      generatedAt: new Date().toISOString(),
      benchmarkId: "nyaya-four-provider-cert-v1",
      geminiAskFailIds: GEMINI_ASK_FAIL_IDS,
      rows: STARTING_FAILURE_INVENTORY,
    });
    process.stdout.write(`wrote ${INVENTORY_PATH}\n`);
  }

  if (wanted.has("criticals") && !checkpoint.criticals) {
    const openaiAsk = await runAskContradictionCert({
      provider: "openai",
      onlyAskIds: ["golden-indemnity-missing-amendment"],
      skipContradiction: true,
      repeatFailures: true,
    });
    const claudeAsk = await runAskContradictionCert({
      provider: "anthropic",
      onlyAskIds: ["golden-email-vs-signed-amendment"],
      skipContradiction: true,
      repeatFailures: true,
    });
    const openaiCx = await runAskContradictionCert({
      provider: "openai",
      skipAsk: true,
      onlyContradictionIds: [
        "cx-sequential-amendment-not-contradiction",
        "cx-wrong-actor-not-contradiction",
      ],
      repeatFailures: true,
    });
    const claudeCx = await runAskContradictionCert({
      provider: "anthropic",
      skipAsk: true,
      onlyContradictionIds: ["cx-wrong-actor-not-contradiction"],
      repeatFailures: true,
    });
    checkpoint.criticals = {
      openaiAsk: openaiAsk.ask.tasks,
      claudeAsk: claudeAsk.ask.tasks,
      openaiCx: openaiCx.contradiction.tasks.filter((t) => t.failureClass !== "GRADER"),
      claudeCx: claudeCx.contradiction.tasks.filter((t) => t.failureClass !== "GRADER"),
    };
    saveCheckpoint(checkpoint);
    process.stdout.write("critical repeats recorded\n");
  }

  if (wanted.has("openai-ask-repeat2") && !checkpoint.openaiAskRepeat2) {
    const openaiAsk2 = await runAskContradictionCert({
      provider: "openai",
      onlyAskIds: ["golden-indemnity-missing-amendment"],
      skipContradiction: true,
      repeatFailures: true,
    });
    checkpoint.openaiAskRepeat2 = openaiAsk2.ask.tasks;
    saveCheckpoint(checkpoint);
    process.stdout.write("openai ask critical second repeat recorded\n");
  }

  if (wanted.has("claude-probe") && !checkpoint.claudeProbe) {
    const outcome = await runIsolatedProviderCall({
      provider: "anthropic",
      modelId: PINNED_MODEL_IDS.anthropic,
      taskId: "claude-400-probe-compare",
      messages: [
        {
          role: "system",
          content:
            "Summarize substantive document version differences for a lawyer. Return JSON only: {summary:string}. Use ONLY the detected changes listed.",
        },
        {
          role: "user",
          content:
            "Document A: Lease\nDocument B: Amendment\nDetected changes (authoritative):\n- modified/review Section 4/Section 4: sixty (60) days -> thirty (30) days",
        },
      ],
      temperature: 0,
    });
    checkpoint.claudeProbe = {
      status: outcome.status,
      normalizedError: outcome.normalizedError ?? null,
      circuitState: outcome.circuitState,
      classified:
        outcome.normalizedError?.includes("type=") || outcome.status === "ok"
          ? outcome.normalizedError ?? "ok"
          : outcome.status,
    };
    saveCheckpoint(checkpoint);
    process.stdout.write(
      `claude probe status=${outcome.status} class=${String(checkpoint.claudeProbe && typeof checkpoint.claudeProbe === "object" ? (checkpoint.claudeProbe as { classified?: string }).classified : "")}\n`,
    );
  }

  const dbOk = await probeDatabase(process.env.DATABASE_URL);
  checkpoint.databaseReachable = dbOk;

  const probe = checkpoint.claudeProbe as { status?: string } | undefined;
  if (wanted.has("claude-retry") && dbOk && probe?.status === "ok" && !checkpoint.claudeRetry) {
    process.stdout.write("claude retry compare+timeline\n");
    const bench = await runNyayaBenchForProvider({
      provider: "anthropic",
      modelId: PINNED_MODEL_IDS.anthropic,
      modes: ["compare", "timeline"],
    });
    checkpoint.claudeRetry = bench;
    saveCheckpoint(checkpoint);
  } else if (wanted.has("claude-retry") && probe && probe.status !== "ok" && !checkpoint.claudeRetry) {
    checkpoint.claudeRetry = {
      skipped: true,
      reason: "probe did not return ok; keep DISABLED unless classified as fixed adapter defect",
      probe,
    };
    saveCheckpoint(checkpoint);
  }

  const claudeQuota =
    typeof checkpoint.claudeProbe === "object" &&
    checkpoint.claudeProbe !== null &&
    JSON.stringify(checkpoint.claudeProbe).includes("credit balance is too low");

  if (wanted.has("deposition") && dbOk && !checkpoint.deposition) {
    const deposition: Record<string, unknown> = {};
    for (const provider of CERT_PROVIDERS) {
      if (provider === "anthropic" && claudeQuota) {
        process.stdout.write("deposition skip anthropic PROVIDER_QUOTA\n");
        deposition[provider] = { skipped: "PROVIDER_QUOTA" };
        continue;
      }
      process.stdout.write(`deposition provider=${provider} scenario=SYNTH-V2-006\n`);
      const bench = await runNyayaBenchForProvider({
        provider,
        modelId: PINNED_MODEL_IDS[provider],
        modes: ["deposition"],
      });
      deposition[provider] = bench.deposition ?? bench;
    }
    checkpoint.deposition = deposition;
    saveCheckpoint(checkpoint);
  }

  if (wanted.has("gemini") && dbOk && !checkpoint.geminiBench) {
    process.stdout.write("gemini remaining nyaya-bench isolated\n");
    const bench = await runNyayaBenchForProvider({
      provider: "google",
      modelId: PINNED_MODEL_IDS.google,
      modes: [
        "research",
        "draft",
        "contract",
        "evidence",
        "compare",
        "timeline",
        "graph",
        "memory",
      ],
    });
    checkpoint.geminiBench = bench;
    saveCheckpoint(checkpoint);
  }

  if (wanted.has("research-r2") && dbOk && !checkpoint.researchR2) {
    const research: Record<string, unknown> = {};
    for (const provider of ["openai", "xai"] as DirectProviderId[]) {
      process.stdout.write(`research-r2 provider=${provider}\n`);
      const bench = await runNyayaBenchForProvider({
        provider,
        modelId: PINNED_MODEL_IDS[provider],
        modes: ["research"],
      });
      research[provider] = bench.research ?? bench;
    }
    if (!claudeQuota) {
      process.stdout.write("research-r2 provider=anthropic\n");
      research.anthropic = await runNyayaBenchForProvider({
        provider: "anthropic",
        modelId: PINNED_MODEL_IDS.anthropic,
        modes: ["research"],
      });
    } else {
      research.anthropic = { skipped: "PROVIDER_QUOTA" };
    }
    checkpoint.researchR2 = research;
    saveCheckpoint(checkpoint);
  }

  if (wanted.has("memory-r2") && dbOk && !checkpoint.memoryR2) {
    const memory: Record<string, unknown> = {};
    for (const provider of ["openai", "xai"] as DirectProviderId[]) {
      process.stdout.write(`memory-r2 provider=${provider}\n`);
      const bench = await runNyayaBenchForProvider({
        provider,
        modelId: PINNED_MODEL_IDS[provider],
        modes: ["memory"],
      });
      memory[provider] = bench.memory ?? bench;
    }
    checkpoint.memoryR2 = memory;
    saveCheckpoint(checkpoint);
  }

  if (wanted.has("openai-ask-variance") && !checkpoint.openaiAskVarianceR2) {
    const ids = [
      "golden-indemnity-missing-amendment",
      "golden-named-exhibit-missing",
      "golden-empty-retrieval",
      "golden-invoice-silence-not-proof",
      "golden-false-rent-amount",
      "golden-future-effective-current-term",
      "golden-email-vs-signed-amendment",
    ];
    const repeats = [];
    for (let i = 0; i < 3; i += 1) {
      const run = await runAskContradictionCert({
        provider: "openai",
        onlyAskIds: ids,
        skipContradiction: true,
        repeatFailures: true,
      });
      repeats.push(run.ask.tasks);
    }
    checkpoint.openaiAskVarianceR2 = { repeats };
    saveCheckpoint(checkpoint);
    process.stdout.write("openai ask variance r2 recorded\n");
  }

  if (wanted.has("gemini-cells") && dbOk && !checkpoint.geminiCellsR2) {
    const modes = [
      "research",
      "draft",
      "contract",
      "deposition",
      "evidence",
      "compare",
      "timeline",
      "graph",
      "memory",
    ] as const;
    const cells: Record<string, unknown> = {};
    let circuitOpen = false;
    for (const mode of modes) {
      if (circuitOpen) {
        cells[mode] = { skipped: "CIRCUIT_OPEN" };
        continue;
      }
      process.stdout.write(`gemini-cells mode=${mode}\n`);
      try {
        const bench = await runNyayaBenchForProvider({
          provider: "google",
          modelId: PINNED_MODEL_IDS.google,
          modes: [mode],
        });
        cells[mode] = bench[mode === "deposition" ? "deposition" : mode] ?? bench;
        const blob = JSON.stringify(cells[mode] ?? {});
        if (/CIRCUIT_OPEN|HARD_TIMEOUT|503/.test(blob)) {
          circuitOpen = true;
          process.stdout.write(`gemini circuit-open after mode=${mode}\n`);
        }
      } catch (error) {
        circuitOpen = true;
        cells[mode] = {
          skipped: "CIRCUIT_OPEN",
          error: error instanceof Error ? error.message.slice(0, 160) : "error",
        };
      }
    }
    checkpoint.geminiCellsR2 = { circuitOpen, cells };
    saveCheckpoint(checkpoint);
  }

  if (wanted.has("deep") && !checkpoint.deepReview) {
    const commencement = GRADED_CASES.find((c) => c.id === "golden-lease-commencement");
    const prompts = commencement ? gradedCaseToPrompt(commencement) : null;
    const messages = prompts
      ? [
          { role: "system" as const, content: prompts.systemPrompt },
          { role: "user" as const, content: prompts.userPrompt },
        ]
      : [
          { role: "system" as const, content: "Return JSON only." },
          { role: "user" as const, content: '{"summary":"ping"}' },
        ];
    const evidenceIds = commencement?.retrieved.map((p) => p.chunkId) ?? [];
    const pairs: Array<{
      subsystem: string;
      primary: DirectProviderId;
      verifier: DirectProviderId;
    }> = [
      { subsystem: "contract", primary: "xai", verifier: "openai" },
      { subsystem: "evidence", primary: "openai", verifier: "xai" },
      { subsystem: "compare", primary: "openai", verifier: "xai" },
      { subsystem: "contradiction", primary: "xai", verifier: "google" },
      { subsystem: "timeline", primary: "openai", verifier: "xai" },
      { subsystem: "graph", primary: "openai", verifier: "xai" },
    ];
    const deep = [];
    for (const pair of pairs) {
      deep.push(
        await runDeepSubsystemPair({
          ...pair,
          evidenceChunkIds: evidenceIds,
          messages,
        }),
      );
    }
    checkpoint.deepReview = {
      ask: "skipped_single_validated_provider",
      results: deep,
    };
    saveCheckpoint(checkpoint);
  }

  const measurements = new Map<string, SubsystemMeasurement>();
  for (const row of COMPLETED_MEASUREMENTS) {
    measurements.set(`${row.provider}:${row.subsystem}`, row);
  }
  const applyBench = (provider: string, payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    for (const [subsystem, value] of Object.entries(
      payload as Record<string, { measurement?: SubsystemMeasurement }>,
    )) {
      if (value?.measurement) measurements.set(`${provider}:${subsystem}`, value.measurement);
    }
  };
  applyBench("anthropic", checkpoint.claudeRetry);
  const deposition = checkpoint.deposition as
    | Record<string, { measurement?: SubsystemMeasurement; skipped?: string }>
    | undefined;
  if (deposition) {
    for (const [provider, row] of Object.entries(deposition)) {
      if (!row.measurement) continue;
      const measured = { ...row.measurement };
      if (provider === "google") measured.incomplete = true;
      measurements.set(`${provider}:deposition`, measured);
    }
  }
  const geminiBench = checkpoint.geminiBench as
    | Record<string, { measurement?: SubsystemMeasurement }>
    | undefined;
  if (geminiBench) {
    for (const [subsystem, value] of Object.entries(geminiBench)) {
      if (!value.measurement) continue;
      measurements.set(`google:${subsystem}`, {
        ...value.measurement,
        incomplete: true,
        operationallyUnusable: false,
      });
    }
  }
  const researchR2 = checkpoint.researchR2 as Record<string, unknown> | undefined;
  if (researchR2) {
    for (const [provider, payload] of Object.entries(researchR2)) {
      if (payload && typeof payload === "object" && "measurement" in payload) {
        measurements.set(
          `${provider}:research`,
          (payload as { measurement: SubsystemMeasurement }).measurement,
        );
      } else {
        applyBench(provider, payload);
      }
    }
  }
  const memoryR2 = checkpoint.memoryR2 as Record<string, unknown> | undefined;
  if (memoryR2) {
    for (const [provider, payload] of Object.entries(memoryR2)) {
      if (payload && typeof payload === "object" && "measurement" in payload) {
        measurements.set(
          `${provider}:memory`,
          (payload as { measurement: SubsystemMeasurement }).measurement,
        );
      } else {
        applyBench(provider, payload);
      }
    }
  }
  const geminiCells = checkpoint.geminiCellsR2 as
    | { circuitOpen?: boolean; cells?: Record<string, { measurement?: SubsystemMeasurement }> }
    | undefined;
  if (geminiCells?.cells) {
    for (const [subsystem, value] of Object.entries(geminiCells.cells)) {
      if (!value?.measurement) continue;
      const infraOrPartial = subsystem !== "research";
      measurements.set(`google:${subsystem}`, {
        ...value.measurement,
        incomplete: infraOrPartial || Boolean(geminiCells.circuitOpen),
      });
    }
  }

  if (wanted.has("auto") && !checkpoint.autoBenchmark) {
    const preferredAuto: Partial<
      Record<CertificationSubsystem, { provider: string; modelId: string; quality: number }>
    > = {};
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
      }
    }
    const evidencePreview: CertificationEvidence = {
      benchmarkId: "nyaya-four-provider-cert-v1",
      applied: true,
      preferredAuto: Object.fromEntries(
        Object.entries(preferredAuto).map(([k, v]) => [
          k,
          v ? { provider: v.provider, modelId: v.modelId } : undefined,
        ]),
      ),
      models: [],
    };
    const registry = overlayRegistryEvidence(buildDefaultModelRegistry(), {
      ...evidencePreview,
      models: CERT_PROVIDERS.map((provider) => {
        const ask = measurements.get(`${provider}:ask`);
        const certification = Object.fromEntries(
          CERTIFICATION_SUBSYSTEMS.map((subsystem) => {
            const measured = measurements.get(`${provider}:${subsystem}`);
            let status = measured ? decideCertification(measured) : "CANDIDATE";
            if (preferredAuto[subsystem]?.provider === provider && status === "VALIDATED") {
              status = "ACTIVE";
            }
            return [subsystem, status];
          }),
        );
        return {
          provider,
          modelId:
            provider === "openai"
              ? PINNED_MODEL_IDS.openai
              : provider === "anthropic"
                ? PINNED_MODEL_IDS.anthropic
                : provider === "xai"
                  ? PINNED_MODEL_IDS.xai
                  : PINNED_MODEL_IDS.google,
          status: "VALIDATED" as const,
          certification,
          qualityScore: ask?.materialQualityPct != null ? ask.materialQualityPct / 100 : null,
          safetyScore: ask?.criticalSafetyPct != null ? ask.criticalSafetyPct / 100 : null,
          citationReliability: null,
          structuredReliability: null,
          notes: "preview",
          benchmarkId: "nyaya-four-provider-cert-v1" as const,
        };
      }),
    });
    checkpoint.autoBenchmark = await runAutoBenchmark({
      registry,
      available: CERT_PROVIDERS,
      envProvider: "openai",
    });
    saveCheckpoint(checkpoint);
  }

  if (
    (wanted.has("auto-r2") && !checkpoint.autoBenchmarkR2) ||
    (wanted.has("fast-standard") && !checkpoint.fastStandardR2)
  ) {
    const preferredAuto: Partial<
      Record<CertificationSubsystem, { provider: string; modelId: string; quality: number }>
    > = {};
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
      }
    }
    const evidencePreview: CertificationEvidence = {
      benchmarkId: "nyaya-four-provider-cert-v1",
      applied: true,
      preferredAuto: Object.fromEntries(
        Object.entries(preferredAuto).map(([k, v]) => [
          k,
          v ? { provider: v.provider, modelId: v.modelId } : undefined,
        ]),
      ),
      models: [],
    };
    const registry = overlayRegistryEvidence(buildDefaultModelRegistry(), {
      ...evidencePreview,
      models: CERT_PROVIDERS.map((provider) => {
        const ask = measurements.get(`${provider}:ask`);
        const certification = Object.fromEntries(
          CERTIFICATION_SUBSYSTEMS.map((subsystem) => {
            const measured = measurements.get(`${provider}:${subsystem}`);
            let status = measured ? decideCertification(measured) : "CANDIDATE";
            if (preferredAuto[subsystem]?.provider === provider && status === "VALIDATED") {
              status = "ACTIVE";
            }
            return [subsystem, status];
          }),
        );
        return {
          provider,
          modelId:
            provider === "openai"
              ? PINNED_MODEL_IDS.openai
              : provider === "anthropic"
                ? PINNED_MODEL_IDS.anthropic
                : provider === "xai"
                  ? PINNED_MODEL_IDS.xai
                  : PINNED_MODEL_IDS.google,
          status: "VALIDATED" as const,
          certification,
          qualityScore: ask?.materialQualityPct != null ? ask.materialQualityPct / 100 : null,
          safetyScore: ask?.criticalSafetyPct != null ? ask.criticalSafetyPct / 100 : null,
          citationReliability: null,
          structuredReliability: null,
          notes: "preview",
          benchmarkId: "nyaya-four-provider-cert-v1" as const,
        };
      }),
    });
    if (wanted.has("fast-standard") && !checkpoint.fastStandardR2) {
      process.stdout.write("fast vs standard cluster\n");
      checkpoint.fastStandardR2 = await runFastVsStandardComparison({
        registry,
        available: CERT_PROVIDERS,
        envProvider: "openai",
      });
      saveCheckpoint(checkpoint);
    }
    if (wanted.has("auto-r2") && !checkpoint.autoBenchmarkR2) {
      process.stdout.write("auto-r2 full graded cases\n");
      checkpoint.autoBenchmarkR2 = await runAutoBenchmark({
        registry,
        available: CERT_PROVIDERS,
        envProvider: "openai",
      });
      saveCheckpoint(checkpoint);
    }
  }

  const r3Registry = overlayRegistryEvidence(
    buildDefaultModelRegistry(),
    CERTIFICATION_EVIDENCE,
  );
  if (wanted.has("safety-floor") && !checkpoint.safetyFloorR3) {
    process.stdout.write("r3 safety floor\n");
    checkpoint.safetyFloorR3 = await runSafetyFloorBenchmark({
      registry: r3Registry,
      available: CERT_PROVIDERS,
      envProvider: "openai",
    });
    saveCheckpoint(checkpoint);
  }
  if (wanted.has("ask-51") && !checkpoint.autoAskR3) {
    process.stdout.write("r3 auto ask 51\n");
    checkpoint.autoAskR3 = await runAutoBenchmark({
      registry: r3Registry,
      available: CERT_PROVIDERS,
      envProvider: "openai",
    });
    saveCheckpoint(checkpoint);
  }
  if (wanted.has("openai-ask-current-term") && !checkpoint.openaiAskVarianceR3) {
    process.stdout.write("r3 openai ask targeted variance\n");
    const run = await runAskContradictionCert({
      provider: "openai",
      onlyAskIds: [...OPENAI_ASK_VARIANCE_IDS],
      skipContradiction: true,
      repeatFailures: false,
    });
    checkpoint.openaiAskVarianceR3 = run.ask;
    saveCheckpoint(checkpoint);
  }
  if (wanted.has("mixed-auto") && !checkpoint.mixedAutoR3) {
    process.stdout.write("r3 mixed auto in-process\n");
    checkpoint.mixedAutoR3 = await runMixedAutoBenchmark({
      registry: r3Registry,
      available: CERT_PROVIDERS,
      envProvider: "openai",
      includeAsk: false,
    });
    saveCheckpoint(checkpoint);
  }
  if (wanted.has("mixed-nyaya-bench") && dbOk && !checkpoint.mixedNyayaBenchR3) {
    process.stdout.write("r3 mixed nyaya-bench auto\n");
    checkpoint.mixedNyayaBenchR3 = await runNyayaBenchAuto({
      modes: [
        "research",
        "draft",
        "contract",
        "deposition",
        "evidence",
        "compare",
        "timeline",
        "graph",
        "memory",
      ],
    });
    saveCheckpoint(checkpoint);
  } else if (wanted.has("mixed-nyaya-bench") && !dbOk && !checkpoint.mixedNyayaBenchR3) {
    checkpoint.mixedNyayaBenchR3 = { skipped: true, reason: "database unreachable" };
    saveCheckpoint(checkpoint);
  }

  if (!wanted.has("freeze")) {
    process.stdout.write("quality phase checkpointed; freeze skipped\n");
    return;
  }

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
    applied: true,
    preferredAuto: Object.fromEntries(
      Object.entries(preferredAuto).map(([k, v]) => [
        k,
        v ? { provider: v.provider, modelId: v.modelId } : undefined,
      ]),
    ),
    models: CERT_PROVIDERS.map((provider) => {
      const ask = measurements.get(`${provider}:ask`);
      const modelId =
        provider === "openai"
          ? PINNED_MODEL_IDS.openai
          : provider === "anthropic"
            ? PINNED_MODEL_IDS.anthropic
            : provider === "xai"
              ? PINNED_MODEL_IDS.xai
              : PINNED_MODEL_IDS.google;
      const certification = Object.fromEntries(
        CERTIFICATION_SUBSYSTEMS.map((subsystem) => {
          const measured = measurements.get(`${provider}:${subsystem}`);
          if (!measured) return [subsystem, "CANDIDATE"];
          let status = decideCertification(measured);
          if (preferredAuto[subsystem]?.provider === provider && status === "VALIDATED") {
            status = "ACTIVE";
          }
          return [subsystem, status];
        }),
      ) as CertificationEvidence["models"][number]["certification"];
      const validatedCount = Object.values(certification).filter(
        (s) => s === "VALIDATED" || s === "ACTIVE",
      ).length;
      const overall =
        validatedCount > 0
          ? preferredAuto.ask?.provider === provider
            ? "ACTIVE"
            : "VALIDATED"
          : "CANDIDATE";
      return {
        provider,
        modelId,
        aliases: provider === "openai" ? ["gpt-4o-mini", "gpt-4o-mini-2024-07-18"] : undefined,
        status: overall as ModelRegistryEntry["status"],
        certification,
        qualityScore: ask?.materialQualityPct != null ? ask.materialQualityPct / 100 : null,
        safetyScore: ask?.criticalSafetyPct != null ? ask.criticalSafetyPct / 100 : null,
        citationReliability: null,
        structuredReliability: null,
        notes: `nyaya-four-provider-cert-v1 quality remediation measured ${provider}.`,
        benchmarkId: "nyaya-four-provider-cert-v1" as const,
      };
    }),
  };

  writeEvidenceTs(evidence);
  writeJson(join(ARTIFACTS, "certification-evidence.json"), evidence);

  const matrix = CERTIFICATION_SUBSYSTEMS.map((subsystem) => {
    const cells: Record<string, ReturnType<typeof cellPayload> & { access: string }> = {};
    for (const provider of CERT_PROVIDERS) {
      const measured = measurements.get(`${provider}:${subsystem}`);
      if (measured) cells[provider] = { ...cellPayload(measured), access: "MEASURED" };
    }
    return { subsystem, ...cells };
  });

  const registryBefore = buildDefaultModelRegistry();
  const registryAfter = overlayRegistryEvidence(registryBefore, evidence);
  const previous = existsSync(join(ARTIFACTS, "FOUR_PROVIDER_CERT.json"))
    ? (JSON.parse(readFileSync(join(ARTIFACTS, "FOUR_PROVIDER_CERT.json"), "utf8")) as Record<
        string,
        unknown
      >)
    : {};

  const artifact = {
    id: "nyaya-four-provider-cert-v1",
    generatedAt: new Date().toISOString(),
    overall: "NEEDS_WORK",
    reason: "Quality remediation measurements applied. Historical 6V/6W/C2A baselines unchanged.",
    registryVersion: MODEL_REGISTRY_VERSION,
    previousGeneratedAt: previous.generatedAt ?? null,
    qualityPhase: checkpoint,
    access: {
      files: access.files,
      dotenv: access.dotenv,
      process: access.process,
      databaseUrl: access.databaseUrl,
      providers: access.providers,
      databaseReachable: dbOk,
    },
    matrix,
    preferredAuto,
    fallbacks,
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
    featureAgents: process.env.FEATURE_AGENTS?.trim() ? "SET" : "OFF_DEFAULT",
    trustArchitectureChanged: false,
    nextPhase: "MODEL QUALITY REMEDIATION — TARGETED ROUND 2",
  };

  if (!accessReportHasNoSecrets(artifact)) {
    throw new Error("Certification artifact unexpectedly contained a secret-shaped value");
  }
  writeJson(join(ARTIFACTS, "FOUR_PROVIDER_CERT.json"), artifact);
  process.stdout.write(`overall=${artifact.overall}\n`);
}

await main();
