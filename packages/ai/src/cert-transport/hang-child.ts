/**
 * Tiny hang child for watchdog tests. Ignores SIGTERM. Parent must force-kill the tree.
 */
export {};

process.on("SIGTERM", () => {
  /* refuse graceful exit */
});
process.on("SIGINT", () => {
  /* refuse */
});
setInterval(() => {
  /* keep event loop alive */
}, 60_000);
await new Promise(() => {
  /* hang forever */
});
