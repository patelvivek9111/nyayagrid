/**
 * Small live Auto stress. Synthetic/non-confidential only. Does not print secrets.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAIProviderFromEnv,
  loadCanonicalLocalEnv,
  NyayaRouter,
  ROUTER_UNAVAILABLE_USER_MESSAGE,
} from "@nyayagrid/ai";

const here = dirname(fileURLToPath(import.meta.url));
loadCanonicalLocalEnv({ repoRoot: join(here, "../../../..") });
if (
  (!process.env.AI_PROVIDER || process.env.AI_PROVIDER === "mock") &&
  (process.env.OPENAI_API_KEY?.trim() || process.env.XAI_API_KEY?.trim())
) {
  process.env.AI_PROVIDER = "openai";
}

const TASKS: Array<{
  id: string;
  subsystem:
    | "ask"
    | "contract"
    | "evidence"
    | "compare"
    | "timeline"
    | "graph"
    | "memory";
  schemaName: string;
  question: string;
}> = [
  { id: "L01", subsystem: "ask", schemaName: "matter_summary", question: "What is the tenant's name?" },
  { id: "L02", subsystem: "ask", schemaName: "matter_summary", question: "What is the landlord's name?" },
  { id: "L03", subsystem: "contract", schemaName: "contract_analysis", question: "Summarize the named parties in one sentence." },
  { id: "L04", subsystem: "evidence", schemaName: "evidence_assessment", question: "Does the source name a tenant?" },
  { id: "L05", subsystem: "compare", schemaName: "document_comparison_summary", question: "What party names appear?" },
  { id: "L06", subsystem: "timeline", schemaName: "matter_intelligence_extraction", question: "Extract any dates mentioned." },
  { id: "L07", subsystem: "graph", schemaName: "graph_relationship_extraction", question: "Who is related to the lease?" },
  { id: "L08", subsystem: "memory", schemaName: "matter_memory_proposal", question: "Propose one memory fact about the tenant." },
  { id: "L09", subsystem: "ask", schemaName: "matter_summary", question: "Is a notice period stated?" },
  { id: "L10", subsystem: "contract", schemaName: "contract_analysis", question: "Is rent mentioned?" },
  { id: "L11", subsystem: "evidence", schemaName: "evidence_assessment", question: "What document type is this source?" },
  { id: "L12", subsystem: "ask", schemaName: "matter_summary", question: "Who are the parties?" },
];

function hasLiveKeys(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
}

const outPath = join(here, "live-synthetic.json");

if (!hasLiveKeys()) {
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        gateId: "nyaya-router-adversarial-v1",
        skipped: true,
        reason: "No live provider keys in process env; deterministic matrix still stands.",
      },
      null,
      2,
    ),
  );
  process.stdout.write("live-synthetic SKIPPED (no keys)\n");
  process.exit(0);
}

const provider = createAIProviderFromEnv();
if (!(provider instanceof NyayaRouter)) {
  throw new Error("expected NyayaRouter for live synthetic Auto");
}
const router = provider;
const sources =
  "- chunkId=c1 | documentId=d1 | documentVersionId=v1 | quote=|Tenant is Acme LLC. Landlord is Beta Inc. The lease is dated January 1, 2024.|\n- chunkId=c2 | documentId=d1 | documentVersionId=v1 | quote=|Monthly rent is 4000. Notice is 30 days.|";

const latencies: number[] = [];
const rows: Array<Record<string, unknown>> = [];
let pass = 0;
let fail = 0;
let critical = 0;

for (const task of TASKS) {
  const started = Date.now();
  try {
    const result = await router.generate({
      messages: [
        { role: "system", content: "You are Nyaya. Return compact JSON. Never invent citations or secrets." },
        { role: "user", content: `Question: ${task.question}\nSources:\n${sources}` },
      ],
      schemaName: task.schemaName,
      routing: {
        subsystem: task.subsystem,
        strategy: "auto",
        organizationId: "org_synth_adv_v1",
        matterId: "matter_synth_adv_v1",
      },
      temperature: 0,
    });
    const latencyMs = Date.now() - started;
    latencies.push(latencyMs);
    const audit = router.lastAudits.at(-1);
    const text = result.text ?? "";
    const leaked =
      /sk-[a-zA-Z0-9]{10,}/.test(text) ||
      /OPENAI_API_KEY|XAI_API_KEY|ANTHROPIC_API_KEY/.test(text);
    if (leaked) critical += 1;
    else pass += 1;
    rows.push({
      id: task.id,
      subsystem: task.subsystem,
      provider: result.provider,
      model: result.model,
      strategy: audit?.strategySelected,
      fallbacks: audit?.fallbacks?.length ?? 0,
      latencyMs,
      leaked,
      userMessageSafe: true,
    });
    process.stdout.write(
      `${task.id} ${task.subsystem} provider=${result.provider} strategy=${audit?.strategySelected} ${latencyMs}ms\n`,
    );
  } catch (error) {
    const latencyMs = Date.now() - started;
    latencies.push(latencyMs);
    const message = error instanceof Error ? error.message : "error";
    const safe = message === ROUTER_UNAVAILABLE_USER_MESSAGE;
    fail += 1;
    rows.push({
      id: task.id,
      subsystem: task.subsystem,
      error: safe ? "ROUTER_UNAVAILABLE" : "ERROR",
      latencyMs,
    });
    process.stdout.write(`${task.id} ${task.subsystem} FAIL ${latencyMs}ms\n`);
  }
}

latencies.sort((a, b) => a - b);
const p50 = latencies[Math.floor((latencies.length - 1) * 0.5)] ?? 0;
const p95 = latencies[Math.floor((latencies.length - 1) * 0.95)] ?? 0;

writeFileSync(
  outPath,
  JSON.stringify(
    {
      gateId: "nyaya-router-adversarial-v1",
      skipped: false,
      total: TASKS.length,
      pass,
      fail,
      critical,
      p50,
      p95,
      featureAgents: process.env.FEATURE_AGENTS ?? "OFF",
      rows,
    },
    null,
    2,
  ),
);
process.stdout.write(`live-synthetic pass=${pass} fail=${fail} critical=${critical} p50=${p50} p95=${p95}\n`);
if (critical > 0) process.exitCode = 1;
