import { and, desc, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  legalAuthorities,
  legalAuthorityRelationships,
  legalAuthorityVersions,
} from "@nyayagrid/database";
import type { EmbeddingProvider } from "@nyayagrid/ai";
import { resolveCitationAgainstCorpus } from "./citations";
import { AuthorityHybridRetriever } from "./search";
import type { AuthoritySearchOptions } from "./search";
import { getTreatmentDisplay } from "./treatment";

export type AuthoritySearchFilters = {
  jurisdiction?: string;
  court?: string;
  authorityType?: string;
  dateFrom?: string;
  dateTo?: string;
  citation?: string;
  title?: string;
  sourceProvider?: string;
};

export type AuthoritySearchHit = {
  authorityId: string;
  authorityVersionId: string;
  chunkId: string;
  title: string;
  citation: string | null;
  authorityType: string;
  jurisdiction: string | null;
  court: string | null;
  decisionDate: string | null;
  score: number;
  snippet: string;
  sectionRef?: string | null;
  pageStart?: number | null;
  opinionPart?: string | null;
};

/**
 * Pluggable source of legal authorities. Capabilities are declared so callers can degrade
 * gracefully instead of assuming a provider can answer treatment or relationship questions.
 */
export interface LegalAuthorityProvider {
  readonly name: string;
  readonly capabilities: {
    search: boolean;
    getAuthority: boolean;
    getAuthorityText: boolean;
    resolveCitation: boolean;
    relatedAuthorities: boolean;
    treatmentInfo: boolean;
  };
  search(
    query: string,
    filters?: AuthoritySearchFilters,
    limit?: number,
  ): Promise<AuthoritySearchHit[]>;
  getAuthority(authorityId: string): Promise<unknown | null>;
  getAuthorityText(authorityId: string, versionId?: string): Promise<string | null>;
  resolveCitation(citation: string): Promise<{ authorityId: string } | null>;
  relatedAuthorities?(
    authorityId: string,
  ): Promise<Array<{ authorityId: string; relationshipType: string }>>;
  treatmentInfo?(authorityId: string): Promise<{ status: string; note: string }>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

/**
 * Provider backed by authorities already imported into the NyayaGrid corpus. It performs no
 * network calls, so it can never surface an authority that has not been ingested and versioned.
 */
export class LocalImportedAuthorityProvider implements LegalAuthorityProvider {
  readonly name = "local-imported";
  readonly capabilities = {
    search: true,
    getAuthority: true,
    getAuthorityText: true,
    resolveCitation: true,
    relatedAuthorities: true,
    treatmentInfo: true,
  };

  private readonly retriever: AuthorityHybridRetriever;

  constructor(
    private readonly db: Database,
    embeddings: EmbeddingProvider,
    private readonly options: AuthoritySearchOptions = {},
  ) {
    this.retriever = new AuthorityHybridRetriever(db, embeddings);
  }

  async search(
    query: string,
    filters: AuthoritySearchFilters = {},
    limit?: number,
  ): Promise<AuthoritySearchHit[]> {
    return this.retriever.search(query, filters, {
      ...this.options,
      limit: limit ?? this.options.limit,
    });
  }

  async getAuthority(authorityId: string) {
    if (!isUuid(authorityId)) return null;
    const [row] = await this.db
      .select()
      .from(legalAuthorities)
      .where(eq(legalAuthorities.id, authorityId))
      .limit(1);
    return row ?? null;
  }

  async getAuthorityText(authorityId: string, versionId?: string): Promise<string | null> {
    if (!isUuid(authorityId)) return null;
    if (versionId && !isUuid(versionId)) return null;
    const where = versionId
      ? and(
          eq(legalAuthorityVersions.authorityId, authorityId),
          eq(legalAuthorityVersions.id, versionId),
        )
      : eq(legalAuthorityVersions.authorityId, authorityId);
    const [row] = await this.db
      .select({ content: legalAuthorityVersions.content })
      .from(legalAuthorityVersions)
      .where(where)
      .orderBy(desc(legalAuthorityVersions.versionNumber))
      .limit(1);
    return row?.content ?? null;
  }

  async resolveCitation(citation: string): Promise<{ authorityId: string } | null> {
    const resolution = await resolveCitationAgainstCorpus(this.db, citation);
    return resolution ? { authorityId: resolution.authorityId } : null;
  }

  async relatedAuthorities(
    authorityId: string,
  ): Promise<Array<{ authorityId: string; relationshipType: string }>> {
    if (!isUuid(authorityId)) return [];
    const rows = await this.db
      .select({
        authorityId: legalAuthorityRelationships.toAuthorityId,
        relationshipType: legalAuthorityRelationships.relationshipType,
      })
      .from(legalAuthorityRelationships)
      .where(eq(legalAuthorityRelationships.fromAuthorityId, authorityId));
    return rows.map((row) => ({
      authorityId: row.authorityId,
      relationshipType: row.relationshipType,
    }));
  }

  async treatmentInfo(authorityId: string): Promise<{ status: string; note: string }> {
    const authority = await this.getAuthority(authorityId);
    if (!authority) {
      const display = getTreatmentDisplay({ treatmentStatus: "unknown" });
      return { status: display.status, note: display.notes.join(" ") };
    }
    const relationships = isUuid(authorityId)
      ? await this.db
          .select({
            relationshipType: legalAuthorityRelationships.relationshipType,
            label: legalAuthorityRelationships.label,
            origin: legalAuthorityRelationships.origin,
            toAuthorityId: legalAuthorityRelationships.toAuthorityId,
          })
          .from(legalAuthorityRelationships)
          .where(eq(legalAuthorityRelationships.fromAuthorityId, authorityId))
      : [];
    const display = getTreatmentDisplay({
      treatmentStatus: authority.treatmentStatus,
      sourceProvider: authority.sourceProvider,
      relationships,
    });
    return { status: display.status, note: display.notes.join(" ") };
  }
}
