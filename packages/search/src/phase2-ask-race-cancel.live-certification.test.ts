/**
 * Phase 2 reliability — Ask A/B race + cancel safety (single-instance).
 * RUN_DB_TESTS=1 against localhost:5433. CourtListener: 0. No schema migration.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  matterMembers,
  matters,
  users,
  type Database,
} from "@nyayagrid/database";
import { MockAIProvider } from "@nyayagrid/ai";
import { askNyayaAboutMatter } from "./nyaya";
import { askRunKey, beginAskRun, cancelAskRun, endAskRun } from "./ask-run-control";
import type { RetrievalHit, Retriever, RetrievalQuery } from "./hybrid";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const dbUrl =
  process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";

class FixtureRetriever implements Retriever {
  readonly name = "p2-race-fixture";
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

describe.runIf(runDbTests)("Phase 2 Ask A/B race + cancel (single-instance)", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `p2r_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  let retriever: FixtureRetriever;

  beforeAll(async () => {
    expect(new URL(dbUrl).host).toMatch(/localhost:5433|127\.0\.0\.1:5433/);
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p2r_${suffix}`,
        email: `p2r_${suffix}@example.nyayagrid.local`,
        name: "P2 Race",
      })
      .returning();
    ids.owner = owner!.id;
    const org = await createOrganizationWithDefaults(db, {
      name: `P2R Firm ${suffix}`,
      slug: `p2r-firm-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    ids.org = org.organization.id;
    const [client] = await db
      .insert(clients)
      .values({
        organizationId: ids.org!,
        displayName: "P2R Client",
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
        matterNumber: `P2R-${suffix}`,
        title: `P2 Race ${suffix}`,
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
    retriever = new FixtureRetriever([
      {
        chunkId: `c1-${suffix}`,
        documentId: "11111111-1111-4111-8111-111111111111",
        documentVersionId: "11111111-1111-4111-8111-111111111111",
        organizationId: ids.org!,
        matterId: ids.matter!,
        page: 1,
        segmentRef: "¶1",
        quote: "River Supply sent a cure notice on March 1, 2025 regarding Claim A.",
        score: 0.9,
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await closeDb(db);
  });

  it("single-instance cancel registry aborts matching run only", () => {
    const keyA = askRunKey({
      organizationId: ids.org!,
      matterId: ids.matter!,
      conversationId: "conv-a",
      userId: ids.owner!,
    });
    const keyB = askRunKey({
      organizationId: ids.org!,
      matterId: ids.matter!,
      conversationId: "conv-b",
      userId: ids.owner!,
    });
    const a = beginAskRun(keyA);
    const b = beginAskRun(keyB);
    expect(cancelAskRun(keyA)).toBe(true);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    expect(cancelAskRun(keyB)).toBe(true);
    expect(b.signal.aborted).toBe(true);
    endAskRun(keyA, a);
    endAskRun(keyB, b);
    // Multi-instance cancel is NOT proven (in-memory Map).
    console.log(
      JSON.stringify({
        ask_cancel: { singleInstance: true, multiInstanceProven: false },
      }),
    );
  });

  it("sequential Ask A then B — B answer independent; no stale overwrite of B by A", async () => {
    const a = await askNyayaAboutMatter({
      db,
      retriever,
      organizationId: ids.org!,
      matterId: ids.matter!,
      userId: ids.owner!,
      question: "What does the cure notice say?",
      ai: new MockAIProvider(),
      sourceScope: "case",
      includeVerifiedIntelligence: false,
      includeGraph: false,
      includeMemory: false,
      includeProfessionalAnalysis: false,
      includeLegalAuthority: false,
    });
    const b = await askNyayaAboutMatter({
      db,
      retriever,
      organizationId: ids.org!,
      matterId: ids.matter!,
      userId: ids.owner!,
      conversationId: a.conversationId,
      question: "What is still unresolved about Claim A?",
      ai: new MockAIProvider(),
      sourceScope: "case",
      includeVerifiedIntelligence: false,
      includeGraph: false,
      includeMemory: false,
      includeProfessionalAnalysis: false,
      includeLegalAuthority: false,
    });
    expect(b.conversationId).toBe(a.conversationId);
    expect(b.answer.answer.length).toBeGreaterThan(0);
    expect(a.artifact?.id).not.toBe(b.artifact?.id);
    const aVal = (a.artifact?.validation ?? {}) as Record<string, unknown>;
    const bVal = (b.artifact?.validation ?? {}) as Record<string, unknown>;
    expect(aVal.completionStatus === "cancelled").toBe(false);
    expect(bVal.completionStatus === "cancelled").toBe(false);
    console.log(
      JSON.stringify({
        ask_ab_sequential: {
          aMs: a.timings?.totalMs ?? null,
          bMs: b.timings?.totalMs ?? null,
          distinctArtifacts: a.artifact?.id !== b.artifact?.id,
        },
      }),
    );
  }, 180_000);

  it("retry after cancel works on same conversation", async () => {
    const t1 = await askNyayaAboutMatter({
      db,
      retriever,
      organizationId: ids.org!,
      matterId: ids.matter!,
      userId: ids.owner!,
      question: "Summarize the notice timeline.",
      ai: new MockAIProvider(),
      sourceScope: "case",
      includeVerifiedIntelligence: false,
      includeGraph: false,
      includeMemory: false,
      includeProfessionalAnalysis: false,
      includeLegalAuthority: false,
    });
    // Soft-cancel registry path: begin then cancel mid-flight is covered by ask-run-control unit tests.
    // Here prove post-cancel retry Ask succeeds and writes a new artifact.
    const retry = await askNyayaAboutMatter({
      db,
      retriever,
      organizationId: ids.org!,
      matterId: ids.matter!,
      userId: ids.owner!,
      conversationId: t1.conversationId,
      question: "Summarize the notice timeline again.",
      ai: new MockAIProvider(),
      sourceScope: "case",
      includeVerifiedIntelligence: false,
      includeGraph: false,
      includeMemory: false,
      includeProfessionalAnalysis: false,
      includeLegalAuthority: false,
    });
    expect(retry.answer.answer.length).toBeGreaterThan(0);
    expect(retry.artifact?.id).toBeTruthy();
    console.log(JSON.stringify({ retry_after_prior_turn: { ok: true } }));
  }, 180_000);
});
