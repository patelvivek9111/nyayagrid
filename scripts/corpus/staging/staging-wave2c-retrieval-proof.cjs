const postgres = require("postgres");

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
  const queries = [
    { key: "usc", cite: "28 U.S.C. § 1331" },
    { key: "cfr", cite: "29 C.F.R. § 541.300" },
    { key: "cfr_alt", cite: "29 CFR § 541.300" },
    { key: "frcp", cite: "Fed. R. Civ. P. 12" },
    { key: "pa", cite: "42 Pa.C.S. § 5525" },
    { key: "ny", cite: "N.Y." },
    { key: "ca", cite: "Cal." },
    { key: "tx", cite: "Tex." },
    { key: "nj", cite: "N.J.S.A." },
    { key: "al_deepened", cite: "Ala. Code" },
    { key: "pa_reg", cite: "34 Pa. Code § 231.1" },
    { key: "fl_reg", cite: "Fla. Admin. Code" },
    { key: "va_reg", cite: "VAC" },
    { key: "oh_reg", cite: "Ohio Admin" },
    { key: "tx_reg", cite: "Tex. Admin" },
    { key: "pa_rule", cite: "Pa.R.C.P." },
    { key: "ca_rule", cite: "Cal. Rules of Court" },
    { key: "tx_rule", cite: "Tex. R. Civ. P." },
    { key: "miss", cite: "ZZZ.FAKE.STATUTE § 99999" },
  ];
  const hits = {};
  for (const q of queries) {
    if (q.key === "miss") {
      const rows = await sql`
        select citation, authority_type::text as t, authority_state, left(title,80) as title
        from legal_authorities
        where source_provider = 'us-primary-corpus'
          and (citation ilike ${"%" + q.cite + "%"} or title ilike ${"%" + q.cite + "%"})
        limit 3
      `;
      hits[q.key] = { cite: q.cite, rows, missSafe: rows.length === 0 };
      continue;
    }
    if (["ny", "ca", "tx", "nj", "al_deepened"].includes(q.key)) {
      const state =
        q.key === "ny"
          ? "NY"
          : q.key === "ca"
            ? "CA"
            : q.key === "tx"
              ? "TX"
              : q.key === "nj"
                ? "NJ"
                : "AL";
      const rows = await sql`
        select citation, authority_type::text as t, authority_state, left(title,100) as title,
          canonical_source_url is not null as has_url,
          currentness_status::text as currentness
        from legal_authorities
        where source_provider = 'us-primary-corpus'
          and authority_state = ${state}
          and authority_type = 'statute'
        order by citation
        limit 5
      `;
      hits[q.key] = { state, rows };
      continue;
    }
    if (
      ["pa_reg", "fl_reg", "va_reg", "oh_reg", "tx_reg", "pa_rule", "ca_rule", "tx_rule"].includes(
        q.key,
      )
    ) {
      const rows = await sql`
        select citation, authority_type::text as t, authority_state, left(title,100) as title,
          canonical_source_url is not null as has_url,
          currentness_status::text as currentness
        from legal_authorities
        where source_provider = 'us-primary-corpus'
          and (
            citation ilike ${"%" + q.cite.replace("§", "%") + "%"}
            or title ilike ${"%" + q.cite + "%"}
          )
        limit 3
      `;
      hits[q.key] = { cite: q.cite, rows };
      continue;
    }
    const rows = await sql`
      select citation, normalized_citation, authority_type::text as t, authority_state,
        left(title,100) as title, canonical_source_url is not null as has_url,
        currentness_status::text as currentness
      from legal_authorities
      where source_provider = 'us-primary-corpus'
        and (
          citation ilike ${"%" + q.cite.replace("§", "%") + "%"}
          or normalized_citation ilike ${"%" + q.cite.replace("§", "%") + "%"}
          or title ilike ${"%" + q.cite + "%"}
        )
      limit 3
    `;
    hits[q.key] = { cite: q.cite, rows };
  }

  const chunks = await sql`
    select count(*)::int as n
    from legal_authority_chunks c
    join legal_authorities a on a.id = c.authority_id
    where a.source_provider = 'us-primary-corpus'
  `;
  const emb = await sql`
    select count(*)::int as n
    from legal_authority_chunks c
    join legal_authorities a on a.id = c.authority_id
    where a.source_provider = 'us-primary-corpus' and c.embedding is not null
  `;
  console.log(
    JSON.stringify(
      {
        ok: true,
        hits,
        chunks: chunks[0],
        embeddings: emb[0],
        featureAgents: process.env.FEATURE_AGENTS ?? null,
        generalWebNote: "Legal Research contract remains generalWebEnabled=false; this probe is corpus SQL only",
      },
      null,
      2,
    ),
  );
  await sql.end({ timeout: 5 });
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 300) }));
  process.exit(1);
});
