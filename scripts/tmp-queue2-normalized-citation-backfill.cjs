#!/usr/bin/env node
/**
 * Zero-CL safe normalized_citation audit + optional backfill.
 * Usage: node script.cjs [--apply]
 * NO CourtListener. NO AI.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
const reports = path.join(__dirname, "..", "packages/research/corpus/reports");

function collapseWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

/** Minimal deterministic citation normalizer (mirrors research citations parsers). */
function parseCitation(raw) {
  const text = collapseWhitespace(raw || "");
  if (!text) return { normalized: null, reporter: null, volume: null, page: null, reason: "empty" };

  const us = text.match(/\b(\d{1,3})\s+U\.\s*S\.\s+(\d{1,4})\b/i);
  if (us) {
    return {
      normalized: `${us[1]} U.S. ${us[2]}`,
      reporter: "U.S.",
      volume: Number(us[1]),
      page: Number(us[2]),
      reason: null,
    };
  }

  const fsupp = text.match(/\b(\d{1,4})\s+F\.?\s*Supp\.?\s*(2d|3d|4th)?\s+(\d{1,4})\b/i);
  if (fsupp) {
    const series = fsupp[2] ? fsupp[2].toLowerCase() : "";
    const reporter = `F. Supp.${series ? ` ${series}` : ""}`;
    return {
      normalized: `${fsupp[1]} ${reporter} ${fsupp[3]}`.replace(/\s+/g, " ").trim(),
      reporter,
      volume: Number(fsupp[1]),
      page: Number(fsupp[3]),
      reason: null,
    };
  }

  const f = text.match(/\b(\d{1,4})\s+F\.?\s*(2d|3d|4th)\s+(\d{1,4})\b/i);
  if (f) {
    const series = f[2].toLowerCase();
    return {
      normalized: `${f[1]} F.${series} ${f[3]}`,
      reporter: `F.${series}`,
      volume: Number(f[1]),
      page: Number(f[3]),
      reason: null,
    };
  }

  const sct = text.match(/\b(\d{1,3})\s+S\.?\s*Ct\.?\s+(\d{1,4})\b/i);
  if (sct) {
    return {
      normalized: `${sct[1]} S. Ct. ${sct[2]}`,
      reporter: "S. Ct.",
      volume: Number(sct[1]),
      page: Number(sct[2]),
      reason: null,
    };
  }

  const led = text.match(/\b(\d{1,3})\s+L\.?\s*Ed\.?\s*(2d)?\s+(\d{1,4})\b/i);
  if (led) {
    const reporter = led[2] ? "L. Ed. 2d" : "L. Ed.";
    return {
      normalized: `${led[1]} ${reporter} ${led[3]}`,
      reporter,
      volume: Number(led[1]),
      page: Number(led[3]),
      reason: null,
    };
  }

  const a = text.match(/\b(\d{1,4})\s+A\.(?:\s?(2d|3d))\s+(\d{1,4})\b/i);
  if (a) {
    return {
      normalized: `${a[1]} A.${a[2].toLowerCase()} ${a[3]}`,
      reporter: `A.${a[2].toLowerCase()}`,
      volume: Number(a[1]),
      page: Number(a[3]),
      reason: null,
    };
  }

  // Common regional reporters (spacing-tolerant)
  const regional = text.match(
    /\b(\d{1,4})\s+((?:N\.?\s*E\.?|N\.?\s*W\.?|S\.?\s*E\.?|S\.?\s*W\.?|P\.?|So\.?|Cal\.?\s*Rptr\.?|N\.?\s*Y\.?\s*S\.?)\s*(?:2d|3d)?)\s+(\d{1,4})\b/i,
  );
  if (regional) {
    // Keep as unsupported for mutation unless we have a canonical formatter already —
    // classify PARSER_UNSUPPORTED for regional if not already covered above.
    return {
      normalized: null,
      reporter: collapseWhitespace(regional[2]),
      volume: Number(regional[1]),
      page: Number(regional[3]),
      reason: "PARSER_UNSUPPORTED",
      rawMatch: regional[0],
    };
  }

  return { normalized: null, reporter: null, volume: null, page: null, reason: "unparsed" };
}

