import { describe, expect, it } from "vitest";
import {
  investigateEmptyMessage,
  investigateSourceMapToDrawerItems,
  parseInvestigateNextForCards,
  parseMatterSynthesisForCards,
  turnGapIntoTaskPhrase,
} from "./command-center-ux";

const sampleGaps = {
  posture: "RESOLVED",
  gaps: [
    {
      id: "gap-1",
      priority: "HIGH",
      priorityRationale: "Referenced by both parties",
      gapType: "MISSING_EVIDENCE",
      title: "Missing inspection attachment",
      description: "Email references an attachment that is not in the record.",
      whyItMatters: "May resolve timeline conflict.",
      recommendedNextStep: "Locate the inspection report attached to the email.",
      relatedDomain: "EVIDENCE",
      expectedEvidenceType: "inspection report",
      impact: "HIGH",
      effort: "LOW",
      status: "OPEN",
      factuality: "SUPPORTED_INFERENCE",
      sourceMap: [
        { kind: "document", id: "doc-1", label: "Email thread" },
        { kind: "chunk", id: "chunk-1", label: "Passage" },
      ],
    },
    {
      id: "gap-2",
      priority: "MEDIUM",
      gapType: "TIMELINE_GAP",
      title: "Unclear notice date",
      whyItMatters: "Affects claim readiness.",
      recommendedNextStep: "Confirm the notice mailing date.",
      factuality: "UNKNOWN",
      sourceMap: [],
    },
    {
      id: "gap-3",
      priority: "LOW",
      title: "Optional witness contact",
      factuality: "FACT",
      sourceMap: [{ kind: "document", id: "doc-2" }],
    },
  ],
  limitations: ["Derived from structured matter records only."],
};

