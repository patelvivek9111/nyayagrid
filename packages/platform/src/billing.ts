/**
 * Phase 9 — plans and entitlements.
 *
 * An entitlement answers "has this organization paid for this optional capability?". It is a
 * commercial question and is kept strictly separate from authorization: `hasEntitlement` never
 * decides who may open a matter, read a document or see an audit log. Those are capability checks in
 * @nyayagrid/permissions, and no billing state changes them.
 *
 * The consequence is deliberate. A firm whose card fails must still be able to read its own matters,
 * export its documents and meet a filing deadline; losing access to client files over an invoice
 * would be a professional-responsibility problem, not a growth lever. So entitlements gate only the
 * optional, cost-bearing extras — agent runs, research volume, OCR, expensive models — and never the
 * record itself.
 */
import { eq } from "drizzle-orm";
import { organizationSubscriptions, type Database } from "@nyayagrid/database";
import { getAppEnv, type EnvSource } from "./config";

export const PLAN_KEYS = ["free", "solo", "firm"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const ENTITLEMENT_KEYS = [
  "agent_runs",
  "research",
  "ocr",
  "expensive_ai",
  "professor",
  "guide",
  "client_portal",
] as const;
export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

export const ENTITLEMENT_LIMIT_KEYS = [
  "seats",
  "storage_gb",
  "monthly_agent_runs",
  "monthly_research_queries",
] as const;
export type EntitlementLimitKey = (typeof ENTITLEMENT_LIMIT_KEYS)[number];

export type Entitlements = {
  features: Partial<Record<EntitlementKey, boolean>>;
  limits: Partial<Record<EntitlementLimitKey, number>>;
};

export const SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "canceled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Only these statuses grant the paid extras. `past_due` and `canceled` fall back to the free plan. */
const ENTITLING_STATUSES: readonly SubscriptionStatus[] = ["active", "trialing"];

export const PLAN_ENTITLEMENTS: Record<PlanKey, Entitlements> = {
  free: {
    features: { professor: true, guide: true },
    limits: { seats: 1, storage_gb: 1 },
  },
  solo: {
    features: { research: true, professor: true, guide: true, ocr: true },
    limits: { seats: 1, storage_gb: 25, monthly_research_queries: 200 },
  },
  firm: {
    features: {
      agent_runs: true,
      research: true,
      ocr: true,
      expensive_ai: true,
      professor: true,
      guide: true,
      client_portal: true,
    },
    limits: {
      seats: 25,
      storage_gb: 500,
      monthly_agent_runs: 500,
      monthly_research_queries: 2000,
    },
  },
};

export function isPlanKey(value: string): value is PlanKey {
  return (PLAN_KEYS as readonly string[]).includes(value);
}

export type SubscriptionView = {
  organizationId: string;
  planKey: string;
  status: SubscriptionStatus;
  entitlements: Entitlements;
  externalCustomerId: string | null;
};

export type EntitlementReason =
  | "development_provider"
  | "plan_includes"
  | "plan_excludes"
  | "no_subscription"
  | "subscription_not_entitling"
  | "unknown_plan";

export type EntitlementDecision = {
  entitled: boolean;
  reason: EntitlementReason;
  planKey: string | null;
  status: SubscriptionStatus | null;
  limit: number | null;
};

export interface BillingProvider {
  readonly name: string;
  getSubscription(organizationId: string): Promise<SubscriptionView | null>;
  hasEntitlement(organizationId: string, key: EntitlementKey): Promise<EntitlementDecision>;
  getLimit(organizationId: string, key: EntitlementLimitKey): Promise<number | null>;
}

/**
 * Merges a stored per-organization override on top of the plan baseline, which is how a negotiated
 * deal or a support grant is represented without inventing a new plan.
 */
export function resolveEntitlements(
  planKey: string,
  overrides?: Partial<Entitlements> | null,
): Entitlements {
  const base = isPlanKey(planKey) ? PLAN_ENTITLEMENTS[planKey] : { features: {}, limits: {} };
  return {
    features: { ...base.features, ...(overrides?.features ?? {}) },
    limits: { ...base.limits, ...(overrides?.limits ?? {}) },
  };
}

/**
 * Grants everything, for local development and tests only.
 *
 * Refuses to be constructed in production: the configuration gate already rejects
 * `BILLING_PROVIDER=development` there, and this is the second lock so a hand-wired instance cannot
 * hand out paid capacity in a real deployment.
 */
export class DevelopmentBillingProvider implements BillingProvider {
  readonly name = "development";

  constructor(env: EnvSource = process.env) {
    if (getAppEnv(env) === "production") {
      throw new Error(
        "DevelopmentBillingProvider grants every entitlement and must not be used in production. Set BILLING_PROVIDER=database.",
      );
    }
  }

  async getSubscription(organizationId: string): Promise<SubscriptionView> {
    return {
      organizationId,
      planKey: "firm",
      status: "active",
      entitlements: PLAN_ENTITLEMENTS.firm,
      externalCustomerId: null,
    };
  }

  async hasEntitlement(): Promise<EntitlementDecision> {
    return {
      entitled: true,
      reason: "development_provider",
      planKey: "firm",
      status: "active",
      limit: null,
    };
  }

  async getLimit(): Promise<number | null> {
    return null;
  }
}

/**
 * Reads `organization_subscriptions`. An organization with no row is treated as the free plan rather
 * than as an error, so a firm created before billing existed keeps working with the free feature set.
 */
export class DatabaseBillingProvider implements BillingProvider {
  readonly name = "database";

  constructor(private readonly db: Database) {}

  async getSubscription(organizationId: string): Promise<SubscriptionView | null> {
    const [row] = await this.db
      .select()
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, organizationId))
      .limit(1);
    if (!row) return null;
    return {
      organizationId: row.organizationId,
      planKey: row.planKey,
      status: row.status,
      entitlements: resolveEntitlements(row.planKey, row.entitlements),
      externalCustomerId: row.externalCustomerId,
    };
  }

  async hasEntitlement(organizationId: string, key: EntitlementKey): Promise<EntitlementDecision> {
    const subscription = await this.getSubscription(organizationId);
    if (!subscription) {
      const free = PLAN_ENTITLEMENTS.free;
      return {
        entitled: free.features[key] === true,
        reason: free.features[key] === true ? "plan_includes" : "no_subscription",
        planKey: "free",
        status: null,
        limit: null,
      };
    }

    if (!ENTITLING_STATUSES.includes(subscription.status)) {
      const free = PLAN_ENTITLEMENTS.free;
      return {
        entitled: free.features[key] === true,
        reason: free.features[key] === true ? "plan_includes" : "subscription_not_entitling",
        planKey: subscription.planKey,
        status: subscription.status,
        limit: null,
      };
    }

    const entitled = subscription.entitlements.features[key] === true;
    return {
      entitled,
      reason: entitled
        ? "plan_includes"
        : isPlanKey(subscription.planKey)
          ? "plan_excludes"
          : "unknown_plan",
      planKey: subscription.planKey,
      status: subscription.status,
      limit: null,
    };
  }

  async getLimit(organizationId: string, key: EntitlementLimitKey): Promise<number | null> {
    const subscription = await this.getSubscription(organizationId);
    const entitlements = subscription
      ? ENTITLING_STATUSES.includes(subscription.status)
        ? subscription.entitlements
        : PLAN_ENTITLEMENTS.free
      : PLAN_ENTITLEMENTS.free;
    return entitlements.limits[key] ?? null;
  }
}

