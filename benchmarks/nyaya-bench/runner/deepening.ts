import {
  answerCivilClaimsQuestion,
  answerSuppressionQuestion,
  buildCivilClaimMatrix,
  buildCivilWholeMatterView,
  buildWholeMatterAnalysis,
  checkCivilClaimsConsistency,
  evidenceRelationsForParty,
  findAutonomousSuppressionViolations,
  findCivilLiabilityViolations,
  formatCivilClaimsAnswer,
  formatLongFormAnalysis,
  formatSuppressionAnswer,
  inferSuppressionDoctrine,
  runComplexCivilClaimsFixture,
  runDeepeningLawFirm,
  runDeepeningProsecution,
  runMirandaReview,
  runMissingAffidavitReview,
  runMultiTheoryWarrantReview,
  runMultiWarrantDefendantReview,
  runPennsylvaniaDoctrineReview,
  runSuppressionHierarchyReview,
} from "@nyayagrid/intelligence";
import { DEEPENING_ASSIGNMENTS, type DeepeningAssignment } from "../datasets/deepening/catalog";

export type DeepeningGrade = {
  id: string;
  passed: boolean;
  severity: DeepeningAssignment["failureSeverity"];
  failures: string[];
};

function fail(assignment: DeepeningAssignment, failures: string[]): DeepeningGrade {
  return { id: assignment.id, passed: failures.length === 0, severity: assignment.failureSeverity, failures };
}

function gradeLawFirm(assignment: DeepeningAssignment): DeepeningGrade {
  const result = runDeepeningLawFirm();
  const failures: string[] = [];
  if (result.separatedIssueCount < 4) failures.push("expected at least four issues");
  const defense = result.analysis.issues.find((issue) => /defense/i.test(issue.description));
  if (!defense?.contraryEvidenceIds.includes("ev-log")) failures.push("defense issue lost contrary evidence");
  if (defense?.supportingEvidenceIds.includes("ev-log")) failures.push("contrary evidence was flattened into support");
  if (!defense?.missingEvidenceIds.includes("missing-delivery")) failures.push("missing evidence was not attached");
  if (result.analysis.authorityConflicts.length === 0 || result.analysis.authorityConflicts.some((item) => item.resolved)) {
    failures.push("authority conflict was missing or resolved");
  }
  if (result.analysis.outcomeConclusion !== null) failures.push("outcome conclusion was set");
  return fail(assignment, failures);
}

function gradeProsecution(assignment: DeepeningAssignment): DeepeningGrade {
  const result = runDeepeningProsecution();
  const failures: string[] = [];
  if (result.defendants.length < 2 || result.charges.length < 2) failures.push("multi-defendant charges missing");
  if (result.evidenceScope.jointEvidenceIds.length !== 1) failures.push("joint evidence missing");
  if (result.evidenceScope.byDefendant.some((row) => row.specificEvidenceIds.length !== 1)) {
    failures.push("defendant-specific evidence missing");
  }
  if (!result.witnessComparison.some((row) => row.label === "TIMELINE_DIFFERENCE")) failures.push("witness time conflict missing");
  if (JSON.stringify(result.witnessComparison).match(/LIAR|UNTRUTHFUL|DECEPTIVE/)) failures.push("truthfulness label");
  if (!result.issueSeparation.some((issue) => issue.kind === "procedure")) failures.push("suppression issue was collapsed");
  if (result.guiltConclusion !== null || result.longForm.guiltConclusion !== null) failures.push("guilt conclusion");
  return fail(assignment, failures);
}

function gradeLongForm(assignment: DeepeningAssignment): DeepeningGrade {
  const result = runDeepeningLawFirm();
  const failures: string[] = [];
  const issueSections = result.longForm.sections.filter((section) => section.issueId);
  if (issueSections.length !== result.analysis.issues.length) failures.push("issue section missing");
  if (!/decisive conclusion is not supported/i.test(result.longForm.shortAnswer)) failures.push("short answer was decisive");
  if (issueSections.some((section) => section.sourceIds.length === 0)) failures.push("issue section lost provenance");
  return fail(assignment, failures);
}

function gradeConsistency(assignment: DeepeningAssignment): DeepeningGrade {
  const result = runDeepeningLawFirm();
  const failures: string[] = [];
  if (!result.consistency.consistent) failures.push(result.consistency.conflicts.join("; ") || "inconsistent");
  return fail(assignment, failures);
}

