import { describe, expect, it } from "vitest";
import { humanizeKey } from "./plain-labels";

describe("humanizeKey", () => {
  it("maps known keys to plain language", () => {
    expect(humanizeKey("verified_context")).toBe("Confirmed fact");
    expect(humanizeKey("awaiting_approval")).toBe("Needs your OK");
    expect(humanizeKey("related_to")).toBe("Related to");
    expect(humanizeKey("timeline_event")).toBe("Event");
  });

  it("falls back to spaces instead of underscores", () => {
    expect(humanizeKey("custom_edge_type")).toBe("custom edge type");
  });
});
