import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { deadlineCandidates, matters, tasks } from "@nyayagrid/database";
import { listAuthorizedMatterIds, requireCapability } from "@nyayagrid/permissions";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

const VERIFIED_DEADLINE_STATUSES = ["approved", "edited_and_approved"] as const;

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const organizationId = new URL(request.url).searchParams.get("organizationId");
    if (!organizationId) return jsonError("VALIDATION_ERROR", "organizationId required", 400);

    await requireCapability(db, {
      userId: user.id,
      organizationId,
      capability: "matters.view",
    });

    const allowed = await listAuthorizedMatterIds(db, { userId: user.id, organizationId });
    if (allowed !== "all" && allowed.length === 0) {
      return jsonOk({ events: [] });
    }

    const matterFilter =
      allowed === "all"
        ? eq(deadlineCandidates.organizationId, organizationId)
        : and(
            eq(deadlineCandidates.organizationId, organizationId),
            inArray(deadlineCandidates.matterId, allowed),
          );

    const taskFilter =
      allowed === "all"
        ? eq(tasks.organizationId, organizationId)
        : and(eq(tasks.organizationId, organizationId), inArray(tasks.matterId, allowed));

    const [deadlines, taskRows, matterRows] = await Promise.all([
      db
        .select()
        .from(deadlineCandidates)
        .where(
          and(
            matterFilter,
            inArray(deadlineCandidates.status, [...VERIFIED_DEADLINE_STATUSES]),
            isNotNull(deadlineCandidates.dueAt),
          ),
        )
        .orderBy(asc(deadlineCandidates.dueAt)),
      db
        .select()
        .from(tasks)
        .where(and(taskFilter, isNotNull(tasks.dueAt)))
        .orderBy(asc(tasks.dueAt)),
      db
        .select({ id: matters.id, title: matters.title, matterNumber: matters.matterNumber })
        .from(matters)
        .where(
          allowed === "all"
            ? eq(matters.organizationId, organizationId)
            : and(eq(matters.organizationId, organizationId), inArray(matters.id, allowed)),
        ),
    ]);

    const titleByMatter = new Map(matterRows.map((m) => [m.id, m]));

    const events = [
      ...deadlines.map((deadline) => ({
        id: deadline.id,
        kind: "deadline" as const,
        title: deadline.title,
        dueAt: deadline.dueAt?.toISOString() ?? null,
        timezone: deadline.timezone,
        matterId: deadline.matterId,
        matterTitle: titleByMatter.get(deadline.matterId)?.title ?? "Case",
        source: "verified_deadline",
      })),
      ...taskRows.map((task) => ({
        id: task.id,
        kind: "task" as const,
        title: task.title,
        dueAt: task.dueAt?.toISOString() ?? null,
        timezone: null,
        matterId: task.matterId,
        matterTitle: titleByMatter.get(task.matterId)?.title ?? "Case",
        source: "task",
      })),
    ].sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));

    return jsonOk({ events });
  } catch (error) {
    return handleRouteError(error);
  }
}
