import { compareWitnessStatements, type StatementClaim } from "../prosecution/domain";
import type { SourceProvenance } from "../legal/types";

export type WitnessStatementView = {
  id: string;
  witnessId: string;
  witnessName: string;
  claims: StatementClaim[];
  provenance: SourceProvenance;
  eventTime?: string | null;
};

export type WitnessDiscrepancy = {
  label: string;
  detail: string;
  key: string;
  statementA: { id: string; source: SourceProvenance; claim: string };
  statementB: { id: string; source: SourceProvenance; claim: string };
  relatedIssueId: string | null;
  relatedElementId: string | null;
};

export type WitnessIntelligenceResult = {
  consistent: WitnessDiscrepancy[];
  contradictions: WitnessDiscrepancy[];
  omissions: WitnessDiscrepancy[];
  addedDetail: WitnessDiscrepancy[];
  timelineDifferences: WitnessDiscrepancy[];
  corroboration: Array<{ evidenceId: string; statementId: string; detail: string; provenance: SourceProvenance }>;
  unresolved: WitnessDiscrepancy[];
  truthfulnessConclusion: null;
};

function pair(
  left: WitnessStatementView,
  right: WitnessStatementView,
  comparison: ReturnType<typeof compareWitnessStatements>,
  relatedIssueId: string | null,
  relatedElementId: string | null,
): WitnessDiscrepancy[] {
  return comparison.map((row) => {
    const leftClaim = left.claims.find((claim) => claim.key === row.key);
    const rightClaim = right.claims.find((claim) => claim.key === row.key);
    return {
      label: row.label,
      detail: row.detail,
      key: row.key,
      statementA: {
        id: left.id,
        source: left.provenance,
        claim: leftClaim ? `${leftClaim.key}=${leftClaim.value}` : "(absent)",
      },
      statementB: {
        id: right.id,
        source: right.provenance,
        claim: rightClaim ? `${rightClaim.key}=${rightClaim.value}` : "(absent)",
      },
      relatedIssueId,
      relatedElementId,
    };
  });
}

export function buildWitnessIntelligence(params: {
  statements: WitnessStatementView[];
  evidenceTexts?: Array<{ id: string; text: string; provenance: SourceProvenance }>;
  relatedIssueId?: string | null;
  relatedElementId?: string | null;
}): WitnessIntelligenceResult {
  const result: WitnessIntelligenceResult = {
    consistent: [],
    contradictions: [],
    omissions: [],
    addedDetail: [],
    timelineDifferences: [],
    corroboration: [],
    unresolved: [],
    truthfulnessConclusion: null,
  };
  for (let i = 0; i < params.statements.length; i += 1) {
    for (let j = i + 1; j < params.statements.length; j += 1) {
      const left = params.statements[i]!;
      const right = params.statements[j]!;
      const comparison = compareWitnessStatements(left.claims, right.claims);
      const rows = pair(left, right, comparison, params.relatedIssueId ?? null, params.relatedElementId ?? null);
      for (const row of rows) {
        if (row.label === "CONSISTENT") result.consistent.push(row);
        else if (row.label === "CONTRADICTORY") result.contradictions.push(row);
        else if (row.label === "OMISSION") result.omissions.push(row);
        else if (row.label === "ADDED_DETAIL") result.addedDetail.push(row);
        else if (row.label === "TIMELINE_DIFFERENCE") result.timelineDifferences.push(row);
        else result.unresolved.push(row);
      }
    }
  }
  for (const statement of params.statements) {
    for (const evidence of params.evidenceTexts ?? []) {
      for (const claim of statement.claims) {
        if (evidence.text.toLowerCase().includes(claim.value.toLowerCase())) {
          result.corroboration.push({
            evidenceId: evidence.id,
            statementId: statement.id,
            detail: `Evidence text overlaps claim ${claim.key}.`,
            provenance: evidence.provenance,
          });
        }
      }
    }
  }
  return result;
}
