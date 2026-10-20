import { describe, expect, it } from "vitest";
import {
  WEEK4_AUDIT,
  decomposeQuestion,
  rankLegalAuthoritiesExplainable,
  retrieveMatterEvidence,
  assertEvidenceTenantIsolation,
  buildAskNyayaCombinedContext,
  runFixtureALawFirm,
  runFixtureBProsecution,
  runFixtureCWarrant,
  runFixtureDWitness,
  runFixtureEDiscovery,
  runCustodyAndTimelineSmoke,
  validateChainOfCustody,
  normalizeCustody,
  mapProsecutionNotifyKind,
} from "./index";

describe("week4 audit map", () => {
  it("records existing, extend, new, validate, and defer sets", () => {
    expect(WEEK4_AUDIT.EXISTING.length).toBeGreaterThan(5);
    expect(WEEK4_AUDIT.NEW).toContain("QueryContext");
    expect(WEEK4_AUDIT.VALIDATE).toEqual(
      expect.arrayContaining(["Agency", "Officer", "Subpoena", "Motion", "Hearing", "Disposition"]),
    );
  });
});

describe("question decomposition", () => {
  it("builds issue context and abstains when forum and jurisdiction are missing", () => {
    const decomposed = decomposeQuestion({
      organizationId: "org",
      workspaceType: "prosecution",
      userQuestion: "What evidence supports each element of Count 1?",
      criminalCaseId: "case-1",
      subjectMatter: "criminal",
    });
    expect(decomposed.issues[0]?.issueType).toBe("STATE_LAW");
    expect(decomposed.evidentiarySubquestions.length).toBeGreaterThan(0);
    expect(decomposed.missingContext).toContain("forumCourt");
  });
});

describe("hybrid ranking explainability", () => {
  it("keeps score components and does not let binding bury relevance", () => {
    const ranked = rankLegalAuthoritiesExplainable({
      query: "written notice requirement",
      hits: [
        {
          authorityId: "binding",
          courtId: "us-ca-3",
          jurisdiction: "US",
          authorityType: "case",
          score: 0.2,
          title: "unrelated hierarchy case",
          snippet: "unrelated",
        },
        {
          authorityId: "persuasive",
          courtId: "us-ca-2",
          jurisdiction: "US",
          authorityType: "case",
          score: 0.9,
          title: "written notice requirement",
          snippet: "written notice requirement",
        },
      ],
      context: {
        questionJurisdiction: "US",
        forumCourtId: "us-d-pa-ed",
        issueType: "FEDERAL_STATUTORY",
      },
    });
    expect(ranked[0]?.authorityId).toBe("persuasive");
    expect(ranked[0]?.scoreBreakdown.semanticScore).toBeGreaterThan(0);
    expect(ranked[0]?.scoreBreakdown.authorityContribution).toBeDefined();
    expect(ranked.find((hit) => hit.authorityId === "binding")?.authorityStatus).toBe("BINDING");
  });
});