function gradeStale(assignment: DeepeningAssignment): DeepeningGrade {
  const result = runDeepeningLawFirm();
  const failures: string[] = [];
  if (!result.freshness.stale || !result.freshness.refreshRequired) failures.push("prior analysis stayed current");
  if (result.freshness.affectedIssueIds.length !== result.analysis.issues.length) {
    failures.push("unscoped new evidence did not mark every issue");
  }
  return fail(assignment, failures);
}

function gradeAbstention(assignment: DeepeningAssignment): DeepeningGrade {
  const result = runDeepeningLawFirm();
  const empty = {
    ...result.bundle,
    supportingEvidence: [],
    contraryEvidence: [],
    missingEvidence: [],
    bindingAuthorities: [],
    contraryAuthorities: [],
    persuasiveAuthorities: [],
  };
  const analysis = buildWholeMatterAnalysis({ context: result.context, bundle: empty });
  const longForm = formatLongFormAnalysis({ analysis, bundle: empty });
  const failures: string[] = [];
  if (analysis.issues.some((issue) => !issue.abstainReason)) failures.push("issue did not abstain");
  if (longForm.outcomeConclusion !== null) failures.push("outcome conclusion");
  if (!/decisive conclusion is not supported/i.test(longForm.shortAnswer)) failures.push("short answer was decisive");
  return fail(assignment, failures);
}

function gradeMultiTheoryWarrant(assignment: DeepeningAssignment): DeepeningGrade {
  const { review, answerText } = runMultiTheoryWarrantReview();
  const failures: string[] = [];
  const phone = review.issues.filter((issue) => issue.warrantId === "warrant-phone");
  const dimensions = new Set(phone.map((issue) => issue.dimension));
  for (const dimension of ["PROBABLE_CAUSE", "NEXUS", "STALENESS", "GOOD_FAITH", "EXECUTION"] as const) {
    if (!dimensions.has(dimension)) failures.push(`missing ${dimension}`);
  }
  const probableCause = phone.find((issue) => issue.dimension === "PROBABLE_CAUSE");
  const goodFaith = phone.find((issue) => issue.dimension === "GOOD_FAITH");
  if (probableCause?.authorities.some((authority) => authority.authorityId !== "auth-synth-pc")) {
    failures.push("probable-cause authority attached to the wrong issue");
  }
  if (goodFaith?.authorities.some((authority) => authority.authorityId !== "auth-synth-faith")) {
    failures.push("good-faith authority attached to the wrong issue");
  }
  if (probableCause?.missingFacts.join("|") === goodFaith?.missingFacts.join("|")) failures.push("missing facts were copied across issues");
  if (review.suppressionConclusion !== null || review.validityConclusion !== null || review.guiltConclusion !== null) {
    failures.push("autonomous conclusion");
  }
  if (findAutonomousSuppressionViolations(answerText).length > 0) failures.push("answer used a forbidden conclusion");
  return fail(assignment, failures);
}

function gradeMultiWarrant(assignment: DeepeningAssignment): DeepeningGrade {
  const review = runMultiWarrantDefendantReview();
  const failures: string[] = [];
  const ada = review.issues.filter((issue) => issue.warrantId === "warrant-ada");
  const joint = review.issues.filter((issue) => issue.warrantId === "warrant-joint");
  if (ada.length === 0 || joint.length === 0) failures.push("a warrant lost its review");
  if (ada.some((issue) => issue.linkedEvidence.some((item) => item.evidenceId !== "ev-ada"))) failures.push("Ada warrant mixed evidence");
  if (joint.some((issue) => issue.linkedEvidence.some((item) => item.evidenceId !== "ev-joint"))) failures.push("joint warrant mixed evidence");
  const answer = answerSuppressionQuestion({ review, question: "What suppression issues should be reviewed?", defendantId: "def-ben" });
  if (answer.issues.some((issue) => issue.warrantId === "warrant-ada")) failures.push("defendant-specific warrant leaked");
  const adaView = review.warrants.find((warrant) => warrant.id === "warrant-ada");
  if (adaView?.timelineEventIds.some((id) => id.startsWith("tl-joint"))) failures.push("timeline crossed warrants");
  if (answer.guiltConclusion !== null) failures.push("guilt conclusion");
  return fail(assignment, failures);
}

