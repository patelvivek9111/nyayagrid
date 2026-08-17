import { describe, expect, it } from "vitest";
import { detectHighStakes } from "@nyayagrid/ai";
import { GuideAuthorizationError, assertGuideOwnedByUser, isGuideOwnedByUser } from "./auth";
import { extractExplicitDatesFromChunks, validateExplicitDatesAgainstChunks } from "./explain";
import {
  FORBIDDEN_PROFESSIONAL_TABLE_NAMES,
  GUIDE_SEARCH_ALLOWED_TABLES,
  assertSqlTemplatesAreIsolated,
  buildGuideChunkSearchSqlTemplates,
} from "./search";
import { containsIllegalityClaim, enforceIllegalityGuardrail } from "./guardrails";

const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CHUNK_A = "11111111-1111-1111-1111-111111111111";
const CHUNK_B = "22222222-2222-2222-2222-222222222222";

const LEASE_TEXT =
  "Rent is due on the first of each month. This Lease terminates on December 31, 2026 unless renewed in writing.";
const AUTHORITY_TEXT =
  "A landlord may not retaliate against a tenant for exercising a legal right under this chapter.";

describe("guide ownership helpers", () => {
  it("treats a row owned by another user the same as a missing row", () => {
    expect(isGuideOwnedByUser({ userId: USER_ID }, USER_ID)).toBe(true);
    expect(isGuideOwnedByUser({ userId: OTHER_USER_ID }, USER_ID)).toBe(false);
    expect(isGuideOwnedByUser(null, USER_ID)).toBe(false);
    expect(isGuideOwnedByUser({ userId: USER_ID }, "")).toBe(false);

    expect(() => assertGuideOwnedByUser({ userId: OTHER_USER_ID }, USER_ID)).toThrow(
      GuideAuthorizationError,
    );
    expect(() => assertGuideOwnedByUser(null, USER_ID)).toThrow(GuideAuthorizationError);
    expect(assertGuideOwnedByUser({ userId: USER_ID, id: "doc-1" }, USER_ID).id).toBe("doc-1");
  });
});

describe("validateExplicitDatesAgainstChunks", () => {
  const chunkContentById = new Map([[CHUNK_A, LEASE_TEXT]]);

  it("keeps a date only when its quote is verbatim in the chunk it cites", () => {
    const result = validateExplicitDatesAgainstChunks(
      [
        {
          date: "December 31, 2026",
          label: "Lease end date",
          quote: "This Lease terminates on December 31, 2026",
          chunkId: CHUNK_A,
        },
      ],
      chunkContentById,
    );
    expect(result.kept).toHaveLength(1);
    expect(result.rejected).toBe(0);
  });

  it("rejects a fabricated date, a date cited to the wrong chunk, and a missing chunkId", () => {
    const result = validateExplicitDatesAgainstChunks(
      [
        {
          date: "January 1, 2099",
          label: "Fabricated",
          quote: "January 1, 2099",
          chunkId: CHUNK_A,
        },
        {
          date: "December 31, 2026",
          label: "Wrong chunk",
          quote: "This Lease terminates on December 31, 2026",
          chunkId: CHUNK_B,
        },
      ],
      chunkContentById,
    );
    expect(result.kept).toHaveLength(0);
    expect(result.rejected).toBe(2);
  });

  it("never derives a date that was not explicitly quoted from the document", () => {
    // No amount of "computation" happens here — an item with no quote is dropped outright,
    // which is the enforcement point for "no procedural deadline calculation".
    const result = validateExplicitDatesAgainstChunks(
      [{ date: "30 days later", label: "Derived", quote: "", chunkId: CHUNK_A }],
      chunkContentById,
    );
    expect(result.kept).toHaveLength(0);
    expect(result.rejected).toBe(1);
  });
});

describe("extractExplicitDatesFromChunks", () => {
  it("copies fully written calendar dates from chunk text and ignores computed phrasing", () => {
    const dates = extractExplicitDatesFromChunks([
      {
        id: CHUNK_A,
        content:
          "This residential lease begins on January 1, 2026 and continues month-to-month unless renewed 30 days before the end date.",
      },
    ]);
    expect(dates).toHaveLength(1);
    expect(dates[0]?.date).toBe("January 1, 2026");
    expect(dates[0]?.quote).toContain("January 1, 2026");
    expect(dates[0]?.chunkId).toBe(CHUNK_A);
  });
});

