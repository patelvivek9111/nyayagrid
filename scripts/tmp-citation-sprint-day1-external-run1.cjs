/**
 * 48-hour citation resolution sprint — Day 1 EXTERNAL identity run.
 * IDENTITY BACKLOG DRAIN ONLY. Full-text / opinion ingestion DISABLED.
 * One probe for live budget; Neon production only. No .md reports.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const postgres = require("postgres");
const {
  LocalAuthorityIndex,
  buildUnresolvedTargetQueue,
  classifyCaseCitationLookupEligibility,
  targetKey,
  experimentalNormalize,
  parseVolReporterPage,
  vrpKey,
  parseCitationLookupResponse,
  createResolutionRecord,
  appendLedger,
  RESOLVER_VERSION,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

let TOTAL_CL_CAP = 270;
let MAX_IDENTITY = 269;
const RATE_MS = 4000;
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const SOURCE = "courtlistener";
const BATCH = "citation-sprint-day1-external-run1";
const SPRINT_START_UNRESOLVED_BASELINE = 61504;
const ROOT = path.join(__dirname, "..");
const CHECKPOINT_DIR = path.join(ROOT, "packages/research/corpus/resolution/checkpoints");
const LEDGER_PATH = path.join(ROOT, "packages/research/corpus/resolution/ledger/cl-citation-sprint-day1-external-run1-2026-10-11.jsonl");
const REPORT_JSON = path.join(ROOT, "packages/research/corpus/reports/citation-sprint-day1-external-run1-2026-10-11.json");
const QUEUE_JSON = path.join(ROOT, "packages/research/corpus/resolution/citation-sprint-day1-external-queue-2026-10-11.json");
const RUN_START_LOCAL = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

const PRIOR_REPORT_GLOBS = [
  "citation-identity-live-batch1-2026-10-09.json",
  "citation-identity-live-batch2-2026-10-09.json",
  "citation-identity-live-batch3-2026-10-09.json",
  "citation-identity-live-batch4-2026-10-09.json",
  "citation-mixed-live-batch1-2026-10-09.json",
  "citation-identity-heavy-mixed-batch2-2026-10-09.json",
  "citation-identity-heavy-mixed-batch3-2026-10-09.json",
  "citation-full-hour-weekend-run1-2026-10-09.json",
  "citation-full-hour-weekend-run2-2026-10-09.json",
  "citation-quality-longtail-run1-2026-10-10.json",
  "post-fulltext-reassessment-run1-2026-10-10.json",
  "corpus-high-value-fulltext-run1-2026-10-10.json",
  "ca3-edpa-pa-fulltext-run1-2026-10-10.json",
  "absent-practice-authority-run1-2026-10-10.json",
  "strict-practice-authority-run1-2026-10-10.json",
  "new-day-high-value-corpus-run1-2026-10-11.json",
  "citation-sprint-day1-run1-2026-10-11.json",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

async function probeQuota(apiKey) {
  const t0 = Date.now();
  const res = await fetch(`${CL_BASE}/api-usage/`, {
    headers: { Authorization: `Token ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json().catch(() => ({}));
  const membership = j.membership || null;
  const current = j.current_usage || j.usage || [];
  function normalizeRows(raw) {
    const out = [];
    const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      if (row.minute || row.hour || row.day) {
        for (const period of ["minute", "hour", "day"]) {
          const p = row[period];
          if (!p) continue;
          out.push({
            period,
            remaining: Number(p.remaining ?? (p.limit != null && p.usage != null ? Number(p.limit) - Number(p.usage) : null)),
          });
        }
        continue;
      }
      const periodRaw = String(row.period || row.window || row.rate || row.name || "").toLowerCase();
      const period = periodRaw.includes("min")
        ? "minute"
        : periodRaw.includes("hour")
          ? "hour"
          : periodRaw.includes("day")
            ? "day"
            : null;
      out.push({
        period,
        remaining: Number(row.remaining ?? (row.limit != null && row.usage != null ? Number(row.limit) - Number(row.usage) : null)),
      });
    }
    return out;
  }
  let rows = [];
  if (Array.isArray(current)) {
    const userish = current.filter((x) =>
      String(x.scope || x.throttle || x.name || "")
        .toLowerCase()
        .includes("user"),
    );
    rows = normalizeRows(userish.length ? userish : current);
  } else if (current && typeof current === "object") {
    rows = normalizeRows(current.user || current);
  }
  const byPeriod = {};
  for (const row of rows) if (row.period) byPeriod[row.period] = row;
  return {
    ok: res.ok,
    membership: { level: membership?.level || membership?.name || null, is_active: membership?.is_active ?? null },
    minute: byPeriod.minute || null,
    hour: byPeriod.hour || null,
    day: byPeriod.day || null,
    ms: Date.now() - t0,
  };
}

async function authorityCompleteness(sql) {
  const [row] = await sql`
    select
      count(*)::int as total_canonical_authorities,
      count(*) filter (
        where authority_type='case'
          and ingestion_status = 'ready'
          and exists (
            select 1 from legal_authority_chunks c
            where c.authority_id = legal_authorities.id and c.embedding is not null
          )
      )::int as corpus_complete_authorities,
      count(*) filter (
        where authority_type='case'
          and (
            ingestion_status is distinct from 'ready'
            or not exists (
              select 1 from legal_authority_chunks c
              where c.authority_id = legal_authorities.id and c.embedding is not null
            )
          )
      )::int as metadata_only_authorities,
      count(*) filter (where authority_type='case' and ingestion_status='ready')::int as full_text_ready_authorities,
      count(*) filter (
        where exists (
          select 1 from legal_authority_chunks c
          where c.authority_id = legal_authorities.id and c.embedding is not null
        )
      )::int as embedded_authorities
    from legal_authorities
  `;
  const [edges] = await sql`
    select
      count(*) filter (where to_authority_id is not null)::int as authority_resolved_edges,
      count(*) filter (
        where to_authority_id is not null
          and a.ingestion_status = 'ready'
          and exists (
            select 1 from legal_authority_chunks c
            where c.authority_id = a.id and c.embedding is not null
          )
      )::int as corpus_complete_edges,
      count(*) filter (where to_authority_id is null)::int as identity_unresolved_edges
    from legal_authority_citations e
    left join legal_authorities a on a.id = e.to_authority_id
  `;
  return {
    TOTAL_CANONICAL_AUTHORITIES: row.total_canonical_authorities,
    METADATA_ONLY_AUTHORITIES: row.metadata_only_authorities,
    CORPUS_COMPLETE_AUTHORITIES: row.corpus_complete_authorities,
    FULL_TEXT_READY_AUTHORITIES: row.full_text_ready_authorities,
    EMBEDDED_AUTHORITIES: row.embedded_authorities,
    AUTHORITY_RESOLVED_EDGES: edges.authority_resolved_edges,
    CORPUS_COMPLETE_EDGES: edges.corpus_complete_edges,
    IDENTITY_UNRESOLVED_EDGES: edges.identity_unresolved_edges,
  };
}

async function healthSnapshot(sql) {
  const [h] = await sql`
    select
      (select count(*)::int from (
        select 1 from legal_authorities where source_external_id is not null
        group by source_provider, source_external_id having count(*) > 1
      ) d) as duplicates,
      (select count(*)::int from legal_authority_citations c
        left join legal_authorities a on a.id = c.from_authority_id where a.id is null) as orphans,
      (select count(*)::int from legal_authority_chunks where embedding is null) as missing_embeddings
  `;
  let failed = 0;
  let notProcessed = 0;
  try {
    await sql.unsafe("SAVEPOINT sp_proc");
    const [ps] = await sql`
      select count(*) filter (where processing_status='FAILED')::int as failed,
             count(*) filter (where processing_status='NOT_PROCESSED')::int as not_processed
      from legal_authorities
    `;
    failed = ps.failed;
    notProcessed = ps.not_processed;
    await sql.unsafe("RELEASE SAVEPOINT sp_proc");
  } catch {
    await sql.unsafe("ROLLBACK TO SAVEPOINT sp_proc").catch(() => {});
  }
  const presentRows = await sql`
    select c.id, count(a.id)::int as n
    from legal_authority_citations c
    join legal_authorities a on (
      a.normalized_citation = c.normalized_citation
      or a.citation = c.normalized_citation
      or a.citation = c.raw_citation
    )
    where c.to_authority_id is null
    group by c.id
  `;
  const presentTargetDefectsDeterministic = presentRows.filter((r) => Number(r.n) === 1).length;
  const [dupMap] = await sql`
    select count(*)::int as n from (
      select to_authority_id from legal_authority_citations
      where to_authority_id is not null
      group by from_authority_id, raw_citation, to_authority_id
      having count(*) > 1
    ) x
  `;
  const green =
    h.duplicates === 0 &&
    h.orphans === 0 &&
    h.missing_embeddings === 0 &&
    failed === 0 &&
    notProcessed === 0 &&
    presentTargetDefectsDeterministic === 0;
  return {
    duplicates: h.duplicates,
    orphans: h.orphans,
    missingEmbeddings: h.missing_embeddings,
    failed,
    notProcessed,
    presentTargetDefectsDeterministic,
    duplicateActiveMappings: dupMap.n,
    green,
    ...(await authorityCompleteness(sql)),
  };
}

function rebuildIndex(authorityRows) {
  return new LocalAuthorityIndex(
    authorityRows.map((a) => ({
      id: a.id,
      citation: a.citation,
      normalizedCitation: a.normalized_citation || a.normalizedCitation,
      metadata: a.metadata || {},
      sourceExternalId: a.source_external_id || a.sourceExternalId,
      sourceProvider: a.source_provider || a.sourceProvider,
      title: a.title,
      court: a.court,
      courtId: a.court_id || a.courtId,
      decisionDate: a.decision_date || a.decisionDate,
      ingestionStatus: a.ingestion_status || a.ingestionStatus,
      corpusComplete: a.corpusComplete,
    })),
  );
}

function isProviderHostile(raw, norm) {
  const t = String(norm || raw || "");
  if (/^\d{4}\s+Pages?\s+\d+$/i.test(t)) return true;
  if (/^(?:at\s+)?\d{1,4}(?:\s*[-–]\s*\d{1,4})?$/i.test(t)) return true;
  if (/\bU\.?\s*S\.?\s*C\.?\s*§/i.test(t)) return true;
  if (/^Fed\.\s*R\./i.test(t)) return true;
  if (/\bECF\b|\bEx\.\s*\d|\bExhibit\b/i.test(t)) return true;
  if (/[|]{2,}|\.{4,}|_{3,}/.test(t)) return true;
  if (/\bOCR\b|�|Â|ï¿½/.test(t)) return true;
  const p = parseVolReporterPage(experimentalNormalize(t) || t);
  if (p && /^page$/i.test(p.reporter)) return true;
  return false;
}

function loadSkipHistory() {
  const amb = new Set();
  const notFound = new Set();
  const hostile = new Set();
  const attempted = new Set();
  const reportsDir = path.join(ROOT, "packages/research/corpus/reports");
  for (const name of PRIOR_REPORT_GLOBS) {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(reportsDir, name), "utf8"));
      const rows = [...(b.results || []), ...(b.identityLane?.results || []), ...(b.identity?.results || [])];
      for (const r of rows) {
        const k = r.targetKey || (r.citation ? targetKey(r.citation, r.citation) : null);
        if (!k) continue;
        attempted.add(k);
        const st = String(r.status || r.providerStatus || "").toUpperCase();
        if (st.includes("AMBIG") || st === "NO_AUTO_RESOLVE") amb.add(k);
        if (st.includes("NOT_FOUND") || st === "IDENTITY_UNRESOLVED") notFound.add(k);
      }
    } catch {
      /* */
    }
  }
  const ledgerDir = path.join(ROOT, "packages/research/corpus/resolution/ledger");
  try {
    for (const f of fs.readdirSync(ledgerDir).filter((x) => x.endsWith(".jsonl"))) {
      const lines = fs.readFileSync(path.join(ledgerDir, f), "utf8").split(/\n/).filter(Boolean);
      for (const line of lines.slice(-5000)) {
        try {
          const r = JSON.parse(line);
          const k = r.targetKey || targetKey(r.rawCitation, r.normalizedCitation);
          if (!k) continue;
          const st = String(r.state || r.status || r.method || "").toUpperCase();
          if (st.includes("AMBIG")) amb.add(k);
          if (st.includes("NOT_FOUND")) notFound.add(k);
        } catch {
          /* */
        }
      }
    }
  } catch {
    /* */
  }
  return { amb, notFound, hostile, attempted };
}

