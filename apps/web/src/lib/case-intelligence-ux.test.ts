import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { humanizeKey } from "./plain-labels";
import {
  evidenceLinkSummary,
  evidenceMatrixIssues,
  filterTimelineEvents,
  graphCanvasEdgeLabel,
  graphCanvasEdgeLabelPriority,
  graphNodeFilterType,
  isAlwaysVisibleGraphRelationship,
  isCommunicationEventType,
  isDeadlineEventType,
  isDisputedTimelineEvent,
  isVerifiedStatus,
  memoryGroupId,
  memoryGroupLabel,
  peopleKindFilter,
  pickVisibleGraphEdgeLabelIds,
  shouldShowGraphCanvasEdgeLabel,
  sourceCountLabel,
  trustStatusFromRecord,
  unwrapEvidencePreviews,
  userFacingLoadError,
  type TimelineEventLike,
  formatTimelineDateCertainty,
} from "./case-intelligence-ux";
import { edgePath, layoutCaseGraph } from "./graph-layout";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

const verifiedEvent: TimelineEventLike = {
  id: "e1",
  title: "Lease commenced",
  eventType: "effective_date",
  eventDate: "2024-01-01T00:00:00.000Z",
  status: "approved",
  sources: [{ id: "s1" }],
};

const emailEvent: TimelineEventLike = {
  id: "e2",
  title: "Notice sent",
  eventType: "communication",
  eventDate: "2025-02-28T00:00:00.000Z",
  status: "approved",
  relatedFindingIds: ["f1"],
  sources: [{ id: "s2" }, { id: "s3" }],
};

const deadlineEvent: TimelineEventLike = {
  id: "e3",
  title: "Response due",
  eventType: "deadline",
  eventDate: "2025-03-15T00:00:00.000Z",
  status: "approved",
};

const suggestedEvent: TimelineEventLike = {
  id: "e4",
  title: "Suggested meeting",
  eventType: "meeting",
  status: "proposed",
};

describe("Case Intelligence timeline UX", () => {
  it("separates verified chronology from suggestions", () => {
    expect(filterTimelineEvents([verifiedEvent, emailEvent], [suggestedEvent], "all")).toEqual([
      verifiedEvent,
      emailEvent,
    ]);
    expect(filterTimelineEvents([verifiedEvent], [suggestedEvent], "suggested")).toEqual([
      suggestedEvent,
    ]);
  });

  it("marks disputed events from related findings without collapsing sides", () => {
    expect(isDisputedTimelineEvent(emailEvent)).toBe(true);
    expect(isDisputedTimelineEvent(verifiedEvent)).toBe(false);
    expect(filterTimelineEvents([verifiedEvent, emailEvent], [], "disputed")).toEqual([emailEvent]);
  });

  it("filters communications and deadlines from existing event types only", () => {
    expect(isCommunicationEventType("communication")).toBe(true);
    expect(isDeadlineEventType("deadline")).toBe(true);
    expect(
      filterTimelineEvents([verifiedEvent, emailEvent, deadlineEvent], [], "communications"),
    ).toEqual([emailEvent]);
    expect(
      filterTimelineEvents([verifiedEvent, emailEvent, deadlineEvent], [], "deadlines"),
    ).toEqual([deadlineEvent]);
  });

  it("keeps Add event and source controls in the timeline page", () => {
    const page = src("src/app/app/cases/[matterId]/timeline/page.tsx");
    expect(page).toContain("+ Add event");
    expect(page).toContain("IntelligenceDialog");
    expect(page).toContain("sourceCountLabel");
    expect(page).toContain("Your verified timeline will appear here as events are confirmed.");
    expect(page).not.toContain("Add manual event");
    expect(page).not.toContain("Create approved edge");
    expect(formatTimelineDateCertainty(verifiedEvent)).toBe("Recorded date");
    expect(formatTimelineDateCertainty({ ...verifiedEvent, eventDate: null })).toBe("Date unknown");
  });
});

describe("Case Intelligence evidence UX", () => {
  it("keeps conflict sides distinct and does not pick a truth", () => {
    const page = src("src/app/app/cases/[matterId]/evidence/page.tsx");
    expect(page).toContain("Source A");
    expect(page).toContain("Source B");
    expect(page).toContain("NyayaGrid does not choose between these accounts automatically.");
    expect(page).toContain("Review evidence");
    expect(page).not.toContain("auto-merge");
  });

  it("unwraps nested document intelligence into readable labels", () => {
    const previews = unwrapEvidencePreviews({
      linkedEvents: [{ event: { title: "Lease commencement" } }],
      linkedFacts: [{ fact: { label: "Base rent", value: "$48,000/year" } }],
      linkedGraphEdges: [
        {
          edge: { relationshipType: "supports" },
          fromNode: { displayName: "Email" },
          toNode: { displayName: "Notice date" },
        },
      ],
    });
    expect(previews.map((p) => p.label)).toContain("Lease commencement");
    expect(previews.some((p) => p.label.includes("Base rent") || p.label.includes("$48,000"))).toBe(
      true,
    );
    expect(evidenceLinkSummary(previews)).toContain("event");
    expect(previews.some((p) => p.kind === "Connection" && p.label.includes("Supports"))).toBe(
      true,
    );
  });

  it("does not render blank Event:/Fact: rows as the primary document preview", () => {
    const page = src("src/app/app/cases/[matterId]/evidence/page.tsx");
    expect(page).not.toContain("{l.kind}: {l.label}");
    expect(page).toContain("No extracted case connections yet.");
  });

  it("reads evidence matrix issues rather than treating the object as an array", () => {
    expect(evidenceMatrixIssues({ issues: [{ label: "Notice timing" }] })).toHaveLength(1);
    expect(evidenceMatrixIssues([{ label: "legacy" }])).toHaveLength(1);
    const page = src("src/app/app/cases/[matterId]/evidence/page.tsx");
    expect(page).toContain("evidenceMatrixIssues");
  });
});

