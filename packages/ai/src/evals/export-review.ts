/**
 * Export live (or mock, if explicitly labeled) agent outputs for attorney review.
 *
 * Mock exports must never be presented as live model quality.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ReviewExportItem = {
  workflow: string;
  id: string;
  description: string;
  input: string;
  output: string;
  sources: string;
  evidenceState?: string;
};

export function writeReviewExport(params: {
  dir: string;
  provider: string;
  model: string;
  live: boolean;
  items: ReviewExportItem[];
  /** Required live-run config block (prompt versions, snapshot, rerank, temperature). */
  runConfig?: string;
}): string {
  mkdirSync(params.dir, { recursive: true });
  const banner = params.live
    ? `Live provider=${params.provider} model=${params.model}`
    : `MOCK provider=${params.provider} — not valid for attorney quality review`;
  const indexLines = [
    `# Agent output export`,
    "",
    banner,
    `Exported: ${new Date().toISOString()}`,
    `Items: ${params.items.length}`,
    "",
    params.runConfig ? `${params.runConfig}\n` : "",
    "Each file is one output. Blind-review against the rubric in docs/AGENT_QUALITY_ATTORNEY_REVIEW.md.",
    "",
  ].filter((line) => line !== "");

  for (const [i, item] of params.items.entries()) {
    const filename = `${String(i + 1).padStart(2, "0")}-${item.workflow}-${item.id}.md`;
    const body = [
      `# ${item.id}`,
      "",
      `- Workflow: ${item.workflow}`,
      `- Description: ${item.description}`,
      `- Provider: ${params.provider} / ${params.model}`,
      `- Live: ${params.live ? "yes" : "NO (mock — do not score as model quality)"}`,
      item.evidenceState ? `- evidenceState: ${item.evidenceState}` : "",
      "",
      "## Input",
      "",
      item.input,
      "",
      "## Output",
      "",
      item.output,
      "",
      "## Cited sources",
      "",
      item.sources || "(none)",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n");
    writeFileSync(join(params.dir, filename), `${body}\n`, "utf8");
    indexLines.push(`- [${filename}](./${filename}) — ${item.description}`);
  }

  const indexPath = join(params.dir, "README.md");
  writeFileSync(indexPath, `${indexLines.join("\n")}\n`, "utf8");
  return indexPath;
}