function gradeMiranda(assignment: DeepeningAssignment): DeepeningGrade {
  const review = runMirandaReview();
  const failures: string[] = [];
  const issue = review.issues.find((row) => row.dimension === "MIRANDA");
  if (!issue) failures.push("Miranda issue missing");
  if (!issue?.missingFacts.includes("Miranda timing is not recorded.")) failures.push("Miranda timing was filled in");
  if (issue?.suppressionConclusion !== null) failures.push("suppression conclusion");
  const text = formatSuppressionAnswer(answerSuppressionQuestion({ review, question: "What Miranda issues should be reviewed?" }));
  if (findAutonomousSuppressionViolations(text).length > 0) failures.push("forbidden conclusion");
  return fail(assignment, failures);
}

function gradeAskSuppression(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runMultiTheoryWarrantReview();
  const answer = answerSuppressionQuestion({
    review,
    question: "What probable cause issues should be reviewed?",
  });
  const text = formatSuppressionAnswer(answer);
  const failures: string[] = [];
  const issue = answer.issues.find((row) => row.dimension === "PROBABLE_CAUSE");
  if (!issue) failures.push("probable cause answer missing");
  if (!text.includes("KNOWN_FACTS:") || !text.includes("MISSING_FACTS:") || !text.includes("LEGAL_STANDARD:")) {
    failures.push("structured sections missing");
  }
  if (answer.issues.some((row) => row.dimension !== "PROBABLE_CAUSE")) failures.push("answer collapsed other issues into probable cause");
  if (issue && issue.bindingAuthorities.some((authority) => authority.treatment !== "UNVERIFIED")) failures.push("unverified treatment hidden");
  if (answer.suppressionConclusion !== null || answer.validityConclusion !== null || answer.guiltConclusion !== null) {
    failures.push("autonomous conclusion");
  }
  if (findAutonomousSuppressionViolations(text).length > 0) failures.push("forbidden conclusion");
  return fail(assignment, failures);
}

function gradeHierarchy(assignment: DeepeningAssignment): DeepeningGrade {
  const federal = runSuppressionHierarchyReview();
  const state = runPennsylvaniaDoctrineReview();
  const failures: string[] = [];
  const federalAuthorities = federal.issues.find((issue) => issue.dimension === "PROBABLE_CAUSE")?.authorities ?? [];
  const stateAuthorities = state.issues.find((issue) => issue.dimension === "PROBABLE_CAUSE")?.authorities ?? [];
  const federalStatus = (id: string) => federalAuthorities.find((authority) => authority.authorityId === id)?.authorityStatus;
  const stateStatus = (id: string) => stateAuthorities.find((authority) => authority.authorityId === id)?.authorityStatus;
  if (federalStatus("auth-scotus") !== "BINDING" || federalStatus("auth-ca3") !== "BINDING") failures.push("controlling federal authority misclassified");
  if (federalStatus("auth-edpa") !== "PERSUASIVE") failures.push("EDPA misclassified as controlling");
  if (stateStatus("auth-pa-high") !== "BINDING" || stateStatus("auth-pa-app") !== "BINDING") failures.push("Pennsylvania court misclassified");
  if (stateStatus("auth-scotus") === "BINDING") failures.push("SCOTUS was treated as binding state constitutional law");
  if (inferSuppressionDoctrine({ jurisdiction: "PA", forumCourtId: "st-pa-trial" }).doctrine !== "UNKNOWN") {
    failures.push("federal and state doctrine were collapsed");
  }
  return fail(assignment, failures);
}

function gradeMissingFacts(assignment: DeepeningAssignment): DeepeningGrade {
  const review = runMissingAffidavitReview();
  const failures: string[] = [];
  const probableCause = review.issues.find((issue) => issue.dimension === "PROBABLE_CAUSE");
  if (!probableCause?.missingFacts.includes("Affidavit unavailable.")) failures.push("missing affidavit was not surfaced");
  if ((probableCause?.knownFacts.length ?? 0) > 0) failures.push("facts were invented for an empty affidavit");
  if (probableCause?.legalStandard) failures.push("legal standard was invented");
  if (review.validityConclusion !== null) failures.push("validity conclusion");
  return fail(assignment, failures);
}

function gradeCivilClaims(assignment: DeepeningAssignment): DeepeningGrade {
  const { review, whole } = runComplexCivilClaimsFixture();
  const failures: string[] = [];
  const currentClaims = review.claims.filter((claim) => claim.isCurrent && claim.kind === "CLAIM");
  if (currentClaims.length < 2) failures.push("expected at least two current claims");
  if (review.claims.some((claim) => claim.id === "claim-negligent-misrep" && claim.isCurrent)) {
    failures.push("withdrawn claim treated as current");
  }
  if (review.parties.length < 3) failures.push("multi-party matter missing");
  if (whole.partyOrientations.every((row) => row.targets.length < 1)) failures.push("party orientation missing");
  if (review.liabilityConclusion !== null || whole.liabilityConclusion !== null) failures.push("liability conclusion");
  return fail(assignment, failures);
}

