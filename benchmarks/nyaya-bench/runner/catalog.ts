import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertIngestibleDocumentPath } from "./isolate";
import { datasetRoot, scenariosDir, type DatasetId } from "./paths";

export type BenchDocument = {
  documentId: string;
  filename: string;
  title: string;
  absolutePath: string;
};

export type MemoryBenchAction = {
  kind:
    "propose" | "create_manual" | "supersede" | "reject" | "duplicate" | "edit" | "hint_fallback";
  question?: string;
  hint?: string;
  memoryType?: string;
  title?: string;
  content?: string;
  oldTitle?: string;
  oldContent?: string;
  oldMemoryType?: string;
  newTitle?: string;
  newContent?: string;
  newMemoryType?: string;
};

export type AnalysisBenchAction = {
  kind:
    | "analyze_contract"
    | "analyze_deposition"
    | "review_contract_item"
    | "duplicate_contract"
    | "downstream_context"
    | "evidence_matrix";
  documentPattern?: string;
  reviewAction?: "reviewed" | "dismissed";
  extractIntelligence?: boolean;
  approveTimeline?: boolean;
  approveFacts?: boolean;
  rejectTimeline?: boolean;
  rejectFacts?: boolean;
  analyzeDeposition?: boolean;
  analyzeContract?: boolean;
  detectContradictions?: boolean;
  reviewContradiction?: "reviewed" | "dismissed";
  markImportantPattern?: string;
};

export type DraftBenchAction = {
  kind: "generate" | "revise";
  draftType?:
    | "memo"
    | "correspondence"
    | "contract"
    | "other";
  extractIntelligence?: boolean;
  approveTimeline?: boolean;
  approveFacts?: boolean;
  analyzeContract?: boolean;
  extractGraph?: boolean;
  createProposedMemory?: { title: string; content: string };
  createApprovedUserMemory?: { title: string; content: string };
  transformAction?: "regenerate" | "shorten";
  saveManualEdit?: string;
};

export type GraphBenchAction = {
  extractIntelligence?: boolean;
  approveTimeline?: boolean;
  approveFacts?: boolean;
  materialize?: boolean;
  extractRelationships?: boolean;
  reviewAction?: "approve" | "reject";
  createManual?: boolean;
  inspectNeighborhood?: boolean;
};

export type ResearchBenchAction = {
  kind?: "query" | "memo";
  jurisdiction?: string;
  citation?: string;
  authorityType?: string;
  court?: string;
  includeMatterContext?: boolean;
  includeContrary?: boolean;
  createProposedMemory?: { title: string; content: string };
  extractIntelligence?: boolean;
  approveTimeline?: boolean;
  approveFacts?: boolean;
};

export type AgentBenchAction = {
  kind?:
    | "execute"
    | "plan_then_cancel"
    | "execute_then_reject"
    | "execute_then_resume"
    | "outsider"
    | "failing_ai";
  importResearchCorpus?: boolean;
  seedProposedMemory?: { title: string; content: string };
  budgets?: { maxSteps?: number; maxToolCalls?: number; timeoutMs?: number; maxRetries?: number };
};

export type FullSystemBenchAction = {
  freshMatter?: boolean;
  extractIntelligence?: boolean;
  extractGraph?: boolean;
  analyzeContract?: boolean;
  analyzeDeposition?: boolean;
  detectContradictions?: boolean;
  evidenceMatrix?: boolean;
  compareDocuments?: boolean;
  importResearchCorpus?: boolean;
  importInjectionAuthority?: boolean;
  researchQuery?: boolean;
  researchMemo?: boolean;
  approveInferentialAttended?: boolean;
  repeatExtract?: boolean;
  actor?: "owner" | "view_only";
  siblingScenario?: string;
  foreignOrgScenario?: string;
  lateDocuments?: string[];
  excludeFromInitial?: string[];
  unprocessedExtraDocument?: string;
  injectAiFailureOn?: "analysis";
  seedProposedMemory?: { title: string; content: string };
  seedRejectedMemory?: { title: string; content: string };
  seedApprovedMemory?: { title: string; content: string };
  supersedeMemory?: {
    oldTitle: string;
    oldContent: string;
    newTitle: string;
    newContent: string;
  };
  review?: {
    timeline?: "approve_first" | "approve_all" | "reject_all" | "leave_proposed";
    facts?: "approve_first" | "approve_all" | "reject_all" | "leave_proposed";
    graph?: "approve_first" | "approve_all" | "reject_all" | "leave_proposed";
    analysis?: "review_first" | "leave_proposed";
    memoryFirst?: boolean;
  };
  downstream?: string[];
};

