import type { Database } from "@nyayagrid/database";
import { and, eq, notifications } from "@nyayagrid/database";

export type ProsecutionNotifyKind =
  | "upcoming_hearing"
  | "task_due"
  | "discovery_review"
  | "disclosure_candidate_review"
  | "subpoena_return_due"
  | "motion_deadline"
  | "new_assigned_case"
  | "processing_failure";

const KIND_TO_PLATFORM: Record<ProsecutionNotifyKind, "deadline" | "review_queue"> = {
  upcoming_hearing: "deadline",
  task_due: "deadline",
  discovery_review: "review_queue",
  disclosure_candidate_review: "review_queue",
  subpoena_return_due: "deadline",
  motion_deadline: "deadline",
  new_assigned_case: "review_queue",
  processing_failure: "review_queue",
};

export function mapProsecutionNotifyKind(kind: ProsecutionNotifyKind): "deadline" | "review_queue" {
  return KIND_TO_PLATFORM[kind];
}

/**
 * Creates a functional in-app notification using existing platform kinds.
 * Skips insert when an identical unread notification already exists for the user.
 */
export async function notifyProsecutionEvent(
  db: Database,
  input: {
    organizationId: string;
    userId: string;
    kind: ProsecutionNotifyKind;
    title: string;
    body: string;
    href?: string | null;
    matterId?: string | null;
  },
) {
  const platformKind = KIND_TO_PLATFORM[input.kind];
  const body = `${input.kind}: ${input.body}`;
  const [existing] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, input.organizationId),
        eq(notifications.userId, input.userId),
        eq(notifications.kind, platformKind),
        eq(notifications.title, input.title),
        eq(notifications.body, body),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [row] = await db
    .insert(notifications)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      kind: platformKind,
      title: input.title,
      body,
      href: input.href ?? null,
      matterId: input.matterId ?? null,
    })
    .returning();
  return row;
}
