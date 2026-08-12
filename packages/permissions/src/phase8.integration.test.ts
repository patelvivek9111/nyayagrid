import { describe, expect, it, beforeAll, afterAll } from "vitest";
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
  legalAuthorities,
  legalAuthorityChunks,
  studentCaseChunks,
  studentSavedItems,
} from "@nyayagrid/database";
import type { StudentCase, GuideDocument } from "@nyayagrid/database";
import {
  DevelopmentMalwareScanner,
  InMemoryStorageProvider,
  processDocumentPipeline,
  sha256Buffer,
} from "@nyayagrid/documents";
import { storageKeyForOrganization } from "@nyayagrid/permissions";
import { MockAIProvider, MockEmbeddingProvider } from "@nyayagrid/ai";
import { InMemoryJobDispatcher } from "@nyayagrid/jobs";
import {
  importAuthority,
  syntheticStatuteAuthority,
  SYNTHETIC_SOURCE_PROVIDER,
} from "@nyayagrid/research";
import {
  // Professor (Student Workspace)
  ingestStudentCase,
  generateCaseBrief,
  askProfessor,
  compareStudentCases,
  saveItem,
  assertStudentCaseOwnership,
  StudentAccessError,
  NO_AUTHORITY_LIMITATION,
  // Guide (Public Workspace)
  ingestGuideDocument,
  explainGuideDocument,
  askGuide,
  createSituation,
  addSituationEvent,
  linkDocument,
  generateConsultationPacket,
  assertGuideDocumentOwnership,
  GuideAuthorizationError,
} from "@nyayagrid/workspaces";

const runDbTests = process.env.RUN_DB_TESTS === "1";

/**
 * Deletes every legal_authorities row tagged with the shared research package's synthetic-fixture
 * provider marker (cascading to its chunks/versions). Safe to call at any time in this test file:
 * SYNTHETIC_SOURCE_PROVIDER is only ever used by test fixtures, never real ingested authorities.
 */
async function removeSyntheticAuthorities(db: ReturnType<typeof createDb>): Promise<void> {
  await db
    .delete(legalAuthorities)
    .where(eq(legalAuthorities.sourceProvider, SYNTHETIC_SOURCE_PROVIDER));
}

/**
 * Fictional judicial opinion for studentA's Professor library. The majority holding turns on
 * "actual receipt" language that never appears in the dissent, so retrieval/mock scoring reliably
 * distinguishes the two opinion parts, and TORRES, J., dissenting. is heading-shaped enough for
 * `detectOpinionPartHeading` to label it.
 */
const CASE_A_TITLE = "Rivera v. Hollis Properties";
const CASE_A_CITATION = "12 Synth. App. 45";
const CASE_A_COURT = "Synthetic Court of Appeals";
const CASE_A_DECISION_DATE = "2022-03-01";
const CASE_A_TEXT = [
  "Rivera v. Hollis Properties, 12 Synth. App. 45 (Synthetic Ct. App. 2022).",
  "",
  "Ms. Rivera remained in possession of the leased unit after the stated notice period expired. Hollis Properties argued the lease terminated automatically once that period ran, and re-let the unit before the dispute reached this court.",
  "",
  "A notice to vacate is effective only upon actual receipt by the tenant, and the record shows Ms. Rivera never received actual notice before the disputed date. The lease had therefore not been terminated when Hollis Properties re-let the unit, and we affirm judgment for Ms. Rivera.",
  "",
  "TORRES, J., dissenting.",
  "",
  "I would hold that mailing alone starts the clock; nothing in this lease required Ms. Rivera to personally accept an envelope before the notice took hold. I would reverse and enter judgment for Hollis Properties.",
].join("\n\n");

/** A second, unrelated case in studentA's own library, used only to exercise compareStudentCases. */
const CASE_A2_TITLE = "Simmons v. Oakview Rentals";
const CASE_A2_CITATION = "18 Synth. App. 210";
const CASE_A2_DECISION_DATE = "2023-05-01";
const CASE_A2_TEXT = [
  "Simmons v. Oakview Rentals, 18 Synth. App. 210 (Synthetic Ct. App. 2023).",
  "",
  "Mr. Simmons vacated within a week of Oakview Rentals mailing a notice to quit, then argued the notice was never effective because he did not personally receive it.",
  "",
  "This lease's own notice clause expressly adopts a mailing rule: notice under this lease is effective on the date it is mailed, not the date of actual receipt. Because Oakview Rentals mailed the notice as the clause required, the notice was effective, and we affirm judgment for Oakview Rentals.",
].join("\n\n");

