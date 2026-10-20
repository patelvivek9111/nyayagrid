import { describe, expect, it, beforeAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  createDb,
  createOrganizationWithDefaults,
  users,
  clients,
  matters,
  matterMembers,
  documents,
  documentVersions,
  documentChunks,
  analysisFindingSources,
  documentDuplicateMembers,
  matterFacts,
  matterFactSources,
} from "@nyayagrid/database";
import {
  AuthorizationError,
  requireMatterAccess,
  storageKeyForOrganization,
} from "@nyayagrid/permissions";
import {
  DevelopmentMalwareScanner,
  InMemoryStorageProvider,
  processDocumentPipeline,
  sha256Buffer,
} from "@nyayagrid/documents";
import {
  createDraft,
  generateDraft,
  saveDraftVersion,
  restoreDraftVersion,
  getDraftWithVersions,
  analyzeContract,
  reviewAnalysisItem,
  generateRedlineSuggestions,
  reviewRedlineSuggestion,
  compareDocuments,
  getDocumentComparison,
  analyzeDeposition,
  detectContradictionCandidates,
  reviewFinding,
  getEvidenceIntelligence,
  markDocumentImportant,
  updateDiscoveryReview,
  proposeDiscoveryClassification,
  createTag,
  assignTag,
  detectExactDuplicates,
  loadAuthorizedChunks,
} from "@nyayagrid/intelligence";
import { askNyayaAboutMatter, PostgresHybridRetriever } from "@nyayagrid/search";
import { MockAIProvider, MockEmbeddingProvider } from "@nyayagrid/ai";
import { InMemoryJobDispatcher } from "@nyayagrid/jobs";

