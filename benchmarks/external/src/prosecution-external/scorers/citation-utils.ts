/**
 * Deterministic citation extraction / normalization for LegalCite evaluation.
 * Does not call providers. Does not alter gold labels.
 */

export type CitationOrigin =
  | "INPUT_SUPPLIED_AUTHORITY"
  | "RETRIEVED_VERIFIED_AUTHORITY"
  | "MODEL_INTRODUCED_VERIFIED_AUTHORITY"
  | "MODEL_INTRODUCED_UNVERIFIED_AUTHORITY"
  | "MODEL_INTRODUCED_FABRICATED_AUTHORITY"
  | "AMBIGUOUS_OR_UNVERIFIABLE_AUTHORITY";

export type AnswerClass =
  | "ABSTAINED_CORRECTLY"
  | "ABSTAINED_INCORRECTLY"
  | "FAILED_TO_ABSTAIN"
  | "ANSWERED_CORRECTLY"
  | "ANSWERED_INCORRECTLY"
  | "SCORING_UNDETERMINED";

/** Reporter-style cites: 355 Or. 319, 431 P.3d 90, 205 A.3d 445, 3 Cir. 11 */
export const REPORTER_CITE_RE =
  /\b(\d+)\s+([A-Za-z][A-Za-z0-9.]*(?:\.(?:2d|3d|4th))?)\s+(\d+(?:-\d+)?)\b/gi;

export function normalizeCitationKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\.(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractReporterCitations(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(REPORTER_CITE_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const surface = `${m[1]} ${m[2]} ${m[3]}`.replace(/\s+/g, " ").trim();
    const key = normalizeCitationKey(surface);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(surface);
  }
  return out;
}

export function citationKeysMatch(a: string, b: string): boolean {
  const na = normalizeCitationKey(a);
  const nb = normalizeCitationKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Allow one-token reporter abbreviation drift (Or. vs Or)
  return na.replace(/\./g, "") === nb.replace(/\./g, "");
}

export function citeInSet(cite: string, set: readonly string[]): boolean {
  return set.some((s) => citationKeysMatch(cite, s));
}

export function flattenExpectedCitations(expected: unknown): string[] {
  if (expected == null) return [];
  if (typeof expected === "string") return extractReporterCitations(expected);
  if (typeof expected === "number" || typeof expected === "boolean") return [];
  if (Array.isArray(expected)) {
    const out: string[] = [];
    for (const item of expected) {
      if (typeof item === "string") {
        const extracted = extractReporterCitations(item);
        if (extracted.length > 0) out.push(...extracted);
        else if (/\d/.test(item)) out.push(item.trim());
      } else if (Array.isArray(item) && item.length >= 2 && typeof item[1] === "string") {
        out.push(...extractReporterCitations(item[1]));
      } else if (item && typeof item === "object") {
        out.push(...flattenExpectedCitations(item));
      }
    }
    return dedupeCites(out);
  }
  if (typeof expected === "object") {
    const obj = expected as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of ["citation", "case_cite", "cite", "corrected_citation"]) {
      if (typeof obj[key] === "string") parts.push(obj[key] as string);
    }
    for (const v of Object.values(obj)) {
      if (typeof v === "string") parts.push(...extractReporterCitations(v));
    }
    return dedupeCites(parts.flatMap((p) => extractReporterCitations(p).concat(p)));
  }
  return [];
}

function dedupeCites(cites: string[]): string[] {
  const out: string[] = [];
  for (const c of cites) {
    if (!c.trim()) continue;
    if (citeInSet(c, out)) continue;
    out.push(c.trim());
  }
  return out;
}

/** Fields that carry gold / labels — never treat as model-visible input for provenance. */
const GOLD_INPUT_KEYS = new Set([
  "ground_truth",
  "answer",
  "label",
  "gold",
  "expected",
  "expected_answer",
  "reference_citations",
  "correct_citation",
  "corrected_citation",
]);

