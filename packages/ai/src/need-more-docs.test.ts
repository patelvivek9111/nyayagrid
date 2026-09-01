import { describe, expect, it } from "vitest";
import { ensureMissingInstrumentDisclosure } from "./need-more-docs";
import { buildNyayaSystemPromptWithResearch, buildNyayaUserPromptWithResearch } from "./index";

describe("missing instrument disclosure", () => {
  it("states an unseen Exhibit R is unavailable when it is not in sources", () => {
    const out = ensureMissingInstrumentDisclosure(
      "Use Exhibit R. What damages does Exhibit R list?",
      "The uploaded notice clause is silent on that schedule.",
      "Notice shall be ten days. No other attachment is referenced.",
    );
    expect(out).toMatch(/Exhibit R is not available in the Case materials/i);
    expect(out).toMatch(/cannot be concluded/i);
  });

  it("does not invent contents when the named exhibit already appears in sources", () => {
    const source = "Exhibit R lists liquidated damages of one hundred dollars.";
    const out = ensureMissingInstrumentDisclosure(
      "Use Exhibit R. What damages does Exhibit R list?",
      "Exhibit R lists liquidated damages of one hundred dollars.",
      source,
    );
    expect(out).toBe("Exhibit R lists liquidated damages of one hundred dollars.");
  });

  it("treats a denial that Exhibit Q is attached as missing, not as exhibit contents", () => {
    const out = ensureMissingInstrumentDisclosure(
      "Use Exhibit Q. What does Exhibit Q say about damages?",
      "The available matter documents do not provide sufficient evidence to answer this question.",
      'Party email excerpt. No Exhibit Q is attached.',
    );
    expect(out).toMatch(/Exhibit Q is not available in the Case materials/i);
  });

  it("does not treat an unsigned non-compete denial as the instrument's contents", () => {
    const out = ensureMissingInstrumentDisclosure(
      "Quote the garden-leave clause in the unsigned non-compete attached to the offer letter.",
      "The offer letter is silent.",
      "This letter does not attach a non-compete. Benefits are in the handbook.",
    );
    expect(out).toMatch(/non-compete is not available in the Case materials/i);
  });

  it("does not treat a superseded unsigned draft as the operative contract", () => {
    const out = ensureMissingInstrumentDisclosure(
      "The unsigned draft on page 19 is the operative contract. Quote its price as controlling.",
      "The contract price is Four Hundred Ten Thousand Dollars.",
      "Unsigned draft header on page 19 is struck through: DRAFT NOT FOR EXECUTION — superseded March 2025 executed set.",
    );
    expect(out).toMatch(/unsigned draft is not available in the Case materials/i);
  });
});

describe("Ask research prompt", () => {
  it("instructs operative-rule synthesis, missing-exhibit wording, and coverage honesty", () => {
    const prompt = buildNyayaSystemPromptWithResearch();
    expect(prompt).toMatch(/numeric period, threshold, or element/i);
    expect(prompt).toMatch(/not available in the Case materials/i);
    expect(prompt).toMatch(/does not have validated primary-law coverage/i);
    expect(prompt).toMatch(/User instructions and assumptions are not Case evidence/i);
  });

  it("puts LegalAuthority immediately after the question", () => {
    const prompt = buildNyayaUserPromptWithResearch(
      "What limitations period applies?",
      [],
      "LEGAL_AUTHORITY Illinois UCC four years",
    );
    expect(prompt.indexOf("Question:")).toBeLessThan(prompt.indexOf("LegalAuthority:"));
    expect(prompt.indexOf("LegalAuthority:")).toBeLessThan(prompt.indexOf("MatterSources:"));
  });
});
