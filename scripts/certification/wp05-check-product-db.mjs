import postgres from "postgres";

const src = process.env.SOURCE_DATABASE_URL;
const dst = process.env.PRODUCT_DATABASE_URL;
if (!src || !dst) {
  console.error(JSON.stringify({ error: "SOURCE_DATABASE_URL and PRODUCT_DATABASE_URL required" }));
  process.exit(1);
}

const s = postgres(src, { max: 1, ssl: "require", prepare: false });
await s`SET default_transaction_read_only = on`;
const counts = {};
for (const t of [
  "legal_authorities",
  "legal_authority_citations",
  "legal_authority_chunks",
  "legal_authority_versions",
]) {
  const r = await s.unsafe(`SELECT COUNT(*)::bigint AS c FROM public.${t}`);
  counts[t] = Number(r[0].c);
}
await s.end({ timeout: 5 });

const d = postgres(dst, { max: 1, ssl: "require", prepare: false });
await d`SET default_transaction_read_only = on`;
const destTables = await d`
  SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema='public'`;
const exts = await d`SELECT extname FROM pg_extension ORDER BY 1`;
await d.end({ timeout: 5 });

console.log(
  JSON.stringify(
    {
      sourceCorpusCounts: counts,
      destPublicTables: destTables[0].c,
      destExtensions: exts.map((e) => e.extname),
      sourceUnchanged:
        counts.legal_authorities === 35863 && counts.legal_authority_citations === 80842,
    },
    null,
    2,
  ),
);
