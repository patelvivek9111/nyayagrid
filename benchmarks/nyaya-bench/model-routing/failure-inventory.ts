/**
 * Machine-readable failure inventory for nyaya-four-provider-cert-v1 quality remediation.
 * Not a markdown report.
 */
export type FailureClass =
  | "FALSE_PREMISE"
  | "UNSUPPORTED_FACT"
  | "CITATION"
  | "JURISDICTION"
  | "ABSTENTION"
  | "SILENCE_AS_PROOF"
  | "TEMPORAL"
  | "MODEL_REASONING"
  | "STRUCTURED_OUTPUT"
  | "PROVIDER_INCOMPATIBLE"
  | "TRANSPORT_API_ERROR"
  | "BENCHMARK_INFRA"
  | "RETRIEVAL"
  | "OTHER";

export type FailureRow = {
  provider: string;
  model: string;
  subsystem: string;
  taskId: string;
  verdict: "FAIL" | "NEEDS_WORK" | "CRITICAL" | "INFRA";
  failureClass: FailureClass;
  expectedBehavior: string;
  observedBehavior: string;
  cluster: "ALL_PROVIDERS" | "ONE_PROVIDER" | "SHARED_SHAPE" | "INCOMPLETE";
  likelyOrigin:
    | "provider_reasoning"
    | "shared_prompt"
    | "adapter_portability"
    | "retrieval"
    | "grader"
    | "trust_boundary"
    | "benchmark_infra";
  sameTaskFailsOtherProviders: string[];
  repeatability: "unrepeated" | "stable_fail" | "stable_pass" | "unstable";
};

