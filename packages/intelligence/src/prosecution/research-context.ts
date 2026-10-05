import type { LegalIssueType } from "@nyayagrid/jurisdiction";
import { annotateRetrievedAuthorities, type RetrievedAuthorityHit, type RetrievedLegalStandard } from "../legal/retrieval";
import { compareWitnessStatements, type StatementClaim } from "./domain";
import { buildProsecutorDemo } from "./fixture";
import { buildLawFirmDemo } from "../legal/law-to-evidence";

const CONSTITUTIONAL_ISSUES = new Set(["SEARCH", "WARRANT", "MIRANDA", "VOLUNTARINESS", "IDENTIFICATION"]);

export type ProsecutionResearchContext = {
  questionJurisdiction: string | null;
  forumCourtId: string | null;
  issueType: LegalIssueType;
  subjectMatter: "criminal";
  query: string;
  includedEvidenceSummaries: string[];
  missingFacts: string[];
  suppressionConclusion: null;
  abstention: "JURISDICTION_UNKNOWN" | "INSUFFICIENT_CONTEXT" | null;
};

export function buildProsecutionResearchContext(input: {
  jurisdiction?: string | null;
  court?: string | null;
  charge?: { offenseName?: string | null; statuteCitation?: string | null } | null;
  elementText?: string | null;
  procedureIssueType?: string | null;
  missingFacts?: string[];
  evidenceSummaries?: string[];
  includeEvidence?: boolean;
}): ProsecutionResearchContext {
  const jurisdiction = input.jurisdiction?.trim() || null;
  const court = input.court?.trim() || null;
  const procedure = input.procedureIssueType?.trim().toUpperCase() || null;
  const constitutional = procedure ? CONSTITUTIONAL_ISSUES.has(procedure) : false;
  const issueType: LegalIssueType =
    !jurisdiction && !court ? "UNKNOWN" : constitutional ? "FEDERAL_CONSTITUTIONAL" : jurisdiction ? "STATE_LAW" : "UNKNOWN";
  const questionJurisdiction = issueType === "UNKNOWN" ? null : constitutional ? "US" : jurisdiction;
  const parts = [
    input.charge?.statuteCitation,
    input.charge?.offenseName,
    input.elementText,
    procedure,
  ].filter((part): part is string => Boolean(part && part.trim()));
  return {
    questionJurisdiction,
    forumCourtId: court,
    issueType,
    subjectMatter: "criminal",
    query: parts.join(" ").trim(),
    includedEvidenceSummaries: input.includeEvidence ? (input.evidenceSummaries ?? []) : [],
    missingFacts: input.missingFacts ?? [],
    suppressionConclusion: null,
    abstention: issueType === "UNKNOWN" ? "JURISDICTION_UNKNOWN" : input.missingFacts && input.missingFacts.length > 0 ? "INSUFFICIENT_CONTEXT" : null,
  };
}

export function researchChargeAuthorities(input: {
  jurisdiction?: string | null;
  court?: string | null;
  charge: { offenseName?: string | null; statuteCitation?: string | null };
  elementText?: string | null;
  hits: RetrievedAuthorityHit[];
  standards?: RetrievedLegalStandard[];
  contraryAuthorityIds?: string[];
}) {
  const context = buildProsecutionResearchContext({
    jurisdiction: input.jurisdiction,
    court: input.court,
    charge: input.charge,
    elementText: input.elementText,
  });
  const ranked = annotateRetrievedAuthorities(
    input.hits,
    {
      questionJurisdiction: context.questionJurisdiction,
      forumCourtId: context.forumCourtId,
      issueType: context.issueType,
      subjectMatter: "criminal",
      standards: input.standards,
      contraryAuthorityIds: input.contraryAuthorityIds,
    },
    { applyStatusRank: context.issueType !== "UNKNOWN" },
  );
  return {
    context,
    authorities: ranked,
    bindingAuthorities: ranked.filter((hit) => hit.authorityStatus === "BINDING"),
    persuasiveAuthorities: ranked.filter((hit) => hit.authorityStatus === "PERSUASIVE"),
    contraryAuthorities: ranked.filter((hit) => hit.issueRelation === "CONTRARY"),
    guiltConclusion: null as null,
  };
}

export function researchSuppressionIssue(input: {
  jurisdiction?: string | null;
  court?: string | null;
  issueType: string;
  missingFacts?: string[];
  hits: RetrievedAuthorityHit[];
}) {
  const context = buildProsecutionResearchContext({
    jurisdiction: input.jurisdiction,
    court: input.court,
    procedureIssueType: input.issueType,
    missingFacts: input.missingFacts,
  });
  const authorities = annotateRetrievedAuthorities(
    input.hits,
    {
      questionJurisdiction: context.questionJurisdiction,
      forumCourtId: context.forumCourtId,
      issueType: context.issueType,
      subjectMatter: "criminal",
    },
    { applyStatusRank: context.issueType !== "UNKNOWN" },
  );
  return {
    context,
    authorities,
    suppressionConclusion: null as null,
  };
}

