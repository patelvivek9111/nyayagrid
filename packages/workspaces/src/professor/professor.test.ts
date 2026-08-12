import { describe, expect, it } from "vitest";
import {
  STUDENT_READABLE_TABLES,
  WORKSPACE_FORBIDDEN_TABLES,
  assertStudentHitsOwnedBy,
  assertStudentQueryIsIsolated,
  type StudentChunkHit,
} from "./isolation";
import { StudentAccessError, assertOwnedByUser, isOwnedByUser } from "./auth";
import { detectOpinionPartHeading, labelSegmentsWithOpinionParts } from "./ingest";
import { validateCaseBrief, verbatimExcerpt } from "./briefs";
import { validateCaseComparison } from "./compare";
import {
  NO_AUTHORITY_LIMITATION,
  NO_STUDENT_SOURCES_ANSWER,
  buildProfessorRetrievalIndex,
  validateProfessorAnswer,
} from "./conversations";
import type { StudentCasePassage } from "./cases";

const STUDENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_STUDENT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CASE_A_ID = "11111111-1111-1111-1111-111111111111";
const CASE_B_ID = "1b1b1b1b-1b1b-1b1b-1b1b-1b1b1b1b1b1b";
const VERSION_A_ID = "22222222-2222-2222-2222-222222222222";
const VERSION_B_ID = "2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b2b2b";
const MAJORITY_CHUNK = "33333333-3333-3333-3333-333333333333";
const DISSENT_CHUNK = "44444444-4444-4444-4444-444444444444";
const UNKNOWN_CHUNK = "55555555-5555-5555-5555-555555555555";
const CASE_B_CHUNK = "66666666-6666-6666-6666-666666666666";
const AUTHORITY_ID = "77777777-7777-7777-7777-777777777777";
const AUTHORITY_CHUNK = "88888888-8888-8888-8888-888888888888";

const MAJORITY_TEXT =
  "The tenant remained in possession after the notice period expired, and the court concluded that the lease had not been terminated.";
const DISSENT_TEXT =
  "In my view the notice was effective on the day it was mailed, so requiring actual receipt reads a term into the lease.";
const AUTHORITY_TEXT =
  "A notice to quit is effective upon actual receipt by the tenant unless the lease provides otherwise.";

function passage(overrides: Partial<StudentCasePassage> & { chunkId: string }): StudentCasePassage {
  return {
    caseId: CASE_A_ID,
    caseVersionId: VERSION_A_ID,
    chunkIndex: 0,
    content: MAJORITY_TEXT,
    pageStart: 1,
    opinionPart: null,
    ...overrides,
  };
}

function hit(overrides: Partial<StudentChunkHit> & { chunkId: string }): StudentChunkHit {
  return {
    caseId: CASE_A_ID,
    caseVersionId: VERSION_A_ID,
    userId: STUDENT_ID,
    content: MAJORITY_TEXT,
    score: 0.9,
    pageStart: 1,
    opinionPart: null,
    ...overrides,
  };
}

describe("workspace isolation", () => {
  it("keeps the student-readable and forbidden table lists disjoint", () => {
    const forbidden = new Set<string>(WORKSPACE_FORBIDDEN_TABLES);
    for (const table of STUDENT_READABLE_TABLES) {
      expect(forbidden.has(table)).toBe(false);
    }
  });

  it("accepts a student query over student tables and the shared authority corpus", () => {
    expect(() =>
      assertStudentQueryIsIsolated(
        "student_search",
        "FROM student_case_chunks c JOIN student_cases k ON k.id = c.case_id",
      ),
    ).not.toThrow();
    expect(() =>
      assertStudentQueryIsIsolated(
        "authority_search",
        "FROM legal_authority_chunks c JOIN legal_authorities a ON a.id = c.authority_id",
      ),
    ).not.toThrow();
  });

  it("rejects any student query that reaches into professional or cross-workspace tables", () => {
    expect(() =>
      assertStudentQueryIsIsolated("leak", "FROM document_chunks WHERE matter_id = $1"),
    ).toThrow(/document_chunks/);
    expect(() =>
      assertStudentQueryIsIsolated(
        "leak",
        "FROM student_case_chunks c JOIN public.matters m ON m.id = c.case_id",
      ),
    ).toThrow(/matters/);
    expect(() => assertStudentQueryIsIsolated("leak", "FROM guide_document_chunks")).toThrow(
      /guide_document_chunks/,
    );
  });

  it("rejects results that cross the user boundary or carry professional identifiers", () => {
    expect(() =>
      assertStudentHitsOwnedBy([hit({ chunkId: MAJORITY_CHUNK })], STUDENT_ID),
    ).not.toThrow();
    expect(() =>
      assertStudentHitsOwnedBy(
        [hit({ chunkId: MAJORITY_CHUNK, userId: OTHER_STUDENT_ID })],
        STUDENT_ID,
      ),
    ).toThrow(/user boundary/);
    expect(() =>
      assertStudentHitsOwnedBy(
        [{ ...hit({ chunkId: MAJORITY_CHUNK }), matterId: "matter-1" } as StudentChunkHit],
        STUDENT_ID,
      ),
    ).toThrow(/matterId/);
    expect(() =>
      assertStudentHitsOwnedBy([{ ...hit({ chunkId: MAJORITY_CHUNK }), caseId: "" }], STUDENT_ID),
    ).toThrow(/provenance/);
  });
});

