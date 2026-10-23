import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FAILURE_TAXONOMY } from "../src/schema/failure-taxonomy.js";
import { getRegistryDir } from "../src/paths.js";

describe("failure taxonomy", () => {
  it("matches registry JSON", () => {
    const raw = JSON.parse(
      readFileSync(path.join(getRegistryDir(), "failure-taxonomy.json"), "utf8"),
    ) as { categories: string[] };
    expect(raw.categories).toEqual([...FAILURE_TAXONOMY]);
  });
});