export function runLawFirmIntegratedFixture() {
  const demo = buildLawFirmDemo();
  const hits: RetrievedAuthorityHit[] = [
    {
      authorityId: "auth-2d",
      citation: "SYNTHETIC-2D-2019-014",
      courtId: "us-ca-2",
      jurisdiction: "US",
      authorityType: "case",
      score: 0.92,
      canonicalSourceUrl: null,
    },
    {
      authorityId: "auth-3d",
      citation: "SYNTHETIC-3D-2020-001",
      courtId: "us-ca-3",
      jurisdiction: "US",
      authorityType: "case",
      score: 0.4,
      canonicalSourceUrl: null,
    },
  ];
  const ranked = annotateRetrievedAuthorities(
    hits,
    {
      questionJurisdiction: "US",
      forumCourtId: "us-d-pa-ed",
      issueType: "FEDERAL_STATUTORY",
      standards: demo.standard && "ruleText" in demo.standard
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
    },
    { applyStatusRank: true },
  );
  return { demo, ranked, guiltConclusion: null as null };
}

export function runProsecutionIntegratedFixture() {
  const workspace = buildProsecutorDemo();
  const snapshot = workspace.snapshot("org-synthetic-prosecution");
  const criminalCase = snapshot.cases[0]!;
  const element = snapshot.elements[0]!;
  const charge = snapshot.charges.find((item) => item.id === element.chargeId)!;
  const research = researchChargeAuthorities({
    jurisdiction: criminalCase.jurisdiction,
    court: criminalCase.court,
    charge,
    elementText: element.elementText,
    hits: [
      {
        authorityId: "auth-pa-high",
        citation: "SYNTHETIC-PA-2018-004",
        courtId: "st-pa-high",
        jurisdiction: "PA",
        authorityType: "case",
        score: 0.55,
      },
      {
        authorityId: "auth-nj-high",
        citation: "SYNTHETIC-NJ-2017-009",
        courtId: "st-nj-high",
        jurisdiction: "NJ",
        authorityType: "case",
        score: 0.9,
      },
    ],
    standards: [
      {
        id: "std-synthetic-taking",
        authorityId: "auth-pa-high",
        ruleText: "Synthetic rule: a taking is a physical acquisition of property.",
        sourceSpan: "Synthetic source span.",
        sourceCitation: "SYNTHETIC-PA-2018-004",
      },
    ],
    contraryAuthorityIds: [],
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
  const statements = snapshot.statements;
  const witnessComparison = compareWitnessStatements(statements[0]?.claims ?? [], statements[1]?.claims ?? []);
  const paStandard = research.authorities.find((hit) => hit.authorityId === "auth-pa-high")?.legalStandard;
  const matrix = workspace.matrix("org-synthetic-prosecution", criminalCase.id).map((row) => {
    if (row.elementId !== element.id) return row;
    return {
      ...row,
      legalStandard: paStandard && paStandard !== "STANDARD_NOT_EXTRACTED" ? {
        id: paStandard.id,
        ruleText: paStandard.ruleText,
        sourceSpan: paStandard.sourceSpan,
        sourceCitation: paStandard.sourceCitation,
        authorityId: paStandard.authorityId,
      } : "STANDARD_NOT_EXTRACTED" as const,
      bindingAuthorities: research.bindingAuthorities.map((hit) => ({
        authorityId: hit.authorityId,
        status: hit.authorityStatus,
        reasonCode: hit.reasonCode,
        citation: hit.citation ?? null,
      })),
      persuasiveAuthorities: research.persuasiveAuthorities.map((hit) => ({
        authorityId: hit.authorityId,
        status: hit.authorityStatus,
        reasonCode: hit.reasonCode,
        citation: hit.citation ?? null,
      })),
      contraryAuthorities: research.contraryAuthorities.map((hit) => ({
        authorityId: hit.authorityId,
        status: hit.authorityStatus,
        reasonCode: hit.reasonCode,
        citation: hit.citation ?? null,
      })),
    };
  });
  return {
    workspace,
    overview: workspace.overview("org-synthetic-prosecution", criminalCase.id),
    matrix,
    research,
    suppression,
    witnessComparison,
    guiltConclusion: null as null,
  };
}

export function compareStatementFixture(left: StatementClaim[], right: StatementClaim[]) {
  return compareWitnessStatements(left, right);
}