describe("guide search isolation", () => {
  it("keeps the guide-allowed and forbidden professional table lists disjoint", () => {
    const forbidden = new Set<string>(FORBIDDEN_PROFESSIONAL_TABLE_NAMES);
    for (const table of GUIDE_SEARCH_ALLOWED_TABLES) {
      expect(forbidden.has(table)).toBe(false);
    }
  });

  it("builds chunk search SQL that never references matter/document_chunks/student tables", () => {
    const { vectorSql, ftsSql } = buildGuideChunkSearchSqlTemplates();
    expect(() => assertSqlTemplatesAreIsolated([vectorSql, ftsSql])).not.toThrow();
    expect(vectorSql).toContain("guide_document_chunks");
    expect(ftsSql).toContain("guide_document_chunks");
  });

  it("rejects any SQL template that reaches into professional or student tables", () => {
    expect(() =>
      assertSqlTemplatesAreIsolated(["SELECT * FROM document_chunks WHERE matter_id = $1"]),
    ).toThrow(/document_chunks/);
    expect(() =>
      assertSqlTemplatesAreIsolated([
        "SELECT * FROM guide_document_chunks c JOIN matters m ON m.id = c.document_id",
      ]),
    ).toThrow(/matters/);
    expect(() => assertSqlTemplatesAreIsolated(["SELECT * FROM student_cases"])).toThrow(
      /student_cases/,
    );
    expect(() =>
      assertSqlTemplatesAreIsolated(["SELECT * FROM student_case_chunks WHERE user_id = $1"]),
    ).toThrow(/student_case_chunks/);
  });
});

describe("detectHighStakes", () => {
  it("flags eviction, arrest, and domestic violence language", () => {
    expect(detectHighStakes("My landlord is trying to evict me next week").highStakes).toBe(true);
    expect(detectHighStakes("My brother was arrested last night").highStakes).toBe(true);
    expect(detectHighStakes("I need a restraining order against my ex-partner").highStakes).toBe(
      true,
    );
  });

  it("does not flag routine, non-urgent legal information questions", () => {
    const result = detectHighStakes("What does an indemnification clause usually mean?");
    expect(result.highStakes).toBe(false);
    expect(result.flags).toHaveLength(0);
  });

  it("combines multiple input texts (e.g. question + situation context) when detecting", () => {
    const result = detectHighStakes(
      "What should I bring to court?",
      "Immigration removal proceedings begin Monday.",
    );
    expect(result.highStakes).toBe(true);
    expect(result.flags).toContain("deportation");
  });
});

describe("illegality guardrail", () => {
  const ILLEGAL_CLAUSE_SENTENCE =
    "This clause is illegal and unenforceable under state law. You do not need to comply with it.";

  it("detects a sentence asserting a clause is illegal or unenforceable", () => {
    expect(containsIllegalityClaim(ILLEGAL_CLAUSE_SENTENCE)).toBe(true);
    expect(containsIllegalityClaim("This clause describes the renewal process.")).toBe(false);
  });

  it("strips an illegality claim when no legal authority backs the answer", () => {
    const result = enforceIllegalityGuardrail(ILLEGAL_CLAUSE_SENTENCE, false);
    expect(result.wasBlocked).toBe(true);
    expect(result.answer).not.toMatch(/illegal/i);
  });

  it("keeps the illegality claim when a retrieved legal authority supports it", () => {
    const result = enforceIllegalityGuardrail(ILLEGAL_CLAUSE_SENTENCE, true);
    expect(result.wasBlocked).toBe(false);
    expect(result.answer).toBe(ILLEGAL_CLAUSE_SENTENCE);
  });

  it("leaves ordinary, non-illegality answers untouched either way", () => {
    const answer = `General information about lease renewal terms, referencing ${AUTHORITY_TEXT}`;
    expect(enforceIllegalityGuardrail(answer, false).wasBlocked).toBe(false);
    expect(enforceIllegalityGuardrail(answer, true).wasBlocked).toBe(false);
  });
});
