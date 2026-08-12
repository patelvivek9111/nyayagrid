-- Phase 9 — production readiness.
--
-- Adds the operational tables that a real deployment needs and that no earlier phase provided:
-- joining an organization by invitation, accounting for AI spend, holding data for litigation,
-- handling deletion requests, overriding feature flags, and recording what a firm has paid for.
--
-- None of these tables holds matter content, and none is a source an AI answer may cite.

CREATE TYPE "public"."data_deletion_request_status" AS ENUM('pending', 'scheduled', 'completed', 'rejected', 'cancelled');
CREATE TYPE "public"."organization_subscription_status" AS ENUM('active', 'trialing', 'past_due', 'canceled');

-- Pending invitations into an organization. Only the SHA-256 of the token is stored, so a database
-- reader, a backup copy or a shipped log cannot mint a working invitation. Acceptance requires
-- presenting the token: a matching email address alone never joins someone to a firm.
--
-- There is deliberately no unique constraint on (organization_id, email). Expiry cannot appear in an
-- index predicate, so a constraint over "not accepted and not revoked" would let one stale expired
-- invitation permanently block re-inviting that person. createOrganizationInvite revokes any
-- outstanding invitation for the address instead.

CREATE TABLE "organization_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "email" text NOT NULL,
  "role_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "invited_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "organization_invites_token_hash_uidx" ON "organization_invites" ("token_hash");
CREATE INDEX "organization_invites_organization_idx" ON "organization_invites" ("organization_id");
CREATE INDEX "organization_invites_email_idx" ON "organization_invites" ("email");
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_role_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_invited_by_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

-- One row per model call. Token counts and identifiers only: prompts, completions and document text
-- must never be written here, because billing and support read this table and that is a wider
-- audience than matter data allows. estimated_cost_cents is derived from a recorded list price and is
-- never authoritative for invoicing.

CREATE TABLE "ai_usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid,
  "user_id" uuid NOT NULL,
  "matter_id" uuid,
  "workspace" text NOT NULL,
  "capability" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "embedding_tokens" integer DEFAULT 0 NOT NULL,
  "estimated_cost_cents" integer,
  "agent_run_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "ai_usage_events_organization_idx" ON "ai_usage_events" ("organization_id");
CREATE INDEX "ai_usage_events_user_idx" ON "ai_usage_events" ("user_id");
CREATE INDEX "ai_usage_events_created_at_idx" ON "ai_usage_events" ("created_at");
CREATE INDEX "ai_usage_events_matter_idx" ON "ai_usage_events" ("matter_id");
CREATE INDEX "ai_usage_events_agent_run_idx" ON "ai_usage_events" ("agent_run_id");
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_agent_run_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;

-- Litigation hold. While a hold is unreleased, the data it covers must survive retention policies,
-- user deletion requests and routine cleanup — spoliation is sanctionable, so a hold outranks every
-- automatic deletion path in the system. A hold covers the organization (both optional columns null),
-- a matter, or a single document.
--
-- placed_by_user_id and released_by_user_id have no ON DELETE action on purpose: a user row cannot be
-- removed while it is the record of who placed or lifted a hold.

CREATE TABLE "legal_holds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid,
  "document_id" uuid,
  "reason" text NOT NULL,
  "placed_by_user_id" uuid NOT NULL,
  "released_at" timestamp with time zone,
  "released_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "legal_holds_organization_idx" ON "legal_holds" ("organization_id");
CREATE INDEX "legal_holds_matter_idx" ON "legal_holds" ("matter_id");
CREATE INDEX "legal_holds_document_idx" ON "legal_holds" ("document_id");
CREATE INDEX "legal_holds_active_idx" ON "legal_holds" ("organization_id") WHERE "released_at" IS NULL;
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_placed_by_fk" FOREIGN KEY ("placed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_released_by_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

-- A request to delete data, and the record that it was handled. Deliberately not a delete: the
-- request is reviewed, may be refused (an active legal hold is a valid refusal), and is scheduled
-- rather than executed inline. The row survives completion so the organization can show later that
-- the request arrived and what was done about it.

CREATE TABLE "data_deletion_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid,
  "user_id" uuid NOT NULL,
  "workspace" text NOT NULL,
  "scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" "data_deletion_request_status" DEFAULT 'pending' NOT NULL,
  "scheduled_for" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "data_deletion_requests_organization_idx" ON "data_deletion_requests" ("organization_id");
CREATE INDEX "data_deletion_requests_user_idx" ON "data_deletion_requests" ("user_id");
CREATE INDEX "data_deletion_requests_status_idx" ON "data_deletion_requests" ("status");
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

