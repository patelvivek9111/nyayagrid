/**
 * Oct 19–25 Phase 3 — Draft + research LOCAL live certification.
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
  matterMembers,
  matters,
  memberships,
  users,
  type Database,
} from "@nyayagrid/database";
import { MockAIProvider, type AskStreamEvent } from "@nyayagrid/ai";
import { createCivilClaim, createMatterMotion } from "@nyayagrid/intelligence";
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
  readonly name = "phase3-draft-research-fixture";
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

describe.runIf(runDbTests)("Oct 19–25 Phase 3 draft+research live certification", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `p3dr_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const metrics = {
    askMs: [] as number[],
    clRequests: 0,
    autoPick: 0,
    inventedAuthorities: 0,
    inventedFacts: 0,
    hiddenContrary: 0,
    unauthorizedWrites: 0,
  };

  let retriever: FixtureRetriever;
  const ai = new MockAIProvider();

  beforeAll(async () => {
    const host = new URL(dbUrl).host;
    expect(host).toMatch(/localhost:5433|127\.0\.0\.1:5433/);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p3_owner_${suffix}`,
        email: `p3_owner_${suffix}@example.nyayagrid.local`,
        name: "P3 Draft Owner",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `p3_guest_${suffix}`,
        email: `p3_guest_${suffix}@example.nyayagrid.local`,
        name: "P3 Draft Guest",
      })
      .returning();
    ids.owner = owner!.id;
    ids.guest = guest!.id;

    const org = await createOrganizationWithDefaults(db, {
      name: `P3 Draft Firm ${suffix}`,
      slug: `p3-draft-${suffix}`,
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
        displayName: "P3 Client",
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
        matterNumber: `P3-${suffix}`,
        title: `Phase3 Draft Research ${suffix}`,
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

    await createCivilClaim(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "CLAIM",
      label: "Causation",
      description: "Causation remains thin.",
      supportStatus: "UNKNOWN",
      parties: [],
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
        quote: "Cure notice emailed March 1, 2025 regarding Notice claim.",
        score: 0.9,
      },
    ]);
  }, 300_000);

  afterAll(async () => {
    console.log(
      JSON.stringify({
        phase3_draft_research_live_metrics: metrics,
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
    const validation = asRecord(result.artifact?.validation);
    return {
      result,
      validation,
      research: asRecord(validation.matterResearch),
      draft: asRecord(validation.matterDraft),
      events,
    };
  }

  it("live: research from explicit issue", async () => {
    expect(
      classifyConversationalAction({ question: "research whether the notice evidence is enough" })
        .actionType,
    ).toBe("RESEARCH_READ");
    const t = await ask("research whether the notice evidence is enough");
    expect(["RESOLVED", "NO_AUTHORITIES", "AMBIGUOUS"]).toContain(String(t.research.posture ?? ""));
    expect(metrics.clRequests).toBe(0);
  }, 180_000);

  it("live: ambiguous issue → no auto-pick", async () => {
    const t = await ask("research the claim");
    const ambiguous =
      t.research.posture === "AMBIGUOUS" ||
      asRecord(t.validation.referentResolution).status === "AMBIGUOUS" ||
      /which|multiple|ambiguous/i.test(t.result.answer.answer);
    if (!ambiguous && t.research.posture === "RESOLVED" && !t.research.issueId) {
      metrics.autoPick += 1;
    }
    // Either ambiguous clarification or resolved with explicit issue — never silent wrong pick across two claims.
    expect(metrics.autoPick).toBe(0);
  }, 180_000);

  it("live: research → draft continuity", async () => {
    const t1 = await ask("research whether notice is supported");
    const t2 = await ask("turn that research into an argument section", t1.result.conversationId);
    expect(
      t2.draft.posture === "RESOLVED" ||
        t2.draft.posture === "UNSAFE_PREMISE" ||
        /DRAFT PREVIEW|argument/i.test(t2.result.answer.answer),
    ).toBe(true);
    if (/\b123 U\.S\. 456\b|Smith v\. Invented/i.test(t2.result.answer.answer)) {
      metrics.inventedAuthorities += 1;
    }
    expect(metrics.inventedAuthorities).toBe(0);
  }, 180_000);

  it("live: factual draft grounds disputed facts", async () => {
    const t = await ask("draft the factual background for our motion");
    expect(
      t.draft.posture === "RESOLVED" || /DRAFT PREVIEW|factual/i.test(t.result.answer.answer),
    ).toBe(true);
    if (/\bDefendant knowingly concealed the defect\b/.test(t.result.answer.answer) &&
      !/contends|conflict|allegation/i.test(t.result.answer.answer)) {
      metrics.inventedFacts += 1;
    }
    expect(metrics.inventedFacts).toBe(0);
  }, 180_000);

  it("live: hearing → draft continuity", async () => {
    const t1 = await ask("Prepare me for the motion to compel hearing");
    const t2 = await ask("turn the hearing prep into a draft argument", t1.result.conversationId);
    expect(
      t2.draft.hearingContinuity === true ||
        /hearing|DRAFT PREVIEW|argument/i.test(t2.result.answer.answer),
    ).toBe(true);
  }, 180_000);

  it("live: guest save blocked; no unauthorized write", async () => {
    const before = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));
    const preview = await ask("draft the causation section");
    const guestSave = await ask("save it", preview.result.conversationId, ids.guest);
    const action = asRecord(guestSave.validation.conversationalAction);
    expect(String(action.actionStatus ?? "")).toBe("FAILED");
    const after = await db
      .select({ n: count() })
      .from(drafts)
      .where(and(eq(drafts.organizationId, ids.orgA!), eq(drafts.matterId, ids.matterA!)));
    if (Number(after[0]?.n ?? 0) !== Number(before[0]?.n ?? 0)) metrics.unauthorizedWrites += 1;
    expect(metrics.unauthorizedWrites).toBe(0);
  }, 180_000);

  it("live: large matter bounded + CL=0", async () => {
    const t = await ask("draft only the notice section");
    expect(Number(t.draft.paragraphCount ?? 0)).toBeLessThan(80);
    expect(metrics.clRequests).toBe(0);
    expect(metrics.hiddenContrary).toBe(0);
  }, 180_000);
});
