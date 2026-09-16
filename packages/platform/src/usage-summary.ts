/**
 * Customer-facing usage rollups from `ai_usage_events` plus org inventory counts.
 * Metadata only: no prompts, document text, or provider dollar charges.
 *
 * Customer counters count USER ACTIONS (distinct usageActionId), not raw model calls.
 * Token totals always sum every model-call row.
 */
import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import {
  aiUsageEvents,
  documentVersions,
  documents,
  matters,
  memberships,
  users,
  type Database,
} from "@nyayagrid/database";

export type UsagePeriodKey = "current" | "previous";

export type UsageFeatureKey =
  | "ask"
  | "research"
  | "draft"
  | "analysis"
  | "compare"
  | "processing"
  | "other";

export type UsagePeriod = {
  key: UsagePeriodKey;
  start: string;
  end: string;
  label: string;
};

export type FeatureUsageCounts = Record<UsageFeatureKey, number>;

export type AiUsageSummary = {
  /** Customer-facing action count (distinct usageActionId, or one per legacy row). */
  modelRequests: number;
  /** Internal: every persisted model-call / usage row. */
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
  totalTokens: number;
  byFeature: FeatureUsageCounts;
  /** True when any row lacks usageActionId (pre-grouping history). */
  hasLegacyActions: boolean;
};

export type MemberUsageRow = {
  email: string;
  name: string | null;
  modelRequests: number;
  inputTokens: number;
  outputTokens: number;
};

export const EMPTY_FEATURE_COUNTS: FeatureUsageCounts = {
  ask: 0,
  research: 0,
  draft: 0,
  analysis: 0,
  compare: 0,
  processing: 0,
  other: 0,
};

export function usagePeriodBounds(
  period: UsagePeriodKey,
  now: Date = new Date(),
): { start: Date; end: Date; label: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const offset = period === "previous" ? -1 : 0;
  const start = new Date(Date.UTC(year, month + offset, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + offset + 1, 1, 0, 0, 0, 0));
  const label = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(start);
  const endLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(end.getTime() - 1));
  return { start, end, label: `${label} – ${endLabel}` };
}

export function toUsagePeriod(period: UsagePeriodKey, now?: Date): UsagePeriod {
  const bounds = usagePeriodBounds(period, now);
  return {
    key: period,
    start: bounds.start.toISOString(),
    end: bounds.end.toISOString(),
    label: bounds.label,
  };
}

export function classifyUsageFeature(capability: string, feature?: string | null): UsageFeatureKey {
  const cap = capability.trim().toLowerCase();
  const f = (feature ?? "").trim().toLowerCase();
  if (f.startsWith("research.") || cap === "research") return "research";
  if (f.startsWith("draft.") || cap === "draft") return "draft";
  if (f.includes("compar")) return "compare";
  if (cap === "embeddings" || f.includes("embed") || f.includes("processing")) return "processing";
  if (cap === "extraction" || f.includes("analysis") || f.startsWith("extraction.")) {
    return "analysis";
  }
  if (f.startsWith("nyaya.") || cap === "qa") return "ask";
  return "other";
}

