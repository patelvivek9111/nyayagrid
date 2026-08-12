import { describe, expect, it } from "vitest";
import type { AuthoritySearchHit } from "./provider";
import {
  JURISDICTION_UNSPECIFIED_WARNING,
  LIMITED_CORPUS_WARNING,
  NO_AUTHORITY_HITS_WARNING,
  NO_CONTRARY_SEARCH_WARNING,
  NO_CORPUS_SYNTHESIS_ANSWER,
  UNSUPPORTED_SYNTHESIS_ANSWER,
  buildAuthorityRetrievalIndex,
  buildCoverageWarnings,
  partitionAuthorityIds,
  validateAuthoritySummaryCitations,
  validateSynthesisAgainstRetrieval,
} from "./synthesize";
import { MEMO_UNSUPPORTED_SHORT_ANSWER, validateMemoAgainstRetrieval } from "./memo";
import { TREATMENT_UNVERIFIED_NOTICE } from "./treatment";
import {
  SYNTHETIC_FABRICATED_QUOTE,
  SYNTHETIC_VALID_QUOTE,
  syntheticStatuteAuthority,
} from "./fixtures";

const AUTHORITY_ID = "11111111-1111-1111-1111-111111111111";
const CHUNK_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_CHUNK_ID = "33333333-3333-3333-3333-333333333333";
const UNKNOWN_AUTHORITY_ID = "44444444-4444-4444-4444-444444444444";
const UNKNOWN_CHUNK_ID = "55555555-5555-5555-5555-555555555555";

const SOURCE_TEXT = syntheticStatuteAuthority.content;

function retrievedHit(overrides: Partial<AuthoritySearchHit> = {}): AuthoritySearchHit {
  return {
    authorityId: AUTHORITY_ID,
    authorityVersionId: "66666666-6666-6666-6666-666666666666",
    chunkId: CHUNK_ID,
    title: syntheticStatuteAuthority.title,
    citation: syntheticStatuteAuthority.citation ?? null,
    authorityType: "statute",
    jurisdiction: "Synthetic Jurisdiction",
    court: null,
    decisionDate: null,
    score: 0.9,
    snippet: SOURCE_TEXT.slice(0, 200),
    ...overrides,
  };
}

function indexWithFullText() {
  return buildAuthorityRetrievalIndex(
    [retrievedHit()],
    new Map([
      [
        CHUNK_ID,
        {
          chunkId: CHUNK_ID,
          authorityId: AUTHORITY_ID,
          authorityVersionId: "66666666-6666-6666-6666-666666666666",
          content: SOURCE_TEXT,
          sectionRef: "100",
          subsectionRef: "b",
          opinionPart: null,
          pageStart: null,
          title: syntheticStatuteAuthority.title,
          citation: syntheticStatuteAuthority.citation ?? null,
          authorityType: "statute",
          jurisdiction: "Synthetic Jurisdiction",
          court: null,
          decisionDate: null,
        },
      ],
    ]),
  );
}

function synthesisPayload(overrides: Record<string, unknown> = {}) {
  return {
    conciseAnswer: "Irreparable harm excludes fully compensable monetary loss.",
    legalPropositions: [
      {
        text: "Money damages defeat a claim of irreparable harm.",
        authorityIds: [AUTHORITY_ID],
        chunkIds: [CHUNK_ID],
      },
    ],
    supportingAuthorities: [AUTHORITY_ID],
    contraryAuthorities: [],
    importantDistinctions: [],
    jurisdictionCaveats: [],
    unresolvedIssues: [],
    coverageWarnings: [],
    sources: [{ authorityId: AUTHORITY_ID, chunkId: CHUNK_ID, quote: SYNTHETIC_VALID_QUOTE }],
    ...overrides,
  };
}

