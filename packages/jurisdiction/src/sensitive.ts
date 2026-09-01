/**
 * Conservative detector for questions whose answer materially depends on jurisdiction.
 * Broader than general doctrine detection: used only for unknown-jurisdiction abstention.
 */
const PATTERNS = [
  /\bstatute of limitations\b/i,
  /\blimitation(s)? period\b/i,
  /\belements? of\b/i,
  /\bwhat is the (law|rule|test|standard)\b/i,
  /\bis it (legal|lawful|enforceable)\b/i,
  /\bgoverning law\b/i,
  /\bchoice of law\b/i,
  /\bwhich (state|jurisdiction|court|circuit)\b/i,
  /\bstandard of review\b/i,
  /\bburden of proof\b/i,
  /\bsolicitation\b/i,
  /\bcan (we|i|they|plaintiff|defendant) (sue|recover|enjoin|file)\b/i,
];

export function looksLikeJurisdictionSensitiveQuestion(question: string): boolean {
  const text = question.trim();
  if (!text) return false;
  return PATTERNS.some((pattern) => pattern.test(text));
}
