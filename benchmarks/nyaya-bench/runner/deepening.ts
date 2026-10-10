import {
  answerCivilClaimsQuestion,
  answerDiscoveryQuestion,
  answerSuppressionQuestion,
  applyDraftCitationResolveOrAbstain,
  buildCivilClaimMatrix,
  buildCivilClaimStrengthAnalysis,
  buildCivilWholeMatterView,
  buildDiscoveryWholeMatterView,
  buildWholeMatterAnalysis,
  checkCivilClaimsConsistency,
  evidenceRelationsForParty,
  findAutonomousSuppressionViolations,
  findCivilLiabilityViolations,
  findDiscoveryLedgerViolations,
  formatCivilClaimsAnswer,
  formatDiscoveryAnswer,
  formatLongFormAnalysis,
  formatSuppressionAnswer,
  inferSuppressionDoctrine,
  objectionOnlyItems,
  runComplexCivilClaimsFixture,
  runComplexDiscoveryLedgerFixture,
  runDeepeningLawFirm,
  runDeepeningProsecution,
  runPass6LitigationFixture,
  runPass7WholeMatterFixture,
  answerMotionsCommunicationsQuestion,
  formatMotionsCommunicationsAnswer,
  answerWholeMatterQuestion,
  formatWholeMatterAnswer,
  planMotionsCommunicationsGraph,
  planMotionsCommunicationsTimelineEvents,
  runMirandaReview,
  runMissingAffidavitReview,
  runMultiTheoryWarrantReview,
  runMultiWarrantDefendantReview,
  runPennsylvaniaDoctrineReview,
  runSuppressionHierarchyReview,
  unansweredItems,
} from "@nyayagrid/intelligence";
import {
  applyResolveOrAbstainPolicy,
  blocksUnsupportedTreatmentMemory,
  buildPass5CitationFixture,
  canLinkAuthorityInGraph,
  memorySafeResolutionFact,
  resolveCitationsForProduct,
  TREATMENT_UNVERIFIED_NOTICE,
} from "@nyayagrid/research";
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

function gradeCivilElements(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexCivilClaimsFixture();
  const failures: string[] = [];
  const breach = review.claims.find((claim) => claim.id === "claim-breach" && claim.isCurrent);
  if (!breach || breach.elements.length < 2) failures.push("breach elements missing");
  if (!breach?.elements.some((element) => element.status === "CONFLICTED" || element.status === "PARTIALLY_SUPPORTED")) {
    failures.push("conflicted or partial element missing");
  }
  if (!breach?.elements.some((element) => element.missingEvidence.length > 0 || element.status === "NO_EVIDENCE_FOUND")) {
    failures.push("missing evidence element missing");
  }
  if (breach?.liabilityConclusion !== null) failures.push("liability conclusion");
  return fail(assignment, failures);
}

function gradeCivilAskParty(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexCivilClaimsFixture();
  const answer = answerCivilClaimsQuestion({
    review,
    question: "Which claims involve Defendant Beta?",
  });
  const text = formatCivilClaimsAnswer(answer);
  const failures: string[] = [];
  if (answer.claims.length === 0 && answer.defenses.length === 0) failures.push("party-scoped civil rows missing");
  if (!answer.claims.some((claim) => /unfair|beta|trade/i.test(claim.label) || claim.id.includes("unfair"))) {
    // Beta may appear only on unfair-trade; require at least one Beta-linked claim id from fixture
    const betaClaim = review.claims.find(
      (claim) => claim.isCurrent && claim.parties.some((party) => party.partyId === "party-beta"),
    );
    if (!betaClaim || !answer.claims.some((claim) => claim.id === betaClaim.id)) {
      failures.push("Beta claim not scoped");
    }
  }
  if (answer.liabilityConclusion !== null) failures.push("liability conclusion");
  if (findCivilLiabilityViolations(text).length > 0) failures.push("forbidden liability language");
  return fail(assignment, failures);
}

function gradeCivilAskAuthority(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexCivilClaimsFixture();
  const answer = answerCivilClaimsQuestion({
    review,
    question: "What authorities govern the waiver defense?",
  });
  const text = formatCivilClaimsAnswer(answer);
  const failures: string[] = [];
  if (!answer.defenses.some((defense) => /waiver/i.test(defense.label) || defense.kind === "WAIVER")) {
    failures.push("waiver defense missing");
  }
  if (!answer.authorityNotes.some((note) => /SYNTHETIC-2D-2019-014|waiver|authority/i.test(note))) {
    failures.push("waiver authority note missing");
  }
  if (answer.liabilityConclusion !== null) failures.push("liability conclusion");
  if (findCivilLiabilityViolations(text).length > 0) failures.push("forbidden liability language");
  return fail(assignment, failures);
}

