import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LegalBenchAdapter } from "../src/adapters/legalbench.js";

describe("LegalBench multi-task root empty-dir skip", () => {
  let root = "";

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("skips empty task folders when loading a tasks root", async () => {
    root = mkdtempSync(path.join(tmpdir(), "lb-empty-skip-"));
    const good = path.join(root, "hearsay");
    const empty = path.join(root, "rule_qa");
    mkdirSync(good);
    mkdirSync(empty);
    writeFileSync(
      path.join(good, "test.tsv"),
      ["index\ttext\tlabel", "0\tIs this hearsay?\tyes"].join("\n"),
      "utf8",
    );
    writeFileSync(path.join(empty, "test.tsv"), "index\ttext\tlabel\n", "utf8");

    const loaded = await LegalBenchAdapter.load(root);
    expect(loaded.length).toBe(1);
    expect(loaded[0]?.taskId).toContain("hearsay");
  });

  it("still fails when a single empty task directory is loaded directly", async () => {
    root = mkdtempSync(path.join(tmpdir(), "lb-empty-single-"));
    writeFileSync(path.join(root, "test.tsv"), "index\ttext\tlabel\n", "utf8");
    await expect(LegalBenchAdapter.load(root)).rejects.toThrow(/no loadable TSV rows/i);
  });
});
