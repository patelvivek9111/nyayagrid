/**
 * Wave 2F citation edge classifier — family buckets + unresolved WHY codes (A–F).
 * Can run locally on a JSON dump or classify individual citations from the CLI.
 */
"use strict";

const FAMILY_BUCKETS = [
  "us_reports",
  "federal_reporter",
  "federal_supplement",
  "regional_reporter",
  "usc",
  "cfr",
  "federal_rules",
  "state_statute",
  "state_regulation",
  "state_court_rules",
  "slip_unreported",
  "docket_like",
  "malformed_partial",
  "unknown",
];

const WHY_CODES = [
  "A_target_absent",
  "B_normalization_mismatch",
  "C_parser_gap",
  "D_ambiguous",
  "E_malformed",
  "F_unsupported_family",
];

const PARSER_SUPPORTED_FAMILIES = new Set([
  "us_reports",
  "federal_reporter",
  "federal_supplement",
  "regional_reporter",
  "usc",
  "cfr",
  "federal_rules",
  "state_statute",
  "state_regulation",
  "state_court_rules",
]);

function collapseWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeCitationWhitespace(raw) {
  return collapseWhitespace(raw)
    .replace(/\s*§\s*/g, " § ")
    .replace(/\s+,/g, ",");
}

function citationLookupAliases(normalizedOrRaw) {
  const base = normalizeCitationWhitespace(normalizedOrRaw);
  if (!base) return [];
  const aliases = new Set([base, base.replace(/\b(2D|3D|4TH)\b/g, (m) => m.toLowerCase())]);

  const cfr = base.match(/^(\d{1,2})\s+C\.?\s?F\.?\s?R\.?\s*§\s*(.+)$/i);
  if (cfr) {
    aliases.add(`${cfr[1]} C.F.R. § ${cfr[2]}`);
    aliases.add(`${cfr[1]} CFR § ${cfr[2]}`);
  }

  const usc = base.match(/^(\d{1,2})\s+U\.?\s?S\.?\s?C\.?\s*§\s*(.+)$/i);
  if (usc) {
    aliases.add(`${usc[1]} U.S.C. § ${usc[2]}`);
    aliases.add(`${usc[1]} USC § ${usc[2]}`);
  }

  const fr = base.match(/^Fed\.?\s*R\.?\s*(Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s+(\d+[A-Za-z]?)$/i);
  if (fr) {
    const kind = fr[1].replace(/\s+/g, " ").trim().toLowerCase();
    let reporter = "Fed. R. Civ. P.";
    if (/^evid/i.test(kind)) reporter = "Fed. R. Evid.";
    else if (/^app/i.test(kind)) reporter = "Fed. R. App. P.";
    else if (/^crim/i.test(kind)) reporter = "Fed. R. Crim. P.";
    aliases.add(`${reporter} ${fr[2]}`);
  }

  const usRep = base.match(/^(\d{1,3})\s+U\.?\s*S\.?\s+(\d{1,4})$/i);
  if (usRep) {
    aliases.add(`${usRep[1]} U.S. ${usRep[2]}`);
    aliases.add(`${usRep[1]} U. S. ${usRep[2]}`);
  }

  const fReporter = base.match(/^(\d{1,4})\s+F\.?\s*(Supp\.?)?\s*(2d|3d|4th)?\s+(\d{1,4})$/i);
  if (fReporter) {
    const vol = fReporter[1];
    const page = fReporter[4];
    const series = (fReporter[3] ?? "").toLowerCase();
    if (fReporter[2]) {
      aliases.add(`${vol} F. Supp.${series ? ` ${series}` : ""} ${page}`.replace(/\s+/g, " ").trim());
    } else if (series) {
      aliases.add(`${vol} F.${series} ${page}`);
      aliases.add(`${vol} F. ${series} ${page}`);
    }
  }

  const sct = base.match(/^(\d{1,3})\s+S\.?\s*Ct\.?\s+(\d{1,4})$/i);
  if (sct) {
    aliases.add(`${sct[1]} S. Ct. ${sct[2]}`);
    aliases.add(`${sct[1]} S.Ct. ${sct[2]}`);
  }

  return [...aliases].filter(Boolean);
}

/** Deterministic normalize for USC/CFR/Fed rules + common state forms (matches lean import + parsers). */
function leanNormalizeCitation(citation) {
  if (!citation) return null;
  let c = normalizeCitationWhitespace(citation);

  const cfr = c.match(/^(\d{1,2})\s+C\.?\s?F\.?\s?R\.?\s*§\s*(.+)$/i);
  if (cfr) return `${cfr[1]} C.F.R. § ${cfr[2]}`;

  const usc = c.match(/^(\d{1,2})\s+U\.?\s?S\.?\s?C\.?\s*§\s*(.+)$/i);
  if (usc) return `${usc[1]} U.S.C. § ${usc[2]}`;

  const fr = c.match(/^Fed\.?\s*R\.?\s*(Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s+(\d+[A-Za-z]?)$/i);
  if (fr) {
    const kind = fr[1].replace(/\s+/g, " ").trim().toLowerCase();
    let reporter = "Fed. R. Civ. P.";
    if (/^evid/i.test(kind)) reporter = "Fed. R. Evid.";
    else if (/^app/i.test(kind)) reporter = "Fed. R. App. P.";
    else if (/^crim/i.test(kind)) reporter = "Fed. R. Crim. P.";
    return `${reporter} ${fr[2]}`;
  }

  const paCode = c.match(/^(\d{1,3})\s+Pa\.?\s*Code\s*§+\s*([\d.]+)$/i);
  if (paCode) return `${paCode[1]} Pa. Code § ${paCode[2]}`;

  const flaAdmin = c.match(/^Fla\.?\s*Admin\.?\s*Code\s*R\.?\s*([\dA-Za-z.-]+)$/i);
  if (flaAdmin) return `Fla. Admin. Code R. ${flaAdmin[1]}`;

  const paRcp = c.match(/^Pa\.?\s*R\.?\s*C\.?\s*P\.?\s*([\d.]+)$/i);
  if (paRcp) return `Pa.R.C.P. ${paRcp[1]}`;

  const flaRcp = c.match(/^Fla\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)$/i);
  if (flaRcp) return `Fla. R. Civ. P. ${flaRcp[1]}`;

  const calRules = c.match(/^Cal\.?\s*Rules?\s+of\s+Court(?:\s*,?\s*rule)?\s*([\d.]+)$/i);
  if (calRules) return `Cal. Rules of Court, rule ${calRules[1]}`;

  const texRcp = c.match(/^Tex\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\dA-Za-z.]+)$/i);
  if (texRcp) return `Tex. R. Civ. P. ${texRcp[1]}`;

  const usReports = c.match(/^(\d{1,3})\s+U\.?\s*S\.?\s+(\d{1,4})$/i);
  if (usReports) return `${usReports[1]} U.S. ${usReports[2]}`;

  const swRep = c.match(/^(\d{1,4})\s+S\.?\s*W\.?\s*(2d|3d)\s+(\d{1,4})$/i);
  if (swRep) return `${swRep[1]} S.W.${swRep[2]} ${swRep[3]}`;

  const soRep = c.match(/^(\d{1,4})\s+So\.?\s*(2d|3d)?\s+(\d{1,4})$/i);
  if (soRep) return `${soRep[1]} So.${soRep[2] ? ` ${soRep[2]}` : ""} ${soRep[3]}`.replace(/\s+/g, " ");

  const fSupp = c.match(/^(\d{1,4})\s+F\.?\s*Supp\.?(?:\s?(2d|3d|4th))?\s+(\d{1,4})$/i);
  if (fSupp) {
    const series = fSupp[2] ? ` ${fSupp[2].toLowerCase()}` : "";
    return `${fSupp[1]} F. Supp.${series} ${fSupp[3]}`;
  }

  const fRep = c.match(/^(\d{1,4})\s+F\.?\s*(2d|3d|4th)?\s+(\d{1,4})$/i);
  if (fRep) {
    const series = (fRep[2] || "").toLowerCase();
    return series ? `${fRep[1]} F.${series} ${fRep[3]}` : `${fRep[1]} F. ${fRep[3]}`;
  }

  const atl = c.match(/^(\d{1,4})\s+A\.(?:\s?(2d|3d))?\s+(\d{1,4})$/i);
  if (atl) return `${atl[1]} A.${atl[2] ? atl[2] : ""} ${atl[3]}`.replace(/\s+/g, " ");

  const paCs = c.match(/^(\d{1,3})\s+Pa\.?\s*C\.?\s*S\.?(?:\s*Ann\.?)?\s*§+\s*(\d[\w.\-]*)$/i);
  if (paCs) return `${paCs[1]} Pa.C.S. § ${paCs[2]}`;

  return c;
}

