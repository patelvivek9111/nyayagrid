import { and, asc, eq, inArray, isNull } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  legalAuthorities,
  legalAuthorityChunks,
  legalAuthorityVersions,
  matterAuthorities,
} from "@nyayagrid/database";

/**
 * Legal authority context for drafting.
 *
 * This loader reads only the shared authority corpus and the matter's saved-authority links. It is
 * intentionally separate from matter document chunks: those are factual evidence and are never
 * legal authority. Only current authority versions are read so superseded text cannot be drafted
 * into a document as good law.
 */
export const DRAFT_LEGAL_AUTHORITY_LABEL = "LEGAL_AUTHORITY";

export const DRAFT_LEGAL_AUTHORITY_HEADER = [
  `${DRAFT_LEGAL_AUTHORITY_LABEL} (authorities saved to this matter from the legal corpus).`,
  "Cite these chunkIds for legal propositions only.",
  "Matter Sources are factual evidence and must NEVER be cited as legal authority.",
  "Treatment and currentness are unknown unless a treatment note says a source reported them.",
].join(" ");

export const DRAFT_LEGAL_AUTHORITY_INSTRUCTION = [
  "When you state a legal rule or standard, cite chunkIds from the LEGAL_AUTHORITY block.",
  "When you state a fact about this matter, cite chunkIds from Sources.",
  "Never cite a matter Source chunkId as legal authority, and never cite authority that is not listed.",
].join(" ");

export type DraftAuthorityPassage = {
  chunkId: string;
  content: string;
  sectionRef: string | null;
  opinionPart: string | null;
};

export type DraftLegalAuthorityItem = {
  authorityId: string;
  status: string;
  relevanceNote: string | null;
  title: string;
  citation: string | null;
  authorityType: string;
  jurisdiction: string | null;
  court: string | null;
  decisionDate: string | null;
  treatmentStatus: string;
  passages: DraftAuthorityPassage[];
};

export type DraftLegalAuthorityContext = {
  items: DraftLegalAuthorityItem[];
  authorityIds: string[];
  /** Authority chunk ids a draft assertion is allowed to cite as legal authority. */
  authorityChunkIds: string[];
  warnings: string[];
};

const DEFAULT_AUTHORITY_LIMIT = 8;
const DEFAULT_PASSAGES_PER_AUTHORITY = 3;
const DEFAULT_PASSAGE_CHARS = 900;

