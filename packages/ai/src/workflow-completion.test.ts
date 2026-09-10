import { describe, expect, it } from "vitest";
import {
  auditWorkflowObligations,
  extractPartiesFromAgreementText,
  extractUnresolvedMeetingDateConflict,
  formatUnavailableObligations,
} from "./workflow-completion";

describe("workflow completion inventory", () => {
  it("extracts parties from the agreement and does not invent names", () => {
    expect(
      extractPartiesFromAgreementText(
        "Governing law: CA.\nParties: Harborline Labs Inc and Sana Iyer.\nSection 4. Payment.",
      ),
    ).toEqual(["Harborline Labs Inc", "Sana Iyer"]);
    expect(extractPartiesFromAgreementText("No party line here.")).toEqual([]);
  });

  it("preserves both meeting dates and ignores amendment effective dates", () => {
    const conflict = extractUnresolvedMeetingDateConflict([
      "Amendment No. 1 signed 2026-06-15, effective 2026-10-15.",
      "Meeting minutes: file-review meeting on 2026-02-19.",
      "Unsigned hallway observer: the meeting was on 2026-03-08, not 2026-02-19.",
    ]);
    expect(conflict).toMatch(/2026-02-19/);
    expect(conflict).toMatch(/2026-03-08/);
    expect(conflict).not.toMatch(/2026-10-15/);
  });

  it("marks missing parties as not established instead of silently omitting them", () => {
    const audit = auditWorkflowObligations({
      parties: ["Harborline Labs Inc", "Sana Iyer"],
      factsText: "Sana Iyer hourly rate",
      entityText: "Sana Iyer person",
      contradictionText: "Sources conflict on 2026-02-19 versus 2026-03-08.",
      draftText: "Internal memo.",
      stepsCompleted: true,
      completedStepCount: 12,
      requiredStepCount: 12,
    });
    expect(audit.silentOmissions).toContain("party:Harborline Labs Inc");
    expect(audit.obligations.find((o) => o.id === "party:Harborline Labs Inc")?.status).toBe(
      "not_established",
    );
    expect(formatUnavailableObligations(audit)).toMatch(/Harborline Labs Inc is not established/);
  });

  it("does not fabricate completion when a required step is missing", () => {
    const audit = auditWorkflowObligations({
      parties: ["A Co", "B Co"],
      factsText: "A Co B Co",
      entityText: "A Co B Co",
      contradictionText: "conflict 2026-01-01 versus 2026-02-02 unresolved",
      draftText: "",
      stepsCompleted: false,
      completedStepCount: 10,
      requiredStepCount: 12,
    });
    expect(audit.silentOmissions).toEqual(expect.arrayContaining(["workflow_steps", "draft"]));
    expect(audit.obligations.find((o) => o.id === "draft")?.status).toBe("unavailable");
  });
});
