import { describe, expect, it } from "vitest";
import {
  emptyMonitorState,
  evaluateProbe,
  mapReadyChecks,
  type ProbeSample,
} from "./continuous-monitor";

function sample(partial: Partial<ProbeSample> & Pick<ProbeSample, "ok">): ProbeSample {
  return {
    at: partial.at ?? new Date().toISOString(),
    httpStatus: partial.httpStatus !== undefined ? partial.httpStatus : partial.ok ? 200 : 503,
    ok: partial.ok,
    latencyMs: partial.latencyMs ?? 50,
    checks: partial.checks,
    error: partial.error,
  };
}

describe("continuous-monitor", () => {
  it("requires 2 consecutive ready failures before firing", () => {
    let state = emptyMonitorState();
    const t0 = new Date("2026-11-04T20:00:00.000Z");
    const r1 = evaluateProbe({
      state,
      sample: sample({ ok: false, at: t0.toISOString() }),
      now: t0,
    });
    expect(r1.transitions.filter((t) => t.policyId === "ready-probe-failing")).toHaveLength(0);
    state = r1.state;
    const t1 = new Date("2026-11-04T20:01:00.000Z");
    const r2 = evaluateProbe({
      state,
      sample: sample({ ok: false, at: t1.toISOString() }),
      now: t1,
    });
    const fire = r2.transitions.find(
      (t) => t.policyId === "ready-probe-failing" && t.status === "firing",
    );
    expect(fire).toBeTruthy();
  });

  it("emits resolved on recovery and suppresses duplicate firing within cooldown", () => {
    let state = emptyMonitorState();
    const t0 = new Date("2026-11-04T20:00:00.000Z");
    state = evaluateProbe({
      state,
      sample: sample({ ok: false, at: t0.toISOString() }),
      now: t0,
    }).state;
    const t1 = new Date("2026-11-04T20:01:00.000Z");
    const fired = evaluateProbe({
      state,
      sample: sample({ ok: false, at: t1.toISOString() }),
      now: t1,
    });
    state = fired.state;
    expect(fired.transitions.some((t) => t.status === "firing")).toBe(true);

    const t2 = new Date("2026-11-04T20:01:30.000Z");
    const still = evaluateProbe({
      state,
      sample: sample({ ok: false, at: t2.toISOString() }),
      now: t2,
      config: { cooldownMs: 15 * 60 * 1000 },
    });
    expect(
      still.transitions.filter(
        (t) => t.policyId === "ready-probe-failing" && t.status === "firing",
      ),
    ).toHaveLength(0);
    state = still.state;

    const t3 = new Date("2026-11-04T20:02:00.000Z");
    const recovered = evaluateProbe({
      state,
      sample: sample({ ok: true, httpStatus: 200, at: t3.toISOString() }),
      now: t3,
    });
    expect(
      recovered.transitions.some(
        (t) => t.policyId === "ready-probe-failing" && t.status === "resolved",
      ),
    ).toBe(true);
  });

  it("maps ready check strings", () => {
    const mapped = mapReadyChecks({
      ok: true,
      checks: { database: "ok", redis: "ok", clamav: "live", storage: "ok", ocr: "disabled" },
    });
    expect(mapped.database).toBe("ok");
    expect(mapped.clamav).toBe("ok");
    expect(mapped.ocr).toBe("ok");
  });

  it("fires application-unreachable when httpStatus is null", () => {
    const r = evaluateProbe({
      state: emptyMonitorState(),
      sample: sample({
        ok: false,
        httpStatus: null,
        error: "fetch failed",
        at: "2026-11-04T20:00:00.000Z",
      }),
      now: new Date("2026-11-04T20:00:00.000Z"),
    });
    expect(
      r.transitions.some((t) => t.policyId === "application-unreachable" && t.status === "firing"),
    ).toBe(true);
  });
});
