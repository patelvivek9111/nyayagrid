import { describe, expect, it } from "vitest";

/** Mirror of batch-job Retry-After parser for unit coverage. */
function parseRetryAfterSec(headers: { get(name: string): string | null }, now = Date.now()): number | null {
  const h = headers.get("retry-after");
  if (!h) return null;
  const asInt = Number.parseInt(h, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return Math.min(asInt, 3600);
  const when = Date.parse(h);
  if (Number.isFinite(when)) {
    const sec = Math.ceil((when - now) / 1000);
    return sec > 0 ? Math.min(sec, 3600) : null;
  }
  return null;
}

function citationStatus(citation: string | null, docket: string | null): "reported" | "unreported" | "citation_unknown" {
  if (citation && citation.trim()) return "reported";
  if (docket && docket.trim()) return "unreported";
  return "citation_unknown";
}

describe("Wave 2B CL rate-limit helpers", () => {
  it("parses integer Retry-After seconds", () => {
    expect(parseRetryAfterSec({ get: () => "12" })).toBe(12);
  });

  it("parses HTTP-date Retry-After", () => {
    const now = Date.parse("Thu, 01 Jan 2026 00:00:00 GMT");
    const later = "Thu, 01 Jan 2026 00:00:30 GMT";
    expect(parseRetryAfterSec({ get: () => later }, now)).toBe(30);
  });

  it("caps Retry-After at 3600", () => {
    expect(parseRetryAfterSec({ get: () => "99999" })).toBe(3600);
  });

  it("classifies citation status without fabricating reporter cites", () => {
    expect(citationStatus("410 U.S. 113", null)).toBe("reported");
    expect(citationStatus(null, "22-123")).toBe("unreported");
    expect(citationStatus(null, null)).toBe("citation_unknown");
  });
});
