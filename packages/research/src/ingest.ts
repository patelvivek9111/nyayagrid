import { createHash } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, isNull } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  legalAuthorities,
  legalAuthorityChunks,
  legalAuthorityCitations,
  legalAuthorityVersions,
} from "@nyayagrid/database";
import { chunkSegments } from "@nyayagrid/documents";
import type { ExtractedSegment } from "@nyayagrid/documents";
import type { EmbeddingProvider } from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { extractCitationsFromText, parseCitation, resolveCitationAgainstCorpus } from "./citations";

export const AUTHORITY_TYPES = [
  "case",
  "statute",
  "regulation",
  "constitution",
  "rule",
  "administrative_decision",
  "other",
] as const;

export const authorityHierarchyNodeSchema = z.object({
  level: z.string().min(1),
  ref: z.string().min(1),
  label: z.string().optional(),
});

/** Filenames are not authority metadata; a title like "opinion_final.pdf" is always rejected. */
const FILENAME_LIKE = /\.(pdf|docx?|txt|rtf|html?|json|xml|csv|tiff?|png|jpe?g)$/i;

export const importAuthorityInputSchema = z
  .object({
    title: z.string().trim().min(3),
    authorityType: z.enum(AUTHORITY_TYPES),
    content: z.string().min(20),
    sourceProvider: z.string().trim().min(1),
    sourceExternalId: z.string().trim().min(1),
    shortTitle: z.string().nullish(),
    citation: z.string().nullish(),
    normalizedCitation: z.string().nullish(),
    jurisdiction: z.string().nullish(),
    court: z.string().nullish(),
    docketNumber: z.string().nullish(),
    decisionDate: z.string().nullish(),
    effectiveDate: z.string().nullish(),
    effectiveFrom: z.string().nullish(),
    effectiveTo: z.string().nullish(),
    publicationStatus: z.string().nullish(),
    canonicalSourceUrl: z.string().nullish(),
    hierarchyPath: z.array(authorityHierarchyNodeSchema).optional(),
    opinionParts: z
      .array(
        z.object({
          part: z.enum(["majority", "concurrence", "dissent"]),
          content: z.string().min(1),
        }),
      )
      .optional(),
    sections: z
      .array(
        z.object({
          sectionRef: z.string().min(1),
          subsectionRef: z.string().nullish(),
          content: z.string().min(1),
        }),
      )
      .optional(),
    treatmentStatus: z.enum(["unknown", "source_reported"]).optional(),
    metadata: z.record(z.unknown()).optional(),
    sourceMetadata: z.record(z.unknown()).optional(),
  })
  .superRefine((input, ctx) => {
    if (FILENAME_LIKE.test(input.title.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["title"],
        message:
          "Authority title must be the official title, not a filename. Provide explicit metadata.",
      });
    }
    if (input.authorityType === "case" && !input.citation && !input.docketNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["citation"],
        message: "Case authorities require an explicit citation or docket number.",
      });
    }
  });

export type ImportAuthorityInput = z.infer<typeof importAuthorityInputSchema>;

export type ImportAuthorityParams = {
  db: Database;
  embeddings: EmbeddingProvider;
  input: ImportAuthorityInput;
  actor?: { organizationId?: string | null; userId?: string | null };
};

export type ImportAuthorityResult = {
  authority: typeof legalAuthorities.$inferSelect;
  version: typeof legalAuthorityVersions.$inferSelect;
  chunkCount: number;
  citationCount: number;
  /** True when the incoming content was byte-identical to the latest stored version. */
  skipped?: boolean;
};

const MAX_PARAGRAPH_CHARS = 1000;
const EMBEDDING_BATCH_SIZE = 32;
const CHUNK_INSERT_BATCH_SIZE = 100;

type ChunkGroup = {
  text: string;
  prefix: string;
  opinionPart?: "majority" | "concurrence" | "dissent" | null;
  sectionRef?: string | null;
  subsectionRef?: string | null;
};

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

function toSegments(text: string, prefix: string): ExtractedSegment[] {
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
      segmentRef: `${prefix}${index + 1}`,
      charStart,
      charEnd,
    });
    cursor = charEnd + 2;
  });
  return segments;
}

/**
 * Structured input wins over the flat text: statute sections and opinion parts keep their own
 * provenance so citations can point at "§ 100(b)" or a dissent rather than the whole document.
 * When no structure is supplied, opinionPart stays null instead of guessing "majority".
 */
function buildChunkGroups(input: ImportAuthorityInput): ChunkGroup[] {
  if (input.sections && input.sections.length > 0) {
    return input.sections.map((section, index) => ({
      text: section.content,
      prefix: `sec${index + 1}-p`,
      sectionRef: section.sectionRef,
      subsectionRef: section.subsectionRef ?? null,
      opinionPart: null,
    }));
  }
  if (input.opinionParts && input.opinionParts.length > 0) {
    return input.opinionParts.map((part, index) => ({
      text: part.content,
      prefix: `${part.part}${index + 1}-p`,
      opinionPart: part.part,
    }));
  }
  return [{ text: input.content, prefix: "p", opinionPart: null }];
}

