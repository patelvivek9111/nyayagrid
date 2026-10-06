import { buildWholeMatterAnalysis, formatLongFormAnalysis, runDeepeningLawFirm, runDeepeningProsecution } from "@nyayagrid/intelligence";
import { DEEPENING_ASSIGNMENTS, type DeepeningAssignment } from "../datasets/deepening/catalog";

export type DeepeningGrade = {
  id: string;
  passed: boolean;
  severity: DeepeningAssignment["failureSeverity"];
  failures: string[];
};

function fail(assignment: DeepeningAssignment, failures: string[]): DeepeningGrade {
  return { id: assignment.id, passed: failures.length === 0, severity: assignment.failureSeverity, failures };
}

function gradeLawFirm(assignment: DeepeningAssignment): DeepeningGrade {
  const result = runDeepeningLawFirm();
  const failures: string[] = [];
  if (result.separatedIssueCount < 4) failures.push("expected at least four issues");
  const defense = result.analysis.issues.find((issue) => /defense/i.test(issue.description));
  if (!defense?.contraryEvidenceIds.includes("ev-log")) failures.push("defense issue lost contrary evidence");
  if (defense?.supportingEvidenceIds.includes("ev-log")) failures.push("contrary evidence was flattened into support");
  if (!defense?.missingEvidenceIds.includes("missing-delivery")) failures.push("missing evidence was not attached");
  if (result.analysis.authorityConflicts.length === 0 || result.analysis.authorityConflicts.some((item) => item.resolved)) {
    failures.push("authority conflict was missing or resolved");
  }
  if (result.analysis.outcomeConclusion !== null) failures.push("outcome conclusion was set");
  return fail(assignment, failures);
}

function gradeProsecution(assignment: DeepeningAssignment): DeepeningGrade {
  const result = runDeepeningProsecution();
  const failures: string[] = [];
  if (result.defendants.length < 2 || result.charges.length < 2) failures.push("multi-defendant charges missing");
  if (result.evidenceScope.jointEvidenceIds.length !== 1) failures.push("joint evidence missing");
  if (result.evidenceScope.byDefendant.some((row) => row.specificEvidenceIds.length !== 1)) {
    failures.push("defendant-specific evidence missing");
  }
  if (!result.witnessComparison.some((row) => row.label === "TIMELINE_DIFFERENCE")) failures.push("witness time conflict missing");
  if (JSON.stringify(result.witnessComparison).match(/LIAR|UNTRUTHFUL|DECEPTIVE/)) failures.push("truthfulness label");
  if (!result.issueSeparation.some((issue) => issue.kind === "procedure")) failures.push("suppression issue was collapsed");
  if (result.guiltConclusion !== null || result.longForm.guiltConclusion !== null) failures.push("guilt conclusion");
  return fail(assignment, failures);
}

function gradeLongForm(assignment: DeepeningAssignment): DeepeningGrade {
  const result = runDeepeningLawFirm();
  const failures: string[] = [];
  const issueSections = result.longForm.sections.filter((section) => section.issueId);
  if (issueSections.length !== result.analysis.issues.length) failures.push("issue section missing");
  if (!/decisive conclusion is not supported/i.test(result.longForm.shortAnswer)) failures.push("short answer was decisive");
  if (issueSections.some((section) => section.sourceIds.length === 0)) failures.push("issue section lost provenance");
  return fail(assignment, failures);
}

function gradeConsistency(assignment: DeepeningAssignment): DeepeningGrade {
  const result = runDeepeningLawFirm();
  const failures: string[] = [];
  if (!result.consistency.consistent) failures.push(result.consistency.conflicts.join("; ") || "inconsistent");
  return fail(assignment, failures);
}

function gradeStale(assignment: DeepeningAssignment): DeepeningGrade {
  const result = runDeepeningLawFirm();
  const failures: string[] = [];
  if (!result.freshness.stale || !result.freshness.refreshRequired) failures.push("prior analysis stayed current");
  if (result.freshness.affectedIssueIds.length !== result.analysis.issues.length) {
    failures.push("unscoped new evidence did not mark every issue");
  }
  return fail(assignment, failures);
}

function gradeAbstention(assignment: DeepeningAssignment): DeepeningGrade {
  const result = runDeepeningLawFirm();
  const empty = {
    ...result.bundle,
    supportingEvidence: [],
    contraryEvidence: [],
    missingEvidence: [],
    bindingAuthorities: [],
    contraryAuthorities: [],
    persuasiveAuthorities: [],
  };
  const analysis = buildWholeMatterAnalysis({ context: result.context, bundle: empty });
  const longForm = formatLongFormAnalysis({ analysis, bundle: empty });
  const failures: string[] = [];
  if (analysis.issues.some((issue) => !issue.abstainReason)) failures.push("issue did not abstain");
  if (longForm.outcomeConclusion !== null) failures.push("outcome conclusion");
  if (!/decisive conclusion is not supported/i.test(longForm.shortAnswer)) failures.push("short answer was decisive");
  return fail(assignment, failures);
}

const GRADERS: Record<string, (assignment: DeepeningAssignment) => DeepeningGrade> = {
  "D1-LF-01": gradeLawFirm,
  "D1-PR-01": gradeProsecution,
  "D1-LONG-01": gradeLongForm,
  "D1-CONSIST-01": gradeConsistency,
  "D1-STALE-01": gradeStale,
  "D1-ERR-01": gradeAbstention,
};

/** Deterministic deepening grades. No database, model, or CourtListener calls. */
export function runDeepeningPass(): { grades: DeepeningGrade[]; passed: number; failed: number } {
  const grades = DEEPENING_ASSIGNMENTS.map((assignment) => {
    const grade = GRADERS[assignment.id];
    if (!grade) return fail(assignment, ["no grader"]);
    return grade(assignment);
  });
  return {
    grades,
    passed: grades.filter((grade) => grade.passed).length,
    failed: grades.filter((grade) => !grade.passed).length,
  };
}

const invokedDirectly = process.argv[1]?.split("\\").join("/").endsWith("runner/deepening.ts");
if (invokedDirectly) {
  const result = runDeepeningPass();
  console.log(JSON.stringify({ passed: result.passed, failed: result.failed, grades: result.grades }, null, 2));
  if (result.failed > 0) process.exit(1);
}
