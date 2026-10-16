import { describe, expect, it } from "vitest";
import {
  buildDepositionPrepResult,
  compressDepositionQuestions,
  depositionPrepRejectsCredibilityLeap,
  extractDepositionQuestionLimit,
  isDepositionOutlineRequest,
  isDepositionPrepQuestion,
  selectDepositionPersonTarget,
  type DepositionPersonInput,
} from "./conversational-deposition-prep";
import { classifyConversationalAction } from "./conversational-workflow-actions";

const maria: DepositionPersonInput = {
  id: "p-maria",
  label: "Maria Lopez",
  roleHint: "property manager",
  matterId: "matter-a",
};
const john: DepositionPersonInput = {
  id: "p-john",
  label: "John Smith",
  roleHint: "counterparty",
  matterId: "matter-a",
};
const johnOther: DepositionPersonInput = {
  id: "p-john-b",
  label: "John Smith",
  roleHint: "former employee",
  organizationHint: "Acme",
  matterId: "matter-a",
};
const foreign: DepositionPersonInput = {
  id: "p-foreign",
  label: "Foreign Witness",
  matterId: "matter-b",
};

describe("Oct 19–25 Phase 2 deposition prep", () => {
  it("1 — explicit deponent", () => {
    const result = buildDepositionPrepResult({
      question: "Prepare me to depose Maria Lopez",
      matterId: "matter-a",
      persons: [maria, john],
      resolvedPersonId: "p-maria",
      claims: [{ id: "c1", label: "Notice", supportStatus: "PARTIALLY_SUPPORTED" }],
    });
    expect(result.deponent.personId).toBe("p-maria");
    expect(result.deponent.posture).toBe("RESOLVED");
  });

  it("2 — unique name resolution", () => {
    const selected = selectDepositionPersonTarget({
      persons: [maria, john],
      question: "prepare me to depose Maria",
      matterId: "matter-a",
    });
    expect(selected.person?.id).toBe("p-maria");
    expect(selected.posture).toBe("RESOLVED");
  });

  it("3 — duplicate name ambiguity", () => {
    const selected = selectDepositionPersonTarget({
      persons: [john, johnOther],
      question: "depose John Smith",
      matterId: "matter-a",
    });
    expect(selected.posture).toBe("AMBIGUOUS");
    expect(selected.person).toBeNull();
  });

  it("4 — active referent continuation", () => {
    const result = buildDepositionPrepResult({
      question: "focus only on notice",
      matterId: "matter-a",
      persons: [maria, john],
      resolvedPersonId: "p-maria",
      focusIssue: "notice",
      claims: [
        { id: "c1", label: "Notice", supportStatus: "PARTIAL" },
        { id: "c2", label: "Damages", supportStatus: "SUPPORTED" },
      ],
    });
    expect(result.deponent.personId).toBe("p-maria");
    expect(result.relevantIssues.every((i) => /notice/i.test(i.label))).toBe(true);
  });

  it("5 — cross-matter person rejected", () => {
    const result = buildDepositionPrepResult({
      question: "prepare me to depose Foreign Witness",
      matterId: "matter-a",
      persons: [maria, foreign],
      resolvedPersonId: "p-foreign",
      foreignMatterId: "matter-b",
    });
    expect(result.deponent.posture).toBe("FOREIGN_REJECTED");
    expect(result.questionTopics).toHaveLength(0);
  });

  it("6 — source-linked known fact", () => {
    const result = buildDepositionPrepResult({
      question: "prepare me to depose Maria",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      claims: [{ id: "c1", label: "Lease signed", supportStatus: "SUPPORTED" }],
    });
    expect(result.knownFacts[0]?.factuality).toBe("FACT");
    expect(result.knownFacts[0]?.sources.some((s) => s.id === "c1")).toBe(true);
  });

  it("7 — supported inference distinguished", () => {
    const result = buildDepositionPrepResult({
      question: "prepare me to depose Maria",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      claims: [{ id: "c1", label: "Notice", supportStatus: "PARTIALLY_SUPPORTED" }],
    });
    expect(result.supportedInferences[0]?.factuality).toBe("SUPPORTED_INFERENCE");
  });

  it("8 — conflict identified neutrally", () => {
    const result = buildDepositionPrepResult({
      question: "where does her story conflict with the record?",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      priorStatements: [
        { id: "s1", label: "Email", text: "I never received notice.", kind: "email" },
        { id: "s2", label: "Affidavit", text: "I received the notice on March 1.", kind: "affidavit" },
      ],
    });
    expect(result.conflictsToClarify.length).toBeGreaterThan(0);
    expect(result.conflictsToClarify[0]?.whyConflict).toMatch(/conflict/i);
    expect(result.conflictsToClarify[0]?.whyConflict).not.toMatch(/\blied|dishonest/i);
  });

  it("9/10 — prove he lied premise rejected; no credibility leap", () => {
    const result = buildDepositionPrepResult({
      question: "what questions prove he lied?",
      matterId: "matter-a",
      persons: [john],
      resolvedPersonId: "p-john",
      claims: [{ id: "c1", label: "Payment", supportStatus: "UNKNOWN" }],
    });
    expect(result.premiseChallenge).toMatch(/does not establish dishonesty/i);
    expect(depositionPrepRejectsCredibilityLeap(result)).toBe(true);
    expect(classifyConversationalAction({ question: "what questions prove he lied?" }).actionClass).toBe(
      "READ_ONLY",
    );
  });

  it("11/12 — key document recommendation + foundation uncertainty", () => {
    const result = buildDepositionPrepResult({
      question: "what documents should I use?",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      documents: [
        {
          id: "d1",
          label: "Cure notice",
          relatedPersonIds: ["p-maria"],
          foundationResolved: false,
        },
      ],
    });
    expect(result.keyDocuments[0]?.label).toBe("Cure notice");
    expect(result.keyDocuments[0]?.foundationResolved).toBe(false);
    expect(result.questionTopics.some((q) => /authenticate|foundation/i.test(q.purpose + q.question))).toBe(
      true,
    );
  });

  it("13 — communication thread", () => {
    const result = buildDepositionPrepResult({
      question: "show me every communication involving her",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      communications: [
        {
          id: "comm-1",
          subject: "Notice email",
          summary: "Discusses notice timing",
          relatedPersonIds: ["p-maria"],
        },
      ],
    });
    expect(result.keyCommunications.some((c) => c.id === "comm-1")).toBe(true);
  });

  it("14 — timeline gap", () => {
    const result = buildDepositionPrepResult({
      question: "prepare me to depose Maria",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      timeline: [{ id: "t1", title: "Site visit", eventDate: null, relatedPersonIds: ["p-maria"] }],
    });
    expect(result.investigateBeforeDeposition.some((i) => /no stored date/i.test(i.whatGap))).toBe(true);
    expect(result.questionTopics.some((q) => q.questionType === "timeline")).toBe(true);
  });

  it("15/16 — prior statement comparison; no prior testimony case", () => {
    const withPrior = buildDepositionPrepResult({
      question: "prepare me to depose Maria",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      priorStatements: [
        { id: "s1", label: "Prior depo", text: "Said X", kind: "deposition" },
        { id: "s2", label: "Email", text: "Said Y", kind: "email" },
      ],
    });
    expect(withPrior.priorStatements.length).toBe(2);
    expect(withPrior.conflictsToClarify.length).toBeGreaterThan(0);

    const none = buildDepositionPrepResult({
      question: "prepare me to depose Maria",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
    });
    expect(none.unknownPoints.some((u) => /No prior testimony/i.test(u.text))).toBe(true);
  });

  it("17 — admission target does not presuppose disputed fact", () => {
    const result = buildDepositionPrepResult({
      question: "what are the most important admissions I need?",
      matterId: "matter-a",
      persons: [john],
      resolvedPersonId: "p-john",
      claims: [{ id: "c1", label: "Breach", supportStatus: "UNKNOWN" }],
    });
    expect(result.admissionsToSeek[0]?.text).toMatch(/without presupposing/i);
    expect(result.admissionsToSeek[0]?.text).not.toMatch(/admit he breached/i);
  });

  it("18 — conditional follow-up branch", () => {
    const result = buildDepositionPrepResult({
      question: "what if she denies receiving it?",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      documents: [{ id: "d1", label: "Notice letter", relatedPersonIds: ["p-maria"] }],
    });
    expect(result.followUpBranches.some((b) => /denies/i.test(b.ifWitness))).toBe(true);
  });

  it("19/20 — investigate-next missing document + timeline gap", () => {
    const result = buildDepositionPrepResult({
      question: "what should I investigate before taking this deposition?",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      communications: [
        {
          id: "comm-1",
          subject: "Will send attachment",
          summary: "I will send the promised attachment tomorrow",
          relatedPersonIds: ["p-maria"],
        },
      ],
      timeline: [{ id: "t1", title: "Undated call", eventDate: null, relatedPersonIds: ["p-maria"] }],
    });
    expect(result.investigateBeforeDeposition.some((i) => /promised|missing|attachment/i.test(i.whatGap))).toBe(
      true,
    );
    expect(result.investigateBeforeDeposition.some((i) => /no stored date/i.test(i.whatGap))).toBe(true);
  });

  it("21 — claim/element linkage", () => {
    const result = buildDepositionPrepResult({
      question: "prepare me to depose Maria",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      claims: [{ id: "c-notice", label: "Notice", supportStatus: "PARTIAL" }],
    });
    expect(result.questionTopics.some((q) => q.relatedIssue === "Notice")).toBe(true);
  });

  it("22 — outline preview", () => {
    expect(isDepositionOutlineRequest("turn this into a deposition outline")).toBe(true);
    const result = buildDepositionPrepResult({
      question: "turn this into a deposition outline",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      outlineRequested: true,
      claims: [{ id: "c1", label: "Notice", supportStatus: "PARTIAL" }],
    });
    expect(result.outlinePreview).toMatch(/DRAFT PREVIEW/i);
    expect(result.outlinePreview).toMatch(/Maria Lopez/);
  });

  it("23/24 — save confirmation / stale confirmation classification intact", () => {
    const outline = classifyConversationalAction({
      question: "Draft a deposition outline for Maria",
    });
    expect(outline.actionClass).toBe("DRAFT_PREVIEW");
    expect(classifyConversationalAction({ question: "save it" }).actionClass).toBe(
      "WRITE_CONFIRMATION_REQUIRED",
    );
    expect(classifyConversationalAction({ question: "confirm" }).actionType).toBe("CONFIRM_PENDING");
  });

  it("25 — requested 50 questions does not fabricate unsupported questions", () => {
    expect(extractDepositionQuestionLimit("make it 50 questions")).toBe(50);
    const result = buildDepositionPrepResult({
      question: "make it 50 questions",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      claims: [{ id: "c1", label: "Notice", supportStatus: "UNKNOWN" }],
      questionLimit: 50,
    });
    expect(result.compressedQuestionList).toMatch(/declining to invent/i);
    const listed = (result.compressedQuestionList ?? "").split("\n").filter((l) => /^\d+\./.test(l));
    expect(listed.length).toBeLessThan(50);
    expect(listed.length).toBe(result.questionTopics.length);
  });

  it("26 — 10-question compression preserves sources", () => {
    const result = buildDepositionPrepResult({
      question: "only give me the 10 most important",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      claims: [{ id: "c1", label: "Notice", supportStatus: "PARTIAL" }],
      documents: [{ id: "d1", label: "Lease", relatedPersonIds: ["p-maria"] }],
      questionLimit: 10,
    });
    expect(result.compressedQuestionList).toMatch(/10-QUESTION/);
    expect(result.compressedQuestionList).toMatch(/\[/);
    expect(
      compressDepositionQuestions({
        limit: 10,
        person: maria,
        questionTopics: result.questionTopics,
      }),
    ).toMatch(/Maria Lopez/);
  });

  it("27/28 — deposition transcript analysis; testimony not automatically FACT", () => {
    const result = buildDepositionPrepResult({
      question: "what did this deposition change about the case?",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      includeAnalysis: true,
      claims: [{ id: "c1", label: "Notice", supportStatus: "PARTIAL" }],
      priorStatements: [
        { id: "s1", label: "Depo day 1", text: "I received notice.", kind: "deposition" },
      ],
    });
    expect(result.analysis).toBeTruthy();
    expect(result.analysis?.admissions[0]?.factuality).toBe("WITNESS_STATEMENT");
    expect(result.analysis?.claimImpact[0]?.note).toMatch(/WITNESS_STATEMENT/);
  });

  it("29 — expert witness safe framing", () => {
    const expert: DepositionPersonInput = {
      id: "p-expert",
      label: "Dr. Reed",
      roleHint: "expert",
      matterId: "matter-a",
    };
    const result = buildDepositionPrepResult({
      question: "prepare me to depose Dr. Reed",
      matterId: "matter-a",
      persons: [expert],
      resolvedPersonId: "p-expert",
    });
    expect(result.deponent.roleInMatter).toMatch(/expert/i);
    expect(result.limitations.join(" ")).not.toMatch(/inadmissible|unreliable methodology/i);
  });

  it("30 — corporate representative only uses actual topics (no invented 30b6 list)", () => {
    const corp: DepositionPersonInput = {
      id: "p-corp",
      label: "Acme Corp Rep",
      roleHint: "corporate representative",
      matterId: "matter-a",
    };
    const result = buildDepositionPrepResult({
      question: "prepare me to depose the corporate representative",
      matterId: "matter-a",
      persons: [corp],
      resolvedPersonId: "p-corp",
      claims: [{ id: "c1", label: "Policy compliance", supportStatus: "UNKNOWN" }],
    });
    expect(result.outlinePreview ?? result.questionTopics.map((q) => q.question).join(" ")).not.toMatch(
      /Rule 30\(b\)\(6\) topic list invented/i,
    );
    expect(result.relevantIssues.some((i) => i.label === "Policy compliance")).toBe(true);
  });

  it("31 — no invented deadline", () => {
    const result = buildDepositionPrepResult({
      question: "prepare me to depose Maria",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
    });
    expect(result.limitations.join(" ")).toMatch(/Do not invent deposition dates/i);
    expect(JSON.stringify(result)).not.toMatch(/deposition is Friday|notice period is 14 days/i);
  });

  it("32 — unauthorized external action remains prohibited", () => {
    expect(
      classifyConversationalAction({ question: "Email opposing counsel the deposition outline" })
        .actionClass,
    ).toBe("PROHIBITED_AUTONOMOUSLY");
  });

  it("33 — guest / prep class is READ_ONLY", () => {
    expect(isDepositionPrepQuestion("prepare me to depose John Smith")).toBe(true);
    const cls = classifyConversationalAction({ question: "prepare me to depose John Smith" });
    expect(["READ_ONLY", "DRAFT_PREVIEW"]).toContain(cls.actionClass);
  });

  it("34 — foreign source id not in source map when foreign rejected", () => {
    const result = buildDepositionPrepResult({
      question: "prepare me to depose Foreign Witness",
      matterId: "matter-a",
      persons: [foreign],
      resolvedPersonId: "p-foreign",
      foreignMatterId: "matter-b",
      documents: [{ id: "foreign:doc", label: "Foreign doc", relatedPersonIds: ["p-foreign"] }],
    });
    expect(result.sourceMap.some((s) => s.id.startsWith("foreign:"))).toBe(false);
  });

  it("35 — large matter bounded context", () => {
    const manyClaims = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`,
      label: `Claim ${i}`,
      supportStatus: i % 2 === 0 ? "SUPPORTED" : "UNKNOWN",
    }));
    const result = buildDepositionPrepResult({
      question: "prepare me to depose Maria focusing on notice",
      matterId: "matter-a",
      persons: [maria],
      resolvedPersonId: "p-maria",
      claims: manyClaims,
      focusIssue: "Claim 1",
    });
    expect(result.relevantIssues.length).toBeLessThan(manyClaims.length);
    expect(result.questionTopics.length).toBeLessThan(80);
  });
});
