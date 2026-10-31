import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getFixturesDir, getRegistryDir, getCacheDir } from "../paths.js";
import { LegalBenchAdapter } from "../adapters/legalbench.js";
import { filterLegalBenchTasks } from "../selectors/legalbench.js";
import { parseNormalizedTasks, type NormalizedTask } from "../schema/normalized-task.js";
import {
  SUITE_ID,
  SUITE_VERSION,
  DETERMINISTIC_SEED,
  SAMPLE_TARGETS,
  DEFAULT_LEGALBENCH_UPSTREAM_TASKS,
  type TaskGroup,
} from "./constants.js";
import { stratifiedDeterministicSelect, hashSelectionManifest } from "./sampling.js";
import { classifyExternalBenchmarkLicense } from "./license-gate.js";
import {
  normalizeLegalCiteBenchRow,
  PRIORITY_LEGALCITE_TASK_TYPES,
} from "./adapters/legalcitebench.js";
import { normalizeCaseFactsRow } from "./adapters/casefacts.js";
import { normalizeLegalRagBenchQa } from "./adapters/legal-rag-bench.js";

export type LoadedSuiteSlice = {
  benchmarkId: string;
  tasks: NormalizedTask[];
  plannedCount: number;
  selectedCount: number;
  jurisdiction: string;
  license: string;
  licenseClassification: string;
  taskGroupDefault: TaskGroup;
  resultLabel?: string;
  mountStatus: "FIXTURE" | "CACHE" | "EXTERNAL_MOUNT" | "MISSING";
};

export type ProsecutionExternalSuitePlan = {
  suiteId: typeof SUITE_ID;
  suiteVersion: typeof SUITE_VERSION;
  seed: typeof DETERMINISTIC_SEED;
  selectionManifestHash: string;
  slices: LoadedSuiteSlice[];
  totalSelected: number;
};

function taskGroupForLegalBench(upstream: string): TaskGroup {
  if (upstream === "hearsay") return "US_EVIDENCE_REASONING";
  if (upstream.includes("citation")) return "CITATION_RELIABILITY";
  if (upstream === "overruling") return "US_PRECEDENT_FACT_CHECKING";
  return "US_AUTHORITY_VERIFICATION";
}

export async function loadLegalBenchProsecutionSliceAsync(opts?: {
  cacheRoot?: string;
  fixtureFallback?: boolean;
  count?: number;
}): Promise<LoadedSuiteSlice> {
  const license = classifyExternalBenchmarkLicense("legalbench");
  const count = opts?.count ?? SAMPLE_TARGETS.legalbench;
  const cacheRoot =
    opts?.cacheRoot ??
    (existsSync(path.join(getCacheDir(), "lb", "tasks"))
      ? path.join(getCacheDir(), "lb", "tasks")
      : existsSync(path.join(getCacheDir(), "legalbench", "tasks"))
        ? path.join(getCacheDir(), "legalbench", "tasks")
        : path.join(getCacheDir(), "legalbench"));

  let tasks: NormalizedTask[] = [];
  let mountStatus: LoadedSuiteSlice["mountStatus"] = "MISSING";

  if (existsSync(cacheRoot)) {
    try {
      const loaded = await LegalBenchAdapter.load(cacheRoot);
      tasks = filterLegalBenchTasks(loaded, {
        mode: "upstream_tasks",
        upstreamTasks: DEFAULT_LEGALBENCH_UPSTREAM_TASKS,
      }).map((t) => ({
        ...t,
        metadata: {
          ...(t.metadata ?? {}),
          taskGroup: taskGroupForLegalBench(String(t.metadata?.upstreamTask ?? t.taskType)),
          stratum: String(t.metadata?.upstreamTask ?? t.taskType),
        },
      }));
      mountStatus = "CACHE";
    } catch {
      mountStatus = "MISSING";
    }
  }

  if (tasks.length === 0 && opts?.fixtureFallback !== false) {
    return loadFixtureLegalBench(count);
  }

  const selected = stratifiedDeterministicSelect(
    tasks,
    Math.min(count, tasks.length),
    "stratum",
    `${DETERMINISTIC_SEED}:legalbench`,
    ["hearsay"],
  );

  return {
    benchmarkId: "legalbench",
    tasks: selected,
    plannedCount: count,
    selectedCount: selected.length,
    jurisdiction: "US",
    license: license.license,
    licenseClassification: license.classification,
    taskGroupDefault: "US_EVIDENCE_REASONING",
    mountStatus,
  };
}

