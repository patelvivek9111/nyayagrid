import { describe, expect, it } from "vitest";
import {
  GENERAL_ASK_COUNSEL,
  GENERAL_ASK_MISSING_INSTRUMENT,
  GENERAL_ASK_NOT_ADVICE,
  buildGeneralAskBoundaryAnswer,
  detectGeneralAskBoundary,
} from "./general-ask-boundary";

describe("general Ask boundary", () => {
  it("intercepts a signing-advice question with no attached clause", () => {
    const q =
      "Can you legally advise me on whether I should sign this specific contract clause, or do I need a real estate attorney?";
    const flags = detectGeneralAskBoundary(q);
    expect(flags.seeksSigningOrAdvice).toBe(true);
    expect(flags.asksWhetherToRetainCounsel).toBe(true);
    expect(flags.referencesUnattachedInstrument).toBe(true);
    const answer = buildGeneralAskBoundaryAnswer(q);
    expect(answer).toContain(GENERAL_ASK_NOT_ADVICE);
    expect(answer).toContain(GENERAL_ASK_MISSING_INSTRUMENT);
    expect(answer).toContain(GENERAL_ASK_COUNSEL);
    expect(answer).not.toMatch(/verified authority/i);
  });

  it("does not intercept ordinary legal-research questions", () => {
    expect(buildGeneralAskBoundaryAnswer("What is the statute of frauds for real estate contracts?")).toBeNull();
    expect(buildGeneralAskBoundaryAnswer("What are the elements of attorney-client privilege?")).toBeNull();
    expect(buildGeneralAskBoundaryAnswer("Virginia waiting period for no-fault divorce")).toBeNull();
  });

  it("treats a long quoted clause as attached text, but still refuses a signing recommendation", () => {
    const clause = `"${"The buyer shall deposit earnest money within ten business days of execution. ".repeat(4)}"`;
    const q = `Should I sign this specific contract clause? ${clause}`;
    const flags = detectGeneralAskBoundary(q);
    expect(flags.seeksSigningOrAdvice).toBe(true);
    expect(flags.referencesUnattachedInstrument).toBe(false);
    const answer = buildGeneralAskBoundaryAnswer(q);
    expect(answer).toContain(GENERAL_ASK_NOT_ADVICE);
    expect(answer).not.toContain(GENERAL_ASK_MISSING_INSTRUMENT);
  });
});
