/**
 * Shared deterministic case-citation extraction for operational ingest paths.
 * ZERO network. Idempotent edge writes. Marks citationExtraction metadata state.
 *
 * Status values:
 *   PROCESSED_NONZERO | PROCESSED_ZERO | FAILED
 */
"use strict";

const { createHash, randomUUID } = require("node:crypto");

const CITATION_EXTRACTION_VERSION = "case-cite-extract-v1.1";

/** Catch-all tokens that look like vol+word+page but are not reporters (Batch4 waste). */
const NON_REPORTER_EXTRACT_TOKENS = new Set([
  "page",
  "pages",
  "id",
  "ibid",
  "supra",
  "see",
  "cf",
  "but",
  "and",
  "the",
  "at",
  "of",
  "in",
  "to",
  "for",
  "note",
  "vol",
  "doc",
  "ex",
  "exh",
  "exhibit",
  "ecf",
  "docket",
  "record",
  "app",
  "cir",
  "dist",
  "no",
  "slip",
  "op",
]);

const EXTRACT_RES = [
  /\b\d{1,3}\s+U\.?\s*S\.?\s+\d{1,4}\b/gi,
  /\b\d{1,3}\s+S\.?\s*Ct\.?\s+\d{1,4}\b/gi,
  /\b\d{1,3}\s+L\.?\s*Ed\.?\s*(?:2d\s+)?\d{1,4}\b/gi,
  /\b\d{1,4}\s+F\.?\s*(?:2d|3d|4th)\s+\d{1,4}\b/gi,
  /\b\d{1,4}\s+F\.?\s*Supp\.?\s*(?:2d|3d)?\s+\d{1,4}\b/gi,
  /\b\d{1,2}\s+U\.?\s*S\.?\s*C\.?\s*§\s*[\dA-Za-z.()-]+\b/gi,
  /\b\d{1,2}\s+C\.?\s*F\.?\s*R\.?\s*§\s*[\d.()-]+\b/gi,
  /\bFed\.?\s*R\.?\s*(?:Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s+\d+[A-Za-z]?\b/gi,
  // Regional reporters: N.W.2d, S.W.3d, P.2d, A.3d, So.2d, etc.
  /\b\d{1,4}\s+(?:N\.?\s*E\.?|N\.?\s*W\.?|S\.?\s*E\.?|S\.?\s*W\.?|A\.?|P\.?|So\.?)\s*(?:2d|3d)?\s+\d{1,4}\b/gi,
  // Two-letter dotted reporters: N.H., N.J., etc. with page
  /\b\d{1,4}\s+[A-Z]\.\s*[A-Z]\.?\s+\d{1,4}\b/g,
  // Common state reporter abbreviations with page: Ill., Cal., Mass., Idaho, etc.
  /\b\d{1,4}\s+(?:Ill|Cal|Mass|Tex|Ohio|Mich|Pa|NY|N\.Y|Fla|Ga|Va|Wash|Or|Minn|Wis|Kan|Okla|Ark|Ala|Tenn|Ky|Ind|Conn|Md|Mo|Colo|Ariz|Idaho)\.?\s*(?:2d|3d|App\.?)?\s+\d{1,4}\b/gi,
  // Historical U.S. reports
  /\b\d{1,3}\s+(?:Wall|How|Pet|Cranch|Dallas|Black)\.?\s+\d{1,4}\b/gi,
  // State neutral citations: 2026 ND 26, 2026 OK 65
  /\b(?:19|20)\d{2}\s+(?:ND|SD|OK|NM|WY|MT|KS|NE|IA|WI|MN|AK|HI|OH|UT|VT|ME|NH|NV|ID|DE|RI|SC|NC|WV)\s+\d{1,4}\b/g,
  // Catch-all state/official name reporters — post-filtered for non-reporter tokens
  /\b\d{1,4}\s+[A-Z][a-z]{0,10}\.?\s*(?:2d|3d)?\s+\d{1,4}\b/g,
];

const HEURISTIC_CITE_LIKE =
  /\b\d{1,4}\s+(?:U\.?\s*S\.?|F\.|F\.?\s*(?:2d|3d|4th)|F\.?\s*Supp|S\.?\s*Ct\.?|L\.?\s*Ed|C\.?\s*F\.?\s*R|U\.?\s*S\.?\s*C|Fed\.?\s*R\.|[A-Z][a-z]{1,10}\.?)\b/;

function sha256Text(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function normalizeCitation(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/\bU\.\s+S\./gi, "U.S.")
    .replace(/\bF\.\s+(2d|3d|4th)\b/gi, (_, x) => `F.${String(x).toLowerCase()}`)
    .replace(/\bF\.\s*Supp\.\s*(2d|3d)?/gi, (_, x) => (x ? `F. Supp. ${String(x).toLowerCase()}` : "F. Supp."))
    .trim();
}

function isExtractableCitation(normalized) {
  const t = String(normalized || "").trim();
  if (!t || t.length < 5) return false;
  // Document pagination artifacts must never enter citation edges going forward.
  if (/^\d{4}\s+Pages?\s+\d+$/i.test(t)) return false;
  const loose = t.match(/^(\d{1,4})\s+([A-Za-z][A-Za-z.]{0,20}?)\s*(?:2d|3d)?\s+(\d{1,4})$/i);
  if (loose) {
    const token = String(loose[2] || "")
      .replace(/\./g, "")
      .toLowerCase();
    if (NON_REPORTER_EXTRACT_TOKENS.has(token)) return false;
  }
  return true;
}

function extractCaseCitationsFromText(content) {
  const seen = new Set();
  const out = [];
  const text = String(content || "");
  for (const re of EXTRACT_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const raw = m[0].trim();
      const normalized = normalizeCitation(raw);
      if (!normalized || normalized.length < 5) continue;
      if (!isExtractableCitation(normalized)) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ raw, normalized });
    }
  }
  return out;
}

