import { describe, expect, it } from "vitest";
import {
  FEATURE_NEON_CORPUS_RESEARCH_ENV,
  CORPUS_DATABASE_ENV,
  inspectCorpusConnection,
  isNeonCorpusResearchEnabled,
  redactCorpusUrl,
} from "./corpus-db";

describe("corpus-db config", () => {
  it("keeps Neon corpus research off by default", () => {
    expect(isNeonCorpusResearchEnabled({})).toBe(false);
    expect(isNeonCorpusResearchEnabled({ [FEATURE_NEON_CORPUS_RESEARCH_ENV]: "0" })).toBe(false);
  });

  it("inspects CORPUS_FLAG_DISABLED when flag off", () => {
    const status = inspectCorpusConnection({});
    expect(status.ok).toBe(false);
    if (!status.ok) expect(status.code).toBe("CORPUS_FLAG_DISABLED");
  });

  it("requires CORPUS_DATABASE_URL when flag on", () => {
    const status = inspectCorpusConnection({
      [FEATURE_NEON_CORPUS_RESEARCH_ENV]: "1",
    });
    expect(status.ok).toBe(false);
    if (!status.ok) {
      expect(status.code).toBe("RESEARCH_CORPUS_UNAVAILABLE");
      expect(status.reason).toContain(CORPUS_DATABASE_ENV);
    }
  });

  it("redacts host/database without credentials", () => {
    const redacted = redactCorpusUrl(
      "postgresql://user:supersecret@ep-example.us-east-1.aws.neon.tech/neondb?sslmode=require",
    );
    expect(redacted.host).toBe("ep-example.us-east-1.aws.neon.tech");
    expect(redacted.database).toBe("neondb");
    expect(JSON.stringify(redacted)).not.toContain("supersecret");
    expect(JSON.stringify(redacted)).not.toContain("user");
  });

  it("reports ok when flag and corpus URL present", () => {
    const status = inspectCorpusConnection({
      [FEATURE_NEON_CORPUS_RESEARCH_ENV]: "1",
      [CORPUS_DATABASE_ENV]: "postgresql://ro:x@ep-jolly.neon.tech/neondb",
    });
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.redactedHost).toContain("neon.tech");
      expect(status.redactedDatabase).toBe("neondb");
    }
  });
});
