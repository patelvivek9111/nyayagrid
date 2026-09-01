import { and, asc, eq, inArray, isNull, or, sql } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  legalAuthorities,
  legalAuthorityChunks,
  legalAuthorityVersions,
  matterAuthorities,
} from "@nyayagrid/database";
import type { ResearchAuthorityChunk } from "@nyayagrid/ai";
import type { MatterAuthorityStatus } from "./matter-authorities";
import { validateQuoteAgainstText } from "./quotes";
import { getTreatmentSummaryLine } from "./treatment";

/** Label used everywhere legal authority text is handed to a model. */
export const LEGAL_AUTHORITY_CONTEXT_LABEL = "LEGAL_AUTHORITY";

export const LEGAL_AUTHORITY_CONTEXT_HEADER = [
  `${LEGAL_AUTHORITY_CONTEXT_LABEL} (authorities saved to this matter from the legal corpus).`,
  "These passages are the ONLY permissible basis for rules, holdings, and quotations.",
  "They are NOT matter evidence, and matter documents are NOT legal authority.",
  "Treatment and currentness are unknown unless a treatment note says a source reported them.",
].join(" ");

export const NO_AUTHORITY_CORPUS_NOTICE =
  "Authoritative legal research has not been performed for this question: no legal authority corpus passages were retrieved. Model training knowledge is not a legal source.";

export const AUTHORITY_COVERAGE_INCOMPLETE_NOTICE =
  "Legal authority coverage is incomplete; the answer may omit controlling or contrary authority.";

const DEFAULT_AUTHORITY_LIMIT = 12;
const DEFAULT_PASSAGES_PER_AUTHORITY = 3;
const DEFAULT_PASSAGE_CHARS = 900;

export type MatterAuthorityPassage = {
  chunkId: string;
  authorityVersionId: string;
  content: string;
  sectionRef: string | null;
  opinionPart: string | null;
  pageStart: number | null;
};

export type MatterLegalAuthorityItem = {
  matterAuthorityId: string;
  authorityId: string;
  status: MatterAuthorityStatus;
  relevanceNote: string | null;
  title: string;
  shortTitle: string | null;
  citation: string | null;
  normalizedCitation: string | null;
  authorityType: string;
  jurisdiction: string | null;
  court: string | null;
  decisionDate: string | null;
  treatmentSummary: string;
  passages: MatterAuthorityPassage[];
};

export type MatterLegalAuthorityContext = {
  matterId: string;
  items: MatterLegalAuthorityItem[];
  /** Statuses that were included in the query, so callers can explain what was left out. */
  includedStatuses: MatterAuthorityStatus[];
  /** True when at least one included authority contributed retrievable passages. */
  hasPassages: boolean;
  warnings: string[];
};

/**
 * Load the authorities a matter team has saved, with optional passage text.
 *
 * Only current authority versions are read (valid_to IS NULL), so superseded language cannot be
 * handed to a model as good law. Matter document chunks are never touched here.
 */
