import { describe, expect, it, vi } from "vitest";
import {
  ConsoleErrorReporter,
  CORRELATION_ID_HEADER,
  createLogger,
  createRequestLogger,
  validateConfig,
  withCorrelationId,
  withTimeout,
} from "./index";

describe("createLogger", () => {
  it("redacts sensitive fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const log = createLogger("test");
    log.info("hello", { apiKey: "secret-value", organizationId: "org_1" });
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).toContain("[redacted]");
    expect(line).toContain("org_1");
    expect(line).not.toContain("secret-value");
    spy.mockRestore();
  });
});

describe("withCorrelationId", () => {
  it("reuses an existing header value", () => {
    const headers = new Headers({ [CORRELATION_ID_HEADER]: "abc-123" });
    expect(withCorrelationId(headers)).toBe("abc-123");
  });

  it("generates an id when absent", () => {
    const id = withCorrelationId(new Headers());
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});

describe("createRequestLogger", () => {
  it("stamps every log line with the correlation id", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const log = createRequestLogger("test", "cid-1");
    log.info("hello");
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).toContain("cid-1");
    spy.mockRestore();
  });
});

describe("ConsoleErrorReporter", () => {
  it("logs the error message and redacts sensitive context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reporter = new ConsoleErrorReporter();
    reporter.captureException(new Error("boom"), { apiKey: "secret", userId: "user_1" });
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).toContain("boom");
    expect(line).toContain("[redacted]");
    expect(line).not.toContain("secret");
    spy.mockRestore();
  });
});

describe("validateConfig", () => {
  it("flags missing DATABASE_URL without leaking other values", () => {
    const result = validateConfig({ AI_PROVIDER: "mock" } as NodeJS.ProcessEnv);
    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => w.includes("DATABASE_URL"))).toBe(true);
  });

  it("flags AI_PROVIDER=openai without an API key", () => {
    const result = validateConfig({
      DATABASE_URL: "postgres://x",
      AI_PROVIDER: "openai",
      S3_BUCKET: "bucket",
    } as NodeJS.ProcessEnv);
    expect(result.warnings.some((w) => w.includes("OPENAI_API_KEY"))).toBe(true);
  });

  it("is ok when required variables are present", () => {
    const result = validateConfig({
      DATABASE_URL: "postgres://x",
      AI_PROVIDER: "mock",
      EMBEDDING_PROVIDER: "mock",
      S3_BUCKET: "bucket",
      AUTH_PROVIDER: "dev",
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe("withTimeout", () => {
  it("resolves when the promise finishes before the timeout", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50)).resolves.toBe("ok");
  });

  it("rejects when the promise is slower than the timeout", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 100));
    await expect(withTimeout(slow, 10, "slow-op")).rejects.toThrow(/slow-op timed out/);
  });
});