export async function loadDraftLegalAuthorityContext(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  limit?: number;
  passagesPerAuthority?: number;
  passageChars?: number;
}): Promise<DraftLegalAuthorityContext> {
  const links = await params.db
    .select({
      authorityId: matterAuthorities.authorityId,
      status: matterAuthorities.status,
      relevanceNote: matterAuthorities.relevanceNote,
      title: legalAuthorities.title,
      citation: legalAuthorities.citation,
      authorityType: legalAuthorities.authorityType,
      jurisdiction: legalAuthorities.jurisdiction,
      court: legalAuthorities.court,
      decisionDate: legalAuthorities.decisionDate,
      treatmentStatus: legalAuthorities.treatmentStatus,
      ingestionStatus: legalAuthorities.ingestionStatus,
    })
    .from(matterAuthorities)
    .innerJoin(legalAuthorities, eq(legalAuthorities.id, matterAuthorities.authorityId))
    .where(
      and(
        eq(matterAuthorities.organizationId, params.organizationId),
        eq(matterAuthorities.matterId, params.matterId),
        inArray(matterAuthorities.status, ["key_authority", "saved"]),
      ),
    )
    .orderBy(asc(matterAuthorities.createdAt))
    .limit(params.limit ?? DEFAULT_AUTHORITY_LIMIT);

  if (links.length === 0) {
    return {
      items: [],
      authorityIds: [],
      authorityChunkIds: [],
      warnings: ["No legal authorities have been saved to this matter."],
    };
  }

  const perAuthority = params.passagesPerAuthority ?? DEFAULT_PASSAGES_PER_AUTHORITY;
  const passageChars = params.passageChars ?? DEFAULT_PASSAGE_CHARS;
  const rows = await params.db
    .select({
      chunkId: legalAuthorityChunks.id,
      authorityId: legalAuthorityChunks.authorityId,
      content: legalAuthorityChunks.content,
      sectionRef: legalAuthorityChunks.sectionRef,
      opinionPart: legalAuthorityChunks.opinionPart,
    })
    .from(legalAuthorityChunks)
    .innerJoin(
      legalAuthorityVersions,
      eq(legalAuthorityVersions.id, legalAuthorityChunks.authorityVersionId),
    )
    .where(
      and(
        inArray(
          legalAuthorityChunks.authorityId,
          links.map((link) => link.authorityId),
        ),
        isNull(legalAuthorityVersions.validTo),
      ),
    )
    .orderBy(asc(legalAuthorityChunks.authorityId), asc(legalAuthorityChunks.chunkIndex));

  const passagesByAuthority = new Map<string, DraftAuthorityPassage[]>();
  for (const row of rows) {
    const list = passagesByAuthority.get(row.authorityId) ?? [];
    if (list.length >= perAuthority) continue;
    list.push({
      chunkId: row.chunkId,
      content: row.content.slice(0, passageChars),
      sectionRef: row.sectionRef,
      opinionPart: row.opinionPart ?? null,
    });
    passagesByAuthority.set(row.authorityId, list);
  }

  const items: DraftLegalAuthorityItem[] = links
    .map((link) => ({
      authorityId: link.authorityId,
      status: link.status,
      relevanceNote: link.relevanceNote,
      title: link.title,
      citation: link.citation,
      authorityType: link.authorityType,
      jurisdiction: link.jurisdiction,
      court: link.court,
      decisionDate: link.decisionDate,
      treatmentStatus: link.treatmentStatus,
      passages: passagesByAuthority.get(link.authorityId) ?? [],
    }))
    .sort(
      (a, b) => (a.status === "key_authority" ? 0 : 1) - (b.status === "key_authority" ? 0 : 1),
    );

  const warnings: string[] = [];
  const withoutText = items.filter((item) => item.passages.length === 0);
  if (withoutText.length > 0) {
    warnings.push(
      `${withoutText.length} saved authority record(s) have no retrievable current-version text and cannot support drafted propositions.`,
    );
  }
  const notReady = links.filter((link) => link.ingestionStatus !== "ready");
  if (notReady.length > 0) {
    warnings.push(`${notReady.length} saved authority record(s) are still being ingested.`);
  }

  return {
    items,
    authorityIds: items.map((item) => item.authorityId),
    authorityChunkIds: items.flatMap((item) => item.passages.map((passage) => passage.chunkId)),
    warnings,
  };
}

/** Render the authority block for a draft prompt, clearly separated from matter evidence. */
export function formatDraftLegalAuthorityContext(ctx: DraftLegalAuthorityContext): string {
  if (ctx.items.length === 0) return "";
  const lines: string[] = [DRAFT_LEGAL_AUTHORITY_HEADER];
  for (const item of ctx.items) {
    lines.push(
      `# authorityId=${item.authorityId} | status=${item.status} | citation=${item.citation ?? "null"} | title=${item.title} | type=${item.authorityType} | court=${item.court ?? "null"} | jurisdiction=${item.jurisdiction ?? "null"} | date=${item.decisionDate ?? "null"} | treatmentStatus=${item.treatmentStatus}`,
    );
    if (item.relevanceNote) lines.push(`  attorneyRelevanceNote=|${item.relevanceNote}|`);
    if (item.passages.length === 0) {
      lines.push("  (no retrievable passage text; do not rely on this authority)");
      continue;
    }
    for (const passage of item.passages) {
      lines.push(
        `- authorityChunkId=${passage.chunkId} | authorityId=${item.authorityId} | section=${passage.sectionRef ?? "null"} | opinionPart=${passage.opinionPart ?? "null"} | text=|${passage.content}|`,
      );
    }
  }
  return lines.join("\n");
}
