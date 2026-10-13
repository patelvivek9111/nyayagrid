/**
 * Read-only stratified sample of unresolved citation targets for bulk prototype.
 * NO CourtListener API. NO production writes.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");
const {
  buildUnresolvedTargetQueue,
  LocalAuthorityIndex,
  experimentalNormalize,
  parseVolReporterPage,
  classifyCaseCitationLookupEligibility,
  targetKey,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const OUT = path.join(__dirname, "../packages/research/corpus/tmp-bulk-prototype/stratified-sample-2026-10-13.json");

function isScotus(t) {
  const r = String(t.reporter || t.normalizedCitation || "");
  return /\bU\.S\.|\bS\.\s*Ct|\bL\.\s*Ed|Wall|How|Cranch|Pet\.|Wheat|Dallas/i.test(r);
}
function isFederal(t) {
  const r = String(t.reporter || t.normalizedCitation || "");
  return /\bF\.(?:2d|3d|4th)|F\.\s*Supp|Fed\.\s*Cl|U\.S\.|\bS\.\s*Ct/i.test(r);
}
function isState(t) {
  const r = String(t.reporter || t.normalizedCitation || "");
  return /\bA\.(?:2d|3d)|N\.E\.|N\.W\.|S\.E\.|S\.W\.|P\.(?:2d|3d)|Cal\.|N\.Y\.|Pa\.|Ill\.|Mass\.|Tex\./i.test(r);
}
function yearish(t) {
  const m = String(t.normalizedCitation || "").match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "need Neon DATABASE_URL" }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  try {
    await sql.unsafe("BEGIN READ ONLY");
    const unresolved = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    const authorityRows = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider,
             title, court, court_id, decision_date, ingestion_status
      from legal_authorities
    `;
    await sql.unsafe("COMMIT");

    const index = new LocalAuthorityIndex(
      authorityRows.map((a) => ({
        id: a.id,
        citation: a.citation,
        normalizedCitation: a.normalized_citation,
        metadata: a.metadata || {},
        sourceExternalId: a.source_external_id,
        sourceProvider: a.source_provider,
        title: a.title,
        court: a.court,
        courtId: a.court_id,
        decisionDate: a.decision_date,
        ingestionStatus: a.ingestion_status,
        corpusComplete: false,
      })),
    );

    const queue = buildUnresolvedTargetQueue(
      unresolved.map((e) => ({
        id: e.id,
        fromAuthorityId: e.from_authority_id,
        rawCitation: e.raw_citation,
        normalizedCitation: e.normalized_citation,
        createdAt: e.created_at,
        fromCourtId: e.from_court_id,
        fromCourt: e.from_court,
      })),
      index,
    );

    const noLocal = queue.targets.filter((t) => t.localCandidateStatus === "NO_LOCAL_MATCH");
    const byBucket = {
      ge10: noLocal.filter((t) => t.edgeCount >= 10),
      ge5to9: noLocal.filter((t) => t.edgeCount >= 5 && t.edgeCount <= 9),
      e4: noLocal.filter((t) => t.edgeCount === 4),
      e3: noLocal.filter((t) => t.edgeCount === 3),
      e2: noLocal.filter((t) => t.edgeCount === 2),
      e1: noLocal.filter((t) => t.edgeCount === 1),
    };

    function take(arr, n) {
      // prefer eligible case citations first, then mix
      const eligible = arr.filter((t) => classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation).eligible);
      const ineligible = arr.filter((t) => !classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation).eligible);
      const out = [];
      for (const a of [eligible, ineligible]) {
        for (const t of a) {
          if (out.length >= n) break;
          out.push(t);
        }
      }
      return out;
    }

    // Stratified quotas totaling ~400
    const picked = [
      ...take(byBucket.ge10, 40),
      ...take(byBucket.ge5to9, 80),
      ...take(byBucket.e4, 70),
      ...take(byBucket.e3, 70),
      ...take(byBucket.e2, 70),
      ...take(byBucket.e1, 70),
    ];

    // Ensure reporter diversity patches
    const needScotus = 25 - picked.filter(isScotus).length;
    if (needScotus > 0) {
      for (const t of noLocal.filter(isScotus)) {
        if (picked.some((p) => p.targetKey === t.targetKey)) continue;
        picked.push(t);
        if (picked.filter(isScotus).length >= 25) break;
      }
    }
    const needState = 40 - picked.filter(isState).length;
    if (needState > 0) {
      for (const t of noLocal.filter(isState)) {
        if (picked.some((p) => p.targetKey === t.targetKey)) continue;
        picked.push(t);
        if (picked.filter(isState).length >= 40) break;
      }
    }

    // Dedup
    const seen = new Set();
    const sample = [];
    for (const t of picked) {
      if (seen.has(t.targetKey)) continue;
      seen.add(t.targetKey);
      const p = parseVolReporterPage(t.normalizedCitation);
      const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
      sample.push({
        targetKey: t.targetKey,
        raw: t.representativeRaw,
        normalized: t.normalizedCitation,
        edgeCount: t.edgeCount,
        uniqueCitingCases: t.uniqueCitingCases,
        jurisdictions: t.jurisdictions,
        reporter: t.reporter,
        volume: t.volume,
        page: t.page,
        vrp: p ? { volume: p.volume, reporter: p.reporter, page: p.page, family: p.family } : null,
        eligible: el.eligible,
        eligibilityLane: el.lane,
        flags: {
          scotus: isScotus(t),
          federal: isFederal(t),
          state: isState(t),
          year: yearish(t),
          historical: (yearish(t) || 9999) < 1950 || (p && p.volume < 100 && /U\.S\.|F\./i.test(p.reporter || "")),
          recent: (yearish(t) || 0) >= 2000,
        },
      });
    }

    const stats = {
      sampleSize: sample.length,
      ge10: sample.filter((t) => t.edgeCount >= 10).length,
      ge5to9: sample.filter((t) => t.edgeCount >= 5 && t.edgeCount <= 9).length,
      e4: sample.filter((t) => t.edgeCount === 4).length,
      e3: sample.filter((t) => t.edgeCount === 3).length,
      e2: sample.filter((t) => t.edgeCount === 2).length,
      e1: sample.filter((t) => t.edgeCount === 1).length,
      federal: sample.filter((t) => t.flags.federal).length,
      state: sample.filter((t) => t.flags.state).length,
      scotus: sample.filter((t) => t.flags.scotus).length,
      historical: sample.filter((t) => t.flags.historical).length,
      recent: sample.filter((t) => t.flags.recent).length,
      eligible: sample.filter((t) => t.eligible).length,
      ineligible: sample.filter((t) => !t.eligible).length,
      withVrp: sample.filter((t) => t.vrp).length,
      backlog: {
        uniqueTargets: queue.uniqueTargets,
        unresolvedEdges: queue.unresolvedEdges,
        noLocal: noLocal.length,
      },
    };

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), stats, sample }, null, 2));
    console.log(JSON.stringify({ ok: true, out: OUT, stats }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
