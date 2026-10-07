#!/usr/bin/env node
/**
 * Repair Unknown Court / st-unknown on Batch2 acquisitions.
 * Uses opinion→cluster CL lookups with hard budget; falls back to citation-family.
 * Stops immediately on 429.
 */
"use strict";
const postgres = require("postgres");
const fs = require("node:fs");
const path = require("node:path");

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const CIRCUIT_MAP = {
  scotus: { courtId: "us-scotus", courtLevel: "scotus", authorityState: "US", courtName: "Supreme Court of the United States", federalCircuit: null },
  ca1: { courtId: "us-ca-1", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the First Circuit", federalCircuit: "1" },
  ca2: { courtId: "us-ca-2", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Second Circuit", federalCircuit: "2" },
  ca3: { courtId: "us-ca-3", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Third Circuit", federalCircuit: "3" },
  ca4: { courtId: "us-ca-4", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Fourth Circuit", federalCircuit: "4" },
  ca5: { courtId: "us-ca-5", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Fifth Circuit", federalCircuit: "5" },
  ca6: { courtId: "us-ca-6", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Sixth Circuit", federalCircuit: "6" },
  ca7: { courtId: "us-ca-7", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Seventh Circuit", federalCircuit: "7" },
  ca8: { courtId: "us-ca-8", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Eighth Circuit", federalCircuit: "8" },
  ca9: { courtId: "us-ca-9", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Ninth Circuit", federalCircuit: "9" },
  ca10: { courtId: "us-ca-10", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Tenth Circuit", federalCircuit: "10" },
  ca11: { courtId: "us-ca-11", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Eleventh Circuit", federalCircuit: "11" },
  cadc: { courtId: "us-ca-dc", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the District of Columbia Circuit", federalCircuit: "dc" },
  cafc: { courtId: "us-ca-fed", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Federal Circuit", federalCircuit: "fed" },
  paed: { courtId: "us-d-paed", courtLevel: "district", authorityState: "US", courtName: "United States District Court for the Eastern District of Pennsylvania", federalCircuit: "3" },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function normalizeClCourtKey(raw) {
  let key = String(raw || "").toLowerCase();
  if (key.includes("/")) key = key.split("/").filter(Boolean).pop() || key;
  return key.replace(/[^a-z0-9]/g, "");
}
function fromCitation(citation) {
  const c = String(citation || "");
  if (/\bF\.(2d|3d|4th)\b/i.test(c)) {
    return {
      courtId: "us-circuit-unspecified",
      courtLevel: "circuit",
      authorityState: "US",
      courtName: "United States Court of Appeals (circuit pending cluster repair)",
      federalCircuit: null,
      jurisdiction: "United States",
      method: "citation_family_federal_reporter",
    };
  }
  if (/\bF\.?\s*Supp/i.test(c)) {
    return {
      courtId: "us-district-unspecified",
      courtLevel: "district",
      authorityState: "US",
      courtName: "United States District Court (district pending cluster repair)",
      federalCircuit: null,
      jurisdiction: "United States",
      method: "citation_family_federal_supplement",
    };
  }
  if (/\bA\.(2d|3d)\b/i.test(c)) {
    return {
      courtId: "st-regional-a",
      courtLevel: "state_high",
      authorityState: null,
      courtName: "State high court (A. reporter; jurisdiction pending cluster repair)",
      federalCircuit: null,
      jurisdiction: "Unknown",
      method: "citation_family_a_reporter",
    };
  }
  return null;
}
function mapFromCluster(cluster) {
  if (!cluster) return null;
  const key = normalizeClCourtKey(cluster.court_id || cluster.court);
  if (CIRCUIT_MAP[key]) return { ...CIRCUIT_MAP[key], jurisdiction: "United States", method: `cl_cluster_${key}`, clKey: key };
  const courtName = String(cluster.court || key || "").slice(0, 200);
  if (/third circuit/i.test(courtName)) return { ...CIRCUIT_MAP.ca3, jurisdiction: "United States", method: "cl_name_ca3", clKey: key };
  if (/eastern district of pennsylvania/i.test(courtName)) return { ...CIRCUIT_MAP.paed, jurisdiction: "United States", method: "cl_name_paed", clKey: key };
  if (/supreme court of pennsylvania/i.test(courtName)) {
    return { courtId: "st-pa-high", courtLevel: "state_high", authorityState: "PA", courtName: "Supreme Court of Pennsylvania", federalCircuit: null, jurisdiction: "Pennsylvania", method: "cl_name_pa_high", clKey: key };
  }
  if (/superior court of pennsylvania/i.test(courtName)) {
    return { courtId: "st-pa-super", courtLevel: "state_appellate", authorityState: "PA", courtName: "Superior Court of Pennsylvania", federalCircuit: null, jurisdiction: "Pennsylvania", method: "cl_name_pa_super", clKey: key };
  }
  if (/circuit|court of appeals/i.test(courtName) || /^ca\d|^cadc|^cafc/.test(key)) {
    return {
      courtId: key ? `us-${key}` : "us-circuit-unspecified",
      courtLevel: "circuit",
      authorityState: "US",
      courtName: courtName || "United States Court of Appeals",
      federalCircuit: null,
      jurisdiction: "United States",
      method: "cl_generic_circuit",
      clKey: key,
    };
  }
  if (/district/i.test(courtName) || /^d[a-z]/.test(key)) {
    return {
      courtId: key ? `us-${key}` : "us-district-unspecified",
      courtLevel: "district",
      authorityState: "US",
      courtName: courtName || "United States District Court",
      federalCircuit: null,
      jurisdiction: "United States",
      method: "cl_generic_district",
      clKey: key,
    };
  }
  return null;
}

async function clGet(url, apiKey, counters) {
  const rateMs = Math.max(Number(process.env.CL_RATE_MS || 4000), 4000);
  const wait = rateMs - (Date.now() - (counters.lastAt || 0));
  if (wait > 0) await sleep(wait);
  counters.apiCalls += 1;
  counters.lastAt = Date.now();
  const res = await fetch(url, {
    headers: { Authorization: `Token ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(60000),
  });
  if (res.status === 429) {
    counters.rateLimited = true;
    counters.retryAfter = res.headers.get("retry-after");
    return null;
  }
  if (!res.ok) return null;
  return res.json();
}

async function resolveCourtViaCl(opinionId, apiKey, counters) {
  const opinion = await clGet(`${CL_BASE}/opinions/${opinionId}/`, apiKey, counters);
  if (!opinion || counters.rateLimited) return null;
  let cluster = null;
  let clusterId = null;
  const cField = opinion.cluster;
  if (typeof cField === "string" && /\/clusters\/(\d+)/.test(cField)) {
    clusterId = cField.match(/\/clusters\/(\d+)/)[1];
  } else if (typeof cField === "number") {
    clusterId = String(cField);
  } else if (cField && typeof cField === "object") {
    cluster = cField;
    clusterId = cField.id != null ? String(cField.id) : null;
  }
  if (!cluster && clusterId && !counters.rateLimited) {
    cluster = await clGet(`${CL_BASE}/clusters/${clusterId}/`, apiKey, counters);
  }
  const mapped = mapFromCluster(cluster);
  if (mapped) return { ...mapped, clusterId };
  // Opinion sometimes embeds court
  const key = normalizeClCourtKey(opinion.court_id || opinion.court);
  if (CIRCUIT_MAP[key]) return { ...CIRCUIT_MAP[key], jurisdiction: "United States", method: `cl_opinion_${key}`, clKey: key, clusterId };
  return null;
}

async function main() {
  const maxCl = Math.min(Math.max(Number(process.env.BATCH2_COURT_REPAIR_MAX_CL || 50), 0), 54);
  const apiKey = process.env.COURTLISTENER_API_KEY?.trim();
  if (!apiKey) {
    console.log(JSON.stringify({ ok: false, reason: "COURTLISTENER_API_KEY missing" }));
    process.exit(2);
  }
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 40 });
  const counters = { apiCalls: 0, lastAt: 0, rateLimited: false, retryAfter: null };
  const repaired = [];
  try {
    const rows = await sql`
      select id, citation, normalized_citation, source_external_id, metadata, court, court_id
      from legal_authorities
      where authority_type = 'case'
        and (court = 'Unknown Court' or court_id in ('st-unknown', 'us-unknown'))
        and created_at > now() - interval '6 hours'
      order by created_at desc
    `;

    for (const row of rows) {
      const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata || {};
      let mapped = null;
      const opinionId = (String(row.source_external_id || "").match(/cl-opinion-(\d+)/) || [])[1];

      if (opinionId && counters.apiCalls < maxCl && !counters.rateLimited) {
        mapped = await resolveCourtViaCl(opinionId, apiKey, counters);
      }
      if (!mapped) mapped = fromCitation(row.citation || row.normalized_citation);
      if (!mapped) continue;

      const nextMeta = {
        ...meta,
        clusterId: mapped.clusterId || meta.clusterId || null,
        clCourt: mapped.clKey || mapped.method || meta.clCourt,
        courtRepair: {
          at: new Date().toISOString(),
          method: mapped.method,
          previousCourt: row.court,
          previousCourtId: row.court_id,
        },
      };

      await sql`
        update legal_authorities
        set court = ${mapped.courtName},
            court_id = ${mapped.courtId},
            court_level = ${mapped.courtLevel},
            authority_state = ${mapped.authorityState},
            federal_circuit = ${mapped.federalCircuit},
            jurisdiction = ${mapped.jurisdiction || "United States"},
            metadata = ${sql.json(nextMeta)},
            updated_at = now()
        where id = ${row.id}
      `;
      repaired.push({
        id: row.id,
        citation: row.citation,
        method: mapped.method,
        courtId: mapped.courtId,
        court: mapped.courtName,
      });
      if (counters.rateLimited) break;
    }

    const stillBad = await sql`
      select count(*)::int as n from legal_authorities
      where authority_type='case'
        and (court='Unknown Court' or court_id in ('st-unknown','us-unknown'))
        and created_at > now() - interval '6 hours'
    `;

    const byMethod = {};
    for (const r of repaired) byMethod[r.method] = (byMethod[r.method] || 0) + 1;

    const out = {
      ok: stillBad[0].n === 0,
      classification: "CORPUS_DAILY_V2_BATCH2_COURT_REPAIR",
      candidates: rows.length,
      repaired: repaired.length,
      remainingUnknown: stillBad[0].n,
      courtListenerHttpCalls: counters.apiCalls,
      rateLimited: counters.rateLimited,
      retryAfter: counters.retryAfter,
      byMethod,
      sample: repaired.slice(0, 20),
    };
    fs.writeFileSync(
      path.join(__dirname, "..", "packages/research/corpus/reports/corpus-daily-v2-batch2-court-repair.json"),
      JSON.stringify({ ...out, repaired }, null, 2),
    );
    console.log(JSON.stringify(out));
    process.exit(out.ok || repaired.length > 0 ? 0 : 1);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 800) }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