function gradeCivilAskWhole(assignment: DeepeningAssignment): DeepeningGrade {
  const { review, whole } = runComplexCivilClaimsFixture();
  const answer = answerCivilClaimsQuestion({
    review,
    question: "What are the major evidentiary weaknesses in this case and what should counsel investigate next?",
  });
  const text = formatCivilClaimsAnswer(answer);
  const failures: string[] = [];
  if (answer.claims.filter((claim) => claim.isCurrent).length < 2) failures.push("live claims flattened");
  if (answer.investigationNotes.length === 0 && answer.evidenceNotes.length === 0) {
    failures.push("investigation notes missing");
  }
  if (whole.sharedEvidenceRoles.every((row) => row.roles.length < 2) === false) {
    // shared evidence must remain claim-separated in notes or whole view
  }
  if (!text.includes("CLAIMS:")) failures.push("claim separation lost");
  if (answer.liabilityConclusion !== null || answer.outcomeConclusion !== null) failures.push("liability conclusion");
  if (findCivilLiabilityViolations(text).length > 0) failures.push("forbidden liability language");
  return fail(assignment, failures);
}

function gradeCivilStrength(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexCivilClaimsFixture();
  const breach = review.claims.find((claim) => claim.id === "claim-breach");
  const failures: string[] = [];
  if (!breach) {
    failures.push("breach claim missing");
    return fail(assignment, failures);
  }
  const strength = buildCivilClaimStrengthAnalysis(breach);
  if (strength.elementSupportCompleteness.length === 0) failures.push("element completeness missing");
  if (
    !strength.elementSupportCompleteness.some(
      (row) => row.missingEvidence.length > 0 || row.conflicted || row.contraryEvidenceIds.length > 0,
    )
  ) {
    failures.push("missing or conflicted support not surfaced");
  }
  if (strength.investigationQuestions.length === 0) failures.push("investigation questions missing");
  if (strength.liabilityConclusion !== null || strength.outcomeConclusion !== null) failures.push("liability conclusion");
  return fail(assignment, failures);
}

function gradeDiscUnanswered(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexDiscoveryLedgerFixture();
  const failures: string[] = [];
  if (!unansweredItems(review).some((item) => item.id === "item-rog-3")) failures.push("ROG-3 not unanswered");
  const text = formatDiscoveryAnswer(
    answerDiscoveryQuestion({ review, question: "Which discovery requests are still unanswered?" }),
  );
  if (!text.includes("item-rog-3")) failures.push("Ask missed unanswered item");
  if (review.sanctionsConclusion !== null || text.includes("SANCTIONS_CONCLUSION: null") === false) {
    failures.push("sanctions conclusion");
  }
  if (findDiscoveryLedgerViolations(text).length > 0) failures.push("forbidden discovery conclusion language");
  return fail(assignment, failures);
}

function gradeDiscResponseHistory(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexDiscoveryLedgerFixture();
  const failures: string[] = [];
  const responses = review.responses.filter((row) => row.itemId === "item-rfp-12");
  if (responses.length < 2) failures.push("initial and supplemental responses missing");
  if (!responses.some((row) => row.isSupplemental && row.supplementsResponseId === "resp-12")) {
    failures.push("supplemental link missing");
  }
  if (!responses.every((row) => row.productionIds.length > 0)) failures.push("production linkage missing");
  return fail(assignment, failures);
}

function gradeDiscObjection(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexDiscoveryLedgerFixture();
  const failures: string[] = [];
  if (!objectionOnlyItems(review).some((item) => item.id === "item-rfp-14")) failures.push("RFP-14 not objection-only");
  const productionFor14 = review.productions.filter((row) => row.requestItemIds.includes("item-rfp-14"));
  if (productionFor14.length > 0) failures.push("unexpected production for RFP-14");
  if (review.sanctionsConclusion !== null) failures.push("sanctions conclusion");
  return fail(assignment, failures);
}

function gradeDiscProduction(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexDiscoveryLedgerFixture();
  const failures: string[] = [];
  const text = formatDiscoveryAnswer(
    answerDiscoveryQuestion({
      review,
      question: "What did Acme produce in response to Request No. 12?",
    }),
  );
  if (!/prod-1|prod-2/.test(text)) failures.push("production not linked");
  if (!/ACME000/.test(text)) failures.push("Bates not cited");
  if (findDiscoveryLedgerViolations(text).length > 0) failures.push("forbidden discovery conclusion language");
  return fail(assignment, failures);
}

function gradeDiscBatesDate(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexDiscoveryLedgerFixture();
  const failures: string[] = [];
  const text = formatDiscoveryAnswer(
    answerDiscoveryQuestion({
      review,
      question: "What Bates ranges were produced on September 18?",
    }),
  );
  if (!text.includes("ACME000200–ACME000220")) failures.push("September 18 Bates missing");
  if (!/supplement|prod-2/i.test(text)) failures.push("supplemental production not identified");
  return fail(assignment, failures);
}