-- Feature flag overrides layered on the environment baseline. A flag is not permission: enabling one
-- makes a code path available in this deployment and grants no user access to any matter. Unknown
-- keys are ignored by the resolver, so a stale row cannot enable something this build lacks.
--
-- Two partial unique indexes rather than one composite: Postgres treats NULLs as distinct, so a plain
-- unique on (organization_id, flag_key) would allow many conflicting global overrides.

CREATE TABLE "feature_flag_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid,
  "flag_key" text NOT NULL,
  "enabled" boolean NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "feature_flag_overrides_org_flag_uidx" ON "feature_flag_overrides" ("organization_id", "flag_key") WHERE "organization_id" IS NOT NULL;
CREATE UNIQUE INDEX "feature_flag_overrides_global_flag_uidx" ON "feature_flag_overrides" ("flag_key") WHERE "organization_id" IS NULL;
CREATE INDEX "feature_flag_overrides_organization_idx" ON "feature_flag_overrides" ("organization_id");
ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

-- What an organization has paid for. Read only to answer entitlement questions about optional
-- capabilities. This row never controls access to matters or documents: a past_due or canceled
-- subscription withdraws the paid extras and nothing else, because a firm must always be able to
-- read, export and work its own client files. No card data is ever stored here.

CREATE TABLE "organization_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "plan_key" text NOT NULL,
  "status" "organization_subscription_status" DEFAULT 'active' NOT NULL,
  "entitlements" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "external_customer_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "organization_subscriptions_organization_uidx" ON "organization_subscriptions" ("organization_id");
CREATE INDEX "organization_subscriptions_status_idx" ON "organization_subscriptions" ("status");
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

-- Tenant-scoped indexes missed by earlier phases.
--
-- Every one of these tables carries organization_id for isolation but was only indexed by matter_id,
-- which is fine for a matter page and wrong for the two Phase 9 operations that walk a whole tenant:
-- enumerating what a legal hold covers, and enumerating what a deletion request must remove. IF NOT
-- EXISTS so this section stays safe to re-run against a database that already has them.

CREATE INDEX IF NOT EXISTS "messages_organization_idx" ON "messages" ("organization_id");
CREATE INDEX IF NOT EXISTS "matter_facts_organization_idx" ON "matter_facts" ("organization_id");
CREATE INDEX IF NOT EXISTS "matter_entities_organization_idx" ON "matter_entities" ("organization_id");
CREATE INDEX IF NOT EXISTS "deadline_candidates_organization_idx" ON "deadline_candidates" ("organization_id");
CREATE INDEX IF NOT EXISTS "matter_summaries_organization_idx" ON "matter_summaries" ("organization_id");
CREATE INDEX IF NOT EXISTS "document_intelligence_runs_organization_idx" ON "document_intelligence_runs" ("organization_id");
-- Audit review is always "recent activity, newest first"; without this it is a full scan plus a sort.
CREATE INDEX IF NOT EXISTS "audit_events_created_at_idx" ON "audit_events" ("created_at" DESC);

/*
 * Row-level security: deliberately not enabled here.
 *
 * Tenant isolation today is enforced in application code — every query path goes through
 * @nyayagrid/permissions, which resolves membership and capabilities before a matter, document or
 * chunk is read, and storage keys are prefixed per organization and asserted on access. Turning on
 * RLS now would add a second, weaker enforcement layer rather than a stronger one, because this
 * application connects as the schema owner and a single BYPASSRLS or table-owner connection makes
 * every policy advisory. Policies also cannot express matter-level access, which is where the real
 * boundary lives: two members of the same firm legitimately see different matters.
 *
 * Enabling RLS properly is its own migration and its own operational change, and it needs all of:
 *   1. A non-owner application role with NOBYPASSRLS, and FORCE ROW LEVEL SECURITY on each table.
 *   2. A request-scoped tenant setting (SET LOCAL app.organization_id) established inside the same
 *      transaction as every query, which the current connection pooling does not guarantee.
 *   3. Policies for matter-level access, not just organization-level, or it will silently be weaker
 *      than the checks it appears to replace.
 *   4. Integration tests proving a policy denies what the application layer denies, so the two
 *      cannot drift apart.
 *
 * Compensating controls in place meanwhile: mandatory server-side capability checks, default-deny
 * matter access (no matter_members row means no access), organization-prefixed storage keys with an
 * assertion on every read, and an append-only audit_events trail. The illustrative policy below is
 * intentionally left commented out; do not uncomment it without items 1-4 above.
 *
 * -- ALTER TABLE "matters" ENABLE ROW LEVEL SECURITY;
 * -- ALTER TABLE "matters" FORCE ROW LEVEL SECURITY;
 * -- CREATE POLICY "matters_tenant_isolation" ON "matters"
 * --   USING ("organization_id" = current_setting('app.organization_id', true)::uuid);
 */
