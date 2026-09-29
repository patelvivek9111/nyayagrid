/**
 * Queue #2 production corpus gap map — ZERO CourtListener HTTP.
 * Read-only DB + optional non-CL source probes (House/eCFR/uscourts).
 *
 * Usage: node tmp-queue2-production-gap-map.cjs [--probe-sources]
 */
"use strict";
const postgres = require("postgres");

const PROBE = process.argv.includes("--probe-sources");

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseUsc(raw) {
  const m = /\b(\d{1,2})\s+U\.?\s?S\.?\s?C\.?\s*§+\s*([\dA-Za-z.\-]+)/i.exec(String(raw || ""));
  return m ? { title: Number(m[1]), section: m[2].replace(/\.+$/, ""), citation: `${m[1]} U.S.C. § ${m[2].replace(/\.+$/, "")}` } : null;
}
function parseCfr(raw) {
  const m = /\b(\d{1,2})\s+C\.?\s?F\.?\s?R\.?\s*§*\s*(\d+(?:\.\d+)*)/i.exec(String(raw || ""));
  return m ? { title: Number(m[1]), section: m[2], citation: `${m[1]} C.F.R. § ${m[2]}` } : null;
}
function parseFedR(raw) {
  const m = /\bFed\.?\s*R\.?\s*(Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s*(\d+[A-Za-z.]*)\b/i.exec(String(raw || ""));
  if (!m) return null;
  const kindRaw = m[1].replace(/\s+/g, " ").trim().toLowerCase();
  let reporter = "Fed. R. Civ. P.";
  let path = "rules-civil-procedure";
  if (/^evid/i.test(kindRaw)) {
    reporter = "Fed. R. Evid.";
    path = "rules-evidence";
  } else if (/^app/i.test(kindRaw)) {
    reporter = "Fed. R. App. P.";
    path = "rules-appellate-procedure";
  } else if (/^crim/i.test(kindRaw)) {
    reporter = "Fed. R. Crim. P.";
    path = "rules-criminal-procedure";
  }
  return { kind: kindRaw, rule: m[2], citation: `${reporter} ${m[2]}`, path, reporter };
}

function classifyAbsentFamily(c) {
  const t = String(c || "").replace(/\s+/g, " ").trim();
  if (/^\d{1,3}\s+U\.\s*S\.\s+\d/i.test(t)) return "us_reports";
  if (/\bF\.\s*4th\b/i.test(t)) return "f4th";
  if (/\bF\.\s*3d\b/i.test(t)) return "f3d";
  if (/\bF\.\s*2d\b/i.test(t)) return "f2d";
  if (/\bF\.\s*Supp/i.test(t)) return "f_supp";
  if (/\bU\.\s*S\.\s*C\./i.test(t) || parseUsc(t)) return "usc";
  if (/\bC\.\s*F\.\s*R\./i.test(t) || parseCfr(t)) return "cfr";
  if (/^Fed\.\s*R\./i.test(t) || parseFedR(t)) return "federal_rules";
  return "other";
}

const CIRCUIT_COURTS = [
  "us-ca-1", "us-ca-2", "us-ca-3", "us-ca-4", "us-ca-5", "us-ca-6", "us-ca-7",
  "us-ca-8", "us-ca-9", "us-ca-10", "us-ca-11", "us-ca-dc", "us-ca-fed",
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_db", courtListenerHttpCalls: 0 }));
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
    const [orphans] = await sql`select count(*)::int as n from legal_authority_chunks c left join legal_authorities a on a.id=c.authority_id where a.id is null`;
    const [dupes] = await sql`select count(*)::int as n from (select 1 from legal_authorities where source_external_id is not null group by source_provider, source_external_id having count(*)>1) d`;
    const [cite] = await sql`
      select count(*)::int as extracted,
             count(*) filter (where to_authority_id is not null)::int as resolved,
             count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;

    const absentRows = await sql`
      select coalesce(normalized_citation, raw_citation) as cite,
             count(*)::int as edges,
             count(distinct from_authority_id)::int as citing
      from legal_authority_citations
      where to_authority_id is null and coalesce(normalized_citation, raw_citation) is not null
      group by 1
    `;
    const familyAbsent = { us_reports: 0, f3d: 0, f2d: 0, f4th: 0, f_supp: 0, usc: 0, cfr: 0, federal_rules: 0, other: 0 };
    const byFamily = { usc: [], cfr: [], federal_rules: [], us_reports: [], f3d: [], f2d: [], f4th: [] };
    for (const r of absentRows) {
      const fam = classifyAbsentFamily(r.cite);
      familyAbsent[fam] = (familyAbsent[fam] || 0) + r.edges;
      if (byFamily[fam]) byFamily[fam].push(r);
    }
    for (const k of Object.keys(byFamily)) byFamily[k].sort((a, b) => b.edges - a.edges);

    // Federal layer depth
    const federalLayers = await sql`
      select
        case
          when court_level = 'scotus' or court_id = 'us-scotus' then 'scotus'
          when court_level = 'circuit' or court_id like 'us-ca-%' then coalesce(court_id, 'circuit_unknown')
          when court_level in ('district','federal_district') or court_id like 'us-d-%' then 'district_aggregate'
          else 'other_federal'
        end as layer,
        count(*)::int as authorities,
        count(*) filter (where authority_type='case')::int as cases,
        min(extract(year from decision_date)::int) filter (where authority_type='case') as earliest,
        max(extract(year from decision_date)::int) filter (where authority_type='case') as latest
      from legal_authorities
      where authority_state = 'US' or jurisdiction ilike 'United States%' or court_level in ('scotus','circuit','district','federal_district')
      group by 1
      order by 1
    `;

    const perCircuit = await sql`
      select coalesce(court_id, 'unknown') as court_id,
             coalesce(court, court_id) as court_name,
             count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases,
             min(extract(year from decision_date)::int) filter (where authority_type='case') as earliest,
             max(extract(year from decision_date)::int) filter (where authority_type='case') as latest
      from legal_authorities
      where court_level = 'circuit' or court_id = any(${CIRCUIT_COURTS})
      group by 1, 2
      order by cases desc
    `;

    const scotus = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases,
             min(extract(year from decision_date)::int) as earliest,
             max(extract(year from decision_date)::int) as latest
      from legal_authorities
      where court_level = 'scotus' or court_id = 'us-scotus'
    `;

    const district = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases,
             min(extract(year from decision_date)::int) as earliest,
             max(extract(year from decision_date)::int) as latest
      from legal_authorities
      where court_level in ('district','federal_district') or court_id like 'us-d-%'
    `;

    // State historical + appellate
    const states = await sql`
      select
        coalesce(nullif(btrim(authority_state),''),'??') as j,
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='case' and court_level in ('state_high','scotus'))::int as high,
        count(*) filter (where authority_type='case' and court_level in ('state_appellate'))::int as intermediate,
        min(extract(year from decision_date)::int) filter (where authority_type='case') as earliest,
        max(extract(year from decision_date)::int) filter (where authority_type='case') as latest,
        count(*) filter (where authority_type='case' and extract(year from decision_date) < 2000)::int as pre2000,
        count(*) filter (where authority_type='case' and extract(year from decision_date) < 1980)::int as pre1980,
        count(*) filter (where authority_type='case' and decision_date is null)::int as missing_decision_date
      from legal_authorities
      where authority_state is not null and authority_state <> 'US' and length(btrim(authority_state))=2
      group by 1
      order by 1
    `;

    const historicalGaps = states
      .map((s) => {
        const span = (s.latest || 0) - (s.earliest || 0);
        const recentHeavy = s.earliest != null && s.earliest >= 2000;
        const thinPre2000 = Number(s.pre2000 || 0) === 0 && Number(s.cases || 0) >= 20;
        const narrowBand = span >= 0 && span < 10 && Number(s.cases || 0) >= 20;
        let gap = null;
        if (recentHeavy && thinPre2000) gap = "missing_pre-2000";
        else if (s.earliest != null && s.earliest >= 1980 && Number(s.pre1980 || 0) === 0) gap = "missing_pre-1980";
        else if (narrowBand) gap = "narrow_year_band";
        else if (Number(s.cases || 0) > 0 && Number(s.cases || 0) < 30) gap = "historically_thin";
        const impact =
          (thinPre2000 ? 40 : 0) +
          (recentHeavy ? 20 : 0) +
          (narrowBand ? 15 : 0) +
          Math.min(30, Number(s.cases || 0) / 2);
        return {
          jurisdiction: s.j,
          earliestYear: s.earliest,
          latestYear: s.latest,
          currentCount: s.cases,
          high: s.high,
          intermediate: s.intermediate,
          pre2000: s.pre2000,
          pre1980: s.pre1980,
          historicalGap: gap,
          impactScore: Math.round(impact),
          recommendedPath: gap ? "B2_HISTORICAL_GAP_RECOVERY (CL depth/date-window or zero-CL archive if available)" : null,
        };
      })
      .filter((r) => r.historicalGap)
      .sort((a, b) => b.impactScore - a.impactScore || b.currentCount - a.currentCount);

    const appellateGaps = states
      .map((s) => ({
        jurisdiction: s.j,
        highCourtCases: s.high,
        intermediateCases: s.intermediate,
        totalCases: s.cases,
        material: Number(s.high || 0) >= 20 && Number(s.intermediate || 0) < 5,
        thin: Number(s.high || 0) >= 20 && Number(s.intermediate || 0) < 15,
        impactScore:
          (Number(s.high || 0) >= 40 ? 30 : 15) +
          (Number(s.intermediate || 0) === 0 ? 40 : Number(s.intermediate || 0) < 5 ? 25 : 0) +
          Math.min(20, Number(s.cases || 0) / 5),
      }))
      .filter((r) => r.thin)
      .sort((a, b) => b.impactScore - a.impactScore);

    // Currentness / metadata
    const [currentness] = await sql`
      select
        count(*) filter (where currentness_status = 'historical')::int as historical,
        count(*) filter (where currentness_status = 'current_as_of_source_date')::int as current_as_of_source_date,
        count(*) filter (where currentness_status = 'unknown' or currentness_status is null)::int as unknown,
        count(*) filter (where last_checked_at is not null)::int as last_checked_present,
        count(*) filter (where last_checked_at is null)::int as last_checked_missing
      from legal_authorities
    `;
    const [caseMeta] = await sql`
      select
        count(*)::int as case_total,
        count(*) filter (where court_id is null or btrim(court_id)='')::int as missing_court_id,
        count(*) filter (where court_level is null or btrim(court_level)='')::int as missing_court_level,
        count(*) filter (where decision_date is null)::int as missing_decision_date
      from legal_authorities
      where authority_type = 'case'
    `;
    const [nonCaseMeta] = await sql`
      select
        count(*)::int as noncase_total,
        count(*) filter (where court_id is null or btrim(court_id)='')::int as missing_court_id_expected,
        count(*) filter (where decision_date is null)::int as missing_decision_date_expected
      from legal_authorities
      where authority_type <> 'case'
    `;

    // Primary authority present
    const [primaryPresent] = await sql`
      select
        count(*) filter (where authority_type='statute' and (normalized_citation ~* 'U\\.\\s*S\\.\\s*C' or citation ~* 'U\\.\\s*S\\.\\s*C'))::int as usc_authorities,
        count(*) filter (where authority_type='regulation' and (normalized_citation ~* 'C\\.\\s*F\\.\\s*R' or citation ~* 'C\\.\\s*F\\.\\s*R'))::int as cfr_authorities,
        count(*) filter (where authority_type='rule' and (normalized_citation ~* 'Fed\\.\\s*R\\.' or citation ~* 'Fed\\.\\s*R\\.'))::int as federal_rules_authorities
      from legal_authorities
    `;

    // Top B1 candidates
    const topUsc = byFamily.usc.slice(0, 20).map((r) => ({ ...parseUsc(r.cite), edges: r.edges, citing: r.citing, cite: r.cite }));
    const topCfr = byFamily.cfr.slice(0, 20).map((r) => ({ ...parseCfr(r.cite), edges: r.edges, citing: r.citing, cite: r.cite }));
    const topFed = byFamily.federal_rules.slice(0, 20).map((r) => ({ ...parseFedR(r.cite), edges: r.edges, citing: r.citing, cite: r.cite }));

    // Source probes (non-CL only)
    const sourceProbes = { enabled: PROBE, usc: [], cfr: [], federal_rules: [] };
    if (PROBE) {
      for (const row of topUsc.filter(Boolean).slice(0, 5)) {
        if (!row.title) continue;
        const page = `https://uscode.house.gov/view.xhtml?req=${encodeURIComponent(`granuleid:USC-prelim-title${row.title}-section${row.section}&num=${row.section}&edition=prelim`)}`;
        try {
          const res = await fetch(page, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(25000) });
          const text = stripHtml(await res.text());
          sourceProbes.usc.push({
            citation: row.citation,
            http: res.status,
            chars: text.length,
            primaryTextLikely: res.ok && text.length >= 80,
            url: page,
          });
        } catch (e) {
          sourceProbes.usc.push({ citation: row.citation, error: String(e.message || e).slice(0, 120) });
        }
      }
      let ecfrDate = new Date().toISOString().slice(0, 10);
      try {
        const titles = await fetch("https://www.ecfr.gov/api/versioner/v1/titles.json", {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(20000),
        });
        if (titles.ok) {
          const j = await titles.json();
          if (j?.meta?.date) ecfrDate = j.meta.date;
        }
      } catch {
        /* keep */
      }
      for (const row of topCfr.filter(Boolean).slice(0, 5)) {
        if (!row.title) continue;
        const page = `https://www.ecfr.gov/api/renderer/v1/content/enhanced/${ecfrDate}/title-${row.title}?section=${encodeURIComponent(row.section)}`;
        try {
          const res = await fetch(page, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(25000) });
          const text = stripHtml(await res.text());
          sourceProbes.cfr.push({
            citation: row.citation,
            http: res.status,
            chars: text.length,
            primaryTextLikely: res.ok && text.length >= 80,
            asOfDate: ecfrDate,
            url: page,
          });
        } catch (e) {
          sourceProbes.cfr.push({ citation: row.citation, error: String(e.message || e).slice(0, 120) });
        }
      }
      for (const row of topFed.filter(Boolean).slice(0, 5)) {
        if (!row.path) continue;
        // Known uscourts HTML index — may not expose machine-readable per-rule body.
        const page = `https://www.uscourts.gov/${row.path}`;
        try {
          const res = await fetch(page, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(25000) });
          const text = stripHtml(await res.text());
          const hasRule = new RegExp(`Rule\\s+${row.rule}\\b`, "i").test(text);
          sourceProbes.federal_rules.push({
            citation: row.citation,
            http: res.status,
            chars: text.length,
            ruleMentioned: hasRule,
            primaryTextLikely: false,
            blocker: "No deterministic per-rule primary-text endpoint wired; index page only",
            url: page,
          });
        } catch (e) {
          sourceProbes.federal_rules.push({ citation: row.citation, error: String(e.message || e).slice(0, 120) });
        }
      }
    }

    // A2 opportunistic: density >= 3
    const a2Eligible = [...byFamily.us_reports, ...byFamily.f3d, ...byFamily.f2d, ...byFamily.f4th]
      .filter((r) => r.edges >= 3)
      .sort((a, b) => b.edges - a.edges)
      .slice(0, 30)
      .map((r) => ({
        citation: r.cite,
        edges: r.edges,
        citing: r.citing,
        family: classifyAbsentFamily(r.cite),
        expectedResolutionsPerCl: Number((r.edges / 2.5).toFixed(2)),
        meetsFloor: r.edges / 2.5 >= 3.0 || r.edges >= 8,
      }));

    console.log(
      JSON.stringify({
        ok: true,
        classification: "QUEUE2_PRODUCTION_CORPUS_GAP_MAP",
        generatedAt: new Date().toISOString(),
        courtListenerHttpCalls: 0,
        mutations: 0,
        corpus,
        chunks,
        orphans: orphans[0]?.n || 0,
        duplicateSourceIds: dupes[0]?.n || 0,
        citations: {
          ...cite,
          targetAbsent: cite.unresolved,
          resolutionRatePct: cite.extracted ? Number(((100 * cite.resolved) / cite.extracted).toFixed(2)) : 0,
        },
        familyAbsent,
        primaryAuthorityPresent: primaryPresent[0],
        federal: {
          scotus: scotus[0],
          circuits: perCircuit,
          district: district[0],
          layers: federalLayers,
          citationDemand: {
            us_reports: familyAbsent.us_reports,
            f3d: familyAbsent.f3d,
            f2d: familyAbsent.f2d,
            f4th: familyAbsent.f4th,
            f_supp: familyAbsent.f_supp,
          },
        },
        historicalGapsTop: historicalGaps.slice(0, 15),
        appellateLayerGapsTop: appellateGaps.slice(0, 15),
        currentness: currentness[0],
        caseMetadata: caseMeta[0],
        nonCaseMetadata: nonCaseMeta[0],
        b1Candidates: {
          usc: topUsc.filter(Boolean).slice(0, 10),
          cfr: topCfr.filter(Boolean).slice(0, 10),
          federal_rules: topFed.filter(Boolean).slice(0, 10),
        },
        sourceProbes,
        a2Opportunistic: a2Eligible,
        pathReadiness: {
          USC_DEPTH: {
            implementationExists: true,
            source: "uscode.house.gov viewer HTML",
            mutationGated: true,
            gate: "QUEUE2_LANE_B_ALLOW_MUTATION / allowMutation",
            deterministicIdentity: true,
            machineReadablePrimaryText: "partial (HTML strip; chrome risk)",
            dedupe: "source_provider+external_id and normalized_citation",
            citationLinking: true,
            expectedEdges: familyAbsent.usc,
            safeToEnableBounded: "CONDITIONAL — probe primary text first",
          },
          CFR_DEPTH: {
            implementationExists: true,
            source: "ecfr.gov renderer API",
            mutationGated: true,
            gate: "QUEUE2_LANE_B_ALLOW_MUTATION / allowMutation",
            deterministicIdentity: true,
            machineReadablePrimaryText: "yes (enhanced renderer)",
            dedupe: "source_provider+external_id and normalized_citation",
            citationLinking: true,
            expectedEdges: familyAbsent.cfr,
            safeToEnableBounded: "CONDITIONAL — probe primary text first",
          },
          FEDERAL_RULES_DEPTH: {
            implementationExists: false,
            parseExists: true,
            ingestLoopExists: false,
            source: "uscourts.gov index pages (not per-rule body)",
            mutationGated: true,
            deterministicIdentity: true,
            machineReadablePrimaryText: false,
            expectedEdges: familyAbsent.federal_rules,
            safeToEnableBounded: false,
            blocker: "parseFedR ranks demand but staging-queue2-lane-b.cjs has no federal-rules fetch/ingest loop",
          },
          NON_CL_PRIMARY_AUTHORITY_INTAKE: {
            implementationExists: true,
            sources: ["loc.gov usrep", "usc_house", "ecfr"],
            mutationGated: true,
            usReportsLocLimitation: "often PDF-only / insufficient primary opinion text",
            safeToEnableBounded: false,
          },
        },
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 500), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