describe("buildAuthorityRetrievalIndex", () => {
  it("indexes retrieved passages and prefers full chunk text over the snippet", () => {
    const index = indexWithFullText();
    expect(index.authorityIds.has(AUTHORITY_ID)).toBe(true);
    expect(index.chunkIds.has(CHUNK_ID)).toBe(true);
    expect(index.authorityIdByChunkId.get(CHUNK_ID)).toBe(AUTHORITY_ID);
    expect(index.textByChunkId.get(CHUNK_ID)).toBe(SOURCE_TEXT);
    expect(index.chunkIdsByAuthorityId.get(AUTHORITY_ID)).toEqual([CHUNK_ID]);
  });

  it("falls back to the retrieval snippet when full text was not loaded", () => {
    const index = buildAuthorityRetrievalIndex([retrievedHit()]);
    expect(index.textByChunkId.get(CHUNK_ID)).toBe(SOURCE_TEXT.slice(0, 200));
  });
});

describe("partitionAuthorityIds", () => {
  it("separates retrieved authority ids from unknown ones and dedupes", () => {
    const index = indexWithFullText();
    expect(
      partitionAuthorityIds([AUTHORITY_ID, AUTHORITY_ID, UNKNOWN_AUTHORITY_ID], index),
    ).toEqual({
      known: [AUTHORITY_ID],
      unknown: [UNKNOWN_AUTHORITY_ID],
    });
  });
});

describe("validateSynthesisAgainstRetrieval", () => {
  it("keeps propositions and verified quotes that trace to retrieved passages", () => {
    const result = validateSynthesisAgainstRetrieval(synthesisPayload(), indexWithFullText());
    expect(result.grounded).toBe(true);
    expect(result.synthesis.legalPropositions).toHaveLength(1);
    expect(result.synthesis.sources[0]?.quote).toBe(SYNTHETIC_VALID_QUOTE);
    expect(result.fabricatedAuthorityIds).toEqual([]);
    expect(result.rejectedQuotes).toEqual([]);
    expect(result.synthesis.conciseAnswer).toBe(
      "Irreparable harm excludes fully compensable monetary loss.",
    );
  });

  it("rejects unknown authority ids and drops the propositions that depend on them", () => {
    const result = validateSynthesisAgainstRetrieval(
      synthesisPayload({
        legalPropositions: [
          {
            text: "Fabricated precedent establishes a presumption of irreparable harm.",
            authorityIds: [UNKNOWN_AUTHORITY_ID],
            chunkIds: [UNKNOWN_CHUNK_ID],
          },
        ],
        supportingAuthorities: [UNKNOWN_AUTHORITY_ID],
        sources: [{ authorityId: UNKNOWN_AUTHORITY_ID, chunkId: UNKNOWN_CHUNK_ID, quote: null }],
      }),
      indexWithFullText(),
    );

    expect(result.synthesis.legalPropositions).toEqual([]);
    expect(result.synthesis.sources).toEqual([]);
    expect(result.synthesis.supportingAuthorities).toEqual([]);
    expect(result.fabricatedAuthorityIds).toContain(UNKNOWN_AUTHORITY_ID);
    expect(result.droppedPropositions).toHaveLength(1);
    expect(result.grounded).toBe(false);
    expect(result.synthesis.conciseAnswer).toBe(UNSUPPORTED_SYNTHESIS_ANSWER);
    expect(result.synthesis.coverageWarnings.join(" ")).toMatch(/dropped/i);
  });

  it("keeps a proposition but strips chunk ids that were not retrieved", () => {
    const result = validateSynthesisAgainstRetrieval(
      synthesisPayload({
        legalPropositions: [
          {
            text: "Money damages defeat a claim of irreparable harm.",
            authorityIds: [AUTHORITY_ID],
            chunkIds: [CHUNK_ID, UNKNOWN_CHUNK_ID],
          },
        ],
      }),
      indexWithFullText(),
    );
    expect(result.synthesis.legalPropositions[0]?.chunkIds).toEqual([CHUNK_ID]);
    expect(result.unknownChunkIds).toEqual([UNKNOWN_CHUNK_ID]);
    expect(result.grounded).toBe(true);
  });

  it("removes quotes that do not appear verbatim in the cited passage", () => {
    const result = validateSynthesisAgainstRetrieval(
      synthesisPayload({
        sources: [
          { authorityId: AUTHORITY_ID, chunkId: CHUNK_ID, quote: SYNTHETIC_FABRICATED_QUOTE },
        ],
      }),
      indexWithFullText(),
    );
    expect(result.rejectedQuotes).toHaveLength(1);
    expect(result.synthesis.sources[0]?.quote).toBeNull();
    expect(result.synthesis.coverageWarnings.join(" ")).toMatch(/could not be verified verbatim/i);
  });

  it("rejects a source whose chunk belongs to a different authority", () => {
    const index = buildAuthorityRetrievalIndex([
      retrievedHit(),
      retrievedHit({
        authorityId: UNKNOWN_AUTHORITY_ID,
        chunkId: OTHER_CHUNK_ID,
        score: 0.5,
      }),
    ]);
    const result = validateSynthesisAgainstRetrieval(
      synthesisPayload({
        sources: [{ authorityId: AUTHORITY_ID, chunkId: OTHER_CHUNK_ID, quote: null }],
      }),
      index,
    );
    expect(result.synthesis.sources).toEqual([]);
    expect(result.droppedSources[0]?.reason).toMatch(/different authority/i);
  });

  it("refuses to answer at all when nothing was retrieved", () => {
    const result = validateSynthesisAgainstRetrieval(
      synthesisPayload(),
      buildAuthorityRetrievalIndex([]),
    );
    expect(result.synthesis.conciseAnswer).toBe(NO_CORPUS_SYNTHESIS_ANSWER);
    expect(result.synthesis.legalPropositions).toEqual([]);
    expect(result.grounded).toBe(false);
  });

  it("returns an ungrounded result when the model output fails schema validation", () => {
    const result = validateSynthesisAgainstRetrieval(
      { conciseAnswer: "", legalPropositions: "not-an-array" },
      indexWithFullText(),
    );
    expect(result.schemaValid).toBe(false);
    expect(result.grounded).toBe(false);
    expect(result.synthesis.conciseAnswer).toBe(UNSUPPORTED_SYNTHESIS_ANSWER);
  });
});

