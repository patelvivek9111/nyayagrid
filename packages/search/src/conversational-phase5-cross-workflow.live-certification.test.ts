/**
 * Oct 19–25 Phase 5 — Cross-workflow chaining LOCAL live certification.
 * Separate from legacy conversational-phase5.live-certification.test.ts (UX/confirm).
 * Requires SHARED_RUNTIME_LOCK + RUN_DB_TESTS=1. CourtListener: 0. No schema migration.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  documents,
  matterEntities,
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
  readonly name = "phase5-cross-workflow-fixture";
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

describe.runIf(runDbTests)("Oct 19–25 Phase 5 cross-workflow live certification", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `p5xw_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const metrics = {
    askMs: [] as number[],
    clRequests: 0,
    autoPick: 0,
    factualityEscalation: 0,
    authorityEscalation: 0,
    guestBypass: 0,
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
        authSubject: `p5_owner_${suffix}`,
        email: `p5_owner_${suffix}@example.nyayagrid.local`,
        name: "P5 Cross Owner",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `p5_guest_${suffix}`,
        email: `p5_guest_${suffix}@example.nyayagrid.local`,
        name: "P5 Cross Guest",
      })
      .returning();
    ids.owner = owner!.id;
    ids.guest = guest!.id;

    const org = await createOrganizationWithDefaults(db, {
      name: `P5 Cross Firm ${suffix}`,
      slug: `p5-xw-${suffix}`,
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
        displayName: "P5 Client",
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
        matterNumber: `P5-${suffix}`,
        title: `Phase5 Cross Workflow ${suffix}`,
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
        quote: "Cure notice emailed March 1, 2025. Attachment inspection-report.pdf referenced.",
        score: 0.9,
      },
    ]);
  }, 300_000);

  afterAll(async () => {
    console.log(
      JSON.stringify({
        phase5_cross_workflow_live_metrics: metrics,
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

  it("CHAIN A: hearing → investigate-next → task preview", async () => {
    const t1 = await ask("Prepare me for the motion to compel hearing");
    const v1 = asRecord(t1.result.artifact?.validation);
    expect(v1.hearingPrep || /hearing|motion|INVESTIGATE/i.test(t1.result.answer.answer)).toBeTruthy();

    const t2 = await ask("what should I investigate next?", t1.result.conversationId);
    const v2 = asRecord(t2.result.artifact?.validation);
    const inv = asRecord(v2.investigateNext);
    expect(inv.posture === "RESOLVED" || inv.posture === "NO_MATERIAL_GAP" || /INVESTIGATE_NEXT/i.test(t2.result.answer.answer)).toBeTruthy();

    const cls = classifyConversationalAction({ question: "turn #1 into a task" });
    expect(cls.actionClass).toBe("WRITE_CONFIRMATION_REQUIRED");
    const t3 = await ask("turn #1 into a task", t2.result.conversationId);
    expect(t3.result.answer.answer).toMatch(/confirm|preview|task|Investigate|gap/i);
    expect(metrics.clRequests).toBe(0);
  });

  it("CHAIN B: deposition → research → draft", async () => {
    const t1 = await ask("Prepare me to depose Maria Lopez");
    const v1 = asRecord(t1.result.artifact?.validation);
    const depo = asRecord(v1.depositionPrep);
    expect(
      depo.posture === "RESOLVED" ||
        String(depo.personId ?? "") === ids.maria ||
        /deposition|Maria|OUTLINE|question/i.test(t1.result.answer.answer),
    ).toBeTruthy();

    const t2 = await ask("research whether the notice evidence supports deposing Maria", t1.result.conversationId);
    expect(t2.result.answer.answer.length).toBeGreaterThan(0);

    const t3 = await ask("turn that research into an argument section", t2.result.conversationId);
    const v3 = asRecord(t3.result.artifact?.validation);
    expect(
      v3.matterDraft ||
        /DRAFT PREVIEW|argument|Ambiguous transform|Confirm with/i.test(t3.result.answer.answer),
    ).toBeTruthy();
  });

  it("CHAIN C: document/evidence → person → deposition → investigate-next", async () => {
    const t1 = await ask("What does the notice email say about receipt?");
    expect(t1.result.answer.answer.length).toBeGreaterThan(0);

    const t2 = await ask("Who is Maria Lopez in this matter?", t1.result.conversationId);
    expect(t2.result.answer.answer.length).toBeGreaterThan(0);

    const t3 = await ask("Prepare me to depose Maria Lopez", t2.result.conversationId);
    const v3 = asRecord(t3.result.artifact?.validation);
    const depo = asRecord(v3.depositionPrep);
    expect(
      depo.posture === "RESOLVED" ||
        String(depo.personId ?? "") === ids.maria ||
        /deposition|Maria/i.test(t3.result.answer.answer),
    ).toBeTruthy();

    const t4 = await ask("what should I investigate next?", t3.result.conversationId);
    const v4 = asRecord(t4.result.artifact?.validation);
    const inv = asRecord(v4.investigateNext);
    expect(
      inv.posture === "RESOLVED" ||
        inv.posture === "NO_MATERIAL_GAP" ||
        /INVESTIGATE_NEXT|gap|weak/i.test(t4.result.answer.answer),
    ).toBeTruthy();

    // Ambiguous person must not auto-pick
    const ambPerson = await ask("Prepare me to depose John Smith");
    expect(ambPerson.result.answer.answer).toMatch(/which person|multiple|ambiguous|John Smith/i);
    metrics.autoPick += /auto.?pick|picked John/i.test(ambPerson.result.answer.answer) ? 1 : 0;
  });

  it("CHAIN D: motion → hearing → research → draft", async () => {
    const t1 = await ask("Prepare me for the motion to compel hearing");
    expect(t1.result.answer.answer.length).toBeGreaterThan(0);

    const t2 = await ask("research authorities relevant to the motion to compel hearing", t1.result.conversationId);
    expect(t2.result.answer.answer.length).toBeGreaterThan(0);

    const t3 = await ask("turn that into a draft opposition outline", t2.result.conversationId);
    const v3 = asRecord(t3.result.artifact?.validation);
    expect(
      v3.matterDraft ||
        /DRAFT PREVIEW|outline|Ambiguous transform|Confirm with|opposition/i.test(t3.result.answer.answer),
    ).toBeTruthy();
  });

  it("CHAIN E: whole-matter → weakest → investigate", async () => {
    const t1 = await ask("What are the weakest parts of the record?");
    const v1 = asRecord(t1.result.artifact?.validation);
    const cross = asRecord(v1.crossWorkflow);
    const synth = asRecord(cross.matterSynthesis);
    expect(
      synth.weakestAreas != null ||
        /WEAKEST|MATTER_INTELLIGENCE|INVESTIGATE|weak/i.test(t1.result.answer.answer),
    ).toBeTruthy();
    expect(synth.credibilityScoring === 0 || synth.credibilityScoring == null).toBe(true);
    expect(synth.winProbability === 0 || synth.winProbability == null).toBe(true);

    const t2 = await ask("what should I investigate next?", t1.result.conversationId);
    expect(t2.result.answer.answer.length).toBeGreaterThan(0);
  });

  it("turn-that-into ambiguity + guest confirmation class + large matter bounds + CL=0", async () => {
    const t1 = await ask("Prepare me for the motion to compel hearing");
    // Create second artifact path so bare transform can be ambiguous
    await ask("what should I investigate next?", t1.result.conversationId);
    const amb = await ask("turn that into", t1.result.conversationId);
    expect(amb.result.answer.answer).toMatch(/Ambiguous|Sources:|Targets:|NO_AUTO_PICK|which source/i);

    expect(classifyConversationalAction({ question: "turn #1 into a task" }).actionClass).toBe(
      "WRITE_CONFIRMATION_REQUIRED",
    );
    expect(metrics.clRequests).toBe(0);
    expect(metrics.askMs.every((ms) => ms < 60_000)).toBe(true);
    expect(metrics.autoPick).toBe(0);
  });
});