export const STARTING_FAILURE_INVENTORY: FailureRow[] = [
  {
    provider: "openai",
    model: "gpt-4o-mini",
    subsystem: "ask",
    taskId: "golden-indemnity-missing-amendment",
    verdict: "CRITICAL",
    failureClass: "FALSE_PREMISE",
    expectedBehavior: "insufficient + need more docs; amendment not in retrieval",
    observedBehavior: "confident answer without the amendment (falseConfidence)",
    cluster: "ONE_PROVIDER",
    likelyOrigin: "provider_reasoning",
    sameTaskFailsOtherProviders: [],
    repeatability: "unrepeated",
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    subsystem: "ask",
    taskId: "golden-email-vs-signed-amendment",
    verdict: "CRITICAL",
    failureClass: "CITATION",
    expectedBehavior: "cite signed 30-day amendment; ignore informal 60-day email",
    observedBehavior: "CRITICAL under same source-role trust layer Grok/OpenAI/Gemini pass",
    cluster: "ONE_PROVIDER",
    likelyOrigin: "provider_reasoning",
    sameTaskFailsOtherProviders: [],
    repeatability: "unrepeated",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    subsystem: "contradiction",
    taskId: "cx-sequential-amendment-not-contradiction",
    verdict: "CRITICAL",
    failureClass: "OTHER",
    expectedBehavior: "sequential amendment is not a contradiction",
    observedBehavior: "labeled contradiction",
    cluster: "ONE_PROVIDER",
    likelyOrigin: "provider_reasoning",
    sameTaskFailsOtherProviders: [],
    repeatability: "unrepeated",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    subsystem: "contradiction",
    taskId: "cx-wrong-actor-not-contradiction",
    verdict: "CRITICAL",
    failureClass: "OTHER",
    expectedBehavior: "wrong actor is not a document contradiction",
    observedBehavior: "labeled contradiction",
    cluster: "SHARED_SHAPE",
    likelyOrigin: "provider_reasoning",
    sameTaskFailsOtherProviders: ["anthropic"],
    repeatability: "unrepeated",
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    subsystem: "contradiction",
    taskId: "cx-wrong-actor-not-contradiction",
    verdict: "CRITICAL",
    failureClass: "OTHER",
    expectedBehavior: "wrong actor is not a document contradiction",
    observedBehavior: "labeled contradiction",
    cluster: "SHARED_SHAPE",
    likelyOrigin: "provider_reasoning",
    sameTaskFailsOtherProviders: ["openai"],
    repeatability: "unrepeated",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    subsystem: "research",
    taskId: "SYNTH-V2-001-R002",
    verdict: "NEEDS_WORK",
    failureClass: "RETRIEVAL",
    expectedBehavior: "rank Acme/Contoso 999 F.3d 1 over near-name 888 F.3d 9",
    observedBehavior: "near-name decoy outranked target",
    cluster: "ALL_PROVIDERS",
    likelyOrigin: "retrieval",
    sameTaskFailsOtherProviders: ["anthropic", "xai", "google"],
    repeatability: "stable_fail",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    subsystem: "research",
    taskId: "SYNTH-V2-001-R003",
    verdict: "NEEDS_WORK",
    failureClass: "RETRIEVAL",
    expectedBehavior: "synthesize SJC § 100 preliminary-injunction elements from retrieved authority",
    observedBehavior: "missed expected retrieved authority or rule content",
    cluster: "SHARED_SHAPE",
    likelyOrigin: "retrieval",
    sameTaskFailsOtherProviders: ["anthropic"],
    repeatability: "stable_fail",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    subsystem: "research",
    taskId: "SYNTH-V2-001-R004",
    verdict: "NEEDS_WORK",
    failureClass: "RETRIEVAL",
    expectedBehavior: "needles irreparable / money damages / compensable from corpus",
    observedBehavior: "missed expected retrieved authority or rule content",
    cluster: "ALL_PROVIDERS",
    likelyOrigin: "retrieval",
    sameTaskFailsOtherProviders: ["anthropic", "xai"],
    repeatability: "stable_fail",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    subsystem: "memory",
    taskId: "SYNTH-V2-001-M001",
    verdict: "NEEDS_WORK",
    failureClass: "MODEL_REASONING",
    expectedBehavior: "AI proposal includes 30-day operative notice; stays proposed/unverified",
    observedBehavior: "proposition needles missing; found 0/1",
    cluster: "ALL_PROVIDERS",
    likelyOrigin: "provider_reasoning",
    sameTaskFailsOtherProviders: ["xai"],
    repeatability: "stable_fail",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    subsystem: "memory",
    taskId: "SYNTH-V2-001-M007",
    verdict: "NEEDS_WORK",
    failureClass: "MODEL_REASONING",
    expectedBehavior: "proposal with source chunks and 30-day needle",
    observedBehavior: "proposition needles missing; found 0/1",
    cluster: "ALL_PROVIDERS",
    likelyOrigin: "provider_reasoning",
    sameTaskFailsOtherProviders: ["xai"],
    repeatability: "stable_fail",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    subsystem: "memory",
    taskId: "SYNTH-V2-001-M010",
    verdict: "NEEDS_WORK",
    failureClass: "MODEL_REASONING",
    expectedBehavior: "proposal needles present; proposed not auto-promoted",
    observedBehavior: "proposition needles missing; found 0/1",
    cluster: "ALL_PROVIDERS",
    likelyOrigin: "provider_reasoning",
    sameTaskFailsOtherProviders: ["xai"],
    repeatability: "stable_fail",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    subsystem: "deposition",
    taskId: "SYNTH-V2-001",
    verdict: "INFRA",
    failureClass: "BENCHMARK_INFRA",
    expectedBehavior: "run frozen DA1 / SYNTH-V2-006 deposition overlay",
    observedBehavior: "cert forced SYNTH-V2-001 which has zero deposition tasks",
    cluster: "ALL_PROVIDERS",
    likelyOrigin: "benchmark_infra",
    sameTaskFailsOtherProviders: ["anthropic", "xai", "google"],
    repeatability: "stable_fail",
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    subsystem: "compare",
    taskId: "SYNTH-V2-001-T007",
    verdict: "INFRA",
    failureClass: "TRANSPORT_API_ERROR",
    expectedBehavior: "accept compare summary payload",
    observedBehavior: "HTTP 400 (unclassified body in prior run)",
    cluster: "ONE_PROVIDER",
    likelyOrigin: "adapter_portability",
    sameTaskFailsOtherProviders: [],
    repeatability: "unrepeated",
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    subsystem: "timeline",
    taskId: "SYNTH-V2-001-T012",
    verdict: "INFRA",
    failureClass: "TRANSPORT_API_ERROR",
    expectedBehavior: "accept matter intelligence extraction payload",
    observedBehavior: "HTTP 400 after sanitizer; mixed with tasks that still pass",
    cluster: "ONE_PROVIDER",
    likelyOrigin: "adapter_portability",
    sameTaskFailsOtherProviders: [],
    repeatability: "unrepeated",
  },
  {
    provider: "google",
    model: "gemini-3.6-flash",
    subsystem: "ask",
    taskId: "golden-lease-commencement",
    verdict: "FAIL",
    failureClass: "MODEL_REASONING",
    expectedBehavior: "grounded commencement date from lease source",
    observedBehavior: "FAIL; 0 CRITICAL; instruction/source-selection cluster",
    cluster: "ONE_PROVIDER",
    likelyOrigin: "provider_reasoning",
    sameTaskFailsOtherProviders: [],
    repeatability: "unrepeated",
  },
];

export const GEMINI_ASK_FAIL_IDS = [
  "golden-lease-commencement",
  "golden-rent-annual",
  "golden-notice-section",
  "golden-cam-date-conflict",
  "golden-cam-date-conflict-incomplete",
  "golden-dispute-date",
  "golden-late-fee",
  "golden-qa06-graph-no-docs",
  "golden-adv-combine-indemnity-and-rent",
  "golden-adv-combine-dispute-and-late-fee",
  "golden-adv-combine-renewal-and-expiration",
  "golden-adv-near-miss-proposed-commencement",
  "golden-future-effective-current-term",
  "golden-future-effective-future-term",
  "golden-compatible-approx-exact-date",
] as const;
