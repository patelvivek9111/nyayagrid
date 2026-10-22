/**
 * Nyaya Conversational Workspace Phase 3 — live certification.
 * Requires SHARED_RUNTIME_LOCK + RUN_DB_TESTS=1 against localhost:5433.
 * CourtListener: 0. Schema migration: NONE. Neon corpus: unused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aiArtifacts,
  closeDb,
  conversations,
  createDb,
  createOrganizationWithDefaults,
  clients,
  documents,
  matterEntities,
  matterMembers,
  matters,
  messages,
  users,
  type Database,
  isLocalCertificationDatabaseUrl,
} from "@nyayagrid/database";
import {
  MockAIProvider,
  type AIProvider,
  type AiGenerateRequest,
  type AiGenerateResult,
} from "@nyayagrid/ai";
import {
  createCivilClaim,
  createDiscoveryDeficiency,
  createMatterCommunication,
  createMatterMotion,
  materializeMotionsCommunicationsTimeline,
} from "@nyayagrid/intelligence";
import { planConversationalContext } from "./conversational-context-router";
import {
  ageActiveWorkingState,
  loadMatterReferentCandidates,
  resolveConversationalReferents,
  type MatterEntityCandidate,
} from "./conversational-referent-resolver";
import {
  emptyWorkingState,
  revalidateDocumentIdsInMatter,
  restrictTurnSourceIds,
  type ConversationWorkingState,
} from "./conversation-context";
import { askNyayaAboutMatter } from "./nyaya";
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

const STATIC_ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const STATIC_MATTER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";
const staticClaimA = "11111111-1111-4111-8111-111111111111";
const staticClaimB = "22222222-2222-4222-8222-222222222222";
const staticMotion1 = "33333333-3333-4333-8333-333333333333";
const staticMotion2 = "44444444-4444-4444-8444-444444444444";
const staticSrc1 = "55555555-5555-4555-8555-555555555555";
const staticAuth1 = "77777777-7777-4777-8777-777777777777";
const staticForeign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const staticCandidates: MatterEntityCandidate[] = [
  {
    entityType: "claim",
    entityId: staticClaimA,
    label: "Claim A — breach",
    organizationId: STATIC_ORG,
    matterId: STATIC_MATTER,
  },
  {
    entityType: "claim",
    entityId: staticClaimB,
    label: "Claim B — warranty",
    organizationId: STATIC_ORG,
    matterId: STATIC_MATTER,
  },
  {
    entityType: "motion",
    entityId: staticMotion1,
    label: "Motion to Compel filed May 4",
    organizationId: STATIC_ORG,
    matterId: STATIC_MATTER,
    orderKey: "2025-05-04",
  },
  {
    entityType: "motion",
    entityId: staticMotion2,
    label: "Summary-judgment motion filed June 12",
    organizationId: STATIC_ORG,
    matterId: STATIC_MATTER,
    orderKey: "2025-06-12",
  },
  {
    entityType: "document",
    entityId: staticSrc1,
    label: "Cure notice",
    organizationId: STATIC_ORG,
    matterId: STATIC_MATTER,
  },
  {
    entityType: "authority",
    entityId: staticAuth1,
    label: "347 F.3d 123",
    organizationId: STATIC_ORG,
    matterId: STATIC_MATTER,
  },
];

class FixtureRetriever implements Retriever {
  readonly name = "phase3-fixture";
  constructor(private readonly chunks: RetrievalHit[]) {}

  async search(query: RetrievalQuery): Promise<RetrievalHit[]> {
    return this.chunks
      .filter(
        (c) =>
          c.organizationId === query.scope.organizationId && c.matterId === query.scope.matterId,
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

describe("Phase 3 referent live-cert static gates", () => {
  it("SCENARIO 1 claim chain continuity", () => {
    let ws = {
      ...emptyWorkingState(),
      activeClaimIds: [staticClaimA],
      activeSourceIds: [staticSrc1],
    };
    const sources = resolveConversationalReferents({
      question: "show me the sources",
      organizationId: STATIC_ORG,
      matterId: STATIC_MATTER,
      workingState: ws,
      matterCandidates: staticCandidates,
      allowedSourceIds: [staticSrc1],
      priorStructured: { sourceRefs: [staticSrc1] },
    });
    expect(sources.status).toBe("RESOLVED");
    ws = sources.activeStateAfter;
    const missing = resolveConversationalReferents({
      question: "what is still missing?",
      organizationId: STATIC_ORG,
      matterId: STATIC_MATTER,
      workingState: ws,
      matterCandidates: staticCandidates,
    });
    expect(missing.referents[0]?.entityId).toBe(staticClaimA);
  });

  it("SCENARIO 2 claim switch", () => {
    const result = resolveConversationalReferents({
      question: "What about Claim B?",
      organizationId: STATIC_ORG,
      matterId: STATIC_MATTER,
      workingState: { ...emptyWorkingState(), activeClaimIds: [staticClaimA] },
      matterCandidates: staticCandidates,
    });
    expect(result.activeStateAfter.activeClaimIds[0]).toBe(staticClaimB);
  });

  it("SCENARIO 6 ambiguity — two motions", () => {
    const result = resolveConversationalReferents({
      question: "what happened with that motion?",
      organizationId: STATIC_ORG,
      matterId: STATIC_MATTER,
      workingState: { ...emptyWorkingState(), activeMotionIds: [staticMotion1, staticMotion2] },
      matterCandidates: staticCandidates,
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.referents.every((r) => r.entityId == null)).toBe(true);
  });

  it("SCENARIO 7 cross-matter attack rejected", () => {
    const result = resolveConversationalReferents({
      question: "what happened with that motion?",
      organizationId: STATIC_ORG,
      matterId: STATIC_MATTER,
      workingState: { ...emptyWorkingState(), activeMotionIds: [staticForeign] },
      matterCandidates: staticCandidates,
    });
    expect(result.referents.every((r) => r.entityId !== staticForeign)).toBe(true);
  });

  it("router follows referent force domains", () => {
    const resolved = resolveConversationalReferents({
      question: "what happened after that?",
      organizationId: STATIC_ORG,
      matterId: STATIC_MATTER,
      workingState: { ...emptyWorkingState(), activeMotionIds: [staticMotion1] },
      matterCandidates: staticCandidates,
    });
    const plan = planConversationalContext({
      question: resolved.routingQuestion,
      forceDomains: resolved.forceDomains,
    });
    expect(plan.selectedDomains).toEqual(expect.arrayContaining(["MOTIONS", "TIMELINE"]));
  });

  it("aging prunes superseded claim focus", () => {
    const aged = ageActiveWorkingState({
      prior: { ...emptyWorkingState(), activeClaimIds: [staticClaimA, staticClaimB] },
      promote: [
        {
          entityType: "claim",
          entityId: staticClaimB,
          label: "Claim B",
          matterId: STATIC_MATTER,
          organizationId: STATIC_ORG,
          resolutionMethod: "EXPLICIT_LABEL",
          sourceMessageId: null,
          confidenceCategory: "deterministic",
          ambiguityStatus: "NONE",
        },
      ],
      replaceTypes: ["claim"],
    });
    expect(aged.activeClaimIds).toEqual([staticClaimB]);
  });
});

describe.runIf(runDbTests)("Phase 3 live certification (local DB — lock granted)", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `p3live_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const metrics: {
    askMs: number[];
    resolverMs: number[];
    candidateLookupMs: number[];
    routerMs: number[];
    contextChars: number[];
    activeStateSizes: number[];
    autoPickWhenAmbiguous: number;
  } = {
    askMs: [],
    resolverMs: [],
    candidateLookupMs: [],
    routerMs: [],
    contextChars: [],
    activeStateSizes: [],
    autoPickWhenAmbiguous: 0,
  };

  let retriever: FixtureRetriever;

  /** Agreeable answers for treatment probes so premise constraints are exercised. */
  class PremiseProbeAI extends MockAIProvider implements AIProvider {
    override async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
      if (request.schemaName === "evidence_assessment") {
        return super.generate(request);
      }
      const user = request.messages.find((m) => m.role === "user")?.content ?? "";
      const questionMatch = user.match(/Question:\s*(.+)/i);
      const question = (questionMatch?.[1] ?? user).trim();
      if (/still good law/i.test(question)) {
        return {
          provider: "mock",
          model: "phase3-premise-probe",
          text: JSON.stringify({
            answer: "Yes, this case is still good law.",
            sources: [],
            assumptions: [],
            unresolvedQuestions: [],
            evidenceState: "grounded",
          }),
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }
      return super.generate(request);
    }
  }
  const ai = new PremiseProbeAI();

  beforeAll(async () => {
    const host = new URL(dbUrl).host;
    expect(isLocalCertificationDatabaseUrl(dbUrl)).toBe(true);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p3_owner_${suffix}`,
        email: `p3_owner_${suffix}@example.nyayagrid.local`,
        name: "P3 Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `p3_out_${suffix}`,
        email: `p3_out_${suffix}@example.nyayagrid.local`,
        name: "P3 Outsider",
      })
      .returning();
    ids.owner = owner!.id;
    ids.outsider = outsider!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `P3 Firm ${suffix}`,
      slug: `p3-firm-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `P3 Other ${suffix}`,
      slug: `p3-other-${suffix}`,
      type: "firm",
      ownerUserId: ids.outsider!,
    });
    ids.orgA = orgA.organization.id;
    ids.orgB = orgB.organization.id;

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgA!,
        displayName: "P3 Client A",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgB!,
        displayName: "P3 Client B",
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
        matterNumber: `P3-A-${suffix}`,
        title: `Phase3 Matter A ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgB!,
        clientId: clientB!.id,
        matterNumber: `P3-B-${suffix}`,
        title: `Phase3 Foreign Matter ${suffix}`,
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
    const [docOrder] = await db
      .insert(documents)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `Compel order ${suffix}`,
        createdByUserId: ids.owner!,
      })
      .returning();
    const [docForeign] = await db
      .insert(documents)
      .values({
        organizationId: ids.orgB!,
        matterId: ids.matterB!,
        title: `Foreign doc ${suffix}`,
        createdByUserId: ids.outsider!,
      })
      .returning();
    ids.docNotice = docNotice!.id;
    ids.docOrder = docOrder!.id;
    ids.docForeign = docForeign!.id;

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
      status: "GRANTED",
      disposition: "GRANTED",
      rulingSummary:
        "Court granted the motion to compel production of the cure-notice attachments.",
      judgeName: "Judge SYNTH",
      filedAt: new Date("2025-05-04T15:00:00.000Z"),
      rulingAt: new Date("2025-06-01T15:00:00.000Z"),
      hearingAt: new Date("2025-05-28T15:00:00.000Z"),
      primaryDocumentId: ids.docNotice!,
      orderDocumentId: ids.docOrder!,
      provenance,
    });
    const sj = await createMatterMotion(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionType: "SUMMARY_JUDGMENT",
      title: `Summary-judgment motion ${suffix}`,
      status: "FILED",
      disposition: null,
      rulingSummary: null,
      filedAt: new Date("2025-06-12T15:00:00.000Z"),
      primaryDocumentId: ids.docNotice!,
      provenance,
    });
    ids.compel = compel.id;
    ids.sj = sj.id;

    const mac = await createMatterCommunication(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationType: "MEET_AND_CONFER",
      subject: `MAC re missing RFP production ${suffix}`,
      summary: "Counsel conferred regarding missing attachments to RFP responses.",
      direction: "OUTBOUND",
      status: "SENT",
      occurredAt: new Date("2025-04-20T15:00:00.000Z"),
      provenance,
    });
    const responseComm = await createMatterCommunication(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationType: "RESPONSE",
      subject: `Partial response to MAC ${suffix}`,
      summary: "Opposing counsel sent a partial production response.",
      direction: "INBOUND",
      status: "RECEIVED",
      occurredAt: new Date("2025-04-27T15:00:00.000Z"),
      provenance,
    });
    ids.mac = mac.id;
    ids.responseComm = responseComm.id;

    const deficiency = await createDiscoveryDeficiency(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "PARTIAL_RESPONSE",
      status: "OPEN",
      description: `Missing attachments on RFP #12 ${suffix}`,
      communicationId: ids.responseComm!,
      motionId: ids.compel!,
      openedAt: new Date("2025-04-28T15:00:00.000Z"),
      provenance,
    });
    ids.deficiency = deficiency.id;

    await materializeMotionsCommunicationsTimeline({
      db,
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });

    // Foreign-matter claim (must never bind into matter A).
    const [foreignPlaintiff] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgB!,
        matterId: ids.matterB!,
        entityType: "organization",
        displayName: "Foreign Co.",
        normalizedName: "foreign co.",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.outsider!,
      })
      .returning();
    const foreignClaim = await createCivilClaim(db, {
      userId: ids.outsider!,
      organizationId: ids.orgB!,
      matterId: ids.matterB!,
      kind: "CLAIM",
      label: "Claim A — foreign breach",
      description: "Foreign matter claim.",
      supportStatus: "UNKNOWN",
      parties: [{ partyEntityId: foreignPlaintiff!.id, role: "PLAINTIFF" }],
      provenance,
    });
    ids.foreignClaim = foreignClaim.id;

    ids.auth1 = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    ids.auth2 = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa";
    ids.nonexistent = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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
          "On March 1, 2025, River Supply Co. sent a written cure notice supporting Claim A defective parts.",
        score: 0.9,
      },
      {
        chunkId: `chunk-order-${suffix}`,
        documentId: ids.docOrder!,
        documentVersionId: ids.docOrder!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        page: 1,
        segmentRef: "¶2",
        quote:
          "On June 1, 2025, the court GRANTED the motion to compel and ordered production of the missing attachments.",
        score: 0.91,
      },
    ]);
  }, 180_000);

  afterAll(async () => {
    console.log(
      JSON.stringify({
        phase3_live_metrics: {
          ask_ms_observed: metrics.askMs,
          resolver_ms_observed: metrics.resolverMs,
          candidate_lookup_ms_observed: metrics.candidateLookupMs,
          router_ms_observed: metrics.routerMs,
          context_chars_observed: metrics.contextChars,
          active_state_sizes: metrics.activeStateSizes,
          auto_pick_when_ambiguous: metrics.autoPickWhenAmbiguous,
          samples: metrics.askMs.length,
          large_matter_measured: false,
        },
      }),
    );
    await closeDb(db);
  });

  async function ask(question: string, conversationId?: string | null) {
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
      includeLegalAuthority: false,
      sourceScope: "case",
    });
    metrics.askMs.push(Date.now() - askStarted);
    const validation = asRecord(result.artifact?.validation);
    const rr = asRecord(validation.referentResolution);
    const diag = asRecord(rr.diagnostics);
    if (typeof diag.resolverLatencyMs === "number") {
      metrics.resolverMs.push(diag.resolverLatencyMs);
    }
    if (typeof diag.candidateLookupLatencyMs === "number") {
      metrics.candidateLookupMs.push(diag.candidateLookupLatencyMs);
    }
    const ws = asRecord(validation.conversationWorkingState) as unknown as ConversationWorkingState;
    const size =
      (ws.activeClaimIds?.length ?? 0) +
      (ws.activeMotionIds?.length ?? 0) +
      (ws.activeDeficiencyIds?.length ?? 0) +
      (ws.activeAuthorityIds?.length ?? 0) +
      (ws.activeSourceIds?.length ?? 0);
    metrics.activeStateSizes.push(size);
    const contract = asRecord(validation.factualityContract);
    const ctx = Number(asRecord(contract.contextDiagnostics).contextChars ?? 0);
    if (ctx > 0) metrics.contextChars.push(ctx);
    return { result, validation, rr, diag, ws };
  }

  it("candidate loader is matter-scoped and excludes foreign IDs", async () => {
    const started = Date.now();
    const { candidates, lookupLatencyMs } = await loadMatterReferentCandidates(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    metrics.candidateLookupMs.push(lookupLatencyMs || Date.now() - started);
    expect(candidates.some((c) => c.entityId === ids.claimA)).toBe(true);
    expect(candidates.some((c) => c.entityId === ids.claimB)).toBe(true);
    expect(candidates.some((c) => c.entityId === ids.compel)).toBe(true);
    expect(candidates.some((c) => c.entityId === ids.deficiency)).toBe(true);
    expect(
      candidates.every((c) => c.matterId === ids.matterA && c.organizationId === ids.orgA),
    ).toBe(true);
    expect(candidates.every((c) => c.entityId !== ids.foreignClaim)).toBe(true);
    expect(candidates.every((c) => c.entityId !== ids.docForeign)).toBe(true);
  }, 60_000);

  it("SCENARIO 1 live: claim chain", async () => {
    const t1 = await ask("What supports Claim A?");
    expect(t1.rr.status).toBe("RESOLVED");
    expect(t1.ws.activeClaimIds?.[0]).toBe(ids.claimA);
    expect(t1.diag.resolvedEntityId).toBe(ids.claimA);
    expect(t1.validation.factualityContract != null).toBe(true);

    const t2 = await ask("show me the sources", t1.result.conversationId);
    expect(t2.ws.activeClaimIds?.[0]).toBe(ids.claimA);
    const allowed = await revalidateDocumentIdsInMatter(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      documentIds: [...(t2.ws.activeSourceIds ?? []), ids.docForeign!, "not-a-uuid"],
    });
    expect(allowed.every((id) => id !== ids.docForeign)).toBe(true);
    expect(allowed).not.toContain("not-a-uuid");
    const scrubbed = restrictTurnSourceIds(
      [
        {
          messageId: "m1",
          role: "assistant",
          content: "prior",
          createdAt: new Date(),
          completionStatus: "completed",
          evidenceState: "grounded",
          sourceIds: [...(t2.ws.activeSourceIds ?? []), ids.docForeign!, "not-a-uuid"],
          authorityIds: [],
          workingState: null,
        },
      ],
      allowed,
    );
    expect(scrubbed[0]!.sourceIds).not.toContain(ids.docForeign);
    expect(scrubbed[0]!.sourceIds).not.toContain("not-a-uuid");

    const t3 = await ask("what is still missing?", t1.result.conversationId);
    expect(t3.ws.activeClaimIds?.[0]).toBe(ids.claimA);
    expect(t3.ws.activeClaimIds).not.toContain(ids.claimB);
    expect(t3.validation.factualityContract != null).toBe(true);
    console.log(
      JSON.stringify({
        scenario1: {
          activeClaim: t3.ws.activeClaimIds,
          referentMethods: [
            t1.diag.resolutionMethod,
            t2.diag.resolutionMethod,
            t3.diag.resolutionMethod,
          ],
        },
      }),
    );
  }, 180_000);

  it("SCENARIO 2 live: claim switch", async () => {
    const t1 = await ask("What supports Claim A?");
    expect(t1.ws.activeClaimIds?.[0]).toBe(ids.claimA);
    const routerStarted = Date.now();
    const t2 = await ask("What about Claim B?", t1.result.conversationId);
    metrics.routerMs.push(Date.now() - routerStarted);
    expect(t2.ws.activeClaimIds?.[0]).toBe(ids.claimB);
    expect(t2.ws.activeClaimIds).not.toContain(ids.claimA);
    expect(t2.rr.forceDomains ?? []).toEqual(expect.arrayContaining(["CLAIMS"]));
    const domains = (t2.validation.selectedDomains as string[]) ?? [];
    expect(domains).toContain("CLAIMS");
  }, 180_000);

  it("SCENARIO 3 live: discovery chain", async () => {
    const t1 = await ask("What discovery is missing?");
    expect((t1.ws.activeDeficiencyIds ?? []).length).toBeGreaterThan(0);
    expect(t1.ws.activeDeficiencyIds).toContain(ids.deficiency);

    const t2 = await ask("did they respond?", t1.result.conversationId);
    expect(t2.ws.activeDeficiencyIds?.[0]).toBe(ids.deficiency);
    // Response link only from persisted communicationId on deficiency.
    const { candidates } = await loadMatterReferentCandidates(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    const def = candidates.find((c) => c.entityId === ids.deficiency);
    expect(def?.linkedIds?.communication).toContain(ids.responseComm);

    const t3 = await ask("what motion did that lead to?", t1.result.conversationId);
    expect(t3.rr.status).toBe("RESOLVED");
    const resolvedMotion = (
      t3.rr.referents as Array<{ entityType: string; entityId: string | null }> | undefined
    )?.find((r) => r.entityType === "motion");
    expect(resolvedMotion?.entityId).toBe(ids.compel);
    // No synthesized SJ contamination.
    expect(
      (t3.rr.referents as Array<{ entityId: string | null }> | undefined)?.some(
        (r) => r.entityId === ids.sj,
      ),
    ).toBe(false);
  }, 180_000);

  it("SCENARIO 4 live: motion / timeline chain", async () => {
    const t1 = await ask("What happened with the motion to compel?");
    expect(t1.rr.status).toBe("RESOLVED");
    expect(t1.ws.activeMotionIds?.[0]).toBe(ids.compel);

    const t2 = await ask("what did the judge rule?", t1.result.conversationId);
    expect(t2.ws.activeMotionIds?.[0]).toBe(ids.compel);
    expect(t2.result.answer.answer).toMatch(/GRANTED|granted|compel/i);

    const t3 = await ask("what happened after that?", t1.result.conversationId);
    expect(t3.rr.status).toBe("RESOLVED");
    expect(t3.ws.activeMotionIds?.[0]).toBe(ids.compel);
    expect((t3.rr.forceDomains as string[] | undefined) ?? []).toEqual(
      expect.arrayContaining(["MOTIONS", "TIMELINE"]),
    );
    expect(t3.diag.resolutionMethod).toMatch(/ACTIVE_CONTEXT|EXPLICIT_LABEL|PRIOR_STRUCTURED/);
  }, 180_000);

  it("SCENARIO 5 live: authority chain", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        createdByUserId: ids.owner!,
        title: `P3 authority ${suffix}`,
      })
      .returning();
    const [msg] = await db
      .insert(messages)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        conversationId: conv!.id,
        role: "assistant",
        content: "Two SYNTH authorities were retrieved: 347 F.3d 123 and 401 F.3d 456.",
        createdByUserId: ids.owner!,
      })
      .returning();
    await db.insert(aiArtifacts).values({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: conv!.id,
      messageId: msg!.id,
      artifactType: "matter_qa",
      question: "Which cases support this?",
      answer: "Two SYNTH authorities were retrieved: 347 F.3d 123 and 401 F.3d 456.",
      evidenceState: "insufficient",
      provider: "synthetic_p3",
      model: "synthetic_p3",
      promptVersion: "p3-live",
      retrievedChunkIds: [],
      citations: [],
      validation: {
        completionStatus: "completed",
        conversationWorkingState: {
          version: 1,
          summaryLines: ["Active topic: Authorities"],
          activeClaimIds: [ids.claimA!],
          activeDefenseIds: [],
          activeMotionIds: [],
          activeDiscoveryIds: [],
          activeDeficiencyIds: [],
          activeCommunicationIds: [],
          activeAuthorityIds: [ids.auth1!, ids.auth2!],
          activeSourceIds: [ids.docNotice!],
          activeTaskIds: [],
          issueLabels: ["Authorities"],
          unresolvedQuestions: [],
          authorityStates: [
            {
              id: ids.auth1!,
              resolution: "AUTHORITY_RESOLVED",
              treatmentVerified: false,
            },
            {
              id: ids.auth2!,
              resolution: "IDENTITY_UNRESOLVED",
              treatmentVerified: false,
            },
          ],
          updatedAt: new Date().toISOString(),
        },
        factualityContract: {
          assertions: [],
          authorityRefs: [ids.auth1!, ids.auth2!],
          sourceRefs: [ids.docNotice!],
        },
      },
      createdByUserId: ids.owner!,
    });

    const t2 = await ask("What does the first case hold?", conv!.id);
    expect(t2.rr.status).toBe("RESOLVED");
    expect(t2.diag.resolvedEntityId).toBe(ids.auth1);
    expect(t2.ws.activeAuthorityIds?.[0]).toBe(ids.auth1);
    expect(t2.ws.authorityStates?.find((a) => a.id === ids.auth1)?.treatmentVerified).toBe(false);

    const t3 = await ask("Is that still good law?", conv!.id);
    expect(t3.ws.activeAuthorityIds?.[0]).toBe(ids.auth1);
    const premise = asRecord(t3.validation.premiseCheck);
    expect(premise.detected).toBe(true);
    expect(["UNSUPPORTED", "UNKNOWN"]).toContain(premise.result);
    expect(t3.result.answer.answer).toMatch(
      /NOT VERIFIED|UNKNOWN|not verified|Unsupported|does not establish/i,
    );
    // Must not affirm treatment from model memory.
    expect(t3.result.answer.answer).not.toMatch(
      /\b(is still good law|remains good law|negative treatment confirmed|was overruled)\b/i,
    );
    const states = t3.ws.authorityStates ?? [];
    expect(states.some((s) => s.resolution === "AUTHORITY_RESOLVED")).toBe(true);
    expect(states.every((s) => s.treatmentVerified === false || s.treatmentVerified == null)).toBe(
      true,
    );
  }, 180_000);

  it("SCENARIO 6 live: ambiguity fail-closed (auto-pick = 0)", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        createdByUserId: ids.owner!,
        title: `P3 ambiguity ${suffix}`,
      })
      .returning();
    const [msg] = await db
      .insert(messages)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        conversationId: conv!.id,
        role: "assistant",
        content: `Prior answer discussed Motion to Compel ${suffix} and Summary-judgment motion ${suffix}.`,
        createdByUserId: ids.owner!,
      })
      .returning();
    await db.insert(aiArtifacts).values({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: conv!.id,
      messageId: msg!.id,
      artifactType: "matter_qa",
      question: "list motions",
      answer: `Prior answer discussed Motion to Compel ${suffix} and Summary-judgment motion ${suffix}.`,
      evidenceState: "grounded",
      provider: "synthetic_p3",
      model: "synthetic_p3",
      promptVersion: "p3-live",
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

    const ambiguous = await ask("what happened with that motion?", conv!.id);
    expect(ambiguous.rr.status).toBe("AMBIGUOUS");
    expect(Number(ambiguous.diag.candidateCount ?? 0)).toBeGreaterThanOrEqual(2);
    expect(
      ambiguous.diag.resolvedEntityId == null || ambiguous.diag.resolvedEntityId === null,
    ).toBe(true);
    const refs = (ambiguous.rr.referents as Array<{ entityId: string | null }> | undefined) ?? [];
    expect(refs.every((r) => r.entityId == null)).toBe(true);
    metrics.autoPickWhenAmbiguous = refs.filter((r) => r.entityId != null).length;
    expect(metrics.autoPickWhenAmbiguous).toBe(0);
    expect(ambiguous.result.answer.answer.length).toBeGreaterThan(10);
    expect(ambiguous.result.answer.answer).toMatch(
      /do you mean|clarif|which motion|more than one/i,
    );
    expect(ambiguous.result.answer.answer).toMatch(/compel|summary/i);
  }, 120_000);

  it("SCENARIO 7 live: cross-matter / foreign / nonexistent scrub", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        createdByUserId: ids.owner!,
        title: `P3 attack ${suffix}`,
      })
      .returning();
    const [msg] = await db
      .insert(messages)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        conversationId: conv!.id,
        role: "assistant",
        content: "Poisoned prior state.",
        createdByUserId: ids.owner!,
      })
      .returning();
    await db.insert(aiArtifacts).values({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: conv!.id,
      messageId: msg!.id,
      artifactType: "matter_qa",
      question: "prior",
      answer: "Poisoned prior state.",
      evidenceState: "insufficient",
      provider: "synthetic_p3",
      model: "synthetic_p3",
      promptVersion: "p3-live",
      retrievedChunkIds: [],
      citations: [],
      validation: {
        completionStatus: "completed",
        conversationWorkingState: {
          version: 1,
          summaryLines: [],
          activeClaimIds: [ids.foreignClaim!, ids.nonexistent!],
          activeDefenseIds: [],
          activeMotionIds: [ids.foreignClaim!],
          activeDiscoveryIds: [],
          activeDeficiencyIds: [],
          activeCommunicationIds: [],
          activeAuthorityIds: [],
          activeSourceIds: [ids.docForeign!, "not-a-uuid"],
          activeTaskIds: [],
          issueLabels: [],
          unresolvedQuestions: [],
          authorityStates: [],
          updatedAt: new Date().toISOString(),
        },
      },
      createdByUserId: ids.owner!,
    });

    const poisoned = await ask("What supports Claim A?", conv!.id);
    expect(poisoned.ws.activeClaimIds).toContain(ids.claimA);
    expect(poisoned.ws.activeClaimIds).not.toContain(ids.foreignClaim);
    expect(poisoned.ws.activeClaimIds).not.toContain(ids.nonexistent);
    expect(poisoned.ws.activeMotionIds ?? []).not.toContain(ids.foreignClaim);
    expect(poisoned.ws.activeSourceIds ?? []).not.toContain(ids.docForeign);
    expect(poisoned.ws.activeSourceIds ?? []).not.toContain("not-a-uuid");

    const revalidated = await revalidateDocumentIdsInMatter(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      documentIds: [ids.docNotice!, ids.docForeign!, "not-a-uuid"],
    });
    expect(revalidated).toContain(ids.docNotice);
    expect(revalidated).not.toContain(ids.docForeign);
    expect(revalidated).not.toContain("not-a-uuid");
  }, 180_000);

  it("active-state aging remains bounded across switches", async () => {
    const t1 = await ask("What supports Claim A?");
    const t2 = await ask("What about Claim B?", t1.result.conversationId);
    const t3 = await ask("What happened with the motion to compel?", t1.result.conversationId);
    expect((t3.ws.activeClaimIds ?? []).length).toBeLessThanOrEqual(3);
    expect((t3.ws.activeMotionIds ?? []).length).toBeLessThanOrEqual(3);
    expect(t3.ws.activeMotionIds?.[0]).toBe(ids.compel);
    // Latest successful motion focus outranks stale claim-only focus for motion questions.
    expect(metrics.activeStateSizes.every((n) => n <= 30)).toBe(true);
    void t2;
  }, 180_000);
});
