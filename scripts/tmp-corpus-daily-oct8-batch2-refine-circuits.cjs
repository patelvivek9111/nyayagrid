#!/usr/bin/env node
/**
 * Bounded CL exact-circuit refinement for us-circuit-unspecified federal reporter authorities.
 * Uses opinion → cluster court metadata only (no inference from reporter volume/caption).
 * Stops on 429. Writes audit + applies verified updates.
 *
 * Env:
 *   REFINE_MAX_CL (default 80)
 *   CL_RATE_MS (default 4000)
 */
"use strict";
const postgres = require("postgres");
const fs = require("node:fs");
const path = require("node:path");

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const OUT = path.join(__dirname, "..", "packages/research/corpus/reports/corpus-daily-oct8-batch2-circuit-refine.json");

const CIRCUIT_MAP = {
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
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function normalizeClCourtKey(raw) {
  let key = String(raw || "").toLowerCase();
  if (key.includes("/")) key = key.split("/").filter(Boolean).pop() || key;
  return key.replace(/[^a-z0-9]/g, "");
}
function mapFromCluster(cluster) {
  if (!cluster) return null;
  const key = normalizeClCourtKey(cluster.court_id || cluster.court);
  if (CIRCUIT_MAP[key]) return { ...CIRCUIT_MAP[key], method: `cl_cluster_${key}`, clKey: key };
  const courtName = String(cluster.court || "").slice(0, 200);
  const nameMap = [
    [/first circuit/i, "ca1"],
    [/second circuit/i, "ca2"],
    [/third circuit/i, "ca3"],
    [/fourth circuit/i, "ca4"],
    [/fifth circuit/i, "ca5"],
    [/sixth circuit/i, "ca6"],
    [/seventh circuit/i, "ca7"],
    [/eighth circuit/i, "ca8"],
    [/ninth circuit/i, "ca9"],
    [/tenth circuit/i, "ca10"],
    [/eleventh circuit/i, "ca11"],
    [/district of columbia circuit|d\.?c\.? circuit/i, "cadc"],
    [/federal circuit/i, "cafc"],
  ];
  for (const [re, k] of nameMap) {
    if (re.test(courtName) && CIRCUIT_MAP[k]) return { ...CIRCUIT_MAP[k], method: `cl_name_${k}`, clKey: k };
  }
  return null;
}

async function clGet(url, apiKey, counters) {
  if (counters.apiCalls >= counters.maxCalls) return { budget: true };
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
  if (res.status === 502 || res.status === 504) {
    counters.gateway += 1;
    return null;
  }
  if (!res.ok) return null;
  return res.json();
}

function mapFromCourtRef(courtRef, courtIdField) {
  const key = normalizeClCourtKey(courtIdField || courtRef);
  if (CIRCUIT_MAP[key]) return { ...CIRCUIT_MAP[key], method: `cl_docket_${key}`, clKey: key };
  const name = String(courtRef || "");
  const nameMap = [
    [/first circuit/i, "ca1"],
    [/second circuit/i, "ca2"],
    [/third circuit/i, "ca3"],
    [/fourth circuit/i, "ca4"],
    [/fifth circuit/i, "ca5"],
    [/sixth circuit/i, "ca6"],
    [/seventh circuit/i, "ca7"],
    [/eighth circuit/i, "ca8"],
    [/ninth circuit/i, "ca9"],
    [/tenth circuit/i, "ca10"],
    [/eleventh circuit/i, "ca11"],
    [/district of columbia circuit|d\.?c\.? circuit/i, "cadc"],
    [/federal circuit/i, "cafc"],
  ];
  for (const [re, k] of nameMap) {
    if (re.test(name) && CIRCUIT_MAP[k]) return { ...CIRCUIT_MAP[k], method: `cl_docket_name_${k}`, clKey: k };
  }
  return null;
}

async function resolveViaOpinion(opinionId, apiKey, counters) {
  const opinion = await clGet(`${CL_BASE}/opinions/${opinionId}/`, apiKey, counters);
  if (!opinion || opinion.budget || counters.rateLimited) return null;
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
  // CL v4: court is on the docket, not the cluster
  if ((!cluster || !cluster.docket) && clusterId && !counters.rateLimited) {
    cluster = await clGet(`${CL_BASE}/clusters/${clusterId}/`, apiKey, counters);
    if (cluster && cluster.budget) cluster = null;
  }
  let mapped = mapFromCluster(cluster);
  if (!mapped && cluster && !counters.rateLimited) {
    let docket = null;
    const dField = cluster.docket;
    if (dField && typeof dField === "object") docket = dField;
    else if (typeof dField === "string") docket = await clGet(dField, apiKey, counters);
    else if (cluster.docket_id) docket = await clGet(`${CL_BASE}/dockets/${cluster.docket_id}/`, apiKey, counters);
    if (docket && !docket.budget) {
      mapped = mapFromCourtRef(docket.court, docket.court_id);
    }
  }
  if (mapped) return { ...mapped, clusterId, opinionId };
  return null;
}

async function main() {
  const apiKey = process.env.COURTLISTENER_API_KEY?.trim();
  const url = process.env.DATABASE_URL?.trim();
  if (!apiKey || !url) {
    console.log(JSON.stringify({ ok: false, reason: "missing_env" }));
    process.exit(2);
  }
  const maxCalls = Math.min(Math.max(Number(process.env.REFINE_MAX_CL || 80), 10), 120);
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 40 });
  const counters = { apiCalls: 0, maxCalls, lastAt: 0, rateLimited: false, retryAfter: null, gateway: 0 };

  try {
    // Prefer recently acquired unspecified with federal reporter citations; order by citation demand if joinable
    const candidates = await sql`
      select a.id, a.citation, a.normalized_citation, a.source_external_id, a.metadata, a.decision_date,
             coalesce(d.edge_demand, 0)::int as edge_demand
      from legal_authorities a
      left join lateral (
        select count(*)::int as edge_demand
        from legal_authority_citations e
        where e.to_authority_id is null
          and (
            e.normalized_citation = a.normalized_citation
            or e.normalized_citation = a.citation
            or e.raw_citation = a.citation
          )
      ) d on true
      where a.authority_type = 'case'
        and a.court_id = 'us-circuit-unspecified'
        and a.citation ~* 'F\\.(2d|3d|4th)'
      order by coalesce(d.edge_demand, 0) desc, a.created_at desc
      limit 200
    `;

    const reviewed = [];
    const resolved = [];
    let thirdCircuit = 0;
    let otherCircuits = 0;
    let stillUnresolved = 0;

    for (const row of candidates) {
      if (counters.rateLimited || counters.apiCalls >= maxCalls) break;
      const opinionId = (String(row.source_external_id || "").match(/cl-opinion-(\d+)/) || [])[1];
      const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata || {};
      const record = {
        id: row.id,
        citation: row.citation,
        edgeDemand: row.edge_demand,
        year: row.decision_date ? String(row.decision_date).slice(0, 4) : null,
        opinionId,
        status: "pending",
      };
      if (!opinionId) {
        record.status = "no_opinion_id";
        stillUnresolved += 1;
        reviewed.push(record);
        continue;
      }
      const mapped = await resolveViaOpinion(opinionId, apiKey, counters);
      if (counters.rateLimited) {
        record.status = "rate_limited";
        reviewed.push(record);
        break;
      }
      if (!mapped) {
        record.status = "unresolved";
        stillUnresolved += 1;
        reviewed.push(record);
        continue;
      }

      const nextMeta = {
        ...meta,
        clusterId: mapped.clusterId || meta.clusterId || null,
        clCourt: mapped.clKey,
        circuitRefine: {
          at: new Date().toISOString(),
          method: mapped.method,
          previousCourtId: "us-circuit-unspecified",
        },
      };
      await sql`
        update legal_authorities
        set court = ${mapped.courtName},
            court_id = ${mapped.courtId},
            court_level = ${mapped.courtLevel},
            authority_state = ${mapped.authorityState},
            federal_circuit = ${mapped.federalCircuit},
            jurisdiction = 'United States',
            metadata = ${sql.json(nextMeta)},
            updated_at = now()
        where id = ${row.id}
      `;
      record.status = "resolved";
      record.courtId = mapped.courtId;
      record.method = mapped.method;
      reviewed.push(record);
      resolved.push(record);
      if (mapped.courtId === "us-ca-3") thirdCircuit += 1;
      else otherCircuits += 1;
    }

    const [remaining] = await sql`
      select count(*)::int as n from legal_authorities
      where authority_type='case' and court_id='us-circuit-unspecified'
        and citation ~* 'F\\.(2d|3d|4th)'
    `;

    const byCircuit = {};
    for (const r of resolved) byCircuit[r.courtId] = (byCircuit[r.courtId] || 0) + 1;

    const out = {
      ok: !counters.rateLimited || resolved.length > 0,
      classification: "CORPUS_DAILY_OCT8_BATCH2_CIRCUIT_REFINE",
      candidates: candidates.length,
      reviewed: reviewed.length,
      exactCircuitsResolved: resolved.length,
      thirdCircuitIdentified: thirdCircuit,
      otherCircuitsIdentified: otherCircuits,
      stillUnresolvedThisPass: stillUnresolved,
      remainingUnspecifiedFederalReporter: remaining.n,
      byCircuit,
      courtListenerHttpCalls: counters.apiCalls,
      rateLimited: counters.rateLimited,
      retryAfter: counters.retryAfter,
      gateway502_504: counters.gateway,
      sampleResolved: resolved.slice(0, 25),
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(OUT, JSON.stringify({ ...out, reviewed }, null, 2));
    console.log(JSON.stringify(out));
    if (counters.rateLimited) process.exit(4);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 800) }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
