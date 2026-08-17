import { createHash } from "node:crypto";
import { z } from "zod";
import { and, desc, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { studentCaseChunks, studentCaseVersions, studentCases } from "@nyayagrid/database";
import type { StudentCase, StudentCaseVersion } from "@nyayagrid/database";
import { chunkSegments, createDefaultTextExtractor } from "@nyayagrid/documents";
import type { ExtractedSegment, StorageProvider, TextExtractor } from "@nyayagrid/documents";
import type { EmbeddingProvider } from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";

const MAX_PARAGRAPH_CHARS = 1000;
const EMBEDDING_BATCH_SIZE = 32;
const CHUNK_INSERT_BATCH_SIZE = 100;
const MAX_HEADING_CHARS = 200;

export type StudentOpinionPart = "majority" | "concurrence" | "dissent";

/** Only separate opinions are ever labelled by ingestion; unlabelled text stays null. */
export type StudentSeparateOpinionPart = "concurrence" | "dissent";

export const ingestStudentCaseInputSchema = z.object({
  title: z.string().trim().min(3),
  citation: z.string().trim().min(1).nullish(),
  court: z.string().trim().min(1).nullish(),
  decisionDate: z.string().trim().min(4).nullish(),
});

/**
 * Detect a separate-opinion heading.
 *
 * Deliberately conservative: it only fires on short, heading-shaped lines that name a concurrence or
 * a dissent. When nothing is labelled, chunks keep `opinionPart = null` rather than being guessed
 * into the majority, because mislabelling a dissent as the holding is the single most damaging
 * error a case brief can make.
 */
export function detectOpinionPartHeading(paragraph: string): "concurrence" | "dissent" | null {
  const normalized = paragraph.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > MAX_HEADING_CHARS) return null;

  const letters = normalized.replace(/[^a-zA-Z]/g, "");
  const isMostlyUpperCase =
    letters.length > 0 && letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.8;
  const namesAJudge = /(?:^|\W)(?:j\.|jj\.|c\.j\.|justice|judge|chief justice)(?:\W|$)/i.test(
    normalized,
  );
  if (!isMostlyUpperCase && !namesAJudge) return null;

  if (/\bdissent(?:ing|s|ed)?\b/i.test(normalized)) return "dissent";
  if (/\bconcurr(?:ing|ence|s|ed)?\b/i.test(normalized)) return "concurrence";
  return null;
}

type StudentSegment = ExtractedSegment & { opinionPart: "concurrence" | "dissent" | null };

function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_PARAGRAPH_CHARS) return [paragraph];
  const sentences = paragraph.split(/(?<=[.;:!?])\s+/);
  const pieces: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    const next = buffer ? `${buffer} ${sentence}` : sentence;
    if (next.length > MAX_PARAGRAPH_CHARS && buffer) {
      pieces.push(buffer);
      buffer = sentence;
    } else {
      buffer = next;
    }
  }
  if (buffer) pieces.push(buffer);
  return pieces;
}

function paragraphsToSegments(text: string): ExtractedSegment[] {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap(splitLongParagraph);

  const segments: ExtractedSegment[] = [];
  let cursor = 0;
  paragraphs.forEach((paragraph, index) => {
    const charStart = cursor;
    const charEnd = cursor + paragraph.length;
    segments.push({
      text: paragraph,
      segmentRef: `p${index + 1}`,
      charStart,
      charEnd,
    });
    cursor = charEnd + 2;
  });
  return segments;
}

/**
 * Tag segments with the separate opinion they fall under. Text before any separate-opinion heading
 * stays null: the absence of a label is recorded, never filled in.
 */
export function labelSegmentsWithOpinionParts(segments: ExtractedSegment[]): StudentSegment[] {
  let current: "concurrence" | "dissent" | null = null;
  return segments.map((segment) => {
    const heading = detectOpinionPartHeading(segment.text);
    if (heading) current = heading;
    return { ...segment, opinionPart: current };
  });
}

async function embedInBatches(
  embeddings: EmbeddingProvider,
  contents: string[],
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let index = 0; index < contents.length; index += EMBEDDING_BATCH_SIZE) {
    vectors.push(...(await embeddings.embed(contents.slice(index, index + EMBEDDING_BATCH_SIZE))));
  }
  return vectors;
}

export type IngestStudentCaseParams = {
  db: Database;
  userId: string;
  title: string;
  /** Pasted opinion text. Provide this or a buffer, not neither. */
  content?: string;
  buffer?: Buffer;
  mimeType?: string;
  filename?: string;
  citation?: string | null;
  court?: string | null;
  decisionDate?: string | null;
  courseLabel?: string | null;
  embeddings: EmbeddingProvider;
  /** When supplied, the original bytes are archived and `storageKey` is recorded. */
  storage?: StorageProvider;
  extractor?: TextExtractor;
};

