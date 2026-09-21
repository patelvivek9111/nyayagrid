/**
 * DISABLED — unpaced court search caused Wave 2V 429 cascade.
 */
console.log(
  JSON.stringify({
    ok: false,
    reason: "UNPACED_COURT_PROBE_DISABLED",
    courtListenerHttpCalls: 0,
    use: "scripts/cl-court-map-registry.cjs + paced staging-cl-court-map-probe.ts with CL_ALLOW_COURT_PROBE=1",
  }),
);
process.exit(2);