describe("Week 3 Slice 3 structured Command Center helpers", () => {
  it("1–12. investigate cards parse priorities, fields, and preserve backend order", () => {
    const parsed = parseInvestigateNextForCards(sampleGaps);
    expect(parsed).not.toBeNull();
    expect(parsed!.gaps).toHaveLength(3);
    expect(parsed!.gaps.map((g) => g.id)).toEqual(["gap-1", "gap-2", "gap-3"]);
    expect(parsed!.gaps.map((g) => g.displayIndex)).toEqual([1, 2, 3]);
    expect(parsed!.gaps[0]!.priority).toBe("HIGH");
    expect(parsed!.gaps[1]!.priority).toBe("MEDIUM");
    expect(parsed!.gaps[2]!.priority).toBe("LOW");
    expect(parsed!.gaps[0]!.priorityRationale).toMatch(/both parties/);
    expect(parsed!.gaps[0]!.gapType).toBe("MISSING_EVIDENCE");
    expect(parsed!.gaps[0]!.whyItMatters).toMatch(/timeline/);
    expect(parsed!.gaps[0]!.recommendedNextStep).toMatch(/inspection/);
    expect(parsed!.gaps[0]!.factuality).toBe("SUPPORTED_INFERENCE");
    // #2 order continuity
    expect(parsed!.gaps[1]!.displayIndex).toBe(2);
    expect(parsed!.gaps[1]!.id).toBe("gap-2");
    expect(turnGapIntoTaskPhrase(2)).toBe("turn #2 into a task");
  });

  it("9. optional empty fields hidden (not coerced to placeholders)", () => {
    const parsed = parseInvestigateNextForCards({
      gaps: [{ id: "gap-1", title: "Only title", description: "", whyItMatters: null, sourceMap: [] }],
    });
    expect(parsed!.gaps[0]!.description).toBeUndefined();
    expect(parsed!.gaps[0]!.whyItMatters).toBeUndefined();
    expect(parsed!.gaps[0]!.recommendedNextStep).toBeUndefined();
  });

  it("13–15. source count / drawer refs; no fake sources when empty", () => {
    const parsed = parseInvestigateNextForCards(sampleGaps)!;
    expect(parsed.gaps[0]!.sourceMap).toHaveLength(2);
    const items = investigateSourceMapToDrawerItems(parsed.gaps[0]!.sourceMap);
    expect(items).toHaveLength(2);
    expect(items[0]!.documentId).toBe("doc-1");
    expect(items[1]!.chunkId).toBe("chunk-1");
    expect(investigateSourceMapToDrawerItems(parsed.gaps[1]!.sourceMap)).toHaveLength(0);
  });

  it("16–19. task CTA phrase feeds preview path (no write, no due date)", () => {
    expect(turnGapIntoTaskPhrase(1)).toBe("turn #1 into a task");
    expect(turnGapIntoTaskPhrase(1)).not.toMatch(/due|deadline|write/i);
  });

  it("20–30. matter synthesis sections; recent changes only if present; no win/credibility", () => {
    const model = parseMatterSynthesisForCards({
      coreIssues: ["Notice"],
      strongestSupported: ["Breach element supported"],
      weakestAreas: ["Damages UNKNOWN"],
      keyFacts: ["Email sent March 1"],
      keyEvidence: ["doc-ev-1"],
      keyPeople: ["Alex"],
      conflicts: ["Parties disagree on receipt date"],
      unknowns: ["Exact mailing time"],
      claimReadiness: [{ label: "Breach", readiness: "PARTIALLY_SUPPORTED", openGaps: ["damages"] }],
      defenseReadiness: [{ label: "Waiver", readiness: "UNSUPPORTED" }],
      recentChanges: ["New contradiction on notice"],
      investigateNextTitles: ["Locate attachment"],
      limitations: ["No win probabilities."],
      winProbability: 0,
      credibilityScoring: 0,
    });
    expect(model).not.toBeNull();
    expect(model!.coreIssues).toEqual(["Notice"]);
    expect(model!.strongestSupported[0]).toMatch(/Breach/);
    expect(model!.weakestAreas[0]).toMatch(/Damages/);
    expect(model!.keyFacts).toHaveLength(1);
    expect(model!.keyEvidence).toEqual(["doc-ev-1"]);
    expect(model!.keyPeople).toEqual(["Alex"]);
    expect(model!.conflicts[0]).not.toMatch(/ly|falsehood|dishonest/i);
    expect(model!.unknowns).toHaveLength(1);
    expect(model!.claimReadiness[0]!.readiness).toBe("PARTIALLY_SUPPORTED");
    expect(model!.defenseReadiness[0]!.readiness).toBe("UNSUPPORTED");
    expect(model!.recentChanges).toHaveLength(1);
    // Must not expose win/credibility as usable card fields
    expect(Object.keys(model!)).not.toContain("winProbability");
    expect(Object.keys(model!)).not.toContain("credibilityScoring");
  });

  it("30. recent changes omitted when absent", () => {
    const model = parseMatterSynthesisForCards({
      coreIssues: ["Notice"],
      recentChanges: [],
    });
    expect(model!.recentChanges).toEqual([]);
  });

  it("33–34. empty investigate + partial validation safe", () => {
    const empty = parseInvestigateNextForCards({ posture: "NO_MATERIAL_GAP", gaps: [] });
    expect(empty!.gaps).toHaveLength(0);
    expect(investigateEmptyMessage(empty!.posture)).toMatch(/No additional high-priority/);
    expect(parseInvestigateNextForCards(null)).toBeNull();
    expect(parseInvestigateNextForCards({ gaps: [{ id: 1 }] })).toBeNull();
    expect(parseMatterSynthesisForCards({})).toBeNull();
    expect(parseMatterSynthesisForCards("x")).toBeNull();
  });

  it("35–36. history hydration uses same parsers as live SSE snapshots", () => {
    const fromValidation = parseInvestigateNextForCards(sampleGaps);
    const fromUx = parseInvestigateNextForCards({ ...sampleGaps });
    expect(fromValidation!.gaps.map((g) => g.id)).toEqual(fromUx!.gaps.map((g) => g.id));
  });

  it("40. no client-side priority/factuality recomputation", () => {
    const parsed = parseInvestigateNextForCards({
      gaps: [
        { id: "gap-1", title: "A", priority: "LOW", factuality: "CONFLICT", sourceMap: [] },
        { id: "gap-2", title: "B", priority: "HIGH", factuality: "FACT", sourceMap: [] },
      ],
    })!;
    // Order preserved even when LOW precedes HIGH
    expect(parsed.gaps.map((g) => g.priority)).toEqual(["LOW", "HIGH"]);
    expect(parsed.gaps.map((g) => g.factuality)).toEqual(["CONFLICT", "FACT"]);
  });
});
