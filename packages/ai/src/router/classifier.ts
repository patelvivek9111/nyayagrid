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
import {
  namedInstrumentFromQuestion,
  instrumentMentionedInText,
} from "../operative-facts";

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

export function isKnownRouterSchemaName(schemaName: string): boolean {
  return Object.prototype.hasOwnProperty.call(SCHEMA_TO_SUBSYSTEM, schemaName);
}

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
  const signals = [...new Set(params.signals ?? [])];
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

function uniqueSignals(signals: RiskSignal[]): RiskSignal[] {
  return [...new Set(signals)];
}

function userAndSourceText(request: AiGenerateRequest): { question: string; sources: string } {
  const user = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const questionMatch = user.match(/Question:\s*([\s\S]*?)(?:\nSources:|\nMatterSources:|\nLegalAuthority:|$)/i);
  const question =
    questionMatch?.[1]?.trim() ||
    user
      .split(/\nSources:|\nMatterSources:/i)[0]
      ?.replace(/^[\s\S]*Question:\s*/i, "")
      .trim() ||
    user;
  const sources =
    user.split(/\nSources:\s*|\nMatterSources:\s*/i)[1]?.split(
      /\n+EvidenceAssessment:|\n\nVerified|\nLegalAuthority:/i,
    )[0] ?? "";
  return { question, sources };
}

/**
 * Deterministic risk from the request itself. Callers may omit riskSignals;
 * Auto must not treat missing-instrument or empty retrieval as low-risk Ask.
 */
export function deriveRiskSignalsFromRequest(request: AiGenerateRequest): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const { question, sources } = userAndSourceText(request);
  const sourceBlob = sources.trim();
  const sourceMissing = !sourceBlob || sourceBlob === "(none)";
  const sourceLineCount = sourceBlob
    ? sourceBlob.split("\n").filter((line) => line.trim().startsWith("-")).length
    : 0;

  if (sourceMissing || sourceLineCount < 2) {
    signals.push("weak_retrieval");
  }

  const named = namedInstrumentFromQuestion(question);
  if (named && (sourceMissing || !instrumentMentionedInText(named, sourceBlob))) {
    signals.push("missing_exhibit");
  }

  if (
    /\b(currently|current|as of|operative|in force)\b/i.test(question) &&
    /\b(amend|notice|term|require|provision|agreement|contract|cap|payment|indemnit)\b/i.test(
      question,
    )
  ) {
    signals.push("uncertain_currentness");
  }

  // Current rent/fee asked against a later-effective instrument in sources — not LOW.
  if (
    /\b(currently|current|as of)\b/i.test(question) &&
    /\b(rent|fee|cap|notice period)\b/i.test(question) &&
    /\b(becomes effective|effective (?:on )?(?:january|february|march|april|may|june|july|august|september|october|november|december)|beginning (?:on )?(?:january|february|20))\b/i.test(
      sourceBlob,
    )
  ) {
    signals.push("uncertain_currentness");
  }

  if (asksCourtAssignmentIdentity(question) && !textIdentifiesCourtAssignment(sourceBlob)) {
    signals.push("unsupported_proposition");
  }

  const stateHits = distinctStateMentions(question);
  if (stateHits >= 2) {
    signals.push("multiple_jurisdictions");
  }

  if (
    /\b(inconsistent|contradict|conflict with|do the .{0,40}agree)\b/i.test(question) ||
    /source role:/i.test(sourceBlob)
  ) {
    const roles = sourceBlob.match(/source role:\s*([a-z_]+)/gi) ?? [];
    const uniqueRoles = new Set(roles.map((row) => row.toLowerCase()));
    if (uniqueRoles.size > 1 || /\b(inconsistent|contradict|conflict)\b/i.test(question)) {
      signals.push("conflicting_evidence");
    }
  }

  return uniqueSignals(signals);
}

/** Keep in sync with evidence-assessment court-identity heuristics. No task-id special cases. */
function asksCourtAssignmentIdentity(question: string): boolean {
  return (
    /\b(which judge|what judge|assigned judge|presiding judge|name of the judge)\b/i.test(
      question,
    ) ||
    /\b(docket number|case number|civil action number|index number)\b/i.test(question) ||
    /\bassigned to this (?:case|matter)\b/i.test(question)
  );
}

function textIdentifiesCourtAssignment(text: string): boolean {
  return /\b(?:hon(?:orable|\.)\s+[A-Z]|judge\s+[A-Z][a-z]+|presiding judge|docket\s*(?:no\.?|number|#)|case no\.|civil action no\.|index no\.)\b/i.test(
    text,
  );
}

function distinctStateMentions(question: string): number {
  let remaining = question.toLowerCase();
  const ordered = [...STATE_NAMES].sort((a, b) => b.length - a.length);
  let n = 0;
  for (const name of ordered) {
    if (remaining.includes(name)) {
      n += 1;
      remaining = remaining.split(name).join(" ");
    }
  }
  return n;
}

const STATE_NAMES = [
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "west virginia",
  "wisconsin",
  "wyoming",
  "district of columbia",
];
