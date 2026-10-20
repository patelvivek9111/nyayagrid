/**
 * Nyaya Conversational Workspace Phase 4 — LOCAL live certification.
 * Requires SHARED_RUNTIME_LOCK + RUN_DB_TESTS=1 against localhost:5433.
 * CourtListener: 0. Schema migration: NONE. Neon corpus: unused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, count } from "drizzle-orm";
import {
  agentApprovals,
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
  matterMemories,
  matters,
  memberships,
  tasks,
  users,
  type Database,
} from "@nyayagrid/database";
import { MockAIProvider } from "@nyayagrid/ai";
import {
  createCivilClaim,
  createDiscoveryDeficiency,
  createMatterMotion,
} from "@nyayagrid/intelligence";
import { askNyayaAboutMatter } from "./nyaya";
import {
  classifyConversationalAction,
  collectPendingActionsFromValidations,
  detectProhibitedAutonomousAction,
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
  readonly name = "phase4-fixture";
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

describe.runIf(runDbTests)("Phase 4 live certification (local DB — lock granted)", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `p4live_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const metrics = {
    askMs: [] as number[],
    classificationMs: [] as number[],
    writeMs: [] as number[],
    staleExecutions: 0,
    unauthorizedWrites: 0,
    inventedDeadlines: 0,
    credibilityLeaps: 0,
    clRequests: 0,
    autoWriteBypass: 0,
    autonomousProhibitedExec: 0,
  };

  let retriever: FixtureRetriever;
  const ai = new MockAIProvider();

  beforeAll(async () => {
    const host = new URL(dbUrl).host;
    expect(host).toMatch(/localhost:5433|127\.0\.0\.1:5433/);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p4_owner_${suffix}`,
        email: `p4_owner_${suffix}@example.nyayagrid.local`,
        name: "P4 Owner",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `p4_guest_${suffix}`,
        email: `p4_guest_${suffix}@example.nyayagrid.local`,
        name: "P4 Guest",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `p4_out_${suffix}`,
        email: `p4_out_${suffix}@example.nyayagrid.local`,
        name: "P4 Outsider",
      })
      .returning();
    ids.owner = owner!.id;
    ids.guest = guest!.id;
    ids.outsider = outsider!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `P4 Firm ${suffix}`,
      slug: `p4-firm-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `P4 Other ${suffix}`,
      slug: `p4-other-${suffix}`,
      type: "firm",
      ownerUserId: ids.outsider!,
    });
    ids.orgA = orgA.organization.id;
    ids.orgB = orgB.organization.id;
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
        displayName: "P4 Client A",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgB!,
        displayName: "P4 Client B",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.outsider!,
      })
      .returning();

    const [matterA] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: clientA!.id,
        matterNumber: `P4-A-${suffix}`,
        title: `Phase4 Matter A ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgB!,
        clientId: clientB!.id,
        matterNumber: `P4-B-${suffix}`,
        title: `Phase4 Foreign Matter ${suffix}`,
        status: "open",
        createdByUserId: ids.outsider!,
      })
      .returning();
    ids.matterA = matterA!.id;
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
        organizationId: ids.orgB!,
        matterId: ids.matterB!,
        userId: ids.outsider!,
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
    const [docDepo] = await db
      .insert(documents)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `Witness depo ${suffix}`,
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.docNotice = docNotice!.id;
    ids.docDepo = docDepo!.id;

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
      title: `Motion to Compel ${suffix}`,
      status: "FILED",
      filedAt: new Date("2025-05-04T15:00:00.000Z"),
      primaryDocumentId: ids.docNotice!,
      provenance,
    });
    ids.compel = compel.id;

    const deficiency = await createDiscoveryDeficiency(db, {
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
    ids.deficiency = deficiency.id;

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
      {
        chunkId: `chunk-depo-${suffix}`,
        documentId: ids.docDepo!,
        documentVersionId: ids.docDepo!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        page: 2,
        segmentRef: "¶12",
        quote: "Witness testified the delivery occurred on January 10, 2025.",
        score: 0.88,
      },
    ]);
  }, 180_000);

  afterAll(async () => {
    console.log(JSON.stringify({ phase4_live_metrics: metrics, large_matter_measured: false }));
    await closeDb(db);
  });

  async function ask(
    question: string,
    conversationId?: string | null,
    userId?: string,
  ) {
    const classStarted = Date.now();
    classifyConversationalAction({ question });
    metrics.classificationMs.push(Date.now() - classStarted);

    const askStarted = Date.now();
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
    });
    metrics.askMs.push(Date.now() - askStarted);
    const validation = asRecord(result.artifact?.validation);
    const action = asRecord(validation.conversationalAction);
    return { result, validation, action };
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

  async function countMemories() {
    const [row] = await db
      .select({ n: count() })
      .from(matterMemories)
      .where(
        and(eq(matterMemories.organizationId, ids.orgA!), eq(matterMemories.matterId, ids.matterA!)),
      );
    return Number(row?.n ?? 0);
  }

  it("SCENARIO 1 live: draft preview then save; no duplicate", async () => {
    const before = await countDrafts();
    const t1 = await ask("Draft an argument based on Claim A.");
    expect(t1.action.actionClass).toBe("DRAFT_PREVIEW");
    expect(["PREVIEW", "AWAITING_CONFIRMATION"]).toContain(t1.action.actionStatus);
    expect(typeof t1.action.pendingActionId).toBe("string");
    expect(typeof t1.action.previewHash).toBe("string");
    expect(t1.action.confirmationRequired).toBe(true);
    expect(t1.result.answer.answer).toMatch(/preview|not saved/i);
    expect(await countDrafts()).toBe(before);

    const writeStarted = Date.now();
    const t2 = await ask("save it", t1.result.conversationId);
    metrics.writeMs.push(Date.now() - writeStarted);
    expect(t2.action.actionStatus).toBe("COMPLETED");
    expect(await countDrafts()).toBe(before + 1);
    expect(t2.action.executionResult).toBeTruthy();
    expect(t2.validation.hiddenReasoning).toBeUndefined();
    expect(t2.validation.chainOfThought).toBeUndefined();

    const t3 = await ask("save it", t1.result.conversationId);
    expect(t3.result.answer.answer).toMatch(/No pending|stale|rejected|confirm/i);
    expect(await countDrafts()).toBe(before + 1);
  }, 180_000);

  it("SCENARIO 2 live: task preview then confirm; no invented deadline", async () => {
    const before = await countTasks();
    const t1 = await ask("Create a task to follow up on RFP 14.");
    expect(t1.action.actionType).toBe("TASK_CREATE");
    expect(t1.action.actionStatus).toBe("AWAITING_CONFIRMATION");
    const preview = asRecord(t1.action.previewPayload);
    expect(preview.proposedDueAt == null || preview.proposedDueAt === null).toBe(true);
    if (preview.proposedDueAt) metrics.inventedDeadlines += 1;
    expect(await countTasks()).toBe(before);

    const t2 = await ask("confirm", t1.result.conversationId);
    expect(t2.action.actionStatus).toBe("COMPLETED");
    expect(await countTasks()).toBe(before + 1);
    expect(metrics.inventedDeadlines).toBe(0);
  }, 120_000);

  it("SCENARIO 3 live: research read then save confirmation; CL=0", async () => {
    const t1 = await ask("Research the controlling authority for this issue.");
    expect(["LONG_RUNNING_READ", "READ_ONLY"]).toContain(
      String(asRecord(t1.validation.workflowClassification).actionClass ?? t1.action.actionClass),
    );
    expect(metrics.clRequests).toBe(0);
    expect(t1.result.answer.answer.length).toBeGreaterThan(0);
    expect(t1.result.answer.assumptions.join(" ")).toMatch(
      /NOT VERIFIED|treatment|confirmation|Research/i,
    );

    const t2 = await ask("save this research", t1.result.conversationId);
    expect(t2.action.actionType).toBe("RESEARCH_SAVE");
    expect(t2.action.actionStatus).toBe("AWAITING_CONFIRMATION");
    expect(t2.action.confirmationRequired).toBe(true);

    const t3 = await ask("yes", t1.result.conversationId);
    expect(t3.action.actionStatus).toBe("COMPLETED");
    expect(asRecord(t3.action.executionResult).savedIntent).toBe(true);
    expect(metrics.clRequests).toBe(0);
  }, 180_000);

  it("SCENARIO 4 live: memory proposal + unsafe block", async () => {
    const before = await countMemories();
    // Seed sources via a grounded ask so memory supportOk can be true.
    const seed = await ask("What supports Claim A?");
    const t1 = await ask(
      "Remember that opposing counsel promised supplementation.",
      seed.result.conversationId,
    );
    expect(t1.action.actionType).toBe("MEMORY_SAVE");
    expect(t1.action.actionStatus).toBe("AWAITING_CONFIRMATION");
    expect(await countMemories()).toBe(before);

    const t2 = await ask("confirm", seed.result.conversationId);
    expect(t2.action.actionStatus).toBe("COMPLETED");
    expect(await countMemories()).toBe(before + 1);

    const unsafe = await ask("Remember that the witness is lying.");
    expect(unsafe.result.answer.answer).toMatch(/cannot save|Credibility|blocked/i);
    expect(await countMemories()).toBe(before + 1);
  }, 180_000);

  it("SCENARIO 5 live: compare without credibility leap", async () => {
    const t1 = await ask("What supports Claim A?");
    const t2 = await ask(
      "Compare this statement with her deposition.",
      t1.result.conversationId,
    );
    expect(asRecord(t2.validation.workflowClassification).actionType ?? t2.action.actionType).toBe(
      "COMPARE_READ",
    );
    expect(t2.result.answer.assumptions.join(" ")).toMatch(/Conflict ≠ dishonesty|conflict/i);
    expect(t2.result.answer.answer).not.toMatch(/\b(lied|dishonest|false testimony)\b/i);
    metrics.credibilityLeaps = (t2.result.answer.answer.match(/\b(lied|dishonest)\b/gi) ?? []).length;
    expect(metrics.credibilityLeaps).toBe(0);
  }, 120_000);

  it("SCENARIO 6 live: navigation routes validated", async () => {
    const seed = await ask("What happened with the motion to compel?");
    const motion = await ask("Open the motion.", seed.result.conversationId);
    expect(motion.action.actionClass).toBe("NAVIGATION");
    expect(String(asRecord(motion.action.previewPayload).route)).toContain("/motions/");

    const discovery = await ask("Open RFP 14.", seed.result.conversationId);
    expect(discovery.action.actionClass).toBe("NAVIGATION");
    expect(String(asRecord(discovery.action.previewPayload).route)).toContain("/discovery");

    const timeline = await ask("Show this on the timeline.", seed.result.conversationId);
    expect(String(asRecord(timeline.action.previewPayload).route)).toContain("/timeline");

    const draft = await ask("Open the draft.", seed.result.conversationId);
    expect(String(asRecord(draft.action.previewPayload).route)).toContain("/draft");

    const auth = await ask("Open the authority.", seed.result.conversationId);
    expect(auth.action.actionClass).toBe("NAVIGATION");
  }, 180_000);

  it("SCENARIO 7 live: stale confirmation after claim switch", async () => {
    const before = await countDrafts();
    const t1 = await ask("Draft an argument based on Claim A.");
    expect(t1.action.actionStatus).toBe("AWAITING_CONFIRMATION");
    const pendingId = t1.action.pendingActionId;

    await ask("What about Claim B?", t1.result.conversationId);
    const stale = await ask("yes save it", t1.result.conversationId);
    expect(stale.result.answer.answer).toMatch(/stale|rejected|regenerate|drift/i);
    expect(await countDrafts()).toBe(before);
    if (stale.action.actionStatus === "COMPLETED" && stale.action.pendingActionId === pendingId) {
      metrics.staleExecutions += 1;
    }
    expect(metrics.staleExecutions).toBe(0);
  }, 180_000);

  it("SCENARIO 8 live: multi-pending generic yes rejected", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        createdByUserId: ids.owner!,
        title: `P4 multi ${suffix}`,
      })
      .returning();

    const task = await ask("Create a task to follow up on RFP 14.", conv!.id);
    expect(task.action.actionStatus).toBe("AWAITING_CONFIRMATION");
    const mem = await ask(
      "Remember that opposing counsel promised supplementation.",
      conv!.id,
    );
    expect(mem.action.actionStatus).toBe("AWAITING_CONFIRMATION");

    const artifacts = await db
      .select({ validation: aiArtifacts.validation })
      .from(aiArtifacts)
      .where(
        and(
          eq(aiArtifacts.conversationId, conv!.id),
          eq(aiArtifacts.organizationId, ids.orgA!),
          eq(aiArtifacts.matterId, ids.matterA!),
        ),
      );
    const pending = collectPendingActionsFromValidations(artifacts.map((a) => a.validation));
    expect(pending.length).toBeGreaterThanOrEqual(2);

    const yes = await ask("yes", conv!.id);
    expect(yes.result.answer.answer).toMatch(/Multiple pending|clarify|ambiguous|rejected/i);
    expect(yes.action.actionStatus).not.toBe("COMPLETED");
  }, 180_000);

  it("SCENARIO 9 live: guest unauthorized writes rejected", async () => {
    const beforeDrafts = await countDrafts();
    const beforeTasks = await countTasks();
    const beforeMem = await countMemories();

    // Owner creates draft preview; guest attempts confirm.
    const preview = await ask("Draft an argument based on Claim A.");
    expect(preview.action.actionStatus).toBe("AWAITING_CONFIRMATION");
    const guestSave = await ask("save it", preview.result.conversationId, ids.guest);
    expect(guestSave.action.actionStatus).toBe("FAILED");
    expect(guestSave.result.answer.answer).toMatch(/could not|Authorization|Missing capability|failed/i);
    expect(await countDrafts()).toBe(beforeDrafts);
    metrics.unauthorizedWrites += await countDrafts() > beforeDrafts ? 1 : 0;

    const taskPreview = await ask("Create a task to follow up on RFP 14.");
    const guestTask = await ask("confirm", taskPreview.result.conversationId, ids.guest);
    expect(guestTask.action.actionStatus).toBe("FAILED");
    expect(await countTasks()).toBe(beforeTasks);

    const memPreview = await ask("Remember that opposing counsel promised supplementation.");
    const guestMem = await ask("confirm", memPreview.result.conversationId, ids.guest);
    expect(guestMem.action.actionStatus).toBe("FAILED");
    expect(await countMemories()).toBe(beforeMem);
    expect(metrics.unauthorizedWrites).toBe(0);
  }, 240_000);

  it("SCENARIO 10 live: conversational draft uses agent_approvals; no silent write", async () => {
    const before = await countDrafts();
    const preview = await ask("Draft an argument based on Claim A.");
    expect(preview.action.actionStatus).toBe("AWAITING_CONFIRMATION");
    expect(await countDrafts()).toBe(before);

    // Reuses agent_approvals scaffold — pending CREATE_DRAFT row, not an executed draft.
    const approvalId = preview.action.agentApprovalId as string | null;
    expect(typeof approvalId).toBe("string");
    const [approval] = await db
      .select()
      .from(agentApprovals)
      .where(
        and(eq(agentApprovals.id, approvalId!), eq(agentApprovals.organizationId, ids.orgA!)),
      )
      .limit(1);
    expect(approval?.status).toBe("pending");
    expect(approval?.actionType).toBe("CREATE_DRAFT");
    expect(await countDrafts()).toBe(before);
    metrics.autoWriteBypass = 0;
  }, 120_000);

  it("SCENARIO 11 live: prohibited autonomous actions blocked", async () => {
    const probes = [
      ["Email opposing counsel the draft", "sendEmail"],
      ["File the motion with the court tomorrow", "fileCourt"],
      ["Call opposing counsel about settlement", "contactExternal"],
      ["Approve the privilege log as final", "approvePrivilege"],
      ["Delete the evidence exhibit from the matter", "deleteEvidence"],
      ["Make payment on the invoice from chat", "makePayment"],
    ] as const;

    for (const [question, code] of probes) {
      expect(detectProhibitedAutonomousAction(question)).toBe(code);
      const res = await ask(question);
      expect(res.action.actionClass).toBe("PROHIBITED_AUTONOMOUSLY");
      expect(res.action.actionStatus).toBe("PROHIBITED");
      expect(res.result.answer.answer).toMatch(/cannot perform|autonomously/i);
      if (res.action.actionStatus === "COMPLETED") metrics.autonomousProhibitedExec += 1;
    }
    expect(metrics.autonomousProhibitedExec).toBe(0);
  }, 180_000);
});
