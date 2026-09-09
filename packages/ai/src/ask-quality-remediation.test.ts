import { describe, expect, it } from "vitest";
import {
  extractInTextProvisionRefs,
  formatGroundingSourceLine,
  selectOperativeProvisionRef,
} from "./document-structure";
import { assessRetrievedEvidenceDeterministic, constrainCitedAnswer } from "./evidence-assessment";
import { GRADED_CASES } from "./evals/graded-cases";
import { passagesByLabels } from "./evals/golden-matter";
import { rankByQuestionOverlap } from "./retrieval-rank";

function requireCase(id: string) {
  const found = GRADED_CASES.find((row) => row.id === id);
  if (!found) throw new Error(`missing case ${id}`);
  return found;
}

describe("document structure metadata", () => {
  it("extracts in-text section cross-references separately from chunk location", () => {
    const quote =
      "Either party may terminate this agreement by providing thirty (30) days written notice to the other party at the notice address listed in Section 15.";
    expect(extractInTextProvisionRefs(quote)).toEqual(["Section 15"]);
    const line = formatGroundingSourceLine({
      chunkId: "chunk_lease_notice",
      documentId: "doc_lease",
      documentVersionId: "docv_lease_1",
      page: 11,
      segmentRef: "§12.2",
      quote,
    });
    expect(line).toContain("segmentRef=§12.2");
    expect(line).toContain("inTextRefs=Section 15");
  });

  it("selects the in-text provision whose window matches the question topic", () => {
    const selected = selectOperativeProvisionRef(
      "Where must termination notice be sent under the lease?",
      passagesByLabels("termination_notice"),
    );
    expect(selected?.label).toBe("Section 15");
    expect(selected?.chunkId).toBe("chunk_lease_notice");
  });
});

describe("Ask quality remediation families", () => {
  it("establishes Section 15 as the notice-address provision identity", () => {
    const testCase = requireCase("golden-notice-section");
    const assessment = assessRetrievedEvidenceDeterministic(
      testCase.question,
      testCase.retrieved,
    );
    expect(assessment?.operativeTerm).toBe("Section 15");
    expect(assessment?.allowedClaim).toMatch(/Section 15/);
    const constrained = constrainCitedAnswer(
      {
        answer: "Notice must be sent to the other party at the notice address.",
        evidenceState: "grounded" as const,
        sources: [] as Array<{
          chunkId?: string;
          documentId: string;
          documentVersionId: string;
          quote: string;
        }>,
      },
      assessment!,
      testCase.retrieved,
    );
    expect(constrained.answer).toMatch(/Section 15/);
    expect(constrained.sources[0]?.chunkId).toBe("chunk_lease_notice");
  });

  it("surfaces both CAM transmittal dates instead of picking one", () => {
    const testCase = requireCase("golden-cam-date-conflict");
    const assessment = assessRetrievedEvidenceDeterministic(
      testCase.question,
      testCase.retrieved,
    );
    expect(assessment?.status).toBe("contradicted");
    expect(assessment?.allowedClaim).toMatch(/February 28, 2025/);
    expect(assessment?.allowedClaim).toMatch(/March 3, 2025/);
    const constrained = constrainCitedAnswer(
      {
        answer:
          "The retrieved sources conflict on the asked transmittal date: February 28, 2025 versus March 3, 2025.",
        evidenceState: "partial" as const,
        sources: [],
      },
      assessment!,
      testCase.retrieved,
    );
    expect(constrained.evidenceState).toBe("grounded");
    expect(constrained.answer).toMatch(/February 28, 2025/);
    expect(constrained.answer).toMatch(/March 3, 2025/);
  });

  it("does not invent the missing CAM side from one transmittal", () => {
    const testCase = requireCase("golden-cam-date-conflict-incomplete");
    const assessment = assessRetrievedEvidenceDeterministic(
      testCase.question,
      testCase.retrieved,
    );
    expect(assessment?.status === "contradicted").toBe(false);
    expect(JSON.stringify(assessment ?? {})).not.toMatch(/March 3, 2025/);
    expect(assessment?.operativeTerm).toBe("February 28, 2025");
    const constrained = constrainCitedAnswer(
      {
        answer:
          "The deposition says February 28, 2025, but another document says March 3, 2025.",
        evidenceState: "grounded" as const,
        sources: [],
      },
      assessment!,
      testCase.retrieved,
    );
    expect(constrained.answer).toMatch(/February 28, 2025/);
    expect(constrained.answer).not.toMatch(/March 3, 2025/);
  });

  it("corrects a near-miss commencement date using source date-role metadata", () => {
    const testCase = requireCase("golden-adv-near-miss-commencement");
    const assessment = assessRetrievedEvidenceDeterministic(
      testCase.question,
      testCase.retrieved,
    );
    expect(assessment?.operativeTerm).toBe("January 1, 2024");
    const constrained = constrainCitedAnswer(
      {
        answer: "Yes, the lease commenced on January 15, 2024.",
        evidenceState: "grounded" as const,
        sources: [],
      },
      assessment!,
      testCase.retrieved,
    );
    expect(constrained.answer).toMatch(/January 1, 2024/);
    expect(constrained.answer).not.toMatch(/commence on January 15, 2024/);
  });

  it("rewrites testimony-vs-log answers to evidentiary tension", () => {
    const testCase = requireCase("golden-evidentiary-tension-testimony-log");
    const assessment = assessRetrievedEvidenceDeterministic(
      testCase.question,
      testCase.retrieved,
    );
    expect(assessment?.operativeTerm).toBe("tension");
    const constrained = constrainCitedAnswer(
      {
        answer:
          "There is a genuine evidentiary tension: testimony denies entering the records room, and the access log records assigned-badge ACCESS GRANTED.",
        evidenceState: "partial" as const,
        sources: [],
      },
      assessment!,
      testCase.retrieved,
    );
    expect(constrained.evidenceState).toBe("grounded");
    expect(constrained.answer.toLowerCase()).toMatch(/tension/);
    expect(constrained.answer.toLowerCase()).not.toMatch(/difference of precision/);
    expect(constrained.answer.toLowerCase()).not.toMatch(/physically entered the records room/);
  });
});

