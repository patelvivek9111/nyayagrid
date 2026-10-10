import { and, eq } from "drizzle-orm";
import { timelineEvents, type Database } from "@nyayagrid/database";
import { requireMatterAccess } from "@nyayagrid/permissions";
import {
  loadMatterMotionsCommunicationsReview,
  type MatterMotionsCommunicationsReview,
} from "./postgres";

export type MotionsCommsTimelineEventPlan = {
  dedupeKey: string;
  title: string;
  description: string;
  eventType: string;
  eventDate: Date;
  datePrecision: "exact";
};

/** Deterministic timeline events from persisted motion/communication dates only. */
export function planMotionsCommunicationsTimelineEvents(
  review: MatterMotionsCommunicationsReview,
): MotionsCommsTimelineEventPlan[] {
  const events: MotionsCommsTimelineEventPlan[] = [];

  for (const motion of review.motions) {
    if (motion.filedAt) {
      events.push({
        dedupeKey: `motion:${motion.id}:filed`,
        title: `Motion filed: ${motion.title}`,
        description: `${motion.motionType} status=${motion.status}`,
        eventType: "motion_filed",
        eventDate: motion.filedAt,
        datePrecision: "exact",
      });
    }
    if (motion.servedAt) {
      events.push({
        dedupeKey: `motion:${motion.id}:served`,
        title: `Motion served: ${motion.title}`,
        description: motion.motionType,
        eventType: "motion_served",
        eventDate: motion.servedAt,
        datePrecision: "exact",
      });
    }
    if (motion.oppositionFiledAt) {
      events.push({
        dedupeKey: `motion:${motion.id}:opposition_filed`,
        title: `Opposition filed: ${motion.title}`,
        description: "Opposition filed (source-backed date)",
        eventType: "motion_opposition_filed",
        eventDate: motion.oppositionFiledAt,
        datePrecision: "exact",
      });
    }
    if (motion.replyFiledAt) {
      events.push({
        dedupeKey: `motion:${motion.id}:reply_filed`,
        title: `Reply filed: ${motion.title}`,
        description: "Reply filed (source-backed date)",
        eventType: "motion_reply_filed",
        eventDate: motion.replyFiledAt,
        datePrecision: "exact",
      });
    }
    if (motion.hearingAt) {
      events.push({
        dedupeKey: `motion:${motion.id}:hearing`,
        title: `Hearing: ${motion.title}`,
        description: "Hearing scheduled (source-backed date)",
        eventType: "motion_hearing",
        eventDate: motion.hearingAt,
        datePrecision: "exact",
      });
    }
    if (motion.rulingAt) {
      events.push({
        dedupeKey: `motion:${motion.id}:ruled`,
        title: `Motion ruled: ${motion.title}`,
        description: `disposition=${motion.disposition ?? "unknown"}; ${motion.rulingSummary ?? ""}`.trim(),
        eventType: "motion_ruled",
        eventDate: motion.rulingAt,
        datePrecision: "exact",
      });
    }
  }

  for (const comm of review.communications) {
    if (!comm.occurredAt) continue;
    const inbound = comm.direction === "INBOUND";
    events.push({
      dedupeKey: `communication:${comm.id}:occurred`,
      title: inbound
        ? `Communication received: ${comm.subject}`
        : `Communication sent: ${comm.subject}`,
      description: `${comm.communicationType}; ${comm.summary ?? ""}`.trim(),
      eventType:
        comm.communicationType === "MEET_AND_CONFER"
          ? "meet_and_confer"
          : inbound
            ? "communication_received"
            : "communication_sent",
      eventDate: comm.occurredAt,
      datePrecision: "exact",
    });
    if (comm.followUpDueAt) {
      events.push({
        dedupeKey: `communication:${comm.id}:follow_up_due`,
        title: `Follow-up due: ${comm.subject}`,
        description: "Explicit follow-up due date",
        eventType: "communication_follow_up_due",
        eventDate: comm.followUpDueAt,
        datePrecision: "exact",
      });
    }
  }

  return events;
}

export async function materializeMotionsCommunicationsTimeline(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
}): Promise<{ eventsUpserted: number; plan: MotionsCommsTimelineEventPlan[] }> {
  await requireMatterAccess(params.db, {
    userId: params.userId,
    matterId: params.matterId,
    minAccess: "edit",
    capability: "matters.edit",
  });
  const review = await loadMatterMotionsCommunicationsReview(params.db, {
    userId: params.userId,
    organizationId: params.organizationId,
    matterId: params.matterId,
  });
  const plan = planMotionsCommunicationsTimelineEvents(review);
  let eventsUpserted = 0;

  for (const event of plan) {
    const [existing] = await params.db
      .select({ id: timelineEvents.id })
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.matterId, params.matterId),
          eq(timelineEvents.organizationId, params.organizationId),
          eq(timelineEvents.dedupeKey, event.dedupeKey),
        ),
      )
      .limit(1);
    if (existing) {
      await params.db
        .update(timelineEvents)
        .set({
          title: event.title,
          description: event.description,
          eventType: event.eventType,
          eventDate: event.eventDate,
          datePrecision: event.datePrecision,
          updatedAt: new Date(),
        })
        .where(eq(timelineEvents.id, existing.id));
    } else {
      await params.db.insert(timelineEvents).values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        title: event.title,
        description: event.description,
        eventType: event.eventType,
        eventDate: event.eventDate,
        datePrecision: event.datePrecision,
        status: "approved",
        confidence: "high",
        origin: "manual",
        dedupeKey: event.dedupeKey,
        createdByUserId: params.userId,
        approvedByUserId: params.userId,
        approvedAt: new Date(),
      });
    }
    eventsUpserted += 1;
  }

  return { eventsUpserted, plan };
}