type ChunkDraft = {
  chunkIndex: number;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  segmentRef: string | null;
  charStart: number | null;
  charEnd: number | null;
  tokenCount: number | null;
  opinionPart: "majority" | "concurrence" | "dissent" | null;
  sectionRef: string | null;
  subsectionRef: string | null;
};

function buildChunkDrafts(input: ImportAuthorityInput): ChunkDraft[] {
  const drafts: ChunkDraft[] = [];
  for (const group of buildChunkGroups(input)) {
    const chunks = chunkSegments(toSegments(group.text, group.prefix));
    for (const chunk of chunks) {
      drafts.push({
        chunkIndex: drafts.length,
        content: chunk.content,
        pageStart: chunk.pageStart ?? null,
        pageEnd: chunk.pageEnd ?? null,
        segmentRef: chunk.segmentRef || null,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        tokenCount: chunk.tokenCount,
        opinionPart: group.opinionPart ?? null,
        sectionRef: group.sectionRef ?? null,
        subsectionRef: group.subsectionRef ?? null,
      });
    }
  }
  return drafts;
}

async function embedInBatches(
  embeddings: EmbeddingProvider,
  contents: string[],
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let index = 0; index < contents.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = contents.slice(index, index + EMBEDDING_BATCH_SIZE);
    vectors.push(...(await embeddings.embed(batch)));
  }
  return vectors;
}

async function countChunksForVersion(db: Database, versionId: string): Promise<number> {
  const rows = await db
    .select({ id: legalAuthorityChunks.id })
    .from(legalAuthorityChunks)
    .where(eq(legalAuthorityChunks.authorityVersionId, versionId));
  return rows.length;
}

/**
 * Import a legal authority into the shared corpus.
 *
 * - Idempotent on (sourceProvider, sourceExternalId): identical content is skipped, changed
 *   content becomes a new immutable version. Existing versions are never overwritten.
 * - Metadata must be supplied explicitly by the caller; nothing is inferred from a filename.
 * - Outbound citations are parsed and stored with the raw text preserved, resolved to corpus
 *   authorities only when the match is unambiguous.
 */
