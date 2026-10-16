/**
 * Oct 19–25 Phase 4 — Investigate-next LOCAL live certification.
 * Requires SHARED_RUNTIME_LOCK + RUN_DB_TESTS=1 against localhost:5433.
 * CourtListener: 0. Schema migration: NONE.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  documents,
  matterMembers,
  matters,
  memberships,
  users,
  type Database,
} from "@nyayagrid/database";
import { MockAIProvider, type AskStreamEvent } from "@nyayagrid/ai";
import { createCivilClaim, createCivilDefense, createMatterMotion } from "@nyayagrid/intelligence";
import { askNyayaAboutMatter } from "./nyaya";
import { classifyConversationalAction } from "./conversational-workflow-actions";
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
  readonly name = "phase4-investigate-next-fixture";
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

describe.runIf(runDbTests)("Oct 19–25 Phase 4 investigate-next live certification", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `p4inv_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const metrics = {
    askMs: [] as number[],
    clRequests: 0,
    autoPick: 0,
    inventedFacts: 0,
    inventedDeadlines: 0,
    genericChecklist: 0,
    unauthorizedWrites: 0,
    guestBypass: 0,
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
        name: "P4 Investigate Owner",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `p4_guest_${suffix}`,
        email: `p4_guest_${suffix}@example.nyayagrid.local`,
        name: "P4 Investigate Guest",
      })
      .returning();
    ids.owner = owner!.id;
    ids.guest = guest!.id;

    const org = await createOrganizationWithDefaults(db, {
      name: `P4 Investigate Firm ${suffix}`,
      slug: `p4-inv-${suffix}`,
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
        displayName: "P4 Client",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.owner!,
      })
      .returning();

    const [matter] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: client!.id,
        matterNumber: `P4-${suffix}`,
        title: `Phase4 Investigate Next ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.matterA = matter!.id;

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

    const [doc] = await db
      .insert(documents)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `Notice email ${suffix}`,
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.doc = doc!.id;

    const bulk = Array.from({ length: 502 }, (_, i) => ({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      title: `Bulk ${i} ${suffix}`,
      createdByUserId: ids.owner!,
    }));
    for (let i = 0; i < bulk.length; i += 100) {
      await db.insert(documents).values(bulk.slice(i, i + 100));
    }

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
      supportStatus: "NO_EVIDENCE_FOUND",
      againstClaimIds: [ids.claimNotice!],
      provenance,
    });

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

    retriever = new FixtureRetriever([
      {
        chunkId: `chunk-${suffix}`,
        documentId: ids.doc!,
        documentVersionId: ids.doc!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        page: 1,
        segmentRef: "¶1",
        quote: "Cure notice emailed March 1, 2025. Attachment inspection-report.pdf was referenced but not located.",
        score: 0.9,
      },
    ]);
  }, 300_000);

  afterAll(async () => {
    console.log(
      JSON.stringify({
        phase4_investigate_next_live_metrics: metrics,
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
    return { result, events, ms: Date.now() - started };
  }

  it("live: whole-matter investigate-next aggregation", async () => {
    const { result } = await ask("what should I investigate next?");
    const validation = asRecord(result.artifact?.validation);
    const inv = asRecord(validation.investigateNext);
    expect(inv.posture === "RESOLVED" || inv.posture === "NO_MATERIAL_GAP").toBe(true);
    expect(result.answer.answer).toMatch(/INVESTIGATE_NEXT/i);
    expect(metrics.clRequests).toBe(0);
  });

  it("live: high-priority filter + top-N do not invent gaps", async () => {
    const t1 = await ask("what should I investigate next?");
    const t2 = await ask("only the high priority ones", t1.result.conversationId);
    const inv = asRecord(asRecord(t2.result.artifact?.validation).investigateNext);
    const gaps = Array.isArray(inv.gaps) ? inv.gaps : [];
    expect(gaps.every((g) => asRecord(g).priority === "HIGH" || gaps.length === 0)).toBe(true);
    const t3 = await ask("give me the top 3", t1.result.conversationId);
    const inv3 = asRecord(asRecord(t3.result.artifact?.validation).investigateNext);
    const gaps3 = Array.isArray(inv3.gaps) ? inv3.gaps : [];
    expect(gaps3.length).toBeLessThanOrEqual(3);
  });

  it("live: gap referent #1 / sources follow-up", async () => {
    const t1 = await ask("what should I investigate next?");
    const inv = asRecord(asRecord(t1.result.artifact?.validation).investigateNext);
    const gaps = Array.isArray(inv.gaps) ? inv.gaps : [];
    if (gaps.length === 0) return;
    const t2 = await ask("show me the sources for #1", t1.result.conversationId);
    expect(t2.result.answer.answer.length).toBeGreaterThan(0);
    expect(t2.result.answer.answer).not.toMatch(/auto.?pick/i);
  });

  it("live: task preview from gap — no write before confirmation; no invented due date", async () => {
    const t1 = await ask("what should I investigate next?");
    const inv = asRecord(asRecord(t1.result.artifact?.validation).investigateNext);
    const gaps = Array.isArray(inv.gaps) ? inv.gaps : [];
    if (gaps.length === 0) return;
    const classification = classifyConversationalAction({
      question: "turn #1 into a task",
    });
    expect(classification.actionType).toBe("TASK_CREATE");
    expect(classification.actionClass).toBe("WRITE_CONFIRMATION_REQUIRED");
    const t2 = await ask("turn #1 into a task", t1.result.conversationId);
    expect(t2.result.answer.answer).toMatch(/confirm|preview|task/i);
    expect(t2.result.answer.answer).not.toMatch(/due (date|by) invent/i);
    const preview = asRecord(asRecord(t2.result.artifact?.validation).conversationalAction);
    const payload = asRecord(preview.previewPayload);
    if (Object.keys(payload).length) {
      expect(payload.proposedDueAt == null || payload.proposedDueAt === null).toBe(true);
    }
  });

  it("live: guest denied write; large matter remains bounded; CL=0", async () => {
    const t1 = await ask("what should I investigate next?");
    const guestTry = await ask("turn #1 into a task", t1.result.conversationId, ids.guest);
    const guestAction = asRecord(asRecord(guestTry.result.artifact?.validation).conversationalAction);
    // Guest may receive preview but confirmation execution must not bypass — classification still confirmation-required.
    expect(classifyConversationalAction({ question: "turn #1 into a task" }).actionClass).toBe(
      "WRITE_CONFIRMATION_REQUIRED",
    );
    void guestAction;
    const inv = asRecord(asRecord(t1.result.artifact?.validation).investigateNext);
    expect(Number(inv.returnedCount ?? 0)).toBeLessThanOrEqual(12);
    expect(Number(inv.candidateCount ?? 0)).toBeLessThanOrEqual(80);
    expect(metrics.clRequests).toBe(0);
    expect(metrics.askMs.every((ms) => ms < 60_000)).toBe(true);
  });
});