export type BenchTask = {
  taskId: string;
  scenarioId: string;
  category: string;
  difficulty: string;
  prompt: string;
  groundTruthRef?: string;
  memoryAction?: MemoryBenchAction;
  analysisAction?: AnalysisBenchAction;
  draftAction?: DraftBenchAction;
  graphAction?: GraphBenchAction;
  researchAction?: ResearchBenchAction;
  agentAction?: AgentBenchAction;
  fsAction?: FullSystemBenchAction;
};

export type BenchScenario = {
  dataset: DatasetId;
  scenarioId: string;
  title: string;
  matterType: string;
  scenarioDir: string;
  documents: BenchDocument[];
  tasks: BenchTask[];
};

type V1Matter = {
  scenario_id: string;
  title: string;
  matter_type?: string;
  documents: Array<{ document_id: string; file: string; title: string }>;
};

type V2Scenario = {
  scenario_id: string;
  name: string;
  domain?: string;
  documents: string[];
};

type V1Task = {
  task_id: string;
  scenario_id: string;
  category: string;
  prompt: string;
  difficulty?: string;
  ground_truth_ref?: string;
};

type V2Task = {
  id: string;
  scenario_id: string;
  category: string;
  prompt: string;
  difficulty?: string;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function listScenarioIds(dataset: DatasetId): string[] {
  return readdirSync(scenariosDir(dataset), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function loadV1Scenario(dataset: DatasetId, scenarioId: string): BenchScenario {
  const root = datasetRoot(dataset);
  const scenarioDir = join(scenariosDir(dataset), scenarioId);
  const matter = readJson<V1Matter>(join(scenarioDir, "matter.json"));
  const tasks = readJson<V1Task[]>(join(scenarioDir, "tasks", "tasks.json"));
  return {
    dataset,
    scenarioId: matter.scenario_id,
    title: matter.title,
    matterType: matter.matter_type ?? "SYNTH",
    scenarioDir,
    documents: matter.documents.map((doc) => {
      const relative = doc.file.replace(/^\.?\//, "");
      const absolutePath = assertIngestibleDocumentPath(root, join(scenarioDir, relative));
      return {
        documentId: doc.document_id,
        filename: relative.split("/").pop() ?? relative,
        title: doc.title,
        absolutePath,
      };
    }),
    tasks: tasks.map((task) => ({
      taskId: task.task_id,
      scenarioId: task.scenario_id,
      category: task.category,
      difficulty: task.difficulty ?? "medium",
      prompt: task.prompt,
      groundTruthRef: task.ground_truth_ref,
    })),
  };
}

function isOverlayOnlyScenario(scenarioDir: string): boolean {
  const scenarioPath = join(scenarioDir, "scenario.json");
  if (!existsSync(scenarioPath)) return false;
  const meta = readJson<{ overlay_only?: boolean }>(scenarioPath);
  return meta.overlay_only === true;
}

function loadV2Scenario(dataset: DatasetId, scenarioId: string): BenchScenario {
  const root = datasetRoot(dataset);
  const scenarioDir = join(scenariosDir(dataset), scenarioId);
  const meta = readJson<V2Scenario>(join(scenarioDir, "scenario.json"));
  const tasksPath = join(scenarioDir, "tasks.json");
  const tasks = existsSync(tasksPath) ? readJson<V2Task[]>(tasksPath) : [];
  return {
    dataset,
    scenarioId: meta.scenario_id,
    title: meta.name,
    matterType: meta.domain ?? "SYNTH",
    scenarioDir,
    documents: meta.documents.map((filename) => {
      const absolutePath = assertIngestibleDocumentPath(
        root,
        join(scenarioDir, "documents", filename),
      );
      return {
        documentId: filename.replace(/\.pdf$/i, ""),
        filename,
        title: filename.replace(/\.pdf$/i, "").replace(/_/g, " "),
        absolutePath,
      };
    }),
    tasks: tasks.map((task) => ({
      taskId: task.id,
      scenarioId: task.scenario_id,
      category: task.category,
      difficulty: task.difficulty ?? "medium",
      prompt: task.prompt,
    })),
  };
}

type MemoryOverlayTask = V2Task & { action?: MemoryBenchAction };

/** Loads scenarios and prompts only. Never reads the answer-key directory. */
export function loadCatalog(dataset: DatasetId, scenarioId?: string): BenchScenario[] {
  const ids = scenarioId ? [scenarioId] : listScenarioIds(dataset);
  const scenarios: BenchScenario[] = [];
  for (const id of ids) {
    const scenarioDir = join(scenariosDir(dataset), id);
    if (existsSync(join(scenarioDir, "matter.json"))) {
      scenarios.push(loadV1Scenario(dataset, id));
      continue;
    }
    if (existsSync(join(scenarioDir, "scenario.json"))) {
      if (isOverlayOnlyScenario(scenarioDir)) continue;
      scenarios.push(loadV2Scenario(dataset, id));
      continue;
    }
    throw new Error(`Unknown scenario layout under ${scenarioDir}`);
  }
  return scenarios;
}

/**
 * Memory-mode catalog: same V2 PDFs, overlay tasks only.
 * Does not open hidden_ground_truth.
 */
export function loadMemoryCatalog(dataset: DatasetId, scenarioId?: string): BenchScenario[] {
  if (dataset !== "v2") return [];
  const overlayPath = join(datasetRoot(dataset), "memory", "catalog.json");
  if (!existsSync(overlayPath)) return [];
  const overlay = readJson<{ tasks: MemoryOverlayTask[] }>(overlayPath);
  const byScenario = new Map<string, MemoryOverlayTask[]>();
  for (const task of overlay.tasks) {
    if (scenarioId && task.scenario_id !== scenarioId) continue;
    const list = byScenario.get(task.scenario_id) ?? [];
    list.push(task);
    byScenario.set(task.scenario_id, list);
  }
  const scenarios: BenchScenario[] = [];
  for (const [id, tasks] of byScenario) {
    const base = loadV2Scenario(dataset, id);
    scenarios.push({
      ...base,
      tasks: tasks.map((task) => ({
        taskId: task.id,
        scenarioId: task.scenario_id,
        category: task.category,
        difficulty: task.difficulty ?? "medium",
        prompt: task.prompt,
        memoryAction: task.action,
      })),
    });
  }
  return scenarios;
}

type AnalysisOverlayTask = V2Task & { action?: AnalysisBenchAction };

/** Analysis-mode catalog: same V2 PDFs, overlay tasks only. Does not open hidden_ground_truth. */
export function loadAnalysisCatalog(dataset: DatasetId, scenarioId?: string): BenchScenario[] {
  if (dataset !== "v2") return [];
  const overlayPath = join(datasetRoot(dataset), "analysis", "catalog.json");
  if (!existsSync(overlayPath)) return [];
  const overlay = readJson<{ tasks: AnalysisOverlayTask[] }>(overlayPath);
  const byScenario = new Map<string, AnalysisOverlayTask[]>();
  for (const task of overlay.tasks) {
    if (scenarioId && task.scenario_id !== scenarioId) continue;
    const list = byScenario.get(task.scenario_id) ?? [];
    list.push(task);
    byScenario.set(task.scenario_id, list);
  }
  const scenarios: BenchScenario[] = [];
  for (const [id, tasks] of byScenario) {
    const base = loadV2Scenario(dataset, id);
    scenarios.push({
      ...base,
      tasks: tasks.map((task) => ({
        taskId: task.id,
        scenarioId: task.scenario_id,
        category: task.category,
        difficulty: task.difficulty ?? "medium",
        prompt: task.prompt,
        analysisAction: task.action,
      })),
    });
  }
  return scenarios;
}

/** Deposition-mode catalog: same V2 PDFs, overlay tasks only. Does not open hidden_ground_truth. */
export function loadDepositionCatalog(dataset: DatasetId, scenarioId?: string): BenchScenario[] {
  if (dataset !== "v2") return [];
  const overlayPath = join(datasetRoot(dataset), "deposition", "catalog.json");
  if (!existsSync(overlayPath)) return [];
  const overlay = readJson<{ tasks: AnalysisOverlayTask[] }>(overlayPath);
  const byScenario = new Map<string, AnalysisOverlayTask[]>();
  for (const task of overlay.tasks) {
    if (scenarioId && task.scenario_id !== scenarioId) continue;
    const list = byScenario.get(task.scenario_id) ?? [];
    list.push(task);
    byScenario.set(task.scenario_id, list);
  }
  const scenarios: BenchScenario[] = [];
  for (const [id, tasks] of byScenario) {
    const base = loadV2Scenario(dataset, id);
    scenarios.push({
      ...base,
      tasks: tasks.map((task) => ({
        taskId: task.id,
        scenarioId: task.scenario_id,
        category: task.category,
        difficulty: task.difficulty ?? "medium",
        prompt: task.prompt,
        analysisAction: task.action,
      })),
    });
  }
  return scenarios;
}

/** Contract-mode catalog: same V2 PDFs, overlay tasks only. Does not open hidden_ground_truth. */
export function loadContractCatalog(dataset: DatasetId, scenarioId?: string): BenchScenario[] {
  if (dataset !== "v2") return [];
  const overlayPath = join(datasetRoot(dataset), "contract", "catalog.json");
  if (!existsSync(overlayPath)) return [];
  const overlay = readJson<{ tasks: AnalysisOverlayTask[] }>(overlayPath);
  const byScenario = new Map<string, AnalysisOverlayTask[]>();
  for (const task of overlay.tasks) {
    if (scenarioId && task.scenario_id !== scenarioId) continue;
    const list = byScenario.get(task.scenario_id) ?? [];
    list.push(task);
    byScenario.set(task.scenario_id, list);
  }
  const scenarios: BenchScenario[] = [];
  for (const [id, tasks] of byScenario) {
    const base = loadV2Scenario(dataset, id);
    scenarios.push({
      ...base,
      tasks: tasks.map((task) => ({
        taskId: task.id,
        scenarioId: task.scenario_id,
        category: task.category,
        difficulty: task.difficulty ?? "medium",
        prompt: task.prompt,
        analysisAction: task.action,
      })),
    });
  }
  return scenarios;
}

/** Evidence-matrix overlay: same V2 PDFs. Does not open hidden_ground_truth. */
export function loadEvidenceCatalog(dataset: DatasetId, scenarioId?: string): BenchScenario[] {
  if (dataset !== "v2") return [];
  const overlayPath = join(datasetRoot(dataset), "evidence", "catalog.json");
  if (!existsSync(overlayPath)) return [];
  const overlay = readJson<{ tasks: AnalysisOverlayTask[] }>(overlayPath);
  const byScenario = new Map<string, AnalysisOverlayTask[]>();
  for (const task of overlay.tasks) {
    if (scenarioId && task.scenario_id !== scenarioId) continue;
    const list = byScenario.get(task.scenario_id) ?? [];
    list.push(task);
    byScenario.set(task.scenario_id, list);
  }
  const scenarios: BenchScenario[] = [];
  for (const [id, tasks] of byScenario) {
    const base = loadV2Scenario(dataset, id);
    scenarios.push({
      ...base,
      tasks: tasks.map((task) => ({
        taskId: task.id,
        scenarioId: task.scenario_id,
        category: task.category,
        difficulty: task.difficulty ?? "medium",
        prompt: task.prompt,
        analysisAction: task.action,
      })),
    });
  }
  return scenarios;
}

type DraftOverlayTask = V2Task & { action?: DraftBenchAction };

/** Draft overlay: same V2 PDFs. Does not open hidden_ground_truth. */
export function loadDraftCatalog(dataset: DatasetId, scenarioId?: string): BenchScenario[] {
  if (dataset !== "v2") return [];
  const overlayPath = join(datasetRoot(dataset), "draft", "catalog.json");
  if (!existsSync(overlayPath)) return [];
  const overlay = readJson<{ tasks: DraftOverlayTask[] }>(overlayPath);
  const byScenario = new Map<string, DraftOverlayTask[]>();
  for (const task of overlay.tasks) {
    if (scenarioId && task.scenario_id !== scenarioId) continue;
    const list = byScenario.get(task.scenario_id) ?? [];
    list.push(task);
    byScenario.set(task.scenario_id, list);
  }
  const scenarios: BenchScenario[] = [];
  for (const [id, tasks] of byScenario) {
    const base = loadV2Scenario(dataset, id);
    scenarios.push({
      ...base,
      tasks: tasks.map((task) => ({
        taskId: task.id,
        scenarioId: task.scenario_id,
        category: task.category,
        difficulty: task.difficulty ?? "medium",
        prompt: task.prompt,
        draftAction: task.action,
      })),
    });
  }
  return scenarios;
}

type GraphOverlayTask = V2Task & { action?: GraphBenchAction };

/** Graph overlay: same V2 PDFs. Does not open hidden_ground_truth. */
export function loadGraphCatalog(dataset: DatasetId, scenarioId?: string): BenchScenario[] {
  if (dataset !== "v2") return [];
  const overlayPath = join(datasetRoot(dataset), "graph", "catalog.json");
  if (!existsSync(overlayPath)) return [];
  const overlay = readJson<{ tasks: GraphOverlayTask[] }>(overlayPath);
  const byScenario = new Map<string, GraphOverlayTask[]>();
  for (const task of overlay.tasks) {
    if (scenarioId && task.scenario_id !== scenarioId) continue;
    const list = byScenario.get(task.scenario_id) ?? [];
    list.push(task);
    byScenario.set(task.scenario_id, list);
  }
  const scenarios: BenchScenario[] = [];
  for (const [id, tasks] of byScenario) {
    const base = loadV2Scenario(dataset, id);
    scenarios.push({
      ...base,
      tasks: tasks.map((task) => ({
        taskId: task.id,
        scenarioId: task.scenario_id,
        category: task.category,
        difficulty: task.difficulty ?? "medium",
        prompt: task.prompt,
        graphAction: task.action,
      })),
    });
  }
  return scenarios;
}

type ResearchOverlayTask = V2Task & { action?: ResearchBenchAction };

/** Research overlay: same V2 PDFs plus imported local/synthetic corpus. Does not open hidden_ground_truth. */
export function loadResearchCatalog(dataset: DatasetId, scenarioId?: string): BenchScenario[] {
  if (dataset !== "v2") return [];
  const overlayPath = join(datasetRoot(dataset), "research", "catalog.json");
  if (!existsSync(overlayPath)) return [];
  const overlay = readJson<{ tasks: ResearchOverlayTask[] }>(overlayPath);
  const byScenario = new Map<string, ResearchOverlayTask[]>();
  for (const task of overlay.tasks) {
    if (scenarioId && task.scenario_id !== scenarioId) continue;
    const list = byScenario.get(task.scenario_id) ?? [];
    list.push(task);
    byScenario.set(task.scenario_id, list);
  }
  const scenarios: BenchScenario[] = [];
  for (const [id, tasks] of byScenario) {
    const base = loadV2Scenario(dataset, id);
    scenarios.push({
      ...base,
      tasks: tasks.map((task) => ({
        taskId: task.id,
        scenarioId: task.scenario_id,
        category: task.category,
        difficulty: task.difficulty ?? "medium",
        prompt: task.prompt,
        researchAction: task.action,
      })),
    });
  }
  return scenarios;
}

type AgentOverlayTask = V2Task & { action?: AgentBenchAction };

/** Agent overlay: same V2 PDFs. Does not open hidden_ground_truth. */
export function loadAgentsCatalog(dataset: DatasetId, scenarioId?: string): BenchScenario[] {
  if (dataset !== "v2") return [];
  const overlayPath = join(datasetRoot(dataset), "agents", "catalog.json");
  if (!existsSync(overlayPath)) return [];
  const overlay = readJson<{ tasks: AgentOverlayTask[] }>(overlayPath);
  const byScenario = new Map<string, AgentOverlayTask[]>();
  for (const task of overlay.tasks) {
    if (scenarioId && task.scenario_id !== scenarioId) continue;
    const list = byScenario.get(task.scenario_id) ?? [];
    list.push(task);
    byScenario.set(task.scenario_id, list);
  }
  const scenarios: BenchScenario[] = [];
  for (const [id, tasks] of byScenario) {
    const base = loadV2Scenario(dataset, id);
    scenarios.push({
      ...base,
      tasks: tasks.map((task) => ({
        taskId: task.id,
        scenarioId: task.scenario_id,
        category: task.category,
        difficulty: task.difficulty ?? "medium",
        prompt: task.prompt,
        agentAction: task.action,
      })),
    });
  }
  return scenarios;
}

type FullSystemOverlayTask = V2Task & { action?: FullSystemBenchAction };

/** Full-system overlay: overlay_only V2 scenarios. Does not open hidden_ground_truth. */
export function loadFullSystemCatalog(dataset: DatasetId, scenarioId?: string): BenchScenario[] {
  if (dataset !== "v2") return [];
  const overlayPath = join(datasetRoot(dataset), "full-system", "catalog.json");
  if (!existsSync(overlayPath)) return [];
  const overlay = readJson<{ tasks: FullSystemOverlayTask[] }>(overlayPath);
  const byScenario = new Map<string, FullSystemOverlayTask[]>();
  for (const task of overlay.tasks) {
    if (scenarioId && task.scenario_id !== scenarioId) continue;
    const list = byScenario.get(task.scenario_id) ?? [];
    list.push(task);
    byScenario.set(task.scenario_id, list);
  }
  const scenarios: BenchScenario[] = [];
  for (const [id, tasks] of byScenario) {
    const base = loadV2Scenario(dataset, id);
    scenarios.push({
      ...base,
      tasks: tasks.map((task) => ({
        taskId: task.id,
        scenarioId: task.scenario_id,
        category: task.category,
        difficulty: task.difficulty ?? "medium",
        prompt: task.prompt,
        fsAction: task.action,
      })),
    });
  }
  return scenarios;
}

/** Load an overlay_only V2 scenario's documents without opening hidden_ground_truth. */
export function loadOverlayV2Scenario(dataset: DatasetId, scenarioId: string): BenchScenario {
  return loadV2Scenario(dataset, scenarioId);
}
