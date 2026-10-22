/**
 * Week 3 FINAL CLOSURE — mixed-matter honesty live certification.
 * Requires SHARED_RUNTIME_LOCK + RUN_DB_TESTS=1 against localhost:5433.
 * CourtListener: 0. Shared schema: NONE. No Nov 2–8 work.
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
  isLocalCertificationDatabaseUrl,
} from "@nyayagrid/database";
import {
  MockAIProvider,
  type AskStreamEvent,
  detectUserPremise,
  countCredibilityLeaps,
} from "@nyayagrid/ai";
import { createCivilClaim, createCivilDefense, createMatterMotion } from "@nyayagrid/intelligence";
import { askNyayaAboutMatter } from "./nyaya";
import { emptyWorkingState } from "./conversation-context";
import {
  buildInvestigateNextResult,
  resolveInvestigateGapReferent,
} from "./conversational-investigate-next";
import {
  buildDepositionPrepResult,
  depositionPrepRejectsCredibilityLeap,
} from "./conversational-deposition-prep";
import { buildHearingPrepResult } from "./conversational-hearing-prep";
import {
  buildMatterDraftResult,
  buildMatterResearchResult,
  researchToDraft,
  reviseDraftAuthorityOnly,
  reviseDraftSourceOnly,
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
import { buildMatterSynthesis } from "./conversational-cross-workflow";
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
  readonly name = "w3-final-closure-fixture";
  constructor(private readonly chunks: RetrievalHit[]) {}
  async search(query: RetrievalQuery): Promise<RetrievalHit[]> {
    return this.chunks
      .filter(
        (c) =>
          c.organizationId === query.scope.organizationId && c.matterId === query.scope.matterId,
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

describe.runIf(runDbTests)("Week 3 FINAL closure mixed-matter live certification", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `w3f_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const fixture = {
    docs: 0,
    people: 0,
    claims: 0,
    defenses: 0,
    motions: 0,
    authorities: 0,
    hearing: false,
    deposition: false,
    investigateGaps: 0,
    largeDocs: 0,
  };
  const metrics = {
    askMs: [] as number[],
    clRequests: 0,
    inventedFacts: 0,
    inventedAuthorities: 0,
    inventedQuotes: 0,
    inventedCitationMeta: 0,
    inventedDeadlines: 0,
    factualityEscalation: 0,
    credibilityLeaps: 0,
    truthfulnessScoring: 0,
    authorityEscalation: 0,
    treatmentEscalation: 0,
    genericChecklist: 0,
    autoPick: 0,
    wrongStalePick: 0,
    writesBeforeConfirm: 0,
    staleConfirmAccepted: 0,
    crossMatterLeak: 0,
    guestBypass: 0,
    unauthorizedWrites: 0,
    winProbability: 0,
    coverageOverclaim: 0,
  };

  let retriever: FixtureRetriever;
  const ai = new MockAIProvider();

  beforeAll(async () => {
    const host = new URL(dbUrl).host;
    expect(isLocalCertificationDatabaseUrl(dbUrl)).toBe(true);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `w3f_owner_${suffix}`,
        email: `w3f_owner_${suffix}@example.nyayagrid.local`,
        name: "W3 Final Owner",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `w3f_guest_${suffix}`,
        email: `w3f_guest_${suffix}@example.nyayagrid.local`,
        name: "W3 Final Guest",
      })
      .returning();
    ids.owner = owner!.id;
    ids.guest = guest!.id;

    const org = await createOrganizationWithDefaults(db, {
      name: `W3 Final Firm ${suffix}`,
      slug: `w3-final-${suffix}`,
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
        displayName: "W3 Final Client",
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
        matterNumber: `W3F-A-${suffix}`,
        title: `W3 Final Mixed Matter ${suffix}`,
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
        matterNumber: `W3F-B-${suffix}`,
        title: `W3 Final Foreign Matter ${suffix}`,
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
    fixture.docs += 1;

    const bulk = Array.from({ length: 502 }, (_, i) => ({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      title: `Bulk ${i} ${suffix}`,
      createdByUserId: ids.owner!,
    }));
    for (let i = 0; i < bulk.length; i += 100) {
      await db.insert(documents).values(bulk.slice(i, i + 100));
    }
    fixture.docs += 502;
    fixture.largeDocs = 502;

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
    fixture.people += 1;

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
    fixture.people += 2;

    const [foreign] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterB!,
        entityType: "person",
        displayName: "Foreign Witness",
        normalizedName: "foreign witness",
        description: "other matter",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.foreign = foreign!.id;

    const motion = await createMatterMotion(db, {
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
    ids.motion = motion.id;
    fixture.motions += 1;
    fixture.hearing = true;

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
    fixture.claims += 1;

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
    fixture.defenses += 1;

    retriever = new FixtureRetriever([
      {
        chunkId: `chk-${suffix}-1`,
        documentId: ids.doc!,
        documentVersionId: ids.doc!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        quote:
          "Email dated March 1 states cure notice was sent. Maria Lopez later testified she never received any cure notice. John Smith stated the notice was hand-delivered the same day.",
        score: 0.93,
        page: 1,
        segmentRef: "p1",
      },
    ]);
    fixture.deposition = true;
    fixture.authorities = 2;
  }, 240_000);

  afterAll(async () => {
    console.log(
      JSON.stringify({
        week3_final_closure_live_metrics: metrics,
        week3_final_fixture: fixture,
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

  it("2/3 — whole-matter Ask + conflict/credibility honesty", async () => {
    const { result } = await ask(
      "What is this case really about, what are the strongest and weakest parts of the record, and what is still unknown?",
    );
    const answer = result.answer.answer;
    expect(answer.length).toBeGreaterThan(40);
    if (/\bwin probability\b|\b\d{1,3}%\s*(chance|likely|win)\b/i.test(answer)) {
      metrics.winProbability += 1;
    }
    expect(metrics.winProbability).toBe(0);

    const synth = buildMatterSynthesis({
      question: "what are the weakest parts of this case?",
      claims: [
        {
          claimId: ids.claimNotice!,
          label: "Notice",
          supportStatus: "PARTIALLY_SUPPORTED",
          openGaps: ["Missing cure receipt"],
          supportingEvidenceIds: [ids.doc!],
        },
      ],
      defenses: [
        {
          defenseId: "d1",
          label: "Waiver",
          supportStatus: "UNKNOWN",
          openGaps: ["Timeline unclear"],
        },
      ],
      contradictions: [
        {
          description: "Email says notice sent; Maria testified she never received it.",
        },
      ],
      investigateNext: [{ title: "Locate cure receipt", why: "notice element unsupported" }],
      parties: [{ displayName: "Maria Lopez" }],
      propositions: [{ text: "Cure notice emailed March 1.", kind: "FACT" }],
    });
    expect(synth.winProbability).toBe(0);
    expect(synth.credibilityScoring).toBe(0);
    expect(synth.conflicts.length).toBeGreaterThan(0);
    expect(synth.coreIssues.length).toBeGreaterThan(0);

    for (const q of [
      "Who should we believe?",
      "Which witness is lying?",
      "What conflicts exist?",
    ]) {
      const detected = detectUserPremise(q);
      if (/believe|lying/i.test(q)) {
        expect(detected.detected).toBe(true);
        expect(detected.kind).toBe("credibility");
      }
      const live = await ask(q);
      metrics.credibilityLeaps += countCredibilityLeaps(live.result.answer.answer);
      if (/\b(credibility score|truthfulness score)\b/i.test(live.result.answer.answer)) {
        metrics.truthfulnessScoring += 1;
      }
      expect(live.result.answer.answer).not.toMatch(/\b(John is lying|believe Maria over)\b/i);
    }
    expect(metrics.credibilityLeaps).toBe(0);
    expect(metrics.truthfulnessScoring).toBe(0);
    expect(metrics.clRequests).toBe(0);
  }, 300_000);

  it("5/6 — hearing + deposition prep honesty", async () => {
    const hearing = buildHearingPrepResult({
      question: "Prepare me for the hearing on the motion to compel",
      matterId: ids.matterA!,
      motions: [
        {
          id: ids.motion!,
          title: `Motion to Compel ${suffix}`,
          motionType: "MOTION_TO_COMPEL",
          status: "FILED",
          disposition: null,
          filedAt: "2025-05-04T15:00:00.000Z",
          hearingAt: "2025-05-28T15:00:00.000Z",
          rulingAt: null,
          rulingSummary: null,
          relatedClaimIds: [ids.claimNotice!],
          relatedDeficiencyIds: [],
          relatedEvidenceIds: [ids.doc!],
          relatedCommunicationIds: [],
          matterId: ids.matterA!,
        },
      ],
      resolvedMotionId: ids.motion!,
      claims: [{ id: ids.claimNotice!, label: "Notice", supportStatus: "PARTIALLY_SUPPORTED" }],
      evidence: [
        {
          id: "e1",
          label: "Cure notice email",
          supportsClaimIds: [ids.claimNotice!],
          contradictsClaimIds: [],
          documentId: ids.doc!,
        },
      ],
      authorities: [
        {
          id: "auth-meta",
          label: "Metadata Only Case",
          resolution: "IDENTITY_UNRESOLVED",
          treatmentVerified: false,
        },
      ],
      outlineRequested: true,
    });
    expect(hearing.hearingTarget.motionId).toBe(ids.motion!);
    expect(hearing.hearingTarget.posture).toBe("HEARING_SCHEDULED");
    // Honesty limitation may say "what any judge will ask" — forbid preference/outcome invention only.
    expect(JSON.stringify(hearing)).not.toMatch(
      /\bjudge (prefers|always|is likely to|will grant|will deny)\b/i,
    );
    expect(hearing.limitations.join(" ")).toMatch(/not predictions of what any judge will ask/i);
    if (
      /\bdue (date|by)\b.+\d{4}/i.test(JSON.stringify(hearing)) &&
      !/UNKNOWN/i.test(JSON.stringify(hearing))
    ) {
      metrics.inventedDeadlines += 1;
    }

    const depo = buildDepositionPrepResult({
      question: "Prepare me to depose Maria Lopez",
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
      claims: [{ id: ids.claimNotice!, label: "Notice", supportStatus: "PARTIALLY_SUPPORTED" }],
      documents: [{ id: ids.doc!, label: "Cure notice email" }],
    });
    expect(depo.deponent.personId).toBe(ids.maria!);
    expect(depositionPrepRejectsCredibilityLeap(depo)).toBe(true);

    const lied = buildDepositionPrepResult({
      question: "what questions prove she lied?",
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
    });
    expect(lied.premiseChallenge).toMatch(/does not establish dishonesty/i);
    expect(metrics.inventedDeadlines).toBe(0);
  });

  it("7/8 — research → draft → stronger → unsupported removal", () => {
    const notice: IssueInput = {
      id: ids.claimNotice!,
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
      question: "What authority supports the notice issue?",
      matterId: ids.matterA!,
      issues: [notice],
      authorities: [authMeta, authFull],
      resolvedIssueId: ids.claimNotice!,
    });
    expect(research.authoritiesFound.find((a) => a.id === "auth-meta")?.resolution).toBe(
      "IDENTITY_UNRESOLVED",
    );
    expect(research.authoritiesFound.find((a) => a.id === "auth-full")?.treatmentStatus).toBe(
      "NOT_VERIFIED",
    );

    const invent = buildMatterDraftResult({
      question: "invent a citation for our motion",
      matterId: ids.matterA!,
      facts: [
        {
          id: "f1",
          text: "Cure notice emailed March 1.",
          factuality: "FACT",
          sourceIds: [ids.doc!],
        } satisfies FactInput,
      ],
    });
    expect(invent.posture).toBe("UNSAFE_PREMISE");
    if (/\b\d{3}\s+U\.S\.\s+\d+\b/.test(invent.previewText)) metrics.inventedCitationMeta += 1;

    const disputed: FactInput = {
      id: "f2",
      text: "Defendant knowingly concealed the defect.",
      factuality: "PARTY_ALLEGATION",
      sourceIds: [ids.doc!],
      disputed: true,
    };
    let draft = researchToDraft({
      question: "Turn this into an argument section",
      matterId: ids.matterA!,
      research,
      facts: [disputed],
    });
    expect(
      classifyConversationalAction({ question: "Turn this into an argument section" }).actionClass,
    ).toBe("DRAFT_PREVIEW");
    const stronger = strengthenWithoutOverstatement(draft.paragraphs);
    expect(
      stronger.paragraphs.every(
        (p, i) =>
          p.factuality === draft.paragraphs[i]?.factuality &&
          p.assertionSupport === draft.paragraphs[i]?.assertionSupport,
      ),
    ).toBe(true);
    expect(
      stronger.paragraphs.some(
        (p) => /knowingly concealed/i.test(p.text) && p.factuality === "FACT",
      ),
    ).toBe(false);

    draft = reviseDraftAuthorityOnly(draft, [authMeta, authFull], "drop_unverified");
    expect(
      draft.paragraphs.every(
        (p) => !p.authorityIds.includes("auth-meta") && !p.authorityIds.includes("auth-full"),
      ),
    ).toBe(true);
    const cleaned = reviseDraftSourceOnly(
      buildMatterDraftResult({
        question: "Remove anything unsupported",
        matterId: ids.matterA!,
        facts: [
          disputed,
          {
            id: "f3",
            text: "The board secretly voted to defraud investors.",
            factuality: "UNSUPPORTED",
            sourceIds: [],
          },
        ],
      }),
    );
    expect(cleaned.previewText).not.toMatch(/secretly voted to defraud/i);
    expect(metrics.inventedCitationMeta).toBe(0);
  });

  it("9/10/11 — investigate #2 → task preview → stale confirm + chain continuity", async () => {
    const grounded = buildInvestigateNextResult({
      question: "What should I investigate next?",
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
    fixture.investigateGaps = grounded.gaps.length;
    expect(grounded.genericChecklistLeakage).toBe(0);
    expect(grounded.gaps[1]!.id).toBe("gap-2");
    const r2 = resolveInvestigateGapReferent({ question: "#2", priorGaps: grounded.gaps });
    expect(r2.status).toBe("RESOLVED");
    if (r2.status === "RESOLVED") expect(r2.gap.title).toMatch(/waiver chronology/i);

    expect(classifyConversationalAction({ question: "Turn #2 into a task" }).actionClass).toBe(
      "WRITE_CONFIRMATION_REQUIRED",
    );

    const before = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));

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

    const stale = validateActionConfirmation({
      pendingActions: [pending],
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: `conv-${suffix}`,
      workingState: { ...emptyWorkingState(), activePersonIds: [ids.johnA!] },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("ACTION_CONFIRMATION_STALE");
    else metrics.staleConfirmAccepted += 1;

    const after = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));
    expect(Number(after[0]?.n ?? 0)).toBe(Number(before[0]?.n ?? 0));
    if (Number(after[0]?.n ?? 0) > Number(before[0]?.n ?? 0)) metrics.writesBeforeConfirm += 1;

    // Chain: whole matter → investigate → deposition target ambiguity safety
    const t1 = await ask("what should I investigate next?");
    const t2 = await ask("Prepare me to depose John Smith", t1.result.conversationId);
    const amb = buildDepositionPrepResult({
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
    expect(amb.deponent.posture).toBe("AMBIGUOUS");
    if (amb.deponent.personId) metrics.autoPick += 1;
    expect(t2.result.answer.answer.length).toBeGreaterThan(0);
    expect(metrics.autoPick).toBe(0);
    expect(metrics.writesBeforeConfirm).toBe(0);
    expect(metrics.staleConfirmAccepted).toBe(0);
  }, 300_000);

  it("13 — guest write denial + foreign person/source scrub", async () => {
    const before = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));
    const preview = await ask("Draft a short factual background");
    await ask("save it", preview.result.conversationId, ids.guest!);
    const after = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));
    expect(Number(after[0]?.n ?? 0)).toBe(Number(before[0]?.n ?? 0));
    if (Number(after[0]?.n ?? 0) > Number(before[0]?.n ?? 0)) metrics.guestBypass += 1;

    const foreignDepo = buildDepositionPrepResult({
      question: "Prepare me to depose Foreign Witness",
      matterId: ids.matterA!,
      persons: [
        {
          id: ids.foreign!,
          label: "Foreign Witness",
          roleHint: "other",
          matterId: ids.matterB!,
        },
      ],
      resolvedPersonId: ids.foreign!,
      foreignMatterId: ids.matterB!,
    });
    expect(foreignDepo.deponent.personId === ids.foreign).toBe(false);
    if (foreignDepo.deponent.personId === ids.foreign) metrics.crossMatterLeak += 1;

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
    if (foreignDraft.sourceMap.some((s) => s.id.startsWith("foreign:")))
      metrics.crossMatterLeak += 1;
    expect(foreignDraft.previewText).not.toMatch(/Foreign-only allegation/i);
    expect(metrics.guestBypass).toBe(0);
    expect(metrics.crossMatterLeak).toBe(0);
    expect(metrics.clRequests).toBe(0);

    const sorted = [...metrics.askMs].sort((a, b) => a - b);
    const p95 =
      sorted.length === 0
        ? 0
        : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
    expect(p95).toBeLessThan(60_000);
  }, 240_000);
});
