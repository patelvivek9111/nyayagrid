import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { runArtifactsDir } from "./persistence.js";

export type OfflineScoreInput = {
  runId: string;
  scoreFn: (savedResponse: unknown) => number;
};

export function scoreFromSavedResponses(input: OfflineScoreInput): {
  scored: number;
  scores: number[];
} {
  const responseDir = path.join(runArtifactsDir(input.runId), "response");
  let entries: string[] = [];
  try {
    entries = readdirSync(responseDir).filter((f) => f.endsWith(".json"));
  } catch {
    return { scored: 0, scores: [] };
  }
  const scores: number[] = [];
  for (const file of entries) {
    const raw = readFileSync(path.join(responseDir, file), "utf8");
    const parsed = JSON.parse(raw) as { response?: unknown };
    scores.push(input.scoreFn(parsed.response));
  }
  return { scored: scores.length, scores };
}
