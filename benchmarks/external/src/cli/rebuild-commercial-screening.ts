import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classifyLegalBenchTask, inventoryLegalBenchTasks, loadLegalBenchTaskDir } from "../adapters/legalbench.js";
import { loadLegalBenchRagBenchmarkFile } from "../adapters/legalbench-rag.js";
import { loadPrbenchParquet, normalizePrbenchRow } from "../adapters/prbench.js";
import { isCommercialInternalEvalOk, loadLegalBenchTaskLicense } from "../license/firewall.js";
import { getCacheDir, getRegistryDir } from "../paths.js";
import { buildCommercialScreeningSuite } from "../selectors/commercial-screening.js";
import { NormalizedTaskSchema } from "../schema/normalized-task.js";

function stubLegalBenchPoolFromLicenses(): ReturnType<typeof NormalizedTaskSchema.parse>[] {
  const raw = readFileSync(path.join(getRegistryDir(), "legalbench-task-licenses.json"), "utf8");
  const parsed = JSON.parse(raw) as { tasks: Array<{ task_id: string }> };
  const tasks = [];
  for (const entry of parsed.tasks) {
    if (!isCommercialInternalEvalOk(loadLegalBenchTaskLicense(`${entry.task_id}::train::0`))) {
      continue;
    }
    if (classifyLegalBenchTask(entry.task_id) === "NON_US_OR_LOW_RELEVANCE") continue;
    tasks.push(
      NormalizedTaskSchema.parse({
        benchmarkId: "legalbench",
        taskId: `${entry.task_id}::train::0`,
        split: "train",
        jurisdiction: null,
        practiceArea: null,
        difficulty: null,
        taskType: entry.task_id,
        input: {},
        conversation: [{ role: "user", content: "stub" }],
        supportingDocuments: null,
        expectedAnswer: null,
        metadata: { upstreamTask: entry.task_id, nyayaCategory: classifyLegalBenchTask(entry.task_id) },
      }),
    );
  }
  return tasks;
}

async function main(): Promise<void> {
  const registryDir = getRegistryDir();
  const current = JSON.parse(
    readFileSync(path.join(registryDir, "screening-suite.json"), "utf8"),
  ) as {
    upstream_ids: {
      prbench_legal_hard: string[];
      legalbench: string[];
      legalbench_rag: string[];
    };
  };

  const cache = getCacheDir();
  let prHardIds = current.upstream_ids.prbench_legal_hard;

  const prPath = path.join(
    cache,
    "prbench/01947c6ef913df518e6e52626a7b29f132b12d4f/data/legal_hard-00000-of-00001.parquet",
  );
  if (existsSync(prPath)) {
    const rows = await loadPrbenchParquet(prPath);
    const prHard = rows.map((r) => normalizePrbenchRow(r, { split: "legal_hard", hard: true }));
    const idSet = new Set(current.upstream_ids.prbench_legal_hard);
    prHardIds = prHard.filter((t) => idSet.has(t.taskId)).map((t) => t.taskId);
    if (prHardIds.length !== current.upstream_ids.prbench_legal_hard.length) {
      prHardIds = current.upstream_ids.prbench_legal_hard;
    }
  }

  let legalbenchPool = stubLegalBenchPoolFromLicenses();
  const tasksRoot = path.join(cache, "lb/tasks");
  if (existsSync(tasksRoot)) {
    const inv = inventoryLegalBenchTasks(tasksRoot);
    const samples = [];
    for (const item of inv) {
      if (classifyLegalBenchTask(item.taskName) === "NON_US_OR_LOW_RELEVANCE") continue;
      if (!isCommercialInternalEvalOk(loadLegalBenchTaskLicense(`${item.taskName}::train::0`))) {
        continue;
      }
      try {
        const rows = loadLegalBenchTaskDir(path.join(tasksRoot, item.taskName), item.taskName, [
          "test",
          "train",
        ]);
        const first = rows[0];
        if (first) samples.push(first);
      } catch {
        // skip
      }
    }
    if (samples.length > 0) legalbenchPool = samples;
  }

  const ragPool = [];
  for (const f of ["contractnli", "cuad", "maud"] as const) {
    const filePath = path.join(
      cache,
      `legalbench-rag/2b9c248bc8179ef0908fd6ba01d50b156facd48b/benchmarks/${f}.json`,
    );
    if (existsSync(filePath)) {
      ragPool.push(...loadLegalBenchRagBenchmarkFile(filePath, f));
    }
  }

  function appendRagStub(source: string, idx: number): void {
    const id = `${source}::${idx}`;
    ragPool.push(
      NormalizedTaskSchema.parse({
        benchmarkId: "legalbench-rag",
        taskId: id,
        split: source,
        jurisdiction: null,
        practiceArea: null,
        difficulty: null,
        taskType: "retrieval",
        input: {},
        conversation: null,
        supportingDocuments: null,
        expectedAnswer: null,
        metadata: { upstreamSource: source },
      }),
    );
  }

  if (ragPool.length < 500) {
    const seen = new Set(ragPool.map((t) => t.taskId));
    for (const source of ["cuad", "maud", "contractnli"] as const) {
      for (let i = 0; i < 5000; i++) {
        const id = `${source}::${i}`;
        if (seen.has(id)) continue;
        appendRagStub(source, i);
        seen.add(id);
      }
    }
  }

  if (ragPool.length === 0) {
    for (const id of current.upstream_ids.legalbench_rag) {
      if (id.startsWith("privacy_qa::")) continue;
      const [source, idx] = id.split("::");
      if (!source || !idx) continue;
      ragPool.push(
        NormalizedTaskSchema.parse({
          benchmarkId: "legalbench-rag",
          taskId: id,
          split: source,
          jurisdiction: null,
          practiceArea: null,
          difficulty: null,
          taskType: "retrieval",
          input: {},
          conversation: null,
          supportingDocuments: null,
          expectedAnswer: null,
          metadata: { upstreamSource: source },
        }),
      );
    }
  }

  const suite = buildCommercialScreeningSuite({
    prbenchHardTaskIds: prHardIds,
    currentLegalbenchIds: current.upstream_ids.legalbench,
    currentRagIds: current.upstream_ids.legalbench_rag,
    legalbenchPool,
    legalbenchRagPool: ragPool,
  });

  const out = {
    suite_id: "external-screening-v1",
    selection_method: "deterministic_stratified",
    seed: suite.seed,
    frozen: true,
    frozen_at: new Date().toISOString(),
    license_filter: suite.license_filter,
    targets: suite.targets,
    actual: suite.actual,
    dropped: suite.dropped,
    upstream_ids: {
      prbench_legal_hard: suite.prbenchHardTaskIds,
      legalbench: suite.legalbenchTaskIds,
      legalbench_rag: suite.legalbenchRagTaskIds,
    },
    fixture_ids: {
      prbench: ["prbench-synth-001", "prbench-synth-002", "prbench-synth-003"],
      legalbench: ["legalbench-synth-001", "legalbench-synth-002", "legalbench-synth-003"],
      legalbench_rag: ["lbrag-synth-001", "lbrag-synth-002", "lbrag-synth-003"],
    },
    notes:
      "Commercial license filter applied; NC LegalBench and privacy_qa RAG excluded from production selection.",
  };

  const dest = path.join(registryDir, "screening-suite.json");
  writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ written: dest, actual: suite.actual, dropped: suite.dropped }, null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