const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDbTests)("phase 5 professional analysis integration", () => {
  const db = createDb(process.env.DATABASE_URL);
  const suffix = Date.now().toString(36);
  const storage = new InMemoryStorageProvider();

  let ownerId = "";
  let outsiderId = "";
  let orgId = "";
  let matterId = "";
  let otherOrgId = "";
  let otherOwnerId = "";
  let otherMatterId = "";

  let agreementADocId = "";
  let agreementAVersionId = "";
  let agreementBDocId = "";
  let agreementBVersionId = "";
  let transcriptDocId = "";
  let transcriptVersionId = "";
  let dup1DocId = "";
  let dup2DocId = "";
  let otherDocId = "";
  let otherVersionId = "";

  let manualDraftId = "";
  let contractAnalysisId = "";
  let comparisonId = "";
  let depositionFindingId = "";
  let contradictionFindingId = "";

  async function uploadAndProcess(params: {
    organizationId: string;
    matterId: string;
    userId: string;
    filename: string;
    content: string;
  }) {
    const documentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const body = Buffer.from(params.content);
    const key = storageKeyForOrganization({
      organizationId: params.organizationId,
      documentId,
      versionId,
      filename: params.filename,
    });
    await storage.putObject({ key, body, contentType: "text/plain" });
    await db.insert(documents).values({
      id: documentId,
      organizationId: params.organizationId,
      matterId: params.matterId,
      title: params.filename,
      createdByUserId: params.userId,
      processingState: "uploaded",
    });
    await db.insert(documentVersions).values({
      id: versionId,
      documentId,
      organizationId: params.organizationId,
      versionNumber: 1,
      storageKey: key,
      contentType: "text/plain",
      byteSize: body.length,
      sha256: sha256Buffer(body),
      originalFilename: params.filename,
      uploadedByUserId: params.userId,
    });
    const result = await processDocumentPipeline(
      {
        db,
        storage,
        scanner: new DevelopmentMalwareScanner(),
        embeddings: new MockEmbeddingProvider(),
      },
      {
        organizationId: params.organizationId,
        matterId: params.matterId,
        documentId,
        documentVersionId: versionId,
      },
    );
    if (!result.ok) {
      throw new Error(`Failed to process ${params.filename}: ${result.message}`);
    }
    return { documentId, versionId };
  }

  beforeAll(async () => {
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p5_owner_${suffix}`,
        email: `p5_owner_${suffix}@example.nyayagrid.local`,
        name: "Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `p5_outsider_${suffix}`,
        email: `p5_outsider_${suffix}@example.nyayagrid.local`,
        name: "Outsider",
      })
      .returning();
    ownerId = owner!.id;
    outsiderId = outsider!.id;

    const org = await createOrganizationWithDefaults(db, {
      name: `P5 Firm ${suffix}`,
      slug: `p5-firm-${suffix}`,
      type: "firm",
      ownerUserId: ownerId,
    });
    orgId = org.organization.id;

    const [otherOwner] = await db
      .insert(users)
      .values({
        authSubject: `p5_other_${suffix}`,
        email: `p5_other_${suffix}@example.nyayagrid.local`,
        name: "Other",
      })
      .returning();
    otherOwnerId = otherOwner!.id;
    const otherOrg = await createOrganizationWithDefaults(db, {
      name: `P5 Other ${suffix}`,
      slug: `p5-other-${suffix}`,
      type: "solo",
      ownerUserId: otherOwnerId,
    });
    otherOrgId = otherOrg.organization.id;

    const [client] = await db
      .insert(clients)
      .values({
        organizationId: orgId,
        clientType: "individual",
        displayName: "Casey Client",
        createdByUserId: ownerId,
      })
      .returning();
    const [matter] = await db
      .insert(matters)
      .values({
        organizationId: orgId,
        clientId: client!.id,
        matterNumber: `P5-${suffix}`,
        title: "Professional Analysis Matter",
        createdByUserId: ownerId,
      })
      .returning();
    matterId = matter!.id;
    await db.insert(matterMembers).values({
      organizationId: orgId,
      matterId,
      userId: ownerId,
      access: "manage",
    });

    const [otherClient] = await db
      .insert(clients)
      .values({
        organizationId: otherOrgId,
        clientType: "organization",
        displayName: "Other Co",
        organizationName: "Other Co",
        createdByUserId: otherOwnerId,
      })
      .returning();
    const [otherMatter] = await db
      .insert(matters)
      .values({
        organizationId: otherOrgId,
        clientId: otherClient!.id,
        matterNumber: `OY5-${suffix}`,
        title: "Other Matter",
        createdByUserId: otherOwnerId,
      })
      .returning();
    otherMatterId = otherMatter!.id;
    await db.insert(matterMembers).values({
      organizationId: otherOrgId,
      matterId: otherMatterId,
      userId: otherOwnerId,
      access: "manage",
    });

    const recital =
      "Additional recital language describing the background and general purpose of this commercial arrangement between the parties hereto. ".repeat(
        3,
      );

    const agreementA = await uploadAndProcess({
      organizationId: orgId,
      matterId,
      userId: ownerId,
      filename: "agreement-v1.txt",
      content: [
        "SERVICES AGREEMENT",
        recital,
        "Either party may terminate this Agreement upon thirty (30) days written notice to the other party.",
        "The Company may withhold approval of deliverables in its sole discretion.",
        "All confidential information disclosed hereunder shall remain confidential for a period of five years.",
      ].join("\n\n"),
    });
    agreementADocId = agreementA.documentId;
    agreementAVersionId = agreementA.versionId;

    const agreementB = await uploadAndProcess({
      organizationId: orgId,
      matterId,
      userId: ownerId,
      filename: "agreement-v2.txt",
      content: [
        "SERVICES AGREEMENT",
        recital,
        "Either party may terminate this Agreement upon ninety (90) days written notice to the other party.",
        "The Company may withhold approval of deliverables in its sole discretion.",
        "All confidential information disclosed hereunder shall remain confidential for a period of five years.",
      ].join("\n\n"),
    });
    agreementBDocId = agreementB.documentId;
    agreementBVersionId = agreementB.versionId;

    const fillerSentence =
      "Filler testimony text extending the length of this answer segment so it forms its own chunk boundary during processing. ".repeat(
        6,
      );
    const affirmative = `Q: Did you sign the Services Agreement on March 4? A: Yes, I signed the agreement on March 4 and confirmed receipt of all attached exhibits and schedules at that time. ${fillerSentence}`;
    const denial = `Q: Are you certain you executed the document? A: No, I never signed anything of the sort and I deny ever agreeing to those termination terms. ${fillerSentence}`;

    const transcript = await uploadAndProcess({
      organizationId: orgId,
      matterId,
      userId: ownerId,
      filename: "deposition-transcript.txt",
      content: [affirmative, denial].join("\n\n"),
    });
    transcriptDocId = transcript.documentId;
    transcriptVersionId = transcript.versionId;

    const dupContent =
      "Duplicate exhibit content shared across two uploaded copies of the same file for this matter.";
    const dup1 = await uploadAndProcess({
      organizationId: orgId,
      matterId,
      userId: ownerId,
      filename: "exhibit-copy-1.txt",
      content: dupContent,
    });
    dup1DocId = dup1.documentId;
    const dup2 = await uploadAndProcess({
      organizationId: orgId,
      matterId,
      userId: ownerId,
      filename: "exhibit-copy-2.txt",
      content: dupContent,
    });
    dup2DocId = dup2.documentId;

    const otherDoc = await uploadAndProcess({
      organizationId: otherOrgId,
      matterId: otherMatterId,
      userId: otherOwnerId,
      filename: "other-matter-doc.txt",
      content:
        "Confidential unrelated matter document text used only for cross-matter isolation testing.",
    });
    otherDocId = otherDoc.documentId;
    otherVersionId = otherDoc.versionId;

    const [firstChunk] = await db
      .select()
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.documentId, agreementADocId),
          eq(documentChunks.organizationId, orgId),
        ),
      )
      .limit(1);

    const [fact] = await db
      .insert(matterFacts)
      .values({
        organizationId: orgId,
        matterId,
        factKey: "termination_notice_period",
        label: "Termination notice period",
        value: "30 days",
        normalizedValue: "30",
        status: "approved",
        origin: "manual",
        confidence: "high",
        createdByUserId: ownerId,
        approvedByUserId: ownerId,
        approvedAt: new Date(),
      })
      .returning();
    await db.insert(matterFactSources).values({
      organizationId: orgId,
      matterId,
      matterFactId: fact!.id,
      documentId: agreementADocId,
      documentVersionId: agreementAVersionId,
      chunkId: firstChunk!.id,
      supportingText: firstChunk!.content.slice(0, 200),
    });
  }, 120000);

  it("denies cross-matter and outsider access via matter auth", async () => {
    await requireMatterAccess(db, { userId: ownerId, matterId, minAccess: "read" });
    await expect(
      requireMatterAccess(db, { userId: outsiderId, matterId, minAccess: "read" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      requireMatterAccess(db, { userId: ownerId, matterId: otherMatterId, minAccess: "read" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  describe("drafts", () => {
    it("creates a manual draft, generates a grounded AI draft, saves an edit, and restores a version", async () => {
      const manual = await createDraft({
        db,
        organizationId: orgId,
        matterId,
        userId: ownerId,
        title: "Manual Demand Letter",
        draftType: "letter",
        content: "Initial manual draft body.",
      });
      expect(manual.version.versionNumber).toBe(1);
      manualDraftId = manual.draft.id;

      const generated = await generateDraft({
        db,
        organizationId: orgId,
        matterId,
        userId: ownerId,
        title: "AI Services Agreement Summary",
        draftType: "memo",
        instructions: "Summarize the termination notice provisions.",
        documentIds: [agreementADocId],
        ai: new MockAIProvider(),
      });
      expect(generated.draft.aiGenerated).toBe(true);
      const generatedAssertions = (generated.version.sourceAssertions ?? []) as Array<{
        text: string;
        chunkIds: string[];
      }>;
      expect(generatedAssertions.length).toBeGreaterThan(0);
      for (const assertion of generatedAssertions) {
        expect(assertion.chunkIds.length).toBeGreaterThan(0);
      }

      const saved = await saveDraftVersion({
        db,
        organizationId: orgId,
        matterId,
        draftId: generated.draft.id,
        userId: ownerId,
        content: "Edited content with attorney refinements.",
        changeSummary: "Attorney edit",
      });
      expect(saved.versionNumber).toBe(2);

      const restored = await restoreDraftVersion({
        db,
        organizationId: orgId,
        matterId,
        draftId: generated.draft.id,
        versionNumber: 1,
        userId: ownerId,
      });
      expect(restored.versionNumber).toBe(3);
      expect(restored.content).toBe(generated.version.content);
    });

    it("rejects outsider draft retrieval via requireMatterAccess before the domain call", async () => {
      await expect(
        requireMatterAccess(db, { userId: outsiderId, matterId, minAccess: "read" }),
      ).rejects.toBeInstanceOf(AuthorizationError);

      const authorized = await getDraftWithVersions({
        db,
        organizationId: orgId,
        matterId,
        draftId: manualDraftId,
      });
      expect(authorized?.draft.id).toBe(manualDraftId);
    });

    it("does not let generateDraft assertions use cross-matter document chunks", async () => {
      const crossMatter = await generateDraft({
        db,
        organizationId: orgId,
        matterId,
        userId: ownerId,
        title: "Cross-matter test draft",
        draftType: "memo",
        documentIds: [otherDocId],
        ai: new MockAIProvider(),
      });
      expect(crossMatter.version.sourceAssertions).toEqual([]);

      const [otherChunk] = await db
        .select()
        .from(documentChunks)
        .where(eq(documentChunks.documentId, otherDocId))
        .limit(1);
      const authorized = await loadAuthorizedChunks(db, {
        organizationId: orgId,
        matterId,
        chunkIds: [otherChunk!.id],
      });
      expect(authorized.size).toBe(0);
    });
  });

  describe("contract analysis", () => {
    it("analyzes a contract with provenance sources on every item", async () => {
      const result = await analyzeContract({
        db,
        organizationId: orgId,
        matterId,
        documentId: agreementADocId,
        documentVersionId: agreementAVersionId,
        userId: ownerId,
        ai: new MockAIProvider(),
      });
      expect(result.skipped).toBe(false);
      expect(result.analysis.items.length).toBeGreaterThan(0);
      for (const item of result.analysis.items) {
        expect(item.sources.length).toBeGreaterThan(0);
      }
      contractAnalysisId = result.analysis.analysis.id;

      const reviewed = await reviewAnalysisItem({
        db,
        organizationId: orgId,
        matterId,
        itemId: result.analysis.items[0]!.id,
        userId: ownerId,
        action: "reviewed",
      });
      expect(reviewed.status).toBe("reviewed");
    });

    it("generates redline suggestions, accepts one, and leaves the original document version unchanged", async () => {
      const [before] = await db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.id, agreementAVersionId))
        .limit(1);

      const redlines = await generateRedlineSuggestions({
        db,
        organizationId: orgId,
        matterId,
        analysisId: contractAnalysisId,
        userId: ownerId,
        ai: new MockAIProvider(),
      });
      expect(redlines.suggestions.length).toBeGreaterThan(0);

      const accepted = await reviewRedlineSuggestion({
        db,
        organizationId: orgId,
        matterId,
        suggestionId: redlines.suggestions[0]!.id,
        userId: ownerId,
        status: "accepted",
      });
      expect(accepted.status).toBe("accepted");

      const [after] = await db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.id, agreementAVersionId))
        .limit(1);
      expect(after!.sha256).toBe(before!.sha256);
      expect(after!.storageKey).toBe(before!.storageKey);
    });

    it("rejects a cross-matter documentId for contract analysis", async () => {
      await expect(
        analyzeContract({
          db,
          organizationId: orgId,
          matterId,
          documentId: otherDocId,
          documentVersionId: otherVersionId,
          userId: ownerId,
          ai: new MockAIProvider(),
        }),
      ).rejects.toThrow();
    });
  });

  describe("document comparison", () => {
    it("compares two document versions, detects changed text, and persists retrievable results", async () => {
      const comparison = await compareDocuments({
        db,
        organizationId: orgId,
        matterId,
        documentAId: agreementADocId,
        versionAId: agreementAVersionId,
        documentBId: agreementBDocId,
        versionBId: agreementBVersionId,
        userId: ownerId,
        ai: new MockAIProvider(),
      });
      expect(comparison.skipped).toBe(false);
      expect(comparison.changes.length).toBeGreaterThan(0);
      const touchesTerminationLanguage = comparison.changes.some(
        (c) =>
          (c.oldText ?? "").toLowerCase().includes("thirty") ||
          (c.newText ?? "").toLowerCase().includes("ninety"),
      );
      expect(touchesTerminationLanguage).toBe(true);
      comparisonId = comparison.comparison.id;

      const persisted = await getDocumentComparison({
        db,
        organizationId: orgId,
        matterId,
        comparisonId,
      });
      expect(persisted?.changes.length).toBe(comparison.changes.length);
    });

    it("denies unauthorized comparison access via matter auth", async () => {
      await expect(
        requireMatterAccess(db, { userId: outsiderId, matterId, minAccess: "read" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  describe("deposition and contradiction analysis", () => {
    it("analyzes deposition testimony and produces cited findings", async () => {
      const result = await analyzeDeposition({
        db,
        organizationId: orgId,
        matterId,
        documentId: transcriptDocId,
        documentVersionId: transcriptVersionId,
        userId: ownerId,
        ai: new MockAIProvider(),
      });
      expect(result.skipped).toBe(false);
      expect(result.findings.length).toBeGreaterThan(0);
      depositionFindingId = result.findings[0]!.id;

      const sources = await db
        .select()
        .from(analysisFindingSources)
        .where(eq(analysisFindingSources.findingId, depositionFindingId));
      expect(sources.length).toBeGreaterThan(0);
    });

    it("detects contradiction candidates spanning both sides of the testimony", async () => {
      const result = await detectContradictionCandidates({
        db,
        organizationId: orgId,
        matterId,
        documentId: transcriptDocId,
        userId: ownerId,
        ai: new MockAIProvider(),
      });
      expect(result.skipped).toBe(false);
      expect(result.findings.length).toBeGreaterThan(0);
      contradictionFindingId = result.findings[0]!.id;

      const sources = await db
        .select()
        .from(analysisFindingSources)
        .where(eq(analysisFindingSources.findingId, contradictionFindingId));
      const sides = new Set(sources.map((s) => s.side));
      expect(sides.has("A")).toBe(true);
      expect(sides.has("B")).toBe(true);
    });

    it("reviews findings as reviewed or dismissed", async () => {
      const reviewed = await reviewFinding({
        db,
        organizationId: orgId,
        matterId,
        findingId: depositionFindingId,
        userId: ownerId,
        action: "reviewed",
        note: "Confirmed relevant to impeachment.",
      });
      expect(reviewed.status).toBe("reviewed");

      const dismissed = await reviewFinding({
        db,
        organizationId: orgId,
        matterId,
        findingId: contradictionFindingId,
        userId: ownerId,
        action: "dismissed",
      });
      expect(dismissed.status).toBe("dismissed");
    });

    it("rejects a cross-matter document for deposition analysis", async () => {
      await expect(
        analyzeDeposition({
          db,
          organizationId: orgId,
          matterId,
          documentId: otherDocId,
          documentVersionId: otherVersionId,
          userId: ownerId,
          ai: new MockAIProvider(),
        }),
      ).rejects.toThrow();
    });
  });

  describe("evidence intelligence", () => {
    it("builds an evidence matrix including the verified fact and its source", async () => {
      const evidence = await getEvidenceIntelligence({ db, organizationId: orgId, matterId });
      expect(evidence.documents.some((d) => d.document.id === agreementADocId)).toBe(true);
      expect(
        evidence.evidenceMatrix.issues.some((i) => i.issueKey === "termination_notice_period"),
      ).toBe(true);
    });

    it("marks a document important and reflects it in the evidence view", async () => {
      const marked = await markDocumentImportant({
        db,
        organizationId: orgId,
        matterId,
        documentId: transcriptDocId,
        important: true,
        userId: ownerId,
      });
      expect(marked.important).toBe(true);

      const evidence = await getEvidenceIntelligence({ db, organizationId: orgId, matterId });
      const transcriptEntry = evidence.documents.find((d) => d.document.id === transcriptDocId);
      expect(transcriptEntry?.important).toBe(true);
    });

    it("isolates evidence intelligence to the requested matter", async () => {
      const otherEvidence = await getEvidenceIntelligence({
        db,
        organizationId: otherOrgId,
        matterId: otherMatterId,
      });
      expect(otherEvidence.documents.some((d) => d.document.id === agreementADocId)).toBe(false);
      expect(
        otherEvidence.evidenceMatrix.issues.some((i) => i.issueKey === "termination_notice_period"),
      ).toBe(false);
    });
  });

  describe("discovery review", () => {
    it("updates discovery review via manual classification", async () => {
      const updated = await updateDiscoveryReview({
        db,
        organizationId: orgId,
        matterId,
        documentId: agreementADocId,
        userId: ownerId,
        relevance: "relevant",
        responsiveness: "responsive",
        confidentiality: "confidential",
        notes: "Core services agreement.",
      });
      expect(updated.relevance).toBe("relevant");
      expect(updated.humanPrivilegeFinal).toBe(false);
    });

    it("proposes an AI discovery classification without setting human privilege final", async () => {
      const proposal = await proposeDiscoveryClassification({
        db,
        organizationId: orgId,
        matterId,
        documentId: agreementADocId,
        userId: ownerId,
        ai: new MockAIProvider(),
      });
      expect(proposal.reviewState.aiPrivilege).not.toBeNull();
      expect(proposal.reviewState.privilege).toBe("unknown");
      expect(proposal.reviewState.humanPrivilegeFinal).toBe(false);
    });

    it("requires humanPrivilegeFinal before privilege can be set to privileged", async () => {
      await expect(
        updateDiscoveryReview({
          db,
          organizationId: orgId,
          matterId,
          documentId: agreementADocId,
          userId: ownerId,
          privilege: "privileged",
        }),
      ).rejects.toThrow();

      const withFinal = await updateDiscoveryReview({
        db,
        organizationId: orgId,
        matterId,
        documentId: agreementADocId,
        userId: ownerId,
        privilege: "privileged",
        humanPrivilegeFinal: true,
      });
      expect(withFinal.privilege).toBe("privileged");
      expect(withFinal.humanPrivilegeFinal).toBe(true);
    });

    it("creates and assigns a discovery tag", async () => {
      const tag = await createTag({
        db,
        organizationId: orgId,
        matterId,
        userId: ownerId,
        key: "Hot Document",
        label: "Hot Document",
      });
      expect(tag.key).toBe("hot_document");

      const assignment = await assignTag({
        db,
        organizationId: orgId,
        matterId,
        documentId: agreementADocId,
        tagId: tag.id,
        userId: ownerId,
      });
      expect(assignment.tagId).toBe(tag.id);
    });

    it("detects exact duplicates by sha256, grouping both copies without deleting either", async () => {
      const result = await detectExactDuplicates({
        db,
        organizationId: orgId,
        matterId,
        userId: ownerId,
      });
      expect(result.groupsCreated).toBeGreaterThanOrEqual(1);
      expect(result.membersAdded).toBeGreaterThanOrEqual(2);

      const members = await db
        .select()
        .from(documentDuplicateMembers)
        .where(eq(documentDuplicateMembers.matterId, matterId));
      const memberDocIds = new Set(members.map((m) => m.documentId));
      expect(memberDocIds.has(dup1DocId)).toBe(true);
      expect(memberDocIds.has(dup2DocId)).toBe(true);

      const stillPresent = await db
        .select()
        .from(documents)
        .where(inArray(documents.id, [dup1DocId, dup2DocId]));
      expect(stillPresent.length).toBe(2);
    });
  });

  describe("nyaya with professional analysis context", () => {
    it("includes professional analysis context in Nyaya answers once reviewed findings exist", async () => {
      const answer = await askNyayaAboutMatter({
        db,
        retriever: new PostgresHybridRetriever(db, new MockEmbeddingProvider()),
        organizationId: orgId,
        matterId,
        userId: ownerId,
        question: "What termination notice period applies to the services agreement?",
        ai: new MockAIProvider(),
      });
      expect(answer.usedProfessionalAnalysis).toBe(true);
    });

    it("prevents outsiders from asking Nyaya via requireMatterAccess", async () => {
      await expect(
        requireMatterAccess(db, { userId: outsiderId, matterId, minAccess: "read" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  describe("jobs", () => {
    it("InMemoryJobDispatcher enforces idempotency for the matter.analyze_contract job", async () => {
      let runs = 0;
      const dispatcher = new InMemoryJobDispatcher({
        "matter.analyze_contract": async (payload) => {
          runs += 1;
          return {
            ok: true,
            message: "contract analyzed",
            data: { documentId: payload.documentId },
          };
        },
      });
      const payload = {
        organizationId: orgId,
        matterId,
        documentId: agreementADocId,
        documentVersionId: agreementAVersionId,
        userId: ownerId,
        idempotencyKey: `contract_analysis:${agreementAVersionId}`,
      };
      await dispatcher.dispatch("matter.analyze_contract", payload);
      await dispatcher.dispatch("matter.analyze_contract", payload);
      expect(runs).toBe(1);
      expect(dispatcher.processed).toHaveLength(1);
    });
  });
});
