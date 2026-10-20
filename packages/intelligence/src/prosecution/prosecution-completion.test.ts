import { describe, expect, it } from "vitest";
import { INVITEABLE_ROLE_KEYS, OWNER_ASSIGNED_ROLE_KEYS, isInviteableRoleKey } from "@nyayagrid/auth";
import { inviteMembershipSchema } from "@nyayagrid/validation";
import {
  annotateRetrievedAuthorities,
  authorityStatusRankContribution,
  precedentRankContribution,
  projectSharedLegalGraph,
  traverseSharedGraph,
  runLawFirmIntegratedFixture,
  runProsecutionIntegratedFixture,
  buildProsecutionResearchContext,
  researchSuppressionIssue,
  compareWitnessStatements,
  transitionDisclosure,
  SHARED_GRAPH_DECISION,
} from "@nyayagrid/intelligence";
import { evaluateAuthorityStatus } from "@nyayagrid/jurisdiction";

const provenance = { extractionOrigin: "deterministic_fixture" as const, sourceSpan: "Synthetic span." };

describe("prosecution invites", () => {
  it("invites working prosecution roles and keeps supervisory roles with the owner", () => {
    expect(INVITEABLE_ROLE_KEYS).toEqual([
      "lawyer",
      "staff",
      "client_guest",
      "prosecutor",
      "investigator",
      "legal_support",
      "prosecution_read_only",
    ]);
    expect(isInviteableRoleKey("prosecutor")).toBe(true);
    expect(isInviteableRoleKey("supervising_prosecutor")).toBe(false);
    expect(isInviteableRoleKey("prosecution_office_admin")).toBe(false);
    expect(OWNER_ASSIGNED_ROLE_KEYS).toContain("supervising_prosecutor");
    expect(inviteMembershipSchema.safeParse({ email: "a@example.com", roleKey: "prosecutor" }).success).toBe(true);
    expect(inviteMembershipSchema.safeParse({ email: "a@example.com", roleKey: "supervising_prosecutor" }).success).toBe(false);
  });
});

describe("authority retrieval ranking", () => {
  const hits = [
    {
      authorityId: "binding-irrelevant",
      citation: "SYNTHETIC-3D-2010-001",
      courtId: "us-ca-3",
      jurisdiction: "US",
      authorityType: "case",
      score: 0.1,
    },
    {
      authorityId: "persuasive-relevant",
      citation: "SYNTHETIC-2D-2019-014",
      courtId: "us-ca-2",
      jurisdiction: "US",
      authorityType: "case",
      score: 0.86,
    },
  ];

  it("does not let a binding label outrank a much more relevant authority", () => {
    const ranked = annotateRetrievedAuthorities(
      hits,
      { questionJurisdiction: "US", forumCourtId: "us-d-pa-ed", issueType: "FEDERAL_STATUTORY" },
      { applyStatusRank: true },
    );
    expect(ranked[0]?.authorityId).toBe("persuasive-relevant");
    expect(ranked[0]?.authorityStatus).toBe("PERSUASIVE");
    expect(ranked[1]?.authorityStatus).toBe("BINDING");
    expect(Math.abs(authorityStatusRankContribution("BINDING"))).toBeLessThanOrEqual(0.15);
  });

  it("uses binding only as a tie-break and abstains without issue context", () => {
    const near = annotateRetrievedAuthorities(
      [
        { ...hits[1], authorityId: "persuasive", score: 0.5 },
        { ...hits[0], authorityId: "binding", score: 0.5 },
      ],
      { questionJurisdiction: "US", forumCourtId: "us-d-pa-ed", issueType: "FEDERAL_STATUTORY" },
      { applyStatusRank: true },
    );
    expect(near[0]?.authorityId).toBe("binding");
    const unknown = annotateRetrievedAuthorities(hits, { forumCourtId: "us-d-pa-ed", issueType: "UNKNOWN" });
    expect(unknown.every((hit) => hit.authorityStatus === "UNKNOWN")).toBe(true);
    expect(unknown.every((hit) => hit.abstention === "INSUFFICIENT_CONTEXT")).toBe(true);
  });

  it("caps precedent volume and does not treat an unverified citation as negative treatment", () => {
    expect(precedentRankContribution(500, true)).toBeLessThanOrEqual(0.02);
    const ranked = annotateRetrievedAuthorities(
      [{ ...hits[0], score: 0.4, authorityId: "treated" }],
      {
        questionJurisdiction: "US",
        forumCourtId: "us-d-pa-ed",
        issueType: "FEDERAL_STATUTORY",
        precedentInbound: { treated: 500 },
        treatments: [{ authorityId: "treated", label: "OVERRULED", verification: "unknown" }],
      },
      { applyStatusRank: true },
    );
    expect(ranked[0]?.treatmentDisplay).toBe("TREATMENT_UNVERIFIED");
    expect(ranked[0]?.treatmentLabel).toBeNull();
    expect(ranked[0]?.adjustedScore).toBeGreaterThan(0.4);
  });

  it("attaches a sourced standard and abstains when none exists", () => {
    const ranked = annotateRetrievedAuthorities(
      hits,
      {
        questionJurisdiction: "US",
        forumCourtId: "us-d-pa-ed",
        issueType: "FEDERAL_STATUTORY",
        standards: [
          {
            id: "std-1",
            authorityId: "binding-irrelevant",
            ruleText: "Synthetic rule.",
            sourceSpan: "Synthetic span.",
            sourceCitation: "SYNTHETIC-3D-2010-001",
          },
        ],
      },
      { applyStatusRank: true },
    );
    const binding = ranked.find((hit) => hit.authorityId === "binding-irrelevant");
    const persuasive = ranked.find((hit) => hit.authorityId === "persuasive-relevant");
    expect(binding?.legalStandard).toMatchObject({ sourceCitation: "SYNTHETIC-3D-2010-001" });
    expect(persuasive?.legalStandard).toBe("STANDARD_NOT_EXTRACTED");
  });

  it("does not treat superseded metadata as current binding law", () => {
    const ranked = annotateRetrievedAuthorities(
      [{ ...hits[0]!, authorityId: hits[0]!.authorityId, currentnessStatus: "superseded", score: 0.9 }],
      { questionJurisdiction: "US", forumCourtId: "us-d-pa-ed", issueType: "FEDERAL_STATUTORY" },
      { applyStatusRank: true },
    );
    expect(ranked[0]?.authorityStatus).toBe("NONCONTROLLING");
    expect(ranked[0]?.reasonCode).toBe("SUPERSEDED_AUTHORITY");
  });
});

