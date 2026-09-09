/**
 * Router Auto / Deep / disagreement checks after registry overlay is known.
 * Individual model certification must already be decided. This measures Router.
 */
import {
  NyayaRouter,
  analyzeDisagreement,
  createDirectProvider,
  parseJsonObject,
  constrainCitedAnswer,
  assessRetrievedEvidenceDeterministic,
  validateCitedAnswerAgainstPassages,
  type AIProvider,
  type DirectProviderId,
  type ModelRegistryEntry,
  type ProviderId,
} from "@nyayagrid/ai";
import {
  CONTRADICTION_CASES,
  contradictionCaseToPrompt,
  GRADED_CASES,
  gradeCitedAnswer,
  gradeContradictionCase,
  gradedCaseToPrompt,
  LIVE_EVAL_TEMPERATURE,
} from "@nyayagrid/ai/evals";

function providersFromEnv(available: DirectProviderId[]): Partial<Record<ProviderId, AIProvider>> {
  const providers: Partial<Record<ProviderId, AIProvider>> = {};
  for (const id of available) {
    try {
      providers[id] = createDirectProvider({ provider: id }).provider;
    } catch {
      /* skip missing */
    }
  }
  return providers;
}

export type AutoTaskResult = {
  taskId: string;
  subsystem: string;
  provider: string;
  model: string;
  strategyRequested: string;
  strategySelected: string;
  riskLevel: string;
  routingReason: string;
  verdict: "pass" | "fail" | "critical" | "error";
  latencyMs: number;
  estimatedCostUsd: number | null;
};

export type AutoBenchmarkResult = {
  materialQuality: number | null;
  criticalSafety: number | null;
  pass: number;
  fail: number;
  critical: number;
  total: number;
  providerDistribution: Record<string, number>;
  strategyDistribution: Record<string, number>;
  fallbackRate: number;
  deepEscalationRate: number;
  p50: number | null;
  p95: number | null;
  costKnown: boolean;
  costPerTask: number | null;
  criticalTaskIds: string[];
  tasks: AutoTaskResult[];
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? null;
}

async function gradeRoutedAsk(params: {
  router: NyayaRouter;
  testCase: (typeof GRADED_CASES)[number];
  strategy: "auto" | "fast" | "standard";
}): Promise<AutoTaskResult> {
  const prompts = gradedCaseToPrompt(params.testCase);
  const started = Date.now();
  try {
    const result = await params.router.generate({
      messages: [
        { role: "system", content: prompts.systemPrompt },
        { role: "user", content: prompts.userPrompt },
      ],
      temperature: LIVE_EVAL_TEMPERATURE,
      routing: { strategy: params.strategy, subsystem: "ask" },
    });
    const audit = params.router.lastAudits.at(-1);
    const parsed = parseJsonObject(result.text);
    let verdict: AutoTaskResult["verdict"] = "error";
    if (parsed.ok) {
      let raw = parsed.value;
      const assessment = assessRetrievedEvidenceDeterministic(
        params.testCase.question,
        params.testCase.retrieved,
      );
      if (assessment) {
        const validated = validateCitedAnswerAgainstPassages(raw, params.testCase.retrieved);
        raw = constrainCitedAnswer(validated.answer, assessment, params.testCase.retrieved);
      }
      const grade = gradeCitedAnswer({
        caseId: params.testCase.id,
        raw,
        retrieved: params.testCase.retrieved,
        rubric: params.testCase.rubric,
        question: params.testCase.question,
        workflow: "case_qa",
        verifiedIntelligence: params.testCase.verifiedIntelligence,
        verifiedGraph: params.testCase.verifiedGraph,
        verifiedMemory: params.testCase.verifiedMemory,
        shouldRefuse: params.testCase.shouldRefuse,
        trapKind: params.testCase.trapKind,
      });
      if (grade.flags.falseConfidence || grade.flags.fabricatedCites > 0) verdict = "critical";
      else if (grade.passed) verdict = "pass";
      else verdict = "fail";
    } else {
      verdict = "fail";
    }
    const cost =
      result.estimatedCost && result.estimatedCost.known ? result.estimatedCost.amountUsd : null;
    return {
      taskId: params.testCase.id,
      subsystem: "ask",
      provider: result.provider,
      model: result.model,
      strategyRequested: params.strategy,
      strategySelected: audit?.strategySelected ?? "unknown",
      riskLevel: audit?.riskLevel ?? "unknown",
      routingReason: audit?.routingReason ?? "",
      verdict,
      latencyMs: result.latencyMs ?? Date.now() - started,
      estimatedCostUsd: cost,
    };
  } catch (error) {
    return {
      taskId: params.testCase.id,
      subsystem: "ask",
      provider: "none",
      model: "none",
      strategyRequested: params.strategy,
      strategySelected: "error",
      riskLevel: "unknown",
      routingReason: error instanceof Error ? error.message.slice(0, 160) : "error",
      verdict: "error",
      latencyMs: Date.now() - started,
      estimatedCostUsd: null,
    };
  }
}

