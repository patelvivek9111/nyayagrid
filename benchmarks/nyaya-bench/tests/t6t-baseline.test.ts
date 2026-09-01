import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listUsStates } from "@nyayagrid/jurisdiction";
import { EXPECTED_HOME_CIRCUIT } from "../datasets/t6t/hidden_ground_truth/expected-circuits";
import { shouldPreserveHistoricalC1 } from "../runner/c1-freeze";

const baselines = join(import.meta.dirname, "..", "baselines");

describe("Phase 6T baseline artifacts", () => {
  const inventory = JSON.parse(
    readFileSync(join(baselines, "BASELINE_6T_CORPUS_INVENTORY.json"), "utf8"),
  );
  const c1 = JSON.parse(readFileSync(join(baselines, "BASELINE_6T_C1_50_STATE.json"), "utf8"));

  it("writes corpus inventory and C1 baseline files", () => {
    expect(existsSync(join(baselines, "BASELINE_6T_CORPUS_INVENTORY.json"))).toBe(true);
    expect(existsSync(join(baselines, "BASELINE_6T_C1_50_STATE.json"))).toBe(true);
    expect(existsSync(join(baselines, "BASELINE_6T_C1_50_STATE.md"))).toBe(true);
    expect(existsSync(join(baselines, "PHASE_6T_50_STATE_JURISDICTION_CERTIFICATION.md"))).toBe(true);
  });

  it("evaluates all 50 states plus DC with zero critical routing failures", () => {
    const codes = listUsStates().map((row) => row.code);
    expect(codes).toHaveLength(51);
    expect(c1.scorecards).toHaveLength(51);
    expect(c1.totals.critical).toBe(0);
    expect(c1.totals.fail).toBe(0);
    expect(c1.totals.wrongStateControlling).toBe(0);
    expect(c1.totals.wrongCircuitControlling).toBe(0);
  });

  it("preserves historical C1 as the empty-corpus architecture snapshot", () => {
    expect(inventory.statesWithAuthorities ?? inventory.states).toBeDefined();
    expect(c1.id).toBe("BASELINE_6T_C1_50_STATE");
    expect(c1.corpus.totalAuthorities).toBe(7);
    expect(c1.corpus.statesWithMappedAuthorities).toBe(0);
    expect(c1.nationwideClaim).toBe("NO");
    expect(c1.betaEligibility.eligible).toEqual([]);
    expect(c1.betaEligibility.notYetValidated.length).toBe(51);
  });

  it("isolates live real-primary coverage from synthetic fixtures in inventory", () => {
    expect(inventory.realPrimaryAuthorities).toBe(30);
    expect(inventory.syntheticAuthorities).toBe(7);
    expect(inventory.sourceProviders["us-primary-corpus"]).toBe(30);
    expect(inventory.realStatuteCount).toBe(20);
    expect(inventory.realCaseCount).toBe(10);
    expect(inventory.statesWithRealAuthorities).toBe(10);
    expect(c1.corpus.statesWithMappedAuthorities).toBe(0);
  });

  it("hidden GT covers every state home circuit", () => {
    for (const code of listUsStates().map((row) => row.code)) {
      expect(EXPECTED_HOME_CIRCUIT[code]).toBeTruthy();
    }
  });

  it("marks practice areas unvalidated per state when corpus is empty", () => {
    for (const row of c1.scorecards) {
      expect(row.coverage.Contract).toBe("unvalidated");
      expect(row.coverage.Employment).toBe("unvalidated");
      expect(row.coverage.Civil).toBe("unvalidated");
      expect(row.coverage.Criminal).toBe("unvalidated");
    }
  });

  it("freezes historical C1 unless T6T_OVERWRITE_C1=1", () => {
    expect(shouldPreserveHistoricalC1({})).toBe(true);
    expect(shouldPreserveHistoricalC1({ T6T_OVERWRITE_C1: "1" })).toBe(false);
  });
});
