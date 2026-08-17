/**
 * Live-9 regression diagnosis (offline). Not a product fix.
 *
 * False-rent: live-9 copy follows the false-premise example, but citing
 * chunk_lease_term is enough for the validator to coerce insufficient→partial.
 * Keyword probe cannot reproduce that cite; it only keys off the false-premise
 * marker. Mixed-term#1 matches the new isolated-decoy taught string. Ninety-day
 * draft was already 1/3 on live 6–7.
 */
import { describe, expect, it } from "vitest";
import {
  NYAYA_AMENDMENT_GROUNDED_WORKED_EXAMPLE,
  NYAYA_AMENDMENT_HEDGE_WORKED_EXAMPLE,
  NYAYA_AMENDMENT_WORKED_EXAMPLE,
  NYAYA_FALSE_PREMISE_WORKED_EXAMPLE,
  buildNyayaSystemPrompt,
  validateCitedAnswerAgainstPassages,
} from "../index";
import { GRADED_CASES } from "./graded-cases";
import { gradeCitedAnswer } from "./grade";
import {
  COMPARE_ISOLATED_DECOY_WORKED_EXAMPLE,
  COMPARE_MIXED_WORKED_EXAMPLE,
  LIVE_CONTRACT_COMPARE_SCENARIOS,
} from "./live-contract-compare";
import { gradeLiveCompareScenario, isNoMaterialChangeClaim } from "./grade-live-compare";
import {
  FALSE_RENT_CASE_ID,
  gradeCaseWithProbe,
} from "./conservatism-mock";

const LIVE8_FALSE_RENT = {
  answer: "The available matter documents do not provide sufficient evidence to answer this question.",
  sources: [] as const,
  assumptions: [],
  unresolvedQuestions: ["Insufficient evidence in retrieved matter sources."],
  evidenceState: "insufficient" as const,
};

const LIVE9_FALSE_RENT_ANSWER =
  "The Sources do not contain enough information to confirm the monthly base rent.";

const LIVE9_MIXED_TERM_1 = "No material changes detected.";
const LIVE8_MIXED_TERM_1 = "The term has been extended to expire on December 31, 2027.";

function gradeFalseRent(raw: unknown) {
  const testCase = GRADED_CASES.find((c) => c.id === FALSE_RENT_CASE_ID)!;
  return gradeCitedAnswer({
    caseId: testCase.id,
    raw,
    retrieved: testCase.retrieved,
    rubric: testCase.rubric,
    question: testCase.question,
    workflow: "case_qa",
    shouldRefuse: testCase.shouldRefuse,
    trapKind: testCase.trapKind,
  });
}

