import { describe, expect, it } from "vitest";
import {
  classifyEvidenceRelation,
  findDeterministicContradictionCandidates,
  infersPhysicalActorFromCredential,
  refineContradictionCandidates,
  refineDepositionFindingClass,
  selectChunksForContradictionAnalysis,
} from "./contradiction-semantics";
import type { ProfessionalChunk } from "./professional";

function chunk(
  chunkId: string,
  documentId: string,
  content: string,
): ProfessionalChunk {
  return {
    chunkId,
    documentId,
    documentVersionId: `${documentId}-v1`,
    page: 1,
    content,
  };
}

describe("contradiction semantic states", () => {
  it("classifies a genuine direct contradiction", () => {
    expect(
      classifyEvidenceRelation("I entered the room at 3 PM.", "I did not enter the room that day."),
    ).toBe("contradiction");
  });

  it("classifies credential activity versus physical denial as tension, not contradiction", () => {
    expect(
      classifyEvidenceRelation(
        "A. No. I never entered the records room on that date.",
        "14:47 - Badge assigned to the witness - Records Room - ACCESS GRANTED.",
      ),
    ).toBe("tension");
  });

  it("does not treat credential activity as proof of physical entry", () => {
    expect(
      infersPhysicalActorFromCredential(
        "The access log proves the witness physically entered the records room.",
      ),
    ).toBe(true);
    expect(
      infersPhysicalActorFromCredential(
        "A badge assigned to the witness recorded ACCESS GRANTED. Recorded credential activity does not independently prove who physically performed the corresponding act.",
      ),
    ).toBe(false);
  });

  it("treats approximate mid-month language as compatible with an exact date in that month", () => {
    expect(
      classifyEvidenceRelation(
        "The meeting happened near the middle of November.",
        "The meeting occurred on 2026-11-10.",
      ),
    ).toBe("compatible");
  });

  it("does not treat sequential contract terms as a contradiction", () => {
    expect(
      classifyEvidenceRelation(
        "The original agreement requires 60 days written notice unless amended.",
        "Amendment 1 is effective on a later date and now requires 30 days written notice.",
      ),
    ).toBe("compatible");
  });

  it("does not treat contract execution language as a physical-entry contradiction", () => {
    expect(
      classifyEvidenceRelation(
        "This agreement is entered as of 2026-03-04 between the parties.",
        "A. No. I never entered the records room on 2026-11-10. The discussion was near the middle of November.",
      ),
    ).toBe("insufficient");
  });

  it("still finds tension when the testimony chunk also contains a compatible approximate date", () => {
    expect(
      classifyEvidenceRelation(
        "A. No. I never entered the records room on 2026-11-10. Q. When was the pricing issue discussed? A. Near the middle of November, at the review meeting.",
        "2026-11-10 14:47 - Badge assigned to the witness - Records Room - ACCESS GRANTED.",
      ),
    ).toBe("tension");
  });

  it("does not treat different named actors as a contradiction involving the first person", () => {
    expect(
      classifyEvidenceRelation(
        "Alice Nguyen testified: I never entered the records room.",
        "Badge assigned to Robert Chen — Records Room — ACCESS GRANTED.",
      ),
    ).toBe("insufficient");
  });
});

