/**
 * Stratified sample audit of unresolved citation edges.
 * ZERO CourtListener. ZERO mutations.
 * Sample >=100 unresolved edges across reporter families.
 */
"use strict";
const postgres = require("postgres");
const fs = require("fs");
const path = require("path");

const SAMPLE_TARGET = Number(process.env.DENOM_SAMPLE_TARGET || 1000);
const PER_STRATUM = Number(process.env.DENOM_PER_STRATUM || 120);

const STRATA = [
  { key: "U.S.", re: /\b\d+\s+U\.?\s*S\.?\s+\d+/i },
  { key: "F.3d", re: /\b\d+\s+F\.\s*3d\s+\d+/i },
  { key: "F.2d", re: /\b\d+\s+F\.\s*2d\s+\d+/i },
  { key: "F.4th", re: /\b\d+\s+F\.\s*4th\s+\d+/i },
  { key: "F.Supp", re: /\b\d+\s+F\.\s*Supp/i },
  { key: "USC", re: /\b\d+\s+U\.?\s*S\.?\s*C\.?/i },
  { key: "CFR", re: /\b\d+\s+C\.?\s*F\.?\s*R\.?/i },
  { key: "FederalRules", re: /\bFed\.\s*R\./i },
  { key: "unusual", re: null },
];

