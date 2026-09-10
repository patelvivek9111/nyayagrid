/**
 * Ask-route recert for the actually served xAI model.
 * Does not rewrite nyaya-four-provider-cert-v1 or V3 first-pass artifacts.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ASK_SERVED_MODEL_RECERT,
  CERTIFICATION_EVIDENCE,
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
import { allTests, type V3Test } from "../datasets/v3.1/catalog";
import { gradeV3Test, type V31Citation } from "../graders/v3-1-grade";
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

const OUT = join(BASELINES_ROOT, "V3_1_ASK_SERVED_MODEL_RECERT.json");
const FOCUS_IDS = [
  "V3-01-T01",
  "V3-01-T04",
  "V3-01-T05",
  "V3-01-T06",
  "V3-01-T08",
  "V3-01-T09",
  "V3-01-T11",
  "V3-ISO-01",
  "V3-ISO-02",
];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
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

async function main() {
  if (getFeatureFlags().agents) throw new Error("FEATURE_AGENTS must remain 0");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || /neon\.tech/i.test(databaseUrl)) throw new Error("recert must use local/non-Neon database");
  const db = createDb(databaseUrl);
  const orgA = await workspace(db, "nyaya-bench-v3-a");
  const matter = await db.query.matters.findFirst({
    where: and(eq(matters.organizationId, orgA.organizationId), eq(matters.matterNumber, "V3-V3-01")),
  });
  if (!matter) throw new Error("missing matter V3-V3-01");
  const ai = createAIProviderFromEnv();
  const embeddings = createEmbeddingProviderFromEnv();
  const requested = (process.env.XAI_MODEL ?? "").trim() || PINNED_MODEL_IDS.xai;
  const tests = allTests().filter((t) => FOCUS_IDS.includes(t.id));
  const docMeta = await citationMeta(db, orgA.organizationId, matter.id);
  const retriever = new PostgresHybridRetriever(db, embeddings);
  const rows: Array<{
    id: string;
    family: string;
    verdict: string;
    detail: string;
    latencyMs: number;
    provider: string;
    model: string;
  }> = [];
  let served = ASK_SERVED_MODEL_RECERT.served;
  let servedProvider = ASK_SERVED_MODEL_RECERT.provider;
  for (const test of tests) {
    const started = Date.now();
    let lastError = "";
    let result: Awaited<ReturnType<typeof askNyayaAboutMatter>> | null = null;
    for (let i = 0; i < 4; i += 1) {
      try {
        result = await askNyayaAboutMatter({
          db,
          retriever,
          organizationId: orgA.organizationId,
          matterId: matter.id,
          userId: orgA.userId,
          question: test.question,
          ai,
          embeddings,
          includeLegalAuthority: false,
        });
        lastError = "";
        break;
      } catch (error) {
        const cause = error instanceof Error && error.cause ? String(error.cause) : "";
        lastError = `${error instanceof Error ? error.message : String(error)}${cause ? ` | ${cause}` : ""}`;
        process.stderr.write(`recert fail ${test.id} ${lastError}\n`);
        if (i === 3 || !/unavailable|fetch failed|timeout|429|503/i.test(lastError)) break;
        await new Promise((resolve) => setTimeout(resolve, 1500 * 2 ** i));
      }
    }
    if (!result) {
      rows.push({
        id: test.id,
        family: test.family,
        verdict: "INFRA",
        detail: lastError.slice(0, 240),
        latencyMs: Date.now() - started,
        provider: servedProvider,
        model: served,
      });
      continue;
    }
    const audit =
      "lastAudits" in ai
        ? (ai as { lastAudits: Array<{ provider: string; model: string }> }).lastAudits.at(-1)
        : undefined;
    const citations: V31Citation[] = result.answer.sources.map((s) => ({
      documentId: s.documentId,
      quote: s.quote,
      title: docMeta.get(s.documentId)?.title,
      filename: docMeta.get(s.documentId)?.filename,
    }));
    const citationText = citations.map((c) => [c.documentId, c.title, c.filename, c.quote].filter(Boolean).join(" ")).join("\n");
    const grade = gradeV3Test({
      test: test as V3Test,
      answer: result.answer.answer,
      evidenceState: result.answer.evidenceState,
      citationText,
      citations,
    });
    const model = audit?.model ?? result.artifact?.model ?? served;
    const provider = audit?.provider ?? result.artifact?.provider ?? servedProvider;
    if (model) served = model;
    if (provider) servedProvider = provider;
    rows.push({
      id: test.id,
      family: test.family,
      verdict: grade.verdict,
      detail: grade.detail,
      latencyMs: Date.now() - started,
      provider,
      model,
    });
  }
  const latencies = rows.map((r) => r.latencyMs);
  const criticalFail = rows.filter((r) => r.verdict === "CRITICAL" || r.verdict === "FAIL").length;
  const payload = {
    id: ASK_SERVED_MODEL_RECERT.id,
    parentOverlay: CERTIFICATION_EVIDENCE.benchmarkId,
    requested,
    served,
    provider: servedProvider,
    featureAgents: process.env.FEATURE_AGENTS,
    frozenOverlayUnchanged: true,
    evaluatedIdentity: served,
    contract: ASK_SERVED_MODEL_RECERT.contract,
    tasks: rows,
    latency: { n: latencies.length, medianMs: percentile(latencies, 50), p95Ms: percentile(latencies, 95) },
    criticalOrFail: criticalFail,
    recertifiedAt: new Date().toISOString(),
  };
  mkdirSync(BASELINES_ROOT, { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  if (!existsSync(join(BASELINES_ROOT, "V3_FIRST_UNTOUCHED.json"))) {
    throw new Error("first-pass missing");
  }
  console.log(
    JSON.stringify({
      wrote: OUT,
      requested,
      served,
      pass: rows.filter((r) => r.verdict === "PASS").length,
      n: rows.length,
      criticalOrFail: criticalFail,
    }),
  );
  await closeDb(db);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
