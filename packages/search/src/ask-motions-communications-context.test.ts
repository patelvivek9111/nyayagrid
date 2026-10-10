import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runPass6LitigationFixture } from "@nyayagrid/intelligence";
import {
  buildMotionsCommunicationsAskContextBlock,
  isMotionsCommunicationsAskQuestion,
  mergeAskContextText,
} from "./nyaya";

const root = resolve(__dirname, "../../..");

function readNyayaSrc(): string {
  return readFileSync(resolve(root, "packages/search/src/nyaya.ts"), "utf8");
}

describe("Ask Nyaya motions/communications context gating", () => {
  const { review } = runPass6LitigationFixture();

  it("includes structured non-predictive motions context", () => {
    const question = "What motions are pending?";
    expect(isMotionsCommunicationsAskQuestion(question)).toBe(true);
    const block = buildMotionsCommunicationsAskContextBlock({ question, review });
    expect(block).toContain("MOTIONS_COMMUNICATIONS_REVIEW");
    expect(block).toContain("PREDICTIVE_OUTCOME: null");
    expect(block).not.toMatch(/\bwill win\b|\bbad faith\b/i);
  });

  it("does not inject motions context for unrelated questions", () => {
    expect(isMotionsCommunicationsAskQuestion("What is on the calendar next week?")).toBe(false);
    expect(
      buildMotionsCommunicationsAskContextBlock({
        question: "What is on the calendar next week?",
        review,
      }),
    ).toBeNull();
  });

  it("wires motions/comms merge into askNyayaAboutMatter", () => {
    const src = readNyayaSrc();
    expect(src).toContain("buildMotionsCommunicationsAskContextBlock");
    expect(src).toContain("loadMatterMotionsCommunicationsReview");
    expect(src).toContain("motionsCommsContextText");
    const merged = mergeAskContextText("WEEK4", null, null, null, "MOTIONS_COMMUNICATIONS_REVIEW");
    expect(merged).toContain("MOTIONS_COMMUNICATIONS_REVIEW");
  });
});