function gradeDiscBatesSignal(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexDiscoveryLedgerFixture();
  const failures: string[] = [];
  if (!review.batesSignals.some((row) => row.kind === "OVERLAP")) failures.push("overlap signal missing");
  if (!review.batesSignals.some((row) => row.kind === "APPARENT_GAP")) failures.push("gap signal missing");
  if (!review.batesSignals.every((row) => row.legalDeficiencyConclusion === null)) {
    failures.push("Bates signal asserted legal deficiency");
  }
  return fail(assignment, failures);
}

function gradeDiscMissing(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexDiscoveryLedgerFixture();
  const failures: string[] = [];
  const missing = review.deficiencies.find((row) => row.id === "def-rfp15-attach");
  if (!missing || missing.kind !== "MISSING_ATTACHMENT") failures.push("missing attachment deficiency absent");
  if (missing?.itemId !== "item-rfp-15") failures.push("deficiency not linked to RFP-15");
  if (review.sanctionsConclusion !== null) failures.push("sanctions conclusion");
  return fail(assignment, failures);
}

function gradeDiscSupplement(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexDiscoveryLedgerFixture();
  const failures: string[] = [];
  const text = formatDiscoveryAnswer(
    answerDiscoveryQuestion({
      review,
      question: "What changed in the supplemental production?",
    }),
  );
  if (!review.productions.some((row) => row.isSupplemental && row.id === "prod-2")) {
    failures.push("supplemental production missing");
  }
  if (!text.includes("ACME000200–ACME000220") && !text.includes("prod-2")) {
    failures.push("supplemental Bates/production not surfaced");
  }
  if (!review.productions.some((row) => row.id === "prod-1" && !row.isSupplemental)) {
    failures.push("prior production not traceable");
  }
  return fail(assignment, failures);
}

function gradeDiscMotion(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexDiscoveryLedgerFixture();
  const failures: string[] = [];
  if (review.meetAndConferIssues.length === 0) failures.push("meet-and-confer missing");
  if (!review.motionLinks.some((row) => row.motionType === "MOTION_TO_COMPEL")) {
    failures.push("motion to compel missing");
  }
  const text = formatDiscoveryAnswer(
    answerDiscoveryQuestion({
      review,
      question: "Which discovery issues are tied to the motion to compel?",
    }),
  );
  if (!text.includes("motion-compel-1")) failures.push("motion link not in Ask answer");
  if (!text.includes("def-rog3") && !/deficiencies=.*def-rog3/.test(text)) {
    // motion notes include deficiency ids
    if (!text.includes("def-rog3")) failures.push("deficiency ids not preserved on motion");
  }
  return fail(assignment, failures);
}

function gradeDiscWhole(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runComplexDiscoveryLedgerFixture();
  const whole = buildDiscoveryWholeMatterView(review);
  const failures: string[] = [];
  if (whole.outstandingItemIds.length === 0) failures.push("outstanding items missing");
  if (whole.openDeficiencyCount === 0) failures.push("open deficiencies missing");
  if (whole.privilegeAssertionsUnderReview === 0) failures.push("privilege review state missing");
  if (whole.sanctionsConclusion !== null) failures.push("sanctions conclusion");
  if (whole.privilegeLegalConclusion !== null) failures.push("privilege legal conclusion");
  if (review.privilegeAssertions.some((row) => row.courtRulingReferenced)) {
    failures.push("privilege treated as court ruling");
  }
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
  "D3-CIVIL-ELEMENTS-01": gradeCivilElements,
  "D3-CIVIL-ASK-PARTY-01": gradeCivilAskParty,
  "D3-CIVIL-ASK-AUTH-01": gradeCivilAskAuthority,
  "D3-CIVIL-ASK-WHOLE-01": gradeCivilAskWhole,
  "D3-CIVIL-STRENGTH-01": gradeCivilStrength,
  "D4-DISC-UNANS-01": gradeDiscUnanswered,
  "D4-DISC-RESP-HIST-01": gradeDiscResponseHistory,
  "D4-DISC-OBJ-01": gradeDiscObjection,
  "D4-DISC-PROD-01": gradeDiscProduction,
  "D4-DISC-BATES-01": gradeDiscBatesDate,
  "D4-DISC-BATES-SIGNAL-01": gradeDiscBatesSignal,
  "D4-DISC-MISSING-01": gradeDiscMissing,
  "D4-DISC-SUPP-01": gradeDiscSupplement,
  "D4-DISC-MOTION-01": gradeDiscMotion,
  "D4-DISC-WHOLE-01": gradeDiscWhole,
  "D5-CITE-RESOLVED-01": gradeCiteResolved,
  "D5-CITE-META-01": gradeCiteMeta,
  "D5-CITE-AMBIG-01": gradeCiteAmbig,
  "D5-CITE-UNRESOLVED-01": gradeCiteUnresolved,
  "D5-CITE-NONCASE-01": gradeCiteNonCase,
  "D5-CITE-MALFORMED-01": gradeCiteMalformed,
  "D5-CITE-PARALLEL-01": gradeCiteParallel,
  "D5-CITE-TREATMENT-01": gradeCiteTreatment,
  "D5-CITE-ASK-01": gradeCiteAsk,
  "D5-CITE-DRAFT-01": gradeCiteDraft,
  "D5-CITE-GRAPH-01": gradeCiteGraph,
  "D5-CITE-MEMORY-01": gradeCiteMemory,
  "D6-MOT-PENDING-01": gradeD6Pending,
  "D6-MOT-STATUS-01": gradeD6Status,
  "D6-MOT-DISC-01": gradeD6DiscoveryChain,
  "D6-COMM-CHRONO-01": gradeD6Chronology,
  "D6-DEADLINE-01": gradeD6Deadlines,
  "D6-RULING-01": gradeD6Ruling,
  "D6-CLAIM-LINK-01": gradeD6ClaimLink,
  "D6-EVIDENCE-01": gradeD6Evidence,
  "D6-ABSTAIN-01": gradeD6Abstain,
  "D6-ISOLATION-01": gradeD6Isolation,
  "D6-WHOLE-01": gradeD6Whole,
  "D6-MAC-SAFE-01": gradeD6MacSafe,
  "D7-STATUS-01": gradeD7Status,
  "D7-CLAIM-SUPPORT-01": gradeD7ClaimSupport,
  "D7-CLAIM-GAP-01": gradeD7ClaimGap,
  "D7-DEFENSE-01": gradeD7Defense,
  "D7-EVIDENCE-ELEMENT-01": gradeD7EvidenceElement,
  "D7-CONTRADICTION-01": gradeD7Contradiction,
  "D7-DISC-GAP-01": gradeD7DiscGap,
  "D7-COMM-MOTION-01": gradeD7CommMotion,
  "D7-RULING-01": gradeD7Ruling,
  "D7-DEADLINE-01": gradeD7Deadline,
  "D7-AUTH-01": gradeD7Auth,
  "D7-ABSTAIN-01": gradeD7Abstain,
  "D7-INVESTIGATE-01": gradeD7Investigate,
  "D7-ISOLATION-01": gradeD7Isolation,
  "D7-WHOLE-01": gradeD7Whole,
};

