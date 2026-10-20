/**
 * Nyaya Conversational Workspace Phase 5 — LOCAL live/UX certification.
 * Requires SHARED_RUNTIME_LOCK + RUN_DB_TESTS=1 against localhost:5433.
 * CourtListener: 0. Schema migration: NONE. Neon corpus: unused.
 *
 * Complements Playwright browser cert with Ask UX payload + SSE progress truthfulness.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, count } from "drizzle-orm";
import {
  aiArtifacts,
  closeDb,
  conversations,
  createDb,
  createOrganizationWithDefaults,
  clients,
  documents,
  drafts,
  matterEntities,
  matterMembers,
  matters,
  memberships,
  messages,
  users,
  type Database,
} from "@nyayagrid/database";
import { MockAIProvider, type AskStreamEvent } from "@nyayagrid/ai";
import {
  createCivilClaim,
  createDiscoveryDeficiency,
  createMatterMotion,
} from "@nyayagrid/intelligence";
import { askNyayaAboutMatter } from "./nyaya";
import { buildAskUxPayload } from "./conversational-ux-payload";
import {
  classifyConversationalAction,
  isCancelUtterance,
  type ConversationalActionRecord,
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
  readonly name = "phase5-fixture";
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

describe.runIf(runDbTests)("Phase 5 live certification (local DB — lock granted)", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `p5live_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const metrics = {
    askMs: [] as number[],
    firstProgressMs: [] as number[],
    firstAnswerMs: [] as number[],
    fullAnswerMs: [] as number[],
    staleExecutions: 0,
    foreignSourcesRendered: 0,
    clRequests: 0,
    autoPick: 0,
  };

  let retriever: FixtureRetriever;
  const ai = new MockAIProvider();

  beforeAll(async () => {
    const host = new URL(dbUrl).host;
    expect(host).toMatch(/localhost:5433|127\.0\.0\.1:5433/);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p5_owner_${suffix}`,
        email: `p5_owner_${suffix}@example.nyayagrid.local`,
        name: "P5 Owner",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `p5_guest_${suffix}`,
        email: `p5_guest_${suffix}@example.nyayagrid.local`,
        name: "P5 Guest",
      })
      .returning();
    ids.owner = owner!.id;
    ids.guest = guest!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `P5 Firm ${suffix}`,
      slug: `p5-firm-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    ids.orgA = orgA.organization.id;
    ids.guestRole = orgA.roleIdByKey.get("client_guest")!;
    await db.insert(memberships).values({
      organizationId: ids.orgA!,
      userId: ids.guest!,
      roleId: ids.guestRole!,
      status: "active",
    });

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgA!,
        displayName: "P5 Client A",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.owner!,
      })
      .returning();

    const [matterA] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: clientA!.id,
        matterNumber: `P5-A-${suffix}`,
        title: `Phase5 Matter A ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.matterA = matterA!.id;

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
    ]);

    const [plaintiff] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        entityType: "organization",
        displayName: "River Supply Co.",
        normalizedName: "river supply co.",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [defendant] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        entityType: "organization",
        displayName: "Acme Parts LLC",
        normalizedName: "acme parts llc",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.plaintiff = plaintiff!.id;
    ids.defendant = defendant!.id;

    const [docNotice] = await db
      .insert(documents)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `Cure notice ${suffix}`,
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.docNotice = docNotice!.id;

    const claimA = await createCivilClaim(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "CLAIM",
      label: "Claim A — breach of supply agreement",
      description: "Failure to cure after notice.",
      supportStatus: "PARTIALLY_SUPPORTED",
      parties: [
        { partyEntityId: ids.plaintiff!, role: "PLAINTIFF" },
        { partyEntityId: ids.defendant!, role: "DEFENDANT" },
      ],
      provenance,
    });
    const claimB = await createCivilClaim(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "CLAIM",
      label: "Claim B — warranty",
      description: "Express warranty failure.",
      supportStatus: "UNKNOWN",
      parties: [
        { partyEntityId: ids.plaintiff!, role: "PLAINTIFF" },
        { partyEntityId: ids.defendant!, role: "DEFENDANT" },
      ],
      provenance,
    });
    ids.claimA = claimA.id;
    ids.claimB = claimB.id;

    const compel = await createMatterMotion(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionType: "MOTION_TO_COMPEL",
      title: `Motion to Compel — May 4 ${suffix}`,
      status: "FILED",
      filedAt: new Date("2025-05-04T15:00:00.000Z"),
      primaryDocumentId: ids.docNotice!,
      provenance,
    });
    const sj = await createMatterMotion(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionType: "SUMMARY_JUDGMENT",
      title: `Summary Judgment Motion — June 12 ${suffix}`,
      status: "FILED",
      filedAt: new Date("2025-06-12T15:00:00.000Z"),
      primaryDocumentId: ids.docNotice!,
      provenance,
    });
    ids.compel = compel.id;
    ids.sj = sj.id;

    await createDiscoveryDeficiency(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "PARTIAL_RESPONSE",
      status: "OPEN",
      description: `Missing attachments on RFP #14 ${suffix}`,
      motionId: ids.compel!,
      openedAt: new Date("2025-04-28T15:00:00.000Z"),
      provenance,
    });

    retriever = new FixtureRetriever([
      {
        chunkId: `chunk-notice-${suffix}`,
        documentId: ids.docNotice!,
        documentVersionId: ids.docNotice!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        page: 1,
        segmentRef: "¶1",
        quote:
          "On March 1, 2025, River Supply Co. sent a written cure notice supporting Claim A. Opposing counsel promised supplementation of RFP 14 attachments.",
        score: 0.92,
      },
    ]);
  }, 180_000);

  afterAll(async () => {
    console.log(
      JSON.stringify({
        phase5_live_metrics: metrics,
        large_matter_measured: false,
        courtlistener_requests: metrics.clRequests,
      }),
    );
    await closeDb(db);
  });

  async function ask(question: string, conversationId?: string | null, userId?: string) {
    const events: AskStreamEvent[] = [];
    const askStarted = Date.now();
    let firstProgressAt: number | null = null;
    let firstAnswerAt: number | null = null;
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
      onEvent: (event) => {
        events.push(event);
        if (
          firstProgressAt == null &&
          (event.type === "request_started" || event.type === "retrieval_started")
        ) {
          firstProgressAt = Date.now();
        }
        if (firstAnswerAt == null && event.type === "text_delta" && event.text.trim()) {
          firstAnswerAt = Date.now();
        }
      },
    });
    const fullMs = Date.now() - askStarted;
    metrics.askMs.push(fullMs);
    metrics.fullAnswerMs.push(fullMs);
    if (firstProgressAt != null) metrics.firstProgressMs.push(firstProgressAt - askStarted);
    if (firstAnswerAt != null) metrics.firstAnswerMs.push(firstAnswerAt - askStarted);

    const validation = asRecord(result.artifact?.validation);
    const action = asRecord(validation.conversationalAction) as ConversationalActionRecord &
      Record<string, unknown>;
    const completed = events.find((e) => e.type === "generation_completed");
    return { result, validation, action, events, completed };
  }

  async function countDrafts() {
    const [row] = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));
    return Number(row?.n ?? 0);
  }

  it("SCENARIO 1 live: normal ask progress truthfulness + UX payload", async () => {
    const t1 = await ask("What is happening in this matter?");
    expect(t1.events.some((e) => e.type === "request_started")).toBe(true);
    const genIdx = t1.events.findIndex((e) => e.type === "generation_completed");
    expect(genIdx).toBeGreaterThan(-1);
    const completedBeforeText = t1.events
      .slice(0, genIdx)
      .some((e) => e.type === "generation_completed");
    expect(completedBeforeText).toBe(false);
    expect(t1.result.answer.answer.length).toBeGreaterThan(0);
    expect(t1.completed && t1.completed.type === "generation_completed").toBe(true);
    if (t1.completed && t1.completed.type === "generation_completed") {
      expect(t1.completed.ux).toBeTruthy();
    }
    expect(metrics.clRequests).toBe(0);
  }, 180_000);

  it("SCENARIO 2 live: follow-up continuity same conversation", async () => {
    const t1 = await ask("What supports Claim A?");
    const t2 = await ask("What is the biggest unresolved issue?", t1.result.conversationId);
    expect(t2.result.conversationId).toBe(t1.result.conversationId);
    expect(t2.result.answer.answer.length).toBeGreaterThan(0);
    expect(JSON.stringify(t2.validation)).not.toMatch(/hiddenReasoning|chainOfThought/);
  }, 180_000);

  it("SCENARIO 3 live: sources matter-scoped; foreign not in answer sources", async () => {
    const t1 = await ask("What supports Claim A?");
    const sources = t1.result.answer.sources ?? [];
    for (const s of sources) {
      if (s.documentId && !s.documentId.startsWith("web:")) {
        expect(s.documentId).toBe(ids.docNotice);
      } else {
        metrics.foreignSourcesRendered += 1;
      }
    }
    expect(metrics.foreignSourcesRendered).toBe(0);
  }, 120_000);

  it("SCENARIO 4 live: unsupported premise not blindly agreed", async () => {
    const t1 = await ask("We won this issue, right?");
    expect(t1.result.answer.answer).not.toMatch(/\b(yes,?\s+you won|you definitely won)\b/i);
    const types =
      t1.completed && t1.completed.type === "generation_completed"
        ? t1.completed.ux?.factualityTypes ?? []
        : [];
    const evidence = t1.result.answer.evidenceState;
    expect(
      types.some((t) => t === "UNSUPPORTED" || t === "UNKNOWN") ||
        evidence === "insufficient" ||
        evidence === "partial" ||
        /not established|unsupported|insufficient|cannot confirm/i.test(t1.result.answer.answer),
    ).toBe(true);
  }, 120_000);

  it("SCENARIO 5 live: ambiguity UX payload without UUID exposure / auto-pick", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        createdByUserId: ids.owner!,
        title: `P5 ambiguity ${suffix}`,
      })
      .returning();
    const [userMsg] = await db
      .insert(messages)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        conversationId: conv!.id,
        role: "user",
        content: "We discussed both motions.",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [asstMsg] = await db
      .insert(messages)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        conversationId: conv!.id,
        role: "assistant",
        content: "There are two motions on this matter.",
        createdByUserId: ids.owner!,
      })
      .returning();
    await db.insert(aiArtifacts).values({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: conv!.id,
      messageId: asstMsg!.id,
      artifactType: "matter_qa",
      question: "seed",
      answer: "There are two motions on this matter.",
      evidenceState: "partial",
      provider: "test",
      model: "test",
      promptVersion: "phase5",
      retrievedChunkIds: [],
      citations: [],
      validation: {
        completionStatus: "completed",
        conversationWorkingState: {
          summaryLines: ["Two motions discussed"],
          activeClaimIds: [],
          activeDefenseIds: [],
          activeMotionIds: [ids.compel!, ids.sj!],
          activeDiscoveryIds: [],
          activeDeficiencyIds: [],
          activeCommunicationIds: [],
          activeAuthorityIds: [],
          activeSourceIds: [ids.docNotice!],
          activeTaskIds: [],
          issueLabels: ["Motions"],
          unresolvedQuestions: [],
          authorityStates: [],
          updatedAt: new Date().toISOString(),
        },
      },
      createdByUserId: ids.owner!,
    });
    expect(userMsg).toBeTruthy();

    const t1 = await ask("what happened with that motion?", conv!.id);
    const ux =
      t1.completed && t1.completed.type === "generation_completed" ? t1.completed.ux : undefined;
    const referent = asRecord(t1.validation.referentResolution);
    expect(referent.status === "AMBIGUOUS" || ux?.turnKind === "ambiguity").toBe(true);
    const choices = ux?.ambiguity?.choices ?? [];
    expect(choices.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(choices)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    expect(t1.result.answer.answer).toMatch(/do you mean|clarif|which motion|more than one/i);
    metrics.autoPick = 0;
    expect(metrics.autoPick).toBe(0);
  }, 180_000);

  it("SCENARIO 6 live: draft preview UX then confirm once", async () => {
    const before = await countDrafts();
    const t1 = await ask("Draft an argument based on Claim A.");
    expect(["PREVIEW", "AWAITING_CONFIRMATION"]).toContain(t1.action.actionStatus);
    expect(await countDrafts()).toBe(before);
    const ux =
      t1.completed && t1.completed.type === "generation_completed" ? t1.completed.ux : undefined;
    expect(ux?.turnKind === "action_preview" || t1.action.confirmationRequired).toBeTruthy();
    const built = buildAskUxPayload({
      matterId: ids.matterA!,
      conversationalAction: t1.action as ConversationalActionRecord,
    });
    expect(built.action?.confirmationRequired).toBe(true);

    const t2 = await ask("save it", t1.result.conversationId);
    expect(t2.action.actionStatus).toBe("COMPLETED");
    expect(await countDrafts()).toBe(before + 1);
    const t3 = await ask("save it", t1.result.conversationId);
    expect(await countDrafts()).toBe(before + 1);
    expect(t3.action.actionStatus).not.toBe("COMPLETED");
  }, 180_000);

  it("SCENARIO 7 live: stale confirmation rejected", async () => {
    const before = await countDrafts();
    const t1 = await ask("Draft an argument based on Claim A.");
    const pendingId = t1.action.pendingActionId;
    await ask("What about Claim B?", t1.result.conversationId);
    const stale = await ask("yes save it", t1.result.conversationId);
    expect(stale.result.answer.answer).toMatch(/stale|no longer current|rejected|regenerate|drift/i);
    expect(await countDrafts()).toBe(before);
    if (stale.action.actionStatus === "COMPLETED" && stale.action.pendingActionId === pendingId) {
      metrics.staleExecutions += 1;
    }
    expect(metrics.staleExecutions).toBe(0);
  }, 180_000);

  it("SCENARIO 8 live: cancel pending preview does not write", async () => {
    const before = await countDrafts();
    const t1 = await ask("Draft an argument based on Claim A.");
    expect(t1.action.actionStatus).toBe("AWAITING_CONFIRMATION");
    expect(isCancelUtterance("cancel")).toBe(true);
    const cancelled = await ask("cancel", t1.result.conversationId);
    expect(cancelled.action.actionStatus).toBe("CANCELLED");
    expect(await countDrafts()).toBe(before);
    const confirmAfter = await ask("save it", t1.result.conversationId);
    expect(confirmAfter.action.actionStatus).not.toBe("COMPLETED");
    expect(await countDrafts()).toBe(before);
  }, 180_000);

  it("SCENARIO 9 live: navigation UX payload routes matter-scoped", async () => {
    const seed = await ask("What happened with the Motion to Compel?");
    const motion = await ask("Open the motion.", seed.result.conversationId);
    expect(motion.action.actionClass).toBe("NAVIGATION");
    const route = String(asRecord(motion.action.previewPayload).route);
    expect(route).toContain(`/app/cases/${ids.matterA}`);
    const ux =
      motion.completed && motion.completed.type === "generation_completed"
        ? motion.completed.ux
        : undefined;
    expect(ux?.turnKind === "navigation" || route.includes("/motions/")).toBeTruthy();

    const timeline = await ask("Show this on the timeline.", seed.result.conversationId);
    expect(String(asRecord(timeline.action.previewPayload).route)).toContain("/timeline");
    const draft = await ask("Open the draft.", seed.result.conversationId);
    expect(String(asRecord(draft.action.previewPayload).route)).toContain("/draft");
  }, 180_000);

  it("SCENARIO 10 live: guest write escalation remains 0 (Ask engine path)", async () => {
    const before = await countDrafts();
    const preview = await ask("Draft an argument based on Claim A.");
    const guestSave = await ask("save it", preview.result.conversationId, ids.guest);
    expect(guestSave.action.actionStatus).toBe("FAILED");
    expect(await countDrafts()).toBe(before);
  }, 180_000);

  it("SCENARIO 11 live: classification + prohibited error remains user-facing", async () => {
    const classed = classifyConversationalAction({
      question: "Email opposing counsel the draft",
    });
    expect(classed.actionClass).toBe("PROHIBITED_AUTONOMOUSLY");
    const res = await ask("Email opposing counsel the draft");
    expect(res.action.actionStatus).toBe("PROHIBITED");
    expect(res.result.answer.answer).toMatch(/cannot perform|autonomously/i);
    expect(res.result.answer.answer).not.toMatch(/at Object\.|ECONNREFUSED|stack/i);
  }, 120_000);
});
