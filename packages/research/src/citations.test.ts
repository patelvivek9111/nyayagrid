import { describe, expect, it } from "vitest";
import { extractCitationsFromText, parseCitation } from "./citations";
import { syntheticCaseAuthority, syntheticStatuteAuthority } from "./fixtures";

describe("parseCitation", () => {
  it("normalizes reporter citations it recognizes", () => {
    expect(parseCitation("410 U.S. 113")).toMatchObject({
      normalized: "410 U.S. 113",
      type: "case",
      confidence: "high",
    });
    expect(parseCitation("999 F.3d 1")).toMatchObject({
      normalized: "999 F.3d 1",
      reporter: "F.3d",
      confidence: "high",
    });
    expect(parseCitation("999 F. Supp. 2d 45")).toMatchObject({
      normalized: "999 F. Supp. 2d 45",
      reporter: "F. Supp. 2d",
    });
    expect(parseCitation("42 U.S.C. § 1983")).toMatchObject({
      normalized: "42 U.S.C. § 1983",
      type: "statute",
      confidence: "high",
    });
    expect(parseCitation("21 C.F.R. § 314.50")).toMatchObject({
      normalized: "21 C.F.R. § 314.50",
      type: "regulation",
      confidence: "high",
    });
    expect(parseCitation("42 Pa.C.S. § 5525")).toMatchObject({
      normalized: "42 Pa.C.S. § 5525",
      type: "statute",
      confidence: "high",
    });
    expect(parseCitation("28 U.S.C. § 1331")).toMatchObject({
      normalized: "28 U.S.C. § 1331",
      type: "statute",
      confidence: "high",
    });
    expect(parseCitation("104 A.3d 626")).toMatchObject({
      normalized: "104 A.3d 626",
      reporter: "A.3d",
      type: "case",
      confidence: "high",
    });
  });

  it("extracts the reporter citation from a full case cite", () => {
    expect(parseCitation("Acme Corp. v. Contoso Ltd., 999 F.3d 1 (Fed. Cir. 2099)")).toMatchObject({
      normalized: "999 F.3d 1",
      confidence: "high",
    });
  });

  it("marks unfamiliar code conventions as low confidence", () => {
    expect(parseCitation("Synthetic Jurisdiction Code § 100")).toMatchObject({
      normalized: "Synthetic Jurisdiction Code § 100",
      confidence: "low",
    });
  });

  it("refuses to normalize what it cannot parse", () => {
    expect(parseCitation("see the discussion above")).toMatchObject({
      normalized: null,
      confidence: "unknown",
    });
    expect(parseCitation("compare 410 U.S. 113 with 999 F.3d 1")).toMatchObject({
      normalized: null,
      confidence: "unknown",
    });
  });

  it("captures pinpoints without folding them into the citation", () => {
    const parsed = parseCitation("999 F.3d 1, at 7");
    expect(parsed.pinpoint).toBe("7");
    expect(parsed.normalized).toBe("999 F.3d 1");
  });

  it("normalizes federal procedural rule citations", () => {
    expect(parseCitation("Fed. R. Civ. P. 56")).toMatchObject({
      normalized: "Fed. R. Civ. P. 56",
      type: "rule",
      confidence: "high",
    });
    expect(parseCitation("Fed. R. Evid. 401")).toMatchObject({
      normalized: "Fed. R. Evid. 401",
      type: "rule",
    });
    expect(parseCitation("Fed. R. App. P. 4")).toMatchObject({
      normalized: "Fed. R. App. P. 4",
      type: "rule",
    });
  });

  it("normalizes CFR without periods to C.F.R.", () => {
    expect(parseCitation("29 CFR § 541.300")).toMatchObject({
      normalized: "29 C.F.R. § 541.300",
      type: "regulation",
      confidence: "high",
    });
  });
});

describe("citationLookupAliases", () => {
  it("aliases CFR punctuation variants", async () => {
    const { citationLookupAliases } = await import("./citations");
    const aliases = citationLookupAliases("29 CFR § 541.300");
    expect(aliases).toContain("29 C.F.R. § 541.300");
    expect(aliases).toContain("29 CFR § 541.300");
  });
});

describe("extractCitationsFromText", () => {
  it("finds citations in synthetic authority text and preserves raw spans", () => {
    const fromCase = extractCitationsFromText(syntheticCaseAuthority.content);
    const normalized = fromCase.map((citation) => citation.normalized);
    expect(normalized).toContain("999 F.3d 1");
    expect(normalized).toContain("Synthetic Jurisdiction Code § 100");
    for (const citation of fromCase) {
      expect(citation.raw.length).toBeGreaterThan(0);
    }
  });

  it("does not absorb trailing punctuation into a section number", () => {
    const [first] = extractCitationsFromText(syntheticStatuteAuthority.content);
    expect(first?.section).toBe("100");
  });
});
