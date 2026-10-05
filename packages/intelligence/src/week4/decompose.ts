import type { LegalIssueType } from "@nyayagrid/jurisdiction";
import type { DecomposedQuestion, QueryContext } from "./types";

function detectIssueType(question: string, context: QueryContext): LegalIssueType {
  if (context.issueType && context.issueType !== "UNKNOWN") return context.issueType;
  const q = question.toLowerCase();
  if (/warrant|probable cause|miranda|suppression|search|seizure|identification/.test(q)) {
    return "FEDERAL_CONSTITUTIONAL";
  }
  if (/statute|federal|circuit|district|§|usc/.test(q)) return "FEDERAL_STATUTORY";
  if (context.subjectMatter === "criminal" || context.criminalCaseId) return "STATE_LAW";
  if (context.jurisdiction && context.jurisdiction !== "US") return "STATE_LAW";
  if (!context.jurisdiction && !context.forumCourt) return "UNKNOWN";
  return "FEDERAL_STATUTORY";
}

/** Deterministic decomposition for fixtures and production scaffolding. */
export function decomposeQuestion(context: QueryContext): DecomposedQuestion {
  const question = context.userQuestion.trim();
  const issueType = detectIssueType(question, context);
  const jurisdiction =
    issueType === "FEDERAL_CONSTITUTIONAL" || issueType === "FEDERAL_STATUTORY" || issueType === "SPECIALIZED_FEDERAL"
      ? "US"
      : (context.jurisdiction ?? null);
  const missingContext: string[] = [];
  if (!context.jurisdiction && issueType === "STATE_LAW") missingContext.push("jurisdiction");
  if (!context.forumCourt) missingContext.push("forumCourt");
  if (!context.matterId && !context.criminalCaseId) missingContext.push("matterOrCase");

  const strengths = /strength|strong|support|element|evidence for|control/i.test(question);
  const weaknesses = /weak|hurt|contrary|conflict|missing|gap|investigat/i.test(question);
  const warrant = /warrant|probable cause|affidavit/i.test(question);
  const witness = /witness|statement|conflict|inconsist/i.test(question);

  const description = warrant
    ? "Warrant and probable-cause review"
    : witness
      ? "Witness consistency and corroboration"
      : strengths || weaknesses
        ? "Claim or charge strength and weakness review"
        : question.slice(0, 240);

  const legalResearchQuery = [
    context.selectedCharge,
    context.selectedElement,
    description,
    jurisdiction,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    question,
    issues: [
      {
        issueType,
        description,
        jurisdiction,
        forumCourt: context.forumCourt ?? null,
        relatedClaimsOrCharges: context.selectedCharge ? [context.selectedCharge] : [],
        relatedFactIds: [],
        relatedEvidenceIds: context.selectedEvidence ?? [],
        legalResearchQuery,
        authorityRequirements: warrant
          ? ["binding search-and-seizure authority", "probable-cause standard"]
          : ["binding authority", "governing legal standard"],
        confidence: missingContext.length === 0 ? "medium" : "low",
        missingContext,
      },
    ],
    factualSubquestions: strengths || weaknesses ? ["What facts support the theory?", "What facts undermine the theory?"] : ["What facts are material?"],
    evidentiarySubquestions: [
      "What evidence supports each requirement?",
      "What evidence is contrary or missing?",
    ],
    legalResearchSubquestions: [
      "What authority controls this issue?",
      "What legal standard applies?",
    ],
    jurisdictionRequirements: jurisdiction ? [jurisdiction] : ["jurisdiction required"],
    missingContext,
  };
}