describe("live-9 false-rent flip", () => {
  const testCase = GRADED_CASES.find((c) => c.id === FALSE_RENT_CASE_ID)!;
  const term = testCase.retrieved.find((p) => p.chunkId === "chunk_lease_term")!;

  it("live-8 captured output still passes; live-9 captured output fails as false-confidence", () => {
    const live8 = gradeFalseRent(LIVE8_FALSE_RENT);
    expect(live8.passed).toBe(true);
    expect(live8.answer?.evidenceState).toBe("insufficient");
    expect(live8.flags.falseConfidence).toBe(false);

    const live9 = gradeFalseRent({
      answer: LIVE9_FALSE_RENT_ANSWER,
      sources: [
        {
          chunkId: term.chunkId,
          documentId: term.documentId,
          documentVersionId: term.documentVersionId,
          quote: term.quote,
        },
      ],
      assumptions: [],
      unresolvedQuestions: [],
      evidenceState: "partial",
    });
    expect(live9.passed).toBe(false);
    expect(live9.answer?.evidenceState).toBe("partial");
    expect(live9.flags.falseConfidence).toBe(true);
    expect(LIVE9_FALSE_RENT_ANSWER.toLowerCase()).not.toMatch(/seven thousand|7,000/);
  });

  it("validator coerces insufficient→partial whenever a valid cite is retained", () => {
    const withCite = validateCitedAnswerAgainstPassages(
      {
        answer: LIVE9_FALSE_RENT_ANSWER,
        sources: [
          {
            chunkId: term.chunkId,
            documentId: term.documentId,
            documentVersionId: term.documentVersionId,
            quote: term.quote,
          },
        ],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "insufficient",
      },
      testCase.retrieved,
    );
    expect(withCite.answer.evidenceState).toBe("partial");
    expect(withCite.answer.sources).toHaveLength(1);

    const noCite = validateCitedAnswerAgainstPassages(
      {
        answer: LIVE9_FALSE_RENT_ANSWER,
        sources: [],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "insufficient",
      },
      testCase.retrieved,
    );
    expect(noCite.answer.evidenceState).toBe("insufficient");
    expect(noCite.answer.sources).toHaveLength(0);
    expect(gradeFalseRent(noCite.answer).passed).toBe(true);
  });

  it("false-premise and amendment examples collide on chunk_lease_term; hedge teaches cite+partial", () => {
    expect(NYAYA_FALSE_PREMISE_WORKED_EXAMPLE).toMatch(/chunk_lease_term/);
    expect(NYAYA_FALSE_PREMISE_WORKED_EXAMPLE).toMatch(/evidenceState=insufficient/);
    expect(NYAYA_FALSE_PREMISE_WORKED_EXAMPLE).toMatch(/Do not set partial/);
    expect(NYAYA_FALSE_PREMISE_WORKED_EXAMPLE).not.toMatch(/sources=\[\]|cite no sources|do not cite/i);
    expect(NYAYA_AMENDMENT_GROUNDED_WORKED_EXAMPLE).toMatch(/chunk_lease_term/);
    expect(NYAYA_AMENDMENT_GROUNDED_WORKED_EXAMPLE).toMatch(
      /Do not set insufficient because a base-lease excerpt is also present/,
    );
    expect(NYAYA_AMENDMENT_HEDGE_WORKED_EXAMPLE).toMatch(/evidenceState=partial/);
    expect(NYAYA_AMENDMENT_HEDGE_WORKED_EXAMPLE).toMatch(/cite chunk_amend_indemnity/);
    expect(LIVE9_FALSE_RENT_ANSWER).toMatch(/Sources do not contain enough information to confirm/);
    expect(NYAYA_FALSE_PREMISE_WORKED_EXAMPLE).toMatch(
      /Sources do not contain enough information to confirm the CAM charge/,
    );
  });

  it("keyword probe still returns insufficient when the hedge contrast is stripped — cannot reproduce the live cite", async () => {
    const full = await gradeCaseWithProbe(FALSE_RENT_CASE_ID);
    expect(full.passed).toBe(true);
    expect(full.evidenceState).toBe("insufficient");

    const strippedHedge = buildNyayaSystemPrompt().replace(NYAYA_AMENDMENT_HEDGE_WORKED_EXAMPLE, "");
    expect(strippedHedge).toContain(NYAYA_FALSE_PREMISE_WORKED_EXAMPLE.slice(0, 40));
    const withoutHedge = await gradeCaseWithProbe(FALSE_RENT_CASE_ID, strippedHedge);
    expect(withoutHedge.passed).toBe(true);
    expect(withoutHedge.evidenceState).toBe("insufficient");

    const strippedAmendment = buildNyayaSystemPrompt().replace(NYAYA_AMENDMENT_WORKED_EXAMPLE, "");
    const withoutAmendment = await gradeCaseWithProbe(FALSE_RENT_CASE_ID, strippedAmendment);
    expect(withoutAmendment.passed).toBe(true);
    expect(withoutAmendment.evidenceState).toBe("insufficient");

    const strippedPremise = buildNyayaSystemPrompt().replace(NYAYA_FALSE_PREMISE_WORKED_EXAMPLE, "");
    const withoutPremise = await gradeCaseWithProbe(FALSE_RENT_CASE_ID, strippedPremise);
    expect(withoutPremise.passed).toBe(false);
    expect(withoutPremise.evidenceState).toBe("partial");
    expect(withoutPremise.answer?.toLowerCase()).toMatch(/seven thousand/);
  });
});

describe("live-9 adjacent cases", () => {
  it("mixed-term-labelled#1 is the isolated-decoy taught no-change string, not mixed-example language", () => {
    const mixed = LIVE_CONTRACT_COMPARE_SCENARIOS.find((s) => s.id === "cc-live-mixed-term-labelled")!;
    expect(COMPARE_ISOLATED_DECOY_WORKED_EXAMPLE).toMatch(/No material changes detected/);
    expect(COMPARE_MIXED_WORKED_EXAMPLE).not.toMatch(/no material changes/i);
    expect(isNoMaterialChangeClaim(LIVE9_MIXED_TERM_1)).toBe(true);
    expect(gradeLiveCompareScenario({ scenario: mixed, summary: LIVE9_MIXED_TERM_1 }).passed).toBe(
      false,
    );
    expect(gradeLiveCompareScenario({ scenario: mixed, summary: LIVE8_MIXED_TERM_1 }).passed).toBe(
      true,
    );
  });

  it("ninety-day-draft is a decoy-adjacent grounded case, not in the conservatism 13", () => {
    const testCase = GRADED_CASES.find((c) => c.id === "golden-adv-near-miss-ninety-day-draft")!;
    expect(testCase.rubric.expectEvidenceState).toBe("grounded");
    expect(testCase.rubric.mustCiteChunkIds).toEqual(["chunk_lease_notice"]);
    expect(testCase.rubric.forbiddenChunkIds).toEqual(["chunk_decoy_ninety_day_draft"]);
    expect(testCase.retrieved.map((p) => p.chunkId)).toEqual([
      "chunk_lease_notice",
      "chunk_decoy_ninety_day_draft",
    ]);
  });
});
