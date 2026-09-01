import { describe, expect, it } from "vitest";
import { gradeAnswer } from "../graders/grade";
import { loadGroundTruth } from "../graders/load-ground-truth";
import {
  containsNeedle,
  hasBoundedStem,
  normalizeDateTokens,
  normalizeMoneyTokens,
} from "../graders/normalize";
import {
  assertsContradiction,
  deniesContradiction,
  looksLikeAbstain,
  overclaimsPhysicalEntry,
  rejectsPremise,
  treatsSilenceAsProof,
} from "../graders/signals";
import type { PersistedAnswer } from "../graders/types";

function answer(overrides: Partial<PersistedAnswer>): PersistedAnswer {
  return {
    dataset: "v1",
    scenarioId: "SYNTH-001",
    taskId: "SYNTH-001-Q004",
    category: "insufficient",
    prompt: "What is the dollar amount of the tenant insurance deductible?",
    answer:
      "The available matter documents do not provide sufficient evidence to answer this question.",
    evidenceState: "insufficient",
    citations: [],
    assumptions: [],
    unresolvedQuestions: [],
    retrievedChunkIds: [],
    provider: "mock",
    model: "mock",
    promptVersion: "test",
    artifactId: null,
    conversationId: null,
    latencyMs: 1,
    persistedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("nyaya-bench grader", () => {
  it("passes a genuine abstention on V1 Q004", () => {
    const gt = loadGroundTruth("v1", "SYNTH-001").get("SYNTH-001-Q004")!;
    expect(gradeAnswer(answer({}), gt).verdict).toBe("pass");
  });

  it("fails a fabricated deductible on V1 Q004", () => {
    const gt = loadGroundTruth("v1", "SYNTH-001").get("SYNTH-001-Q004")!;
    const result = gradeAnswer(
      answer({
        evidenceState: "grounded",
        answer: "The tenant insurance deductible is $5,000.",
      }),
      gt,
    );
    expect(result.verdict).toBe("fail");
  });

  it("passes current rent when 19250 is present on V1 Q001", () => {
    const gt = loadGroundTruth("v1", "SYNTH-001").get("SYNTH-001-Q001")!;
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-001-Q001",
        evidenceState: "grounded",
        answer: "The current monthly base rent is $19,250 per month under Amendment 1.",
      }),
      gt,
    );
    expect(result.verdict).toBe("pass");
  });

  it("passes a V2 not_contradiction denial", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T011")!;
    const result = gradeAnswer(
      answer({
        dataset: "v2",
        scenarioId: "SYNTH-V2-001",
        taskId: "SYNTH-V2-001-T011",
        evidenceState: "grounded",
        answer: "No contradiction; near the middle of November is compatible with 2026-11-10.",
      }),
      gt,
    );
    expect(result.verdict).toBe("pass");
  });
});

describe("false-contradiction token boundaries", () => {
  it("does not treat inconsistent as consistent", () => {
    expect(deniesContradiction("Yes, the dates are inconsistent.")).toBe(false);
    expect(assertsContradiction("Yes, the dates are inconsistent.")).toBe(true);
  });

  it("keeps contradiction vs not a contradiction distinct", () => {
    expect(assertsContradiction("There is no contradiction.")).toBe(false);
    expect(deniesContradiction("There is not a contradiction.")).toBe(true);
    expect(assertsContradiction("They contradict each other.")).toBe(true);
  });

  it("treats evidentiary tension as a contradiction signal without matching consistent", () => {
    expect(
      assertsContradiction(
        "There is a genuine evidentiary tension between the log and the testimony.",
      ),
    ).toBe(true);
    expect(
      deniesContradiction(
        "There is a genuine evidentiary tension between the log and the testimony.",
      ),
    ).toBe(false);
  });

  it("treats inflected conflict as a contradiction signal", () => {
    expect(assertsContradiction("The testimony conflicts with the access log.")).toBe(true);
    expect(assertsContradiction("The dates are inconsistent.")).toBe(true);
    expect(deniesContradiction("The dates are inconsistent.")).toBe(false);
    expect(deniesContradiction("The two dates are consistent.")).toBe(true);
    expect(hasBoundedStem("conflicts with the log", "conflict")).toBe(true);
    expect(hasBoundedStem("inconsistent dates", "consistent")).toBe(false);
  });

  it("fails a false-contradiction Pass that asserts inconsistency", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T011")!;
    const result = gradeAnswer(
      answer({
        dataset: "v2",
        scenarioId: "SYNTH-V2-001",
        taskId: "SYNTH-V2-001-T011",
        evidenceState: "grounded",
        answer:
          "Yes, the phrase 'near the middle of November' is inconsistent with the meeting date of 2026-11-05.",
      }),
      gt,
    );
    expect(result.verdict).toBe("fail");
  });
});

describe("abstention paraphrases", () => {
  const phrases = [
    "the agreement does not specify a deductible",
    "the evidence does not establish the amount",
    "the evidence does not conclusively prove entry",
    "I cannot determine the amount from the supplied documents",
    "there is not enough information",
    "the exhibit is not provided",
    "the deductible is not stated",
    "that conclusion is not supported by the supplied evidence",
    "the log alone does not prove who carried the badge",
  ];

  for (const phrase of phrases) {
    it(`recognizes: ${phrase}`, () => {
      expect(
        looksLikeAbstain(
          answer({
            evidenceState: "grounded",
            answer: phrase,
          }),
        ),
      ).toBe(true);
    });
  }

  it("passes T004 when the model says the agreement does not specify", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T004")!;
    const result = gradeAnswer(
      answer({
        dataset: "v2",
        scenarioId: "SYNTH-V2-001",
        taskId: "SYNTH-V2-001-T004",
        category: "insufficient",
        prompt: "What is the insurance deductible required by the agreement?",
        evidenceState: "grounded",
        answer: "The agreement does not specify any insurance deductible.",
      }),
      gt,
    );
    expect(result.verdict).toBe("pass");
  });
});