function isGarbageCitation(text) {
  if (!text || !text.trim()) return true;
  const t = text.trim();
  if (t.length < 3) return true;
  if (/^[\W_]+$/.test(t)) return true;
  if (/^(see|cf\.|e\.g\.|id\.|supra|infra|ibid\.?)$/i.test(t)) return true;
  return false;
}

function classifyCitationFamily(raw, normalized) {
  const text = normalizeCitationWhitespace(normalized || raw || "");
  if (!text) return "unknown";
  if (isGarbageCitation(text)) return "malformed_partial";

  if (/\b\d{1,3}\s+U\.?\s*S\.?\s+\d{1,4}\b/i.test(text)) return "us_reports";
  if (/\b\d{1,4}\s+F\.?\s*Supp\.?(?:\s?(?:2d|3d|4th))?\s+\d{1,4}\b/i.test(text)) return "federal_supplement";
  if (/\b\d{1,4}\s+F\.(?:\s?(?:2d|3d|4th))?\s+\d{1,4}\b/i.test(text)) return "federal_reporter";
  if (/\b\d{1,4}\s+(?:A\.|N\.?E\.|S\.?E\.|S\.?W\.|N\.?W\.|P\.|P\.?\s?2d|P\.?\s?3d|So\.|So\.?\s?2d|So\.?\s?3d|Cal\.?\s?Rptr\.?|N\.?Y\.?S\.?)(?:\s?(?:2d|3d))?\s+\d{1,4}\b/i.test(text)) {
    return "regional_reporter";
  }
  if (/\b\d{1,4}\s+S\.?\s*W\.?\s*(?:2d|3d)\s+\d{1,4}\b/i.test(text)) return "regional_reporter";
  if (/\b\d{1,4}\s+So\.?\s*(?:2d|3d)\s+\d{1,4}\b/i.test(text)) return "regional_reporter";
  if (/\b\d{1,2}\s+U\.?\s?S\.?\s?C\.?\s*§/i.test(text)) return "usc";
  if (/\b\d{1,2}\s+C\.?\s?F\.?\s?R\.?\s*§/i.test(text)) return "cfr";
  if (/\bFed\.?\s*R\.?\s*(?:Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s+\d/i.test(text)) return "federal_rules";

  if (
    /\b(?:Pa\.?\s*R\.?\s*C\.?\s*P\.?|Fla\.?\s*R\.?\s*Civ\.?\s*P\.?|Va\.?\s*Sup\.?\s*Ct\.?\s*R\.?|Cal\.?\s*Rules?\s+of\s+Court|Tex\.?\s*R\.?\s*Civ\.?\s*P\.?|Mass\.?\s*R\.?\s*Civ\.?\s*P\.?|N\.?\s*J\.?\s*Ct\.?\s*R\.?|Ill\.?\s*S\.?\s*Ct\.?\s*R\.?|Del\.?\s*Super\.?\s*Ct\.?\s*Civ\.?\s*R\.?)\b/i.test(
      text,
    )
  ) {
    return "state_court_rules";
  }

  if (
    /\b(?:Pa\.?\s*Code|Fla\.?\s*Admin\.?\s*Code|\d+\s*VAC|\d+\s+DE\s+Admin\.?\s*Code|Ill\.?\s*Admin\.?\s*Code)\b/i.test(
      text,
    )
  ) {
    return "state_regulation";
  }

  if (
    /\b\d{1,3}\s+(?:Pa\.?\s*C\.?\s*S\.?|N\.?J\.?\s*S\.?A\.?|N\.?Y\.?\s*(?:C\.?L\.?S\.?|Consol\.)|Cal\.?\s*(?:Civ\.?\s*)?Code|Tex\.?\s*(?:Bus\.?\s*&?\s*Com\.?\s*)?Code|Fla\.?\s*Stat\.?|Ill\.?\s*Comp\.?\s*Stat\.?|Mass\.?\s*Gen\.?\s*Laws|Va\.?\s*Code\s*Ann\.?|Del\.?\s*Code\s*Ann\.?)\s*§/i.test(
      text,
    ) ||
    /\b(?:[A-Z][A-Za-z'’.\- ]{2,40}?Code)\s*§/i.test(text)
  ) {
    return "state_statute";
  }

  if (/\b(?:slip\s+op\.?|unreported|WL\s+\d+|Westlaw\s+\d+)\b/i.test(text)) return "slip_unreported";
  if (/\b(?:No\.|Dkt\.|Case\s+No\.|C\.A\.?\s+No\.|S\.?C\.?t\.?\s+No\.)\s*[\dA-Z-]+/i.test(text)) return "docket_like";

  if (/^\d{4,5}\s+F\.\s*Supp/i.test(text)) return "malformed_partial";
  if (/^\d{1,4}\s+[A-Z.]{1,6}\.?\s*$/i.test(text)) return "malformed_partial";
  if (/\b\d{1,4}\s+[A-Z.]{1,8}\.?\s+\d/i.test(text) && !/\bU\.?\s?S\.?\b/i.test(text)) return "unknown";

  return "unknown";
}

function collectLookupKeys(raw, normalized) {
  const keys = new Set();
  for (const value of [normalized, raw, leanNormalizeCitation(raw), leanNormalizeCitation(normalized)].filter(Boolean)) {
    for (const alias of citationLookupAliases(value)) keys.add(alias);
  }
  return [...keys];
}

/**
 * Build authority index: Map<lookupKey, authorityId[]>
 */
function buildAuthorityIndex(authorities) {
  const index = new Map();
  for (const auth of authorities) {
    const id = auth.id;
    const values = [auth.normalized_citation, auth.normalizedCitation, auth.citation].filter(Boolean);
    for (const v of values) {
      for (const key of citationLookupAliases(v)) {
        if (!index.has(key)) index.set(key, []);
        const arr = index.get(key);
        if (!arr.includes(id)) arr.push(id);
      }
    }
  }
  return index;
}

function resolveAuthorityMatches(index, raw, normalized) {
  const matchedIds = new Set();
  for (const key of collectLookupKeys(raw, normalized)) {
    const hits = index.get(key) || [];
    for (const id of hits) matchedIds.add(id);
  }
  return [...matchedIds];
}

function resolveAuthorityMatchesWithRawOnly(index, raw) {
  const matchedIds = new Set();
  for (const key of collectLookupKeys(raw, null)) {
    const hits = index.get(key) || [];
    for (const id of hits) matchedIds.add(id);
  }
  return [...matchedIds];
}

function determineWhyUnresolved(edge, index, family) {
  const raw = normalizeCitationWhitespace(edge.raw_citation || edge.rawCitation || "");
  const normalized = normalizeCitationWhitespace(edge.normalized_citation || edge.normalizedCitation || "");

  if (isGarbageCitation(raw) && isGarbageCitation(normalized)) return "E_malformed";
  if (family === "malformed_partial") return "E_malformed";
  if (!PARSER_SUPPORTED_FAMILIES.has(family)) return "F_unsupported_family";

  const directMatches = resolveAuthorityMatches(index, raw, normalized);
  if (directMatches.length > 1) return "D_ambiguous";
  if (directMatches.length === 1) return null;

  const normalizedOnly = leanNormalizeCitation(raw) || leanNormalizeCitation(normalized);
  const normMatches = resolveAuthorityMatches(index, raw, normalizedOnly);
  if (normMatches.length > 1) return "D_ambiguous";
  if (normMatches.length === 1) return "B_normalization_mismatch";

  const rawOnlyMatches = resolveAuthorityMatchesWithRawOnly(index, raw);
  if (rawOnlyMatches.length > 1) return "D_ambiguous";
  if (rawOnlyMatches.length === 1) return "B_normalization_mismatch";

  if (PARSER_SUPPORTED_FAMILIES.has(family)) return "A_target_absent";
  return "C_parser_gap";
}

function classifyEdge(edge, index, { resolvedOnly = false } = {}) {
  const raw = edge.raw_citation || edge.rawCitation || "";
  const normalized = edge.normalized_citation || edge.normalizedCitation || null;
  const family = classifyCitationFamily(raw, normalized);
  const resolved = Boolean(edge.to_authority_id || edge.toAuthorityId);
  let why = null;
  if (!resolved && !resolvedOnly) {
    why = determineWhyUnresolved(edge, index, family);
  }
  return { family, why, resolved };
}

function emptyBucketCounts(keys) {
  const out = {};
  for (const k of keys) out[k] = 0;
  return out;
}

function auditCitationEdges(edges, authorities, options = {}) {
  const index = buildAuthorityIndex(authorities);
  const families = emptyBucketCounts(FAMILY_BUCKETS);
  const why = emptyBucketCounts(WHY_CODES);
  const samples = {};
  for (const f of FAMILY_BUCKETS) samples[f] = [];
  const whySamples = {};
  for (const w of WHY_CODES) whySamples[w] = [];

  let total = 0;
  let resolved = 0;
  let unresolved = 0;

  for (const edge of edges) {
    total += 1;
    const isResolved = Boolean(edge.to_authority_id || edge.toAuthorityId);
    if (isResolved) resolved += 1;
    else unresolved += 1;

    const result = classifyEdge(edge, index, options);
    families[result.family] = (families[result.family] || 0) + 1;
    if (result.why) {
      why[result.why] = (why[result.why] || 0) + 1;
      if (whySamples[result.why].length < 5) {
        whySamples[result.why].push({
          raw: edge.raw_citation || edge.rawCitation,
          normalized: edge.normalized_citation || edge.normalizedCitation,
          family: result.family,
        });
      }
    }
    if (samples[result.family].length < 5) {
      samples[result.family].push({
        raw: edge.raw_citation || edge.rawCitation,
        normalized: edge.normalized_citation || edge.normalizedCitation,
        why: result.why,
        resolved: isResolved,
      });
    }
  }

  return {
    totals: { total, resolved, unresolved },
    families,
    whyUnresolved: why,
    samples,
    whySamples,
  };
}

function parseJsonDump(data) {
  if (Array.isArray(data)) {
    return { edges: data, authorities: [] };
  }
  const edges = data.edges || data.citations || data.legal_authority_citations || [];
  const authorities = data.authorities || data.legal_authorities || [];
  return { edges, authorities };
}

function classifyOneCitation(text) {
  const raw = String(text || "");
  const normalized = leanNormalizeCitation(raw);
  const family = classifyCitationFamily(raw, normalized);
  return {
    raw,
    normalized,
    family,
    aliases: citationLookupAliases(normalized || raw),
    parserSupported: PARSER_SUPPORTED_FAMILIES.has(family),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--help" || args[0] === "-h") {
    console.log(
      JSON.stringify(
        {
          usage: [
            "node scripts/wave2f-citation-audit.cjs <dump.json>",
            "node scripts/wave2f-citation-audit.cjs --classify \"410 U.S. 113\"",
            "node scripts/wave2f-citation-audit.cjs --families",
          ],
          families: FAMILY_BUCKETS,
          whyCodes: WHY_CODES,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args[0] === "--families") {
    console.log(JSON.stringify({ families: FAMILY_BUCKETS, whyCodes: WHY_CODES, parserSupported: [...PARSER_SUPPORTED_FAMILIES] }, null, 2));
    return;
  }

  if (args[0] === "--classify") {
    const text = args.slice(1).join(" ");
    console.log(JSON.stringify(classifyOneCitation(text), null, 2));
    return;
  }

  if (args[0]) {
    const fs = require("node:fs");
    const path = require("node:path");
    const file = path.resolve(args[0]);
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw);
    const { edges, authorities } = parseJsonDump(data);
    const report = auditCitationEdges(edges, authorities, { source: file });
    console.log(JSON.stringify({ ok: true, wave: "2F", mode: "local_json", source: file, ...report }, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        wave: "2F",
        mode: "helpers",
        exports: [
          "classifyCitationFamily",
          "determineWhyUnresolved",
          "auditCitationEdges",
          "leanNormalizeCitation",
          "citationLookupAliases",
          "classifyOneCitation",
        ],
        families: FAMILY_BUCKETS,
        whyCodes: WHY_CODES,
      },
      null,
      2,
    ),
  );
}

module.exports = {
  FAMILY_BUCKETS,
  WHY_CODES,
  PARSER_SUPPORTED_FAMILIES,
  collapseWhitespace,
  normalizeCitationWhitespace,
  citationLookupAliases,
  leanNormalizeCitation,
  isGarbageCitation,
  classifyCitationFamily,
  buildAuthorityIndex,
  determineWhyUnresolved,
  classifyEdge,
  auditCitationEdges,
  classifyOneCitation,
  collectLookupKeys,
};

if (require.main === module) {
  main().catch((e) => {
    console.log(JSON.stringify({ ok: false, err: String(e?.message || e) }));
    process.exit(1);
  });
}
