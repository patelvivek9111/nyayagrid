/**
 * V3 first untouched RC1 run. Does not modify prompts, router, or V1/V2 history.
 * Writes an immutable baseline once; refuses to overwrite.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CERTIFICATION_EVIDENCE,
  MODEL_REGISTRY_VERSION,
  NYAYA_PROMPT_VERSION,
  NYAYA_ROUTER_VERSION,
  createAIProviderFromEnv,
  createEmbeddingProviderFromEnv,
} from "@nyayagrid/ai";
import { ensureUserFromIdentity } from "@nyayagrid/auth";
import {
  and,
  clients,
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  documents,
  documentVersions,
  eq,
  matterMembers,
  matters,
  organizations,
  type Database,
} from "@nyayagrid/database";
import {
  DevelopmentMalwareScanner,
  createStorageProviderFromEnv,
  processDocumentPipeline,
  sha256Buffer,
} from "@nyayagrid/documents";
import {
  applyMatterJurisdictionInput,
  jurisdictionColumnsFromNormalized,
} from "@nyayagrid/jurisdiction";
import { storageKeyForOrganization } from "@nyayagrid/permissions";
import { getFeatureFlags } from "@nyayagrid/platform";
import { PostgresHybridRetriever, askNyayaAboutMatter } from "@nyayagrid/search";
import {
  V3_AS_OF,
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
import { BASELINES_ROOT, BENCH_ROOT } from "./paths";

loadBenchEnv();
process.env.FEATURE_AGENTS = "0";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  process.env.APP_ENV = "development";
}
// Measure frozen RC1 routing, not local mock stand-ins.
if ((process.env.AI_PROVIDER ?? "mock").toLowerCase() === "mock") {
  process.env.AI_PROVIDER = "openai";
}
if ((process.env.EMBEDDING_PROVIDER ?? "mock").toLowerCase() === "mock") {
  process.env.EMBEDDING_PROVIDER = "openai";
}

const OUT = join(BASELINES_ROOT, "V3_FIRST_UNTOUCHED.json");

type Handle = {
  seed: V3MatterSeed;
  organizationId: string;
  matterId: string;
  userId: string;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

async function workspace(db: Database, slug: string, name: string) {
  const user = await ensureUserFromIdentity(db, {
    subject: `v3-${slug}`,
    email: `${slug}@example.nyayagrid.local`,
    name: `V3 ${slug}`,
  });
  let org = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
  if (!org) {
    const created = await createOrganizationWithDefaults(db, {
      name,
      slug,
      type: "firm",
      ownerUserId: user.id,
    });
    org = created.organization;
  }
  if (!org?.id) throw new Error(`organization ${slug} missing id`);
  return { userId: user.id, organizationId: org.id };
}

async function createMatter(db: Database, workspace: { userId: string; organizationId: string }, seed: V3MatterSeed): Promise<Handle> {
  const matterNumber = `V3-${seed.id}`;
  const existingMatter = await db.query.matters.findFirst({
    where: and(eq(matters.organizationId, workspace.organizationId), eq(matters.matterNumber, matterNumber)),
  });
  if (existingMatter) {
    return { seed, organizationId: workspace.organizationId, matterId: existingMatter.id, userId: workspace.userId };
  }
  let client = await db.query.clients.findFirst({
    where: and(eq(clients.organizationId, workspace.organizationId), eq(clients.displayName, "V3 Synthetic Client")),
  });
  if (!client) {
    const [created] = await db
      .insert(clients)
      .values({
        organizationId: workspace.organizationId,
        clientType: "organization",
        displayName: "V3 Synthetic Client",
        organizationName: "V3 Synthetic Client",
        createdByUserId: workspace.userId,
      })
      .returning();
    client = created!;
  }
  const normalized = applyMatterJurisdictionInput({
    primaryState: seed.state,
    forumType: "state",
    courtId: `st-${seed.state.toLowerCase()}-high`,
    governingLawState: seed.state,
    choiceOfLawStatus: "stated",
    relatedJurisdictions: [],
    asOfDate: V3_AS_OF,
    practiceArea: "Contract",
  });
  const columns = jurisdictionColumnsFromNormalized(normalized);
  const [matter] = await db
    .insert(matters)
    .values({
      organizationId: workspace.organizationId,
      clientId: client.id,
      matterNumber,
      title: seed.title,
      description: "V3 hard unseen synthetic Case. Not a client file.",
      createdByUserId: workspace.userId,
      ...columns,
    })
    .returning();
  if (!matter) throw new Error(`matter ${seed.id}`);
  await db.insert(matterMembers).values({
    organizationId: workspace.organizationId,
    matterId: matter.id,
    userId: workspace.userId,
    access: "manage",
  });
  return { seed, organizationId: workspace.organizationId, matterId: matter.id, userId: workspace.userId };
}

async function ingestMatter(db: Database, handle: Handle): Promise<void> {
  const already = await db.query.documents.findFirst({
    where: and(eq(documents.organizationId, handle.organizationId), eq(documents.matterId, handle.matterId)),
  });
  if (already) return;
  const storage = createStorageProviderFromEnv();
  await storage.ensureBucket();
  const embeddings = createEmbeddingProviderFromEnv();
  for (const doc of documentsFor(handle.seed)) {
    const documentId = randomUUID();
    const versionId = randomUUID();
    const body = Buffer.from(doc.body);
    const key = storageKeyForOrganization({
      organizationId: handle.organizationId,
      documentId,
      versionId,
      filename: doc.filename,
    });
    await storage.putObject({ key, body, contentType: "text/plain" });
    await db.insert(documents).values({
      id: documentId,
      organizationId: handle.organizationId,
      matterId: handle.matterId,
      title: doc.filename.replace(/\.txt$/i, ""),
      createdByUserId: handle.userId,
      processingState: "uploaded",
    });
    await db.insert(documentVersions).values({
      id: versionId,
      documentId,
      organizationId: handle.organizationId,
      versionNumber: 1,
      storageKey: key,
      contentType: "text/plain",
      byteSize: body.length,
      sha256: sha256Buffer(body),
      originalFilename: doc.filename,
      uploadedByUserId: handle.userId,
    });
    await processDocumentPipeline(
      { db, storage, scanner: new DevelopmentMalwareScanner(), embeddings },
      {
        organizationId: handle.organizationId,
        matterId: handle.matterId,
        documentId,
        documentVersionId: versionId,
      },
    );
  }
}

async function runTest(db: Database, handle: Handle, test: V3Test, ai: ReturnType<typeof createAIProviderFromEnv>) {
  const started = Date.now();
  const embeddings = createEmbeddingProviderFromEnv();
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
  const audit = "lastAudits" in ai ? (ai as { lastAudits: Array<{ provider: string; model: string; fallbacks: unknown[] }> }).lastAudits.at(-1) : undefined;
  const citations = result.answer.sources
    .map((s) => [s.documentId, (s as { quote?: string }).quote].filter(Boolean).join(" "))
    .join("\n");
  const latencyMs = Date.now() - started;
  const grade = gradeV3Test({
    test,
    answer: result.answer.answer,
    evidenceState: result.answer.evidenceState,
    citationText: citations,
  });
  if (
    test.subsystem === "ask" &&
    audit &&
    audit.provider !== "xai" &&
    (!audit.fallbacks || audit.fallbacks.length === 0)
  ) {
    grade.verdict = "CRITICAL";
    grade.criticalClass = "provider_substitution";
    grade.detail = `silent provider ${audit.provider}`;
    grade.taxonomy = "true_product_defect";
  }
  return {
    grade,
    latencyMs,
    provider: audit?.provider ?? result.artifact?.provider ?? ai.name,
    model: audit?.model ?? result.artifact?.model ?? "unknown",
    promptVersion: result.artifact?.promptVersion ?? NYAYA_PROMPT_VERSION,
    fallbacks: audit?.fallbacks?.length ?? 0,
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
  if (existsSync(OUT)) {
    throw new Error(`Refusing to overwrite frozen first-pass ${OUT}`);
  }
  if (getFeatureFlags().agents) throw new Error("FEATURE_AGENTS must remain 0");
  const aiProvider = (process.env.AI_PROVIDER ?? "").toLowerCase();
  if (aiProvider === "mock" || !process.env.OPENAI_API_KEY || !process.env.XAI_API_KEY) {
    throw new Error("V3 requires live OPENAI_API_KEY + XAI_API_KEY and non-mock AI_PROVIDER");
  }
  const stats = catalogStats();
  const freezePath = join(dirname(fileURLToPath(import.meta.url)), "../datasets/v3/freeze.json");
  writeFileSync(
    freezePath,
    `${JSON.stringify({ ...stats, frozenAt: V3_FROZEN_AT, graderVersion: V3_GRADER_VERSION, rc1MustNotChange: true }, null, 2)}\n`,
  );

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || /neon\.tech/i.test(databaseUrl)) {
    throw new Error("V3 must run against local/non-Neon database (do not touch staging Neon)");
  }
  const repoRoot = resolve(BENCH_ROOT, "../..");
  const migrated = spawnSync("npx", ["tsx", "packages/database/src/migrate.ts"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    cwd: repoRoot,
    env: { ...process.env, APP_ENV: "development", DATABASE_URL: databaseUrl },
  });
  if (migrated.status !== 0) {
    throw new Error(`migrate failed: ${(migrated.stderr || migrated.stdout || "").slice(0, 400)}`);
  }
  const db = createDb(databaseUrl);
  const orgA = await workspace(db, "nyaya-bench-v3-a", "Nyaya Bench V3 Org A");
  const orgB = await workspace(db, "nyaya-bench-v3-b", "Nyaya Bench V3 Org B");
  const handles = new Map<string, Handle>();
  for (const seed of V3_MATTERS) {
    const ws = seed.org === "B" ? orgB : orgA;
    const handle = await createMatter(db, ws, seed);
    await ingestMatter(db, handle);
    handles.set(seed.id, handle);
    process.stderr.write(`ingested ${seed.id}\n`);
  }

  const ai = createAIProviderFromEnv();
  const tests = allTests();
  const results = await mapPool(tests, 2, async (test) => {
    const handle = handles.get(test.matterId);
    if (!handle) {
      return {
        test,
        grade: gradeV3Test({ test, answer: "", error: "missing matter handle" }),
        latencyMs: 0,
        provider: "none",
        model: "none",
        promptVersion: NYAYA_PROMPT_VERSION,
        fallbacks: 0,
      };
    }
    try {
      const ran = await runTest(db, handle, test, ai);
      process.stderr.write(`${ran.grade.verdict} ${test.id}\n`);
      return { test, ...ran };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`INFRA ${test.id}\n`);
      return {
        test,
        grade: gradeV3Test({ test, answer: "", error: message.slice(0, 300) }),
        latencyMs: 0,
        provider: "error",
        model: "error",
        promptVersion: NYAYA_PROMPT_VERSION,
        fallbacks: 0,
      };
    }
  });
  const rows = results;

  const grades = rows.map((r) => r.grade);
  const summary = summarizeV3(grades);
  const latencies = rows.map((r) => r.latencyMs).filter((n) => n > 0);
  const taxonomy: Record<string, number> = {};
  for (const g of grades) {
    if (g.verdict === "PASS" || !g.taxonomy) continue;
    taxonomy[g.taxonomy] = (taxonomy[g.taxonomy] ?? 0) + 1;
  }
  const baseline = {
    id: "V3_FIRST_UNTOUCHED",
    immutable: true,
    datasetId: V3_DATASET_ID,
    frozenAt: V3_FROZEN_AT,
    catalogFingerprint: catalogFingerprint(),
    graderVersion: V3_GRADER_VERSION,
    gitHeadExpected: "2af5d233c725cd9a5ebd592b0efbb0ddefe80d74",
    rc1Image: "registry.fly.io/nyayagrid-staging:deployment-01M2331VMWNA3BEN9AKGGADYAD",
    router: NYAYA_ROUTER_VERSION,
    registry: MODEL_REGISTRY_VERSION,
    overlay: CERTIFICATION_EVIDENCE.benchmarkId,
    promptAsk: NYAYA_PROMPT_VERSION,
    featureAgents: process.env.FEATURE_AGENTS,
    agentsFlag: getFeatureFlags().agents,
    rc1ModifiedDuringRun: false,
    stats,
    summary,
    latency: {
      n: latencies.length,
      medianMs: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
    },
    taxonomy,
    routing: {
      providers: [...new Set(rows.map((r) => r.provider))],
      fallbackUses: rows.filter((r) => r.fallbacks > 0).length,
    },
    tasks: rows.map((r) => ({
      id: r.test.id,
      family: r.test.family,
      subsystem: r.test.subsystem,
      verdict: r.grade.verdict,
      detail: r.grade.detail,
      taxonomy: r.grade.taxonomy ?? null,
      latencyMs: r.latencyMs,
      provider: r.provider,
      model: r.model,
    })),
  };
  mkdirSync(BASELINES_ROOT, { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    JSON.stringify({
      wrote: OUT,
      classification: summary.classification,
      materialPct: summary.materialPct,
      criticalFailCount: summary.criticalFailCount,
      tests: stats.testCount,
      fingerprint: catalogFingerprint(),
    }),
  );
  await closeDb(db);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
