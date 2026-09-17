import { describe, expect, it } from "vitest";
import {
  authorityIdentityBoost,
  caseNameQueryTokens,
  diversifyAuthorityHits,
  retainAuthorityHits,
  suppressWeakerCaseNameHits,
} from "./search";
import type { AuthoritySearchHit } from "./provider";

const QUERY = "What did Acme Corp. v. Contoso Ltd. hold about irreparable harm?";

function hit(
  partial: Partial<AuthoritySearchHit> & { authorityId: string; score: number },
): AuthoritySearchHit {
  return {
    authorityVersionId: "v1",
    chunkId: `c-${partial.authorityId}`,
    title: partial.title ?? partial.authorityId,
    citation: partial.citation ?? null,
    normalizedCitation: partial.normalizedCitation ?? null,
    sourceProvider: partial.sourceProvider ?? "us-primary-corpus",
    authorityType: partial.authorityType ?? "case",
    jurisdiction: partial.jurisdiction ?? null,
    court: partial.court ?? null,
    decisionDate: null,
    authorityState: partial.authorityState ?? null,
    courtLevel: partial.courtLevel ?? null,
    snippet: "snippet",
    ...partial,
  };
}

describe("authority identity ranking", () => {
  it("extracts both party names from a case-name query", () => {
    const tokens = caseNameQueryTokens(QUERY);
    expect(tokens).toEqual(expect.arrayContaining(["acme", "corp", "contoso", "ltd"]));
  });

  it("ranks the exact party match ahead of a near-name decoy without using the task id", () => {
    const target = authorityIdentityBoost({
      title: "Acme Corp. v. Contoso Ltd., 999 F.3d 1 (Fed. Cir. 2099)",
      citation: "999 F.3d 1",
      query: QUERY,
    });
    const decoy = authorityIdentityBoost({
      title: "Acme Corp. v. Contoso Holdings, 888 F.3d 9 (Fed. Cir. 2098)",
      citation: "888 F.3d 9",
      query: QUERY,
    });
    expect(target).toBeGreaterThan(decoy);
  });

  it("keeps one chunk per authority first so a decoy cannot occupy every top-k slot", () => {
    const diversified = diversifyAuthorityHits(
      [
        { authorityId: "decoy", score: 0.9 },
        { authorityId: "decoy", score: 0.88 },
        { authorityId: "decoy", score: 0.87 },
        { authorityId: "target", score: 0.8 },
      ],
      3,
    );
    expect(diversified.map((row) => row.authorityId)).toEqual(["decoy", "target", "decoy"]);
  });

  it("drops a weaker near-name competitor when an exact party match is present", () => {
    const kept = suppressWeakerCaseNameHits(
      [
        { title: "Acme Corp. v. Contoso Ltd., 999 F.3d 1 (Fed. Cir. 2099)" },
        { title: "Acme Corp. v. Contoso Holdings, 888 F.3d 9 (Fed. Cir. 2098)" },
      ],
      QUERY,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.title).toMatch(/Contoso Ltd/);
  });
});

describe("retainAuthorityHits", () => {
  it("always retains exact citation matches and drops weak peers", () => {
    const retained = retainAuthorityHits(
      [
        hit({
          authorityId: "pa-5525",
          score: 1.72,
          citation: "42 Pa.C.S. § 5525",
          normalizedCitation: "42 Pa.C.S. § 5525",
          authorityState: "PA",
        }),
        hit({
          authorityId: "marbury",
          score: 0.88,
          citation: "5 U.S. 137",
          authorityState: "US",
          courtLevel: "scotus",
        }),
      ],
      "What does 42 Pa.C.S. § 5525 provide?",
      { preferredStateCodes: ["PA"], limit: 6 },
    );
    expect(retained.map((row) => row.authorityId)).toEqual(["pa-5525"]);
  });

  it("suppresses out-of-jurisdiction distractors for supported-state issue queries", () => {
    const retained = retainAuthorityHits(
      [
        hit({
          authorityId: "marbury",
          score: 0.63,
          citation: "5 U.S. 137",
          authorityState: "US",
          courtLevel: "scotus",
        }),
        hit({
          authorityId: "nj-ucc",
          score: 0.44,
          citation: "N.J. Stat. § 12A:2-725",
          authorityState: "NJ",
          authorityType: "statute",
        }),
      ],
      "New Jersey statute of limitations for contracts for sale of goods",
      { preferredStateCodes: ["NJ"], limit: 6 },
    );
    expect(retained.map((row) => row.authorityId)).toEqual(["nj-ucc"]);
  });

  it("returns empty for unsupported-jurisdiction corpus miss", () => {
    const retained = retainAuthorityHits(
      [
        hit({
          authorityId: "marbury",
          score: 0.6,
          citation: "5 U.S. 137",
          authorityState: "US",
          courtLevel: "scotus",
        }),
        hit({
          authorityId: "fl",
          score: 0.1,
          citation: "882 So. 2d 801",
          authorityState: "FL",
        }),
      ],
      "Wyoming geothermal well bonding schedules",
      { preferredStateCodes: ["WY"], limit: 6 },
    );
    expect(retained).toEqual([]);
  });

  it("returns empty for low-confidence no-preferred miss", () => {
    const retained = retainAuthorityHits(
      [
        hit({
          authorityId: "marbury",
          score: 0.68,
          citation: "5 U.S. 137",
          authorityState: "US",
        }),
      ],
      "What does 999 Z.Z.Z. section 0001 say?",
      { preferredStateCodes: [], limit: 6 },
    );
    expect(retained).toEqual([]);
  });

  it("drops synthetic authorities", () => {
    const retained = retainAuthorityHits(
      [
        hit({
          authorityId: "synth",
          score: 1.5,
          citation: "Synthetic Jurisdiction Code § 100",
          sourceProvider: "synthetic-fixtures",
        }),
      ],
      "Synthetic Jurisdiction Code § 100",
      { limit: 6 },
    );
    expect(retained).toEqual([]);
  });
});