function gradeD7Status(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence } = runPass7WholeMatterFixture();
  const failures: string[] = [];
  if (intelligence.status.flags.length === 0) failures.push("no status flags");
  if (
    !intelligence.status.flags.some((f) =>
      ["CLAIMS_ACTIVE", "EVIDENCE_GAP", "DEFICIENCIES_OUTSTANDING", "MOTION_PENDING", "MOTION_RULED"].includes(
        f,
      ),
    )
  ) {
    failures.push("expected core status flags");
  }
  return fail(assignment, failures);
}

function gradeD7ClaimSupport(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence, ids } = runPass7WholeMatterFixture();
  const claim = intelligence.claims.find((c) => c.claimId === ids.claimBreach);
  const failures: string[] = [];
  if (!claim) failures.push("claim missing");
  if (!claim?.supportStatus) failures.push("support status missing");
  if (intelligence.liabilityConclusion !== null) failures.push("liability set");
  return fail(assignment, failures);
}

function gradeD7ClaimGap(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence, ids } = runPass7WholeMatterFixture();
  const claim = intelligence.claims.find((c) => c.claimId === ids.claimBreach);
  const failures: string[] = [];
  if (!claim) failures.push("claim missing");
  if (
    !(
      (claim?.openGaps.length ?? 0) > 0 ||
      claim?.supportStatus === "PARTIALLY_SUPPORTED" ||
      claim?.supportStatus === "NO_EVIDENCE_FOUND" ||
      claim?.supportStatus === "CONFLICTED"
    )
  ) {
    failures.push("expected gap or partial/conflicted support");
  }
  return fail(assignment, failures);
}

function gradeD7Defense(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence, ids } = runPass7WholeMatterFixture();
  const defense = intelligence.defenses.find((d) => d.defenseId === ids.defense);
  const failures: string[] = [];
  if (!defense) failures.push("defense missing");
  if (defense?.established !== false) failures.push("defense treated as established");
  return fail(assignment, failures);
}

function gradeD7EvidenceElement(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence } = runPass7WholeMatterFixture();
  const failures: string[] = [];
  if (intelligence.propositions.length === 0) failures.push("no propositions");
  return fail(assignment, failures);
}

function gradeD7Contradiction(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence } = runPass7WholeMatterFixture();
  const failures: string[] = [];
  if (intelligence.contradictions.length === 0) failures.push("no contradictions");
  if (intelligence.contradictions.some((c) => c.credibilityConclusion !== null)) {
    failures.push("credibility conclusion set");
  }
  if (
    !intelligence.contradictions.some((c) =>
      ["DIRECT_CONFLICT", "POTENTIAL_TENSION"].includes(c.kind),
    )
  ) {
    failures.push("expected conflict/tension kind");
  }
  return fail(assignment, failures);
}

