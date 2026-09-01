import { describe, expect, it } from "vitest";
import {
  applyComparisonSummaryAlignmentPolicy,
  computeParagraphDiffs,
} from "./draft/helpers";
import {
  classifyChangeAttention,
  computeClauseDiffs,
  parseAmendmentOperations,
} from "./analysis/clause-compare";

describe("clause-level compare", () => {
  it("treats a duration change as modified high-attention with before/after values", () => {
    const changes = computeParagraphDiffs(
      "4. Notice\nFormal notice requires 45 days.",
      "4. Notice\nFormal notice requires 30 days.",
    );
    const row = changes.find((change) => change.changeType === "changed");
    expect(row).toBeTruthy();
    expect(row?.oldText).toMatch(/45/);
    expect(row?.newText).toMatch(/30/);
    expect(row?.attention).toBe("high_attention");
  });

  it("treats a money/cap change as modified high-attention", () => {
    const changes = computeParagraphDiffs(
      "9. Liability\nAggregate contractual liability will not exceed $255,000.",
      "9. Liability\nAggregate contractual liability will not exceed $510,000.",
    );
    const row = changes.find((change) => change.changeType === "changed");
    expect(row?.oldText).toMatch(/255,000/);
    expect(row?.newText).toMatch(/510,000/);
    expect(row?.attention).toBe("high_attention");
  });

  it("treats a spelling correction as non-material formatting", () => {
    const changes = computeParagraphDiffs(
      "Notices may recieve electronic copies as a courtesy.",
      "Notices may receive electronic copies as a courtesy.",
    );
    expect(changes.every((change) => change.attention !== "high_attention")).toBe(true);
    expect(changes.some((change) => change.changeType === "formatting")).toBe(true);
  });

  it("treats exhibit renumbering without substance change as non-material", () => {
    const changes = computeParagraphDiffs(
      "Performance is described in Exhibit A.",
      "Performance is described in Exhibit B.",
    );
    expect(changes.every((change) => change.attention !== "high_attention")).toBe(true);
    expect(changes.some((change) => change.changeType === "moved" || change.changeType === "formatting" || change.changeType === "changed")).toBe(true);
  });

  it("treats section renumbering with equivalent content as moved/non-material", () => {
    const changes = computeParagraphDiffs(
      "Section 7.2 — Notice\nFormal notice requires 30 days.",
      "Section 8.2 — Notice\nFormal notice requires 30 days.",
    );
    expect(changes.every((change) => change.attention !== "high_attention")).toBe(true);
    expect(changes.some((change) => change.changeType === "moved" || change.changeType === "formatting")).toBe(true);
  });

  it("does not normalize away may vs shall", () => {
    const changes = computeParagraphDiffs(
      "The tenant may assign the agreement with consent.",
      "The tenant shall assign the agreement with consent.",
    );
    const row = changes.find((change) => change.changeType === "changed" || change.changeType === "formatting");
    expect(row).toBeTruthy();
    expect(row?.attention).toBe("high_attention");
    expect(`${row?.oldText} ${row?.newText}`).toMatch(/\bmay\b/i);
    expect(`${row?.oldText} ${row?.newText}`).toMatch(/\bshall\b/i);
  });

  it("does not normalize away insertion or removal of not", () => {
    const changes = computeParagraphDiffs(
      "The tenant may assign the agreement.",
      "The tenant may not assign the agreement.",
    );
    expect(changes.some((change) => change.attention === "high_attention")).toBe(true);
  });

  it("treats an added substantive obligation as material", () => {
    const changes = computeParagraphDiffs(
      "1. Records\nEach party must retain records for four years.",
      "1. Records\nEach party must retain records for four years.\n\n2. Insurance\nParty B shall maintain insurance of $1,000,000.",
    );
    expect(changes.some((change) => change.changeType === "added" && change.attention === "high_attention")).toBe(
      true,
    );
  });

  it("treats a removed substantive obligation as material", () => {
    const changes = computeParagraphDiffs(
      "1. Records\nEach party must retain records for four years.\n\n2. Insurance\nParty B shall maintain insurance of $1,000,000.",
      "1. Records\nEach party must retain records for four years.",
    );
    expect(changes.some((change) => change.changeType === "removed" && change.attention === "high_attention")).toBe(
      true,
    );
  });

  it("splits numbered clauses inside a page-sized block with repeating filler", () => {
    const filler = Array.from({ length: 8 }, (_, i) =>
      `General Provision GP-${String(i + 1).padStart(2, "0")}\nFor purposes of this agreement, the parties will maintain complete written records. No statement in this general provision modifies a specific commercial term unless an amendment expressly identifies the affected section. Headings are for convenience only.`,
    ).join("\n");
    const original = [
      "1. Parties\nThis agreement is between Party A and Party B.",
      "4. Notice\nExcept where a later amendment provides otherwise, formal notice requires 45 days.",
      "9. Liability\nAggregate contractual liability will not exceed $255,000.",
      filler,
    ].join("\n");
    const amendment = [
      "Amendment No. 1",
      "Section 4 is deleted and replaced. Formal notice now requires 30 days.",
      "Section 9 is amended so the aggregate liability cap is $510,000.",
      'Exhibit A is renumbered Exhibit B and the word "recieve" is corrected to "receive".',
      filler,
    ].join("\n");
    const changes = computeClauseDiffs(original, amendment);
    expect(changes.some((change) => (change.oldText ?? "").includes("45") && (change.newText ?? "").includes("30"))).toBe(
      true,
    );
    expect(
      changes.some((change) => (change.oldText ?? "").includes("255,000") && (change.newText ?? "").includes("510,000")),
    ).toBe(true);
    expect(changes.filter((change) => change.attention === "high_attention").every((change) => (change.oldText ?? "").length < 1500)).toBe(
      true,
    );
  });

  it("maps amendment replace/amend language onto the affected original sections", () => {
    const original = [
      "1. Parties\nThis agreement is between Party A and Party B.",
      "4. Notice\nExcept where a later amendment provides otherwise, formal notice requires 45 days.",
      "9. Liability\nAggregate contractual liability will not exceed $255,000.",
    ].join("\n\n");
    const amendment = [
      "Amendment No. 1",
      "Section 4 is deleted and replaced. Formal notice now requires 30 days. All other provisions remain unchanged except as expressly stated.",
      "Section 9 is amended so the aggregate liability cap is $510,000. This revision is substantive.",
      'Exhibit A is renumbered Exhibit B and the word "recieve" is corrected to "receive". These administrative corrections do not change substantive obligations.',
    ].join("\n\n");
    const ops = parseAmendmentOperations(amendment);
    expect(ops.some((op) => op.kind === "replace_section" && op.section === "4")).toBe(true);
    expect(ops.some((op) => op.kind === "amend_section" && op.section === "9")).toBe(true);
    expect(ops.some((op) => op.kind === "renumber_exhibit")).toBe(true);
    expect(ops.some((op) => op.kind === "spelling")).toBe(true);

    const changes = computeClauseDiffs(original, amendment);
    const notice = changes.find((change) => (change.oldText ?? "").includes("45") && (change.newText ?? "").includes("30"));
    const cap = changes.find(
      (change) => (change.oldText ?? "").includes("255,000") && (change.newText ?? "").includes("510,000"),
    );
    const exhibit = changes.find((change) => /exhibit a/i.test(`${change.oldText} ${change.newText}`));
    const typo = changes.find((change) => /recieve/i.test(`${change.oldText} ${change.newText}`));
    expect(notice?.attention).toBe("high_attention");
    expect(cap?.attention).toBe("high_attention");
    expect(exhibit?.attention).not.toBe("high_attention");
    expect(typo?.attention).not.toBe("high_attention");
    expect(Math.max(...changes.map((change) => (change.oldText ?? "").length))).toBeLessThan(2000);
  });

  it("rewrites a summary that denies substantive structured changes", () => {
    const changes = computeParagraphDiffs(
      "4. Notice\nFormal notice requires 45 days.",
      "4. Notice\nFormal notice requires 30 days.",
    );
    const applied = applyComparisonSummaryAlignmentPolicy("No substantive changes to obligations or agreements.", changes);
    expect(applied.summary).not.toMatch(/no substantive/i);
    expect(applied.score.alignment).toBe("aligned");
    expect(applied.summary).toMatch(/45|30/);
  });

  it("keeps may/shall tokens out of match-only normalization", () => {
    expect(classifyChangeAttention("Party may terminate.", "Party shall terminate.", "changed")).toBe(
      "high_attention",
    );
  });
});
