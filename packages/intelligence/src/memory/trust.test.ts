import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatActiveMemoryForPrompt } from "./index";
import {
  chunkSupportsMemoryProposition,
  filterSupportingMemoryChunkIds,
  isDownstreamEligibleMemory,
  memoriesEligibleForDownstreamPrompt,
  memoryPromptTrustLabel,
  memoryTypeForUnsupportedAiClaim,
  resolveMemoryCreateConfidence,
  resolveMemoryCreateStatus,
} from "./trust";

describe("Memory trust invariant: storage != verification", () => {
  it("A. manual memory defaults to proposed, not approved", () => {
    expect(resolveMemoryCreateStatus({ origin: "manual" })).toBe("proposed");
  });

  it("B. proposed memory is not downstream-eligible", () => {
    expect(isDownstreamEligibleMemory({ status: "proposed" })).toBe(false);
    expect(
      memoriesEligibleForDownstreamPrompt([{ status: "proposed", title: "x" }]),
    ).toEqual([]);
  });

  it("C. explicitly approved manual memory is eligible", () => {
    expect(resolveMemoryCreateStatus({ origin: "manual", status: "approved" })).toBe("approved");
    expect(isDownstreamEligibleMemory({ status: "approved", supersededBy: null })).toBe(true);
  });

  it("D. origin survives formatting of approved memory", () => {
    const text = formatActiveMemoryForPrompt([
      {
        title: "Client payment statement",
        content: "Client says payment was made on Friday.",
        memoryType: "user_instruction",
        importance: "normal",
        origin: "manual",
        status: "approved",
        sourceReference: {},
      },
      {
        title: "Notice period",
        content: "Amendment 1 requires 30 days' notice.",
        memoryType: "verified_context",
        importance: "high",
        origin: "ai",
        status: "approved",
        sourceReference: { chunkIds: ["c1"] },
      },
    ]);
    expect(text).toContain("reviewed user-provided information");
    expect(text).toContain("reviewed AI-derived memory with cited sources");
    expect(text).not.toMatch(/source verified/i);
  });

  it("E. memoryType=verified_context does not auto-approve", () => {
    expect(
      resolveMemoryCreateStatus({
        origin: "manual",
        memoryType: "verified_context",
      }),
    ).toBe("proposed");
  });

  it("F. high confidence does not auto-approve", () => {
    expect(
      resolveMemoryCreateStatus({
        origin: "ai",
        memoryType: "verified_context",
        confidence: "high",
      }),
    ).toBe("proposed");
    expect(resolveMemoryCreateConfidence({ origin: "manual", confidence: "high" })).toBe("high");
    expect(resolveMemoryCreateConfidence({ origin: "manual" })).toBe("medium");
  });

  it("G. AI memory stays proposed by default", () => {
    expect(resolveMemoryCreateStatus({ origin: "ai" })).toBe("proposed");
  });

  it("H. agent-created memory stays proposed unless status is explicit", () => {
    expect(
      resolveMemoryCreateStatus({
        origin: "ai",
        memoryType: "verified_context",
        confidence: "high",
      }),
    ).toBe("proposed");
  });

  it("I. rejected memory is excluded", () => {
    expect(isDownstreamEligibleMemory({ status: "rejected" })).toBe(false);
  });

  it("J. superseded memory is excluded", () => {
    expect(isDownstreamEligibleMemory({ status: "superseded", supersededBy: null })).toBe(false);
    expect(
      isDownstreamEligibleMemory({ status: "approved", supersededBy: "newer-id" }),
    ).toBe(false);
  });

  it("K. edited_and_approved memory is eligible", () => {
    expect(isDownstreamEligibleMemory({ status: "edited_and_approved" })).toBe(true);
  });

  it("L. unknown provenance stays empty", () => {
    expect(
      filterSupportingMemoryChunkIds({
        title: "Hint",
        content: "No service credit was ever issued.",
        claimedChunkIds: [],
        chunks: [{ id: "c1", content: "Original agreement term is 60 days." }],
      }),
    ).toEqual([]);
  });

  it("M. arbitrary first-chunk fallback is removed", () => {
    expect(
      filterSupportingMemoryChunkIds({
        title: "Hint",
        content: "No service credit was ever issued.",
        claimedChunkIds: ["c1"],
        chunks: [{ id: "c1", content: "The parties agree to a 60-day notice period." }],
      }),
    ).toEqual([]);
  });

  it("N. badge activity does not support named-person physical entry", () => {
    expect(
      chunkSupportsMemoryProposition(
        "Mercer entered the records room.",
        "ACCESS GRANTED. Badge 4412 assigned to Mercer recorded activity at the records room reader.",
      ),
    ).toBe(false);
  });

  it("O. invoice silence does not establish universal absence", () => {
    expect(
      chunkSupportsMemoryProposition(
        "No service credit was ever issued.",
        "No service credits reflected on this invoice.",
      ),
    ).toBe(false);
  });

  it("P. false retroactivity assertion is not formatted as source fact while unreviewed", () => {
    const text = formatActiveMemoryForPrompt([
      {
        title: "Retroactive amendment",
        content: "The amendment applied retroactively.",
        memoryType: "verified_context",
        importance: "normal",
        origin: "manual",
        status: "proposed",
      },
    ]);
    expect(text).toBe("");
    expect(memoryPromptTrustLabel({ origin: "manual", sourceReference: {} })).toBe(
      "reviewed user-provided information",
    );
  });

  it("Q. formatter does not call unreviewed manual content approved", () => {
    const text = formatActiveMemoryForPrompt([
      {
        title: "Records room entry",
        content: "Mercer entered the records room.",
        memoryType: "verified_context",
        importance: "normal",
        origin: "manual",
        status: "proposed",
      },
    ]);
    expect(text).not.toContain("Approved Matter Memory");
    expect(text).not.toContain("Mercer entered");
  });

  it("does not treat unsupported AI verified_context as sourced", () => {
    expect(memoryTypeForUnsupportedAiClaim("verified_context", [])).toBe("other");
    expect(memoryTypeForUnsupportedAiClaim("verified_context", ["c1"])).toBe("verified_context");
  });
});

describe("Memory → Graph boundary", () => {
  it("does not import Memory tables into Graph materialization", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../graph");
    const materialize = readFileSync(path.join(root, "materialize.ts"), "utf8");
    const index = readFileSync(path.join(root, "index.ts"), "utf8");
    expect(materialize).not.toMatch(/matterMemories|createMatterMemory|retrieveActiveMatterMemories/);
    expect(index).not.toMatch(/matterMemories|createMatterMemory|retrieveActiveMatterMemories/);
  });
});
