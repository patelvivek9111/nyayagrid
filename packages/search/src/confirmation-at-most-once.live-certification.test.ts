/**
 * Phase 2 reliability — confirmation at-most-once live repro.
 * RUN_DB_TESTS=1 DATABASE_URL=...localhost:5433/...
 * CourtListener: 0. Shared schema: none.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq, sql } from "drizzle-orm";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  drafts,
  matterMembers,
  matters,
  tasks,
  users,
  type Database,
} from "@nyayagrid/database";
import { MockAIProvider } from "@nyayagrid/ai";
import { askNyayaAboutMatter } from "./nyaya";
import {
  createPendingActionRecord,
  executeConfirmedConversationalAction,
} from "./conversational-workflow-actions";
import { emptyWorkingState } from "./conversation-context";
import type { RetrievalHit, Retriever, RetrievalQuery } from "./hybrid";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const dbUrl =
  process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";

class FixtureRetriever implements Retriever {
  readonly name = "p2-confirm-fixture";
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
  async loadChunksByDocumentIds(): Promise<RetrievalHit[]> {
    return [];
  }
}

describe.runIf(runDbTests)("Phase 2 confirmation at-most-once stress", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `p2c_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  let retriever: FixtureRetriever;

  beforeAll(async () => {
    expect(new URL(dbUrl).host).toMatch(/localhost:5433|127\.0\.0\.1:5433/);
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p2c_${suffix}`,
        email: `p2c_${suffix}@example.nyayagrid.local`,
        name: "P2 Confirm",
      })
      .returning();
    ids.owner = owner!.id;
    const org = await createOrganizationWithDefaults(db, {
      name: `P2C Firm ${suffix}`,
      slug: `p2c-firm-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    ids.org = org.organization.id;
    const [client] = await db
      .insert(clients)
      .values({
        organizationId: ids.org!,
        displayName: "P2C Client",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matter] = await db
      .insert(matters)
      .values({
        organizationId: ids.org!,
        clientId: client!.id,
        matterNumber: `P2C-${suffix}`,
        title: `P2 Confirm ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.matter = matter!.id;
    await db.insert(matterMembers).values({
      organizationId: ids.org!,
      matterId: ids.matter!,
      userId: ids.owner!,
      access: "manage",
    });
    retriever = new FixtureRetriever([]);
  }, 120_000);

  afterAll(async () => {
    await closeDb(db);
  });

  async function countTasks() {
    const [row] = await db
      .select({ n: count() })
      .from(tasks)
      .where(and(eq(tasks.organizationId, ids.org!), eq(tasks.matterId, ids.matter!)));
    return Number(row?.n ?? 0);
  }

  async function countDrafts() {
    const [row] = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.org!), eq(drafts.matterId, ids.matter!)));
    return Number(row?.n ?? 0);
  }

  it("A sequential Ask confirm twice — TASK_CREATE", async () => {
    const before = await countTasks();
    const t1 = await askNyayaAboutMatter({
      db,
      retriever,
      organizationId: ids.org!,
      matterId: ids.matter!,
      userId: ids.owner!,
      question: "Create a task to calendar the cure-notice follow-up.",
      ai: new MockAIProvider(),
      sourceScope: "case",
      includeVerifiedIntelligence: false,
      includeGraph: false,
      includeMemory: false,
      includeProfessionalAnalysis: false,
      includeLegalAuthority: false,
    });
    const action = (t1.artifact?.validation as any)?.conversationalAction;
    expect(action?.actionType).toBe("TASK_CREATE");
    expect(action?.actionStatus).toBe("AWAITING_CONFIRMATION");
    expect(await countTasks()).toBe(before);

    const t2 = await askNyayaAboutMatter({
      db,
      retriever,
      organizationId: ids.org!,
      matterId: ids.matter!,
      userId: ids.owner!,
      conversationId: t1.conversationId,
      question: "confirm",
      ai: new MockAIProvider(),
      sourceScope: "case",
      includeVerifiedIntelligence: false,
      includeGraph: false,
      includeMemory: false,
      includeProfessionalAnalysis: false,
      includeLegalAuthority: false,
    });
    expect((t2.artifact?.validation as any)?.conversationalAction?.actionStatus).toBe("COMPLETED");
    expect(await countTasks()).toBe(before + 1);

    const t3 = await askNyayaAboutMatter({
      db,
      retriever,
      organizationId: ids.org!,
      matterId: ids.matter!,
      userId: ids.owner!,
      conversationId: t1.conversationId,
      question: "confirm",
      ai: new MockAIProvider(),
      sourceScope: "case",
      includeVerifiedIntelligence: false,
      includeGraph: false,
      includeMemory: false,
      includeProfessionalAnalysis: false,
      includeLegalAuthority: false,
    });
    const a3 = (t3.artifact?.validation as any)?.conversationalAction;
    expect(String(t3.answer.answer)).toMatch(/No pending|stale|rejected|confirm/i);
    expect(a3?.actionStatus).not.toBe("COMPLETED");
    expect(await countTasks()).toBe(before + 1);
    console.log(JSON.stringify({ sequential_task: { before, after: await countTasks(), dup: 0 } }));
  }, 180_000);

  it("B concurrent executeConfirmed — same TASK pendingActionId", async () => {
    const before = await countTasks();
    const pending = createPendingActionRecord({
      actionType: "TASK_CREATE",
      actionClass: "WRITE_CONFIRMATION_REQUIRED",
      conversationId: crypto.randomUUID(),
      organizationId: ids.org!,
      matterId: ids.matter!,
      workingState: emptyWorkingState(),
      previewPayload: {
        title: `Concurrent task ${suffix}`,
        description: "at-most-once probe",
        proposedDueAt: null,
      },
    });
    const [r1, r2] = await Promise.all([
      executeConfirmedConversationalAction({
        db,
        userId: ids.owner!,
        pending,
        capability: "matters.edit",
      }),
      executeConfirmedConversationalAction({
        db,
        userId: ids.owner!,
        pending,
        capability: "matters.edit",
      }),
    ]);
    const after = await countTasks();
    const completed = [r1, r2].filter((r) => r.status === "COMPLETED").length;
    const dup = after - before;
    console.log(
      JSON.stringify({
        concurrent_task_execute: {
          before,
          after,
          completedStatuses: completed,
          r1: r1.status,
          r2: r2.status,
          taskIds: [r1.executionResult?.taskId, r2.executionResult?.taskId],
          duplicateWrites: Math.max(0, dup - 1),
        },
      }),
    );
    expect(dup).toBe(1);
    expect(completed).toBe(2);
    expect([r1.alreadyExecuted, r2.alreadyExecuted].filter(Boolean).length).toBe(1);
    expect(r1.executionResult?.taskId).toBe(r2.executionResult?.taskId);
  }, 120_000);

  it("C concurrent executeConfirmed — same DRAFT pendingActionId", async () => {
    const before = await countDrafts();
    const pending = createPendingActionRecord({
      actionType: "DRAFT_SAVE",
      actionClass: "WRITE_CONFIRMATION_REQUIRED",
      conversationId: crypto.randomUUID(),
      organizationId: ids.org!,
      matterId: ids.matter!,
      workingState: emptyWorkingState(),
      previewPayload: {
        draftType: "argument",
        requestedPurpose: `Concurrent draft ${suffix}`,
        previewText: "Preview body for at-most-once probe.",
        sourceRefs: [],
      },
    });
    const [r1, r2] = await Promise.all([
      executeConfirmedConversationalAction({
        db,
        userId: ids.owner!,
        pending,
        capability: "drafts.create",
      }),
      executeConfirmedConversationalAction({
        db,
        userId: ids.owner!,
        pending,
        capability: "drafts.create",
      }),
    ]);
    const after = await countDrafts();
    const dup = after - before;
    console.log(
      JSON.stringify({
        concurrent_draft_execute: {
          before,
          after,
          r1: r1.status,
          r2: r2.status,
          draftIds: [r1.executionResult?.draftId, r2.executionResult?.draftId],
          duplicateWrites: Math.max(0, dup - 1),
        },
      }),
    );
    expect(dup).toBe(1);
    expect([r1.alreadyExecuted, r2.alreadyExecuted].filter(Boolean).length).toBe(1);
    expect(r1.executionResult?.draftId).toBe(r2.executionResult?.draftId);
  }, 120_000);

  it("D concurrent Ask confirm twice — same conversation TASK", async () => {
    const before = await countTasks();
    const t1 = await askNyayaAboutMatter({
      db,
      retriever,
      organizationId: ids.org!,
      matterId: ids.matter!,
      userId: ids.owner!,
      question: "Create a task to send the deficiency letter.",
      ai: new MockAIProvider(),
      sourceScope: "case",
      includeVerifiedIntelligence: false,
      includeGraph: false,
      includeMemory: false,
      includeProfessionalAnalysis: false,
      includeLegalAuthority: false,
    });
    expect((t1.artifact?.validation as any)?.conversationalAction?.actionStatus).toBe(
      "AWAITING_CONFIRMATION",
    );
    const [c1, c2] = await Promise.all([
      askNyayaAboutMatter({
        db,
        retriever,
        organizationId: ids.org!,
        matterId: ids.matter!,
        userId: ids.owner!,
        conversationId: t1.conversationId,
        question: "yes",
        ai: new MockAIProvider(),
        sourceScope: "case",
        includeVerifiedIntelligence: false,
        includeGraph: false,
        includeMemory: false,
        includeProfessionalAnalysis: false,
        includeLegalAuthority: false,
      }),
      askNyayaAboutMatter({
        db,
        retriever,
        organizationId: ids.org!,
        matterId: ids.matter!,
        userId: ids.owner!,
        conversationId: t1.conversationId,
        question: "confirm",
        ai: new MockAIProvider(),
        sourceScope: "case",
        includeVerifiedIntelligence: false,
        includeGraph: false,
        includeMemory: false,
        includeProfessionalAnalysis: false,
        includeLegalAuthority: false,
      }),
    ]);
    const after = await countTasks();
    const statuses = [
      (c1.artifact?.validation as any)?.conversationalAction?.actionStatus,
      (c2.artifact?.validation as any)?.conversationalAction?.actionStatus,
    ];
    console.log(
      JSON.stringify({
        concurrent_ask_confirm: {
          before,
          after,
          statuses,
          duplicateWrites: Math.max(0, after - before - 1),
        },
      }),
    );
    expect(after - before).toBe(1);
  }, 180_000);
});