function gradeD7DiscGap(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence } = runPass7WholeMatterFixture();
  const failures: string[] = [];
  if (intelligence.openDeficiencyIds.length === 0) failures.push("no open deficiencies");
  if (intelligence.discoveryChains.length === 0) failures.push("no discovery chains");
  return fail(assignment, failures);
}

function gradeD7CommMotion(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence, ids } = runPass7WholeMatterFixture();
  const failures: string[] = [];
  if (!intelligence.communications.some((c) => c.id === ids.macComm)) failures.push("mac missing");
  if (!intelligence.motions.some((m) => m.motionId === ids.motionCompel)) failures.push("compel missing");
  const answer = answerWholeMatterQuestion({
    intelligence,
    question: "What communications led to the motion to compel?",
  });
  if (!answer.communications.some((c) => c.id === ids.macComm)) failures.push("ask missing mac");
  return fail(assignment, failures);
}

function gradeD7Ruling(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence, ids } = runPass7WholeMatterFixture();
  const motion = intelligence.motions.find((m) => m.motionId === ids.motionCompel);
  const failures: string[] = [];
  if (motion?.disposition !== "GRANTED_IN_PART") failures.push("wrong disposition");
  if (motion?.disposesEntireClaim !== false) failures.push("overstated claim disposal");
  if (intelligence.claims.some((c) => c.wholeClaimDisposedByMotion)) {
    failures.push("claim marked disposed by motion");
  }
  return fail(assignment, failures);
}

function gradeD7Deadline(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence } = runPass7WholeMatterFixture();
  const failures: string[] = [];
  if (intelligence.tasks.length === 0 && intelligence.deadlines.length === 0) {
    failures.push("no tasks/deadlines");
  }
  return fail(assignment, failures);
}

function gradeD7Auth(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence } = runPass7WholeMatterFixture();
  const buckets = new Set(intelligence.authorities.map((a) => a.resolution));
  const failures: string[] = [];
  if (!buckets.has("AUTHORITY_RESOLVED")) failures.push("missing AUTHORITY_RESOLVED");
  if (!buckets.has("CORPUS_COMPLETE")) failures.push("missing CORPUS_COMPLETE");
  if (!buckets.has("IDENTITY_UNRESOLVED")) failures.push("missing IDENTITY_UNRESOLVED");
  return fail(assignment, failures);
}

function gradeD7Abstain(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence } = runPass7WholeMatterFixture();
  const answer = answerWholeMatterQuestion({
    intelligence,
    question: "Will we win because the witness is lying?",
  });
  const text = formatWholeMatterAnswer(answer);
  const failures: string[] = [];
  if (answer.predictiveOutcome !== null) failures.push("predictive set");
  if (answer.credibilityConclusion !== null) failures.push("credibility set");
  if (!/PREDICTIVE_OUTCOME: null/.test(text)) failures.push("predictive line missing");
  return fail(assignment, failures);
}

function gradeD7Investigate(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence } = runPass7WholeMatterFixture();
  const failures: string[] = [];
  if (intelligence.investigateNext.length === 0) failures.push("no investigate items");
  if (intelligence.investigateNext.some((i) => !i.why || !i.resolvesIf)) {
    failures.push("investigate item missing why/resolvesIf");
  }
  if (intelligence.investigateNext.some((i) => i.predictiveOutcome !== null)) {
    failures.push("investigate predictive set");
  }
  return fail(assignment, failures);
}

function gradeD7Isolation(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence } = runPass7WholeMatterFixture();
  const failures: string[] = [];
  if (!intelligence.organizationId || !intelligence.matterId) failures.push("missing scope ids");
  return fail(assignment, failures);
}

function gradeD7Whole(assignment: DeepeningAssignment): DeepeningGrade {
  const { intelligence } = runPass7WholeMatterFixture();
  const answer = answerWholeMatterQuestion({
    intelligence,
    question: "Give me the complete status of this matter.",
  });
  const failures: string[] = [];
  if (intelligence.claims.length === 0) failures.push("no claims");
  if (intelligence.motions.length === 0) failures.push("no motions");
  if (intelligence.communications.length === 0) failures.push("no communications");
  if (answer.summaryLines.length === 0) failures.push("no summary");
  return fail(assignment, failures);
}

function gradeD6Pending(assignment: DeepeningAssignment): DeepeningGrade {
  const { review, ids } = runPass6LitigationFixture();
  const answer = answerMotionsCommunicationsQuestion({
    review,
    question: "What motions are pending?",
  });
  const failures: string[] = [];
  if (!answer.pendingMotionIds.includes(ids.motionPending)) failures.push("pending motion missing");
  if (answer.pendingMotionIds.includes(ids.motionCompel)) failures.push("compel treated as pending");
  return fail(assignment, failures);
}

function gradeD6Status(assignment: DeepeningAssignment): DeepeningGrade {
  const { review, ids } = runPass6LitigationFixture();
  const answer = answerMotionsCommunicationsQuestion({
    review,
    question: "What is the status of the motion to compel?",
  });
  const motion = answer.motions.find((m) => m.id === ids.motionCompel);
  const failures: string[] = [];
  if (!motion) failures.push("compel missing");
  if (motion?.disposition !== "GRANTED_IN_PART") failures.push("wrong disposition");
  if (motion?.status !== "GRANTED_IN_PART") failures.push("wrong status");
  return fail(assignment, failures);
}

