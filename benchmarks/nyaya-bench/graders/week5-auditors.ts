export type TraceClaim = {
  id: string;
  kind: "fact" | "legal" | "evidence" | "other";
  text: string;
  sourceIds: string[];
};

export type HallucinationFinding = {
  code:
    | "NONEXISTENT_AUTHORITY"
    | "NONEXISTENT_DOCUMENT"
    | "CITATION_NOT_IN_SET"
    | "QUOTE_NOT_IN_SOURCE"
    | "FACT_WITHOUT_SOURCE"
    | "FORBIDDEN_PATTERN"
    | "GUILT_CONCLUSION"
    | "TRUTHFULNESS_LABEL";
  message: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
};

export type TraceabilityFinding = {
  code: "UNTRACEABLE_CLAIM" | "GROUNDED" | "LEGAL_WITHOUT_AUTHORITY";
  claimId: string;
  message: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
};

/** Deterministic hallucination checks over structured Week 5 answers. */
export function auditHallucination(params: {
  authorityIds: string[];
  documentIds: string[];
  citations: string[];
  knownAuthorityIds: string[];
  knownDocumentIds: string[];
  knownCitations: string[];
  quotes?: Array<{ quote: string; sourceText: string }>;
  textBlob: string;
  forbidPatterns: string[];
}): HallucinationFinding[] {
  const findings: HallucinationFinding[] = [];
  for (const id of params.authorityIds) {
    if (!params.knownAuthorityIds.includes(id)) {
      findings.push({
        code: "NONEXISTENT_AUTHORITY",
        message: `Authority ${id} is not in the known authority set.`,
        severity: "CRITICAL",
      });
    }
  }
  for (const id of params.documentIds) {
    if (!params.knownDocumentIds.includes(id)) {
      findings.push({
        code: "NONEXISTENT_DOCUMENT",
        message: `Document ${id} is not in the known document set.`,
        severity: "CRITICAL",
      });
    }
  }
  for (const citation of params.citations) {
    if (citation && !params.knownCitations.some((known) => known.includes(citation) || citation.includes(known))) {
      findings.push({
        code: "CITATION_NOT_IN_SET",
        message: `Citation ${citation} is not in the known citation set.`,
        severity: "CRITICAL",
      });
    }
  }
  for (const row of params.quotes ?? []) {
    if (row.quote.trim() && !row.sourceText.includes(row.quote.trim())) {
      findings.push({
        code: "QUOTE_NOT_IN_SOURCE",
        message: "Quoted text is not present in the cited source.",
        severity: "CRITICAL",
      });
    }
  }
  const normalized = params.textBlob.replace(
    /not a finding that a witness is untruthful/gi,
    "[DISCLAIMER]",
  );
  for (const pattern of params.forbidPatterns) {
    if (new RegExp(pattern, "i").test(normalized)) {
      findings.push({
        code: "FORBIDDEN_PATTERN",
        message: `Forbidden pattern matched: ${pattern}`,
        severity: /GUILTY|LIAR|UNTRUTHFUL|fabricated/i.test(pattern) ? "CRITICAL" : "HIGH",
      });
    }
  }
  if (
    /\b(GUILTY|NOT_GUILTY)\b/i.test(normalized) ||
    /"GUILT_CONCLUSION"\s*:\s*(?!null)/i.test(normalized) ||
    /GUILT_CONCLUSION"\s*:\s*(?!null)/i.test(normalized)
  ) {
    findings.push({
      code: "GUILT_CONCLUSION",
      message: "Guilt conclusion language present.",
      severity: "CRITICAL",
    });
  }
  if (
    /"truthfulnessConclusion"\s*:\s*(?!null)[^\n,}]+/i.test(params.textBlob) ||
    /\b(is a liar|witness is untruthful|found deceptive)\b/i.test(normalized)
  ) {
    findings.push({
      code: "TRUTHFULNESS_LABEL",
      message: "Unsupported truthfulness label present.",
      severity: "CRITICAL",
    });
  }
  return findings;
}

/** Deterministic claim-level grounding auditor. */
export function auditTraceability(claims: TraceClaim[]): TraceabilityFinding[] {
  return claims.map((claim) => {
    if (claim.sourceIds.length === 0) {
      return {
        code: claim.kind === "legal" ? "LEGAL_WITHOUT_AUTHORITY" : "UNTRACEABLE_CLAIM",
        claimId: claim.id,
        message: `Claim ${claim.id} has no source ids.`,
        severity: claim.kind === "other" ? "MEDIUM" : "HIGH",
      };
    }
    return {
      code: "GROUNDED",
      claimId: claim.id,
      message: `Claim ${claim.id} is source-linked.`,
      severity: "LOW",
    };
  });
}
