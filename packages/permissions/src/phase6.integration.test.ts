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
  matterFacts,
  legalAuthorities,
  legalAuthorityVersions,
  legalAuthorityChunks,
  researchArtifacts,
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
  generateDraft,
  classifyDraftAssertions,
  loadDraftLegalAuthorityContext,
  type ClassifiedDraftAssertion,
} from "@nyayagrid/intelligence";
import { askNyayaAboutMatter, PostgresHybridRetriever } from "@nyayagrid/search";
import { MockAIProvider, MockEmbeddingProvider } from "@nyayagrid/ai";
import { InMemoryJobDispatcher } from "@nyayagrid/jobs";
import {
  importAuthority,
  syntheticCaseAuthority,
  syntheticStatuteAuthority,
  SYNTHETIC_SOURCE_PROVIDER,
  SYNTHETIC_CASE_CITATION,
  SYNTHETIC_VALID_QUOTE,
  SYNTHETIC_FABRICATED_QUOTE,
  AuthorityHybridRetriever,
  assertAuthorityHitsOnly,
  assertChunksBelongToAuthorityCorpus,
  resolveCitationAgainstCorpus,
  parseCitation,
  validateQuoteAgainstText,
  loadAuthorizedAuthorityChunks,
  runResearchQuery,
  generateResearchMemo,
  saveAuthorityToMatter,
  updateMatterAuthorityStatus,
  listMatterAuthorities,
  createResearchSession,
  getResearchSession,
  createResearchNote,
  NO_AUTHORITY_HITS_WARNING,
  NO_CORPUS_SYNTHESIS_ANSWER,
  type ImportAuthorityInput,
} from "@nyayagrid/research";

const runDbTests = process.env.RUN_DB_TESTS === "1";

/**
 * Synthetic case that reaches the opposite conclusion from `syntheticCaseAuthority` on the same
 * statutory question, so contrary-authority retrieval has something real to surface. Fictional
 * names/citations/year, matching the convention in `@nyayagrid/research`'s fixtures.
 */
const contraryCaseAuthority: ImportAuthorityInput = {
  title: "Wexford Holdings v. Bramwell Corp., 888 F.3d 200 (Fed. Cir. 2099)",
  shortTitle: "Wexford v. Bramwell",
  authorityType: "case",
  jurisdiction: "Synthetic Federal",
  court: "Synthetic Court of Appeals",
  citation: "888 F.3d 200",
  docketNumber: "SYN-2099-0002",
  decisionDate: "2099-06-01",
  publicationStatus: "published",
  sourceProvider: SYNTHETIC_SOURCE_PROVIDER,
  sourceExternalId: "wexford-v-bramwell-888-f3d-200",
  content: [
    "Wexford Holdings v. Bramwell Corp., 888 F.3d 200 (Fed. Cir. 2099).",
    "",
    "Contrary to the rule applied in Acme Corp. v. Contoso Ltd., 999 F.3d 1, this panel holds that a preliminary injunction under Synthetic Jurisdiction Code § 100 may issue even where the underlying harm is compensable in damages, so long as the loss threatens the movant's ongoing business relationships.",
    "",
    "We decline to adopt a categorical rule that fully compensable monetary loss can never constitute irreparable harm.",
  ].join("\n"),
  metadata: { synthetic: true },
};

