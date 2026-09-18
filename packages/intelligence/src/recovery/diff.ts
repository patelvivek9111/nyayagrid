import type { DiffChange, LegalWorkPayload } from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (key === "embedding" || key === "updatedAt") continue;
      out[key] = normalize(value[key]);
    }
    return out;
  }
  return value;
}

function walk(path: string, before: unknown, after: unknown, out: DiffChange[]) {
  if (JSON.stringify(normalize(before)) === JSON.stringify(normalize(after))) return;

  if (typeof before === "string" && typeof after === "string") {
    out.push({ path: path || "text", kind: "changed", before, after });
    return;
  }

  if (Array.isArray(before) || Array.isArray(after)) {
    const a = Array.isArray(before) ? before : [];
    const b = Array.isArray(after) ? after : [];
    const max = Math.max(a.length, b.length);
    if (max > 20 || a.some((item) => !isPlainObject(item)) || b.some((item) => !isPlainObject(item))) {
      if (a.length !== b.length) {
        out.push({
          path: path || "list",
          kind: a.length < b.length ? "added" : "removed",
          before: a,
          after: b,
        });
      } else {
        out.push({ path: path || "list", kind: "changed", before: a, after: b });
      }
      return;
    }
    for (let i = 0; i < max; i += 1) {
      walk(path ? `${path}[${i}]` : `[${i}]`, a[i], b[i], out);
    }
    return;
  }

  if (isPlainObject(before) || isPlainObject(after)) {
    const left = isPlainObject(before) ? before : {};
    const right = isPlainObject(after) ? after : {};
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of [...keys].sort()) {
      if (key === "embedding" || key === "updatedAt") continue;
      const nextPath = path ? `${path}.${key}` : key;
      if (!(key in left)) {
        out.push({ path: nextPath, kind: "added", after: right[key] });
      } else if (!(key in right)) {
        out.push({ path: nextPath, kind: "removed", before: left[key] });
      } else {
        walk(nextPath, left[key], right[key], out);
      }
    }
    return;
  }

  if (before === undefined) {
    out.push({ path: path || "value", kind: "added", after });
  } else if (after === undefined) {
    out.push({ path: path || "value", kind: "removed", before });
  } else {
    out.push({ path: path || "value", kind: "changed", before, after });
  }
}

/** Deterministic structural/text diff. No model calls. */
export function diffPayloads(before: LegalWorkPayload, after: LegalWorkPayload): DiffChange[] {
  const out: DiffChange[] = [];
  walk("", before, after, out);
  return out;
}

export function diffTextLines(before: string, after: string): DiffChange[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const max = Math.max(a.length, b.length);
  const out: DiffChange[] = [];
  for (let i = 0; i < max; i += 1) {
    if (a[i] === b[i]) continue;
    if (a[i] === undefined) {
      out.push({ path: `line ${i + 1}`, kind: "added", after: b[i] });
    } else if (b[i] === undefined) {
      out.push({ path: `line ${i + 1}`, kind: "removed", before: a[i] });
    } else {
      out.push({ path: `line ${i + 1}`, kind: "changed", before: a[i], after: b[i] });
    }
  }
  return out;
}