export async function importAuthority(
  params: ImportAuthorityParams,
): Promise<ImportAuthorityResult> {
  const { db, embeddings } = params;
  const input = importAuthorityInputSchema.parse(params.input);
  const sha256 = createHash("sha256").update(input.content).digest("hex");
  const normalizedCitation =
    input.normalizedCitation ?? (input.citation ? parseCitation(input.citation).normalized : null);

  const [existing] = await db
    .select()
    .from(legalAuthorities)
    .where(
      and(
        eq(legalAuthorities.sourceProvider, input.sourceProvider),
        eq(legalAuthorities.sourceExternalId, input.sourceExternalId),
      ),
    )
    .limit(1);

  const [latestVersion] = existing
    ? await db
        .select()
        .from(legalAuthorityVersions)
        .where(eq(legalAuthorityVersions.authorityId, existing.id))
        .orderBy(desc(legalAuthorityVersions.versionNumber))
        .limit(1)
    : [];

  if (existing && latestVersion && latestVersion.sha256 === sha256) {
    await writeAuditEvent(db, {
      organizationId: params.actor?.organizationId ?? null,
      actorUserId: params.actor?.userId ?? null,
      action: "legal_authority.import_skipped",
      targetType: "legal_authority",
      targetId: existing.id,
      metadata: {
        sourceProvider: input.sourceProvider,
        sourceExternalId: input.sourceExternalId,
        versionNumber: latestVersion.versionNumber,
        reason: "content_unchanged",
      },
    });
    return {
      authority: existing,
      version: latestVersion,
      chunkCount: await countChunksForVersion(db, latestVersion.id),
      citationCount: 0,
      skipped: true,
    };
  }

  const authorityValues = {
    authorityType: input.authorityType,
    jurisdiction: input.jurisdiction ?? null,
    court: input.court ?? null,
    title: input.title.trim(),
    shortTitle: input.shortTitle ?? null,
    citation: input.citation ?? null,
    normalizedCitation,
    docketNumber: input.docketNumber ?? null,
    decisionDate: input.decisionDate ?? null,
    effectiveDate: input.effectiveDate ?? null,
    publicationStatus: input.publicationStatus ?? null,
    sourceProvider: input.sourceProvider,
    sourceExternalId: input.sourceExternalId,
    canonicalSourceUrl: input.canonicalSourceUrl ?? null,
    treatmentStatus: input.treatmentStatus ?? ("unknown" as const),
    hierarchyPath: input.hierarchyPath ?? [],
    metadata: input.metadata ?? {},
  };

  let authority: typeof legalAuthorities.$inferSelect;
  if (existing) {
    const [updated] = await db
      .update(legalAuthorities)
      .set({ ...authorityValues, ingestionStatus: "processing", updatedAt: new Date() })
      .where(eq(legalAuthorities.id, existing.id))
      .returning();
    if (!updated) throw new Error("Failed to update legal authority");
    authority = updated;
  } else {
    const [inserted] = await db
      .insert(legalAuthorities)
      .values({ ...authorityValues, ingestionStatus: "processing" })
      .returning();
    if (!inserted) throw new Error("Failed to insert legal authority");
    authority = inserted;
  }

  // Close out the previous version's validity window. Old rows are kept verbatim; only their
  // system-time range changes, so retrieval can exclude superseded text by default.
  if (existing) {
    await db
      .update(legalAuthorityVersions)
      .set({ validTo: new Date() })
      .where(
        and(
          eq(legalAuthorityVersions.authorityId, authority.id),
          isNull(legalAuthorityVersions.validTo),
        ),
      );
  }

  const [version] = await db
    .insert(legalAuthorityVersions)
    .values({
      authorityId: authority.id,
      versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
      content: input.content,
      effectiveFrom: input.effectiveFrom ?? input.effectiveDate ?? null,
      effectiveTo: input.effectiveTo ?? null,
      sourceProvider: input.sourceProvider,
      sourceMetadata: input.sourceMetadata ?? {},
      sha256,
    })
    .returning();
  if (!version) throw new Error("Failed to insert legal authority version");

  const drafts = buildChunkDrafts(input);
  const vectors = await embedInBatches(
    embeddings,
    drafts.map((draft) => draft.content),
  );

  for (let index = 0; index < drafts.length; index += CHUNK_INSERT_BATCH_SIZE) {
    const batch = drafts.slice(index, index + CHUNK_INSERT_BATCH_SIZE);
    await db.insert(legalAuthorityChunks).values(
      batch.map((draft, offset) => {
        const embedding = vectors[index + offset];
        return {
          authorityId: authority.id,
          authorityVersionId: version.id,
          chunkIndex: draft.chunkIndex,
          content: draft.content,
          opinionPart: draft.opinionPart,
          sectionRef: draft.sectionRef,
          subsectionRef: draft.subsectionRef,
          pageStart: draft.pageStart,
          pageEnd: draft.pageEnd,
          segmentRef: draft.segmentRef,
          charStart: draft.charStart,
          charEnd: draft.charEnd,
          tokenCount: draft.tokenCount,
          embedding: embedding ?? null,
          embeddingModel: embedding ? embeddings.model : null,
        };
      }),
    );
  }

  const citationCount = await storeOutboundCitations(db, authority, input.content);

  const [ready] = await db
    .update(legalAuthorities)
    .set({ ingestionStatus: "ready", updatedAt: new Date() })
    .where(eq(legalAuthorities.id, authority.id))
    .returning();

  await writeAuditEvent(db, {
    organizationId: params.actor?.organizationId ?? null,
    actorUserId: params.actor?.userId ?? null,
    action: existing ? "legal_authority.version_added" : "legal_authority.imported",
    targetType: "legal_authority",
    targetId: authority.id,
    metadata: {
      sourceProvider: input.sourceProvider,
      sourceExternalId: input.sourceExternalId,
      versionNumber: version.versionNumber,
      chunkCount: drafts.length,
      citationCount,
    },
  });

  return {
    authority: ready ?? authority,
    version,
    chunkCount: drafts.length,
    citationCount,
    skipped: false,
  };
}

/**
 * Replace the parsed outbound citations for an authority. Raw citation text is always stored;
 * toAuthorityId stays null when the citation cannot be resolved unambiguously.
 */
async function storeOutboundCitations(
  db: Database,
  authority: typeof legalAuthorities.$inferSelect,
  content: string,
): Promise<number> {
  const parsed = extractCitationsFromText(content);
  await db
    .delete(legalAuthorityCitations)
    .where(eq(legalAuthorityCitations.fromAuthorityId, authority.id));
  if (parsed.length === 0) return 0;

  const rows: Array<typeof legalAuthorityCitations.$inferInsert> = [];
  for (const citation of parsed) {
    const isSelfCitation =
      Boolean(citation.normalized) && citation.normalized === authority.normalizedCitation;
    if (isSelfCitation) continue;
    const resolution = await resolveCitationAgainstCorpus(db, citation);
    const toAuthorityId = resolution?.authorityId ?? null;
    rows.push({
      fromAuthorityId: authority.id,
      toAuthorityId: toAuthorityId && toAuthorityId !== authority.id ? toAuthorityId : null,
      rawCitation: citation.raw,
      normalizedCitation: citation.normalized,
      pinpoint: citation.pinpoint ?? null,
    });
  }
  if (rows.length === 0) return 0;
  await db.insert(legalAuthorityCitations).values(rows);
  return rows.length;
}
