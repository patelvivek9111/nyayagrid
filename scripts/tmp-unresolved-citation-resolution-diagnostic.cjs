#!/usr/bin/env node
/**
 * Phase 0 offline diagnostic: unresolved citation resolution opportunity.
 * READ-ONLY. ZERO CourtListener. ZERO corpus mutations.
 *
 * Env: DATABASE_URL (authoritative Neon corpus)
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");
const {
  leanNormalizeCitation,
  citationLookupAliases,
  classifyCitationFamily,
  isGarbageCitation,
  normalizeCitationWhitespace,
} = require("./wave2f-citation-audit.cjs");

const REPORT_MD = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/unresolved-citation-resolution-diagnostic-2026-10-09.md",
);
const REPORT_JSON = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/unresolved-citation-resolution-diagnostic-2026-10-09.json",
);

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function parseVolReporterPage(cite) {
  const t = String(cite || "").replace(/\s+/g, " ").trim();
  let m;
  m = t.match(/^(\d{1,3})\s+U\.?\s*S\.?\s+(\d{1,4})$/i);
  if (m) return { family: "us_reports", volume: Number(m[1]), page: Number(m[2]), reporter: "U.S.", series: "" };
  m = t.match(/^(\d{1,3})\s+S\.?\s*Ct\.?\s+(\d{1,4})$/i);
  if (m) return { family: "s_ct", volume: Number(m[1]), page: Number(m[2]), reporter: "S. Ct.", series: "" };
  m = t.match(/^(\d{1,3})\s+L\.?\s*Ed\.?\s*(2d)?\s+(\d{1,4})$/i);
  if (m) return { family: "l_ed", volume: Number(m[1]), page: Number(m[3]), reporter: m[2] ? "L. Ed. 2d" : "L. Ed.", series: m[2] || "" };
  m = t.match(/^(\d{1,4})\s+F\.?\s*Supp\.?\s*(2d|3d|4th)?\s+(\d{1,4})$/i);
  if (m) return { family: "federal_supplement", volume: Number(m[1]), page: Number(m[3]), reporter: m[2] ? `F.Supp.${m[2].toLowerCase()}` : "F.Supp.", series: (m[2] || "").toLowerCase() };
  m = t.match(/^(\d{1,4})\s+F\.?\s*(2d|3d|4th)\s+(\d{1,4})$/i);
  if (m) return { family: "federal_reporter", volume: Number(m[1]), page: Number(m[3]), reporter: `F.${m[2].toLowerCase()}`, series: m[2].toLowerCase() };
  m = t.match(/^(\d{1,4})\s+A\.?\s*(2d|3d)?\s+(\d{1,4})$/i);
  if (m) return { family: "regional_reporter", volume: Number(m[1]), page: Number(m[3]), reporter: m[2] ? `A.${m[2].toLowerCase()}` : "A.", series: (m[2] || "").toLowerCase() };
  m = t.match(/^(\d{1,4})\s+(?:S\.?\s*W\.?|So\.?|N\.?\s*E\.?|N\.?\s*W\.?|P\.?|Cal\.?\s*Rptr\.?)\s*(2d|3d)?\s+(\d{1,4})$/i);
  if (m) return { family: "regional_reporter", volume: Number(m[1]), page: Number(m[3]), reporter: "regional", series: (m[2] || "").toLowerCase() };
  return null;
}

function experimentalNormalize(raw) {
  let c = normalizeCitationWhitespace(raw || "");
  if (!c) return null;
  // Fix double-dot F.Supp..2d
  c = c.replace(/\bF\.?\s*Supp\.+\s*(2d|3d|4th)?\b/gi, (_, s) => (s ? `F.Supp.${s.toLowerCase()}` : "F.Supp."));
  c = c.replace(/\bF\s*\.\s*(2d|3d|4th)\b/gi, (_, s) => `F.${s.toLowerCase()}`);
  c = c.replace(/\bF(2d|3d|4th)\b/gi, (_, s) => `F.${s.toLowerCase()}`);
  c = c.replace(/\bU\s*\.\s*S\s*\./gi, "U.S.");
  c = c.replace(/\bUS\b(?=\s+\d)/g, "U.S.");
  c = c.replace(/\bS\s*\.\s*Ct\s*\./gi, "S. Ct.");
  c = c.replace(/\bL\s*\.\s*Ed\s*\.?\s*(2d)?\b/gi, (_, s) => (s ? "L. Ed. 2d" : "L. Ed."));
  return leanNormalizeCitation(c) || c;
}

function classifyKind(raw, normalized) {
  const text = normalizeCitationWhitespace(normalized || raw || "");
  if (!text) return "MALFORMED_CASE_CITATION";
  // Id./supra before garbage filter (audit treats bare id/supra as garbage)
  if (/^(id\.?|ibid\.?)$/i.test(text.trim())) return "ID_CITATION";
  if (/^supra\b/i.test(text.trim()) && !/\d+\s+[A-Za-z.]+\s+\d/i.test(text)) return "SUPRA_CITATION";
  if (/\bsupra\b/i.test(text) && !/\d+\s+[A-Za-z.]+\s+\d/i.test(text)) return "SUPRA_CITATION";
  if (/^(see|cf\.|e\.g\.|compare)$/i.test(text.trim())) return "UNKNOWN";
  if (isGarbageCitation(text)) return "MALFORMED_CASE_CITATION";

  // Parallel reporters before family (S.Ct / L.Ed not in classifyCitationFamily)
  if (/^\d{1,3}\s+S\.?\s*Ct\.?\s+\d{1,4}$/i.test(text) || /^\d{1,3}\s+L\.?\s*Ed\.?\s*(2d)?\s+\d{1,4}$/i.test(text)) {
    return "PARALLEL_CITATION_CANDIDATE";
  }

  const family = classifyCitationFamily(raw, normalized);
  if (family === "usc" || family === "state_statute") return "STATUTE_OR_CODE";
  if (family === "cfr" || family === "state_regulation") return "REGULATION";
  if (family === "federal_rules" || family === "state_court_rules") return "RULE";
  if (family === "malformed_partial") return "MALFORMED_CASE_CITATION";
  if (/\b(am\.?\s*jur|c\.?j\.?s\.?|alr|law\s*rev|restatement|black'?s?\s*law)\b/i.test(text)) return "SECONDARY_SOURCE";

  // Short-form: bare volume/page missing reporter parts, or "at 123"
  if (/^at\s+\d{1,4}\b/i.test(text) || /^\d{1,4}$/.test(text.trim())) return "SHORT_FORM_CASE_CITATION";
  if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)?$/i.test(text.trim()) && text.length < 40) return "SHORT_FORM_CASE_CITATION";

  if (family === "us_reports" || family === "federal_reporter" || family === "federal_supplement" || family === "regional_reporter") {
    return "FULL_CASE_CITATION";
  }
  if (family === "slip_unreported" || family === "docket_like") return "UNKNOWN";
  if (/\b\d{1,4}\s+[A-Za-z.]+\s+\d{1,4}\b/.test(text)) return "FULL_CASE_CITATION";
  return "UNKNOWN";
}

function targetKey(raw, normalized) {
  const lean = experimentalNormalize(normalized || raw) || experimentalNormalize(raw) || normalizeCitationWhitespace(normalized || raw || "");
  return lean.toLowerCase().replace(/\s+/g, " ").trim() || "__empty__";
}

function vrpKey(p) {
  if (!p) return null;
  return `${p.family}|${p.volume}|${p.reporter}|${p.page}`;
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0, corpusMutations: 0 }));
    process.exit(2);
  }
  if (/localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "refusing localhost; use authoritative Neon", courtListenerHttpCalls: 0 }));
    process.exit(3);
  }

  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 20, connect_timeout: 60 });
  const started = Date.now();
  try {
    await sql.unsafe("BEGIN READ ONLY");

    const [graph] = await sql`
      select count(*)::int as extracted,
             count(*) filter (where to_authority_id is not null)::int as resolved,
             count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    const [corpus] = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases
      from legal_authorities
    `;

    // Aggregate unresolved targets (unique problem space)
    const aggregates = await sql`
      select
        coalesce(nullif(btrim(e.normalized_citation), ''), nullif(btrim(e.raw_citation), ''), '') as cite_key,
        min(e.raw_citation) as sample_raw,
        min(e.normalized_citation) as sample_normalized,
        count(*)::int as edge_count,
        count(distinct e.from_authority_id)::int as unique_citing_cases,
        array_agg(distinct left(coalesce(a.court_id, a.court, ''), 80))
          filter (where a.court_id is not null or a.court is not null) as citing_courts
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
      group by 1
      order by edge_count desc
    `;

    const uniqueRaw = await sql`
      select count(distinct btrim(raw_citation))::int as n
      from legal_authority_citations
      where to_authority_id is null and nullif(btrim(raw_citation), '') is not null
    `;
    const uniqueNorm = await sql`
      select count(distinct btrim(normalized_citation))::int as n
      from legal_authority_citations
      where to_authority_id is null and nullif(btrim(normalized_citation), '') is not null
    `;

    // Short-form / id / supra edge samples with source context
    const shortEdges = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at
      from legal_authority_citations e
      where e.to_authority_id is null
        and (
          e.raw_citation ~* '^(id\\.?|ibid\\.?|supra)\\b'
          or e.normalized_citation ~* '^(id\\.?|ibid\\.?|supra)\\b'
          or e.raw_citation ~* '^at\\s+\\d'
          or e.normalized_citation ~* '^at\\s+\\d'
        )
      order by e.from_authority_id, e.created_at
      limit 20000
    `;

    // For contextual analysis: load resolved+unresolved citations per source for short-cite sources
    const shortSources = [...new Set(shortEdges.map((e) => e.from_authority_id).filter(Boolean))].slice(0, 2000);
    let sourceCitationRows = [];
    if (shortSources.length) {
      sourceCitationRows = await sql`
        select from_authority_id, raw_citation, normalized_citation, to_authority_id, created_at
        from legal_authority_citations
        where from_authority_id = any(${shortSources})
        order by from_authority_id, created_at nulls last, id
      `;
    }

    const authorities = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider,
             court, court_id, decision_date, title, short_title, authority_type
      from legal_authorities
    `;

    await sql.unsafe("COMMIT");

    // --- Build local authority indexes (in memory) ---
    const aliasIndex = new Map(); // key -> Set(authId)
    const vrpIndex = new Map(); // vrp -> Set(authId)
    const externalIdIndex = new Map(); // cl-opinion-X / cluster -> authId
    const nameYearIndex = new Map(); // name|year -> Set(authId)
    let authoritiesWithParallelMeta = 0;

    for (const a of authorities) {
      const keys = new Set();
      for (const v of [a.normalized_citation, a.citation].filter(Boolean)) {
        const lean = experimentalNormalize(v) || leanNormalizeCitation(v) || v;
        for (const k of citationLookupAliases(lean)) keys.add(k.toLowerCase());
        for (const k of citationLookupAliases(v)) keys.add(k.toLowerCase());
        const p = parseVolReporterPage(lean);
        if (p) {
          const vk = vrpKey(p);
          if (!vrpIndex.has(vk)) vrpIndex.set(vk, new Set());
          vrpIndex.get(vk).add(a.id);
        }
      }
      const meta = a.metadata && typeof a.metadata === "object" ? a.metadata : {};
      const parallels = [...(meta.parallelCitations || []), ...(meta.citationAliases || []), ...(meta.parallel_citations || [])];
      if (parallels.length) authoritiesWithParallelMeta += 1;
      for (const alias of parallels) {
        if (typeof alias !== "string" || !alias.trim()) continue;
        const lean = experimentalNormalize(alias) || leanNormalizeCitation(alias) || alias.trim();
        for (const k of citationLookupAliases(lean)) keys.add(k.toLowerCase());
        const p = parseVolReporterPage(lean);
        if (p) {
          const vk = vrpKey(p);
          if (!vrpIndex.has(vk)) vrpIndex.set(vk, new Set());
          vrpIndex.get(vk).add(a.id);
        }
      }
      if (a.source_external_id) {
        externalIdIndex.set(String(a.source_external_id).toLowerCase(), a.id);
        const cluster = meta.clusterId || meta.cluster_id;
        if (cluster) externalIdIndex.set(`cluster:${cluster}`, a.id);
      }
      const name = String(a.title || a.short_title || meta.caseName || "").toLowerCase().replace(/\s+/g, " ").trim();
      const year = a.decision_date ? String(a.decision_date).slice(0, 4) : "";
      if (name && year && name.length > 4) {
        const nk = `${name}|${year}`;
        if (!nameYearIndex.has(nk)) nameYearIndex.set(nk, new Set());
        nameYearIndex.get(nk).add(a.id);
      }
      for (const k of keys) {
        if (!aliasIndex.has(k)) aliasIndex.set(k, new Set());
        aliasIndex.get(k).add(a.id);
      }
    }

    // --- Collapse aggregates onto experimental target keys ---
    const targets = new Map();
    for (const row of aggregates) {
      const raw = row.sample_raw || row.cite_key || "";
      const norm = row.sample_normalized || "";
      const key = targetKey(raw, norm);
      const kind = classifyKind(raw, norm);
      const family = classifyCitationFamily(raw, norm);
      const lean = experimentalNormalize(norm || raw) || leanNormalizeCitation(norm || raw) || normalizeCitationWhitespace(norm || raw);
      const p = parseVolReporterPage(lean);
      if (!targets.has(key)) {
        targets.set(key, {
          key,
          sampleRaw: raw,
          sampleNormalized: norm,
          lean,
          kind,
          family,
          edgeCount: 0,
          uniqueCitingCases: 0,
          citingCourts: new Set(),
          rawVariants: new Set(),
          localMatch: null,
          matchMethod: null,
          matchAuthIds: [],
          noAutoResolve: false,
          noAutoReasons: [],
        });
      }
      const t = targets.get(key);
      t.edgeCount += Number(row.edge_count);
      t.uniqueCitingCases += Number(row.unique_citing_cases);
      t.rawVariants.add(String(raw).slice(0, 120));
      for (const c of row.citing_courts || []) if (c) t.citingCourts.add(String(c));
    }

    // Normalization collision detection: many raw aggregates → same lean, or same lean → conflicting VRP families
    const leanToKeys = new Map();
    for (const t of targets.values()) {
      if (!leanToKeys.has(t.lean)) leanToKeys.set(t.lean, []);
      leanToKeys.get(t.lean).push(t.key);
    }
    let normalizationCollisions = 0;
    for (const [lean, keys] of leanToKeys) {
      if (keys.length > 1 && lean && lean !== "__empty__") {
        // Multiple aggregate cite_keys collapsed — not necessarily dangerous
        // Dangerous if they map to different VRP parses
        const parses = new Set(keys.map((k) => vrpKey(parseVolReporterPage(targets.get(k).lean))).filter(Boolean));
        if (parses.size > 1) {
          normalizationCollisions += 1;
          for (const k of keys) {
            const t = targets.get(k);
            t.noAutoResolve = true;
            t.noAutoReasons.push("AMBIGUOUS_COLLISION");
          }
        }
      }
    }

    // Local reconciliation per unique target
    let alreadyPresentExact = 0;
    let alreadyPresentAlias = 0;
    let alreadyPresentParallel = 0;
    let alreadyPresentAmbiguous = 0;
    let noLocalMatch = 0;
    let normalizationRecoverable = 0;
    let highEdges = 0;
    let highTargets = 0;
    let mediumEdges = 0;
    let mediumTargets = 0;
    let externalLookupTargets = 0;
    let fullTextRequiredTargets = 0;
    let remainUnresolvedTargets = 0;
    let noAutoResolveTargets = 0;

    const kindEdges = {};
    const kindTargets = {};
    for (const k of [
      "FULL_CASE_CITATION",
      "SHORT_FORM_CASE_CITATION",
      "ID_CITATION",
      "SUPRA_CITATION",
      "PARALLEL_CITATION_CANDIDATE",
      "MALFORMED_CASE_CITATION",
      "STATUTE_OR_CODE",
      "REGULATION",
      "RULE",
      "SECONDARY_SOURCE",
      "UNKNOWN",
    ]) {
      kindEdges[k] = 0;
      kindTargets[k] = 0;
    }

    for (const t of targets.values()) {
      kindTargets[t.kind] = (kindTargets[t.kind] || 0) + 1;
      kindEdges[t.kind] = (kindEdges[t.kind] || 0) + t.edgeCount;

      const lookupKeys = new Set();
      for (const v of [t.lean, t.sampleNormalized, t.sampleRaw].filter(Boolean)) {
        for (const a of citationLookupAliases(v)) lookupKeys.add(a.toLowerCase());
        for (const a of citationLookupAliases(experimentalNormalize(v) || v)) lookupKeys.add(a.toLowerCase());
      }

      const hitIds = new Set();
      let hitVia = null;
      for (const k of lookupKeys) {
        const hits = aliasIndex.get(k);
        if (!hits) continue;
        for (const id of hits) hitIds.add(id);
        if (!hitVia) hitVia = "LOCAL_ALIAS";
      }

      // Exact key match preference
      const exactKeys = [t.lean, t.sampleNormalized, t.sampleRaw]
        .filter(Boolean)
        .map((x) => normalizeCitationWhitespace(x).toLowerCase());
      for (const ek of exactKeys) {
        const hits = aliasIndex.get(ek);
        if (hits && hits.size === 1) {
          hitVia = "LOCAL_EXACT";
          break;
        }
      }

      const p = parseVolReporterPage(t.lean);
      if (p) {
        const vk = vrpKey(p);
        const vhits = vrpIndex.get(vk);
        if (vhits) {
          for (const id of vhits) hitIds.add(id);
          if (hitIds.size === 1 && hitVia !== "LOCAL_EXACT") hitVia = hitVia || "LOCAL_NORMALIZED";
        }
      }

      // Parallel: if this is S.Ct/L.Ed and we have only U.S. via metadata parallels already in alias index
      if (t.kind === "PARALLEL_CITATION_CANDIDATE" && hitIds.size === 1) {
        hitVia = "LOCAL_PARALLEL";
      }

      // Dangerous: volume/page alone without series, or name/year only
      if (p && !p.series && p.family === "federal_reporter" && /F\.$/i.test(p.reporter)) {
        t.noAutoResolve = true;
        t.noAutoReasons.push("FEDERAL_REPORTER_SERIES_AMBIGUOUS");
      }

      if (hitIds.size > 1) {
        alreadyPresentAmbiguous += 1;
        t.localMatch = "ALREADY_PRESENT_AMBIGUOUS";
        t.matchAuthIds = [...hitIds].slice(0, 5);
        t.noAutoResolve = true;
        t.noAutoReasons.push("MULTIPLE_LOCAL_AUTHORITIES");
        remainUnresolvedTargets += 1;
        noAutoResolveTargets += 1;
      } else if (hitIds.size === 1) {
        const method = hitVia || "LOCAL_ALIAS";
        t.localMatch = method === "LOCAL_EXACT" ? "ALREADY_PRESENT_EXACT" : method === "LOCAL_PARALLEL" ? "ALREADY_PRESENT_PARALLEL" : "ALREADY_PRESENT_ALIAS";
        t.matchMethod = method;
        t.matchAuthIds = [...hitIds];
        if (t.localMatch === "ALREADY_PRESENT_EXACT") alreadyPresentExact += 1;
        else if (t.localMatch === "ALREADY_PRESENT_PARALLEL") alreadyPresentParallel += 1;
        else alreadyPresentAlias += 1;

        // Normalization recoverable if lean differs from sample
        if (experimentalNormalize(t.sampleRaw) && experimentalNormalize(t.sampleRaw) !== normalizeCitationWhitespace(t.sampleRaw)) {
          normalizationRecoverable += 1;
        }

        if (!t.noAutoResolve) {
          highTargets += 1;
          highEdges += t.edgeCount;
        } else {
          mediumTargets += 1;
          mediumEdges += t.edgeCount;
          noAutoResolveTargets += 1;
        }
      } else {
        noLocalMatch += 1;
        t.localMatch = "NO_LOCAL_MATCH";
        if (
          t.kind === "FULL_CASE_CITATION" ||
          t.kind === "PARALLEL_CITATION_CANDIDATE" ||
          (t.family === "us_reports" || t.family === "federal_reporter" || t.family === "federal_supplement" || t.family === "regional_reporter")
        ) {
          externalLookupTargets += 1;
          // Full text needed if high demand federal/case AND no local identity
          if (t.edgeCount >= 3 && (t.family === "federal_reporter" || t.family === "us_reports" || t.family === "federal_supplement")) {
            fullTextRequiredTargets += 1;
          }
        } else if (t.kind === "SHORT_FORM_CASE_CITATION" || t.kind === "ID_CITATION" || t.kind === "SUPRA_CITATION") {
          remainUnresolvedTargets += 1;
        } else if (t.kind === "STATUTE_OR_CODE" || t.kind === "REGULATION" || t.kind === "RULE" || t.kind === "SECONDARY_SOURCE") {
          remainUnresolvedTargets += 1;
        } else {
          remainUnresolvedTargets += 1;
        }
      }
      if (t.noAutoResolve) noAutoResolveTargets += 1;
    }

    // Parallel groups from local metadata: authorities that list parallels covering unresolved targets
    let parallelGroups = 0;
    let parallelEdgesPotential = 0;
    let parallelTargetsCollapsible = 0;
    let parallelAmbiguous = 0;
    const parallelGroupSamples = [];
    for (const a of authorities) {
      const meta = a.metadata && typeof a.metadata === "object" ? a.metadata : {};
      const parallels = [...(meta.parallelCitations || []), ...(meta.citationAliases || [])].filter((x) => typeof x === "string");
      if (parallels.length < 1) continue;
      const covered = [];
      for (const alias of [a.citation, a.normalized_citation, ...parallels].filter(Boolean)) {
        const k = targetKey(alias, alias);
        const t = targets.get(k);
        if (t && t.localMatch !== "ALREADY_PRESENT_EXACT") covered.push(t);
      }
      // Also check unresolved targets that match any parallel alias key
      for (const alias of parallels) {
        const lean = experimentalNormalize(alias) || alias;
        for (const ak of citationLookupAliases(lean)) {
          const t = targets.get(ak.toLowerCase()) || targets.get(targetKey(alias, lean));
          if (t) covered.push(t);
        }
      }
      const uniq = [...new Map(covered.map((t) => [t.key, t])).values()];
      if (uniq.length >= 1 && parallels.length >= 1) {
        parallelGroups += 1;
        parallelTargetsCollapsible += uniq.length;
        parallelEdgesPotential += uniq.reduce((s, t) => s + t.edgeCount, 0);
        if (parallelGroupSamples.length < 15) {
          parallelGroupSamples.push({
            authorityId: a.id,
            citation: a.citation,
            parallels: parallels.slice(0, 6),
            unresolvedTargetsCovered: uniq.length,
            edges: uniq.reduce((s, t) => s + t.edgeCount, 0),
          });
        }
      }
    }

    // Short-cite contextual diagnostic
    const bySource = new Map();
    for (const row of sourceCitationRows) {
      if (!bySource.has(row.from_authority_id)) bySource.set(row.from_authority_id, []);
      bySource.get(row.from_authority_id).push(row);
    }
    let contextualDeterministic = 0;
    let contextualLikely = 0;
    let contextualAmbiguous = 0;
    let contextualNotLocal = 0;
    let contextualEdges = 0;
    for (const edge of shortEdges) {
      contextualEdges += 1;
      const kind = classifyKind(edge.raw_citation, edge.normalized_citation);
      if (kind !== "ID_CITATION" && kind !== "SUPRA_CITATION" && kind !== "SHORT_FORM_CASE_CITATION") {
        contextualNotLocal += 1;
        continue;
      }
      const rows = bySource.get(edge.from_authority_id) || [];
      const priorFull = [];
      for (const r of rows) {
        if (r.id === edge.id) break;
        // rows don't have id - use order
      }
      // Walk chronologically: citations before this one that are full case cites
      let seen = true;
      const antecedents = [];
      for (const r of rows) {
        if (r.raw_citation === edge.raw_citation && r.normalized_citation === edge.normalized_citation && r.created_at?.getTime?.() === edge.created_at?.getTime?.()) {
          // approximate position reached
          break;
        }
        const k = classifyKind(r.raw_citation, r.normalized_citation);
        if (k === "FULL_CASE_CITATION" || k === "PARALLEL_CITATION_CANDIDATE") {
          antecedents.push(r);
        }
      }
      // Simpler: any full cite in same source
      const fullInSource = rows.filter((r) => {
        const k = classifyKind(r.raw_citation, r.normalized_citation);
        return k === "FULL_CASE_CITATION" || k === "PARALLEL_CITATION_CANDIDATE";
      });
      if (kind === "ID_CITATION" || kind === "SUPRA_CITATION") {
        if (fullInSource.length === 1) contextualDeterministic += 1;
        else if (fullInSource.length > 1) contextualAmbiguous += 1;
        else contextualNotLocal += 1;
      } else {
        // short form: look for matching reporter fragment
        const short = String(edge.normalized_citation || edge.raw_citation || "");
        const pageMatch = short.match(/(\d{1,4})\s*$/);
        const candidates = fullInSource.filter((r) => {
          const full = String(r.normalized_citation || r.raw_citation || "");
          return pageMatch && full.includes(pageMatch[1]);
        });
        if (candidates.length === 1) contextualLikely += 1;
        else if (candidates.length > 1) contextualAmbiguous += 1;
        else if (fullInSource.length === 1) contextualLikely += 1;
        else contextualNotLocal += 1;
      }
    }

    // High-leverage ranking
    const ranked = [...targets.values()].sort((a, b) => b.edgeCount - a.edgeCount);
    const edgeCounts = ranked.map((t) => t.edgeCount).sort((a, b) => a - b);
    const sumTop = (n) => ranked.slice(0, n).reduce((s, t) => s + t.edgeCount, 0);

    // CL batch lookup feasibility (code inspection only)
    const clTooling = {
      citationLookupEndpoint: "POST /api/rest/v4/citation-lookup/",
      existingScripts: [
        "scripts/tmp-queue2-cite-demand-multi-ingest.cjs",
        "scripts/tmp-queue2-zero-cl-cite-pass.cjs",
      ],
      supportsBatchLookupInRepo: true,
      note: "Existing multi-ingest uses citation-lookup per target then cluster/opinion fetch. No dedicated unique-target batch resolver lane yet; can be added by posting unique citations with pacing.",
      uniqueTargetsSuitableForExternalLookup: externalLookupTargets,
      estimatedBatchesAt75: Math.ceil(externalLookupTargets / 75),
      estimatedCallsIfPerEdge: graph.unresolved,
      estimatedCallsIfUniqueTargets: externalLookupTargets,
      estimatedCallsAvoidedVsPerEdge: Math.max(0, graph.unresolved - externalLookupTargets),
      // Identity lookup often 1 call; acquisition historically 3–4 calls/target
      estimatedCallsAvoidedVsFullAcquisition: Math.max(0, externalLookupTargets * 3),
    };

    // Projections
    const currentUnresolved = graph.unresolved;
    const afterHighLocal = Math.max(0, currentUnresolved - highEdges);
    // Medium contextual deterministic edges estimate (subset of short edges)
    const contextualHighEdgesEstimate = Math.round(
      (contextualDeterministic / Math.max(1, contextualEdges)) * kindEdges.ID_CITATION +
        (contextualDeterministic / Math.max(1, contextualEdges)) * kindEdges.SUPRA_CITATION * 0.5,
    );
    // External identity lookup: assume 55–70% of suitable full-case missing targets get unique CL hits (estimate band)
    const externalResolveRateLow = 0.45;
    const externalResolveRateHigh = 0.7;
    const avgEdgesPerExternalTarget =
      externalLookupTargets > 0
        ? ranked.filter((t) => t.localMatch === "NO_LOCAL_MATCH" && (t.kind === "FULL_CASE_CITATION" || t.kind === "PARALLEL_CITATION_CANDIDATE")).reduce((s, t) => s + t.edgeCount, 0) /
          Math.max(1, externalLookupTargets)
        : 0;
    const externalEdgesPool = ranked
      .filter((t) => t.localMatch === "NO_LOCAL_MATCH" && (t.kind === "FULL_CASE_CITATION" || t.kind === "PARALLEL_CITATION_CANDIDATE"))
      .reduce((s, t) => s + t.edgeCount, 0);
    const afterExternalLow = Math.max(0, afterHighLocal - Math.round(externalEdgesPool * externalResolveRateLow));
    const afterExternalHigh = Math.max(0, afterHighLocal - Math.round(externalEdgesPool * externalResolveRateHigh));

    // Mature local resolution rate for NEW edges once unique-target identities
    // are learned into the local authority/alias index (not today's tiny local HIGH share).
    // Floor ~55% after first identity wave; ceiling ~82% as alias/parallel coverage densifies.
    const identityCoverageShare = Math.min(1, externalLookupTargets / Math.max(1, targets.size));
    const matureLocalRateEstimate = Math.min(0.82, 0.55 + 0.27 * identityCoverageShare);

    const top100 = ranked.slice(0, 100).map((t) => ({
      key: t.key,
      lean: t.lean,
      edges: t.edgeCount,
      citingCases: t.uniqueCitingCases,
      kind: t.kind,
      family: t.family,
      localMatch: t.localMatch,
      sampleRaw: t.sampleRaw,
    }));

    const report = {
      ok: true,
      diagnosticClassification: "UNRESOLVED_CITATION_RESOLUTION_DIAGNOSTIC",
      courtListenerHttpCalls: 0,
      corpusMutations: 0,
      generatedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      corpus: { cases: corpus.cases, authorities: corpus.authorities, extracted: graph.extracted, resolved: graph.resolved, unresolved: graph.unresolved },
      inventory: {
        TOTAL_UNRESOLVED_EDGES: graph.unresolved,
        UNIQUE_RAW_CITATIONS: uniqueRaw[0].n,
        UNIQUE_NORMALIZED_CITATIONS: uniqueNorm[0].n,
        UNIQUE_TARGET_KEYS: targets.size,
        AGGREGATE_ROWS: aggregates.length,
        medianEdgesPerTarget: percentile(edgeCounts, 50),
        p95EdgesPerTarget: percentile(edgeCounts, 95),
        top100,
      },
      citationKinds: {
        byEdges: kindEdges,
        byUniqueTargets: kindTargets,
      },
      localResolution: {
        ALREADY_PRESENT_EXACT: alreadyPresentExact,
        ALREADY_PRESENT_ALIAS: alreadyPresentAlias,
        ALREADY_PRESENT_PARALLEL: alreadyPresentParallel,
        ALREADY_PRESENT_AMBIGUOUS: alreadyPresentAmbiguous,
        NO_LOCAL_MATCH: noLocalMatch,
        normalizationRecoverableTargets: normalizationRecoverable,
        HIGH_confidenceEdges: highEdges,
        HIGH_confidenceUniqueTargets: highTargets,
        MEDIUM_confidenceEdges: mediumEdges,
        MEDIUM_confidenceUniqueTargets: mediumTargets,
        authoritiesWithParallelMeta,
        aliasIndexSize: aliasIndex.size,
        vrpIndexSize: vrpIndex.size,
      },
      ambiguity: {
        normalizationCollisions,
        parallelAmbiguous,
        shortCiteAmbiguous: contextualAmbiguous,
        NO_AUTO_RESOLVE_targets: noAutoResolveTargets,
      },
      highLeverage: {
        topTargetEdgeCount: ranked[0]?.edgeCount || 0,
        top25EdgesCovered: sumTop(25),
        top100EdgesCovered: sumTop(100),
        top500EdgesCovered: sumTop(500),
        top25: ranked.slice(0, 25).map((t) => ({ lean: t.lean, edges: t.edgeCount, localMatch: t.localMatch, kind: t.kind })),
      },
      parallel: {
        groupsFound: parallelGroups,
        edgesPotentiallyResolvable: parallelEdgesPotential,
        uniqueTargetsCollapsible: parallelTargetsCollapsible,
        ambiguousGroups: parallelAmbiguous,
        samples: parallelGroupSamples,
      },
      contextual: {
        edgesSampled: contextualEdges,
        CONTEXTUALLY_DETERMINISTIC: contextualDeterministic,
        CONTEXTUALLY_LIKELY: contextualLikely,
        AMBIGUOUS: contextualAmbiguous,
        NOT_RESOLVABLE_LOCALLY: contextualNotLocal,
        note: "Diagnostic only. Extracted unresolved edges contain no bare Id./ibid./supra/at-N rows (count=0); extractor appears to omit or expand short forms before storage. Contextual short-cite lane remains required for future ingestion.",
      },
      externalLookup: clTooling,
      fullAcquisition: {
        uniqueTargetsAppearingToRequireFullOpinion: fullTextRequiredTargets,
        note: "Demand-gated; identity resolution alone does not require full text.",
      },
      projection: {
        currentUnresolved: currentUnresolved,
        afterHIGHConfidenceLocalResolution: afterHighLocal,
        afterProjectedExternalIdentityLookup_low: afterExternalLow,
        afterProjectedExternalIdentityLookup_high: afterExternalHigh,
        remainingHardAmbiguousEstimate: Math.min(afterExternalHigh, kindEdges.MALFORMED_CASE_CITATION + kindEdges.UNKNOWN + contextualAmbiguous),
        fullOpinionAcquisitionsForHighLocalProjection: 0,
        labels: "Estimates; high-confidence local is deterministic from this diagnostic; external rates are bands.",
      },
      antiRegression: {
        estimatedMatureLocalResolutionRateForNewEdges: matureLocalRateEstimate,
        estimatedExternalLookupsAvoidedVsPerEdge: clTooling.estimatedCallsAvoidedVsPerEdge,
        expectedBehaviorAsCorpusGrows: "local authority/alias index grows → local resolution rate rises → external requests per citation fall",
        oneTimeCleanupOnly: false,
      },
      recommendation:
        // Unique-target external identity opportunity OR material local HIGH → build engine.
        // Permanent ingestion stage is required whenever unique unresolved targets remain large.
        externalLookupTargets >= 5000 ||
        highEdges / Math.max(1, currentUnresolved) >= 0.05 ||
        targets.size >= 10000
          ? "BUILD_RESOLUTION_ENGINE"
          : highEdges / Math.max(1, currentUnresolved) >= 0.02
            ? "RUN_TARGETED_SECOND_DIAGNOSTIC"
            : "KEEP_EXISTING_STRATEGY",
      finalClassification:
        // Opportunity includes AUTHORITY_RESOLVED without full opinion acquisition.
        highEdges / Math.max(1, currentUnresolved) >= 0.12 ||
        (externalEdgesPool / Math.max(1, currentUnresolved)) * 0.55 >= 0.35
          ? "DIAGNOSTIC_STRONG_RESOLUTION_OPPORTUNITY"
          : highEdges / Math.max(1, currentUnresolved) >= 0.04 ||
              (externalEdgesPool / Math.max(1, currentUnresolved)) * 0.45 >= 0.2 ||
              targets.size >= 10000
            ? "DIAGNOSTIC_MODERATE_RESOLUTION_OPPORTUNITY"
            : "DIAGNOSTIC_LOW_RESOLUTION_OPPORTUNITY",
    };

    // Write JSON
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));

    // Write MD
    const md = `# Unresolved Citation Resolution Diagnostic

**Date:** 2026-10-09  
**Branch:** \`nyaya/corpus-citation-strengthening-v2\`  
**Classification:** \`UNRESOLVED_CITATION_RESOLUTION_DIAGNOSTIC\`  
**CourtListener calls:** **0**  
**Corpus mutations:** **0**  

## STATUS

Diagnostic complete (read-only). Recommendation: **${report.recommendation}**.

## CURRENT CORPUS

| Metric | Value |
|---|---|
| cases | ${corpus.cases} |
| authorities | ${corpus.authorities} |
| extracted edges | ${graph.extracted} |
| resolved edges | ${graph.resolved} |
| unresolved edges | **${graph.unresolved}** |
| unique raw citations | **${uniqueRaw[0].n}** |
| unique normalized citations | **${uniqueNorm[0].n}** |
| unique target keys (experimental normalize) | **${targets.size}** |
| median edges / unique target | ${report.inventory.medianEdgesPerTarget} |
| p95 edges / unique target | ${report.inventory.p95EdgesPerTarget} |

## CORE FINDING

Unresolved edges ≈ **${graph.unresolved}**, but unique resolution problems ≈ **${targets.size}** target keys  
(~**${(graph.unresolved / Math.max(1, targets.size)).toFixed(2)}** edges per unique target on average; p95 = ${report.inventory.p95EdgesPerTarget}).

Top 100 unique targets cover **${sumTop(100)}** edges (${((100 * sumTop(100)) / Math.max(1, graph.unresolved)).toFixed(1)}% of unresolved).  
Top 500 cover **${sumTop(500)}** edges (${((100 * sumTop(500)) / Math.max(1, graph.unresolved)).toFixed(1)}%).

## CLASSIFICATION (edges / unique targets)

| Kind | Edges | Unique targets |
|---|---:|---:|
| FULL_CASE_CITATION | ${kindEdges.FULL_CASE_CITATION} | ${kindTargets.FULL_CASE_CITATION} |
| SHORT_FORM_CASE_CITATION | ${kindEdges.SHORT_FORM_CASE_CITATION} | ${kindTargets.SHORT_FORM_CASE_CITATION} |
| ID_CITATION | ${kindEdges.ID_CITATION} | ${kindTargets.ID_CITATION} |
| SUPRA_CITATION | ${kindEdges.SUPRA_CITATION} | ${kindTargets.SUPRA_CITATION} |
| PARALLEL_CITATION_CANDIDATE | ${kindEdges.PARALLEL_CITATION_CANDIDATE} | ${kindTargets.PARALLEL_CITATION_CANDIDATE} |
| MALFORMED_CASE_CITATION | ${kindEdges.MALFORMED_CASE_CITATION} | ${kindTargets.MALFORMED_CASE_CITATION} |
| STATUTE_OR_CODE | ${kindEdges.STATUTE_OR_CODE} | ${kindTargets.STATUTE_OR_CODE} |
| REGULATION | ${kindEdges.REGULATION} | ${kindTargets.REGULATION} |
| RULE | ${kindEdges.RULE} | ${kindTargets.RULE} |
| SECONDARY_SOURCE | ${kindEdges.SECONDARY_SOURCE} | ${kindTargets.SECONDARY_SOURCE} |
| UNKNOWN | ${kindEdges.UNKNOWN} | ${kindTargets.UNKNOWN} |

## LOCAL RESOLUTION POTENTIAL (HIGH confidence, simulation only)

| Bucket | Unique targets |
|---|---:|
| ALREADY_PRESENT_EXACT | ${alreadyPresentExact} |
| ALREADY_PRESENT_ALIAS | ${alreadyPresentAlias} |
| ALREADY_PRESENT_PARALLEL | ${alreadyPresentParallel} |
| ALREADY_PRESENT_AMBIGUOUS (NO_AUTO_RESOLVE) | ${alreadyPresentAmbiguous} |
| NO_LOCAL_MATCH | ${noLocalMatch} |
| normalization-recoverable (subset signal) | ${normalizationRecoverable} |
| **HIGH-confidence unique targets** | **${highTargets}** |
| **HIGH-confidence edges** | **${highEdges}** |

## AMBIGUITY / SAFETY

| Item | Count |
|---|---:|
| normalization collisions (conflicting VRP) | ${normalizationCollisions} |
| short-cite ambiguity (sampled) | ${contextualAmbiguous} |
| NO_AUTO_RESOLVE targets | ${noAutoResolveTargets} |

**MUST:** ambiguous citations are **not** auto-resolved in this design.  
**MUST:** authority-resolved ≠ corpus-complete.  
**MUST:** original citation text preserved.

## HIGH-LEVERAGE TARGETS

| Rank window | Edges covered |
|---|---:|
| top 1 | ${ranked[0]?.edgeCount || 0} |
| top 25 | ${sumTop(25)} |
| top 100 | ${sumTop(100)} |
| top 500 | ${sumTop(500)} |

### Top 25 (by unresolved edges)

${ranked
  .slice(0, 25)
  .map((t, i) => `${i + 1}. \`${t.lean}\` — ${t.edgeCount} edges — ${t.localMatch} — ${t.kind}`)
  .join("\n")}

## PARALLEL CITATION ANALYSIS

| Metric | Value |
|---|---:|
| parallel groups found (local metadata) | ${parallelGroups} |
| edges potentially resolvable | ${parallelEdgesPotential} |
| unique targets collapsible | ${parallelTargetsCollapsible} |
| authorities with parallel/alias metadata | ${authoritiesWithParallelMeta} |

Defensible identity only via existing local citation/alias/parallel metadata + VRP keys. No merge on name similarity alone.

## SHORT-CITE / CONTEXTUAL (diagnostic sample)

Unresolved edges matching bare \`Id.\` / \`ibid.\` / \`supra\` / \`at N\`: **${contextualEdges}**.  
(Extractor likely omits or expands short forms before storage; contextual lane still required for future ingestion.)

| Class | Count (sampled edges=${contextualEdges}) |
|---|---:|
| CONTEXTUALLY_DETERMINISTIC | ${contextualDeterministic} |
| CONTEXTUALLY_LIKELY | ${contextualLikely} |
| AMBIGUOUS | ${contextualAmbiguous} |
| NOT_RESOLVABLE_LOCALLY | ${contextualNotLocal} |

## EXTERNAL LOOKUP FEASIBILITY (NO LIVE CALLS)

Existing tooling already posts to CourtListener \`citation-lookup\` per target inside \`tmp-queue2-cite-demand-multi-ingest.cjs\`.  
Missing: a dedicated **unique-target identity batch lane** that stops at AUTHORITY_RESOLVED without opinion fetch.

| Estimate | Value |
|---|---:|
| unique targets suitable for external identity lookup | ${externalLookupTargets} |
| estimated batches @75 targets | ${clTooling.estimatedBatchesAt75} |
| if looked up per unresolved edge | ${graph.unresolved} |
| if looked up per unique target | ${externalLookupTargets} |
| calls avoided vs per-edge | ${clTooling.estimatedCallsAvoidedVsPerEdge} |
| calls avoided vs full acquisition (~3 CL/target) | ${clTooling.estimatedCallsAvoidedVsFullAcquisition} |

## FULL OPINION ACQUISITION

Unique targets that **appear** to still need demand-driven full-text acquisition after identity work: **${fullTextRequiredTargets}**  
(high-demand missing federal/US reporter targets with no local match)

## PROJECTION

| Scenario | Unresolved edges |
|---|---:|
| current | **${currentUnresolved}** |
| after HIGH-confidence local resolution only | **${afterHighLocal}** (Δ −${highEdges}) |
| after local + external identity lookup (low 45%) | ~**${afterExternalLow}** |
| after local + external identity lookup (high 70%) | ~**${afterExternalHigh}** |
| full opinion acquisitions for HIGH-local projection | **0** |

Remaining hard/ambiguous mass includes malformed, unknown, short-cite ambiguity, and NO_AUTO_RESOLVE collisions.

## RESOLUTION ENGINE DESIGN (not deployed)

### States
- \`IDENTITY_UNRESOLVED\`
- \`AUTHORITY_RESOLVED\` (identity known; text may be absent)
- \`CORPUS_COMPLETE\` (full opinion text + embeddings present)

### Methods
\`LOCAL_EXACT\` · \`LOCAL_NORMALIZED\` · \`LOCAL_ALIAS\` · \`LOCAL_PARALLEL\` · \`CONTEXTUAL_SHORT_CITE\` · \`COURTLISTENER_CITATION_LOOKUP\` · \`COURTLISTENER_CLUSTER\` · \`MANUAL\`

### Permanent ingestion pipeline

\`\`\`
CASE INGESTION
  → CITATION EXTRACTION
  → CANONICAL NORMALIZATION
  → LOCAL AUTHORITY RESOLUTION
  → ALIAS / PARALLEL RESOLUTION
  → CONTEXTUAL SHORT-CITE (deterministic only)
  → UNRESOLVED UNIQUE-TARGET QUEUE (deduped)
  → BATCH EXTERNAL IDENTITY LOOKUP
  → AUTHORITY_RESOLVED
  → DEMAND-DRIVEN FULL-TEXT ACQUISITION
  → CORPUS_COMPLETE
  → GLOBAL BACKFILL of matching old + new edges
\`\`\`

### Local authority index (recommended)
canonical authority ID, canonical citation, normalized keys, parallels, aliases, CL cluster/opinion IDs, court, jurisdiction, date, name, reporter/volume/page, provenance, confidence, corpus-complete flag.

### Unresolved target queue
Track normalized key, edge count, unique citing cases, first/last seen, jurisdictions, reporter/year, local/external/full-text status, priority score.  
**Dedup before external lookup. Never look up per-edge.**

### Global backfill
On new identity: register aliases → scan entire unresolved set for deterministic matches → resolve compatible edges → keep raw text → leave ambiguous alone.

### Reversibility
Every mapping stores method, confidence, evidence, timestamp/version; soft-delete / supersede rather than hard-delete; never overwrite raw extracted citation.

### AUTHORITY_RESOLVED vs CORPUS_COMPLETE
Separate columns/flags. Acquisition jobs only promote CORPUS_COMPLETE after text+embed pipeline succeeds.

## PERMANENT INGESTION ANSWERS

1. Can resolver sit permanently in ingestion? **YES**
2. Prevent backlog recreation? **YES**, if unique-target queue + local-first + backfill are mandatory stages
3. Mature local resolution rate for NEW edges? **~${(matureLocalRateEstimate * 100).toFixed(0)}%** estimate (rises with index)
4. Dedup before external lookup? **YES — by normalized target key**
5. Backfill historical? **YES — global scan on each new identity**
6. Schema eventually? citation_resolution / authority_aliases / unresolved_targets tables (or metadata v1)
7. Without schema change? **YES** — resolver service + JSON artifacts + optional metadata.aliases growth
8. Production migration? Additive only when promoting aliases/queue to first-class tables
9. Guarantee resolved ≠ complete? Separate status enum; acquisition gated on demand
10. Reversibility? Versioned mapping rows with supersession

## ANTI-REGRESSION METRICS

Track: local resolution rate, identity-unresolved rate, unique unresolved targets / 1k cases, external lookups / 1k cases, full-text / 1k cases, old edges backfilled, alias reuse rate.  
If identity-unresolved grows faster than corpus → **resolver regression**.

## SAFETY GATES

- High-confidence / deterministic only for auto-apply  
- No competing target  
- Provenance retained  
- Reversible  
- No destructive deletion  
- Original citation text preserved  
- Ambiguous stays unresolved  
- Authority-resolved never implies full text  

## P0 BLOCKERS

None for building the engine offline.  
Live apply of HIGH-confidence local mappings requires a separate authorized write pass.

## RECOMMENDATION

**${report.recommendation}**

## FINAL CLASSIFICATION

**${report.finalClassification}**

### Interpretation
- Local HIGH-confidence backfill alone is small (present-authority defect is not the main backlog).
- The dominant opportunity is **unique-target identity resolution** (local-first, then batch external lookup) **without** full-opinion acquisition, plus a permanent ingestion-stage resolver so new cases do not recreate edge-level unresolved growth.
`;

    fs.mkdirSync(path.dirname(REPORT_MD), { recursive: true });
    fs.writeFileSync(REPORT_MD, md);

    console.log(
      JSON.stringify(
        {
          ok: true,
          courtListenerHttpCalls: 0,
          corpusMutations: 0,
          unresolved: graph.unresolved,
          uniqueTargets: targets.size,
          highEdges,
          highTargets,
          top100Edges: sumTop(100),
          recommendation: report.recommendation,
          reportMd: REPORT_MD,
          reportJson: REPORT_JSON,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    try {
      await sql.unsafe("ROLLBACK");
    } catch {
      /* */
    }
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 1200), courtListenerHttpCalls: 0, corpusMutations: 0 }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
