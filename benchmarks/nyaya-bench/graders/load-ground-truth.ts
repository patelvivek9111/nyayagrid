import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchExpectation } from "./types";
import { hiddenGroundTruthDir, type DatasetId } from "../runner/paths";

type V1File = {
  scenario_id: string;
  answers: Record<
    string,
    {
      task_id: string;
      expected: string;
      supporting_refs?: string[];
      verdict_logic: string;
    }
  >;
};

type V2File = {
  scenario_id: string;
  ground_truth: Array<{
    task_id: string;
    expectation_type: string;
    canonical_answer: string | string[];
    supporting_documents?: string[];
    notes?: string;
    failure_severity_if_wrong?: string;
  }>;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function severityOf(value: string | undefined): BenchExpectation["severity"] {
  if (value === "critical") return "critical";
  if (value === "minor") return "minor";
  return "major";
}

function refsToDocs(refs: string[] | undefined): string[] {
  return (refs ?? []).map((ref) => ref.split(":")[0] ?? ref);
}

/**
 * Load hidden answer keys. Call only after the matching task answer JSON exists on disk.
 */
export function loadGroundTruth(
  dataset: DatasetId,
  scenarioId: string,
): Map<string, BenchExpectation> {
  const dir = hiddenGroundTruthDir(dataset);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  const match =
    files.find((name) => name.startsWith(`${scenarioId}_`)) ??
    files.find((name) => name.includes(scenarioId));
  if (!match) throw new Error(`No hidden ground truth file for ${scenarioId} in ${dir}`);
  const raw = readJson<V1File | V2File>(join(dir, match));
  const map = new Map<string, BenchExpectation>();

  if ("answers" in raw) {
    for (const row of Object.values(raw.answers)) {
      map.set(row.task_id, {
        taskId: row.task_id,
        expectationType: row.verdict_logic,
        canonical: row.expected,
        supportingDocs: refsToDocs(row.supporting_refs),
        notes: "",
        severity: row.verdict_logic === "must_abstain" ? "critical" : "major",
      });
    }
    return map;
  }

  for (const row of raw.ground_truth) {
    map.set(row.task_id, {
      taskId: row.task_id,
      expectationType: row.expectation_type,
      canonical: row.canonical_answer,
      supportingDocs: row.supporting_documents ?? [],
      notes: row.notes ?? "",
      severity: severityOf(row.failure_severity_if_wrong),
    });
  }
  mergeMemoryGroundTruth(dir, scenarioId, map);
  mergeAnalysisGroundTruth(dir, scenarioId, map);
  mergeDepositionGroundTruth(dir, scenarioId, map);
  mergeContractGroundTruth(dir, scenarioId, map);
  mergeEvidenceGroundTruth(dir, scenarioId, map);
  mergeDraftGroundTruth(dir, scenarioId, map);
  mergeGraphGroundTruth(dir, scenarioId, map);
  mergeResearchGroundTruth(dir, scenarioId, map);
  mergeAgentsGroundTruth(dir, scenarioId, map);
  return map;
}

function mergeAgentsGroundTruth(
  dir: string,
  scenarioId: string,
  map: Map<string, BenchExpectation>,
) {
  const agentsPath = join(dir, "agents", `${scenarioId}.json`);
  if (!existsSync(agentsPath)) return;
  const raw = readJson<V2File>(agentsPath);
  for (const row of raw.ground_truth) {
    if (map.has(row.task_id)) continue;
    map.set(row.task_id, {
      taskId: row.task_id,
      expectationType: row.expectation_type,
      canonical: row.canonical_answer,
      supportingDocs: row.supporting_documents ?? [],
      notes: row.notes ?? "",
      severity: severityOf(row.failure_severity_if_wrong),
    });
  }
}

function mergeResearchGroundTruth(
  dir: string,
  scenarioId: string,
  map: Map<string, BenchExpectation>,
) {
  const researchPath = join(dir, "research", `${scenarioId}.json`);
  if (!existsSync(researchPath)) return;
  const raw = readJson<V2File>(researchPath);
  for (const row of raw.ground_truth) {
    if (map.has(row.task_id)) continue;
    map.set(row.task_id, {
      taskId: row.task_id,
      expectationType: row.expectation_type,
      canonical: row.canonical_answer,
      supportingDocs: row.supporting_documents ?? [],
      notes: row.notes ?? "",
      severity: severityOf(row.failure_severity_if_wrong),
    });
  }
}

function mergeGraphGroundTruth(
  dir: string,
  scenarioId: string,
  map: Map<string, BenchExpectation>,
) {
  const graphPath = join(dir, "graph", `${scenarioId}.json`);
  if (!existsSync(graphPath)) return;
  const raw = readJson<V2File>(graphPath);
  for (const row of raw.ground_truth) {
    if (map.has(row.task_id)) continue;
    map.set(row.task_id, {
      taskId: row.task_id,
      expectationType: row.expectation_type,
      canonical: row.canonical_answer,
      supportingDocs: row.supporting_documents ?? [],
      notes: row.notes ?? "",
      severity: severityOf(row.failure_severity_if_wrong),
    });
  }
}

function mergeMemoryGroundTruth(
  dir: string,
  scenarioId: string,
  map: Map<string, BenchExpectation>,
) {
  const memoryPath = join(dir, "memory", `${scenarioId}.json`);
  if (!existsSync(memoryPath)) return;
  const raw = readJson<V2File>(memoryPath);
  for (const row of raw.ground_truth) {
    if (map.has(row.task_id)) continue;
    map.set(row.task_id, {
      taskId: row.task_id,
      expectationType: row.expectation_type,
      canonical: row.canonical_answer,
      supportingDocs: row.supporting_documents ?? [],
      notes: row.notes ?? "",
      severity: severityOf(row.failure_severity_if_wrong),
    });
  }
}

function mergeAnalysisGroundTruth(
  dir: string,
  scenarioId: string,
  map: Map<string, BenchExpectation>,
) {
  const analysisPath = join(dir, "analysis", `${scenarioId}.json`);
  if (!existsSync(analysisPath)) return;
  const raw = readJson<V2File>(analysisPath);
  for (const row of raw.ground_truth) {
    if (map.has(row.task_id)) continue;
    map.set(row.task_id, {
      taskId: row.task_id,
      expectationType: row.expectation_type,
      canonical: row.canonical_answer,
      supportingDocs: row.supporting_documents ?? [],
      notes: row.notes ?? "",
      severity: severityOf(row.failure_severity_if_wrong),
    });
  }
}

function mergeDepositionGroundTruth(
  dir: string,
  scenarioId: string,
  map: Map<string, BenchExpectation>,
) {
  const depositionPath = join(dir, "deposition", `${scenarioId}.json`);
  if (!existsSync(depositionPath)) return;
  const raw = readJson<V2File>(depositionPath);
  for (const row of raw.ground_truth) {
    if (map.has(row.task_id)) continue;
    map.set(row.task_id, {
      taskId: row.task_id,
      expectationType: row.expectation_type,
      canonical: row.canonical_answer,
      supportingDocs: row.supporting_documents ?? [],
      notes: row.notes ?? "",
      severity: severityOf(row.failure_severity_if_wrong),
    });
  }
}

function mergeContractGroundTruth(
  dir: string,
  scenarioId: string,
  map: Map<string, BenchExpectation>,
) {
  const contractPath = join(dir, "contract", `${scenarioId}.json`);
  if (!existsSync(contractPath)) return;
  const raw = readJson<V2File>(contractPath);
  for (const row of raw.ground_truth) {
    if (map.has(row.task_id)) continue;
    map.set(row.task_id, {
      taskId: row.task_id,
      expectationType: row.expectation_type,
      canonical: row.canonical_answer,
      supportingDocs: row.supporting_documents ?? [],
      notes: row.notes ?? "",
      severity: severityOf(row.failure_severity_if_wrong),
    });
  }
}

function mergeEvidenceGroundTruth(
  dir: string,
  scenarioId: string,
  map: Map<string, BenchExpectation>,
) {
  const evidencePath = join(dir, "evidence", `${scenarioId}.json`);
  if (!existsSync(evidencePath)) return;
  const raw = readJson<V2File>(evidencePath);
  for (const row of raw.ground_truth) {
    if (map.has(row.task_id)) continue;
    map.set(row.task_id, {
      taskId: row.task_id,
      expectationType: row.expectation_type,
      canonical: row.canonical_answer,
      supportingDocs: row.supporting_documents ?? [],
      notes: row.notes ?? "",
      severity: severityOf(row.failure_severity_if_wrong),
    });
  }
}

function mergeDraftGroundTruth(
  dir: string,
  scenarioId: string,
  map: Map<string, BenchExpectation>,
) {
  const draftPath = join(dir, "draft", `${scenarioId}.json`);
  if (!existsSync(draftPath)) return;
  const raw = readJson<V2File>(draftPath);
  for (const row of raw.ground_truth) {
    if (map.has(row.task_id)) continue;
    map.set(row.task_id, {
      taskId: row.task_id,
      expectationType: row.expectation_type,
      canonical: row.canonical_answer,
      supportingDocs: row.supporting_documents ?? [],
      notes: row.notes ?? "",
      severity: severityOf(row.failure_severity_if_wrong),
    });
  }
}
