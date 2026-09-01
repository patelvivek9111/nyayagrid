import type { BenchTask } from "./catalog";

export type ExecutionTarget =
  | "case_qa"
  | "contract_compare"
  | "contradiction"
  | "timeline"
  | "graph"
  | "memory"
  | "research"
  | "draft"
  | "analysis"
  | "professional_analysis"
  | "agent"
  | "full_system"
  | "not_applicable";

export type ExecutionMode =
  | "case-qa"
  | "full-system"
  | "compare"
  | "contradictions"
  | "compare-contradiction"
  | "timeline"
  | "graph"
  | "memory"
  | "research"
  | "draft"
  | "analysis"
  | "deposition"
  | "contract"
  | "evidence"
  | "agents"
  | "full-system-fs";

const CATEGORY_TARGET: Record<string, ExecutionTarget> = {
  case_qa: "case_qa",
  insufficient: "case_qa",
  numeric: "case_qa",
  numeric_precision: "case_qa",
  adversarial: "case_qa",
  email_reliability: "case_qa",
  citation: "case_qa",
  quote_accuracy: "case_qa",
  termination: "case_qa",
  reasoning: "case_qa",
  missing_exhibit: "case_qa",
  entity_resolution: "case_qa",
  cross_document: "case_qa",
  timeline: "timeline",
  contract_compare: "contract_compare",
  contract_decoy: "contract_compare",
  decoy: "contract_compare",
  contradiction: "contradiction",
  false_contradiction: "contradiction",
  memory: "memory",
  analysis: "professional_analysis",
  deposition: "professional_analysis",
  contract: "professional_analysis",
  evidence: "professional_analysis",
  draft: "draft",
  graph: "graph",
  research: "research",
  agent: "agent",
  full_system: "full_system",
};

const MODE_FILTER: Partial<Record<ExecutionMode, ExecutionTarget>> = {
  compare: "contract_compare",
  contradictions: "contradiction",
  timeline: "timeline",
  graph: "graph",
  memory: "memory",
  research: "research",
  draft: "draft",
  analysis: "professional_analysis",
  deposition: "professional_analysis",
  contract: "professional_analysis",
  evidence: "professional_analysis",
  agents: "agent",
  "full-system-fs": "full_system",
  "case-qa": "case_qa",
};

export function targetForCategory(category: string): ExecutionTarget {
  return CATEGORY_TARGET[category] ?? "case_qa";
}

export function executionTargetFor(task: BenchTask, mode: ExecutionMode): ExecutionTarget {
  const mapped = targetForCategory(task.category);
  if (mode === "case-qa") return "case_qa";
  if (mode === "full-system") return mapped;
  if (mode === "compare-contradiction") {
    return mapped === "contract_compare" || mapped === "contradiction" ? mapped : "not_applicable";
  }
  if (mode === "deposition") {
    return task.category === "deposition" ? "professional_analysis" : "not_applicable";
  }
  if (mode === "contract") {
    return task.category === "contract" ? "professional_analysis" : "not_applicable";
  }
  if (mode === "evidence") {
    return task.category === "evidence" ? "professional_analysis" : "not_applicable";
  }
  if (mode === "draft") {
    return task.category === "draft" ? "draft" : "not_applicable";
  }
  if (mode === "graph") {
    return task.category === "graph" ? "graph" : "not_applicable";
  }
  if (mode === "research") {
    return task.category === "research" ? "research" : "not_applicable";
  }
  if (mode === "agents") {
    return task.category === "agent" ? "agent" : "not_applicable";
  }
  if (mode === "full-system-fs") {
    return task.category === "full_system" ? "full_system" : "not_applicable";
  }
  if (mode === "analysis") {
    return task.category === "analysis" ? "professional_analysis" : "not_applicable";
  }
  const wanted = MODE_FILTER[mode];
  if (!wanted) return mapped;
  return mapped === wanted ? mapped : "not_applicable";
}

export function isApplicable(task: BenchTask, mode: ExecutionMode): boolean {
  return executionTargetFor(task, mode) !== "not_applicable";
}