describe("ownership helpers", () => {
  it("treats a row owned by another user the same as a missing row", () => {
    expect(isOwnedByUser({ userId: STUDENT_ID }, STUDENT_ID)).toBe(true);
    expect(isOwnedByUser({ userId: OTHER_STUDENT_ID }, STUDENT_ID)).toBe(false);
    expect(isOwnedByUser(null, STUDENT_ID)).toBe(false);
    expect(isOwnedByUser({ userId: STUDENT_ID }, "")).toBe(false);

    expect(() => assertOwnedByUser({ userId: OTHER_STUDENT_ID }, STUDENT_ID)).toThrow(
      StudentAccessError,
    );
    expect(() => assertOwnedByUser(null, STUDENT_ID)).toThrow(StudentAccessError);
    expect(assertOwnedByUser({ userId: STUDENT_ID, id: "x" }, STUDENT_ID).id).toBe("x");
  });
});

describe("opinion part detection", () => {
  it("labels separate opinions only from heading-shaped lines", () => {
    expect(detectOpinionPartHeading("BREYER, J., dissenting.")).toBe("dissent");
    expect(detectOpinionPartHeading("SEPARATE OPINION CONCURRING IN THE JUDGMENT")).toBe(
      "concurrence",
    );
    expect(
      detectOpinionPartHeading(
        "The parties dissent from one another on nearly every factual question raised below.",
      ),
    ).toBeNull();
    expect(detectOpinionPartHeading("")).toBeNull();
  });

  it("leaves text before any separate-opinion heading unlabelled instead of guessing majority", () => {
    const labelled = labelSegmentsWithOpinionParts([
      { text: MAJORITY_TEXT, segmentRef: "p1", charStart: 0, charEnd: MAJORITY_TEXT.length },
      { text: "KAGAN, J., dissenting.", segmentRef: "p2", charStart: 200, charEnd: 222 },
      { text: DISSENT_TEXT, segmentRef: "p3", charStart: 230, charEnd: 330 },
    ]);
    expect(labelled.map((segment) => segment.opinionPart)).toEqual([null, "dissent", "dissent"]);
  });
});

