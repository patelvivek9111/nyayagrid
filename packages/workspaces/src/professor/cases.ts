import { and, asc, desc, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { studentCaseChunks, studentCaseVersions, studentCases } from "@nyayagrid/database";
import type { StudentCase, StudentCaseVersion } from "@nyayagrid/database";
import type { ProfessorCaseChunk } from "@nyayagrid/ai";
import { StudentAccessError, assertStudentCaseOwnership } from "./auth";

export type StudentCasePassage = {
  chunkId: string;
  caseId: string;
  caseVersionId: string;
  chunkIndex: number;
  content: string;
  pageStart: number | null;
  opinionPart: "majority" | "concurrence" | "dissent" | null;
};

export async function listStudentCases(db: Database, userId: string): Promise<StudentCase[]> {
  if (!userId) throw new StudentAccessError("userId is required");
  return db
    .select()
    .from(studentCases)
    .where(eq(studentCases.userId, userId))
    .orderBy(desc(studentCases.createdAt));
}

export async function getStudentCase(
  db: Database,
  userId: string,
  caseId: string,
): Promise<StudentCase> {
  return assertStudentCaseOwnership(db, userId, caseId);
}

export async function getLatestStudentCaseVersion(
  db: Database,
  userId: string,
  caseId: string,
): Promise<StudentCaseVersion> {
  const [version] = await db
    .select()
    .from(studentCaseVersions)
    .where(and(eq(studentCaseVersions.caseId, caseId), eq(studentCaseVersions.userId, userId)))
    .orderBy(desc(studentCaseVersions.versionNumber))
    .limit(1);
  if (!version) throw new StudentAccessError("No stored text found for this case");
  return version;
}

/**
 * Load a version's passages in reading order. Every query here is filtered by `userId`, so a chunk
 * belonging to another student is unreachable even with a valid chunk id.
 */
export async function loadStudentCasePassages(params: {
  db: Database;
  userId: string;
  caseVersionId: string;
  limit?: number;
}): Promise<StudentCasePassage[]> {
  if (!params.userId) throw new StudentAccessError("userId is required");
  const rows = await params.db
    .select({
      chunkId: studentCaseChunks.id,
      caseId: studentCaseChunks.caseId,
      caseVersionId: studentCaseChunks.caseVersionId,
      chunkIndex: studentCaseChunks.chunkIndex,
      content: studentCaseChunks.content,
      pageStart: studentCaseChunks.pageStart,
      opinionPart: studentCaseChunks.opinionPart,
    })
    .from(studentCaseChunks)
    .where(
      and(
        eq(studentCaseChunks.caseVersionId, params.caseVersionId),
        eq(studentCaseChunks.userId, params.userId),
      ),
    )
    .orderBy(asc(studentCaseChunks.chunkIndex))
    .limit(params.limit ?? 40);

  return rows.map((row) => ({
    chunkId: row.chunkId,
    caseId: row.caseId,
    caseVersionId: row.caseVersionId,
    chunkIndex: row.chunkIndex,
    content: row.content,
    pageStart: row.pageStart ?? null,
    opinionPart: row.opinionPart ?? null,
  }));
}

export function toProfessorCaseChunks(passages: StudentCasePassage[]): ProfessorCaseChunk[] {
  return passages.map((passage) => ({
    caseId: passage.caseId,
    chunkId: passage.chunkId,
    opinionPart: passage.opinionPart,
    page: passage.pageStart,
    content: passage.content,
  }));
}

export function caseDisplayLabel(row: StudentCase): string {
  return row.citation ? `${row.title} (${row.citation})` : row.title;
}

export async function updateStudentCaseCourseLabel(params: {
  db: Database;
  userId: string;
  caseId: string;
  courseLabel: string | null;
}): Promise<StudentCase> {
  await assertStudentCaseOwnership(params.db, params.userId, params.caseId);
  const [row] = await params.db
    .update(studentCases)
    .set({
      courseLabel: params.courseLabel?.trim() || null,
      updatedAt: new Date(),
    })
    .where(and(eq(studentCases.id, params.caseId), eq(studentCases.userId, params.userId)))
    .returning();
  if (!row) throw new StudentAccessError();
  return row;
}
