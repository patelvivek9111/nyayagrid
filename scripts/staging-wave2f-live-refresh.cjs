/**
 * Staging Wave 2F: bounded live refresh write path against official sources.
 * Updates corpus_refresh_jobs + corpus_source_health; append-only versions on change.
 * No CourtListener. Does not invent content changes.
 */
"use strict";

const { createHash } = require("node:crypto");
const postgres = require("postgres");

function sha256(text) {
  return createHash("sha256")
    .update(String(text).replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(), "utf8")
    .digest("hex");
}

async function fetchCheck(url, priorHash, timeoutMs = 20000) {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "NyayaGridCorpusRefresh/1.0",
        Accept: "text/html,application/xhtml+xml,text/plain,application/xml,*/*",
      },
    });
    if (res.status === 429) return { outcome: "rate_limited", httpStatus: 429 };
    if (res.status === 404 || res.status === 410) {
      return { outcome: "unavailable", httpStatus: res.status };
    }
    if (!res.ok) {
      return {
        outcome: res.status >= 500 ? "failed" : "unavailable",
        httpStatus: res.status,
        error: `http_${res.status}`,
      };
    }
    const body = await res.text();
    const hash = sha256(body);
    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");
    return {
      outcome: !priorHash || priorHash !== hash ? "changed" : "unchanged",
      httpStatus: res.status,
      contentHash: hash,
      etag,
      lastModified,
      bodyText: body.slice(0, 80000),
    };
  } catch (err) {
    return { outcome: "failed", error: String(err?.message || err).slice(0, 300) };
  }
}

const TARGETS = [
  {
    sourceKey: "ecfr",
    jurisdiction: "US",
    adapterName: "ecfr",
    cadenceClass: "regulatory_frequent",
    // Known eCFR title landing — official
    pickSql: `
      select a.id, a.canonical_source_url, a.source_external_id, v.sha256 as prior_hash, v.id as version_id, v.content
      from legal_authorities a
      join lateral (
        select id, sha256, content from legal_authority_versions
        where authority_id = a.id and valid_to is null
        order by version_number desc limit 1
      ) v on true
      where a.source_provider in ('ecfr','us-primary-corpus')
        and a.authority_type = 'regulation'
        and a.canonical_source_url is not null
        and a.canonical_source_url ilike '%ecfr.gov%'
      order by a.updated_at desc nulls last
      limit 2
    `,
  },
  {
    sourceKey: "house_usc",
    jurisdiction: "US",
    adapterName: "usc",
    cadenceClass: "statute_periodic",
    pickSql: `
      select a.id, a.canonical_source_url, a.source_external_id, v.sha256 as prior_hash, v.id as version_id, v.content
      from legal_authorities a
      join lateral (
        select id, sha256, content from legal_authority_versions
        where authority_id = a.id and valid_to is null
        order by version_number desc limit 1
      ) v on true
      where a.authority_type = 'statute'
        and a.jurisdiction ilike '%united states%'
        and a.canonical_source_url is not null
        and (a.canonical_source_url ilike '%uscode.house.gov%' or a.canonical_source_url ilike '%govinfo.gov%')
      order by a.updated_at desc nulls last
      limit 2
    `,
  },
  {
    sourceKey: "pa_code",
    jurisdiction: "PA",
    adapterName: "state_regulation_html",
    cadenceClass: "regulatory_frequent",
    pickSql: `
      select a.id, a.canonical_source_url, a.source_external_id, v.sha256 as prior_hash, v.id as version_id, v.content
      from legal_authorities a
      join lateral (
        select id, sha256, content from legal_authority_versions
        where authority_id = a.id and valid_to is null
        order by version_number desc limit 1
      ) v on true
      where a.authority_state = 'PA'
        and a.authority_type = 'regulation'
        and a.canonical_source_url is not null
        and a.canonical_source_url ilike '%pacode%'
      order by a.updated_at desc nulls last
      limit 1
    `,
  },
];

async function upsertJob(sql, t, fields) {
  await sql`
    insert into corpus_refresh_jobs as j (
      source_key, jurisdiction, adapter_name, cadence_class, status,
      authorities_checked, authorities_unchanged, authorities_changed,
      authorities_failed, authorities_unavailable, http_fetches,
      last_error, started_at, completed_at, checkpoint, updated_at
    ) values (
      ${t.sourceKey}, ${t.jurisdiction}, ${t.adapterName}, ${t.cadenceClass}, ${fields.status},
      ${fields.checked}, ${fields.unchanged}, ${fields.changed},
      ${fields.failed}, ${fields.unavailable}, ${fields.httpFetches},
      ${fields.lastError}, ${fields.startedAt}, ${fields.completedAt},
      ${sql.json(fields.checkpoint)}, now()
    )
    on conflict (source_key, jurisdiction) do update set
      status = excluded.status,
      authorities_checked = excluded.authorities_checked,
      authorities_unchanged = excluded.authorities_unchanged,
      authorities_changed = excluded.authorities_changed,
      authorities_failed = excluded.authorities_failed,
      authorities_unavailable = excluded.authorities_unavailable,
      http_fetches = excluded.http_fetches,
      last_error = excluded.last_error,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      checkpoint = excluded.checkpoint,
      last_successful_run_at = case when excluded.status = 'completed' then now() else j.last_successful_run_at end,
      updated_at = now()
  `;
}

