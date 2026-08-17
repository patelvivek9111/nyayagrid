-- Nyaya Professor hardening: case-room conversation, course labels, student notes.
-- Every table/column here is still user-scoped. No organization_id or matter_id is added.

ALTER TABLE "student_conversations" ADD COLUMN "case_id" uuid;
ALTER TABLE "student_conversations" ADD CONSTRAINT "student_conversations_case_fk" FOREIGN KEY ("case_id") REFERENCES "public"."student_cases"("id") ON DELETE set null ON UPDATE no action;
CREATE UNIQUE INDEX "student_conversations_user_case_uidx" ON "student_conversations" ("user_id", "case_id") WHERE "case_id" IS NOT NULL;
CREATE INDEX "student_conversations_case_idx" ON "student_conversations" ("case_id");

ALTER TABLE "student_cases" ADD COLUMN "course_label" text;
ALTER TABLE "student_saved_items" ADD COLUMN "course_label" text;

CREATE TABLE "student_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "case_id" uuid,
  "brief_id" uuid,
  "kind" text DEFAULT 'note' NOT NULL,
  "section_key" text,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "course_label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "student_notes_user_idx" ON "student_notes" ("user_id");
CREATE INDEX "student_notes_case_idx" ON "student_notes" ("case_id");
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_case_fk" FOREIGN KEY ("case_id") REFERENCES "public"."student_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_brief_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."student_case_briefs"("id") ON DELETE set null ON UPDATE no action;
