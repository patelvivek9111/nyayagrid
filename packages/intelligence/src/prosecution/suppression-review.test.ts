import { describe, expect, it } from "vitest";
import { CORPUS_HOLDING_SCREEN } from "./suppression-catalog";
import {
  HOLDING_SCREEN_IDENTITY,
  HOLDING_SCREEN_REJECTED,
  SOURCE_BACKED_SUPPRESSION_AUTHORITIES,
} from "./suppression-source-backed";
import {
  runMirandaReview,
  runMissingAffidavitReview,
  runMultiTheoryWarrantReview,
  runMultiWarrantDefendantReview,
  runPennsylvaniaDoctrineReview,
  runSuppressionHierarchyReview,
} from "./suppression-fixtures";
import {
  answerSuppressionQuestion,
  buildSuppressionReview,
  checkSuppressionConsistency,
  findAutonomousSuppressionViolations,
  formatSuppressionAnswer,
  inferSuppressionDoctrine,
  screenHoldingProposition,
  suppressionPayload,
} from "./suppression-review";

describe("suppression review dimensions", () => {
  it("keeps probable cause, nexus, staleness, good faith, and execution apart", () => {
    const { review, answerText } = runMultiTheoryWarrantReview();
    const dimensions = review.issues.filter((issue) => issue.warrantId === "warrant-phone").map((issue) => issue.dimension);
    expect(dimensions).toEqual(expect.arrayContaining(["PROBABLE_CAUSE", "NEXUS", "STALENESS", "GOOD_FAITH", "EXECUTION"]));
    expect(new Set(dimensions).size).toBe(dimensions.length);
    const probableCause = review.issues.find((issue) => issue.dimension === "PROBABLE_CAUSE");
    const goodFaith = review.issues.find((issue) => issue.dimension === "GOOD_FAITH");
    const nexus = review.issues.find((issue) => issue.dimension === "NEXUS");
    expect(probableCause?.authorities.map((authority) => authority.authorityId)).toEqual(["auth-synth-pc"]);
    expect(goodFaith?.authorities.map((authority) => authority.authorityId)).toEqual(["auth-synth-faith"]);
    expect(nexus?.authorities).toEqual([]);
    expect(probableCause?.missingFacts.join(" ")).not.toBe(goodFaith?.missingFacts.join(" "));
    expect(probableCause?.legalStandard).toMatch(/probable cause is reviewed/i);
    expect(goodFaith?.legalStandard).toMatch(/good-faith review/i);
    expect(review.suppressionConclusion).toBeNull();
    expect(review.validityConclusion).toBeNull();
    expect(review.guiltConclusion).toBeNull();
    expect(findAutonomousSuppressionViolations(answerText)).toEqual([]);
    expect(answerText).toContain("SUPPRESSION_CONCLUSION: null");
    expect(answerText).toContain("GUILT_CONCLUSION: null");
  });

  it("does not mix warrants or defendant-specific evidence", () => {
    const review = runMultiWarrantDefendantReview();
    const ada = review.issues.filter((issue) => issue.warrantId === "warrant-ada");
    const joint = review.issues.filter((issue) => issue.warrantId === "warrant-joint");
    expect(ada.length).toBeGreaterThan(0);
    expect(joint.length).toBeGreaterThan(0);
    expect(ada.every((issue) => issue.linkedEvidence.every((item) => item.evidenceId === "ev-ada"))).toBe(true);
    expect(joint.every((issue) => issue.linkedEvidence.every((item) => item.evidenceId === "ev-joint"))).toBe(true);
    expect(ada[0]?.defendantScope).toBe("DEFENDANT_SPECIFIC");
    expect(joint[0]?.defendantScope).toBe("JOINT");
    const adaView = review.warrants.find((warrant) => warrant.id === "warrant-ada");
    const jointView = review.warrants.find((warrant) => warrant.id === "warrant-joint");
    expect(adaView?.timelineEventIds).toEqual(["tl-ada-issue", "tl-ada-exec"]);
    expect(jointView?.timelineEventIds).toEqual(["tl-joint-issue", "tl-joint-exec"]);
    const answer = answerSuppressionQuestion({
      review,
      question: "What suppression issues should be reviewed?",
      defendantId: "def-ben",
    });
    expect(answer.issues.every((issue) => issue.warrantId !== "warrant-ada")).toBe(true);
    expect(answer.guiltConclusion).toBeNull();
  });

  it("reviews Miranda timing without a suppression decision", () => {
    const review = runMirandaReview();
    const issue = review.issues.find((row) => row.dimension === "MIRANDA");
    expect(issue?.missingFacts).toContain("Miranda timing is not recorded.");
    expect(issue?.timelineEventIds).toEqual(["tl-interview"]);
    expect(issue?.defendantIds).toEqual(["def-ada"]);
    expect(issue?.suppressionConclusion).toBeNull();
    const text = formatSuppressionAnswer(answerSuppressionQuestion({ review, question: "What Miranda issues should be reviewed?" }));
    expect(text).toContain("ISSUE: MIRANDA");
    expect(findAutonomousSuppressionViolations(text)).toEqual([]);
  });

  it("surfaces missing affidavit facts without filling them", () => {
    const review = runMissingAffidavitReview();
    const probableCause = review.issues.find((issue) => issue.dimension === "PROBABLE_CAUSE");
    expect(probableCause?.missingFacts).toContain("Affidavit unavailable.");
    expect(probableCause?.knownFacts).toEqual([]);
    expect(probableCause?.legalStandard).toBeNull();
    expect(review.issues.find((issue) => issue.dimension === "STALENESS")?.missingFacts).toContain(
      "Date of underlying observations is not recorded.",
    );
    expect(review.issues.find((issue) => issue.dimension === "NEXUS")?.missingFacts.join(" ")).toMatch(/not recorded/i);
  });
});

