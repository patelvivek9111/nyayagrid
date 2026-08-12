import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, paginate } from "./pagination";

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a payload", () => {
    const payload = { createdAt: "2024-01-01T00:00:00.000Z", id: "abc-123" };
    const cursor = encodeCursor(payload);
    expect(typeof cursor).toBe("string");
    expect(decodeCursor(cursor)).toEqual(payload);
  });

  it("returns null for missing/invalid cursors", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("not-base64-json!!")).toBeNull();
  });
});

describe("paginate", () => {
  const rows = [{ id: "1" }, { id: "2" }, { id: "3" }];

  it("returns all rows and no cursor when under the limit", () => {
    const result = paginate(rows, 10, (row) => ({ id: row.id }));
    expect(result.items).toEqual(rows);
    expect(result.nextCursor).toBeNull();
  });

  it("truncates to limit and returns a cursor when there is another page", () => {
    const result = paginate(rows, 2, (row) => ({ id: row.id }));
    expect(result.items).toEqual([{ id: "1" }, { id: "2" }]);
    expect(result.nextCursor).not.toBeNull();
    expect(decodeCursor(result.nextCursor)).toEqual({ id: "2" });
  });
});
