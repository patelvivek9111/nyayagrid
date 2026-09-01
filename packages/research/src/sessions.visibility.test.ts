import { describe, expect, it } from "vitest";
import { filterVisibleResearchSessions } from "./sessions";

describe("filterVisibleResearchSessions", () => {
  const rows = [
    { id: "s1", matterId: null, title: "org-level" },
    { id: "s2", matterId: "matter-a", title: "secret matter" },
    { id: "s3", matterId: "matter-b", title: "assigned matter" },
  ];

  it("lets organization owners see every session", () => {
    expect(filterVisibleResearchSessions(rows, "all")).toEqual(rows);
  });

  it("hides matter-linked sessions the viewer cannot access", () => {
    const visible = filterVisibleResearchSessions(rows, ["matter-b"]);
    expect(visible.map((row) => row.id)).toEqual(["s1", "s3"]);
  });
});
