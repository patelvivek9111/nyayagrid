import { cpus, totalmem, freemem, platform, arch, hostname } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MockEmbeddingProvider } from "@nyayagrid/ai";
import { chunkSegments } from "@nyayagrid/documents";
import { InMemoryRateLimiter, RATE_LIMIT_PRESETS, checkEndpointRateLimit } from "@nyayagrid/platform";
import {
  classifyFailure,
  runConcurrent,
  summarizeLatencies,
  syntheticPage,
  CONTROLLED_BETA_LOAD_MODEL,
} from "./harness";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

function pagesToSegments(pageCount: number) {
  return Array.from({ length: pageCount }, (_, i) => {
    const text = syntheticPage(i + 1);
    return {
      text,
      page: i + 1,
      segmentRef: `p${i + 1}`,
      charStart: 0,
      charEnd: text.length,
    };
  });
}

async function measureIngest(pageCounts: number[]) {
  const embeddings = new MockEmbeddingProvider();
  const rows = [];
  for (const pages of pageCounts) {
    const rssBefore = rssMb();
    const segments = pagesToSegments(pages);
    const t0 = performance.now();
    const parseMs = 0;
    const tChunk = performance.now();
    const drafts = chunkSegments(segments);
    const chunkMs = performance.now() - tChunk;
    const tEmbed = performance.now();
    await embeddings.embed(drafts.map((d) => d.content));
    const embedMs = performance.now() - tEmbed;
    const wallMs = performance.now() - t0;
    rows.push({
      pages,
      chunks: drafts.length,
      embeddingCount: drafts.length,
      bytes: segments.reduce((sum, s) => sum + Buffer.byteLength(s.text), 0),
      parseMs: Math.round(parseMs),
      chunkMs: Math.round(chunkMs),
      embedMs: Math.round(embedMs),
      wallMs: Math.round(wallMs),
      rssMb: rssMb(),
      rssDeltaMb: rssMb() - rssBefore,
    });
  }
  return rows;
}

async function measureConcurrency() {
  const limiter = new InMemoryRateLimiter();
  const latencies: number[] = [];
  const errors: Record<string, number> = {};
  const { elapsedMs } = await runConcurrent(10, 40, async () => {
    const t0 = performance.now();
    try {
      const decision = await checkEndpointRateLimit(limiter, {
        endpointClass: "ask_nyaya",
        userId: "perf-user",
      });
      if (!decision.allowed) {
        throw new Error("RATE_LIMITED");
      }
      await new Promise((r) => setTimeout(r, 5));
      latencies.push(performance.now() - t0);
    } catch (error) {
      const kind = classifyFailure(error);
      errors[kind] = (errors[kind] ?? 0) + 1;
    }
  });

  const isolationLimiter = new InMemoryRateLimiter();
  const isolation = { ok: 0, rate_limit: 0 };
  for (let i = 0; i < 70; i++) {
    const decision = await checkEndpointRateLimit(isolationLimiter, {
      endpointClass: "ask_nyaya",
      userId: "same-user",
    });
    if (decision.allowed) isolation.ok += 1;
    else isolation.rate_limit += 1;
  }

  return {
    concurrency: 10,
    requests: 40,
    elapsedMs,
    latencies: summarizeLatencies(latencies),
    failures: errors,
    askNyayaPreset: RATE_LIMIT_PRESETS.ask_nyaya,
    productVsRateLimit: {
      note: "40 asks from one user stay under the 60/hour product cap. 70 sequential asks isolate 10 RATE_LIMITED rejections from capacity.",
      seventySequentialAsksSameUser: isolation,
    },
  };
}

async function measureDocumentCounts() {
  const embeddings = new MockEmbeddingProvider();
  const rows = [];
  for (const documents of [1, 10, 25, 50]) {
    const rssBefore = rssMb();
    const t0 = performance.now();
    let chunks = 0;
    let pages = 0;
    for (let d = 0; d < documents; d++) {
      const pageCount = 10;
      pages += pageCount;
      const drafts = chunkSegments(pagesToSegments(pageCount));
      chunks += drafts.length;
      await embeddings.embed(drafts.map((x) => x.content));
    }
    const wallMs = performance.now() - t0;
    rows.push({
      documents,
      pages,
      chunks,
      wallMs: Math.round(wallMs),
      documentsPerMin: wallMs > 0 ? Math.round((documents / wallMs) * 60_000) : null,
      pagesPerMin: wallMs > 0 ? Math.round((pages / wallMs) * 60_000) : null,
      chunksPerMin: wallMs > 0 ? Math.round((chunks / wallMs) * 60_000) : null,
      rssDeltaMb: rssMb() - rssBefore,
      note: "CPU-only mock embeddings; excludes PDF parse, MinIO, serial DB inserts, and intelligence model calls",
    });
  }
  return rows;
}

