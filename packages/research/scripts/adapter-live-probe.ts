import { writeFile } from "node:fs/promises";
import { createEcfrAdapter } from "../src/corpus/adapters/ecfr";
import { createCourtListenerAdapter } from "../src/corpus/adapters/courtlistener";
import { createUscHouseAdapter } from "../src/corpus/adapters/usc";

async function main() {
  const ecfr = createEcfrAdapter({
    sectionTargets: [{ title: 29, part: "541", section: "541.100" }],
    rateLimitMs: 50,
  });
  const d = await ecfr.discover?.(undefined, 1);
  const fetched = d?.items?.length && ecfr.fetch ? await ecfr.fetch(d.items) : [];
  const parsed = await ecfr.parse(fetched);

  const cl = createCourtListenerAdapter({});
  const clDiscover = await cl.discover?.(undefined, 1);
  const clFetch = clDiscover?.items?.length && cl.fetch ? await cl.fetch(clDiscover.items) : [];
  const clParse = await cl.parse(clFetch.length ? clFetch : [{ sourceExternalId: "missing-key", raw: null, retrievedAt: new Date().toISOString() }]);

  const usc = createUscHouseAdapter({
    sectionTargets: [{ title: 28, section: "1331" }],
    rateLimitMs: 50,
  });
  const uscD = await usc.discover?.(undefined, 1);
  const uscF = uscD?.items?.length && usc.fetch ? await usc.fetch(uscD.items) : [];
  const uscP = await usc.parse(uscF);

  const report = {
    ecfr: {
      discoverCount: d?.items?.length ?? 0,
      fetchCount: fetched.length,
      records: parsed.records.map((r) => ({
        title: r.title,
        citation: r.citation,
        len: r.content?.length,
        hash: r.contentHash?.slice(0, 16),
        url: r.canonicalSourceUrl,
      })),
      quarantined: parsed.quarantined,
    },
    courtlistener: {
      discoverCount: clDiscover?.items?.length ?? 0,
      fetchCount: clFetch.length,
      quarantined: clParse.quarantined,
      records: clParse.records.length,
      requiresApiKey: cl.capabilities.requiresApiKey,
    },
    usc: {
      discoverCount: uscD?.items?.length ?? 0,
      fetchCount: uscF.length,
      records: uscP.records.map((r) => ({
        title: r.title,
        citation: r.citation,
        len: r.content?.length,
        url: r.canonicalSourceUrl,
      })),
      quarantined: uscP.quarantined,
    },
  };

  await writeFile("adapter-live-probe.json", `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