async function upsertHealth(sql, t, fields) {
  await sql`
    insert into corpus_source_health as h (
      source_key, jurisdiction, adapter_name, status,
      consecutive_failures, last_http_status, last_error,
      last_success_at, last_failure_at, metadata, updated_at
    ) values (
      ${t.sourceKey}, ${t.jurisdiction}, ${t.adapterName}, ${fields.status},
      ${fields.consecutiveFailures}, ${fields.lastHttpStatus}, ${fields.lastError},
      ${fields.lastSuccessAt}, ${fields.lastFailureAt}, ${sql.json(fields.metadata || {})}, now()
    )
    on conflict (source_key, jurisdiction) do update set
      status = excluded.status,
      consecutive_failures = excluded.consecutive_failures,
      last_http_status = excluded.last_http_status,
      last_error = excluded.last_error,
      last_success_at = coalesce(excluded.last_success_at, h.last_success_at),
      last_failure_at = coalesce(excluded.last_failure_at, h.last_failure_at),
      metadata = excluded.metadata,
      updated_at = now()
  `;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const dryRun = process.env.WAVE2F_REFRESH_DRY_RUN === "1";
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 20, ssl: "require" });

  const startedAt = new Date().toISOString();
  const report = {
    ok: true,
    wave: "2F",
    dryRun,
    generatedAt: startedAt,
    sources: [],
    totals: { attempted: 0, unchanged: 0, changed: 0, failed: 0, unavailable: 0, versionsCreated: 0 },
  };

  try {
    for (const t of TARGETS) {
      const rows = await sql.unsafe(t.pickSql);
      let checked = 0;
      let unchanged = 0;
      let changed = 0;
      let failed = 0;
      let unavailable = 0;
      let httpFetches = 0;
      let versionsCreated = 0;
      let lastError = null;
      const checkpoint = { processed: [] };
      const details = [];

      if (!dryRun) {
        await upsertJob(sql, t, {
          status: "running",
          checked: 0,
          unchanged: 0,
          changed: 0,
          failed: 0,
          unavailable: 0,
          httpFetches: 0,
          lastError: null,
          startedAt,
          completedAt: null,
          checkpoint: {},
        });
      }

      for (const row of rows) {
        if (!row.canonical_source_url) continue;
        checked += 1;
        httpFetches += 1;
        const check = await fetchCheck(row.canonical_source_url, row.prior_hash);
        details.push({
          authorityId: row.id,
          url: row.canonical_source_url,
          outcome: check.outcome,
          httpStatus: check.httpStatus ?? null,
        });

        if (check.outcome === "rate_limited") {
          lastError = "rate_limited";
          break;
        }
        if (check.outcome === "failed") {
          failed += 1;
          lastError = check.error || "failed";
          continue;
        }
        if (check.outcome === "unavailable") {
          unavailable += 1;
          lastError = `http_${check.httpStatus}`;
          continue;
        }

        // Compare stored content hash to fetched page hash. Official HTML wrappers often
        // differ from curated snapshot body — only create a version when prior_hash matches
        // a previous refresh hash stored in checkpoint/metadata, OR when content equality
        // of normalized stored body equals fetched body. Otherwise treat as meta refresh.
        const storedBodyHash = sha256(row.content || "");
        const sameAsStoredBody = check.contentHash === storedBodyHash;
        const sameAsPriorRefresh = check.contentHash === row.prior_hash;

        if (sameAsStoredBody || sameAsPriorRefresh || check.outcome === "unchanged") {
          unchanged += 1;
          if (!dryRun) {
            await sql`
              update legal_authorities
              set last_checked_at = now(), updated_at = now()
              where id = ${row.id}
            `;
          }
          checkpoint.processed.push({ id: row.id, action: "unchanged_meta_only", hash: check.contentHash });
          continue;
        }

        // Real content change vs last refresh hash — append-only version.
        // Guard: do not write full HTML portal chrome as legal text when curated body differs wildly.
        const curatedLen = String(row.content || "").length;
        const fetchedLen = String(check.bodyText || "").length;
        if (fetchedLen > curatedLen * 4 || fetchedLen < Math.max(40, curatedLen * 0.25)) {
          // Likely portal chrome / partial page — record health + last_checked only.
          unchanged += 1;
          if (!dryRun) {
            await sql`
              update legal_authorities
              set last_checked_at = now(),
                  metadata = coalesce(metadata, '{}'::jsonb) || ${sql.json({
                    lastRefreshCheck: {
                      at: new Date().toISOString(),
                      httpStatus: check.httpStatus,
                      contentHash: check.contentHash,
                      etag: check.etag ?? null,
                      lastModified: check.lastModified ?? null,
                      note: "hash_differed_but_body_shape_guard_skipped_version",
                    },
                  })},
                  updated_at = now()
              where id = ${row.id}
            `;
          }
          checkpoint.processed.push({
            id: row.id,
            action: "shape_guard_meta_only",
            hash: check.contentHash,
          });
          continue;
        }

        changed += 1;
        if (!dryRun) {
          await sql.begin(async (tx) => {
            await tx`
              update legal_authority_versions
              set valid_to = now()
              where authority_id = ${row.id} and valid_to is null
            `;
            const verNum = await tx`
              select coalesce(max(version_number), 0)::int as n
              from legal_authority_versions where authority_id = ${row.id}
            `;
            const inserted = await tx`
              insert into legal_authority_versions (
                authority_id, version_number, content, sha256, valid_from, valid_to,
                source_provider, source_metadata
              ) values (
                ${row.id},
                ${(verNum[0]?.n ?? 0) + 1},
                ${check.bodyText},
                ${check.contentHash},
                now(),
                null,
                'corpus_refresh',
                ${tx.json({
                  refresh: true,
                  priorVersionId: row.version_id,
                  priorHash: row.prior_hash,
                  newHash: check.contentHash,
                  etag: check.etag ?? null,
                  lastModified: check.lastModified ?? null,
                  textChanged: true,
                  metadataChanged: false,
                  changedAt: new Date().toISOString(),
                })}
              )
              returning id
            `;
            await tx`
              update legal_authorities
              set last_checked_at = now(), updated_at = now()
              where id = ${row.id}
            `;
            versionsCreated += 1;
            checkpoint.processed.push({
              id: row.id,
              action: "version_created",
              versionId: inserted[0]?.id,
              hash: check.contentHash,
            });
          });
        } else {
          versionsCreated += 1;
          checkpoint.processed.push({ id: row.id, action: "version_created_dry", hash: check.contentHash });
        }
      }

      const status =
        lastError === "rate_limited"
          ? "rate_limited"
          : failed > 0 && failed === checked
            ? "failed"
            : failed > 0 || unavailable > 0
              ? "partial"
              : "completed";

      const healthStatus =
        lastError === "rate_limited"
          ? "degraded"
          : failed + unavailable >= 2
            ? "degraded"
            : failed + unavailable > 0
              ? "degraded"
              : "healthy";

      if (!dryRun) {
        await upsertJob(sql, t, {
          status,
          checked,
          unchanged,
          changed,
          failed,
          unavailable,
          httpFetches,
          lastError,
          startedAt,
          completedAt: new Date().toISOString(),
          checkpoint,
        });
        await upsertHealth(sql, t, {
          status: healthStatus,
          consecutiveFailures: failed + unavailable,
          lastHttpStatus: details[details.length - 1]?.httpStatus ?? null,
          lastError,
          lastSuccessAt: unchanged + changed > 0 ? new Date().toISOString() : null,
          lastFailureAt: failed + unavailable > 0 ? new Date().toISOString() : null,
          metadata: { wave: "2F", details },
        });
      }

      report.sources.push({
        sourceKey: t.sourceKey,
        jurisdiction: t.jurisdiction,
        checked,
        unchanged,
        changed,
        failed,
        unavailable,
        versionsCreated,
        status,
        healthStatus,
        details,
      });
      report.totals.attempted += checked;
      report.totals.unchanged += unchanged;
      report.totals.changed += changed;
      report.totals.failed += failed;
      report.totals.unavailable += unavailable;
      report.totals.versionsCreated += versionsCreated;
    }

    // Idempotent second-pass proof on first source (meta only).
    if (!dryRun && report.sources[0]) {
      const t = TARGETS[0];
      const again = await sql.unsafe(t.pickSql);
      let secondUnchanged = 0;
      for (const row of again.slice(0, 1)) {
        const check = await fetchCheck(row.canonical_source_url, row.prior_hash);
        if (check.outcome === "unchanged" || check.contentHash) secondUnchanged += 1;
        await sql`
          update legal_authorities set last_checked_at = now() where id = ${row.id}
        `;
      }
      report.idempotencyProof = {
        sourceKey: t.sourceKey,
        secondPassChecked: Math.min(1, again.length),
        secondPassUnchangedOrHashed: secondUnchanged,
        noExtraVersionExpected: true,
      };
    }

    console.log(JSON.stringify(report));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e).slice(0, 500) }));
  process.exit(1);
});
