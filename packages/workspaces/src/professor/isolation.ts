/**
 * Workspace isolation guards for the Student Workspace.
 *
 * Student study material lives in user-scoped tables and is never joined against the professional
 * side of the product. The shared `legal_authorities*` corpus is the one exception: it is
 * non-confidential reference material, so Professor may read it.
 *
 * These are pure functions on purpose. They can be unit tested without a database, and they run on
 * every student retrieval path so a future refactor cannot quietly widen the query surface.
 */

/** Tables Professor is allowed to read. Anything else is out of scope by construction. */
export const STUDENT_READABLE_TABLES = [
  "student_conversations",
  "student_messages",
  "student_cases",
  "student_case_versions",
  "student_case_chunks",
  "student_case_briefs",
  "student_case_comparisons",
  "student_saved_items",
  "student_notes",
  "legal_authorities",
  "legal_authority_versions",
  "legal_authority_chunks",
  "audit_events",
] as const;

/**
 * Tables that hold confidential professional data (or another workspace's data). A student query
 * that mentions any of these is a bug, not a feature request.
 */
export const WORKSPACE_FORBIDDEN_TABLES = [
  "documents",
  "document_versions",
  "document_chunks",
  "document_analyses",
  "document_comparisons",
  "matters",
  "matter_authorities",
  "matter_memories",
  "matter_facts",
  "matter_entities",
  "matter_timeline_events",
  "matter_deadlines",
  "organizations",
  "organization_members",
  "research_sessions",
  "research_queries",
  "research_results",
  "research_artifacts",
  "agent_runs",
  "agent_artifacts",
  "drafts",
  "notes",
  "guide_documents",
  "guide_document_chunks",
] as const;

/** Identifier fields that would prove a student result crossed into professional or tenant scope. */
export const FORBIDDEN_STUDENT_RESULT_FIELDS = [
  "documentId",
  "documentVersionId",
  "matterId",
  "organizationId",
] as const;

/**
 * Reject any SQL fragment that names a table outside the student-readable set. Matching is on
 * whole identifiers, so `student_cases` does not trip the `cases` style prefixes and
 * `document_chunks` is caught even when it appears as `public.document_chunks`.
 */
export function assertStudentQueryIsIsolated(label: string, sqlText: string): void {
  const lowered = sqlText.toLowerCase();
  for (const table of WORKSPACE_FORBIDDEN_TABLES) {
    const pattern = new RegExp(`(^|[^a-z0-9_])${table}($|[^a-z0-9_])`);
    if (pattern.test(lowered)) {
      throw new Error(
        `Student workspace query "${label}" referenced non-student table "${table}". Student data is user-scoped and must never join professional or cross-workspace tables.`,
      );
    }
  }
}

export type StudentChunkHit = {
  chunkId: string;
  caseId: string;
  caseVersionId: string;
  userId: string;
  content: string;
  score: number;
  pageStart?: number | null;
  pageEnd?: number | null;
  segmentRef?: string | null;
  opinionPart?: "majority" | "concurrence" | "dissent" | null;
};

/**
 * Runtime check on retrieval output: every hit must belong to the requesting user, and no hit may
 * carry a matter/organization identifier. A failure here means a scope filter was dropped.
 */
export function assertStudentHitsOwnedBy(hits: StudentChunkHit[], userId: string): void {
  for (const hit of hits) {
    const record = hit as unknown as Record<string, unknown>;
    for (const field of FORBIDDEN_STUDENT_RESULT_FIELDS) {
      if (record[field] !== undefined) {
        throw new Error(`Student search result leaked professional-scoped field "${field}"`);
      }
    }
    if (hit.userId !== userId) {
      throw new Error("Student search result leaked across user boundary");
    }
    if (!hit.caseId || !hit.caseVersionId || !hit.chunkId) {
      throw new Error("Student search result is missing case provenance");
    }
  }
}
