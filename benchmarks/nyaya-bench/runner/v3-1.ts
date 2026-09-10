/**
 * V3.1 runner. Never overwrites V3_FIRST_UNTOUCHED / INFRA_RERUN / FORENSICS.
 * Default: measurement-only RC1 replay. --post writes the post-remediation run.
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
  createAIProviderFromEnv,
  createEmbeddingProviderFromEnv,
} from "@nyayagrid/ai";
import { ensureUserFromIdentity } from "@nyayagrid/auth";
import {
  and,
  closeDb,
  createDb,
  documents,
  documentVersions,
  eq,
  matters,
  organizations,
  type Database,
} from "@nyayagrid/database";
import { getFeatureFlags } from "@nyayagrid/platform";
import { PostgresHybridRetriever, askNyayaAboutMatter } from "@nyayagrid/search";
import {
  V31_DATASET_ID,
  V31_FROZEN_AT,
  V31_GRADER_VERSION,
  V3_MATTERS,
  allTests,
  catalogFingerprint,
  catalogStats,
  type V3MatterSeed,
  type V3Test,
} from "../datasets/v3.1/catalog";
import { gradeV3Test, summarizeV3, type V31Citation } from "../graders/v3-1-grade";
import { loadBenchEnv } from "./load-env";
import { BASELINES_ROOT } from "./paths";

loadBenchEnv();
process.env.FEATURE_AGENTS = "0";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  process.env.APP_ENV = "development";
}
if ((process.env.AI_PROVIDER ?? "mock").toLowerCase() === "mock") process.env.AI_PROVIDER = "openai";
if ((process.env.EMBEDDING_PROVIDER ?? "mock").toLowerCase() === "mock") {
  process.env.EMBEDDING_PROVIDER = "openai";
}

const MODE = process.argv.includes("--post") ? "post" : "replay";
const FAMILY_FILTER = (process.env.V31_FAMILIES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ID_FILTER = (process.env.V31_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_REQUESTS = Number.parseInt(process.env.V31_MAX_REQUESTS ?? "", 10);
const FIRST = join(BASELINES_ROOT, "V3_FIRST_UNTOUCHED.json");
const INFRA = join(BASELINES_ROOT, "V3_INFRA_RERUN.json");
const FORENSICS = join(BASELINES_ROOT, "V3_FORENSICS.json");
const REPLAY = join(BASELINES_ROOT, "V3_1_RC1_MEASUREMENT_REPLAY.json");
const POST = join(BASELINES_ROOT, process.env.V31_ARTIFACT ?? "V3_1_POST_REMEDIATION.json");
const FREEZE = join(BASELINES_ROOT, "..", "datasets", "v3.1", "freeze.json");
const OUT = MODE === "post" ? POST : REPLAY;

type Handle = { seed: V3MatterSeed; organizationId: string; matterId: string; userId: string };

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 400);
  const extra: string[] = [error.name, error.message];
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) extra.push(`${cause.name}:${cause.message}`);
  else if (cause && typeof cause === "object" && "code" in cause) extra.push(`code=${String((cause as { code: unknown }).code)}`);
  return extra.filter(Boolean).join(" | ").slice(0, 500);
}

function requestCapHits(selectedCount: number, cap: number): boolean {
  return Number.isFinite(cap) && cap > 0 && selectedCount > cap;
}

function isTransientInfra(message: string): boolean {
  return /fetch failed|could not complete this analysis|ECONNRESET|ETIMEDOUT|UND_ERR|socket|aborted|timeout|rate.?limit|429|503|502|unavailable/i.test(
    message,
  );
}

function isSpendOrAuth(message: string): boolean {
  return /non-operational provider failure: auth|status 401|status 403|\b403\b|permission-denied|permission.?denied|invalid api key|spend limit|insufficient.?quota|quota exceeded|resource.?exhausted|used credits/i.test(
    message,
  );
}

class SpendAuthAbort extends Error {
  override readonly name = "SpendAuthAbort";
  readonly testId: string;
  readonly detail: string;
  constructor(testId: string, detail: string) {
    super(`SPEND_AUTH_ABORT ${testId} ${detail}`);
    this.testId = testId;
    this.detail = detail;
  }
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
    const matter = await db.query.matters.findFirst({
      where: and(eq(matters.organizationId, ws.organizationId), eq(matters.matterNumber, `V3-${seed.id}`)),
    });
    if (!matter) throw new Error(`missing matter V3-${seed.id}`);
    handles.set(seed.id, { seed, organizationId: ws.organizationId, matterId: matter.id, userId: ws.userId });
  }
  return handles;
}

async function citationMeta(db: Database, organizationId: string, matterId: string): Promise<Map<string, V31Citation>> {
  const rows = await db
    .select({
      documentId: documents.id,
      title: documents.title,
      filename: documentVersions.originalFilename,
    })
    .from(documents)
    .leftJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .where(and(eq(documents.organizationId, organizationId), eq(documents.matterId, matterId)));
  const map = new Map<string, V31Citation>();
  for (const row of rows) {
    map.set(row.documentId, {
      documentId: row.documentId,
      title: row.title,
      filename: row.filename ?? undefined,
    });
  }
  return map;
}

async function runOnce(
  db: Database,
  handle: Handle,
  test: V3Test,
  ai: ReturnType<typeof createAIProviderFromEnv>,
  embeddings: ReturnType<typeof createEmbeddingProviderFromEnv>,
  docMeta: Map<string, V31Citation>,
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
  const citations: V31Citation[] = result.answer.sources.map((s) => ({
    documentId: s.documentId,
    quote: s.quote,
    title: docMeta.get(s.documentId)?.title,
    filename: docMeta.get(s.documentId)?.filename,
  }));
  const citationText = citations.map((c) => [c.documentId, c.title, c.filename, c.quote].filter(Boolean).join(" ")).join("\n");
  const grade = gradeV3Test({
    test,
    answer: result.answer.answer,
    evidenceState: result.answer.evidenceState,
    citationText,
    citations,
  });
  return {
    grade,
    latencyMs: Date.now() - started,
    provider: audit?.provider ?? result.artifact?.provider ?? ai.name,
    model: audit?.model ?? result.artifact?.model ?? "unknown",
    fallbacks: audit?.fallbacks?.length ?? 0,
  };
}

async function runWithRetry(
  db: Database,
  handle: Handle,
  test: V3Test,
  ai: ReturnType<typeof createAIProviderFromEnv>,
  embeddings: ReturnType<typeof createEmbeddingProviderFromEnv>,
  docMeta: Map<string, V31Citation>,
) {
  let lastError = "";
  for (let i = 0; i < 4; i += 1) {
    try {
      const ran = await runOnce(db, handle, test, ai, embeddings, docMeta);
      return { ...ran, attempts: i + 1 };
    } catch (error) {
      lastError = errorDetail(error);
      process.stderr.write(`retry ${i + 1} ${test.id} ${lastError}\n`);
      if (isSpendOrAuth(lastError)) throw new SpendAuthAbort(test.id, lastError);
      if (i === 3 || !isTransientInfra(lastError)) break;
      await sleep(Math.min(12_000, 1500 * 2 ** i));
    }
  }
  return {
    grade: gradeV3Test({ test, answer: "", error: lastError }),
    latencyMs: 0,
    provider: "error",
    model: "error",
    fallbacks: 0,
    attempts: 4,
  };
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return out;
}

async function main() {
  for (const frozen of [FIRST, INFRA, FORENSICS]) {
    if (!existsSync(frozen)) throw new Error(`missing immutable ${frozen}`);
  }
  const firstHash = sha256File(FIRST);
  if (existsSync(OUT)) throw new Error(`Refusing to overwrite ${OUT}`);
  if (MODE === "post" && !existsSync(REPLAY)) throw new Error("measurement replay must exist before post run");
  if (getFeatureFlags().agents) throw new Error("FEATURE_AGENTS must remain 0");
  const stats = catalogStats();
  if (!existsSync(FREEZE)) {
    mkdirSync(join(FREEZE, ".."), { recursive: true });
    writeFileSync(
      FREEZE,
      `${JSON.stringify({ ...stats, frozenAt: V31_FROZEN_AT, parent: "v3-hard-unseen", rc1MustNotChange: true }, null, 2)}\n`,
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || /neon\.tech/i.test(databaseUrl)) throw new Error("V3.1 must use local/non-Neon database");
  const db = createDb(databaseUrl);
  const handles = await loadHandles(db);
  const ai = createAIProviderFromEnv();
  const embeddings = createEmbeddingProviderFromEnv();
  const selected = allTests().filter((test) => {
    if (FAMILY_FILTER.length > 0 && !FAMILY_FILTER.includes(test.family)) return false;
    if (ID_FILTER.length > 0 && !ID_FILTER.includes(test.id)) return false;
    return true;
  });
  const requestCap = Number.isFinite(MAX_REQUESTS) && MAX_REQUESTS > 0 ? MAX_REQUESTS : 0;
  const incomplete = requestCapHits(selected.length, requestCap);
  const tests = requestCap > 0 ? selected.slice(0, requestCap) : selected;
  const writePath = incomplete ? join(BASELINES_ROOT, "V3_1_INCOMPLETE.json") : OUT;
  if (existsSync(writePath)) throw new Error(`Refusing to overwrite ${writePath}`);
  const metaByMatter = new Map<string, Map<string, V31Citation>>();
  for (const handle of handles.values()) {
    metaByMatter.set(handle.seed.id, await citationMeta(db, handle.organizationId, handle.matterId));
  }

  const concurrency = Number.parseInt(process.env.V31_CONCURRENCY ?? "", 10);
  const poolSize = Number.isFinite(concurrency) && concurrency > 0 ? Math.min(concurrency, 2) : MODE === "post" ? 1 : 2;
  const completed: Array<{
    test: V3Test;
    grade: ReturnType<typeof gradeV3Test>;
    latencyMs: number;
    provider: string;
    model: string;
    fallbacks: number;
    attempts: number;
  }> = [];
  let rows = completed;
  try {
    rows = await mapPool(tests, poolSize, async (test) => {
      const handle = handles.get(test.matterId);
      if (!handle) {
        const missing = {
          test,
          grade: gradeV3Test({ test, answer: "", error: "missing handle" }),
          latencyMs: 0,
          provider: "none",
          model: "none",
          fallbacks: 0,
          attempts: 0,
        };
        completed.push(missing);
        return missing;
      }
      const ran = await runWithRetry(db, handle, test, ai, embeddings, metaByMatter.get(handle.seed.id) ?? new Map());
      process.stderr.write(`${ran.grade.verdict} ${test.id}\n`);
      const row = { test, ...ran };
      completed.push(row);
      return row;
    });
  } catch (error) {
    if (!(error instanceof SpendAuthAbort)) throw error;
    const stopPath = join(BASELINES_ROOT, "V3_1_INCOMPLETE.json");
    if (existsSync(stopPath)) throw new Error(`Refusing to overwrite ${stopPath}`);
    mkdirSync(BASELINES_ROOT, { recursive: true });
    const gradesStopped = completed.map((r) => r.grade);
    const summaryStopped = summarizeV3(gradesStopped);
    const latenciesStopped = completed.map((r) => r.latencyMs).filter((n) => n > 0);
    writeFileSync(
      stopPath,
      `${JSON.stringify(
        {
          id: "V3_1_INCOMPLETE",
          mode: "incomplete",
          incomplete: true,
          stopReason: "spend_or_auth",
          stoppedAt: error.testId,
          stopDetail: error.detail,
          notMergedIntoFirstPass: true,
          firstPassSha256: firstHash,
          datasetId: V31_DATASET_ID,
          frozenAt: V31_FROZEN_AT,
          catalogFingerprint: catalogFingerprint(),
          graderVersion: V31_GRADER_VERSION,
          promptAsk: NYAYA_PROMPT_VERSION,
          router: NYAYA_ROUTER_VERSION,
          registry: MODEL_REGISTRY_VERSION,
          overlay: CERTIFICATION_EVIDENCE.benchmarkId,
          featureAgents: process.env.FEATURE_AGENTS,
          requestedXaiModel: (process.env.XAI_MODEL ?? "").trim() || PINNED_MODEL_IDS.xai,
          stats,
          summary: summaryStopped,
          latency: {
            n: latenciesStopped.length,
            medianMs: percentile(latenciesStopped, 50),
            p95Ms: percentile(latenciesStopped, 95),
          },
          completed: completed.length,
          selected: selected.length,
          tasks: completed.map((r) => ({
            id: r.test.id,
            family: r.test.family,
            verdict: r.grade.verdict,
            detail: r.grade.detail,
            taxonomy: r.grade.taxonomy ?? null,
            latencyMs: r.latencyMs,
            provider: r.provider,
            model: r.model,
          })),
        },
        null,
        2,
      )}\n`,
    );
    if (sha256File(FIRST) !== firstHash) throw new Error("first-pass was modified");
    console.log(
      JSON.stringify({
        wrote: stopPath,
        mode: "incomplete",
        stopReason: "spend_or_auth",
        stoppedAt: error.testId,
      }),
    );
    await closeDb(db);
    process.exit(1);
  }

  const grades = rows.map((r) => r.grade);
  const summary = summarizeV3(grades);
  const latencies = rows.map((r) => r.latencyMs).filter((n) => n > 0);
  const payload = {
    id: incomplete ? "V3_1_INCOMPLETE" : MODE === "post" ? "V3_1_POST_REMEDIATION" : "V3_1_RC1_MEASUREMENT_REPLAY",
    mode: incomplete ? "incomplete" : MODE,
    incomplete,
    notMergedIntoFirstPass: true,
    firstPassSha256: firstHash,
    datasetId: V31_DATASET_ID,
    frozenAt: V31_FROZEN_AT,
    catalogFingerprint: catalogFingerprint(),
    graderVersion: V31_GRADER_VERSION,
    promptAsk: NYAYA_PROMPT_VERSION,
    router: NYAYA_ROUTER_VERSION,
    registry: MODEL_REGISTRY_VERSION,
    overlay: CERTIFICATION_EVIDENCE.benchmarkId,
    featureAgents: process.env.FEATURE_AGENTS,
    requestedXaiModel: (process.env.XAI_MODEL ?? "").trim() || PINNED_MODEL_IDS.xai,
    stats,
    summary,
    latency: { n: latencies.length, medianMs: percentile(latencies, 50), p95Ms: percentile(latencies, 95) },
    routing: {
      providers: [...new Set(rows.map((r) => r.provider))],
      models: [...new Set(rows.map((r) => r.model))],
      fallbackUses: rows.filter((r) => r.fallbacks > 0).length,
    },
    tasks: rows.map((r) => ({
      id: r.test.id,
      family: r.test.family,
      verdict: r.grade.verdict,
      detail: r.grade.detail,
      taxonomy: r.grade.taxonomy ?? null,
      latencyMs: r.latencyMs,
      provider: r.provider,
      model: r.model,
    })),
  };
  mkdirSync(BASELINES_ROOT, { recursive: true });
  writeFileSync(writePath, `${JSON.stringify(payload, null, 2)}\n`);
  if (sha256File(FIRST) !== firstHash) throw new Error("first-pass was modified");
  console.log(
    JSON.stringify({
      wrote: writePath,
      mode: incomplete ? "incomplete" : MODE,
      classification: incomplete ? "INCOMPLETE" : summary.classification,
      materialPct: summary.materialPct,
      criticalFailCount: summary.criticalFailCount,
      fingerprint: catalogFingerprint(),
    }),
  );
  await closeDb(db);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