describe("buildCoverageWarnings", () => {
  it("always states corpus limits and unverified treatment", () => {
    const warnings = buildCoverageWarnings({
      hitCount: 6,
      authorityCount: 4,
      contrarySearchPerformed: true,
      jurisdictionFilter: "Synthetic Jurisdiction",
    });
    expect(warnings).toContain(LIMITED_CORPUS_WARNING);
    expect(warnings).toContain(TREATMENT_UNVERIFIED_NOTICE);
    expect(warnings).not.toContain(JURISDICTION_UNSPECIFIED_WARNING);
    expect(warnings).not.toContain(NO_CONTRARY_SEARCH_WARNING);
  });

  it("warns about empty retrieval, missing jurisdiction, and skipped contrary search", () => {
    const warnings = buildCoverageWarnings({
      hitCount: 0,
      authorityCount: 0,
      contrarySearchPerformed: false,
      extra: ["Custom caveat", "Custom caveat"],
    });
    expect(warnings).toContain(NO_AUTHORITY_HITS_WARNING);
    expect(warnings).toContain(JURISDICTION_UNSPECIFIED_WARNING);
    expect(warnings).toContain(NO_CONTRARY_SEARCH_WARNING);
    expect(warnings.filter((warning) => warning === "Custom caveat")).toHaveLength(1);
  });

  it("flags thin coverage when only a couple of authorities matched", () => {
    const warnings = buildCoverageWarnings({
      hitCount: 2,
      authorityCount: 1,
      contrarySearchPerformed: true,
      jurisdictionFilters: ["Synthetic Jurisdiction"],
    });
    expect(warnings.join(" ")).toMatch(/coverage for this question is thin/i);
  });
});