function pickFromMetadata(meta) {
  if (!meta || typeof meta !== "object") return { raw: null, list: [], structured: null };
  const list = [];
  const candidates = [];

  const push = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) {
      for (const x of v) push(x);
      return;
    }
    if (typeof v === "string" && v.trim()) {
      list.push(v.trim());
      candidates.push(v.trim());
      return;
    }
    if (typeof v === "object") {
      if (typeof v.cite === "string") push(v.cite);
      if (typeof v.citation === "string") push(v.citation);
      if (typeof v.normalized === "string") push(v.normalized);
      if (v.volume != null && v.reporter && v.page != null) {
        return; // handled via structured below
      }
    }
  };

  for (const key of [
    "citation",
    "citations",
    "officialCitation",
    "official_citation",
    "reporterCitation",
    "reporter_citation",
    "clusterCitation",
    "cluster_citation",
    "lexisCitation",
    "westCitation",
    "neutralCitation",
    "cite",
    "cites",
  ]) {
    if (key in meta) push(meta[key]);
  }

  // nested provider payloads
  if (meta.courtlistener && typeof meta.courtlistener === "object") {
    push(meta.courtlistener.citation);
    push(meta.courtlistener.citations);
  }
  if (meta.source && typeof meta.source === "object") {
    push(meta.source.citation);
    push(meta.source.citations);
  }
  if (meta.cl && typeof meta.cl === "object") {
    push(meta.cl.citation);
    push(meta.cl.citations);
  }

  let structured = null;
  const vol = meta.volume ?? meta.reporter_volume ?? meta.vol;
  const page = meta.page ?? meta.first_page ?? meta.reporter_page ?? meta.start_page;
  const reporter = meta.reporter ?? meta.reporter_name ?? meta.reporterAbbrev;
  if (vol != null && page != null && reporter) {
    structured = {
      volume: Number(vol),
      page: Number(page),
      reporter: String(reporter),
    };
  }

  return { raw: candidates[0] || null, list: [...new Set(list)], structured };
}

function constructFromStructured(s) {
  if (!s || !Number.isFinite(s.volume) || !Number.isFinite(s.page) || !s.reporter) return null;
  const raw = `${s.volume} ${collapseWhitespace(s.reporter)} ${s.page}`;
  const parsed = parseCitation(raw);
  if (!parsed.normalized) return null;
  // round-trip: same volume/page
  if (parsed.volume !== s.volume || parsed.page !== s.page) return null;
  return parsed;
}

