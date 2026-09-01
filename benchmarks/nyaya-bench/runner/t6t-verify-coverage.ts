import postgres from "postgres";
import { loadBenchEnv } from "./load-env";

loadBenchEnv();
const sql = postgres(
  process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  { max: 1 },
);
const rows = await sql`
  SELECT status, count(*)::int AS n FROM jurisdiction_coverage GROUP BY status
`;
const sample = await sql`
  SELECT state_code, practice_area, status
  FROM jurisdiction_coverage
  ORDER BY state_code, practice_area
  LIMIT 8
`;
console.log(JSON.stringify({ rows, sample, total: rows.reduce((s, r) => s + r.n, 0) }, null, 2));
await sql.end();