describe("contradiction candidate selection and filters", () => {
  it("keeps high-signal testimony and access-log chunks instead of filler", () => {
    const filler = Array.from({ length: 40 }, (_, i) =>
      chunk(
        `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        "doc_contract",
        "General provision. Headings are for convenience only. Administrative renumbering.",
      ),
    );
    const testimony = chunk(
      "11111111-1111-4111-8111-111111111111",
      "doc_depo",
      "A. No. I never entered the records room that day.",
    );
    const log = chunk(
      "22222222-2222-4222-8222-222222222222",
      "doc_log",
      "Badge assigned to the witness — Records Room — ACCESS GRANTED.",
    );
    const selected = selectChunksForContradictionAnalysis([...filler, testimony, log], 8);
    const ids = selected.map((item) => item.chunkId);
    expect(ids).toContain(testimony.chunkId);
    expect(ids).toContain(log.chunkId);
  });

  it("emits a tension candidate for testimony versus assigned-badge activity", () => {
    const candidates = findDeterministicContradictionCandidates([
      chunk(
        "11111111-1111-4111-8111-111111111111",
        "doc_depo",
        "A. I never entered the records room.",
      ),
      chunk(
        "22222222-2222-4222-8222-222222222222",
        "doc_log",
        "Badge assigned to the witness — Records Room — ACCESS GRANTED.",
      ),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.relation).toBe("tension");
    expect(candidates[0]?.explanation).toMatch(/does not independently prove who/i);
  });

  it("rewrites actor-overclaim summaries on tension candidates", () => {
    const textA = "A. I never entered the records room.";
    const textB = "Badge assigned to the witness — ACCESS GRANTED.";
    const refined = refineContradictionCandidates(
      [
        {
          title: "Witness entered",
          explanation: "The access log proves the witness physically entered the room.",
          confidence: "medium",
          relation: "contradiction",
          sideA: { chunkIds: ["a"], summary: "The witness physically entered the records room." },
          sideB: { chunkIds: ["b"], summary: textB },
        },
      ],
      new Map([
        ["a", textA],
        ["b", textB],
      ]),
    );
    expect(refined).toHaveLength(1);
    expect(refined[0]?.relation).toBe("tension");
    expect(infersPhysicalActorFromCredential(refined[0]!.explanation)).toBe(false);
    expect(infersPhysicalActorFromCredential(refined[0]!.sideA.summary)).toBe(false);
  });

  it("rejects a candidate that cites the same chunk on both sides", () => {
    const refined = refineContradictionCandidates(
      [
        {
          title: "Internal invoice dispute",
          explanation: "Due date versus remittance date.",
          confidence: "medium",
          relation: "contradiction",
          sideA: { chunkIds: ["same"], summary: "Due 2026-10-31." },
          sideB: { chunkIds: ["same"], summary: "Transmitted 2026-11-03." },
        },
      ],
      new Map([
        [
          "same",
          "Invoice due 2026-10-31. Bank remittance record shows payment transmitted on 2026-11-03.",
        ],
      ]),
    );
    expect(refined).toHaveLength(0);
  });

  it("rejects a candidate that is missing source text on a side", () => {
    const refined = refineContradictionCandidates(
      [
        {
          title: "Conflict",
          explanation: "One side is unsourced.",
          confidence: "medium",
          relation: "contradiction",
          sideA: { chunkIds: ["a"], summary: "I entered." },
          sideB: { chunkIds: ["missing"], summary: "I did not enter." },
        },
      ],
      new Map([["a", "I entered."]]),
    );
    expect(refined).toHaveLength(0);
  });

  it("drops sequential amendment notice-period pairs", () => {
    const refined = refineContradictionCandidates(
      [
        {
          title: "Notice period conflict",
          explanation: "60 days versus 30 days after the amendment.",
          confidence: "high",
          relation: "contradiction",
          sideA: { chunkIds: ["a"], summary: "requires 60 days" },
          sideB: { chunkIds: ["b"], summary: "now requires 30 days" },
        },
      ],
      new Map([
        ["a", "The original agreement requires 60 days written notice unless amended."],
        ["b", "Amendment 1 deleted and replaced the clause and now requires 30 days written notice."],
      ]),
    );
    expect(refined).toHaveLength(0);
  });

  it("flags conflicting cure periods even when one notice quotes the other period", () => {
    const noticeA =
      "DEFAULT NOTICE. You have thirty (30) days from this notice to cure by delivering Lot TX-17. Signed Camille Ortiz.";
    const noticeB =
      "DEFAULT NOTICE. You have ten (10) days from this notice to cure by delivering Lot TX-17. Signed Jordan Phelps. Notice A and Notice B conflict on the cure period (thirty days versus ten days).";
    expect(classifyEvidenceRelation(noticeA, noticeB)).toBe("contradiction");
    const found = findDeterministicContradictionCandidates([
      chunk("a", "doc_a", noticeA),
      chunk("b", "doc_b", noticeB),
    ]);
    expect(found.some((row) => /10/.test(row.explanation) && /30/.test(row.explanation))).toBe(true);
    const refined = refineContradictionCandidates(
      found,
      new Map([
        ["a", noticeA],
        ["b", noticeB],
      ]),
    );
    expect(refined.length).toBeGreaterThan(0);
  });

  it("demotes vault-swipe ACCESS GRANTED versus a physical-entry denial to tension", () => {
    const refined = refineDepositionFindingClass({
      findingType: "inconsistency",
      title: "Witness's vault entry versus swipe log",
      explanation:
        "The witness stated they never entered the vault on 2026-03-04, while the swipe log indicates ACCESS GRANTED for a badge assigned to them.",
      supportingQuotes: [
        "A. I never entered the vault on 2026-03-04.",
        "2026-03-04 11:03 - Badge PH-441 assigned to Priya Shah - Vault - ACCESS GRANTED.",
      ],
    });
    expect(refined.findingType).toBe("tension");
    expect(refined.title.toLowerCase()).not.toMatch(/contradiction|inconsistency/);
    expect(refined.explanation ?? "").toMatch(/does not independently prove who/i);
  });

  it("demotes a Texas login record versus a California denial without using original bench wording", () => {
    const refined = refineDepositionFindingClass({
      findingType: "direct_contradiction",
      title: "Login activity versus testimony",
      explanation: "Morgan Hale denied entering Dock B. The account activity recorded login successful.",
      supportingQuotes: [
        "A. I never entered Dock B that morning.",
        "Account activity: credential assigned to Morgan Hale — login successful at Dock B.",
      ],
    });
    expect(refined.findingType).toBe("tension");
  });

  it("keeps two sworn physical-entry statements as inconsistency", () => {
    const refined = refineDepositionFindingClass({
      findingType: "inconsistency",
      title: "Conflicting sworn entry testimony",
      explanation: "One witness testified they entered the conference room; the other testified they did not enter.",
      supportingQuotes: [
        "A. I entered the conference room at 3 p.m.",
        "A. I did not enter the conference room that day.",
      ],
    });
    expect(refined.findingType).toBe("inconsistency");
  });

  it("flags a termination notice that uses a superseded day period against the amendment", () => {
    const notice =
      "NOTICE OF TERMINATION. Willowbrook hereby terminates the agreement. This notice cites the original clause and is effective forty-five (45) days after this notice.";
    const amendment =
      "AMENDMENT NO. 1. Section 3 is deleted and replaced: terminate for convenience by written notice at least sixty (60) days before the termination effective date.";
    expect(classifyEvidenceRelation(notice, amendment)).toBe("contradiction");
  });
});
