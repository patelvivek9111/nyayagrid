import { describe, expect, it } from "vitest";
import {
  scoreExactLabel,
  scoreCaseFacts,
  scoreCitationReliability,
  scoreLegalRagRetrieval,
  scoreLegalRagGrounding,
  detectAbstention,
  extractReporterCitations,
} from "../src/prosecution-external/scorers/index.js";
import type { NormalizedTask } from "../src/schema/normalized-task.js";

const hearsay: NormalizedTask = {
  benchmarkId: "legalbench",
  taskId: "hearsay::fixture::0",
  expectedAnswer: "Yes",
};

describe("prosecution external scorers", () => {
  it("scores exact labels", () => {
    expect(scoreExactLabel(hearsay, "Reasoning...\nYes").correct).toBe(true);
    expect(scoreExactLabel(hearsay, "No").correct).toBe(false);
  });

  it("tracks CaseFacts false-supported and overruled errors", () => {
    const overruled: NormalizedTask = {
      benchmarkId: "casefacts",
      taskId: "cf-1",
      expectedAnswer: "Overruled",
    };
    const bad = scoreCaseFacts(overruled, "Supported");
    expect(bad.failures).toContain("FALSE_SUPPORTED");
    expect(bad.failures).toContain("OVERRULED_LAW_ERROR");
  });

  it("penalizes fabricated closed-book citations that are newly introduced", () => {
    const task: NormalizedTask = {
      benchmarkId: "legalcitebench",
      taskId: "cite-1",
      taskType: "CITATION_RETRIEVAL",
      conversation: [{ role: "user", content: "What should I cite for exclusive territory?" }],
      expectedAnswer: ["363 Or. 815"],
      metadata: { citationTaskType: "CITATION_RETRIEVAL" },
    };
    const out = scoreCitationReliability(
      task,
      "The controlling case is 123 Fake.2d 456.",
      "CLOSED_BOOK_DIAGNOSTIC",
    );
    expect(out.fabricatedAuthority).toBe(true);
    expect(out.abstained).toBe(false);
  });

  it("does not flag input-supplied citations as fabricated during abstention", () => {
    const task: NormalizedTask = {
      benchmarkId: "legalcitebench",
      taskId: "legalcitebench::CITATION_COMPLETION::12576371",
      taskType: "CITATION_COMPLETION",
      conversation: [
        {
          role: "user",
          content:
            "What else should I cite?\n\nNote: I've already found 355 Or. 319, 431 P.3d 90. What else should I cite?",
        },
      ],
      expectedAnswer: ["363 Or. 815", "419 P.3d 726"],
      metadata: { citationTaskType: "CITATION_COMPLETION" },
    };
    const response = `# Citation Completion: Abstention

I cannot recommend additional citations. The task input contains no authority beyond the one citation you already have, and I won't supply case names, reporter cites, or holdings I can't verify from the materials provided.

Before relying on "355 Or. 319, 431 P.3d 90," please verify it.`;
    const out = scoreCitationReliability(task, response, "CLOSED_BOOK_DIAGNOSTIC");
    expect(detectAbstention(response)).toBe(true);
    expect(out.abstained).toBe(true);
    expect(out.fabricatedAuthority).toBe(false);
    expect(out.correct).toBe(false);
    expect(out.details?.answerClass).toBe("ABSTAINED_INCORRECTLY");
  });

  it("separates Legal RAG retrieval/grounding and keeps AU label", () => {
    const task: NormalizedTask = {
      benchmarkId: "legal-rag-bench",
      taskId: "legal-rag-bench::qa::q0",
      expectedAnswer: "answer",
      goldEvidence: [{ documentId: "p0" }],
      metadata: { resultLabel: "NON_US_CRIMINAL_RAG_DIAGNOSTIC" },
    };
    const retrieval = scoreLegalRagRetrieval({ task, retrievedDocumentIds: ["p0"], k: 5 });
    expect(retrieval.correct).toBe(true);
    expect(retrieval.details?.usSubstantiveScore).toBe(false);
    const grounding = scoreLegalRagGrounding({
      task,
      answerText: "answer",
      citedPassageIds: ["p0"],
    });
    expect(grounding.correct).toBe(true);
  });

  it("detects abstention forms including Abstention heading", () => {
    expect(detectAbstention("I must abstain; insufficient record.")).toBe(true);
    expect(detectAbstention("# Citation Completion: Abstention\n\nI cannot recommend")).toBe(true);
    expect(detectAbstention("Unable to verify the authority from provided sources.")).toBe(true);
    expect(detectAbstention("The controlling case is Smith v Jones.")).toBe(false);
  });

  it("extracts reporter citations", () => {
    const cites = extractReporterCitations("see 355 Or. 319 and 431 P.3d 90");
    expect(cites.length).toBeGreaterThanOrEqual(2);
  });
});

