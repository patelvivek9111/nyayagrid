import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getFixturesDir } from "../paths.js";

export type DummyProviderOptions = {
  fixturesDir?: string;
  modelId?: string;
};

export type DummyCompletionRequest = {
  taskId: string;
  benchmarkId: string;
  messages: Array<{ role: string; content: string }>;
};

export type DummyCompletionResponse = {
  modelId: string;
  taskId: string;
  content: string;
  finishReason: "stop";
  usage: { inputTokens: number; outputTokens: number };
};

type FixtureBundle = {
  prefilledResponses?: Record<string, string>;
};

function loadFixtureBundle(fixturesDir: string, benchmarkId: string): FixtureBundle {
  const file = path.join(fixturesDir, `${benchmarkId}-like.json`);
  if (!existsSync(file)) {
    return {};
  }
  return JSON.parse(readFileSync(file, "utf8")) as FixtureBundle;
}

export class FakeProvider {
  readonly modelId: string;
  private readonly fixturesDir: string;

  constructor(options: DummyProviderOptions = {}) {
    this.modelId = options.modelId ?? "dummy/fixture";
    this.fixturesDir = options.fixturesDir ?? getFixturesDir();
  }

  complete(request: DummyCompletionRequest): DummyCompletionResponse {
    const bundle = loadFixtureBundle(this.fixturesDir, request.benchmarkId);
    const prefilled =
      bundle.prefilledResponses?.[request.taskId] ??
      `Synthetic deterministic response for ${request.taskId}`;

    const inputChars = request.messages.reduce((n, m) => n + m.content.length, 0);

    return {
      modelId: this.modelId,
      taskId: request.taskId,
      content: prefilled,
      finishReason: "stop",
      usage: {
        inputTokens: Math.ceil(inputChars / 4),
        outputTokens: Math.ceil(prefilled.length / 4),
      },
    };
  }
}