describe("authority hierarchy and treatment", () => {
  it("classifies SCOTUS, the Third Circuit, and EDPA on a federal issue", () => {
    const review = runSuppressionHierarchyReview();
    const authorities = review.issues.find((issue) => issue.dimension === "PROBABLE_CAUSE")?.authorities ?? [];
    const status = (id: string) => authorities.find((authority) => authority.authorityId === id)?.authorityStatus;
    expect(status("auth-scotus")).toBe("BINDING");
    expect(status("auth-ca3")).toBe("BINDING");
    expect(status("auth-edpa")).toBe("PERSUASIVE");
    expect(status("auth-pa-high")).toBe("PERSUASIVE");
    expect(status("auth-pa-app")).toBe("PERSUASIVE");
    expect(authorities.every((authority) => authority.treatment === "UNVERIFIED")).toBe(true);
    expect(JSON.stringify(authorities)).not.toMatch(/good law/i);
  });

  it("keeps Pennsylvania constitutional hierarchy separate from the Fourth Amendment", () => {
    const unspecified = inferSuppressionDoctrine({ jurisdiction: "PA", forumCourtId: "st-pa-trial" });
    expect(unspecified.doctrine).toBe("UNKNOWN");
    expect(unspecified.warning).toMatch(/separate/i);
    const review = runPennsylvaniaDoctrineReview();
    const authorities = review.issues.find((issue) => issue.dimension === "PROBABLE_CAUSE")?.authorities ?? [];
    const status = (id: string) => authorities.find((authority) => authority.authorityId === id)?.authorityStatus;
    expect(status("auth-pa-high")).toBe("BINDING");
    expect(status("auth-pa-app")).toBe("BINDING");
    expect(status("auth-scotus")).toBe("NONCONTROLLING");
  });

  it("attaches only Neon source-backed propositions and keeps treatment unverified", () => {
    expect(SOURCE_BACKED_SUPPRESSION_AUTHORITIES.every((entry) => entry.sourceSupported && entry.treatment === "UNVERIFIED")).toBe(
      true,
    );
    expect(SOURCE_BACKED_SUPPRESSION_AUTHORITIES.some((entry) => entry.caseName === "Illinois v. Gates" && entry.autoAttach)).toBe(
      true,
    );
    expect(HOLDING_SCREEN_REJECTED.some((entry) => entry.caseName === "Fuentes v. Shevin")).toBe(true);
    expect(HOLDING_SCREEN_REJECTED.some((entry) => entry.caseName === "Bamont")).toBe(true);
    expect(HOLDING_SCREEN_IDENTITY.cases).toBe(4680);
    const screened = screenHoldingProposition({
      proposition: "probable cause existed",
      sourceSpan: "probable cause existed",
      sourceText: "The affidavit discusses other facts.",
    });
    expect(screened.sourceSupported).toBe(false);
    expect(screened.proposition).toBeNull();
  });

  it("places Gates and Leon on the matching warrant issues only", () => {
    const payload = suppressionPayload({
      jurisdiction: "US",
      forumCourtId: "us-d-pa-ed",
      doctrine: "FEDERAL_CONSTITUTIONAL",
      warrants: [
        {
          id: "warrant-phone",
          warrantType: "search",
          issuingCourt: "us-d-pa-ed",
          issuingJudge: null,
          applicationDate: "2026-04-01",
          issueDate: "2026-04-02",
          executionDate: "2026-05-20",
          scope: "cellular phone",
          probableCauseFacts: ["Officer report describes a witness observation."],
          sourceFactIds: [],
          seizedEvidenceIds: ["ev-phone"],
          returnNotes: null,
          relatedSuppressionIssueIds: [],
          openedDimensions: ["GOOD_FAITH", "EXIGENCY"],
        },
      ],
      procedureIssues: [],
      evidence: [
        {
          id: "ev-phone",
          evidenceType: "device",
          documentId: "doc-phone",
          storageReference: null,
          relatedDefendantIds: ["def-ada"],
          relatedWitnessIds: [],
        },
      ],
    });
    const probableCause = payload.suppressionReview.issues.find((issue) => issue.dimension === "PROBABLE_CAUSE");
    const goodFaith = payload.suppressionReview.issues.find((issue) => issue.dimension === "GOOD_FAITH");
    const execution = payload.suppressionReview.issues.find((issue) => issue.dimension === "EXECUTION");
    expect(probableCause?.authorities.some((authority) => authority.citation === "462 U.S. 213")).toBe(true);
    expect(goodFaith?.authorities.some((authority) => authority.citation === "468 U.S. 897")).toBe(true);
    expect(goodFaith?.authorities.every((authority) => authority.treatment === "UNVERIFIED")).toBe(true);
    expect(execution?.authorities.some((authority) => /Hudson/i.test(authority.title ?? "") || authority.citation === "547 U.S. 586")).toBe(
      true,
    );
    expect(probableCause?.authorities.some((authority) => authority.citation === "468 U.S. 897")).toBe(false);
    expect(payload.suppressionReview.suppressionConclusion).toBeNull();
    expect(payload.suppressionReview.validityConclusion).toBeNull();
    expect(payload.suppressionReview.guiltConclusion).toBeNull();
  });
});