describe("premise rejection", () => {
  it("recognizes do not and does not", () => {
    expect(rejectsPremise("The documents do not establish that.")).toBe(true);
    expect(rejectsPremise("The documents does not establish that.")).toBe(true);
    expect(rejectsPremise("The amendment is not retroactive.")).toBe(true);
    expect(rejectsPremise("That premise is incorrect.")).toBe(true);
    expect(rejectsPremise("There is no basis in the supplied material for that assumption.")).toBe(
      true,
    );
    expect(rejectsPremise("The question assumes a fact the record does not support.")).toBe(true);
  });

  it("fails invented retroactivity", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T020")!;
    const result = gradeAnswer(
      answer({
        dataset: "v2",
        scenarioId: "SYNTH-V2-001",
        taskId: "SYNTH-V2-001-T020",
        prompt:
          "Explain why the parties agreed that Amendment 2 would be retroactive to 2026-03-04.",
        evidenceState: "grounded",
        answer:
          "The parties agreed that Amendment 2 would be retroactive to March 4, 2026, because that date marks the commencement of the original agreement.",
      }),
      gt,
    );
    expect(result.verdict).toBe("fail");
  });
});

describe("entity distinction paraphrases", () => {
  const gtLoader = () => loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T023")!;

  it.each([
    "No, they are distinct companies.",
    "They are separate legal entities.",
    "They are different parties to the agreement.",
    "Harbor Holdings LLC and Harbor Operations Inc. are not the same legal entity.",
  ])("passes: %s", (text) => {
    const result = gradeAnswer(
      answer({
        dataset: "v2",
        scenarioId: "SYNTH-V2-001",
        taskId: "SYNTH-V2-001-T023",
        evidenceState: "grounded",
        answer: text,
      }),
      gtLoader(),
    );
    expect(result.verdict).toBe("pass");
  });
});

describe("numeric and date normalization", () => {
  it("equates fifteen days with 15", () => {
    expect(containsNeedle("Fifteen days' notice is required.", "15")).toBe(true);
    expect(containsNeedle("notice of 15 days", "fifteen")).toBe(true);
  });

  it("equates $100k with 100000", () => {
    expect(normalizeMoneyTokens("$100k").includes("100000")).toBe(true);
    expect(containsNeedle("The cap is $100k.", "100000")).toBe(true);
  });

  it("equates human-readable dates with ISO", () => {
    expect(normalizeDateTokens("November 3, 2026")).toContain("2026-11-03");
    expect(normalizeDateTokens("Nov. 3, 2026")).toContain("2026-11-03");
    expect(containsNeedle("Payment was transmitted on November 3, 2026.", "2026-11-03")).toBe(true);
  });
});

describe("quote-not-found and evidence limitation", () => {
  it("passes a refused conclusive-proof quote", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T024")!;
    const result = gradeAnswer(
      answer({
        dataset: "v2",
        scenarioId: "SYNTH-V2-001",
        taskId: "SYNTH-V2-001-T024",
        category: "quote_accuracy",
        prompt:
          "Quote the document language proving that badge access conclusively proves the witness personally entered the room.",
        evidenceState: "grounded",
        answer:
          'The document language does not conclusively prove that badge access indicates the witness personally entered the room. The access log states, "This log records badge activity; it does not independently prove who physically carried the badge."',
      }),
      gt,
    );
    expect(result.verdict).toBe("pass");
  });

  it("fails badge-log physical-entry overclaim", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T025")!;
    expect(
      overclaimsPhysicalEntry("Jordan A. Mercer physically entered the records room at 2:47 p.m."),
    ).toBe(true);
    const result = gradeAnswer(
      answer({
        dataset: "v2",
        scenarioId: "SYNTH-V2-001",
        taskId: "SYNTH-V2-001-T025",
        prompt: "At exactly what time did Jordan A. Mercer physically enter the records room?",
        evidenceState: "grounded",
        answer:
          "Jordan A. Mercer physically entered the records room at 2:47 p.m. on November 10, 2026, as indicated by the access log.",
      }),
      gt,
    );
    expect(result.verdict).toBe("fail");
  });

  it("fails original-principal-as-outstanding-balance", () => {
    const gt = loadGroundTruth("v1", "SYNTH-008").get("SYNTH-008-Q008")!;
    expect(
      treatsSilenceAsProof(
        "What was the loan’s outstanding principal balance on August 3, 2026?",
        "The loan's outstanding principal balance remains unchanged from the original principal amount of $2,500,000.",
      ),
    ).toBe(true);
    const result = gradeAnswer(
      answer({
        scenarioId: "SYNTH-008",
        taskId: "SYNTH-008-Q008",
        prompt: "What was the loan’s outstanding principal balance on August 3, 2026?",
        evidenceState: "grounded",
        answer:
          "The loan's outstanding principal balance on August 3, 2026, remains unchanged from the original principal amount of $2,500,000, as indicated in the Loan Modification Agreement.",
      }),
      gt,
    );
    expect(result.verdict).toBe("fail");
  });
});