function practiceBoost(jurisdictions, citation) {
  const s = (jurisdictions || []).join(" ").toLowerCase();
  let b = 0;
  if (/us-ca-3|ca3|third/.test(s)) b += 18;
  if (/us-d-pa|paed|edpa/.test(s)) b += 14;
  if (/st-pa|pennsylvania/.test(s)) b += 10;
  if (/us-scotus|scotus/.test(s) || /\bU\.S\.|\bS\.\s*Ct|Wall|How/i.test(citation || "")) b += 12;
  return b;
}

function providerScore(t, hist, familySize) {
  let s = 0;
  s += Number(t.edgeCount || 0) * 3;
  s += Number(familySize || 1) * 2;
  s += Number(t.uniqueCitingCases || 0) * 2;
  const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
  if (el.eligible) s += 20;
  else s -= 40;
  if (t.reporter && /U\.S\.|F\.(?:2d|3d|4th)|F\.\s*Supp|S\.\s*Ct|A\.(?:2d|3d)|Wall|How/i.test(t.reporter)) s += 12;
  s += practiceBoost(t.jurisdictions, t.normalizedCitation);
  if (hist.amb.has(t.targetKey)) s -= 45;
  if (hist.notFound.has(t.targetKey)) s -= 40;
  if (hist.attempted.has(t.targetKey)) s -= 18;
  if (isProviderHostile(t.representativeRaw, t.normalizedCitation)) s -= 60;
  if (/^\d+\s+[A-Za-z]/.test(t.normalizedCitation || "") === false) s -= 8;
  return Math.round(s * 10) / 10;
}

