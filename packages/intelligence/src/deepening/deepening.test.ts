import { describe, expect, it } from "vitest";
import { formatStructuredAnswerContextForPrompt } from "../week4/ask-context";
import { decomposeQuestion } from "../week4/decompose";
import { toStructuredAnswerContext } from "../week4/law-evidence-join";
import { checkWholeMatterConsistency } from "./consistency";
import { decomposeMatterIssues } from "./decompose-matter";
import { runDeepeningLawFirm, runDeepeningProsecution } from "./fixtures";
import { assessAnalysisFreshness } from "./freshness";
import { buildWholeMatterAnalysis, formatLongFormAnalysis } from "./whole-matter";

describe("multi-issue decomposition", () => {
  it("keeps a single-topic question on one issue", () => {
    const context = {
      organizationId: "org",
      workspaceType: "prosecution" as const,
      userQuestion: "What evidence supports each element of Count 1?",
      criminalCaseId: "case-1",
      subjectMatter: "criminal" as const,
    };
    expect(decomposeMatterIssues(context).issues).toHaveLength(1);
    expect(decomposeMatterIssues(context).issues[0]?.description).toBe(decomposeQuestion(context).issues[0]?.description);
  });

  it("separates defenses, damages, and conflicting authority from the claim", () => {
    const result = runDeepeningLawFirm();
    expect(result.separatedIssueCount).toBeGreaterThanOrEqual(4);
    const descriptions = result.analysis.issues.map((issue) => issue.description);
    expect(descriptions).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/strength and weakness/i),
        expect.stringMatching(/defense/i),
        expect.stringMatching(/damages/i),
        expect.stringMatching(/conflicting authority/i),
      ]),
    );
  });
});

describe("law-firm whole-matter deepening", () => {
  it("keeps support, contrary evidence, missing evidence, and unresolved authority apart", () => {
    const result = runDeepeningLawFirm();
    expect(result.analysis.issues.length).toBeGreaterThan(1);
    expect(result.analysis.authorityConflicts.length).toBeGreaterThan(0);
    expect(result.analysis.authorityConflicts.every((conflict) => conflict.resolved === false)).toBe(true);
    expect(result.analysis.decisiveConclusion).toBeNull();
    expect(result.analysis.outcomeConclusion).toBeNull();
    expect(result.analysis.guiltConclusion).toBeNull();
    expect(result.analysis.unassignedEvidenceIds).toContain("ev-unassigned");
    const defense = result.analysis.issues.find((issue) => /defense/i.test(issue.description));
    expect(defense?.contraryEvidenceIds).toContain("ev-log");
    expect(defense?.missingEvidenceIds).toContain("missing-delivery");
    expect(defense?.supportingEvidenceIds).not.toContain("ev-log");
    expect(result.longForm.sections.filter((section) => section.issueId).length).toBe(result.analysis.issues.length);
    expect(result.longForm.shortAnswer).toMatch(/decisive conclusion is not supported/i);
    expect(result.longForm.shortAnswer).not.toMatch(/\b(GUILTY|LIABLE|PLAINTIFF WINS)\b/);
    expect(result.claimMatrix).toHaveLength(2);
    expect(result.consistency.consistent).toBe(true);
    expect(result.freshness.stale).toBe(true);
    expect(result.freshness.refreshRequired).toBe(true);
    expect(result.freshness.newEvidenceIds).toContain("ev-supplemental");
    expect(result.freshness.affectedIssueIds.length).toBe(result.analysis.issues.length);
    expect(result.analysis.hypotheses.every((item) => item.status === "hypothesis")).toBe(true);
  });

  it("flags a matrix that flips an evidence role", () => {
    const result = runDeepeningLawFirm();
    const broken = checkWholeMatterConsistency({
      analysis: result.analysis,
      longForm: result.longForm,
      primaryIssueDescription: result.analysis.issues[0]!.description,
      matrixRows: [{ id: "req-notice", supportingEvidenceIds: ["ev-log"], contraryEvidenceIds: [] }],
      theorySupportingIds: [],
      theoryContraryIds: [],
    });
    expect(broken.consistent).toBe(false);
    expect(broken.conflicts.some((conflict) => conflict.includes("ev-log"))).toBe(true);
  });
});