describe.runIf(runDbTests)("phase 6 research corpus integration", () => {
  const db = createDb(process.env.DATABASE_URL);
  const suffix = Date.now().toString(36);
  const storage = new InMemoryStorageProvider();

  let ownerId = "";
  let outsiderId = "";
  let orgId = "";
  let matterId = "";
  let otherOwnerId = "";
  let otherOrgId = "";
  let otherMatterId = "";

  let matterDocId = "";
  let matterDocVersionId = "";
  let matterDocChunkIds: string[] = [];

  let statuteAuthorityId = "";
  let statuteVersionId = "";
  let caseAuthorityId = "";
  let contraryAuthorityId = "";

  let researchSessionId = "";

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
    // The legal authority corpus has no org/matter scope and is not suffix-namespaced like the
    // rest of this fixture, so re-running this suite against a persistent local database must
    // start from a clean slate for these specific fixture sourceExternalIds. FK cascades clean up
    // versions/chunks/citations/matter_authorities/research_results for the deleted authorities.
    await db
      .delete(legalAuthorities)
      .where(
        and(
          eq(legalAuthorities.sourceProvider, SYNTHETIC_SOURCE_PROVIDER),
          inArray(legalAuthorities.sourceExternalId, [
            syntheticStatuteAuthority.sourceExternalId!,
            syntheticCaseAuthority.sourceExternalId!,
            contraryCaseAuthority.sourceExternalId!,
          ]),
        ),
      );

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p6_owner_${suffix}`,
        email: `p6_owner_${suffix}@example.nyayagrid.local`,
        name: "Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `p6_outsider_${suffix}`,
        email: `p6_outsider_${suffix}@example.nyayagrid.local`,
        name: "Outsider",
      })
      .returning();
    ownerId = owner!.id;
    outsiderId = outsider!.id;

    const org = await createOrganizationWithDefaults(db, {
      name: `P6 Firm ${suffix}`,
      slug: `p6-firm-${suffix}`,
      type: "firm",
      ownerUserId: ownerId,
    });
    orgId = org.organization.id;

    const [otherOwner] = await db
      .insert(users)
      .values({
        authSubject: `p6_other_${suffix}`,
        email: `p6_other_${suffix}@example.nyayagrid.local`,
        name: "Other",
      })
      .returning();
    otherOwnerId = otherOwner!.id;
    const otherOrg = await createOrganizationWithDefaults(db, {
      name: `P6 Other ${suffix}`,
      slug: `p6-other-${suffix}`,
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
        matterNumber: `P6-${suffix}`,
        title: "Research Corpus Matter",
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
        matterNumber: `OY6-${suffix}`,
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
      "Additional recital language describing the background and general commercial purpose of this supply arrangement between the parties hereto, kept for administrative record-keeping only. ".repeat(
        4,
      );
    const matterDoc = await uploadAndProcess({
      organizationId: orgId,
      matterId,
      userId: ownerId,
      filename: "widget-supply-agreement.txt",
      content: [
        "WIDGET ALPHA SUPPLY AGREEMENT",
        recital,
        "Vendor shall deliver Widget Alpha units to Buyer according to the delivery schedule set forth in Exhibit A, with quarterly inventory reconciliation completed within thirty days of each quarter end.",
        "Buyer shall provide Vendor written notice of any nonconforming shipment within ten business days of receipt.",
      ].join("\n\n"),
    });
    matterDocId = matterDoc.documentId;
    matterDocVersionId = matterDoc.versionId;

    const chunkRows = await db
      .select({ id: documentChunks.id })
      .from(documentChunks)
      .where(
        and(eq(documentChunks.documentId, matterDocId), eq(documentChunks.organizationId, orgId)),
      );
    matterDocChunkIds = chunkRows.map((row) => row.id);
    expect(matterDocChunkIds.length).toBeGreaterThan(0);

    await db.insert(matterFacts).values({
      organizationId: orgId,
      matterId,
      factKey: "delivery_schedule_dispute",
      label: "Delivery schedule dispute date",
      value: "2024-05-01",
      normalizedValue: "2024-05-01",
      status: "approved",
      origin: "manual",
      confidence: "high",
      createdByUserId: ownerId,
      approvedByUserId: ownerId,
      approvedAt: new Date(),
    });
  }, 120000);

  describe("ingestion", () => {
    it("imports the synthetic statute, persists metadata, and embeds every chunk", async () => {
      const result = await importAuthority({
        db,
        embeddings: new MockEmbeddingProvider(),
        input: syntheticStatuteAuthority,
      });
      expect(result.skipped).toBe(false);
      statuteAuthorityId = result.authority.id;
      statuteVersionId = result.version.id;

      expect(result.authority.title).toBe(syntheticStatuteAuthority.title);
      expect(result.authority.citation).toBe(syntheticStatuteAuthority.citation);
      expect(result.authority.jurisdiction).toBe(syntheticStatuteAuthority.jurisdiction);
      expect(result.authority.authorityType).toBe("statute");
      expect(result.chunkCount).toBeGreaterThan(0);

      const chunks = await db
        .select()
        .from(legalAuthorityChunks)
        .where(eq(legalAuthorityChunks.authorityVersionId, statuteVersionId));
      expect(chunks.length).toBe(result.chunkCount);
      for (const chunk of chunks) {
        expect(chunk.embedding).not.toBeNull();
        expect(chunk.embeddingModel).toBe(new MockEmbeddingProvider().model);
      }
    });

    it("imports the synthetic case and the contrary case authority", async () => {
      const caseResult = await importAuthority({
        db,
        embeddings: new MockEmbeddingProvider(),
        input: syntheticCaseAuthority,
      });
      expect(caseResult.skipped).toBe(false);
      caseAuthorityId = caseResult.authority.id;
      expect(caseResult.authority.citation).toBe(SYNTHETIC_CASE_CITATION);
      expect(caseResult.authority.authorityType).toBe("case");

      const contraryResult = await importAuthority({
        db,
        embeddings: new MockEmbeddingProvider(),
        input: contraryCaseAuthority,
      });
      expect(contraryResult.skipped).toBe(false);
      contraryAuthorityId = contraryResult.authority.id;
      expect(contraryResult.authority.citation).toBe(contraryCaseAuthority.citation);
    });

    it("is idempotent when content is unchanged", async () => {
      const before = await importAuthority({
        db,
        embeddings: new MockEmbeddingProvider(),
        input: syntheticStatuteAuthority,
      });
      expect(before.skipped).toBe(true);
      expect(before.authority.id).toBe(statuteAuthorityId);
      expect(before.version.id).toBe(statuteVersionId);

      const versions = await db
        .select()
        .from(legalAuthorityVersions)
        .where(eq(legalAuthorityVersions.authorityId, statuteAuthorityId));
      expect(versions).toHaveLength(1);
    });

    it("creates a new immutable version on content change without deleting the old one", async () => {
      const amended: ImportAuthorityInput = {
        ...syntheticStatuteAuthority,
        content: `${syntheticStatuteAuthority.content}\n\n(d) This subsection was added by a later amendment.`,
      };
      const result = await importAuthority({
        db,
        embeddings: new MockEmbeddingProvider(),
        input: amended,
      });
      expect(result.skipped).toBe(false);
      expect(result.authority.id).toBe(statuteAuthorityId);
      expect(result.version.versionNumber).toBe(2);

      const versions = await db
        .select()
        .from(legalAuthorityVersions)
        .where(eq(legalAuthorityVersions.authorityId, statuteAuthorityId));
      expect(versions).toHaveLength(2);
      const v1 = versions.find((v) => v.versionNumber === 1)!;
      const v2 = versions.find((v) => v.versionNumber === 2)!;
      expect(v1.validTo).not.toBeNull();
      expect(v2.validTo).toBeNull();
      expect(v1.content).toContain(SYNTHETIC_VALID_QUOTE);
      statuteVersionId = v2.id;
    });
  });

  describe("search", () => {
    it("finds the authority by exact citation", async () => {
      const retriever = new AuthorityHybridRetriever(db, new MockEmbeddingProvider());
      const hits = await retriever.search(SYNTHETIC_CASE_CITATION, {}, { limit: 5 });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.authorityId).toBe(caseAuthorityId);
    });

    it("finds relevant passages via hybrid FTS/vector search", async () => {
      const retriever = new AuthorityHybridRetriever(db, new MockEmbeddingProvider());
      const hits = await retriever.search(
        "irreparable harm compensable damages",
        {},
        { limit: 10 },
      );
      const authorityIds = new Set(hits.map((h) => h.authorityId));
      expect(hits.length).toBeGreaterThan(0);
      expect(authorityIds.has(statuteAuthorityId) || authorityIds.has(caseAuthorityId)).toBe(true);
    });

    it("scopes results with a jurisdiction filter", async () => {
      const retriever = new AuthorityHybridRetriever(db, new MockEmbeddingProvider());
      const hits = await retriever.search(
        "irreparable harm",
        { jurisdiction: "Synthetic Federal" },
        { limit: 10 },
      );
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((h) => h.jurisdiction === "Synthetic Federal")).toBe(true);
      expect(hits.some((h) => h.authorityId === caseAuthorityId)).toBe(true);
      expect(hits.some((h) => h.authorityId === statuteAuthorityId)).toBe(false);
    });

    it("never returns matter document chunks as authority hits", async () => {
      const retriever = new AuthorityHybridRetriever(db, new MockEmbeddingProvider());
      const hits = await retriever.search(
        "Widget Alpha units delivery schedule Exhibit A quarterly inventory reconciliation",
        {},
        { limit: 10 },
      );
      const hitChunkIds = new Set(hits.map((h) => h.chunkId));
      for (const docChunkId of matterDocChunkIds) {
        expect(hitChunkIds.has(docChunkId)).toBe(false);
      }
      expect(() => assertAuthorityHitsOnly(hits)).not.toThrow();
      await expect(
        assertChunksBelongToAuthorityCorpus(
          db,
          hits.map((h) => h.chunkId),
        ),
      ).resolves.toBeUndefined();
      await expect(assertChunksBelongToAuthorityCorpus(db, matterDocChunkIds)).rejects.toThrow();
    });
  });

  describe("citations and quotes", () => {
    it("resolves an exact citation to the corpus authority", async () => {
      const resolution = await resolveCitationAgainstCorpus(db, SYNTHETIC_CASE_CITATION);
      expect(resolution?.authorityId).toBe(caseAuthorityId);
    });

    it("parses citations and refuses to normalize unrecognized text", () => {
      expect(parseCitation(SYNTHETIC_CASE_CITATION).normalized).toBe(SYNTHETIC_CASE_CITATION);
      expect(parseCitation("see the discussion above").normalized).toBeNull();
    });

    it("validates a verbatim quote against persisted authority text and rejects a fabricated one", async () => {
      const chunks = await loadAuthorizedAuthorityChunks({
        db,
        authorityIds: [statuteAuthorityId],
      });
      const combinedText = [...chunks.values()].map((c) => c.content).join("\n");
      expect(validateQuoteAgainstText(SYNTHETIC_VALID_QUOTE, combinedText).valid).toBe(true);
      expect(validateQuoteAgainstText(SYNTHETIC_FABRICATED_QUOTE, combinedText).valid).toBe(false);
    });
  });

  describe("synthesis", () => {
    it("runs a grounded research query citing only real corpus authority ids", async () => {
      const result = await runResearchQuery({
        db,
        organizationId: orgId,
        userId: ownerId,
        question:
          "What must a party show to obtain a preliminary injunction under Synthetic Jurisdiction Code § 100?",
        ai: new MockAIProvider(),
        embeddings: new MockEmbeddingProvider(),
      });
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.grounded).toBe(true);
      expect(result.synthesis.legalPropositions.length).toBeGreaterThan(0);

      const corpusIds = new Set([statuteAuthorityId, caseAuthorityId, contraryAuthorityId]);
      for (const proposition of result.synthesis.legalPropositions) {
        for (const authorityId of proposition.authorityIds) {
          expect(corpusIds.has(authorityId)).toBe(true);
        }
      }
      expect(result.validation.fabricatedAuthorityIds).toEqual([]);
      researchSessionId = result.session.id;
    });

    it("does not fabricate an answer when nothing in the corpus matches", async () => {
      const result = await runResearchQuery({
        db,
        organizationId: orgId,
        userId: ownerId,
        question: "What rule applies in a jurisdiction that has no authorities in this corpus?",
        filters: { jurisdiction: "Nonexistent Jurisdiction Xyz" },
        ai: new MockAIProvider(),
        embeddings: new MockEmbeddingProvider(),
      });
      expect(result.hits).toHaveLength(0);
      expect(result.grounded).toBe(false);
      expect(result.synthesis.legalPropositions).toEqual([]);
      expect(result.synthesis.conciseAnswer).toBe(NO_CORPUS_SYNTHESIS_ANSWER);
      expect(result.coverageWarnings).toContain(NO_AUTHORITY_HITS_WARNING);
    });

    it("surfaces contrary authority when includeContrary is requested", async () => {
      const result = await runResearchQuery({
        db,
        organizationId: orgId,
        userId: ownerId,
        question:
          "Does compensable monetary loss ever qualify as irreparable harm under Synthetic Jurisdiction Code § 100?",
        includeContrary: true,
        ai: new MockAIProvider(),
        embeddings: new MockEmbeddingProvider(),
      });
      expect(result.contrarySearchPerformed).toBe(true);
      expect(result.hits.some((h) => h.authorityId === contraryAuthorityId)).toBe(true);
    });
  });

  describe("matter integration", () => {
    it("uses verified matter context for issue formulation while keeping authorities corpus-only", async () => {
      const result = await runResearchQuery({
        db,
        organizationId: orgId,
        userId: ownerId,
        matterId,
        question:
          "Given our delivery schedule dispute, what standard governs a preliminary injunction under Synthetic Jurisdiction Code § 100?",
        ai: new MockAIProvider(),
        embeddings: new MockEmbeddingProvider(),
      });
      expect(result.usedMatterContext).toBe(true);

      const corpusIds = new Set([statuteAuthorityId, caseAuthorityId, contraryAuthorityId]);
      const matterChunkIdSet = new Set(matterDocChunkIds);
      for (const hit of result.hits) {
        expect(corpusIds.has(hit.authorityId)).toBe(true);
        expect(matterChunkIdSet.has(hit.chunkId)).toBe(false);
      }
    });

    it("saves an authority to the matter and marks it key_authority", async () => {
      const saved = await saveAuthorityToMatter({
        db,
        organizationId: orgId,
        matterId,
        authorityId: statuteAuthorityId,
        userId: ownerId,
        status: "saved",
      });
      expect(saved.status).toBe("saved");

      const updated = await updateMatterAuthorityStatus({
        db,
        organizationId: orgId,
        matterId,
        authorityId: statuteAuthorityId,
        userId: ownerId,
        status: "key_authority",
      });
      expect(updated.status).toBe("key_authority");

      const list = await listMatterAuthorities({ db, organizationId: orgId, matterId });
      const entry = list.find((item) => item.authorityId === statuteAuthorityId);
      expect(entry?.status).toBe("key_authority");
    });

    it("creates a manual research note", async () => {
      const session = await createResearchSession({
        db,
        organizationId: orgId,
        userId: ownerId,
        matterId,
        title: "Injunction standard research",
      });
      researchSessionId = session.id;

      const note = await createResearchNote({
        db,
        organizationId: orgId,
        userId: ownerId,
        origin: "manual",
        content: "Confirm current treatment of Acme v. Contoso before relying on it.",
        sessionId: session.id,
        matterId,
        authorityId: caseAuthorityId,
      });
      expect(note.origin).toBe("manual");
      expect(note.authorityId).toBe(caseAuthorityId);
    });

    it("generates a research memo distinguishing FACT_SOURCE matter evidence from LEGAL_AUTHORITY propositions", async () => {
      const memoResult = await generateResearchMemo({
        db,
        organizationId: orgId,
        userId: ownerId,
        matterId,
        question:
          "What standard applies to a preliminary injunction under Synthetic Jurisdiction Code § 100, and how does our delivery schedule dispute bear on timing?",
        documentIds: [matterDocId],
        ai: new MockAIProvider(),
        embeddings: new MockEmbeddingProvider(),
      });
      expect(memoResult.grounded).toBe(true);
      expect(memoResult.matterChunkIds.length).toBeGreaterThan(0);
      expect(memoResult.artifactId).not.toBeNull();

      const [artifact] = await db
        .select()
        .from(researchArtifacts)
        .where(eq(researchArtifacts.id, memoResult.artifactId!));
      const propositions = artifact!.propositions ?? [];
      expect(propositions.some((p) => p.provenanceClass === "LEGAL_AUTHORITY")).toBe(true);
      const factProposition = propositions.find((p) => p.provenanceClass === "FACT_SOURCE");
      expect(factProposition).toBeDefined();
      expect(factProposition!.authorityIds).toEqual([]);
      expect(factProposition!.matterChunkIds?.length).toBeGreaterThan(0);
    });
  });

  describe("draft and nyaya integration", () => {
    it("keeps LEGAL_AUTHORITY and FACT_SOURCE assertions separate when generating a draft", async () => {
      const authorityContext = await loadDraftLegalAuthorityContext({
        db,
        organizationId: orgId,
        matterId,
      });
      expect(authorityContext.authorityIds).toContain(statuteAuthorityId);
      const authorityChunkIdSet = new Set(authorityContext.authorityChunkIds);
      const matterChunkIdSet = new Set(matterDocChunkIds);
      expect(authorityChunkIdSet.size).toBeGreaterThan(0);
      for (const chunkId of authorityChunkIdSet) {
        expect(matterChunkIdSet.has(chunkId)).toBe(false);
      }

      // Direct check: an assertion citing both a matter chunk and an authority chunk must split
      // into two provenance-labeled entries, never conflating matter evidence with legal authority.
      const matterChunkId = matterDocChunkIds[0]!;
      const authorityChunkId = [...authorityChunkIdSet][0]!;
      const classified = classifyDraftAssertions(
        [
          {
            text: "Combined assertion citing both a fact and a legal rule.",
            chunkIds: [matterChunkId, authorityChunkId],
          },
        ],
        { factChunkIds: new Set([matterChunkId]), authorityChunkIds: authorityChunkIdSet },
      );
      expect(classified).toHaveLength(2);
      const factEntry = classified.find((c) => c.provenanceClass === "FACT_SOURCE")!;
      const authorityEntry = classified.find((c) => c.provenanceClass === "LEGAL_AUTHORITY")!;
      expect(factEntry.chunkIds).toEqual([matterChunkId]);
      expect(authorityEntry.chunkIds).toEqual([authorityChunkId]);

      const generated = await generateDraft({
        db,
        organizationId: orgId,
        matterId,
        userId: ownerId,
        title: "Injunction Motion Summary",
        draftType: "memo",
        instructions: "Summarize the injunction standard and the delivery schedule dispute fact.",
        documentIds: [matterDocId],
        ai: new MockAIProvider(),
      });
      expect(generated.legalAuthorityIds).toContain(statuteAuthorityId);

      const sourceAssertions = (generated.version.sourceAssertions ??
        []) as ClassifiedDraftAssertion[];
      for (const assertion of sourceAssertions) {
        if (assertion.provenanceClass === "LEGAL_AUTHORITY") {
          expect(assertion.chunkIds.every((id) => authorityChunkIdSet.has(id))).toBe(true);
        } else {
          expect(assertion.chunkIds.every((id) => matterChunkIdSet.has(id))).toBe(true);
        }
      }
    });

    it("marks usedLegalAuthority true once an authority is saved to the matter", async () => {
      const answer = await askNyayaAboutMatter({
        db,
        retriever: new PostgresHybridRetriever(db, new MockEmbeddingProvider()),
        organizationId: orgId,
        matterId,
        userId: ownerId,
        question:
          "What standard governs a preliminary injunction under Synthetic Jurisdiction Code § 100?",
        ai: new MockAIProvider(),
        embeddings: new MockEmbeddingProvider(),
      });
      expect(answer.doctrineQuestion).toBe(true);
      expect(answer.usedLegalAuthority).toBe(true);
    });
  });

  describe("security", () => {
    it("denies the outsider matter access and cross-org session lookup", async () => {
      await expect(
        requireMatterAccess(db, { userId: outsiderId, matterId, minAccess: "read" }),
      ).rejects.toBeInstanceOf(AuthorizationError);

      const crossOrgSession = await getResearchSession({
        db,
        organizationId: otherOrgId,
        sessionId: researchSessionId,
      });
      expect(crossOrgSession).toBeNull();

      const ownOrgSession = await getResearchSession({
        db,
        organizationId: orgId,
        sessionId: researchSessionId,
      });
      expect(ownOrgSession?.id).toBe(researchSessionId);
    });

    it("denies a cross-org matter authority save via requireMatterAccess before the domain call runs", async () => {
      await expect(
        requireMatterAccess(db, { userId: otherOwnerId, matterId, minAccess: "edit" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        requireMatterAccess(db, { userId: ownerId, matterId: otherMatterId, minAccess: "edit" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  describe("jobs", () => {
    it("InMemoryJobDispatcher enforces idempotency for research.ingest_authority", async () => {
      let runs = 0;
      const dispatcher = new InMemoryJobDispatcher({
        "research.ingest_authority": async (payload) => {
          runs += 1;
          return {
            ok: true,
            message: "authority ingested",
            data: { sourceExternalId: payload.sourceExternalId },
          };
        },
      });
      const payload = {
        idempotencyKey: `research_ingest:${SYNTHETIC_SOURCE_PROVIDER}:acme-v-contoso-999-f3d-1`,
        sourceProvider: SYNTHETIC_SOURCE_PROVIDER,
        sourceExternalId: "acme-v-contoso-999-f3d-1",
      };
      await dispatcher.dispatch("research.ingest_authority", payload);
      await dispatcher.dispatch("research.ingest_authority", payload);
      expect(runs).toBe(1);
      expect(dispatcher.processed).toHaveLength(1);
    });
  });
});