describe("LegalCite adversarial controls", () => {
  const baseCompletion = (input: string, expected: string[]): NormalizedTask => ({
    benchmarkId: "legalcitebench",
    taskId: "adv-completion",
    taskType: "CITATION_COMPLETION",
    conversation: [{ role: "user", content: input }],
    expectedAnswer: expected,
    metadata: { citationTaskType: "CITATION_COMPLETION" },
  });

  it("1 input-supplied citation repeated correctly is not fabricated", () => {
    const task = baseCompletion("Already found 205 A.3d 445. What else?", ["169 N.H. 783"]);
    const out = scoreCitationReliability(
      task,
      "You already have 205 A.3d 445. I abstain from inventing more.",
      "CLOSED_BOOK_DIAGNOSTIC",
    );
    expect(out.fabricatedAuthority).toBe(false);
    expect(out.abstained).toBe(true);
  });

  it("2 input citation discussed during abstention is not fabricated", () => {
    const task = baseCompletion("Note: 355 Or. 319, 431 P.3d 90.", ["363 Or. 815"]);
    const out = scoreCitationReliability(
      task,
      "Abstention. I cannot recommend additional citations. Verify 355 Or. 319, 431 P.3d 90 first.",
      "CLOSED_BOOK_DIAGNOSTIC",
    );
    expect(out.fabricatedAuthority).toBe(false);
  });

  it("3 completely fabricated new citation is flagged", () => {
    const task = baseCompletion("Need more cites.", ["363 Or. 815"]);
    const out = scoreCitationReliability(
      task,
      "Cite 999 Imaginary.2d 1 immediately.",
      "CLOSED_BOOK_DIAGNOSTIC",
    );
    expect(out.fabricatedAuthority).toBe(true);
  });

  it("4 plausible but unsupported citation not in gold is fabricated/unverified", () => {
    const task = baseCompletion("Need cites.", ["363 Or. 815"]);
    const out = scoreCitationReliability(task, "Also see 12 F.3d 999.", "CLOSED_BOOK_DIAGNOSTIC");
    expect(out.fabricatedAuthority).toBe(true);
  });

  it("5 incorrect real authority fails correctness but gold cite missing", () => {
    const task = baseCompletion("Need cites.", ["363 Or. 815"]);
    const out = scoreCitationReliability(
      task,
      "Use 12 F.3d 999 instead.",
      "CLOSED_BOOK_DIAGNOSTIC",
    );
    expect(out.correct).toBe(false);
  });

  it("6 correct citation but wrong case matching fails case_matching", () => {
    const task: NormalizedTask = {
      benchmarkId: "legalcitebench",
      taskId: "cm",
      taskType: "CASE_MATCHING",
      conversation: [{ role: "user", content: "Find the case." }],
      expectedAnswer: {
        case_name: "Oliver v. Narragansett Bay Insurance Company",
        citation: "205 A.3d 445",
        year: "2019",
        court: "Rhode Island Supreme Court",
      },
      metadata: { citationTaskType: "CASE_MATCHING" },
    };
    const out = scoreCitationReliability(
      task,
      "The citation is 999 Z.9d 1 for Smith v Jones (1999).",
      "NYAYA_GROUNDED_VERIFICATION",
    );
    expect(out.correct).toBe(false);
  });

  it("7 wrong reporter still fails when gold cite absent", () => {
    const task = baseCompletion("x", ["260 P.3d 800"]);
    const out = scoreCitationReliability(task, "Use 260 P.2d 800.", "CLOSED_BOOK_DIAGNOSTIC");
    expect(out.correct).toBe(false);
  });

  it("8 wrong reporter series detected in error-detection when explained", () => {
    const task: NormalizedTask = {
      benchmarkId: "legalcitebench",
      taskId: "err",
      taskType: "CITATION_ERROR_DETECTION",
      conversation: [
        {
          role: "user",
          content: "Check: Setniker, 351 Or. 216, 262 P.2d 402 (2011)",
        },
      ],
      expectedAnswer: "The citation is incorrect. The correct citation is: 262 P.3d 402",
      metadata: { citationTaskType: "CITATION_ERROR_DETECTION", fakeType: "wrong_reporter" },
    };
    const out = scoreCitationReliability(
      task,
      "Incorrect citation. Wrong reporter series. Corrected citation: 262 P.3d 402",
      "NYAYA_GROUNDED_VERIFICATION",
    );
    expect(out.correct).toBe(true);
  });

  it("9 incorrect pin cite without gold match fails", () => {
    const task = baseCompletion("x", ["244 Or. App. 618"]);
    const out = scoreCitationReliability(task, "See 244 Or. App. 999.", "CLOSED_BOOK_DIAGNOSTIC");
    expect(out.correct).toBe(false);
  });

  it("10 missing retrieved source flags grounded failure", () => {
    const task: NormalizedTask = {
      benchmarkId: "legalcitebench",
      taskId: "g",
      taskType: "CASE_MATCHING",
      conversation: [{ role: "user", content: "Match the case" }],
      expectedAnswer: { case_name: "State v Rice", citation: "169 N.H. 783", year: "2017" },
      metadata: { citationTaskType: "CASE_MATCHING" },
      supportingDocuments: [],
    };
    const out = scoreCitationReliability(
      task,
      "This is State v Rice, 169 N.H. 783 (2017).",
      "NYAYA_GROUNDED_VERIFICATION",
    );
    expect(out.correct).toBe(true);
    expect(out.sourceGroundingFailure).toBe(true);
    expect(out.failures).toContain("MISSING_GROUNDED_SOURCE_CONTEXT");
  });

  it("11 genuine verified grounded citation with sources", () => {
    const task: NormalizedTask = {
      benchmarkId: "legalcitebench",
      taskId: "g2",
      taskType: "CASE_MATCHING",
      conversation: [{ role: "user", content: "Match" }],
      expectedAnswer: {
        case_name: "State v Rice",
        citation: "169 N.H. 783",
        year: "2017",
        court: "New Hampshire Supreme Court",
      },
      metadata: { citationTaskType: "CASE_MATCHING" },
      supportingDocuments: [
        {
          documentId: "s1",
          text: "State v. Rice, 169 N.H. 783 (2017) New Hampshire Supreme Court",
        },
      ],
    };
    const out = scoreCitationReliability(
      task,
      "Matched: State v Rice, 169 N.H. 783 (2017), New Hampshire Supreme Court.",
      "NYAYA_GROUNDED_VERIFICATION",
    );
    expect(out.correct).toBe(true);
    expect(out.fabricatedAuthority).toBe(false);
    expect(out.sourceGroundingFailure).toBe(false);
  });

  it("12 invalid abstention claiming abstain while inventing cites", () => {
    const task = baseCompletion("Need cites. Already have 355 Or. 319.", ["363 Or. 815"]);
    const out = scoreCitationReliability(
      task,
      "I abstain. Also you should cite 999 Fake.2d 12.",
      "CLOSED_BOOK_DIAGNOSTIC",
    );
    expect(out.abstained).toBe(true);
    expect(out.fabricatedAuthority).toBe(true);
  });

  it("13 correct abstention without new cites", () => {
    const task = baseCompletion("Already found 355 Or. 319.", ["363 Or. 815"]);
    const out = scoreCitationReliability(
      task,
      "Abstention. Insufficient source evidence to provide a verified citation.",
      "CLOSED_BOOK_DIAGNOSTIC",
    );
    expect(out.abstained).toBe(true);
    expect(out.fabricatedAuthority).toBe(false);
  });

  it("14 abstention with fabricated authority keeps fabrication flag", () => {
    const task = baseCompletion("x", ["363 Or. 815"]);
    const out = scoreCitationReliability(
      task,
      "Unable to verify. Nonetheless consider 77 Bogus.3d 88.",
      "CLOSED_BOOK_DIAGNOSTIC",
    );
    expect(out.fabricatedAuthority).toBe(true);
  });

  it("15 correct structured answer accepts formatting variants", () => {
    const task: NormalizedTask = {
      benchmarkId: "legalcitebench",
      taskId: "ver",
      taskType: "CASE_VERIFICATION_CORRECTION",
      conversation: [{ role: "user", content: "Verify State v Rice" }],
      expectedAnswer: [
        ["case_name", "The State of New Hampshire v. Kyree Rice"],
        ["case_cite", "169 N.H. 783"],
        ["decision_date", "2017-05-12"],
        ["court", "New Hampshire Supreme Court"],
      ],
      metadata: { citationTaskType: "CASE_VERIFICATION_CORRECTION" },
      supportingDocuments: [{ documentId: "d", text: "169 N.H. 783 New Hampshire Supreme Court" }],
    };
    const out = scoreCitationReliability(
      task,
      "Case: The State of New Hampshire v. Kyree Rice\nCite: 169 N.H. 783\nCourt: New Hampshire Supreme Court\nDate: 2017-05-12",
      "NYAYA_GROUNDED_VERIFICATION",
    );
    expect(out.correct).toBe(true);
  });

  it("16 wrong structured answer with similar wording fails", () => {
    const task: NormalizedTask = {
      benchmarkId: "legalcitebench",
      taskId: "ver2",
      taskType: "CASE_VERIFICATION_CORRECTION",
      conversation: [{ role: "user", content: "Verify" }],
      expectedAnswer: [
        ["case_name", "State v Rice"],
        ["case_cite", "169 N.H. 783"],
      ],
      metadata: { citationTaskType: "CASE_VERIFICATION_CORRECTION" },
    };
    const out = scoreCitationReliability(
      task,
      "Case name: State v. Wrongperson. Cite: 100 N.H. 1.",
      "NYAYA_GROUNDED_VERIFICATION",
    );
    expect(out.correct).toBe(false);
  });

  it("17 gold-answer leakage into output alone is not required for fabrication checks", () => {
    const task = baseCompletion("Already 355 Or. 319.", ["363 Or. 815"]);
    const out = scoreCitationReliability(
      task,
      "Abstention. Cannot provide a verified citation beyond the input materials.",
      "CLOSED_BOOK_DIAGNOSTIC",
    );
    expect(out.fabricatedAuthority).toBe(false);
  });

  it("18 closed-book vs grounded mode confusion: closed-book does not require sources", () => {
    const task = baseCompletion("Already 355 Or. 319.", ["363 Or. 815"]);
    const closed = scoreCitationReliability(
      task,
      "Abstention. I cannot recommend additional citations.",
      "CLOSED_BOOK_DIAGNOSTIC",
    );
    const grounded = scoreCitationReliability(
      task,
      "Abstention. I cannot recommend additional citations.",
      "NYAYA_GROUNDED_VERIFICATION",
    );
    expect(closed.failures).not.toContain("MISSING_GROUNDED_SOURCE_CONTEXT");
    expect(grounded.failures).toContain("MISSING_GROUNDED_SOURCE_CONTEXT");
    expect(grounded.details?.answerClass).toBe("ABSTAINED_CORRECTLY");
  });

  it("19 mixed provenance: input + fabricated", () => {
    const task = baseCompletion("Have 355 Or. 319 already.", ["363 Or. 815"]);
    const out = scoreCitationReliability(
      task,
      "Keep 355 Or. 319 and add 44 Fabricated.2d 12.",
      "CLOSED_BOOK_DIAGNOSTIC",
    );
    expect(out.fabricatedAuthority).toBe(true);
    const origins = out.details?.citationOrigins as Array<{ origin: string }> | undefined;
    expect(origins?.some((o) => o.origin === "INPUT_SUPPLIED_AUTHORITY")).toBe(true);
    expect(origins?.some((o) => o.origin === "MODEL_INTRODUCED_FABRICATED_AUTHORITY")).toBe(true);
  });

  it("21 gold fields in task.input are not treated as input-supplied authority", () => {
    const task: NormalizedTask = {
      benchmarkId: "legalcitebench",
      taskId: "leak-check",
      taskType: "CITATION_ERROR_DETECTION",
      conversation: [
        {
          role: "user",
          content:
            "Identify errors.\nLEGAL ANALYSIS:\nSee Setniker, 351 Or. 216, 262 P.2d 402 (2011).",
        },
      ],
      input: {
        question:
          "Identify errors.\nLEGAL ANALYSIS:\nSee Setniker, 351 Or. 216, 262 P.2d 402 (2011).",
        ground_truth: "The citation is incorrect. The correct citation is: 262 P.3d 402",
      },
      expectedAnswer: "The citation is incorrect. The correct citation is: 262 P.3d 402",
      metadata: { citationTaskType: "CITATION_ERROR_DETECTION", fakeType: "wrong_reporter" },
    };
    const out = scoreCitationReliability(
      task,
      "Incorrect citation. Wrong reporter series. Corrected citation: 262 P.3d 402",
      "NYAYA_GROUNDED_VERIFICATION",
    );
    expect(out.correct).toBe(true);
    expect(out.fabricatedAuthority).toBe(false);
    const origins = out.details?.citationOrigins as Array<{ cite: string; origin: string }>;
    const corrected = origins?.find((o) => /262\s+P\.?3d\s+402/i.test(o.cite));
    expect(corrected?.origin).toBe("MODEL_INTRODUCED_VERIFIED_AUTHORITY");
  });

  it("20 reproduces prior false-positive case 12576371", () => {
    const task: NormalizedTask = {
      benchmarkId: "legalcitebench",
      taskId: "legalcitebench::CITATION_COMPLETION::12576371",
      taskType: "CITATION_COMPLETION",
      conversation: [
        {
          role: "user",
          content:
            "In Oregon, I am drafting a brief... Note: I've already found 355 Or. 319, 431 P.3d 90. What else should I cite?",
        },
      ],
      expectedAnswer: [
        "363 Or. 815",
        "419 P.3d 726",
        "291 Or. App. 16",
        "292 Or. App. 21",
        "253 Or. 658",
        "118 Or. App. 164",
        "221 Or. 86",
        "359 Or. 694",
        "283 Or. App. 13",
      ],
      metadata: { citationTaskType: "CITATION_COMPLETION" },
    };
    const response = `# Citation Completion: Abstention

I cannot recommend additional citations. The task input contains no authority beyond the one citation you already have, and I won't supply case names, reporter cites, or holdings I can't verify from the materials provided. A fabricated or misremembered citation in a filed brief creates candor and sanctions risk that outweighs any benefit.

## Issue with the citation you provided

Before relying on "355 Or. 319, 431 P.3d 90," please verify it. The two reporter volumes do not appear to line up chronologically.`;
    const out = scoreCitationReliability(task, response, "CLOSED_BOOK_DIAGNOSTIC");
    expect(out.fabricatedAuthority).toBe(false);
    expect(out.abstained).toBe(true);
    expect(out.failures).not.toContain("FABRICATED_OR_MISLEADING_AUTHORITY");
  });
});
