ALTER TABLE "invoice_line_items" DROP COLUMN IF EXISTS "updated_at";
ALTER TABLE "invoice_line_items" DROP COLUMN IF EXISTS "amount_cents";
ALTER TABLE "invoice_line_items" DROP COLUMN IF EXISTS "hourly_rate_cents";
ALTER TABLE "invoice_line_items" DROP COLUMN IF EXISTS "billable";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "total_cents";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "total_minutes";
ALTER TABLE "time_entries" DROP COLUMN IF EXISTS "hourly_rate_cents";
ALTER TABLE "time_entries" DROP COLUMN IF EXISTS "billable";
