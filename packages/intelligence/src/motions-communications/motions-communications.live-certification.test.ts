/**
 * Deepening Pass 6 — authorized LOCAL live certification.
 * RUN_DB_TESTS=1 DATABASE_URL=postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid
 * Production Neon / CourtListener: unused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  civilEvidenceItems,
  deadlineCandidates,
  documents,
  graphEdges,
  graphNodes,
  matters,
  matterEntities,
  matterMembers,
  memberships,
  timelineEvents,
  tasks,
  users,
} from "@nyayagrid/database";
import { AuthorizationError } from "@nyayagrid/permissions";
import { createCivilClaim } from "../civil/postgres";
import {
  createDiscoveryDeficiency,
  createDiscoveryMeetAndConferIssue,
  createDiscoveryRequestItem,
  createDiscoveryRequestSet,
  createDiscoveryResponse,
} from "../discovery-ledger/postgres";
import { materializeDiscoveryGraph } from "../discovery-ledger/graph-materialize";
import { materializeVerifiedGraph } from "../graph/materialize";
import {
  answerMotionsCommunicationsQuestion,
  createMatterCommunication,
  createMatterMotion,
  formatMotionsCommunicationsAnswer,
  getMatterCommunication,
  getMatterMotion,
  linkMatterCommunicationTarget,
  linkMatterMotionTarget,
  linkMotionDocument,
  listMatterCommunications,
  listMatterMotions,
  loadMatterMotionsCommunicationsReview,
  materializeMotionsCommunicationsGraph,
  materializeMotionsCommunicationsTimeline,
  MotionsCommunicationsError,
  updateMatterCommunication,
  updateMatterMotion,
} from "./index";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const provenance = { extractionOrigin: "human" as const, humanEntered: true };

describe.runIf(runDbTests)("Pass 6 motions/communications live certification (local DB)", () => {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  const suffix = `d6live_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  let guestRoleId = "";

  beforeAll(async () => {
    const host = new URL(
      process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
    ).host;
    expect(host).toMatch(/localhost:5433|127\.0\.0\.1:5433/);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `d6_owner_${suffix}`,
        email: `d6_owner_${suffix}@example.nyayagrid.local`,
        name: "D6 Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `d6_out_${suffix}`,
        email: `d6_out_${suffix}@example.nyayagrid.local`,
        name: "D6 Outsider",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `d6_guest_${suffix}`,
        email: `d6_guest_${suffix}@example.nyayagrid.local`,
        name: "D6 Guest",
      })
      .returning();
    ids.owner = owner!.id;
    ids.outsider = outsider!.id;
    ids.guest = guest!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `D6 Firm ${suffix}`,
      slug: `d6-firm-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `D6 Other ${suffix}`,
      slug: `d6-other-${suffix}`,
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
        displayName: "Supply Co Client",
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
        title: `Supply Agreement Dispute ${suffix}`,
        matterNumber: `D6-${suffix}`,
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
        matterNumber: `D6F-${suffix}`,
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
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        userId: ids.guest!,
        access: "read",
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
    ids.docOpposition = await doc(`Opposition ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    ids.docReply = await doc(`Reply ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    ids.docOrder = await doc(`Order granted in part ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    ids.docMac = await doc(`MAC letter ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    ids.docFollow = await doc(`Follow-up letter ${suffix}`, ids.orgA!, ids.matterA!, ids.owner!);
    ids.docB = await doc(`Foreign Doc ${suffix}`, ids.orgB!, ids.matterB!, ids.outsider!);

    const [evidence] = await db
      .insert(civilEvidenceItems)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        label: `Cure-notice exhibit ${suffix}`,
        documentId: ids.docExhibit!,
        provenance,
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.evidence = evidence!.id;

    const [foreignEvidence] = await db
      .insert(civilEvidenceItems)
      .values({
        organizationId: ids.orgB!,
        matterId: ids.matterB!,
        label: `Foreign evidence ${suffix}`,
        documentId: ids.docB!,
        provenance,
        createdByUserId: ids.outsider!,
      })
      .returning();
    ids.foreignEvidence = foreignEvidence!.id;

    const [task] = await db
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
    ids.task = task!.id;

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
  }, 90_000);

  afterAll(async () => {
    await closeDb(db);
  });

  it("persists the full D6 litigation spine with first-class motion/communication ids", async () => {
    const claim = await createCivilClaim(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "CLAIM",
      label: "Claim A — breach of supply agreement",
      description: "Failure to cure defective parts after notice.",
      parties: [
        { partyEntityId: ids.plaintiff!, role: "PLAINTIFF" },
        { partyEntityId: ids.defendant!, role: "DEFENDANT" },
      ],
      provenance,
    });
    ids.claim = claim.id;

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
      targetId: ids.claim!,
      note: "summary judgment not implied; compel relating to Claim A discovery",
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
      targetId: ids.evidence!,
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
      targetId: ids.task!,
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
    await linkMatterCommunicationTarget(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationId: ids.followComm!,
      linkType: "TASK",
      targetId: ids.commTask!,
    });

    expect(deficiency.motionId).toBe(ids.motionCompel);
    expect(deficiency.communicationId).toBe(ids.macComm);
    expect(mac.communicationId).toBe(ids.macComm);
    expect(compel.disposition).toBe("GRANTED_IN_PART");
    expect(compel.hearingAt).toBeTruthy();
  }, 120_000);

  it("live-certifies motion/communication CRUD and same-matter linking", async () => {
    const listed = await listMatterMotions(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    expect(listed.some((m) => m.id === ids.motionCompel)).toBe(true);

    const updated = await updateMatterMotion(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionId: ids.motionCompel!,
      patch: { courtName: "Synthetic District Court" },
    });
    expect(updated.courtName).toBe("Synthetic District Court");

    const loaded = await getMatterMotion(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionId: ids.motionCompel!,
    });
    expect(loaded.disposition).toBe("GRANTED_IN_PART");

    const comms = await listMatterCommunications(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    expect(comms.map((c) => c.id)).toEqual(expect.arrayContaining([ids.macComm, ids.followComm]));

    const updatedComm = await updateMatterCommunication(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationId: ids.followComm!,
      patch: { status: "SENT" },
    });
    expect(updatedComm.status).toBe("SENT");

    const loadedComm = await getMatterCommunication(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationId: ids.macComm!,
    });
    expect(loadedComm.communicationType).toBe("MEET_AND_CONFER");
  });

  it("rejects cross-org/cross-matter/foreign links and guest mutation", async () => {
    await expect(
      getMatterMotion(db, {
        userId: ids.outsider!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        motionId: ids.motionCompel!,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      getMatterCommunication(db, {
        userId: ids.outsider!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        communicationId: ids.macComm!,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      linkMatterMotionTarget(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        motionId: ids.motionCompel!,
        linkType: "EVIDENCE",
        targetId: ids.foreignEvidence!,
      }),
    ).rejects.toMatchObject({ code: "CROSS_MATTER" });

    await expect(
      linkMotionDocument(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        motionId: ids.motionCompel!,
        documentId: ids.docB!,
        role: "EXHIBIT",
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/CROSS_ORG|CROSS_MATTER/) });

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

    // guest read permitted
    const guestList = await listMatterMotions(db, {
      userId: ids.guest!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    expect(guestList.some((m) => m.id === ids.motionCompel)).toBe(true);
  });

  it("answers live Ask questions from persisted review without inventing conclusions", async () => {
    const review = await loadMatterMotionsCommunicationsReview(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });

    const pending = answerMotionsCommunicationsQuestion({
      review,
      question: "What motions are pending?",
    });
    expect(pending.pendingMotionIds).toContain(ids.motionPending);
    expect(pending.pendingMotionIds).not.toContain(ids.motionCompel);

    const status = answerMotionsCommunicationsQuestion({
      review,
      question: "What is the status of the motion to compel?",
    });
    const compel = status.motions.find((m) => m.id === ids.motionCompel)!;
    expect(compel.disposition).toBe("GRANTED_IN_PART");
    expect(compel.relatedDeficiencyIds).toContain(ids.deficiency);
    expect(compel.relatedClaimIds).toContain(ids.claim);
    expect(compel.relatedEvidenceIds).toContain(ids.evidence);

    const chrono = answerMotionsCommunicationsQuestion({
      review,
      question: "What communications happened before the motion was filed?",
    });
    expect(chrono.communications.map((c) => c.id)).toEqual(
      expect.arrayContaining([ids.macComm, ids.followComm]),
    );

    const deadlines = answerMotionsCommunicationsQuestion({
      review,
      question: "What deadline is currently explicit for the motion?",
    });
    expect(deadlines.explicitDeadlines.some((d) => d.label === "hearing")).toBe(true);
    expect(deadlines.limitations.some((l) => /No jurisdictional deadline was calculated/i.test(l))).toBe(
      true,
    );

    const ruling = answerMotionsCommunicationsQuestion({
      review,
      question: "What did the court rule on the motion to compel?",
    });
    expect(ruling.motions[0]?.rulingSummary?.toLowerCase()).toContain("grants in part");

    const claimQ = answerMotionsCommunicationsQuestion({
      review,
      question: "Which claim is the motion related to?",
    });
    expect(claimQ.limitations.some((l) => /does not mean the court disposed/i.test(l))).toBe(true);

    const abstain = answerMotionsCommunicationsQuestion({
      review,
      question: "Will the motion win because the judge favors plaintiff?",
    });
    expect(abstain.predictiveOutcome).toBeNull();
    expect(formatMotionsCommunicationsAnswer(abstain)).toContain("PREDICTIVE_OUTCOME: null");
  });

  it("materializes Pass 6 graph and timeline idempotently without semantic duplicates", async () => {
    const first = await materializeMotionsCommunicationsGraph({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
    });
    expect(first.plan.nodes.some((n) => n.nodeType === "motion" && n.canonicalEntityId === ids.motionCompel)).toBe(
      true,
    );
    expect(
      first.plan.nodes.some(
        (n) => n.nodeType === "communication" && n.canonicalEntityId === ids.macComm,
      ),
    ).toBe(true);
    expect(first.plan.edges.some((e) => e.relationshipType === "relates_to_deficiency")).toBe(true);
    expect(first.plan.edges.some((e) => e.relationshipType === "order_resolves_motion")).toBe(true);

    const discoveryFirst = await materializeDiscoveryGraph({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
    });
    expect(
      discoveryFirst.plan.nodes.some(
        (n) => n.nodeType === "communication" && n.canonicalEntityId === ids.macComm,
      ),
    ).toBe(true);
    expect(
      discoveryFirst.plan.nodes.some(
        (n) => n.nodeType === "document" && n.canonicalEntityId === ids.macComm,
      ),
    ).toBe(false);
    expect(
      discoveryFirst.plan.nodes.some(
        (n) => n.nodeType === "motion" && n.canonicalEntityId === ids.motionCompel,
      ),
    ).toBe(true);

    await materializeVerifiedGraph({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
      force: true,
    });

    const nodes = await db
      .select()
      .from(graphNodes)
      .where(and(eq(graphNodes.matterId, ids.matterA!), eq(graphNodes.organizationId, ids.orgA!)));
    const nodeKeys = nodes.map((n) => `${n.canonicalEntityType}:${n.canonicalEntityId}`);
    expect(new Set(nodeKeys).size).toBe(nodeKeys.length);
    // Same real communication must not also appear as a document node.
    expect(
      nodes.filter((n) => n.canonicalEntityId === ids.macComm).map((n) => n.nodeType),
    ).toEqual(["communication"]);

    const edges = await db
      .select()
      .from(graphEdges)
      .where(and(eq(graphEdges.matterId, ids.matterA!), eq(graphEdges.organizationId, ids.orgA!)));
    const edgeKeys = edges.map(
      (e) => `${e.fromNodeId}|${e.relationshipType}|${e.toNodeId}`,
    );
    expect(new Set(edgeKeys).size).toBe(edgeKeys.length);

    const secondGraph = await materializeMotionsCommunicationsGraph({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
    });
    expect(secondGraph.edgesCreated).toBe(0);

    const timelineFirst = await materializeMotionsCommunicationsTimeline({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
    });
    expect(timelineFirst.eventsUpserted).toBeGreaterThan(0);
    const countAfterFirst = await db
      .select({ n: count() })
      .from(timelineEvents)
      .where(
        and(eq(timelineEvents.matterId, ids.matterA!), eq(timelineEvents.organizationId, ids.orgA!)),
      );
    await materializeMotionsCommunicationsTimeline({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
    });
    const countAfterSecond = await db
      .select({ n: count() })
      .from(timelineEvents)
      .where(
        and(eq(timelineEvents.matterId, ids.matterA!), eq(timelineEvents.organizationId, ids.orgA!)),
      );
    expect(Number(countAfterSecond[0]!.n)).toBe(Number(countAfterFirst[0]!.n));

    const events = await db
      .select()
      .from(timelineEvents)
      .where(
        and(eq(timelineEvents.matterId, ids.matterA!), eq(timelineEvents.organizationId, ids.orgA!)),
      );
    const dedupe = events.map((e) => e.dedupeKey).filter(Boolean);
    expect(new Set(dedupe).size).toBe(dedupe.length);
    expect(events.some((e) => e.eventType === "motion_filed")).toBe(true);
    expect(events.some((e) => e.eventType === "motion_ruled")).toBe(true);
    expect(events.some((e) => e.eventType === "meet_and_confer" || e.eventType === "communication_sent")).toBe(
      true,
    );
    expect(events.every((e) => e.eventDate != null)).toBe(true);
  }, 180_000);

  it("handles missing entities safely without inventing replacements", async () => {
    await expect(
      getMatterMotion(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        motionId: "00000000-0000-4000-8000-00000000dead",
      }),
    ).rejects.toBeInstanceOf(MotionsCommunicationsError);

    await expect(
      getMatterCommunication(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        communicationId: "00000000-0000-4000-8000-00000000dead",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    const sparseReview = await loadMatterMotionsCommunicationsReview(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    const sparse = {
      ...sparseReview,
      motions: sparseReview.motions.map((m) =>
        m.id === ids.motionCompel
          ? { ...m, orderDocumentId: null, rulingSummary: null, disposition: null, hearingAt: null }
          : m,
      ),
    };
    const answer = answerMotionsCommunicationsQuestion({
      review: sparse,
      question: "What did the court rule on the motion to compel?",
    });
    expect(answer.motions.every((m) => !m.disposition)).toBe(true);
    expect(answer.predictiveOutcome).toBeNull();
  });

  it("scales list/review/ask/graph planning for 50+ motions and 200+ communications", async () => {
    const tCreate = performance.now();
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
    const createMs = performance.now() - tCreate;

    const tList = performance.now();
    const motions = await listMatterMotions(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    const listMotionMs = performance.now() - tList;
    expect(motions.length).toBeGreaterThanOrEqual(55);

    const tComm = performance.now();
    const communications = await listMatterCommunications(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    const listCommMs = performance.now() - tComm;
    expect(communications.length).toBeGreaterThanOrEqual(212);

    const tReview = performance.now();
    const review = await loadMatterMotionsCommunicationsReview(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    const reviewMs = performance.now() - tReview;
    const tAsk = performance.now();
    const ask = answerMotionsCommunicationsQuestion({
      review,
      question: "What motions are pending?",
    });
    const askMs = performance.now() - tAsk;
    expect(ask.pendingMotionIds.length).toBeGreaterThan(0);

    const tGraph = performance.now();
    const graph = await materializeMotionsCommunicationsGraph({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
    });
    const graphMs = performance.now() - tGraph;
    expect(graph.nodesUpserted).toBeGreaterThan(50);

    console.log(
      JSON.stringify({
        createMs: Math.round(createMs),
        listMotionMs: Math.round(listMotionMs),
        listCommMs: Math.round(listCommMs),
        reviewMs: Math.round(reviewMs),
        askMs: Math.round(askMs),
        graphMs: Math.round(graphMs),
        motions: motions.length,
        communications: communications.length,
      }),
    );

    expect(listMotionMs).toBeLessThan(5_000);
    expect(listCommMs).toBeLessThan(5_000);
    expect(reviewMs).toBeLessThan(8_000);
    expect(askMs).toBeLessThan(1_000);
    expect(graphMs).toBeLessThan(120_000);
  }, 300_000);
});
