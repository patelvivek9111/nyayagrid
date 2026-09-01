const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

const MONTH_ABBREV: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  sept: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function wordNumberMap(): Map<string, number> {
  const map = new Map<string, number>();
  ONES.forEach((word, value) => map.set(word, value));
  TENS.forEach((word, value) => {
    if (word) map.set(word, value * 10);
  });
  for (let ten = 2; ten <= 9; ten += 1) {
    for (let one = 1; one <= 9; one += 1) {
      map.set(`${TENS[ten]}-${ONES[one]}`, ten * 10 + one);
      map.set(`${TENS[ten]} ${ONES[one]}`, ten * 10 + one);
    }
  }
  return map;
}

const WORD_NUMBERS = wordNumberMap();

export function fold(text: string): string {
  return text.toLowerCase().replace(/[’']/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

export function compactDigits(text: string): string {
  return text.replace(/[$,]/g, "");
}

export function normalizeMoneyTokens(text: string): string[] {
  const tokens = new Set<string>();
  const folded = fold(text);
  const compact = compactDigits(folded);
  const matches = compact.match(/\d+(?:\.\d+)?/g) ?? [];
  for (const match of matches) {
    const asNumber = Number(match);
    if (!Number.isFinite(asNumber)) continue;
    tokens.add(String(asNumber));
    tokens.add(asNumber.toLocaleString("en-US"));
  }
  for (const match of folded.matchAll(/\b(\d+(?:\.\d+)?)\s*k\b/g)) {
    const asNumber = Number(match[1]) * 1000;
    if (!Number.isFinite(asNumber)) continue;
    tokens.add(String(asNumber));
    tokens.add(asNumber.toLocaleString("en-US"));
  }
  for (const [word, value] of WORD_NUMBERS) {
    if (new RegExp(`\\b${word}\\b`, "i").test(folded)) {
      tokens.add(String(value));
    }
  }
  return [...tokens];
}

export function normalizeDateTokens(text: string): string[] {
  const folded = fold(text);
  const tokens = new Set<string>();
  for (const iso of folded.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/g) ?? []) {
    tokens.add(iso);
    const [year, month, day] = iso.split("-");
    if (year && month && day) tokens.add(`${month}/${day}/${year}`);
  }
  const named = [
    ...folded.matchAll(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(20\d{2})\b/g,
    ),
  ];
  for (const match of named) {
    const month = MONTHS[match[1] ?? ""];
    const day = String(match[2] ?? "").padStart(2, "0");
    const year = match[3] ?? "";
    if (month && year) tokens.add(`${year}-${month}-${day}`);
  }
  const abbrev = [
    ...folded.matchAll(
      /\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2}),?\s+(20\d{2})\b/g,
    ),
  ];
  for (const match of abbrev) {
    const month = MONTH_ABBREV[match[1] ?? ""];
    const day = String(match[2] ?? "").padStart(2, "0");
    const year = match[3] ?? "";
    if (month && year) tokens.add(`${year}-${month}-${day}`);
  }
  return [...tokens];
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "for",
  "in",
  "on",
  "is",
  "are",
  "was",
  "were",
  "be",
  "as",
  "by",
  "from",
  "that",
  "this",
  "with",
  "not",
  "no",
  "yes",
]);

export function distinctivePhrases(canonical: string): string[] {
  const folded = fold(canonical);
  const phrases: string[] = [];
  if (folded.length <= 80) phrases.push(folded);
  const words = folded
    .replace(/[^a-z0-9$\-\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOP.has(word));
  phrases.push(...words);
  phrases.push(...normalizeMoneyTokens(canonical).map((token) => fold(token)));
  phrases.push(...normalizeDateTokens(canonical));
  return [...new Set(phrases.filter(Boolean))];
}

export function containsNeedle(haystack: string, needle: string): boolean {
  const hay = fold(compactDigits(haystack));
  const need = fold(compactDigits(needle));
  if (!need) return false;
  if (hay.includes(need)) return true;
  const hayDates = new Set(normalizeDateTokens(haystack));
  const needDates = normalizeDateTokens(needle);
  if (needDates.some((date) => hayDates.has(date))) return true;
  const hayMoney = new Set(normalizeMoneyTokens(haystack));
  const needMoney = normalizeMoneyTokens(needle);
  if (needMoney.length > 0 && needMoney.every((amount) => hayMoney.has(amount))) return true;
  return false;
}

/** True when `needle` appears as its own token, not as a substring of a longer word. */
export function hasBoundedToken(haystack: string, needle: string): boolean {
  const hay = fold(haystack);
  const need = fold(needle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!need) return false;
  return new RegExp(`(^|[^a-z0-9])${need}([^a-z0-9]|$)`).test(hay);
}

/**
 * True when `stem` starts a token (`conflict` matches `conflicts`, `conflicting`).
 * Does not match a stem that is only a suffix of a longer word (`consistent` does not
 * match inside `inconsistent`).
 */
export function hasBoundedStem(haystack: string, stem: string): boolean {
  const hay = fold(haystack);
  const need = fold(stem).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!need) return false;
  return new RegExp(`(^|[^a-z0-9])${need}[a-z]*([^a-z0-9]|$)`).test(hay);
}