function looksCitationLike(content) {
  return HEURISTIC_CITE_LIKE.test(String(content || ""));
}

function buildExtractionMeta(params) {
  const { status, textHash, occurrenceCount, error } = params;
  return {
    citationExtraction: {
      status,
      version: CITATION_EXTRACTION_VERSION,
      extractedAt: new Date().toISOString(),
      textHashAtExtraction: textHash,
      occurrenceCount: occurrenceCount ?? 0,
      ...(error ? { error: String(error).slice(0, 300) } : {}),
    },
  };
}

/**
 * Idempotently insert citation edges and merge extraction state into authority metadata.
 * @returns {{ inserted: number, status: string, textHash: string, occurrenceCount: number }}
 */
async function ensureCaseCitationExtraction(sql, params) {
  const { authorityId, content, existingMetadata } = params;
  const textHash = sha256Text(content);
  try {
    const cites = extractCaseCitationsFromText(content);
    let inserted = 0;
    for (const cit of cites) {
      const dup = await sql`
        select 1 as ok from legal_authority_citations
        where from_authority_id = ${authorityId}
          and normalized_citation = ${cit.normalized}
        limit 1
      `;
      if (dup.length > 0) continue;
      const matches = await sql`
        select id from legal_authorities
        where normalized_citation = ${cit.normalized}
           or citation = ${cit.normalized}
           or citation = ${cit.raw}
        limit 2
      `;
      const toId = matches.length === 1 ? matches[0].id : null;
      await sql`
        insert into legal_authority_citations (
          id, from_authority_id, to_authority_id, raw_citation, normalized_citation
        ) values (
          ${randomUUID()}, ${authorityId}, ${toId}, ${cit.raw}, ${cit.normalized}
        )
      `;
      inserted += 1;
    }
    const status = cites.length > 0 ? "PROCESSED_NONZERO" : "PROCESSED_ZERO";
    const metaPatch = buildExtractionMeta({
      status,
      textHash,
      occurrenceCount: cites.length,
    });
    const base =
      existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
        ? existingMetadata
        : {};
    const merged = { ...base, ...metaPatch };
    await sql`
      update legal_authorities
      set metadata = ${sql.json(merged)}, updated_at = now()
      where id = ${authorityId}
    `;
    return { inserted, status, textHash, occurrenceCount: cites.length };
  } catch (err) {
    const base =
      existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
        ? existingMetadata
        : {};
    const merged = {
      ...base,
      ...buildExtractionMeta({
        status: "FAILED",
        textHash,
        occurrenceCount: 0,
        error: err && err.message ? err.message : String(err),
      }),
    };
    try {
      await sql`
        update legal_authorities
        set metadata = ${sql.json(merged)}, updated_at = now()
        where id = ${authorityId}
      `;
    } catch {
      /* ignore meta write failure */
    }
    throw err;
  }
}

module.exports = {
  CITATION_EXTRACTION_VERSION,
  sha256Text,
  normalizeCitation,
  isExtractableCitation,
  extractCaseCitationsFromText,
  looksCitationLike,
  buildExtractionMeta,
  ensureCaseCitationExtraction,
};
