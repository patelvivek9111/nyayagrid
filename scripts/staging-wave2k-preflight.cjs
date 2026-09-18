/**
 * Wave 2K preflight: unknown-currentness buckets + regulation depth audit.
 * No CourtListener HTTP.
 */
"use strict";

const postgres = require("postgres");

const REG_SUBJECTS = [
  "employment",
  "consumer",
  "business",
  "licensing",
  "privacy",
  "administrative",
  "housing",
];

function mapTopicToFamily(topic, areas) {
  const blob = `${topic || ""} ${(areas || []).join(" ")}`.toLowerCase();
  if (/employ|wage|overtime|labor|child.?labor|unemploy|payday|meal|rest/.test(blob)) return "employment";
  if (/consumer|unfair|deceptive|advertis|real.?estate.?advert/.test(blob)) return "consumer";
  if (/business|commercial|corporat|contractor|agriculture|food.?service/.test(blob)) return "business";
  if (/licens|professional|unprofessional|occupational/.test(blob)) return "licensing";
  if (/privacy|data|breach|shield|personal.?info/.test(blob)) return "privacy";
  if (/admin|apa|petition|complaint|procedure|jurisdiction|definition/.test(blob)) return "administrative";
  if (/hous|landlord|tenant|rent|property/.test(blob)) return "housing";
  return null;
}

function classifyUnknown(row) {
  const meta = row.metadata || {};
  const provider = String(row.source_provider || "").toLowerCase();
  const type = row.authority_type;

  if (provider.includes("courtlistener") || meta.courtListener || meta.clOpinionId || meta.clClusterId) {
    return "C_CL_related";
  }
  if (type === "case") {
    return "B_historical_case";
  }
  // Missing provider/external id while ingested → metadata bug
  if (!row.source_provider || !row.source_external_id) {
    return "F_missing_metadata_bug";
  }
  const retrievedAt = meta.retrievedAt || meta.sourceRetrievedAt || meta.bundleRetrievedAt;
  const editionDate = meta.sourceDate || meta.editionDate || meta.revisionDate || meta.officialPublishedAt;
  if (retrievedAt || editionDate || meta.sourceAssertsCurrent) {
    return "A_source_supports_recheck";
  }
  if (meta.retrievalMethod === "manual" || meta.manualSource || provider === "manual") {
    return "E_manual_source";
  }
  // Curated official snapshots without revision signal
  if (provider === "us-primary-corpus" || meta.retrievalMethod === "official_regulation_snapshot") {
    // If they have retrievedAt they would be A; otherwise D
    return "D_source_no_revision_metadata";
  }
  return "D_source_no_revision_metadata";
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const totals = await sql`
      select count(*)::int as total,
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='statute')::int as statutes,
        count(*) filter (where authority_type='regulation')::int as regulations,
        count(*) filter (where authority_type='rule')::int as rules,
        count(*) filter (where currentness_status='unknown' or currentness_status is null)::int as unknown,
        count(*) filter (where last_checked_at is not null)::int as last_checked,
        count(*) filter (where canonical_source_url is not null and btrim(canonical_source_url)<>'')::int as with_url,
        count(*) filter (where source_provider is not null and source_external_id is not null)::int as provenance
      from legal_authorities
    `;

    const unknowns = await sql`
      select id, authority_type, authority_state, jurisdiction, source_provider, source_external_id,
             currentness_status, last_checked_at, metadata, decision_date, effective_date
      from legal_authorities
      where currentness_status = 'unknown' or currentness_status is null
    `;

    const buckets = { A_source_supports_recheck: 0, B_historical_case: 0, C_CL_related: 0, D_source_no_revision_metadata: 0, E_manual_source: 0, F_missing_metadata_bug: 0 };
    const byType = {};
    const byState = {};
    const byFamily = {};
    const aIds = [];
    const bIds = [];

    for (const row of unknowns) {
      const bucket = classifyUnknown(row);
      buckets[bucket] += 1;
      byType[row.authority_type] = (byType[row.authority_type] || 0) + 1;
      const st = row.authority_state || "US_OR_NULL";
      byState[st] = (byState[st] || 0) + 1;
      const fam = String(row.source_provider || "unknown");
      byFamily[fam] = (byFamily[fam] || 0) + 1;
      if (bucket === "A_source_supports_recheck") aIds.push(row.id);
      if (bucket === "B_historical_case") bIds.push(row.id);
    }

    const regs = await sql`
      select id, authority_state, citation, normalized_citation, source_provider, currentness_status, metadata, canonical_source_url
      from legal_authorities
      where authority_type = 'regulation'
    `;

    const byRegState = {};
    for (const r of regs) {
      const st = r.authority_state || "US";
      if (!byRegState[st]) {
        byRegState[st] = { count: 0, subjects: new Set(), sourceFamilies: new Set(), withCurrent: 0, withUrl: 0 };
      }
      byRegState[st].count += 1;
      const meta = r.metadata || {};
      const fam = mapTopicToFamily(meta.statuteTopic, meta.bundlePracticeAreas || []);
      if (fam) byRegState[st].subjects.add(fam);
      for (const a of meta.bundlePracticeAreas || []) {
        const f2 = mapTopicToFamily(a, []);
        if (f2) byRegState[st].subjects.add(f2);
      }
      byRegState[st].sourceFamilies.add(r.source_provider || "unknown");
      if (r.currentness_status && r.currentness_status !== "unknown") byRegState[st].withCurrent += 1;
      if (r.canonical_source_url) byRegState[st].withUrl += 1;
    }

    const regDepth = {};
    for (const [st, v] of Object.entries(byRegState)) {
      const subjects = [...v.subjects].sort();
      let depth = "REG_DEPTH_MINIMAL";
      if (subjects.length >= 4 && v.count >= 5) depth = "REG_DEPTH_GOOD";
      else if (subjects.length >= 2 || v.count >= 4) depth = "REG_DEPTH_PARTIAL";
      regDepth[st] = {
        count: v.count,
        subjects,
        subjectCount: subjects.length,
        sourceFamilies: [...v.sourceFamilies],
        currentnessSupport: v.withCurrent,
        urlSupport: v.withUrl,
        depth,
      };
    }

    const out = {
      ok: true,
      wave: "2K-pre",
      totals: totals[0],
      unknownBuckets: buckets,
      unknownByType: byType,
      unknownByStateTop: Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 20),
      unknownBySourceFamily: byFamily,
      aRecheckCount: aIds.length,
      bHistoricalCount: bIds.length,
      aSampleIds: aIds.slice(0, 20),
      bSampleIds: bIds.slice(0, 20),
      regJurisdictions: Object.keys(regDepth).length,
      regDepth,
      minimal: Object.entries(regDepth).filter(([, v]) => v.depth === "REG_DEPTH_MINIMAL").map(([k]) => k),
      partial: Object.entries(regDepth).filter(([, v]) => v.depth === "REG_DEPTH_PARTIAL").map(([k]) => k),
      good: Object.entries(regDepth).filter(([, v]) => v.depth === "REG_DEPTH_GOOD").map(([k]) => k),
    };
    process.stdout.write(JSON.stringify(out));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, err: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