describe("validateCaseBrief", () => {
  const passages = [
    passage({ chunkId: MAJORITY_CHUNK }),
    passage({
      chunkId: DISSENT_CHUNK,
      content: DISSENT_TEXT,
      opinionPart: "dissent",
      chunkIndex: 1,
    }),
  ];

  const rawBrief = {
    caseName: "Sample v. Example",
    court: "Synthetic Court of Appeals",
    year: "2021",
    materialFacts: {
      text: "The tenant stayed past the notice period.",
      chunkIds: [MAJORITY_CHUNK, UNKNOWN_CHUNK],
    },
    issue: { text: "Was the lease terminated?", chunkIds: [MAJORITY_CHUNK] },
    rule: { text: "Notice must be received to terminate.", chunkIds: [MAJORITY_CHUNK] },
    holding: { text: "The lease was not terminated.", chunkIds: [MAJORITY_CHUNK, DISSENT_CHUNK] },
    reasoning: { text: "Receipt governs effectiveness.", chunkIds: [MAJORITY_CHUNK] },
    dissent: { text: "Mailing should suffice.", chunkIds: [DISSENT_CHUNK] },
    concurrence: { text: "A concurrence that does not exist.", chunkIds: [MAJORITY_CHUNK] },
    keyQuotations: [
      { quote: "the lease had not been terminated", chunkId: MAJORITY_CHUNK },
      { quote: "the lease terminated the moment the notice was mailed", chunkId: MAJORITY_CHUNK },
    ],
    openQuestions: [],
    limitations: [],
  };

  it("drops citations that are not passages of this case version", () => {
    const result = validateCaseBrief(rawBrief, passages, "Fallback");
    expect(result.brief.materialFacts.chunkIds).toEqual([MAJORITY_CHUNK]);
    expect(result.droppedChunkIds).toContain(UNKNOWN_CHUNK);
  });

  it("refuses to let a dissent support the holding but keeps it in the dissent section", () => {
    const result = validateCaseBrief(rawBrief, passages, "Fallback");
    expect(result.brief.holding.chunkIds).toEqual([MAJORITY_CHUNK]);
    expect(result.droppedChunkIds).toContain(DISSENT_CHUNK);
    expect(result.brief.dissent?.chunkIds).toEqual([DISSENT_CHUNK]);
  });

  it("drops a separate-opinion section that cites no passage from that opinion", () => {
    const result = validateCaseBrief(rawBrief, passages, "Fallback");
    expect(result.brief.concurrence).toBeNull();
    expect(result.droppedSections).toContain("concurrence");
  });

  it("keeps verbatim quotations and removes fabricated ones", () => {
    const result = validateCaseBrief(rawBrief, passages, "Fallback");
    expect(result.brief.keyQuotations).toHaveLength(1);
    expect(result.brief.keyQuotations[0]?.quote).toBe("the lease had not been terminated");
    expect(result.rejectedQuotes).toHaveLength(1);
    expect(result.brief.limitations.join(" ")).toMatch(/verbatim/);
  });

  it("records that nothing was labelled when the upload has no separate opinions", () => {
    const result = validateCaseBrief(
      {
        ...rawBrief,
        dissent: null,
        concurrence: null,
        holding: { text: "Held.", chunkIds: [MAJORITY_CHUNK] },
      },
      [passage({ chunkId: MAJORITY_CHUNK })],
      "Fallback",
    );
    expect(result.brief.dissent).toBeNull();
    expect(result.brief.limitations.join(" ")).toMatch(/No concurrence or dissent was labelled/);
  });

  it("discards a brief that does not match the schema", () => {
    const result = validateCaseBrief({ caseName: "" }, passages, "Fallback v. Fallback");
    expect(result.schemaValid).toBe(false);
    expect(result.brief.caseName).toBe("Fallback v. Fallback");
    expect(result.brief.keyQuotations).toHaveLength(0);
  });

  it("produces excerpts that are still verbatim substrings of the passage", () => {
    const excerpt = verbatimExcerpt(MAJORITY_TEXT, 60);
    expect(MAJORITY_TEXT).toContain(excerpt);
    expect(excerpt.length).toBeLessThanOrEqual(60);
  });
});