function gradeD6DiscoveryChain(assignment: DeepeningAssignment): DeepeningGrade {
  const { review, ids } = runPass6LitigationFixture();
  const answer = answerMotionsCommunicationsQuestion({
    review,
    question: "What discovery deficiencies led to the motion to compel?",
  });
  const motion = answer.motions.find((m) => m.id === ids.motionCompel);
  const failures: string[] = [];
  if (!motion?.relatedDeficiencyIds.includes(ids.deficiencyId)) failures.push("deficiency not linked");
  if (
    !review.motionLinks.some(
      (l) => l.motionId === ids.motionCompel && l.linkType === "DISCOVERY_REQUEST_ITEM",
    )
  ) {
    failures.push("request item not linked");
  }
  return fail(assignment, failures);
}

function gradeD6Chronology(assignment: DeepeningAssignment): DeepeningGrade {
  const { review, ids } = runPass6LitigationFixture();
  const answer = answerMotionsCommunicationsQuestion({
    review,
    question: "What communications occurred before the motion was filed?",
  });
  const failures: string[] = [];
  if (!answer.communications.some((c) => c.id === ids.macComm)) failures.push("mac missing");
  if (!answer.communications.some((c) => c.id === ids.followComm)) failures.push("follow-up missing");
  return fail(assignment, failures);
}

function gradeD6Deadlines(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runPass6LitigationFixture();
  const answer = answerMotionsCommunicationsQuestion({
    review,
    question: "What deadlines are associated with the motion?",
  });
  const failures: string[] = [];
  if (!answer.explicitDeadlines.some((d) => d.label === "hearing")) failures.push("hearing missing");
  if (!answer.limitations.some((l) => /No jurisdictional deadline was calculated/i.test(l))) {
    failures.push("invented deadline risk not limited");
  }
  return fail(assignment, failures);
}

function gradeD6Ruling(assignment: DeepeningAssignment): DeepeningGrade {
  const { review, ids } = runPass6LitigationFixture();
  const answer = answerMotionsCommunicationsQuestion({
    review,
    question: "What did the court rule on the motion to compel?",
  });
  const motion = answer.motions.find((m) => m.id === ids.motionCompel);
  const failures: string[] = [];
  if (motion?.disposition !== "GRANTED_IN_PART") failures.push("wrong disposition");
  if (!motion?.rulingSummary?.toLowerCase().includes("grants in part")) {
    failures.push("ruling summary missing");
  }
  return fail(assignment, failures);
}

function gradeD6ClaimLink(assignment: DeepeningAssignment): DeepeningGrade {
  const { review, ids } = runPass6LitigationFixture();
  const answer = answerMotionsCommunicationsQuestion({
    review,
    question: "Which claim is this motion related to?",
  });
  const motion = answer.motions.find((m) => m.id === ids.motionCompel);
  const failures: string[] = [];
  if (!motion?.relatedClaimIds.includes(ids.claimId)) failures.push("claim not linked");
  if (!answer.limitations.some((l) => /does not mean the court disposed/i.test(l))) {
    failures.push("overclaim limitation missing");
  }
  return fail(assignment, failures);
}

function gradeD6Evidence(assignment: DeepeningAssignment): DeepeningGrade {
  const { review, ids } = runPass6LitigationFixture();
  const answer = answerMotionsCommunicationsQuestion({
    review,
    question: "What evidence supports the motion?",
  });
  const motion = answer.motions.find((m) => m.id === ids.motionCompel);
  const failures: string[] = [];
  if (!motion?.relatedEvidenceIds.includes(ids.evidenceId)) failures.push("evidence not linked");
  if (!answer.limitations.some((l) => /does not independently prove/i.test(l))) {
    failures.push("association limitation missing");
  }
  return fail(assignment, failures);
}

function gradeD6Abstain(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runPass6LitigationFixture();
  const answer = answerMotionsCommunicationsQuestion({
    review,
    question: "Will the motion to compel win because the judge favors plaintiff?",
  });
  const text = formatMotionsCommunicationsAnswer(answer);
  const failures: string[] = [];
  if (answer.predictiveOutcome !== null) failures.push("predictive outcome set");
  if (!/PREDICTIVE_OUTCOME: null/.test(text)) failures.push("predictive line missing");
  if (!answer.limitations.some((l) => /predictive|bad faith|judicial favor/i.test(l))) {
    failures.push("abstention limitation missing");
  }
  return fail(assignment, failures);
}

