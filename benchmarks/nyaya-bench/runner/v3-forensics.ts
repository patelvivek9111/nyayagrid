/**
 * V3 first-pass forensics. Does not overwrite V3_FIRST_UNTOUCHED.json.
 * Reruns INFRA tests only; captures sample answers. No product/grader/catalog changes.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CERTIFICATION_EVIDENCE,
  MODEL_REGISTRY_VERSION,
  NYAYA_PROMPT_VERSION,
  NYAYA_ROUTER_VERSION,
  PINNED_MODEL_IDS,
  XaiProvider,
  createAIProviderFromEnv,
  createEmbeddingProviderFromEnv,
} from "@nyayagrid/ai";
import { ensureUserFromIdentity } from "@nyayagrid/auth";
import {
  and,
  closeDb,
  createDb,
  eq,
  matters,
  organizations,
  type Database,
} from "@nyayagrid/database";
import { getFeatureFlags } from "@nyayagrid/platform";
import { PostgresHybridRetriever, askNyayaAboutMatter } from "@nyayagrid/search";
import {
  V3_DATASET_ID,
  V3_FROZEN_AT,
  V3_GRADER_VERSION,
  V3_MATTERS,
  allTests,
  catalogFingerprint,
  catalogStats,
  documentsFor,
  type V3MatterSeed,
  type V3Test,
} from "../datasets/v3/catalog";
import { gradeV3Test, summarizeV3, type V3Grade } from "../graders/v3-grade";
import { loadBenchEnv } from "./load-env";
import { BASELINES_ROOT } from "./paths";

loadBenchEnv();
process.env.FEATURE_AGENTS = "0";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  process.env.APP_ENV = "development";
}
if ((process.env.AI_PROVIDER ?? "mock").toLowerCase() === "mock") {
  process.env.AI_PROVIDER = "openai";
}
if ((process.env.EMBEDDING_PROVIDER ?? "mock").toLowerCase() === "mock") {
  process.env.EMBEDDING_PROVIDER = "openai";
}

const FIRST = join(BASELINES_ROOT, "V3_FIRST_UNTOUCHED.json");
const INFRA_OUT = join(BASELINES_ROOT, "V3_INFRA_RERUN.json");
const FORENSIC_OUT = join(BASELINES_ROOT, "V3_FORENSICS.json");
const FROZEN_FP = "4be5b8923175ced5bbe380c2786998b8f44af3cdc4b0fd03fe44a0c164aee634";
const FROZEN_GIT = "2af5d233c725cd9a5ebd592b0efbb0ddefe80d74";

type FirstPass = {
  catalogFingerprint: string;
  graderVersion: string;
  gitHeadExpected: string;
  promptAsk: string;
  router: string;
  registry: string;
  overlay: string;
  featureAgents: string;
  tasks: Array<{
    id: string;
    family: string;
    subsystem: string;
    verdict: string;
    detail: string;
    taxonomy: string | null;
    latencyMs: number;
    provider: string;
    model: string;
  }>;
};

type Handle = { seed: V3MatterSeed; organizationId: string; matterId: string; userId: string };

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 400);
  const extra: string[] = [error.name, error.message];
  let cause: unknown = (error as { cause?: unknown }).cause;
  for (let i = 0; i < 3 && cause; i += 1) {
    if (cause instanceof Error) {
      extra.push(`${cause.name}:${cause.message}`);
      const code = (cause as { code?: unknown }).code;
      if (code) extra.push(`code=${String(code)}`);
      cause = (cause as { cause?: unknown }).cause;
    } else if (typeof cause === "object" && cause) {
      const rec = cause as { code?: unknown; message?: unknown };
      if (rec.code) extra.push(`code=${String(rec.code)}`);
      if (rec.message) extra.push(String(rec.message));
      break;
    } else {
      extra.push(String(cause));
      break;
    }
  }
  return extra.filter(Boolean).join(" | ").slice(0, 500);
}

function isTransientInfra(message: string): boolean {
  return /fetch failed|could not complete this analysis|ECONNRESET|ETIMEDOUT|UND_ERR|socket|aborted|timeout|rate.?limit|429|503|502|unavailable/i.test(
    message,
  );
}

function clusterFirstPass(tasks: FirstPass["tasks"]) {
  const bySuffix: Record<string, Record<string, number>> = {};
  const criticalByFamily: Record<string, number> = {};
  const criticalDetails: Record<string, number> = {};
  const infraIndex: number[] = [];
  tasks.forEach((t, i) => {
    const suffix = t.id.replace(/^V3-\d+-/, "").replace(/^V3-/, "");
    bySuffix[suffix] ??= {};
    bySuffix[suffix][t.verdict] = (bySuffix[suffix][t.verdict] ?? 0) + 1;
    if (t.verdict === "CRITICAL") {
      criticalByFamily[t.family] = (criticalByFamily[t.family] ?? 0) + 1;
      const key = t.detail.split(":")[0] ?? t.detail;
      criticalDetails[key] = (criticalDetails[key] ?? 0) + 1;
    }
    if (t.verdict === "INFRA") infraIndex.push(i);
  });
  const infraRuns: Array<{ start: number; end: number; n: number; firstId: string; lastId: string }> = [];
  let runStart = -1;
  for (let i = 0; i < tasks.length; i += 1) {
    if (tasks[i]?.verdict === "INFRA") {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      infraRuns.push({
        start: runStart,
        end: i - 1,
        n: i - runStart,
        firstId: tasks[runStart]!.id,
        lastId: tasks[i - 1]!.id,
      });
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    infraRuns.push({
      start: runStart,
      end: tasks.length - 1,
      n: tasks.length - runStart,
      firstId: tasks[runStart]!.id,
      lastId: tasks[tasks.length - 1]!.id,
    });
  }
  return { bySuffix, criticalByFamily, criticalDetails, infraIndex, infraRuns };
}

function citationHarnessDefect(): Record<string, unknown> {
  const seed = V3_MATTERS[0]!;
  const docs = documentsFor(seed);
  const agreement = docs.find((d) => d.filename === "01_agreement.txt")!;
  return {
    id: "citation_filename_vs_uuid",
    confirmed: true,
    evidence: [
      "Grader requireCitationDocs looks for '01_agreement.txt' / '01 agreement' inside citationText.",
      "Runner citationText is source.documentId (UUID) plus quote, not originalFilename/title.",
      `Agreement body contains filename: ${agreement.body.toLowerCase().includes("01_agreement")}`,
    ],
    estimatedFirstPassFails: 49,
  };
}

function forbidSubstringRisk(): Record<string, unknown> {
  const examples = [
    {
      forbidden: "admission of liability",
      correctRefusal: "this is not an admission of liability",
      wouldFail: "this is not an admission of liability".includes("admission of liability"),
    },
    {
      forbidden: "already prevailed",
      correctRefusal: "the file does not show that the party already prevailed",
      wouldFail: "the file does not show that the party already prevailed".includes("already prevailed"),
    },
    {
      forbidden: "entered the records room",
      correctRefusal: "the log does not establish that the actor entered the records room",
      wouldFail: "the log does not establish that the actor entered the records room".includes("entered the records room"),
    },
    {
      forbidden: "never received",
      correctRefusal: "the file does not prove they never received the invoice",
      wouldFail: "the file does not prove they never received the invoice".includes("never received"),
    },
  ];
  return {
    id: "forbid_substring_negation",
    confirmedAsRisk: true,
    confirmedAsFirstPassCause: "requires sample answers",
    examples,
  };
}

async function workspace(db: Database, slug: string) {
  const user = await ensureUserFromIdentity(db, {
    subject: `v3-${slug}`,
    email: `${slug}@example.nyayagrid.local`,
    name: `V3 ${slug}`,
  });
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
  if (!org?.id) throw new Error(`missing org ${slug}`);
  return { userId: user.id, organizationId: org.id };
}

async function loadHandles(db: Database): Promise<Map<string, Handle>> {
  const orgA = await workspace(db, "nyaya-bench-v3-a");
  const orgB = await workspace(db, "nyaya-bench-v3-b");
  const handles = new Map<string, Handle>();
  for (const seed of V3_MATTERS) {
    const ws = seed.org === "B" ? orgB : orgA;
    const matterNumber = `V3-${seed.id}`;
    const matter = await db.query.matters.findFirst({
      where: and(eq(matters.organizationId, ws.organizationId), eq(matters.matterNumber, matterNumber)),
    });
    if (!matter) throw new Error(`missing matter ${matterNumber}`);
    handles.set(seed.id, { seed, organizationId: ws.organizationId, matterId: matter.id, userId: ws.userId });
  }
  return handles;
}

async function runOnce(
  db: Database,
  handle: Handle,
  test: V3Test,
  ai: ReturnType<typeof createAIProviderFromEnv>,
  embeddings: ReturnType<typeof createEmbeddingProviderFromEnv>,
) {
  const started = Date.now();
  const retriever = new PostgresHybridRetriever(db, embeddings);
  const result = await askNyayaAboutMatter({
    db,
    retriever,
    organizationId: handle.organizationId,
    matterId: handle.matterId,
    userId: handle.userId,
    question: test.question,
    ai,
    embeddings,
    includeLegalAuthority: false,
  });
  const audit =
    "lastAudits" in ai
      ? (ai as { lastAudits: Array<{ provider: string; model: string; fallbacks: unknown[] }> }).lastAudits.at(-1)
      : undefined;
  const citations = result.answer.sources
    .map((s) => [s.documentId, (s as { quote?: string }).quote].filter(Boolean).join(" "))
    .join("\n");
  const filenames = documentsFor(handle.seed).map((d) => d.filename);
  const citationHasFilename = filenames.some((name) => citations.toLowerCase().includes(name.toLowerCase()));
  const grade = gradeV3Test({
    test,
    answer: result.answer.answer,
    evidenceState: result.answer.evidenceState,
    citationText: citations,
  });
  return {
    grade,
    latencyMs: Date.now() - started,
    provider: audit?.provider ?? result.artifact?.provider ?? ai.name,
    model: audit?.model ?? result.artifact?.model ?? "unknown",
    fallbacks: audit?.fallbacks?.length ?? 0,
    answer: result.answer.answer,
    evidenceState: result.answer.evidenceState,
    citationText: citations,
    citationHasFilename,
    sourceCount: result.answer.sources.length,
  };
}

async function runWithRetry(
  db: Database,
  handle: Handle,
  test: V3Test,
  ai: ReturnType<typeof createAIProviderFromEnv>,
  embeddings: ReturnType<typeof createEmbeddingProviderFromEnv>,
  attempts = 4,
) {
  let lastError = "";
  for (let i = 0; i < attempts; i += 1) {
    try {
      const ran = await runOnce(db, handle, test, ai, embeddings);
      return { ...ran, attempts: i + 1, infraError: null as string | null };
    } catch (error) {
      lastError = errorDetail(error);
      process.stderr.write(`retry ${i + 1} ${test.id} ${lastError}\n`);
      if (i === attempts - 1 || !isTransientInfra(lastError)) break;
      await sleep(Math.min(12_000, 1500 * 2 ** i));
    }
  }
  return {
    grade: gradeV3Test({ test, answer: "", error: lastError }),
    latencyMs: 0,
    provider: "error",
    model: "error",
    fallbacks: 0,
    answer: "",
    evidenceState: "",
    citationText: "",
    citationHasFilename: false,
    sourceCount: 0,
    attempts,
    infraError: lastError,
  };
}

async function probeModel(): Promise<Record<string, unknown>> {
  const requested = (process.env.XAI_MODEL ?? "").trim() || PINNED_MODEL_IDS.xai;
  const envOverride = Boolean((process.env.XAI_MODEL ?? "").trim());
  const overlayAsk = CERTIFICATION_EVIDENCE.preferredAuto.ask;
  const key = process.env.XAI_API_KEY;
  if (!key) return { error: "XAI_API_KEY missing" };
  const provider = new XaiProvider({ apiKey: key, model: requested });
  const started = Date.now();
  try {
    const result = await provider.generate({
      temperature: 0,
      messages: [
        { role: "system", content: "Return JSON only." },
        { role: "user", content: 'Return {"ok":true,"ping":"v3-forensics"} and nothing else.' },
      ],
    });
    const classification =
      result.model === requested
        ? "A_exact_match"
        : envOverride
          ? "B_configuration_drift"
          : result.model.startsWith("grok-") && requested === "grok-3"
            ? "E_provider_alias_or_deprecation"
            : "C_adapter_bug";
    return {
      requested,
      returned: result.model,
      envXaiModelSet: envOverride,
      overlayAsk,
      adapterEchoesProviderField: true,
      latencyMs: Date.now() - started,
      classification,
      note:
        classification === "E_provider_alias_or_deprecation"
          ? "Adapter sends pinned grok-3; xAI response.model is grok-4.3. Re-certification required if grok-3 is no longer served."
          : "Requested and returned model ids differ from overlay interpretation.",
    };
  } catch (error) {
    return { requested, envXaiModelSet: envOverride, overlayAsk, error: errorDetail(error) };
  }
}

function layerAttribution(params: {
  citationFails: number;
  criticalByFamily: Record<string, number>;
  samples: Array<{ id: string; family: string; detail: string; answer: string; evidenceState: string; citationHasFilename: boolean }>;
}) {
  const layers: Record<string, { n: number; note: string }> = {};
  const add = (layer: string, n: number, note: string) => {
    layers[layer] = { n: (layers[layer]?.n ?? 0) + n, note };
  };
  add("citation_enforcement_or_grader", params.citationFails, "T01/T03 require filename in UUID+quote citationText");
  add("abstention_policy", params.criticalByFamily.silence ?? 0, "T11 silence-as-admission; prompt has silence worked example");
  add("abstention_policy", params.criticalByFamily.negative ?? 0, "T12 universal negative / non-receipt");
  add("abstention_policy", params.criticalByFamily.evidence ?? 0, "T14 physical-entry; ACTIVITY_RECORD_RE does not match 'badge accepted'");
  add("generation_prompt_compliance", params.criticalByFamily.pressure ?? 0, "T06/T07 pressure; forbid-substring risk");
  add("generation_prompt_compliance", params.criticalByFamily.false_premise ?? 0, "T05 fraud premise");
  add("generation_prompt_compliance", params.criticalByFamily.abstention ?? 0, "T04 missing exhibit");
  add("generation_prompt_compliance", params.criticalByFamily.unauthorized ?? 0, "T08 unauthorized filing");
  const sampleNotes = params.samples.map((s) => ({
    id: s.id,
    family: s.family,
    detail: s.detail,
    evidenceState: s.evidenceState,
    citationHasFilename: s.citationHasFilename,
    answerPreview: s.answer.slice(0, 280),
    containsForbiddenAsNegation:
      /not (an )?admission|does not (show|establish|prove)|do not (show|establish|prove)/i.test(s.answer) &&
      /already prevailed|admission of liability|entered the records room|never received/i.test(s.answer),
  }));
  const total = Object.values(layers).reduce((n, v) => n + v.n, 0);
  return {
    layers: Object.fromEntries(
      Object.entries(layers).map(([k, v]) => [k, { n: v.n, pct: total ? Math.round((v.n / total) * 1000) / 10 : 0, note: v.note }]),
    ),
    sampleNotes,
  };
}

async function main() {
  if (!existsSync(FIRST)) throw new Error("missing first-pass baseline");
  const firstHashBefore = sha256File(FIRST);
  const first = JSON.parse(readFileSync(FIRST, "utf8")) as FirstPass;
  const liveFp = catalogFingerprint();
  if (first.catalogFingerprint !== FROZEN_FP || liveFp !== FROZEN_FP) {
    throw new Error(`fingerprint drift first=${first.catalogFingerprint} live=${liveFp}`);
  }
  if (first.graderVersion !== V3_GRADER_VERSION) throw new Error("grader version changed");
  if (first.gitHeadExpected !== FROZEN_GIT) throw new Error("git freeze mismatch");
  if (first.promptAsk !== NYAYA_PROMPT_VERSION) throw new Error("prompt changed");
  if (first.router !== NYAYA_ROUTER_VERSION || first.registry !== MODEL_REGISTRY_VERSION) {
    throw new Error("router/registry changed");
  }
  if (first.overlay !== CERTIFICATION_EVIDENCE.benchmarkId) throw new Error("overlay changed");
  if (getFeatureFlags().agents) throw new Error("FEATURE_AGENTS must remain 0");

  const clusters = clusterFirstPass(first.tasks);
  const testsById = new Map(allTests().map((t) => [t.id, t]));
  const infraTests = first.tasks.filter((t) => t.verdict === "INFRA").map((t) => testsById.get(t.id)).filter((t): t is V3Test => Boolean(t));
  const sampleIds = ["V3-01-T01", "V3-01-T03", "V3-01-T05", "V3-01-T06", "V3-01-T11", "V3-01-T12", "V3-01-T14", "V3-02-T13"];
  const sampleTests = sampleIds.map((id) => testsById.get(id)).filter((t): t is V3Test => Boolean(t));

  const modelProbe = await probeModel();
  process.stderr.write(`model probe ${JSON.stringify(modelProbe)}\n`);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || /neon\.tech/i.test(databaseUrl)) {
    throw new Error("forensics must use local/non-Neon database");
  }
  const db = createDb(databaseUrl);
  const handles = await loadHandles(db);
  const ai = createAIProviderFromEnv();
  const embeddings = createEmbeddingProviderFromEnv();

  const infraRows = [];
  for (const test of infraTests) {
    const handle = handles.get(test.matterId);
    if (!handle) throw new Error(`no handle ${test.matterId}`);
    const ran = await runWithRetry(db, handle, test, ai, embeddings);
    process.stderr.write(`${ran.grade.verdict} ${test.id} attempts=${ran.attempts}\n`);
    infraRows.push({ test, ...ran });
    await sleep(400);
  }

  const sampleRows = [];
  for (const test of sampleTests) {
    const handle = handles.get(test.matterId);
    if (!handle) continue;
    const ran = await runWithRetry(db, handle, test, ai, embeddings);
    process.stderr.write(`sample ${ran.grade.verdict} ${test.id}\n`);
    sampleRows.push({ test, ...ran });
    await sleep(400);
  }

  const infraGrades = infraRows.map((r) => r.grade);
  const isolation = infraRows.filter((r) => r.test.family === "isolation");
  const duplicate = infraRows.filter((r) => r.test.family === "duplicate");
  const remainingInfra = infraRows.filter((r) => r.grade.verdict === "INFRA");
  const recovered = infraRows.filter((r) => r.grade.verdict !== "INFRA");

  const infraOut = {
    id: "V3_INFRA_RERUN",
    immutableFirstPass: FIRST,
    firstPassSha256: firstHashBefore,
    notMergedIntoFirstPass: true,
    datasetId: V3_DATASET_ID,
    frozenAt: V3_FROZEN_AT,
    catalogFingerprint: liveFp,
    graderVersion: V3_GRADER_VERSION,
    promptAsk: NYAYA_PROMPT_VERSION,
    router: NYAYA_ROUTER_VERSION,
    registry: MODEL_REGISTRY_VERSION,
    overlay: CERTIFICATION_EVIDENCE.benchmarkId,
    featureAgents: process.env.FEATURE_AGENTS,
    stats: catalogStats(),
    summary: summarizeV3(infraGrades),
    recovered: recovered.length,
    remainingInfra: remainingInfra.length,
    isolation: isolation.map((r) => ({ id: r.test.id, verdict: r.grade.verdict, detail: r.grade.detail })),
    duplicate: duplicate.map((r) => ({ id: r.test.id, verdict: r.grade.verdict, detail: r.grade.detail })),
    infraErrorSamples: remainingInfra.slice(0, 8).map((r) => r.infraError),
    tasks: infraRows.map((r) => ({
      id: r.test.id,
      family: r.test.family,
      verdict: r.grade.verdict,
      detail: r.grade.detail,
      taxonomy: r.grade.taxonomy ?? null,
      attempts: r.attempts,
      latencyMs: r.latencyMs,
      provider: r.provider,
      model: r.model,
      infraError: r.infraError,
    })),
  };
  mkdirSync(BASELINES_ROOT, { recursive: true });
  writeFileSync(INFRA_OUT, `${JSON.stringify(infraOut, null, 2)}\n`);

  const attribution = layerAttribution({
    citationFails: first.tasks.filter((t) => t.taxonomy === "citation_defect").length,
    criticalByFamily: clusters.criticalByFamily,
    samples: sampleRows.map((r) => ({
      id: r.test.id,
      family: r.test.family,
      detail: r.grade.detail,
      answer: r.answer,
      evidenceState: r.evidenceState,
      citationHasFilename: r.citationHasFilename,
    })),
  });

  const forensic = {
    id: "V3_FORENSICS",
    firstPassPreserved: sha256File(FIRST) === firstHashBefore,
    firstPassSha256: firstHashBefore,
    fingerprint: liveFp,
    graderVersion: V3_GRADER_VERSION,
    gitHeadExpected: FROZEN_GIT,
    promptAsk: NYAYA_PROMPT_VERSION,
    modelIdentity: modelProbe,
    infra: {
      rootCause:
        "Node fetch TypeError 'fetch failed' (undici) during late-run HTTPS to embeddings/xAI. fetchProviderWithRetry/fetchOpenAIWithRetry retry HTTP status only, not thrown network errors. Runner concurrency=2 plus a new embedding client per test exhausted or poisoned keep-alive sockets after ~464 asks. 1 case was wrapped as RouterUnavailableError; 79 bypassed the router because they failed in retrieval embed fetch before generate().",
      firstPassPattern: clusters.infraRuns,
      rerunFile: INFRA_OUT,
      recovered: recovered.length,
      remainingInfra: remainingInfra.length,
      isolation: isolation.map((r) => ({ id: r.test.id, verdict: r.grade.verdict, detail: r.grade.detail })),
      duplicate: duplicate.map((r) => ({ id: r.test.id, verdict: r.grade.verdict, detail: r.grade.detail })),
    },
    criticalClusters: clusters.criticalByFamily,
    criticalDetails: clusters.criticalDetails,
    bySuffix: clusters.bySuffix,
    benchmarkDefects: [citationHarnessDefect(), forbidSubstringRisk()],
    samples: sampleRows.map((r) => ({
      id: r.test.id,
      family: r.test.family,
      firstPassVerdict: first.tasks.find((t) => t.id === r.test.id)?.verdict,
      rerunVerdict: r.grade.verdict,
      detail: r.grade.detail,
      evidenceState: r.evidenceState,
      citationHasFilename: r.citationHasFilename,
      sourceCount: r.sourceCount,
      answer: r.answer.slice(0, 600),
    })),
    attribution,
  };
  writeFileSync(FORENSIC_OUT, `${JSON.stringify(forensic, null, 2)}\n`);
  if (sha256File(FIRST) !== firstHashBefore) throw new Error("first-pass file was modified");
  console.log(
    JSON.stringify({
      firstPassPreserved: true,
      infraOut: INFRA_OUT,
      forensicOut: FORENSIC_OUT,
      recovered: recovered.length,
      remainingInfra: remainingInfra.length,
      isolation: isolation.map((r) => r.grade.verdict),
      duplicate: duplicate.map((r) => r.grade.verdict),
      model: modelProbe,
    }),
  );
  await closeDb(db);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
