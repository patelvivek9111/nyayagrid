import { and, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  studentCaseBriefs,
  studentCaseVersions,
  studentCases,
  studentConversations,
  studentNotes,
  studentSavedItems,
} from "@nyayagrid/database";
import type {
  StudentCase,
  StudentCaseVersion,
  StudentConversation,
  StudentNote,
} from "@nyayagrid/database";

/**
 * Ownership checks for the Student Workspace. There is no role model here and no organization to
 * fall back on: a student row belongs to exactly one user, and every read or write path proves that
 * ownership before touching the row. A missing row and a row owned by someone else produce the same
 * error, so these helpers cannot be used to probe for the existence of another user's material.
 */
export class StudentAccessError extends Error {
  readonly code = "student_access_denied";

  constructor(message = "Student resource not found for this user") {
    super(message);
    this.name = "StudentAccessError";
  }
}

export async function assertStudentCaseOwnership(
  db: Database,
  userId: string,
  caseId: string,
): Promise<StudentCase> {
  if (!userId || !caseId) {
    throw new StudentAccessError("userId and caseId are required");
  }
  const [row] = await db
    .select()
    .from(studentCases)
    .where(and(eq(studentCases.id, caseId), eq(studentCases.userId, userId)))
    .limit(1);
  if (!row) throw new StudentAccessError();
  return row;
}

export async function assertStudentConversationOwnership(
  db: Database,
  userId: string,
  conversationId: string,
): Promise<StudentConversation> {
  if (!userId || !conversationId) {
    throw new StudentAccessError("userId and conversationId are required");
  }
  const [row] = await db
    .select()
    .from(studentConversations)
    .where(
      and(eq(studentConversations.id, conversationId), eq(studentConversations.userId, userId)),
    )
    .limit(1);
  if (!row) throw new StudentAccessError();
  return row;
}

export async function assertStudentCaseVersionOwnership(
  db: Database,
  userId: string,
  caseVersionId: string,
): Promise<StudentCaseVersion> {
  if (!userId || !caseVersionId) {
    throw new StudentAccessError("userId and caseVersionId are required");
  }
  const [row] = await db
    .select()
    .from(studentCaseVersions)
    .where(and(eq(studentCaseVersions.id, caseVersionId), eq(studentCaseVersions.userId, userId)))
    .limit(1);
  if (!row) throw new StudentAccessError();
  return row;
}

export async function assertStudentBriefOwnership(db: Database, userId: string, briefId: string) {
  const [row] = await db
    .select()
    .from(studentCaseBriefs)
    .where(and(eq(studentCaseBriefs.id, briefId), eq(studentCaseBriefs.userId, userId)))
    .limit(1);
  if (!row) throw new StudentAccessError();
  return row;
}

export async function assertStudentSavedItemOwnership(
  db: Database,
  userId: string,
  itemId: string,
) {
  const [row] = await db
    .select()
    .from(studentSavedItems)
    .where(and(eq(studentSavedItems.id, itemId), eq(studentSavedItems.userId, userId)))
    .limit(1);
  if (!row) throw new StudentAccessError();
  return row;
}

export async function assertStudentNoteOwnership(
  db: Database,
  userId: string,
  noteId: string,
): Promise<StudentNote> {
  if (!userId || !noteId) {
    throw new StudentAccessError("userId and noteId are required");
  }
  const [row] = await db
    .select()
    .from(studentNotes)
    .where(and(eq(studentNotes.id, noteId), eq(studentNotes.userId, userId)))
    .limit(1);
  if (!row) throw new StudentAccessError();
  return row;
}

/**
 * Pure ownership predicate, separated from the database read so the rule itself can be tested and
 * reused when a row has already been loaded.
 */
export function isOwnedByUser(row: { userId?: string | null } | null | undefined, userId: string) {
  return Boolean(row && userId && row.userId === userId);
}

export function assertOwnedByUser<T extends { userId?: string | null }>(
  row: T | null | undefined,
  userId: string,
): T {
  if (!isOwnedByUser(row, userId)) throw new StudentAccessError();
  return row as T;
}
