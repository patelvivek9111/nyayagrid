import { describe, expect, it } from "vitest";
import {
  buildMatterDraftResult,
  buildMatterResearchResult,
  detectDraftType,
  draftToResearch,
  extractParagraphNumber,
  formatDraftForPrompt,
  formatResearchForPrompt,
  isAuthorityOnlyRevision,
  isConversationalDraftQuestion,
  isDraftToResearchRequest,
  isResearchToDraftRequest,
  isResearchWorkflowQuestion,
  isSourceOnlyRevision,
  researchToDraft,
  reviseDraftAuthorityOnly,
  reviseDraftParagraph,
  reviseDraftSourceOnly,
  selectResearchIssue,
  strengthenWithoutOverstatement,
  type AuthorityInput,
  type FactInput,
  type IssueInput,
} from "./conversational-draft-research";
import { classifyConversationalAction } from "./conversational-workflow-actions";

const notice: IssueInput = {
  id: "c-notice",
  label: "Notice",
  kind: "claim",
  supportStatus: "PARTIALLY_SUPPORTED",
};
const causation: IssueInput = {
  id: "c-causation",
  label: "Causation",
  kind: "claim",
  supportStatus: "UNKNOWN",
};

const authA: AuthorityInput = {
  id: "auth-a",
  label: "Matter Authority A",
  resolution: "CORPUS_COMPLETE",
  treatmentVerified: false,
  hasFullText: true,
  propositionHints: ["notice"],
  stance: "supporting",
  jurisdictionHint: null,
};
const authB: AuthorityInput = {
  id: "auth-b",
  label: "Matter Authority B",
  resolution: "AUTHORITY_RESOLVED",
  treatmentVerified: false,
  hasFullText: false,
  propositionHints: ["contrary notice"],
  stance: "contrary",
  limitationHints: ["Different procedural posture on record"],
};
const authMeta: AuthorityInput = {
  id: "auth-meta",
  label: "Metadata Only Case",
  resolution: "IDENTITY_UNRESOLVED",
  treatmentVerified: false,
  hasFullText: false,
  stance: "unknown",
};

const factOk: FactInput = {
  id: "f1",
  text: "Cure notice was emailed on March 1.",
  factuality: "FACT",
  sourceIds: ["doc-1"],
};
const factDispute: FactInput = {
  id: "f2",
  text: "Defendant knowingly concealed the defect.",
  factuality: "PARTY_ALLEGATION",
  sourceIds: ["doc-2"],
  disputed: true,
};
const factUnsupported: FactInput = {
  id: "f3",
  text: "The board secretly voted to defraud investors.",
  factuality: "UNSUPPORTED",
  sourceIds: [],
};