describe("integrated fixtures", () => {
  it("connects a law-firm issue to a rule, binding authority, and contrary evidence", () => {
    const result = runLawFirmIntegratedFixture();
    expect(result.demo.issue.issueType).toBe("FEDERAL_STATUTORY");
    expect(result.demo.standard).toMatchObject({ sourceCitation: "SYNTHETIC-3D-2020-001" });
    expect(result.ranked.some((hit) => hit.authorityStatus === "BINDING" && hit.courtId === "us-ca-3")).toBe(true);
    expect(result.ranked.some((hit) => hit.authorityStatus === "PERSUASIVE" && hit.courtId === "us-ca-2")).toBe(true);
    expect(result.demo.supportingEvidence.length).toBeGreaterThan(0);
    expect(result.demo.contraryEvidence.length).toBeGreaterThan(0);
    expect(result.guiltConclusion).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/GUILTY/);
  });

  it("connects a prosecution case to elements, contrary evidence, and authority status", () => {
    const result = runProsecutionIntegratedFixture();
    expect(result.overview.charges.length).toBe(2);
    expect(result.matrix.map((row) => row.status)).toEqual(["SUPPORTED", "CONFLICTED", "NO_EVIDENCE_FOUND"]);
    expect(result.matrix.every((row) => row.guiltConclusion === null)).toBe(true);
    expect(result.matrix[0]?.legalStandard).toMatchObject({ sourceCitation: "SYNTHETIC-PA-2018-004" });
    expect(result.matrix[0]?.bindingAuthorities.some((item) => item.authorityId === "auth-pa-high")).toBe(true);
    expect(result.research.bindingAuthorities.some((hit) => hit.courtId === "st-pa-high")).toBe(true);
    expect(result.research.authorities.some((hit) => hit.authorityStatus === "OUT_OF_JURISDICTION")).toBe(true);
    expect(result.research.authorities.find((hit) => hit.authorityId === "auth-pa-high")?.legalStandard).toMatchObject({
      sourceCitation: "SYNTHETIC-PA-2018-004",
    });
    expect(result.witnessComparison.some((row) => row.label === "CONTRADICTORY")).toBe(true);
    expect(result.suppression.suppressionConclusion).toBeNull();
    expect(result.suppression.context.missingFacts).toContain("warrant return");
    expect(result.suppression.authorities[0]?.authorityStatus).toBe("BINDING");
    expect(result.guiltConclusion).toBeNull();
  });
});

