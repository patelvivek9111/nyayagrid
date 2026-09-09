import { describe, expect, it } from "vitest";
import { authorityIdentityBoost, caseNameQueryTokens, diversifyAuthorityHits, suppressWeakerCaseNameHits } from "./search";

const QUERY = "What did Acme Corp. v. Contoso Ltd. hold about irreparable harm?";

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
    expect(diversified.map((hit) => hit.authorityId)).toEqual(["decoy", "target", "decoy"]);
  });

  it("drops a weaker near-name competitor when an exact party match is present", () => {
    const kept = suppressWeakerCaseNameHits(
      [
        { title: "Acme Corp. v. Contoso Holdings, 888 F.3d 9 (Fed. Cir. 2098)" },
        { title: "Acme Corp. v. Contoso Ltd., 999 F.3d 1 (Fed. Cir. 2099)" },
      ],
      QUERY,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.title).toMatch(/Contoso Ltd/);
  });
});