describe("safety floor assessments remain abstaining or established as before", () => {
  it("keeps missing amendment insufficient", () => {
    const testCase = requireCase("golden-indemnity-missing-amendment");
    const assessment = assessRetrievedEvidenceDeterministic(
      testCase.question,
      testCase.retrieved,
    );
    expect(assessment?.status).toBe("insufficient");
  });

  it("keeps a named missing exhibit not established", () => {
    const testCase = requireCase("golden-named-exhibit-missing");
    const assessment = assessRetrievedEvidenceDeterministic(
      testCase.question,
      testCase.retrieved,
    );
    expect(assessment?.status).toBe("not_established");
  });

  it("keeps empty retrieval without a fabricated assessment", () => {
    const testCase = requireCase("golden-empty-retrieval");
    const assessment = assessRetrievedEvidenceDeterministic(
      testCase.question,
      testCase.retrieved,
    );
    expect(assessment).toBeNull();
  });

  it("keeps invoice silence from proving a universal negative", () => {
    const testCase = requireCase("golden-invoice-silence-not-proof");
    const assessment = assessRetrievedEvidenceDeterministic(
      testCase.question,
      testCase.retrieved,
    );
    expect(assessment?.status).toBe("not_established");
    expect(assessment?.prohibitedOverclaims.join(" ")).toMatch(/never issued/i);
  });

  it("refuses a judge or filing-number question when sources have no court identity", () => {
    const testCase = requireCase("golden-judge-not-in-record");
    const assessment = assessRetrievedEvidenceDeterministic(
      testCase.question,
      testCase.retrieved,
    );
    expect(assessment?.status).toBe("insufficient");
    expect(assessment?.allowedClaim).not.toMatch(/docket|Hon\./i);
    const constrained = constrainCitedAnswer(
      {
        answer: "Hon. Rivera is assigned; docket 24-CV-0188.",
        evidenceState: "grounded" as const,
        sources: [
          {
            chunkId: "chunk_lease_rent",
            documentId: "doc_lease",
            documentVersionId: "docv_lease_1",
            quote: testCase.retrieved[0]!.quote,
          },
        ],
      },
      assessment!,
      testCase.retrieved,
    );
    expect(constrained.evidenceState).toBe("insufficient");
    expect(constrained.answer).not.toMatch(/Hon\.|docket|Rivera|24-CV/i);
    expect(constrained.sources).toEqual([]);
  });

  it("does not abstain on court identity when a source names the judge", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "Which judge is assigned to this Case and what is the docket number?",
      [
        {
          chunkId: "chunk_order",
          documentId: "doc_order",
          documentVersionId: "docv_order_1",
          quote:
            "The Hon. Rivera, presiding judge, assigned this matter under docket number 24-CV-0188.",
        },
      ],
    );
    expect(assessment?.status).not.toBe("insufficient");
  });

  it("keeps a future-effective amendment from becoming the current term", () => {
    const testCase = requireCase("golden-future-effective-current-term");
    const assessment = assessRetrievedEvidenceDeterministic(
      testCase.question,
      testCase.retrieved,
      new Date("2026-09-01T12:00:00.000Z"),
    );
    expect(assessment?.operativeTerm).toBe("60 days");
    expect(assessment?.allowedClaim).toMatch(/not yet effective/i);
    expect(assessment?.prohibitedOverclaims.join(" ")).toMatch(/currently 45/);
  });
});

describe("date-role retrieval ranking", () => {
  it("ranks the commencement clause above a decoy that only shares the asked date", () => {
    const ranked = rankByQuestionOverlap("Did the lease commence on January 15, 2024?", [
      {
        chunkId: "decoy",
        quote: "Unsigned hold: proposed move-in remains January 15, 2024 pending countersignature.",
      },
      {
        chunkId: "term",
        quote: "The lease term commences on January 1, 2024 and expires on December 31, 2026.",
      },
    ]);
    expect(ranked[0]?.chunkId).toBe("term");
  });
});
