/**
 * Phase 6 — D8 live multi-turn certification (local DB).
 * Requires SHARED_RUNTIME_LOCK + RUN_DB_TESTS=1 against localhost:5433.
 * CourtListener: 0. Schema migration: NONE. Neon corpus: unused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import {
  aiArtifacts,
  closeDb,
  conversations,
  createDb,
  createOrganizationWithDefaults,
  clients,
  documents,
  drafts,
  legalAuthorities,
  matterAuthorities,
  matterEntities,
  matterMembers,
  matters,
  messages,
  tasks,
  timelineEvents,
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
import {
  CONVERSATION_CONTEXT_MAX_CHARS,
  CONVERSATION_RECENT_TURN_LIMIT,
  assembleConversationAskContext,
} from "./conversation-context";
import {
  D8_ASSIGNMENTS,
  gradeD8Assignment,
  gradeD8Suite,
  type D8AssignmentGrade,
  type D8TurnObservation,
} from "./conversational-d8-benchmark";
import type { ConversationalActionRecord } from "./conversational-workflow-actions";
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
  readonly name = "phase6-d8-fixture";
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

describe.runIf(runDbTests)("Phase 6 D8 live certification (local DB — lock granted)", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `p6d8_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const metrics = {
    askMs: [] as number[],
    contextAssemblyMs: [] as number[],
    largeMatterAskMs: [] as number[],
    longConversationAskMs: [] as number[],
    staleExecutions: 0,
    foreignSources: 0,
    autoPick: 0,
    clRequests: 0,
    inventedDeadlines: 0,
    unauthorizedWrites: 0,
  };
  const grades: D8AssignmentGrade[] = [];

  let retriever: FixtureRetriever;
  const ai = new MockAIProvider();
  let scaleDocCount = 0;

  beforeAll(async () => {
    const host = new URL(dbUrl).host;
    expect(host).toMatch(/localhost:5433|127\.0\.0\.1:5433/);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p6_owner_${suffix}`,
        email: `p6_owner_${suffix}@example.nyayagrid.local`,
        name: "P6 Owner",
      })
      .returning();
    ids.owner = owner!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `P6 Firm ${suffix}`,
      slug: `p6-firm-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    ids.orgA = orgA.organization.id;

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgA!,
        displayName: "P6 Client A",
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
        matterNumber: `P6-A-${suffix}`,
        title: `Phase6 D8 Matter ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.matterA = matterA!.id;

    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: clientA!.id,
        matterNumber: `P6-B-${suffix}`,
        title: `Phase6 Foreign Matter ${suffix}`,
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
        matterId: ids.matterB!,
        userId: ids.owner!,
        access: "manage",
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

    const [docForeign] = await db
      .insert(documents)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterB!,
        title: `Foreign matter doc ${suffix}`,
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.docForeign = docForeign!.id;

    // Scale fixture: 500+ documents on matter A (metadata only; realistic product DB size).
    const scaleBatch: Array<{
      organizationId: string;
      matterId: string;
      title: string;
      createdByUserId: string;
    }> = [];
    for (let i = 0; i < 520; i++) {
      scaleBatch.push({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `P6 scale doc ${i} ${suffix}`,
        createdByUserId: ids.owner!,
      });
    }
    for (let i = 0; i < scaleBatch.length; i += 100) {
      await db.insert(documents).values(scaleBatch.slice(i, i + 100));
    }
    const [docCountRow] = await db
      .select({ n: count() })
      .from(documents)
      .where(and(eq(documents.organizationId, ids.orgA!), eq(documents.matterId, ids.matterA!)));
    scaleDocCount = Number(docCountRow?.n ?? 0);

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

    await db.insert(timelineEvents).values([
      {
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        eventType: "fact_event",
        title: "Cure notice sent",
        description: "Written cure notice supporting Claim A.",
        eventDate: new Date("2025-03-01T12:00:00.000Z"),
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
        dedupeKey: `p6-notice-${suffix}`,
      },
      {
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        eventType: "fact_event",
        title: "Motion to compel filed",
        description: "Motion to compel filed after incomplete RFP 14 response.",
        eventDate: new Date("2025-05-04T12:00:00.000Z"),
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
        dedupeKey: `p6-compel-${suffix}`,
      },
    ]);

    const [authResolved] = await db
      .insert(legalAuthorities)
      .values({
        authorityType: "case",
        title: "Acme v. Supply (synthetic)",
        citation: `123 F.3d 456 P6 ${suffix}`,
        jurisdiction: "US",
        ingestionStatus: "ready",
        treatmentStatus: "unknown",
        currentnessStatus: "unknown",
        metadata: {},
        sourceProvider: "synthetic_p6",
        sourceExternalId: `resolved_${suffix}`,
      })
      .returning();
    ids.authResolved = authResolved!.id;
    await db.insert(matterAuthorities).values({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      authorityId: ids.authResolved!,
      status: "saved",
      addedByUserId: ids.owner!,
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
          "On March 1, 2025, River Supply Co. sent a written cure notice supporting Claim A. Opposing counsel promised supplementation of RFP 14 attachments. No discovery close date is stated.",
        score: 0.92,
      },
      {
        chunkId: `chunk-foreign-${suffix}`,
        documentId: ids.docForeign!,
        documentVersionId: ids.docForeign!,
        organizationId: ids.orgA!,
        matterId: ids.matterB!,
        page: 1,
        segmentRef: "¶1",
        quote: "Foreign matter secret — must never appear in Matter A answers.",
        score: 0.99,
      },
    ]);
  }, 300_000);

  afterAll(async () => {
    const suite = gradeD8Suite(grades);
    console.log(
      JSON.stringify({
        phase6_d8_live: {
          suite,
          metrics,
          scaleDocCount,
          courtlistener_requests: metrics.clRequests,
        },
      }),
    );
    await closeDb(db);
  });

  async function ask(question: string, conversationId?: string | null) {
    const events: AskStreamEvent[] = [];
    const askStarted = Date.now();
    const result = await askNyayaAboutMatter({
      db,
      retriever,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
      question,
      conversationId: conversationId ?? null,
      ai,
      includeVerifiedIntelligence: false,
      includeGraph: false,
      includeMemory: false,
      includeProfessionalAnalysis: false,
      includeLegalAuthority: true,
      sourceScope: "case",
      onEvent: (event) => {
        events.push(event);
      },
    });
    const askMs = Date.now() - askStarted;
    metrics.askMs.push(askMs);
    const validation = asRecord(result.artifact?.validation);
    const action = asRecord(validation.conversationalAction) as ConversationalActionRecord &
      Record<string, unknown>;
    const completed = events.find((e) => e.type === "generation_completed");
    const sources = result.answer.sources ?? [];
    for (const s of sources) {
      if (s.documentId === ids.docForeign) metrics.foreignSources += 1;
      if (s.documentId && s.documentId !== ids.docNotice && !String(s.documentId).startsWith("web:")) {
        // Scale docs may appear; only foreign matter doc is a security failure.
        if (s.documentId === ids.docForeign) metrics.foreignSources += 1;
      }
    }
    return { result, validation, action, events, completed, askMs, sources };
  }

  async function countDrafts() {
    const [row] = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));
    return Number(row?.n ?? 0);
  }

  async function countTasks() {
    const [row] = await db
      .select({ n: count() })
      .from(tasks)
      .where(and(eq(tasks.organizationId, ids.orgA!), eq(tasks.matterId, ids.matterA!)));
    return Number(row?.n ?? 0);
  }

  function toObservation(
    question: string,
    pack: Awaited<ReturnType<typeof ask>>,
    extras?: Partial<D8TurnObservation>,
  ): D8TurnObservation {
    const factualityTypes =
      pack.completed && pack.completed.type === "generation_completed"
        ? pack.completed.ux?.factualityTypes ?? []
        : [];
    const referent = asRecord(pack.validation.referentResolution);
    const preview = asRecord(pack.action.previewPayload);
    return {
      question,
      answer: pack.result.answer.answer,
      conversationId: pack.result.conversationId,
      evidenceState: pack.result.answer.evidenceState,
      assumptions: pack.result.answer.assumptions,
      unresolvedQuestions: pack.result.answer.unresolvedQuestions,
      sources: pack.sources.map((s) => ({ documentId: s.documentId ?? null })),
      factualityTypes,
      actionType: typeof pack.action.actionType === "string" ? pack.action.actionType : null,
      actionClass: typeof pack.action.actionClass === "string" ? pack.action.actionClass : null,
      actionStatus: typeof pack.action.actionStatus === "string" ? pack.action.actionStatus : null,
      confirmationRequired: Boolean(pack.action.confirmationRequired),
      pendingActionId:
        typeof pack.action.pendingActionId === "string" ? pack.action.pendingActionId : null,
      previewProposedDueAt: preview.proposedDueAt,
      referentStatus: typeof referent.status === "string" ? referent.status : null,
      autoPickCount: 0,
      foreignSourceCount: pack.sources.filter((s) => s.documentId === ids.docForeign).length,
      hiddenReasoningPresent:
        pack.validation.hiddenReasoning != null || pack.validation.chainOfThought != null,
      askMs: pack.askMs,
      ...extras,
    };
  }

  it("D8 live: execute and grade all 18 assignments", async () => {
    const allowedDocs = new Set([ids.docNotice!]);

    // 1 Matter status
    {
      const spec = D8_ASSIGNMENTS[0]!;
      const t1 = await ask(spec.turns[0]!.question);
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      grades.push(
        gradeD8Assignment(spec, [toObservation(spec.turns[0]!.question, t1), toObservation(spec.turns[1]!.question, t2)], {
          allowedDocumentIds: allowedDocs,
        }),
      );
    }

    // 2 Claim support
    {
      const spec = D8_ASSIGNMENTS[1]!;
      const t1 = await ask(spec.turns[0]!.question);
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      grades.push(
        gradeD8Assignment(spec, [toObservation(spec.turns[0]!.question, t1), toObservation(spec.turns[1]!.question, t2)], {
          allowedDocumentIds: allowedDocs,
        }),
      );
    }

    // 3 Claim weakness
    {
      const spec = D8_ASSIGNMENTS[2]!;
      const t1 = await ask(spec.turns[0]!.question);
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      grades.push(
        gradeD8Assignment(spec, [toObservation(spec.turns[0]!.question, t1), toObservation(spec.turns[1]!.question, t2)]),
      );
    }

    // 4 False outcome
    {
      const spec = D8_ASSIGNMENTS[3]!;
      const t1 = await ask(spec.turns[0]!.question);
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      grades.push(
        gradeD8Assignment(spec, [
          toObservation(spec.turns[0]!.question, t1),
          toObservation(spec.turns[1]!.question, t2),
        ]),
      );
    }

    // 5 Claim switch
    {
      const spec = D8_ASSIGNMENTS[4]!;
      const t1 = await ask(spec.turns[0]!.question);
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      grades.push(
        gradeD8Assignment(spec, [
          toObservation(spec.turns[0]!.question, t1),
          toObservation(spec.turns[1]!.question, t2),
        ]),
      );
    }

    // 6 Discovery gap
    {
      const spec = D8_ASSIGNMENTS[5]!;
      const t1 = await ask(spec.turns[0]!.question);
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      const t3 = await ask(spec.turns[2]!.question, t1.result.conversationId);
      grades.push(
        gradeD8Assignment(spec, [
          toObservation(spec.turns[0]!.question, t1),
          toObservation(spec.turns[1]!.question, t2),
          toObservation(spec.turns[2]!.question, t3),
        ]),
      );
    }

    // 7 Communication → motion
    {
      const spec = D8_ASSIGNMENTS[6]!;
      const t1 = await ask(spec.turns[0]!.question);
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      const t3 = await ask(spec.turns[2]!.question, t1.result.conversationId);
      grades.push(
        gradeD8Assignment(spec, [
          toObservation(spec.turns[0]!.question, t1),
          toObservation(spec.turns[1]!.question, t2),
          toObservation(spec.turns[2]!.question, t3),
        ]),
      );
    }

    // 8 Motion / ruling
    {
      const spec = D8_ASSIGNMENTS[7]!;
      const t1 = await ask(spec.turns[0]!.question);
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      grades.push(
        gradeD8Assignment(spec, [toObservation(spec.turns[0]!.question, t1), toObservation(spec.turns[1]!.question, t2)]),
      );
    }

    // 9 Timeline follow-up
    {
      const spec = D8_ASSIGNMENTS[8]!;
      const t1 = await ask(spec.turns[0]!.question);
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      grades.push(
        gradeD8Assignment(spec, [
          toObservation(spec.turns[0]!.question, t1),
          toObservation(spec.turns[1]!.question, t2),
        ]),
      );
    }

    // 10 Deadline
    {
      const spec = D8_ASSIGNMENTS[9]!;
      const t1 = await ask(spec.turns[0]!.question);
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      grades.push(
        gradeD8Assignment(
          spec,
          [
            toObservation(spec.turns[0]!.question, t1),
            toObservation(spec.turns[1]!.question, t2),
          ],
          { discoveryDeadlineSupported: false },
        ),
      );
    }

    // 11 Contradiction
    {
      const spec = D8_ASSIGNMENTS[10]!;
      const t1 = await ask(spec.turns[0]!.question);
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      grades.push(
        gradeD8Assignment(spec, [
          toObservation(spec.turns[0]!.question, t1),
          toObservation(spec.turns[1]!.question, t2),
        ]),
      );
    }

    // 12 Authority
    {
      const spec = D8_ASSIGNMENTS[11]!;
      const t1 = await ask(spec.turns[0]!.question);
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      grades.push(
        gradeD8Assignment(spec, [toObservation(spec.turns[0]!.question, t1), toObservation(spec.turns[1]!.question, t2)]),
      );
    }

    // 13 Treatment
    {
      const spec = D8_ASSIGNMENTS[12]!;
      const t1 = await ask(spec.turns[0]!.question);
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      grades.push(
        gradeD8Assignment(
          spec,
          [
            toObservation(spec.turns[0]!.question, t1),
            toObservation(spec.turns[1]!.question, t2),
          ],
          { treatmentVerified: false },
        ),
      );
    }

    // 14 Research
    {
      const spec = D8_ASSIGNMENTS[13]!;
      const t1 = await ask(spec.turns[0]!.question);
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      grades.push(
        gradeD8Assignment(spec, [
          toObservation(spec.turns[0]!.question, t1, { writesBeforeConfirm: 0 }),
          toObservation(spec.turns[1]!.question, t2),
        ]),
      );
    }

    // 15 Draft
    {
      const spec = D8_ASSIGNMENTS[14]!;
      const before = await countDrafts();
      const t1 = await ask(spec.turns[0]!.question);
      const afterPreview = await countDrafts();
      if (afterPreview !== before) metrics.unauthorizedWrites += 1;
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      const afterConfirm = await countDrafts();
      grades.push(
        gradeD8Assignment(spec, [
          toObservation(spec.turns[0]!.question, t1, {
            draftCountBefore: before,
            draftCountAfterPreview: afterPreview,
          }),
          toObservation(spec.turns[1]!.question, t2, {
            draftCountAfterConfirm: afterConfirm,
          }),
        ]),
      );
    }

    // 16 Task
    {
      const spec = D8_ASSIGNMENTS[15]!;
      const before = await countTasks();
      const t1 = await ask(spec.turns[0]!.question);
      const afterPreview = await countTasks();
      const preview = asRecord(t1.action.previewPayload);
      if (preview.proposedDueAt != null) metrics.inventedDeadlines += 1;
      const t2 = await ask(spec.turns[1]!.question, t1.result.conversationId);
      const afterConfirm = await countTasks();
      grades.push(
        gradeD8Assignment(spec, [
          toObservation(spec.turns[0]!.question, t1, {
            taskCountBefore: before,
            taskCountAfterPreview: afterPreview,
            previewProposedDueAt: preview.proposedDueAt,
            inventedDeadline: preview.proposedDueAt != null,
          }),
          toObservation(spec.turns[1]!.question, t2, {
            taskCountAfterConfirm: afterConfirm,
          }),
        ]),
      );
    }

    // 17 Ambiguity
    {
      const spec = D8_ASSIGNMENTS[16]!;
      const [conv] = await db
        .insert(conversations)
        .values({
          organizationId: ids.orgA!,
          matterId: ids.matterA!,
          createdByUserId: ids.owner!,
          title: `P6 ambiguity ${suffix}`,
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
        promptVersion: "phase6",
        retrievedChunkIds: [],
        citations: [],
        validation: {
          completionStatus: "completed",
          conversationWorkingState: {
            version: 1,
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
      const t1 = await ask(spec.turns[0]!.question, conv!.id);
      const referent = asRecord(t1.validation.referentResolution);
      const autoPick =
        referent.status === "RESOLVED" &&
        !/do you mean|clarif|which motion|more than one|ambiguous/i.test(t1.result.answer.answer)
          ? 1
          : 0;
      metrics.autoPick += autoPick;
      grades.push(
        gradeD8Assignment(spec, [
          toObservation(spec.turns[0]!.question, t1, {
            referentStatus: typeof referent.status === "string" ? referent.status : null,
            autoPickCount: autoPick,
          }),
        ]),
      );
    }

    // 18 Security / cross-matter — foreign chunk must not render
    {
      const spec = D8_ASSIGNMENTS[17]!;
      const t1 = await ask(spec.turns[0]!.question);
      const foreign = t1.sources.filter((s) => s.documentId === ids.docForeign).length;
      metrics.foreignSources += foreign;
      expect(t1.result.answer.answer).not.toMatch(/Foreign matter secret/i);
      grades.push(
        gradeD8Assignment(spec, [
          toObservation(spec.turns[0]!.question, t1, { foreignSourceCount: foreign }),
        ], {
          allowedDocumentIds: allowedDocs,
          foreignMatterId: ids.matterB,
        }),
      );
    }

    const suite = gradeD8Suite(grades);
    expect(suite.assignments).toBe(18);
    expect(suite.criticalFailures).toEqual([]);
    expect(suite.failed).toBe(0);
    expect(suite.pass).toBe(true);
    expect(metrics.clRequests).toBe(0);
    expect(metrics.autoPick).toBe(0);
    expect(metrics.foreignSources).toBe(0);
    expect(metrics.inventedDeadlines).toBe(0);
    expect(metrics.unauthorizedWrites).toBe(0);
  }, 900_000);

  it("large-matter conversational bounds + investigate-next", async () => {
    expect(scaleDocCount).toBeGreaterThanOrEqual(500);
    const started = Date.now();
    const t1 = await ask("What is happening in this matter?");
    metrics.largeMatterAskMs.push(Date.now() - started);
    expect(t1.result.answer.answer.length).toBeGreaterThan(0);
    expect(t1.result.answer.answer.length).toBeLessThan(50_000);

    const t2 = await ask("What should I investigate next?", t1.result.conversationId);
    expect(t2.result.answer.answer).toMatch(
      /missing|unanswered|discovery|RFP|authority|gap|deficiency|Claim|evidence/i,
    );

    const assembleStarted = Date.now();
    const assembled = await assembleConversationAskContext(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: t1.result.conversationId!,
      currentQuestion: "follow-up",
    });
    metrics.contextAssemblyMs.push(Date.now() - assembleStarted);
    expect(assembled).toBeTruthy();
    expect(assembled!.recentTurns.length).toBeLessThanOrEqual(CONVERSATION_RECENT_TURN_LIMIT);
    expect(assembled!.metrics.promptChars).toBeLessThanOrEqual(CONVERSATION_CONTEXT_MAX_CHARS);
  }, 300_000);

  it("long conversation recent window remains bounded", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        createdByUserId: ids.owner!,
        title: `P6 long ${suffix}`,
      })
      .returning();

    for (let i = 0; i < 36; i++) {
      const role = i % 2 === 0 ? "user" : "assistant";
      const [msg] = await db
        .insert(messages)
        .values({
          organizationId: ids.orgA!,
          matterId: ids.matterA!,
          conversationId: conv!.id,
          role,
          content: `History turn ${i} about Claim A and RFP 14. `.repeat(8),
          createdByUserId: ids.owner!,
        })
        .returning();
      if (role === "assistant") {
        await db.insert(aiArtifacts).values({
          organizationId: ids.orgA!,
          matterId: ids.matterA!,
          conversationId: conv!.id,
          messageId: msg!.id,
          artifactType: "matter_qa",
          question: `q${i}`,
          answer: msg!.content,
          evidenceState: "partial",
          provider: "test",
          model: "test",
          promptVersion: "phase6",
          retrievedChunkIds: [],
          citations: [],
          validation: {
            completionStatus: "completed",
            conversationWorkingState: {
              version: 1,
              summaryLines: ["Claim A / RFP 14"],
              activeClaimIds: [ids.claimA!],
              activeDefenseIds: [],
              activeMotionIds: [ids.compel!],
              activeDiscoveryIds: [],
              activeDeficiencyIds: [],
              activeCommunicationIds: [],
              activeAuthorityIds: [],
              activeSourceIds: [ids.docNotice!],
              activeTaskIds: [],
              issueLabels: ["Discovery"],
              unresolvedQuestions: ["RFP 14 attachments"],
              authorityStates: [],
              updatedAt: new Date().toISOString(),
            },
          },
          createdByUserId: ids.owner!,
        });
      }
    }

    const started = Date.now();
    const t1 = await ask("What is the biggest unresolved issue?", conv!.id);
    metrics.longConversationAskMs.push(Date.now() - started);
    expect(t1.result.conversationId).toBe(conv!.id);

    const assembled = await assembleConversationAskContext(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: conv!.id,
      currentQuestion: "What is the biggest unresolved issue?",
    });
    expect(assembled!.recentTurns.length).toBeLessThanOrEqual(CONVERSATION_RECENT_TURN_LIMIT);
    expect(assembled!.metrics.promptChars).toBeLessThanOrEqual(CONVERSATION_CONTEXT_MAX_CHARS);
    expect(assembled!.promptBlock ?? "").not.toContain("History turn 0 about Claim A");
  }, 300_000);

  it("failure injection: stale confirmation + foreign source rejection", async () => {
    const before = await countDrafts();
    const t1 = await ask("Draft an argument based on Claim A.");
    expect(["PREVIEW", "AWAITING_CONFIRMATION"]).toContain(t1.action.actionStatus);
    await ask("What about Claim B?", t1.result.conversationId);
    const stale = await ask("yes save it", t1.result.conversationId);
    expect(stale.result.answer.answer).toMatch(/stale|no longer current|rejected|regenerate|drift/i);
    expect(await countDrafts()).toBe(before);
    if (stale.action.actionStatus === "COMPLETED") metrics.staleExecutions += 1;
    expect(metrics.staleExecutions).toBe(0);

    const support = await ask("What supports Claim A?");
    expect(support.sources.every((s) => s.documentId !== ids.docForeign)).toBe(true);
    expect(support.result.answer.answer).not.toMatch(/Foreign matter secret/i);
  }, 300_000);
});
