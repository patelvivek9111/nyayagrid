/**
 * Format a matter date without the UTC midnight → local previous-day shift.
 * Timeline timestamps stored as `2024-01-01T00:00:00.000Z` must still read as 1 Jan 2024.
 */
export function formatMatterCalendarDate(
  iso: string | Date | null | undefined,
  options?: { dateUnknownLabel?: string; timezoneLabel?: string | null },
): string {
  const unknown = options?.dateUnknownLabel ?? "Date unknown";
  if (iso == null || iso === "") return unknown;

  const raw = typeof iso === "string" ? iso : iso.toISOString();
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T00:00:00(?:\.000)?Z$)/);
  const formatted = dateOnly
    ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))).toLocaleDateString(
        undefined,
        { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" },
      )
    : new Date(raw).toLocaleDateString();

  const tz = options?.timezoneLabel?.trim();
  return tz ? `${formatted} (${tz})` : `${formatted} (UTC calendar date)`;
}
