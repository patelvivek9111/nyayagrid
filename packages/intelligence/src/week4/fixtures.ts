import { buildProsecutorDemo } from "../prosecution/fixture";
import { buildLawFirmDemo } from "../legal/law-to-evidence";
import { buildLawEvidenceBundle, buildClaimMatrix, buildRetrievalAwareElementsMatrix, toStructuredAnswerContext } from "./law-evidence-join";
import { buildWitnessIntelligence } from "./witness-intelligence";
import { normalizeCustody, validateChainOfCustody } from "./chain-of-custody";
import { detectTimelineConflicts, unifyCriminalTimeline } from "./timeline";
import { buildDiscoveryDashboard, suggestDisclosureCandidates } from "./discovery-ops";
import { buildWarrantIntelligence } from "./warrant-intelligence";
import { researchSuppressionIssue } from "../prosecution/research-context";
import type { EvidenceCorpusItem } from "./evidence-retrieval";
import type { EvidenceRelationLabel, QueryContext } from "./types";

const PROV = {
  extractionOrigin: "deterministic_fixture" as const,
  humanEntered: false,
  sourceSpan: "Synthetic source span.",
};

export function runFixtureALawFirm() {
  const demo = buildLawFirmDemo();
  const context: QueryContext = {
    organizationId: "org-synthetic-firm",
    workspaceType: "professional",
    matterId: "matter-synthetic-1",
    jurisdiction: "US",
    forumCourt: "us-d-pa-ed",
    issueType: "FEDERAL_STATUTORY",
    userQuestion: "What are the strengths and weaknesses of this claim?",
    subjectMatter: "civil",
  };
  const bundle = buildLawEvidenceBundle({
    context,
    evidenceCorpus: [
      {
        id: "ev-support",
        organizationId: context.organizationId,
        matterId: context.matterId,
        kind: "exhibit",
        text: "Letter exhibit states the notice was written and timely.",
        documentId: "doc-letter",
        relation: "SUPPORTS",
        provenance: { ...PROV, documentId: "doc-letter", sourcePage: 1 },
      },
      {
        id: "ev-contrary",
        organizationId: context.organizationId,
        matterId: context.matterId,
        kind: "log",
        text: "Recipient log has no delivery entry.",
        documentId: "doc-log",
        relation: "CONTRADICTS",
        provenance: { ...PROV, documentId: "doc-log", sourcePage: 2 },
      },
      {
        id: "ev-other-org",
        organizationId: "org-other",
        matterId: "matter-other",
        kind: "exhibit",
        text: "Should never appear.",
        relation: "SUPPORTS",
        provenance: PROV,
      },
    ],
    authorityHits: [
      {
        authorityId: "auth-3d",
        citation: "SYNTHETIC-3D-2020-001",
        courtId: "us-ca-3",
        jurisdiction: "US",
        authorityType: "case",
        score: 0.45,
        title: "Synthetic Third Circuit notice case",
        snippet: "written and timely notice",
      },
      {
        authorityId: "auth-2d",
        citation: "SYNTHETIC-2D-2019-014",
        courtId: "us-ca-2",
        jurisdiction: "US",
        authorityType: "case",
        score: 0.9,
        title: "Synthetic Second Circuit discussion",
        snippet: "notice discussion",
      },
    ],
    standards:
      demo.standard && "ruleText" in demo.standard
        ? [
            {
              id: demo.standard.id,
              authorityId: "auth-3d",
              ruleText: demo.standard.ruleText,
              sourceSpan: demo.standard.sourceSpan ?? "",
              sourceCitation: demo.standard.sourceCitation ?? "",
            },
          ]
        : [],
    facts: demo.facts,
    requirements: [
      { id: "req-notice", text: "written notice", claimOrChargeId: "claim-1", status: "PARTIALLY_SUPPORTED" },
      { id: "req-timely", text: "timely delivery", claimOrChargeId: "claim-1", status: "CONFLICTED" },
    ],
    missingEvidence: [{ id: "missing-delivery", description: "No delivery receipt.", relatedRequirementId: "req-timely" }],
  });
  const claimMatrix = buildClaimMatrix([
    {
      claimOrDefenseId: "claim-1",
      label: "Synthetic notice claim",
      requirementId: "req-notice",
      requirementText: "written notice",
      supportingEvidence: bundle.supportingEvidence.map((item) => ({ id: item.id, text: item.text })),
      contraryEvidence: bundle.contraryEvidence.map((item) => ({ id: item.id, text: item.text })),
      missingEvidence: bundle.missingEvidence.map((item) => ({ id: item.id, description: item.description })),
      governingAuthorities: bundle.bindingAuthorities.map((item) => ({
        authorityId: String(item.authorityId),
        status: String(item.authorityStatus),
        citation: (item.citation as string | null) ?? null,
      })),
      status: "PARTIALLY_SUPPORTED",
      provenance: { sourceSpan: "Synthetic source span.", documentId: "doc-letter" },
    },
  ]);
  return {
    bundle,
    claimMatrix,
    answerContext: toStructuredAnswerContext(bundle),
    guiltConclusion: null as null,
  };
}

