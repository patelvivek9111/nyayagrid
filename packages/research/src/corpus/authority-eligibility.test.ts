import { describe, expect, it } from "vitest";
import { assertOpinionQuoteAllowed, classifyAuthorityEligibility } from "./authority-eligibility";

describe("classifyAuthorityEligibility", () => {
  it("forbids opinion quotes for identity-only without text", () => {
    const elig = classifyAuthorityEligibility({
      authorityId: "a1",
      hasTextContent: false,
      identityOnly: true,
      corpusComplete: false,
      canonicalSourceUrl: "https://example.test/x",
      sourceExternalId: "123",
    });
    expect(elig.allowOpinionQuote).toBe(false);
    expect(elig.allowFullTextGrounding).toBe(false);
    expect(elig.allowIdentityLookup).toBe(true);
    expect(elig.classes).toContain("IDENTITY_ONLY");
  });

  it("allows quotes for text-backed authorities with provenance", () => {
    const elig = classifyAuthorityEligibility({
      authorityId: "a2",
      hasTextContent: true,
      textCharCount: 5000,
      hasEmbedding: true,
      canonicalSourceUrl: "https://example.test/opinion",
      sourceExternalId: "cl-9",
      identityOnly: false,
    });
    expect(elig.allowOpinionQuote).toBe(true);
    expect(elig.allowFullTextGrounding).toBe(true);
    expect(elig.classes).toContain("FULL_TEXT_VERIFIED");
    expect(elig.classes).toContain("SOURCE_VERIFIED");
  });

  it("handles conflicting identityOnly+corpusComplete conservatively", () => {
    const elig = classifyAuthorityEligibility({
      authorityId: "a3",
      hasTextContent: false,
      identityOnly: true,
      corpusComplete: true,
    });
    expect(elig.conflictingMetadata).toBe(true);
    expect(elig.allowOpinionQuote).toBe(false);
    expect(elig.classes).toContain("CONFLICTING_METADATA");
  });

  it("uses real text over conflicting flags when chunks exist", () => {
    const elig = classifyAuthorityEligibility({
      authorityId: "a4",
      hasTextContent: true,
      textCharCount: 2500,
      identityOnly: true,
      corpusComplete: true,
      canonicalSourceUrl: "https://example.test/y",
      sourceExternalId: "ext-1",
    });
    expect(elig.conflictingMetadata).toBe(true);
    expect(elig.allowOpinionQuote).toBe(true);
    expect(elig.reasons.some((r) => /identityOnly flag set but text/i.test(r))).toBe(true);
  });

  it("marks short text as PARTIAL_TEXT and blocks quotes", () => {
    const elig = classifyAuthorityEligibility({
      authorityId: "a5",
      hasTextContent: true,
      textCharCount: 120,
      canonicalSourceUrl: "https://example.test/z",
      sourceExternalId: "ext-2",
      minQuoteChars: 500,
    });
    expect(elig.classes).toContain("PARTIAL_TEXT");
    expect(elig.allowOpinionQuote).toBe(false);
    expect(elig.allowFullTextGrounding).toBe(true);
  });

  it("blocks quotes when provenance missing", () => {
    const elig = classifyAuthorityEligibility({
      authorityId: "a6",
      hasTextContent: true,
      textCharCount: 3000,
      canonicalSourceUrl: null,
      sourceExternalId: null,
    });
    expect(elig.allowOpinionQuote).toBe(false);
    expect(elig.classes).toContain("SOURCE_UNVERIFIED");
  });

  it("assertOpinionQuoteAllowed throws when forbidden", () => {
    const elig = classifyAuthorityEligibility({
      authorityId: "a7",
      hasTextContent: false,
      identityOnly: true,
    });
    expect(() => assertOpinionQuoteAllowed(elig)).toThrow(/OPINION_QUOTE_FORBIDDEN/);
  });
});
