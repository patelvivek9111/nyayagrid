import { describe, expect, it } from "vitest";
import {
  US_PRIMARY_CORPUS_PROVIDER,
  isRealPrimarySourceProvider,
  isSyntheticBenchSource,
} from "./source-classes";
import { redactDatabaseUrl, summarizeCorpusCoverage } from "./db-identity";
import { defaultQualityTierForSourceClass } from "./quality-tier";
import { enrichCorpusAuthority } from "./provenance";
import { syntheticCaseAuthority, SYNTHETIC_SOURCE_PROVIDER } from "../fixtures";
import { loadCorpusManifest, UCC_2725_BODY } from "./bundles";

describe("corpus source classes", () => {
  it("separates synthetic fixtures from real primary corpus", () => {
    expect(isSyntheticBenchSource(SYNTHETIC_SOURCE_PROVIDER, { synthetic: true })).toBe(true);
    expect(isSyntheticBenchSource(US_PRIMARY_CORPUS_PROVIDER, { synthetic: false })).toBe(false);
    expect(isRealPrimarySourceProvider(US_PRIMARY_CORPUS_PROVIDER)).toBe(true);
    expect(isRealPrimarySourceProvider(SYNTHETIC_SOURCE_PROVIDER)).toBe(false);
  });

  it("redacts database credentials and counts only us-primary-corpus as real coverage", () => {
    const redacted = redactDatabaseUrl("postgresql://nyayagrid:s3cret@localhost:5433/nyayagrid");
    expect(redacted).toEqual({
      protocol: "postgresql",
      host: "localhost",
      port: "5433",
      database: "nyayagrid",
      hasUser: true,
      hasPassword: true,
    });
    expect(JSON.stringify(redacted)).not.toContain("s3cret");

    const summary = summarizeCorpusCoverage([
      {
        sourceProvider: US_PRIMARY_CORPUS_PROVIDER,
        authorityType: "statute",
        authorityState: "PA",
        courtId: null,
      },
      {
        sourceProvider: US_PRIMARY_CORPUS_PROVIDER,
        authorityType: "case",
        authorityState: "PA",
        courtId: "st-pa-high",
      },
      {
        sourceProvider: SYNTHETIC_SOURCE_PROVIDER,
        authorityType: "statute",
        authorityState: null,
        courtId: null,
        metadata: { synthetic: true },
      },
      {
        sourceProvider: "nyaya-bench-research-overlay",
        authorityType: "case",
        authorityState: null,
        courtId: null,
        metadata: { synthetic: true },
      },
    ]);
    expect(summary.realPrimaryAuthorities).toBe(2);
    expect(summary.syntheticAuthorities).toBe(2);
    expect(summary.realStatuteCount).toBe(1);
    expect(summary.realCaseCount).toBe(1);
    expect(summary.realStatesWithAuthorities).toEqual(["PA"]);
  });

  it("assigns deterministic quality tiers", () => {
    expect(defaultQualityTierForSourceClass("PRIMARY_OFFICIAL")).toBe("TIER_1_OFFICIAL");
    expect(defaultQualityTierForSourceClass("PRIMARY_PUBLIC_REPOSITORY")).toBe(
      "TIER_2_TRUSTED_PUBLIC",
    );
    expect(defaultQualityTierForSourceClass("SYNTHETIC_BENCH")).toBe("TIER_3_REFERENCE_ONLY");
  });

  it("enriches provenance without inferring effective dates", () => {
    const enriched = enrichCorpusAuthority(syntheticCaseAuthority, {
      sourceClass: "PRIMARY_OFFICIAL",
      importedAt: "2026-08-19T00:00:00.000Z",
    });
    expect(enriched.metadata.sourceClass).toBe("PRIMARY_OFFICIAL");
    expect(enriched.metadata.qualityTier).toBe("TIER_1_OFFICIAL");
    expect(enriched.sourceMetadata.parserVersion).toBe("corpus1-v1");
    expect(enriched.sourceMetadata.importedAt).toBe("2026-08-19T00:00:00.000Z");
  });
});

describe("corpus bundles", () => {
  it("loads initial batch manifest with 10 states", async () => {
    const manifest = await loadCorpusManifest();
    expect(manifest.phase).toBe("6T-CORPUS-1");
    expect(manifest.states).toHaveLength(10);
    expect(manifest.states.map((s) => s.code).sort()).toEqual(
      ["CA", "DE", "FL", "IL", "MA", "NJ", "NY", "PA", "TX", "VA"].sort(),
    );
  });

  it("includes uniform UCC 2-725 body text", () => {
    expect(UCC_2725_BODY).toContain("4 years after the cause of action has accrued");
  });
});
