/**
 * Cursor-pagination helpers.
 *
 * Pattern for a "heavy" list API (many rows, or rows with large joined data):
 *
 *   1. Parse `{ limit, cursor }` with `cursorPaginationSchema` from `@nyayagrid/validation`.
 *   2. `decodeCursor<{ createdAt: string; id: string }>(cursor)` to get the last-seen row's sort
 *      key, or `null` for the first page.
 *   3. Query `WHERE (createdAt, id) < (cursor.createdAt, cursor.id) ORDER BY createdAt DESC, id DESC
 *      LIMIT (limit + 1)` — fetching one extra row to detect whether another page exists.
 *   4. Pass the fetched rows through `paginate(rows, limit, (row) => ({ createdAt: ..., id: ... }))`
 *      to get back `{ items, nextCursor }`. Return `nextCursor` to the client as an opaque string.
 *
 * The cursor is intentionally opaque (base64url JSON) so callers never need to know its shape,
 * and so the sort key can change later without breaking the public API contract.
 */

export type CursorPayload = Record<string, string | number>;

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor<T extends CursorPayload = CursorPayload>(
  cursor?: string | null,
): T | null {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as T;
  } catch {
    return null;
  }
}

export type PageResult<T> = {
  items: T[];
  nextCursor: string | null;
};

/**
 * Given rows fetched with `LIMIT limit + 1`, returns the page of `limit` items plus an opaque
 * `nextCursor` (or `null` when there is no further page).
 */
export function paginate<T>(
  rows: T[],
  limit: number,
  getCursorPayload: (row: T) => CursorPayload,
): PageResult<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(getCursorPayload(last)) : null;
  return { items, nextCursor };
}
