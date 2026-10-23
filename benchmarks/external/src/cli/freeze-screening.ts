import { writeFileSync } from "node:fs";
import path from "node:path";
import { inventoryLegalBenchTasks, loadLegalBenchTaskDir } from "../adapters/legalbench.js";
import { loadLegalBenchRagBenchmarkFile } from "../adapters/legalbench-rag.js";
import { loadPrbenchParquet, normalizePrbenchRow } from "../adapters/prbench.js";
import { getCacheDir, getRegistryDir } from "../paths.js";
import { buildScreeningSelection } from "../selectors/screening.js";

async function main(): Promise<void> {
  const cache = getCacheDir();
  const hardRows = await loadPrbenchParquet(
    path.join(
      cache,
      "prbench/01947c6ef913df518e6e52626a7b29f132b12d4f/data/legal_hard-00000-of-00001.parquet",
    ),
  );
  const prHard = hardRows.map((r) => normalizePrbenchRow(r, { split: "legal_hard", hard: true }));

  const tasksRoot = path.join(cache, "lb/tasks");
  const inv = inventoryLegalBenchTasks(tasksRoot);
  const lbSamples = [];
  for (const item of inv) {
    if (item.category === "NON_US_OR_LOW_RELEVANCE") continue;
    try {
      const rows = loadLegalBenchTaskDir(path.join(tasksRoot, item.taskName), item.taskName, [
        "test",
        "train",
      ]);
      const first = rows[0];
      if (first) lbSamples.push(first);
    } catch {
      // skip malformed/missing
    }
  }

  const rag = [];
  for (const f of ["privacy_qa", "contractnli", "cuad", "maud"] as const) {
    rag.push(
      ...loadLegalBenchRagBenchmarkFile(
        path.join(
          cache,
          `legalbench-rag/2b9c248bc8179ef0908fd6ba01d50b156facd48b/benchmarks/${f}.json`,
        ),
        f,
      ),
    );
  }

  const suite = buildScreeningSelection({
    prbenchHard: prHard,
    legalbench: lbSamples,
    legalbenchRag: rag,
  });

  const out = {
    suite_id: "external-screening-v1",
    selection_method: suite.selectionMethod,
    seed: suite.seed,
    frozen: true,
    frozen_at: new Date().toISOString(),
    targets: suite.targets,
    actual: suite.actual,
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
    notes: "Deterministic stratified selection; not cherry-picked by model performance.",
  };

  const dest = path.join(getRegistryDir(), "screening-suite.json");
  writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        written: dest,
        actual: suite.actual,
        prHardPool: prHard.length,
        legalbenchPool: lbSamples.length,
        ragPool: rag.length,
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
