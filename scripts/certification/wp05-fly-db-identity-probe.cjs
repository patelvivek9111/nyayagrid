const u = process.env.DATABASE_URL || "";
let host = null;
let db = null;
let role = null;
try {
  const parsed = new URL(u);
  host = parsed.hostname;
  db = parsed.pathname.replace(/^\//, "").split("?")[0];
  role = decodeURIComponent(parsed.username || "");
} catch {
  /* ignore */
}
const looksProduct =
  Boolean(host && host.includes("lively-lake")) ||
  Boolean(host && host.includes("auyeia5m"));
console.log(
  JSON.stringify({
    hostEndsWith: host ? host.slice(Math.max(0, host.length - 48)) : null,
    database: db,
    role,
    productBranchEndpoint: looksProduct,
    sharedJollyBrook: Boolean(host && host.includes("jolly-brook")),
  }),
);