export function runFixtureBProsecution() {
  const workspace = buildProsecutorDemo();
  const snapshot = workspace.snapshot("org-synthetic-prosecution");
  const criminalCase = snapshot.cases[0]!;
  const context: QueryContext = {
    organizationId: "org-synthetic-prosecution",
    workspaceType: "prosecution",
    criminalCaseId: criminalCase.id,
    jurisdiction: criminalCase.jurisdiction,
    forumCourt: criminalCase.court,
    issueType: "STATE_LAW",
    userQuestion: "What are the strengths and weaknesses of the prosecution case?",
    subjectMatter: "criminal",
  };
  const researchHits = [
    {
      authorityId: "auth-pa-high",
      citation: "SYNTHETIC-PA-2018-004",
      courtId: "st-pa-high",
      jurisdiction: "PA",
      authorityType: "case",
      score: 0.55,
      snippet: "taking of property",
    },
    {
      authorityId: "auth-nj-high",
      citation: "SYNTHETIC-NJ-2017-009",
      courtId: "st-nj-high",
      jurisdiction: "NJ",
      authorityType: "case",
      score: 0.88,
      snippet: "receiving property",
    },
  ];
  const standards = [
    {
      id: "std-taking",
      authorityId: "auth-pa-high",
      ruleText: "Synthetic rule: a taking is a physical acquisition of property.",
      sourceSpan: "Synthetic source span.",
      sourceCitation: "SYNTHETIC-PA-2018-004",
    },
  ];
  const evidenceCorpus: EvidenceCorpusItem[] = [
    ...snapshot.evidence.map((item): EvidenceCorpusItem => ({
      id: item.id,
      organizationId: item.organizationId,
      criminalCaseId: item.criminalCaseId,
      kind: item.evidenceType,
      text: `Evidence ${item.storageReference ?? item.id}`,
      documentId: item.documentId,
      relation: (item.id === snapshot.evidence[0]?.id
        ? "SUPPORTS"
        : "UNKNOWN_RELATION") satisfies EvidenceRelationLabel,
      provenance: item.provenance,
    })),
    ...snapshot.statements.map((statement): EvidenceCorpusItem => ({
      id: statement.id,
      organizationId: statement.organizationId,
      criminalCaseId: statement.criminalCaseId,
      kind: "witness_statement",
      text: statement.sourceSpan ?? "statement",
      documentId: statement.sourceDocumentId,
      relation: statement.id === "stmt-contrary" ? "CONTRADICTS" : "SUPPORTS",
      provenance: statement.provenance,
    })),
  ];
  const bundle = buildLawEvidenceBundle({
    context,
    evidenceCorpus,
    authorityHits: researchHits,
    standards,
    requirements: workspace.matrix("org-synthetic-prosecution", criminalCase.id).map((row) => ({
      id: row.elementId,
      text: row.elementText,
      claimOrChargeId: row.chargeId,
      status: row.status,
    })),
    missingEvidence: [{ id: "knowledge-source", description: "No evidence of knowledge.", relatedRequirementId: workspace.matrix("org-synthetic-prosecution", criminalCase.id)[2]?.elementId ?? null }],
  });
  const matrix = buildRetrievalAwareElementsMatrix({
    matrix: workspace.matrix("org-synthetic-prosecution", criminalCase.id),
    authorities: bundle.bindingAuthorities
      .concat(bundle.persuasiveAuthorities)
      .map((item) => ({
        authorityId: String(item.authorityId),
        status: String(item.authorityStatus),
        reasonCode: String(item.reasonCode),
        citation: (item.citation as string | null) ?? null,
        issueRelation: String(item.issueRelation ?? ""),
      })),
    standards,
  });
  const witness = buildWitnessIntelligence({
    statements: snapshot.statements.map((statement) => ({
      id: statement.id,
      witnessId: statement.witnessId,
      witnessName: "Synthetic Witness",
      claims: statement.claims,
      provenance: statement.provenance,
    })),
    evidenceTexts: snapshot.evidence.map((item) => ({
      id: item.id,
      text: item.storageReference ?? item.id,
      provenance: item.provenance,
    })),
  });
  const suppression = researchSuppressionIssue({
    jurisdiction: criminalCase.jurisdiction,
    court: criminalCase.court,
    issueType: snapshot.procedureIssues[0]?.issueType ?? "WARRANT",
    missingFacts: snapshot.procedureIssues[0]?.missingFacts ?? [],
    hits: [
      {
        authorityId: "auth-scotus",
        citation: "SYNTHETIC-SCOTUS-2015-001",
        courtId: "us-scotus",
        jurisdiction: "US",
        authorityType: "case",
        score: 0.5,
      },
    ],
  });
  return {
    bundle,
    matrix,
    witness,
    suppression,
    answerContext: toStructuredAnswerContext(bundle),
    guiltConclusion: null as null,
  };
}

