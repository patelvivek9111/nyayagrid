import { cpus, totalmem, freemem, platform, arch, hostname } from "node:os";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCUMENT_INGEST_RUNTIME, ingestIdempotencyKey } from "@nyayagrid/documents";
import { runConcurrent, summarizeLatencies } from "./harness";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

async function measureAcceptLatency() {
  const samples: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    const key = ingestIdempotencyKey(`version-${i}`);
    JSON.stringify({
      name: "nyayagrid/document.malware_scan",
      id: key,
      data: { documentVersionId: `version-${i}`, idempotencyKey: key },
    });
    samples.push(performance.now() - t0);
  }
  return summarizeLatencies(samples);
}

async function measureOrchestrationConcurrency() {
  let peak = 0;
  let current = 0;
  const { elapsedMs } = await runConcurrent(
    DOCUMENT_INGEST_RUNTIME.ingestConcurrencyGlobal,
    20,
    async () => {
      current += 1;
      peak = Math.max(peak, current);
      await new Promise((r) => setTimeout(r, 15));
      current -= 1;
      return true;
    },
  );
  return {
    documents: 20,
    workerLimit: DOCUMENT_INGEST_RUNTIME.ingestConcurrencyGlobal,
    peakInFlight: peak,
    elapsedMs,
    note: "Local orchestration only; Inngest enforces the same per-function limits in production.",
  };
}

async function main() {
  const p1Path = resolve(repoRoot, "docs/performance/PERF_BASELINE_P1.json");
  const p1 = JSON.parse(readFileSync(p1Path, "utf8")) as { label: string; capturedAt: string };
  const accept = await measureAcceptLatency();
  const orchestration = await measureOrchestrationConcurrency();

  const baseline = {
    label: "PERF_BASELINE_P2",
    capturedAt: new Date().toISOString(),
    doesNotOverwrite: p1.label,
    p1CapturedAt: p1.capturedAt,
    environment: {
      host: hostname(),
      platform: platform(),
      arch: arch(),
      cpus: cpus().length,
      cpuModel: cpus()[0]?.model ?? "unknown",
      totalMemMb: Math.round(totalmem() / 1024 / 1024),
      freeMemMb: Math.round(freemem() / 1024 / 1024),
      node: process.version,
      note: "Local laptop numbers. Not a production SLA. Upload accept samples are in-process enqueue serialization, not MinIO+HTTP.",
    },
    httpContract: {
      uploadStatus: 202,
      pipelineOnRequest: false,
      intelligenceOnRequest: false,
      durableEnqueue: "inngest.send nyayagrid/document.malware_scan with event id = document.ingest:{versionId}",
    },
    uploadAcceptInProcessMs: accept,
    backgroundRuntime: DOCUMENT_INGEST_RUNTIME,
    dbPoolMaxUnchanged: 10,
    orchestration20Docs: orchestration,
    serialChunkInserts: "unchanged P1",
    retrievalIndexes: "unchanged P1",
    openaiAdapterRetry: "unchanged; ingest retries via Inngest on thrown 429/timeout",
    residualFailureWindow:
      "Document rows are committed before inngest.send. If send throws, the route marks the document failed and returns 503. If send succeeds and the worker never runs, the document stays uploaded/processing until retried.",
  };

  const outDir = resolve(repoRoot, "docs/performance");
  mkdirSync(outDir, { recursive: true });
  const jsonPath = resolve(outDir, "PERF_BASELINE_P2.json");
  writeFileSync(jsonPath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(JSON.stringify({ uploadAcceptInProcessMs: accept, orchestration }, null, 2));
  console.log(`wrote ${jsonPath}`);
}

await main();