export function loadFixtureSlice(
  benchmarkId: "legalcitebench" | "casefacts" | "legal-rag-bench",
  count: number,
): LoadedSuiteSlice {
  const license = classifyExternalBenchmarkLicense(benchmarkId);
  const file =
    benchmarkId === "legalcitebench"
      ? "legalcitebench-like.json"
      : benchmarkId === "casefacts"
        ? "casefacts-like.json"
        : "legal-rag-bench-like.json";
  const fx = JSON.parse(
    readFileSync(path.join(getFixturesDir(), "prosecution-external", file), "utf8"),
  ) as { tasks: Record<string, unknown>[] };

  let tasks: NormalizedTask[];
  if (benchmarkId === "legalcitebench") {
    tasks = fx.tasks.map((row, i) =>
      normalizeLegalCiteBenchRow(
        (row.citationTaskType as (typeof PRIORITY_LEGALCITE_TASK_TYPES)[number]) ||
          "CITATION_ERROR_DETECTION",
        "fixture",
        row,
        i,
      ),
    );
  } else if (benchmarkId === "casefacts") {
    tasks = fx.tasks.map((row, i) => normalizeCaseFactsRow(row, "fixture", i));
  } else {
    tasks = fx.tasks.map((row, i) => normalizeLegalRagBenchQa(row, i));
  }

  const stratum =
    benchmarkId === "casefacts"
      ? "stratum"
      : benchmarkId === "legalcitebench"
        ? "citationTaskType"
        : "stratum";
  const prefer =
    benchmarkId === "casefacts"
      ? ["Overruled", "Refuted"]
      : benchmarkId === "legalcitebench"
        ? PRIORITY_LEGALCITE_TASK_TYPES.slice(0, 3)
        : [];

  const selected = stratifiedDeterministicSelect(
    tasks,
    Math.min(count, tasks.length),
    stratum,
    `${DETERMINISTIC_SEED}:${benchmarkId}`,
    prefer,
  );

  const taskGroupDefault: TaskGroup =
    benchmarkId === "legalcitebench"
      ? "CITATION_RELIABILITY"
      : benchmarkId === "casefacts"
        ? "US_PRECEDENT_FACT_CHECKING"
        : "CRIMINAL_RAG_GROUNDING";

  return {
    benchmarkId,
    tasks: selected,
    plannedCount: count,
    selectedCount: selected.length,
    jurisdiction:
      license.jurisdiction ?? (benchmarkId === "legal-rag-bench" ? "VICTORIA_AUSTRALIA" : "US"),
    license: license.license,
    licenseClassification: license.classification,
    taskGroupDefault,
    resultLabel: license.resultLabel,
    mountStatus: "FIXTURE",
  };
}

function loadFixtureLegalBench(count: number = SAMPLE_TARGETS.legalbench): LoadedSuiteSlice {
  const license = classifyExternalBenchmarkLicense("legalbench");
  const fx = JSON.parse(
    readFileSync(
      path.join(getFixturesDir(), "prosecution-external", "legalbench-like.json"),
      "utf8",
    ),
  ) as { tasks: unknown[] };
  const tasks = parseNormalizedTasks(fx.tasks);
  const selected = stratifiedDeterministicSelect(
    tasks,
    Math.min(count, tasks.length),
    "stratum",
    `${DETERMINISTIC_SEED}:legalbench`,
    ["hearsay"],
  );
  return {
    benchmarkId: "legalbench",
    tasks: selected,
    plannedCount: count,
    selectedCount: selected.length,
    jurisdiction: "US",
    license: license.license,
    licenseClassification: license.classification,
    taskGroupDefault: "US_EVIDENCE_REASONING",
    mountStatus: "FIXTURE",
  };
}

export async function buildProsecutionExternalSuitePlan(opts?: {
  useFixturesOnly?: boolean;
}): Promise<ProsecutionExternalSuitePlan> {
  const useFixturesOnly = opts?.useFixturesOnly ?? true;
  const legalbench = useFixturesOnly
    ? loadFixtureLegalBench()
    : await loadLegalBenchProsecutionSliceAsync({ fixtureFallback: true });
  const legalcite = loadFixtureSlice("legalcitebench", SAMPLE_TARGETS.legalcitebench);
  const casefacts = loadFixtureSlice("casefacts", SAMPLE_TARGETS.casefacts);
  const legalRag = loadFixtureSlice("legal-rag-bench", SAMPLE_TARGETS.legalRagBench);

  const slices = [legalbench, legalcite, casefacts, legalRag];
  const allIds = slices.flatMap((s) => s.tasks.map((t) => t.taskId));
  return {
    suiteId: SUITE_ID,
    suiteVersion: SUITE_VERSION,
    seed: DETERMINISTIC_SEED,
    selectionManifestHash: hashSelectionManifest(allIds, DETERMINISTIC_SEED),
    slices,
    totalSelected: allIds.length,
  };
}

export function loadSuiteRegistryMeta(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(getRegistryDir(), "prosecution-external-suite.json"), "utf8"),
  ) as Record<string, unknown>;
}
