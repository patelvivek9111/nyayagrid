import { fold } from "./normalize";
import type { BenchExpectation } from "./types";
import type {
  CanonicalContradictionFinding,
  ContradictionSemanticClass,
} from "./structured-schemas";

/**
 * Production `findingType` is structural (cross-document → "contradiction",
 * same-document → "tension"). Benchmark semantic classes are legal/evidentiary.
 * This layer maps between them without requiring production to rename fields.
 */
export function expectedSemanticClass(expectation: BenchExpectation): ContradictionSemanticClass {
  const type = expectation.expectationType;
  if (type === "possible_contradiction") return "tension";
  if (type === "not_contradiction") return "compatible";
  if (type === "must_abstain") return "insufficient";

  const blob = fold(
    `${Array.isArray(expectation.canonical) ? expectation.canonical.join(" ") : expectation.canonical} ${expectation.notes}`,
  );
  if (/\bno contradiction\b|\bcompatible\b|\bconsistent\b/.test(blob) && !/\binconsistent\b/.test(blob)) {
    return "compatible";
  }
  if (/\btension\b|\bevidentiary\b/.test(blob)) return "tension";
  if (/\bcontradict/.test(blob)) return "contradiction";
  return "insufficient";
}

export function isBadgeVersusTestimonyPair(text: string): boolean {
  const folded = fold(text);
  const testimony =
    /\bnever entered\b|\bdid not enter\b|\btestimony\b|\bdeposition\b|\bi never\b/.test(folded);
  const badge =
    /\baccess granted\b|\bbadge\b|\baccess log\b|\bbadge activity\b|\bassigned badge\b/.test(folded);
  return testimony && badge;
}

export function isImpreciseDateVersusExactPair(text: string): boolean {
  const folded = fold(text);
  const imprecise =
    /\bnear the middle\b|\bmiddle of\b|\bmid-?\s*(november|december|january|february|march|april|may|june|july|august|september|october)\b|\baround\b|\bapproximately\b|\bon or about\b/.test(
      folded,
    );
  const exact = /\b20\d{2}-\d{2}-\d{2}\b|\bnovember\s+\d{1,2},?\s+20\d{2}\b/.test(folded);
  return imprecise && exact;
}

export function assertsMutualImpossibility(text: string): boolean {
  const folded = fold(text);
  return (
    /\bcannot both be true\b/.test(folded) ||
    /\bimpossible for both\b/.test(folded) ||
    /\bmutually exclusive\b/.test(folded) ||
    /\blogical contradiction\b/.test(folded) ||
    /\bcannot coexist\b/.test(folded)
  );
}

export function infersPhysicalActorFromSystemActivity(text: string): boolean {
  const folded = fold(text);
  const limitation =
    /\bdoes not (independently |conclusively )?prove who\b/.test(folded) ||
    /\bdoes not prove .{0,80}(entered|entry|who carried)\b/.test(folded) ||
    /\bbadge activity.{0,80}not\b/.test(folded) ||
    /\blog (alone )?does not\b/.test(folded) ||
    /\bnot independently prove\b/.test(folded);
  if (limitation) return false;
  const system =
    /\baccess granted\b|\bbadge (access|log|activity)\b|\bassigned badge\b|\baccess log\b/.test(
      folded,
    );
  const personAct =
    /\bphysically entered\b/.test(folded) ||
    /\bpersonally entered\b/.test(folded) ||
    /\baccessed the (records )?room\b/.test(folded) ||
    /\bthe witness entered\b/.test(folded) ||
    /\bproves .{0,60}entered\b/.test(folded) ||
    /\bconclusively (shows|proves|establishes) .{0,80}enter/.test(folded) ||
    /\btherefore .{0,40}entered\b/.test(folded);
  return system && personAct;
}

function findingAssertedClaim(finding: CanonicalContradictionFinding): string {
  return [finding.title, finding.explanation ?? ""].join("\n");
}

function findingPrimaryText(finding: CanonicalContradictionFinding): string {
  return [finding.title, finding.explanation ?? "", finding.statementA, finding.statementB].join(
    "\n",
  );
}

/**
 * Map a persisted production finding onto a benchmark semantic class.
 * Production labels are preserved on `productionFindingType`.
 */
export function mapFindingToSemanticClass(
  finding: CanonicalContradictionFinding,
): ContradictionSemanticClass {
  const claim = findingAssertedClaim(finding);
  const primary = findingPrimaryText(finding);
  if (isImpreciseDateVersusExactPair(claim) || isImpreciseDateVersusExactPair(primary)) {
    return "compatible";
  }
  if (isBadgeVersusTestimonyPair(claim)) return "tension";
  if (assertsMutualImpossibility(primary) && !isBadgeVersusTestimonyPair(claim)) {
    return "contradiction";
  }
  const production = fold(finding.productionFindingType);
  if (production === "tension") return "tension";
  if (production === "contradiction") return "contradiction";
  if (!finding.sourceA.length || !finding.sourceB.length) return "insufficient";
  return "contradiction";
}