describe("suppression guardrails", () => {
  it("rejects autonomous validity, suppression, and guilt language", () => {
    expect(findAutonomousSuppressionViolations("The warrant was valid.")).toContain("warrant validity");
    expect(findAutonomousSuppressionViolations("The search was unconstitutional.")).toContain("unconstitutional search");
    expect(findAutonomousSuppressionViolations("The evidence should be suppressed.")).toContain("suppression decision");
    expect(findAutonomousSuppressionViolations("Probable cause existed.")).toContain("probable cause conclusion");
    expect(findAutonomousSuppressionViolations("The defendant is guilty.")).toContain("guilt");
    expect(findAutonomousSuppressionViolations("HUMAN_ENTERED_DECISION: The warrant was valid.")).toEqual([]);
  });

  it("marks new warrant evidence for review and stays consistent across views", () => {
    const built = buildSuppressionReview({
      jurisdiction: "US",
      forumCourtId: "us-d-pa-ed",
      doctrine: "FEDERAL_CONSTITUTIONAL",
      warrants: [
        {
          id: "warrant-phone",
          warrantType: "search",
          issuingCourt: "us-d-pa-ed",
          issuingJudge: null,
          applicationDate: null,
          issueDate: null,
          executionDate: null,
          scope: "phone",
          probableCauseFacts: [],
          sourceFactIds: [],
          seizedEvidenceIds: ["ev-phone"],
          returnNotes: null,
          relatedSuppressionIssueIds: [],
        },
      ],
      procedureIssues: [],
      evidence: [
        {
          id: "ev-phone",
          evidenceType: "device",
          documentId: "doc-phone",
          storageReference: null,
          relatedDefendantIds: ["def-ada"],
          relatedWitnessIds: [],
        },
      ],
      priorEvidenceIds: [],
      currentEvidenceIds: ["ev-phone"],
    });
    expect(built.issues.every((issue) => issue.reviewStatus === "needs_review")).toBe(true);
    const answer = answerSuppressionQuestion({ review: built, question: "What suppression issues should be reviewed?" });
    const consistency = checkSuppressionConsistency({
      review: built,
      answer,
      evidenceIds: ["ev-phone"],
      warrantIds: ["warrant-phone"],
      defendantEvidence: [{ evidenceId: "ev-phone", relatedDefendantIds: ["def-ada"] }],
    });
    expect(consistency.consistent).toBe(true);
  });
});
