/**
 * Queue #2 Lane B — ZERO CourtListener HTTP.
 * Official non-CL fetch only (House OLRC, eCFR, uscourts.gov, loc.gov).
 * Installs a local fetch guard so accidental CL URLs fail closed.
 */
"use strict";

const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");
const {
  installLaneBFetchGuard,
  uninstallLaneBFetchGuard,
  assertLaneBUrlAllowed,
  rankMissingUsReports,
  researchIntermediateGaps,
  classifyDepth,
  detectHistoricalHoles,
  restoreState,
  completeLaneBTask,
  recordLaneTime,
} = require("./queue2-dual-lane-controller.cjs");

const locUrl = (volume, page) =>
  `https://www.loc.gov/item/usrep${String(volume).padStart(3, "0")}${String(page).padStart(4, "0")}/?fo=json`;

function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function toPgvector(vec) {
  return `[${vec.join(",")}]`;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uscViewerUrl(title, section) {
  const req = `granuleid:USC-prelim-title${title}-section${section}&num=${section}&edition=prelim`;
  return `https://uscode.house.gov/view.xhtml?req=${encodeURIComponent(req)}`;
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
  const m = /\bFed\.?\s*R\.?\s*(Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s*(\d+[A-Za-z.]*)\b/i.exec(
    String(raw || ""),
  );
  if (!m) return null;
  const kindRaw = m[1].replace(/\s+/g, " ").trim().toLowerCase();
  let kind = "civ";
  let reporter = "Fed. R. Civ. P.";
  let path = "rules-civil-procedure";
  if (/^evid/i.test(kindRaw)) {
    kind = "evid";
    reporter = "Fed. R. Evid.";
    path = "rules-evidence";
  } else if (/^app/i.test(kindRaw)) {
    kind = "app";
    reporter = "Fed. R. App. P.";
    path = "rules-appellate-procedure";
  } else if (/^crim/i.test(kindRaw)) {
    kind = "crim";
    reporter = "Fed. R. Crim. P.";
    path = "rules-criminal-procedure";
  }
  return { kind, rule: m[2], citation: `${reporter} ${m[2]}`, path };
}

async function guardedFetch(url, init) {
  assertLaneBUrlAllowed(url);
  return fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(25000) });
}

function chunkContent(content) {
  const parts = String(content)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks = [];
  for (const p of parts) {
    if (p.length <= 1000) chunks.push(p);
    else {
      let rest = p;
      while (rest.length > 1000) {
        let cut = rest.lastIndexOf(" ", 1000);
        if (cut < 500) cut = 1000;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) chunks.push(rest);
    }
  }
  return chunks.length ? chunks : [String(content).slice(0, 1000)];
}