describe("validateAuthoritySummaryCitations", () => {
  const summaryField = (chunkIds: string[]) => ({ text: "Field text", chunkIds });

  it("drops chunk citations that are not stored passages of the authority", () => {
    const result = validateAuthoritySummaryCitations(
      {
        authorityId: AUTHORITY_ID,
        facts: summaryField([CHUNK_ID, UNKNOWN_CHUNK_ID]),
        issue: summaryField([UNKNOWN_CHUNK_ID]),
        rule: summaryField([CHUNK_ID]),
        reasoning: summaryField([]),
        holding: summaryField([CHUNK_ID]),
        proceduralPosture: null,
        concurrenceDissent: null,
        relevance: summaryField([]),
        treatmentUnknown: false,
        coverageWarnings: [],
      },
      new Set([CHUNK_ID]),
      AUTHORITY_ID,
    );

    expect(result.summary.facts.chunkIds).toEqual([CHUNK_ID]);
    expect(result.summary.issue.chunkIds).toEqual([]);
    expect(result.droppedChunkIds).toEqual([UNKNOWN_CHUNK_ID]);
    expect(result.summary.treatmentUnknown).toBe(true);
    expect(result.coverageWarnings).toContain(TREATMENT_UNVERIFIED_NOTICE);
  });

  it("returns a placeholder summary when the model output fails schema validation", () => {
    const result = validateAuthoritySummaryCitations(
      { nope: true },
      new Set([CHUNK_ID]),
      AUTHORITY_ID,
    );
    expect(result.schemaValid).toBe(false);
    expect(result.summary.authorityId).toBe(AUTHORITY_ID);
    expect(result.summary.treatmentUnknown).toBe(true);
  });
});

describe("validateMemoAgainstRetrieval", () => {
  const memoPayload = (propositions: unknown[]) => ({
    issue: "Does compensable revenue loss establish irreparable harm?",
    shortAnswer: "No, fully compensable loss is not irreparable harm.",
    factsAssumptions: "Assumes the distributor's losses are quantifiable.",
    applicableAuthorities: [AUTHORITY_ID, UNKNOWN_AUTHORITY_ID],
    analysis: "The statute excludes harm remediable by money damages.",
    counterarguments: "",
    conclusion: "Injunctive relief is unlikely on these facts.",
    authorityVerificationNotes: [],
    coverageWarnings: [],
    propositions,
  });

  it("keeps supported propositions and removes unretrieved authority ids", () => {
    const result = validateMemoAgainstRetrieval(
      memoPayload([
        {
          text: "Compensable loss is not irreparable harm.",
          authorityIds: [AUTHORITY_ID],
          chunkIds: [CHUNK_ID, UNKNOWN_CHUNK_ID],
        },
      ]),
      indexWithFullText(),
    );

    expect(result.grounded).toBe(true);
    expect(result.memo.applicableAuthorities).toEqual([AUTHORITY_ID]);
    expect(result.memo.propositions[0]?.chunkIds).toEqual([CHUNK_ID]);
    expect(result.fabricatedAuthorityIds).toContain(UNKNOWN_AUTHORITY_ID);
    expect(result.unknownChunkIds).toEqual([UNKNOWN_CHUNK_ID]);
  });

  it("withholds the short answer and conclusion when no proposition survives", () => {
    const result = validateMemoAgainstRetrieval(
      memoPayload([
        {
          text: "A fabricated case presumes irreparable harm.",
          authorityIds: [UNKNOWN_AUTHORITY_ID],
          chunkIds: [],
        },
      ]),
      indexWithFullText(),
    );

    expect(result.grounded).toBe(false);
    expect(result.memo.propositions).toEqual([]);
    expect(result.memo.shortAnswer).toBe(MEMO_UNSUPPORTED_SHORT_ANSWER);
    expect(result.memo.conclusion).toBe(MEMO_UNSUPPORTED_SHORT_ANSWER);
    expect(result.droppedPropositions).toHaveLength(1);
  });

  it("always attaches the attorney-review verification note", () => {
    const result = validateMemoAgainstRetrieval(memoPayload([]), indexWithFullText());
    expect(result.memo.authorityVerificationNotes.join(" ")).toMatch(/not attorney-authored/i);
  });
});