export type IngestStudentCaseResult = {
  case: StudentCase;
  version: StudentCaseVersion;
  chunkCount: number;
  /** True when this exact text was already stored for this user and nothing new was written. */
  skipped: boolean;
  labelledOpinionParts: StudentSeparateOpinionPart[];
};

/**
 * Ingest one uploaded case into a student's private library.
 *
 * Idempotent on (userId, sha256): re-uploading identical text returns the stored case instead of
 * creating a duplicate. Text, versions, and chunks are all written with the owning `userId`, and no
 * organization or matter scope exists on any of these rows.
 */
export async function ingestStudentCase(
  params: IngestStudentCaseParams,
): Promise<IngestStudentCaseResult> {
  if (!params.userId) throw new Error("userId is required to ingest a student case");
  const metadata = ingestStudentCaseInputSchema.parse({
    title: params.title,
    citation: params.citation,
    court: params.court,
    decisionDate: params.decisionDate,
  });

  const extraction = await resolveContent(params);
  const content = extraction.content;
  if (content.trim().length < 20) {
    throw new Error(
      params.buffer
        ? "Could not extract enough text from the uploaded file. The PDF may be scanned or empty — paste the opinion text instead."
        : "Case text is too short to ingest",
    );
  }
  const sha256 = createHash("sha256").update(content).digest("hex");

  const [existing] = await params.db
    .select()
    .from(studentCases)
    .where(and(eq(studentCases.userId, params.userId), eq(studentCases.sha256, sha256)))
    .limit(1);

  if (existing) {
    const [latest] = await params.db
      .select()
      .from(studentCaseVersions)
      .where(
        and(
          eq(studentCaseVersions.caseId, existing.id),
          eq(studentCaseVersions.userId, params.userId),
        ),
      )
      .orderBy(desc(studentCaseVersions.versionNumber))
      .limit(1);
    if (latest) {
      const chunks = await params.db
        .select({ id: studentCaseChunks.id })
        .from(studentCaseChunks)
        .where(eq(studentCaseChunks.caseVersionId, latest.id));
      return {
        case: existing,
        version: latest,
        chunkCount: chunks.length,
        skipped: true,
        labelledOpinionParts: [],
      };
    }
  }

  const [created] = existing
    ? [existing]
    : await params.db
        .insert(studentCases)
        .values({
          userId: params.userId,
          title: metadata.title,
          citation: metadata.citation ?? null,
          court: metadata.court ?? null,
          decisionDate: metadata.decisionDate ?? null,
          courseLabel: params.courseLabel?.trim() || null,
          sourceType: params.buffer ? "uploaded_file" : "pasted_text",
          processingState: "uploaded",
          mimeType: params.mimeType ?? null,
          sha256,
          byteSize: params.buffer?.byteLength ?? Buffer.byteLength(content, "utf8"),
        })
        .returning();
  if (!created) throw new Error("Failed to create student case");
  let studentCase = created;

  try {
    studentCase = await setState(params.db, studentCase.id, params.userId, "extracting");

    const [version] = await params.db
      .insert(studentCaseVersions)
      .values({
        caseId: studentCase.id,
        userId: params.userId,
        versionNumber: 1,
        content,
        sha256,
      })
      .returning();
    if (!version) throw new Error("Failed to create student case version");

    if (params.storage && params.buffer) {
      const storageKey = `students/${params.userId}/cases/${studentCase.id}/${version.id}`;
      await params.storage.putObject({
        key: storageKey,
        body: params.buffer,
        contentType: params.mimeType ?? "application/octet-stream",
      });
      await params.db
        .update(studentCases)
        .set({ storageKey, updatedAt: new Date() })
        .where(and(eq(studentCases.id, studentCase.id), eq(studentCases.userId, params.userId)));
    }

    studentCase = await setState(params.db, studentCase.id, params.userId, "chunking");

    const labelled = labelSegmentsWithOpinionParts(extraction.segments);
    const drafts = buildChunkDrafts(labelled);
    if (drafts.length === 0) {
      throw new Error("No chunks were produced from the uploaded case text");
    }

    studentCase = await setState(params.db, studentCase.id, params.userId, "embedding");
    const vectors = await embedInBatches(
      params.embeddings,
      drafts.map((draft) => draft.content),
    );

    for (let index = 0; index < drafts.length; index += CHUNK_INSERT_BATCH_SIZE) {
      const batch = drafts.slice(index, index + CHUNK_INSERT_BATCH_SIZE);
      await params.db.insert(studentCaseChunks).values(
        batch.map((draft, offset) => {
          const embedding = vectors[index + offset];
          return {
            caseId: studentCase.id,
            caseVersionId: version.id,
            userId: params.userId,
            chunkIndex: draft.chunkIndex,
            content: draft.content,
            pageStart: draft.pageStart,
            pageEnd: draft.pageEnd,
            segmentRef: draft.segmentRef,
            charStart: draft.charStart,
            charEnd: draft.charEnd,
            opinionPart: draft.opinionPart,
            embedding: embedding ?? null,
            embeddingModel: embedding ? params.embeddings.model : null,
          };
        }),
      );
    }

    studentCase = await setState(params.db, studentCase.id, params.userId, "ready");

    const labelledParts = [
      ...new Set(
        drafts
          .map((draft) => draft.opinionPart)
          .filter((part): part is "concurrence" | "dissent" => part !== null),
      ),
    ];

    // Student data is not tenant-scoped, so the audit row carries no organizationId and records
    // counts only — never the case text itself.
    await writeAuditEvent(params.db, {
      organizationId: null,
      actorUserId: params.userId,
      action: "student_case.ingested",
      targetType: "student_case",
      targetId: studentCase.id,
      metadata: {
        versionId: version.id,
        chunkCount: drafts.length,
        sourceType: studentCase.sourceType,
        labelledOpinionParts: labelledParts,
      },
    });

    return {
      case: studentCase,
      version,
      chunkCount: drafts.length,
      skipped: false,
      labelledOpinionParts: labelledParts,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Student case ingestion failed";
    await params.db
      .update(studentCases)
      .set({ processingState: "failed", processingError: message, updatedAt: new Date() })
      .where(and(eq(studentCases.id, studentCase.id), eq(studentCases.userId, params.userId)));
    throw error;
  }
}

type ChunkDraft = {
  chunkIndex: number;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  segmentRef: string | null;
  charStart: number | null;
  charEnd: number | null;
  opinionPart: "concurrence" | "dissent" | null;
};

/**
 * Chunk each labelled opinion part separately so a chunk never straddles the boundary between the
 * main opinion and a dissent.
 */
function buildChunkDrafts(segments: StudentSegment[]): ChunkDraft[] {
  const groups: Array<{ opinionPart: "concurrence" | "dissent" | null; items: StudentSegment[] }> =
    [];
  for (const segment of segments) {
    const last = groups[groups.length - 1];
    if (last && last.opinionPart === segment.opinionPart) {
      last.items.push(segment);
    } else {
      groups.push({ opinionPart: segment.opinionPart, items: [segment] });
    }
  }

  const drafts: ChunkDraft[] = [];
  for (const group of groups) {
    for (const chunk of chunkSegments(group.items)) {
      drafts.push({
        chunkIndex: drafts.length,
        content: chunk.content,
        pageStart: chunk.pageStart ?? null,
        pageEnd: chunk.pageEnd ?? null,
        segmentRef: chunk.segmentRef || null,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        opinionPart: group.opinionPart,
      });
    }
  }
  return drafts;
}

async function setState(
  db: Database,
  caseId: string,
  userId: string,
  state: "uploaded" | "extracting" | "chunking" | "embedding" | "ready" | "failed",
): Promise<StudentCase> {
  const [row] = await db
    .update(studentCases)
    .set({ processingState: state, processingError: null, updatedAt: new Date() })
    .where(and(eq(studentCases.id, caseId), eq(studentCases.userId, userId)))
    .returning();
  if (!row) throw new Error("Student case disappeared during processing");
  return row;
}

async function resolveContent(
  params: IngestStudentCaseParams,
): Promise<{ content: string; segments: ExtractedSegment[] }> {
  if (params.content?.trim()) {
    const content = params.content.replace(/\r\n/g, "\n").trim();
    return { content, segments: paragraphsToSegments(content) };
  }
  if (!params.buffer) {
    throw new Error("Provide either pasted case text or an uploaded file buffer");
  }

  const extractor = params.extractor ?? createDefaultTextExtractor();
  const result = await extractor.extract({
    buffer: params.buffer,
    contentType: params.mimeType ?? "application/octet-stream",
    filename: params.filename ?? "case",
  });
  if (result.status !== "ok") {
    throw new Error(
      `Could not extract text from the uploaded case: ${result.reason}. Paste the opinion text instead.`,
    );
  }
  const content = result.segments.map((segment) => segment.text).join("\n\n").trim();
  if (!content) {
    throw new Error(
      "Could not extract text from the uploaded file. The PDF may be scanned or empty — paste the opinion text instead.",
    );
  }
  return {
    content,
    segments: result.segments,
  };
}