describe("prosecution whole-matter deepening", () => {
  it("separates two defendants, shared evidence, witness conflict, and suppression without guilt", () => {
    const result = runDeepeningProsecution();
    expect(result.defendants).toHaveLength(2);
    expect(result.charges).toHaveLength(2);
    expect(result.evidenceScope.jointEvidenceIds).toHaveLength(1);
    expect(result.evidenceScope.byDefendant.every((row) => row.specificEvidenceIds.length === 1)).toBe(true);
    expect(result.evidenceScope.byDefendant.every((row) => row.jointEvidenceIds.length === 1)).toBe(true);
    expect(result.overview.evidenceScope.jointEvidenceIds).toEqual(result.evidenceScope.jointEvidenceIds);
    expect(result.overview.issueSeparation.filter((issue) => issue.kind === "charge")).toHaveLength(2);
    expect(result.overview.issueSeparation.some((issue) => issue.kind === "procedure" && issue.label === "WARRANT")).toBe(
      true,
    );
    expect(result.witnessComparison.some((row) => row.label === "TIMELINE_DIFFERENCE")).toBe(true);
    expect(result.witnessComparison.some((row) => row.label === "ADDED_DETAIL")).toBe(true);
    expect(result.witnessComparison.some((row) => row.label === "CONSISTENT")).toBe(true);
    expect(JSON.stringify(result.witnessComparison)).not.toMatch(/LIAR|UNTRUTHFUL|DECEPTIVE/);
    expect(result.analysis.issues.length).toBeGreaterThanOrEqual(4);
    expect(result.analysis.guiltConclusion).toBeNull();
    expect(result.longForm.guiltConclusion).toBeNull();
    expect(result.longForm.shortAnswer).toMatch(/decisive conclusion is not supported/i);
    expect(result.bundle.missingEvidence.map((item) => item.id)).toContain("missing-bodycam");
    const discovery = result.analysis.issues.find((issue) => /discovery/i.test(issue.description));
    expect(discovery?.missingEvidenceIds).toContain("missing-bodycam");
    expect(result.freshness.refreshRequired).toBe(true);
    expect(result.freshness.reason).toMatch(/not current/i);
    expect(result.analysis.hypotheses.some((item) => item.role === "defense" && item.status === "hypothesis")).toBe(true);
    expect(result.analysis.authorityConflicts.length).toBeGreaterThan(0);
    expect(result.analysis.authorityConflicts.every((conflict) => conflict.resolved === false)).toBe(true);
  });
});

describe("stale analysis and abstention", () => {
  it("does not mark an unchanged record stale", () => {
    const freshness = assessAnalysisFreshness({
      priorEvidenceIds: ["a"],
      priorIssueEvidence: [{ issueId: "issue-1", evidenceIds: ["a"] }],
      currentEvidenceIds: ["a"],
    });
    expect(freshness.stale).toBe(false);
    expect(freshness.refreshRequired).toBe(false);
    expect(freshness.reason).toBeNull();
  });

  it("abstains when the record has no source and no binding authority", () => {
    const result = runDeepeningLawFirm();
    const empty = {
      ...result.bundle,
      supportingEvidence: [],
      contraryEvidence: [],
      missingEvidence: [],
      bindingAuthorities: [],
      contraryAuthorities: [],
    };
    const analysis = buildWholeMatterAnalysis({ context: result.context, bundle: empty });
    const longForm = formatLongFormAnalysis({ analysis, bundle: empty });
    expect(analysis.issues.every((issue) => issue.abstainReason)).toBe(true);
    expect(longForm.abstentions.length).toBeGreaterThan(0);
    expect(longForm.shortAnswer).toMatch(/decisive conclusion is not supported/i);
    expect(longForm.outcomeConclusion).toBeNull();
  });
});

describe("Ask Nyaya prompt separation", () => {
  it("adds separated issues only when the question names more than one topic", () => {
    const single = formatStructuredAnswerContextForPrompt(
      toStructuredAnswerContext(runDeepeningLawFirm().bundle),
    );
    expect(single).toContain("GUILT_CONCLUSION: null");
    expect(single).toContain("SEPARATED_ISSUES");
    const quiet = formatStructuredAnswerContextForPrompt({
      ...toStructuredAnswerContext(runDeepeningLawFirm().bundle),
      QUESTION: "What authority controls this issue?",
    });
    expect(quiet).not.toContain("SEPARATED_ISSUES");
    expect(quiet).toContain("GUILT_CONCLUSION: null");
  });
});
