import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  index,
  jsonb,
  integer,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, users, roles, matters, documents } from "./index";
import { agentRuns } from "./phase7";

/**
 * Phase 9 — production readiness: joining an organization, accounting for AI spend, holding data for
 * litigation, deleting it on request, flagging features, and recording what a firm has paid for.
 *
 * These tables are operational rather than legal-substantive: none of them holds matter content, and
 * none of them is a source an AI answer may cite. Two of them are compliance records that outrank
 * convenience — `legal_holds` blocks deletion, and `data_deletion_requests` is the audit trail
 * proving a deletion request was handled — so both are written to be readable years later by someone
 * who was not here.
 */

export const dataDeletionRequestStatusEnum = pgEnum("data_deletion_request_status", [
  "pending",
  "scheduled",
  "completed",
  "rejected",
  "cancelled",
]);

export const organizationSubscriptionStatusEnum = pgEnum("organization_subscription_status", [
  "active",
  "trialing",
  "past_due",
  "canceled",
]);

export type DataDeletionRequestStatus = (typeof dataDeletionRequestStatusEnum.enumValues)[number];
export type OrganizationSubscriptionStatus =
  (typeof organizationSubscriptionStatusEnum.enumValues)[number];

/** Workspace an operational row belongs to. Matches the product's three workspaces. */
export type OperationalWorkspace = "professional" | "student" | "public";

/**
 * Plan overrides stored per organization, merged over the plan baseline in @nyayagrid/platform.
 * Kept structural here so the database package stays free of billing logic.
 */
export type OrganizationEntitlements = {
  features?: Record<string, boolean>;
  limits?: Record<string, number>;
};

/** What a deletion request covers. Interpreted by the lifecycle worker, never by an AI provider. */
export type DataDeletionScope = {
  workspaces?: OperationalWorkspace[];
  matterIds?: string[];
  documentIds?: string[];
  includeAuditEvents?: boolean;
  note?: string;
};

/**
 * Pending invitations into an organization.
 *
 * Only the SHA-256 of the invite token is stored, so a database reader — including a backup or a log
 * shipped elsewhere — cannot mint a working invitation. Acceptance requires presenting the token,
 * which is why an email address matching an existing invite is never enough on its own to join a
 * firm; see acceptOrganizationInvite in @nyayagrid/auth.
 *
 * The row is the state machine: `accepted_at` makes it single-use, `revoked_at` withdraws it, and
 * `expires_at` bounds it. None of the three is ever cleared, so the history of who was invited to a
 * firm and what happened stays intact.
 */
export const organizationInvites = pgTable(
  "organization_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** The role the invitee receives on acceptance. Restricted so a role in use cannot be deleted. */
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_invites_token_hash_uidx").on(table.tokenHash),
    index("organization_invites_organization_idx").on(table.organizationId),
    index("organization_invites_email_idx").on(table.email),
    /*
     * No unique constraint on (organization_id, email): expiry cannot be expressed in an index
     * predicate, so a constraint on "not accepted and not revoked" would make a stale expired
     * invitation permanently block re-inviting that person. createOrganizationInvite revokes any
     * outstanding invitation for the address instead, which keeps one live invite per address and
     * leaves the superseded rows readable.
     */
  ],
);

/**
 * One row per model call: what ran, for whom, and roughly what it cost.
 *
 * Token counts and identifiers only. Prompts, completions and document text must never be written
 * here — @nyayagrid/platform strips content-bearing keys from `metadata` before insert — because this
 * table is read by billing and support, which is a wider audience than matter data allows.
 *
 * `estimated_cost_cents` is an estimate from a recorded list price and is never authoritative for
 * invoicing.
 */
export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Null for the student and public workspaces, which have no organization by design. */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "cascade" }),
    workspace: text("workspace").$type<OperationalWorkspace>().notNull(),
    /** Capability from @nyayagrid/platform: qa, extraction, draft, research, agents, professor, guide, embeddings. */
    capability: text("capability").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    embeddingTokens: integer("embedding_tokens").notNull().default(0),
    estimatedCostCents: integer("estimated_cost_cents"),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ai_usage_events_organization_idx").on(table.organizationId),
    index("ai_usage_events_user_idx").on(table.userId),
    index("ai_usage_events_created_at_idx").on(table.createdAt),
    index("ai_usage_events_matter_idx").on(table.matterId),
    index("ai_usage_events_agent_run_idx").on(table.agentRunId),
  ],
);

