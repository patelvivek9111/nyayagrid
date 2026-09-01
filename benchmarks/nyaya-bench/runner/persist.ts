import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PersistedAnswer } from "../graders/types";
import { RUNS_ROOT } from "./paths";

export function createRunDir(runId: string): string {
  const dir = join(RUNS_ROOT, runId);
  mkdirSync(join(dir, "answers"), { recursive: true });
  mkdirSync(join(dir, "grades"), { recursive: true });
  return dir;
}

export function answerPath(runDir: string, taskId: string): string {
  return join(runDir, "answers", `${taskId}.json`);
}

export function persistAnswer(runDir: string, answer: PersistedAnswer): string {
  const path = answerPath(runDir, answer.taskId);
  mkdirSync(join(runDir, "answers"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(answer, null, 2)}\n`, "utf8");
  return path;
}

export function persistGrade(runDir: string, taskId: string, grade: unknown): string {
  const path = join(runDir, "grades", `${taskId}.json`);
  mkdirSync(join(runDir, "grades"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(grade, null, 2)}\n`, "utf8");
  return path;
}

export function persistSummary(runDir: string, summary: unknown): string {
  const path = join(runDir, "summary.json");
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return path;
}

export function copyAnswers(sourceRunDir: string, destRunDir: string): string[] {
  mkdirSync(join(destRunDir, "answers"), { recursive: true });
  const names = readdirSync(join(sourceRunDir, "answers")).filter((name) => name.endsWith(".json"));
  for (const name of names) {
    copyFileSync(join(sourceRunDir, "answers", name), join(destRunDir, "answers", name));
  }
  return names.map((name) => name.replace(/\.json$/, ""));
}

export function assertAnswerPersisted(runDir: string, taskId: string): void {
  if (!existsSync(answerPath(runDir, taskId))) {
    throw new Error(
      `Refuse to load hidden_ground_truth until the answer is persisted: missing ${answerPath(runDir, taskId)}`,
    );
  }
}
