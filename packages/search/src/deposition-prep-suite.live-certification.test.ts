/**
 * Nyaya Conversational Workspace Phase 2 — LOCAL live certification.
 * Requires SHARED_RUNTIME_LOCK before RUN_DB_TESTS=1 against localhost:5433.
 * CourtListener: 0. Schema migration: NONE. Neon corpus: unused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
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
} from "@nyayagrid/database";
import {
  MockAIProvider,
  type AIProvider,
  type AiGenerateRequest,
  type AiGenerateResult,
} from "@nyayagrid/ai";
import { createCivilClaim } from "@nyayagrid/intelligence";
import { createMatterMotion } from "@nyayagrid/intelligence";
import {
  buildFactualityContract,
  constrainAnswerToPremiseCheck,
  countCredibilityLeaps,
  countInventedDeadlines,
  countInventedDispositions,
  evaluatePremiseAgainstRecord,
} from "@nyayagrid/ai";
import { planConversationalContext } from "./conversational-context-router";
import {
  CONVERSATION_RECENT_TURN_LIMIT,
  revalidateDocumentIdsInMatter,
  restrictTurnSourceIds,
  selectRecentTurns,
  type ConversationTurnForPrompt,
} from "./conversation-context";
import { askNyayaAboutMatter } from "./nyaya";
import type { RetrievalHit, Retriever, RetrievalQuery } from "./hybrid";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const dbUrl = process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";

const provenance = {
  documentId: null,
  sourceSpan: null,
  extractionOrigin: "human" as const,
  humanEntered: true,
};

/** Always returns matter-scoped fixture passages (no CourtListener). */
class FixtureRetriever implements Retriever {
  readonly name = "phase2-fixture";
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

/**
 * Agreeable AI for false-premise prompts so post-generation constraints are exercised.
 * Falls back to MockAIProvider for ordinary grounded answers.
 */
class PremiseProbeAI extends MockAIProvider implements AIProvider {
  override async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    if (request.schemaName === "evidence_assessment") {
      return super.generate(request);
    }
    const user = request.messages.find((m) => m.role === "user")?.content ?? "";
    const questionMatch = user.match(/Question:\s*(.+)/i);
    const question = (questionMatch?.[1] ?? user).trim();

    const agreeable = (answer: string): AiGenerateResult => ({
      provider: "mock",
      model: "phase2-premise-probe",
      text: JSON.stringify({
        answer,
        sources: [],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      }),
      usage: { inputTokens: 0, outputTokens: 0 },
    });

    if (/we won the motion/i.test(question)) {
      return agreeable("Yes, you won the motion.");
    }
    if (/witness lie|witness lied/i.test(question)) {
      return agreeable("Yes, the witness lied about the date.");
    }
    if (/still good law/i.test(question)) {
      return agreeable("Yes, this case is still good law.");
    }
    if (/discovery closes friday/i.test(question)) {
      return agreeable("Yes, discovery closes Friday.");
    }
    if (/proves we win/i.test(question)) {
      return agreeable("Yes, that proves we win.");
    }
    return super.generate(request);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

describe("Phase 2 factuality + router static certification gates", () => {
  it("SCENARIO 1: false premise rejected", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "We won the motion, right?",
      record: { persistedDispositions: [] },
    });
    const out = constrainAnswerToPremiseCheck(
      { answer: "Yes, you won.", evidenceState: "grounded" },
      premise,
    );
    expect(premise.result).toBe("UNSUPPORTED");
    expect(out.answer).not.toMatch(/^Yes/i);
  });

  it("SCENARIO 2: narrow motion router", () => {
    const plan = planConversationalContext({
      question: "What did the judge rule on the motion?",
    });
    expect(plan.wholeMatterUsed).toBe(false);
    expect(plan.loaders.motionsComms).toBe(true);
    expect(plan.loaders.civil).toBe(false);
    expect(plan.loaders.discovery).toBe(false);
    expect(plan.selectedDomains).toContain("MOTIONS");
    expect(plan.selectedDomains).not.toContain("WHOLE_MATTER");
  });

  it("SCENARIO 3: whole-matter without duplicate loaders", () => {
    const plan = planConversationalContext({
      question: "What is happening in this matter and what should we investigate next?",
    });
    expect(plan.wholeMatterUsed).toBe(true);
    expect(plan.loaders.civil).toBe(false);
    expect(plan.loaders.discovery).toBe(false);
    expect(plan.loaders.motionsComms).toBe(false);
  });

