-- PROF-BILL-01 — optional fee assistance on time entries / draft invoices.
-- Minutes remain authoritative. amount_cents / total_cents are assistance only.
-- Not payment processing or trust accounting.

ALTER TABLE "time_entries"
  ADD COLUMN IF NOT EXISTS "billable" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_entries"
  ADD COLUMN IF NOT EXISTS "hourly_rate_cents" integer;
--> statement-breakpoint
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "total_minutes" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "total_cents" integer;
--> statement-breakpoint
ALTER TABLE "invoice_line_items"
  ADD COLUMN IF NOT EXISTS "billable" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_line_items"
  ADD COLUMN IF NOT EXISTS "hourly_rate_cents" integer;
--> statement-breakpoint
ALTER TABLE "invoice_line_items"
  ADD COLUMN IF NOT EXISTS "amount_cents" integer;
--> statement-breakpoint
ALTER TABLE "invoice_line_items"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
UPDATE "invoices" i
SET "total_minutes" = COALESCE((
  SELECT SUM(li."minutes")::integer
  FROM "invoice_line_items" li
  WHERE li."invoice_id" = i."id"
), 0)
WHERE COALESCE(i."total_minutes", 0) = 0;
