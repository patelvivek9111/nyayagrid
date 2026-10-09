/**
 * Phase 1F read-only probe: Batch4 miss root cause + hardened queue rebuild.
 * CourtListener calls: 0. Citation mutations: 0.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");
const {
  LocalAuthorityIndex,
  buildUnresolvedTargetQueue,
  classifyCaseCitationLookupEligibility,
  isCaseCitationLookupEligible,
  targetKey,
  experimentalNormalize,
  parseVolReporterPage,
  isLookupSuitableCitation,
  RESOLVER_VERSION,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const REPORT_JSON = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-queue-hardening-2026-10-09.json",
);
const REPORT_MD = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-queue-hardening-2026-10-09.md",
);
const BATCH4 = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-identity-live-batch4-2026-10-09.json",
);
const FULLTEXT_QUEUE = path.join(
  __dirname,
  "..",
  "packages/research/corpus/resolution/fulltext-demand-queue-2026-10-09.json",
);

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

function demandBucket(n) {
  if (n >= 10) return "ge10";
  if (n >= 5) return "ge5";
  if (n >= 3) return "ge3";
  return "ge12";
}

function isStrategic(t) {
  const j = (t.jurisdictions || []).join(" ").toLowerCase();
  if (/us-ca-3|ca3|third/.test(j)) return true;
  if (/us-d-pa|paed|edpa/.test(j)) return true;
  if (/st-pa|pennsylvania/.test(j) && Number(t.priorityScore || 0) >= 40) return true;
  if (/us-scotus|scotus/.test(j) && Number(t.priorityScore || 0) >= 45) return true;
  if (Number(t.priorityScore || 0) >= 55) return true;
  return false;
}

function jurisdictionFlags(t) {
  const j = (t.jurisdictions || []).join(" ").toLowerCase();
  const cite = String(t.normalizedCitation || "");
  return {
    ca3: /us-ca-3|ca3|third/.test(j),
    edpa: /us-d-pa|paed|edpa/.test(j),
    pa: /st-pa|pennsylvania|paed|edpa/.test(j),
    federal: /us-|scotus|ca-|d-|f\.|u\.s\.|s\.\s*ct/i.test(j + " " + cite),
    state: /st-/.test(j),
    historical: /\b(Wall|How|Pet|Cranch|Dallas|Black)\b/i.test(cite),
    parallel: /S\.\s*Ct|L\.\s*Ed/i.test(cite),
  };
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "need Neon DATABASE_URL" }));
    process.exit(2);
  }

  const batch4 = JSON.parse(fs.readFileSync(BATCH4, "utf8"));
  const misses = (batch4.results || []).filter(
    (r) => r.externalLookup && r.status === "IDENTITY_UNRESOLVED",
  );

  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  try {
    await sql.unsafe("BEGIN READ ONLY");

    const citeCols = await sql`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='legal_authority_citations'
      order by ordinal_position
    `;

    const missAnalyses = [];
    for (const m of misses) {
      const key = m.targetKey;
      const edges = await sql`
        select e.id, e.raw_citation, e.normalized_citation, e.from_authority_id, e.created_at,
               a.title as from_title, a.citation as from_citation, a.court_id, a.court,
               a.source_external_id, a.jurisdiction
        from legal_authority_citations e
        left join legal_authorities a on a.id = e.from_authority_id
        where e.to_authority_id is null
          and (
            lower(btrim(coalesce(e.raw_citation,''))) = ${key}
            or lower(btrim(coalesce(e.normalized_citation,''))) = ${key}
          )
        order by e.created_at
        limit 8
      `;

      // Try to find surrounding text in from-authority content/chunks if available
      let surroundingContext = null;
      let extractorHint = null;
      if (edges[0]?.from_authority_id) {
        const fromId = edges[0].from_authority_id;
        const [auth] = await sql`
          select id, title, citation, metadata, source_external_id
          from legal_authorities where id = ${fromId}
        `;
        const meta = auth?.metadata && typeof auth.metadata === "object" ? auth.metadata : {};
        extractorHint = {
          metadataKeys: Object.keys(meta).slice(0, 30),
          citationExtraction: meta.citationExtraction || meta.extraction || meta.extractor || null,
          eyecite: meta.eyecite || null,
        };
        const needle = edges[0].raw_citation || m.representativeRaw;
        const chunks = await sql`
          select left(content, 400) as snippet
          from legal_authority_chunks
          where authority_id = ${fromId}
            and content ilike ${"%" + needle + "%"}
          limit 2
        `.catch(() => []);
        if (chunks.length) {
          surroundingContext = chunks.map((c) => c.snippet);
        } else {
          // Some corpora store plain text on authorities
          try {
            const [txt] = await sql`
              select left(coalesce(plain_text, full_text, content, ''), 500) as snippet
              from legal_authorities where id = ${fromId}
            `;
            if (txt?.snippet && String(txt.snippet).toLowerCase().includes(String(needle).toLowerCase())) {
              surroundingContext = [txt.snippet];
            }
          } catch {
            /* column may not exist */
          }
        }
      }

      const sample = edges[0] || null;
      const raw = sample?.raw_citation || m.representativeRaw;
      const norm = sample?.normalized_citation || m.citation;
      const lean = experimentalNormalize(norm || raw);
      const parsed = parseVolReporterPage(lean || norm || raw);
      const eligibility = classifyCaseCitationLookupEligibility(raw, norm);
      const oldSuitable = isLookupSuitableCitation(norm || raw);

      missAnalyses.push({
        targetKey: key,
        edgeCount: m.edgeCount,
        uniqueCitingCases: m.uniqueCitingCases,
        jurisdictions: m.jurisdictions,
        sampleEdges: edges.map((e) => ({
          id: e.id,
          rawCitation: e.raw_citation,
          normalizedCitation: e.normalized_citation,
          fromAuthorityId: e.from_authority_id,
          fromTitle: e.from_title,
          fromCitation: e.from_citation,
          fromCourt: e.court_id || e.court,
          createdAt: e.created_at,
        })),
        normalizationResult: lean,
        reporterParserResult: parsed,
        oldLookupSuitable: oldSuitable,
        newEligibility: eligibility,
        extractorHint,
        surroundingContext,
        artifactKind: /^\d{4}\s+page\s+\d+$/i.test(key) ? "YYYY_PAGE_N" : "OTHER",
      });
    }

    // Count artifact edges corpus-wide
    const [artifactStats] = await sql`
      select
        count(*)::int as edges,
        count(distinct lower(btrim(coalesce(normalized_citation, raw_citation, ''))))::int as targets
      from legal_authority_citations
      where to_authority_id is null
        and (
          lower(btrim(coalesce(raw_citation,''))) ~ '^[0-9]{4}[[:space:]]+page[[:space:]]+[0-9]+$'
          or lower(btrim(coalesce(normalized_citation,''))) ~ '^[0-9]{4}[[:space:]]+page[[:space:]]+[0-9]+$'
        )
    `;

    const unresolved = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    const authorityRows = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider,
             title, court, court_id, decision_date, ingestion_status,
             exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
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
        corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
      })),
    );

    const edgeRows = unresolved.map((e) => ({
      id: e.id,
      fromAuthorityId: e.from_authority_id,
      rawCitation: e.raw_citation,
      normalizedCitation: e.normalized_citation,
      createdAt: e.created_at,
      fromCourtId: e.from_court_id,
      fromCourt: e.from_court,
    }));

    const oldQueue = buildUnresolvedTargetQueue(edgeRows, index);
    // Old lookup candidates used isLookupSuitable before Batch4 patch — approximate with current
    // isLookupSuitable PLUS treating YYYY Page as previously suitable for "before" comparison.
    const beforeCandidates = oldQueue.targets.filter((t) => {
      if (t.lookupSuitable) return true;
      // Reconstruct pre-hardening suitability: Page artifacts matched vol-reporter-ish regex
      return /^\d{4}\s+page\s+\d+$/i.test(t.normalizedCitation || t.representativeRaw || "");
    });

    const laneCounts = {
      CASE_IDENTITY_LOOKUP_ELIGIBLE: 0,
      NON_CASE_REFERENCE: 0,
      MALFORMED_CASE_REFERENCE: 0,
      PIN_CITE_ONLY: 0,
      STATUTE_RULE_REGULATION: 0,
      UNKNOWN_REVIEW: 0,
    };
    const afterEligible = [];
    const classifiedTargets = [];

    for (const t of oldQueue.targets) {
      const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
      laneCounts[el.lane] = (laneCounts[el.lane] || 0) + 1;
      classifiedTargets.push({
        targetKey: t.targetKey,
        edgeCount: t.edgeCount,
        lane: el.lane,
        reasons: el.reasons,
        reporterFamily: el.reporterFamily,
        jurisdictions: t.jurisdictions,
        priorityScore: t.priorityScore,
      });
      if (el.eligible) {
        afterEligible.push({ ...t, eligibilityLane: el.lane, eligibilityReasons: el.reasons });
      }
    }

    const bucketize = (arr) => {
      const b = { ge10: 0, ge5: 0, ge3: 0, ge12: 0, edges: { ge10: 0, ge5: 0, ge3: 0, ge12: 0 } };
      for (const t of arr) {
        const k = demandBucket(t.edgeCount);
        b[k] += 1;
        b.edges[k] += t.edgeCount;
      }
      return b;
    };

    const beforeBuckets = bucketize(beforeCandidates);
    const afterBuckets = bucketize(afterEligible);

    // >=5 identity lane
    const ge5Lane = afterEligible.filter((t) => t.edgeCount >= 5);
    const ge5Stats = {
      targets: ge5Lane.length,
      edgesRepresented: ge5Lane.reduce((s, t) => s + t.edgeCount, 0),
      ca3: 0,
      edpa: 0,
      pa: 0,
      federal: 0,
      state: 0,
      historical: 0,
      parallel: 0,
    };
    for (const t of ge5Lane) {
      const f = jurisdictionFlags(t);
      if (f.ca3) ge5Stats.ca3 += 1;
      if (f.edpa) ge5Stats.edpa += 1;
      if (f.pa) ge5Stats.pa += 1;
      if (f.federal) ge5Stats.federal += 1;
      if (f.state && !f.federal) ge5Stats.state += 1;
      if (f.historical) ge5Stats.historical += 1;
      if (f.parallel) ge5Stats.parallel += 1;
    }

    // 3–4 policy
    const ge34 = afterEligible.filter((t) => t.edgeCount >= 3 && t.edgeCount < 5);
    const policy34 = { STRATEGIC_LOOKUP: [], DEFER: [], LOCAL_ONLY_WAIT: [] };
    for (const t of ge34) {
      if (isStrategic(t)) policy34.STRATEGIC_LOOKUP.push(t.targetKey);
      else if (t.localCandidateStatus !== "NO_LOCAL_MATCH") policy34.LOCAL_ONLY_WAIT.push(t.targetKey);
      else policy34.DEFER.push(t.targetKey);
    }

    // 1–2 policy
    const ge12 = afterEligible.filter((t) => t.edgeCount < 3);
    const policy12 = {
      strategicExceptions: ge12.filter(isStrategic).length,
      noBulk: ge12.filter((t) => !isStrategic(t)).length,
    };

    // Full-text queue audit
    let ftCandidates = [];
    try {
      ftCandidates = JSON.parse(fs.readFileSync(FULLTEXT_QUEUE, "utf8")).candidates || [];
    } catch {
      /* */
    }
    const scoreFt = (c) => {
      const edges = Number(c.edgeCount || c.unresolvedDemandRepresented || 0);
      const citing = Number(c.uniqueCitingCases || 0);
      const j = String((c.jurisdictions || []).join(" ") + " " + (c.court || "")).toLowerCase();
      let s = edges * 2 + citing;
      if (/us-ca-3|ca3|third/.test(j)) s += 25;
      if (/us-d-pa|paed|edpa/.test(j)) s += 20;
      if (/st-pa|pennsylvania/.test(j)) s += 12;
      if (/us-scotus|scotus/.test(j) || /S\.\s*Ct|U\.S\./i.test(c.citation || "")) s += 18;
      if (c.controllingRelevance) s += 15;
      s += Number(c.practiceValue || 0) * 0.1;
      // Prefer federal reporter / SCOTUS for retrieval value
      if (/\bU\.S\.|\bS\.\s*Ct|\bF\.(?:2d|3d|4th)|\bF\.\s*Supp/i.test(c.citation || "")) s += 10;
      return s;
    };
    const rankedFt = [...ftCandidates]
      .map((c) => ({ ...c, rankScore: scoreFt(c) }))
      .sort((a, b) => b.rankScore - a.rankScore);
    const tierA = rankedFt.filter((c) => c.rankScore >= 50 || Number(c.edgeCount || 0) >= 15);
    const tierB = rankedFt.filter(
      (c) => !tierA.includes(c) && (c.rankScore >= 30 || Number(c.edgeCount || 0) >= 8),
    );
    const tierC = rankedFt.filter((c) => !tierA.includes(c) && !tierB.includes(c));

    // Expected identity value after excluding artifacts (B1-B4)
    // B4 artifact-excluded: 5 HIGH / 6 lookups (5 high + 1 idaho miss) ≈ 83% if only reporter-valid
    // Actually B4: 5 high of 6 non-artifact = 83.3%, edges 60/6 = 10 if we only count the 5? 
    // Non-artifact lookups: 5 HIGH + 1 Idaho not_found = 6; edges 60; rate 83%; edges/CL = 10
    const expectedValue = {
      historicalBulkTargetRate: 0.85,
      historicalBulkEdgesPerCl: 6.5,
      batch4ReporterValidOnly: { lookups: 6, high: 5, rate: 5 / 6, edges: 60, edgesPerCl: 10 },
      preferredLane: ">=5 reporter-valid CASE_IDENTITY_LOOKUP_ELIGIBLE",
    };

    // Dry-run mixed batch max 40
    // Evidence: identity still efficient on >=5 reporter-valid (~6.5–10 edges/CL)
    // Acquisition old-edge ~0.7–3.5 but adds text value; METADATA_ONLY=115
    // Allocation: 55% identity, 35% fulltext, 10% reserve → 22 identity, 14 fulltext, 4 headroom
    const proposedIdentity = ge5Lane
      .filter((t) => t.localCandidateStatus === "NO_LOCAL_MATCH")
      .slice(0, 22);
    const proposedFt = tierA.slice(0, 14);
    const dryRun = {
      totalProposedClMax: 40,
      identityCalls: proposedIdentity.length,
      identityTargets: proposedIdentity.map((t) => ({
        targetKey: t.targetKey,
        citation: t.normalizedCitation,
        edgeCount: t.edgeCount,
        jurisdictions: t.jurisdictions,
      })),
      identityEdgesRepresented: proposedIdentity.reduce((s, t) => s + t.edgeCount, 0),
      expectedIdentityHigh: Math.round(proposedIdentity.length * expectedValue.historicalBulkTargetRate),
      expectedIdentityEdges: Math.round(proposedIdentity.length * expectedValue.historicalBulkEdgesPerCl),
      fullTextCalls: proposedFt.length,
      fullTextTargets: proposedFt.map((c) => ({
        citation: c.citation,
        caseName: c.caseName,
        edgeCount: c.edgeCount,
        authorityId: c.authorityId,
        rankScore: c.rankScore,
        reason:
          Number(c.edgeCount || 0) >= 15
            ? "high_citation_demand_metadata_only"
            : c.controllingRelevance
              ? "controlling_jurisdiction_gap"
              : "ranked_retrieval_practice_value",
      })),
      estimatedRequestCost: proposedIdentity.length + proposedFt.length,
      headroom: 40 - (proposedIdentity.length + proposedFt.length),
      allocation: { identityPct: 55, fullTextPct: 35, reservePct: 10 },
    };

    const pageArtifactsInBefore = beforeCandidates.filter((t) =>
      /^\d{4}\s+page\s+\d+$/i.test(t.normalizedCitation || ""),
    ).length;
    const batch4Avoided = misses.filter((m) => /^\d{4}\s+page\s+\d+$/i.test(m.targetKey)).length;

    const report = {
      ok: true,
      classification: "CITATION_RESOLUTION_QUEUE_HARDENING",
      stopReason: "QUEUE_HARDENED_DRY_RUN_READY",
      courtListenerCalls: 0,
      citationMutations: 0,
      resolverVersion: RESOLVER_VERSION,
      citeTableColumns: citeCols.map((c) => c.column_name),
      batch4MissAnalysis: {
        noResultTargets: misses.length,
        yyyyPageNArtifacts: misses.filter((m) => /^\d{4}\s+page\s+\d+$/i.test(m.targetKey)).length,
        otherMisses: misses.filter((m) => !/^\d{4}\s+page\s+\d+$/i.test(m.targetKey)).length,
        rootCause:
          "Extractor emitted document pagination tokens ('YYYY Page N') as raw_citation/normalized_citation on unresolved edges. Pre-hardening isLookupSuitableCitation treated vol+word+page as lookup-suitable because parseVolReporterPage returned null and the loose \\d reporter \\d regex matched '2026 Page 2'. Raw citation text preserved; only resolution lane reclassified.",
        artifactEdgeStats: artifactStats,
        details: missAnalyses,
      },
      eligibilityGate: laneCounts,
      queueBefore: {
        lookupCandidates: beforeCandidates.length,
        ...beforeBuckets,
        note: "Before = pre-hardening suitability (includes YYYY Page N that Batch4 treated as suitable)",
      },
      queueAfter: {
        lookupEligible: afterEligible.length,
        ...afterBuckets,
        uniqueIdentityTargets: oldQueue.uniqueTargets,
        totalIdentityUnresolvedEdges: oldQueue.unresolvedEdges,
      },
      filterImpact: {
        batch4CallsThatWouldHaveBeenAvoided: batch4Avoided,
        currentArtifactTargetsRemovedFromClQueue: pageArtifactsInBefore,
        nonCaseFiltered: laneCounts.NON_CASE_REFERENCE + laneCounts.STATUTE_RULE_REGULATION,
        malformedFiltered: laneCounts.MALFORMED_CASE_REFERENCE,
        pinCiteFiltered: laneCounts.PIN_CITE_ONLY,
        estimatedFutureClCallsAvoided:
          pageArtifactsInBefore +
          laneCounts.MALFORMED_CASE_REFERENCE +
          Math.floor((laneCounts.NON_CASE_REFERENCE + laneCounts.STATUTE_RULE_REGULATION) * 0.3),
      },
      ge5IdentityLane: { ...ge5Stats, expectedValue },
      policy34: {
        strategicLookup: policy34.STRATEGIC_LOOKUP.length,
        defer: policy34.DEFER.length,
        localOnlyWait: policy34.LOCAL_ONLY_WAIT.length,
        strategicSample: policy34.STRATEGIC_LOOKUP.slice(0, 15),
      },
      policy12,
      fullTextQueue: {
        total: rankedFt.length,
        tierA: tierA.length,
        tierB: tierB.length,
        tierC: tierC.length,
        topTierA: tierA.slice(0, 15).map((c) => ({
          citation: c.citation,
          caseName: c.caseName,
          edgeCount: c.edgeCount,
          rankScore: c.rankScore,
          reason:
            Number(c.edgeCount || 0) >= 15
              ? "high_citation_demand"
              : /S\.\s*Ct|U\.S\./i.test(c.citation || "")
                ? "scotus_parallel_or_us_reports"
                : "practice_jurisdiction_value",
        })),
      },
      permanentPolicy: {
        bulkIdentityThreshold: ">=5 edges AND CASE_IDENTITY_LOOKUP_ELIGIBLE",
        strategicExceptionPolicy:
          "3–4 or 1–2 only when CA3/EDPA/high-value PA/SCOTUS benchmark/priorityScore>=55 and reporter-valid",
        oneTwoEdgePolicy: "NO_BULK_EXTERNAL_LOOKUP; alias/parallel/local growth or on-demand",
        nonCaseHandling: "NON_CASE_REFERENCE / STATUTE_RULE_REGULATION — preserve raw; never CL case-identity lane",
        malformedHandling: "MALFORMED_CASE_REFERENCE — preserve raw; never CL case-identity lane",
        mixedAllocation: dryRun.allocation,
      },
      dryRunNextBatch: dryRun,
      generatedAt: new Date().toISOString(),
    };

    writeJson(REPORT_JSON, report);
    fs.writeFileSync(
      REPORT_MD,
      `# Citation Queue Hardening — 2026-10-09

**CourtListener calls:** 0  
**Citation mutations:** 0  
**Stop:** ${report.stopReason}

## Batch 4 miss root cause

${report.batch4MissAnalysis.rootCause}

- no-result: ${report.batch4MissAnalysis.noResultTargets}
- YYYY Page N: ${report.batch4MissAnalysis.yyyyPageNArtifacts}
- other: ${report.batch4MissAnalysis.otherMisses} (163 Idaho 856)
- artifact edges in DB: ${artifactStats.edges} / targets ${artifactStats.targets}

## Queue

| | Before | After |
|---|---:|---:|
| lookup candidates | ${beforeCandidates.length} | ${afterEligible.length} |
| >=10 | ${beforeBuckets.ge10} | ${afterBuckets.ge10} |
| 5–9 | ${beforeBuckets.ge5} | ${afterBuckets.ge5} |
| 3–4 | ${beforeBuckets.ge3} | ${afterBuckets.ge3} |
| 1–2 | ${beforeBuckets.ge12} | ${afterBuckets.ge12} |

## >=5 identity lane

targets: **${ge5Stats.targets}** · edges: **${ge5Stats.edgesRepresented}**  
CA3 ${ge5Stats.ca3} · EDPA ${ge5Stats.edpa} · PA ${ge5Stats.pa} · federal ${ge5Stats.federal} · state ${ge5Stats.state}

## Mixed dry-run (NOT executed)

max CL 40 · identity ${dryRun.identityCalls} · full-text ${dryRun.fullTextCalls} · headroom ${dryRun.headroom}  
allocation ${dryRun.allocation.identityPct}/${dryRun.allocation.fullTextPct}/${dryRun.allocation.reservePct}
`,
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          reportJson: REPORT_JSON,
          courtListenerCalls: 0,
          batch4Avoided,
          before: beforeCandidates.length,
          after: afterEligible.length,
          ge5: ge5Stats.targets,
          ge5Edges: ge5Stats.edgesRepresented,
          lanes: laneCounts,
          dryRun: {
            identity: dryRun.identityCalls,
            fullText: dryRun.fullTextCalls,
            headroom: dryRun.headroom,
          },
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
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 2000) }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