const HOLDING_QUESTION =
  "According to the majority opinion, is a notice to vacate effective only upon actual receipt by the tenant?";
const HYPOTHETICAL_QUESTION =
  "Hypothetically, if Ms. Rivera had personally signed for the notice by mail on the day it was sent, would that hypothetical change the outcome from the court's actual holding?";
// Deliberately paraphrases the unique language of subsection (c) — "The court shall state the
// findings that support the grant or denial of relief under this section." — rather than the
// "preliminary injunction ... likelihood of success ... irreparable harm" language shared almost
// verbatim by @nyayagrid/research's syntheticCaseAuthority fixture. Other integration tests in
// this shared dev database import that case fixture too and don't always clean it up, so a query
// using the shared wording can have its naive vector search nearest-neighbors won by that
// unrelated leftover case chunk instead of our own imported statute.
const AUTHORITY_QUESTION =
  "Under Synthetic Jurisdiction Code § 100, must a court state the findings that support the grant or denial of relief?";

/** Confidential professional matter content that Professor and Guide must never be able to reach. */
const MATTER_DOCUMENT_CONTENT = [
  "PROFESSIONAL SERVICES AGREEMENT - CONFIDENTIAL",
  "This is a confidential professional matter document. It must never be retrievable from the Student Workspace or the Public Workspace under any circumstances.",
  "Vendor shall deliver monthly status reports summarizing work performed under this engagement.",
].join("\n\n");

/**
 * Kept as a single short paragraph so the mock document-explanation routine's "first chunk"
 * lookup sees the explicit date. Deliberately avoids any single-token dollar amount (e.g.
 * "$1,500") — the Guide quote validator rejects quotes under two words as "too short to verify",
 * which would otherwise inflate rejectedQuoteCount for reasons unrelated to date extraction.
 */
const GUIDE_LEASE_TEXT =
  "This residential lease begins on January 1, 2026 and continues on a month-to-month basis unless renewed in writing at least 30 days before the end date. Rent is due on the first day of each month. Either party may end this lease early only as permitted by applicable law.";

const JURISDICTION_SENSITIVE_QUESTION =
  "My landlord gave me a written notice to vacate — how much advance notice is legally required before I have to move out?";

