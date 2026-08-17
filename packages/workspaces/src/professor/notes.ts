import { z } from "zod";
import { and, desc, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { studentNotes } from "@nyayagrid/database";
import type { StudentNote } from "@nyayagrid/database";
import { writeAuditEvent } from "@nyayagrid/permissions";
import {
  StudentAccessError,
  assertStudentBriefOwnership,
  assertStudentCaseOwnership,
  assertStudentNoteOwnership,
} from "./auth";

export const STUDENT_NOTE_KINDS = ["note", "brief_challenge"] as const;
export type StudentNoteKind = (typeof STUDENT_NOTE_KINDS)[number];

export const createStudentNoteInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1).max(20000),
  caseId: z.string().uuid().nullish(),
  briefId: z.string().uuid().nullish(),
  kind: z.enum(STUDENT_NOTE_KINDS).default("note"),
  sectionKey: z.string().trim().min(1).max(80).nullish(),
  courseLabel: z.string().trim().max(80).nullish(),
});

export const updateStudentNoteInputSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  content: z.string().trim().min(1).max(20000).optional(),
  courseLabel: z.string().trim().max(80).nullish(),
});

export type CreateStudentNoteInput = z.infer<typeof createStudentNoteInputSchema>;
export type UpdateStudentNoteInput = z.infer<typeof updateStudentNoteInputSchema>;

export async function createStudentNote(params: {
  db: Database;
  userId: string;
  input: CreateStudentNoteInput;
}): Promise<StudentNote> {
  if (!params.userId) throw new StudentAccessError("userId is required");
  const input = createStudentNoteInputSchema.parse(params.input);

  if (input.caseId) {
    await assertStudentCaseOwnership(params.db, params.userId, input.caseId);
  }
  if (input.briefId) {
    await assertStudentBriefOwnership(params.db, params.userId, input.briefId);
  }

  const [row] = await params.db
    .insert(studentNotes)
    .values({
      userId: params.userId,
      caseId: input.caseId ?? null,
      briefId: input.briefId ?? null,
      kind: input.kind,
      sectionKey: input.sectionKey ?? null,
      title: input.title,
      content: input.content,
      courseLabel: input.courseLabel ?? null,
    })
    .returning();
  if (!row) throw new Error("Failed to create student note");

  await writeAuditEvent(params.db, {
    organizationId: null,
    actorUserId: params.userId,
    action:
      input.kind === "brief_challenge"
        ? "student_professor.brief_challenged"
        : "student_note.created",
    targetType: "student_note",
    targetId: row.id,
    metadata: {
      caseId: row.caseId,
      briefId: row.briefId,
      kind: row.kind,
      sectionKey: row.sectionKey,
    },
  });

  return row;
}

export async function listStudentNotes(params: {
  db: Database;
  userId: string;
  caseId?: string | null;
  kind?: StudentNoteKind;
  limit?: number;
}): Promise<StudentNote[]> {
  if (!params.userId) throw new StudentAccessError("userId is required");
  const filters = [eq(studentNotes.userId, params.userId)];
  if (params.caseId) filters.push(eq(studentNotes.caseId, params.caseId));
  if (params.kind) filters.push(eq(studentNotes.kind, params.kind));
  return params.db
    .select()
    .from(studentNotes)
    .where(and(...filters))
    .orderBy(desc(studentNotes.updatedAt))
    .limit(params.limit ?? 100);
}

export async function updateStudentNote(params: {
  db: Database;
  userId: string;
  noteId: string;
  input: UpdateStudentNoteInput;
}): Promise<StudentNote> {
  const existing = await assertStudentNoteOwnership(params.db, params.userId, params.noteId);
  const input = updateStudentNoteInputSchema.parse(params.input);
  const [row] = await params.db
    .update(studentNotes)
    .set({
      title: input.title ?? existing.title,
      content: input.content ?? existing.content,
      courseLabel: input.courseLabel === undefined ? existing.courseLabel : input.courseLabel,
      updatedAt: new Date(),
    })
    .where(and(eq(studentNotes.id, existing.id), eq(studentNotes.userId, params.userId)))
    .returning();
  if (!row) throw new StudentAccessError();
  return row;
}

export async function deleteStudentNote(params: {
  db: Database;
  userId: string;
  noteId: string;
}): Promise<{ deletedId: string }> {
  const existing = await assertStudentNoteOwnership(params.db, params.userId, params.noteId);
  await params.db
    .delete(studentNotes)
    .where(and(eq(studentNotes.id, existing.id), eq(studentNotes.userId, params.userId)));
  return { deletedId: existing.id };
}