describe("Case Intelligence people UX", () => {
  it("renders roster filters only for supported classifications", () => {
    expect(peopleKindFilter("person", [{ role: "witness" }], "people")).toBe(true);
    expect(peopleKindFilter("organization", [], "organizations")).toBe(true);
    expect(peopleKindFilter("person", [{ role: "witness" }], "witnesses")).toBe(true);
    expect(peopleKindFilter("person", [{ role: "counsel" }], "witnesses")).toBe(false);
    const page = src("src/app/app/cases/[matterId]/people/page.tsx");
    expect(page).toContain("roleFiltersAvailable");
    expect(page).toContain("No people or organizations identified yet.");
  });
});

describe("Case Intelligence graph UX", () => {
  it("layouts nodes and keeps suggested edges distinct from verified edges", () => {
    const laid = layoutCaseGraph({
      nodes: [
        { id: "a", displayName: "Property Manager", nodeType: "person" },
        { id: "b", displayName: "Feb 28 Email", nodeType: "document" },
      ],
      width: 800,
      height: 400,
    });
    expect(laid).toHaveLength(2);
    expect(laid[0]?.x).not.toBe(laid[1]?.x);
    const path = edgePath(laid[0]!, laid[1]!);
    expect(path.startsWith("M ")).toBe(true);
    const page = src("src/app/app/cases/[matterId]/graph/page.tsx");
    const canvas = src("src/components/ux/case-intelligence-graph.tsx");
    expect(canvas).toContain('strokeDasharray={verified ? undefined : "6 4"}');
    expect(canvas).toContain('role="button"');
    expect(canvas).toContain("aria-pressed={selected}");
    expect(page).toContain("+ Add connection");
    expect(page).toContain("GRAPH_RELATIONSHIP_OPTIONS");
    expect(page).toContain("/graph/edges");
    expect(page).toContain("Connections");
    expect(page).toContain("Proposed graph edges");
    expect(page).not.toContain("Create approved edge");
    expect(page).not.toContain("From node");
  });

  it("maps node types to lawyer filters without inventing evidence nodes", () => {
    expect(graphNodeFilterType("person")).toBe("people");
    expect(graphNodeFilterType("document")).toBe("documents");
    expect(graphNodeFilterType("event")).toBe("events");
    expect(graphNodeFilterType("fact")).toBe("facts");
  });

  it("hides ordinary canvas labels by default and shows them on hover or selection", () => {
    expect(
      shouldShowGraphCanvasEdgeLabel({
        relationshipType: "supported_by",
        hovered: false,
        selected: false,
        connectedToSelectedNode: false,
      }),
    ).toBe(false);
    expect(
      shouldShowGraphCanvasEdgeLabel({
        relationshipType: "related_to",
        hovered: true,
        selected: false,
        connectedToSelectedNode: false,
      }),
    ).toBe(true);
    expect(
      shouldShowGraphCanvasEdgeLabel({
        relationshipType: "mentioned_in",
        hovered: false,
        selected: false,
        connectedToSelectedNode: true,
      }),
    ).toBe(true);
    expect(
      shouldShowGraphCanvasEdgeLabel({
        relationshipType: "contains_fact",
        hovered: false,
        selected: true,
        connectedToSelectedNode: false,
      }),
    ).toBe(true);
    expect(
      shouldShowGraphCanvasEdgeLabel({
        relationshipType: "supported_by",
        hovered: false,
        selected: false,
        connectedToSelectedNode: false,
      }),
    ).toBe(false);
  });

  it("keeps unrelated ordinary labels hidden when another node is selected", () => {
    expect(
      shouldShowGraphCanvasEdgeLabel({
        relationshipType: "supported_by",
        hovered: false,
        selected: false,
        connectedToSelectedNode: false,
      }),
    ).toBe(false);
  });

  it("preserves distinct labels for stored important relationship types", () => {
    expect(isAlwaysVisibleGraphRelationship("contradicts")).toBe(true);
    expect(isAlwaysVisibleGraphRelationship("supported_by")).toBe(false);
    expect(isAlwaysVisibleGraphRelationship("related_to")).toBe(false);
    expect(graphCanvasEdgeLabel("contradicts")).toBe("Conflicts with");
    expect(graphCanvasEdgeLabel("supported_by")).toBe("Supported by");
    expect(graphCanvasEdgeLabel("related_to")).toBe("Related to");
    expect(graphCanvasEdgeLabel("mentioned_in")).toBe("Mentioned in");
    expect(graphCanvasEdgeLabel("contains_fact")).toBe("Contains fact");
    expect(graphCanvasEdgeLabel("supported_by")).not.toBe(graphCanvasEdgeLabel("supports"));
  });

  it("prefers hovered and selected labels when nearby labels would collide", () => {
    expect(
      graphCanvasEdgeLabelPriority({
        hovered: true,
        selected: false,
        alwaysVisible: false,
        connectedToSelectedNode: true,
      }),
    ).toBeGreaterThan(
      graphCanvasEdgeLabelPriority({
        hovered: false,
        selected: false,
        alwaysVisible: false,
        connectedToSelectedNode: true,
      }),
    );
    const visible = pickVisibleGraphEdgeLabelIds([
      { id: "hovered", x: 10, y: 10, priority: 100 },
      { id: "ordinary", x: 12, y: 12, priority: 20 },
      { id: "far", x: 200, y: 200, priority: 20 },
    ]);
    expect(visible.has("hovered")).toBe(true);
    expect(visible.has("ordinary")).toBe(false);
    expect(visible.has("far")).toBe(true);
  });

  it("keeps Connections list and accessible fallback semantics", () => {
    const page = src("src/app/app/cases/[matterId]/graph/page.tsx");
    const canvas = src("src/components/ux/case-intelligence-graph.tsx");
    expect(page).toContain("humanizeKey(edge.relationshipType)");
    expect(page).toContain('aria-label="Verified connections"');
    expect(page).toContain("Proposed graph edges");
    expect(page).toContain("sr-only");
    expect(page).toContain("Suggested by Nyaya");
    expect(canvas).toContain("graphCanvasEdgeLabel(edge.relationshipType)");
    expect(canvas).not.toContain("edge.label?.trim()");
    expect(canvas).not.toContain("supported_by");
  });
});