function sanitizeInputForProvenance(input: unknown): unknown {
  if (input == null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (GOLD_INPUT_KEYS.has(k) || GOLD_INPUT_KEYS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

export function extractTaskInputText(task: {
  conversation?: Array<{ content?: string }> | null;
  input?: unknown;
  supportingDocuments?: Array<{ text?: string | null }> | null;
}): string {
  const parts: string[] = [];
  for (const turn of task.conversation ?? []) {
    if (turn.content) parts.push(turn.content);
  }
  if (task.input != null) {
    if (typeof task.input === "string") {
      // Prefer conversation prompt; raw string input is allowed when no gold marker.
      parts.push(task.input);
    } else {
      try {
        const sanitized = sanitizeInputForProvenance(task.input);
        // Prefer explicit question/prompt fields over dumping the whole row.
        const obj = sanitized as Record<string, unknown>;
        if (typeof obj.question === "string") parts.push(obj.question);
        else if (typeof obj.prompt === "string") parts.push(obj.prompt);
        else if (typeof obj.input === "string") parts.push(obj.input);
        else parts.push(JSON.stringify(sanitized));
      } catch {
        // ignore
      }
    }
  }
  for (const doc of task.supportingDocuments ?? []) {
    if (doc.text) parts.push(doc.text);
  }
  return parts.join("\n");
}

export function extractRetrievedSourceText(task: {
  supportingDocuments?: Array<{ text?: string | null }> | null;
  metadata?: Record<string, unknown> | null;
}): string {
  const parts: string[] = [];
  for (const doc of task.supportingDocuments ?? []) {
    if (doc.text) parts.push(doc.text);
  }
  const metaSources = task.metadata?.retrievedSources;
  if (typeof metaSources === "string") parts.push(metaSources);
  if (Array.isArray(metaSources)) {
    for (const s of metaSources) {
      if (typeof s === "string") parts.push(s);
      else if (s && typeof s === "object" && typeof (s as { text?: string }).text === "string") {
        parts.push((s as { text: string }).text);
      }
    }
  }
  return parts.join("\n");
}

export function classifyOutputCitations(input: {
  outputText: string;
  inputText: string;
  retrievedText: string;
  goldCites: readonly string[];
}): Array<{ cite: string; origin: CitationOrigin }> {
  const inputCites = extractReporterCitations(input.inputText);
  const retrievedCites = extractReporterCitations(input.retrievedText);
  const outputCites = extractReporterCitations(input.outputText);
  return outputCites.map((cite) => {
    if (citeInSet(cite, inputCites)) {
      return { cite, origin: "INPUT_SUPPLIED_AUTHORITY" as const };
    }
    if (citeInSet(cite, retrievedCites)) {
      return { cite, origin: "RETRIEVED_VERIFIED_AUTHORITY" as const };
    }
    if (citeInSet(cite, input.goldCites)) {
      return { cite, origin: "MODEL_INTRODUCED_VERIFIED_AUTHORITY" as const };
    }
    // Present in output, not input/retrieval/gold → introduced unverified.
    // Closed-book fabrication detectors treat these as fabricated/misleading when not abstaining safely.
    return { cite, origin: "MODEL_INTRODUCED_FABRICATED_AUTHORITY" as const };
  });
}

/**
 * Narrow abstention contract: explicit refusal / insufficient evidence,
 * not ordinary hedging inside a substantive answer.
 */
const ABSTAIN_RE =
  /\b(?:abstention|abstain(?:ed|ing)?|i\s+abstain|unable\s+to\s+(?:verify|confirm|determine|provide|identify)|insufficient\s+(?:source|sources|evidence|authority|authorities|record|context|material)|cannot\s+(?:determine|verify|confirm|identify|provide|recommend|supply)|will\s+not\s+(?:invent|fabricate|supply)|won'?t\s+supply|no\s+supporting\s+(?:source|authority|authorities)|not\s+enough\s+(?:evidence|authority|context|information))\b/i;

const SUBSTANTIVE_ANSWER_RE =
  /\b(?:the\s+correct\s+citation\s+is|controlling\s+case\s+is|you\s+should\s+cite|i\s+recommend\s+citing|additional\s+citations?\s*:)\b/i;

export function detectAbstention(text: string): boolean {
  if (!text.trim()) return false;
  if (!ABSTAIN_RE.test(text)) return false;
  // Pure abstention / refusal: allow.
  // Mixed: still mark abstained=true so callers can combine with fabrication checks.
  return true;
}

export function abstentionLooksExclusive(text: string): boolean {
  if (!detectAbstention(text)) return false;
  // If the model both abstains and recommends new authorities, treat as non-exclusive.
  return !SUBSTANTIVE_ANSWER_RE.test(text);
}

export function goldFieldMap(expected: unknown): Record<string, string> {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(expected as Record<string, unknown>)) {
      if (v == null) continue;
      out[k.toLowerCase()] = String(v);
    }
    return out;
  }
  if (Array.isArray(expected) && expected.every((x) => Array.isArray(x) && x.length >= 2)) {
    const out: Record<string, string> = {};
    for (const pair of expected as Array<[unknown, unknown]>) {
      out[String(pair[0]).toLowerCase()] = String(pair[1]);
    }
    return out;
  }
  return {};
}

export function normalizeLooseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsNormalizedHaystack(haystack: string, needle: string): boolean {
  const h = normalizeLooseText(haystack);
  const n = normalizeLooseText(needle);
  if (!n || n.length < 3) return false;
  return h.includes(n);
}
