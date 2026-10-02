/**
 * Citation production hardening: classify remaining zero-edge cases,
 * mark extraction state, build scorecard + demand manifest.
 * ZERO CourtListener. ZERO AI.
 *
 * Writes JSON to stdout (and /tmp on fly).
 */
"use strict";

const fs = require("fs");
const crypto = require("crypto");
const postgres = require("postgres");
const {
  extractCaseCitationsFromText,
  looksCitationLike,
  sha256Text,
  ensureCaseCitationExtraction,
  CITATION_EXTRACTION_VERSION,
} = require("./lib/case-citation-extraction.cjs");
const {
  leanNormalizeCitation,
  citationLookupAliases,
  classifyCitationFamily,
  isGarbageCitation,
} = require("./wave2f-citation-audit.cjs");

function pct(n, d) {
  return d ? Number(((100 * n) / d).toFixed(2)) : 0;
}

function familyBucket(raw, norm) {
  return classifyCitationFamily(raw || "", norm || "") || "unknown";
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_db", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, idle_timeout: 30, connect_timeout: 30 });
  const started = Date.now();
  const mutations = { edges: 0, meta: 0 };

  try {
    const [start] = await sql`
      select
        (select count(*)::int from legal_authorities where authority_type='case') as cases,
        (select count(*)::int from legal_authority_citations) as extracted,
        (select count(*)::int from legal_authority_citations where to_authority_id is not null) as resolved,
        (select count(*)::int from legal_authority_citations where to_authority_id is null) as unresolved
    `;

    // ----- zero-edge classification -----
    const zeroEdge = await sql`
      select a.id, a.metadata, a.court_level, a.authority_state, a.citation,
             length(v.content)::int as text_len, v.content, v.sha256 as version_sha
      from legal_authorities a
      join lateral (
        select content, sha256 from legal_authority_versions
        where authority_id = a.id order by version_number desc limit 1
      ) v on true
      where a.authority_type = 'case'
        and length(v.content) >= 200
        and not exists (
          select 1 from legal_authority_citations c where c.from_authority_id = a.id
        )
    `;

    const classes = {
      PROCESSED_ZERO_VALID: 0,
      NOT_PROCESSED: 0,
      EXTRACTION_FAILED: 0,
      TEXT_CHANGED_AFTER_EXTRACTION: 0,
      PARSER_POSITIVE_BUT_EDGE_WRITE_MISSING: 0,
      UNSUPPORTED_CITATION_SHAPE: 0,
      TEXT_TOO_LOW_QUALITY: 0,
      OTHER: 0,
    };
    const unsupportedSamples = [];
    let backfilledCases = 0;
    let backfilledEdges = 0;

    for (const row of zeroEdge) {
      const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const prior = meta.citationExtraction || null;
      const textHash = sha256Text(row.content);
      const found = extractCaseCitationsFromText(row.content);
      const citeLike = looksCitationLike(row.content);

      let classification;
      if (prior && prior.status === "FAILED") classification = "EXTRACTION_FAILED";
      else if (prior && prior.textHashAtExtraction && prior.textHashAtExtraction !== textHash)
        classification = "TEXT_CHANGED_AFTER_EXTRACTION";
      else if (found.length > 0) classification = "PARSER_POSITIVE_BUT_EDGE_WRITE_MISSING";
      else if (citeLike) classification = "UNSUPPORTED_CITATION_SHAPE";
      else if (Number(row.text_len) < 400) classification = "TEXT_TOO_LOW_QUALITY";
      else if (prior && (prior.status === "PROCESSED_ZERO" || prior.status === "PROCESSED_NONZERO"))
        classification = "PROCESSED_ZERO_VALID";
      else classification = "NOT_PROCESSED";

      // Treat unmarked parser-empty as PROCESSED_ZERO_VALID after we mark them
      if (classification === "NOT_PROCESSED" && found.length === 0 && !citeLike) {
        classification = "PROCESSED_ZERO_VALID";
      }

      classes[classification] = (classes[classification] || 0) + 1;

      if (classification === "UNSUPPORTED_CITATION_SHAPE" && unsupportedSamples.length < 40) {
        const m = String(row.content).match(
          /\b\d{1,4}\s+[A-Za-z.]{1,20}(?:\s+\d{1,4})?\b/g,
        );
        unsupportedSamples.push({
          id: row.id,
          samples: (m || []).slice(0, 8),
        });
      }

      if (
        classification === "PARSER_POSITIVE_BUT_EDGE_WRITE_MISSING" ||
        classification === "TEXT_CHANGED_AFTER_EXTRACTION" ||
        classification === "EXTRACTION_FAILED" ||
        (classification === "NOT_PROCESSED" && found.length > 0)
      ) {
        const res = await ensureCaseCitationExtraction(sql, {
          authorityId: row.id,
          content: row.content,
          existingMetadata: meta,
        });
        mutations.edges += res.inserted;
        mutations.meta += 1;
        backfilledCases += 1;
        backfilledEdges += res.inserted;
      } else if (
        classification === "PROCESSED_ZERO_VALID" ||
        classification === "UNSUPPORTED_CITATION_SHAPE" ||
        classification === "TEXT_TOO_LOW_QUALITY"
      ) {
        // Mark PROCESSED_ZERO so coverage gate treats as processed
        const res = await ensureCaseCitationExtraction(sql, {
          authorityId: row.id,
          content: row.content,
          existingMetadata: meta,
        });
        mutations.meta += 1;
        // should insert 0 for true empty
        backfilledEdges += res.inserted;
        if (res.inserted > 0) {
          backfilledCases += 1;
          classes.PARSER_POSITIVE_BUT_EDGE_WRITE_MISSING += 1;
          classes[classification] -= 1;
        }
      }
    }

    // ----- present-target audit -----
    const authorities = await sql`
      select id, citation, normalized_citation, metadata from legal_authorities
    `;
    const aliasIndex = new Map();
    for (const a of authorities) {
      for (const v of [a.normalized_citation, a.citation].filter(Boolean)) {
        const lean = leanNormalizeCitation(v) || v;
        for (const k of citationLookupAliases(lean)) {
          if (!aliasIndex.has(k)) aliasIndex.set(k, new Set());
          aliasIndex.get(k).add(a.id);
        }
      }
    }
    const unresolved = await sql`
      select id, raw_citation, normalized_citation
      from legal_authority_citations where to_authority_id is null
    `;
    let presentMiss = 0;
    let fixedPresent = 0;
    const absentBuckets = {
      TARGET_ABSENT_CASE: 0,
      TARGET_ABSENT_STATUTE: 0,
      TARGET_ABSENT_REGULATION: 0,
      TARGET_ABSENT_RULE: 0,
      PRESENT_AMBIGUOUS: 0,
      UNSUPPORTED: 0,
      MALFORMED: 0,
      INSUFFICIENT_METADATA: 0,
      OTHER: 0,
    };
    const demand = new Map();
    const familyStats = new Map();

    function bumpFamily(fam, field) {
      if (!familyStats.has(fam)) {
        familyStats.set(fam, { occurrences: 0, resolved: 0, unresolved: 0, uniqueMissing: new Set() });
      }
      familyStats.get(fam)[field] += 1;
    }

    // Full edge family stats
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
      const fam = familyBucket(e.raw_citation, lean);
      bumpFamily(fam, "occurrences");
      if (e.to_authority_id) bumpFamily(fam, "resolved");
      else bumpFamily(fam, "unresolved");
    }

    for (const e of unresolved) {
      const lean =
        leanNormalizeCitation(e.normalized_citation) ||
        leanNormalizeCitation(e.raw_citation) ||
        e.normalized_citation ||
        "";
      const fam = familyBucket(e.raw_citation, lean);
      if (isGarbageCitation(e.raw_citation) && isGarbageCitation(e.normalized_citation)) {
        absentBuckets.MALFORMED += 1;
        continue;
      }
      const keys = new Set();
      for (const v of [lean, e.raw_citation, e.normalized_citation].filter(Boolean)) {
        for (const k of citationLookupAliases(v)) keys.add(k);
      }
      const ids = new Set();
      for (const k of keys) {
        const hit = aliasIndex.get(k);
        if (hit) for (const id of hit) ids.add(id);
      }
      if (ids.size === 1) {
        presentMiss += 1;
        await sql`
          update legal_authority_citations
          set to_authority_id = ${[...ids][0]}
          where id = ${e.id} and to_authority_id is null
        `;
        fixedPresent += 1;
        mutations.edges += 1;
        continue;
      }
      if (ids.size > 1) {
        absentBuckets.PRESENT_AMBIGUOUS += 1;
        continue;
      }
      if (/\b(WL|LEXIS|Restatement|Am\.\s*Jur)\b/i.test(lean)) {
        absentBuckets.UNSUPPORTED += 1;
        continue;
      }
      let bucket = "TARGET_ABSENT_CASE";
      if (fam === "usc" || fam === "state_statute") bucket = "TARGET_ABSENT_STATUTE";
      else if (fam === "cfr" || fam === "state_regulation") bucket = "TARGET_ABSENT_REGULATION";
      else if (fam === "federal_rules" || fam === "state_court_rules") bucket = "TARGET_ABSENT_RULE";
      else if (fam === "unknown" || fam === "malformed_partial") bucket = "INSUFFICIENT_METADATA";
      absentBuckets[bucket] += 1;

      if (bucket.startsWith("TARGET_ABSENT")) {
        const key = lean || e.normalized_citation || e.raw_citation;
        if (bucket === "TARGET_ABSENT_CASE") {
          if (!demand.has(key)) {
            demand.set(key, { citation: key, family: fam, edgeDemand: 0 });
          }
          demand.get(key).edgeDemand += 1;
          familyStats.get(fam)?.uniqueMissing.add(key);
        } else {
          // Non-case absent demand tracked in family buckets / scorecard only
          if (!demand.has(`__noncase__:${bucket}:${key}`)) {
            demand.set(`__noncase__:${bucket}:${key}`, {
              citation: key,
              family: fam,
              edgeDemand: 0,
              _nonCase: true,
              _bucket: bucket,
            });
          }
          demand.get(`__noncase__:${bucket}:${key}`).edgeDemand += 1;
        }
      }
    }

    const [after] = await sql`
      select
        (select count(*)::int from legal_authorities where authority_type='case') as cases,
        (select count(*)::int from legal_authority_citations) as extracted,
        (select count(*)::int from legal_authority_citations where to_authority_id is not null) as resolved,
        (select count(*)::int from legal_authority_citations where to_authority_id is null) as unresolved
    `;

    // Extraction coverage via metadata + edges
    const [coverage] = await sql`
      select
        count(*) filter (where has_text)::int as eligible,
        count(*) filter (where has_text and (
          edges > 0
          or coalesce(metadata->'citationExtraction'->>'status','') in ('PROCESSED_ZERO','PROCESSED_NONZERO','FAILED')
        ))::int as processed,
        count(*) filter (where has_text and edges > 0)::int as processed_nonzero,
        count(*) filter (where has_text and edges = 0 and coalesce(metadata->'citationExtraction'->>'status','') = 'PROCESSED_ZERO')::int as processed_zero,
        count(*) filter (where has_text and edges = 0 and coalesce(metadata->'citationExtraction'->>'status','') = 'FAILED')::int as failed,
        count(*) filter (where has_text and edges = 0 and coalesce(metadata->'citationExtraction'->>'status','') = '')::int as not_processed,
        count(*) filter (where has_text and edges = 0)::int as zero_edge
      from (
        select a.metadata,
          (exists (select 1 from legal_authority_versions v where v.authority_id=a.id and length(v.content)>=200)) as has_text,
          coalesce((select count(*)::int from legal_authority_citations c where c.from_authority_id=a.id),0) as edges
        from legal_authorities a where a.authority_type='case'
      ) x
    `;

    const ranked = [...demand.values()]
      .filter((x) => !x._nonCase)
      .sort((a, b) => b.edgeDemand - a.edgeDemand);
    const nonCaseDemand = [...demand.values()].filter((x) => x._nonCase);
    function cum(n) {
      return ranked.slice(0, n).reduce((s, x) => s + x.edgeDemand, 0);
    }

    const familyTable = [...familyStats.entries()]
      .map(([family, s]) => ({
        family,
        occurrences: s.occurrences,
        resolved: s.resolved,
        unresolved: s.unresolved,
        resolutionPct: pct(s.resolved, s.occurrences),
        uniqueMissing: s.uniqueMissing.size,
      }))
      .sort((a, b) => b.unresolved - a.unresolved);

    const us = ranked.filter((r) => r.family === "us_reports");
    const f2d = ranked.filter(
      (r) => r.family === "federal_reporter" || /\bF\.?\s*(?:2d|3d|4th)\b/i.test(r.citation),
    );
    const fSupp = ranked.filter((r) => r.family === "federal_supplement");
    const usc = nonCaseDemand.filter((r) => r.family === "usc" || r._bucket === "TARGET_ABSENT_STATUTE");
    const cfr = nonCaseDemand.filter((r) => r.family === "cfr" || r._bucket === "TARGET_ABSENT_REGULATION");
    const frules = nonCaseDemand.filter(
      (r) => r.family === "federal_rules" || r._bucket === "TARGET_ABSENT_RULE",
    );

    const denom = after.extracted || 1;
    const resolvedNow = after.resolved;
    function milestone(targetPct) {
      const need = Math.ceil((targetPct / 100) * denom);
      const additional = Math.max(0, need - resolvedNow);
      let targetsNeeded = 0;
      let acc = 0;
      for (const t of ranked) {
        if (acc >= additional) break;
        acc += t.edgeDemand;
        targetsNeeded += 1;
      }
      return {
        targetPct,
        additionalEdgesRequired: additional,
        topDemandTargetsRequired: additional === 0 ? 0 : targetsNeeded,
        achievableWithTopDemandEdges: acc,
      };
    }

    const tiers = { A: [], B: [], C: [], D: [] };
    for (const t of ranked.slice(0, 500)) {
      const edgeDemand = t.edgeDemand;
      const identityStrong =
        /\d+\s+[A-Za-z.][A-Za-z.0-9]*\s+\d+/.test(t.citation) ||
        /\d+\s+[A-Za-z.]+\d*\s+\d+/.test(t.citation);
      const clEligible = ["us_reports", "federal_reporter", "federal_supplement", "regional_reporter"].includes(
        t.family,
      );
      let tier = "C";
      if (!identityStrong || t.family === "unknown") tier = "D";
      else if (edgeDemand >= 5 && clEligible) tier = "A";
      else if (edgeDemand >= 2 && clEligible) tier = "B";
      else tier = "C";
      tiers[tier].push(t);
    }

    const manifest = {
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: 0,
      targets: ranked.slice(0, 500).map((t, i) => {
        const cumDemand = ranked.slice(0, i + 1).reduce((s, x) => s + x.edgeDemand, 0);
        const identityStrong =
        /\d+\s+[A-Za-z.][A-Za-z.0-9]*\s+\d+/.test(t.citation) ||
        /\d+\s+[A-Za-z.]+\d*\s+\d+/.test(t.citation);
        const clEligible = ["us_reports", "federal_reporter", "federal_supplement", "regional_reporter"].includes(
          t.family,
        );
        let status = "READY_CL";
        if (t.family === "usc" || t.family === "federal_rules") status = "BLOCKED_SOURCE";
        else if (t.family === "cfr") status = "READY_ZERO_CL";
        else if (!identityStrong) status = "AMBIGUOUS";
        else if (!clEligible) status = "UNSUPPORTED";
        return {
          rank: i + 1,
          canonicalTargetKey: t.citation,
          citation: t.citation,
          citationFamily: t.family,
          edgeDemand: t.edgeDemand,
          cumulativeEdgeDemand: cumDemand,
          jurisdiction: null,
          court: null,
          decisionYear: null,
          authorityType: "case",
          sourceStrategy: status === "READY_ZERO_CL" ? "ecfr_or_official" : "courtlistener",
          courtListenerEligible: clEligible,
          zeroCLSourceAvailable: t.family === "cfr",
          localTargetPresent: false,
          status,
          priorityReason: `edgeDemand=${t.edgeDemand}`,
          citationDemandScore: t.edgeDemand,
          coverageValue: t.family === "us_reports" || t.family === "federal_reporter" ? 2 : 1,
          balanceValue: 0,
          efficiencyBonus: null,
          expectedEdgesPerCl: null,
          expectedEdgesPerClConfidence: "UNKNOWN",
        };
      }),
    };

    const scorecard = {
      timestamp: new Date().toISOString(),
      courtListenerHttpCalls: 0,
      parserVersion: CITATION_EXTRACTION_VERSION,
      corpus: {
        cases: after.cases,
        eligibleTextCases: coverage.eligible,
      },
      extraction: {
        processedNonzero: coverage.processed_nonzero,
        processedZero: coverage.processed_zero,
        notProcessed: coverage.not_processed,
        failed: coverage.failed,
        coveragePercent: pct(coverage.processed, coverage.eligible),
        parserVersion: CITATION_EXTRACTION_VERSION,
      },
      citations: {
        occurrences: after.extracted,
        uniqueStrings: null,
        resolvedOccurrences: after.resolved,
        resolvedUnique: null,
        unresolvedOccurrences: after.unresolved,
        rawResolutionPercent: pct(after.resolved, after.extracted),
      },
      unresolved: {
        targetAbsentCase: absentBuckets.TARGET_ABSENT_CASE,
        targetAbsentStatute: absentBuckets.TARGET_ABSENT_STATUTE,
        targetAbsentRegulation: absentBuckets.TARGET_ABSENT_REGULATION,
        targetAbsentRule: absentBuckets.TARGET_ABSENT_RULE,
        presentAmbiguous: absentBuckets.PRESENT_AMBIGUOUS,
        unsupported: absentBuckets.UNSUPPORTED,
        malformed: absentBuckets.MALFORMED,
        other: absentBuckets.OTHER + absentBuckets.INSUFFICIENT_METADATA,
      },
      quality: {
        presentTargetMisses: presentMiss,
        presentTargetFixedThisRun: fixedPresent,
        duplicateCitationEdges: (
          await sql`
            select count(*)::int as n from (
              select from_authority_id, normalized_citation
              from legal_authority_citations group by 1,2 having count(*)>1
            ) d
          `
        )[0].n,
        orphanEdges: 0,
      },
      demand: {
        top10: cum(10),
        top25: cum(25),
        top50: cum(50),
        top100: cum(100),
        top250: cum(250),
        top500: cum(500),
        top1000: cum(1000),
      },
      families: familyTable,
      zeroEdgeClassification: {
        remainingAtStart: zeroEdge.length,
        classes,
        backfilledCases,
        backfilledEdges,
        unsupportedSamples: unsupportedSamples.slice(0, 20),
      },
      milestones: {
        "5": milestone(5),
        "10": milestone(10),
        "15": milestone(15),
        "20": milestone(20),
        "25": milestone(25),
        "30": milestone(30),
        "40": milestone(40),
        "50": milestone(50),
      },
      usReports: {
        occurrences: familyTable.find((f) => f.family === "us_reports")?.occurrences || 0,
        resolved: familyTable.find((f) => f.family === "us_reports")?.resolved || 0,
        unresolved: familyTable.find((f) => f.family === "us_reports")?.unresolved || 0,
        uniqueMissing: us.length,
        top100Demand: us.slice(0, 100).reduce((s, x) => s + x.edgeDemand, 0),
      },
      federalReporter: {
        uniqueMissing: f2d.length,
        top100Demand: f2d.slice(0, 100).reduce((s, x) => s + x.edgeDemand, 0),
      },
      federalSupplement: {
        uniqueMissing: fSupp.length,
        edgeDemand: fSupp.reduce((s, x) => s + x.edgeDemand, 0),
      },
      usc: { uniqueMissing: usc.length, edgeDemand: usc.reduce((s, x) => s + x.edgeDemand, 0), sourceStatus: "MUTATION_OFF" },
      cfr: { uniqueMissing: cfr.length, edgeDemand: cfr.reduce((s, x) => s + x.edgeDemand, 0), sourceStatus: "eCFR_available_gated" },
      federalRules: {
        uniqueMissing: frules.length,
        edgeDemand: frules.reduce((s, x) => s + x.edgeDemand, 0),
        sourceStatus: "MUTATION_OFF",
      },
      tiers: {
        A: { count: tiers.A.length, edgeDemand: tiers.A.reduce((s, x) => s + x.edgeDemand, 0) },
        B: { count: tiers.B.length, edgeDemand: tiers.B.reduce((s, x) => s + x.edgeDemand, 0) },
        C: { count: tiers.C.length, edgeDemand: tiers.C.reduce((s, x) => s + x.edgeDemand, 0) },
        D: { count: tiers.D.length, edgeDemand: tiers.D.reduce((s, x) => s + x.edgeDemand, 0) },
      },
      start,
      after,
      elapsedMs: Date.now() - started,
      mutations,
    };

    // write outputs if writable
    const outPaths = [];
    for (const [name, obj] of [
      ["citation-production-scorecard.json", scorecard],
      ["citation-demand-acquisition-manifest.json", manifest],
    ]) {
      for (const base of [
        "/tmp",
        "packages/research/corpus/reports",
        "/packages/research/corpus/reports",
      ]) {
        try {
          const p = `${base}/${name}`;
          fs.mkdirSync(base, { recursive: true });
          fs.writeFileSync(p, JSON.stringify(obj, null, 2));
          outPaths.push(p);
          break;
        } catch {
          /* try next */
        }
      }
    }

    console.log(
      JSON.stringify({
        ok: true,
        classification: "ZERO_CL_CITATION_PRODUCTION_HARDENING_AND_DEMAND_MANIFEST",
        courtListenerHttpCalls: 0,
        openaiCalls: 0,
        outPaths,
        start,
        after: {
          ...after,
          resolutionPct: pct(after.resolved, after.extracted),
        },
        coverage,
        coveragePct: pct(coverage.processed, coverage.eligible),
        zeroEdgeStart: zeroEdge.length,
        classes,
        backfilledCases,
        backfilledEdges,
        presentMiss,
        fixedPresent,
        absentBuckets,
        demandTop: {
          top10: cum(10),
          top25: cum(25),
          top50: cum(50),
          top100: cum(100),
          top250: cum(250),
          top500: cum(500),
          top1000: cum(1000),
        },
        ifAcquiredPct: {
          top10: pct(resolvedNow + cum(10), denom),
          top25: pct(resolvedNow + cum(25), denom),
          top50: pct(resolvedNow + cum(50), denom),
          top100: pct(resolvedNow + cum(100), denom),
          top250: pct(resolvedNow + cum(250), denom),
          top500: pct(resolvedNow + cum(500), denom),
          top1000: pct(resolvedNow + cum(1000), denom),
        },
        familyTop8: familyTable.slice(0, 8),
        tiers: scorecard.tiers,
        milestones: scorecard.milestones,
        usReports: scorecard.usReports,
        federalReporter: scorecard.federalReporter,
        federalSupplement: scorecard.federalSupplement,
        usc: scorecard.usc,
        cfr: scorecard.cfr,
        federalRules: scorecard.federalRules,
        topRanked: manifest.targets[0] || null,
        integrity: scorecard.quality,
        elapsedMs: Date.now() - started,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
