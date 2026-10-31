import { describe, expect, it } from "vitest";
import {
  recordModelPin,
  assertNoSilentSubstitution,
  GPT_61_SOL_LIVE_VERIFIED,
} from "../src/prosecution-external/model-pin.js";

describe("prosecution external model pin contract", () => {
  it("does not treat gpt-6.1-sol as live verified", () => {
    expect(GPT_61_SOL_LIVE_VERIFIED).toBe(false);
  });

  it("records MODEL_PIN_UNAVAILABLE when nothing served", () => {
    const pin = recordModelPin({
      logicalModel: "gpt-6.1-sol",
      requestedApiModel: "gpt-6.1-sol",
      servedModel: null,
    });
    expect(pin.pinStatus).toBe("MODEL_PIN_UNAVAILABLE");
  });

  it("forbids silent substitution scoring", () => {
    const pin = recordModelPin({
      logicalModel: "gpt-6.1-sol",
      requestedApiModel: "gpt-6.1-sol",
      servedModel: "gpt-4o-mini",
    });
    expect(pin.pinStatus).toBe("SUBSTITUTED_FORBIDDEN");
    expect(pin.adapterSubstitution).toBe(true);
    expect(() => assertNoSilentSubstitution(pin)).toThrow(/MODEL_PIN/);
  });

  it("accepts matching served pin", () => {
    const pin = recordModelPin({
      logicalModel: "claude-opus-5-5",
      requestedApiModel: "claude-opus-5-5",
      servedModel: "claude-opus-5-5",
    });
    expect(pin.pinStatus).toBe("PINNED");
    expect(() => assertNoSilentSubstitution(pin)).not.toThrow();
  });
});
