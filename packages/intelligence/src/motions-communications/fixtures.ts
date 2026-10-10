import type { MatterMotionsCommunicationsReview } from "./postgres";

const provenance = {
  humanEntered: true,
  extractionOrigin: "deterministic_fixture" as const,
};

function ts(iso: string): Date {
  return new Date(iso);
}

/**
 * Deterministic D6 litigation-spine fixture (in-memory review shape).
 * Persisted seeding is performed by runPass6LitigationFixture when a Database is supplied.
 */
export function buildPass6LitigationFixtureReview(params?: {
  organizationId?: string;
  matterId?: string;
}): MatterMotionsCommunicationsReview {
  const organizationId = params?.organizationId ?? "00000000-0000-4000-8000-0000000000a1";
  const matterId = params?.matterId ?? "00000000-0000-4000-8000-0000000000m1";

  const motionId = "00000000-0000-4000-8000-0000000000mo";
  const macCommId = "00000000-0000-4000-8000-0000000000c1";
  const followCommId = "00000000-0000-4000-8000-0000000000c2";
  const claimId = "00000000-0000-4000-8000-0000000000cl";
  const deficiencyId = "00000000-0000-4000-8000-0000000000df";
  const requestItemId = "00000000-0000-4000-8000-0000000000ri";
  const evidenceId = "00000000-0000-4000-8000-0000000000ev";
  const motionDocId = "00000000-0000-4000-8000-0000000000d1";
  const exhibitDocId = "00000000-0000-4000-8000-0000000000d2";
  const oppositionDocId = "00000000-0000-4000-8000-0000000000d3";
  const replyDocId = "00000000-0000-4000-8000-0000000000d4";
  const orderDocId = "00000000-0000-4000-8000-0000000000d5";
  const taskId = "00000000-0000-4000-8000-0000000000tk";

  const baseMotion = {
    organizationId,
    matterId,
    summary: "Motion to compel complete production on RFP-12 cure-notice communications.",
    movingPartyEntityId: null,
    opposingPartyEntityId: null,
    courtName: "Synthetic District Court",
    judgeName: null,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: ts("2025-10-01T12:00:00.000Z"),
    updatedAt: ts("2025-11-20T12:00:00.000Z"),
    provenance,
  };

  return {
    organizationId,
    matterId,
    motions: [
      {
        ...baseMotion,
        id: motionId,
        motionType: "MOTION_TO_COMPEL",
        title: "Motion to Compel — RFP-12",
        status: "GRANTED_IN_PART",
        filedAt: ts("2025-10-15T15:00:00.000Z"),
        servedAt: ts("2025-10-15T18:00:00.000Z"),
        oppositionDueAt: ts("2025-10-29T23:59:00.000Z"),
        oppositionFiledAt: ts("2025-10-28T16:00:00.000Z"),
        replyDueAt: ts("2025-11-05T23:59:00.000Z"),
        replyFiledAt: ts("2025-11-04T14:00:00.000Z"),
        hearingAt: ts("2025-11-12T14:30:00.000Z"),
        rulingAt: ts("2025-11-18T17:00:00.000Z"),
        disposition: "GRANTED_IN_PART",
        rulingSummary:
          "Order grants in part and denies in part; supplemental production of cure-notice attachments required by 2025-12-02.",
        primaryDocumentId: motionDocId,
        orderDocumentId: orderDocId,
      },
      {
        ...baseMotion,
        id: "00000000-0000-4000-8000-0000000000mp",
        motionType: "PROCEDURAL",
        title: "Pending Scheduling Motion (fixture contrast)",
        status: "FILED",
        filedAt: ts("2025-11-01T12:00:00.000Z"),
        servedAt: null,
        oppositionDueAt: null,
        oppositionFiledAt: null,
        replyDueAt: null,
        replyFiledAt: null,
        hearingAt: null,
        rulingAt: null,
        disposition: null,
        rulingSummary: null,
        primaryDocumentId: null,
        orderDocumentId: null,
      },
    ],
    communications: [
      {
        id: macCommId,
        organizationId,
        matterId,
        communicationType: "MEET_AND_CONFER",
        direction: "OUTBOUND",
        status: "SENT",
        occurredAt: ts("2025-09-20T15:00:00.000Z"),
        subject: "Meet-and-confer regarding RFP-12 deficiencies",
        summary:
          "River Co. requested complete production of cure-notice attachments; Acme stated it would supplement.",
        senderEntityId: null,
        recipientEntityId: null,
        primaryDocumentId: null,
        inboundEmailId: null,
        followUpNeeded: true,
        followUpDueAt: ts("2025-09-27T23:59:00.000Z"),
        followUpTaskId: taskId,
        provenance,
        createdByUserId: null,
        updatedByUserId: null,
        createdAt: ts("2025-09-20T15:00:00.000Z"),
        updatedAt: ts("2025-09-20T15:00:00.000Z"),
      },
      {
        id: followCommId,
        organizationId,
        matterId,
        communicationType: "FOLLOW_UP",
        direction: "OUTBOUND",
        status: "SENT",
        occurredAt: ts("2025-10-05T16:00:00.000Z"),
        subject: "Follow-up: incomplete RFP-12 supplement",
        summary: "Supplement remained incomplete; unresolved deficiency preserved for motion practice.",
        senderEntityId: null,
        recipientEntityId: null,
        primaryDocumentId: null,
        inboundEmailId: null,
        followUpNeeded: false,
        followUpDueAt: null,
        followUpTaskId: null,
        provenance,
        createdByUserId: null,
        updatedByUserId: null,
        createdAt: ts("2025-10-05T16:00:00.000Z"),
        updatedAt: ts("2025-10-05T16:00:00.000Z"),
      },
    ],
    motionLinks: [
      {
        id: "00000000-0000-4000-8000-0000000000l1",
        organizationId,
        matterId,
        motionId,
        linkType: "CLAIM",
        targetId: claimId,
        note: "Motion relates to Claim A discovery needed for breach proof; does not dispose Claim A.",
        provenance,
        createdAt: ts("2025-10-15T15:00:00.000Z"),
        updatedAt: ts("2025-10-15T15:00:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-0000000000l2",
        organizationId,
        matterId,
        motionId,
        linkType: "DISCOVERY_DEFICIENCY",
        targetId: deficiencyId,
        note: null,
        provenance,
        createdAt: ts("2025-10-15T15:00:00.000Z"),
        updatedAt: ts("2025-10-15T15:00:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-0000000000l3",
        organizationId,
        matterId,
        motionId,
        linkType: "DISCOVERY_REQUEST_ITEM",
        targetId: requestItemId,
        note: "RFP-12",
        provenance,
        createdAt: ts("2025-10-15T15:00:00.000Z"),
        updatedAt: ts("2025-10-15T15:00:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-0000000000l4",
        organizationId,
        matterId,
        motionId,
        linkType: "EVIDENCE",
        targetId: evidenceId,
        note: "Supporting exhibit association only",
        provenance,
        createdAt: ts("2025-10-15T15:00:00.000Z"),
        updatedAt: ts("2025-10-15T15:00:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-0000000000l5",
        organizationId,
        matterId,
        motionId,
        linkType: "COMMUNICATION",
        targetId: macCommId,
        note: null,
        provenance,
        createdAt: ts("2025-10-15T15:00:00.000Z"),
        updatedAt: ts("2025-10-15T15:00:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-0000000000l6",
        organizationId,
        matterId,
        motionId,
        linkType: "COMMUNICATION",
        targetId: followCommId,
        note: null,
        provenance,
        createdAt: ts("2025-10-15T15:00:00.000Z"),
        updatedAt: ts("2025-10-15T15:00:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-0000000000l7",
        organizationId,
        matterId,
        motionId,
        linkType: "TASK",
        targetId: taskId,
        note: "Follow-up production deadline task",
        provenance,
        createdAt: ts("2025-11-18T17:00:00.000Z"),
        updatedAt: ts("2025-11-18T17:00:00.000Z"),
      },
    ],
    communicationLinks: [
      {
        id: "00000000-0000-4000-8000-0000000000cl1",
        organizationId,
        matterId,
        communicationId: macCommId,
        linkType: "DISCOVERY_DEFICIENCY",
        targetId: deficiencyId,
        note: null,
        provenance,
        createdAt: ts("2025-09-20T15:00:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-0000000000cl2",
        organizationId,
        matterId,
        communicationId: macCommId,
        linkType: "MOTION",
        targetId: motionId,
        note: null,
        provenance,
        createdAt: ts("2025-10-15T15:00:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-0000000000cl3",
        organizationId,
        matterId,
        communicationId: followCommId,
        linkType: "DISCOVERY_DEFICIENCY",
        targetId: deficiencyId,
        note: null,
        provenance,
        createdAt: ts("2025-10-05T16:00:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-0000000000cl4",
        organizationId,
        matterId,
        communicationId: followCommId,
        linkType: "MOTION",
        targetId: motionId,
        note: null,
        provenance,
        createdAt: ts("2025-10-15T15:00:00.000Z"),
      },
    ],
    motionDocuments: [
      {
        id: "00000000-0000-4000-8000-0000000000md1",
        organizationId,
        matterId,
        motionId,
        documentId: motionDocId,
        role: "MOTION",
        sortOrder: 0,
        createdAt: ts("2025-10-15T15:00:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-0000000000md2",
        organizationId,
        matterId,
        motionId,
        documentId: exhibitDocId,
        role: "EXHIBIT",
        sortOrder: 1,
        createdAt: ts("2025-10-15T15:00:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-0000000000md3",
        organizationId,
        matterId,
        motionId,
        documentId: oppositionDocId,
        role: "OPPOSITION",
        sortOrder: 2,
        createdAt: ts("2025-10-28T16:00:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-0000000000md4",
        organizationId,
        matterId,
        motionId,
        documentId: replyDocId,
        role: "REPLY",
        sortOrder: 3,
        createdAt: ts("2025-11-04T14:00:00.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-0000000000md5",
        organizationId,
        matterId,
        motionId,
        documentId: orderDocId,
        role: "ORDER",
        sortOrder: 4,
        createdAt: ts("2025-11-18T17:00:00.000Z"),
      },
    ],
  };
}

export function runPass6LitigationFixture() {
  const review = buildPass6LitigationFixtureReview();
  return {
    review,
    ids: {
      motionCompel: review.motions[0]!.id,
      motionPending: review.motions[1]!.id,
      macComm: review.communications[0]!.id,
      followComm: review.communications[1]!.id,
      claimId: review.motionLinks.find((l) => l.linkType === "CLAIM")!.targetId,
      deficiencyId: review.motionLinks.find((l) => l.linkType === "DISCOVERY_DEFICIENCY")!.targetId,
      evidenceId: review.motionLinks.find((l) => l.linkType === "EVIDENCE")!.targetId,
    },
  };
}
