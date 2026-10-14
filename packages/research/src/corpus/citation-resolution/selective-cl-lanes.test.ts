import { describe, expect, it } from "vitest";
import {
  evaluateLaneEconomics,
  mayQueryCollisionTarget,
  rankLaneTargets,
  scoreLaneTarget,
} from "./selective-cl-lanes.js";

describe("selective-cl-lanes", () => {
  it("ranks by edges then citing breadth", () => {
    const a = { targetKey: "a", score: scoreLaneTarget({ edgeCount: 10, uniqueCitingCases: 2, hasCleanVrp: true, priorDefinitiveNotFound: false, isHopelessCollisionWithoutDiscriminator: false, providerSuitableShape: true }) };
    const b = { targetKey: "b", score: scoreLaneTarget({ edgeCount: 3, uniqueCitingCases: 3, hasCleanVrp: true, priorDefinitiveNotFound: false, isHopelessCollisionWithoutDiscriminator: false, providerSuitableShape: true }) };
    expect(rankLaneTargets([b, a])[0]?.targetKey).toBe("a");
  });

  it("suppresses collision queries without discriminator", () => {
    expect(mayQueryCollisionTarget(null)).toBe(false);
    expect(mayQueryCollisionTarget({})).toBe(false);
  });

  it("allows collision queries with discriminator", () => {
    expect(mayQueryCollisionTarget({ caseName: "Riley v. California" })).toBe(true);
    expect(mayQueryCollisionTarget({ parallelCitation: "134 S. Ct. 2473" })).toBe(true);
  });

  it("marks strong / weak lane economics", () => {
    expect(evaluateLaneEconomics({ requests: 20, highTargets: 12, ambiguous: 2, notFound: 6, edgesResolved: 40 }).decision).toBe("STRONG");
    expect(evaluateLaneEconomics({ requests: 20, highTargets: 2, ambiguous: 5, notFound: 13, edgesResolved: 4 }).decision).toBe("WEAK");
    expect(evaluateLaneEconomics({ requests: 20, highTargets: 6, ambiguous: 4, notFound: 10, edgesResolved: 22 }).decision).toBe("MARGINAL");
  });

  it("deprioritizes prior not-found and hopeless collisions", () => {
    const bad = scoreLaneTarget({
      edgeCount: 100,
      hasCleanVrp: true,
      priorDefinitiveNotFound: true,
      isHopelessCollisionWithoutDiscriminator: false,
      providerSuitableShape: true,
    });
    expect(bad).toBeLessThan(0);
  });
});
