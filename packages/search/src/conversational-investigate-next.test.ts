import { describe, expect, it } from "vitest";
import {
  applyInvestigateFilters,
  buildDedupeKey,
  buildInvestigateNextResult,
  buildInvestigateTaskPreview,
  candidatesFromDeposition,
  candidatesFromDraft,
  candidatesFromHearing,
  candidatesFromResearch,
  candidatesFromWholeMatter,
  dedupeGaps,
  detectChangeSet,
  formatInvestigateNextAnswer,
  isInvestigateNextFollowUp,
  isInvestigateNextQuestion,
  normalizeCandidate,
  parseInvestigateFilters,
  parsePriorInvestigateGaps,
  resolveInvestigateGapReferent,
  toInvestigateNextValidationSnapshot,
  type InvestigateCandidateInput,
} from "./conversational-investigate-next";

function cand(partial: Partial<InvestigateCandidateInput> & Pick<InvestigateCandidateInput, "title" | "why" | "domain">): InvestigateCandidateInput {
  return partial;
}

describe("Oct 19–25 Phase 4 investigate-next", () => {
  it("1 — detects whole-matter investigate-next questions", () => {
    expect(isInvestigateNextQuestion("what should I investigate next?")).toBe(true);
    expect(isInvestigateNextQuestion("what are the biggest holes in this case?")).toBe(true);
    expect(isInvestigateNextQuestion("draft a motion")).toBe(false);
  });

  it("2 — claim element missing evidence", () => {
    const result = buildInvestigateNextResult({
      question: "what should I investigate next?",
      matterId: "m1",
      candidates: [
        cand({
          title: "Close evidence gap on Notice",
          why: "Element notice has no supporting evidence.",
          domain: "CLAIMS",
          gapType: "CLAIM_ELEMENT_GAP",
          relatedEntityIds: ["claim-1"],
          sourceRefs: [{ kind: "claim", id: "claim-1", label: "Notice" }],
          priority: "HIGH",
          priorityRationale: "Required claim element has no supporting evidence.",
        }),
      ],
    });
    expect(result.gaps[0]!.gapType).toBe("CLAIM_ELEMENT_GAP");
    expect(result.gaps[0]!.priority).toBe("HIGH");
    expect(result.gaps[0]!.priorityRationale.length).toBeGreaterThan(10);
  });

  it("3 — defense element gap", () => {
    const result = buildInvestigateNextResult({
      question: "what should I investigate next?",
      matterId: "m1",
      candidates: [
        cand({
          title: "Close evidence gap on defense Waiver",
          why: "Defense support status=UNKNOWN",
          domain: "DEFENSES",
          gapType: "DEFENSE_ELEMENT_GAP",
          relatedEntityIds: ["def-1"],
          priority: "HIGH",
          priorityRationale: "Required defense element has no supporting evidence.",
        }),
      ],
    });
    expect(result.gaps.some((g) => g.gapType === "DEFENSE_ELEMENT_GAP")).toBe(true);
  });

  it("4/5 — weak + conflicting evidence", () => {
    const result = buildInvestigateNextResult({
      question: "what should I investigate next?",
      matterId: "m1",
      candidates: [
        cand({
          title: "Weak evidence on causation",
          why: "Critical fact rests on one witness statement only.",
          domain: "EVIDENCE",
          gapType: "WEAK_EVIDENCE",
        }),
        cand({
          title: "Investigate recorded evidentiary conflict",
          why: "Email date conflicts with alleged receipt.",
          domain: "EVIDENCE",
          gapType: "CONFLICTING_EVIDENCE",
          priority: "HIGH",
          priorityRationale: "Conflict affects a material timeline proposition.",
        }),
      ],
    });
    expect(result.gaps.some((g) => g.gapType === "WEAK_EVIDENCE")).toBe(true);
    expect(result.gaps.some((g) => g.gapType === "CONFLICTING_EVIDENCE")).toBe(true);
  });

  it("6/7 — missing document + missing attachment", () => {
    const result = buildInvestigateNextResult({
      question: "only missing documents",
      matterId: "m1",
      candidates: [
        cand({
          title: "Missing inspection report",
          why: "Email references attached inspection report.",
          domain: "COMMUNICATIONS",
          gapType: "REFERENCED_BUT_UNLOCATED_DOCUMENT",
          effort: "LOW",
          priority: "HIGH",
          priorityRationale: "Referenced attachment may resolve a material conflict.",
        }),
        cand({
          title: "Missing board minutes",
          why: "Document category not produced.",
          domain: "EVIDENCE",
          gapType: "MISSING_DOCUMENT",
        }),
      ],
    });
    expect(result.gaps.every((g) => g.gapType === "MISSING_DOCUMENT" || g.gapType === "REFERENCED_BUT_UNLOCATED_DOCUMENT")).toBe(true);
  });

  it("8/9 — unidentified person + timeline gap", () => {
    const result = buildInvestigateNextResult({
      question: "what should I investigate next?",
      matterId: "m1",
      candidates: [
        cand({
          title: "Identify unknown participant",
          why: "Message mentions Jordan but no person entity is linked.",
          domain: "COMMUNICATIONS",
          gapType: "UNIDENTIFIED_PERSON",
        }),
        cand({
          title: "Clarify undated timeline event",
          why: "Event exists without eventDate.",
          domain: "TIMELINE",
          gapType: "TIMELINE_GAP",
        }),
      ],
    });
    expect(result.gaps.some((g) => g.gapType === "UNIDENTIFIED_PERSON")).toBe(true);
    expect(result.gaps.some((g) => g.gapType === "TIMELINE_GAP")).toBe(true);
  });

  it("10/11 — discovery deficiency + unanswered", () => {
    const result = buildInvestigateNextResult({
      question: "only discovery gaps",
      matterId: "m1",
      candidates: [
        cand({
          title: "Resolve open discovery deficiency",
          why: "Deficiency def-1 remains open.",
          domain: "DISCOVERY",
          gapType: "DISCOVERY_DEFICIENCY",
          relatedEntityIds: ["def-1"],
          priority: "HIGH",
          priorityRationale: "Open deficiency blocks motion support.",
        }),
        cand({
          title: "Unanswered interrogatory",
          why: "No response recorded for RFP 4.",
          domain: "DISCOVERY",
          gapType: "UNANSWERED_DISCOVERY",
        }),
      ],
    });
    expect(result.gaps.every((g) => g.relatedDomain === "DISCOVERY")).toBe(true);
  });

  it("12/13 — hearing + deposition reuse", () => {
    const hearing = candidatesFromHearing([
      {
        id: "h1",
        whyThisGapMatters: "Motion lacks factual support for notice element.",
        whatToLookFor: "Cure notice email",
        relatedEntity: { kind: "motion", id: "mot-1", label: "Compel" },
        gapBasis: [{ kind: "claim", id: "c1", label: "Notice" }],
        priority: "high",
      },
    ]);
    const depo = candidatesFromDeposition([
      {
        id: "d1",
        whatGap: "Witness referenced missing attachment",
        whyItMatters: "Follow-up needed before outline freeze.",
        whatToLookFor: "Attachment named report.pdf",
        relatedEntity: { kind: "person", id: "p1", label: "Alex" },
        sourceBasis: [{ kind: "document", id: "doc-1", label: "Email" }],
        priority: "high",
      },
    ]);
    const result = buildInvestigateNextResult({
      question: "what should I investigate next?",
      matterId: "m1",
      candidates: [...hearing, ...depo],
    });
    expect(result.gaps.some((g) => g.relatedDomain === "HEARING")).toBe(true);
    expect(result.gaps.some((g) => g.relatedDomain === "DEPOSITION")).toBe(true);
  });

  it("14/15 — draft unsupported + research treatment/authority", () => {
    const draft = candidatesFromDraft({
      unsupportedRemoved: ["The defect was proven by the missing report."],
      paragraphs: [
        {
          id: "p1",
          text: "Unsupported certainty.",
          assertionSupport: "UNSUPPORTED",
          sources: [],
        },
      ],
    });
    const research = candidatesFromResearch([
      {
        whatIsMissing: "Verified treatment for authority Auth-1",
        whyItMatters: "Drafts must not claim verified treatment without a source.",
        sourceBasis: [{ kind: "authority", id: "a1", label: "Auth-1" }],
      },
      {
        whatIsMissing: "Authorities for issue Notice",
        whyItMatters: "No local authority mapped.",
        sourceBasis: [{ kind: "claim", id: "c1", label: "Notice" }],
      },
    ]);
    const result = buildInvestigateNextResult({
      question: "what should I investigate next?",
      matterId: "m1",
      candidates: [...draft, ...research],
    });
    expect(result.gaps.some((g) => g.gapType === "UNSUPPORTED_DRAFT_ASSERTION")).toBe(true);
    expect(result.gaps.some((g) => g.gapType === "UNVERIFIED_AUTHORITY_TREATMENT")).toBe(true);
    expect(result.gaps.some((g) => g.gapType === "MISSING_AUTHORITY")).toBe(true);
  });

  it("16 — dedupe across workflows for same missing attachment", () => {
    const a = normalizeCandidate(
      cand({
        title: "Locate inspection report attachment",
        why: "Email references attached inspection report.",
        domain: "COMMUNICATIONS",
        gapType: "REFERENCED_BUT_UNLOCATED_DOCUMENT",
        relatedEntityIds: ["comm-1"],
        sourceRefs: [{ kind: "communication", id: "comm-1" }],
      }),
      0,
    );
    const b = normalizeCandidate(
      cand({
        title: "Locate inspection report attachment",
        why: "Email references attached inspection report.",
        domain: "HEARING",
        gapType: "REFERENCED_BUT_UNLOCATED_DOCUMENT",
        relatedEntityIds: ["comm-1"],
        sourceRefs: [{ kind: "communication", id: "comm-1" }],
      }),
      1,
    );
    expect(a.dedupeKey).toBe(b.dedupeKey);
    const merged = dedupeGaps([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.provenanceDomains.sort()).toEqual(["COMMUNICATIONS", "HEARING"].sort());
  });

  it("17 — HIGH priority requires rationale", () => {
    const result = buildInvestigateNextResult({
      question: "what should I investigate next?",
      matterId: "m1",
      candidates: [
        cand({
          title: "Close evidence gap",
          why: "No support for element.",
          domain: "CLAIMS",
          gapType: "CLAIM_ELEMENT_GAP",
          priority: "HIGH",
        }),
      ],
    });
    expect(result.gaps[0]!.priorityRationale.trim().length).toBeGreaterThan(0);
    expect(/high because important/i.test(result.gaps[0]!.priorityRationale)).toBe(false);
  });

  it("18/19/20 — top-N, domain, and person/motion filters", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      cand({
        title: `Gap ${i}`,
        why: `Why ${i}`,
        domain: i % 2 === 0 ? "CLAIMS" : "DISCOVERY",
        relatedEntityIds: i === 3 ? ["person-1"] : i === 4 ? ["motion-1"] : [`e-${i}`],
        priority: i < 2 ? "HIGH" : "MEDIUM",
        priorityRationale: i < 2 ? "Required element unsupported." : undefined,
      }),
    );
    const top3 = buildInvestigateNextResult({
      question: "give me the top 3",
      matterId: "m1",
      candidates: many,
    });
    expect(top3.returnedCount).toBeLessThanOrEqual(3);

    const discovery = buildInvestigateNextResult({
      question: "only discovery gaps",
      matterId: "m1",
      candidates: many,
    });
    expect(discovery.gaps.every((g) => g.relatedDomain === "DISCOVERY")).toBe(true);

    const person = applyInvestigateFilters(
      buildInvestigateNextResult({ question: "all", matterId: "m1", candidates: many }).gaps,
      { ...parseInvestigateFilters("all"), personIds: ["person-1"] },
    );
    expect(person.every((g) => g.relatedEntityIds.includes("person-1"))).toBe(true);
  });

  it("21/22 — gap referent #2 and ambiguous referent", () => {
    const built = buildInvestigateNextResult({
      question: "what should I investigate next?",
      matterId: "m1",
      candidates: [
        cand({ title: "A", why: "a", domain: "CLAIMS", gapType: "CLAIM_ELEMENT_GAP", priority: "HIGH", priorityRationale: "no support" }),
        cand({ title: "B missing attachment", why: "attachment", domain: "COMMUNICATIONS", gapType: "REFERENCED_BUT_UNLOCATED_DOCUMENT", priority: "HIGH", priorityRationale: "referenced" }),
        cand({ title: "C attachment also", why: "attachment", domain: "HEARING", gapType: "REFERENCED_BUT_UNLOCATED_DOCUMENT", relatedEntityIds: ["other"], sourceRefs: [{ kind: "communication", id: "x" }], priority: "HIGH", priorityRationale: "referenced" }),
      ],
    });
    const r2 = resolveInvestigateGapReferent({ question: "why is #2 high?", priorGaps: built.gaps });
    expect(r2.status).toBe("RESOLVED");
    if (r2.status === "RESOLVED") expect(r2.gap.id).toBe("gap-2");

    const amb = resolveInvestigateGapReferent({
      question: "the missing attachment",
      priorGaps: [
        { ...built.gaps[1]!, id: "gap-2", dedupeKey: "k1" },
        { ...built.gaps[1]!, id: "gap-3", title: "Other attachment", dedupeKey: "k2", relatedEntityIds: ["z"] },
      ],
    });
    expect(amb.status).toBe("AMBIGUOUS");
  });

  it("23 — source follow-up retained on gap", () => {
    const result = buildInvestigateNextResult({
      question: "show me the sources",
      matterId: "m1",
      candidates: [
        cand({
          title: "Gap",
          why: "why",
          domain: "CLAIMS",
          sourceRefs: [
            { kind: "claim", id: "c1", label: "Notice" },
            { kind: "document", id: "d1", label: "Email" },
          ],
        }),
      ],
    });
    expect(result.sourceMap.length).toBeGreaterThan(0);
    expect(result.gaps[0]!.sourceIds).toContain("c1");
  });

  it("24/25/27 — task preview, no invent due date", () => {
    const gap = normalizeCandidate(
      cand({
        title: "Locate report",
        why: "Email references report.",
        domain: "COMMUNICATIONS",
        gapType: "REFERENCED_BUT_UNLOCATED_DOCUMENT",
        relatedEntityIds: ["comm-1"],
        sourceRefs: [{ kind: "communication", id: "comm-1" }],
        priority: "HIGH",
        priorityRationale: "Referenced by both parties.",
      }),
      0,
    );
    const preview = buildInvestigateTaskPreview({
      gap: { ...gap, id: "gap-2" },
      matterId: "m1",
      question: "turn #2 into a task",
    });
    expect(preview.proposedDueAt).toBeNull();
    expect(preview.gapId).toBe("gap-2");
    expect(preview.title).toMatch(/Locate report/);
  });

  it("26 — stale/not-found referent fails safely", () => {
    const r = resolveInvestigateGapReferent({
      question: "focus on #9",
      priorGaps: [
        normalizeCandidate(cand({ title: "A", why: "a", domain: "CLAIMS" }), 0),
      ],
    });
    expect(r.status).toBe("NOT_FOUND");
  });

  it("28 — two-hour filter does not invent effort", () => {
    const result = buildInvestigateNextResult({
      question: "what should I investigate if I only have two hours?",
      matterId: "m1",
      candidates: [
        cand({
          title: "Locate attachment",
          why: "Email refers to attached report by filename.",
          domain: "COMMUNICATIONS",
          gapType: "REFERENCED_BUT_UNLOCATED_DOCUMENT",
          effort: "LOW",
          priority: "HIGH",
          priorityRationale: "Referenced attachment.",
        }),
        cand({
          title: "Identify 2019 witness",
          why: "Unknown person from 2019 meeting.",
          domain: "COMMUNICATIONS",
          gapType: "UNIDENTIFIED_PERSON",
          effort: "UNKNOWN",
        }),
      ],
    });
    expect(result.inventedUrgency).toBe(0);
    expect(result.gaps.every((g) => g.effort === "LOW")).toBe(true);
  });

  it("29 — no material gap result", () => {
    const result = buildInvestigateNextResult({
      question: "what should I investigate next?",
      matterId: "m1",
      candidates: [],
    });
    expect(result.posture).toBe("NO_MATERIAL_GAP");
    expect(formatInvestigateNextAnswer(result)).toMatch(/No additional high-priority/i);
  });

  it("30 — generic checklist leakage blocked", () => {
    const result = buildInvestigateNextResult({
      question: "give me the standard litigation checklist",
      matterId: "m1",
      candidates: [
        cand({ title: "Real gap", why: "real", domain: "CLAIMS" }),
      ],
    });
    expect(result.genericChecklistLeakage).toBe(0);
    expect(result.gaps).toHaveLength(0);
  });

  it("31 — ignore authority filter", () => {
    const result = buildInvestigateNextResult({
      question: "ignore authority research",
      matterId: "m1",
      candidates: [
        cand({ title: "Auth gap", why: "missing authority", domain: "AUTHORITIES", gapType: "MISSING_AUTHORITY" }),
        cand({ title: "Claim gap", why: "missing evidence", domain: "CLAIMS", gapType: "CLAIM_ELEMENT_GAP", priority: "HIGH", priorityRationale: "no support" }),
      ],
    });
    expect(result.gaps.every((g) => g.gapType !== "MISSING_AUTHORITY")).toBe(true);
  });

  it("32 — change detection against prior snapshot", () => {
    const first = buildInvestigateNextResult({
      question: "what should I investigate next?",
      matterId: "m1",
      candidates: [
        cand({ title: "Gap A", why: "a", domain: "CLAIMS", relatedEntityIds: ["c1"], sourceRefs: [{ kind: "claim", id: "c1" }] }),
      ],
    });
    const second = buildInvestigateNextResult({
      question: "what new gaps came from this document?",
      matterId: "m1",
      candidates: [
        cand({ title: "Gap A", why: "a", domain: "CLAIMS", relatedEntityIds: ["c1"], sourceRefs: [{ kind: "claim", id: "c1" }] }),
        cand({ title: "Gap B", why: "b", domain: "DISCOVERY", relatedEntityIds: ["d1"], sourceRefs: [{ kind: "discovery_deficiency", id: "d1" }] }),
      ],
      priorGaps: first.gaps,
    });
    expect(second.changeSet).toBeTruthy();
    expect(second.changeSet!.newGaps.length).toBeGreaterThan(0);
    expect(second.changeSet!.unchangedGaps.length).toBeGreaterThan(0);
  });

  it("33 — validation snapshot round-trip", () => {
    const result = buildInvestigateNextResult({
      question: "what should I investigate next?",
      matterId: "m1",
      candidates: [
        cand({ title: "Gap", why: "why", domain: "CLAIMS", priority: "HIGH", priorityRationale: "no support" }),
      ],
    });
    const snap = toInvestigateNextValidationSnapshot(result);
    const parsed = parsePriorInvestigateGaps(snap);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.title).toBe("Gap");
  });

  it("34 — whole-matter candidate adapter bounded", () => {
    const adapted = candidatesFromWholeMatter({
      investigateNext: Array.from({ length: 40 }, (_, i) => ({
        id: `inv-${i}`,
        priority: "high" as const,
        title: `Item ${i}`,
        why: `Why ${i}`,
        triggeredBy: [{ kind: "claim", id: `c${i}`, label: `C${i}` }],
        resolvesIf: "Add evidence",
      })),
      timeline: [{ id: "t1", title: "Undated event", eventDate: null }],
    });
    expect(adapted.length).toBeLessThanOrEqual(12);
  });

  it("35 — dedupe key stability", () => {
    const k1 = buildDedupeKey({
      gapType: "MISSING_DOCUMENT",
      relatedEntityIds: ["b", "a"],
      sourceIds: ["s2", "s1"],
      title: "Locate report",
      why: "Email references report",
    });
    const k2 = buildDedupeKey({
      gapType: "MISSING_DOCUMENT",
      relatedEntityIds: ["a", "b"],
      sourceIds: ["s1", "s2"],
      title: "Locate report",
      why: "Email references report",
    });
    expect(k1).toBe(k2);
  });

  it("36 — follow-up detector", () => {
    expect(isInvestigateNextFollowUp("only the high priority ones")).toBe(true);
    expect(isInvestigateNextFollowUp("#2")).toBe(true);
    expect(isInvestigateNextFollowUp("hello")).toBe(false);
  });

  it("37/38/39 — invent counters stay zero", () => {
    const result = buildInvestigateNextResult({
      question: "top 5 things that could materially change the case",
      matterId: "m1",
      candidates: [
        cand({ title: "One real gap", why: "record gap", domain: "CLAIMS", priority: "HIGH", priorityRationale: "element unsupported" }),
      ],
    });
    expect(result.returnedCount).toBe(1);
    expect(result.inventedUrgency).toBe(0);
    expect(result.genericChecklistLeakage).toBe(0);
  });

  it("40 — large matter candidate cap", () => {
    const candidates = Array.from({ length: 200 }, (_, i) =>
      cand({
        title: `Gap ${i}`,
        why: `Why ${i} unique ${i}`,
        domain: i % 2 === 0 ? "CLAIMS" : "DISCOVERY",
        relatedEntityIds: [`e-${i}`],
        sourceRefs: [{ kind: "claim", id: `e-${i}` }],
      }),
    );
    const result = buildInvestigateNextResult({
      question: "what are the biggest holes in the whole case?",
      matterId: "m1",
      candidates,
    });
    expect(result.candidateCount).toBeLessThanOrEqual(80);
    expect(result.returnedCount).toBeLessThanOrEqual(12);
  });
});