async function measureRetrievalShape() {
  const embeddings = new MockEmbeddingProvider();
  const sizes = [100, 1000, 5000];
  const rows = [];
  for (const n of sizes) {
    const texts = Array.from({ length: n }, (_, i) => syntheticPage(i + 1, 80));
    const t0 = performance.now();
    await embeddings.embed(texts);
    rows.push({
      chunks: n,
      embedAllMs: Math.round(performance.now() - t0),
      note: "mock embeddings; production hybrid also runs two SQL queries (vector + FTS) with LIMIT",
    });
  }
  return rows;
}

async function main() {
  const ingest = await measureIngest([10, 30, 100, 250]);
  const ingestByDocumentCount = await measureDocumentCounts();
  const concurrency = await measureConcurrency();
  const retrieval = await measureRetrievalShape();

  const baseline = {
    label: "PERF_BASELINE_P1",
    capturedAt: new Date().toISOString(),
    environment: {
      host: hostname(),
      platform: platform(),
      arch: arch(),
      cpus: cpus().length,
      cpuModel: cpus()[0]?.model ?? "unknown",
      totalMemMb: Math.round(totalmem() / 1024 / 1024),
      freeMemMb: Math.round(freemem() / 1024 / 1024),
      node: process.version,
      aiProvider: process.env.AI_PROVIDER ?? "mock",
      embeddingProvider: process.env.EMBEDDING_PROVIDER ?? process.env.AI_PROVIDER ?? "mock",
      note: "Local laptop/process numbers. Not a production SLA. Live OpenAI timings below come from frozen reliability runs, not this process.",
    },
    loadModel: CONTROLLED_BETA_LOAD_MODEL,
    productRateLimits: RATE_LIMIT_PRESETS,
    dbPoolMax: 10,
    upload: {
      maxBytes: 15 * 1024 * 1024,
      maxPages: Number(process.env.MAX_PAGES ?? 2000),
      processing: "synchronous in POST /documents including malware scan, extract, chunk, embed, and intelligence extract",
    },
    offlineHarness: {
      ingestByPageCount: ingest,
      ingestByDocumentCount,
      mockAskConcurrency: concurrency,
      mockEmbeddingByChunkCount: retrieval,
    },
    liveOpenAiFromFrozenReliabilityRuns: {
      askNyayaA3: { medianLatencyMs: 2788, p95LatencyMs: 5108, source: "BASELINE_A3" },
      askNyayaA4: { medianLatencyMs: 2708, source: "BASELINE_A4" },
      contractAnalysisCa1: {
        medianLatencyMs: 15891,
        p95LatencyMs: 19845,
        maxLatencyMs: 19956,
        modelCallsPerTask: 1,
        source: "BASELINE_CA1",
      },
      depositionAnalysisDa1: {
        medianLatencyMs: 8840,
        p95LatencyMs: 11713,
        maxLatencyMs: 12016,
        modelCallsPerTask: 1,
        source: "BASELINE_DA1",
      },
      compareB2: {
        tasks: 48,
        wallClockMs: 68935,
        approxMeanMsIfSerial: Math.round(68935 / 48),
        source: "BASELINE_B2 config startedAt/finishedAt",
      },
      known429Storm: {
        run: "2026-08-18T17-36-27-621Z",
        note: "80× OpenAI HTTP 429; excluded from A.3 reliability scoring",
      },
    },
  };

  const outDir = resolve(repoRoot, "docs/performance");
  mkdirSync(outDir, { recursive: true });
  const jsonPath = resolve(outDir, "PERF_BASELINE_P1.json");
  writeFileSync(jsonPath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(JSON.stringify(baseline.offlineHarness, null, 2));
  console.log(`wrote ${jsonPath}`);
}

await main();
