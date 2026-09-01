import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertIngestibleDocumentPath, isForbiddenBenchmarkPath } from "../runner/isolate";
import { datasetRoot } from "../runner/paths";
import { assertAnswerPersisted } from "../runner/persist";

const v1 = datasetRoot("v1");

describe("benchmark ingest isolation", () => {
  it("allows scenario document PDFs", () => {
    const allowed = join(v1, "scenarios", "SYNTH-001", "documents", "lease.pdf");
    expect(assertIngestibleDocumentPath(v1, allowed)).toContain("lease.pdf");
  });

  it("refuses hidden ground truth", () => {
    const forbidden = join(v1, "hidden_ground_truth", "SYNTH-001_ground_truth.json");
    expect(isForbiddenBenchmarkPath(forbidden)).toBe(true);
    expect(() => assertIngestibleDocumentPath(v1, forbidden)).toThrow(/hidden ground truth/i);
  });

  it("refuses review packets", () => {
    const review = join(v1, "review_packets", "anything.pdf");
    expect(() => assertIngestibleDocumentPath(v1, review)).toThrow(/review/i);
  });

  it("refuses files that are not under scenarios/<id>/documents/", () => {
    expect(() => assertIngestibleDocumentPath(v1, join(v1, "README.md"))).toThrow(/limited to/i);
  });

  it("refuses to grade before an answer file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "nyaya-bench-"));
    mkdirSync(join(dir, "answers"));
    expect(() => assertAnswerPersisted(dir, "SYNTH-001-Q001")).toThrow(
      /Refuse to load hidden_ground_truth/,
    );
    writeFileSync(join(dir, "answers", "SYNTH-001-Q001.json"), "{}");
    expect(() => assertAnswerPersisted(dir, "SYNTH-001-Q001")).not.toThrow();
  });
});