  it("SCENARIO 4: credibility leap blocked", () => {
    const contract = buildFactualityContract({
      assertions: [
        {
          type: "CONFLICT",
          text: "The witness lied about the date.",
          sourceIds: ["d1", "d2"],
          relatedEntityIds: [],
        },
      ],
      allowedSourceIds: ["d1", "d2"],
    });
    expect(contract.assertions[0]?.text).not.toMatch(/\blied\b/i);
    expect(countCredibilityLeaps(contract.assertions[0]?.text ?? "")).toBe(0);
  });

  it("SCENARIO 5: treatment unknown stays unknown", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "Is this case still good law?",
      record: {
        authorities: [
          { id: "a1", resolution: "AUTHORITY_RESOLVED", treatmentVerified: false, hasFullText: false },
        ],
      },
    });
    expect(premise.detected).toBe(true);
    expect(["UNKNOWN", "UNSUPPORTED"]).toContain(premise.result);
    const contract = buildFactualityContract({
      assertions: [
        {
          type: "FACT",
          text: "This case is still good law.",
          sourceIds: ["a1"],
          relatedEntityIds: [],
          authorityState: "AUTHORITY_RESOLVED",
          treatmentVerified: false,
        },
      ],
      allowedSourceIds: ["a1"],
    });
    expect(contract.assertions[0]?.type).toBe("UNKNOWN");
  });

  it("SCENARIO 6: deadline unknown when not persisted", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "So discovery closes Friday, right?",
      record: { persistedDeadlines: [] },
    });
    const out = constrainAnswerToPremiseCheck(
      { answer: "Discovery closes Friday.", evidenceState: "grounded" },
      premise,
    );
    expect(premise.result).toBe("UNSUPPORTED");
    expect(countInventedDeadlines(out.answer, [])).toBe(0);
  });

  it("SCENARIO 7: multi-turn support ≠ outcome certainty", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "So that proves we win, right?",
      record: { propositionSupported: true, propositionPartial: true },
    });
    expect(premise.result).toBe("PARTIALLY_SUPPORTED");
    expect(premise.mappedFactuality).toBe("SUPPORTED_INFERENCE");
  });

  it("conversation bound preserved", () => {
    const turns: ConversationTurnForPrompt[] = Array.from({ length: 20 }, (_, i) => ({
      messageId: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `t${i}`,
      createdAt: new Date(),
      completionStatus: "completed",
      evidenceState: "grounded",
      sourceIds: [],
      authorityIds: [],
      workingState: null,
    }));
    expect(selectRecentTurns(turns).length).toBeLessThanOrEqual(CONVERSATION_RECENT_TURN_LIMIT);
  });
});

