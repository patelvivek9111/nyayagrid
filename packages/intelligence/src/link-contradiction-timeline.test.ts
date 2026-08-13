import { describe, expect, it } from "vitest";
import {
  linkContradictionToTimelineEvents,
  linkTimelineEventsToContradictionFindings,
} from "./analysis/link-contradiction-timeline";

describe("contradiction ↔ timeline linking", () => {
  const chunkA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const chunkB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  const finding = {
    title: "CAM package date conflict",
    explanation: "Sources disagree on when the February CAM package was sent.",
    findingType: "contradiction",
    sources: [
      {
        side: "A",
        chunkId: chunkA,
        documentId: "doc-depo",
        supportingText:
          "Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025.",
      },
      {
        side: "B",
        chunkId: chunkB,
        documentId: "doc-email",
        supportingText:
          "The February CAM package was uploaded to the portal on March 3, 2025; I do not see an earlier transmission.",
      },
    ],
  };

  const eventFeb = {
    id: "evt-feb",
    title: "CAM package emailed",
    description: "Property manager says CAM package emailed February 28, 2025.",
    eventDate: new Date("2025-02-28T00:00:00.000Z"),
    actors: ["Property Manager"],
    status: "proposed",
    sources: [{ chunkId: chunkA, documentId: "doc-depo", supportingText: "emailed on February 28, 2025" }],
  };

  const eventMar = {
    id: "evt-mar",
    title: "CAM package uploaded",
    description: "Portal upload on March 3, 2025.",
    eventDate: new Date("2025-03-03T00:00:00.000Z"),
    actors: ["Property Manager"],
    status: "proposed",
    sources: [{ chunkId: chunkB, documentId: "doc-email", supportingText: "uploaded on March 3, 2025" }],
  };

  it("links each dated side to its own timeline event (dual remains dual)", () => {
    const linked = linkContradictionToTimelineEvents({
      finding,
      events: [eventFeb, eventMar],
    });

    expect(linked.autoMergeForbidden).toBe(true);
    expect(linked.relatedTimelineEventIds).toEqual(expect.arrayContaining(["evt-feb", "evt-mar"]));
    expect(linked.sideAEventIds).toContain("evt-feb");
    expect(linked.sideBEventIds).toContain("evt-mar");
    // Critical: both sides stay addressable — we do not collapse to one event id only.
    expect(new Set([...linked.sideAEventIds, ...linked.sideBEventIds]).size).toBeGreaterThanOrEqual(2);
  });

  it("never invents a merged verified event from two conflicting sides", () => {
    const linked = linkContradictionToTimelineEvents({
      finding,
      events: [eventFeb, eventMar],
    });
    // Helper returns navigation links only — no single winner event.
    expect(linked.links.every((l) => l.eventId === "evt-feb" || l.eventId === "evt-mar")).toBe(true);
    expect(linked.links.some((l) => l.side === "A" || l.side === "both")).toBe(true);
    expect(linked.links.some((l) => l.side === "B" || l.side === "both")).toBe(true);
  });

  it("builds inverse finding links for timeline events", () => {
    const map = linkTimelineEventsToContradictionFindings({
      events: [eventFeb, eventMar],
      findings: [{ id: "finding-1", ...finding }],
    });
    expect(map.get("evt-feb")).toContain("finding-1");
    expect(map.get("evt-mar")).toContain("finding-1");
  });

  it("does not link unrelated timeline events", () => {
    const linked = linkContradictionToTimelineEvents({
      finding,
      events: [
        {
          id: "evt-unrelated",
          title: "Lease signed",
          description: "Parties signed the master lease on January 1, 2024.",
          eventDate: new Date("2024-01-01T00:00:00.000Z"),
          actors: ["Landlord"],
          status: "approved",
          sources: [{ chunkId: "cccccccc-cccc-cccc-cccc-cccccccccccc", documentId: "doc-lease" }],
        },
      ],
    });
    expect(linked.relatedTimelineEventIds).toEqual([]);
  });
});
