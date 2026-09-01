export const FAILURE_CLASSES = [
  "RETRIEVAL_FAILURE",
  "REASONING_FAILURE",
  "GROUNDING_FAILURE",
  "CITATION_FAILURE",
  "TIMELINE_FAILURE",
  "GRAPH_FAILURE",
  "MEMORY_FAILURE",
  "RESEARCH_FAILURE",
  "DRAFT_FAILURE",
  "AGENT_PLANNING_FAILURE",
  "AGENT_TOOL_SELECTION_FAILURE",
  "AGENT_APPROVAL_FAILURE",
  "AGENT_EXECUTION_FAILURE",
    "AGENT_ARTIFACT_FAILURE",
    "FULL_SYSTEM_TRUST",
    "FULL_SYSTEM_ISOLATION",
    "FULL_SYSTEM_PERMISSION",
    "INFRASTRUCTURE_FAILURE",
  "GRADER_FAILURE",
  "POSSIBLE_BENCHMARK_DEFECT",
  "COMPARE_RETRIEVAL_FAILURE",
  "COMPARE_WRONG_DOCUMENT_PAIR",
  "COMPARE_CHANGE_EXTRACTION",
  "COMPARE_NUMERIC_EXTRACTION",
  "COMPARE_MATERIALITY",
  "COMPARE_DECOY_PROMOTION",
  "COMPARE_SUMMARY_HALLUCINATION",
  "COMPARE_PROVENANCE",
  "COMPARE_PERSISTENCE",
  "CONTRADICTION_RETRIEVAL_FAILURE",
  "CONTRADICTION_WRONG_SOURCE_PAIR",
  "CONTRADICTION_FALSE_POSITIVE",
  "CONTRADICTION_MISSED",
  "CONTRADICTION_TENSION_MISCLASSIFIED",
  "CONTRADICTION_COMPATIBLE_MISCLASSIFIED",
  "CONTRADICTION_ACTOR_INFERENCE",
  "CONTRADICTION_DATE_PRECISION",
  "CONTRADICTION_PROVENANCE",
  "TIMELINE_EVENT_EXTRACTION",
  "TIMELINE_INVENTED_EVENT",
  "TIMELINE_DATE_EXTRACTION",
  "TIMELINE_DATE_PRECISION",
  "TIMELINE_ACTOR_EXTRACTION",
  "TIMELINE_EVENT_TYPE",
  "TIMELINE_DEDUPE",
  "TIMELINE_SOURCE_MAPPING",
  "TIMELINE_REJECTION_REPROPOSAL",
  "TIMELINE_FORMATTER_TRUST",
  "TIMELINE_RETRIEVAL",
  "MEMORY_CREATION",
  "MEMORY_PROPOSITION",
  "MEMORY_PROVENANCE",
  "MEMORY_TRUST_CLASSIFICATION",
  "MEMORY_MANUAL_SEMANTICS",
  "MEMORY_INFERENCE_UPGRADE",
  "MEMORY_DISPUTE",
  "MEMORY_SUPERSESSION",
  "MEMORY_LIFECYCLE",
  "MEMORY_QA_BOUNDARY",
  "MEMORY_DRAFT_BOUNDARY",
  "MEMORY_AGENT_BOUNDARY",
  "MEMORY_GRAPH_BOUNDARY",
  "ANALYSIS_FAILURE",
  "ANALYSIS_RETRIEVAL",
  "ANALYSIS_DOCUMENT_SELECTION",
  "ANALYSIS_FINDING_EXTRACTION",
  "ANALYSIS_FINDING_CLASSIFICATION",
  "ANALYSIS_OPERATIVE_SOURCE",
  "ANALYSIS_TEMPORAL",
  "ANALYSIS_NUMERIC",
  "ANALYSIS_ACTOR_INFERENCE",
  "ANALYSIS_EVIDENCE_ROLE",
  "ANALYSIS_ABSTENTION",
  "ANALYSIS_PROVENANCE",
  "ANALYSIS_DUPLICATE",
  "ANALYSIS_REVIEW_LIFECYCLE",
  "ANALYSIS_DOWNSTREAM_TRUST",
  "ANALYSIS_EXECUTION_ROUTING",
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

export function classifyGradeFailure(params: {
  detail: string;
  expectationType: string;
  executionTarget?: string;
  taxonomy?: string;
}): FailureClass | undefined {
  if (params.detail.startsWith("INFRASTRUCTURE:")) return "INFRASTRUCTURE_FAILURE";
  if (params.executionTarget === "timeline") {
    if (params.taxonomy === "event extraction") return "TIMELINE_EVENT_EXTRACTION";
    if (params.taxonomy === "invented event") return "TIMELINE_INVENTED_EVENT";
    if (params.taxonomy === "date extraction") return "TIMELINE_DATE_EXTRACTION";
    if (params.taxonomy === "date precision") return "TIMELINE_DATE_PRECISION";
    if (params.taxonomy === "actor extraction") return "TIMELINE_ACTOR_EXTRACTION";
    if (params.taxonomy === "event type") return "TIMELINE_EVENT_TYPE";
    if (params.taxonomy === "dedupe") return "TIMELINE_DEDUPE";
    if (params.taxonomy === "source mapping") return "TIMELINE_SOURCE_MAPPING";
    if (params.taxonomy === "rejected-event re-proposal") return "TIMELINE_REJECTION_REPROPOSAL";
    if (params.taxonomy === "formatter/trust-boundary") return "TIMELINE_FORMATTER_TRUST";
    if (params.taxonomy === "retrieval/source visibility") return "TIMELINE_RETRIEVAL";
    if (params.taxonomy === "infrastructure") return "INFRASTRUCTURE_FAILURE";
    if (params.taxonomy === "benchmark/grader defect") return "POSSIBLE_BENCHMARK_DEFECT";
    return "TIMELINE_FAILURE";
  }
  if (params.executionTarget === "graph") return "GRAPH_FAILURE";
  if (params.executionTarget === "memory") {
    if (params.taxonomy === "creation") return "MEMORY_CREATION";
    if (params.taxonomy === "proposition extraction") return "MEMORY_PROPOSITION";
    if (params.taxonomy === "provenance") return "MEMORY_PROVENANCE";
    if (params.taxonomy === "trust classification") return "MEMORY_TRUST_CLASSIFICATION";
    if (params.taxonomy === "manual-memory semantics") return "MEMORY_MANUAL_SEMANTICS";
    if (params.taxonomy === "inference upgrade") return "MEMORY_INFERENCE_UPGRADE";
    if (params.taxonomy === "dispute handling") return "MEMORY_DISPUTE";
    if (params.taxonomy === "supersession") return "MEMORY_SUPERSESSION";
    if (params.taxonomy === "lifecycle/rejection") return "MEMORY_LIFECYCLE";
    if (params.taxonomy === "Q&A boundary") return "MEMORY_QA_BOUNDARY";
    if (params.taxonomy === "Draft boundary") return "MEMORY_DRAFT_BOUNDARY";
    if (params.taxonomy === "Agent boundary") return "MEMORY_AGENT_BOUNDARY";
    if (params.taxonomy === "Graph boundary") return "MEMORY_GRAPH_BOUNDARY";
    if (params.taxonomy === "infrastructure") return "INFRASTRUCTURE_FAILURE";
    if (params.taxonomy === "benchmark/grader defect") return "POSSIBLE_BENCHMARK_DEFECT";
    return "MEMORY_FAILURE";
  }
  if (params.executionTarget === "professional_analysis") {
    if (params.taxonomy === "retrieval") return "ANALYSIS_RETRIEVAL";
    if (params.taxonomy === "document selection") return "ANALYSIS_DOCUMENT_SELECTION";
    if (params.taxonomy === "finding extraction") return "ANALYSIS_FINDING_EXTRACTION";
    if (params.taxonomy === "finding classification") return "ANALYSIS_FINDING_CLASSIFICATION";
    if (params.taxonomy === "operative-source selection") return "ANALYSIS_OPERATIVE_SOURCE";
    if (params.taxonomy === "temporal reasoning") return "ANALYSIS_TEMPORAL";
    if (params.taxonomy === "numeric extraction") return "ANALYSIS_NUMERIC";
    if (params.taxonomy === "actor inference") return "ANALYSIS_ACTOR_INFERENCE";
    if (params.taxonomy === "evidence-role classification") return "ANALYSIS_EVIDENCE_ROLE";
    if (params.taxonomy === "missing-evidence abstention") return "ANALYSIS_ABSTENTION";
    if (params.taxonomy === "provenance") return "ANALYSIS_PROVENANCE";
    if (params.taxonomy === "duplicate/noise") return "ANALYSIS_DUPLICATE";
    if (params.taxonomy === "review lifecycle") return "ANALYSIS_REVIEW_LIFECYCLE";
    if (params.taxonomy === "downstream trust boundary") return "ANALYSIS_DOWNSTREAM_TRUST";
    if (params.taxonomy === "execution routing") return "ANALYSIS_EXECUTION_ROUTING";
    if (params.taxonomy === "infrastructure") return "INFRASTRUCTURE_FAILURE";
    if (params.taxonomy === "benchmark/grader defect") return "POSSIBLE_BENCHMARK_DEFECT";
    return "ANALYSIS_FAILURE";
  }
  if (params.executionTarget === "research") return "RESEARCH_FAILURE";
  if (params.executionTarget === "draft") return "DRAFT_FAILURE";
  if (params.executionTarget === "agent") return "AGENT_EXECUTION_FAILURE";
  if (params.executionTarget === "full_system") {
    if (params.taxonomy === "L" || params.taxonomy === "K") return "FULL_SYSTEM_ISOLATION";
    if (params.taxonomy === "K") return "FULL_SYSTEM_PERMISSION";
    return "FULL_SYSTEM_TRUST";
  }
  if (params.executionTarget === "contract_compare") {
    if (params.taxonomy === "wrong version/document pair") return "COMPARE_WRONG_DOCUMENT_PAIR";
    if (params.taxonomy === "change extraction") return "COMPARE_CHANGE_EXTRACTION";
    if (params.taxonomy === "numeric extraction") return "COMPARE_NUMERIC_EXTRACTION";
    if (params.taxonomy === "materiality") return "COMPARE_MATERIALITY";
    if (params.taxonomy === "decoy promotion") return "COMPARE_DECOY_PROMOTION";
    if (params.taxonomy === "summary hallucination") return "COMPARE_SUMMARY_HALLUCINATION";
    if (params.taxonomy === "provenance") return "COMPARE_PROVENANCE";
    if (params.taxonomy === "persistence") return "COMPARE_PERSISTENCE";
    if (params.taxonomy === "retrieval") return "COMPARE_RETRIEVAL_FAILURE";
    if (params.taxonomy === "infrastructure") return "INFRASTRUCTURE_FAILURE";
    if (params.taxonomy === "benchmark/grader defect") return "POSSIBLE_BENCHMARK_DEFECT";
  }
  if (params.executionTarget === "contradiction") {
    if (params.taxonomy === "wrong source pair") return "CONTRADICTION_WRONG_SOURCE_PAIR";
    if (params.taxonomy === "false contradiction") return "CONTRADICTION_FALSE_POSITIVE";
    if (params.taxonomy === "missed contradiction") return "CONTRADICTION_MISSED";
    if (params.taxonomy === "tension misclassified") return "CONTRADICTION_TENSION_MISCLASSIFIED";
    if (params.taxonomy === "compatible evidence misclassified") {
      return "CONTRADICTION_COMPATIBLE_MISCLASSIFIED";
    }
    if (params.taxonomy === "actor inference") return "CONTRADICTION_ACTOR_INFERENCE";
    if (params.taxonomy === "date precision") return "CONTRADICTION_DATE_PRECISION";
    if (params.taxonomy === "provenance") return "CONTRADICTION_PROVENANCE";
    if (params.taxonomy === "retrieval") return "CONTRADICTION_RETRIEVAL_FAILURE";
    if (params.taxonomy === "infrastructure") return "INFRASTRUCTURE_FAILURE";
    if (params.taxonomy === "benchmark/grader defect") return "POSSIBLE_BENCHMARK_DEFECT";
  }
  if (params.detail.includes("Overclaimed") || params.detail.includes("silence"))
    return "GROUNDING_FAILURE";
  if (params.detail.includes("retroactivity") || params.detail.includes("contradiction")) {
    return "REASONING_FAILURE";
  }
  if (params.expectationType === "must_cite" || params.detail.includes("citation"))
    return "CITATION_FAILURE";
  return undefined;
}