function summarizeTasks(tasks: AutoTaskResult[]): AutoBenchmarkResult {
  const pass = tasks.filter((t) => t.verdict === "pass").length;
  const critical = tasks.filter((t) => t.verdict === "critical").length;
  const fail = tasks.filter((t) => t.verdict === "fail" || t.verdict === "error").length;
  const total = tasks.length;
  const providerDistribution: Record<string, number> = {};
  const strategyDistribution: Record<string, number> = {};
  let fallbacks = 0;
  let deep = 0;
  const latencies = tasks.map((t) => t.latencyMs).sort((a, b) => a - b);
  const costs = tasks.map((t) => t.estimatedCostUsd).filter((n): n is number => n != null);
  for (const task of tasks) {
    providerDistribution[task.provider] = (providerDistribution[task.provider] ?? 0) + 1;
    strategyDistribution[task.strategySelected] =
      (strategyDistribution[task.strategySelected] ?? 0) + 1;
    if (task.strategySelected === "deep") deep += 1;
    if (/fallback/i.test(task.routingReason)) fallbacks += 1;
  }
  return {
    materialQuality: total > 0 ? (pass / total) * 100 : null,
    criticalSafety: total > 0 ? ((total - critical) / total) * 100 : null,
    pass,
    fail,
    critical,
    total,
    providerDistribution,
    strategyDistribution,
    fallbackRate: total > 0 ? fallbacks / total : 0,
    deepEscalationRate: total > 0 ? deep / total : 0,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    costKnown: costs.length > 0,
    costPerTask: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
    criticalTaskIds: tasks.filter((t) => t.verdict === "critical").map((t) => t.taskId),
    tasks,
  };
}

export async function runAutoBenchmark(params: {
  registry: ModelRegistryEntry[];
  available: DirectProviderId[];
  envProvider: string;
}): Promise<AutoBenchmarkResult> {
  const router = new NyayaRouter({
    providers: providersFromEnv(params.available),
    registry: params.registry,
    envProvider: params.envProvider,
    env: { ...process.env, AI_PROVIDER: params.envProvider },
    timeoutMs: 60_000,
  });
  const tasks: AutoTaskResult[] = [];
  for (const testCase of GRADED_CASES) {
    const row = await gradeRoutedAsk({ router, testCase, strategy: "auto" });
    tasks.push(row);
    process.stdout.write(
      `auto ${row.taskId} strategy=${row.strategySelected} risk=${row.riskLevel} provider=${row.provider} verdict=${row.verdict}\n`,
    );
  }
  return summarizeTasks(tasks);
}

export const SAFETY_FLOOR_IDS = [
  "golden-indemnity-missing-amendment",
  "golden-named-exhibit-missing",
  "golden-empty-retrieval",
  "golden-invoice-silence-not-proof",
  "golden-false-rent-amount",
  "golden-false-premise-future-effective",
  "golden-email-vs-signed-amendment",
  "golden-future-effective-current-term",
] as const;

export async function runSafetyFloorBenchmark(params: {
  registry: ModelRegistryEntry[];
  available: DirectProviderId[];
  envProvider: string;
}): Promise<AutoBenchmarkResult> {
  const router = new NyayaRouter({
    providers: providersFromEnv(params.available),
    registry: params.registry,
    envProvider: params.envProvider,
    env: { ...process.env, AI_PROVIDER: params.envProvider },
    timeoutMs: 60_000,
  });
  const tasks: AutoTaskResult[] = [];
  for (const testCase of GRADED_CASES.filter((row) =>
    (SAFETY_FLOOR_IDS as readonly string[]).includes(row.id),
  )) {
    const row = await gradeRoutedAsk({ router, testCase, strategy: "auto" });
    tasks.push(row);
    process.stdout.write(
      `safety ${row.taskId} strategy=${row.strategySelected} risk=${row.riskLevel} verdict=${row.verdict}\n`,
    );
  }
  return summarizeTasks(tasks);
}