export async function loadMatterLegalAuthorityContext(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  limit?: number;
  statuses?: MatterAuthorityStatus[];
  includePassages?: boolean;
  passagesPerAuthority?: number;
  passageChars?: number;
}): Promise<MatterLegalAuthorityContext> {
  const includedStatuses =
    params.statuses ?? (["key_authority", "saved"] as MatterAuthorityStatus[]);
  const limit = params.limit ?? DEFAULT_AUTHORITY_LIMIT;

  const links = await params.db
    .select({
      matterAuthorityId: matterAuthorities.id,
      authorityId: matterAuthorities.authorityId,
      status: matterAuthorities.status,
      relevanceNote: matterAuthorities.relevanceNote,
      title: legalAuthorities.title,
      shortTitle: legalAuthorities.shortTitle,
      citation: legalAuthorities.citation,
      normalizedCitation: legalAuthorities.normalizedCitation,
      authorityType: legalAuthorities.authorityType,
      jurisdiction: legalAuthorities.jurisdiction,
      court: legalAuthorities.court,
      decisionDate: legalAuthorities.decisionDate,
      treatmentStatus: legalAuthorities.treatmentStatus,
      sourceProvider: legalAuthorities.sourceProvider,
      ingestionStatus: legalAuthorities.ingestionStatus,
    })
    .from(matterAuthorities)
    .innerJoin(legalAuthorities, eq(legalAuthorities.id, matterAuthorities.authorityId))
    .where(
      and(
        eq(matterAuthorities.organizationId, params.organizationId),
        eq(matterAuthorities.matterId, params.matterId),
        inArray(matterAuthorities.status, includedStatuses),
      ),
    )
    .orderBy(asc(matterAuthorities.createdAt))
    .limit(limit);

  const warnings: string[] = [];
  const notReady = links.filter((link) => link.ingestionStatus !== "ready");
  if (notReady.length > 0) {
    warnings.push(
      `${notReady.length} saved authority record(s) are not fully ingested; their text may be unavailable.`,
    );
  }

  const passagesByAuthority = new Map<string, MatterAuthorityPassage[]>();
  if (params.includePassages !== false && links.length > 0) {
    const perAuthority = params.passagesPerAuthority ?? DEFAULT_PASSAGES_PER_AUTHORITY;
    const passageChars = params.passageChars ?? DEFAULT_PASSAGE_CHARS;
    const rows = await params.db
      .select({
        chunkId: legalAuthorityChunks.id,
        authorityId: legalAuthorityChunks.authorityId,
        authorityVersionId: legalAuthorityChunks.authorityVersionId,
        content: legalAuthorityChunks.content,
        sectionRef: legalAuthorityChunks.sectionRef,
        opinionPart: legalAuthorityChunks.opinionPart,
        pageStart: legalAuthorityChunks.pageStart,
        chunkIndex: legalAuthorityChunks.chunkIndex,
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

    for (const row of rows) {
      const list = passagesByAuthority.get(row.authorityId) ?? [];
      if (list.length >= perAuthority) continue;
      list.push({
        chunkId: row.chunkId,
        authorityVersionId: row.authorityVersionId,
        content: row.content.slice(0, passageChars),
        sectionRef: row.sectionRef,
        opinionPart: row.opinionPart ?? null,
        pageStart: row.pageStart,
      });
      passagesByAuthority.set(row.authorityId, list);
    }
  }

  const statusRank = (status: MatterAuthorityStatus) => (status === "key_authority" ? 0 : 1);
  const items: MatterLegalAuthorityItem[] = links.map((link) => ({
    matterAuthorityId: link.matterAuthorityId,
    authorityId: link.authorityId,
    status: link.status,
    relevanceNote: link.relevanceNote,
    title: link.title,
    shortTitle: link.shortTitle,
    citation: link.citation,
    normalizedCitation: link.normalizedCitation,
    authorityType: link.authorityType,
    jurisdiction: link.jurisdiction,
    court: link.court,
    decisionDate: link.decisionDate,
    treatmentSummary: getTreatmentSummaryLine({
      treatmentStatus: link.treatmentStatus,
      sourceProvider: link.sourceProvider,
      relationships: [],
    }),
    passages: passagesByAuthority.get(link.authorityId) ?? [],
  }));
  items.sort((a, b) => statusRank(a.status) - statusRank(b.status));

  if (items.length === 0) {
    warnings.push("No legal authorities have been saved to this matter.");
  }

  return {
    matterId: params.matterId,
    items,
    includedStatuses,
    hasPassages: items.some((item) => item.passages.length > 0),
    warnings,
  };
}

/**
 * Render matter authorities for a prompt. The block is labeled LEGAL_AUTHORITY and each passage
 * carries its authorityId/chunkId so citations can be validated after generation.
 */
export function formatLegalAuthorityContextForPrompt(ctx: MatterLegalAuthorityContext): string {
  if (ctx.items.length === 0) return "";
  const lines: string[] = [LEGAL_AUTHORITY_CONTEXT_HEADER];
  for (const item of ctx.items) {
    lines.push(
      `# authorityId=${item.authorityId} | status=${item.status} | citation=${item.citation ?? "null"} | title=${item.title} | type=${item.authorityType} | court=${item.court ?? "null"} | jurisdiction=${item.jurisdiction ?? "null"} | date=${item.decisionDate ?? "null"} | treatment=${item.treatmentSummary}`,
    );
    if (item.relevanceNote) {
      lines.push(`  attorneyRelevanceNote=|${item.relevanceNote}|`);
    }
    if (item.passages.length === 0) {
      lines.push("  (no retrievable passage text for this authority)");
      continue;
    }
    for (const passage of item.passages) {
      lines.push(
        `- authorityId=${item.authorityId} | chunkId=${passage.chunkId} | citation=${item.citation ?? "null"} | court=${item.court ?? "null"} | date=${item.decisionDate ?? "null"} | section=${passage.sectionRef ?? "null"} | opinionPart=${passage.opinionPart ?? "null"} | text=|${passage.content}|`,
      );
    }
  }
  return lines.join("\n");
}

/** Convert matter authority context into the chunk shape the research prompts expect. */
export function matterAuthorityContextToChunks(
  ctx: MatterLegalAuthorityContext,
): ResearchAuthorityChunk[] {
  return ctx.items.flatMap((item) =>
    item.passages.map((passage) => ({
      authorityId: item.authorityId,
      chunkId: passage.chunkId,
      citation: item.citation,
      court: item.court,
      date: item.decisionDate,
      content: passage.content,
    })),
  );
}

export type AuthorityChunkProvenance = {
  chunkId: string;
  authorityId: string;
  authorityVersionId: string;
  content: string;
  sectionRef: string | null;
  subsectionRef: string | null;
  opinionPart: string | null;
  pageStart: number | null;
  title: string;
  citation: string | null;
  authorityType: string;
  jurisdiction: string | null;
  court: string | null;
  decisionDate: string | null;
};

/**
 * Load authority chunk text for citation and quote validation. Nothing here reads matter data, and
 * only chunks that actually exist in the corpus come back — an unknown id simply has no entry.
 */
export async function loadAuthorizedAuthorityChunks(params: {
  db: Database;
  chunkIds?: string[];
  authorityIds?: string[];
  currentVersionsOnly?: boolean;
  limit?: number;
}): Promise<Map<string, AuthorityChunkProvenance>> {
  const chunkIds = [...new Set((params.chunkIds ?? []).filter(Boolean))];
  const authorityIds = [...new Set((params.authorityIds ?? []).filter(Boolean))];
  if (chunkIds.length === 0 && authorityIds.length === 0) return new Map();

  const idConditions: Array<ReturnType<typeof sql>> = [];
  if (chunkIds.length > 0) idConditions.push(inArray(legalAuthorityChunks.id, chunkIds));
  if (authorityIds.length > 0) {
    idConditions.push(inArray(legalAuthorityChunks.authorityId, authorityIds));
  }
  const conditions: Array<ReturnType<typeof sql>> = [
    idConditions.length === 1 ? idConditions[0]! : or(...idConditions)!,
  ];
  if (params.currentVersionsOnly !== false) {
    conditions.push(isNull(legalAuthorityVersions.validTo));
  }

  const rows = await params.db
    .select({
      chunkId: legalAuthorityChunks.id,
      authorityId: legalAuthorityChunks.authorityId,
      authorityVersionId: legalAuthorityChunks.authorityVersionId,
      content: legalAuthorityChunks.content,
      sectionRef: legalAuthorityChunks.sectionRef,
      subsectionRef: legalAuthorityChunks.subsectionRef,
      opinionPart: legalAuthorityChunks.opinionPart,
      pageStart: legalAuthorityChunks.pageStart,
      chunkIndex: legalAuthorityChunks.chunkIndex,
      title: legalAuthorities.title,
      citation: legalAuthorities.citation,
      authorityType: legalAuthorities.authorityType,
      jurisdiction: legalAuthorities.jurisdiction,
      court: legalAuthorities.court,
      decisionDate: legalAuthorities.decisionDate,
    })
    .from(legalAuthorityChunks)
    .innerJoin(legalAuthorities, eq(legalAuthorities.id, legalAuthorityChunks.authorityId))
    .innerJoin(
      legalAuthorityVersions,
      eq(legalAuthorityVersions.id, legalAuthorityChunks.authorityVersionId),
    )
    .where(and(...conditions))
    .orderBy(asc(legalAuthorityChunks.authorityId), asc(legalAuthorityChunks.chunkIndex))
    .limit(params.limit ?? 400);

  return new Map(
    rows.map((row) => [
      row.chunkId,
      {
        chunkId: row.chunkId,
        authorityId: row.authorityId,
        authorityVersionId: row.authorityVersionId,
        content: row.content,
        sectionRef: row.sectionRef,
        subsectionRef: row.subsectionRef,
        opinionPart: row.opinionPart ?? null,
        pageStart: row.pageStart,
        title: row.title,
        citation: row.citation,
        authorityType: row.authorityType,
        jurisdiction: row.jurisdiction,
        court: row.court,
        decisionDate: row.decisionDate,
      },
    ]),
  );
}

export type AuthorityMentionValidation = {
  /** Authority and chunk identifiers mentioned in the text that were part of the provided context. */
  citedAuthorityIds: string[];
  citedChunkIds: string[];
  /** Identifiers that look like corpus ids but were not in the provided context. */
  unknownIdentifiers: string[];
  /** Quoted spans that could not be matched verbatim to any provided source text. */
  unverifiedQuotes: string[];
};

const UUID_MENTION_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const QUOTED_SPAN_PATTERN = /"([^"\n]{40,400})"/g;

