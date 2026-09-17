import { writeFile } from "node:fs/promises";
import { createDb, sql } from "@nyayagrid/database";
import { buildCorpusInventory } from "../src/corpus/inventory";

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  const inv = await buildCorpusInventory(db);

  const citations = [
    "28 U.S.C. § 1331",
    "29 CFR § 541.100",
    "42 Pa.C.S. § 5525",
    "Fed. R. Civ. P. 12",
  ];

  const citationHits: Record<string, unknown> = {};
  for (const citation of citations) {
    const rows = await db.execute(sql`
      select title, citation, authority_type::text as authority_type, authority_state,
             canonical_source_url, currentness_status::text as currentness_status
      from legal_authorities
      where source_provider = 'us-primary-corpus'
        and (citation ilike ${`%${citation.replace(/§/g, "%")}%`} or title ilike ${`%${citation}%`})
      limit 5
    `);
    citationHits[citation] = rows;
  }

  const typeCounts = await db.execute(sql`
    select authority_type::text as t, count(*)::int as n
    from legal_authorities
    where source_provider = 'us-primary-corpus'
    group by 1 order by 1
  `);

  const stateCounts = await db.execute(sql`
    select coalesce(authority_state, '?') as s, count(*)::int as n
    from legal_authorities
    where source_provider = 'us-primary-corpus'
    group by 1 order by 1
  `);

  const report = {
    inventory: {
      total: inv.totalAuthorities,
      real: inv.realPrimaryAuthorities,
      synth: inv.syntheticAuthorities,
      types: inv.realTypeCounts,
      federal: inv.federal,
      statesWithCorpus: Object.values(inv.states).filter((s) => s.authorityCount > 0).length,
      chunks: inv.chunkCount,
      versions: inv.versionCount,
    },
    sqlTypeCounts: typeCounts,
    sqlStateCount: Array.isArray(stateCounts) ? stateCounts.length : 0,
    citationHits,
  };
  await writeFile("corpus-sql-probe.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
