import { describe, expect, it } from "vitest";
import {
  LEGAL_CORPUS_TABLES,
  buildLocalIsolationPrivilegeSql,
  evaluateProductCorpusIsolation,
} from "./product-corpus-isolation";

describe("WP-05 product/corpus isolation", () => {
  it("blocks when product and corpus share host/db", () => {
    const r = evaluateProductCorpusIsolation({
      APP_ENV: "staging",
      DATABASE_URL: "postgresql://u:p@ep-shared.neon.tech/neondb",
      CORPUS_DATABASE_URL: "postgresql://u:p@ep-shared.neon.tech/neondb",
    });
    expect(r.ok).toBe(false);
    expect(r.sharedPhysicalDatabase).toBe(true);
    expect(r.findings.some((f) => f.code === "PRODUCT_CORPUS_SAME_PHYSICAL_DATABASE")).toBe(true);
  });

  it("passes when physically separate", () => {
    const r = evaluateProductCorpusIsolation({
      APP_ENV: "staging",
      DATABASE_URL: "postgresql://u:p@ep-product.neon.tech/neondb",
      CORPUS_DATABASE_URL: "postgresql://u:p@ep-corpus.neon.tech/corpus",
    });
    expect(r.ok).toBe(true);
    expect(r.sharedPhysicalDatabase).toBe(false);
  });

  it("treats undeclared corpus URL in staging as shared-risk blocker", () => {
    const r = evaluateProductCorpusIsolation({
      APP_ENV: "staging",
      DATABASE_URL: "postgresql://u:p@ep-jolly-brook.neon.tech/neondb",
    });
    expect(r.sharedPhysicalDatabase).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.code === "CORPUS_DATABASE_URL_UNDECLARED")).toBe(true);
  });

  it("builds privilege SQL covering all corpus tables", () => {
    const sql = buildLocalIsolationPrivilegeSql({
      productRole: "nyaya_product",
      corpusRole: "nyaya_corpus",
      researchRole: "nyaya_research_ro",
    });
    for (const t of LEGAL_CORPUS_TABLES) {
      expect(sql).toContain(`"${t}"`);
    }
    expect(sql).toMatch(/REVOKE ALL ON TABLE.*"legal_authorities"/s);
  });
});
