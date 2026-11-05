import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { auditEvents, type Database } from "@nyayagrid/database";
import { requireCapability } from "@nyayagrid/permissions";
import { ProsecutionError } from "./domain";

export const PROSECUTION_AUDIT_ACTION_PREFIX = "prosecution.";

/** Metadata keys that must never leave the audit browser (secrets / tokens). */
const REDACTED_METADATA_KEYS = new Set([
  "token",
  "password",
  "secret",
  "authorization",
  "accessToken",
  "refreshToken",
  "apiKey",
  "rawPrompt",
  "documentText",
]);

export type ProsecutionAuditEventRow = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorUserId: string | null;
  matterId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type ProsecutionAuditBrowserResult = {
  events: ProsecutionAuditEventRow[];
  page: number;
  pageSize: number;
  total: number;
  canAudit: true;
  safety: {
    convictionRate: null;
    prosecutorPerformanceScore: null;
    guiltOutcomeKpi: null;
    inventedDeadlines: false;
  };
};

export function clampAuditPage(page: number | undefined): number {
  if (!Number.isFinite(page) || page === undefined || page < 1) return 1;
  return Math.floor(page);
}

export function clampAuditPageSize(pageSize: number | undefined): number {
  if (!Number.isFinite(pageSize) || pageSize === undefined) return 25;
  return Math.min(100, Math.max(1, Math.floor(pageSize)));
}

/** Only allow narrowing within the prosecution.* action namespace. */
export function normalizeProsecutionAuditActionFilter(
  raw: string | undefined | null,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.includes("%") || trimmed.includes(";") || trimmed.includes("'")) {
    throw new ProsecutionError("VALIDATION_ERROR", "Invalid action filter.", 400);
  }
  if (trimmed.startsWith(PROSECUTION_AUDIT_ACTION_PREFIX)) {
    const suffix = trimmed.slice(PROSECUTION_AUDIT_ACTION_PREFIX.length);
    if (!suffix || !/^[a-z0-9._-]+$/.test(suffix)) {
      throw new ProsecutionError("VALIDATION_ERROR", "Invalid action filter.", 400);
    }
    return trimmed;
  }
  // Reject other namespaces (e.g. matters.create); allow short suffixes like case_created.
  if (trimmed.includes(".")) {
    throw new ProsecutionError("VALIDATION_ERROR", "Invalid action filter.", 400);
  }
  if (/^[a-z0-9_-]+$/.test(trimmed)) {
    return `${PROSECUTION_AUDIT_ACTION_PREFIX}${trimmed}`;
  }
  throw new ProsecutionError("VALIDATION_ERROR", "Invalid action filter.", 400);
}

export function buildProsecutionAuditSafetyBanner() {
  return {
    convictionRate: null,
    prosecutorPerformanceScore: null,
    guiltOutcomeKpi: null,
    inventedDeadlines: false as const,
  };
}

export function sanitizeProsecutionAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (REDACTED_METADATA_KEYS.has(key)) continue;
    if (/token|secret|password|authorization/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Tenant-scoped prosecution audit listing.
 * Strictly read-only: does not provision roles, reconcile permissions, or write audit rows.
 * Caller must already hold `audit.view` for the organization.
 */
export async function listProsecutionOfficeAuditEvents(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    page?: number;
    pageSize?: number;
    action?: string | null;
    targetType?: string | null;
    targetId?: string | null;
  },
): Promise<ProsecutionAuditBrowserResult> {
  // Authorize before any audit_events read. No role provisioning on this path.
  await requireCapability(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    capability: "audit.view",
  });

  const page = clampAuditPage(params.page);
  const pageSize = clampAuditPageSize(params.pageSize);
  const actionFilter = normalizeProsecutionAuditActionFilter(params.action);
  const targetType = params.targetType?.trim() || null;
  const targetId = params.targetId?.trim() || null;

  const conditions: SQL[] = [
    eq(auditEvents.organizationId, params.organizationId),
    sql`${auditEvents.action} like ${`${PROSECUTION_AUDIT_ACTION_PREFIX}%`}`,
  ];
  if (actionFilter) {
    conditions.push(eq(auditEvents.action, actionFilter));
  }
  if (targetType) {
    conditions.push(eq(auditEvents.targetType, targetType));
  }
  if (targetId) {
    conditions.push(eq(auditEvents.targetId, targetId));
  }
  const where = and(...conditions);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(where);
  const total = Number(countRow?.total ?? 0);

  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      actorUserId: auditEvents.actorUserId,
      matterId: auditEvents.matterId,
      createdAt: auditEvents.createdAt,
      metadata: auditEvents.metadata,
    })
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    events: rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.targetType ?? null,
      targetId: row.targetId ?? null,
      actorUserId: row.actorUserId ?? null,
      matterId: row.matterId ?? null,
      createdAt: row.createdAt.toISOString(),
      metadata: sanitizeProsecutionAuditMetadata((row.metadata ?? {}) as Record<string, unknown>),
    })),
    page,
    pageSize,
    total,
    canAudit: true,
    safety: buildProsecutionAuditSafetyBanner(),
  };
}
