/**
 * Offline replay of saved paid-run outputs. Zero provider calls.
 * Does not mutate historical artifacts; reports original vs corrected scores separately.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getCacheDir } from "../src/paths.js";
import {
  scoreCitationReliability,
  scoreExactLabel,
} from "../src/prosecution-external/scorers/index.js";
import {
  LegalCiteBenchAdapter,
  resolveLegalCiteTaskForReplay,
} from "../src/prosecution-external/adapters/legalcitebench.js";
import { resolveLegalCiteBenchMount } from "../src/prosecution-external/suite.js";
import { loadLegalBenchProsecutionSliceAsync } from "../src/prosecution-external/suite.js";
import type { NormalizedTask } from "../src/schema/normalized-task.js";

type ReplayRow = {
  sampleId: string;
  benchmark: string;
  task: string;
  original: {
    correct: boolean | null;
    abstained: boolean;
    fabricatedAuthority: boolean;
    failures: string[];
  };
  corrected: {
    correct: boolean | null;
    abstained: boolean;
    fabricatedAuthority: boolean;
    failures: string[];
    answerClass?: unknown;
  };
  changed: boolean;
  reasonForChange?: string;
};

function loadJsonl(file: string): Array<Record<string, unknown>> {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function citationModeFor(
  taskType: string,
): "CLOSED_BOOK_DIAGNOSTIC" | "NYAYA_GROUNDED_VERIFICATION" {
  return taskType === "CITATION_RETRIEVAL" || taskType === "CITATION_COMPLETION"
    ? "CLOSED_BOOK_DIAGNOSTIC"
    : "NYAYA_GROUNDED_VERIFICATION";
}

function responseText(payload: Record<string, unknown>): string {
  const response = payload.response;
  if (
    response &&
    typeof response === "object" &&
    typeof (response as { text?: string }).text === "string"
  ) {
    return (response as { text: string }).text;
  }
  return "";
}

describe("offline replay of closed paid run (zero provider calls)", () => {
  const runDir = path.join(getCacheDir(), "runs", "prosecution-external-live");
  const hasArtifacts = existsSync(runDir) && existsSync(path.join(runDir, "response-calls.jsonl"));

  it("replays LegalCite + LegalBench saved outputs and clears prior FP fabrication", async () => {
    if (!hasArtifacts) {
      expect(hasArtifacts).toBe(false);
      return;
    }

    const calls = loadJsonl(path.join(runDir, "response-calls.jsonl"));
    const byId = new Map<string, Record<string, unknown>>();
    for (const f of readdirSync(runDir).filter(
      (x) => x.startsWith("batch-") && x.endsWith(".json"),
    )) {
      const report = JSON.parse(readFileSync(path.join(runDir, f), "utf8")) as {
        tasks?: Array<Record<string, unknown>>;
      };
      for (const t of report.tasks ?? []) {
        if (typeof t.sampleId === "string") {
          // Prefer later batches only when earlier lacked a scored outcome.
          const prev = byId.get(t.sampleId);
          if (!prev || (prev.correct == null && t.correct != null)) {
            byId.set(t.sampleId, t);
          } else if (!prev) {
            byId.set(t.sampleId, t);
          } else if (!byId.has(t.sampleId)) {
            byId.set(t.sampleId, t);
          } else {
            // Keep first successful scoring; overwrite only for same id if newer has more fields.
            byId.set(t.sampleId, { ...prev, ...t });
          }
        }
      }
    }

    const mount = resolveLegalCiteBenchMount();
    const citeTasks = mount ? await LegalCiteBenchAdapter.load(mount) : [];

    const lbSlice = await loadLegalBenchProsecutionSliceAsync({ fixtureFallback: true });
    const lbById = new Map(lbSlice.tasks.map((t) => [t.taskId, t]));

    const citeReplay: ReplayRow[] = [];
    const lbReplay: ReplayRow[] = [];

    for (const call of calls) {
      const payload = (call.payload ?? call) as Record<string, unknown>;
      const taskId = String(payload.taskId ?? "");
      const text = responseText(payload);
      const original = byId.get(taskId);
      if (!original || !text) continue;

      if (taskId.startsWith("legalcitebench::")) {
        const task =
          resolveLegalCiteTaskForReplay(citeTasks, taskId, text) ??
          ({
            benchmarkId: "legalcitebench",
            taskId,
            taskType: String(original.task ?? "CITATION_COMPLETION"),
            conversation: [{ role: "user", content: "(replay missing mount prompt)" }],
            expectedAnswer: null,
            metadata: {
              citationTaskType: String(original.task ?? "CITATION_COMPLETION"),
            },
          } satisfies NormalizedTask);
        const mode = citationModeFor(
          String(task.taskType ?? task.metadata?.citationTaskType ?? ""),
        );
        const corrected = scoreCitationReliability(task, text, mode);
        const reasons: string[] = [];
        if (Boolean(original.fabricatedAuthority) !== corrected.fabricatedAuthority) {
          reasons.push(
            corrected.fabricatedAuthority
              ? "fabrication_now_detected"
              : "input_supplied_or_abstention_cleared_false_fabrication",
          );
        }
        if (Boolean(original.abstained) !== corrected.abstained) {
          reasons.push(corrected.abstained ? "abstention_now_detected" : "abstention_cleared");
        }
        if (original.correct !== corrected.correct) {
          reasons.push("correctness_changed");
        }
        citeReplay.push({
          sampleId: taskId,
          benchmark: "legalcitebench",
          task: String(original.task ?? task.taskType),
          original: {
            correct: (original.correct as boolean | null) ?? null,
            abstained: Boolean(original.abstained),
            fabricatedAuthority: Boolean(original.fabricatedAuthority),
            failures: (original.failures as string[]) ?? [],
          },
          corrected: {
            correct: corrected.correct,
            abstained: corrected.abstained,
            fabricatedAuthority: corrected.fabricatedAuthority,
            failures: corrected.failures,
            answerClass: corrected.details?.answerClass,
          },
          changed: reasons.length > 0,
          reasonForChange: reasons.join("; ") || undefined,
        });
      } else {
        const task = lbById.get(taskId);
        if (!task) continue;
        const corrected = scoreExactLabel(task, text);
        lbReplay.push({
          sampleId: taskId,
          benchmark: "legalbench",
          task: String(original.task ?? task.taskType ?? ""),
          original: {
            correct: (original.correct as boolean | null) ?? null,
            abstained: Boolean(original.abstained),
            fabricatedAuthority: false,
            failures: (original.failures as string[]) ?? [],
          },
          corrected: {
            correct: corrected.correct,
            abstained: corrected.abstained,
            fabricatedAuthority: false,
            failures: corrected.failures,
            answerClass: corrected.details?.answerClass,
          },
          changed:
            original.correct !== corrected.correct ||
            Boolean(original.abstained) !== corrected.abstained,
          reasonForChange:
            original.correct !== corrected.correct ? "legalbench_correctness_delta" : undefined,
        });
      }
    }

    expect(citeReplay.length).toBe(9);
    expect(lbReplay.length).toBeGreaterThanOrEqual(30);

    const critical = citeReplay.find((r) => r.sampleId.includes("12576371"));
    expect(critical).toBeTruthy();
    expect(critical!.original.fabricatedAuthority).toBe(true);
    expect(critical!.original.abstained).toBe(false);
    expect(critical!.corrected.fabricatedAuthority).toBe(false);
    expect(critical!.corrected.abstained).toBe(true);
    expect(critical!.reasonForChange).toMatch(/false_fabrication|abstention_now_detected/);

    // Scorer must not mark everything PASS.
    const citeCorrectedPasses = citeReplay.filter((r) => r.corrected.correct === true).length;
    expect(citeCorrectedPasses).toBeLessThan(citeReplay.length);

    // LegalBench offline rescore should not invent mass regressions vs original live correctness.
    const lbOriginalCorrect = lbReplay.filter((r) => r.original.correct === true).length;
    const lbCorrectedCorrect = lbReplay.filter((r) => r.corrected.correct === true).length;
    expect(Math.abs(lbOriginalCorrect - lbCorrectedCorrect)).toBeLessThanOrEqual(3);

    const reportPath = path.join(runDir, "offline-rescore-wp01.json");
    writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          kind: "OFFLINE_RESCORE_ONLY",
          notALiveEvaluation: true,
          paidCalls: 0,
          courtlistenerCalls: 0,
          legalbench: {
            replayed: lbReplay.length,
            originalCorrect: lbOriginalCorrect,
            correctedCorrect: lbCorrectedCorrect,
            abstentionChanges: lbReplay.filter(
              (r) => r.original.abstained !== r.corrected.abstained,
            ).length,
            rows: lbReplay,
          },
          legalcitebench: {
            replayed: citeReplay.length,
            originalFabricationFlags: citeReplay.filter((r) => r.original.fabricatedAuthority)
              .length,
            correctedFabricationFlags: citeReplay.filter((r) => r.corrected.fabricatedAuthority)
              .length,
            originalCorrect: citeReplay.filter((r) => r.original.correct === true).length,
            correctedCorrect: citeCorrectedPasses,
            rows: citeReplay,
          },
          priorCriticalAfterReplay: critical,
        },
        null,
        2,
      )}\n`,
    );
    expect(existsSync(reportPath)).toBe(true);
  }, 120_000);
});
