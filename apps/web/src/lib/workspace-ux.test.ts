import { describe, expect, it } from "vitest";
import {
  activityKindLabel,
  filterReviewQueue,
  flattenReviewQueue,
  resolveActiveOrganizationId,
  reviewCategoryCounts,
  shouldShowWorkspaceSwitcher,
  taskPriorityLabel,
  taskStatusLabel,
} from "./workspace-ux";

describe("workspace UX helpers", () => {
  it("flattens proposed review buckets into a single queue", () => {
    const entries = flattenReviewQueue({
      facts: [
        {
          id: "f1",
          label: "Base rent",
          value: "$48,000/year",
          sources: [{ documentTitle: "Lease" }],
        },
      ],
      deadlines: [{ id: "d1", title: "Notice", dateKind: "inferred" }],
      analysis: {
        findings: [{ id: "c1", title: "Conflicting CAM send dates", runType: "contradiction" }],
      },
    });
    expect(entries.map((e) => e.kind)).toEqual(["fact", "deadline", "finding"]);
    expect(entries[0]?.typeLabel).toBe("Suggested fact");
    expect(entries[1]?.subtitle).toBe("Inferred from case files");
    expect(entries[2]?.typeLabel).toBe("Evidence conflict");
  });

  it("filters categories that exist", () => {
    const entries = flattenReviewQueue({
      facts: [{ id: "f1", label: "Fact" }],
      memories: [{ id: "m1", title: "Note", sources: [{}, {}] }],
    });
    const counts = reviewCategoryCounts(entries);
    expect(counts.all).toBe(2);
    expect(counts.facts).toBe(1);
    expect(counts.memory).toBe(1);
    expect(counts.graph).toBe(0);
    expect(filterReviewQueue(entries, "memory")).toHaveLength(1);
  });

  it("uses lawyer-facing activity and task labels", () => {
    expect(activityKindLabel("document")).toBe("Document uploaded");
    expect(activityKindLabel("artifact")).toBe("Nyaya answer saved");
    expect(taskStatusLabel("in_progress")).toBe("In progress");
    expect(taskPriorityLabel("high")).toBe("High priority");
  });

  it("shows a workspace switcher only when the user can access more than one org", () => {
    expect(shouldShowWorkspaceSwitcher(0)).toBe(false);
    expect(shouldShowWorkspaceSwitcher(1)).toBe(false);
    expect(shouldShowWorkspaceSwitcher(2)).toBe(true);
  });

  it("selects a saved org when still a membership, otherwise the first or none", () => {
    expect(resolveActiveOrganizationId([], "org_a")).toBe("");
    expect(resolveActiveOrganizationId([{ id: "org_a" }], null)).toBe("org_a");
    expect(resolveActiveOrganizationId([{ id: "org_a" }, { id: "org_b" }], "org_b")).toBe("org_b");
    expect(resolveActiveOrganizationId([{ id: "org_a" }, { id: "org_b" }], "org_gone")).toBe(
      "org_a",
    );
  });
});