export class EntitlementRequiredError extends Error {
  readonly code = "ENTITLEMENT_REQUIRED";
  readonly entitlement: EntitlementKey;

  constructor(entitlement: EntitlementKey, message?: string) {
    super(message ?? `This organization's plan does not include ${entitlement}`);
    this.name = "EntitlementRequiredError";
    this.entitlement = entitlement;
  }
}

/**
 * Throws when the plan does not cover the capability. Call this *after* the capability check, never
 * instead of it: a paid plan is not permission, and an unpaid plan is not a reason to hide a matter
 * from the people who own it.
 */
export async function requireEntitlement(
  provider: BillingProvider,
  organizationId: string,
  key: EntitlementKey,
): Promise<EntitlementDecision> {
  const decision = await provider.hasEntitlement(organizationId, key);
  if (!decision.entitled) throw new EntitlementRequiredError(key);
  return decision;
}

export function createBillingProviderFromEnv(
  db: Database,
  env: EnvSource = process.env,
): BillingProvider {
  const configured = env.BILLING_PROVIDER?.trim().toLowerCase() ?? "development";
  if (configured === "database") return new DatabaseBillingProvider(db);
  if (configured === "development") return new DevelopmentBillingProvider(env);
  throw new Error(
    `BILLING_PROVIDER=${configured} is not implemented. Use "database" or, locally, "development".`,
  );
}