function gradeCivilDefense(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexCivilClaimsFixture();
  const failures: string[] = [];
  const negating = review.defenses.find((defense) => defense.kind === "ELEMENT_NEGATING");
  const affirmative = review.defenses.find((defense) => defense.kind === "AFFIRMATIVE");
  const notice = review.defenses.find((defense) => defense.kind === "NOTICE");
  if (!negating || !affirmative || !notice) failures.push("defense kinds collapsed");
  if (negating?.id === affirmative?.id) failures.push("element-negating and affirmative defenses merged");
  if (!affirmative?.elements.some((element) => element.missingEvidence.length > 0)) failures.push("waiver missing evidence lost");
  if (review.defenses.some((defense) => defense.validityConclusion !== null)) failures.push("defense validity conclusion");
  return fail(assignment, failures);
}

function gradeCivilCounter(assignment: DeepeningAssignment): DeepeningGrade {
  const { review, whole } = runComplexCivilClaimsFixture();
  const failures: string[] = [];
  const counter = review.claims.find((claim) => claim.kind === "COUNTERCLAIM");
  if (!counter) failures.push("counterclaim missing");
  if (review.defenses.some((defense) => /counterclaim/i.test(defense.label))) failures.push("counterclaim treated as defense");
  if (!counter?.parties.some((party) => party.role === "COUNTERCLAIMANT")) failures.push("counterclaimant role missing");
  if (!counter?.parties.some((party) => party.role === "COUNTERCLAIM_DEFENDANT")) failures.push("counterclaim-defendant role missing");
  if (!counter?.elements.some((element) => element.supportingEvidence.some((item) => item.evidenceId === "ev-invoice"))) {
    failures.push("invoice evidence missing from counterclaim");
  }
  if (!whole.counterclaims.some((claim) => claim.id === counter?.id)) failures.push("whole-matter lost counterclaim");
  return fail(assignment, failures);
}

function gradeCivilAmend(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexCivilClaimsFixture();
  const failures: string[] = [];
  const complaintPleadings = review.pleadings.filter((pleading) => /complaint/i.test(pleading.label));
  if (complaintPleadings.filter((pleading) => pleading.isCurrent).length !== 1) failures.push("multiple current complaints");
  if (review.pleadings.find((pleading) => pleading.id === "plead-amended")?.isCurrent !== true) failures.push("amended complaint not current");
  const withdrawn = review.claims.find((claim) => claim.id === "claim-negligent-misrep");
  if (withdrawn?.isCurrent) failures.push("removed claim still current");
  if (withdrawn?.provenance.documentId !== "doc-complaint") failures.push("original source lost");
  if (!review.claims.some((claim) => claim.id === "claim-unfair-trade" && claim.isCurrent)) failures.push("added claim missing");
  if (review.claims.find((claim) => claim.id === "claim-breach-v1")?.isCurrent) failures.push("superseded breach treated as current");
  return fail(assignment, failures);
}

function gradeCivilSharedEvidence(assignment: DeepeningAssignment): DeepeningGrade {
  const { review, whole } = runComplexCivilClaimsFixture();
  const failures: string[] = [];
  if (review.evidence.filter((item) => item.id === "ev-notice").length !== 1) failures.push("notice evidence duplicated");
  const roles = whole.sharedEvidenceRoles.find((row) => row.evidenceId === "ev-notice")?.roles ?? [];
  if (new Set(roles.map((role) => role.role)).size < 2) failures.push("shared evidence roles collapsed");
  const betaOnly = review.claims
    .find((claim) => claim.id === "claim-unfair-trade")
    ?.elements.find((element) => element.id === "el-utp-beta-only");
  if (!betaOnly) failures.push("beta-specific element missing");
  if (evidenceRelationsForParty(betaOnly?.supportingEvidence ?? [], "party-acme").length > 0) {
    failures.push("beta evidence leaked to Acme");
  }
  return fail(assignment, failures);
}