function buildFamilies(targets) {
  const byVrp = new Map();
  const byNorm = new Map();
  for (const t of targets) {
    const vk = vrpKey(parseVolReporterPage(t.normalizedCitation));
    if (vk) {
      if (!byVrp.has(vk)) byVrp.set(vk, []);
      byVrp.get(vk).push(t.targetKey);
    }
    const nk = (experimentalNormalize(t.normalizedCitation) || t.normalizedCitation || "").toLowerCase();
    if (nk) {
      if (!byNorm.has(nk)) byNorm.set(nk, []);
      byNorm.get(nk).push(t.targetKey);
    }
  }
  const parent = new Map();
  function find(x) {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
    return parent.get(x);
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const t of targets) parent.set(t.targetKey, t.targetKey);
  for (const keys of byVrp.values()) {
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
  }
  for (const keys of byNorm.values()) {
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
  }
  const families = new Map();
  for (const t of targets) {
    const root = find(t.targetKey);
    if (!families.has(root)) families.set(root, []);
    families.get(root).push(t.targetKey);
  }
  return { families, familyOf: (k) => find(k), familySize: (k) => (families.get(find(k)) || []).length };
}

async function findExistingAuthority(sql, { clusterId, normalizedCitation, citations }) {
  const ext = `cl-cluster-${clusterId}`;
  const byExt = await sql`
    select id, ingestion_status,
      exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
    from legal_authorities
    where source_provider = ${SOURCE} and source_external_id = ${ext}
    limit 2
  `;
  if (byExt.length === 1) return { row: byExt[0], via: "cluster_external_id" };
  if (byExt.length > 1) return { ambiguous: true, via: "cluster_external_id" };
  const norms = [...new Set([normalizedCitation, ...(citations || [])].map((c) => experimentalNormalize(c) || c).filter(Boolean))];
  const hits = await sql`
    select id, ingestion_status,
      exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
    from legal_authorities
    where normalized_citation = any(${norms}) or citation = any(${norms})
    limit 5
  `;
  if (hits.length === 1) return { row: hits[0], via: "citation" };
  if (hits.length > 1) return { ambiguous: true, via: "citation" };
  return { row: null, via: null };
}