describe("suppression and witness structure", () => {
  it("abstains when jurisdiction is missing and does not decide suppression", () => {
    const context = buildProsecutionResearchContext({ procedureIssueType: "SEARCH" });
    expect(context.issueType).toBe("UNKNOWN");
    expect(context.suppressionConclusion).toBeNull();
    const researched = researchSuppressionIssue({
      issueType: "MIRANDA",
      jurisdiction: "PA",
      court: "st-pa-trial",
      missingFacts: ["custody"],
      hits: [{ authorityId: "scotus", courtId: "us-scotus", jurisdiction: "US", authorityType: "case", score: 0.4 }],
    });
    expect(researched.authorities[0]?.authorityStatus).toBe("BINDING");
    expect(researched.suppressionConclusion).toBeNull();
    expect(researched.context.abstention).toBe("INSUFFICIENT_CONTEXT");
  });

  it("keeps statement differences independent and unlabeled as deceit", () => {
    expect(compareWitnessStatements([{ key: "a", value: "1" }], [{ key: "a", value: "1" }])[0]?.label).toBe("CONSISTENT");
    expect(compareWitnessStatements([{ key: "a", value: "1" }], [])[0]?.label).toBe("OMISSION");
    expect(compareWitnessStatements([], [{ key: "b", value: "2" }])[0]?.label).toBe("ADDED_DETAIL");
    expect(
      compareWitnessStatements([{ key: "when", value: "1pm", kind: "time" }], [{ key: "when", value: "3pm", kind: "time" }])[0]
        ?.label,
    ).toBe("TIMELINE_DIFFERENCE");
    expect(compareWitnessStatements([], [])[0]?.label).toBe("UNKNOWN");
    expect(JSON.stringify(compareWitnessStatements([{ key: "a", value: "1" }], [{ key: "a", value: "2" }]))).not.toMatch(
      /LIAR|UNTRUTHFUL|DECEPTIVE/,
    );
  });

  it("refuses an automated disclosure decision", () => {
    expect(() => transitionDisclosure({ next: "REVIEWED_DISCLOSE", humanActor: false })).toThrow(/disclosure/i);
    expect(transitionDisclosure({ next: "REVIEW_REQUIRED", humanActor: false })).toBe("REVIEW_REQUIRED");
  });
});

describe("shared graph projection", () => {
  it("traverses charge, issue, warrant, and authority without using the matter graph enum", () => {
    expect(SHARED_GRAPH_DECISION.decision).toBe("PROJECTION_BRIDGE");
    const graph = projectSharedLegalGraph({
      criminalCase: { id: "case", provenance },
      charges: [{ id: "charge", provenance }],
      elements: [{ id: "element", chargeId: "charge", evidenceIds: ["evidence"], issueIds: ["issue"], provenance }],
      evidence: [{ id: "evidence", provenance }],
      witnesses: [{ id: "witness", evidenceIds: ["evidence"], provenance }],
      warrants: [{ id: "warrant", evidenceIds: ["evidence"], provenance }],
      motions: [{ id: "motion", issueIds: ["issue"], provenance }],
      issues: [{ id: "issue", authorityIds: ["authority"], provenance }],
      authorities: [{ id: "authority", standardIds: ["standard"], relatedAuthorityIds: ["older"], provenance }],
      standards: [{ id: "standard", provenance }],
    });
    expect(traverseSharedGraph(graph, "charge", "HAS_ELEMENT").map((node) => node.id)).toEqual(["element"]);
    expect(traverseSharedGraph(graph, "element", "ELEMENT_EVIDENCE").map((node) => node.id)).toEqual(["evidence"]);
    expect(traverseSharedGraph(graph, "element", "ELEMENT_ISSUE").map((node) => node.id)).toEqual(["issue"]);
    expect(traverseSharedGraph(graph, "issue", "ISSUE_AUTHORITY").map((node) => node.id)).toEqual(["authority"]);
    expect(traverseSharedGraph(graph, "evidence", "EVIDENCE_WITNESS").map((node) => node.id)).toEqual(["witness"]);
    expect(traverseSharedGraph(graph, "warrant", "WARRANT_EVIDENCE").map((node) => node.id)).toEqual(["evidence"]);
    expect(traverseSharedGraph(graph, "motion", "MOTION_ISSUE").map((node) => node.id)).toEqual(["issue"]);
    expect(traverseSharedGraph(graph, "authority", "AUTHORITY_STANDARD").map((node) => node.id)).toEqual(["standard"]);
    expect(traverseSharedGraph(graph, "authority", "AUTHORITY_AUTHORITY").map((node) => node.id)).toEqual(["older"]);
    expect(graph.edges.every((edge) => edge.provenance?.sourceSpan === "Synthetic span.")).toBe(true);
  });
});

describe("authority status performance smoke", () => {
  it("evaluates a few hundred statuses without a pathological loop", () => {
    const started = Date.now();
    for (let index = 0; index < 300; index += 1) {
      evaluateAuthorityStatus({
        questionJurisdiction: "US",
        forumCourtId: "us-d-pa-ed",
        issueType: "FEDERAL_STATUTORY",
        authorityCourtId: index % 2 === 0 ? "us-ca-3" : "us-ca-2",
      });
    }
    expect(Date.now() - started).toBeLessThan(500);
  });
});
