/**
 * Nyaya Conversational Workspace Phase 1 — LOCAL live certification.
 * RUN_DB_TESTS=1 DATABASE_URL=postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid
 * Production Neon / CourtListener: unused. Schema migration: NONE.
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
  matters,
  matterMembers,
  messages,
  users,
} from "@nyayagrid/database";
import {
  assembleConversationAskContext,
  CONVERSATION_CONTEXT_MAX_CHARS,
  CONVERSATION_RECENT_TURN_LIMIT,
  mergeWorkingStates,
  parseWorkingState,
  revalidateDocumentIdsInMatter,
} from "./conversation-context";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const dbUrl = process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";

describe.runIf(runDbTests)("Phase 1 conversational foundation live certification (local DB)", () => {
  const db = createDb(dbUrl);
  const suffix = `p1live_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const timings: Record<string, number> = {};

  async function insertUserTurn(conversationId: string, content: string, userId: string) {
    const [row] = await db
      .insert(messages)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        conversationId,
        role: "user",
        content,
        createdByUserId: userId,
      })
      .returning();
    return row!;
  }

  async function insertAssistantTurn(params: {
    conversationId: string;
    question: string;
    answer: string;
    userId: string;
    completionStatus?: "completed" | "cancelled" | "failed";
    evidenceState?: string;
    sourceIds?: string[];
    workingState?: Record<string, unknown>;
  }) {
    const [msg] = await db
      .insert(messages)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        conversationId: params.conversationId,
        role: "assistant",
        content: params.answer,
        createdByUserId: params.userId,
      })
      .returning();
    const [art] = await db
      .insert(aiArtifacts)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        conversationId: params.conversationId,
        messageId: msg!.id,
        artifactType: "matter_qa",
        question: params.question,
        answer: params.answer,
        evidenceState: params.evidenceState ?? "grounded",
        provider: params.completionStatus === "cancelled" ? "cancelled" : "synthetic_p1",
        model: params.completionStatus === "cancelled" ? "cancelled" : "synthetic_p1",
        promptVersion: "p1-live",
        retrievedChunkIds: [],
        citations: (params.sourceIds ?? []).map((documentId) => ({
          chunkId: `chunk-${documentId}`,
          documentId,
          documentVersionId: documentId,
          quote: "synthetic quote",
        })),
        validation: {
          completionStatus: params.completionStatus ?? "completed",
          conversationWorkingState: params.workingState ?? null,
          assertionReady: true,
        },
        createdByUserId: params.userId,
      })
      .returning();
    return { message: msg!, artifact: art! };
  }

  beforeAll(async () => {
    const host = new URL(dbUrl).host;
    expect(host).toMatch(/localhost:5433|127\.0\.0\.1:5433/);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p1_owner_${suffix}`,
        email: `p1_owner_${suffix}@example.nyayagrid.local`,
        name: "P1 Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `p1_out_${suffix}`,
        email: `p1_out_${suffix}@example.nyayagrid.local`,
        name: "P1 Outsider",
      })
      .returning();
    ids.owner = owner!.id;
    ids.outsider = outsider!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `P1 Firm ${suffix}`,
      slug: `p1-firm-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `P1 Other ${suffix}`,
      slug: `p1-other-${suffix}`,
      type: "firm",
      ownerUserId: ids.outsider!,
    });
    ids.orgA = orgA.organization.id;
    ids.orgB = orgB.organization.id;

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgA!,
        displayName: "P1 Client A",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgB!,
        displayName: "P1 Client B",
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
        matterNumber: `P1-A-${suffix}`,
        title: `Phase1 Matter A ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matterA2] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: clientA!.id,
        matterNumber: `P1-A2-${suffix}`,
        title: `Phase1 Sibling Matter ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgB!,
        clientId: clientB!.id,
        matterNumber: `P1-B-${suffix}`,
        title: `Phase1 Foreign Matter ${suffix}`,
        status: "open",
        createdByUserId: ids.outsider!,
      })
      .returning();
    ids.matterA = matterA!.id;
    ids.matterA2 = matterA2!.id;
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
        matterId: ids.matterA2!,
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

    const [docNotice] = await db
      .insert(documents)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `Cure notice ${suffix}`,
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
    ids.docForeign = docForeign!.id;

    const [convA] = await db
      .insert(conversations)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        createdByUserId: ids.owner!,
        title: `P1 Command Center ${suffix}`,
      })
      .returning();
    const [convA2] = await db
      .insert(conversations)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA2!,
        createdByUserId: ids.owner!,
        title: `P1 Sibling Chat ${suffix}`,
      })
      .returning();
    const [convB] = await db
      .insert(conversations)
      .values({
        organizationId: ids.orgB!,
        matterId: ids.matterB!,
        createdByUserId: ids.outsider!,
        title: `P1 Foreign Chat ${suffix}`,
      })
      .returning();
    ids.convA = convA!.id;
    ids.convA2 = convA2!.id;
    ids.convB = convB!.id;
  }, 120_000);

  afterAll(async () => {
    await closeDb(db);
  });

  it("scenario 1: multi-turn matter status → unresolved issue uses prior context without full dump", async () => {
    await insertUserTurn(ids.convA!, "What is happening in this matter?", ids.owner!);
    await insertAssistantTurn({
      conversationId: ids.convA!,
      question: "What is happening in this matter?",
      answer:
        "Claim A is partially supported; one discovery deficiency remains open; a motion to compel was granted in part.",
      userId: ids.owner!,
      sourceIds: [ids.docNotice!],
      workingState: {
        version: 1,
        summaryLines: ["Active topic: Claim A / breach", "Active topic: Discovery"],
        activeClaimIds: [],
        activeDefenseIds: [],
        activeMotionIds: [],
        activeDiscoveryIds: [],
        activeDeficiencyIds: ["def-open-1"],
        activeCommunicationIds: [],
        activeAuthorityIds: ["auth-resolved", "auth-unresolved"],
        activeSourceIds: [ids.docNotice!],
        activeTaskIds: [],
        issueLabels: ["Claim A / breach", "Discovery"],
        unresolvedQuestions: ["What is the biggest unresolved deficiency?"],
        authorityStates: [
          { id: "auth-resolved", resolution: "AUTHORITY_RESOLVED", treatmentVerified: false },
          { id: "auth-unresolved", resolution: "IDENTITY_UNRESOLVED", treatmentVerified: false },
          { id: "auth-corpus", resolution: "CORPUS_COMPLETE", treatmentVerified: false },
        ],
        updatedAt: new Date().toISOString(),
      },
    });

    const t0 = performance.now();
    const assembled = await assembleConversationAskContext(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: ids.convA!,
      currentQuestion: "What is the biggest unresolved issue?",
    });
    timings.scenario1AssemblyMs = performance.now() - t0;

    expect(assembled).toBeTruthy();
    expect(assembled!.recentTurns.length).toBeGreaterThanOrEqual(2);
    expect(assembled!.recentTurns.length).toBeLessThanOrEqual(CONVERSATION_RECENT_TURN_LIMIT);
    expect(assembled!.promptBlock).toContain("CONVERSATION_CONTEXT");
    expect(assembled!.promptBlock).toContain("What is happening in this matter?");
    expect(assembled!.promptBlock!.length).toBeLessThanOrEqual(CONVERSATION_CONTEXT_MAX_CHARS);
    expect(assembled!.workingState.issueLabels.some((l) => /Discovery|Claim A/i.test(l))).toBe(true);
    expect(assembled!.workingState.activeSourceIds).toContain(ids.docNotice!);
    expect(assembled!.metrics.promptChars).toBeGreaterThan(0);

    console.log(
      JSON.stringify({
        p1_scenario1: {
          assembly_ms: Math.round(timings.scenario1AssemblyMs),
          recent_turns: assembled!.metrics.recentTurnCount,
          prompt_chars: assembled!.metrics.promptChars,
          summary_chars: assembled!.metrics.summaryChars,
        },
      }),
    );
  }, 60_000);

  it("scenario 2: Claim A support → show sources retains matter-valid source IDs", async () => {
    await insertUserTurn(ids.convA!, "What supports Claim A?", ids.owner!);
    await insertAssistantTurn({
      conversationId: ids.convA!,
      question: "What supports Claim A?",
      answer: "The cure notice supports the notice element of Claim A.",
      userId: ids.owner!,
      sourceIds: [ids.docNotice!, ids.docForeign!], // foreign id should be stripped on assemble
      workingState: {
        version: 1,
        summaryLines: ["Active topic: Claim A / breach"],
        activeClaimIds: [],
        activeDefenseIds: [],
        activeMotionIds: [],
        activeDiscoveryIds: [],
        activeDeficiencyIds: [],
        activeCommunicationIds: [],
        activeAuthorityIds: [],
        activeSourceIds: [ids.docNotice!, ids.docForeign!],
        activeTaskIds: [],
        issueLabels: ["Claim A / breach"],
        unresolvedQuestions: [],
        authorityStates: [],
        updatedAt: new Date().toISOString(),
      },
    });

    const t0 = performance.now();
    const assembled = await assembleConversationAskContext(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: ids.convA!,
      currentQuestion: "show me the sources",
    });
    timings.scenario2AssemblyMs = performance.now() - t0;

    expect(assembled!.promptBlock).toMatch(/sourceIds=|sources=/);
    expect(assembled!.workingState.activeSourceIds).toContain(ids.docNotice!);
    expect(assembled!.workingState.activeSourceIds).not.toContain(ids.docForeign!);
    expect(assembled!.promptBlock).toContain(ids.docNotice!);
    expect(assembled!.promptBlock).not.toContain(ids.docForeign!);

    console.log(
      JSON.stringify({
        p1_scenario2: {
          assembly_ms: Math.round(timings.scenario2AssemblyMs),
          source_ids: assembled!.workingState.activeSourceIds,
        },
      }),
    );
  }, 60_000);

  it("scenario 3: active-context continuity for motion follow-up", async () => {
    await insertUserTurn(ids.convA!, "What communications led to the motion?", ids.owner!);
    await insertAssistantTurn({
      conversationId: ids.convA!,
      question: "What communications led to the motion?",
      answer: "The meet-and-confer letter preceded the motion to compel.",
      userId: ids.owner!,
      workingState: {
        version: 1,
        summaryLines: ["Active topic: Motions / rulings"],
        activeClaimIds: [],
        activeDefenseIds: [],
        activeMotionIds: ["motion-compel-1"],
        activeDiscoveryIds: [],
        activeDeficiencyIds: ["def-open-1"],
        activeCommunicationIds: ["comm-mac-1"],
        activeAuthorityIds: [],
        activeSourceIds: [ids.docNotice!],
        activeTaskIds: [],
        issueLabels: ["Motions / rulings", "Discovery"],
        unresolvedQuestions: [],
        authorityStates: [],
        updatedAt: new Date().toISOString(),
      },
    });

    const assembled = await assembleConversationAskContext(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: ids.convA!,
      currentQuestion: "What motion did that lead to?",
    });

    expect(assembled!.workingState.activeMotionIds).toContain("motion-compel-1");
    expect(assembled!.workingState.activeCommunicationIds).toContain("comm-mac-1");
    expect(assembled!.promptBlock).toContain("motions=");
    expect(assembled!.promptBlock).toContain("communications=");
  }, 60_000);

  it("reload scenario: persisted history still assembles after re-load", async () => {
    const tLoad = performance.now();
    const rows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, ids.convA!),
          eq(messages.matterId, ids.matterA!),
          eq(messages.organizationId, ids.orgA!),
        ),
      );
    timings.conversationLoadMs = performance.now() - tLoad;
    expect(rows.length).toBeGreaterThan(4);

    const assembled = await assembleConversationAskContext(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: ids.convA!,
      currentQuestion: "Summarize what we already covered.",
    });
    expect(assembled!.recentTurns.length).toBeGreaterThan(0);
    expect(assembled!.promptBlock).toContain("CONVERSATION_CONTEXT");

    console.log(
      JSON.stringify({
        p1_reload: {
          conversation_load_ms: Math.round(timings.conversationLoadMs),
          message_count: rows.length,
          recent_turns: assembled!.metrics.recentTurnCount,
        },
      }),
    );
  }, 60_000);

  it("cross-matter: sibling matter conversation cannot see matter A context", async () => {
    await db.insert(messages).values({
      organizationId: ids.orgA!,
      matterId: ids.matterA2!,
      conversationId: ids.convA2!,
      role: "user",
      content: "Sibling-only question",
      createdByUserId: ids.owner!,
    });

    const sibling = await assembleConversationAskContext(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA2!,
      conversationId: ids.convA2!,
      currentQuestion: "What is happening?",
    });
    expect(sibling!.promptBlock ?? "").not.toContain("Claim A");
    expect(sibling!.promptBlock ?? "").not.toContain(ids.docNotice!);
    expect(sibling!.recentTurns.every((t) => !t.content.includes("cure notice"))).toBe(true);

    // Wrong matterId for conversation A must fail closed.
    const cross = await assembleConversationAskContext(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA2!,
      conversationId: ids.convA!,
      currentQuestion: "leak?",
    });
    expect(cross).toBeNull();
  }, 60_000);

  it("cross-org: foreign conversation/org cannot assemble into org A", async () => {
    await db.insert(messages).values({
      organizationId: ids.orgB!,
      matterId: ids.matterB!,
      conversationId: ids.convB!,
      role: "user",
      content: "Foreign org secret",
      createdByUserId: ids.outsider!,
    });

    const crossOrg = await assembleConversationAskContext(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: ids.convB!,
      currentQuestion: "leak?",
    });
    expect(crossOrg).toBeNull();

    const foreignOk = await assembleConversationAskContext(db, {
      organizationId: ids.orgB!,
      matterId: ids.matterB!,
      conversationId: ids.convB!,
      currentQuestion: "status?",
    });
    expect(foreignOk!.promptBlock).toContain("Foreign org secret");
    expect(foreignOk!.promptBlock).not.toContain("Claim A");
  }, 60_000);

  it("cancelled/failed assistant turns are excluded from context", async () => {
    await insertUserTurn(ids.convA!, "Cancelled probe question", ids.owner!);
    await insertAssistantTurn({
      conversationId: ids.convA!,
      question: "Cancelled probe question",
      answer: "[Generation stopped]",
      userId: ids.owner!,
      completionStatus: "cancelled",
      evidenceState: "insufficient",
    });
    await insertUserTurn(ids.convA!, "Failed probe question", ids.owner!);
    await insertAssistantTurn({
      conversationId: ids.convA!,
      question: "Failed probe question",
      answer: "partial broken",
      userId: ids.owner!,
      completionStatus: "failed",
      evidenceState: "insufficient",
    });

    const assembled = await assembleConversationAskContext(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: ids.convA!,
      currentQuestion: "continue after cancel",
    });
    expect(assembled!.recentTurns.every((t) => t.content !== "[Generation stopped]")).toBe(true);
    expect(assembled!.recentTurns.every((t) => t.completionStatus !== "cancelled")).toBe(true);
    expect(assembled!.recentTurns.every((t) => t.completionStatus !== "failed")).toBe(true);
    // User turns that preceded cancel may remain; cancelled assistant content must not.
    expect(assembled!.promptBlock).not.toContain("[Generation stopped]");
  }, 60_000);

  it("source IDs remain matter-valid and foreign docs fail closed", async () => {
    const validated = await revalidateDocumentIdsInMatter(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      documentIds: [ids.docNotice!, ids.docForeign!, "web:example"],
    });
    expect(validated).toEqual([ids.docNotice!]);
  }, 30_000);

  it("authority-state honesty survives working-state merge and assemble", async () => {
    const prior = parseWorkingState({
      version: 1,
      summaryLines: [],
      activeAuthorityIds: ["auth-unresolved"],
      authorityStates: [
        { id: "auth-unresolved", resolution: "IDENTITY_UNRESOLVED", treatmentVerified: false },
        { id: "auth-resolved", resolution: "AUTHORITY_RESOLVED", treatmentVerified: false },
        { id: "auth-corpus", resolution: "CORPUS_COMPLETE", treatmentVerified: false },
      ],
      updatedAt: new Date().toISOString(),
    })!;
    const merged = mergeWorkingStates(prior, {
      authorityStates: [
        { id: "auth-unresolved", resolution: "AUTHORITY_RESOLVED", treatmentVerified: true },
      ],
    });
    expect(merged.authorityStates.find((a) => a.id === "auth-unresolved")?.resolution).toBe(
      "IDENTITY_UNRESOLVED",
    );
    expect(merged.authorityStates.find((a) => a.id === "auth-unresolved")?.treatmentVerified).toBe(
      false,
    );
    expect(merged.authorityStates.find((a) => a.id === "auth-corpus")?.resolution).toBe(
      "CORPUS_COMPLETE",
    );

    await insertAssistantTurn({
      conversationId: ids.convA!,
      question: "authority honesty",
      answer: "Authority states recorded.",
      userId: ids.owner!,
      workingState: {
        version: 1,
        summaryLines: ["Active topic: Authorities"],
        activeClaimIds: [],
        activeDefenseIds: [],
        activeMotionIds: [],
        activeDiscoveryIds: [],
        activeDeficiencyIds: [],
        activeCommunicationIds: [],
        activeAuthorityIds: ["auth-unresolved", "auth-resolved", "auth-corpus"],
        activeSourceIds: [],
        activeTaskIds: [],
        issueLabels: ["Authorities"],
        unresolvedQuestions: [],
        authorityStates: prior.authorityStates,
        updatedAt: new Date().toISOString(),
      },
    });

    const assembled = await assembleConversationAskContext(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: ids.convA!,
      currentQuestion: "which authorities remain unresolved?",
    });
    expect(assembled!.promptBlock).toContain("IDENTITY_UNRESOLVED");
    expect(assembled!.promptBlock).toContain("AUTHORITY_RESOLVED");
    expect(assembled!.promptBlock).toContain("CORPUS_COMPLETE");
    expect(assembled!.promptBlock).toMatch(/treatment=UNKNOWN/);
  }, 60_000);

  it("SSE cancel/continue contract: cancelled artifacts stay non-authoritative; continue path stays org/matter scoped", async () => {
    // Cancelled turn already seeded; re-assemble and ensure completed turns still present.
    const assembled = await assembleConversationAskContext(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: ids.convA!,
      currentQuestion: "after soft cancel",
    });
    expect(assembled!.recentTurns.some((t) => t.role === "assistant" && t.completionStatus === "completed")).toBe(
      true,
    );
    expect(assembled!.recentTurns.some((t) => t.completionStatus === "cancelled")).toBe(false);

    // Conversation remains matter-scoped for continue-style follow-up.
    const wrongOrgContinue = await assembleConversationAskContext(db, {
      organizationId: ids.orgB!,
      matterId: ids.matterA!,
      conversationId: ids.convA!,
      currentQuestion: "continue?",
    });
    expect(wrongOrgContinue).toBeNull();
  }, 60_000);

  it("reports Phase 1 live performance summary", async () => {
    const t0 = performance.now();
    const assembled = await assembleConversationAskContext(db, {
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      conversationId: ids.convA!,
      currentQuestion: "What is happening in this matter?",
    });
    const assemblyMs = performance.now() - t0;
    expect(assembled).toBeTruthy();
    expect(assemblyMs).toBeLessThan(5_000);

    console.log(
      JSON.stringify({
        p1_live_perf: {
          conversation_load_ms: Math.round(timings.conversationLoadMs ?? 0),
          context_assembly_ms: Math.round(assemblyMs),
          scenario1_assembly_ms: Math.round(timings.scenario1AssemblyMs ?? 0),
          scenario2_assembly_ms: Math.round(timings.scenario2AssemblyMs ?? 0),
          recent_turns: assembled!.metrics.recentTurnCount,
          prompt_chars: assembled!.metrics.promptChars,
          summary_chars: assembled!.metrics.summaryChars,
          turn_bound: CONVERSATION_RECENT_TURN_LIMIT,
          max_chars: CONVERSATION_CONTEXT_MAX_CHARS,
          note: "Ask/whole-matter LLM latency not re-run (foundation cert focuses on conversation context path)",
        },
      }),
    );
  }, 60_000);
});
