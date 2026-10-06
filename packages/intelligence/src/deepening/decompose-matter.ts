import { decomposeQuestion } from "../week4/decompose";
import type { DecomposedQuestion, QueryContext } from "../week4/types";

type ExtraSignal = {
  id: string;
  pattern: RegExp;
  /** Skip when the primary issue description already covers this signal. */
  coveredBy: RegExp;
  description: string;
  authorityRequirements: string[];
};

/**
 * Distinct issue families beyond the primary Week 4 issue.
 * Patterns stay narrow so single-topic questions keep one issue.
 */
const EXTRA_SIGNALS: ExtraSignal[] = [
  {
    id: "warrant",
    pattern: /\b(warrant|probable cause|affidavit|suppression|miranda)\b/i,
    coveredBy: /warrant|probable-cause/i,
    description: "Warrant, suppression, and probable-cause review",
    authorityRequirements: ["binding search-and-seizure authority", "probable-cause standard"],
  },
  {
    id: "witness",
    pattern: /\b(witness|witnesses|statement|statements|inconsistent|corroborat)/i,
    coveredBy: /witness consistency/i,
    description: "Witness statement comparison",
    authorityRequirements: ["source-linked statements", "no truthfulness conclusion"],
  },
  {
    id: "discovery",
    pattern: /\b(discovery|disclosure|brady|production)\b/i,
    coveredBy: /discovery|disclosure/i,
    description: "Discovery and disclosure review",
    authorityRequirements: ["human disclosure review", "production record"],
  },
  {
    id: "authority_conflict",
    pattern: /\b(conflicting authorities|conflicting authority|authority conflict|contrary authorities|contrary authority|split of authority)\b/i,
    coveredBy: /conflicting authority|authority conflict/i,
    description: "Conflicting authority review",
    authorityRequirements: ["binding authority", "contrary authority left unresolved"],
  },
  {
    id: "damages",
    pattern: /\b(damages|remedy|relief)\b/i,
    coveredBy: /damages|remedy/i,
    description: "Damages and remedy",
    authorityRequirements: ["remedy standard", "fact support for the measure of recovery"],
  },
  {
    id: "defense",
    pattern: /\b(defense|counterclaim|affirmative defense)\b/i,
    coveredBy: /defense|counterclaim/i,
    description: "Defenses and counterclaims",
    authorityRequirements: ["governing defense standard", "element support and contrary evidence"],
  },
  {
    id: "charge_strength",
    pattern: /\b(strengths and weaknesses|each element|unsupported element)\b/i,
    coveredBy: /strength and weakness/i,
    description: "Charge or claim strength and weakness review",
    authorityRequirements: ["element support", "contrary evidence", "missing evidence"],
  },
  {
    id: "limitations",
    pattern: /\b(statute of limitations|limitations period)\b/i,
    coveredBy: /limitations/i,
    description: "Limitations period",
    authorityRequirements: ["limitations authority", "accrual facts"],
  },
];

function issueFromSignal(
  signal: ExtraSignal,
  primary: DecomposedQuestion["issues"][number],
  context: QueryContext,
): DecomposedQuestion["issues"][number] {
  return {
    issueType: primary.issueType,
    description: signal.description,
    jurisdiction: primary.jurisdiction,
    forumCourt: context.forumCourt ?? primary.forumCourt,
    relatedClaimsOrCharges: [],
    relatedFactIds: [],
    relatedEvidenceIds: [],
    legalResearchQuery: [signal.description, primary.jurisdiction].filter(Boolean).join(" "),
    authorityRequirements: signal.authorityRequirements,
    confidence: primary.confidence,
    missingContext: primary.missingContext,
  };
}

/**
 * Multi-issue decomposition. The first issue matches `decomposeQuestion` so
 * existing single-issue callers stay stable. Additional issues are appended
 * only when the question names a distinct legal topic.
 */
export function decomposeMatterIssues(context: QueryContext): DecomposedQuestion {
  const base = decomposeQuestion(context);
  const primary = base.issues[0];
  if (!primary) return base;
  const question = context.userQuestion;
  const extras: DecomposedQuestion["issues"] = [];
  for (const signal of EXTRA_SIGNALS) {
    if (!signal.pattern.test(question)) continue;
    if (signal.coveredBy.test(primary.description)) continue;
    if (extras.some((issue) => issue.description === signal.description)) continue;
    extras.push(issueFromSignal(signal, primary, context));
    if (extras.length >= 5) break;
  }
  return {
    ...base,
    issues: [primary, ...extras],
  };
}