describe("matter evidence security scoping", () => {
  it("never returns another organization or invents support from similarity alone", () => {
    const items = retrieveMatterEvidence({
      context: {
        organizationId: "org-a",
        workspaceType: "professional",
        matterId: "matter-a",
        userQuestion: "notice delivery",
      },
      corpus: [
        {
          id: "a",
          organizationId: "org-a",
          matterId: "matter-a",
          kind: "fact",
          text: "notice delivery letter",
          relation: null,
          provenance: { extractionOrigin: "deterministic_fixture", sourceSpan: "a" },
        },
        {
          id: "b",
          organizationId: "org-b",
          matterId: "matter-b",
          kind: "fact",
          text: "notice delivery letter",
          relation: "SUPPORTS",
          provenance: { extractionOrigin: "deterministic_fixture", sourceSpan: "b" },
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.relation).toBe("UNKNOWN_RELATION");
    expect(assertEvidenceTenantIsolation(items, "org-a")).toHaveLength(1);
  });
});

describe("fixtures A-E", () => {
  it("fixture A returns law-firm law+evidence bundle", () => {
    const result = runFixtureALawFirm();
    expect(result.bundle.bindingAuthorities.some((item) => item.authorityStatus === "BINDING")).toBe(true);
    expect(result.bundle.supportingEvidence.length).toBeGreaterThan(0);
    expect(result.bundle.contraryEvidence.length).toBeGreaterThan(0);
    expect(result.bundle.missingEvidence.length).toBeGreaterThan(0);
    expect(result.claimMatrix[0]?.governingAuthorities.length).toBeGreaterThan(0);
    expect(result.answerContext.GUILT_CONCLUSION).toBeNull();
    expect(result.bundle.supportingEvidence.every((item) => item.organizationId === "org-synthetic-firm")).toBe(true);
  });

  it("fixture B returns prosecution strengths without guilt", () => {
    const result = runFixtureBProsecution();
    expect(result.matrix.length).toBe(3);
    expect(result.matrix.every((row) => row.guiltConclusion === null)).toBe(true);
    expect(result.witness.contradictions.length).toBeGreaterThan(0);
    expect(result.witness.truthfulnessConclusion).toBeNull();
    expect(result.suppression.suppressionConclusion).toBeNull();
    expect(result.bundle.investigationGaps.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/GUILTY|NOT_GUILTY|LIAR|UNTRUTHFUL/);
  });

  it("fixture C maps warrant assertions without deciding validity", () => {
    const result = runFixtureCWarrant();
    expect(result.factMap[0]?.sourceFact?.id).toBe("fact-1");
    expect(result.validityConclusion).toBeNull();
    expect(result.coverageWarnings.some((warning) => warning.code === "DOCUMENT_NOT_AVAILABLE")).toBe(true);
  });

  it("fixture D compares three statements with source views", () => {
    const result = runFixtureDWitness();
    expect(result.contradictions[0]?.statementA.source.documentId).toBeTruthy();
    expect(result.timelineDifferences.length).toBeGreaterThan(0);
    expect(result.addedDetail.length).toBeGreaterThan(0);
    expect(result.truthfulnessConclusion).toBeNull();
  });

  it("fixture E builds a discovery dashboard and keeps human disclosure control", () => {
    const result = runFixtureEDiscovery();
    expect(result.dashboard.totalItems).toBe(4);
    expect(result.dashboard.flagged).toBe(1);
    expect(result.dashboard.produced).toBe(1);
    expect(result.dashboard.potentialDisclosureReview).toBeGreaterThan(0);
    expect(result.humanFinalRequired).toBe(true);
    expect(result.dashboard.legalConclusion).toBeNull();
  });
});

describe("custody and timeline", () => {
  it("detects chain gaps and timeline conflicts without alleging tampering", () => {
    const smoke = runCustodyAndTimelineSmoke();
    expect(smoke.custodyFindings.some((finding) => finding.code === "CHAIN_GAP" || finding.code === "SEQUENCE_INCONSISTENCY" || finding.code === "UNKNOWN")).toBe(true);
    expect(smoke.timelineConflicts.some((conflict) => conflict.conflict === "TIME_CONFLICT")).toBe(true);
    expect(validateChainOfCustody(normalizeCustody([])).some((finding) => finding.code === "MISSING_RECORD")).toBe(true);
  });
});

describe("prosecution notification mapping", () => {
  it("maps operational events onto existing platform kinds", () => {
    expect(mapProsecutionNotifyKind("upcoming_hearing")).toBe("deadline");
    expect(mapProsecutionNotifyKind("disclosure_candidate_review")).toBe("review_queue");
    expect(mapProsecutionNotifyKind("subpoena_return_due")).toBe("deadline");
  });
});

describe("Ask Nyaya combined context", () => {
  it("returns structured issues, evidence, law, and coverage warnings", () => {
    const { structured } = buildAskNyayaCombinedContext({
      context: {
        organizationId: "org",
        workspaceType: "professional",
        matterId: "m1",
        jurisdiction: "US",
        forumCourt: "us-d-pa-ed",
        issueType: "FEDERAL_STATUTORY",
        userQuestion: "What authority controls this issue?",
      },
      evidenceCorpus: [
        {
          id: "ev1",
          organizationId: "org",
          matterId: "m1",
          kind: "fact",
          text: "written notice was sent",
          relation: "SUPPORTS",
          provenance: { extractionOrigin: "deterministic_fixture", documentId: "d1", sourceSpan: "span" },
        },
      ],
      authorityHits: [
        {
          authorityId: "auth-3d",
          courtId: "us-ca-3",
          jurisdiction: "US",
          authorityType: "case",
          score: 0.7,
          citation: "SYNTHETIC-3D-2020-001",
        },
      ],
      standards: [
        {
          id: "std",
          authorityId: "auth-3d",
          ruleText: "Synthetic rule",
          sourceSpan: "span",
          sourceCitation: "SYNTHETIC-3D-2020-001",
        },
      ],
    });
    expect(structured.BINDING_AUTHORITY.length).toBe(1);
    expect(structured.EVIDENCE_FOR.length).toBe(1);
    expect(structured.LEGAL_STANDARDS[0]?.sourceCitation).toBe("SYNTHETIC-3D-2020-001");
    expect(structured.GUILT_CONCLUSION).toBeNull();
  });
});
