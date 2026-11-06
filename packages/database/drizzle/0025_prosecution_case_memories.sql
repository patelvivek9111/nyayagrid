-- Prosecution case memory (PROS-MEM-01).
-- Case-scoped, reviewable entries. Proposed AI entries are never verified facts.
-- No guilt verdict, charging recommendation, or autonomy fields.
-- Reverse with 0025_prosecution_case_memories.down.sql.

CREATE TABLE IF NOT EXISTS "prosecution_case_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "evidence_item_id" uuid,
  "memory_type" text DEFAULT 'other' NOT NULL,
  "content" text NOT NULL,
  "status" text DEFAULT 'proposed' NOT NULL,
  "origin" text DEFAULT 'manual' NOT NULL,
  "confidence" text,
  "provenance" jsonb NOT NULL,
  "superseded_by" uuid,
  "created_by_user_id" uuid,
  "reviewed_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "prosecution_case_memories_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade,
  CONSTRAINT "prosecution_case_memories_criminal_case_id_fkey"
    FOREIGN KEY ("criminal_case_id") REFERENCES "criminal_cases"("id") ON DELETE cascade,
  CONSTRAINT "prosecution_case_memories_evidence_item_id_fkey"
    FOREIGN KEY ("evidence_item_id") REFERENCES "prosecution_evidence_items"("id") ON DELETE set null,
  CONSTRAINT "prosecution_case_memories_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id"),
  CONSTRAINT "prosecution_case_memories_reviewed_by_user_id_fkey"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id"),
  CONSTRAINT "prosecution_case_memories_type_chk" CHECK ("memory_type" IN (
    'confirmed_fact','disputed_fact','allegation','admission','legal_issue',
    'open_question','procedural_context','evidence_note','strategy_note','other'
  )),
  CONSTRAINT "prosecution_case_memories_status_chk" CHECK ("status" IN (
    'proposed','approved','rejected','superseded'
  )),
  CONSTRAINT "prosecution_case_memories_origin_chk" CHECK ("origin" IN ('ai','manual')),
  CONSTRAINT "prosecution_case_memories_confidence_chk" CHECK (
    "confidence" IS NULL OR "confidence" IN ('low','medium','high')
  )
);

CREATE INDEX IF NOT EXISTS "prosecution_case_memories_case_idx"
  ON "prosecution_case_memories" ("criminal_case_id");
CREATE INDEX IF NOT EXISTS "prosecution_case_memories_org_idx"
  ON "prosecution_case_memories" ("organization_id");
CREATE INDEX IF NOT EXISTS "prosecution_case_memories_status_idx"
  ON "prosecution_case_memories" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "prosecution_case_memories_case_status_idx"
  ON "prosecution_case_memories" ("criminal_case_id", "status");
CREATE INDEX IF NOT EXISTS "prosecution_case_memories_evidence_idx"
  ON "prosecution_case_memories" ("evidence_item_id");