/**
 * Best-effort validation of authority references inside free-form answer text.
 *
 * Prose answers do not carry structured citations, so this checks the two things that can be
 * checked: any corpus identifier it names must have been supplied as context, and any quoted span
 * must appear verbatim in a supplied source. Findings are reported, never silently accepted.
 */
export function validateAuthorityMentionsInText(
  text: string,
  allowed: { authorityIds: Set<string>; chunkIds: Set<string>; sourceTexts: string[] },
): AuthorityMentionValidation {
  const citedAuthorityIds = new Set<string>();
  const citedChunkIds = new Set<string>();
  const unknownIdentifiers = new Set<string>();

  for (const match of text.matchAll(UUID_MENTION_PATTERN)) {
    const id = match[0].toLowerCase();
    if (allowed.authorityIds.has(id)) citedAuthorityIds.add(id);
    else if (allowed.chunkIds.has(id)) citedChunkIds.add(id);
    else unknownIdentifiers.add(id);
  }

  const unverifiedQuotes: string[] = [];
  for (const match of text.matchAll(QUOTED_SPAN_PATTERN)) {
    const quote = match[1];
    if (!quote) continue;
    const verified = allowed.sourceTexts.some(
      (source) => validateQuoteAgainstText(quote, source).valid,
    );
    if (!verified) unverifiedQuotes.push(quote);
  }

  return {
    citedAuthorityIds: [...citedAuthorityIds],
    citedChunkIds: [...citedChunkIds],
    unknownIdentifiers: [...unknownIdentifiers],
    unverifiedQuotes,
  };
}

