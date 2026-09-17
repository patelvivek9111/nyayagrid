/**
 * Conservative treatment-signal foundation.
 * Detector output is a signal, never a definitive "bad law" conclusion.
 */

export const TREATMENT_SIGNAL_KINDS = [
  "overruled",
  "superseded",
  "reversed",
  "vacated",
  "distinguished",
  "followed",
  "criticized",
] as const;

export type TreatmentSignalKind = (typeof TREATMENT_SIGNAL_KINDS)[number];

export type TreatmentSignal = {
  kind: TreatmentSignalKind;
  citingAuthorityId?: string;
  citedAuthorityId?: string | null;
  sourceSentence: string;
  detector: "lexical_pattern" | "source_metadata" | "human_review";
  /** Internal only — never show as mathematical certainty in customer UI. */
  confidenceHint?: "low" | "medium" | "high";
};

const SIGNAL_PATTERNS: Array<{ kind: TreatmentSignalKind; re: RegExp }> = [
  { kind: "overruled", re: /\boverrul(ed|ing)\b/i },
  { kind: "superseded", re: /\bsupersed(ed|ing|es)\b/i },
  { kind: "reversed", re: /\brevers(ed|ing)\b/i },
  { kind: "vacated", re: /\bvacat(ed|ing|e)\b/i },
  { kind: "distinguished", re: /\bdistinguish(ed|ing)\b/i },
  { kind: "followed", re: /\bfollow(ed|ing)\b/i },
  { kind: "criticized", re: /\bcriticiz(ed|ing|e)\b/i },
];

/** Extract lexical treatment signals from a citing passage. */
export function extractTreatmentSignalsFromText(params: {
  text: string;
  citingAuthorityId?: string;
  citedAuthorityId?: string | null;
}): TreatmentSignal[] {
  const sentence = params.text.trim().slice(0, 500);
  if (!sentence) return [];
  const found: TreatmentSignal[] = [];
  for (const pattern of SIGNAL_PATTERNS) {
    if (pattern.re.test(sentence)) {
      found.push({
        kind: pattern.kind,
        citingAuthorityId: params.citingAuthorityId,
        citedAuthorityId: params.citedAuthorityId ?? null,
        sourceSentence: sentence,
        detector: "lexical_pattern",
        confidenceHint: "low",
      });
    }
  }
  return found;
}

export function treatmentSignalCustomerDisclaimer(): string {
  return "Detected treatment language is a research signal only. It is not Shepard's, KeyCite, or a determination that authority is bad law.";
}
