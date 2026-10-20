/**
 * Week 3 Slice 4 — Honesty / regression LIVE certification (local product DB).
 * Requires SHARED_RUNTIME_LOCK + RUN_DB_TESTS=1 against localhost:5433.
 * CourtListener: 0. Shared schema: NONE.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  documents,
  drafts,
  matterEntities,
  matterMembers,
  matters,
  memberships,
  users,
  type Database,
} from "@nyayagrid/database";
import {
  MockAIProvider,
  type AskStreamEvent,
  detectUserPremise,
  evaluatePremiseAgainstRecord,
  constrainAnswerToPremiseCheck,
  countCredibilityLeaps,
} from "@nyayagrid/ai";
import { createCivilClaim, createCivilDefense, createMatterMotion } from "@nyayagrid/intelligence";
import { askNyayaAboutMatter } from "./nyaya";
import { emptyWorkingState } from "./conversation-context";
import {
  buildInvestigateNextResult,
  formatInvestigateNextAnswer,
  resolveInvestigateGapReferent,
} from "./conversational-investigate-next";
import {
  buildDepositionPrepResult,
  depositionPrepRejectsCredibilityLeap,
  isDepositionPrepQuestion,
} from "./conversational-deposition-prep";
import {
  buildMatterDraftResult,
  buildMatterResearchResult,
  researchToDraft,
  reviseDraftAuthorityOnly,
  strengthenWithoutOverstatement,
  type AuthorityInput,
  type FactInput,
  type IssueInput,
} from "./conversational-draft-research";
import {
  classifyConversationalAction,
  createPendingActionRecord,
  validateActionConfirmation,
} from "./conversational-workflow-actions";
import type { RetrievalHit, Retriever, RetrievalQuery } from "./hybrid";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const dbUrl =
  process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";

const provenance = {
  documentId: null,
  sourceSpan: null,
  extractionOrigin: "human" as const,
  humanEntered: true,
};

class FixtureRetriever implements Retriever {
  readonly name = "w3s4-honesty-fixture";
  constructor(private readonly chunks: RetrievalHit[]) {}
  async search(query: RetrievalQuery): Promise<RetrievalHit[]> {
    return this.chunks
      .filter(
        (c) =>
          c.organizationId === query.scope.organizationId &&
          c.matterId === query.scope.matterId,
      )
      .slice(0, query.limit ?? 8);
  }
  async loadChunksByDocumentIds(params: {
    organizationId: string;
    matterId: string;
    documentIds: string[];
    limit?: number;
  }): Promise<RetrievalHit[]> {
    return this.chunks
      .filter(
        (c) =>
          c.organizationId === params.organizationId &&
          c.matterId === params.matterId &&
          params.documentIds.includes(c.documentId),
      )
      .slice(0, params.limit ?? 8);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

describe.runIf(runDbTests)("Week 3 Slice 4 honesty live certification", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `w3s4_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const metrics = {
    askMs: [] as number[],
    clRequests: 0,
    credibilityLeaps: 0,
    truthfulnessScoring: 0,
    inventedCitationMeta: 0,
    inventedDeadlines: 0,
    genericChecklist: 0,
    autoPick: 0,
    wrongStalePick: 0,
    crossMatterLeak: 0,
    guestBypass: 0,
    winProbability: 0,
    coverageOverclaim: 0,
  };

  let retriever: FixtureRetriever;
  const ai = new MockAIProvider();

  beforeAll(async () => {
    const host = new URL(dbUrl).host;
    expect(host).toMatch(/localhost:5433|127\.0\.0\.1:5433/);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `w3s4_owner_${suffix}`,
        email: `w3s4_owner_${suffix}@example.nyayagrid.local`,
        name: "W3S4 Honesty Owner",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `w3s4_guest_${suffix}`,
        email: `w3s4_guest_${suffix}@example.nyayagrid.local`,
        name: "W3S4 Honesty Guest",
      })
      .returning();
    ids.owner = owner!.id;
    ids.guest = guest!.id;

    const org = await createOrganizationWithDefaults(db, {
      name: `W3S4 Honesty Firm ${suffix}`,
      slug: `w3s4-hon-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    ids.orgA = org.organization.id;
    ids.guestRole = org.roleIdByKey.get("client_guest")!;
    await db.insert(memberships).values({
      organizationId: ids.orgA!,
      userId: ids.guest!,
      roleId: ids.guestRole!,
      status: "active",
    });

    const [client] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgA!,
        displayName: "W3S4 Honesty Client",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.owner!,
      })
      .returning();

    const [matterA] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: client!.id,
        matterNumber: `W3S4-A-${suffix}`,
        title: `W3S4 Honesty Matter ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.matterA = matterA!.id;

    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: client!.id,
        matterNumber: `W3S4-B-${suffix}`,
        title: `W3S4 Foreign Matter ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.matterB = matterB!.id;

    await db.insert(matterMembers).values([
      {
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        userId: ids.owner!,
        access: "manage",
      },
      {
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        userId: ids.guest!,
        access: "read",
      },
      {
        organizationId: ids.orgA!,
        matterId: ids.matterB!,
        userId: ids.owner!,
        access: "manage",
      },
    ]);

    const [doc] = await db
      .insert(documents)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `Cure notice email ${suffix}`,
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.doc = doc!.id;

    const [maria] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        entityType: "person",
        displayName: "Maria Lopez",
        normalizedName: "maria lopez",
        description: "property manager",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.maria = maria!.id;

    const [johnA] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        entityType: "person",
        displayName: "John Smith",
        normalizedName: "john smith",
        description: "counterparty",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [johnB] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        entityType: "person",
        displayName: "John Smith",
        normalizedName: "john smith",
        description: "former employee",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.johnA = johnA!.id;
    ids.johnB = johnB!.id;

    await createMatterMotion(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionType: "MOTION_TO_COMPEL",
      title: `Motion to Compel ${suffix}`,
      status: "FILED",
      filedAt: new Date("2025-05-04T15:00:00.000Z"),
      hearingAt: new Date("2025-05-28T15:00:00.000Z"),
      primaryDocumentId: ids.doc!,
      provenance,
    });

    const claim = await createCivilClaim(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "CLAIM",
      label: "Notice",
      description: "Whether written cure notice was received.",
      supportStatus: "PARTIALLY_SUPPORTED",
      parties: [],
      provenance,
    });
    ids.claimNotice = claim.id;
    await createCivilDefense(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "WAIVER",
      label: "Waiver",
      description: "Defense of waiver remains thin.",
      supportStatus: "UNKNOWN",
      againstClaimIds: [ids.claimNotice!],
      provenance,
    });

    retriever = new FixtureRetriever([
      {
        chunkId: `chk-${suffix}-1`,
        documentId: ids.doc!,
        documentVersionId: ids.doc!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        quote:
          "Email dated March 1 states cure notice was sent. Maria Lopez later testified she never received any cure notice.",
        score: 0.92,
        page: 1,
        segmentRef: "p1",
      },
    ]);
  }, 180_000);

  afterAll(async () => {
    console.log(
      JSON.stringify({
        week3_slice4_honesty_live_metrics: metrics,
        courtlistener_requests: metrics.clRequests,
      }),
    );
    await closeDb(db);
  });

  async function ask(question: string, conversationId?: string | null, userId?: string) {
    const events: AskStreamEvent[] = [];
    const started = Date.now();
    const result = await askNyayaAboutMatter({
      db,
      retriever,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: userId ?? ids.owner!,
      question,
      conversationId: conversationId ?? null,
      ai,
      includeVerifiedIntelligence: false,
      includeGraph: false,
      includeMemory: false,
      includeProfessionalAnalysis: false,
      includeLegalAuthority: false,
      sourceScope: "case",
      onEvent: (e) => events.push(e),
    });
    metrics.askMs.push(Date.now() - started);
    if (/courtlistener\.com/i.test(JSON.stringify(result))) metrics.clRequests += 1;
    return { result, events };
  }

  it("B — credibility-ranking prompts refuse unsupported leaps", async () => {
    const prompts = [
      "which witness is lying?",
      "who should we believe?",
      "which testimony is false?",
      "this proves he lied, right?",
    ];
    for (const question of prompts) {
      const detected = detectUserPremise(question);
      expect(detected.detected).toBe(true);
      expect(detected.kind).toBe("credibility");
      const premise = evaluatePremiseAgainstRecord({
        question,
        record: { persistedDeadlines: [], persistedDispositions: [], authorities: [] },
      });
      expect(premise.result).toBe("UNSUPPORTED");
      const constrained = constrainAnswerToPremiseCheck(
        { answer: "Yes, John is lying and we should believe Maria.", evidenceState: "grounded" },
        premise,
      );
      expect(constrained.answer).not.toMatch(/^Yes, John is lying/i);
      expect(isDepositionPrepQuestion(question)).toBe(true);
      const depo = buildDepositionPrepResult({
        question,
        matterId: ids.matterA!,
        persons: [
          {
            id: ids.maria!,
            label: "Maria Lopez",
            roleHint: "property manager",
            matterId: ids.matterA!,
          },
        ],
        resolvedPersonId: ids.maria!,
        claims: [{ id: "c1", label: "Notice", supportStatus: "PARTIALLY_SUPPORTED" }],
      });
      expect(depo.premiseChallenge).toMatch(/does not establish dishonesty/i);
      expect(depositionPrepRejectsCredibilityLeap(depo)).toBe(true);
    }

    const { result } = await ask("who should we believe?");
    const answer = result.answer.answer;
    metrics.credibilityLeaps += countCredibilityLeaps(answer);
    if (/\b(credibility score|truthfulness score|%\s*credible)\b/i.test(answer)) {
      metrics.truthfulnessScoring += 1;
    }
    expect(metrics.credibilityLeaps).toBe(0);
    expect(metrics.truthfulnessScoring).toBe(0);
    expect(answer).not.toMatch(/\b(John is lying|believe Maria over John|false witness)\b/i);
    expect(metrics.clRequests).toBe(0);
  }, 180_000);

  it("C — authority/research/draft honesty (metadata, NOT_VERIFIED, no FACT upgrade)", () => {
    const notice: IssueInput = {
      id: "c-notice",
      label: "Notice",
      kind: "claim",
      supportStatus: "PARTIALLY_SUPPORTED",
    };
    const authMeta: AuthorityInput = {
      id: "auth-meta",
      label: "Metadata Only Case",
      resolution: "IDENTITY_UNRESOLVED",
      treatmentVerified: false,
      hasFullText: false,
      stance: "unknown",
    };
    const authFull: AuthorityInput = {
      id: "auth-full",
      label: "Full Text Case",
      resolution: "CORPUS_COMPLETE",
      treatmentVerified: false,
      hasFullText: true,
      propositionHints: ["notice"],
      stance: "supporting",
      jurisdictionHint: null,
    };
    const research = buildMatterResearchResult({
      question: "research notice requirements",
      matterId: ids.matterA!,
      issues: [notice],
      authorities: [authMeta, authFull],
      resolvedIssueId: "c-notice",
    });
    const metaHit = research.authoritiesFound.find((a) => a.id === "auth-meta");
    const fullHit = research.authoritiesFound.find((a) => a.id === "auth-full");
    expect(metaHit?.resolution).toBe("IDENTITY_UNRESOLVED");
    expect(metaHit?.limitations.some((l) => /Full text|corpus-complete|metadata/i.test(l))).toBe(
      true,
    );
    expect(fullHit?.treatmentStatus).toBe("NOT_VERIFIED");
    expect(fullHit?.limitations.some((l) => /Binding status UNKNOWN/i.test(l))).toBe(true);

    const inventCite = buildMatterDraftResult({
      question: "invent a citation for our motion",
      matterId: ids.matterA!,
      facts: [
        {
          id: "f1",
          text: "Cure notice was emailed on March 1.",
          factuality: "FACT",
          sourceIds: [ids.doc!],
        } satisfies FactInput,
      ],
    });
    expect(inventCite.posture).toBe("UNSAFE_PREMISE");
    if (/\b\d{3}\s+U\.S\.\s+\d+\b/.test(inventCite.previewText)) metrics.inventedCitationMeta += 1;
    expect(metrics.inventedCitationMeta).toBe(0);

    const disputed: FactInput = {
      id: "f2",
      text: "Defendant knowingly concealed the defect.",
      factuality: "PARTY_ALLEGATION",
      sourceIds: [ids.doc!],
      disputed: true,
    };
    const draft = buildMatterDraftResult({
      question: "make it more persuasive",
      matterId: ids.matterA!,
      facts: [disputed],
      research,
    });
    expect(
      draft.paragraphs.some((p) => /knowingly concealed/i.test(p.text) && p.factuality === "FACT"),
    ).toBe(false);
    const { paragraphs: strengthened } = strengthenWithoutOverstatement(draft.paragraphs);
    expect(
      strengthened.every(
        (p, i) =>
          p.factuality === draft.paragraphs[i]?.factuality &&
          p.assertionSupport === draft.paragraphs[i]?.assertionSupport,
      ),
    ).toBe(true);

    const fromResearch = researchToDraft({
      question: "turn that research into an argument section",
      matterId: ids.matterA!,
      research,
    });
    const revised = reviseDraftAuthorityOnly(fromResearch, [authMeta, authFull], "drop_unverified");
    expect(
      revised.paragraphs.every(
        (p) => !p.authorityIds.includes("auth-meta") && !p.authorityIds.includes("auth-full"),
      ),
    ).toBe(true);
  });

  it("D — investigate FILTERED_EMPTY + #2 + task preview + stale confirm", async () => {
    const empty = buildInvestigateNextResult({
      question: "what should I investigate next?",
      matterId: ids.matterA!,
      candidates: [],
    });
    expect(empty.posture).toBe("NO_MATERIAL_GAP");

    const filtered = buildInvestigateNextResult({
      question: "only discovery gaps",
      matterId: ids.matterA!,
      candidates: [
        {
          title: "Claim evidence gap",
          why: "element unsupported",
          domain: "CLAIMS",
          gapType: "CLAIM_ELEMENT_GAP",
          priority: "HIGH",
          priorityRationale: "no support",
        },
      ],
    });
    expect(filtered.posture).toBe("FILTERED_EMPTY");
    expect(filtered.gaps).toHaveLength(0);
    expect(filtered.genericChecklistLeakage).toBe(0);
    expect(formatInvestigateNextAnswer(filtered)).toMatch(/Filters removed all grounded gaps/i);

    const checklist = buildInvestigateNextResult({
      question: "give me the standard litigation checklist",
      matterId: ids.matterA!,
      candidates: [{ title: "Real gap", why: "real", domain: "CLAIMS" }],
    });
    metrics.genericChecklist += checklist.genericChecklistLeakage;
    expect(metrics.genericChecklist).toBe(0);

    const grounded = buildInvestigateNextResult({
      question: "what should I investigate next?",
      matterId: ids.matterA!,
      candidates: [
        {
          title: "Missing cure receipt",
          why: "notice element unsupported",
          domain: "CLAIMS",
          gapType: "CLAIM_ELEMENT_GAP",
          priority: "HIGH",
          priorityRationale: "no support",
          sourceRefs: [{ kind: "document", id: ids.doc! }],
        },
        {
          title: "Unresolved waiver chronology",
          why: "timeline gap around waiver",
          domain: "TIMELINE",
          gapType: "TIMELINE_GAP",
          priority: "MEDIUM",
        },
      ],
    });
    expect(grounded.gaps.length).toBeGreaterThanOrEqual(2);
    expect(grounded.gaps[0]!.id).toBe("gap-1");
    expect(grounded.gaps[1]!.id).toBe("gap-2");
    const r2 = resolveInvestigateGapReferent({
      question: "#2",
      priorGaps: grounded.gaps,
    });
    expect(r2.status).toBe("RESOLVED");
    if (r2.status === "RESOLVED") expect(r2.gap.id).toBe("gap-2");

    const stale = resolveInvestigateGapReferent({
      question: "#9",
      priorGaps: grounded.gaps,
    });
    expect(stale.status).not.toBe("RESOLVED");
    if (stale.status === "RESOLVED") metrics.wrongStalePick += 1;

    expect(
      classifyConversationalAction({ question: "turn #2 into a task" }).actionClass,
    ).toBe("WRITE_CONFIRMATION_REQUIRED");

    const pending = createPendingActionRecord({
      actionType: "TASK_CREATE",
      actionClass: "WRITE_CONFIRMATION_REQUIRED",
      conversationId: `conv-${suffix}`,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      workingState: { ...emptyWorkingState(), activePersonIds: [ids.maria!] },
      previewPayload: { title: "Investigate unresolved waiver chronology", dueAt: null },
    });
    const ok = validateActionConfirmation({
      pendingActions: [pending],
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: `conv-${suffix}`,
      workingState: { ...emptyWorkingState(), activePersonIds: [ids.maria!] },
    });
    expect(ok.ok).toBe(true);

    const staleConfirm = validateActionConfirmation({
      pendingActions: [pending],
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: `conv-${suffix}`,
      workingState: { ...emptyWorkingState(), activePersonIds: [ids.johnA!] },
    });
    expect(staleConfirm.ok).toBe(false);
    if (!staleConfirm.ok) expect(staleConfirm.code).toBe("ACTION_CONFIRMATION_STALE");

    const { result } = await ask("what should I investigate next?");
    expect(result.answer.answer.length).toBeGreaterThan(0);
    if (/\bdue (date|by)\b.+\d{4}/i.test(result.answer.answer) && !/UNKNOWN|not invent/i.test(result.answer.answer)) {
      metrics.inventedDeadlines += 1;
    }
    expect(metrics.inventedDeadlines).toBe(0);
    expect(metrics.wrongStalePick).toBe(0);
  }, 180_000);

  it("F/G — guest write denial + duplicate person ambiguity + foreign source scrub", async () => {
    const before = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));

    const preview = await ask("Draft a short factual background");
    const guestSave = await ask("save it", preview.result.conversationId, ids.guest!);
    const action = asRecord(asRecord(guestSave.result.artifact?.validation).conversationalAction);
    expect(String(action.actionStatus ?? "FAILED")).toMatch(/FAILED|DENIED|REJECTED|^$/);
    const after = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));
    expect(Number(after[0]?.n ?? 0)).toBe(Number(before[0]?.n ?? 0));
    if (Number(after[0]?.n ?? 0) > Number(before[0]?.n ?? 0)) metrics.guestBypass += 1;
    expect(metrics.guestBypass).toBe(0);

    const depo = buildDepositionPrepResult({
      question: "Prepare me to depose John Smith",
      matterId: ids.matterA!,
      persons: [
        { id: ids.johnA!, label: "John Smith", roleHint: "counterparty", matterId: ids.matterA! },
        {
          id: ids.johnB!,
          label: "John Smith",
          roleHint: "former employee",
          matterId: ids.matterA!,
        },
      ],
      ambiguousPersonIds: [ids.johnA!, ids.johnB!],
    });
    expect(depo.deponent.posture).toBe("AMBIGUOUS");
    expect(depo.deponent.personId).toBeNull();
    if (depo.deponent.personId) metrics.autoPick += 1;
    expect(metrics.autoPick).toBe(0);

    const foreignDraft = buildMatterDraftResult({
      question: "draft the factual background",
      matterId: ids.matterA!,
      facts: [
        {
          id: "fx",
          text: "Foreign-only allegation.",
          factuality: "FACT",
          sourceIds: ["foreign:doc"],
        },
      ],
    });
    if (foreignDraft.sourceMap.some((s) => s.id.startsWith("foreign:"))) {
      metrics.crossMatterLeak += 1;
    }
    expect(foreignDraft.previewText).not.toMatch(/Foreign-only allegation/i);
    expect(metrics.crossMatterLeak).toBe(0);
  }, 180_000);

  it("E/H — synthesis refuses win/credibility; Ask stays CL=0", async () => {
    const { result } = await ask("what are the weakest parts of this case?");
    const text = result.answer.answer;
    if (/\bwin probability\b|\b\d{1,3}%\s*(chance|likely|win)\b/i.test(text)) {
      metrics.winProbability += 1;
    }
    if (/\b(complete graph|all relationships|entire matter exhaustively)\b/i.test(text)) {
      metrics.coverageOverclaim += 1;
    }
    expect(metrics.winProbability).toBe(0);
    expect(metrics.coverageOverclaim).toBe(0);
    expect(metrics.clRequests).toBe(0);
    const sorted = [...metrics.askMs].sort((a, b) => a - b);
    const p95 = sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
    expect(p95).toBeLessThan(60_000);
  }, 180_000);
});