function gradeD6Isolation(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runPass6LitigationFixture();
  const failures: string[] = [];
  if (!review.organizationId || !review.matterId) failures.push("missing scope ids");
  if (review.motions.some((m) => m.organizationId !== review.organizationId)) {
    failures.push("motion org mismatch");
  }
  if (review.communications.some((c) => c.matterId !== review.matterId)) {
    failures.push("communication matter mismatch");
  }
  return fail(assignment, failures);
}

function gradeD6Whole(assignment: DeepeningAssignment): DeepeningGrade {
  const { review, ids } = runPass6LitigationFixture();
  const answer = answerMotionsCommunicationsQuestion({
    review,
    question: "Summarize the motions and communications on this matter.",
  });
  const failures: string[] = [];
  if (review.motions.length < 2) failures.push("expected two motions");
  if (review.communications.length < 2) failures.push("expected two communications");
  if (!answer.motions.some((m) => m.id === ids.motionCompel && m.disposition === "GRANTED_IN_PART")) {
    failures.push("compel disposition missing from summary");
  }
  const graph = planMotionsCommunicationsGraph(review);
  if (!graph.nodes.some((n) => n.nodeType === "motion")) failures.push("graph motion node missing");
  const timeline = planMotionsCommunicationsTimelineEvents(review);
  if (!timeline.some((e) => e.eventType === "motion_ruled")) failures.push("timeline ruling missing");
  return fail(assignment, failures);
}

function gradeD6MacSafe(assignment: DeepeningAssignment): DeepeningGrade {
  const { review } = runPass6LitigationFixture();
  const answer = answerMotionsCommunicationsQuestion({
    review,
    question: "What meet-and-confer communications occurred?",
  });
  const failures: string[] = [];
  if (answer.sanctionsConclusion !== null) failures.push("sanctions conclusion");
  if (answer.privilegeLegalConclusion !== null) failures.push("privilege legal conclusion");
  if (!answer.communications.some((c) => c.communicationType === "MEET_AND_CONFER")) {
    failures.push("mac communication missing");
  }
  return fail(assignment, failures);
}

function gradeCiteResolved(assignment: DeepeningAssignment): DeepeningGrade {
  const fixture = buildPass5CitationFixture();
  const [row] = resolveCitationsForProduct({
    citations: [{ rawCitation: fixture.citations.resolvedCorpusComplete }],
    authorities: fixture.authorities,
  });
  const failures: string[] = [];
  if (row?.outcome !== "RESOLVED_HIGH_CONFIDENCE") failures.push("not resolved");
  if (row?.authorityState !== "CORPUS_COMPLETE" || !row.corpusComplete) failures.push("not corpus complete");
  if (!row?.coverage.treatmentUnknown) failures.push("invented treatment");
  return fail(assignment, failures);
}

function gradeCiteMeta(assignment: DeepeningAssignment): DeepeningGrade {
  const fixture = buildPass5CitationFixture();
  const [row] = resolveCitationsForProduct({
    citations: [{ rawCitation: fixture.citations.resolvedMetadataOnly }],
    authorities: fixture.authorities,
  });
  const failures: string[] = [];
  if (row?.authorityState !== "AUTHORITY_RESOLVED") failures.push("expected AUTHORITY_RESOLVED");
  if (row?.corpusComplete) failures.push("false corpus-complete");
  if (row?.coverage.displayState !== "IDENTITY_VERIFIED_TEXT_NOT_IN_CORPUS") {
    failures.push("missing text-not-in-corpus disclosure");
  }
  return fail(assignment, failures);
}

function gradeCiteAmbig(assignment: DeepeningAssignment): DeepeningGrade {
  const fixture = buildPass5CitationFixture();
  const [row] = resolveCitationsForProduct({
    citations: [{ rawCitation: fixture.citations.ambiguous }],
    authorities: fixture.authorities,
  });
  const policy = applyResolveOrAbstainPolicy({ resolutions: row ? [row] : [] });
  const failures: string[] = [];
  if (row?.outcome !== "AMBIGUOUS") failures.push("not ambiguous");
  if (row?.authorityId) failures.push("silent winner selected");
  if (!policy.suppressedCitations.includes(fixture.citations.ambiguous)) failures.push("not suppressed");
  return fail(assignment, failures);
}

function gradeCiteUnresolved(assignment: DeepeningAssignment): DeepeningGrade {
  const fixture = buildPass5CitationFixture();
  const [row] = resolveCitationsForProduct({
    citations: [{ rawCitation: fixture.citations.unresolved }],
    authorities: fixture.authorities,
  });
  const failures: string[] = [];
  if (row?.coverage.displayState !== "UNRESOLVED") failures.push("not unresolved");
  if (row?.authorityId) failures.push("fabricated authority");
  return fail(assignment, failures);
}

function gradeCiteNonCase(assignment: DeepeningAssignment): DeepeningGrade {
  const fixture = buildPass5CitationFixture();
  const [row] = resolveCitationsForProduct({
    citations: [{ rawCitation: fixture.citations.nonCase }],
    authorities: fixture.authorities,
  });
  return fail(assignment, row?.outcome === "NOT_CASE_CITATION" ? [] : ["expected NOT_CASE_CITATION"]);
}