describe("Case Intelligence memory UX", () => {
  it("groups stored memory types into lawyer-facing sections", () => {
    expect(memoryGroupId("verified_context")).toBe("confirmed_facts");
    expect(memoryGroupLabel("confirmed_facts")).toBe("Confirmed facts");
    expect(memoryGroupId("user_instruction")).toBe("instructions");
    expect(memoryGroupLabel("instructions")).toBe("Attorney instructions");
  });

  it("preserves supersede/archive/review API behavior behind edit language", () => {
    const page = src("src/app/app/cases/[matterId]/memory/page.tsx");
    expect(page).toContain("Save updated memory");
    expect(page).toContain("oldMemoryId");
    expect(page).toContain("Editing preserves the previous version in history.");
    expect(page).toContain("Memory history");
    expect(page).toContain('review("archive")');
    expect(page).toContain("Accept");
    expect(page).toContain("Dismiss");
    expect(page).not.toContain("Supersede with edited copy");
    expect(page).not.toContain("Create / supersede memory");
    expect(isVerifiedStatus("approved")).toBe(true);
    expect(isVerifiedStatus("proposed")).toBe(false);
  });
});

describe("shared Case Intelligence language", () => {
  it("uses consistent trust and source labels", () => {
    expect(trustStatusFromRecord({ status: "approved" })).toBe("verified");
    expect(trustStatusFromRecord({ status: "proposed" })).toBe("suggested");
    expect(trustStatusFromRecord({ status: "approved", disputed: true })).toBe("disputed");
    expect(sourceCountLabel(0)).toBe("No sources");
    expect(sourceCountLabel(1)).toBe("View source");
    expect(sourceCountLabel(3)).toBe("View sources (3)");
    expect(humanizeKey("related_to")).toBe("Related to");
    expect(humanizeKey("supported_by")).toBe("Supported by");
    expect(humanizeKey("contradicts")).toBe("Conflicts with");
    expect(humanizeKey("timeline_event")).toBe("Event");
    expect(humanizeKey("manual_note")).toBe("Note");
    expect(humanizeKey("matter_fact")).toBe("Fact");
  });

  it("does not expose raw graph-admin copy on the five intelligence pages", () => {
    for (const relative of [
      "src/app/app/cases/[matterId]/timeline/page.tsx",
      "src/app/app/cases/[matterId]/evidence/page.tsx",
      "src/app/app/cases/[matterId]/people/page.tsx",
      "src/app/app/cases/[matterId]/graph/page.tsx",
      "src/app/app/cases/[matterId]/memory/page.tsx",
    ]) {
      const page = src(relative);
      expect(page).not.toContain("Create approved edge");
      expect(page).not.toContain("Failed to fetch graph materialization");
      expect(page).not.toContain("Inspect both sides");
    }
  });
});

describe("auth-aware load errors", () => {
  it("maps 401 and 403 to sign-in / no-access copy", () => {
    expect(userFacingLoadError("home", 401)).toMatch(/sign in/i);
    expect(userFacingLoadError("review", 403)).toMatch(/access/i);
    expect(userFacingLoadError("documents", 500)).toMatch(/couldn't load documents/i);
  });
});