export function runFixtureCWarrant() {
  return buildWarrantIntelligence({
    assertions: [
      {
        id: "assert-1",
        text: "Synthetic informant reported stolen property at the address.",
        sourceFactId: "fact-1",
        sourceDocumentId: "doc-affidavit",
        provenance: { ...PROV, documentId: "doc-affidavit", sourcePage: 1 },
      },
      {
        id: "assert-2",
        text: "Officer observed boxes matching the report.",
        sourceFactId: null,
        sourceDocumentId: "doc-affidavit",
        provenance: { ...PROV, documentId: "doc-affidavit", sourcePage: 2 },
      },
    ],
    facts: [{ id: "fact-1", text: "Informant tip recorded in report.", provenance: { ...PROV, documentId: "doc-report" } }],
    evidence: [
      { id: "ev-1", text: "Synthetic informant reported stolen property at the address.", relation: "SUPPORTS" },
      { id: "ev-2", text: "Neighbor saw no boxes.", relation: "CONTRADICTS" },
    ],
    scope: "residence and attached garage",
    issueDate: "2026-02-18",
    executionDate: "2026-02-19",
    seizedEvidenceIds: ["ev-physical"],
    missingFacts: ["warrant return inventory"],
    legalStandards: [
      {
        id: "std-pc",
        authorityId: "auth-scotus",
        ruleText: "Synthetic probable-cause standard from source text.",
        sourceCitation: "SYNTHETIC-SCOTUS-2015-001",
        sourceSpan: "Synthetic span.",
      },
    ],
    authorities: [
      {
        authorityId: "auth-scotus",
        authorityStatus: "BINDING",
        citation: "SYNTHETIC-SCOTUS-2015-001",
      },
    ],
  });
}

