import { describe, expect, it } from "vitest";
import {
  buildProsecutionCaseIntelligence,
  formatProsecutionAskIntelligenceContext,
} from "./case-intelligence";
import { PROSECUTION_EVIDENCE_TYPES, normalizeProsecutionEvidenceType } from "./domain";

const provenance = {
  extractionOrigin: "human" as const,
  humanEntered: true,
  sourceSpan: "synthetic-span",
  documentId: "doc-synthetic-1",
};

describe("prosecution case intelligence (stage 3)", () => {
  it("surfaces element gaps, CoC warnings, witness conflicts, and timeline conflicts without guilt fields", () => {
    const snapshot = buildProsecutionCaseIntelligence({
      caseId: "case-synthetic-1",
      defendantCount: 2,
      discoveryCount: 1,
      openTaskCount: 2,
      matrix: [
        {
          chargeId: "ch-1",
          offenseName: "Count 1",
          elementId: "el-supported",
          elementText: "Identity",
          status: "SUPPORTED",
          supportingEvidenceIds: ["ev-joint"],
          contraryEvidenceIds: [],
          uncertainEvidenceIds: [],
          missingEvidenceIds: [],
          authorityIds: [],
          provenance,
          humanReviewStatus: "reviewed",
          legalStandard: "STANDARD_NOT_EXTRACTED",
          bindingAuthorities: [],
          persuasiveAuthorities: [],
          contraryAuthorities: [],
          guiltConclusion: null,
        },
        {
          chargeId: "ch-1",
          offenseName: "Count 1",
          elementId: "el-conflict",
          elementText: "Possession",
          status: "CONFLICTED",
          supportingEvidenceIds: ["ev-a"],
          contraryEvidenceIds: ["ev-contrary"],
          uncertainEvidenceIds: [],
          missingEvidenceIds: [],
          authorityIds: [],
          provenance,
          humanReviewStatus: "unreviewed",
          legalStandard: "STANDARD_NOT_EXTRACTED",
          bindingAuthorities: [],
          persuasiveAuthorities: [],
          contraryAuthorities: [],
          guiltConclusion: null,
        },
        {
          chargeId: "ch-2",
          offenseName: "Count 2",
          elementId: "el-missing",
          elementText: "Intent",
          status: "NO_EVIDENCE_FOUND",
          supportingEvidenceIds: [],
          contraryEvidenceIds: [],
          uncertainEvidenceIds: [],
          missingEvidenceIds: ["expected-lab-report"],
          authorityIds: [],
          provenance,
          humanReviewStatus: "unreviewed",
          legalStandard: "STANDARD_NOT_EXTRACTED",
          bindingAuthorities: [],
          persuasiveAuthorities: [],
          contraryAuthorities: [],
          guiltConclusion: null,
        },
      ],
      evidence: [
        {
          id: "ev-joint",
          evidenceType: "photograph",
          relatedDefendantIds: ["def-a", "def-b"],
          relatedChargeIds: ["ch-1"],
          relatedElementIds: ["el-supported"],
          chainOfCustody: [
            {
              actor: "Officer A",
              timestamp: "2024-01-02T10:00:00Z",
              from: null,
              to: "Officer A",
              source: provenance,
            },
            {
              actor: "Evidence Room",
              timestamp: "2024-01-02T12:00:00Z",
              from: "Officer B",
              to: "Evidence Room",
              source: provenance,
            },
          ],
          provenance,
        },
        {
          id: "ev-a",
          evidenceType: "police_report",
          relatedDefendantIds: ["def-a"],
          relatedChargeIds: ["ch-1"],
          relatedElementIds: ["el-conflict"],
          chainOfCustody: [],
          provenance,
        },
        {
          id: "ev-contrary",
          evidenceType: "witness_statement",
          relatedDefendantIds: ["def-a"],
          relatedChargeIds: ["ch-1"],
          relatedElementIds: ["el-conflict"],
          chainOfCustody: [
            {
              actor: "Officer A",
              timestamp: "2024-01-02T10:00:00Z",
              from: null,
              to: "Officer A",
              source: provenance,
            },
          ],
          provenance: { extractionOrigin: "deterministic_fixture", humanEntered: false },
        },
        {
          id: "ev-unassigned",
          evidenceType: "other",
          relatedDefendantIds: [],
          relatedChargeIds: [],
          relatedElementIds: [],
          chainOfCustody: [],
          provenance,
        },
      ],
      evidenceLinks: [
        {
          id: "link-1",
          evidenceId: "ev-joint",
          relationship: "SUPPORTS_ELEMENT",
          targetType: "ChargeElement",
          targetId: "el-supported",
          provenance,
          createdAt: "2024-01-03T00:00:00Z",
        },
        {
          id: "link-2",
          evidenceId: "ev-contrary",
          relationship: "UNDERMINES_ELEMENT",
          targetType: "ChargeElement",
          targetId: "el-conflict",
          provenance,
          createdAt: "2024-01-03T00:00:00Z",
        },
      ],
      witnesses: [{ id: "wit-1", displayName: "Synthetic Witness" }],
      statements: [
        {
          id: "st-1",
          witnessId: "wit-1",
          claims: [
            { key: "location", value: "Main St", kind: "fact" },
            { key: "time", value: "10:00", kind: "time" },
          ],
          provenance,
          statementDate: "2024-01-01",
          sourceDocumentId: "doc-synthetic-1",
        },
        {
          id: "st-2",
          witnessId: "wit-1",
          claims: [
            { key: "location", value: "Oak Ave", kind: "fact" },
            { key: "time", value: "11:00", kind: "time" },
            { key: "clothing", value: "red jacket", kind: "fact" },
          ],
          provenance,
          statementDate: "2024-01-04",
          sourceDocumentId: "doc-synthetic-2",
        },
      ],
      timeline: [
        {
          id: "tl-1",
          eventType: "ARREST",
          title: "Arrest recorded",
          eventDate: "2024-01-05T09:00:00Z",
          provenance,
        },
        {
          id: "tl-2",
          eventType: "ARREST",
          title: "Arrest recorded (alternate source)",
          eventDate: "2024-01-06T09:00:00Z",
          provenance: { ...provenance, documentId: "doc-synthetic-alt" },
        },
      ],
      procedureIssues: [
        { id: "proc-1", issueType: "WARRANT", status: "open", missingFacts: ["device id"] },
      ],
      disclosures: [
        { id: "disc-1", status: "REVIEW_REQUIRED", category: "POTENTIALLY_EXCULPATORY" },
      ],
    });

    expect(snapshot.guiltConclusion).toBeNull();
    expect(snapshot.chargingRecommendation).toBeNull();
    expect(snapshot.witnessCredibilityScore).toBeNull();
    expect(snapshot.overviewStats.elementConflicted).toBe(1);
    expect(snapshot.overviewStats.elementMissingSupport).toBe(1);
    expect(snapshot.overviewStats.custodyWarningCount).toBeGreaterThan(0);
    expect(snapshot.overviewStats.witnessConflictCount).toBeGreaterThan(0);
    expect(snapshot.investigationGaps.some((g) => g.gapType === "ELEMENT_NO_SUPPORT")).toBe(true);
    expect(snapshot.investigationGaps.some((g) => g.gapType === "ELEMENT_CONFLICTED")).toBe(true);
    expect(snapshot.investigationGaps.some((g) => g.gapType === "CHAIN_OF_CUSTODY")).toBe(true);
    expect(snapshot.investigationGaps.some((g) => g.gapType === "WITNESS_CONFLICT")).toBe(true);
    expect(snapshot.investigationGaps.some((g) => g.gapType === "DISCLOSURE_REVIEW_REQUIRED")).toBe(
      true,
    );
    expect(snapshot.investigationGaps.some((g) => g.gapType === "JOINT_SCOPE_REVIEW")).toBe(true);
    expect(snapshot.investigationGaps.some((g) => g.gapType === "UNASSIGNED_EVIDENCE")).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/GUILTY|probability of guilt|credibility score/i);
    expect(JSON.stringify(snapshot.witnessIntelligence)).not.toMatch(
      /\b(lie|perjury|dishonest|false testimony|fabrication)\b/i,
    );

    const ask = formatProsecutionAskIntelligenceContext(snapshot);
    expect(ask).toContain("PROSECUTION_CASE_INTELLIGENCE");
    expect(ask).toContain("GUILT_CONCLUSION: null");
    expect(ask).toContain("ELEMENT_MISSING_SUPPORT");
    expect(ask).toContain("Do not invent facts");
  });

  it("normalizes evidence taxonomy aliases without inventing admissibility", () => {
    expect(normalizeProsecutionEvidenceType("bodycam")).toBe("body_camera");
    expect(normalizeProsecutionEvidenceType("scene_photo")).toBe("photograph");
    expect(normalizeProsecutionEvidenceType("report")).toBe("police_report");
    expect(normalizeProsecutionEvidenceType("")).toBe("unknown");
    expect(PROSECUTION_EVIDENCE_TYPES).toContain("forensic_report");
    expect(PROSECUTION_EVIDENCE_TYPES).toContain("unknown");
  });
});