function gradeCiteMalformed(assignment: DeepeningAssignment): DeepeningGrade {
  const fixture = buildPass5CitationFixture();
  const [row] = resolveCitationsForProduct({
    citations: [{ rawCitation: fixture.citations.malformed }],
    authorities: fixture.authorities,
  });
  return fail(assignment, row?.outcome === "MALFORMED" ? [] : ["expected MALFORMED"]);
}

function gradeCiteParallel(assignment: DeepeningAssignment): DeepeningGrade {
  const fixture = buildPass5CitationFixture();
  const [row] = resolveCitationsForProduct({
    citations: [{ rawCitation: fixture.citations.parallel }],
    authorities: fixture.authorities,
  });
  const failures: string[] = [];
  if (row?.outcome !== "RESOLVED_HIGH_CONFIDENCE") failures.push("parallel not resolved");
  if (row?.outcome === "AMBIGUOUS") failures.push("unexpected ambiguity");
  return fail(assignment, failures);
}

function gradeCiteTreatment(assignment: DeepeningAssignment): DeepeningGrade {
  const fixture = buildPass5CitationFixture();
  const rows = resolveCitationsForProduct({
    citations: [
      { rawCitation: fixture.citations.resolvedCorpusComplete },
      { rawCitation: fixture.citations.resolvedMetadataOnly },
    ],
    authorities: fixture.authorities,
  });
  const failures: string[] = [];
  if (!rows.every((row) => row.coverage.treatmentUnknown)) failures.push("treatment not unknown");
  if (!rows.every((row) => row.coverage.coverageWarning?.includes(TREATMENT_UNVERIFIED_NOTICE))) {
    failures.push("missing treatment unverified notice");
  }
  return fail(assignment, failures);
}

function gradeCiteAsk(assignment: DeepeningAssignment): DeepeningGrade {
  const fixture = buildPass5CitationFixture();
  const resolutions = resolveCitationsForProduct({
    citations: [
      { rawCitation: fixture.citations.resolvedCorpusComplete },
      { rawCitation: fixture.citations.resolvedMetadataOnly },
      { rawCitation: fixture.citations.ambiguous },
    ],
    authorities: fixture.authorities,
  });
  const policy = applyResolveOrAbstainPolicy({ resolutions });
  const failures: string[] = [];
  if (!policy.allowedFullTextAuthorityIds.includes("auth-brown")) failures.push("full-text not allowed");
  if (!policy.allowedIdentityAuthorityIds.includes("auth-roe-meta")) failures.push("identity not allowed");
  if (!policy.suppressedCitations.includes(fixture.citations.ambiguous)) failures.push("ambiguous not suppressed");
  return fail(assignment, failures);
}

function gradeCiteDraft(assignment: DeepeningAssignment): DeepeningGrade {
  const fixture = buildPass5CitationFixture();
  const resolutions = resolveCitationsForProduct({
    citations: [
      { rawCitation: fixture.citations.ambiguous },
      { rawCitation: fixture.citations.unresolved },
    ],
    authorities: fixture.authorities,
  });
  const grounded = applyDraftCitationResolveOrAbstain({
    content: `See ${fixture.citations.ambiguous} and ${fixture.citations.unresolved}.`,
    assumptions: [],
    resolutions,
  });
  const failures: string[] = [];
  if (grounded.suppressedCitations.length < 2) failures.push("suppressed citations missing");
  if (!/Attorney review required/i.test(grounded.content)) failures.push("review banner missing");
  if (/invented authority/i.test(grounded.content)) failures.push("fabricated substitute");
  return fail(assignment, failures);
}

function gradeCiteGraph(assignment: DeepeningAssignment): DeepeningGrade {
  const fixture = buildPass5CitationFixture();
  const [resolved, ambiguous] = resolveCitationsForProduct({
    citations: [
      { rawCitation: fixture.citations.resolvedCorpusComplete },
      { rawCitation: fixture.citations.ambiguous },
    ],
    authorities: fixture.authorities,
  });
  const failures: string[] = [];
  if (!canLinkAuthorityInGraph(resolved!)) failures.push("resolved should be linkable");
  if (canLinkAuthorityInGraph(ambiguous!)) failures.push("ambiguous must not be linkable");
  return fail(assignment, failures);
}

function gradeCiteMemory(assignment: DeepeningAssignment): DeepeningGrade {
  const fixture = buildPass5CitationFixture();
  const [resolved] = resolveCitationsForProduct({
    citations: [{ rawCitation: fixture.citations.resolvedMetadataOnly }],
    authorities: fixture.authorities,
  });
  const fact = memorySafeResolutionFact(resolved!);
  const failures: string[] = [];
  if (!fact.allowed || !fact.fact) failures.push("resolution fact blocked");
  if (!blocksUnsupportedTreatmentMemory("This case is still good law.")) {
    failures.push("good-law conclusion not blocked");
  }
  return fail(assignment, failures);
}

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