function gradeCivilAsk(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexCivilClaimsFixture();
  const answer = answerCivilClaimsQuestion({
    review,
    question: "What claims are currently pleaded and which elements of breach are unsupported?",
  });
  const text = formatCivilClaimsAnswer(answer);
  const failures: string[] = [];
  if (!answer.claims.some((claim) => claim.id === "claim-breach" && claim.isCurrent)) failures.push("current breach claim missing");
  if (!answer.claims.some((claim) => claim.id === "claim-unfair-trade" && claim.isCurrent)) failures.push("current statutory claim missing");
  if (answer.claims.some((claim) => claim.id === "claim-negligent-misrep" && claim.isCurrent)) failures.push("withdrawn claim listed as current");
  if (!answer.elements.some((element) => element.missing.length > 0 || element.status === "NO_EVIDENCE_FOUND")) {
    failures.push("unsupported breach element not surfaced");
  }
  if (answer.liabilityConclusion !== null || answer.outcomeConclusion !== null) failures.push("liability conclusion");
  if (findCivilLiabilityViolations(text).length > 0) failures.push("forbidden liability language");
  if (!text.includes("LIABILITY_CONCLUSION: null")) failures.push("structured null liability missing");
  return fail(assignment, failures);
}

function gradeCivilMatrix(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexCivilClaimsFixture();
  const matrix = buildCivilClaimMatrix(review);
  const whole = buildCivilWholeMatterView(review);
  const consistency = checkCivilClaimsConsistency({ review, matrix, whole });
  const failures: string[] = [];
  if (!matrix.some((row) => row.rowKind === "claim")) failures.push("claim rows missing");
  if (!matrix.some((row) => row.rowKind === "defense")) failures.push("defense rows missing");
  if (!matrix.some((row) => row.rowKind === "counterclaim")) failures.push("counterclaim rows missing");
  const breach = matrix.find((row) => row.elementId === "el-breach-breach");
  if (!breach?.contraryEvidenceIds.includes("ev-log")) failures.push("contrary evidence lost");
  if (!breach?.missingEvidence.some((item) => item.id === "missing-delivery")) failures.push("missing evidence lost");
  if (!consistency.consistent) failures.push(consistency.conflicts.join("; ") || "inconsistent");
  if (whole.liabilityConclusion !== null) failures.push("liability conclusion");
  return fail(assignment, failures);
}

const GRADERS: Record<string, (assignment: DeepeningAssignment) => DeepeningGrade> = {
  "D1-LF-01": gradeLawFirm,
  "D1-PR-01": gradeProsecution,
  "D1-LONG-01": gradeLongForm,
  "D1-CONSIST-01": gradeConsistency,
  "D1-STALE-01": gradeStale,
  "D1-ERR-01": gradeAbstention,
  "D2-PR-WARRANT-01": gradeMultiTheoryWarrant,
  "D2-PR-WARRANT-02": gradeMultiWarrant,
  "D2-PR-MIRANDA-01": gradeMiranda,
  "D2-ASK-SUPPRESS-01": gradeAskSuppression,
  "D2-AUTH-HIER-01": gradeHierarchy,
  "D2-MISSING-FACTS-01": gradeMissingFacts,
  "D3-CIVIL-CLAIMS-01": gradeCivilClaims,
  "D3-CIVIL-DEFENSE-01": gradeCivilDefense,
  "D3-CIVIL-COUNTER-01": gradeCivilCounter,
  "D3-CIVIL-AMEND-01": gradeCivilAmend,
  "D3-CIVIL-SHARED-EVID-01": gradeCivilSharedEvidence,
  "D3-CIVIL-ASK-01": gradeCivilAsk,
  "D3-CIVIL-MATRIX-01": gradeCivilMatrix,
};

/** Deterministic deepening grades. No database, model, or CourtListener calls. */
export function runDeepeningPass(): { grades: DeepeningGrade[]; passed: number; failed: number } {
  const grades = DEEPENING_ASSIGNMENTS.map((assignment) => {
    const grade = GRADERS[assignment.id];
    if (!grade) return fail(assignment, ["no grader"]);
    return grade(assignment);
  });
  return {
    grades,
    passed: grades.filter((grade) => grade.passed).length,
    failed: grades.filter((grade) => !grade.passed).length,
  };
}

const invokedDirectly = process.argv[1]?.split("\\").join("/").endsWith("runner/deepening.ts");
if (invokedDirectly) {
  const result = runDeepeningPass();
  console.log(JSON.stringify({ passed: result.passed, failed: result.failed, grades: result.grades }, null, 2));
  if (result.failed > 0) process.exit(1);
}