export function runFixtureDWitness() {
  return buildWitnessIntelligence({
    statements: [
      {
        id: "s1",
        witnessId: "w1",
        witnessName: "Witness A",
        claims: [
          { key: "took-item", value: "yes" },
          { key: "when", value: "1pm", kind: "time" },
        ],
        provenance: { ...PROV, documentId: "doc-a" },
      },
      {
        id: "s2",
        witnessId: "w1",
        witnessName: "Witness A",
        claims: [
          { key: "took-item", value: "no" },
          { key: "when", value: "3pm", kind: "time" },
        ],
        provenance: { ...PROV, documentId: "doc-b" },
      },
      {
        id: "s3",
        witnessId: "w2",
        witnessName: "Witness B",
        claims: [
          { key: "took-item", value: "yes" },
          { key: "color", value: "blue" },
        ],
        provenance: { ...PROV, documentId: "doc-c" },
      },
    ],
    evidenceTexts: [{ id: "ev-1", text: "Report notes blue bag.", provenance: { ...PROV, documentId: "doc-report" } }],
  });
}

export function runFixtureEDiscovery() {
  const items = [
    {
      id: "d1",
      reviewStatus: "RECEIVED",
      productionStatus: "RECEIVED",
      category: "reports",
      receivedDate: "2026-02-22",
    },
    {
      id: "d2",
      reviewStatus: "REVIEWED",
      productionStatus: "PRODUCED",
      category: "statements",
      receivedDate: "2026-02-20",
      producedDate: "2026-02-25",
    },
    {
      id: "d3",
      reviewStatus: "FLAGGED",
      productionStatus: "WITHHELD_FOR_ATTORNEY_REVIEW",
      category: "bodycam",
      receivedDate: "2026-02-21",
    },
    {
      id: "d4",
      reviewStatus: "UNKNOWN",
      productionStatus: "RECEIVED",
      category: "MISSING_EXPECTED",
    },
  ];
  const candidates = suggestDisclosureCandidates({
    contradictoryEvidenceIds: ["stmt-contrary"],
    witnessConflictKeys: ["took-item"],
    weakElementIds: ["element-knowledge"],
  }).map((candidate, index) => ({ ...candidate, id: `disc-${index + 1}` }));
  return {
    dashboard: buildDiscoveryDashboard({ items, disclosureCandidates: candidates }),
    candidates,
    humanFinalRequired: true,
  };
}

export function runCustodyAndTimelineSmoke() {
  const transfers = normalizeCustody([
    {
      actor: "Officer Synthetic",
      timestamp: "2026-02-19T10:00:00Z",
      from: null,
      to: "evidence locker",
      source: { ...PROV, documentId: "doc-log" },
    },
    {
      actor: "Lab tech",
      timestamp: "2026-02-20T09:00:00Z",
      from: "evidence locker",
      to: "lab",
      source: { ...PROV, documentId: "doc-lab" },
    },
    {
      actor: "unknown",
      timestamp: "2026-02-18T09:00:00Z",
      from: "street",
      to: "patrol car",
      source: { extractionOrigin: "import", humanEntered: false },
    },
  ]);
  const timeline = unifyCriminalTimeline([
    {
      id: "t1",
      eventType: "OFFENSE",
      title: "Offense",
      occurredAt: "2026-02-18T12:00:00Z",
      peopleIds: [],
      chargeIds: [],
      evidenceIds: [],
      documentIds: [],
      provenance: PROV,
      confidence: "medium",
    },
    {
      id: "t2",
      eventType: "ARREST",
      title: "Arrest",
      occurredAt: "2026-02-18T18:00:00Z",
      peopleIds: [],
      chargeIds: [],
      evidenceIds: [],
      documentIds: [],
      provenance: PROV,
      confidence: "medium",
    },
    {
      id: "t3",
      eventType: "ARREST",
      title: "Arrest alt",
      occurredAt: "2026-02-18T19:00:00Z",
      peopleIds: [],
      chargeIds: [],
      evidenceIds: [],
      documentIds: ["doc-alt"],
      provenance: { ...PROV, documentId: "doc-alt" },
      confidence: "low",
    },
  ]);
  return {
    custodyFindings: validateChainOfCustody(transfers),
    timeline,
    timelineConflicts: detectTimelineConflicts(timeline),
  };
}