describe("Oct 19–25 Phase 3 draft + research", () => {
  it("1 — explicit research issue", () => {
    const r = buildMatterResearchResult({
      question: "research whether the notice evidence is enough",
      matterId: "m1",
      issues: [notice, causation],
      authorities: [authA],
      resolvedIssueId: "c-notice",
    });
    expect(r.posture).toBe("RESOLVED");
    expect(r.issue.id).toBe("c-notice");
  });

  it("2 — ambiguous issue", () => {
    const sel = selectResearchIssue({
      question: "research the claim",
      issues: [notice, causation],
    });
    expect(sel.posture).toBe("AMBIGUOUS");
  });

  it("3/4/5 — authority resolved / corpus-complete / metadata-only honesty", () => {
    const r = buildMatterResearchResult({
      question: "what authorities support notice",
      matterId: "m1",
      issues: [notice],
      authorities: [authA, authMeta],
      resolvedIssueId: "c-notice",
    });
    expect(r.authoritiesFound.some((a) => a.resolution === "CORPUS_COMPLETE")).toBe(true);
    expect(r.authoritiesFound.some((a) => a.resolution === "IDENTITY_UNRESOLVED")).toBe(true);
    expect(r.authoritiesFound.find((a) => a.id === "auth-meta")?.limitations.join(" ")).toMatch(
      /Identity unresolved|Full text/i,
    );
  });

  it("6 — treatment NOT_VERIFIED", () => {
    const r = buildMatterResearchResult({
      question: "research notice",
      matterId: "m1",
      issues: [notice],
      authorities: [authA],
      resolvedIssueId: "c-notice",
    });
    expect(r.authoritiesFound[0]?.treatmentStatus).toBe("NOT_VERIFIED");
  });

  it("7/8 — proposition supported / unsupported", () => {
    const supported = buildMatterResearchResult({
      question: "which authorities support notice",
      matterId: "m1",
      issues: [notice],
      authorities: [authA],
      resolvedIssueId: "c-notice",
    });
    expect(supported.propositionsSupported.length).toBeGreaterThan(0);

    const none = buildMatterResearchResult({
      question: "is the notice proof enough",
      matterId: "m1",
      issues: [notice],
      authorities: [authMeta],
      resolvedIssueId: "c-notice",
    });
    expect(
      none.propositionsNotSupported.length + (none.propositionsSupported.length === 0 ? 1 : 0),
    ).toBeGreaterThan(0);
  });

  it("9/10 — conflicting authority + limitations", () => {
    const r = buildMatterResearchResult({
      question: "compare authorities on notice",
      matterId: "m1",
      issues: [notice],
      authorities: [authA, authB],
      resolvedIssueId: "c-notice",
    });
    expect(r.conflictingAuthorities.length).toBeGreaterThan(0);
    expect(r.authorityLimitations.some((l) => /procedural posture|NOT VERIFIED|UNKNOWN/i.test(l.limitation))).toBe(
      true,
    );
  });

  it("11 — binding-status unknown not guessed", () => {
    const r = buildMatterResearchResult({
      question: "which one is binding?",
      matterId: "m1",
      issues: [notice],
      authorities: [authA],
      resolvedIssueId: "c-notice",
    });
    expect(r.authoritiesFound[0]?.limitations.join(" ")).toMatch(/Binding status UNKNOWN/i);
  });

  it("12 — research source map", () => {
    const r = buildMatterResearchResult({
      question: "research notice",
      matterId: "m1",
      issues: [notice],
      authorities: [authA],
      resolvedIssueId: "c-notice",
    });
    expect(r.sourceMap.some((s) => s.id === "c-notice")).toBe(true);
    expect(r.sourceMap.some((s) => s.id === "auth-a")).toBe(true);
  });

  it("13 — research save confirmation classification", () => {
    expect(classifyConversationalAction({ question: "save this research" }).actionClass).toBe(
      "WRITE_CONFIRMATION_REQUIRED",
    );
    expect(isResearchWorkflowQuestion("what law do we have for this issue?")).toBe(true);
    expect(classifyConversationalAction({ question: "research whether notice is enough" }).actionClass).toBe(
      "LONG_RUNNING_READ",
    );
  });

  it("14/15 — research → draft and draft → research", () => {
    expect(isResearchToDraftRequest("turn that research into an argument section")).toBe(true);
    expect(isDraftToResearchRequest("what authority do we have for paragraph 3?")).toBe(true);
    const research = buildMatterResearchResult({
      question: "research notice",
      matterId: "m1",
      issues: [notice],
      authorities: [authA, authB],
      resolvedIssueId: "c-notice",
    });
    const draft = researchToDraft({
      question: "turn that research into an argument section",
      matterId: "m1",
      research,
      facts: [factOk],
    });
    expect(draft.researchArtifactId).toBeTruthy();
    expect(draft.previewText).toMatch(/DRAFT PREVIEW/i);
    expect(draft.paragraphs.some((p) => p.authorityIds.includes("auth-a") || /contrary/i.test(p.text))).toBe(
      true,
    );

    const back = draftToResearch({
      question: "what authority do we have for paragraph 1?",
      matterId: "m1",
      draft,
      paragraphNumber: 1,
      issues: [notice],
      authorities: [authA],
    });
    expect(back.issue.id).toBeTruthy();
  });

  it("16/17 — factual paragraph grounded; disputed fact qualified", () => {
    const d = buildMatterDraftResult({
      question: "draft the factual background",
      matterId: "m1",
      facts: [factOk, factDispute],
    });
    expect(d.paragraphs.some((p) => /emailed on March 1/i.test(p.text))).toBe(true);
    expect(d.paragraphs.some((p) => /contends|conflict/i.test(p.text))).toBe(true);
    expect(
      d.paragraphs.every(
        (p) =>
          !/^Defendant knowingly concealed the defect\.$/i.test(p.text.trim()),
      ),
    ).toBe(true);
  });

  it("18 — unsupported assertion removed", () => {
    const d = buildMatterDraftResult({
      question: "draft the factual background",
      matterId: "m1",
      facts: [factOk, factUnsupported],
    });
    expect(d.unsupportedRemoved.some((u) => /defraud/i.test(u))).toBe(true);
    expect(d.previewText).not.toMatch(/secretly voted to defraud/i);
  });

  it("19 — make stronger does not overstate", () => {
    const base = buildMatterDraftResult({
      question: "draft argument section",
      matterId: "m1",
      facts: [factDispute],
      research: buildMatterResearchResult({
        question: "research notice",
        matterId: "m1",
        issues: [notice],
        authorities: [authA],
        resolvedIssueId: "c-notice",
      }),
    });
    const stronger = buildMatterDraftResult({
      question: "make it more persuasive",
      matterId: "m1",
      facts: [factDispute],
      research: buildMatterResearchResult({
        question: "research notice",
        matterId: "m1",
        issues: [notice],
        authorities: [authA],
        resolvedIssueId: "c-notice",
      }),
    });
    // Make-stronger must not promote disputed / partial claims to FACT.
    expect(
      stronger.paragraphs.some(
        (p) => /knowingly concealed/i.test(p.text) && p.factuality === "FACT",
      ),
    ).toBe(false);
    expect(
      stronger.paragraphs.every(
        (p) =>
          p.factuality !== "FACT" ||
          (p.assertionSupport === "SUPPORTED" && p.sources.length > 0),
      ),
    ).toBe(true);
    const { notes, paragraphs: strengthened } = strengthenWithoutOverstatement(base.paragraphs);
    expect(notes.join(" ")).toMatch(/without upgrading/i);
    expect(
      strengthened.every(
        (p, i) =>
          p.factuality === base.paragraphs[i]?.factuality &&
          p.assertionSupport === base.paragraphs[i]?.assertionSupport,
      ),
    ).toBe(true);
  });

  it("20 — source-only revision", () => {
    expect(isSourceOnlyRevision("remove anything that isn't supported")).toBe(true);
    const research = buildMatterResearchResult({
      question: "research notice",
      matterId: "m1",
      issues: [notice],
      authorities: [authA],
      resolvedIssueId: "c-notice",
    });
    const d = researchToDraft({
      question: "turn that research into an argument section",
      matterId: "m1",
      research,
      facts: [factOk],
    });
    expect(d.paragraphs.some((p) => p.authorityIds.length > 0 || !p.sources.some((s) => s.kind === "document"))).toBe(
      true,
    );
    const revised = reviseDraftSourceOnly(d);
    expect(revised.changedAssertions.some((c) => /Source-only/i.test(c))).toBe(true);
    expect(revised.paragraphs.every((p) => p.sources.some((s) => s.kind === "document"))).toBe(true);
  });

  it("21 — authority-only revision", () => {
    expect(isAuthorityOnlyRevision("remove authorities with unverified treatment")).toBe(true);
    const research = buildMatterResearchResult({
      question: "research notice",
      matterId: "m1",
      issues: [notice],
      authorities: [authA, authB],
      resolvedIssueId: "c-notice",
    });
    const d = researchToDraft({ question: "turn research into argument", matterId: "m1", research });
    expect(d.paragraphs.some((p) => p.authorityIds.includes("auth-a") || p.authorityIds.includes("auth-b"))).toBe(
      true,
    );
    const revised = reviseDraftAuthorityOnly(d, [authA, authB], "drop_unverified");
    // Both fixture authorities are treatmentVerified=false → must be stripped; no guessed binding.
    expect(
      revised.paragraphs.every(
        (p) => !p.authorityIds.includes("auth-a") && !p.authorityIds.includes("auth-b"),
      ),
    ).toBe(true);
    expect(
      revised.paragraphs.every((p) =>
        p.authorityIds.every(
          (id) => [authA, authB].find((a) => a.id === id)?.treatmentVerified === true,
        ),
      ),
    ).toBe(true);
  });

  it("22/23 — no fabricated quote; incomplete citation not fabricated", () => {
    const d = buildMatterDraftResult({
      question: "invent a citation for our motion",
      matterId: "m1",
      facts: [factOk],
    });
    expect(d.posture).toBe("UNSAFE_PREMISE");
    expect(d.previewText).not.toMatch(/\b\d{3}\s+U\.S\.\s+\d+\b/);
  });

  it("24 — paragraph revision", () => {
    expect(extractParagraphNumber("rewrite paragraph 2")).toBe(2);
    const d = buildMatterDraftResult({
      question: "draft factual background",
      matterId: "m1",
      facts: [factOk, factDispute],
    });
    const revised = reviseDraftParagraph(d, 1, "make this narrower / qualify disputed");
    expect(revised.changedAssertions.some((c) => /Rewrote paragraph 1/i.test(c))).toBe(true);
  });

  it("25/26 — active draft / research continuity fields", () => {
    const research = buildMatterResearchResult({
      question: "research notice",
      matterId: "m1",
      issues: [notice],
      authorities: [authA],
      resolvedIssueId: "c-notice",
    });
    const d = researchToDraft({ question: "turn into argument", matterId: "m1", research });
    expect(d.draftId).toMatch(/^preview:/);
    expect(d.researchArtifactId).toContain("research:");
  });

  it("27/28 — stale confirmation classification intact", () => {
    expect(classifyConversationalAction({ question: "save it" }).actionClass).toBe(
      "WRITE_CONFIRMATION_REQUIRED",
    );
    expect(classifyConversationalAction({ question: "confirm" }).actionType).toBe("CONFIRM_PENDING");
  });

  it("29/30/31 — hearing → draft; deposition → draft/research", () => {
    expect(detectDraftType("turn the hearing prep into a draft argument")).toBe(
      "HEARING_OUTLINE_DERIVATIVE",
    );
    expect(detectDraftType("turn the deposition admissions into a factual section")).toBe(
      "DEPOSITION_OUTLINE_DERIVATIVE",
    );
    const hearingDraft = buildMatterDraftResult({
      question: "turn the hearing prep into a draft argument",
      matterId: "m1",
      hearingOutline: "I. Foundation\nII. Notice issue",
    });
    expect(hearingDraft.hearingContinuity).toBe(true);
    const depoDraft = buildMatterDraftResult({
      question: "turn deposition outline into factual section",
      matterId: "m1",
      depositionOutline: "I. Role\nII. Notice communications",
      draftType: "DEPOSITION_OUTLINE_DERIVATIVE",
    });
    expect(depoDraft.depositionContinuity).toBe(true);
    expect(isResearchWorkflowQuestion("research the issue that came out of the deposition")).toBe(
      true,
    );
  });

  it("32 — no-authority-found case", () => {
    const r = buildMatterResearchResult({
      question: "research notice",
      matterId: "m1",
      issues: [notice],
      authorities: [],
      resolvedIssueId: "c-notice",
    });
    expect(r.posture).toBe("NO_AUTHORITIES");
  });

  it("33/34 — foreign source / cross-matter draft rejected", () => {
    const d = buildMatterDraftResult({
      question: "draft factual background",
      matterId: "matter-a",
      facts: [{ id: "fx", text: "Foreign fact", factuality: "FACT", sourceIds: ["foreign:doc"] }],
    });
    expect(d.sourceMap.some((s) => s.id.startsWith("foreign:"))).toBe(false);
    expect(d.previewText).not.toMatch(/Foreign fact/i);
  });

  it("35/36 — guest / unauthorized writes", () => {
    expect(isConversationalDraftQuestion("draft the factual background for our motion")).toBe(true);
    expect(
      classifyConversationalAction({ question: "Email opposing counsel the draft" }).actionClass,
    ).toBe("PROHIBITED_AUTONOMOUSLY");
    expect(classifyConversationalAction({ question: "draft the causation section" }).actionClass).toBe(
      "DRAFT_PREVIEW",
    );
  });

  it("37/38/39 — invented authorities/facts/hidden contrary = 0", () => {
    const research = buildMatterResearchResult({
      question: "research notice",
      matterId: "m1",
      issues: [notice],
      authorities: [authA, authB],
      resolvedIssueId: "c-notice",
    });
    const draft = researchToDraft({
      question: "turn research into argument; hide contrary authority",
      matterId: "m1",
      research,
    });
    // Hide-contrary is unsafe if asked alone; combined with turn-research still keeps contrary in research→draft path when question hits HIDE_CONTRARY
    const hide = buildMatterDraftResult({
      question: "hide the contrary authority from the draft",
      matterId: "m1",
      research,
    });
    expect(hide.posture).toBe("UNSAFE_PREMISE");
    expect(research.conflictingAuthorities.length).toBeGreaterThan(0);
    expect(formatResearchForPrompt(research)).not.toMatch(/Smith v\. Jones, 123 U\.S\. 456/);
    expect(formatDraftForPrompt(draft)).not.toMatch(/guaranteed victory/i);
  });

  it("40 — large matter bounded", () => {
    const manyIssues = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`,
      label: `Issue ${i}`,
      kind: "claim" as const,
    }));
    const manyAuth = Array.from({ length: 80 }, (_, i) => ({
      id: `a${i}`,
      label: `Auth ${i}`,
      resolution: "AUTHORITY_RESOLVED",
      treatmentVerified: false,
      stance: i % 5 === 0 ? ("contrary" as const) : ("supporting" as const),
    }));
    const r = buildMatterResearchResult({
      question: "research Issue 1",
      matterId: "m1",
      issues: manyIssues,
      authorities: manyAuth,
      resolvedIssueId: "c1",
    });
    expect(r.authoritiesFound.length).toBeLessThanOrEqual(40);
    const d = researchToDraft({
      question: "turn into argument",
      matterId: "m1",
      research: r,
      facts: Array.from({ length: 60 }, (_, i) => ({
        id: `f${i}`,
        text: `Fact ${i}`,
        factuality: "FACT" as const,
        sourceIds: [`d${i}`],
      })),
    });
    expect(d.paragraphs.length).toBeLessThan(80);
  });
});
