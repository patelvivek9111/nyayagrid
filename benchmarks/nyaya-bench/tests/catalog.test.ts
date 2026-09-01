import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadCatalog,
  loadMemoryCatalog,
  loadAnalysisCatalog,
  loadDepositionCatalog,
  loadContractCatalog,
  loadEvidenceCatalog,
  loadDraftCatalog,
  loadGraphCatalog,
  loadResearchCatalog,
  loadAgentsCatalog,
  loadFullSystemCatalog,
} from "../runner/catalog";

const catalogSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../runner/catalog.ts"),
  "utf8",
);

describe("nyaya-bench catalog", () => {
  it("loads V1 prompts without opening hidden_ground_truth", () => {
    expect(catalogSource).not.toMatch(/loadGroundTruth/);
    const catalog = loadCatalog("v1");
    expect(catalog).toHaveLength(10);
    expect(catalog.reduce((sum, scenario) => sum + scenario.tasks.length, 0)).toBe(100);
    expect(catalog.reduce((sum, scenario) => sum + scenario.documents.length, 0)).toBe(50);
    expect(catalog[0]?.documents.every((doc) => doc.absolutePath.includes("documents"))).toBe(true);
  });

  it("loads V2 prompts without opening hidden_ground_truth", () => {
    const catalog = loadCatalog("v2");
    expect(catalog).toHaveLength(16);
    expect(catalog.reduce((sum, scenario) => sum + scenario.tasks.length, 0)).toBe(400);
    expect(catalog.reduce((sum, scenario) => sum + scenario.documents.length, 0)).toBe(128);
  });

  it("loads the Memory overlay without opening hidden_ground_truth", () => {
    const catalog = loadMemoryCatalog("v2");
    expect(catalog.map((row) => row.scenarioId).sort()).toEqual(["SYNTH-V2-001", "SYNTH-V2-006"]);
    expect(catalog.reduce((sum, scenario) => sum + scenario.tasks.length, 0)).toBe(16);
    expect(
      catalog.every((scenario) => scenario.tasks.every((task) => task.category === "memory")),
    ).toBe(true);
    expect(catalog[0]?.documents.every((doc) => doc.absolutePath.includes("documents"))).toBe(true);
  });

  it("loads the Analysis overlay without opening hidden_ground_truth", () => {
    const catalog = loadAnalysisCatalog("v2");
    expect(catalog.map((row) => row.scenarioId).sort()).toEqual(["SYNTH-V2-001", "SYNTH-V2-006"]);
    expect(catalog.reduce((sum, scenario) => sum + scenario.tasks.length, 0)).toBe(14);
    expect(
      catalog.every((scenario) => scenario.tasks.every((task) => task.category === "analysis")),
    ).toBe(true);
    expect(catalog[0]?.documents.every((doc) => doc.absolutePath.includes("documents"))).toBe(true);
  });

  it("loads the Deposition overlay without opening hidden_ground_truth", () => {
    const catalog = loadDepositionCatalog("v2");
    expect(catalog.map((row) => row.scenarioId)).toEqual(["SYNTH-V2-006"]);
    expect(catalog.reduce((sum, scenario) => sum + scenario.tasks.length, 0)).toBe(16);
    expect(
      catalog.every((scenario) => scenario.tasks.every((task) => task.category === "deposition")),
    ).toBe(true);
    expect(catalog[0]?.documents.every((doc) => doc.absolutePath.includes("documents"))).toBe(true);
  });

  it("loads the Contract overlay without opening hidden_ground_truth", () => {
    const catalog = loadContractCatalog("v2");
    expect(catalog.map((row) => row.scenarioId)).toEqual(["SYNTH-V2-001"]);
    expect(catalog.reduce((sum, scenario) => sum + scenario.tasks.length, 0)).toBe(18);
    expect(
      catalog.every((scenario) => scenario.tasks.every((task) => task.category === "contract")),
    ).toBe(true);
    expect(catalog[0]?.documents.every((doc) => doc.absolutePath.includes("documents"))).toBe(true);
  });

  it("loads the Evidence overlay without opening hidden_ground_truth", () => {
    const catalog = loadEvidenceCatalog("v2");
    expect(catalog.map((row) => row.scenarioId).sort()).toEqual(["SYNTH-V2-001", "SYNTH-V2-006"]);
    expect(catalog.reduce((sum, scenario) => sum + scenario.tasks.length, 0)).toBe(28);
    expect(
      catalog.every((scenario) => scenario.tasks.every((task) => task.category === "evidence")),
    ).toBe(true);
  });

  it("loads the Draft overlay without opening hidden_ground_truth", () => {
    const catalog = loadDraftCatalog("v2");
    expect(catalog.map((row) => row.scenarioId).sort()).toEqual(["SYNTH-V2-001", "SYNTH-V2-006"]);
    expect(catalog.reduce((sum, scenario) => sum + scenario.tasks.length, 0)).toBe(24);
    expect(
      catalog.every((scenario) => scenario.tasks.every((task) => task.category === "draft")),
    ).toBe(true);
  });

  it("loads the Graph overlay without opening hidden_ground_truth", () => {
    const catalog = loadGraphCatalog("v2");
    expect(catalog.map((row) => row.scenarioId).sort()).toEqual(["SYNTH-V2-001", "SYNTH-V2-006"]);
    expect(catalog.reduce((sum, scenario) => scenario.tasks.length + sum, 0)).toBe(18);
    expect(
      catalog.every((scenario) => scenario.tasks.every((task) => task.category === "graph")),
    ).toBe(true);
  });

  it("loads the Research overlay without opening hidden_ground_truth", () => {
    const catalog = loadResearchCatalog("v2");
    expect(catalog.map((row) => row.scenarioId)).toEqual(["SYNTH-V2-001"]);
    expect(catalog.reduce((sum, scenario) => sum + scenario.tasks.length, 0)).toBe(18);
    expect(
      catalog.every((scenario) => scenario.tasks.every((task) => task.category === "research")),
    ).toBe(true);
  });

  it("loads the Agents overlay without opening hidden_ground_truth", () => {
    const catalog = loadAgentsCatalog("v2");
    expect(catalog.map((row) => row.scenarioId).sort()).toEqual(["SYNTH-V2-001", "SYNTH-V2-006"]);
    expect(catalog.reduce((sum, scenario) => sum + scenario.tasks.length, 0)).toBe(24);
    expect(
      catalog.every((scenario) => scenario.tasks.every((task) => task.category === "agent")),
    ).toBe(true);
  });

  it("loads the Full-system overlay without opening hidden_ground_truth", () => {
    const catalog = loadFullSystemCatalog("v2");
    expect(catalog.map((row) => row.scenarioId).sort()).toEqual(["SYNTH-FS-001", "SYNTH-FS-002"]);
    expect(catalog.reduce((sum, scenario) => sum + scenario.tasks.length, 0)).toBe(32);
    expect(
      catalog.every((scenario) => scenario.tasks.every((task) => task.category === "full_system")),
    ).toBe(true);
    expect(catalog[0]?.documents.every((doc) => doc.absolutePath.includes("documents"))).toBe(true);
  });
});
