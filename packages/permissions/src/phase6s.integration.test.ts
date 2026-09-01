import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  users,
  clients,
  matters,
  matterMembers,
  memberships,
  auditEvents,
} from "@nyayagrid/database";
import { AuthorizationError, requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import {
  applyMatterJurisdictionInput,
  existingJurisdictionFromMatter,
  jurisdictionColumnsFromNormalized,
  resolveMatterJurisdictionContext,
  type MatterJurisdictionContext,
} from "@nyayagrid/jurisdiction";
import { eq } from "drizzle-orm";
import { MockAIProvider, MockEmbeddingProvider, type AiGenerateRequest } from "@nyayagrid/ai";
import { generateDraft } from "@nyayagrid/intelligence";
import { askNyayaAboutMatter, InMemoryMatterRetriever } from "@nyayagrid/search";
import {
  agentInputSchema,
  agentOutputSchema,
  createAgentRun,
  createDefaultAgentRegistry,
  createDefaultToolRegistry,
  executeAgentRun,
  type NyayaAgent,
} from "@nyayagrid/agents";
import { getFeatureFlags } from "@nyayagrid/platform";

const runDbTests = process.env.RUN_DB_TESTS === "1";

class PromptCaptureAI extends MockAIProvider {
  lastUser = "";
  lastSystem = "";
  readonly captured: Array<{ schemaName?: string; system: string; user: string }> = [];

  override async generate(request: AiGenerateRequest) {
    const system = request.messages.find((m) => m.role === "system")?.content ?? "";
    const user = request.messages.find((m) => m.role === "user")?.content ?? "";
    this.lastSystem = system;
    this.lastUser = user;
    this.captured.push({ schemaName: request.schemaName, system, user });
    return super.generate(request);
  }
}

describe.runIf(runDbTests)("phase 6S jurisdiction isolation", () => {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  const suffix = Date.now().toString(36);
  afterAll(async () => {
    await closeDb(db);
  });
  let ownerId = "";
  let viewerId = "";
  let otherOwnerId = "";
  let orgA = "";
  let orgB = "";
  let matterA = "";
  let matterB = "";
  let matterJ1 = "";

  beforeAll(async () => {
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `j6s_owner_${suffix}`,
        email: `j6s_owner_${suffix}@example.nyayagrid.local`,
        name: "Owner",
      })
      .returning();
    const [viewer] = await db
      .insert(users)
      .values({
        authSubject: `j6s_viewer_${suffix}`,
        email: `j6s_viewer_${suffix}@example.nyayagrid.local`,
        name: "Viewer",
      })
      .returning();
    ownerId = owner!.id;
    viewerId = viewer!.id;

    const a = await createOrganizationWithDefaults(db, {
      name: `J6S A ${suffix}`,
      slug: `j6s-a-${suffix}`,
      type: "firm",
      ownerUserId: ownerId,
    });
    orgA = a.organization.id;
    await db.insert(memberships).values({
      organizationId: orgA,
      userId: viewerId,
      roleId: a.roleIdByKey.get("lawyer")!,
      status: "active",
    });
    const otherOwner = await db
      .insert(users)
      .values({
        authSubject: `j6s_b_${suffix}`,
        email: `j6s_b_${suffix}@example.nyayagrid.local`,
        name: "B Owner",
      })
      .returning();
    otherOwnerId = otherOwner[0]!.id;
    const b = await createOrganizationWithDefaults(db, {
      name: `J6S B ${suffix}`,
      slug: `j6s-b-${suffix}`,
      type: "solo",
      ownerUserId: otherOwnerId,
    });
    orgB = b.organization.id;

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: orgA,
        clientType: "individual",
        displayName: "Client A",
        createdByUserId: ownerId,
      })
      .returning();
    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: orgB,
        clientType: "individual",
        displayName: "Client B",
        createdByUserId: otherOwnerId,
      })
      .returning();

    const createdA = await db.transaction(async (tx) => {
      const columns = jurisdictionColumnsFromNormalized(
        applyMatterJurisdictionInput({
          courtId: "us-d-pa-ed",
          practiceArea: "Employment",
          asOfDate: "2026-08-19",
        }),
      );
      const [matter] = await tx
        .insert(matters)
        .values({
          organizationId: orgA,
          clientId: clientA!.id,
          matterNumber: `M-A-${suffix}`,
          title: "PA Federal Employment",
          createdByUserId: ownerId,
          ...columns,
        })
        .returning();
      await tx.insert(matterMembers).values({
        organizationId: orgA,
        matterId: matter!.id,
        userId: ownerId,
        access: "manage",
      });
      await tx.insert(matterMembers).values({
        organizationId: orgA,
        matterId: matter!.id,
        userId: viewerId,
        access: "read",
      });
      return matter!;
    });
    matterA = createdA.id;

    const createdB = await db.transaction(async (tx) => {
      const columns = jurisdictionColumnsFromNormalized(
        applyMatterJurisdictionInput({ primaryState: "NJ", forumType: "state" }),
      );
      const [matter] = await tx
        .insert(matters)
        .values({
          organizationId: orgB,
          clientId: clientB!.id,
          matterNumber: `M-B-${suffix}`,
          title: "NJ State Matter",
          createdByUserId: otherOwnerId,
          ...columns,
        })
        .returning();
      await tx.insert(matterMembers).values({
        organizationId: orgB,
        matterId: matter!.id,
        userId: otherOwnerId,
        access: "manage",
      });
      return matter!;
    });
    matterB = createdB.id;

    const createdJ1 = await db.transaction(async (tx) => {
      const columns = jurisdictionColumnsFromNormalized(
        applyMatterJurisdictionInput({
          primaryState: "PA",
          forumType: "state",
          practiceArea: "Contract",
          asOfDate: "2026-08-19",
          relatedJurisdictions: [{ stateCode: "NJ" }],
        }),
      );
      const [matter] = await tx
        .insert(matters)
        .values({
          organizationId: orgA,
          clientId: clientA!.id,
          matterNumber: `M-J1-${suffix}`,
          title: "PA Contract with NJ related forum",
          createdByUserId: ownerId,
          ...columns,
        })
        .returning();
      await tx.insert(matterMembers).values({
        organizationId: orgA,
        matterId: matter!.id,
        userId: ownerId,
        access: "manage",
      });
      return matter!;
    });
    matterJ1 = createdJ1.id;
  });

  it("resolves E.D. Pa. to the Third Circuit without promoting forum to governing law", async () => {
    const ctx = await resolveMatterJurisdictionContext({
      db,
      organizationId: orgA,
      matterId: matterA,
    });
    expect(ctx?.courtId).toBe("us-d-pa-ed");
    expect(ctx?.federalCircuit).toBe("3");
    expect(ctx?.primaryState).toBe("PA");
    expect(ctx?.forumType).toBe("federal");
    expect(ctx?.governingLawState).toBeNull();
    expect(ctx?.coverage).toBe("unvalidated");
    expect(ctx?.asOfDate).toBe("2026-08-19");
  });

  it("does not leak Matter A jurisdiction into Matter B or Org B", async () => {
    const wrongOrg = await resolveMatterJurisdictionContext({
      db,
      organizationId: orgB,
      matterId: matterA,
    });
    expect(wrongOrg).toBeNull();
    const otherMatter = await resolveMatterJurisdictionContext({
      db,
      organizationId: orgB,
      matterId: matterB,
    });
    expect(otherMatter?.primaryState).toBe("NJ");
    expect(otherMatter?.courtId).not.toBe("us-d-pa-ed");
  });

  it("refuses view-only mutation of Case metadata", async () => {
    await expect(
      requireMatterAccess(db, {
        userId: viewerId,
        matterId: matterA,
        minAccess: "edit",
        capability: "matters.edit",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const readAccess = await requireMatterAccess(db, {
      userId: viewerId,
      matterId: matterA,
      minAccess: "read",
      capability: "matters.view",
    });
    expect(readAccess.access).toBe("read");
  });

  it("records jurisdiction field identifiers on Case update audit", async () => {
    const [current] = await db.select().from(matters).where(eq(matters.id, matterA)).limit(1);
    const updated = jurisdictionColumnsFromNormalized(
      applyMatterJurisdictionInput(
        { governingLawState: "DE", choiceOfLawStatus: "stated" },
        existingJurisdictionFromMatter(current!),
      ),
    );
    await db.update(matters).set(updated).where(eq(matters.id, matterA));
    await writeAuditEvent(db, {
      organizationId: orgA,
      actorUserId: ownerId,
      matterId: matterA,
      action: "matter.updated",
      targetType: "matter",
      targetId: matterA,
      metadata: {
        governingLawState: updated.governingLawState,
        courtId: updated.courtId,
      },
    });
    const events = await db.select().from(auditEvents).where(eq(auditEvents.matterId, matterA));
    const event = events.find((row) => row.action === "matter.updated");
    expect(event).toBeTruthy();
    expect((event?.metadata as Record<string, unknown> | null)?.governingLawState).toBe("DE");
    expect((event?.metadata as Record<string, unknown> | null)?.courtId).toBe("us-d-pa-ed");
    const ctx = await resolveMatterJurisdictionContext({
      db,
      organizationId: orgA,
      matterId: matterA,
    });
    expect(ctx?.governingLawState).toBe("DE");
    expect(ctx?.choiceOfLawDistinctFromForum).toBe(true);
    expect(ctx?.jurisdictionMode).toBe("multi_jurisdiction");
  });

  it("J012: askNyayaAboutMatter injects structured Case jurisdiction into the live prompt", async () => {
    const ai = new PromptCaptureAI();
    const result = await askNyayaAboutMatter({
      db,
      retriever: new InMemoryMatterRetriever([]),
      organizationId: orgA,
      matterId: matterJ1,
      userId: ownerId,
      question: "What statute of limitations applies to this contract claim?",
      ai,
      includeLegalAuthority: false,
    });
    expect(result.conversationId).toBeTruthy();
    const userPrompt = ai.captured.find((row) => !row.schemaName || row.schemaName !== "evidence_assessment")
      ?.user ?? ai.lastUser;
    expect(userPrompt).toContain("USER CASE METADATA (not Case evidence; not verified governing law)");
    expect(userPrompt).toContain("primaryState=PA");
    expect(userPrompt).toContain("forumType=state");
    expect(userPrompt).toContain("asOfDate=2026-08-19");
    expect(userPrompt).toContain("relatedJurisdictions=NJ");
    expect(userPrompt).toContain("governingLawState=unknown");
    expect(userPrompt).not.toMatch(/governingLawState=NJ/);
    expect(userPrompt).not.toContain("us-d-pa-ed");
  });

  it("J012 isolation: Ask on Org B / Matter B does not receive Matter A forum metadata", async () => {
    const ai = new PromptCaptureAI();
    await askNyayaAboutMatter({
      db,
      retriever: new InMemoryMatterRetriever([]),
      organizationId: orgB,
      matterId: matterB,
      userId: otherOwnerId,
      question: "What statute of limitations applies?",
      ai,
      includeLegalAuthority: false,
    });
    const userPrompt = ai.captured.find((row) => !row.schemaName || row.schemaName !== "evidence_assessment")
      ?.user ?? ai.lastUser;
    expect(userPrompt).toContain("primaryState=NJ");
    expect(userPrompt).not.toContain("primaryState=PA");
    expect(userPrompt).not.toContain("us-d-pa-ed");
    expect(userPrompt).not.toContain("E.D. Pa");
  });

  it("J015: generateDraft receives USER CASE METADATA and does not treat related NJ as governing law", async () => {
    const ai = new PromptCaptureAI();
    const generated = await generateDraft({
      db,
      organizationId: orgA,
      matterId: matterJ1,
      userId: ownerId,
      title: "J1 contract letter",
      draftType: "letter",
      instructions: "Draft a short demand letter. Do not invent governing law.",
      ai,
      includeLegalAuthority: false,
    });
    expect(generated.draft.id).toBeTruthy();
    const draftCall = ai.captured.find((row) => /generate legal draft content/i.test(row.system));
    expect(draftCall).toBeTruthy();
    expect(draftCall!.system).toContain("not evidence and not verified governing law");
    expect(draftCall!.system).toContain("Do not convert related jurisdictions into governing law");
    expect(draftCall!.user).toContain("USER CASE METADATA (not Case evidence; not verified governing law)");
    expect(draftCall!.user).toContain("primaryState=PA");
    expect(draftCall!.user).toContain("relatedJurisdictions=NJ");
    expect(draftCall!.user).toContain("governingLawState=unknown");
    expect(draftCall!.user).not.toMatch(/governingLawState=NJ/);
    expect(draftCall!.user).toContain("Do not treat forum as governing law unless governingLawState is set.");
  });

  it("J016: executeAgentRun receives Case jurisdiction while FEATURE_AGENTS stays off in production", async () => {
    expect(getFeatureFlags({ APP_ENV: "production" }).agents).toBe(false);
    expect(getFeatureFlags({ APP_ENV: "staging" }).agents).toBe(false);
    expect(getFeatureFlags({ APP_ENV: "production", FEATURE_AGENTS: undefined }).agents).toBe(false);

    let captured: MatterJurisdictionContext | null | undefined;
    const probe: NyayaAgent = {
      id: "j1_jurisdiction_probe",
      name: "J1 jurisdiction probe",
      description: "Records Case jurisdiction context loaded by executeAgentRun.",
      supportedIntents: ["research"],
      requiredCapabilities: ["research.run"],
      allowedTools: [],
      riskClass: "low",
      inputSchema: agentInputSchema,
      outputSchema: agentOutputSchema,
      async execute(ctx) {
        captured = ctx.caseJurisdictionContext ?? null;
        return {
          summary: `Loaded jurisdiction ${ctx.caseJurisdictionContext?.primaryState ?? "none"}`,
          provenance: [],
          sources: [],
        };
      },
    };

    const created = await createAgentRun({
      db,
      organizationId: orgA,
      userId: ownerId,
      matterId: matterJ1,
      goal: "Record the Case jurisdiction context for this run.",
      intent: "research",
      steps: [
        {
          stepId: "j016-1",
          agentType: "j1_jurisdiction_probe",
          objective: "Capture caseJurisdictionContext from the agent runtime.",
          dependencies: [],
          requiredTools: [],
          approvalRequirement: "low",
        },
      ],
      userFacingPlan: "Inspect Case jurisdiction context. No filing or sending.",
    });

    const result = await executeAgentRun({
      db,
      organizationId: orgA,
      userId: ownerId,
      runId: created.run.id,
      agents: createDefaultAgentRegistry([probe]),
      tools: createDefaultToolRegistry(),
      ai: new MockAIProvider(),
      embeddings: new MockEmbeddingProvider(),
    });

    expect(result.run.status).toBe("completed");
    expect(captured?.matterId).toBe(matterJ1);
    expect(captured?.primaryState).toBe("PA");
    expect(captured?.relatedJurisdictions.some((row) => row.stateCode === "NJ")).toBe(true);
    expect(captured?.governingLawState).toBeNull();
    expect(captured?.asOfDate).toBe("2026-08-19");
    expect(captured?.promptBlock).toContain("USER CASE METADATA");
  });
});
