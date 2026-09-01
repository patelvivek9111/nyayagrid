/**
 * Deterministic-first task and risk classification. No LLM call to choose an LLM.
 */

import type {
  AiGenerateRequest,
  CertificationSubsystem,
  RiskLevel,
  RiskSignal,
  RouterSubsystem,
} from "../provider-contract";
import { CERTIFICATION_SUBSYSTEMS } from "../provider-contract";

const SCHEMA_TO_SUBSYSTEM: Record<string, RouterSubsystem> = {
  evidence_assessment: "evidence",
  student_case_brief: "professor",
  professor_answer: "professor",
  student_case_comparison: "professor",
  matter_intelligence_extraction: "timeline",
  graph_relationship_extraction: "graph",
  matter_memory_proposal: "memory",
  matter_summary: "ask",
  draft_generation: "draft",
  contract_analysis: "contract",
  redline_suggestions: "contract",
  deposition_analysis: "deposition",
  contradiction_analysis: "contradiction",
  discovery_classification: "evidence",
  legal_issue_extraction: "research",
  contrary_authority_search: "research",
  research_synthesis: "research",
  authority_summary: "research",
  research_memo: "research",
  intent_classification: "agents",
  agent_plan: "agents",
  document_comparison_summary: "compare",
  guideAnswer: "guide",
  guideDocumentExplanation: "guide",
  consultationPacket: "guide",
};

export function classifyTask(request: AiGenerateRequest): RouterSubsystem {
  if (request.routing?.subsystem) return request.routing.subsystem;
  const mapped = request.schemaName ? SCHEMA_TO_SUBSYSTEM[request.schemaName] : undefined;
  if (mapped) return mapped;
  const system = request.messages.find((m) => m.role === "system")?.content ?? "";
  if (/synthesize legal research|legal research memo|LegalAuthority/i.test(system)) {
    return "research";
  }
  if (/generate legal draft content/i.test(system)) return "draft";
  if (/analyze contract documents|propose contract redline/i.test(system)) return "contract";
  if (/analyze deposition transcripts/i.test(system)) return "deposition";
  if (/identify potential contradictions/i.test(system)) return "contradiction";
  if (/propose graph relationships/i.test(system)) return "graph";
  if (/propose durable Matter Memory/i.test(system)) return "memory";
  if (/extract proposed matter intelligence|Extract proposed timeline/i.test(system)) {
    return "timeline";
  }
  if (/Nyaya Guide|plain language/i.test(system)) return "guide";
  if (/nyaya professor|student case/i.test(system)) return "professor";
  if (/classify the user's request intent|operational agent execution/i.test(system)) {
    return "agents";
  }
  return "ask";
}

export function toCertificationSubsystem(
  subsystem: RouterSubsystem,
): CertificationSubsystem {
  if ((CERTIFICATION_SUBSYSTEMS as readonly string[]).includes(subsystem)) {
    return subsystem as CertificationSubsystem;
  }
  if (subsystem === "professor" || subsystem === "guide") return "ask";
  return "ask";
}

const HIGH_STAKES_DRAFTS = new Set([
  "complaint",
  "motion",
  "brief",
  "discovery_request",
  "settlement_agreement",
]);

export function classifyRisk(params: {
  subsystem: RouterSubsystem;
  signals?: RiskSignal[];
  contextTokensEstimate?: number;
  draftType?: string;
}): { level: RiskLevel; signals: RiskSignal[] } {
  const signals = [...(params.signals ?? [])];
  if (params.subsystem === "contradiction" && !signals.includes("contradiction_request")) {
    signals.push("contradiction_request");
  }
  if (params.draftType && HIGH_STAKES_DRAFTS.has(params.draftType)) {
    if (!signals.includes("high_stakes_draft")) signals.push("high_stakes_draft");
  }
  if ((params.contextTokensEstimate ?? 0) > 24_000 && !signals.includes("long_context")) {
    signals.push("long_context");
  }

  const critical = signals.some(
    (s) =>
      s === "unsupported_proposition" ||
      s === "missing_exhibit" ||
      s === "critical_deadline",
  );
  if (critical) return { level: "CRITICAL", signals };

  const highTriggers: RiskSignal[] = [
    "multiple_jurisdictions",
    "limited_coverage",
    "unvalidated_coverage",
    "conflicting_authorities",
    "conflicting_evidence",
    "uncertain_currentness",
    "high_stakes_draft",
    "contradiction_request",
    "low_citation_coverage",
  ];
  if (signals.some((s) => highTriggers.includes(s))) {
    return { level: "HIGH", signals };
  }

  if (
    signals.includes("missing_governing_law") ||
    signals.includes("weak_retrieval") ||
    signals.includes("long_context") ||
    signals.includes("model_uncertainty")
  ) {
    return { level: "NORMAL", signals };
  }

  if (params.subsystem === "ask" && signals.length === 0) {
    return { level: "LOW", signals };
  }
  return { level: signals.length === 0 ? "NORMAL" : "NORMAL", signals };
}