export type AiUsageEventRowInput = {
  capability: string;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
  usageActionId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Successful customer attempts only. Failed / blocked / unavailable calls stay in
 * modelCalls + tokens for internal telemetry but do not inflate headline usage.
 */
export function isSuccessfulCustomerUsageRow(row: AiUsageEventRowInput): boolean {
  const meta = row.metadata ?? {};
  if (meta.success === false) return false;
  if (typeof meta.finalStatus === "string" && meta.finalStatus !== "ok") return false;
  return true;
}

function resolveUsageActionKey(row: AiUsageEventRowInput, index: number): string {
  if (typeof row.usageActionId === "string" && row.usageActionId.trim()) {
    return `action:${row.usageActionId.trim()}`;
  }
  const metaId = row.metadata?.usageActionId;
  if (typeof metaId === "string" && metaId.trim()) {
    return `action:${metaId.trim()}`;
  }
  return `legacy:${index}`;
}

export function summarizeAiEventRows(rows: AiUsageEventRowInput[]): AiUsageSummary {
  const byFeature: FeatureUsageCounts = { ...EMPTY_FEATURE_COUNTS };
  let inputTokens = 0;
  let outputTokens = 0;
  let embeddingTokens = 0;
  let hasLegacyActions = false;

  type ActionAgg = {
    feature: UsageFeatureKey;
    countable: boolean;
  };
  const actions = new Map<string, ActionAgg>();

  rows.forEach((row, index) => {
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    embeddingTokens += row.embeddingTokens;

    const key = resolveUsageActionKey(row, index);
    if (key.startsWith("legacy:")) hasLegacyActions = true;

    const feature = classifyUsageFeature(
      row.capability,
      typeof row.metadata?.feature === "string" ? row.metadata.feature : null,
    );
    const existing = actions.get(key);
    const success = isSuccessfulCustomerUsageRow(row);
    if (!existing) {
      actions.set(key, { feature, countable: success });
    } else {
      if (success) existing.countable = true;
      // Prefer a non-other feature if a later successful call is more specific.
      if (success && existing.feature === "other" && feature !== "other") {
        existing.feature = feature;
      }
    }
  });

  let modelRequests = 0;
  for (const action of actions.values()) {
    if (!action.countable) continue;
    modelRequests += 1;
    byFeature[action.feature] += 1;
  }

  return {
    modelRequests,
    modelCalls: rows.length,
    inputTokens,
    outputTokens,
    embeddingTokens,
    totalTokens: inputTokens + outputTokens + embeddingTokens,
    byFeature,
    hasLegacyActions,
  };
}

export { formatByteSize, formatTokenCount } from "./usage-format";

type AiEventRow = {
  userId: string;
  capability: string;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
  usageActionId: string | null;
  metadata: Record<string, unknown> | null;
};

async function loadAiEvents(
  db: Database,
  params: { organizationId: string; userId?: string; start: Date; end: Date },
): Promise<AiEventRow[]> {
  const filters = [
    eq(aiUsageEvents.organizationId, params.organizationId),
    gte(aiUsageEvents.createdAt, params.start),
    lt(aiUsageEvents.createdAt, params.end),
  ];
  if (params.userId) filters.push(eq(aiUsageEvents.userId, params.userId));
  return db
    .select({
      userId: aiUsageEvents.userId,
      capability: aiUsageEvents.capability,
      inputTokens: aiUsageEvents.inputTokens,
      outputTokens: aiUsageEvents.outputTokens,
      embeddingTokens: aiUsageEvents.embeddingTokens,
      usageActionId: aiUsageEvents.usageActionId,
      metadata: aiUsageEvents.metadata,
    })
    .from(aiUsageEvents)
    .where(and(...filters));
}

function completenessMessage(ai: AiUsageSummary): string {
  if (ai.modelCalls > 0 && ai.totalTokens === 0) {
    return "Counts include recorded activity in this period only. Token totals were not stored for these calls.";
  }
  if (ai.hasLegacyActions) {
    return "Counts include recorded activity in this period only. Earlier months may be incomplete. Historical usage before action grouping may count each model call as an action.";
  }
  return "Counts include recorded activity in this period only. Earlier months may be incomplete. Nyaya activity is one count per user action; nested model calls, retries, and fallbacks inside an action are not extra requests.";
}

export async function summarizeOrganizationUsage(
  db: Database,
  params: {
    organizationId: string;
    period: UsagePeriodKey;
    /** When set, AI totals are limited to this user (personal usage). */
    userId?: string;
    includeMemberBreakdown?: boolean;
    now?: Date;
  },
) {
  const now = params.now ?? new Date();
  const bounds = usagePeriodBounds(params.period, now);
  const period = toUsagePeriod(params.period, now);
  const events = await loadAiEvents(db, {
    organizationId: params.organizationId,
    userId: params.userId,
    start: bounds.start,
    end: bounds.end,
  });
  const ai = summarizeAiEventRows(events);
  const completeness = completenessMessage(ai);

  let byMember: MemberUsageRow[] | undefined;
  if (params.includeMemberBreakdown && !params.userId) {
    const byUser = new Map<string, AiEventRow[]>();
    for (const row of events) {
      const list = byUser.get(row.userId) ?? [];
      list.push(row);
      byUser.set(row.userId, list);
    }
    const userIds = [...byUser.keys()];
    const profiles =
      userIds.length === 0
        ? []
        : await db
            .select({ id: users.id, email: users.email, name: users.name })
            .from(users)
            .where(inArray(users.id, userIds));
    const profileById = new Map(profiles.map((row) => [row.id, row]));
    byMember = userIds.map((id) => {
      const summary = summarizeAiEventRows(byUser.get(id) ?? []);
      const profile = profileById.get(id);
      return {
        email: profile?.email ?? "Unknown member",
        name: profile?.name ?? null,
        modelRequests: summary.modelRequests,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
      };
    });
    byMember.sort((a, b) => b.modelRequests - a.modelRequests);
  }

  const emptyInventory = {
    documents: { total: 0, uploadedThisPeriod: 0, storageBytes: 0 },
    cases: { active: 0, createdThisPeriod: 0 },
    members: { active: 0 },
  };

  if (params.userId) {
    return {
      period,
      completeness,
      scope: "personal" as const,
      ai,
      documents: emptyInventory.documents,
      cases: emptyInventory.cases,
      members: emptyInventory.members,
    };
  }

  const [documentRow] = await db
    .select({ total: count() })
    .from(documents)
    .where(eq(documents.organizationId, params.organizationId));
  const [uploadsRow] = await db
    .select({ total: count() })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, params.organizationId),
        gte(documents.createdAt, bounds.start),
        lt(documents.createdAt, bounds.end),
      ),
    );
  const versionRows = await db
    .select({
      documentId: documentVersions.documentId,
      versionNumber: documentVersions.versionNumber,
      byteSize: documentVersions.byteSize,
    })
    .from(documentVersions)
    .where(eq(documentVersions.organizationId, params.organizationId));
  const latestBytes = new Map<string, { version: number; bytes: number }>();
  for (const row of versionRows) {
    const current = latestBytes.get(row.documentId);
    if (!current || row.versionNumber > current.version) {
      latestBytes.set(row.documentId, { version: row.versionNumber, bytes: row.byteSize });
    }
  }
  const storageBytes = [...latestBytes.values()].reduce((total, row) => total + row.bytes, 0);

  const [openMatters] = await db
    .select({ total: count() })
    .from(matters)
    .where(
      and(
        eq(matters.organizationId, params.organizationId),
        inArray(matters.status, ["intake", "open", "active", "on_hold"]),
      ),
    );
  const [createdMatters] = await db
    .select({ total: count() })
    .from(matters)
    .where(
      and(
        eq(matters.organizationId, params.organizationId),
        gte(matters.createdAt, bounds.start),
        lt(matters.createdAt, bounds.end),
      ),
    );
  const [seatRow] = await db
    .select({ total: count() })
    .from(memberships)
    .where(
      and(eq(memberships.organizationId, params.organizationId), eq(memberships.status, "active")),
    );

  return {
    period,
    completeness,
    scope: "organization" as const,
    ai,
    byMember,
    documents: {
      total: Number(documentRow?.total ?? 0),
      uploadedThisPeriod: Number(uploadsRow?.total ?? 0),
      storageBytes,
    },
    cases: {
      active: Number(openMatters?.total ?? 0),
      createdThisPeriod: Number(createdMatters?.total ?? 0),
    },
    members: {
      active: Number(seatRow?.total ?? 0),
    },
  };
}

export function designPartnerPlanPresentation() {
  return {
    name: "Design Partner Beta",
    access: "Private preview",
    ai: "Beta fair-use",
    storage: "Beta allocation",
    seats: "Included with preview",
    billingLive: false,
    note: "NyayaGrid is not collecting subscription payment. Client time invoices, if you use them, are on Billing.",
  };
}
