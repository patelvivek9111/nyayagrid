import { describe, expect, it } from "vitest";
import { formatMatterCalendarDate } from "./matter-dates";

describe("formatMatterCalendarDate", () => {
  it("keeps UTC midnight on the calendar day instead of shifting to the previous local day", () => {
    const midnight = formatMatterCalendarDate("2024-01-01T00:00:00.000Z");
    expect(midnight).toMatch(/2024/);
    expect(midnight).not.toMatch(/2023/);
    const dateOnly = formatMatterCalendarDate("2024-01-01");
    expect(dateOnly).toMatch(/2024/);
    expect(dateOnly).not.toMatch(/2023/);
  });

  it("labels missing dates as unknown", () => {
    expect(formatMatterCalendarDate(null)).toBe("Date unknown");
  });
});