const DOCTRINE_PATTERNS = [
  /\bcase ?law\b/i,
  /\bprecedent\b/i,
  /\bstatut(e|es|ory)\b/i,
  /\bregulation(s)?\b/i,
  /\bdoctrine\b/i,
  /\belements? of\b/i,
  /\bburden of proof\b/i,
  /\bstandard of review\b/i,
  /\blegal standard\b/i,
  /\bwhat is the (law|rule|test)\b/i,
  /\bis it (legal|lawful|enforceable)\b/i,
  /\benforceab(le|ility)\b/i,
  /\bstatute of limitations\b/i,
  /\bjurisdiction(al)?\s+(requirement|test|standard)/i,
  /\b(cite|citation|authority|authorities)\b/i,
  /\bcourt(s)? (have|has) held\b/i,
  /\bunder\s+§/i,
  /§\s*\d/,
  /\bcan (we|i|they|plaintiff|defendant) (sue|recover|enjoin|compel)\b/i,
  /\bunder (the )?(governing |recorded )?law\b/i,
  /\b(limitations? period|time[- ]bar)\b/i,
  /\baction.{0,80}commenced\b/i,
  /\bsentencing\b/i,
  /\bcriminal[- ]law\b/i,
];

/**
 * Heuristic gate for whether a matter question is asking about law rather than matter facts.
 * False positives only cause an extra authority lookup; false negatives leave the answer
 * document-only, which is the safe direction.
 */
export function looksLikeLegalDoctrineQuestion(question: string): boolean {
  const text = question.trim();
  if (!text) return false;
  return DOCTRINE_PATTERNS.some((pattern) => pattern.test(text));
}
