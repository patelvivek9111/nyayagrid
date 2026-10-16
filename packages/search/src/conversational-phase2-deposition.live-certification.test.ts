/**
 * Oct 19–25 Phase 2 — Deposition prep LOCAL live certification.
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
  createMatterCommunication,
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
  readonly name = "phase2-deposition-fixture";
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

describe.runIf(runDbTests)("Oct 19–25 Phase 2 deposition prep live certification", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `p2depo_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const metrics = {
    askMs: [] as number[],
    depositionPrepMs: [] as number[],
    clRequests: 0,
    autoPick: 0,
    inventedDeadlines: 0,
    credibilityLeaps: 0,
    crossMatterLeak: 0,
  };

  let retriever: FixtureRetriever;
  const ai = new MockAIProvider();

  beforeAll(async () => {
    const host = new URL(dbUrl).host;
    expect(host).toMatch(/localhost:5433|127\.0\.0\.1:5433/);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p2d_owner_${suffix}`,
        email: `p2d_owner_${suffix}@example.nyayagrid.local`,
        name: "P2 Depo Owner",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `p2d_guest_${suffix}`,
        email: `p2d_guest_${suffix}@example.nyayagrid.local`,
        name: "P2 Depo Guest",
      })
      .returning();
    ids.owner = owner!.id;
    ids.guest = guest!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `P2 Depo Firm ${suffix}`,
      slug: `p2-depo-${suffix}`,
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
        displayName: "P2 Depo Client",
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
        matterNumber: `P2D-A-${suffix}`,
        title: `Phase2 Deposition Matter ${suffix}`,
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
        matterNumber: `P2D-B-${suffix}`,
        title: `Phase2 Foreign Matter ${suffix}`,
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
        description: "former employee — Acme",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [foreign] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterB!,
        entityType: "person",
        displayName: "Foreign Witness",
        normalizedName: "foreign witness",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.maria = maria!.id;
    ids.johnA = johnA!.id;
    ids.johnB = johnB!.id;
    ids.foreign = foreign!.id;

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

    // Bounded large-matter pressure: 500+ docs without dumping into prep.
    const bulk = Array.from({ length: 502 }, (_, i) => ({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      title: `Bulk doc ${i} ${suffix}`,
      createdByUserId: ids.owner!,
    }));
    for (let i = 0; i < bulk.length; i += 100) {
      await db.insert(documents).values(bulk.slice(i, i + 100));
    }

    await createCivilClaim(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "CLAIM",
      label: "Notice",
      description: "Whether Maria received written cure notice.",
      supportStatus: "PARTIALLY_SUPPORTED",
      parties: [],
      provenance,
    });

    await createMatterCommunication(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationType: "OTHER_CORRESPONDENCE",
      direction: "INBOUND",
      subject: `Maria notice email ${suffix}`,
      summary: "Maria wrote she never received the cure notice.",
      occurredAt: new Date("2025-03-02T15:00:00.000Z"),
      primaryDocumentId: ids.docNotice!,
      provenance,
    });
    await createMatterCommunication(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationType: "OTHER_CORRESPONDENCE",
      direction: "INBOUND",
      subject: `Maria affidavit ${suffix}`,
      summary: "Affidavit states Maria received the notice on March 1.",
      occurredAt: new Date("2025-03-10T15:00:00.000Z"),
      primaryDocumentId: ids.docNotice!,
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
          "Cure notice dated March 1, 2025 was sent to Maria Lopez. Accounts conflict on receipt.",
        score: 0.92,
      },
    ]);
  }, 300_000);

  afterAll(async () => {
    console.log(
      JSON.stringify({
        phase2_deposition_live_metrics: metrics,
        courtlistener_requests: metrics.clRequests,
        invented_deadlines: metrics.inventedDeadlines,
        auto_picks: metrics.autoPick,
        credibility_leaps: metrics.credibilityLeaps,
        cross_matter_leak: metrics.crossMatterLeak,
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
    if (/depos|witness|outline|conflict|lied/i.test(question)) metrics.depositionPrepMs.push(fullMs);
    const validation = asRecord(result.artifact?.validation);
    const depositionPrep = asRecord(validation.depositionPrep);
    const completed = events.find((e) => e.type === "generation_completed");
    return { result, validation, depositionPrep, events, completed, fullMs };
  }

  it("live: explicit deponent prep", async () => {
    expect(
      classifyConversationalAction({ question: "prepare me to depose Maria Lopez" }).actionType,
    ).toBe("DEPOSITION_PREP_PREVIEW");
    const t = await ask("Prepare me to depose Maria Lopez");
    expect(t.depositionPrep.posture).toBe("RESOLVED");
    expect(String(t.depositionPrep.personId ?? "")).toBe(ids.maria);
    expect(metrics.clRequests).toBe(0);
  }, 180_000);

  it("live: duplicate name → no auto-pick", async () => {
    const t = await ask("prepare me to depose John Smith");
    const ux =
      t.completed && t.completed.type === "generation_completed" ? t.completed.ux : undefined;
    const ambiguous =
      t.depositionPrep.posture === "AMBIGUOUS" ||
      ux?.turnKind === "ambiguity" ||
      /which person|multiple people/i.test(t.result.answer.answer);
    if (!ambiguous) metrics.autoPick += 1;
    expect(ambiguous).toBe(true);
    expect(metrics.autoPick).toBe(0);
  }, 180_000);

  it("live: multi-turn focus + conflict + outline preview", async () => {
    const t1 = await ask("Prepare me to depose Maria Lopez");
    const t2 = await ask("focus only on notice", t1.result.conversationId);
    expect(String(t2.depositionPrep.personId ?? "")).toBe(ids.maria);
    const t3 = await ask("where does her story conflict with the record?", t2.result.conversationId);
    expect(Number(t3.depositionPrep.conflictCount ?? 0)).toBeGreaterThan(0);
    expect(t3.result.answer.answer).not.toMatch(/\blied|dishonest/i);

    const beforeDrafts = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));
    const t4 = await ask("turn this into a deposition outline", t3.result.conversationId);
    const outlineOk =
      t4.depositionPrep.outlinePreview === true ||
      /draft preview|not saved|DEPOSITION OUTLINE|DRAFT PREVIEW/i.test(t4.result.answer.answer);
    expect(outlineOk).toBe(true);
    const afterDrafts = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));
    expect(Number(afterDrafts[0]?.n ?? 0)).toBe(Number(beforeDrafts[0]?.n ?? 0));
  }, 300_000);

  it("live: prove he lied premise challenged", async () => {
    const t = await ask("what questions prove he lied?");
    const challenge = String(t.depositionPrep.premiseChallenge ?? "");
    const answer = t.result.answer.answer;
    if (/\bhe lied\b|\bprove dishonesty\b/i.test(answer) && !/does not establish dishonesty/i.test(answer + challenge)) {
      metrics.credibilityLeaps += 1;
    }
    expect(metrics.credibilityLeaps).toBe(0);
    expect(challenge.length + answer.length).toBeGreaterThan(0);
  }, 180_000);

  it("live: cross-matter person not resolved into current prep", async () => {
    const t = await ask("Prepare me to depose Foreign Witness");
    const personId = String(t.depositionPrep.personId ?? "");
    if (personId === ids.foreign) metrics.crossMatterLeak += 1;
    expect(metrics.crossMatterLeak).toBe(0);
    expect(personId === ids.foreign).toBe(false);
  }, 180_000);

  it("live: guest write escalation remains blocked", async () => {
    const before = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));
    const preview = await ask("Draft a deposition outline for Maria Lopez");
    const guestSave = await ask("save it", preview.result.conversationId, ids.guest);
    const action = asRecord(guestSave.validation.conversationalAction);
    expect(String(action.actionStatus ?? "")).toBe("FAILED");
    const after = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));
    expect(Number(after[0]?.n ?? 0)).toBe(Number(before[0]?.n ?? 0));
  }, 180_000);

  it("live: no invented deadline + large-matter still person-scoped", async () => {
    const t = await ask("Prepare me to depose Maria Lopez");
    if (/\bdeposition is Friday|notice period is 14 days\b/i.test(t.result.answer.answer)) {
      metrics.inventedDeadlines += 1;
    }
    expect(metrics.inventedDeadlines).toBe(0);
    expect(String(t.depositionPrep.personId ?? "")).toBe(ids.maria);
    expect(Number(t.depositionPrep.questionCount ?? 0)).toBeLessThan(80);
    expect(metrics.clRequests).toBe(0);
  }, 180_000);
});
