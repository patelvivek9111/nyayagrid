import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadPrbenchParquet } from "../adapters/prbench.js";
import { inventoryLegalBenchTasks } from "../adapters/legalbench.js";
import { loadLegalBenchRagBenchmarkFile } from "../adapters/legalbench-rag.js";
import { getCacheDir, getFixturesDir, getRegistryDir } from "../paths.js";

type LicenseRow = {
  benchmark_id: string;
  review_status: string;
  license: string;
};

async function main(): Promise<void> {
  const licenses = JSON.parse(
    readFileSync(path.join(getRegistryDir(), "licenses.json"), "utf8"),
  ) as LicenseRow[];
  const sources = JSON.parse(readFileSync(path.join(getRegistryDir(), "sources.json"), "utf8")) as {
    sources: Array<{ benchmark_id: string; revision: string }>;
  };
  const cache = getCacheDir();

  const rows: Array<Record<string, unknown>> = [];

  for (const src of sources.sources) {
    const lic = licenses.find((l) => l.benchmark_id === src.benchmark_id);
    const row: Record<string, unknown> = {
      benchmark: src.benchmark_id,
      revision: src.revision,
      license: lic?.license ?? null,
      licenseStatus: lic?.review_status ?? null,
      localAvailability: "missing",
      tasks: null,
      hardTasks: null,
    };

    if (src.benchmark_id === "prbench") {
      const legal = path.join(cache, "prbench", src.revision, "data/legal-00000-of-00001.parquet");
      const hard = path.join(
        cache,
        "prbench",
        src.revision,
        "data/legal_hard-00000-of-00001.parquet",
      );
      if (existsSync(legal) && existsSync(hard)) {
        row.localAvailability = "cached";
        row.tasks = (await loadPrbenchParquet(legal)).length;
        row.hardTasks = (await loadPrbenchParquet(hard)).length;
      } else if (existsSync(path.join(getFixturesDir(), "prbench-like.json"))) {
        row.localAvailability = "fixtures_only";
        const fx = JSON.parse(
          readFileSync(path.join(getFixturesDir(), "prbench-like.json"), "utf8"),
        ) as { tasks: unknown[] };
        row.tasks = fx.tasks.length;
      }
    }

    if (src.benchmark_id === "legalbench") {
      const tasksRoot = path.join(cache, "lb/tasks");
      if (existsSync(tasksRoot)) {
        row.localAvailability = "cached";
        row.tasks = inventoryLegalBenchTasks(tasksRoot).length;
      } else {
        row.localAvailability = "fixtures_only";
      }
    }

    if (src.benchmark_id === "legalbench-rag") {
      const benchDir = path.join(cache, "legalbench-rag", src.revision, "benchmarks");
      if (existsSync(benchDir)) {
        let total = 0;
        for (const f of ["privacy_qa.json", "contractnli.json", "cuad.json", "maud.json"]) {
          const p = path.join(benchDir, f);
          if (existsSync(p)) {
            total += loadLegalBenchRagBenchmarkFile(p, f.replace(/\.json$/, "")).length;
          }
        }
        row.localAvailability = "cached";
        row.tasks = total;
      } else {
        row.localAvailability = "fixtures_only";
      }
    }

    rows.push(row);
  }

  // PLawBench classification row
  const plaw = licenses.find((l) => l.benchmark_id === "plawbench");
  rows.push({
    benchmark: "plawbench",
    revision: null,
    license: plaw?.license ?? null,
    licenseStatus: plaw?.review_status ?? null,
    localAvailability: "not_integrated",
    tasks: null,
    hardTasks: null,
    classification: "FOREIGN_JURISDICTION_OPTIONAL",
  });

  console.log(JSON.stringify({ benchmarks: rows }, null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
