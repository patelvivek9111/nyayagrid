import { describe, expect, it } from "vitest";
import {
  dateIsAfter,
  disambiguateAmbiguousCitation,
  extractCaptionBeforeCitation,
  isDeterministicAmbiguousStatus,
  normalizeCaseCaption,
  parseIsoDate,
} from "./ambiguous-metadata-resolver.js";

describe("case caption normalization", () => {
  it("normalizes v./vs. and suffixes without fuzzy guessing", () => {
    expect(normalizeCaseCaption("Roe v. Wade")).toBe(normalizeCaseCaption("Roe vs Wade"));
    expect(normalizeCaseCaption("Acme Corp. v. Baker, Inc.")).toBe(
      normalizeCaseCaption("Acme Corporation v. Baker Incorporated"),
    );
    expect(normalizeCaseCaption("Foo v. Bar")).not.toBe(normalizeCaseCaption("Foo v. Baz"));
  });

  it("extracts caption before reporter cite", () => {
    expect(extractCaptionBeforeCitation("Roe v. Wade, 410 U.S. 113")).toBe("Roe v. Wade");
    expect(extractCaptionBeforeCitation("410 U.S. 113")).toBeNull();
  });
});

describe("temporal helpers", () => {
  it("parses ISO dates and after-compare", () => {
    expect(parseIsoDate("1973-01-22")).toBe("1973-01-22");
    expect(dateIsAfter("1980-01-01", "1973-01-22")).toBe(true);
    expect(dateIsAfter("1970-01-01", "1973-01-22")).toBe(false);
  });
});