/**
 * Litigation hold. While a hold is unreleased, the data it covers must survive retention policies,
 * user deletion requests and routine cleanup: spoliation is a sanctionable event, so a hold outranks
 * every automatic deletion path in the system.
 *
 * A hold may cover a whole organization (both optional columns null), a matter, or a single document.
 * `placed_by_user_id` and `released_by_user_id` have no ON DELETE action on purpose — a user row
 * cannot be removed while it is the record of who placed a hold.
 */
export const legalHolds = pgTable(
  "legal_holds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    placedByUserId: uuid("placed_by_user_id")
      .notNull()
      .references(() => users.id),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedByUserId: uuid("released_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("legal_holds_organization_idx").on(table.organizationId),
    index("legal_holds_matter_idx").on(table.matterId),
    index("legal_holds_document_idx").on(table.documentId),
    /** Supports the "is anything holding this?" check that every deletion path must run first. */
    index("legal_holds_active_idx")
      .on(table.organizationId)
      .where(sql`${table.releasedAt} IS NULL`),
  ],
);

/**
 * A request to delete data, and the record that it was handled.
 *
 * Deliberately not a delete: the request is reviewed, may be refused (an active legal hold is a valid
 * refusal), and is scheduled rather than executed inline. Keeping the request after completion is
 * what lets the organization show, later, that the request arrived and what was done about it.
 */
export const dataDeletionRequests = pgTable(
  "data_deletion_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Null for student and public workspace requests, which are user-scoped. */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    workspace: text("workspace").$type<OperationalWorkspace>().notNull(),
    scope: jsonb("scope")
      .$type<DataDeletionScope>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: dataDeletionRequestStatusEnum("status").notNull().default("pending"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("data_deletion_requests_organization_idx").on(table.organizationId),
    index("data_deletion_requests_user_idx").on(table.userId),
    index("data_deletion_requests_status_idx").on(table.status),
  ],
);

/**
 * Per-organization (or global, when `organization_id` is null) feature flag overrides layered on the
 * environment baseline in @nyayagrid/platform.
 *
 * A flag is not permission. Enabling one here makes a code path available in this deployment; it does
 * not grant any user access to any matter, and unknown keys are ignored by the resolver so a stale
 * row cannot enable something this build does not implement.
 */
export const featureFlagOverrides = pgTable(
  "feature_flag_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    flagKey: text("flag_key").notNull(),
    enabled: boolean("enabled").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    /*
     * Two partial unique indexes rather than one composite: Postgres treats NULLs as distinct, so a
     * plain unique on (organization_id, flag_key) would allow many conflicting global overrides.
     */
    uniqueIndex("feature_flag_overrides_org_flag_uidx")
      .on(table.organizationId, table.flagKey)
      .where(sql`${table.organizationId} IS NOT NULL`),
    uniqueIndex("feature_flag_overrides_global_flag_uidx")
      .on(table.flagKey)
      .where(sql`${table.organizationId} IS NULL`),
    index("feature_flag_overrides_organization_idx").on(table.organizationId),
  ],
);

/**
 * What an organization has paid for. Read by the billing provider in @nyayagrid/platform to answer
 * entitlement questions about optional capabilities.
 *
 * This row never controls access to matters or documents. A `past_due` or `canceled` subscription
 * withdraws the paid extras and nothing else: a firm must always be able to read, export and work its
 * own client files.
 */
export const organizationSubscriptions = pgTable(
  "organization_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planKey: text("plan_key").notNull(),
    status: organizationSubscriptionStatusEnum("status").notNull().default("active"),
    /** Negotiated overrides merged over the plan baseline; `{}` means "exactly the plan". */
    entitlements: jsonb("entitlements")
      .$type<OrganizationEntitlements>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Identifier at the payment processor. No card data is ever stored in this database. */
    externalCustomerId: text("external_customer_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_subscriptions_organization_uidx").on(table.organizationId),
    index("organization_subscriptions_status_idx").on(table.status),
  ],
);

export type OrganizationInvite = typeof organizationInvites.$inferSelect;
export type AiUsageEvent = typeof aiUsageEvents.$inferSelect;
export type LegalHold = typeof legalHolds.$inferSelect;
export type DataDeletionRequest = typeof dataDeletionRequests.$inferSelect;
export type FeatureFlagOverride = typeof featureFlagOverrides.$inferSelect;
export type OrganizationSubscription = typeof organizationSubscriptions.$inferSelect;
