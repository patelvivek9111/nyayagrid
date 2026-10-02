/**
 * ZERO-CL citation forensic audit (read-only by default).
 * Env: DATABASE_URL required.
 * Optional: RUN_BACKFILL=1 to extract citations for unprocessed cases (local only).
 * Optional: RUN_RERESOLVE=1 to resolve present-target edges after backfill (local only).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const postgres = require("postgres");
const {
  leanNormalizeCitation,
  citationLookupAliases,
  classifyCitationFamily,
  isGarbageCitation,
} = require("./wave2f-citation-audit.cjs");

const OUT =
  process.env.FORENSIC_OUT ||
  (fs.existsSync(path.join(__dirname, "../packages/research/corpus/reports"))
    ? path.join(__dirname, "../packages/research/corpus/reports/citation-forensic-audit-last.json")
    : "/tmp/citation-forensic-audit-last.json");
const ARGV = new Set(process.argv.slice(2));
const RUN_BACKFILL = process.env.RUN_BACKFILL === "1" || ARGV.has("--backfill");
const RUN_RERESOLVE = process.env.RUN_RERESOLVE === "1" || ARGV.has("--reresolve");
const SAMPLE_N = Number(process.env.SAMPLE_N || 120);
const BACKFILL_LIMIT = Number(process.env.BACKFILL_LIMIT || 5000);
const BACKFILL_BATCH = Number(process.env.BACKFILL_BATCH || 25);
const HIST_ONLY = process.env.HIST_ONLY === "1" || ARGV.has("--hist-only");

// Broader local extractors than lean batch (still deterministic, no network).
const EXTRACT_RES = [
  /\b\d{1,3}\s+U\.?\s*S\.?\s+\d{1,4}\b/gi,
  /\b\d{1,3}\s+S\.?\s*Ct\.?\s+\d{1,4}\b/gi,
  /\b\d{1,3}\s+L\.?\s*Ed\.?\s*(?:2d\s+)?\d{1,4}\b/gi,
  /\b\d{1,4}\s+F\.?\s*(?:2d|3d|4th)\s+\d{1,4}\b/gi,
  /\b\d{1,4}\s+F\.?\s*Supp\.?\s*(?:2d|3d)?\s+\d{1,4}\b/gi,
  /\b\d{1,2}\s+U\.?\s*S\.?\s*C\.?\s*§\s*[\dA-Za-z.()-]+\b/gi,
  /\b\d{1,2}\s+C\.?\s*F\.?\s*R\.?\s*§\s*[\d.()-]+\b/gi,
  /\bFed\.?\s*R\.?\s*(?:Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s+\d+[A-Za-z]?\b/gi,
  /\b\d{1,4}\s+[A-Z][a-z]{0,10}\.?\s*(?:2d|3d)?\s+\d{1,4}\b/g,
];

function normalizeCitation(raw) {
  return leanNormalizeCitation(raw) || String(raw || "").replace(/\s+/g, " ").trim();
}

function extractCitationsLocal(content) {
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
      if (isGarbageCitation(normalized)) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ raw, normalized });
    }
  }
  return out;
}

function familyOf(raw, norm) {
  return classifyCitationFamily(raw || "", norm || "") || "unknown";
}

function parseVolReporterPage(cite) {
  const t = String(cite || "").replace(/\s+/g, " ").trim();
  let m = t.match(/^(\d{1,3})\s+U\.?\s*S\.?\s+(\d{1,4})$/i);
  if (m) return { family: "us_reports", volume: Number(m[1]), page: Number(m[2]), reporter: "U.S." };
  m = t.match(/^(\d{1,4})\s+F\.?\s*(2d|3d|4th)\s+(\d{1,4})$/i);
  if (m) return { family: "federal_reporter", volume: Number(m[1]), page: Number(m[3]), reporter: `F.${m[2].toLowerCase()}` };
  m = t.match(/^(\d{1,4})\s+F\.?\s*Supp\.?\s*(2d|3d)?\s+(\d{1,4})$/i);
  if (m)
    return {
      family: "federal_supplement",
      volume: Number(m[1]),
      page: Number(m[3]),
      reporter: m[2] ? `F. Supp. ${m[2].toLowerCase()}` : "F. Supp.",
    };
  return null;
}

function keyOf(p) {
  return `${p.family}|${p.volume}|${p.reporter}|${p.page}`;
}

function pct(n, d) {
  if (!d) return 0;
  return Number(((100 * n) / d).toFixed(2));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 30 });
  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    courtListenerHttpCalls: 0,
    openaiCalls: 0,
    claudeCalls: 0,
    geminiCalls: 0,
    grokCalls: 0,
    otherLlmCalls: 0,
    externalEmbeddings: 0,
    subagents: 0,
    mutations: 0,
    phases: {},
  };

  try {
    // ---------- PHASE 0 / 1 baseline ----------
    const [corpus] = await sql`
      select
        count(*)::int as authorities,
        count(*) filter (where authority_type = 'case')::int as cases,
        count(*) filter (where authority_type = 'statute')::int as statutes,
        count(*) filter (where authority_type = 'regulation')::int as regulations,
        count(*) filter (where authority_type = 'rule')::int as rules
      from legal_authorities
    `;
    const [cites] = await sql`
      select
        count(*)::int as extracted,
        count(*) filter (where to_authority_id is not null)::int as resolved,
        count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    const [integrity] = await sql`
      select
        (select count(*)::int from (
          select from_authority_id, normalized_citation
          from legal_authority_citations
          group by 1,2 having count(*) > 1
        ) d) as duplicate_citation_edges,
        (select count(*)::int from legal_authority_citations c
          left join legal_authorities a on a.id = c.from_authority_id
          where a.id is null) as orphan_citation_edges_from,
        (select count(*)::int from legal_authority_citations c
          left join legal_authorities a on a.id = c.to_authority_id
          where c.to_authority_id is not null and a.id is null) as orphan_citation_edges_to,
        (select count(*)::int from (
          select source_provider, source_external_id from legal_authorities
          where source_external_id is not null
          group by 1,2 having count(*) > 1
        ) d) as duplicate_authorities,
        (select count(*)::int from legal_authority_chunks c
          left join legal_authorities a on a.id = c.authority_id where a.id is null) as orphan_chunks,
        (select count(*)::int from legal_authority_chunks where embedding is null) as missing_embeddings
    `;

    report.phases.baseline = {
      corpus,
      citations: {
        ...cites,
        resolutionPct: pct(cites.resolved, cites.extracted),
      },
      integrity,
    };

    // Case text + extraction coverage
    const caseRows = await sql`
      select
        a.id,
        a.court_level,
        a.authority_state,
        a.source_provider,
        a.created_at,
        a.metadata,
        coalesce(length(v.content), 0)::int as content_len,
        (v.content is not null and length(v.content) >= 200) as has_text,
        coalesce(cite.edge_count, 0)::int as edge_count,
        coalesce(ch.chunk_count, 0)::int as chunk_count,
        coalesce(ch.embed_count, 0)::int as embed_count
      from legal_authorities a
      left join lateral (
        select content from legal_authority_versions
        where authority_id = a.id
        order by version_number desc
        limit 1
      ) v on true
      left join lateral (
        select count(*)::int as edge_count
        from legal_authority_citations
        where from_authority_id = a.id
      ) cite on true
      left join lateral (
        select count(*)::int as chunk_count,
               count(*) filter (where embedding is not null)::int as embed_count
        from legal_authority_chunks
        where authority_id = a.id
      ) ch on true
      where a.authority_type = 'case'
    `;

    const casesTotal = caseRows.length;
    const withText = caseRows.filter((r) => r.has_text);
    const withoutText = caseRows.filter((r) => !r.has_text);
    const withEdges = caseRows.filter((r) => r.edge_count > 0);
    const zeroEdges = caseRows.filter((r) => r.edge_count === 0);
    const zeroEdgesWithText = caseRows.filter((r) => r.edge_count === 0 && r.has_text);
    const histAdapter = caseRows.filter((r) => {
      const m = r.metadata && typeof r.metadata === "object" ? r.metadata : {};
      return m.adapter === "s3-hist-ingest";
    });
    const histZero = histAdapter.filter((r) => r.edge_count === 0);
    const histWithEdges = histAdapter.filter((r) => r.edge_count > 0);

    // Extraction classification (proxy: edge_count + text + adapter)
    // NOT_EXTRACTED: has text, 0 edges, hist adapter OR no extraction marker
    // EXTRACTED_ZERO_VALID: would need extraction marker; we don't store one — use parser sample later
    const extraction = {
      eligible: withText.length,
      processedProxy_hasEdges: withEdges.length,
      notProcessedProxy_zeroEdgesWithText: zeroEdgesWithText.length,
      coveragePct_proxy: pct(withEdges.length, withText.length),
      noText: withoutText.length,
      histIngestCases: histAdapter.length,
      histIngestWithEdges: histWithEdges.length,
      histIngestZeroEdges: histZero.length,
      histIngestZeroEdgesPct: pct(histZero.length, histAdapter.length || 1),
      textBytesEligible: withText.reduce((s, r) => s + Number(r.content_len || 0), 0),
      textBytesWithEdges: withEdges.reduce((s, r) => s + Number(r.content_len || 0), 0),
      textBytesZeroEdges: zeroEdgesWithText.reduce((s, r) => s + Number(r.content_len || 0), 0),
    };

    // Recent case cohorts by created_at order (approx for user's milestones)
    const byCreated = [...caseRows].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const milestones = [2905, 3070, 3416, 3490, 3568, 3652, 3754, 3867];
    const cohortAudit = [];
    for (let i = 0; i < milestones.length - 1; i++) {
      const from = milestones[i];
      const to = milestones[i + 1];
      const slice = byCreated.slice(from, Math.min(to, byCreated.length));
      const z = slice.filter((r) => r.edge_count === 0 && r.has_text).length;
      const e = slice.filter((r) => r.edge_count > 0).length;
      const hist = slice.filter((r) => {
        const m = r.metadata && typeof r.metadata === "object" ? r.metadata : {};
        return m.adapter === "s3-hist-ingest";
      }).length;
      cohortAudit.push({
        fromCount: from,
        toCount: to,
        added: slice.length,
        withEdges: e,
        zeroEdgesWithText: z,
        histAdapter: hist,
        extractionCoveragePct: pct(e, slice.filter((r) => r.has_text).length || 1),
      });
    }
    // Most recent ~1000
    const recent = byCreated.slice(Math.max(0, byCreated.length - 1000));
    const recentAudit = {
      n: recent.length,
      withText: recent.filter((r) => r.has_text).length,
      withEdges: recent.filter((r) => r.edge_count > 0).length,
      zeroEdgesWithText: recent.filter((r) => r.edge_count === 0 && r.has_text).length,
      histAdapter: recent.filter((r) => {
        const m = r.metadata && typeof r.metadata === "object" ? r.metadata : {};
        return m.adapter === "s3-hist-ingest";
      }).length,
      byCourtLevel: {},
    };
    for (const r of recent) {
      const lvl = r.court_level || "unknown";
      if (!recentAudit.byCourtLevel[lvl]) recentAudit.byCourtLevel[lvl] = { n: 0, withEdges: 0, zero: 0 };
      recentAudit.byCourtLevel[lvl].n += 1;
      if (r.edge_count > 0) recentAudit.byCourtLevel[lvl].withEdges += 1;
      else if (r.has_text) recentAudit.byCourtLevel[lvl].zero += 1;
    }

    report.phases.extractionInventory = {
      casesTotal,
      withText: withText.length,
      withoutText: withoutText.length,
      withEdges: withEdges.length,
      zeroEdges: zeroEdges.length,
      zeroEdgesWithText: zeroEdgesWithText.length,
      extraction,
      cohortAudit,
      recentAudit,
      codePathDefect: {
        file: "scripts/tmp-queue2-s3-hist-ingest.cjs (+ bundled)",
        storesFullText: true,
        createsChunks: true,
        createsEmbeddings: true,
        runsCitationExtraction: false,
        runsResolver: false,
        evidence: "No insert into legal_authority_citations in hist ingest path",
        affectedCases: histAdapter.length,
        affectedZeroEdgeCases: histZero.length,
      },
    };

    // ---------- PHASE 4 sample scan ----------
    function stratifiedSample(rows, n) {
      const buckets = {
        state_high: [],
        state_appellate: [],
        circuit: [],
        district: [],
        other: [],
      };
      for (const r of rows) {
        const k = buckets[r.court_level] ? r.court_level : "other";
        buckets[k].push(r);
      }
      const out = [];
      const keys = Object.keys(buckets);
      const per = Math.max(1, Math.floor(n / keys.length));
      for (const k of keys) {
        const arr = buckets[k];
        for (let i = 0; i < Math.min(per, arr.length); i++) {
          const idx = Math.floor((i * arr.length) / Math.min(per, arr.length));
          out.push(arr[Math.min(idx, arr.length - 1)]);
        }
      }
      return out.slice(0, n);
    }

    const sampleTargets = stratifiedSample(zeroEdgesWithText, SAMPLE_N);
    const sampleIds = sampleTargets.map((r) => r.id);
    let sampleParserPositive = 0;
    let sampleParserZero = 0;
    let sampleCiteOcc = 0;
    const sampleExamples = [];
    if (sampleIds.length) {
      const texts = await sql`
        select a.id, v.content
        from legal_authorities a
        join lateral (
          select content from legal_authority_versions
          where authority_id = a.id
          order by version_number desc limit 1
        ) v on true
        where a.id = any(${sampleIds}::uuid[])
      `;
      for (const t of texts) {
        const found = extractCitationsLocal(t.content);
        if (found.length > 0) {
          sampleParserPositive += 1;
          sampleCiteOcc += found.length;
          if (sampleExamples.length < 15) {
            sampleExamples.push({
              id: t.id,
              found: found.length,
              samples: found.slice(0, 5).map((c) => c.normalized),
            });
          }
        } else sampleParserZero += 1;
      }
    }

    const estimatedExtractionMissRate = pct(sampleParserPositive, sampleTargets.length || 1);
    const estimatedMissedCases =
      zeroEdgesWithText.length > 0
        ? Math.round((sampleParserPositive / Math.max(1, sampleTargets.length)) * zeroEdgesWithText.length)
        : 0;

    report.phases.zeroEdgeSample = {
      sampleSize: sampleTargets.length,
      parserPositive: sampleParserPositive,
      parserZero: sampleParserZero,
      parserFoundOccurrences: sampleCiteOcc,
      estimatedExtractionMissRatePct: estimatedExtractionMissRate,
      estimatedMissedEligibleCases: estimatedMissedCases,
      examples: sampleExamples,
    };

    // ---------- PHASE 7-9 unresolved forensics ----------
    const authorities = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider,
             authority_type, court, decision_date
      from legal_authorities
    `;
    const unresolved = await sql`
      select id, from_authority_id, raw_citation, normalized_citation
      from legal_authority_citations
      where to_authority_id is null
    `;

    const aliasIndex = new Map();
    const vrpIndex = new Map();
    for (const a of authorities) {
      const keys = new Set();
      for (const v of [a.normalized_citation, a.citation].filter(Boolean)) {
        const lean = leanNormalizeCitation(v) || v;
        for (const k of citationLookupAliases(lean)) keys.add(k);
        for (const k of citationLookupAliases(v)) keys.add(k);
        const p = parseVolReporterPage(leanNormalizeCitation(v) || v);
        if (p) {
          const vk = keyOf(p);
          if (!vrpIndex.has(vk)) vrpIndex.set(vk, new Set());
          vrpIndex.get(vk).add(a.id);
        }
      }
      const meta = a.metadata && typeof a.metadata === "object" ? a.metadata : {};
      for (const alias of [...(meta.citationAliases || []), ...(meta.parallelCitations || [])]) {
        if (typeof alias !== "string" || !alias.trim()) continue;
        const lean = leanNormalizeCitation(alias) || alias.trim();
        for (const k of citationLookupAliases(lean)) keys.add(k);
      }
      for (const k of keys) {
        if (!aliasIndex.has(k)) aliasIndex.set(k, new Set());
        aliasIndex.get(k).add(a.id);
      }
    }

    const buckets = {
      A_TARGET_PRESENT_EXACT_MATCH_MISSED: 0,
      B_TARGET_PRESENT_ALIAS_MATCH_MISSED: 0,
      C_TARGET_PRESENT_REPORTER_MATCH_MISSED: 0,
      D_TARGET_PRESENT_IDENTITY_COLLISION: 0,
      E_TARGET_PRESENT_AMBIGUOUS: 0,
      F_TARGET_TRULY_ABSENT_CASE: 0,
      G_TARGET_TRULY_ABSENT_STATUTE: 0,
      H_TARGET_TRULY_ABSENT_REGULATION: 0,
      I_TARGET_TRULY_ABSENT_RULE: 0,
      J_UNSUPPORTED_CITATION_TYPE: 0,
      K_MALFORMED: 0,
      L_INSUFFICIENT_METADATA: 0,
      M_SOURCE_TEXT_PARSE_DEFECT: 0,
      N_OTHER: 0,
    };
    const uniqueByBucket = Object.fromEntries(Object.keys(buckets).map((k) => [k, new Set()]));
    const familyStats = new Map(); // family -> {extracted later; unresolved; unique}
    const absentDemand = new Map(); // lean -> {family, edges, bucket}
    const presentMissExamples = [];
    const defectClass = {
      NORMALIZATION: 0,
      REPORTER_ALIAS: 0,
      REPORTER_VARIANT: 0,
      SPACING: 0,
      PUNCTUATION: 0,
      PARALLEL_CITATION: 0,
      NEUTRAL_CITATION: 0,
      VOLUME_PAGE: 0,
      CASE_ALIAS: 0,
      DB_LOOKUP: 0,
      STALE_EDGE: 0,
      CANONICAL_ID: 0,
      DUPLICATE_AUTHORITY: 0,
      OTHER: 0,
    };

    function bumpFamily(family, field, citeKey) {
      if (!familyStats.has(family)) {
        familyStats.set(family, { unresolved: 0, unique: new Set(), resolved: 0, extracted: 0 });
      }
      const s = familyStats.get(family);
      s[field] += 1;
      if (citeKey) s.unique.add(citeKey);
    }

    for (const e of unresolved) {
      const raw = e.raw_citation || "";
      const norm = e.normalized_citation || "";
      const lean = leanNormalizeCitation(norm) || leanNormalizeCitation(raw) || norm || raw;
      const family = familyOf(raw, lean);
      const citeKey = lean || norm || raw;
      bumpFamily(family, "unresolved", citeKey);

      if (isGarbageCitation(raw) && isGarbageCitation(norm)) {
        buckets.K_MALFORMED += 1;
        uniqueByBucket.K_MALFORMED.add(citeKey);
        continue;
      }
      if (!lean || lean.length < 3) {
        buckets.K_MALFORMED += 1;
        uniqueByBucket.K_MALFORMED.add(citeKey);
        continue;
      }

      // unsupported secondary
      if (/\b(WL|LEXIS|Restatement|Am\.\s*Jur|C\.J\.S\.|ALR|L\.\s*Rev)\b/i.test(lean)) {
        buckets.J_UNSUPPORTED_CITATION_TYPE += 1;
        uniqueByBucket.J_UNSUPPORTED_CITATION_TYPE.add(citeKey);
        continue;
      }

      const keys = new Set();
      for (const v of [lean, raw, norm].filter(Boolean)) {
        for (const k of citationLookupAliases(v)) keys.add(k);
        const l = leanNormalizeCitation(v);
        if (l) for (const k of citationLookupAliases(l)) keys.add(k);
      }
      const ids = new Set();
      for (const k of keys) {
        const hit = aliasIndex.get(k);
        if (hit) for (const id of hit) ids.add(id);
      }

      // exact string present?
      let exactPresent = false;
      for (const a of authorities) {
        if (a.normalized_citation === lean || a.citation === lean || a.normalized_citation === norm) {
          exactPresent = true;
          break;
        }
      }

      if (ids.size === 1) {
        if (exactPresent) {
          buckets.A_TARGET_PRESENT_EXACT_MATCH_MISSED += 1;
          uniqueByBucket.A_TARGET_PRESENT_EXACT_MATCH_MISSED.add(citeKey);
          defectClass.DB_LOOKUP += 1;
        } else {
          buckets.B_TARGET_PRESENT_ALIAS_MATCH_MISSED += 1;
          uniqueByBucket.B_TARGET_PRESENT_ALIAS_MATCH_MISSED.add(citeKey);
          defectClass.CASE_ALIAS += 1;
        }
        if (presentMissExamples.length < 25) {
          presentMissExamples.push({ raw, lean, family, matchId: [...ids][0], exactPresent });
        }
        continue;
      }
      if (ids.size > 1) {
        buckets.E_TARGET_PRESENT_AMBIGUOUS += 1;
        uniqueByBucket.E_TARGET_PRESENT_AMBIGUOUS.add(citeKey);
        defectClass.DUPLICATE_AUTHORITY += 1;
        continue;
      }

      const p = parseVolReporterPage(lean);
      if (p) {
        const vk = keyOf(p);
        const vhit = vrpIndex.get(vk);
        if (vhit && vhit.size === 1) {
          buckets.C_TARGET_PRESENT_REPORTER_MATCH_MISSED += 1;
          uniqueByBucket.C_TARGET_PRESENT_REPORTER_MATCH_MISSED.add(citeKey);
          defectClass.VOLUME_PAGE += 1;
          if (presentMissExamples.length < 25) {
            presentMissExamples.push({ raw, lean, family, matchId: [...vhit][0], via: "vrp" });
          }
          continue;
        }
        if (vhit && vhit.size > 1) {
          buckets.D_TARGET_PRESENT_IDENTITY_COLLISION += 1;
          uniqueByBucket.D_TARGET_PRESENT_IDENTITY_COLLISION.add(citeKey);
          continue;
        }
      }

      // truly absent by family
      let bucket = "F_TARGET_TRULY_ABSENT_CASE";
      if (family === "usc" || family === "state_statute") bucket = "G_TARGET_TRULY_ABSENT_STATUTE";
      else if (family === "cfr" || family === "state_regulation") bucket = "H_TARGET_TRULY_ABSENT_REGULATION";
      else if (family === "federal_rules" || family === "state_court_rules") bucket = "I_TARGET_TRULY_ABSENT_RULE";
      else if (family === "malformed_partial" || family === "slip_unreported" || family === "docket_like") {
        if (family === "malformed_partial") bucket = "K_MALFORMED";
        else bucket = "J_UNSUPPORTED_CITATION_TYPE";
      } else if (family === "unknown") {
        bucket = "L_INSUFFICIENT_METADATA";
      }

      buckets[bucket] += 1;
      uniqueByBucket[bucket].add(citeKey);

      if (bucket.startsWith("F_") || bucket.startsWith("G_") || bucket.startsWith("H_") || bucket.startsWith("I_")) {
        if (!absentDemand.has(citeKey)) {
          absentDemand.set(citeKey, { family, edges: 0, lean: citeKey });
        }
        absentDemand.get(citeKey).edges += 1;
      }
    }

    // family extracted/resolved totals
    const allEdges = await sql`
      select raw_citation, normalized_citation, to_authority_id
      from legal_authority_citations
    `;
    for (const e of allEdges) {
      const lean =
        leanNormalizeCitation(e.normalized_citation) ||
        leanNormalizeCitation(e.raw_citation) ||
        e.normalized_citation ||
        e.raw_citation ||
        "";
      const family = familyOf(e.raw_citation || "", lean);
      if (!familyStats.has(family)) {
        familyStats.set(family, { unresolved: 0, unique: new Set(), resolved: 0, extracted: 0 });
      }
      const s = familyStats.get(family);
      s.extracted += 1;
      if (e.to_authority_id) s.resolved += 1;
    }

    const familyTable = [...familyStats.entries()]
      .map(([family, s]) => ({
        family,
        extracted: s.extracted,
        resolved: s.resolved,
        unresolved: s.extracted - s.resolved,
        resolutionPct: pct(s.resolved, s.extracted),
        uniqueUnresolvedApprox: s.unique.size,
      }))
      .sort((a, b) => b.unresolved - a.unresolved);

    const uniqueBucketCounts = Object.fromEntries(
      Object.entries(uniqueByBucket).map(([k, set]) => [k, set.size]),
    );

    const presentTargetMissed =
      buckets.A_TARGET_PRESENT_EXACT_MATCH_MISSED +
      buckets.B_TARGET_PRESENT_ALIAS_MATCH_MISSED +
      buckets.C_TARGET_PRESENT_REPORTER_MATCH_MISSED;

    const topAbsent = [...absentDemand.values()].sort((a, b) => b.edges - a.edges);
    function cumEdges(n) {
      return topAbsent.slice(0, n).reduce((s, x) => s + x.edges, 0);
    }

    // Family-specific audits
    function familyAudit(familyName) {
      const row = familyTable.find((f) => f.family === familyName) || {
        extracted: 0,
        resolved: 0,
        unresolved: 0,
        resolutionPct: 0,
      };
      const absent = topAbsent.filter((t) => t.family === familyName);
      const presentMiss = presentMissExamples.filter((e) => e.family === familyName).length;
      return {
        ...row,
        uniqueMissing: absent.length,
        top50Demand: absent.slice(0, 50).reduce((s, x) => s + x.edges, 0),
        presentButUnresolvedExamples: presentMiss,
        maxTheoreticalLiftIfAllAbsentAcquired: absent.reduce((s, x) => s + x.edges, 0),
      };
    }

    report.phases.resolutionForensics = {
      unresolvedEdges: unresolved.length,
      buckets,
      uniqueBucketCounts,
      presentTargetMissedEdges: presentTargetMissed,
      presentMissExamples,
      defectClass,
      familyTable,
      concentration: {
        top10: cumEdges(10),
        top25: cumEdges(25),
        top50: cumEdges(50),
        top100: cumEdges(100),
        top250: cumEdges(250),
        top500: cumEdges(500),
        uniqueAbsentTargets: topAbsent.length,
        totalAbsentEdgesTracked: topAbsent.reduce((s, x) => s + x.edges, 0),
      },
      top100Missing: topAbsent.slice(0, 100),
      usReports: familyAudit("us_reports"),
      usc: familyAudit("usc"),
      cfr: familyAudit("cfr"),
      federalRules: familyAudit("federal_rules"),
      federalReporter: familyAudit("federal_reporter"),
      federalSupplement: familyAudit("federal_supplement"),
    };

    // Root cause contribution (edge counts on CURRENT denominator)
    const root = {
      extractionMissing_estimatedNewEdgesIfBackfill:
        // conservative: sample mean cites * zero-edge-with-text * miss rate — use sample avg
        sampleTargets.length
          ? Math.round(
              (sampleCiteOcc / sampleTargets.length) * zeroEdgesWithText.length * (sampleParserPositive / sampleTargets.length),
            )
          : 0,
      presentTargetResolverDefects: presentTargetMissed,
      trueMissingCase: buckets.F_TARGET_TRULY_ABSENT_CASE,
      trueMissingStatute: buckets.G_TARGET_TRULY_ABSENT_STATUTE,
      trueMissingRegulation: buckets.H_TARGET_TRULY_ABSENT_REGULATION,
      trueMissingRule: buckets.I_TARGET_TRULY_ABSENT_RULE,
      unsupported: buckets.J_UNSUPPORTED_CITATION_TYPE,
      malformedAmbiguous:
        buckets.K_MALFORMED + buckets.E_TARGET_PRESENT_AMBIGUOUS + buckets.L_INSUFFICIENT_METADATA,
      other:
        buckets.D_TARGET_PRESENT_IDENTITY_COLLISION +
        buckets.M_SOURCE_TEXT_PARSE_DEFECT +
        buckets.N_OTHER,
    };
    // Contributions among CURRENT unresolved (8255-scale): percentages of unresolved
    const u = Math.max(1, unresolved.length);
    report.phases.rootCauseOfCurrentResolution = {
      note: "Percentages below are share of CURRENT unresolved edges (not of extracted). Extraction missing is SEPARATE — those cases have ZERO edges today so they do not appear in the 8255 TARGET_ABSENT pool.",
      currentUnresolvedBreakdownPct: {
        presentTargetResolverDefects: pct(root.presentTargetResolverDefects, u),
        trueMissingCase: pct(root.trueMissingCase, u),
        trueMissingStatute: pct(root.trueMissingStatute, u),
        trueMissingRegulation: pct(root.trueMissingRegulation, u),
        trueMissingRule: pct(root.trueMissingRule, u),
        unsupported: pct(root.unsupported, u),
        malformedAmbiguous: pct(root.malformedAmbiguous, u),
        other: pct(root.other, u),
      },
      edgeCounts: root,
      extractionGapSeparate: {
        casesWithTextZeroEdges: zeroEdgesWithText.length,
        sampleParserPositiveRatePct: estimatedExtractionMissRate,
        estimatedMissedCases: estimatedMissedCases,
        estimatedNewOccurrencesIfBackfilled: root.extractionMissing_estimatedNewEdgesIfBackfill,
      },
    };

    // Milestones from CURRENT resolved without extraction backfill
    const startResolved = cites.resolved;
    const startExtracted = cites.extracted;
    function milestone(targetPct) {
      const needTotalResolved = Math.ceil((targetPct / 100) * startExtracted);
      const additional = Math.max(0, needTotalResolved - startResolved);
      return { targetPct, additionalEdgesRequired: additional, needTotalResolved };
    }
    report.phases.milestonesOnCurrentDenominator = {
      "15": milestone(15),
      "20": milestone(20),
      "25": milestone(25),
      "30": milestone(30),
      "40": milestone(40),
      "50": milestone(50),
      curveIfResolveTopAbsent: {
        top25: {
          add: cumEdges(25),
          pct: pct(startResolved + cumEdges(25), startExtracted),
        },
        top50: { add: cumEdges(50), pct: pct(startResolved + cumEdges(50), startExtracted) },
        top100: { add: cumEdges(100), pct: pct(startResolved + cumEdges(100), startExtracted) },
        top250: { add: cumEdges(250), pct: pct(startResolved + cumEdges(250), startExtracted) },
        top500: { add: cumEdges(500), pct: pct(startResolved + cumEdges(500), startExtracted) },
      },
    };

    // ---------- optional BACKFILL ----------
    report.phases.backfill = { ran: false };
    if (RUN_BACKFILL) {
      const toProcess = zeroEdgesWithText
        .filter((r) => {
          const m = r.metadata && typeof r.metadata === "object" ? r.metadata : {};
          return m.adapter === "s3-hist-ingest" || r.edge_count === 0;
        })
        .slice(0, BACKFILL_LIMIT);

      let processed = 0;
      let newOcc = 0;
      let newUnique = 0;
      let failures = 0;
      const uniqueNew = new Set();

      for (let i = 0; i < toProcess.length; i += BACKFILL_BATCH) {
        const batch = toProcess.slice(i, i + BACKFILL_BATCH);
        const ids = batch.map((b) => b.id);
        const texts = await sql`
          select a.id, v.content
          from legal_authorities a
          join lateral (
            select content from legal_authority_versions
            where authority_id = a.id order by version_number desc limit 1
          ) v on true
          where a.id = any(${ids}::uuid[])
        `;
        for (const t of texts) {
          try {
            const citesFound = extractCitationsLocal(t.content);
            for (const cit of citesFound) {
              const dup = await sql`
                select 1 as ok from legal_authority_citations
                where from_authority_id = ${t.id}
                  and normalized_citation = ${cit.normalized}
                limit 1
              `;
              if (dup.length) continue;
              // resolve if present
              let toId = null;
              const keys = new Set();
              for (const k of citationLookupAliases(cit.normalized)) keys.add(k);
              for (const k of keys) {
                const hit = aliasIndex.get(k);
                if (hit && hit.size === 1) {
                  toId = [...hit][0];
                  break;
                }
              }
              if (!toId) {
                const matches = await sql`
                  select id from legal_authorities
                  where normalized_citation = ${cit.normalized}
                     or citation = ${cit.normalized}
                     or citation = ${cit.raw}
                  limit 2
                `;
                if (matches.length === 1) toId = matches[0].id;
              }
              await sql`
                insert into legal_authority_citations (
                  id, from_authority_id, to_authority_id, raw_citation, normalized_citation
                ) values (
                  ${crypto.randomUUID()}, ${t.id}, ${toId}, ${cit.raw}, ${cit.normalized}
                )
              `;
              report.mutations += 1;
              newOcc += 1;
              if (!uniqueNew.has(cit.normalized)) {
                uniqueNew.add(cit.normalized);
                newUnique += 1;
              }
            }
            processed += 1;
          } catch (err) {
            failures += 1;
          }
        }
        // integrity pulse
        const [dupCheck] = await sql`
          select count(*)::int as n from (
            select from_authority_id, normalized_citation
            from legal_authority_citations
            group by 1,2 having count(*) > 1
          ) d
        `;
        if (dupCheck.n > 0) {
          report.phases.backfill = {
            ran: true,
            aborted: true,
            reason: "duplicateCitationEdges>0",
            processed,
            newOcc,
          };
          break;
        }
      }

      report.phases.backfill = {
        ran: true,
        casesProcessed: processed,
        newCitationOccurrences: newOcc,
        newUniqueCitationStrings: newUnique,
        failures,
        limit: BACKFILL_LIMIT,
      };
    }

    // ---------- optional RERESOLVE present-target ----------
    report.phases.reresolve = { ran: false };
    if (RUN_RERESOLVE) {
      // Refresh unresolved present-target via alias index
      const unresolved2 = await sql`
        select id, raw_citation, normalized_citation
        from legal_authority_citations
        where to_authority_id is null
      `;
      // rebuild alias index after backfill
      const authorities2 = await sql`
        select id, citation, normalized_citation, metadata from legal_authorities
      `;
      const alias2 = new Map();
      for (const a of authorities2) {
        const keys = new Set();
        for (const v of [a.normalized_citation, a.citation].filter(Boolean)) {
          const lean = leanNormalizeCitation(v) || v;
          for (const k of citationLookupAliases(lean)) keys.add(k);
        }
        const meta = a.metadata && typeof a.metadata === "object" ? a.metadata : {};
        for (const alias of [...(meta.citationAliases || []), ...(meta.parallelCitations || [])]) {
          if (typeof alias !== "string") continue;
          for (const k of citationLookupAliases(leanNormalizeCitation(alias) || alias)) keys.add(k);
        }
        for (const k of keys) {
          if (!alias2.has(k)) alias2.set(k, new Set());
          alias2.get(k).add(a.id);
        }
      }
      let fixed = 0;
      for (const e of unresolved2) {
        const lean =
          leanNormalizeCitation(e.normalized_citation) ||
          leanNormalizeCitation(e.raw_citation) ||
          e.normalized_citation ||
          "";
        const keys = new Set();
        for (const v of [lean, e.raw_citation, e.normalized_citation].filter(Boolean)) {
          for (const k of citationLookupAliases(v)) keys.add(k);
        }
        const ids = new Set();
        for (const k of keys) {
          const hit = alias2.get(k);
          if (hit) for (const id of hit) ids.add(id);
        }
        if (ids.size !== 1) continue;
        const toId = [...ids][0];
        await sql`
          update legal_authority_citations
          set to_authority_id = ${toId}
          where id = ${e.id} and to_authority_id is null
        `;
        fixed += 1;
        report.mutations += 1;
      }
      const [after] = await sql`
        select count(*)::int as extracted,
               count(*) filter (where to_authority_id is not null)::int as resolved,
               count(*) filter (where to_authority_id is null)::int as unresolved
        from legal_authority_citations
      `;
      report.phases.reresolve = {
        ran: true,
        fixed,
        before: cites,
        after,
        deltaResolved: after.resolved - cites.resolved,
        resolutionPctAfter: pct(after.resolved, after.extracted),
      };
    }

    // Final snapshot
    const [finalCites] = await sql`
      select count(*)::int as extracted,
             count(*) filter (where to_authority_id is not null)::int as resolved,
             count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    const [finalIntegrity] = await sql`
      select
        (select count(*)::int from (
          select from_authority_id, normalized_citation
          from legal_authority_citations group by 1,2 having count(*) > 1
        ) d) as duplicate_citation_edges,
        (select count(*)::int from legal_authority_chunks where embedding is null) as missing_embeddings
    `;
    report.phases.final = {
      citations: { ...finalCites, resolutionPct: pct(finalCites.resolved, finalCites.extracted) },
      integrity: finalIntegrity,
    };

    // Production decisions
    report.phases.decisions = {
      citationExtractionOnAllIngestPaths: false,
      recentHistoricalMissingExtraction: true,
      affectedHistCases: histAdapter.length,
      resolverFailingPresentTargets: presentTargetMissed > 0,
      presentTargetMissedCount: presentTargetMissed,
      targetAbsentMateriallyAccurate: presentTargetMissed < unresolved.length * 0.05,
      largestZeroClImprovement: "Local citation extraction backfill on hist-ingest cases (zero edges with text)",
      largestFutureAcquisitionPerCl: "Acquire top absent case targets by edge-demand concentration (top 100/250)",
      nextBeforeMoreCl:
        "Run RUN_BACKFILL=1 local extraction on all zero-edge eligible cases, then RUN_RERESOLVE=1 for present-target links",
    };

    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      ok: true,
      out: OUT,
      baseline: report.phases.baseline,
      extraction: report.phases.extractionInventory.extraction,
      recent: report.phases.extractionInventory.recentAudit,
      sample: report.phases.zeroEdgeSample,
      presentTargetMissed: presentTargetMissed,
      bucketsSummary: buckets,
      topConcentration: report.phases.resolutionForensics.concentration,
      familyTop5: familyTable.slice(0, 5),
      backfill: report.phases.backfill,
      reresolve: report.phases.reresolve,
      final: report.phases.final,
      courtListenerHttpCalls: 0,
    }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
