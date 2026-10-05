import { describe, expect, it } from "vitest";
import {
  auditCitationHealth,
  buildLawFirmDemo,
  createAuthorityConflict,
  createLegalStandard,
  createTreatmentRelationship,
  highDemandAuthorities,
  SHARED_REQUIREMENT_ABSTRACTION,
  traversePrecedent,
  treatmentFromCitationOnly,
  week3MaterialCorpusGaps,
} from "./index";

describe("legal standards and issues", () => {
  it("rejects a canonical standard without a source span", () => {
    expect(() =>
      createLegalStandard({
        id: "std",
        ruleText: "A rule.",
        standardType: "RULE",
        status: "canonical",
        authorityId: "auth",
        sourceCitation: "SYNTHETIC-1",
        provenance: { extractionOrigin: "human", humanEntered: true },
      }),
    ).toThrow(/source span/i);
  });

  it("builds the law-firm law-to-evidence fixture without a merits conclusion", () => {
    const demo = buildLawFirmDemo();
    expect(demo.issue.issueType).toBe("FEDERAL_STATUTORY");
    expect(demo.standard).toMatchObject({ status: "canonical" });
    expect(demo.authorities.map((link) => link.authorityStatus)).toEqual(["BINDING", "PERSUASIVE"]);
    expect(demo.supportingEvidence.length).toBe(1);
    expect(demo.contraryEvidence.length).toBe(1);
    expect(demo.guiltConclusion).toBeNull();
    expect(SHARED_REQUIREMENT_ABSTRACTION.decision).toBe("SHARE_SHAPE_KEEP_STORES_SEPARATE");
  });
});

describe("precedent traversal", () => {
  const edges = [
    { id: "e1", fromAuthorityId: "A", toAuthorityId: "B", rawCitation: "B" },
    { id: "e2", fromAuthorityId: "B", toAuthorityId: "C", rawCitation: "C" },
    { id: "e3", fromAuthorityId: "C", toAuthorityId: "A", rawCitation: "A" },
    { id: "e4", fromAuthorityId: "D", toAuthorityId: "B", rawCitation: "B" },
  ];
  const authorities = [
    { authorityId: "A", court: "us-ca-3", decisionDate: "2020-01-01", jurisdiction: "US", citation: "SYN-A" },
    { authorityId: "B", court: "us-scotus", decisionDate: "1990-01-01", jurisdiction: "US", citation: "SYN-B" },
    { authorityId: "C", court: "us-ca-3", decisionDate: "1980-01-01", jurisdiction: "US", citation: "SYN-C" },
  ];

  it("returns a bounded chain and blocks cycles", () => {
    const path = traversePrecedent({ edges, authorities, startId: "A", direction: "ancestors", maxDepth: 6 });
    expect(path.nodes.map((node) => node.authorityId)).toEqual(["A", "B", "C"]);
    expect(path.cycleBlocked).toBe(true);
    expect(path.edges.every((edge) => edge.relationship === "cites")).toBe(true);
    expect(path.nodes[1]?.citation).toBe("SYN-B");
  });

  it("lists who cites an authority and high-demand targets", () => {
    const citedBy = traversePrecedent({ edges, startId: "B", direction: "descendants" });
    expect(citedBy.nodes.map((node) => node.authorityId).sort()).toEqual(["A", "B", "C", "D"]);
    expect(highDemandAuthorities(edges, 2)[0]).toEqual({ authorityId: "B", inbound: 2 });
  });
});

describe("treatment and conflict", () => {
  it("does not verify treatment from a citation edge alone", () => {
    expect(treatmentFromCitationOnly({ sourceAuthorityId: "A", targetAuthorityId: "B" }).abstention).toBe(
      "TREATMENT_UNVERIFIED",
    );
    const unverified = createTreatmentRelationship({
      sourceAuthorityId: "A",
      targetAuthorityId: "B",
      treatment: "OVERRULED",
      provenance: { extractionOrigin: "import", authorityId: "A" },
    });
    expect(unverified.verificationStatus).toBe("unknown");
    expect(unverified.treatment).toBe("UNKNOWN");
  });

  it("verifies treatment only with source text", () => {
    const verified = createTreatmentRelationship({
      sourceAuthorityId: "A",
      targetAuthorityId: "B",
      treatment: "DISTINGUISHED",
      evidenceSpan: "The court distinguished the earlier case on its facts.",
      sourcePage: 12,
      provenance: { extractionOrigin: "source_metadata", authorityId: "A", sourceSpan: "distinguished" },
    });
    expect(verified.verificationStatus).toBe("verified");
    expect(verified.treatment).toBe("DISTINGUISHED");
  });

  it("keeps a conflict without source spans in review", () => {
    const conflict = createAuthorityConflict({
      id: "c1",
      authorityA: "A",
      authorityB: "B",
      issueId: "issue-1",
      conflictType: "RULE_CONFLICT",
      explanation: "The rules differ.",
      supportingSourceSpans: [],
      confidence: "high",
      status: "recorded",
      provenance: { extractionOrigin: "human", humanEntered: true },
    });
    expect(conflict.status).toBe("needs_review");
  });
});

describe("citation health", () => {
  it("counts present-target defects, duplicates, and orphans without CourtListener", () => {
    const report = auditCitationHealth({
      nodes: [{ authorityId: "A" }, { authorityId: "B" }],
      edges: [
        { id: "1", fromAuthorityId: "A", toAuthorityId: "B", rawCitation: "B", targetPresentInCorpus: true },
        { id: "2", fromAuthorityId: "A", toAuthorityId: "B", rawCitation: "B", targetPresentInCorpus: true },
        { id: "3", fromAuthorityId: "A", toAuthorityId: null, rawCitation: "missing", targetPresentInCorpus: true },
        { id: "4", fromAuthorityId: "Z", toAuthorityId: "B", rawCitation: "orphan" },
      ],
    });
    expect(report.presentTargetDefects).toBe(1);
    expect(report.duplicateEdges).toBe(1);
    expect(report.orphanEdges).toBe(1);
    expect(report.courtListenerRequests).toBe(0);
    expect(week3MaterialCorpusGaps()).toEqual([]);
  });
});
