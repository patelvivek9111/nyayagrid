import { and, desc, eq, inArray } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  legalAuthorities,
  legalAuthorityChunks,
  legalAuthorityCitations,
  legalAuthorityRelationships,
  legalAuthorityVersions,
} from "@nyayagrid/database";
import type { EmbeddingProvider } from "@nyayagrid/ai";
import { AuthorityHybridRetriever } from "./search";
import type { AuthoritySearchFilters, AuthoritySearchHit } from "./provider";
import { getTreatmentDisplay, type TreatmentDisplay } from "./treatment";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

export type LegalAuthorityRow = typeof legalAuthorities.$inferSelect;

/** Thin wrapper over AuthorityHybridRetriever used by the API layer. */
export async function searchAuthorities(params: {
  db: Database;
  embeddings: EmbeddingProvider;
  query: string;
  filters?: AuthoritySearchFilters;
  limit?: number;
}): Promise<AuthoritySearchHit[]> {
  const retriever = new AuthorityHybridRetriever(params.db, params.embeddings);
  return retriever.search(params.query.trim(), params.filters ?? {}, { limit: params.limit });
}

export async function getAuthorityById(
  db: Database,
  authorityId: string,
): Promise<LegalAuthorityRow | null> {
  if (!isUuid(authorityId)) return null;
  const [row] = await db
    .select()
    .from(legalAuthorities)
    .where(eq(legalAuthorities.id, authorityId))
    .limit(1);
  return row ?? null;
}

/** Simple non-ranked listing, mainly useful for admin/debug and CLI verification. */
export async function listAuthorities(params: {
  db: Database;
  authorityType?: string;
  jurisdiction?: string;
  limit?: number;
}): Promise<LegalAuthorityRow[]> {
  const conditions: Array<ReturnType<typeof eq>> = [];
  if (params.authorityType) {
    conditions.push(
      eq(
        legalAuthorities.authorityType,
        params.authorityType as LegalAuthorityRow["authorityType"],
      ),
    );
  }
  if (params.jurisdiction) {
    conditions.push(eq(legalAuthorities.jurisdiction, params.jurisdiction));
  }
  return params.db
    .select()
    .from(legalAuthorities)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(legalAuthorities.updatedAt))
    .limit(params.limit ?? 50);
}

export type AuthorityChunkPreview = {
  id: string;
  chunkIndex: number;
  content: string;
  opinionPart: string | null;
  sectionRef: string | null;
  subsectionRef: string | null;
  pageStart: number | null;
  pageEnd: number | null;
};

export type AuthorityDetail = {
  authority: LegalAuthorityRow;
  currentVersion: typeof legalAuthorityVersions.$inferSelect | null;
  versions: Array<Omit<typeof legalAuthorityVersions.$inferSelect, "content">>;
  chunks: AuthorityChunkPreview[];
  outboundCitations: Array<typeof legalAuthorityCitations.$inferSelect>;
  relationships: Array<typeof legalAuthorityRelationships.$inferSelect>;
  treatment: TreatmentDisplay;
};

const CHUNK_PREVIEW_LIMIT = 500;

/**
 * Full authority detail used by the authority viewer: metadata, version history, a chunk
 * preview for the current version, outbound citations, and reported treatment relationships.
 * Superseded version text is intentionally never included here.
 */
export async function getAuthorityDetail(params: {
  db: Database;
  authorityId: string;
}): Promise<AuthorityDetail | null> {
  const authority = await getAuthorityById(params.db, params.authorityId);
  if (!authority) return null;

  const versionRows = await params.db
    .select()
    .from(legalAuthorityVersions)
    .where(eq(legalAuthorityVersions.authorityId, authority.id))
    .orderBy(desc(legalAuthorityVersions.versionNumber));

  const currentVersion = versionRows.find((v) => v.validTo === null) ?? versionRows[0] ?? null;

  const chunks = currentVersion
    ? await params.db
        .select({
          id: legalAuthorityChunks.id,
          chunkIndex: legalAuthorityChunks.chunkIndex,
          content: legalAuthorityChunks.content,
          opinionPart: legalAuthorityChunks.opinionPart,
          sectionRef: legalAuthorityChunks.sectionRef,
          subsectionRef: legalAuthorityChunks.subsectionRef,
          pageStart: legalAuthorityChunks.pageStart,
          pageEnd: legalAuthorityChunks.pageEnd,
        })
        .from(legalAuthorityChunks)
        .where(eq(legalAuthorityChunks.authorityVersionId, currentVersion.id))
        .orderBy(legalAuthorityChunks.chunkIndex)
        .limit(CHUNK_PREVIEW_LIMIT)
    : [];

  const outboundCitations = await params.db
    .select()
    .from(legalAuthorityCitations)
    .where(eq(legalAuthorityCitations.fromAuthorityId, authority.id));

  const relationships = await params.db
    .select()
    .from(legalAuthorityRelationships)
    .where(eq(legalAuthorityRelationships.fromAuthorityId, authority.id));

  const treatment = getTreatmentDisplay({
    treatmentStatus: authority.treatmentStatus,
    sourceProvider: authority.sourceProvider,
    relationships: relationships.map((r) => ({
      relationshipType: r.relationshipType,
      label: r.label,
      origin: r.origin,
      toAuthorityId: r.toAuthorityId,
    })),
  });

  return {
    authority,
    currentVersion,
    versions: versionRows.map(({ content: _content, ...rest }) => rest),
    chunks,
    outboundCitations,
    relationships,
    treatment,
  };
}

/** Load full chunk content for a set of chunk ids belonging to one authority (grounding text). */
export async function getAuthorityChunksByIds(
  db: Database,
  chunkIds: string[],
): Promise<Array<typeof legalAuthorityChunks.$inferSelect>> {
  const unique = [...new Set(chunkIds)].filter(isUuid);
  if (unique.length === 0) return [];
  return db.select().from(legalAuthorityChunks).where(inArray(legalAuthorityChunks.id, unique));
}
