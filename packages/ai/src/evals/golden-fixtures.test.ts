import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGoldenFixtureDocuments, GOLDEN_MATTER_ID } from "./golden-matter";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "golden-fixtures");

describe("golden fixture documents", () => {
  it("builds one uploadable body per logical document", () => {
    const docs = buildGoldenFixtureDocuments();
    expect(docs.map((d) => d.documentKey).sort()).toEqual(
      ["doc_amendment", "doc_depo", "doc_email", "doc_email_pm", "doc_lease"].sort(),
    );
    for (const doc of docs) {
      expect(doc.filename).toMatch(/^synth-.*\.txt$/i);
      expect(doc.body).toContain("SYNTHETIC EVAL FIXTURE");
      expect(doc.body).toContain(GOLDEN_MATTER_ID);
      expect(doc.body).toContain(doc.title);
    }
  });

  it("keeps committed golden-fixtures/*.txt in sync with the corpus builder", () => {
    const docs = buildGoldenFixtureDocuments();
    for (const doc of docs) {
      const path = join(fixturesDir, doc.filename);
      expect(existsSync(path), `missing ${doc.filename}`).toBe(true);
      expect(readFileSync(path, "utf8")).toBe(doc.body);
    }
  });
});
