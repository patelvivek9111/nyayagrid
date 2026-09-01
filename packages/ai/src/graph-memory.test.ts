import { describe, expect, it } from "vitest";
import {
  MEMORY_PROPOSAL_PROMPT_VERSION,
  buildMemoryProposalSystemPrompt,
} from "./graph-memory";

describe("memory proposal prompt v2", () => {
  it("forbids treating hints, silence, and badge activity as verified facts", () => {
    expect(MEMORY_PROPOSAL_PROMPT_VERSION).toBe("matter-memory-propose-v2");
    const prompt = buildMemoryProposalSystemPrompt();
    expect(prompt).toMatch(/hint is not evidence/i);
    expect(prompt).toMatch(/ACCESS GRANTED/i);
    expect(prompt).toMatch(/universal negative/i);
    expect(prompt).toMatch(/Storage is not verification/i);
  });
});
