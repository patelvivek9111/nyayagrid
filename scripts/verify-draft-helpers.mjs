import {
  applySourceLimitationGuard,
  neutralizeUnsupportedQuotes,
  validateDraftAssertions,
  withInsufficientSourceAssumption,
} from "../packages/intelligence/src/draft/helpers.ts";

const validated = validateDraftAssertions(
  [
    { text: "Grounded claim", chunkIds: ["c1", "c2"] },
    { text: "Ungrounded claim", chunkIds: ["c3"] },
  ],
  new Set(["c1", "c2"]),
);
if (validated.length !== 1 || validated[0].text !== "Grounded claim") {
  throw new Error("validateDraftAssertions failed");
}

const neutralized = neutralizeUnsupportedQuotes(
  'The clause says "no such obligation exists anywhere".',
  "Notice shall be forty-five (45) days.",
);
if (neutralized.includes('"no such obligation exists anywhere"')) {
  throw new Error("unsupported quote not neutralized");
}

const guarded = applySourceLimitationGuard(
  "It is unequivocally clear that Priya Calderon entered the archive vault.",
  "This register does not independently prove which person carried the badge.",
);
if (/unequivocally clear that Priya Calderon entered/i.test(guarded)) {
  throw new Error("source limitation guard failed");
}

const abstained = withInsufficientSourceAssumption({
  chunkCount: 0,
  assumptions: [],
});
if (!abstained.insufficientSourceMaterial || abstained.assumptions.length < 1) {
  throw new Error("insufficient source helper failed");
}

console.log("DRAFT_HELPERS_OK");
