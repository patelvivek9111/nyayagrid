import { buildLawEvidenceBundle, toStructuredAnswerContext } from "./law-evidence-join";
import type { EvidenceCorpusItem } from "./evidence-retrieval";
import type { RetrievedAuthorityHit, RetrievedLegalStandard } from "../legal/retrieval";
import type { QueryContext, StructuredAnswerContext } from "./types";

/**
 * Builds the Week 4 combined Ask context for law-firm or prosecution questions.
 * Callers supply already-scoped evidence and authority candidates.
 */
export function buildAskNyayaCombinedContext(params: {
  context: QueryContext;
  evidenceCorpus: EvidenceCorpusItem[];
  authorityHits: RetrievedAuthorityHit[];
  standards?: RetrievedLegalStandard[];
  contraryAuthorityIds?: string[];
  facts?: Array<{
    id: string;
    text: string;
    provenance: StructuredAnswerContext["FACTS"][number]["provenance"];
  }>;
  requirements?: Array<{ id: string; text: string; claimOrChargeId: string; status: string }>;
  missingEvidence?: Array<{ id: string; description: string; relatedRequirementId: string | null }>;
}): {
  bundle: ReturnType<typeof buildLawEvidenceBundle>;
  structured: StructuredAnswerContext;
} {
  const bundle = buildLawEvidenceBundle(params);
  return { bundle, structured: toStructuredAnswerContext(bundle) };
}

/** Compact prompt block for Ask Nyaya. Never includes a guilt conclusion. */
export function formatStructuredAnswerContextForPrompt(structured: StructuredAnswerContext): string {
  const lines = [
    "WEEK4_COMBINED_RETRIEVAL_CONTEXT (grounded; do not invent sources or guilt conclusions):",
    `QUESTION: ${structured.QUESTION}`,
    `ISSUES: ${structured.ISSUES.map((issue) => `${issue.issueType}:${issue.description}`).join(" | ") || "(none)"}`,
    `FACTS: ${structured.FACTS.map((fact) => `${fact.id}:${fact.text}`).join(" | ") || "(none)"}`,
    `EVIDENCE_FOR: ${structured.EVIDENCE_FOR.map((item) => `${item.id}:${item.relation}:${item.text}`).join(" | ") || "(none)"}`,
    `EVIDENCE_AGAINST: ${structured.EVIDENCE_AGAINST.map((item) => `${item.id}:${item.relation}:${item.text}`).join(" | ") || "(none)"}`,
    `MISSING_EVIDENCE: ${structured.MISSING_EVIDENCE.map((item) => item.description).join(" | ") || "(none)"}`,
    `LEGAL_STANDARDS: ${structured.LEGAL_STANDARDS.map((std) => std.sourceCitation || std.ruleText).join(" | ") || "(none)"}`,
    `BINDING_AUTHORITY: ${structured.BINDING_AUTHORITY.map((hit) => {
      const row = hit as { authorityId?: string; citation?: string | null };
      return `${row.authorityId ?? "?"}:${row.citation ?? ""}`;
    }).join(" | ") || "(none)"}`,
    `PERSUASIVE_AUTHORITY: ${structured.PERSUASIVE_AUTHORITY.map((hit) => {
      const row = hit as { authorityId?: string; citation?: string | null };
      return `${row.authorityId ?? "?"}:${row.citation ?? ""}`;
    }).join(" | ") || "(none)"}`,
    `CONTRARY_AUTHORITY: ${structured.CONTRARY_AUTHORITY.map((hit) => {
      const row = hit as { authorityId?: string };
      return row.authorityId ?? "?";
    }).join(" | ") || "(none)"}`,
    `TREATMENT: ${structured.TREATMENT.map((item) => `${item.authorityId}:${item.label}`).join(" | ") || "(none)"}`,
    `COVERAGE_WARNINGS: ${structured.COVERAGE_WARNINGS.map((warning) => warning.code).join(" | ") || "(none)"}`,
    "GUILT_CONCLUSION: null",
  ];
  return lines.join("\n");
}
