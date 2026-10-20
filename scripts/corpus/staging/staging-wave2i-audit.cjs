/**
 * Wave 2I — precise broader_corpus blockers + rule-depth + refresh classification (read staging DB).
 */
"use strict";

const postgres = require("postgres");

const FAMILIES = [
  "limitations",
  "contracts_commercial",
  "corporations_business",
  "employment",
  "consumer_protection",
  "property_landlord_tenant",
  "civil_procedure_jurisdiction",
  "evidence",
  "privacy_data",
  "licensing_admin_procedure",
];

function classifyFamily(topic, areas, citation, title) {
  const blob = `${topic || ""} ${(areas || []).join(" ")} ${citation || ""} ${title || ""}`.toLowerCase();
  if (/limit|5525|95\.11/.test(blob)) return "limitations";
  if (/ucc|warranty|contract|merchant|commercial/.test(blob)) return "contracts_commercial";
  if (/corp|director|llc|shareholder|dgcl|entity/.test(blob)) return "corporations_business";
  if (/wage|employ|overtime|labor|unemploy|minimum.?wage/.test(blob)) return "employment";
  if (/consumer|deceptive|unfair.?trade|udtpa|1345|fraud.?act/.test(blob)) return "consumer_protection";
  if (/landlord|tenant|lease|evict|property|habitab/.test(blob)) return "property_landlord_tenant";
  if (/admin|licensing|apa\b|administrative/.test(blob)) return "licensing_admin_procedure";
  if (/jurisdict|venue|long.?arm|plead|dismiss|negligen|fault/.test(blob)) {
    return "civil_procedure_jurisdiction";
  }
  if (/\bprocedure\b/.test(blob) && !/admin/.test(blob)) return "civil_procedure_jurisdiction";
  if (/eviden|hearsay|witness|competenc|relevance/.test(blob)) return "evidence";
  if (/privacy|breach|personal.?info|data.?secur|shield/.test(blob)) return "privacy_data";
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const rows = await sql`
      select id, authority_type, authority_state, jurisdiction, court, citation, title,
             canonical_source_url, currentness_status, last_checked_at, source_provider,
             metadata, normalized_citation
      from legal_authorities
    `;

    const byJur = {};
    for (const r of rows) {
      const j = r.authority_state || (String(r.jurisdiction || "").toLowerCase().includes("united") ? "US" : r.jurisdiction) || "UNK";
      if (!byJur[j]) {
        byJur[j] = {
          authorities: 0,
          statutes: 0,
          cases: 0,
          regulations: 0,
          rules: 0,
          withUrl: 0,
          currentKnown: 0,
          highCourt: 0,
          appellate: 0,
          subjects: new Set(),
          ruleCivil: 0,
          ruleEvid: 0,
          ruleApp: 0,
        };
      }
      const b = byJur[j];
      b.authorities += 1;
      if (r.authority_type === "statute") b.statutes += 1;
      if (r.authority_type === "case") b.cases += 1;
      if (r.authority_type === "regulation") b.regulations += 1;
      if (r.authority_type === "rule") b.rules += 1;
      if (r.canonical_source_url) b.withUrl += 1;
      if (r.currentness_status && r.currentness_status !== "unknown") b.currentKnown += 1;
      const court = String(r.court || "").toLowerCase();
      if (r.authority_type === "case") {
        if (/supreme|high court/.test(court)) b.highCourt += 1;
        if (/appeal|appellate|circuit|app\./.test(court)) b.appellate += 1;
      }
      if (r.authority_type === "statute") {
        let areas = r.metadata?.bundlePracticeAreas;
        if (typeof areas === "string") {
          try {
            areas = JSON.parse(areas);
          } catch {
            areas = [];
          }
        }
        const fam = classifyFamily(r.metadata?.statuteTopic, areas, r.citation, r.title);
        if (fam) b.subjects.add(fam);
      }
      if (r.authority_type === "rule") {
        const c = `${r.citation || ""} ${r.metadata?.ruleFamily || ""} ${r.metadata?.statuteTopic || ""}`;
        if (/evid|evidence|relevance/i.test(c)) b.ruleEvid += 1;
        else if (/app\.|appellate|rap\b|notice of appeal/i.test(c)) b.ruleApp += 1;
        else b.ruleCivil += 1;
      }
    }

    const blockersByType = {};
    const perJur = {};
    const closest = [];
    for (const [j, b] of Object.entries(byJur)) {
      const urlPct = b.authorities ? Math.round((100 * b.withUrl) / b.authorities) : 0;
      const curPct = b.authorities ? Math.round((100 * b.currentKnown) / b.authorities) : 0;
      const blockers = [];
      if (!(b.authorities > 100)) blockers.push("authority_count_below_or_eq_100");
      if (b.statutes < 15) blockers.push("statute_count_below_15");
      if (b.cases < 20) blockers.push("case_count_below_20");
      if (b.regulations + b.rules < 1) blockers.push("no_reg_or_rule");
      if (b.highCourt + b.appellate < 1) blockers.push("no_high_or_appellate");
      if (urlPct < 80) blockers.push("canonical_url_below_80");
      if (curPct < 40) blockers.push("currentness_below_40");
      if (b.subjects.size < 6) blockers.push("statute_subjects_below_6");
      for (const k of blockers) blockersByType[k] = (blockersByType[k] || 0) + 1;

      let ruleDepth = "MINIMAL_ONLY";
      if (b.ruleCivil && b.ruleEvid && b.ruleApp) ruleDepth = "COMPLETE_CORE";
      else if (b.rules && !b.ruleCivil) ruleDepth = "MISSING_CIVIL";
      else if (b.ruleCivil && !b.ruleEvid && b.ruleApp) ruleDepth = "MISSING_EVIDENCE";
      else if (b.ruleCivil && b.ruleEvid && !b.ruleApp) ruleDepth = "MISSING_APPELLATE";
      else if (b.ruleCivil && !b.ruleEvid && !b.ruleApp) ruleDepth = "MINIMAL_ONLY";

      perJur[j] = {
        authorities: b.authorities,
        statutes: b.statutes,
        cases: b.cases,
        regulations: b.regulations,
        rules: b.rules,
        subjects: b.subjects.size,
        subjectList: [...b.subjects].sort(),
        urlPct,
        curPct,
        blockers,
        ruleDepth,
        ruleCivil: b.ruleCivil,
        ruleEvid: b.ruleEvid,
        ruleApp: b.ruleApp,
        broaderEligible: blockers.length === 0,
      };
      closest.push({ j, missing: blockers.length, blockers, cases: b.cases, authorities: b.authorities });
    }
    closest.sort((a, b) => a.missing - b.missing || b.cases - a.cases);

    const ruleDepthCounts = {};
    for (const v of Object.values(perJur)) {
      ruleDepthCounts[v.ruleDepth] = (ruleDepthCounts[v.ruleDepth] || 0) + 1;
    }

    const refresh = {
      AUTO_REFRESH: ["ecfr", "usc_periodic"],
      REIMPORT_REFRESH: ["us_primary_corpus_bundles", "state_regulation_configs", "court_rules_curated"],
      MANUAL_REFRESH: ["constitution_static", "one_shot_historical"],
      EXTERNAL_BLOCKED: ["courtlistener"],
    };

    const currentness = {};
    for (const r of rows) {
      const s = r.currentness_status || "null";
      currentness[s] = (currentness[s] || 0) + 1;
    }
    const lastChecked = rows.filter((r) => r.last_checked_at).length;

    console.log(
      JSON.stringify({
        ok: true,
        wave: "2I",
        total: rows.length,
        broaderCount: Object.values(perJur).filter((x) => x.broaderEligible).length,
        blockersByType,
        closestToBroader: closest.slice(0, 15),
        ruleDepthCounts,
        currentness,
        lastChecked,
        lastCheckedPct: Math.round((100 * lastChecked) / rows.length),
        refresh,
        sampleJurisdictions: Object.fromEntries(
          ["PA", "CA", "NY", "TX", "AL", "MA", "AZ", "RI", "WV", "US"].map((j) => [j, perJur[j]]),
        ),
        meets6Subjects: Object.values(perJur).filter((x) => x.subjects >= 6).length,
        licensingGaps: Object.entries(perJur)
          .filter(([, v]) => v.statutes > 0 && !v.subjectList.includes("licensing_admin_procedure"))
          .map(([j]) => j)
          .slice(0, 40),
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e).slice(0, 800) }));
  process.exit(1);
});
