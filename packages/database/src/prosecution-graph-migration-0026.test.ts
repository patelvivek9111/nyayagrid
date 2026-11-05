import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the 0026 upgrade contract: legacy 0018 stub rows must be archived and
 * only UUID-backed refs may backfill as proposed projection nodes (never approved).
 */
describe("0026 prosecution graph migration contract", () => {
  const forward = readFileSync(
    resolve(__dirname, "../drizzle/0026_prosecution_case_graph.sql"),
    "utf8",
  );
  const down = readFileSync(
    resolve(__dirname, "../drizzle/0026_prosecution_case_graph.down.sql"),
    "utf8",
  );

  it("archives 0018 tables before replacing stub schema", () => {
    expect(forward).toContain("prosecution_graph_nodes_0018_archive");
    expect(forward).toContain("prosecution_graph_edges_0018_archive");
    expect(forward.includes('CREATE TABLE "prosecution_graph_nodes_0018_archive"')).toBe(true);
  });

  it("backfills migrated stubs as proposed projections only", () => {
    expect(forward).toContain("'projection'");
    expect(forward).toContain("'proposed'");
    const insertIdx = forward.indexOf('INSERT INTO "prosecution_graph_nodes"');
    expect(insertIdx).toBeGreaterThan(0);
    const insertBlock = forward.slice(insertIdx, insertIdx + 900);
    expect(insertBlock).toContain("'proposed'");
    expect(insertBlock).not.toContain("'approved'");
  });

  it("documents rollback limitation for post-upgrade rows", () => {
    expect(down).toContain("reviewable-only rows created after 0026 are discarded");
    expect(down).toContain("prosecution_graph_nodes_0018_archive");
  });
});