describe.runIf(runDbTests)("phase 8 professor and guide workspaces integration", () => {
  const db = createDb(process.env.DATABASE_URL);
  const suffix = Date.now().toString(36);
  const storage = new InMemoryStorageProvider();
  const ai = new MockAIProvider();
  const embeddings = new MockEmbeddingProvider();

  let studentAId = "";
  let studentBId = "";
  let guideAId = "";
  let guideBId = "";
  let proOwnerId = "";
  let orgId = "";
  let matterId = "";
  let matterChunkIds: string[] = [];

  // Populated by the first Professor test, reused by later Professor tests.
  let caseA: StudentCase;
  let caseA2: StudentCase;
  let caseABriefRecordId = "";
  let professorConversationId = "";

  // Populated by the first Guide test, reused by later Guide tests.
  let guideDocA: GuideDocument;

  beforeAll(async () => {
    const [studentA] = await db
      .insert(users)
      .values({
        authSubject: `p8_studentA_${suffix}`,
        email: `p8_studentA_${suffix}@example.nyayagrid.local`,
        name: "Student A",
      })
      .returning();
    const [studentB] = await db
      .insert(users)
      .values({
        authSubject: `p8_studentB_${suffix}`,
        email: `p8_studentB_${suffix}@example.nyayagrid.local`,
        name: "Student B",
      })
      .returning();
    const [guideA] = await db
      .insert(users)
      .values({
        authSubject: `p8_guideA_${suffix}`,
        email: `p8_guideA_${suffix}@example.nyayagrid.local`,
        name: "Guide A",
      })
      .returning();
    const [guideB] = await db
      .insert(users)
      .values({
        authSubject: `p8_guideB_${suffix}`,
        email: `p8_guideB_${suffix}@example.nyayagrid.local`,
        name: "Guide B",
      })
      .returning();
    const [proOwner] = await db
      .insert(users)
      .values({
        authSubject: `p8_pro_owner_${suffix}`,
        email: `p8_pro_owner_${suffix}@example.nyayagrid.local`,
        name: "Professional Owner",
      })
      .returning();
    studentAId = studentA!.id;
    studentBId = studentB!.id;
    guideAId = guideA!.id;
    guideBId = guideB!.id;
    proOwnerId = proOwner!.id;

    // A professional org/matter/document, used only to prove Professor and Guide can never reach
    // document_chunks — neither workspace's package even imports the professional schema, but this
    // exercises the guarantee end to end against real rows.
    const org = await createOrganizationWithDefaults(db, {
      name: `P8 Firm ${suffix}`,
      slug: `p8-firm-${suffix}`,
      type: "firm",
      ownerUserId: proOwnerId,
    });
    orgId = org.organization.id;
    const [client] = await db
      .insert(clients)
      .values({
        organizationId: orgId,
        clientType: "individual",
        displayName: "P8 Confidential Client",
        createdByUserId: proOwnerId,
      })
      .returning();
    const [matter] = await db
      .insert(matters)
      .values({
        organizationId: orgId,
        clientId: client!.id,
        matterNumber: `P8-${suffix}`,
        title: "Confidential Matter",
        createdByUserId: proOwnerId,
      })
      .returning();
    matterId = matter!.id;
    await db.insert(matterMembers).values({
      organizationId: orgId,
      matterId,
      userId: proOwnerId,
      access: "manage",
    });

    const documentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const body = Buffer.from(MATTER_DOCUMENT_CONTENT);
    const key = storageKeyForOrganization({
      organizationId: orgId,
      documentId,
      versionId,
      filename: "services-agreement.txt",
    });
    await storage.putObject({ key, body, contentType: "text/plain" });
    await db.insert(documents).values({
      id: documentId,
      organizationId: orgId,
      matterId,
      title: "services-agreement.txt",
      createdByUserId: proOwnerId,
      processingState: "uploaded",
    });
    await db.insert(documentVersions).values({
      id: versionId,
      documentId,
      organizationId: orgId,
      versionNumber: 1,
      storageKey: key,
      contentType: "text/plain",
      byteSize: body.length,
      sha256: sha256Buffer(body),
      originalFilename: "services-agreement.txt",
      uploadedByUserId: proOwnerId,
    });
    const pipelineResult = await processDocumentPipeline(
      {
        db,
        storage,
        scanner: new DevelopmentMalwareScanner(),
        embeddings: new MockEmbeddingProvider(),
      },
      { organizationId: orgId, matterId, documentId, documentVersionId: versionId },
    );
    if (!pipelineResult.ok) {
      throw new Error(
        `Failed to process the confidential matter document: ${pipelineResult.message}`,
      );
    }
    const chunkRows = await db
      .select({ id: documentChunks.id })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId));
    matterChunkIds = chunkRows.map((row) => row.id);
    expect(matterChunkIds.length).toBeGreaterThan(0);

    // The shared legal_authority_chunks corpus is global (not scoped to this test file) and other
    // integration suites (e.g. phase6) import synthetic fixtures without always cleaning them up.
    // Guide's naive vector search has no similarity threshold, so it returns *some* authority
    // chunk as a source as soon as the corpus is non-empty — regardless of query relevance. Start
    // from a guaranteed-empty corpus so the "no authority available" guardrail test below is
    // actually exercising the no-authority branch, not accidentally riding on leftover fixtures.
    await removeSyntheticAuthorities(db);
  }, 120000);

  afterAll(async () => {
    // Belt-and-suspenders: remove anything this file imported, in case an assertion failure above
    // short-circuited a test's own local cleanup before it reached its `finally`.
    await removeSyntheticAuthorities(db);
  });

  describe("professor (student workspace)", () => {
    it("ingests studentA's case and generates a case brief whose section sources are all owned by studentA", async () => {
      const ingested = await ingestStudentCase({
        db,
        userId: studentAId,
        title: CASE_A_TITLE,
        content: CASE_A_TEXT,
        citation: CASE_A_CITATION,
        court: CASE_A_COURT,
        decisionDate: CASE_A_DECISION_DATE,
        embeddings,
      });
      expect(ingested.skipped).toBe(false);
      expect(ingested.chunkCount).toBeGreaterThan(0);
      expect(ingested.labelledOpinionParts).toContain("dissent");
      caseA = ingested.case;

      const briefResult = await generateCaseBrief({ db, userId: studentAId, caseId: caseA.id, ai });
      caseABriefRecordId = briefResult.record.id;

      expect(briefResult.record.userId).toBe(studentAId);
      expect(briefResult.record.caseId).toBe(caseA.id);
      expect(briefResult.record.caseVersionId).toBeTruthy();
      // The dissent is reported separately from the majority-only sections, never inside them.
      expect(briefResult.sectionSources.dissent?.[0]).toBeDefined();

      const ownedChunkRows = await db
        .select({ id: studentCaseChunks.id })
        .from(studentCaseChunks)
        .where(
          and(eq(studentCaseChunks.caseId, caseA.id), eq(studentCaseChunks.userId, studentAId)),
        );
      const ownedChunkIds = new Set(ownedChunkRows.map((row) => row.id));

      const citedChunkIds = Object.values(briefResult.sectionSources).flatMap((entries) =>
        entries.map((entry) => entry.chunkId),
      );
      expect(citedChunkIds.length).toBeGreaterThan(0);
      for (const chunkId of citedChunkIds) {
        expect(ownedChunkIds.has(chunkId)).toBe(true);
      }
    });

    it("askProfessor with a caseId answers using the uploaded case", async () => {
      const result = await askProfessor({
        db,
        userId: studentAId,
        caseId: caseA.id,
        question: HOLDING_QUESTION,
        ai,
        embeddings,
        includeAuthority: false,
      });

      expect(result.caseHitCount).toBeGreaterThan(0);
      expect(result.grounded).toBe(true);
      expect(
        result.sources.some(
          (source) => source.provenance === "UPLOADED_CASE" && source.caseId === caseA.id,
        ),
      ).toBe(true);
      professorConversationId = result.conversation.id;
    });

    it("distinguishes a hypothetical question from the case's actual holding", async () => {
      const result = await askProfessor({
        db,
        userId: studentAId,
        conversationId: professorConversationId,
        caseId: caseA.id,
        question: HYPOTHETICAL_QUESTION,
        ai,
        embeddings,
        includeAuthority: false,
      });

      // The hypothetical is still grounded in the case the student actually uploaded — Professor
      // never invents a new fact pattern's holding out of thin air.
      expect(result.grounded).toBe(true);
      expect(
        result.sources.some(
          (source) => source.provenance === "UPLOADED_CASE" && source.caseId === caseA.id,
        ),
      ).toBe(true);
      // With no legal authority retrieved, the answer is explicitly flagged as not stating a
      // doctrinal rule: a hypothetical "what if" is never presented with the same certainty as the
      // case's own actual holding.
      expect(result.answer.legalAuthoritySources).toHaveLength(0);
      expect(result.answer.limitations).toContain(NO_AUTHORITY_LIMITATION);
    });

    it("compares two of studentA's own uploaded cases, citing only chunks from those two cases", async () => {
      const ingestedA2 = await ingestStudentCase({
        db,
        userId: studentAId,
        title: CASE_A2_TITLE,
        content: CASE_A2_TEXT,
        citation: CASE_A2_CITATION,
        court: CASE_A_COURT,
        decisionDate: CASE_A2_DECISION_DATE,
        embeddings,
      });
      caseA2 = ingestedA2.case;

      const { record, comparison, sources, validation } = await compareStudentCases({
        db,
        userId: studentAId,
        caseAId: caseA.id,
        caseBId: caseA2.id,
        ai,
      });

      expect(record.userId).toBe(studentAId);
      expect(record.caseAId).toBe(caseA.id);
      expect(record.caseBId).toBe(caseA2.id);
      expect(validation.schemaValid).toBe(true);
      expect(comparison.limitations.join(" ")).toMatch(/study aid/i);

      const caseAChunkRows = await db
        .select({ id: studentCaseChunks.id })
        .from(studentCaseChunks)
        .where(eq(studentCaseChunks.caseId, caseA.id));
      const caseA2ChunkRows = await db
        .select({ id: studentCaseChunks.id })
        .from(studentCaseChunks)
        .where(eq(studentCaseChunks.caseId, caseA2.id));
      const allowedChunkIds = new Set([
        ...caseAChunkRows.map((row) => row.id),
        ...caseA2ChunkRows.map((row) => row.id),
      ]);
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(source.chunkId && allowedChunkIds.has(source.chunkId)).toBe(true);
      }
    });

    it("saves a generated item to studentA's own library", async () => {
      const saved = await saveItem({
        db,
        userId: studentAId,
        input: {
          itemType: "case_brief",
          title: `Brief: ${CASE_A_TITLE}`,
          content: "Saved from the generated case brief.",
          ref: { caseId: caseA.id, briefId: caseABriefRecordId },
        },
      });
      expect(saved.userId).toBe(studentAId);
      expect(saved.itemType).toBe("case_brief");

      const rows = await db
        .select()
        .from(studentSavedItems)
        .where(eq(studentSavedItems.userId, studentAId));
      expect(rows.some((row) => row.id === saved.id)).toBe(true);
    });

    it("studentB cannot read studentA's case", async () => {
      await expect(assertStudentCaseOwnership(db, studentBId, caseA.id)).rejects.toBeInstanceOf(
        StudentAccessError,
      );
      await expect(
        generateCaseBrief({ db, userId: studentBId, caseId: caseA.id, ai }),
      ).rejects.toBeInstanceOf(StudentAccessError);
      await expect(
        askProfessor({
          db,
          userId: studentBId,
          caseId: caseA.id,
          question: "What happened in this case?",
          ai,
          embeddings,
        }),
      ).rejects.toBeInstanceOf(StudentAccessError);
    });

    it("never returns professional document_chunks as a Professor source", async () => {
      const result = await askProfessor({
        db,
        userId: studentAId,
        caseId: caseA.id,
        question:
          "What does the confidential professional services agreement say about monthly status reports?",
        ai,
        embeddings,
        includeAuthority: false,
      });

      const sourceChunkIds = new Set(
        result.sources.map((source) => source.chunkId).filter((id): id is string => Boolean(id)),
      );
      for (const chunkId of matterChunkIds) {
        expect(sourceChunkIds.has(chunkId)).toBe(false);
      }

      const ownedChunkRows = await db
        .select({ id: studentCaseChunks.id })
        .from(studentCaseChunks)
        .where(eq(studentCaseChunks.caseId, caseA.id));
      const ownedChunkIds = new Set(ownedChunkRows.map((row) => row.id));
      for (const source of result.sources) {
        if (source.provenance === "UPLOADED_CASE" && source.chunkId) {
          expect(ownedChunkIds.has(source.chunkId)).toBe(true);
        }
      }
    });

    it("can use the shared legal authority corpus for a doctrinal question", async () => {
      // Imported and torn down entirely within this test so the corpus is guaranteed empty again
      // before the Guide describe block runs its "no authority available" guardrail test below.
      const importResult = await importAuthority({
        db,
        embeddings: new MockEmbeddingProvider(),
        input: syntheticStatuteAuthority,
      });
      const localAuthorityId = importResult.authority.id;
      try {
        const result = await askProfessor({
          db,
          userId: studentAId,
          question: AUTHORITY_QUESTION,
          ai,
          embeddings,
        });

        expect(result.grounded).toBe(true);
        expect(result.authorityChunkCount).toBeGreaterThan(0);
        expect(
          result.answer.legalAuthoritySources.some(
            (source) => source.authorityId === localAuthorityId,
          ),
        ).toBe(true);
      } finally {
        await removeSyntheticAuthorities(db);
      }
    });
  });

  describe("guide (public workspace)", () => {
    it("ingests a guide document and explains it using only dates explicitly written in the text", async () => {
      const ingestResult = await ingestGuideDocument({
        db,
        embeddings,
        userId: guideAId,
        title: "My Residential Lease",
        documentKind: "lease",
        content: GUIDE_LEASE_TEXT,
      });
      expect(ingestResult.processingState).toBe("ready");
      expect(ingestResult.chunkCount).toBeGreaterThan(0);
      guideDocA = ingestResult.document;

      const { explanation, record, rejectedQuoteCount } = await explainGuideDocument({
        db,
        documentId: guideDocA.id,
        userId: guideAId,
        ai,
      });

      expect(record.userId).toBe(guideAId);
      expect(rejectedQuoteCount).toBe(0);
      // Exactly the one date explicitly written in the text — nothing calculated or inferred.
      expect(explanation.explicitDates).toHaveLength(1);
      expect(explanation.explicitDates[0]?.quote).toBe("January 1, 2026");
      expect(record.explicitDates).toHaveLength(1);
      expect(record.explicitDates[0]?.rawText).toBe("January 1, 2026");
      // Tolerant of local-timezone rendering of a date-only string; never asserts the derived value,
      // only that the source string round-trips to on/around the date actually written.
      expect(record.explicitDates[0]?.isoDate).toMatch(/^202[56]-(01-01|12-31)$/);
    });

    it("flags a jurisdiction caveat when asked a jurisdiction-sensitive question with no jurisdiction given", async () => {
      const result = await askGuide({
        db,
        userId: guideAId,
        question: JURISDICTION_SENSITIVE_QUESTION,
        ai,
        embeddings,
      });

      expect(result.jurisdictionKnown).toBe(false);
      expect(result.jurisdictionCaveat).toBeTruthy();
      expect(result.disclaimer.toLowerCase()).toContain("jurisdiction");
    });

    it("creates a situation, records a user-provided event, links the document, and generates a consultation packet", async () => {
      const situation = await createSituation(db, guideAId, {
        title: "Notice to vacate from Hollis Properties",
        issueCategory: "housing",
        desiredOutcome: "Understand my rights and options before responding",
      });

      const event = await addSituationEvent(db, {
        situationId: situation.id,
        userId: guideAId,
        input: {
          title: "Received notice to vacate",
          eventDate: "2026-01-15",
          guideDocumentId: guideDocA.id,
        },
      });
      expect(event.sourceLabel).toBe("user_provided");

      await linkDocument(db, {
        situationId: situation.id,
        documentId: guideDocA.id,
        userId: guideAId,
      });

      const { packet, record } = await generateConsultationPacket({
        db,
        situationId: situation.id,
        userId: guideAId,
        ai,
        embeddings,
      });

      expect(record.userId).toBe(guideAId);
      expect(packet.questionsToAsk.length).toBeGreaterThan(0);
      expect(packet.keyEvents.some((item) => item.title === "Received notice to vacate")).toBe(
        true,
      );
      expect(record.packet.limitations.join(" ")).toMatch(/does not reach any legal conclusion/i);
    });

    it("never claims a clause is illegal when asked directly, without supporting legal authority", async () => {
      // Phrased as a declarative claim (not just a question) so the mock's echoed answer forms a
      // sentence matching ILLEGALITY_CLAIM_PATTERN ("this ... clause ... is ... illegal."),
      // actually exercising enforceIllegalityGuardrail rather than trivially passing because the
      // mock never generates illegality language on its own.
      const result = await askGuide({
        db,
        userId: guideAId,
        documentId: guideDocA.id,
        question: "This early termination clause in this lease is illegal.",
        ai,
        embeddings,
      });

      // No LEGAL_AUTHORITY source was retrieved for this question, so the guardrail must have
      // fired and stripped the claim — confirm both the stripped answer and the recorded
      // limitation note.
      expect(result.sources.some((s) => s.class === "LEGAL_AUTHORITY")).toBe(false);
      expect(result.answer.toLowerCase()).not.toMatch(/\b(illegal|unenforceable|void)\b/);
      expect(result.limitations.join(" ")).toMatch(
        /removed because it lacked supporting legal authority/i,
      );
    });

    it("guideB cannot access guideA's documents", async () => {
      await expect(
        assertGuideDocumentOwnership(db, { documentId: guideDocA.id, userId: guideBId }),
      ).rejects.toBeInstanceOf(GuideAuthorizationError);

      await expect(
        askGuide({
          db,
          userId: guideBId,
          documentId: guideDocA.id,
          question: "What does this document say?",
          ai,
          embeddings,
        }),
      ).rejects.toBeInstanceOf(GuideAuthorizationError);
    });

    it("never returns studentA's case chunks as a Guide source", async () => {
      const result = await askGuide({
        db,
        userId: guideAId,
        documentId: guideDocA.id,
        question: `${HOLDING_QUESTION} ${GUIDE_LEASE_TEXT}`,
        ai,
        embeddings,
      });

      const studentChunkRows = await db
        .select({ id: studentCaseChunks.id })
        .from(studentCaseChunks)
        .where(eq(studentCaseChunks.caseId, caseA.id));
      const studentChunkIds = new Set(studentChunkRows.map((row) => row.id));

      const guideSourceChunkIds = result.sources
        .map((source) => source.chunkId)
        .filter((id): id is string => Boolean(id));
      for (const chunkId of guideSourceChunkIds) {
        expect(studentChunkIds.has(chunkId)).toBe(false);
      }
    });

    it("never returns professional matter document_chunks as a Guide source", async () => {
      const result = await askGuide({
        db,
        userId: guideAId,
        documentId: guideDocA.id,
        question: `${GUIDE_LEASE_TEXT} monthly status reports summarizing work performed under this engagement`,
        ai,
        embeddings,
      });

      const guideSourceChunkIds = result.sources
        .map((source) => source.chunkId)
        .filter((id): id is string => Boolean(id));
      for (const chunkId of matterChunkIds) {
        expect(guideSourceChunkIds.includes(chunkId)).toBe(false);
      }
    });
  });

  describe("shared", () => {
    it("guideA can also search the shared legal authority corpus", async () => {
      // Imported locally (the Guide describe block above already tore down any prior import), and
      // cleaned up again afterward since this is the last test in the file to need it.
      const importResult = await importAuthority({
        db,
        embeddings: new MockEmbeddingProvider(),
        input: syntheticStatuteAuthority,
      });
      const localAuthorityId = importResult.authority.id;
      try {
        const authorityChunkRows = await db
          .select({ id: legalAuthorityChunks.id })
          .from(legalAuthorityChunks)
          .where(eq(legalAuthorityChunks.authorityId, localAuthorityId));
        const authorityChunkIds = new Set(authorityChunkRows.map((row) => row.id));

        const result = await askGuide({
          db,
          userId: guideAId,
          question: AUTHORITY_QUESTION,
          ai,
          embeddings,
        });

        const guideAuthorityChunkIds = result.sources
          .filter((source) => source.class === "LEGAL_AUTHORITY")
          .map((source) => source.authorityChunkId)
          .filter((id): id is string => Boolean(id));
        expect(guideAuthorityChunkIds.some((id) => authorityChunkIds.has(id))).toBe(true);
      } finally {
        await removeSyntheticAuthorities(db);
      }
    });

    it("InMemoryJobDispatcher enforces idempotency for student.ingest_case", async () => {
      let runs = 0;
      const dispatcher = new InMemoryJobDispatcher({
        "student.ingest_case": async (payload) => {
          runs += 1;
          return { ok: true, message: "student case ingested", data: { caseId: payload.caseId } };
        },
      });
      const payload = {
        userId: studentAId,
        caseId: caseA.id,
        idempotencyKey: `student_ingest_case:${caseA.id}`,
      };
      await dispatcher.dispatch("student.ingest_case", payload);
      await dispatcher.dispatch("student.ingest_case", payload);
      expect(runs).toBe(1);
      expect(dispatcher.processed).toHaveLength(1);
    });

    it("InMemoryJobDispatcher enforces idempotency for guide.ingest_document", async () => {
      let runs = 0;
      const dispatcher = new InMemoryJobDispatcher({
        "guide.ingest_document": async (payload) => {
          runs += 1;
          return {
            ok: true,
            message: "guide document ingested",
            data: { documentId: payload.documentId },
          };
        },
      });
      const payload = {
        userId: guideAId,
        documentId: guideDocA.id,
        idempotencyKey: `guide_ingest_document:${guideDocA.id}`,
      };
      await dispatcher.dispatch("guide.ingest_document", payload);
      await dispatcher.dispatch("guide.ingest_document", payload);
      expect(runs).toBe(1);
      expect(dispatcher.processed).toHaveLength(1);
    });
  });
});
