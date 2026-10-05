import { describe, expect, it } from "vitest";
import { compareWitnessStatements, prosecutionCapabilityAllows } from "./domain";
import { buildProsecutorDemo } from "./fixture";
import { ProsecutionWorkspace } from "./memory";

describe("prosecution elements matrix", () => {
  it("shows supported, conflicted, and missing elements without a guilt verdict", () => {
    const workspace = buildProsecutorDemo();
    const criminalCase = workspace.snapshot("org-synthetic-prosecution").cases[0]!;
    const matrix = workspace.matrix("org-synthetic-prosecution", criminalCase.id);
    expect(matrix.map((row) => row.status)).toEqual(["SUPPORTED", "CONFLICTED", "NO_EVIDENCE_FOUND"]);
    expect(matrix.every((row) => row.guiltConclusion === null)).toBe(true);
    const overview = workspace.overview("org-synthetic-prosecution", criminalCase.id);
    expect(overview.charges).toHaveLength(2);
    expect(overview.defendants).toHaveLength(1);
    expect(overview.evidenceCount).toBe(2);
    expect(overview.witnessCount).toBe(1);
    expect(overview.elementGaps.length).toBeGreaterThan(0);
    expect(overview.issueFlags[0]?.issueType).toBe("WARRANT");
    expect(overview.guiltConclusion).toBeNull();
  });
});

describe("witness comparison and disclosure", () => {
  it("reports a contradiction without calling a witness untruthful", () => {
    const workspace = buildProsecutorDemo();
    const statements = workspace.snapshot("org-synthetic-prosecution").statements;
    const comparison = compareWitnessStatements(statements[0]!.claims, statements[1]!.claims);
    expect(comparison[0]?.label).toBe("CONTRADICTORY");
    expect(JSON.stringify(comparison)).not.toMatch(/LIAR|UNTRUTHFUL|DECEPTIVE/);
    const disclosure = workspace.snapshot("org-synthetic-prosecution").disclosures[0]!;
    expect(disclosure.status).toBe("REVIEW_REQUIRED");
    expect(() =>
      workspace.addDisclosure({
        organizationId: "org-synthetic-prosecution",
        criminalCaseId: workspace.snapshot("org-synthetic-prosecution").cases[0]!.id,
        category: "POTENTIALLY_EXCULPATORY",
        status: "REVIEWED_NOT_DISCLOSE",
        notes: null,
        humanActorId: null,
        humanActor: false,
        provenance: { extractionOrigin: "deterministic_fixture", sourceSpan: "span" },
      }),
    ).toThrow(/final disclosure/i);
  });
});

describe("prosecution isolation", () => {
  it("blocks cross-case evidence links and cross-tenant reads", () => {
    const workspace = new ProsecutionWorkspace();
    const a = workspace.createCase(blank("org-a", "A"));
    const b = workspace.createCase(blank("org-a", "B"));
    const evidence = workspace.addEvidence({
      organizationId: "org-a",
      criminalCaseId: a.id,
      documentId: "doc",
      evidenceType: "report",
      sourceAgency: null,
      collector: null,
      collectionDate: null,
      storageReference: null,
      chainOfCustody: [],
      relatedDefendantIds: [],
      relatedChargeIds: [],
      relatedElementIds: [],
      relatedWitnessIds: [],
      sensitivity: "standard",
      reviewStatus: "received",
      provenance: { extractionOrigin: "human", humanEntered: true },
    });
    expect(() =>
      workspace.linkEvidence({
        organizationId: "org-a",
        criminalCaseId: b.id,
        evidenceId: evidence.id,
        relationship: "SUPPORTS_ELEMENT",
        targetType: "ChargeElement",
        targetId: "missing",
        provenance: { extractionOrigin: "human", humanEntered: true },
      }),
    ).toThrow(/another criminal case/i);
    expect(() => workspace.overview("org-b", a.id)).toThrow(/not found/i);
    expect(workspace.snapshot("org-b").cases).toHaveLength(0);
    expect(workspace.snapshot("org-a").audits.some((event) => event.action === "prosecution.case_created")).toBe(true);
  });
});

describe("prosecution graph, timeline, and roles", () => {
  it("projects graph nodes with provenance and accepts prosecution timeline types", () => {
    const workspace = buildProsecutorDemo();
    const criminalCase = workspace.snapshot("org-synthetic-prosecution").cases[0]!;
    const graph = workspace.graph("org-synthetic-prosecution", criminalCase.id);
    const types = new Set(graph.nodes.map((node) => node.nodeType));
    expect(types.has("CriminalCase")).toBe(true);
    expect(types.has("ChargeElement")).toBe(true);
    expect(types.has("Warrant")).toBe(true);
    expect(graph.edges.every((edge) => edge.provenance.extractionOrigin)).toBe(true);
    expect(workspace.snapshot("org-synthetic-prosecution").timeline[0]?.eventType).toBe("CHARGE_FILED");
  });

  it("separates read, edit, and disclosure review", () => {
    expect(prosecutionCapabilityAllows(new Set(["prosecution.view"]), "edit")).toBe(false);
    expect(prosecutionCapabilityAllows(new Set(["prosecution.edit"]), "edit")).toBe(true);
    expect(prosecutionCapabilityAllows(new Set(["prosecution.edit"]), "review")).toBe(false);
    expect(prosecutionCapabilityAllows(new Set(["prosecution.review"]), "review")).toBe(true);
  });
});

function blank(organizationId: string, caseNumber: string) {
  return {
    organizationId,
    matterId: null,
    caseNumber,
    jurisdiction: "PA",
    court: "st-pa-trial",
    courthouse: null,
    caseStatus: "open",
    assignedProsecutorId: null,
    supervisingProsecutorId: null,
    investigatingAgencyId: null,
    priority: "normal",
    filingDate: null,
    arrestDate: null,
    offenseDateStart: null,
    offenseDateEnd: null,
    trialDate: null,
    sentencingDate: null,
    closedDate: null,
    summary: null,
    notes: null,
    createdByUserId: null,
    updatedByUserId: null,
  };
}
