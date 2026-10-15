/**
 * Oct 19–25 Phase 1 — Hearing prep LOCAL live certification.
 * Requires SHARED_RUNTIME_LOCK + RUN_DB_TESTS=1 against localhost:5433.
 * CourtListener: 0. Schema migration: NONE.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, count } from "drizzle-orm";
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
import { MockAIProvider, type AskStreamEvent } from "@nyayagrid/ai";
import {
  createCivilClaim,
  createDiscoveryDeficiency,
  createMatterMotion,
} from "@nyayagrid/intelligence";
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
  readonly name = "phase1-hearing-fixture";
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

describe.runIf(runDbTests)("Oct 19–25 Phase 1 hearing prep live certification", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `p1hear_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const metrics = {
    askMs: [] as number[],
    hearingPrepMs: [] as number[],
    clRequests: 0,
    autoPick: 0,
    inventedDeadlines: 0,
  };

  let retriever: FixtureRetriever;
  const ai = new MockAIProvider();

  beforeAll(async () => {
    const host = new URL(dbUrl).host;
    expect(host).toMatch(/localhost:5433|127\.0\.0\.1:5433/);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p1h_owner_${suffix}`,
        email: `p1h_owner_${suffix}@example.nyayagrid.local`,
        name: "P1 Hearing Owner",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `p1h_guest_${suffix}`,
        email: `p1h_guest_${suffix}@example.nyayagrid.local`,
        name: "P1 Hearing Guest",
      })
      .returning();
    ids.owner = owner!.id;
    ids.guest = guest!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `P1 Hearing Firm ${suffix}`,
      slug: `p1-hear-${suffix}`,
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
        displayName: "P1 Hearing Client",
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
        matterNumber: `P1H-A-${suffix}`,
        title: `Phase1 Hearing Matter ${suffix}`,
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
    const claimC = await createCivilClaim(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "CLAIM",
      label: "Claim C — causation",
      description: "Causation remains thin on the record.",
      supportStatus: "UNKNOWN",
      parties: [
        { partyEntityId: ids.plaintiff!, role: "PLAINTIFF" },
        { partyEntityId: ids.defendant!, role: "DEFENDANT" },
      ],
      provenance,
    });
    ids.claimA = claimA.id;
    ids.claimC = claimC.id;

    const compel = await createMatterMotion(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionType: "MOTION_TO_COMPEL",
      title: `Motion to Compel — May 4 ${suffix}`,
      status: "FILED",
      filedAt: new Date("2025-05-04T15:00:00.000Z"),
      hearingAt: new Date("2025-05-28T15:00:00.000Z"),
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
      hearingAt: new Date("2025-07-01T15:00:00.000Z"),
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
          "On March 1, 2025, River Supply Co. sent a written cure notice supporting Claim A. Discovery deficiency remains open on RFP 14.",
        score: 0.92,
      },
    ]);
  }, 180_000);

  afterAll(async () => {
    console.log(
      JSON.stringify({
        phase1_hearing_live_metrics: metrics,
        courtlistener_requests: metrics.clRequests,
        invented_deadlines: metrics.inventedDeadlines,
        auto_picks: metrics.autoPick,
      }),
    );
    await closeDb(db);
  });

  async function ask(question: string, conversationId?: string | null, userId?: string) {
    const events: AskStreamEvent[] = [];
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
      onEvent: (event) => {
        events.push(event);
      },
    });
    const fullMs = Date.now() - askStarted;
    metrics.askMs.push(fullMs);
    if (/hearing|outline|investigate/i.test(question)) metrics.hearingPrepMs.push(fullMs);
    const validation = asRecord(result.artifact?.validation);
    const hearingPrep = asRecord(validation.hearingPrep);
    const completed = events.find((e) => e.type === "generation_completed");
    return { result, validation, hearingPrep, events, completed, fullMs };
  }

  it("live: hearing prep from explicit motion", async () => {
    expect(classifyConversationalAction({ question: "prepare me for the motion to compel hearing" }).actionType).toBe(
      "HEARING_PREP_READ",
    );
    const t = await ask("Prepare me for the motion to compel hearing");
    expect(t.hearingPrep.posture).toBeTruthy();
    expect(String(t.hearingPrep.motionId ?? "")).toBe(ids.compel);
    expect(t.result.answer.answer).not.toMatch(/\bthe judge will ask\b/i);
    expect(metrics.clRequests).toBe(0);
  }, 180_000);

  it("live: ambiguous hearing → no auto-pick", async () => {
    const t = await ask("prepare me for the hearing");
    const ux =
      t.completed && t.completed.type === "generation_completed" ? t.completed.ux : undefined;
    const ambiguous =
      t.hearingPrep.posture === "AMBIGUOUS" ||
      ux?.turnKind === "ambiguity" ||
      /which motion|which hearing|multiple motions/i.test(t.result.answer.answer);
    if (!ambiguous) metrics.autoPick += 1;
    expect(ambiguous).toBe(true);
    expect(metrics.autoPick).toBe(0);
  }, 180_000);

  it("live: multi-turn focus + investigate-next + outline preview", async () => {
    const t1 = await ask("Prepare me for the motion to compel hearing");
    const t2 = await ask("focus only on causation", t1.result.conversationId);
    const t3 = await ask("what should I investigate before the hearing?", t2.result.conversationId);
    expect(Number(t3.hearingPrep.investigateCount ?? 0)).toBeGreaterThan(0);

    const beforeDrafts = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));
    const t4 = await ask("turn this into a hearing outline", t3.result.conversationId);
    expect(t4.hearingPrep.outlinePreview === true || /DRAFT PREVIEW|hearing outline/i.test(t4.result.answer.answer)).toBe(
      true,
    );
    const afterDrafts = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));
    expect(Number(afterDrafts[0]?.n ?? 0)).toBe(Number(beforeDrafts[0]?.n ?? 0));
  }, 300_000);

  it("live: guest access denied for professional Ask", async () => {
    await expect(
      ask("Prepare me for the motion to compel hearing", null, ids.guest),
    ).rejects.toThrow();
  }, 120_000);

  it("live: no invented deadline language when posture known", async () => {
    const t = await ask("Prepare me for the motion to compel hearing");
    if (/\btomorrow at \d|invented hearing date|assume the hearing is Friday/i.test(t.result.answer.answer)) {
      metrics.inventedDeadlines += 1;
    }
    expect(metrics.inventedDeadlines).toBe(0);
    expect(metrics.clRequests).toBe(0);
  }, 180_000);
});