describe("validateProfessorAnswer", () => {
  const index = buildProfessorRetrievalIndex({
    caseHits: [hit({ chunkId: MAJORITY_CHUNK })],
    authorityChunks: [
      {
        authorityId: AUTHORITY_ID,
        chunkId: AUTHORITY_CHUNK,
        citation: "1 Synth. 1",
        court: "Synthetic Court",
        date: "2019-01-01",
        content: AUTHORITY_TEXT,
      },
    ],
  });

  it("keeps the three provenance classes separate", () => {
    const result = validateProfessorAnswer(
      {
        answer: "Receipt of the notice controls.",
        explanationLevel: "standard",
        uploadedCaseSources: [
          {
            caseId: CASE_A_ID,
            chunkId: MAJORITY_CHUNK,
            quote: "the lease had not been terminated",
          },
        ],
        legalAuthoritySources: [
          {
            authorityId: AUTHORITY_ID,
            chunkId: AUTHORITY_CHUNK,
            quote: "effective upon actual receipt by the tenant",
          },
        ],
        explanationNotes: ["Read the notice provision yourself before class."],
        socraticFollowUp: "Which fact would change the result?",
        supportState: "grounded",
        limitations: [],
      },
      index,
      "standard",
    );

    expect(result.grounded).toBe(true);
    const classes = result.sources.map((source) => source.provenance);
    expect(classes).toContain("UPLOADED_CASE");
    expect(classes).toContain("LEGAL_AUTHORITY");
    expect(classes).toContain("PROFESSOR_EXPLANATION");

    const caseSource = result.sources.find((source) => source.provenance === "UPLOADED_CASE");
    expect(caseSource?.caseVersionId).toBe(VERSION_A_ID);
    expect(caseSource?.authorityId).toBeUndefined();
    const authoritySource = result.sources.find(
      (source) => source.provenance === "LEGAL_AUTHORITY",
    );
    expect(authoritySource?.caseId).toBeUndefined();
    expect(result.answer.socraticFollowUp).toBe("Which fact would change the result?");
  });

  it("strips quotes that are not verbatim in the cited passage", () => {
    const result = validateProfessorAnswer(
      {
        answer: "The court said the opposite of this.",
        uploadedCaseSources: [
          { caseId: CASE_A_ID, chunkId: MAJORITY_CHUNK, quote: "the lease terminated on mailing" },
        ],
        legalAuthoritySources: [],
        explanationNotes: [],
        supportState: "grounded",
        limitations: [],
      },
      index,
      "standard",
    );
    expect(result.sources[0]?.quote).toBeNull();
    expect(result.rejectedQuotes).toHaveLength(1);
    expect(result.answer.limitations).toContain(NO_AUTHORITY_LIMITATION);
  });

  it("says it cannot answer when every citation was invented", () => {
    const result = validateProfessorAnswer(
      {
        answer: "Confidently wrong.",
        uploadedCaseSources: [{ caseId: CASE_A_ID, chunkId: UNKNOWN_CHUNK }],
        legalAuthoritySources: [{ authorityId: UNKNOWN_CHUNK, chunkId: null }],
        explanationNotes: [],
        supportState: "grounded",
        limitations: [],
      },
      index,
      "simple",
    );
    expect(result.grounded).toBe(false);
    expect(result.answer.answer).toBe(NO_STUDENT_SOURCES_ANSWER);
    expect(result.answer.supportState).toBe("insufficient");
    expect(result.droppedCaseChunkIds).toContain(UNKNOWN_CHUNK);
  });

  it("discards an answer that does not match the schema", () => {
    const result = validateProfessorAnswer({ answer: 42 }, index, "advanced");
    expect(result.schemaValid).toBe(false);
    expect(result.answer.explanationLevel).toBe("advanced");
    expect(result.answer.answer).toBe(NO_STUDENT_SOURCES_ANSWER);
  });
});

describe("validateCaseComparison", () => {
  const caseAPassages = [passage({ chunkId: MAJORITY_CHUNK })];
  const caseBPassages = [
    passage({
      chunkId: CASE_B_CHUNK,
      caseId: CASE_B_ID,
      caseVersionId: VERSION_B_ID,
      content: DISSENT_TEXT,
    }),
  ];

  const field = (text: string) => ({
    text,
    caseAChunkIds: [MAJORITY_CHUNK],
    caseBChunkIds: [CASE_B_CHUNK],
  });

  it("drops a claimed conflict that only one case supports", () => {
    const result = validateCaseComparison(
      {
        facts: field("Both leases ended in dispute."),
        issue: field("Whether notice was effective."),
        rule: field("Each court states a rule."),
        reasoning: field("Each court reasons from its own record."),
        holding: field("Each majority holds for its own tenant."),
        outcome: field("Dispositions differ."),
        tensions: [
          { text: "Unsupported split.", caseAChunkIds: [MAJORITY_CHUNK], caseBChunkIds: [] },
          field("Both courts weigh receipt differently."),
        ],
        limitations: [],
      },
      caseAPassages,
      caseBPassages,
    );

    expect(result.comparison.tensions).toHaveLength(1);
    expect(result.droppedTensionCount).toBe(1);
    expect(result.comparison.limitations.join(" ")).toMatch(/removed because passages from both/);
  });

  it("drops a citation attributed to the wrong case", () => {
    const result = validateCaseComparison(
      {
        facts: {
          text: "Cross-cited facts.",
          caseAChunkIds: [CASE_B_CHUNK],
          caseBChunkIds: [CASE_B_CHUNK],
        },
        issue: field("Issue."),
        rule: field("Rule."),
        reasoning: field("Reasoning."),
        holding: field("Holding."),
        outcome: field("Outcome."),
        tensions: [],
        limitations: [],
      },
      caseAPassages,
      caseBPassages,
    );
    expect(result.comparison.facts.caseAChunkIds).toEqual([]);
    expect(result.droppedChunkIds).toContain(CASE_B_CHUNK);
    expect(result.comparison.limitations.join(" ")).toMatch(/No conflict between these cases/);
  });

  it("discards a comparison that does not match the schema", () => {
    const result = validateCaseComparison({ facts: "not an object" }, caseAPassages, caseBPassages);
    expect(result.schemaValid).toBe(false);
    expect(result.comparison.tensions).toHaveLength(0);
  });
});