async function gradeRoutedContradiction(params: {
  router: NyayaRouter;
  testCase: (typeof CONTRADICTION_CASES)[number];
}): Promise<AutoTaskResult> {
  const prompts = contradictionCaseToPrompt(params.testCase);
  const started = Date.now();
  try {
    const result = await params.router.generate({
      messages: [
        { role: "system", content: prompts.systemPrompt },
        { role: "user", content: prompts.userPrompt },
      ],
      temperature: LIVE_EVAL_TEMPERATURE,
      schemaName: "contradiction_analysis",
      routing: { strategy: "auto" },
    });
    const audit = params.router.lastAudits.at(-1);
    const parsed = parseJsonObject(result.text);
    let verdict: AutoTaskResult["verdict"] = "error";
    if (parsed.ok) {
      const grade = gradeContradictionCase(params.testCase, parsed.value);
      if (grade.flags.falseConfidence || grade.flags.fabricatedCites > 0) verdict = "critical";
      else if (grade.passed) verdict = "pass";
      else verdict = "fail";
    } else {
      verdict = "fail";
    }
    const cost =
      result.estimatedCost && result.estimatedCost.known ? result.estimatedCost.amountUsd : null;
    return {
      taskId: params.testCase.id,
      subsystem: "contradiction",
      provider: result.provider,
      model: result.model,
      strategyRequested: "auto",
      strategySelected: audit?.strategySelected ?? "unknown",
      riskLevel: audit?.riskLevel ?? "unknown",
      routingReason: audit?.routingReason ?? "",
      verdict,
      latencyMs: result.latencyMs ?? Date.now() - started,
      estimatedCostUsd: cost,
    };
  } catch (error) {
    return {
      taskId: params.testCase.id,
      subsystem: "contradiction",
      provider: "none",
      model: "none",
      strategyRequested: "auto",
      strategySelected: "error",
      riskLevel: "unknown",
      routingReason: error instanceof Error ? error.message.slice(0, 160) : "error",
      verdict: "error",
      latencyMs: Date.now() - started,
      estimatedCostUsd: null,
    };
  }
}

export type MixedAutoResult = AutoBenchmarkResult & {
  perSubsystem: Record<
    string,
    { total: number; pass: number; fail: number; critical: number; quality: number | null }
  >;
};

function perSubsystem(tasks: AutoTaskResult[]): MixedAutoResult["perSubsystem"] {
  const out: MixedAutoResult["perSubsystem"] = {};
  for (const task of tasks) {
    const bucket = out[task.subsystem] ?? { total: 0, pass: 0, fail: 0, critical: 0, quality: null };
    bucket.total += 1;
    if (task.verdict === "pass") bucket.pass += 1;
    else if (task.verdict === "critical") bucket.critical += 1;
    else bucket.fail += 1;
    out[task.subsystem] = bucket;
  }
  for (const bucket of Object.values(out)) {
    bucket.quality = bucket.total > 0 ? (bucket.pass / bucket.total) * 100 : null;
  }
  return out;
}

export async function runMixedAutoBenchmark(params: {
  registry: ModelRegistryEntry[];
  available: DirectProviderId[];
  envProvider: string;
  includeAsk?: boolean;
}): Promise<MixedAutoResult> {
  const router = new NyayaRouter({
    providers: providersFromEnv(params.available),
    registry: params.registry,
    envProvider: params.envProvider,
    env: { ...process.env, AI_PROVIDER: params.envProvider },
    timeoutMs: 60_000,
  });
  const tasks: AutoTaskResult[] = [];
  if (params.includeAsk !== false) {
    for (const testCase of GRADED_CASES) {
      const row = await gradeRoutedAsk({ router, testCase, strategy: "auto" });
      tasks.push(row);
      process.stdout.write(
        `mixed ${row.subsystem} ${row.taskId} provider=${row.provider} verdict=${row.verdict}\n`,
      );
    }
  }
  for (const testCase of CONTRADICTION_CASES.filter((row) => row.kind === "generate")) {
    const row = await gradeRoutedContradiction({ router, testCase });
    tasks.push(row);
    process.stdout.write(
      `mixed ${row.subsystem} ${row.taskId} provider=${row.provider} verdict=${row.verdict}\n`,
    );
  }
  const summary = summarizeTasks(tasks);
  return { ...summary, perSubsystem: perSubsystem(tasks) };
}

const FAST_STANDARD_CLUSTER = [
  "golden-indemnity-missing-amendment",
  "golden-named-exhibit-missing",
  "golden-empty-retrieval",
  "golden-false-rent-amount",
  "golden-invoice-silence-not-proof",
  "golden-email-vs-signed-amendment",
  "golden-future-effective-current-term",
] as const;

