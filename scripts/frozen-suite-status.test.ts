import { describe, expect, it } from "vitest";
import { harnessGateFailed, interpretFrozenSuiteOutput } from "./frozen-suite-status";

describe("interpretFrozenSuiteOutput", () => {
  it("fails a suite whose JSON reports criticalFails even when the process exits 0", () => {
    const gate = interpretFrozenSuiteOutput({
      timedOut: false,
      exitCode: 0,
      output: `PASS\tsome-task\tok
{
  "runDir": "C:\\\\runs\\\\x",
  "counts": {
    "pass": 13,
    "needs_work": 3,
    "fail": 2,
    "infrastructure": 0,
    "notApplicable": 0,
    "criticalFails": 2
  }
}
`,
    });
    expect(gate.processStatus).toBe("exited");
    expect(gate.suiteStatus).toBe("CRITICAL");
    expect(gate.criticalFails).toBe(2);
  });

  it("reads 6U/C2A totals.critical and criticalSafety", () => {
    const gate = interpretFrozenSuiteOutput({
      timedOut: false,
      exitCode: 0,
      output: JSON.stringify({
        totals: { tasks: 47, pass: 45, needsWork: 2, fail: 0, critical: 1 },
        criticalSafety: 97.8,
      }),
    });
    expect(gate.suiteStatus).toBe("CRITICAL");
  });

  it("treats timeout as a process failure", () => {
    const gate = interpretFrozenSuiteOutput({
      timedOut: true,
      exitCode: null,
      output: "",
    });
    expect(gate.processStatus).toBe("timeout");
    expect(gate.suiteStatus).toBe("FAIL");
  });

  it("does not treat infrastructure-only JSON as PASS even when exit code is 0", () => {
    const gate = interpretFrozenSuiteOutput({
      timedOut: false,
      exitCode: 0,
      output: JSON.stringify({
        counts: {
          pass: 0,
          needs_work: 0,
          fail: 0,
          infrastructure: 16,
          notApplicable: 0,
          criticalFails: 0,
        },
      }),
    });
    expect(gate.processStatus).toBe("exited");
    expect(gate.suiteStatus).toBe("FAIL");
    expect(gate.infrastructure).toBe(16);
    expect(gate.criticalFails).toBe(0);
    expect(harnessGateFailed(gate, true)).toBe(true);
  });

  it("does not fail the overall gate on a non-critical quality fail with zero infrastructure", () => {
    const gate = interpretFrozenSuiteOutput({
      timedOut: false,
      exitCode: 0,
      output: JSON.stringify({
        counts: {
          pass: 17,
          needs_work: 0,
          fail: 1,
          infrastructure: 0,
          criticalFails: 0,
        },
      }),
    });
    expect(gate.suiteStatus).toBe("FAIL");
    expect(harnessGateFailed(gate, true)).toBe(false);
  });
});
