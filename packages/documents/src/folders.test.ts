import { describe, expect, it } from "vitest";
import { buildFolderParentMap, wouldCreateFolderCycle } from "./folders";

describe("document folder cycle detection", () => {
  const parentById = buildFolderParentMap([
    { id: "root", parentFolderId: null },
    { id: "a", parentFolderId: "root" },
    { id: "b", parentFolderId: "a" },
    { id: "c", parentFolderId: "b" },
    { id: "sibling", parentFolderId: "root" },
  ]);

  it("allows moving to root or unrelated ancestors", () => {
    expect(wouldCreateFolderCycle("c", null, parentById)).toBe(false);
    expect(wouldCreateFolderCycle("c", "root", parentById)).toBe(false);
    expect(wouldCreateFolderCycle("c", "sibling", parentById)).toBe(false);
    expect(wouldCreateFolderCycle("a", "sibling", parentById)).toBe(false);
  });

  it("blocks self-parent and descendant parents", () => {
    expect(wouldCreateFolderCycle("a", "a", parentById)).toBe(true);
    expect(wouldCreateFolderCycle("a", "b", parentById)).toBe(true);
    expect(wouldCreateFolderCycle("a", "c", parentById)).toBe(true);
    expect(wouldCreateFolderCycle("root", "c", parentById)).toBe(true);
  });

  it("detects pre-existing cycles in the parent map", () => {
    const cyclic = buildFolderParentMap([
      { id: "x", parentFolderId: "y" },
      { id: "y", parentFolderId: "x" },
    ]);
    expect(wouldCreateFolderCycle("z", "x", cyclic)).toBe(true);
  });
});
