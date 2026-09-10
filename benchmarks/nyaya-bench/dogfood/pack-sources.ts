/**
 * Writes reviewer source packets. No model calls. Does not copy hidden ground truth.
 */
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOGFOOD_MATTERS, DOGFOOD_PACK_ID, lateDocument, RUBRIC_CATEGORIES, SAFETY_FLAGS, sourceDocuments, suggestedReviewerLoad } from "./catalog";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BENCH = resolve(ROOT, "..");
const DIST = join(ROOT, "dist");

function formMarkdown(matterId: string, taskId: string, title: string): string {
  const scores = RUBRIC_CATEGORIES.map(
    (c) => `| ${c.key} | ${c.label} |  |  |`,
  ).join("\n");
  const flags = SAFETY_FLAGS.map((f) => `| ${f.key} | ${f.prompt} | YES / NO |`).join("\n");
  return `# Review form — ${matterId} / ${taskId}

**${title}**

- Reviewer name:
- Role (attorney / student / paralegal / operator):
- Date:
- Minutes spent:
- NyayaGrid output location:

Score 1–5 or NA if the workflow was not run. 1=unusable, 3=usable with caution, 5=would trust with source check.

| Key | Category | Score | Notes |
| --- | --- | --- | --- |
${scores}

## Safety (circle YES/NO)

| Key | Question | Answer |
| --- | --- | --- |
${flags}

Expected: **would_rely_without_checking = NO**. NyayaGrid is assistive.

## Issues

Classify each problem CRITICAL / MAJOR / MINOR. Stylistic disagreement is MINOR or omit.

1. Severity:    Theme:    Exact source-backed example:
2.

## Use in practice

would-use-in-practice: YES / WITH CHANGES / NO

Free-text observations:

Time-to-complete (minutes):
`;
}

function taskSheet(matter: (typeof DOGFOOD_MATTERS)[number]): string {
  return [
    `# ${matter.id} — ${matter.title}`,
    "",
    `SYNTHETIC FILE. Not a real client. Not legal advice. As-of ${matter.asOf}.`,
    "",
    `- Domain: ${matter.domain}`,
    `- Profile: ${matter.profile}`,
    `- Why in the pack: ${matter.whySelected}`,
    `- Workflows in scope: ${matter.workflows.join(", ")}`,
    "",
    "Read the `sources/` folder (or the V2 PDFs) before judging NyayaGrid. Do not open facilitator scoring keys.",
    "",
    ...matter.tasks.flatMap((task) => [
      `## ${task.id} — ${task.title}`,
      "",
      `- Output location: ${task.outputLocation}`,
      `- Rubric: ${task.rubric.join(", ")}`,
      "",
      task.reviewerActivity,
      "",
    ]),
  ].join("\n");
}

function main(): void {
  mkdirSync(DIST, { recursive: true });
  const index = [
    `# ${DOGFOOD_PACK_ID} source packets`,
    "",
    "Generated without model calls. Hidden ground truth is not included.",
    "",
    "Suggested reviewer load (2–3 matters each):",
    ...suggestedReviewerLoad().map((row) => `- ${row.reviewer}: ${row.matterIds.join(", ")}`),
    "",
  ];
  for (const matter of DOGFOOD_MATTERS) {
    const dir = join(DIST, "packets", matter.id);
    mkdirSync(join(dir, "sources"), { recursive: true });
    mkdirSync(join(dir, "sources-late"), { recursive: true });
    mkdirSync(join(dir, "forms"), { recursive: true });
    writeFileSync(join(dir, "TASKS.md"), `${taskSheet(matter)}\n`);
    if (matter.source.kind === "fw1") {
      for (const doc of sourceDocuments(matter)) {
        writeFileSync(join(dir, "sources", doc.filename), doc.body);
      }
      const late = lateDocument(matter);
      if (late) {
        writeFileSync(
          join(dir, "sources-late", late.filename),
          `${late.body}\n\nFACILITATOR: give this file to the reviewer only after the first draft pass.\n`,
        );
      }
    } else {
      const src = join(BENCH, matter.source.documentsRel);
      const note = [
        `V2 PDFs live at ${matter.source.documentsRel} (copied below if present).`,
        "Do not copy datasets/v2/hidden_ground_truth into this packet.",
        "",
      ].join("\n");
      writeFileSync(join(dir, "sources", "README.md"), `${note}\n`);
      if (existsSync(src)) {
        for (const name of readdirSync(src)) {
          if (!name.toLowerCase().endsWith(".pdf")) continue;
          copyFileSync(join(src, name), join(dir, "sources", name));
        }
      }
    }
    for (const task of matter.tasks) {
      writeFileSync(join(dir, "forms", `${task.id}.md`), formMarkdown(matter.id, task.id, task.title));
    }
    index.push(`- [${matter.id} ${matter.title}](./packets/${matter.id}/TASKS.md)`);
  }
  writeFileSync(join(DIST, "PACKET_INDEX.md"), `${index.join("\n")}\n`);
  process.stdout.write(`${JSON.stringify({ wrote: DIST, matters: DOGFOOD_MATTERS.length, modelCalls: 0 })}\n`);
}

main();
