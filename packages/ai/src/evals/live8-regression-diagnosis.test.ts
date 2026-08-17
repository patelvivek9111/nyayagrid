/**
 * Live-8 regression diagnosis (offline). Not a product fix.
 *
 * Isolated decoys: live-8 summaries are the product empty-summary fallback, not
 * v3 example language. QA-05 indemnity: keyword probe cannot reproduce the
 * live grounded flip; prompt overlap points at the amendment example.
 */
import { describe, expect, it } from "vitest";
import {
  NYAYA_AMENDMENT_WORKED_EXAMPLE,
  NYAYA_FALSE_PREMISE_WORKED_EXAMPLE,
  buildNyayaSystemPrompt,
} from "../index";
import {
  assertsInventedMaterialChange,
  gradeLiveCompareScenario,
  isNoMaterialChangeClaim,
} from "./grade-live-compare";
import { GRADED_CASES } from "./graded-cases";
import {
  COMPARE_ISOLATED_DECOY_WORKED_EXAMPLE,
  COMPARE_MIXED_WORKED_EXAMPLE,
  LIVE_CONTRACT_COMPARE_SCENARIOS,
} from "./live-contract-compare";
import {
  FALSE_RENT_CASE_ID,
  INDEMNITY_AMENDMENT_CASE_ID,
  QA05_INDEMNITY_CASE_ID,
  gradeCaseWithProbe,
} from "./conservatism-mock";

const LIVE8_DECOY_FALLBACK = "Document versions differ; review the detected changes.";
const LIVE8_DECOY_EXPORT = `${LIVE8_DECOY_FALLBACK}\n\n[Note: AI summary claims are not fully aligned with the deterministic paragraph diff. Treat the summary as a proposal and verify every claim against the change list.]`;
const LIVE7_DECOY_SUMMARY = "No material changes detected.";


describe("live-8 isolated-decoy phrasing diagnosis", () => {
  const isolatedExhibit = LIVE_CONTRACT_COMPARE_SCENARIOS.find((s) => s.id === "cc-live-decoy-exhibit")!;

  it("the live-8 string is the product empty-summary fallback, not v3 example language", () => {
    expect(COMPARE_MIXED_WORKED_EXAMPLE).not.toMatch(/Document versions differ/i);
    expect(COMPARE_MIXED_WORKED_EXAMPLE).not.toMatch(/review the detected changes/i);
    expect(COMPARE_MIXED_WORKED_EXAMPLE).toMatch(/Do not mention Exhibit 1 or Exhibit I/);
    expect(COMPARE_MIXED_WORKED_EXAMPLE).not.toMatch(/no material changes/i);
    expect(COMPARE_ISOLATED_DECOY_WORKED_EXAMPLE).toMatch(/No material changes detected/);
    expect(COMPARE_ISOLATED_DECOY_WORKED_EXAMPLE).toMatch(/Do not return an empty summary/);
  });

  it("live-7 phrasing is a true no-material-change claim; live-8 fallback is not", () => {
    expect(isNoMaterialChangeClaim(LIVE7_DECOY_SUMMARY)).toBe(true);
    expect(assertsInventedMaterialChange(LIVE7_DECOY_SUMMARY)).toBe(false);
    expect(isNoMaterialChangeClaim(LIVE8_DECOY_FALLBACK)).toBe(false);
    expect(isNoMaterialChangeClaim(LIVE8_DECOY_EXPORT)).toBe(false);
    expect(assertsInventedMaterialChange(LIVE8_DECOY_FALLBACK)).toBe(true);
    expect(assertsInventedMaterialChange(LIVE8_DECOY_EXPORT)).toBe(true);
  });

  it("grader fails isolated decoy on the fallback the same way live 8 did", () => {
    const live7 = gradeLiveCompareScenario({
      scenario: isolatedExhibit,
      summary: LIVE7_DECOY_SUMMARY,
    });
    expect(live7.passed).toBe(true);
    const live8 = gradeLiveCompareScenario({
      scenario: isolatedExhibit,
      summary: LIVE8_DECOY_EXPORT,
    });
    expect(live8.passed).toBe(false);
    expect(live8.details).toMatch(/invented material change/i);
  });
});

describe("live-8 QA-05 indemnity ablation", () => {
  it("QA-05 indemnity uses the same amendment chunk; v7 contrasts grounded vs partial on that chunk", () => {
    const qa05 = GRADED_CASES.find((c) => c.id === QA05_INDEMNITY_CASE_ID)!;
    expect(qa05.retrieved.map((p) => p.chunkId)).toContain("chunk_amend_indemnity");
    expect(qa05.rubric.expectEvidenceState).toBe("partial");
    expect(NYAYA_AMENDMENT_WORKED_EXAMPLE).toMatch(/chunk_amend_indemnity/);
    expect(NYAYA_AMENDMENT_WORKED_EXAMPLE).toMatch(/How does the amendment change the indemnity obligation/);
    expect(NYAYA_AMENDMENT_WORKED_EXAMPLE).toMatch(/evidenceState=grounded/);
    expect(NYAYA_AMENDMENT_WORKED_EXAMPLE).toMatch(
      /Is the indemnity obligation fully settled in these excerpts/,
    );
    expect(NYAYA_AMENDMENT_WORKED_EXAMPLE).toMatch(/evidenceState=partial/);
    expect(NYAYA_FALSE_PREMISE_WORKED_EXAMPLE).not.toMatch(/indemnity/i);
    expect(NYAYA_FALSE_PREMISE_WORKED_EXAMPLE).not.toMatch(/chunk_amend_indemnity/);
  });

  it("stripping the amendment example fails indemnity-with-amendment but does not flip QA-05 off partial in this keyword probe", async () => {
    const stripped = buildNyayaSystemPrompt().replace(NYAYA_AMENDMENT_WORKED_EXAMPLE, "");
    const indemnity = await gradeCaseWithProbe(INDEMNITY_AMENDMENT_CASE_ID, stripped);
    const qa05 = await gradeCaseWithProbe(QA05_INDEMNITY_CASE_ID, stripped);
    const falseRent = await gradeCaseWithProbe(FALSE_RENT_CASE_ID, stripped);
    expect(indemnity.passed).toBe(false);
    expect(indemnity.evidenceState).toBe("insufficient");
    expect(qa05.evidenceState).toBe("partial");
    expect(qa05.passed).toBe(true);
    expect(falseRent.passed).toBe(true);
  });

  it("stripping the false-premise example keeps indemnity-with-amendment passing and leaves QA-05 partial", async () => {
    const stripped = buildNyayaSystemPrompt().replace(NYAYA_FALSE_PREMISE_WORKED_EXAMPLE, "");
    const indemnity = await gradeCaseWithProbe(INDEMNITY_AMENDMENT_CASE_ID, stripped);
    const qa05 = await gradeCaseWithProbe(QA05_INDEMNITY_CASE_ID, stripped);
    expect(indemnity.passed).toBe(true);
    expect(qa05.evidenceState).toBe("partial");
    expect(qa05.passed).toBe(true);
  });

  it("full v7 prompt probe-passes indemnity-with-amendment as grounded and QA-05 indemnity as partial", async () => {
    const indemnity = await gradeCaseWithProbe(INDEMNITY_AMENDMENT_CASE_ID);
    const qa05 = await gradeCaseWithProbe(QA05_INDEMNITY_CASE_ID);
    expect(indemnity.passed).toBe(true);
    expect(qa05.evidenceState).toBe("partial");
    expect(qa05.passed).toBe(true);
  });
});
