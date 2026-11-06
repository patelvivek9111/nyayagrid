import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const drizzleRoot = resolve(__dirname, "../drizzle");

function sql(name: string): string {
  return readFileSync(resolve(drizzleRoot, name), "utf8");
}

describe("prosecution graph migration integrity (static)", () => {
  it("0031 creates reviewable tables with FKs and CHECKs (not bare shells)", () => {
    const forward = sql("0031_migration_safety_assertions.sql");
    expect(forward).toContain("prosecution_graph_nodes_organization_id_fkey");
    expect(forward).toContain("prosecution_graph_nodes_kind_chk");
    expect(forward).toContain("prosecution_graph_edges_from_node_id_fkey");
    expect(forward).toContain("prosecution_graph_edges_confidence_chk");
    expect(forward).toContain("prosecution_graph_nodes_canonical_uidx");
    expect(forward).toContain("refusing DROP — nodes archive missing");
    // Must not leave CREATE TABLE shell without constraints after the stub drop path
    const createNodes = forward.indexOf('CREATE TABLE IF NOT EXISTS "prosecution_graph_nodes"');
    const createEdges = forward.indexOf('CREATE TABLE IF NOT EXISTS "prosecution_graph_edges"');
    expect(createNodes).toBeGreaterThan(-1);
    expect(createEdges).toBeGreaterThan(createNodes);
    const nodesBlock = forward.slice(createNodes, createEdges);
    expect(nodesBlock).toContain("FOREIGN KEY");
    expect(nodesBlock).toContain("CHECK");
  });

  it("0032 adds case/org isolation composite FKs and fail-closed assertions", () => {
    const forward = sql("0032_prosecution_graph_integrity_contract.sql");
    expect(forward).toContain("prosecution_graph_edges_from_case_fk");
    expect(forward).toContain("prosecution_graph_edges_to_org_fk");
    expect(forward).toContain("prosecution_graph_nodes_case_org_fk");
    expect(forward).toContain("missing graph integrity constraints");
    expect(forward).toContain("missing graph integrity indexes");
    const down = sql("0032_prosecution_graph_integrity_contract.down.sql");
    expect(down.toLowerCase()).toContain("no-op");
  });

  it("journal includes 0032 after 0031", () => {
    const journal = JSON.parse(
      readFileSync(resolve(drizzleRoot, "meta/_journal.json"), "utf8"),
    ) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const e31 = journal.entries.find((e) => e.tag === "0031_migration_safety_assertions");
    const e32 = journal.entries.find((e) => e.tag === "0032_prosecution_graph_integrity_contract");
    expect(e31).toBeTruthy();
    expect(e32).toBeTruthy();
    expect(e32!.when).toBeGreaterThan(e31!.when);
    expect(e32!.idx).toBeGreaterThan(e31!.idx);
  });
});