async function ensureIdentityAuthority(sql, target, lookup) {
  const clusterId = lookup.clusterId;
  const citations = lookup.citations || [];
  const primaryCite =
    citations.find((c) => targetKey(c, c) === target.targetKey) ||
    experimentalNormalize(target.normalizedCitation) ||
    target.normalizedCitation;
  const existing = await findExistingAuthority(sql, { clusterId, normalizedCitation: primaryCite, citations });
  if (existing.ambiguous) return { ok: false, reason: "local_ambiguous_after_lookup" };
  if (existing.row) {
    const corpusComplete = Boolean(existing.row.has_embeddings) && existing.row.ingestion_status === "ready";
    const [full] = await sql`select metadata from legal_authorities where id = ${existing.row.id}`;
    const meta = full?.metadata && typeof full.metadata === "object" ? { ...full.metadata } : {};
    const aliases = Array.isArray(meta.citationAliases) ? meta.citationAliases : [];
    const parallels = Array.isArray(meta.parallelCitations) ? meta.parallelCitations : [];
    meta.citationAliases = [...new Set([...aliases, target.normalizedCitation, target.representativeRaw, ...citations].filter(Boolean))].slice(0, 24);
    meta.parallelCitations = [...new Set([...parallels, ...citations].filter(Boolean))].slice(0, 24);
    meta.identityResolution = {
      method: "COURTLISTENER_CITATION_LOOKUP",
      clusterId,
      batch: BATCH,
      resolvedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
      identityOnly: true,
    };
    await sql`
      update legal_authorities
      set metadata = ${sql.json(meta)}, last_checked_at = now(), updated_at = now()
      where id = ${existing.row.id}
    `;
    return {
      ok: true,
      authorityId: existing.row.id,
      created: false,
      corpusComplete,
      aliasesLearned: Math.max(0, meta.citationAliases.length - aliases.length),
      parallelsLearned: Math.max(0, meta.parallelCitations.length - parallels.length),
    };
  }

  const authorityId = crypto.randomUUID();
  const title = lookup.caseName || primaryCite || target.normalizedCitation;
  const aliasSet = [...new Set([target.normalizedCitation, target.representativeRaw, primaryCite, ...citations].filter(Boolean))].slice(0, 24);
  const parallelSet = citations.slice(0, 12);
  const metadata = {
    adapter: BATCH,
    identityOnly: true,
    corpusComplete: false,
    clClusterId: clusterId,
    clOpinionIds: lookup.opinionIds || [],
    parallelCitations: parallelSet,
    citationAliases: aliasSet,
    identityResolution: {
      method: "COURTLISTENER_CITATION_LOOKUP",
      clusterId,
      court: lookup.court,
      dateFiled: lookup.dateFiled,
      evidence: lookup.evidence,
      batch: BATCH,
      resolvedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    },
    edgeDemand: target.edgeCount,
  };
  await sql`
    insert into legal_authorities (
      id, authority_type, jurisdiction, court, court_id, title, citation, normalized_citation,
      decision_date, source_provider, source_external_id, canonical_source_url,
      metadata, ingestion_status, created_at, updated_at, last_checked_at
    ) values (
      ${authorityId}, 'case', ${lookup.court ? "us" : null}, ${lookup.court}, ${null},
      ${title}, ${primaryCite}, ${experimentalNormalize(primaryCite) || primaryCite},
      ${lookup.dateFiled ? String(lookup.dateFiled).slice(0, 10) : null},
      ${SOURCE}, ${`cl-cluster-${clusterId}`},
      ${`https://www.courtlistener.com/api/rest/v4/clusters/${clusterId}/`},
      ${sql.json(metadata)}, 'pending'::authority_ingestion_status,
      now(), now(), now()
    )
  `;
  return {
    ok: true,
    authorityId,
    created: true,
    corpusComplete: false,
    aliasesLearned: aliasSet.length,
    parallelsLearned: parallelSet.length,
  };
}

async function backfillTarget(sql, target, authorityId, method, evidence, corpusComplete) {
  const unresolved = await sql`
    select id, from_authority_id, raw_citation, normalized_citation
    from legal_authority_citations where to_authority_id is null
  `;
  const matches = unresolved.filter((e) => targetKey(e.raw_citation, e.normalized_citation) === target.targetKey);
  const ledger = [];
  let updated = 0;
  for (const e of matches) {
    const rows = await sql`
      update legal_authority_citations
      set to_authority_id = ${authorityId}
      where id = ${e.id} and to_authority_id is null
      returning id, raw_citation
    `;
    if (!rows.length) continue;
    if (rows[0].raw_citation !== e.raw_citation) throw new Error(`raw_citation_mutated:${e.id}`);
    updated += 1;
    ledger.push(
      createResolutionRecord({
        rawCitation: e.raw_citation || target.representativeRaw,
        normalizedCitation: e.normalized_citation || target.normalizedCitation,
        targetKey: target.targetKey,
        fromAuthorityId: e.from_authority_id,
        citationEdgeId: e.id,
        toAuthorityId: authorityId,
        method,
        confidence: "HIGH",
        evidence,
        externalIdentity: {
          provider: "courtlistener",
          clusterId: String(evidence.find((x) => String(x).startsWith("cluster:")) || "").replace("cluster:", "") || null,
          opinionId: null,
        },
        state: corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
      }),
    );
  }
  return { updated, ledger };
}

function bucketLabel(n) {
  if (n >= 10) return "ge10";
  if (n >= 5) return "ge5to9";
  if (n === 4) return "e4";
  if (n === 3) return "e3";
  if (n === 2) return "e2";
  return "e1";
}
function emptyLaneBuckets() {
  return {
    ge10: { attempted: 0, high: 0, edges: 0 },
    ge5to9: { attempted: 0, high: 0, edges: 0 },
    e4: { attempted: 0, high: 0, edges: 0 },
    e3: { attempted: 0, high: 0, edges: 0 },
  };
}

async function main() {
  const apiKey = process.env.COURTLISTENER_API_KEY?.trim();
  const url = process.env.DATABASE_URL?.trim();
  if (!apiKey) {
    console.log(JSON.stringify({ ok: false, reason: "COURTLISTENER_API_KEY missing" }));
    process.exit(2);
  }
  if (!url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "need Neon DATABASE_URL" }));
    process.exit(2);
  }

  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  let totalCl = 0;
  let identityCl = 0;
  let retryCl = 0;
  let probeCl = 0;
  let lastAt = 0;
  let hit429 = false;
  let hit502 = 0;
  let stopReason = "BATCH_COMPLETE";
  let minuteRem = null;
  let hourRem = null;
  let dayRem = null;
  let membership = null;

  const localStats = {
    targetsResolved: 0,
    familiesResolved: 0,
    edgesResolved: 0,
    clAvoided: 0,
    aliasesUsed: 0,
    parallelsUsed: 0,
    clusterIdsUsed: 0,
    opinionIdsUsed: 0,
    edgesCollapsedByFamily: 0,
    ambiguousFamiliesSkipped: 0,
  };
  let idExternalAttempted = 0;
  let idHigh = 0;
  let idAmbiguous = 0;
  let idNotFound = 0;
  let idFailed = 0;
  let directEdges = 0;
  let familyEdges = 0;
  let backfillEdges = 0;
  let totalOldEdges = 0;
  let idAliases = 0;
  let idParallels = 0;
  let identityShellCreated = 0;
  const idResults = [];
  const ledgerAll = [];
  const resolvedInBatch = new Set();
  const attemptedInBatch = new Set();
  const rolling = [];
  const checkpoints = [];

  async function rateWait() {
    const wait = RATE_MS - (Date.now() - lastAt);
    if (lastAt && wait > 0) await sleep(wait);
  }

  try {
    const start = await healthSnapshot(sql);
    console.log(JSON.stringify({ phase: "PRECHECK_STATE", host: new URL(url.replace(/^postgresql:/, "http:")).host, start }, null, 2));
    if (!start.green) {
      writeJson(REPORT_JSON, {
        ok: false,
        classification: "CITATION_RESOLUTION_SPRINT_DAY1_EXTERNAL_RUN",
        stopReason: "START_HEALTH_NOT_GREEN",
        start,
      });
      console.log(JSON.stringify({ ok: false, stopReason: "START_HEALTH_NOT_GREEN", classification: "CITATION_RESOLUTION_SPRINT_DAY1_EXTERNAL_RUN" }));
      process.exit(3);
    }
    const RUN_START_UNRESOLVED = start.IDENTITY_UNRESOLVED_EDGES;
    const SPRINT_START_UNRESOLVED = SPRINT_START_UNRESOLVED_BASELINE;

    await sql.unsafe("BEGIN READ ONLY");
    const unresolved = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    let authorityRows = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider,
             title, court, court_id, decision_date, ingestion_status,
             exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
      from legal_authorities
    `;
    await sql.unsafe("COMMIT");

    let index = rebuildIndex(
      authorityRows.map((a) => ({ ...a, corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready" })),
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

    const uniqueRaw = new Set(unresolved.map((e) => String(e.raw_citation || "").trim()).filter(Boolean));
    const uniqueNorm = new Set(
      unresolved.map((e) => experimentalNormalize(e.normalized_citation || e.raw_citation) || "").filter(Boolean),
    );
    const fam = buildFamilies(queue.targets);
    const multiFormFamilies = [...fam.families.values()].filter((m) => m.length > 1).length;

    async function applyLocal(target, localHit, viaFamily = false) {
      const auth = authorityRows.find((a) => a.id === localHit.authorityId);
      const corpusComplete = Boolean(auth?.has_embeddings) && auth?.ingestion_status === "ready";
      const bf = await backfillTarget(sql, target, localHit.authorityId, localHit.method, localHit.evidence, corpusComplete);
      localStats.edgesResolved += bf.updated;
      localStats.targetsResolved += 1;
      localStats.clAvoided += 1;
      totalOldEdges += bf.updated;
      if (viaFamily) localStats.edgesCollapsedByFamily += bf.updated;
      if (localHit.method === "LOCAL_ALIAS") localStats.aliasesUsed += 1;
      if (localHit.method === "LOCAL_PARALLEL") localStats.parallelsUsed += 1;
      if (String(localHit.method || "").includes("CLUSTER")) localStats.clusterIdsUsed += 1;
      if (String(localHit.method || "").includes("OPINION")) localStats.opinionIdsUsed += 1;
      ledgerAll.push(...bf.ledger);
      resolvedInBatch.add(target.targetKey);
      idResults.push({
        targetKey: target.targetKey,
        citation: target.normalizedCitation,
        edgeCount: target.edgeCount,
        status: viaFamily ? "HIGH_RESOLVED_FAMILY_LOCAL" : "HIGH_RESOLVED_LOCAL",
        method: localHit.method,
        edgesBackfilled: bf.updated,
        externalLookup: false,
      });
      return bf.updated;
    }

    // ---- LOCAL SWEEP ----
    const localCandidates = queue.targets.filter((t) => t.localCandidateStatus !== "NO_LOCAL_MATCH");
    for (const target of queue.targets) {
      if (resolvedInBatch.has(target.targetKey)) continue;
      const hit = index.lookupCitation(target.representativeRaw, target.normalizedCitation);
      if (hit.kind === "one") {
        await applyLocal(target, hit, false);
      } else if (hit.kind === "ambiguous") {
        localStats.ambiguousFamiliesSkipped += 1;
      }
    }
    // Family collapse: if one member resolved and others now local-match same authority
    const resolvedAuthByFamily = new Map();
    for (const r of idResults) {
      if (!r.externalLookup && r.status?.includes("LOCAL")) {
        const root = fam.familyOf(r.targetKey);
        // authority from last apply — re-lookup
        const t = queue.targets.find((x) => x.targetKey === r.targetKey);
        if (!t) continue;
        const hit = index.lookupCitation(t.representativeRaw, t.normalizedCitation);
        if (hit.kind === "one") resolvedAuthByFamily.set(root, hit.authorityId);
      }
    }
    for (const target of queue.targets) {
      if (resolvedInBatch.has(target.targetKey)) continue;
      const hit = index.lookupCitation(target.representativeRaw, target.normalizedCitation);
      if (hit.kind === "one") {
        await applyLocal(target, hit, true);
        localStats.familiesResolved += 1;
      }
    }

    console.log(
      JSON.stringify({
        phase: "LOCAL_SWEEP",
        uniqueRaw: uniqueRaw.size,
        uniqueNorm: uniqueNorm.size,
        citationFamilies: fam.families.size,
        multiFormFamilies,
        localCandidates: localCandidates.length,
        ...localStats,
      }),
    );
    const localFirstSnapshot = {
      targetsResolved: localStats.targetsResolved,
      edgesResolved: localStats.edgesResolved,
      clAvoided: localStats.clAvoided,
    };

    const hist = loadSkipHistory();
    let skippedAmb = 0;
    let skippedNf = 0;
    let skippedHostile = 0;

    const scored = queue.targets
      .filter((t) => !resolvedInBatch.has(t.targetKey))
      .map((t) => {
        const fsz = fam.familySize(t.targetKey);
        const score = providerScore(t, hist, fsz);
        return { ...t, familySize: fsz, providerScore: score };
      });

    const externalEligible = [];
    for (const t of scored) {
      const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
      if (!el.eligible) continue;
      if (isProviderHostile(t.representativeRaw, t.normalizedCitation)) {
        skippedHostile += 1;
        continue;
      }
      if (hist.amb.has(t.targetKey)) {
        skippedAmb += 1;
        continue;
      }
      if (hist.notFound.has(t.targetKey)) {
        skippedNf += 1;
        continue;
      }
      // ordinary 1-2 prohibited; 3-edge only if high-confidence subset
      if (t.edgeCount <= 2) continue;
      if (t.edgeCount === 3 && t.providerScore < 65) continue;
      if (t.localCandidateStatus !== "NO_LOCAL_MATCH") continue;
      externalEligible.push(t);
    }
    const byProviderScore = (a, b) =>
      b.providerScore - a.providerScore || b.edgeCount - a.edgeCount || b.uniqueCitingCases - a.uniqueCitingCases;
    externalEligible.sort(byProviderScore);

    function bucketStats(pred) {
      const raw = scored.filter(pred);
      const suitable = externalEligible.filter(pred);
      const prev = raw.filter((t) => hist.attempted.has(t.targetKey)).length;
      const edges = suitable.reduce((s, t) => s + t.edgeCount, 0);
      const avg = suitable.length ? suitable.reduce((s, t) => s + t.providerScore, 0) / suitable.length : 0;
      return {
        raw: raw.length,
        suitable: suitable.length,
        previouslyAttempted: prev,
        edges,
        avgScore: Math.round(avg * 10) / 10,
      };
    }
    const buckets = {
      ge10: bucketStats((t) => t.edgeCount >= 10),
      ge5to9: bucketStats((t) => t.edgeCount >= 5 && t.edgeCount <= 9),
      e4: bucketStats((t) => t.edgeCount === 4),
      e3: bucketStats((t) => t.edgeCount === 3),
      e2: bucketStats((t) => t.edgeCount === 2),
      e1: bucketStats((t) => t.edgeCount === 1),
    };
    console.log(JSON.stringify({ phase: "QUEUE", buckets, externalEligible: externalEligible.length, skippedAmb, skippedNf, skippedHostile }, null, 2));
    writeJson(QUEUE_JSON, {
      generatedAt: new Date().toISOString(),
      buckets,
      top: externalEligible.slice(0, 80).map((t) => ({
        citation: t.normalizedCitation,
        edges: t.edgeCount,
        citers: t.uniqueCitingCases,
        score: t.providerScore,
        familySize: t.familySize,
        jurisdictions: t.jurisdictions,
      })),
    });

    // ---- ONE QUOTA PROBE ----
    const quota = await probeQuota(apiKey);
    probeCl = 1;
    totalCl = 1;
    minuteRem = Number(quota.minute?.remaining ?? 0);
    hourRem = Number(quota.hour?.remaining ?? 0);
    dayRem = Number(quota.day?.remaining ?? 0);
    membership = quota.membership;
    console.log(JSON.stringify({ quotaGate: { minuteRem, hourRem, dayRem, membership } }, null, 2));

    if (!quota.ok || hourRem < 250) {
      stopReason = "HOURLY_WINDOW_NOT_READY";
      const end = await healthSnapshot(sql);
      const report = finalizeReport({
        ok: false,
        stopReason,
        start,
        end,
        RUN_START_UNRESOLVED,
        SPRINT_START_UNRESOLVED,
        localStats,
        uniqueRaw: uniqueRaw.size,
        uniqueNorm: uniqueNorm.size,
        citationFamilies: fam.families.size,
        multiFormFamilies,
        buckets,
        skippedAmb,
        skippedNf,
        skippedHostile,
        minuteRem,
        hourRem,
        dayRem,
        membership,
        laneBuckets: emptyLaneBuckets(),
      });
      writeJson(REPORT_JSON, report);
      console.log(JSON.stringify({ ok: false, stopReason, classification: "CITATION_RESOLUTION_SPRINT_DAY1_EXTERNAL_RUN", totalCl }));
      process.exit(3);
    }
    if (dayRem < 250) {
      stopReason = "DAILY_CAPACITY_TOO_LOW_FOR_FULL_RUN";
      const end = await healthSnapshot(sql);
      const report = finalizeReport({
        ok: false,
        stopReason,
        start,
        end,
        RUN_START_UNRESOLVED,
        SPRINT_START_UNRESOLVED,
        localStats,
        uniqueRaw: uniqueRaw.size,
        uniqueNorm: uniqueNorm.size,
        citationFamilies: fam.families.size,
        multiFormFamilies,
        buckets,
        skippedAmb,
        skippedNf,
        skippedHostile,
        minuteRem,
        hourRem,
        dayRem,
        membership,
        laneBuckets: emptyLaneBuckets(),
      });
      writeJson(REPORT_JSON, report);
      console.log(JSON.stringify({ ok: false, stopReason, classification: "CITATION_RESOLUTION_SPRINT_DAY1_EXTERNAL_RUN", totalCl }));
      process.exit(3);
    }

    // Preserve ~25–30 hourly headroom; prefer ~270 when hour near 300+
    if (hourRem >= 280) TOTAL_CL_CAP = Math.min(270, hourRem - 28);
    else TOTAL_CL_CAP = Math.min(270, Math.max(40, hourRem - 28));
    if (dayRem < 300) TOTAL_CL_CAP = Math.min(TOTAL_CL_CAP, Math.max(40, dayRem - 250));
    MAX_IDENTITY = Math.max(20, TOTAL_CL_CAP - 1);
    console.log(JSON.stringify({ budget: { TOTAL_CL_CAP, MAX_IDENTITY, FULL_TEXT_CL: 0, runStartLocal: RUN_START_LOCAL } }));

    const ge10Q = externalEligible.filter((t) => t.edgeCount >= 10 && t.providerScore >= 40).sort(byProviderScore);
    const ge59Q = externalEligible.filter((t) => t.edgeCount >= 5 && t.edgeCount <= 9 && t.providerScore >= 40).sort(byProviderScore);
    const e4Q = externalEligible.filter((t) => t.edgeCount === 4 && t.providerScore >= 40).sort(byProviderScore);
    const e3Q = externalEligible.filter((t) => t.edgeCount === 3 && t.providerScore >= 65).sort(byProviderScore);
    const workingQueue = [...ge10Q, ...ge59Q, ...e4Q, ...e3Q].slice(0, MAX_IDENTITY + 120);
    const laneBuckets = emptyLaneBuckets();
    console.log(
      JSON.stringify({
        workingQueue: {
          ge10: ge10Q.length,
          ge5to9: ge59Q.length,
          e4: e4Q.length,
          e3HighConf: e3Q.length,
          total: workingQueue.length,
        },
      }),
    );

    async function drainLearning() {
      let gained = 0;
      for (const t of [...workingQueue, ...queue.targets]) {
        if (resolvedInBatch.has(t.targetKey)) continue;
        const hit = index.lookupCitation(t.representativeRaw, t.normalizedCitation);
        if (hit.kind === "one") {
          const n = await applyLocal(t, hit, true);
          familyEdges += n;
          gained += n;
          localStats.familiesResolved += 1;
        }
      }
      return gained;
    }

    let identityStopReason = null;
    for (const target of workingQueue) {
      if (identityCl >= MAX_IDENTITY || totalCl >= TOTAL_CL_CAP) {
        stopReason = "QUOTA_SAFETY_THRESHOLD";
        break;
      }
      if (hit429) break;
      if (identityStopReason) break;
      if (resolvedInBatch.has(target.targetKey)) continue;

      // 3-edge only after higher buckets exhausted and economics remain strong
      if (target.edgeCount === 3) {
        const higherLeft = workingQueue.some(
          (t) =>
            t.edgeCount >= 4 &&
            !resolvedInBatch.has(t.targetKey) &&
            !attemptedInBatch.has(t.targetKey),
        );
        if (higherLeft) continue;
        if (rolling.length >= 20) {
          const last20 = rolling.slice(-20);
          const high20 = last20.filter((x) => x.high).length / 20;
          const amb20 = last20.filter((x) => x.ambiguous).length / 20;
          const edges20 = last20.reduce((s, x) => s + x.edges, 0) / 20;
          if (high20 < 0.6 || amb20 > 0.25 || edges20 < 3) {
            identityStopReason = "SKIP_3EDGE_WEAK_ECONOMICS";
            stopReason = "IDENTITY_EFFICIENCY_STOP";
            break;
          }
        }
      }

      // local-first before every CL call
      const pre = index.lookupCitation(target.representativeRaw, target.normalizedCitation);
      if (pre.kind === "one") {
        await applyLocal(target, pre, false);
        continue;
      }

      await rateWait();
      identityCl += 1;
      totalCl += 1;
      idExternalAttempted += 1;
      attemptedInBatch.add(target.targetKey);
      lastAt = Date.now();
      const lane = bucketLabel(target.edgeCount);
      if (laneBuckets[lane]) laneBuckets[lane].attempted += 1;

      let callHigh = false;
      let callEdges = 0;
      let callAmb = false;
      let body = null;
      let httpStatus = 0;
      try {
        const res = await fetch(`${CL_BASE}/citation-lookup/`, {
          method: "POST",
          headers: {
            Authorization: `Token ${apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: target.normalizedCitation || target.representativeRaw }),
          signal: AbortSignal.timeout(60000),
        });
        httpStatus = res.status;
        if (res.status === 429) {
          hit429 = true;
          stopReason = "HTTP_429";
          idFailed += 1;
          writeJson(path.join(CHECKPOINT_DIR, `sprint-day1-429-${Date.now()}.json`), {
            at: new Date().toISOString(),
            retryAfter: res.headers.get("retry-after"),
            totalCl,
            identityCl,
            totalOldEdges,
          });
          idResults.push({ targetKey: target.targetKey, status: "failed", reason: "rate_limited", externalLookup: true });
          break;
        }
        if (res.status === 502 || res.status === 504) {
          hit502 += 1;
          if (totalCl < TOTAL_CL_CAP && hit502 < 4) {
            await sleep(2000);
            retryCl += 1;
            identityCl += 1;
            totalCl += 1;
            lastAt = Date.now();
            const res2 = await fetch(`${CL_BASE}/citation-lookup/`, {
              method: "POST",
              headers: {
                Authorization: `Token ${apiKey}`,
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ text: target.normalizedCitation || target.representativeRaw }),
              signal: AbortSignal.timeout(60000),
            });
            httpStatus = res2.status;
            if (!res2.ok) {
              idFailed += 1;
              idResults.push({ targetKey: target.targetKey, status: "failed", reason: `http_${httpStatus}`, externalLookup: true });
              continue;
            }
            body = await res2.json();
          } else {
            idFailed += 1;
            idResults.push({ targetKey: target.targetKey, status: "failed", reason: "http_5xx", externalLookup: true });
            continue;
          }
        } else if (!res.ok) {
          idFailed += 1;
          idResults.push({ targetKey: target.targetKey, status: "failed", reason: `http_${httpStatus}`, externalLookup: true });
          continue;
        } else {
          body = await res.json();
        }
      } catch (e) {
        idFailed += 1;
        idResults.push({
          targetKey: target.targetKey,
          status: "failed",
          reason: String(e.message || e).slice(0, 160),
          externalLookup: true,
        });
        continue;
      }

      const parsed = parseCitationLookupResponse(body);
      const record = {
        targetKey: target.targetKey,
        citation: target.normalizedCitation,
        edgeCount: target.edgeCount,
        providerScore: target.providerScore,
        externalLookup: true,
        httpStatus,
        providerStatus: parsed.status,
      };

      if (parsed.status === "ambiguous") {
        idAmbiguous += 1;
        callAmb = true;
        record.status = "NO_AUTO_RESOLVE";
        idResults.push(record);
      } else if (parsed.status === "not_found") {
        idNotFound += 1;
        record.status = "IDENTITY_UNRESOLVED";
        idResults.push(record);
      } else if (parsed.status !== "resolved") {
        idFailed += 1;
        record.status = "failed";
        idResults.push(record);
      } else {
        const ensured = await ensureIdentityAuthority(sql, target, parsed);
        if (!ensured.ok) {
          idAmbiguous += 1;
          callAmb = true;
          record.status = "NO_AUTO_RESOLVE";
          record.reason = ensured.reason;
          idResults.push(record);
        } else {
          if (ensured.created) identityShellCreated += 1;
          const bf = await backfillTarget(
            sql,
            target,
            ensured.authorityId,
            "COURTLISTENER_CITATION_LOOKUP",
            parsed.evidence,
            ensured.corpusComplete,
          );
          directEdges += bf.updated;
          callEdges = bf.updated;
          callHigh = true;
          idHigh += 1;
          totalOldEdges += bf.updated;
          backfillEdges += bf.updated;
          if (laneBuckets[lane]) {
            laneBuckets[lane].high += 1;
            laneBuckets[lane].edges += bf.updated;
          }
          idAliases += Number(ensured.aliasesLearned || 0);
          idParallels += Number(ensured.parallelsLearned || 0);
          ledgerAll.push(...bf.ledger);
          if (ensured.created) {
            authorityRows.push({
              id: ensured.authorityId,
              citation: target.normalizedCitation,
              normalized_citation: experimentalNormalize(target.normalizedCitation) || target.normalizedCitation,
              metadata: {
                parallelCitations: parsed.citations,
                citationAliases: [target.normalizedCitation, ...(parsed.citations || [])],
              },
              source_external_id: `cl-cluster-${parsed.clusterId}`,
              source_provider: SOURCE,
              title: parsed.caseName,
              court: parsed.court,
              ingestion_status: "pending",
              has_embeddings: false,
            });
          } else {
            const idx = authorityRows.findIndex((a) => a.id === ensured.authorityId);
            if (idx >= 0) {
              const row = authorityRows[idx];
              const meta = row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
              meta.citationAliases = [...new Set([...(meta.citationAliases || []), target.normalizedCitation, ...(parsed.citations || [])])];
              meta.parallelCitations = [...new Set([...(meta.parallelCitations || []), ...(parsed.citations || [])])];
              authorityRows[idx] = { ...row, metadata: meta };
            }
          }
          index = rebuildIndex(
            authorityRows.map((a) => ({
              ...a,
              corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
            })),
          );
          resolvedInBatch.add(target.targetKey);
          record.status = "HIGH_RESOLVED";
          record.authorityId = ensured.authorityId;
          record.createdAuthority = ensured.created;
          record.edgesBackfilled = bf.updated;
          record.clusterId = parsed.clusterId;
          idResults.push(record);
          await drainLearning();
        }
      }

      rolling.push({ high: callHigh, edges: callEdges, ambiguous: callAmb });
      if (rolling.length >= 20) {
        const last20 = rolling.slice(-20);
        const high20 = last20.filter((x) => x.high).length / 20;
        const amb20 = last20.filter((x) => x.ambiguous).length / 20;
        const edges20 = last20.reduce((s, x) => s + x.edges, 0) / 20;
        if (high20 < 0.55 || amb20 > 0.3 || edges20 < 2.5) {
          identityStopReason = "IDENTITY_EFFICIENCY_STOP";
          stopReason = "IDENTITY_EFFICIENCY_STOP";
        }
        if (idFailed >= 8 && idFailed / Math.max(1, idExternalAttempted) > 0.25) {
          identityStopReason = "SYSTEMIC_PROVIDER_FAILURE";
          stopReason = "SYSTEMIC_PROVIDER_FAILURE";
        }
      }

      if (identityCl % 20 === 0 || identityStopReason) {
        const health = await healthSnapshot(sql);
        const last20 = rolling.slice(-20);
        const cp = {
          atLookup: identityCl,
          totalCl,
          HIGH: idHigh,
          ambiguous: idAmbiguous,
          notFound: idNotFound,
          failed: idFailed,
          oldEdges: totalOldEdges,
          oldEdgesPerCl: identityCl > 0 ? totalOldEdges / identityCl : null,
          rolling20: {
            high: last20.length ? last20.filter((x) => x.high).length / last20.length : null,
            ambiguity: last20.length ? last20.filter((x) => x.ambiguous).length / last20.length : null,
            oldEdgesPerCl: last20.length ? last20.reduce((s, x) => s + x.edges, 0) / last20.length : null,
          },
          remainingHighScore: workingQueue.filter((t) => !resolvedInBatch.has(t.targetKey) && !attemptedInBatch.has(t.targetKey) && t.providerScore >= 50)
            .length,
          identityStopReason,
          unresolved: health.IDENTITY_UNRESOLVED_EDGES,
          green: health.green,
        };
        checkpoints.push(cp);
        writeJson(path.join(CHECKPOINT_DIR, `sprint-day1-id-cp-${identityCl}.json`), cp);
        console.log(JSON.stringify({ checkpoint: cp }));
        if (!health.green) {
          stopReason = "HEALTH_NOT_GREEN";
          break;
        }
      }
    }

    if (!identityStopReason && workingQueue.every((t) => resolvedInBatch.has(t.targetKey) || attemptedInBatch.has(t.targetKey))) {
      if (stopReason === "BATCH_COMPLETE") stopReason = "HIGH_SCORE_QUEUE_EXHAUSTED";
    }

    if (ledgerAll.length) appendLedger(LEDGER_PATH, ledgerAll);

    const end = await healthSnapshot(sql);
    const report = finalizeReport({
      ok: end.green && end.IDENTITY_UNRESOLVED_EDGES < RUN_START_UNRESOLVED,
      stopReason,
      start,
      end,
      RUN_START_UNRESOLVED,
      SPRINT_START_UNRESOLVED,
      localStats,
      uniqueRaw: uniqueRaw.size,
      uniqueNorm: uniqueNorm.size,
      citationFamilies: fam.families.size,
      multiFormFamilies,
      buckets,
      skippedAmb,
      skippedNf,
      skippedHostile,
      minuteRem,
      hourRem,
      dayRem,
      membership,
      laneBuckets,
      localFirstSnapshot,
    });
    writeJson(REPORT_JSON, report);
    console.log("CITATION_RESOLUTION_SPRINT_DAY1_EXTERNAL_RUN_COMPLETE");
    console.log(
      JSON.stringify({
        ok: report.ok,
        stopReason,
        totalCl,
        identityCl,
        HIGH: idHigh,
        totalOldEdges,
        RUN_NET_REDUCTION: report.sprintMetrics.RUN_NET_REDUCTION,
        SPRINT_TOTAL_REDUCTION: report.sprintMetrics.SPRINT_TOTAL_REDUCTION,
        finalClassification: report.finalClassification,
        health: end.green ? "PASS" : "FAIL",
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }

  function finalizeReport(ctx) {
    const last20 = rolling.slice(-20);
    const runNet = ctx.RUN_START_UNRESOLVED - ctx.end.IDENTITY_UNRESOLVED_EDGES;
    const sprintTotal = ctx.SPRINT_START_UNRESOLVED - ctx.end.IDENTITY_UNRESOLVED_EDGES;
    const pct = ctx.SPRINT_START_UNRESOLVED > 0 ? (sprintTotal / ctx.SPRINT_START_UNRESOLVED) * 100 : 0;
    const localShare = runNet > 0 ? Math.min(1, localStats.edgesResolved / Math.max(1, runNet)) : 0;
    const clShare = runNet > 0 ? Math.min(1, (directEdges + familyEdges) / Math.max(1, runNet)) : 0;
    const rollHigh = last20.length ? last20.filter((x) => x.high).length / last20.length : null;
    const rollAmb = last20.length ? last20.filter((x) => x.ambiguous).length / last20.length : null;
    const rollEdges = last20.length ? last20.reduce((s, x) => s + x.edges, 0) / last20.length : null;
    let finalClassification = "CITATION_SPRINT_WEAK";
    if (ctx.stopReason === "HOURLY_WINDOW_NOT_READY" || ctx.stopReason === "DAILY_CAPACITY_TOO_LOW_FOR_FULL_RUN") {
      finalClassification = "CITATION_SPRINT_BLOCKED";
    } else if (ctx.stopReason === "IDENTITY_EFFICIENCY_STOP" || ctx.stopReason === "SYSTEMIC_PROVIDER_FAILURE") {
      finalClassification = "CITATION_SPRINT_ECONOMIC_STOP";
    } else if (runNet <= 0) {
      finalClassification = "CITATION_SPRINT_WEAK";
    } else if (
      runNet >= 400 ||
      (identityCl >= 40 && totalOldEdges / identityCl >= 4 && idHigh / Math.max(1, idExternalAttempted) >= 0.6)
    ) {
      finalClassification = "CITATION_SPRINT_STRONG";
    } else if (runNet >= 80 || (identityCl >= 20 && idHigh / Math.max(1, idExternalAttempted) >= 0.55)) {
      finalClassification = "CITATION_SPRINT_MODERATE";
    }
    const remainGe10 = Math.max(0, (ctx.buckets?.ge10?.suitable || 0) - (ctx.laneBuckets?.ge10?.attempted || 0));
    const remain59 = Math.max(0, (ctx.buckets?.ge5to9?.suitable || 0) - (ctx.laneBuckets?.ge5to9?.attempted || 0));
    const remain4 = Math.max(0, (ctx.buckets?.e4?.suitable || 0) - (ctx.laneBuckets?.e4?.attempted || 0));
    const remain3 = Math.max(0, (ctx.buckets?.e3?.suitable || 0) - (ctx.laneBuckets?.e3?.attempted || 0));
    const remainingHigh = remainGe10 + remain59 + remain4;
    const strategyValidated =
      identityCl >= 20
        ? idHigh / Math.max(1, idExternalAttempted) >= 0.55 && totalOldEdges / Math.max(1, identityCl) >= 2.5
          ? "YES"
          : idHigh / Math.max(1, idExternalAttempted) >= 0.4
            ? "PARTIAL"
            : "NO"
        : identityCl > 0
          ? "PARTIAL"
          : "NO";
    const estHourLeft = hourRem != null ? Math.max(0, hourRem - Math.max(0, totalCl - probeCl)) : null;
    const estDayLeft = dayRem != null ? Math.max(0, dayRem - Math.max(0, totalCl - probeCl)) : null;
    return {
      ok: Boolean(ctx.ok) && runNet > 0 && ctx.end.green,
      classification: "CITATION_RESOLUTION_SPRINT_DAY1_EXTERNAL_RUN",
      runStartLocal: RUN_START_LOCAL,
      stopReason: ctx.stopReason,
      courtListener: {
        quotaProbeRequests: probeCl,
        identityLookupCl: identityCl,
        fullTextCl: 0,
        retryOtherCl: retryCl,
        totalClRequests: totalCl,
        minuteAtStart: ctx.minuteRem,
        hourAtStart: ctx.hourRem,
        dayAtStart: ctx.dayRem,
        estimatedHourRemaining: estHourLeft,
        estimatedDayRemaining: estDayLeft,
        hit429,
        hit502,
        budgetCap: TOTAL_CL_CAP,
        membership: ctx.membership,
      },
      start: ctx.start,
      end: ctx.end,
      localSweep: {
        uniqueRawTargets: ctx.uniqueRaw,
        uniqueNormalizedTargets: ctx.uniqueNorm,
        citationFamilies: ctx.citationFamilies,
        multiFormFamilies: ctx.multiFormFamilies,
        ...localStats,
      },
      queue: ctx.buckets,
      skipHistory: {
        previousAmbiguousSkipped: ctx.skippedAmb,
        previousNotFoundSkipped: ctx.skippedNf,
        providerHostileSkipped: ctx.skippedHostile,
        estimatedCallsSaved: ctx.skippedAmb + ctx.skippedNf + ctx.skippedHostile,
      },
      identity: {
        cl: identityCl,
        attempted: idExternalAttempted,
        HIGH: idHigh,
        ambiguous: idAmbiguous,
        notFound: idNotFound,
        providerFailures: idFailed,
        overallHighRate: idExternalAttempted > 0 ? idHigh / idExternalAttempted : null,
        overallAmbiguityRate: idExternalAttempted > 0 ? idAmbiguous / idExternalAttempted : null,
        directEdgesResolved: directEdges,
        familyEdgesResolved: familyEdges,
        backfillEdgesResolved: backfillEdges,
        TOTAL_OLD_EDGES_RESOLVED: totalOldEdges,
        oldEdgesPerCl: identityCl > 0 ? totalOldEdges / identityCl : null,
        rollingFinalHigh: rollHigh,
        rollingFinalAmbiguity: rollAmb,
        rollingFinalOldEdgesPerCl: rollEdges,
        identityShellAuthoritiesCreated: identityShellCreated,
        aliasesLearned: idAliases,
        parallelsLearned: idParallels,
        laneBuckets: ctx.laneBuckets || emptyLaneBuckets(),
        localFirstSnapshot: ctx.localFirstSnapshot || null,
        results: idResults.slice(0, 400),
      },
      fullText: { cl: 0, newAuthoritiesIngested: 0, newOutboundEdgesIntroduced: 0 },
      sprintMetrics: {
        RUN_START_UNRESOLVED: ctx.RUN_START_UNRESOLVED,
        END_UNRESOLVED: ctx.end.IDENTITY_UNRESOLVED_EDGES,
        RUN_NET_REDUCTION: runNet,
        SPRINT_START_UNRESOLVED: ctx.SPRINT_START_UNRESOLVED,
        SPRINT_TOTAL_REDUCTION: sprintTotal,
        SPRINT_PERCENT_REDUCED: Math.round(pct * 1000) / 1000,
        LOCAL_SHARE_OF_REDUCTION: Math.round(localShare * 1000) / 1000,
        CL_SHARE_OF_REDUCTION: Math.round(clShare * 1000) / 1000,
      },
      health: {
        duplicates: ctx.end.duplicates,
        orphans: ctx.end.orphans,
        missingEmbeddings: ctx.end.missingEmbeddings,
        failed: ctx.end.failed,
        notProcessed: ctx.end.notProcessed,
        duplicateActiveMappings: ctx.end.duplicateActiveMappings,
        presentTargetDefectsDeterministic: ctx.end.presentTargetDefectsDeterministic,
        rawCitationLoss: 0,
        status: ctx.end.green ? "PASS" : "FAIL",
      },
      queueRemaining: {
        ge10Suitable: remainGe10,
        ge5to9Suitable: remain59,
        e4Suitable: remain4,
        e3HighConfidenceSuitable: remain3,
      },
      economic: {
        providerSuitableStrategyValidated: strategyValidated,
        highYieldIdentityQueueRemains: remainingHigh > 0,
        bestRemainingBucket: remainGe10 > 0 ? ">=10" : remain59 > 0 ? "5-9" : remain4 > 0 ? "4" : remain3 > 0 ? "3-high" : "none",
        estimatedNextRunYield: remainingHigh > 0 ? "moderate-high" : "low",
      },
      nextDecision:
        ctx.stopReason === "HOURLY_WINDOW_NOT_READY" || ctx.stopReason === "HTTP_429" || (estHourLeft != null && estHourLeft < 80)
          ? "PAUSE_FOR_QUOTA_RECOVERY"
          : ctx.stopReason === "IDENTITY_EFFICIENCY_STOP" || ctx.stopReason === "SYSTEMIC_PROVIDER_FAILURE"
            ? "REFINE_PROVIDER_SCORING"
            : runNet <= 0
              ? "REFINE_PROVIDER_SCORING"
              : remainingHigh > 0
                ? "RUN_NEXT_FULL_HOUR_AFTER_RECOVERY"
                : "CONTINUE_LOCAL_ONLY_SWEEP",
      nextRecommendedClBudget:
        ctx.stopReason === "HOURLY_WINDOW_NOT_READY" ||
        ctx.stopReason === "IDENTITY_EFFICIENCY_STOP" ||
        ctx.stopReason === "SYSTEMIC_PROVIDER_FAILURE"
          ? 0
          : remainingHigh > 0
            ? 270
            : 0,
      checkpoints,
      finalClassification,
      generatedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    };
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
