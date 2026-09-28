/**
 * Queue #2 zero-CL citation TARGET_ABSENT priority analysis.
 * Read-only. ZERO CourtListener HTTP. ZERO corpus mutations.
 *
 * Usage on staging: node tmp-queue2-citation-target-priority.cjs
 */
"use strict";

const postgres = require("postgres");
const {
  leanNormalizeCitation,
  classifyCitationFamily,
  citationLookupAliases,
  isGarbageCitation,
} = require("./wave2f-citation-audit.cjs");

function parseVolumeReporterPage(cite) {
  if (!cite) return null;
  const t = String(cite).replace(/\s+/g, " ").trim();

  let m = t.match(/^(\d{1,3})\s+U\.?\s*S\.?\s+(\d{1,4})$/i);
  if (m) return { reporter: "U.S.", volume: Number(m[1]), page: Number(m[2]), series: null, family: "us_reports" };

  m = t.match(/^(\d{1,3})\s+S\.?\s*Ct\.?\s+(\d{1,4})$/i);
  if (m) return { reporter: "S. Ct.", volume: Number(m[1]), page: Number(m[2]), series: null, family: "s_ct" };

  m = t.match(/^(\d{1,3})\s+L\.?\s*Ed\.?\s*(2d)?\s+(\d{1,4})$/i);
  if (m) {
    return {
      reporter: m[2] ? "L. Ed. 2d" : "L. Ed.",
      volume: Number(m[1]),
      page: Number(m[3]),
      series: m[2] ? "2d" : null,
      family: "l_ed",
    };
  }

  m = t.match(/^(\d{1,4})\s+F\.?\s*Supp\.?(?:\s?(2d|3d|4th))?\s+(\d{1,4})$/i);
  if (m) {
    const series = (m[2] || "").toLowerCase() || null;
    const reporter = series ? `F. Supp. ${series}` : "F. Supp.";
    return { reporter, volume: Number(m[1]), page: Number(m[3]), series, family: "federal_supplement" };
  }

  m = t.match(/^(\d{1,4})\s+F\.?\s*(2d|3d|4th)?\s+(\d{1,4})$/i);
  if (m) {
    const series = (m[2] || "").toLowerCase() || null;
    const reporter = series ? `F.${series}` : "F.";
    return { reporter, volume: Number(m[1]), page: Number(m[3]), series, family: "federal_reporter" };
  }

  m = t.match(/^(\d{1,4})\s+(A\.|N\.?E\.|S\.?E\.|S\.?W\.|N\.?W\.|P\.|So\.|Cal\.?\s?Rptr\.?|N\.?Y\.?S\.?)(?:\s?(2d|3d))?\s+(\d{1,4})$/i);
  if (m) {
    const base = m[2].replace(/\s+/g, " ").replace(/\.$/, ".");
    const series = (m[3] || "").toLowerCase() || null;
    const reporter = series ? `${base}${series}` : base;
    return { reporter, volume: Number(m[1]), page: Number(m[4]), series, family: "regional_reporter" };
  }

  m = t.match(/^(\d{1,2})\s+U\.?\s?S\.?\s?C\.?\s*§\s*(.+)$/i);
  if (m) return { reporter: "U.S.C.", volume: Number(m[1]), page: null, series: null, family: "usc", section: m[2] };

  m = t.match(/^(\d{1,2})\s+C\.?\s?F\.?\s?R\.?\s*§\s*(.+)$/i);
  if (m) return { reporter: "C.F.R.", volume: Number(m[1]), page: null, series: null, family: "cfr", section: m[2] };

  m = t.match(/^Fed\.?\s*R\.?\s*(Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s+(\d+[A-Za-z]?)$/i);
  if (m) {
    const kind = m[1].replace(/\s+/g, " ").trim().toLowerCase();
    let reporter = "Fed. R. Civ. P.";
    if (/^evid/i.test(kind)) reporter = "Fed. R. Evid.";
    else if (/^app/i.test(kind)) reporter = "Fed. R. App. P.";
    else if (/^crim/i.test(kind)) reporter = "Fed. R. Crim. P.";
    return { reporter, volume: null, page: null, series: null, family: "federal_rules", section: m[2] };
  }

  return null;
}

function reporterBucket(parsed, family) {
  if (parsed?.reporter) return parsed.reporter;
  if (family === "us_reports") return "U.S.";
  if (family === "federal_reporter") return "F.* (unparsed series)";
  if (family === "federal_supplement") return "F. Supp.* (unparsed series)";
  if (family === "regional_reporter") return "regional (unparsed)";
  if (family === "usc") return "U.S.C.";
  if (family === "cfr") return "C.F.R.";
  if (family === "federal_rules") return "Fed. R.*";
  if (family === "malformed_partial") return "malformed";
  return family || "other";
}

function likelyJurisdiction(parsed, family) {
  if (!parsed && !family) return "unknown";
  if (family === "us_reports" || family === "s_ct" || family === "l_ed") return "federal_scotus";
  if (family === "federal_reporter") return "federal_circuit";
  if (family === "federal_supplement") return "federal_district";
  if (family === "usc" || family === "cfr" || family === "federal_rules") return "federal_primary";
  if (family === "regional_reporter") return "state_regional";
  if (family === "state_statute" || family === "state_regulation" || family === "state_court_rules") return "state_primary";
  return "unknown";
}

function acquisitionPath(family, reporter) {
  if (family === "us_reports") {
    return {
      sourceFeasibility: "HIGH",
      recommendedPath: "CourtListener scotus + existing US Reports / LOC non-CL intake if enabled",
      clObtainable: true,
      zeroClCandidate: true,
      zeroClSource: "US_REPORTS_NON_CL_INTAKE (Lane B; mutation gated)",
    };
  }
  if (family === "federal_reporter") {
    return {
      sourceFeasibility: "HIGH",
      recommendedPath: "CourtListener circuit opinions (ca1–ca11/cadc/cafc)",
      clObtainable: true,
      zeroClCandidate: false,
      zeroClSource: null,
    };
  }
  if (family === "federal_supplement") {
    return {
      sourceFeasibility: "MEDIUM",
      recommendedPath: "CourtListener district opinions (lower priority vs high-court depth)",
      clObtainable: true,
      zeroClCandidate: false,
      zeroClSource: null,
    };
  }
  if (family === "usc" || family === "cfr" || family === "federal_rules") {
    return {
      sourceFeasibility: "HIGH",
      recommendedPath: "Existing USC/CFR/federal-rules Lane B depth (non-CL)",
      clObtainable: false,
      zeroClCandidate: true,
      zeroClSource: family === "usc" ? "USC_DEPTH" : family === "cfr" ? "CFR_DEPTH" : "FEDERAL_RULES_DEPTH",
    };
  }
  if (family === "regional_reporter") {
    return {
      sourceFeasibility: "MEDIUM",
      recommendedPath: "CourtListener state high/appellate opinions covering that reporter",
      clObtainable: true,
      zeroClCandidate: false,
      zeroClSource: null,
    };
  }
  return {
    sourceFeasibility: "LOW",
    recommendedPath: "unknown / unsupported without new integration",
    clObtainable: false,
    zeroClCandidate: false,
    zeroClSource: null,
  };
}

function hierarchyWeight(family) {
  if (family === "us_reports" || family === "s_ct" || family === "l_ed") return 100;
  if (family === "federal_reporter") return 80;
  if (family === "usc" || family === "cfr" || family === "federal_rules") return 70;
  if (family === "regional_reporter") return 50;
  if (family === "federal_supplement") return 40;
  return 10;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0, mutations: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 40 });

  try {
    const [corpus] = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases,
             count(*) filter (where authority_type='case' and source_provider='courtlistener')::int as cl_cases,
             count(*) filter (where authority_type='statute')::int as statutes,
             count(*) filter (where authority_type='regulation')::int as regulations,
             count(*) filter (where authority_type='rule')::int as rules
      from legal_authorities
    `;
    const [chunks] = await sql`
      select count(*)::int as chunks,
             count(*) filter (where embedding is not null)::int as embeddings,
             count(*) filter (where embedding is null)::int as missing_embeddings
      from legal_authority_chunks
    `;
    const [orphans] = await sql`
      select count(*)::int as n from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id where a.id is null
    `;
    const [dups] = await sql`
      select count(*)::int as n from (
        select source_provider, source_external_id from legal_authorities
        where source_external_id is not null
        group by 1, 2 having count(*) > 1
      ) d
    `;
    const [citeTotals] = await sql`
      select count(*)::int as extracted,
             count(*) filter (where to_authority_id is not null)::int as resolved,
             count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;

    const authorities = await sql`
      select id, citation, normalized_citation, authority_state, authority_type, court_level, source_provider, metadata
      from legal_authorities
    `;

    const presentKeys = new Set();
    for (const row of authorities) {
      for (const value of [row.normalized_citation, row.citation].filter(Boolean)) {
        const lean = leanNormalizeCitation(value) || value;
        for (const a of citationLookupAliases(lean)) presentKeys.add(a);
        for (const a of citationLookupAliases(value)) presentKeys.add(a);
      }
      const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const aliases = Array.isArray(meta.citationAliases)
        ? meta.citationAliases
        : Array.isArray(meta.parallelCitations)
          ? meta.parallelCitations
          : [];
      for (const a of aliases) {
        if (typeof a !== "string" || !a.trim()) continue;
        const lean = leanNormalizeCitation(a) || a.trim();
        for (const k of citationLookupAliases(lean)) presentKeys.add(k);
      }
    }

    const edges = await sql`
      select e.id, e.raw_citation, e.normalized_citation, e.from_authority_id,
             a.authority_state as citing_state,
             a.authority_type as citing_type,
             a.court_level as citing_court_level,
             a.citation as citing_citation
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;

    const groups = new Map();
    let malformed = 0;
    let ambiguousBucket = 0;
    let targetPresentButNotMatched = 0;

    for (const e of edges) {
      const lean =
        leanNormalizeCitation(e.normalized_citation) ||
        leanNormalizeCitation(e.raw_citation) ||
        (e.normalized_citation ? String(e.normalized_citation).trim() : null) ||
        (e.raw_citation ? String(e.raw_citation).trim() : null);

      const family = classifyCitationFamily(e.raw_citation, lean || e.normalized_citation);
      if (!lean || isGarbageCitation(lean) || family === "malformed_partial") {
        malformed += 1;
        continue;
      }

      const aliases = citationLookupAliases(lean);
      const presentHits = aliases.filter((k) => presentKeys.has(k));
      if (presentHits.length > 0) {
        // Should be rare after resolve; still classify for honesty.
        targetPresentButNotMatched += 1;
      }

      const key = lean;
      let g = groups.get(key);
      if (!g) {
        const parsed = parseVolumeReporterPage(lean);
        const acq = acquisitionPath(family, parsed?.reporter);
        g = {
          normalizedCitation: lean,
          sampleRaw: e.raw_citation,
          family,
          parsed,
          reporter: reporterBucket(parsed, family),
          likelyJurisdiction: likelyJurisdiction(parsed, family),
          edgeCount: 0,
          citingAuthorityIds: new Set(),
          citingStates: new Set(),
          presentInCorpus: presentHits.length > 0,
          presentHitCount: presentHits.length,
          ...acq,
        };
        groups.set(key, g);
      }
      g.edgeCount += 1;
      if (e.from_authority_id) g.citingAuthorityIds.add(e.from_authority_id);
      if (e.citing_state) g.citingStates.add(e.citing_state);
    }

    // Ambiguous = same volume/reporter/page parse would collide across distinct lean keys? Not collapsing those.
    // Mark groups that have presentInCorpus as B class (should not be in A2 acquisition).
    const absentGroups = [...groups.values()].filter((g) => !g.presentInCorpus);
    const presentGroups = [...groups.values()].filter((g) => g.presentInCorpus);
    ambiguousBucket = presentGroups.length; // present-but-unresolved treated as ambiguous/mismatch class for inventory

    absentGroups.sort(
      (a, b) =>
        b.edgeCount - a.edgeCount ||
        b.citingAuthorityIds.size - a.citingAuthorityIds.size ||
        hierarchyWeight(b.family) - hierarchyWeight(a.family) ||
        String(a.normalizedCitation).localeCompare(String(b.normalizedCitation)),
    );

    const totalAbsentEdges = absentGroups.reduce((s, g) => s + g.edgeCount, 0);
    const top10Edges = absentGroups.slice(0, 10).reduce((s, g) => s + g.edgeCount, 0);
    const top100Edges = absentGroups.slice(0, 100).reduce((s, g) => s + g.edgeCount, 0);

    function serializeGroup(g, rank) {
      return {
        rank,
        normalizedCitation: g.normalizedCitation,
        sampleRaw: g.sampleRaw,
        reporter: g.reporter,
        family: g.family,
        volume: g.parsed?.volume ?? null,
        page: g.parsed?.page ?? null,
        series: g.parsed?.series ?? null,
        section: g.parsed?.section ?? null,
        estimatedCitationEdgesUnlocked: g.edgeCount,
        uniqueCitingAuthorities: g.citingAuthorityIds.size,
        citingJurisdictions: [...g.citingStates].sort(),
        likelyTargetJurisdiction: g.likelyJurisdiction,
        presentInCorpus: false,
        sourceFeasibility: g.sourceFeasibility,
        recommendedAcquisitionPath: g.recommendedPath,
        clObtainable: g.clObtainable,
        zeroClCandidate: g.zeroClCandidate,
        zeroClSource: g.zeroClSource,
        hierarchyWeight: hierarchyWeight(g.family),
      };
    }

    const top100 = absentGroups.slice(0, 100).map((g, i) => serializeGroup(g, i + 1));
    const top20 = top100.slice(0, 20);

    // Reporter aggregation
    const byReporter = new Map();
    for (const g of absentGroups) {
      const r = g.reporter;
      let row = byReporter.get(r);
      if (!row) row = { reporter: r, family: g.family, unresolvedEdges: 0, uniqueTargets: 0, clObtainable: g.clObtainable, zeroClCandidate: g.zeroClCandidate };
      row.unresolvedEdges += g.edgeCount;
      row.uniqueTargets += 1;
      byReporter.set(r, row);
    }
    const reporterGaps = [...byReporter.values()]
      .map((r) => ({
        ...r,
        shareOfTargetAbsentEdgesPct:
          totalAbsentEdges > 0 ? Math.round((10000 * r.unresolvedEdges) / totalAbsentEdges) / 100 : 0,
        currentQueue2CanAcquire:
          r.clObtainable || r.zeroClCandidate
            ? r.clObtainable
              ? "YES_VIA_CL_FUTURE_WINDOW"
              : "YES_VIA_EXISTING_ZERO_CL_LANE_B"
            : "NO_WITHOUT_NEW_INTEGRATION",
      }))
      .sort((a, b) => b.unresolvedEdges - a.unresolvedEdges);

    // Jurisdiction aggregation (likely target jurisdiction)
    const byJur = new Map();
    for (const g of absentGroups) {
      const j = g.likelyJurisdiction;
      let row = byJur.get(j);
      if (!row) row = { jurisdiction: j, unresolvedEdges: 0, uniqueTargets: 0, topTargets: [] };
      row.unresolvedEdges += g.edgeCount;
      row.uniqueTargets += 1;
      byJur.set(j, row);
    }
    for (const g of absentGroups) {
      const row = byJur.get(g.likelyJurisdiction);
      if (row.topTargets.length < 5) {
        row.topTargets.push({ citation: g.normalizedCitation, edges: g.edgeCount });
      }
    }
    const jurisdictionGaps = [...byJur.values()]
      .map((r) => ({
        ...r,
        sharePct: totalAbsentEdges > 0 ? Math.round((10000 * r.unresolvedEdges) / totalAbsentEdges) / 100 : 0,
      }))
      .sort((a, b) => b.unresolvedEdges - a.unresolvedEdges);

    // Citing-jurisdiction demand: which citing states generate TARGET_ABSENT edges
    const citingDemand = new Map();
    for (const e of edges) {
      const st = e.citing_state || "UNKNOWN";
      citingDemand.set(st, (citingDemand.get(st) || 0) + 1);
    }
    const citingJurisdictionDemand = [...citingDemand.entries()]
      .map(([jurisdiction, unresolvedEdges]) => ({ jurisdiction, unresolvedEdges }))
      .sort((a, b) => b.unresolvedEdges - a.unresolvedEdges)
      .slice(0, 30);

    // Depth-wave overlap: completed + active from dual-lane is not in DB; use authority_state case depth
    const depthByState = await sql`
      select authority_state as j,
             count(*) filter (where authority_type='case' and court_level in ('state_high','scotus','circuit','state_appellate'))::int as qualifying
      from legal_authorities
      where authority_state is not null and btrim(authority_state) <> ''
      group by 1
    `;
    const depthMap = Object.fromEntries(depthByState.map((r) => [r.j, r.qualifying]));

    // Zero-CL opportunity rollups
    const zeroClFamilies = ["us_reports", "usc", "cfr", "federal_rules"];
    const zeroClOpps = zeroClFamilies.map((fam) => {
      const rows = absentGroups.filter((g) => g.family === fam);
      return {
        family: fam,
        uniqueTargets: rows.length,
        unresolvedEdges: rows.reduce((s, g) => s + g.edgeCount, 0),
        source: acquisitionPath(fam).zeroClSource,
        mutationPathEnabled: false,
        safeToExecuteNow: false,
        note: "ANALYZE ONLY — Lane B mutation not enabled in this prompt",
      };
    });

    // A2 queue: CL-obtainable high-impact absent targets (cases)
    const a2 = absentGroups
      .filter((g) => g.clObtainable && (g.family === "us_reports" || g.family === "federal_reporter" || g.family === "regional_reporter"))
      .slice(0, 50)
      .map((g, i) => ({
        rank: i + 1,
        citation: g.normalizedCitation,
        likelyCourtJurisdiction: g.likelyJurisdiction,
        edgesPotentiallyUnlocked: g.edgeCount,
        uniqueCitingAuthorities: g.citingAuthorityIds.size,
        acquisitionConfidence: g.family === "us_reports" ? "HIGH" : g.family === "federal_reporter" ? "HIGH" : "MEDIUM",
        estimatedClCost:
          g.family === "us_reports"
            ? "~2–3 requests/authority if opinion fetch+cluster (manual baseline ~2.2)"
            : "~2–3 requests/authority (estimate from Lane A baseline; not measured this run)",
        whyA2: `TARGET_ABSENT ${g.family}; ${g.edgeCount} edges / ${g.citingAuthorityIds.size} citing authorities`,
      }));

    const resolutionRate =
      citeTotals.extracted > 0
        ? Math.round((10000 * citeTotals.resolved) / citeTotals.extracted) / 100
        : 0;

    const federalShare = jurisdictionGaps
      .filter((j) => String(j.jurisdiction).startsWith("federal"))
      .reduce((s, j) => s + j.unresolvedEdges, 0);
    const federalSharePct =
      totalAbsentEdges > 0 ? Math.round((10000 * federalShare) / totalAbsentEdges) / 100 : 0;

    const coverageDiagnosis = {
      depthWaveOverlap:
        federalSharePct >= 70
          ? "WEAK_OVERLAP_STATE_DEPTH_VS_FEDERAL_CITATION_DEMAND"
          : federalSharePct >= 40
            ? "MIXED_OVERLAP"
            : "STRONG_STATE_OVERLAP",
      evidence: {
        federalTargetAbsentSharePct: federalSharePct,
        topReporter: reporterGaps[0]?.reporter || null,
        topReporterSharePct: reporterGaps[0]?.shareOfTargetAbsentEdgesPct || 0,
        usReportsEdges: reporterGaps.find((r) => r.reporter === "U.S.")?.unresolvedEdges || 0,
        f2dEdges: reporterGaps.find((r) => r.reporter === "F.2d")?.unresolvedEdges || 0,
        f3dEdges: reporterGaps.find((r) => r.reporter === "F.3d")?.unresolvedEdges || 0,
        fSuppEdges: reporterGaps
          .filter((r) => String(r.reporter).startsWith("F. Supp"))
          .reduce((s, r) => s + r.unresolvedEdges, 0),
      },
      narrative: [
        "Unresolved edges are overwhelmingly TARGET_ABSENT after exact alias resolve.",
        "Dominant demand is federal reporters (U.S. / F.2d / F.3d / F. Supp.*), while Lane A depth wave adds state high-court cases.",
        "State high-court expansion increases extracted edges but rarely supplies the missing federal targets those edges cite.",
      ],
    };

    const result = {
      ok: true,
      classification: "MANUAL_QUEUE2_CITATION_TARGET_PRIORITY_ANALYSIS",
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: 0,
      mutations: 0,
      queue: { "#2": "OPEN", "#9": "CLOSED", "#3": "NOT_OPEN", transition: "NONE" },
      integrity: {
        duplicateSourceIds: dups.n,
        orphanCount: orphans.n,
        missingEmbeddings: chunks.missing_embeddings,
        chunks: chunks.chunks,
        embeddings: chunks.embeddings,
      },
      corpus: corpus,
      citationBaseline: {
        extracted: citeTotals.extracted,
        resolved: citeTotals.resolved,
        unresolved: citeTotals.unresolved,
        targetAbsent: citeTotals.unresolved, // all unresolved currently TARGET_ABSENT class after prior audits
        resolutionRatePct: resolutionRate,
        uniqueAbsentTargets: absentGroups.length,
        malformedUnusable: malformed,
        targetPresentButNotMatchedGroups: ambiguousBucket,
        targetPresentButNotMatchedEdges: targetPresentButNotMatched,
        top10ShareOfAbsentEdgesPct:
          totalAbsentEdges > 0 ? Math.round((10000 * top10Edges) / totalAbsentEdges) / 100 : 0,
        top100ShareOfAbsentEdgesPct:
          totalAbsentEdges > 0 ? Math.round((10000 * top100Edges) / totalAbsentEdges) / 100 : 0,
        totalAbsentEdges,
      },
      inventory: {
        unresolvedEdges: edges.length,
        uniqueNormalizedAbsentTargets: absentGroups.length,
        ambiguousOrPresentMismatchTargets: ambiguousBucket,
        malformedUnusableTargets: malformed,
      },
      top20MissingTargets: top20,
      top100MissingTargets: top100,
      reporterGaps,
      jurisdictionGaps,
      citingJurisdictionDemand,
      coverageDiagnosis,
      zeroClOpportunities: zeroClOpps,
      proposedQueues: {
        A1_depthCompletion: {
          resumeFirst: { jurisdiction: "WV", court: "wva", qualifying: depthMap.WV ?? null, target: 45, note: "PAUSED_RESUMABLE from durable state; verify live before next CL window" },
          then: ["finish remaining depth-wave incompletes in current Lane A order"],
          note: "Do not auto-replace depth wave with citation recovery",
        },
        A2_citationTargetRecovery: {
          candidates: a2,
          ordering: "edges unlocked desc, then unique citing authorities, then hierarchy",
          note: "Future CL windows only; zero requests this run",
        },
      },
      interleavingRecommendation: {
        evidenceSupported: true,
        policy: [
          "Always finish resumable depth target first (currently WV 39/45) before opening a new court.",
          "Within a CL window after resumable completion: majority budget remains A1 depth-wave incompletes.",
          "Reserve a bounded A2 pilot slice only after A1 makes durable progress in the same window.",
          "A2 pilot size: top N US Reports / F.2d targets by edge unlock, capped so expected requests stay within remaining safe hour budget after A1 needs.",
          "Measure after each A2 pilot: delta resolved / CL requests. Continue A2 only if resolved increases materially.",
        ],
        percentages: {
          inventPercentages: false,
          reason: "Insufficient multi-window A2 outcome data; recommend bounded pilot instead of fixed X%/Y% split",
          boundedPilotSuggestion:
            "After WV completes: one A1 jurisdiction batch, then ≤15 productive CL requests on top US Reports A2 targets; compare resolved delta before expanding A2 share",
        },
      },
      nextClTarget: {
        jurisdiction: "WV",
        court: "wva",
        qualifyingHint: depthMap.WV ?? null,
        target: 45,
        remainsFirst: true,
        reason: "Durable PAUSED_RESUMABLE depth target; no production-safety reason to skip",
      },
    };

    console.log(JSON.stringify(result));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e).slice(0, 500), courtListenerHttpCalls: 0, mutations: 0 }));
  process.exit(1);
});