describe("disambiguateAmbiguousCitation", () => {
  const baseCands = [
    {
      clusterId: "A",
      caseName: "Old Case v. One",
      dateFiled: "1950-01-01",
      parallelCitations: ["100 U.S. 1", "1 S. Ct. 1"],
    },
    {
      clusterId: "B",
      caseName: "New Case v. Two",
      dateFiled: "1990-01-01",
      parallelCitations: ["100 U.S. 1", "90 S. Ct. 9"],
    },
  ];

  it("date eliminates impossible candidate", () => {
    const r = disambiguateAmbiguousCitation({
      rawCitation: "100 U.S. 1",
      normalizedCitation: "100 U.S. 1",
      candidates: baseCands,
      citers: [{ decisionDate: "1975-06-01" }],
    });
    expect(r.status).toBe("RESOLVED_TEMPORAL_UNIQUE");
    expect(r.clusterId).toBe("A");
    expect(r.eliminatedByDate).toContain("B");
    expect(isDeterministicAmbiguousStatus(r.status)).toBe(true);
  });

  it("date does not resolve if >1 candidates remain", () => {
    const r = disambiguateAmbiguousCitation({
      rawCitation: "100 U.S. 1",
      normalizedCitation: "100 U.S. 1",
      candidates: baseCands,
      citers: [{ decisionDate: "2000-01-01" }],
    });
    expect(r.status).toBe("STILL_AMBIGUOUS");
    expect(r.clusterId).toBeNull();
    expect(r.survivingClusterIds.sort()).toEqual(["A", "B"]);
  });

  it("parallel citation uniquely resolves", () => {
    const r = disambiguateAmbiguousCitation({
      rawCitation: "100 U.S. 1",
      normalizedCitation: "100 U.S. 1",
      candidates: baseCands,
      nyayaFamilyCitations: ["90 S. Ct. 9"],
    });
    expect(r.status).toBe("RESOLVED_PARALLEL_UNIQUE");
    expect(r.clusterId).toBe("B");
  });

  it("bulk-unique parallel fingerprint resolves", () => {
    const r = disambiguateAmbiguousCitation({
      rawCitation: "100 U.S. 1",
      normalizedCitation: "100 U.S. 1",
      candidates: baseCands,
      uniqueParallelFingerprintsByCluster: {
        B: ["90 S. Ct. 9"],
      },
    });
    expect(r.status).toBe("RESOLVED_PARALLEL_UNIQUE");
    expect(r.reason).toBe("bulk_unique_parallel_fingerprint");
    expect(r.clusterId).toBe("B");
  });

  it("existing Nyaya cluster identity resolves", () => {
    const r = disambiguateAmbiguousCitation({
      rawCitation: "100 U.S. 1",
      normalizedCitation: "100 U.S. 1",
      candidates: [
        {
          ...baseCands[0]!,
          existingAuthorityId: "auth-a",
          existingAuthorityCitations: ["100 U.S. 1"],
        },
        baseCands[1]!,
      ],
    });
    expect(r.status).toBe("RESOLVED_EXISTING_NYAYA_IDENTITY");
    expect(r.clusterId).toBe("A");
  });

  it("case-name exact normalization helps but does not fuzzy-guess", () => {
    const hit = disambiguateAmbiguousCitation({
      rawCitation: "Old Case v. One, 100 U.S. 1",
      normalizedCitation: "100 U.S. 1",
      candidates: baseCands,
    });
    expect(hit.status).toBe("RESOLVED_METADATA_UNIQUE");
    expect(hit.clusterId).toBe("A");

    const fuzzy = disambiguateAmbiguousCitation({
      rawCitation: "Old Cases v. Ones, 100 U.S. 1",
      normalizedCitation: "100 U.S. 1",
      candidates: baseCands,
    });
    expect(isDeterministicAmbiguousStatus(fuzzy.status)).toBe(false);
  });

  it("multi-citer consensus resolves only when consistent", () => {
    const r = disambiguateAmbiguousCitation({
      rawCitation: "100 U.S. 1",
      normalizedCitation: "100 U.S. 1",
      candidates: baseCands,
      citers: [{ decisionDate: "1975-01-01" }, { decisionDate: "1980-01-01" }],
    });
    expect(r.status).toBe("RESOLVED_MULTI_CITER_CONSENSUS");
    expect(r.clusterId).toBe("A");
  });

  it("multi-citer conflict stays collision-confirmed", () => {
    const r = disambiguateAmbiguousCitation({
      rawCitation: "100 U.S. 1",
      normalizedCitation: "100 U.S. 1",
      candidates: [
        { clusterId: "A", dateFiled: "1950-01-01", caseName: "Alpha v. One" },
        { clusterId: "B", dateFiled: "1950-01-01", caseName: "Beta v. Two" },
      ],
      citers: [
        { decisionDate: "1960-01-01", rawCitation: "Alpha v. One, 100 U.S. 1" },
        { decisionDate: "1960-01-01", rawCitation: "Beta v. Two, 100 U.S. 1" },
      ],
    });
    expect(r.status).toBe("COLLISION_CONFIRMED");
    expect(r.clusterId).toBeNull();
    expect(r.survivingClusterIds.sort()).toEqual(["A", "B"]);
  });

  it("candidate collision stays ambiguous when no signal", () => {
    const r = disambiguateAmbiguousCitation({
      rawCitation: "100 U.S. 1",
      normalizedCitation: "100 U.S. 1",
      candidates: baseCands,
    });
    expect(r.status).toBe("METADATA_INSUFFICIENT");
    expect(r.clusterId).toBeNull();
  });

  it("date leaves multiple candidates still ambiguous", () => {
    const r = disambiguateAmbiguousCitation({
      rawCitation: "100 U.S. 1",
      normalizedCitation: "100 U.S. 1",
      candidates: [
        { clusterId: "A", dateFiled: "1950-01-01" },
        { clusterId: "B", dateFiled: null },
        { clusterId: "C", dateFiled: "1990-01-01" },
      ],
      citers: [{ decisionDate: "1980-01-01" }],
    });
    expect(r.status).toBe("STILL_AMBIGUOUS");
    expect(r.survivingClusterIds.sort()).toEqual(["A", "B"]);
  });
});
