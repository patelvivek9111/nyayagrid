import type { RouterSubsystem } from "@nyayagrid/ai";

export function featureFromRouterSubsystem(subsystem: RouterSubsystem | string): string {
  switch (subsystem) {
    case "ask":
      return "nyaya.ask";
    case "research":
      return "research.query";
    case "draft":
      return "draft.generate";
    case "compare":
      return "analysis.compare";
    case "contract":
    case "deposition":
    case "contradiction":
    case "evidence":
      return "extraction.analysis";
    case "timeline":
      return "document.processing";
    default:
      return `other.${subsystem}`;
  }
}
