/**
 * Free deterministic LegalBench-RAG lexical retrieval eval.
 * ZERO paid model / embedding API calls.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadLegalBenchRagBenchmarkFile } from "../adapters/legalbench-rag.js";
import { getCacheDir, getRegistryDir } from "../paths.js";
import { documentHit, topKDocumentRecall } from "../scorers/rag-metrics.js";
import { hashRetrievalConfig, loadCorpusDocuments, retrieveTopKDocuments } from "../retrieval/lexical.js";
import { isCommercialInternalEvalOk, loadRagSourceLicense } from "../license/firewall.js";

type Screening = {
  upstream_ids: { legalbench_rag: string[] };
};

async function main(): Promise<void> {
  const screening = JSON.parse(
    readFileSync(path.join(getRegistryDir(), "screening-suite.json"), "utf8"),
  ) as Screening;
  const ids = screening.upstream_ids.legalbench_rag;
  const ragRoot = path.join(
    getCacheDir(),
    "legalbench-rag/2b9c248bc8179ef0908fd6ba01d50b156facd48b",
  );
  const benchmarksDir = path.join(ragRoot, "benchmarks");
  const corpusDir = path.join(ragRoot, "corpus");

  const bySource = new Map<string, ReturnType<typeof loadLegalBenchRagBenchmarkFile>>();
  for (const source of ["cuad", "maud", "contractnli"] as const) {
    const file = path.join(benchmarksDir, `${source}.json`);
    if (!existsSync(file)) continue;
    if (!isCommercialInternalEvalOk(loadRagSourceLicense(source))) continue;
    bySource.set(source, loadLegalBenchRagBenchmarkFile(file, source));
  }

  const docsBySource = new Map<string, ReturnType<typeof loadCorpusDocuments>>();
  for (const source of bySource.keys()) {
    docsBySource.set(source, loadCorpusDocuments(corpusDir, source));
  }

  const k = 5;
  let queries = 0;
  let docHits = 0;
  let recallSum = 0;
  const perQuery: Array<{
    taskId: string;
    source: string;
    docHit: boolean;
    recallAtK: number;
  }> = [];

  for (const taskId of ids) {
    const [source, indexStr] = taskId.split("::");
    if (!source || indexStr === undefined) continue;
    if (source === "privacy_qa") continue;
    const tasks = bySource.get(source);
    const docs = docsBySource.get(source) ?? [];
    if (!tasks) continue;
    const idx = Number(indexStr);
    const task = tasks.find((t) => t.taskId === taskId) ?? tasks[idx];
    if (!task) continue;
    const query =
      typeof task.input === "object" && task.input && "query" in task.input
        ? String((task.input as { query: string }).query)
        : task.conversation?.[0]?.content ?? "";
    const goldDocs = [
      ...new Set(
        (task.goldEvidence ?? [])
          .map((g) => g.documentId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    const goldNorm = goldDocs.map((g) => (g.includes("/") ? g : `${source}/${g}`));
    const retrieved = retrieveTopKDocuments(query, docs, k);
    const retrievedBase = retrieved.map((r) => r.split("/").slice(1).join("/"));
    const goldBase = goldNorm.map((g) => g.replace(new RegExp(`^${source}/`), ""));
    const hit =
      documentHit(retrieved, goldNorm) ||
      documentHit(retrievedBase, goldBase) ||
      documentHit(retrieved, goldDocs);
    const recall = Math.max(
      topKDocumentRecall(retrieved, goldNorm, k),
      topKDocumentRecall(retrievedBase, goldBase, k),
      topKDocumentRecall(retrieved, goldDocs, k),
    );
    queries += 1;
    if (hit) docHits += 1;
    recallSum += recall;
    perQuery.push({ taskId, source, docHit: hit, recallAtK: recall });
  }

  const result = {
    status: "FREE_RAG_RETRIEVAL_COMPLETE",
    method: "lexical_term_frequency_v1",
    paidModelCalls: 0,
    retrievalConfigHash: hashRetrievalConfig(),
    queries,
    k,
    documentHitRate: queries === 0 ? 0 : docHits / queries,
    meanRecallAtK: queries === 0 ? 0 : recallSum / queries,
    corpusDocsLoaded: [...docsBySource.entries()].map(([s, d]) => ({ source: s, docs: d.length })),
    note: "Baseline lexical retrieval only; not production embedding/RAG pipeline. Separated from model-selection generation scores.",
    corpusStatus:
      [...docsBySource.values()].every((d) => d.length === 0)
        ? "COMMERCIAL_CORPUS_NOT_CACHED_LOCALLY"
        : "LOADED",
    sample: perQuery.slice(0, 5),
  };

  const outDir = path.join(getCacheDir(), "runs", "free-rag-preflight");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "legalbench-rag-lexical.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(
    path.join(getRegistryDir(), "free-rag-preflight-result.json"),
    `${JSON.stringify({ ...result, perQueryCount: perQuery.length }, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
