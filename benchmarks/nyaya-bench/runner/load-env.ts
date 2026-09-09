import { resolve } from "node:path";
import { loadCanonicalLocalEnv } from "@nyayagrid/ai";
import { BENCH_ROOT } from "./paths";

/** Load the canonical local secret files without overriding process env. */
export function loadBenchEnv(): void {
  loadCanonicalLocalEnv({ repoRoot: resolve(BENCH_ROOT, "../..") });
}