function classifyRow(row) {
  const citation = (row.citation || "").trim();
  const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata || {};
  const fromMeta = pickFromMetadata(meta);

  if (citation) {
    const parsed = parseCitation(citation);
    if (parsed.normalized) {
      return { bucket: "A_RAW_CITATION_NORMALIZABLE", candidate: parsed.normalized, source: "citation", parsed };
    }
    if (parsed.reason === "PARSER_UNSUPPORTED") {
      return { bucket: "H_PARSER_UNSUPPORTED_OR_NONSTANDARD", candidate: null, source: "citation", parsed };
    }
    return { bucket: "G_AMBIGUOUS_OR_UNPARSED_RAW", candidate: null, source: "citation", parsed };
  }

  if (fromMeta.raw) {
    const parsed = parseCitation(fromMeta.raw);
    if (parsed.normalized) {
      return {
        bucket: "E_SOURCE_METADATA_CITATION",
        candidate: parsed.normalized,
        source: "metadata",
        parsed,
        metaList: fromMeta.list,
      };
    }
  }

  // parallel: multiple distinct parseable cites
  const parseable = [];
  for (const c of fromMeta.list) {
    const p = parseCitation(c);
    if (p.normalized) parseable.push(p.normalized);
  }
  const uniq = [...new Set(parseable)];
  if (uniq.length > 1) {
    return {
      bucket: "D_AMBIGUOUS_PARALLEL",
      candidate: null,
      source: "metadata",
      parallels: uniq,
    };
  }
  if (uniq.length === 1) {
    return {
      bucket: "E_SOURCE_METADATA_CITATION",
      candidate: uniq[0],
      source: "metadata",
      parallels: uniq,
    };
  }

  if (fromMeta.structured) {
    const built = constructFromStructured(fromMeta.structured);
    if (built?.normalized) {
      return {
        bucket: "B_STRUCTURED_REPORTER_VOLUME_PAGE",
        candidate: built.normalized,
        source: "structured",
        parsed: built,
      };
    }
    return {
      bucket: "C_INSUFFICIENT_OR_FAILED_STRUCTURED",
      candidate: null,
      source: "structured",
      structured: fromMeta.structured,
    };
  }

  // metadata has citation-like keys but unusable
  if (fromMeta.list.length > 0) {
    return { bucket: "F_SOURCE_METADATA_GAP", candidate: null, source: "metadata", metaList: fromMeta.list };
  }

  return { bucket: "F_NO_CITATION_DATA", candidate: null, source: null };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const [counts] = await sql`
      select
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='case' and (normalized_citation is null or btrim(normalized_citation)=''))::int as missing_norm,
        count(*) filter (where authority_type='case' and normalized_citation is not null and btrim(normalized_citation)<>'')::int as has_norm
      from legal_authorities
    `;

    const missing = await sql`
      select id::text, citation, normalized_citation, title, source_provider, source_external_id,
             court, court_id, jurisdiction, decision_date::text, metadata, currentness_status
      from legal_authorities
      where authority_type='case'
        and (normalized_citation is null or btrim(normalized_citation)='')
    `;

    const buckets = {};
    const updates = [];
    const remainingReasons = {
      NO_CITATION_DATA: 0,
      INSUFFICIENT_REPORTER_FIELDS: 0,
      AMBIGUOUS_PARALLEL_CITATIONS: 0,
      NON_STANDARD_CITATION: 0,
      SOURCE_METADATA_GAP: 0,
      PARSER_UNSUPPORTED: 0,
      OTHER: 0,
    };

    for (const row of missing) {
      const c = classifyRow(row);
      buckets[c.bucket] = (buckets[c.bucket] || 0) + 1;

      if (c.candidate) {
        updates.push({ id: row.id, normalized: c.candidate, bucket: c.bucket, citation: row.citation });
      } else {
        switch (c.bucket) {
          case "F_NO_CITATION_DATA":
            remainingReasons.NO_CITATION_DATA += 1;
            break;
          case "C_INSUFFICIENT_OR_FAILED_STRUCTURED":
            remainingReasons.INSUFFICIENT_REPORTER_FIELDS += 1;
            break;
          case "D_AMBIGUOUS_PARALLEL":
            remainingReasons.AMBIGUOUS_PARALLEL_CITATIONS += 1;
            break;
          case "H_PARSER_UNSUPPORTED_OR_NONSTANDARD":
            remainingReasons.PARSER_UNSUPPORTED += 1;
            remainingReasons.NON_STANDARD_CITATION += 1;
            break;
          case "F_SOURCE_METADATA_GAP":
            remainingReasons.SOURCE_METADATA_GAP += 1;
            break;
          case "G_AMBIGUOUS_OR_UNPARSED_RAW":
            remainingReasons.OTHER += 1;
            break;
          default:
            remainingReasons.OTHER += 1;
        }
      }
    }

    // Sample metadata keys for gap analysis
    const metaKeyFreq = {};
    for (const row of missing.slice(0, 500)) {
      const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata || {};
      for (const k of Object.keys(meta || {})) metaKeyFreq[k] = (metaKeyFreq[k] || 0) + 1;
    }

    let applied = 0;
    let rejected = 0;
    const appliedSamples = [];
    if (APPLY && updates.length) {
      for (const u of updates) {
        // Round-trip validate again before write
        const again = parseCitation(u.normalized);
        if (!again.normalized || again.normalized !== u.normalized) {
          rejected += 1;
          continue;
        }
        // If citation column empty, also set citation to normalized (deterministic) — only when null
        const r = await sql`
          update legal_authorities
          set
            normalized_citation = ${u.normalized},
            citation = coalesce(nullif(btrim(citation), ''), ${u.normalized}),
            updated_at = now()
          where id = ${u.id}::uuid
            and authority_type = 'case'
            and (normalized_citation is null or btrim(normalized_citation) = '')
        `;
        if (r.count > 0) {
          applied += 1;
          if (appliedSamples.length < 10) appliedSamples.push(u);
        }
      }
    }

    const [after] = await sql`
      select
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='case' and (normalized_citation is null or btrim(normalized_citation)=''))::int as missing_norm,
        count(*) filter (where authority_type='case' and normalized_citation is not null and btrim(normalized_citation)<>'')::int as has_norm
      from legal_authorities
    `;

    const [dups] = await sql`
      select
        (select count(*)::int from (
          select source_provider, source_external_id from legal_authorities
          where source_provider is not null and source_external_id is not null
          group by 1,2 having count(*)>1
        ) d) as duplicates,
        (select count(*)::int from (
          select lower(btrim(normalized_citation)) from legal_authorities
          where authority_type='case' and normalized_citation is not null and btrim(normalized_citation)<>''
          group by 1 having count(*)>1
        ) c) as dup_norm_cites,
        (select count(*)::int from legal_authority_chunks c left join legal_authorities a on a.id=c.authority_id where a.id is null) as orphans,
        (select count(*)::int from legal_authority_chunks where embedding is null) as missing_embeddings,
        (select count(*)::int from (
          select from_authority_id, coalesce(normalized_citation, raw_citation), coalesce(to_authority_id::text,'')
          from legal_authority_citations group by 1,2,3 having count(*)>1
        ) e) as duplicate_citation_edges
    `;

    // Currentness unknown audit
    const unknownRows = await sql`
      select authority_type, count(*)::int as n,
        count(*) filter (where decision_date is not null)::int as with_decision,
        count(*) filter (where effective_date is not null)::int as with_effective,
        count(*) filter (where last_checked_at is not null)::int as with_checked
      from legal_authorities
      where currentness_status = 'unknown'
      group by 1
    `;
    const [unknownTotal] = await sql`
      select count(*)::int as n from legal_authorities where currentness_status='unknown'
    `;

    const out = {
      ok: true,
      classification: "ZERO_CL_NORMALIZED_CITATION_BACKFILL",
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: 0,
      aiCalls: 0,
      apply: APPLY,
      starting: counts,
      buckets,
      safeCandidates: updates.length,
      applied,
      rejected,
      appliedSamples,
      after,
      coveragePct: after.cases ? Number(((after.has_norm / after.cases) * 100).toFixed(2)) : 0,
      remainingReasons: APPLY
        ? null
        : remainingReasons,
      remainingReasonsNote: APPLY
        ? "recompute after apply via ending missing classify"
        : "pre-apply remaining among non-candidates",
      integrity: dups,
      metaKeyFreqTop: Object.entries(metaKeyFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25),
      currentnessUnknown: { total: unknownTotal.n, byType: unknownRows },
    };

    try {
      fs.mkdirSync(reports, { recursive: true });
      fs.writeFileSync(
        path.join(reports, "queue2-normalized-citation-backfill.json"),
        JSON.stringify(out, null, 2),
      );
    } catch (_) {}
    console.log(JSON.stringify(out));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, err: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
