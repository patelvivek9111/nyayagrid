import type { Database, NotificationKind } from "@nyayagrid/database";
import { notifications } from "@nyayagrid/database";

export async function createNotification(
  db: Database,
  input: {
    organizationId: string;
    userId: string;
    kind: NotificationKind;
    title: string;
    body: string;
    href?: string | null;
    matterId?: string | null;
  },
) {
  const [row] = await db
    .insert(notifications)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      href: input.href ?? null,
      matterId: input.matterId ?? null,
    })
    .returning();
  return row;
}
