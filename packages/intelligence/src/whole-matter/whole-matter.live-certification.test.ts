/**
 * Deepening Pass 7 — authorized LOCAL whole-matter live certification.
 * RUN_DB_TESTS=1 DATABASE_URL=postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid
 * Production Neon / CourtListener: unused. Schema migration: NONE.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  documents,
  graphEdges,
  graphNodes,
  legalAuthorities,
  matterAuthorities,
  matterFacts,
  matters,
  matterEntities,
  matterMembers,
  memberships,
  timelineEvents,
  tasks,
  deadlineCandidates,
  users,
} from "@nyayagrid/database";
import { AuthorizationError } from "@nyayagrid/permissions";
import {
  addCivilClaimElement,
  createCivilClaim,
  createCivilDefense,
  createCivilEvidenceItem,
  createCivilPleading,
  linkCivilAuthority,
  linkCivilEvidence,
  linkCivilFact,
} from "../civil/postgres";
import {
  createDiscoveryDeficiency,
  createDiscoveryMeetAndConferIssue,
  createDiscoveryProduction,
  createDiscoveryRequestItem,
  createDiscoveryRequestSet,
  createDiscoveryResponse,
} from "../discovery-ledger/postgres";
import { materializeDiscoveryGraph } from "../discovery-ledger/graph-materialize";
import { materializeVerifiedGraph } from "../graph/materialize";
import {
  createMatterCommunication,
  createMatterMotion,
  linkMatterCommunicationTarget,
  linkMatterMotionTarget,
  linkMotionDocument,
  materializeMotionsCommunicationsGraph,
  materializeMotionsCommunicationsTimeline,
} from "../motions-communications/index";
import {
  answerWholeMatterQuestion,
  formatWholeMatterAnswer,
  isWholeMatterAskQuestion,
  loadWholeMatterIntelligence,
  planWholeMatterGraph,
} from "./index";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const provenance = { extractionOrigin: "human" as const, humanEntered: true };

describe.runIf(runDbTests)("Pass 7 whole-matter live certification (local DB)", () => {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  const suffix = `d7live_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  let guestRoleId = "";
  const timings: Record<string, number> = {};

  beforeAll(async () => {
    const host = new URL(
      process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
    ).host;
    expect(host).toMatch(/localhost:5433|127\.0\.0\.1:5433/);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `d7_owner_${suffix}`,
        email: `d7_owner_${suffix}@example.nyayagrid.local`,
        name: "D7 Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `d7_out_${suffix}`,
        email: `d7_out_${suffix}@example.nyayagrid.local`,
        name: "D7 Outsider",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `d7_guest_${suffix}`,
        email: `d7_guest_${suffix}@example.nyayagrid.local`,
        name: "D7 Guest",
      })
      .returning();
    ids.owner = owner!.id;
    ids.outsider = outsider!.id;
    ids.guest = guest!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `D7 Firm ${suffix}`,
      slug: `d7-firm-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `D7 Other ${suffix}`,
      slug: `d7-other-${suffix}`,
      type: "firm",
      ownerUserId: ids.outsider!,
    });
    ids.orgA = orgA.organization.id;
    ids.orgB = orgB.organization.id;
    guestRoleId = orgA.roleIdByKey.get("client_guest")!;

    await db.insert(memberships).values({
      organizationId: ids.orgA!,
      userId: ids.guest!,
      roleId: guestRoleId,
      status: "active",
    });

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgA!,
        displayName: "River Supply Client",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgB!,
        displayName: "Foreign Client",
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
        title: `Whole-Matter Supply Dispute ${suffix}`,
        matterNumber: `D7-${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matterA2] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: clientA!.id,
        title: `Sibling Matter ${suffix}`,
        matterNumber: `D7S-${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgB!,
        clientId: clientB!.id,
        title: `Foreign Matter ${suffix}`,
        matterNumber: `D7F-${suffix}`,
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
        matterId: ids.matterA!,
        userId: ids.guest!,
        access: "read",
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

    async function entity(displayName: string, organizationId: string, matterId: string, userId: string) {
      const [row] = await db
        .insert(matterEntities)
        .values({
          organizationId,
          matterId,
          entityType: "organization",
          displayName,
          normalizedName: displayName.toLowerCase(),
          status: "approved",
          origin: "manual",
          createdByUserId: userId,
        })
        .returning();
      return row!.id;
    }

    ids.plaintiff = await entity("River Supply Co.", ids.orgA!, ids.matterA!, ids.owner!);
    ids.defendant = await entity("Acme Parts LLC", ids.orgA!, ids.matterA!, ids.owner!);
    ids.foreignEntity = await entity("Foreign Party", ids.orgB!, ids.matterB!, ids.outsider!);

    async function doc(title: string, organizationId: string, matterId: string, userId: string) {
      const [row] = await db
        .insert(documents)
        .values({ organizationId, matterId, title, createdByUserId: userId })
        .returning();
      return row!.id;
    }

    ids.docMotion = await doc(`Motion to Compel ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    ids.docExhibit = await doc(`Exhibit A cure notice ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    ids.docLog = await doc(`Delivery log ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    ids.docOpposition = await doc(`Opposition ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    ids.docReply = await doc(`Reply ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    ids.docOrder = await doc(`Order granted in part ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    ids.docMac = await doc(`MAC letter ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    ids.docFollow = await doc(`Follow-up letter ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    ids.docProd = await doc(`Incomplete production cover ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    ids.docB = await doc(`Foreign Doc ${suffix}`, ids.orgB!, ids.matterB!, ids.outsider!);

    // Hundreds of source/document references for performance realism.
    for (let i = 0; i < 220; i++) {
      await doc(`Source ref ${i} ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    }

    const [factNotice] = await db
      .insert(matterFacts)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        factKey: `notice_${suffix}`,
        label: "Cure notice sent",
        value: "River sent a cure notice on 2025-11-02.",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.factNotice = factNotice!.id;

    const [factLog] = await db
      .insert(matterFacts)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        factKey: `log_${suffix}`,
        label: "Delivery log empty",
        value: "Acme delivery log shows no outbound cure-notice transmission.",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.factLog = factLog!.id;

    await db.insert(timelineEvents).values({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      title: "Cure notice sent",
      eventType: "fact_event",
      eventDate: new Date("2025-11-02T12:00:00.000Z"),
      status: "approved",
      origin: "manual",
      createdByUserId: ids.owner!,
      dedupeKey: `d7-fact-notice-${suffix}`,
    });

    const [taskOpen] = await db
      .insert(tasks)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `Supplemental production follow-up ${suffix}`,
        status: "open",
        dueAt: new Date("2025-12-02T23:59:00.000Z"),
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.taskOpen = taskOpen!.id;

    const [taskDone] = await db
      .insert(tasks)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `MAC letter filed ${suffix}`,
        status: "completed",
        dueAt: new Date("2025-09-21T23:59:00.000Z"),
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.taskDone = taskDone!.id;

    const [commTask] = await db
      .insert(tasks)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `MAC follow-up task ${suffix}`,
        status: "open",
        dueAt: new Date("2025-10-10T23:59:00.000Z"),
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.commTask = commTask!.id;

    const [deadline] = await db
      .insert(deadlineCandidates)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: "Supplemental production due (order)",
        description: "Explicit order deadline",
        dueAt: new Date("2025-12-02T23:59:00.000Z"),
        datePrecision: "exact",
        dateKind: "explicit",
        status: "approved",
        confidence: "high",
        origin: "manual",
        createdByUserId: ids.owner!,
        approvedByUserId: ids.owner!,
        approvedAt: new Date(),
      })
      .returning();
    ids.deadline = deadline!.id;

    const [authResolved] = await db
      .insert(legalAuthorities)
      .values({
        authorityType: "case",
        title: "Synthetic Resolved Authority",
        citation: `410 U.S. 113 D7 ${suffix}`,
        jurisdiction: "US",
        court: "U.S. Supreme Court (synthetic)",
        ingestionStatus: "ready",
        treatmentStatus: "unknown",
        currentnessStatus: "unknown",
        metadata: {},
        sourceProvider: "synthetic_d7",
        sourceExternalId: `resolved_${suffix}`,
      })
      .returning();
    ids.authResolved = authResolved!.id;

    const [authCorpus] = await db
      .insert(legalAuthorities)
      .values({
        authorityType: "case",
        title: "Synthetic Corpus-Complete Authority",
        citation: `123 F. Supp. 3d 456 D7 ${suffix}`,
        jurisdiction: "US",
        court: "Synthetic District Court",
        ingestionStatus: "ready",
        treatmentStatus: "unknown",
        currentnessStatus: "unknown",
        metadata: { corpusComplete: true, fullTextPresent: true },
        sourceProvider: "synthetic_d7",
        sourceExternalId: `corpus_${suffix}`,
      })
      .returning();
    ids.authCorpus = authCorpus!.id;

    const [authUnresolved] = await db
      .insert(legalAuthorities)
      .values({
        authorityType: "case",
        title: "Unresolved Identity Placeholder",
        citation: `999 Fake.Rep. 1 D7 ${suffix}`,
        jurisdiction: "US",
        ingestionStatus: "pending",
        treatmentStatus: "unknown",
        currentnessStatus: "unknown",
        metadata: {},
        sourceProvider: "synthetic_d7",
        sourceExternalId: `unresolved_${suffix}`,
      })
      .returning();
    ids.authUnresolved = authUnresolved!.id;

    await db.insert(matterAuthorities).values([
      {
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        authorityId: ids.authResolved!,
        status: "saved",
        addedByUserId: ids.owner!,
      },
      {
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        authorityId: ids.authCorpus!,
        status: "saved",
        addedByUserId: ids.owner!,
      },
      {
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        authorityId: ids.authUnresolved!,
        status: "saved",
        addedByUserId: ids.owner!,
      },
    ]);
  }, 180_000);

  afterAll(async () => {
    await closeDb(db);
  });

  it("persists the multi-domain D7 fixture spine", async () => {
    const pleading = await createCivilPleading(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      label: "Complaint",
      pleadingType: "complaint",
      provenance,
    });

    const claimA = await createCivilClaim(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "CLAIM",
      category: "CONTRACT",
      label: "Claim A — breach of supply agreement",
      description: "Failure to cure defective parts after notice.",
      pleadingId: pleading.id,
      supportStatus: "PARTIALLY_SUPPORTED",
      proceduralStatus: "PLED",
      parties: [
        { partyEntityId: ids.plaintiff!, role: "PLAINTIFF" },
        { partyEntityId: ids.defendant!, role: "DEFENDANT" },
      ],
      provenance,
    });
    ids.claimA = claimA.id;

    const claimB = await createCivilClaim(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "CLAIM",
      category: "CONTRACT",
      label: "Claim B — warranty",
      pleadingId: pleading.id,
      supportStatus: "NO_EVIDENCE_FOUND",
      proceduralStatus: "PLED",
      parties: [
        { partyEntityId: ids.plaintiff!, role: "PLAINTIFF" },
        { partyEntityId: ids.defendant!, role: "DEFENDANT" },
      ],
      provenance,
    });
    ids.claimB = claimB.id;

    const elNotice = await addCivilClaimElement(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      claimId: claimA.id,
      label: "Notice and opportunity to cure",
      requirementText: "Plaintiff provided timely cure notice.",
      status: "CONFLICTED",
      provenance,
    });
    ids.elNotice = elNotice.id;

    const elDamages = await addCivilClaimElement(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      claimId: claimA.id,
      label: "Damages",
      requirementText: "Quantified contract damages.",
      status: "NO_EVIDENCE_FOUND",
      provenance,
    });
    ids.elDamages = elDamages.id;

    await addCivilClaimElement(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      claimId: claimB.id,
      label: "Warranty terms",
      requirementText: "Express warranty terms apply.",
      status: "NO_EVIDENCE_FOUND",
      provenance,
    });

    const defense = await createCivilDefense(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "AFFIRMATIVE",
      label: "Waiver",
      againstClaimIds: [claimA.id],
      assertingPartyIds: [ids.defendant!],
      targetPartyIds: [ids.plaintiff!],
      pleadingId: pleading.id,
      supportStatus: "NO_EVIDENCE_FOUND",
      provenance,
    });
    ids.defense = defense.id;

    const evNotice = await createCivilEvidenceItem(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      label: `Cure-notice exhibit ${suffix}`,
      documentId: ids.docExhibit!,
      provenance,
    });
    ids.evNotice = evNotice.id;

    const evLog = await createCivilEvidenceItem(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      label: `Empty delivery log ${suffix}`,
      documentId: ids.docLog!,
      provenance,
    });
    ids.evLog = evLog.id;

    await linkCivilEvidence(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      elementId: elNotice.id,
      evidenceId: evNotice.id,
      role: "SUPPORTS",
      partyEntityIds: [ids.plaintiff!],
      note: "Letter supports notice theory.",
      provenance,
    });
    await linkCivilEvidence(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      elementId: elNotice.id,
      evidenceId: evLog.id,
      role: "CONTRADICTS",
      partyEntityIds: [ids.defendant!],
      note: "Log contradicts notice receipt/transmission.",
      provenance,
    });
    await linkCivilEvidence(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      elementId: elDamages.id,
      role: "MISSING_EXPECTED",
      note: "No damages spreadsheet or expert report in the record.",
      provenance,
    });
    await linkCivilFact(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      elementId: elNotice.id,
      factId: ids.factNotice!,
      role: "SUPPORTS",
      provenance,
    });
    await linkCivilFact(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      elementId: elNotice.id,
      factId: ids.factLog!,
      role: "CONTRADICTS",
      provenance,
    });

    await linkCivilAuthority(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      claimId: claimA.id,
      authorityId: ids.authResolved!,
      relation: "PERSUASIVE",
      sourceSupported: true,
      treatment: "UNVERIFIED",
      currentness: "unknown",
      provenance,
    });
    await linkCivilAuthority(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      claimId: claimA.id,
      authorityId: ids.authCorpus!,
      relation: "PERSUASIVE",
      sourceSupported: true,
      treatment: "UNVERIFIED",
      currentness: "unknown",
      provenance,
    });

    const set = await createDiscoveryRequestSet(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      label: "Plaintiff First Set of RFPs",
      discoveryType: "REQUEST_FOR_PRODUCTION",
      requestingPartyEntityId: ids.plaintiff!,
      respondingPartyEntityId: ids.defendant!,
      provenance,
    });
    const item = await createDiscoveryRequestItem(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      setId: set.id,
      requestNumber: "RFP-12",
      title: "Cure-notice communications",
      requestText: "Produce all cure-notice communications and attachments.",
      status: "DEFICIENT",
      requestingPartyEntityId: ids.plaintiff!,
      respondingPartyEntityId: ids.defendant!,
      provenance,
    });
    ids.requestItem = item.id;

    await createDiscoveryResponse(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      itemId: item.id,
      label: "Initial deficient response to RFP-12",
      respondedAt: new Date("2025-09-15T15:00:00.000Z"),
      substantiveText: "Produced cover letter only; attachments omitted.",
      provenance,
    });

    await createDiscoveryProduction(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      label: "Incomplete RFP-12 production",
      producingPartyEntityId: ids.defendant!,
      receivingPartyEntityId: ids.plaintiff!,
      producedAt: new Date("2025-09-15T16:00:00.000Z"),
      isSupplemental: false,
      transmittalDocumentId: ids.docProd!,
      notes: "Cover letter only",
      provenance,
    });

    const macComm = await createMatterCommunication(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationType: "MEET_AND_CONFER",
      direction: "OUTBOUND",
      status: "SENT",
      subject: "Meet-and-confer regarding RFP-12 cure-notice production",
      summary: "Opposing counsel agreed to supplement attachments by October 1.",
      occurredAt: new Date("2025-09-20T16:00:00.000Z"),
      senderEntityId: ids.plaintiff!,
      recipientEntityId: ids.defendant!,
      primaryDocumentId: ids.docMac!,
      followUpNeeded: true,
      followUpDueAt: new Date("2025-10-01T23:59:00.000Z"),
      followUpTaskId: ids.commTask!,
      provenance,
    });
    ids.macComm = macComm.id;

    const followComm = await createMatterCommunication(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationType: "FOLLOW_UP",
      direction: "OUTBOUND",
      status: "SENT",
      subject: "Follow-up after incomplete supplement to RFP-12",
      summary: "Supplement remained incomplete; motion practice reserved.",
      occurredAt: new Date("2025-10-05T16:00:00.000Z"),
      senderEntityId: ids.plaintiff!,
      recipientEntityId: ids.defendant!,
      primaryDocumentId: ids.docFollow!,
      followUpNeeded: true,
      followUpDueAt: new Date("2025-10-12T23:59:00.000Z"),
      provenance,
    });
    ids.followComm = followComm.id;

    const compel = await createMatterMotion(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionType: "MOTION_TO_COMPEL",
      title: "Motion to Compel — RFP-12",
      summary: "Compel complete production of cure-notice attachments.",
      status: "GRANTED_IN_PART",
      movingPartyEntityId: ids.plaintiff!,
      opposingPartyEntityId: ids.defendant!,
      filedAt: new Date("2025-10-15T15:00:00.000Z"),
      servedAt: new Date("2025-10-15T18:00:00.000Z"),
      oppositionDueAt: new Date("2025-10-29T23:59:00.000Z"),
      oppositionFiledAt: new Date("2025-10-28T16:00:00.000Z"),
      replyDueAt: new Date("2025-11-05T23:59:00.000Z"),
      replyFiledAt: new Date("2025-11-04T14:00:00.000Z"),
      hearingAt: new Date("2025-11-12T14:30:00.000Z"),
      rulingAt: new Date("2025-11-18T17:00:00.000Z"),
      disposition: "GRANTED_IN_PART",
      rulingSummary:
        "Order grants in part and denies in part; supplemental production of cure-notice attachments required by 2025-12-02.",
      primaryDocumentId: ids.docMotion!,
      orderDocumentId: ids.docOrder!,
      provenance,
    });
    ids.motionCompel = compel.id;

    const pending = await createMatterMotion(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionType: "PROCEDURAL",
      title: "Pending Scheduling Motion (fixture contrast)",
      status: "FILED",
      filedAt: new Date("2025-11-01T12:00:00.000Z"),
      provenance,
    });
    ids.motionPending = pending.id;

    for (const [documentId, role, sortOrder] of [
      [ids.docMotion!, "MOTION", 0],
      [ids.docExhibit!, "EXHIBIT", 1],
      [ids.docOpposition!, "OPPOSITION", 2],
      [ids.docReply!, "REPLY", 3],
      [ids.docOrder!, "ORDER", 4],
    ] as const) {
      await linkMotionDocument(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        motionId: ids.motionCompel!,
        documentId,
        role,
        sortOrder,
      });
    }

    const deficiency = await createDiscoveryDeficiency(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "INCOMPLETE_PRODUCTION",
      status: "MOTION_PENDING",
      description: "RFP-12 cure-notice attachments remain incomplete after promised supplement.",
      itemId: ids.requestItem!,
      openedAt: new Date("2025-09-16T12:00:00.000Z"),
      responsiblePartyEntityId: ids.defendant!,
      communicationId: ids.macComm!,
      motionId: ids.motionCompel!,
      motionDocumentId: ids.docMotion!,
      isReviewSignal: false,
      provenance,
    });
    ids.deficiency = deficiency.id;

    const mac = await createDiscoveryMeetAndConferIssue(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      label: "Meet-and-confer on RFP-12 incomplete production",
      occurredAt: new Date("2025-09-20T16:00:00.000Z"),
      communicationId: ids.macComm!,
      outcomeNotes: "Defendant promised to supplement cure-notice attachments.",
      deficiencyIds: [ids.deficiency!],
      provenance,
    });
    ids.mac = mac.id;

    await linkMatterMotionTarget(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionId: ids.motionCompel!,
      linkType: "CLAIM",
      targetId: ids.claimA!,
      note: "compel relating to Claim A discovery — not claim disposition",
    });
    await linkMatterMotionTarget(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionId: ids.motionCompel!,
      linkType: "DISCOVERY_REQUEST_ITEM",
      targetId: ids.requestItem!,
    });
    await linkMatterMotionTarget(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionId: ids.motionCompel!,
      linkType: "DISCOVERY_DEFICIENCY",
      targetId: ids.deficiency!,
    });
    await linkMatterMotionTarget(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionId: ids.motionCompel!,
      linkType: "EVIDENCE",
      targetId: ids.evNotice!,
    });
    await linkMatterMotionTarget(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionId: ids.motionCompel!,
      linkType: "COMMUNICATION",
      targetId: ids.macComm!,
    });
    await linkMatterMotionTarget(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionId: ids.motionCompel!,
      linkType: "COMMUNICATION",
      targetId: ids.followComm!,
    });
    await linkMatterMotionTarget(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionId: ids.motionCompel!,
      linkType: "TASK",
      targetId: ids.taskOpen!,
    });
    await linkMatterMotionTarget(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionId: ids.motionCompel!,
      linkType: "DEADLINE_CANDIDATE",
      targetId: ids.deadline!,
    });

    await linkMatterCommunicationTarget(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationId: ids.macComm!,
      linkType: "DISCOVERY_DEFICIENCY",
      targetId: ids.deficiency!,
    });
    await linkMatterCommunicationTarget(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationId: ids.macComm!,
      linkType: "MOTION",
      targetId: ids.motionCompel!,
    });
    await linkMatterCommunicationTarget(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationId: ids.followComm!,
      linkType: "DISCOVERY_DEFICIENCY",
      targetId: ids.deficiency!,
    });
    await linkMatterCommunicationTarget(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationId: ids.followComm!,
      linkType: "MOTION",
      targetId: ids.motionCompel!,
    });

    expect(deficiency.motionId).toBe(ids.motionCompel);
    expect(deficiency.communicationId).toBe(ids.macComm);
    expect(mac.communicationId).toBe(ids.macComm);
    expect(compel.disposition).toBe("GRANTED_IN_PART");
  }, 180_000);

  it("assembles whole-matter intelligence from persisted domains", async () => {
    const t0 = performance.now();
    const wm = await loadWholeMatterIntelligence(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    timings.assemblyMs = performance.now() - t0;

    expect(wm.organizationId).toBe(ids.orgA);
    expect(wm.matterId).toBe(ids.matterA);
    expect(wm.parties.map((p) => p.id)).toEqual(
      expect.arrayContaining([ids.plaintiff, ids.defendant]),
    );

    const claimA = wm.claims.find((c) => c.claimId === ids.claimA);
    expect(claimA).toBeTruthy();
    expect(claimA!.partyIds).toEqual(expect.arrayContaining([ids.plaintiff, ids.defendant]));
    expect(claimA!.elementIds).toContain(ids.elNotice);
    expect(claimA!.supportingEvidenceIds).toContain(ids.evNotice);
    expect(claimA!.contradictingEvidenceIds).toContain(ids.evLog);
    expect(claimA!.relatedFactIds).toEqual(expect.arrayContaining([ids.factNotice, ids.factLog]));
    expect(claimA!.relatedMotionIds).toContain(ids.motionCompel);
    expect(claimA!.relatedDeficiencyIds).toContain(ids.deficiency);
    expect(claimA!.relatedCommunicationIds).toEqual(
      expect.arrayContaining([ids.macComm, ids.followComm]),
    );
    expect(claimA!.relatedAuthorityIds).toEqual(
      expect.arrayContaining([ids.authResolved, ids.authCorpus]),
    );
    expect(claimA!.openGaps.length).toBeGreaterThan(0);
    expect(claimA!.wholeClaimDisposedByMotion).toBe(false);
    expect(wm.claims.some((c) => c.claimId === ids.claimB)).toBe(true);

    const defense = wm.defenses.find((d) => d.defenseId === ids.defense);
    expect(defense).toBeTruthy();
    expect(defense!.established).toBe(false);
    expect(defense!.againstClaimIds).toContain(ids.claimA);
    expect(defense!.openGaps.length).toBeGreaterThan(0);

    expect(wm.propositions.length).toBeGreaterThan(0);
    expect(wm.contradictions.some((c) => c.kind === "DIRECT_CONFLICT")).toBe(true);
    expect(wm.contradictions.every((c) => c.credibilityConclusion === null)).toBe(true);
    expect(wm.openDeficiencyIds).toContain(ids.deficiency);
    expect(wm.discoveryChains.some((c) => c.deficiencyId === ids.deficiency && c.motionId === ids.motionCompel)).toBe(
      true,
    );
    expect(wm.communications.some((c) => c.id === ids.macComm)).toBe(true);
    expect(wm.motions.some((m) => m.motionId === ids.motionCompel && m.disposition === "GRANTED_IN_PART")).toBe(
      true,
    );
    expect(wm.motions.some((m) => m.motionId === ids.motionPending && m.pending)).toBe(true);
    expect(wm.motions.every((m) => m.disposesEntireClaim === false)).toBe(true);
    expect(wm.tasks.some((t) => t.id === ids.taskOpen && t.status === "open")).toBe(true);
    expect(wm.tasks.some((t) => t.id === ids.taskDone && t.status === "completed")).toBe(true);
    expect(wm.deadlines.some((d) => d.id === ids.deadline && d.explicit)).toBe(true);
    expect(wm.timeline.some((e) => e.dateKind === "filing" || e.eventType === "motion_filed")).toBe(true);
    expect(wm.timeline.some((e) => e.eventType === "motion_ruled")).toBe(true);
    expect(wm.timeline.every((e) => e.eventDate != null)).toBe(true);

    const buckets = new Set(wm.authorities.map((a) => a.resolution));
    expect(buckets.has("AUTHORITY_RESOLVED")).toBe(true);
    expect(buckets.has("CORPUS_COMPLETE")).toBe(true);
    expect(buckets.has("IDENTITY_UNRESOLVED")).toBe(true);
    expect(wm.authorities.every((a) => a.treatmentVerified === false || a.resolution === "CORPUS_COMPLETE")).toBe(
      true,
    );
    expect(wm.investigateNext.length).toBeGreaterThan(0);
    expect(wm.investigateNext.every((i) => i.why && i.resolvesIf && i.predictiveOutcome === null)).toBe(true);
    expect(wm.sourceRefs.some((s) => s.kind === "claim" && s.id === ids.claimA)).toBe(true);
    expect(wm.liabilityConclusion).toBeNull();
    expect(wm.predictiveOutcome).toBeNull();
    expect(wm.status.flags).toEqual(
      expect.arrayContaining(["CLAIMS_ACTIVE", "DEFICIENCIES_OUTSTANDING", "MOTION_RULED", "EVIDENCE_GAP"]),
    );

    console.log(
      JSON.stringify({
        pass7_live_assembly_ms: Math.round(timings.assemblyMs),
        claims: wm.claims.length,
        motions: wm.motions.length,
        communications: wm.communications.length,
        propositions: wm.propositions.length,
        investigateNext: wm.investigateNext.length,
      }),
    );
  }, 120_000);

  it("answers live whole-matter Ask questions against persisted fixture", async () => {
    const wm = await loadWholeMatterIntelligence(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });

    const questions = [
      "Give me the current status of this matter.",
      "What supports Claim A?",
      "What is missing for Claim A?",
      "What evidence contradicts the current theory?",
      "What discovery deficiencies remain unresolved?",
      "What communications led to the motion?",
      "What did the court actually rule?",
      "What tasks and explicit deadlines remain?",
      "What authorities apply to the unresolved issues?",
      "What facts are unsupported?",
      "What should the attorney investigate next?",
      "Will we win because the witness is lying?",
    ];
    for (const q of questions) {
      expect(isWholeMatterAskQuestion(q)).toBe(true);
    }

    const t0 = performance.now();
    const status = answerWholeMatterQuestion({
      intelligence: wm,
      question: "Give me the current status of this matter.",
    });
    timings.askMs = performance.now() - t0;
    expect(status.statusFlags.length).toBeGreaterThan(0);
    expect(status.claims.some((c) => c.id === ids.claimA)).toBe(true);

    const support = answerWholeMatterQuestion({
      intelligence: wm,
      question: "What supports Claim A?",
    });
    expect(support.claims.some((c) => c.id === ids.claimA)).toBe(true);

    const gaps = answerWholeMatterQuestion({
      intelligence: wm,
      question: "What is missing for Claim A?",
    });
    expect(gaps.claims.some((c) => c.id === ids.claimA && c.openGaps.length > 0)).toBe(true);

    const contrad = answerWholeMatterQuestion({
      intelligence: wm,
      question: "What evidence contradicts the current theory?",
    });
    expect(contrad.contradictions.length).toBeGreaterThan(0);
    expect(contrad.credibilityConclusion).toBeNull();

    const disc = answerWholeMatterQuestion({
      intelligence: wm,
      question: "What discovery deficiencies remain unresolved?",
    });
    expect(disc.discoveryGaps.some((g) => g.includes(ids.deficiency!))).toBe(true);

    const chain = answerWholeMatterQuestion({
      intelligence: wm,
      question: "What communications led to the motion?",
    });
    expect(chain.communications.some((c) => c.id === ids.macComm)).toBe(true);

    const ruling = answerWholeMatterQuestion({
      intelligence: wm,
      question: "What did the court actually rule?",
    });
    expect(ruling.motions.some((m) => m.id === ids.motionCompel && m.disposition === "GRANTED_IN_PART")).toBe(
      true,
    );

    const deadlines = answerWholeMatterQuestion({
      intelligence: wm,
      question: "What tasks and explicit deadlines remain?",
    });
    expect(deadlines.deadlinesTasks.some((d) => /Supplemental production/i.test(d))).toBe(true);

    const auths = answerWholeMatterQuestion({
      intelligence: wm,
      question: "What authorities apply to the unresolved issues?",
    });
    expect(auths.authorities.some((a) => a.id === ids.authResolved)).toBe(true);
    expect(auths.authorities.some((a) => a.id === ids.authUnresolved && a.resolution === "IDENTITY_UNRESOLVED")).toBe(
      true,
    );

    const next = answerWholeMatterQuestion({
      intelligence: wm,
      question: "What should the attorney investigate next?",
    });
    expect(next.investigateNext.length).toBeGreaterThan(0);
    expect(next.investigateNext.every((i) => i.why && i.resolvesIf)).toBe(true);

    const abstain = answerWholeMatterQuestion({
      intelligence: wm,
      question: "Will we win because the witness is lying?",
    });
    expect(abstain.predictiveOutcome).toBeNull();
    expect(abstain.credibilityConclusion).toBeNull();
    const text = formatWholeMatterAnswer(abstain);
    expect(text).toContain("PREDICTIVE_OUTCOME: null");
    expect(text.length).toBeLessThan(80_000);
    expect(text).toMatch(/bounded|drill down/i);

    console.log(JSON.stringify({ pass7_live_ask_ms: Math.round(timings.askMs), ask_context_chars: text.length }));
  }, 120_000);

  it("materializes Graph/Timeline without duplicates or unresolved-authority promotion", async () => {
    const wm = await loadWholeMatterIntelligence(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });

    const tPlan = performance.now();
    const planned = planWholeMatterGraph(wm);
    timings.graphPlanMs = performance.now() - tPlan;
    expect(planned.nodes.length).toBeGreaterThan(0);
    expect(new Set(planned.nodes.map((n) => n.key)).size).toBe(planned.nodes.length);
    expect(planned.nodes.some((n) => n.entityId === ids.authUnresolved)).toBe(false);
    expect(
      planned.edges.some(
        (e) =>
          e.relationshipType.includes("CLAIM") ||
          e.relationshipType.includes("MOTION") ||
          e.relationshipType.includes("COMMUNICATION"),
      ),
    ).toBe(true);

    const tGraph = performance.now();
    const mcGraph = await materializeMotionsCommunicationsGraph({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
    });
    await materializeDiscoveryGraph({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
    });
    await materializeVerifiedGraph({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
      force: true,
    });
    timings.graphMaterializeMs = performance.now() - tGraph;
    expect(mcGraph.plan.nodes.some((n) => n.canonicalEntityId === ids.motionCompel)).toBe(true);
    expect(mcGraph.plan.nodes.some((n) => n.canonicalEntityId === ids.macComm)).toBe(true);

    const nodes = await db
      .select()
      .from(graphNodes)
      .where(and(eq(graphNodes.matterId, ids.matterA!), eq(graphNodes.organizationId, ids.orgA!)));
    const nodeKeys = nodes.map((n) => `${n.canonicalEntityType}:${n.canonicalEntityId}`);
    expect(new Set(nodeKeys).size).toBe(nodeKeys.length);

    const edges = await db
      .select()
      .from(graphEdges)
      .where(and(eq(graphEdges.matterId, ids.matterA!), eq(graphEdges.organizationId, ids.orgA!)));
    const edgeKeys = edges.map((e) => `${e.fromNodeId}|${e.relationshipType}|${e.toNodeId}`);
    expect(new Set(edgeKeys).size).toBe(edgeKeys.length);

    const second = await materializeMotionsCommunicationsGraph({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
    });
    expect(second.edgesCreated).toBe(0);

    const foreignNodes = await db
      .select()
      .from(graphNodes)
      .where(and(eq(graphNodes.matterId, ids.matterA!), eq(graphNodes.canonicalEntityId, ids.foreignEntity!)));
    expect(foreignNodes.length).toBe(0);

    const tTl = performance.now();
    const tl = await materializeMotionsCommunicationsTimeline({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
    });
    timings.timelineMs = performance.now() - tTl;
    expect(tl.eventsUpserted).toBeGreaterThan(0);
    await materializeMotionsCommunicationsTimeline({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
    });
    const events = await db
      .select()
      .from(timelineEvents)
      .where(and(eq(timelineEvents.matterId, ids.matterA!), eq(timelineEvents.organizationId, ids.orgA!)));
    const dedupe = events.map((e) => e.dedupeKey).filter(Boolean);
    expect(new Set(dedupe).size).toBe(dedupe.length);
    expect(events.every((e) => e.eventDate != null)).toBe(true);
    expect(events.some((e) => e.eventType === "motion_filed")).toBe(true);
    expect(events.some((e) => e.eventType === "motion_ruled")).toBe(true);

    console.log(
      JSON.stringify({
        pass7_live_graph_plan_ms: Math.round(timings.graphPlanMs),
        pass7_live_graph_materialize_ms: Math.round(timings.graphMaterializeMs),
        pass7_live_timeline_ms: Math.round(timings.timelineMs),
        nodes: nodes.length,
        edges: edges.length,
        timeline_events: events.length,
      }),
    );
  }, 180_000);

  it("enforces cross-org, cross-matter, and client_guest isolation", async () => {
    await expect(
      loadWholeMatterIntelligence(db, {
        userId: ids.outsider!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const sibling = await loadWholeMatterIntelligence(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA2!,
    });
    expect(sibling.matterId).toBe(ids.matterA2);
    expect(sibling.claims.some((c) => c.claimId === ids.claimA)).toBe(false);
    expect(sibling.motions.some((m) => m.motionId === ids.motionCompel)).toBe(false);
    expect(sibling.communications.some((c) => c.id === ids.macComm)).toBe(false);

    const guestWm = await loadWholeMatterIntelligence(db, {
      userId: ids.guest!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    expect(guestWm.claims.some((c) => c.claimId === ids.claimA)).toBe(true);

    await expect(
      createMatterMotion(db, {
        userId: ids.guest!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        motionType: "OTHER",
        title: "Guest motion",
        status: "DRAFT",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // Guide/Professor workspaces have no matters.view on professional matters —
    // outsider without membership is the isolation proxy for those surfaces.
    await expect(
      loadWholeMatterIntelligence(db, {
        userId: ids.outsider!,
        organizationId: ids.orgB!,
        matterId: ids.matterA!,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  }, 60_000);

  it("fails closed on missing domains without fabricating replacements", async () => {
    const wm = await loadWholeMatterIntelligence(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA2!,
    });
    expect(wm.claims.length).toBe(0);
    expect(wm.motions.length).toBe(0);
    expect(wm.communications.length).toBe(0);
    expect(wm.openDeficiencyIds.length).toBe(0);
    expect(wm.predictiveOutcome).toBeNull();

    const sparse = {
      ...wm,
      motions: [],
      communications: [],
      authorities: wm.authorities.map((a) =>
        a.id === ids.authUnresolved
          ? a
          : { ...a, resolution: "IDENTITY_UNRESOLVED" as const, treatmentVerified: false },
      ),
      contradictions: [],
    };
    const answer = answerWholeMatterQuestion({
      intelligence: sparse,
      question: "What did the court actually rule?",
    });
    expect(answer.motions.length).toBe(0);
    expect(answer.predictiveOutcome).toBeNull();
    expect(answer.credibilityConclusion).toBeNull();
  });

  it("scales assembly/ask/graph for 50+ motions and 200+ communications", async () => {
    for (let i = 0; i < 53; i++) {
      await createMatterMotion(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        motionType: "OTHER",
        title: `Scale motion ${i} ${suffix}`,
        status: i % 5 === 0 ? "FILED" : "DRAFT",
        filedAt: i % 5 === 0 ? new Date(`2025-0${(i % 8) + 1}-10T12:00:00.000Z`) : null,
      });
    }
    for (let i = 0; i < 210; i++) {
      await createMatterCommunication(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        communicationType: "OTHER_CORRESPONDENCE",
        direction: "OUTBOUND",
        status: "SENT",
        subject: `Scale communication ${i} ${suffix}`,
        occurredAt: new Date(`2025-0${(i % 8) + 1}-05T12:00:00.000Z`),
      });
    }

    const tAsm = performance.now();
    const wm = await loadWholeMatterIntelligence(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    const assemblyMs = performance.now() - tAsm;
    expect(wm.motions.length).toBeGreaterThanOrEqual(55);
    expect(wm.communications.length).toBeGreaterThanOrEqual(212);

    const tAsk = performance.now();
    const ask = answerWholeMatterQuestion({
      intelligence: wm,
      question: "Give me the current status of this matter.",
    });
    const askMs = performance.now() - tAsk;
    const ctx = formatWholeMatterAnswer(ask);
    expect(ask.motions.length).toBeLessThanOrEqual(24);
    expect(ask.communications.length).toBeLessThanOrEqual(24);
    expect(ctx.length).toBeLessThan(80_000);

    const tGraph = performance.now();
    const graph = planWholeMatterGraph(wm);
    const graphMs = performance.now() - tGraph;
    expect(graph.nodes.length).toBeGreaterThan(50);
    expect(new Set(graph.nodes.map((n) => n.key)).size).toBe(graph.nodes.length);

    const tTl = performance.now();
    const timelineLen = wm.timeline.length;
    const timelineMs = performance.now() - tTl;

    expect(assemblyMs).toBeLessThan(15_000);
    expect(askMs).toBeLessThan(500);
    expect(graphMs).toBeLessThan(750);

    console.log(
      JSON.stringify({
        pass7_scale: {
          docs_seeded: "220+",
          motions: wm.motions.length,
          communications: wm.communications.length,
          tasks: wm.tasks.length,
          timeline_events: timelineLen,
          authorities: wm.authorities.length,
          assembly_ms: Math.round(assemblyMs),
          ask_ms: Math.round(askMs),
          ask_context_chars: ctx.length,
          graph_plan_ms: Math.round(graphMs),
          timeline_ms: Math.round(timelineMs),
          graph_nodes: graph.nodes.length,
          graph_edges: graph.edges.length,
        },
      }),
    );
  }, 300_000);
});