function classify(norm, raw, isDefect) {
  if (isDefect) return "VALID_PRESENT_UNRESOLVED_DEFECT";
  const n = String(norm || "").trim();
  if (!n || n.length < 3) return "MALFORMED";
  if (/^[\d\s.,;:]+$/.test(n)) return "MALFORMED";
  if (/\?\?\?|FIXME|TODO|lorem/i.test(n)) return "MALFORMED";
  if (n.length > 180) return "MALFORMED";
  if (/\b(WL|LEXIS|Westlaw|Google Scholar)\b/i.test(n)) return "OUT_OF_SCOPE";
  if (/\b(Restatement|Am\.\s*Jur|C\.J\.S\.|ALR|Law Review|L\.\s*Rev\.)\b/i.test(n)) return "UNSUPPORTED_TYPE";
  if (/\b(Treatise|Hornbook|Black'?s Law)\b/i.test(n)) return "UNSUPPORTED_TYPE";
  if (/\b(U\.N\.|I\.C\.J\.|E\.C\.H\.R\.)\b/i.test(n)) return "OUT_OF_SCOPE";
  if (/\band\b.+\bv\./i.test(n) && n.split(/\d+/).length > 6) return "AMBIGUOUS";
  if (/^\d+\s+[A-Za-z.\s]+$/.test(n) && !/\d+$/.test(n) && !/section/i.test(n)) return "AMBIGUOUS";
  if (/\bS\.\s*Ct\.\b/i.test(n) && !/\bU\.?\s*S\.?\s+\d+/i.test(n)) return "SOURCE_UNAVAILABLE";
  if (/\bL\.\s*Ed\.?\s*(2d)?\b/i.test(n) && !/\bU\.?\s*S\.?\s+\d+/i.test(n)) return "SOURCE_UNAVAILABLE";
  // Well-formed primary families with local-absent evidence only.
  if (/\b\d+\s+U\.?\s*S\.?\s+\d+/i.test(n)) return "VALID_TARGET_ABSENT";
  if (/\b\d+\s+F\.\s*(2d|3d|4th)\s+\d+/i.test(n)) return "VALID_TARGET_ABSENT";
  if (/\b\d+\s+F\.\s*Supp/i.test(n)) return "VALID_TARGET_ABSENT";
  if (/\b\d+\s+U\.?\s*S\.?\s*C\.?/i.test(n)) return "VALID_TARGET_ABSENT";
  if (/\b\d+\s+C\.?\s*F\.?\s*R\.?/i.test(n)) return "VALID_TARGET_ABSENT";
  if (/\bFed\.\s*R\./i.test(n)) return "VALID_TARGET_ABSENT";
  if (/\b\d+\s+[A-Z][a-z]+\.?\s*(2d|3d)?\s+\d+/i.test(n)) return "VALID_TARGET_ABSENT";
  // Do not guess — insufficient local parser evidence.
  if (/\d/.test(n) && /[A-Za-z]/.test(n) && n.length >= 6) {
    return "UNKNOWN_REQUIRES_EXTERNAL_VERIFICATION";
  }
  return "AMBIGUOUS";
}

function stratumOf(norm) {
  const n = String(norm || "");
  for (const s of STRATA) {
    if (s.key === "unusual") continue;
    if (s.re.test(n)) return s.key;
  }
  return "unusual";
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_db" }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const defects = await sql`
      select e.id
      from legal_authority_citations e
      join legal_authorities a
        on e.to_authority_id is null
       and e.normalized_citation is not null
       and length(e.normalized_citation) > 4
       and (a.normalized_citation = e.normalized_citation or a.citation = e.normalized_citation)
      limit 50000
    `;
    const defectIds = new Set(defects.map((d) => d.id));

    const unresolved = await sql`
      select id, normalized_citation, raw_citation
      from legal_authority_citations
      where to_authority_id is null
      order by id
    `;

    const byStratum = Object.fromEntries(STRATA.map((s) => [s.key, []]));
    for (const e of unresolved) {
      const k = stratumOf(e.normalized_citation || e.raw_citation);
      byStratum[k].push(e);
    }

    const sample = [];
    const stratumCounts = {};
    for (const s of STRATA) {
      const pool = byStratum[s.key] || [];
      // deterministic every-Nth sample
      const take = Math.min(PER_STRATUM, pool.length);
      const step = pool.length > take ? Math.floor(pool.length / take) : 1;
      const picked = [];
      for (let i = 0; i < pool.length && picked.length < take; i += step) picked.push(pool[i]);
      stratumCounts[s.key] = { pool: pool.length, sampled: picked.length };
      for (const e of picked) sample.push({ ...e, stratum: s.key });
    }

    // top up to SAMPLE_TARGET from largest remaining pools
    if (sample.length < SAMPLE_TARGET) {
      const used = new Set(sample.map((e) => e.id));
      const rest = unresolved.filter((e) => !used.has(e.id));
      const need = SAMPLE_TARGET - sample.length;
      const step = rest.length > need ? Math.floor(rest.length / need) : 1;
      for (let i = 0; i < rest.length && sample.length < SAMPLE_TARGET; i += step) {
        sample.push({ ...rest[i], stratum: stratumOf(rest[i].normalized_citation || rest[i].raw_citation) });
      }
    }

    const counts = {
      VALID_TARGET_ABSENT: 0,
      VALID_PRESENT_RESOLVED: 0,
      VALID_PRESENT_UNRESOLVED_DEFECT: 0,
      AMBIGUOUS: 0,
      MALFORMED: 0,
      OUT_OF_SCOPE: 0,
      UNSUPPORTED_TYPE: 0,
      SOURCE_UNAVAILABLE: 0,
      UNKNOWN_REQUIRES_EXTERNAL_VERIFICATION: 0,
    };
    const rows = [];
    for (const e of sample) {
      const cls = classify(e.normalized_citation, e.raw_citation, defectIds.has(e.id));
      counts[cls] += 1;
      rows.push({
        id: e.id,
        stratum: e.stratum,
        class: cls,
        citation: String(e.normalized_citation || e.raw_citation || "").slice(0, 100),
      });
    }

    const n = sample.length;
    const proportions = Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, n ? Number(((v / n) * 100).toFixed(1)) : 0]),
    );

    const out = {
      ok: true,
      classification: "MANUAL_QUEUE2_S3_CITATION_DENOMINATOR_SAMPLE_AUDIT",
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: 0,
      mutations: 0,
      methodology:
        "Stratified deterministic sample of unresolved citation edges across reporter families; heuristic classification only. Proportions are SAMPLE proportions, not extrapolated population ground truth.",
      sampleSize: n,
      unresolvedUniverse: unresolved.length,
      stratumCounts,
      counts,
      proportionsPct: proportions,
      validTargetAbsentShareOfSamplePct: proportions.VALID_TARGET_ABSENT,
      note:
        "Do not treat sample proportions as population ground truth. If VALID_TARGET_ABSENT dominates the sample, raw denominator is directionally similar to valid denominator for primary-family cites.",
      sampleRows: rows,
    };

    const reportPath =
      process.env.DENOM_SAMPLE_OUT ||
      (process.platform === "win32"
        ? path.join(__dirname, "..", "packages/research/corpus/reports/queue2-s3-citation-denominator-sample.json")
        : "/tmp/queue2-s3-citation-denominator-sample.json");
    try {
      fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));
    } catch {
      /* stdout is authoritative */
    }
    console.log(JSON.stringify(out));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 400) }));
  process.exit(1);
});