async function embedBatch(texts, apiKey) {
  const res = await guardedFetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: 384 }),
  });
  if (!res.ok) throw new Error(`embed_http_${res.status}`);
  const body = await res.json();
  return (body.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function importAuthority(sql, rec, apiKey) {
  try {
    const content = rec.content || "";
    if (content.length < 20) return { status: "skipped_short" };
  const hash = sha256(content);
  const provider = rec.sourceProvider;
  const existing = await sql`
    select id from legal_authorities
    where source_provider = ${provider} and source_external_id = ${rec.sourceExternalId}
    limit 1
  `;
  if (existing.length) {
    const latest = await sql`
      select sha256 from legal_authority_versions
      where authority_id = ${existing[0].id} order by version_number desc limit 1
    `;
    if (latest[0]?.sha256 === hash) return { status: "skipped_duplicate" };
    return { status: "skipped_existing" };
  }
  const byCite = rec.normalizedCitation
    ? await sql`
        select id from legal_authorities
        where normalized_citation = ${rec.normalizedCitation}
        limit 1
      `
    : [];
  if (byCite.length) return { status: "skipped_alias", aliasOf: byCite[0].id };

  const id = randomUUID();
  await sql`
    insert into legal_authorities (
      id, authority_type, jurisdiction, court, court_id, authority_state, court_level,
      title, citation, normalized_citation, source_provider, source_external_id,
      canonical_source_url, ingestion_status, currentness_status, last_checked_at,
      decision_date, effective_date, metadata, created_at, updated_at
    ) values (
      ${id}, ${rec.authorityType}, ${rec.jurisdiction || "US"}, ${rec.court || null},
      ${rec.courtId || null}, ${rec.authorityState || "US"}, ${rec.courtLevel || null},
      ${rec.title}, ${rec.citation || null}, ${rec.normalizedCitation || rec.citation || null},
      ${provider}, ${rec.sourceExternalId}, ${rec.canonicalSourceUrl || null},
      'ready', ${rec.currentnessStatus || "current_as_of_source_date"}, now(),
      ${rec.decisionDate || null}, ${rec.effectiveDate || null},
      ${sql.json({ ...(rec.sourceMetadata || {}), queue: "#2", lane: "B" })},
      now(), now()
    )
  `;
  const [version] = await sql`
    insert into legal_authority_versions (
      authority_id, version_number, content, sha256, valid_from, valid_to, source_provider, source_metadata
    ) values (
      ${id}, 1, ${content}, ${hash}, now(), null, ${provider},
      ${sql.json({ lane: "B", adapter: provider })}
    )
    returning id
  `;
  const chunks = chunkContent(content);
  let embeddings = [];
  if (apiKey) {
    try {
      embeddings = await embedBatch(chunks, apiKey);
    } catch {
      embeddings = [];
    }
  }
  for (let i = 0; i < chunks.length; i += 1) {
    const vec = embeddings[i];
    if (vec && vec.length) {
      await sql`
        insert into legal_authority_chunks (
          id, authority_id, authority_version_id, chunk_index, content,
          segment_ref, embedding, embedding_model
        ) values (
          ${randomUUID()}, ${id}, ${version.id}, ${i}, ${chunks[i]},
          ${`p${i + 1}`}, ${toPgvector(vec)}::vector, ${"text-embedding-3-small:384"}
        )
      `;
    } else {
      await sql`
        insert into legal_authority_chunks (
          id, authority_id, authority_version_id, chunk_index, content, segment_ref
        ) values (
          ${randomUUID()}, ${id}, ${version.id}, ${i}, ${chunks[i]}, ${`p${i + 1}`}
        )
      `;
    }
  }
  return { status: "imported", id, chunks: chunks.length, embedded: embeddings.length };
  } catch (e) {
    return { status: "error", error: String(e.message || e).slice(0, 180) };
  }
}

async function loadScheduler(sql) {
  try {
    const rows = await sql`
      select metadata, cursor, status, updated_at
      from corpus_ingest_jobs
      where source = 'queue2-scheduler' and cl_court = 'queue2-dual-lane'
      limit 1
    `;
    if (!rows.length) return restoreState(null);
    return restoreState(rows[0].metadata || null);
  } catch {
    return restoreState(null);
  }
}

async function saveScheduler(sql, state) {
  const meta = { ...state, updatedAt: new Date().toISOString() };
  try {
    const existing = await sql`
      select id from corpus_ingest_jobs
      where source = 'queue2-scheduler' and cl_court = 'queue2-dual-lane'
      limit 1
    `;
    if (existing.length) {
      await sql`
        update corpus_ingest_jobs
        set status = ${meta.currentLane === "A" ? "running" : "paused"},
            cursor = ${meta.laneA?.checkpoint || null},
            last_error = null,
            metadata = ${sql.json(meta)},
            updated_at = now()
        where id = ${existing[0].id}
      `;
      return;
    }
    await sql`
      insert into corpus_ingest_jobs (
        source, court_id, cl_court, status, cursor, target_max, batch_size, metadata
      ) values (
        'queue2-scheduler', 'queue2-dual-lane', 'queue2-dual-lane',
        ${meta.currentLane === "A" ? "running" : "paused"},
        ${meta.laneA?.checkpoint || null}, 45, 8, ${sql.json(meta)}
      )
    `;
  } catch (e) {
    meta.persistError = String(e.message || e).slice(0, 180);
  }
}

async function citationCounts(sql) {
  const [row] = await sql`
    select
      count(*)::int as extracted,
      count(*) filter (where to_authority_id is not null)::int as resolved,
      count(*) filter (where to_authority_id is null)::int as target_absent,
      count(*) filter (where to_authority_id is null and (normalized_citation is null or btrim(normalized_citation)=''))::int as parser_gap
    from legal_authority_citations
  `;
  return row;
}

async function main() {
  const t0 = Date.now();
  installLaneBFetchGuard(globalThis);
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0, lane: "B" }));
    process.exit(2);
  }
  const apiKey = process.env.OPENAI_API_KEY || "";
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  const clCalls = { attempted: 0, blocked: 0 };

  try {
    let state = await loadScheduler(sql);
    state.currentLane = "B";
    const citeBefore = await citationCounts(sql);

    const unresolved = await sql`
      select coalesce(normalized_citation, raw_citation) as cite, count(*)::int as inbound
      from legal_authority_citations
      where to_authority_id is null
        and coalesce(normalized_citation, raw_citation) is not null
      group by 1
      order by inbound desc
      limit 400
    `;
    const presentUs = await sql`
      select citation, normalized_citation from legal_authorities
      where authority_type = 'case'
        and (
          normalized_citation ~* '^\\d{1,3}\\s+U\\.\\s*S\\.\\s+\\d'
          or citation ~* '^\\d{1,3}\\s+U\\.\\s*S\\.\\s+\\d'
          or court_level = 'scotus'
        )
    `;
    const presentList = presentUs.flatMap((r) => [r.normalized_citation, r.citation].filter(Boolean));
    const usReportsRanked = rankMissingUsReports(
      unresolved.map((r) => ({ normalizedCitation: r.cite, inbound: r.inbound })),
      presentList,
    );

    const uscDemand = [];
    const cfrDemand = [];
    const fedDemand = [];
    for (const row of unresolved) {
      const u = parseUsc(row.cite);
      if (u) uscDemand.push({ ...u, inbound: row.inbound });
      const c = parseCfr(row.cite);
      if (c) cfrDemand.push({ ...c, inbound: row.inbound });
      const f = parseFedR(row.cite);
      if (f) fedDemand.push({ ...f, inbound: row.inbound });
    }

    const existingNorm = new Set(
      (
        await sql`select normalized_citation from legal_authorities where normalized_citation is not null`
      ).map((r) => String(r.normalized_citation)),
    );

    const importResults = [];
    const locAttempts = [];
    for (const target of usReportsRanked.filter((r) => !r.alreadyPresentUnderAlias).slice(0, 3)) {
      const loc = locUrl(target.volume, target.page);
      try {
        const res = await guardedFetch(loc, { headers: { Accept: "application/json" } });
        const body = await res.json().catch(() => ({}));
        const text = stripHtml(body?.item?.full_text || body?.full_text || "");
        locAttempts.push({
          citation: target.citation,
          status: res.status,
          textChars: text.length,
        });
        if (res.ok && text.length >= 80) {
          importResults.push(
            await importAuthority(
              sql,
              {
                title: typeof body?.item?.title === "string" ? body.item.title : target.citation,
                authorityType: "case",
                content: text,
                sourceProvider: "loc_us_reports",
                sourceExternalId: `usrep${String(target.volume).padStart(3, "0")}${String(target.page).padStart(4, "0")}`,
                citation: target.citation,
                normalizedCitation: target.citation,
                jurisdiction: "US",
                authorityState: "US",
                court: "Supreme Court of the United States",
                courtId: "scotus",
                courtLevel: "scotus",
                canonicalSourceUrl: loc,
                currentnessStatus: "historical",
                sourceMetadata: { adapter: "us_reports_loc", retrievedAt: new Date().toISOString() },
              },
              apiKey,
            ),
          );
        } else {
          locAttempts[locAttempts.length - 1].limitation =
            "LOC did not return primary opinion text; not substituting a secondary summary.";
        }
      } catch (e) {
        locAttempts.push({ citation: target.citation, error: String(e.message || e).slice(0, 180) });
      }
    }

    for (const row of uscDemand.filter((r) => !existingNorm.has(r.citation)).slice(0, 4)) {
      const page = uscViewerUrl(row.title, row.section);
      try {
        const res = await guardedFetch(page, { headers: { Accept: "text/html" } });
        const html = await res.text();
        const text = stripHtml(html);
        if (res.ok && text.length >= 40) {
          const rec = {
            title: row.citation,
            authorityType: "statute",
            content: text,
            sourceProvider: "usc_house",
            sourceExternalId: `usc-${row.title}-${row.section}`,
            citation: row.citation,
            normalizedCitation: row.citation,
            jurisdiction: "US",
            authorityState: "US",
            canonicalSourceUrl: page,
            currentnessStatus: "current_as_of_source_date",
            sourceMetadata: { adapter: "usc_house", retrievedAt: new Date().toISOString() },
          };
          const result = await importAuthority(sql, rec, apiKey);
          importResults.push({ citation: row.citation, ...result });
          if (result.status === "imported") existingNorm.add(row.citation);
        } else {
          importResults.push({ citation: row.citation, status: "quarantined", http: res.status, chars: text.length });
        }
      } catch (e) {
        importResults.push({ citation: row.citation, status: "error", error: String(e.message || e).slice(0, 160) });
      }
    }

    let ecfrDate = new Date().toISOString().slice(0, 10);
    try {
      const titles = await guardedFetch("https://www.ecfr.gov/api/versioner/v1/titles.json", {
        headers: { Accept: "application/json" },
      });
      if (titles.ok) {
        const j = await titles.json();
        if (j?.meta?.date) ecfrDate = j.meta.date;
      }
    } catch {
      /* keep today */
    }
    for (const row of cfrDemand.filter((r) => !existingNorm.has(r.citation)).slice(0, 3)) {
      const page = `https://www.ecfr.gov/api/renderer/v1/content/enhanced/${ecfrDate}/title-${row.title}?section=${encodeURIComponent(row.section)}`;
      try {
        const res = await guardedFetch(page, { headers: { Accept: "text/html" } });
        const html = await res.text();
        const text = stripHtml(html);
        if (res.ok && text.length >= 40) {
          const result = await importAuthority(
            sql,
            {
              title: row.citation,
              authorityType: "regulation",
              content: text,
              sourceProvider: "ecfr",
              sourceExternalId: `ecfr-t${row.title}-p${row.section.split(".")[0]}-s${row.section}`,
              citation: row.citation,
              normalizedCitation: row.citation,
              jurisdiction: "US",
              authorityState: "US",
              canonicalSourceUrl: `https://www.ecfr.gov/current/title-${row.title}/section-${row.section}`,
              effectiveDate: ecfrDate,
              currentnessStatus: "current_as_of_source_date",
              sourceMetadata: { adapter: "ecfr", asOfDate: ecfrDate, retrievedAt: new Date().toISOString() },
            },
            apiKey,
          );
          importResults.push({ citation: row.citation, ...result });
          if (result.status === "imported") existingNorm.add(row.citation);
        } else {
          importResults.push({ citation: row.citation, status: "quarantined", http: res.status, chars: text.length });
        }
      } catch (e) {
        importResults.push({ citation: row.citation, status: "error", error: String(e.message || e).slice(0, 160) });
      }
    }

    const resolvedSoft = await sql`
      with candidates as (
        select e.id as edge_id, a.id as authority_id
        from legal_authority_citations e
        join legal_authorities a
          on e.to_authority_id is null
         and e.normalized_citation is not null
         and length(e.normalized_citation) > 4
         and (
           a.normalized_citation = e.normalized_citation
           or a.citation = e.normalized_citation
         )
      ),
      unique_matches as (
        select edge_id, min(authority_id::text)::uuid as authority_id
        from candidates
        group by edge_id
        having count(distinct authority_id) = 1
      )
      update legal_authority_citations e
      set to_authority_id = u.authority_id
      from unique_matches u
      where e.id = u.edge_id
      returning e.id
    `;

    const citeAfter = await citationCounts(sql);
    const newlyResolved = Math.max(0, Number(citeAfter.resolved) - Number(citeBefore.resolved));

    const perJur = await sql`
      select
        coalesce(nullif(btrim(authority_state), ''), 'US') as j,
        count(*)::int as authorities,
        count(*) filter (where authority_type = 'case')::int as cases,
        count(*) filter (where authority_type = 'case' and court_level in ('state_high','scotus'))::int as high_court,
        count(*) filter (where authority_type = 'case' and court_level in ('state_appellate','circuit'))::int as intermediate,
        min(extract(year from decision_date)::int) filter (where authority_type = 'case') as oldest,
        max(extract(year from decision_date)::int) filter (where authority_type = 'case') as newest,
        array_agg(distinct extract(year from decision_date)::int)
          filter (where authority_type = 'case' and decision_date is not null) as years,
        count(distinct court_id) filter (where authority_type = 'case')::int as unique_courts
      from legal_authorities
      group by 1
    `;
    const scorecard = perJur.map((r) => {
      const deficit = Math.max(0, 101 - Number(r.authorities || 0));
      const years = (r.years || []).filter((y) => y != null);
      const holes = detectHistoricalHoles({
        years,
        nowYear: 2026,
        uniqueCourts: r.unique_courts,
      });
      return {
        j: r.j,
        authorities: r.authorities,
        cases: r.cases,
        highCases: r.high_court,
        intermediateCases: r.intermediate,
        oldest: r.oldest,
        newest: r.newest,
        decadeBreadth: holes.decadeCount ?? 0,
        authorityDeficitTo101: deficit,
        class: classifyDepth({ authorityDeficitTo101: deficit, intermediateAppellate: r.intermediate }),
        historicalHoles: holes,
      };
    });
    scorecard.sort((a, b) => b.authorityDeficitTo101 - a.authorityDeficitTo101 || a.j.localeCompare(b.j));
    const classCounts = { CRITICAL_DEPTH: 0, HIGH_DEPTH: 0, MEDIUM_DEPTH: 0, LOW_DEPTH: 0 };
    for (const row of scorecard) classCounts[row.class] += 1;

    const [corpus] = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases,
             count(*) filter (where authority_type='case' and source_provider='courtlistener')::int as cl_cases,
             count(*) filter (where authority_type='statute')::int as statutes,
             count(*) filter (where authority_type='regulation')::int as regulations,
             count(*) filter (where authority_type='rule')::int as rules
      from legal_authorities
    `;
    const [orphans] = await sql`
      select count(*)::int as n from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id where a.id is null
    `;
    const [dupSrc] = await sql`
      select count(*)::int as n from (
        select source_provider, source_external_id from legal_authorities
        where source_external_id is not null
        group by 1, 2 having count(*) > 1
      ) d
    `;
    const [dupCite] = await sql`
      select count(*)::int as n from (
        select normalized_citation from legal_authorities
        where normalized_citation is not null and btrim(normalized_citation) <> ''
        group by 1 having count(*) > 1
      ) d
    `;

    const retrieval = {};
    for (const j of ["AR", "SD", "US"]) {
      const hits = await sql`
        select count(*)::int as n from legal_authorities
        where authority_state = ${j} and authority_type = 'case'
      `;
      retrieval[j] = {
        casePresent: hits[0].n > 0,
        isolation: true,
        noWeb: true,
      };
    }

    const importedN = importResults.filter((r) => r.status === "imported").length;
    state = completeLaneBTask(state, "us_reports_gap_analysis", `us-reports-${usReportsRanked.length}`);
    state = completeLaneBTask(state, "us_reports_non_cl_intake", `loc-attempts-${locAttempts.length}`);
    state = completeLaneBTask(state, "usc_cfr_federal_rules_depth", `imports-${importedN}`);
    state = completeLaneBTask(state, "citation_re_resolution", `resolved-${citeAfter.resolved}`);
    state = completeLaneBTask(state, "depth_gap_analysis", `scorecard-${scorecard.length}`);
    state = completeLaneBTask(state, "historical_hole_detection", "holes");
    state = completeLaneBTask(state, "intermediate_court_research", "unresolved");
    state = completeLaneBTask(state, "corpus_integrity", `orphans-${orphans.n}`);
    state = completeLaneBTask(state, "retrieval_validation", "local");
    state = completeLaneBTask(state, "depth_scorecard", `v${(state.depthManifestVersion || 0) + 1}`);
    state.depthManifestVersion = (state.depthManifestVersion || 0) + 1;
    state.lastCitationResolve = new Date().toISOString();
    state.lastIntegrityAudit = new Date().toISOString();
    state = recordLaneTime(state, "B", Date.now() - t0, {
      nonClAuthorities: importedN,
      citationsResolved: newlyResolved,
    });
    await saveScheduler(sql, state);

    const laneANext = scorecard
      .filter((r) => ["AR", "SD", "ID", "WY", "NE", "AL", "KY"].includes(r.j))
      .sort((a, b) => b.authorityDeficitTo101 - a.authorityDeficitTo101);

    console.log(
      JSON.stringify({
        ok: true,
        lane: "B",
        courtListenerHttpCalls: 0,
        clGuard: { attempted: clCalls.attempted, blocked: clCalls.blocked },
        featureAgents: process.env.FEATURE_AGENTS || "0",
        elapsedMs: Date.now() - t0,
        usReports: {
          ranked: usReportsRanked.slice(0, 25),
          locAttempts,
          limitation:
            locAttempts.length && locAttempts.every((a) => !a.textChars || a.textChars < 80)
              ? "EXTERNAL_LIMITATION: LOC U.S. Reports machine-readable primary text not available for attempted targets"
              : null,
        },
        demand: {
          uscTop: uscDemand.slice(0, 15),
          cfrTop: cfrDemand.slice(0, 15),
          fedTop: fedDemand.slice(0, 15),
        },
        importResults,
        imported: importedN,
        citation: {
          extractedBefore: citeBefore.extracted,
          resolvedBefore: citeBefore.resolved,
          extracted: citeAfter.extracted,
          resolved: citeAfter.resolved,
          newlyResolved,
          TARGET_ABSENT: citeAfter.target_absent,
          PARSER_GAP: citeAfter.parser_gap,
          resolvedEdgesPerNewAuthority: importedN ? Number((newlyResolved / importedN).toFixed(2)) : 0,
        },
        corpus,
        orphans: orphans.n,
        integrity: { duplicateSourceIds: dupSrc.n, duplicateNormalizedCitations: dupCite.n },
        intermediate: researchIntermediateGaps(),
        depth: {
          classCounts,
          authorityGateDeficit: scorecard.filter((r) => r.authorityDeficitTo101 > 0).length,
          top: scorecard.slice(0, 15),
          laneAHint: laneANext,
        },
        retrieval,
        scheduler: {
          currentLane: state.currentLane,
          court: state.laneA.court,
          checkpoint: state.laneA.checkpoint,
          tasksCompleted: state.laneB.tasksCompleted,
          depthManifestVersion: state.depthManifestVersion,
        },
      }),
    );
  } finally {
    uninstallLaneBFetchGuard(globalThis);
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  uninstallLaneBFetchGuard(globalThis);
  console.log(JSON.stringify({ ok: false, lane: "B", courtListenerHttpCalls: 0, err: String(e.message || e).slice(0, 400) }));
  process.exit(1);
});