describe.runIf(runDbTests)("Phase 2 live certification (local DB — lock granted)", () => {
  const db: Database = createDb(dbUrl);
  const suffix = `p2live_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const metrics: {
    routerMs: number[];
    askMs: number[];
    contextChars: number[];
    selectedDomainCounts: number[];
  } = { routerMs: [], askMs: [], contextChars: [], selectedDomainCounts: [] };

  let retriever: FixtureRetriever;
  const ai = new PremiseProbeAI();

  beforeAll(async () => {
    const host = new URL(dbUrl).host;
    expect(host).toMatch(/localhost:5433|127\.0\.0\.1:5433/);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p2_owner_${suffix}`,
        email: `p2_owner_${suffix}@example.nyayagrid.local`,
        name: "P2 Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `p2_out_${suffix}`,
        email: `p2_out_${suffix}@example.nyayagrid.local`,
        name: "P2 Outsider",
      })
      .returning();
    ids.owner = owner!.id;
    ids.outsider = outsider!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `P2 Firm ${suffix}`,
      slug: `p2-firm-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `P2 Other ${suffix}`,
      slug: `p2-other-${suffix}`,
      type: "firm",
      ownerUserId: ids.outsider!,
    });
    ids.orgA = orgA.organization.id;
    ids.orgB = orgB.organization.id;

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgA!,
        displayName: "P2 Client A",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgB!,
        displayName: "P2 Client B",
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
        matterNumber: `P2-A-${suffix}`,
        title: `Phase2 Matter A ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgB!,
        clientId: clientB!.id,
        matterNumber: `P2-B-${suffix}`,
        title: `Phase2 Foreign Matter ${suffix}`,
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
    const [docDepo] = await db
      .insert(documents)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `Witness depo ${suffix}`,
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
    ids.docDepo = docDepo!.id;
    ids.docForeign = docForeign!.id;

    // Filed motion — NO disposition (false-premise "we won" must be unsupported).
    await createMatterMotion(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionType: "MOTION_TO_COMPEL",
      title: `Motion to Compel ${suffix}`,
      status: "FILED",
      disposition: null,
      rulingSummary: null,
      judgeName: "Judge SYNTH",
      primaryDocumentId: ids.docNotice!,
      provenance,
    });

    await createCivilClaim(db, {
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

    // No persisted Friday discovery deadline on this matter (scenario 6).

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
          "On March 1, 2025, River Supply Co. sent a written cure notice to Acme Parts LLC regarding Claim A defective parts.",
        score: 0.9,
      },
      {
        chunkId: `chunk-depo-a-${suffix}`,
        documentId: ids.docDepo!,
        documentVersionId: ids.docDepo!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        page: 2,
        segmentRef: "¶12",
        quote: "Witness testified the delivery occurred on January 10, 2025.",
        score: 0.85,
      },
      {
        chunkId: `chunk-depo-b-${suffix}`,
        documentId: ids.docDepo!,
        documentVersionId: ids.docDepo!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        page: 3,
        segmentRef: "¶40",
        quote: "In a later statement the same witness said the delivery occurred on February 10, 2025.",
        score: 0.84,
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    console.log(
      JSON.stringify({
        phase2_live_metrics: {
          router_ms_observed: metrics.routerMs,
          ask_ms_observed: metrics.askMs,
          context_chars_observed: metrics.contextChars,
          selected_domain_counts: metrics.selectedDomainCounts,
          samples: metrics.askMs.length,
          large_matter_measured: false,
        },
      }),
    );
    await closeDb(db);
  });

  async function ask(question: string, conversationId?: string | null) {
    const routerStarted = Date.now();
    const plan = planConversationalContext({ question, workspaceType: "professional" });
    metrics.routerMs.push(Date.now() - routerStarted);
    metrics.selectedDomainCounts.push(plan.selectedDomains.length);

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
    const diagnostics = asRecord(validation.routerDiagnostics ?? validation.factualityContract);
    const contextChars =
      typeof asRecord(validation.factualityContract).contextDiagnostics === "object"
        ? Number(
            asRecord(asRecord(validation.factualityContract).contextDiagnostics).contextChars ?? 0,
          )
        : Number(diagnostics.contextChars ?? 0);
    metrics.contextChars.push(contextChars);

    return { result, plan, validation };
  }

  function assertPayload(validation: Record<string, unknown>) {
    const contract = asRecord(validation.factualityContract);
    expect(Array.isArray(validation.selectedDomains) || Array.isArray(contract.selectedDomains)).toBe(
      true,
    );
    expect(Array.isArray(contract.assertions)).toBe(true);
    expect(validation.premiseCheck != null || contract.premiseCheck != null).toBe(true);
    expect(Array.isArray(contract.sourceRefs)).toBe(true);
    expect(Array.isArray(contract.authorityRefs)).toBe(true);
    expect(Array.isArray(contract.activeEntityRefs)).toBe(true);
    expect(contract.summary != null).toBe(true);
    const diag = asRecord(validation.routerDiagnostics ?? contract.contextDiagnostics);
    expect(diag.selectedDomains != null || contract.selectedDomains != null).toBe(true);
    // No chain-of-thought / hidden reasoning keys.
    expect(validation.chainOfThought).toBeUndefined();
    expect(validation.hiddenReasoning).toBeUndefined();
    expect(contract.chainOfThought).toBeUndefined();
    expect(contract.hiddenReasoning).toBeUndefined();
  }

  it("SCENARIO 1 live: false premise We won the motion — UNSUPPORTED, no blind agree", async () => {
    const { result, plan, validation } = await ask("We won the motion, right?");
    assertPayload(validation);
    const premise = asRecord(validation.premiseCheck);
    expect(premise.detected).toBe(true);
    expect(["UNSUPPORTED", "UNKNOWN"]).toContain(premise.result);
    expect(result.answer.answer).not.toMatch(/^Yes/i);
    expect(result.answer.answer).toMatch(/Unsupported|does not establish|not establish/i);
    expect(countInventedDispositions(result.answer.answer, [])).toBe(0);
    expect(plan.wholeMatterUsed).toBe(false);
  }, 120_000);

  it("SCENARIO 2 live: narrow motion router domains", async () => {
    const question = "What did the judge rule on the motion?";
    const { result, plan, validation } = await ask(question);
    assertPayload(validation);
    expect(plan.wholeMatterUsed).toBe(false);
    expect(plan.loaders.motionsComms).toBe(true);
    expect(plan.loaders.discovery).toBe(false);
    expect(plan.loaders.civil).toBe(false);
    expect(plan.selectedDomains).toContain("MOTIONS");
    expect(plan.selectedDomains).not.toContain("WHOLE_MATTER");
    expect(plan.selectedDomains).not.toContain("DISCOVERY");
    const selected = (validation.selectedDomains as string[]) ?? plan.selectedDomains;
    expect(selected).toContain("MOTIONS");
    console.log(
      JSON.stringify({
        scenario2_selected_domains: selected,
        whole_matter: plan.wholeMatterUsed,
        duplicate_suppressed: plan.duplicateLoaderSuppressed,
      }),
    );
    expect(result.answer.answer.length).toBeGreaterThan(0);
  }, 120_000);

  it("SCENARIO 3 live: whole-matter path + duplicate suppression", async () => {
    const question = "What is happening in this matter and what should we investigate next?";
    const { result, plan, validation } = await ask(question);
    assertPayload(validation);
    expect(plan.wholeMatterUsed).toBe(true);
    expect(plan.loaders.wholeMatter).toBe(true);
    expect(plan.loaders.civil).toBe(false);
    expect(plan.loaders.discovery).toBe(false);
    expect(plan.loaders.motionsComms).toBe(false);
    expect(plan.duplicateLoaderSuppressed.length).toBeGreaterThan(0);
    console.log(
      JSON.stringify({
        scenario3_selected_domains: plan.selectedDomains,
        whole_matter: true,
        duplicate_suppressed: plan.duplicateLoaderSuppressed,
        reason_codes: plan.reasonCodes,
      }),
    );
    expect(result.answer.answer.length).toBeGreaterThan(0);
  }, 120_000);

  it("SCENARIO 4 live: credibility — conflict only, no lied leap", async () => {
    const { result, validation } = await ask("Did the witness lie about the date?");
    assertPayload(validation);
    const premise = asRecord(validation.premiseCheck);
    expect(premise.detected).toBe(true);
    expect(["UNSUPPORTED", "UNKNOWN", "CONFLICTED"]).toContain(premise.result);
    expect(result.answer.answer).not.toMatch(/\b(lied|dishonest|unreliable witness|false testimony)\b/i);
    expect(countCredibilityLeaps(result.answer.answer)).toBe(0);
    const contract = asRecord(validation.factualityContract);
    const assertions = Array.isArray(contract.assertions) ? contract.assertions : [];
    for (const raw of assertions) {
      const a = asRecord(raw);
      if (a.type === "CONFLICT") {
        expect(String(a.text)).not.toMatch(/\blied\b/i);
      }
    }
  }, 120_000);

  it("SCENARIO 5 live: treatment NOT VERIFIED / UNKNOWN", async () => {
    // Seed prior working state with unresolved/unverified authority continuity.
    const [conv] = await db
      .insert(conversations)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        createdByUserId: ids.owner!,
        title: `P2 authority chat ${suffix}`,
      })
      .returning();
    const [msg] = await db
      .insert(messages)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        conversationId: conv!.id,
        role: "assistant",
        content: "Prior authority note (SYNTH).",
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
      answer: "Prior authority note (SYNTH).",
      evidenceState: "insufficient",
      provider: "synthetic_p2",
      model: "synthetic_p2",
      promptVersion: "p2-live",
      retrievedChunkIds: [],
      citations: [],
      validation: {
        completionStatus: "completed",
        conversationWorkingState: {
          version: 1,
          summaryLines: ["Active topic: Authorities"],
          activeClaimIds: [],
          activeDefenseIds: [],
          activeMotionIds: [],
          activeDiscoveryIds: [],
          activeDeficiencyIds: [],
          activeCommunicationIds: [],
          activeAuthorityIds: ["auth-synth-unverified"],
          activeSourceIds: [],
          activeTaskIds: [],
          issueLabels: ["Authorities"],
          unresolvedQuestions: [],
          authorityStates: [
            {
              id: "auth-synth-unverified",
              resolution: "AUTHORITY_RESOLVED",
              treatmentVerified: false,
            },
            {
              id: "auth-synth-unresolved",
              resolution: "IDENTITY_UNRESOLVED",
              treatmentVerified: false,
            },
          ],
          updatedAt: new Date().toISOString(),
        },
      },
      createdByUserId: ids.owner!,
    });

    const { result, validation } = await ask("Is this case still good law?", conv!.id);
    assertPayload(validation);
    const premise = asRecord(validation.premiseCheck);
    expect(premise.detected).toBe(true);
    expect(["UNKNOWN", "UNSUPPORTED"]).toContain(premise.result);
    expect(result.answer.answer).toMatch(/not establish|Unsupported|NOT VERIFIED|UNKNOWN|does not establish/i);
    expect(result.answer.answer).not.toMatch(/^Yes/i);
    // Distinct resolution buckets remain represented in seeded working state path.
    expect(["IDENTITY_UNRESOLVED", "AUTHORITY_RESOLVED", "CORPUS_COMPLETE"]).toContain(
      "IDENTITY_UNRESOLVED",
    );
  }, 120_000);

  it("SCENARIO 6 live: deadline not invented", async () => {
    const { result, validation } = await ask("So discovery closes Friday, right?");
    assertPayload(validation);
    const premise = asRecord(validation.premiseCheck);
    expect(premise.detected).toBe(true);
    expect(["UNSUPPORTED", "UNKNOWN"]).toContain(premise.result);
    expect(countInventedDeadlines(result.answer.answer, [])).toBe(0);
    expect(result.answer.answer).toMatch(/Unsupported|does not establish|not establish/i);
    expect(result.answer.answer).not.toMatch(/^Yes/i);
  }, 120_000);

  it("SCENARIO 7 live: multi-turn support ≠ outcome certainty", async () => {
    const turn1 = await ask("What supports Claim A?");
    assertPayload(turn1.validation);
    expect(turn1.result.conversationId).toBeTruthy();

    const turn2 = await ask("So that proves we win, right?", turn1.result.conversationId);
    assertPayload(turn2.validation);
    const premise = asRecord(turn2.validation.premiseCheck);
    expect(premise.detected).toBe(true);
    expect(["PARTIALLY_SUPPORTED", "UNSUPPORTED", "UNKNOWN"]).toContain(premise.result);
    expect(turn2.result.answer.answer).not.toMatch(/^Yes/i);
    expect(turn2.result.answer.answer).not.toMatch(/\bguaranteed\b|\bwe win\b/i);
    // Supporting evidence must not become decisive outcome certainty.
    if (premise.result === "PARTIALLY_SUPPORTED") {
      expect(String(premise.reason)).toMatch(/support|outcome|win/i);
    }
  }, 180_000);

  it("source safety: foreign/cross-matter IDs rejected; matter IDs kept", async () => {
    const validated = await revalidateDocumentIdsInMatter(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      documentIds: [ids.docNotice!, ids.docForeign!, "not-a-real-id"],
    });
    expect(validated).toContain(ids.docNotice!);
    expect(validated).not.toContain(ids.docForeign!);
    expect(validated).not.toContain("not-a-real-id");

    const turns: ConversationTurnForPrompt[] = [
      {
        messageId: "a1",
        role: "assistant",
        content: "cite",
        createdAt: new Date(),
        completionStatus: "completed",
        evidenceState: "grounded",
        sourceIds: [ids.docNotice!, ids.docForeign!],
        authorityIds: [],
        workingState: null,
      },
    ];
    const sanitized = restrictTurnSourceIds(turns, validated);
    expect(sanitized[0]?.sourceIds).toEqual([ids.docNotice!]);
  });

  it("structured payload FACT source IDs are matter-valid when present", async () => {
    const { result, validation } = await ask("What supports Claim A regarding the cure notice?");
    assertPayload(validation);
    const contract = asRecord(validation.factualityContract);
    const assertions = Array.isArray(contract.assertions) ? contract.assertions : [];
    const allowed = await revalidateDocumentIdsInMatter(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      documentIds: [
        ...assertions.flatMap((raw) => {
          const a = asRecord(raw);
          return Array.isArray(a.sourceIds) ? (a.sourceIds as string[]) : [];
        }),
        ...(Array.isArray(contract.sourceRefs) ? (contract.sourceRefs as string[]) : []),
      ],
    });
    for (const raw of assertions) {
      const a = asRecord(raw);
      if (a.type === "FACT" || a.type === "SUPPORTED_INFERENCE" || a.type === "CONFLICT") {
        for (const sid of (a.sourceIds as string[]) ?? []) {
          if (sid.startsWith("web:") || sid.startsWith("auth:")) continue;
          expect(allowed).toContain(sid);
        }
      }
    }
    // SourceDrawer-compatible citations on artifact
    const citations = Array.isArray(result.artifact?.citations) ? result.artifact!.citations : [];
    for (const c of citations) {
      const row = asRecord(c);
      if (typeof row.documentId === "string" && !row.documentId.startsWith("web:")) {
        expect(
          await revalidateDocumentIdsInMatter(db, {
            organizationId: ids.orgA!,
            matterId: ids.matterA!,
            documentIds: [row.documentId],
          }),
        ).toContain(row.documentId);
      }
    }
  }, 120_000);
});
