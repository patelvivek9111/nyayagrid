/**
 * Staging-only Brave presence probe. Never prints the API key value.
 * Usage via: fly ssh console --app nyayagrid-staging -C "node /tmp/brave-probe.cjs"
 * Or pipe this file content.
 */
const key = process.env.BRAVE_SEARCH_API_KEY;
if (!key || !String(key).trim()) {
  console.log(JSON.stringify({ ok: false, reason: "missing" }));
  process.exit(2);
}

const url =
  "https://api.search.brave.com/res/v1/web/search?q=" +
  encodeURIComponent("Pennsylvania Courts official site") +
  "&count=3";

fetch(url, {
  headers: {
    Accept: "application/json",
    "X-Subscription-Token": key,
  },
})
  .then(async (r) => {
    const j = await r.json();
    const results = (j.web && j.web.results) || [];
    const serialized = JSON.stringify(j);
    console.log(
      JSON.stringify({
        ok: r.ok,
        status: r.status,
        count: results.length,
        bounded: results.length <= 8,
        titles: results.map((x) => String(x.title || "").slice(0, 80)),
        urls: results.map((x) => String(x.url || "").slice(0, 120)),
        keyLeaked: serialized.includes(key),
      }),
    );
  })
  .catch((e) => {
    console.log(
      JSON.stringify({
        ok: false,
        error: String(e && e.message ? e.message : e).slice(0, 120),
      }),
    );
    process.exit(1);
  });
