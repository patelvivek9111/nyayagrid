-- P7 — separately recorded training-consent audit rows.
-- No active row means no consent. This table does not turn on a training pipeline.

CREATE TABLE "training_consents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "recorded_by_user_id" uuid NOT NULL,
  "statement" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "withdrawn_at" timestamp with time zone,
  "withdrawn_by_user_id" uuid
);
CREATE INDEX "training_consents_organization_idx" ON "training_consents" ("organization_id");
CREATE INDEX "training_consents_active_idx" ON "training_consents" ("organization_id") WHERE "withdrawn_at" IS NULL;
ALTER TABLE "training_consents" ADD CONSTRAINT "training_consents_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "training_consents" ADD CONSTRAINT "training_consents_recorded_by_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "training_consents" ADD CONSTRAINT "training_consents_withdrawn_by_fk" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
