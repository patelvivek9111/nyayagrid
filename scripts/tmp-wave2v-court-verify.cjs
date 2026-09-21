/**
 * DISABLED — unpaced court-id probe caused Wave 2V 429.
 * Use scripts/cl-court-map-registry.cjs (offline) or paced ensureCourtVerified in staging-cl-batch-job.
 * CourtListener HTTP requests from this file: FORBIDDEN unless CL_ALLOW_UNPACED_COURT_PROBE=1 (never set in prod).
 */
if (process.env.CL_ALLOW_UNPACED_COURT_PROBE !== "1") {
  console.log(
    JSON.stringify({
      ok: false,
      reason: "UNPACED_COURT_PROBE_DISABLED",
      courtListenerHttpCalls: 0,
      use: "scripts/cl-court-map-registry.cjs",
    }),
  );
  process.exit(2);
}
console.log(JSON.stringify({ ok: false, reason: "refusing_unpaced_probe_even_with_override" }));
process.exit(2);
