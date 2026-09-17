import { writeFile } from "node:fs/promises";
import { createDb } from "@nyayagrid/database";
import { createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import { buildCorpusInventory } from "../src/corpus/inventory";
import { AuthorityHybridRetriever } from "../src/search";

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  const inv = await buildCorpusInventory(db);
  const embeddings = createEmbeddingProviderFromEnv();
  const retriever = new AuthorityHybridRetriever(db, embeddings);

  const queries = [
    { id: "federal_statute", q: "28 U.S.C. § 1331" },
    { id: "federal_reg", q: "29 CFR § 541.100 executive employees" },
    { id: "pa_statute", q: "42 Pa.C.S. § 5525" },
    { id: "ny_case", q: "Gristede's Foods" },
    { id: "ca_case", q: "California employment retaliation high court" },
    { id: "tx_statute", q: "Texas Civil Practice and Remedies Code limitations" },
    { id: "nj_issue", q: "New Jersey statute of limitations for contracts" },
    { id: "miss", q: "Rhode Island unicorn property forfeiture statute § 99999.01" },
  ];

  const retrieval: Record<string, unknown> = {};
  for (const row of queries) {
    const hits = await retriever.search(row.q, {}, { limit: 5 });
    retrieval[row.id] = {
      hitCount: hits.length,
      top: hits.slice(0, 3).map((h) => ({
        citation: h.citation,
        title: h.title,
        authorityState: h.authorityState,
        authorityType: h.authorityType,
        score: h.score,
        url: h.canonicalSourceUrl,
      })),
    };
  }

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
    retrieval,
  };
  await writeFile("corpus-retrieval-probe.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