export async function runFastVsStandardComparison(params: {
  registry: ModelRegistryEntry[];
  available: DirectProviderId[];
  envProvider: string;
}): Promise<{
  cluster: string[];
  fast: AutoBenchmarkResult;
  standard: AutoBenchmarkResult;
}> {
  const makeRouter = () =>
    new NyayaRouter({
      providers: providersFromEnv(params.available),
      registry: params.registry,
      envProvider: params.envProvider,
      env: { ...process.env, AI_PROVIDER: params.envProvider },
      timeoutMs: 60_000,
    });
  const cases = GRADED_CASES.filter((c) =>
    (FAST_STANDARD_CLUSTER as readonly string[]).includes(c.id),
  );
  const fastTasks: AutoTaskResult[] = [];
  const standardTasks: AutoTaskResult[] = [];
  const fastRouter = makeRouter();
  const standardRouter = makeRouter();
  for (const testCase of cases) {
    fastTasks.push(await gradeRoutedAsk({ router: fastRouter, testCase, strategy: "fast" }));
    standardTasks.push(
      await gradeRoutedAsk({ router: standardRouter, testCase, strategy: "standard" }),
    );
  }
  return {
    cluster: cases.map((c) => c.id),
    fast: summarizeTasks(fastTasks),
    standard: summarizeTasks(standardTasks),
  };
}

export const OPENAI_ASK_VARIANCE_IDS = [
  "golden-indemnity-missing-amendment",
  "golden-named-exhibit-missing",
  "golden-empty-retrieval",
  "golden-invoice-silence-not-proof",
  "golden-false-rent-amount",
  "golden-future-effective-current-term",
  "golden-email-vs-signed-amendment",
] as const;

export async function runDisagreementGate(params: {
  primary: DirectProviderId;
  verifier: DirectProviderId;
}): Promise<{
  agreed: boolean;
  unresolved: boolean;
  evidenceWinner: string;
  usedMajorityVote: false;
}> {
  const testCase = GRADED_CASES.find((c) => c.id === "golden-lease-commencement") ?? GRADED_CASES[0];
  if (!testCase) {
    return { agreed: false, unresolved: true, evidenceWinner: "unresolved", usedMajorityVote: false };
  }
  const prompts = gradedCaseToPrompt(testCase);
  const messages = [
    { role: "system" as const, content: prompts.systemPrompt },
    { role: "user" as const, content: prompts.userPrompt },
  ];
  const a = createDirectProvider({ provider: params.primary }).provider;
  const b = createDirectProvider({ provider: params.verifier }).provider;
  const [left, right] = await Promise.all([
    a.generate({ messages, temperature: LIVE_EVAL_TEMPERATURE }),
    b.generate({ messages, temperature: LIVE_EVAL_TEMPERATURE }),
  ]);
  const disagreement = analyzeDisagreement({
    primaryText: left.text,
    verifierText: right.text,
    evidenceChunkIds: testCase.retrieved.map((p) => p.chunkId),
  });
  const winner =
    disagreement.findings[0]?.evidenceWinner ?? (disagreement.agreed ? "agreed" : "unresolved");
  return {
    agreed: disagreement.agreed,
    unresolved: disagreement.unresolved,
    evidenceWinner: winner,
    usedMajorityVote: false,
  };
}

export type DeepSubsystemResult = {
  subsystem: string;
  primary: DirectProviderId;
  verifier: DirectProviderId;
  agreed: boolean;
  unresolved: boolean;
  evidenceWinner: string;
  usedMajorityVote: false;
  error?: string;
};

/** Sequential Deep pair. Never majority-votes. Ask is not included. */
export async function runDeepSubsystemPair(params: {
  subsystem: string;
  primary: DirectProviderId;
  verifier: DirectProviderId;
  evidenceChunkIds: string[];
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}): Promise<DeepSubsystemResult> {
  try {
    const a = createDirectProvider({ provider: params.primary }).provider;
    const left = await a.generate({
      messages: params.messages,
      temperature: LIVE_EVAL_TEMPERATURE,
      routing: { subsystem: params.subsystem as "compare", strategy: "standard" },
    });
    const b = createDirectProvider({ provider: params.verifier }).provider;
    const right = await b.generate({
      messages: params.messages,
      temperature: LIVE_EVAL_TEMPERATURE,
      routing: { subsystem: params.subsystem as "compare", strategy: "standard" },
    });
    const disagreement = analyzeDisagreement({
      primaryText: left.text,
      verifierText: right.text,
      evidenceChunkIds: params.evidenceChunkIds,
    });
    return {
      subsystem: params.subsystem,
      primary: params.primary,
      verifier: params.verifier,
      agreed: disagreement.agreed,
      unresolved: disagreement.unresolved,
      evidenceWinner:
        disagreement.findings[0]?.evidenceWinner ?? (disagreement.agreed ? "agreed" : "unresolved"),
      usedMajorityVote: false,
    };
  } catch (error) {
    return {
      subsystem: params.subsystem,
      primary: params.primary,
      verifier: params.verifier,
      agreed: false,
      unresolved: true,
      evidenceWinner: "unresolved",
      usedMajorityVote: false,
      error: error instanceof Error ? error.message.slice(0, 160) : "error",
    };
  }
}
