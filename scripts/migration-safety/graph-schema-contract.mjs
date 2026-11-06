/**
 * Prosecution graph schema contract — catalog-level integrity checks.
 * Used by pr09-matrix and CI-oriented smokes. Table existence / node_kind alone is insufficient.
 */

export const REQUIRED_NODE_CONSTRAINTS = [
  "prosecution_graph_nodes_organization_id_fkey",
  "prosecution_graph_nodes_criminal_case_id_fkey",
  "prosecution_graph_nodes_kind_chk",
  "prosecution_graph_nodes_origin_chk",
  "prosecution_graph_nodes_status_chk",
  "prosecution_graph_nodes_case_org_fk",
];

export const REQUIRED_EDGE_CONSTRAINTS = [
  "prosecution_graph_edges_organization_id_fkey",
  "prosecution_graph_edges_criminal_case_id_fkey",
  "prosecution_graph_edges_from_node_id_fkey",
  "prosecution_graph_edges_to_node_id_fkey",
  "prosecution_graph_edges_origin_chk",
  "prosecution_graph_edges_status_chk",
  "prosecution_graph_edges_confidence_chk",
  "prosecution_graph_edges_case_org_fk",
  "prosecution_graph_edges_from_case_fk",
  "prosecution_graph_edges_to_case_fk",
  "prosecution_graph_edges_from_org_fk",
  "prosecution_graph_edges_to_org_fk",
];

export const REQUIRED_INDEXES = [
  "prosecution_graph_nodes_canonical_uidx",
  "prosecution_graph_nodes_case_idx",
  "prosecution_graph_nodes_org_idx",
  "prosecution_graph_nodes_kind_idx",
  "prosecution_graph_nodes_id_case_uidx",
  "prosecution_graph_nodes_id_org_uidx",
  "prosecution_graph_edges_case_idx",
  "prosecution_graph_edges_org_idx",
  "prosecution_graph_edges_from_idx",
  "prosecution_graph_edges_to_idx",
  "prosecution_graph_edges_status_idx",
];

export const REQUIRED_NODE_COLUMNS = [
  "id",
  "organization_id",
  "criminal_case_id",
  "node_kind",
  "canonical_entity_type",
  "canonical_entity_id",
  "display_name",
  "provenance",
  "origin",
  "status",
  "metadata",
  "created_by_user_id",
  "created_at",
  "updated_at",
];

export const REQUIRED_EDGE_COLUMNS = [
  "id",
  "organization_id",
  "criminal_case_id",
  "from_node_id",
  "to_node_id",
  "relationship_type",
  "provenance",
  "origin",
  "status",
  "confidence",
  "created_by_user_id",
  "reviewed_by_user_id",
  "reviewed_at",
  "rejection_reason",
  "created_at",
  "updated_at",
];

/**
 * @param {import("postgres").Sql} sql
 */
export async function assertGraphSchemaContract(sql) {
  const nodeCols = await sql`
    select column_name, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'prosecution_graph_nodes'
  `;
  const edgeCols = await sql`
    select column_name, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'prosecution_graph_edges'
  `;
  const nodeNames = new Set(nodeCols.map((r) => r.column_name));
  const edgeNames = new Set(edgeCols.map((r) => r.column_name));
  for (const c of REQUIRED_NODE_COLUMNS) {
    if (!nodeNames.has(c)) throw new Error(`contract: missing node column ${c}`);
  }
  for (const c of REQUIRED_EDGE_COLUMNS) {
    if (!edgeNames.has(c)) throw new Error(`contract: missing edge column ${c}`);
  }
  if (nodeNames.has("node_type") || nodeNames.has("ref_id")) {
    throw new Error("contract: stub columns still present on nodes");
  }
  if (edgeNames.has("from_ref") || edgeNames.has("to_ref")) {
    throw new Error("contract: stub columns still present on edges");
  }

  const nullableNode = Object.fromEntries(nodeCols.map((r) => [r.column_name, r.is_nullable]));
  for (const c of [
    "organization_id",
    "criminal_case_id",
    "node_kind",
    "canonical_entity_type",
    "canonical_entity_id",
    "display_name",
    "provenance",
    "origin",
    "status",
    "metadata",
  ]) {
    if (nullableNode[c] !== "NO") throw new Error(`contract: node.${c} must be NOT NULL`);
  }

  const cons = await sql`
    select conname from pg_constraint
    where conrelid in (
      'public.prosecution_graph_nodes'::regclass,
      'public.prosecution_graph_edges'::regclass
    )
  `;
  const conNames = new Set(cons.map((r) => r.conname));
  for (const name of [...REQUIRED_NODE_CONSTRAINTS, ...REQUIRED_EDGE_CONSTRAINTS]) {
    if (!conNames.has(name)) throw new Error(`contract: missing constraint ${name}`);
  }

  const idxs = await sql`
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'i'
      and c.relname like 'prosecution_graph_%'
  `;
  const idxNames = new Set(idxs.map((r) => r.name));
  for (const name of REQUIRED_INDEXES) {
    if (!idxNames.has(name)) throw new Error(`contract: missing index ${name}`);
  }

  return {
    nodeColumns: nodeCols.length,
    edgeColumns: edgeCols.length,
    constraints: conNames.size,
    indexes: REQUIRED_INDEXES.length,
  };
}

/**
 * Snapshot comparable catalog signatures for clean vs repaired parity.
 * @param {import("postgres").Sql} sql
 */
export async function snapshotGraphCatalog(sql) {
  const columns = await sql`
    select table_name, column_name, data_type, is_nullable,
           coalesce(column_default, '') as column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('prosecution_graph_nodes', 'prosecution_graph_edges')
    order by table_name, ordinal_position
  `;
  const constraints = await sql`
    select c.conname, c.contype, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname in ('prosecution_graph_nodes', 'prosecution_graph_edges')
    order by c.conname
  `;
  const indexes = await sql`
    select indexname, indexdef
    from pg_indexes
    where schemaname = 'public'
      and tablename in ('prosecution_graph_nodes', 'prosecution_graph_edges')
    order by indexname
  `;
  return {
    columns: columns.map(
      (r) => `${r.table_name}.${r.column_name}:${r.data_type}:${r.is_nullable}:${r.column_default}`,
    ),
    constraints: constraints.map((r) => `${r.conname}:${r.contype}:${r.def}`),
    indexes: indexes.map((r) => `${r.indexname}:${r.indexdef}`),
  };
}

/**
 * @param {{ columns: string[], constraints: string[], indexes: string[] }} a
 * @param {{ columns: string[], constraints: string[], indexes: string[] }} b
 */
export function diffCatalog(a, b) {
  const diff = (xs, ys) => ({
    onlyA: xs.filter((x) => !ys.includes(x)),
    onlyB: ys.filter((y) => !xs.includes(y)),
  });
  return {
    columns: diff(a.columns, b.columns),
    constraints: diff(a.constraints, b.constraints),
    indexes: diff(a.indexes, b.indexes),
  };
}
