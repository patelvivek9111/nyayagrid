/**
 * DISABLED — unpaced court-id probe caused Wave 2V 429.
 */
if (true) {
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
