import type { ContradictionCandidate, ProfessionalChunk } from "./professional";
import { extractExactDates, isImpreciseDateRestatement } from "./imprecise-date";

export type EvidenceRelation = "contradiction" | "tension" | "compatible" | "insufficient";

export const EVIDENTIARY_TENSION_LIMITATION =
  "Testimony that a person never entered a location is in tension with a recorded badge or access-log event for a credential assigned to that person. Recorded credential activity does not independently prove who physically performed the corresponding act.";

const CREDENTIAL_RE =
  /\b(access granted|access log|badge|login|log-?in|swipe|credential|card reader|exit sensor|assigned to|account activity)\b/i;
const PHYSICAL_DENIAL_RE =
  /\b(never entered|did not (personally )?enter|didn't enter|i never|testified.{0,80}never|denied entering)\b/i;
const PHYSICAL_ENTRY_RE =
  /\b(entered the|enter the|physically entered|personally entered|i entered|i did enter)\b/i;
const CONTRACT_TERM_RE =
  /\b(notice period|formal notice|requires \d+\s*days|\d+\s*days.{0,60}notice|liability cap|aggregate.{0,40}liability)\b/i;
const SEQUENCE_RE =
  /\b(amendment|amended|effective|deleted and replaced|now requires|supersed|unless amended|later signed|original agreement)\b/i;
const FILLER_RE = /\b(general provision|headings are for convenience|administrative renumbering)\b/i;
const TRANSMITTAL_RE = /\b(send|sent|emailed|uploaded|transmitted|transmission)\b/i;

export function isCredentialActivity(text: string): boolean {
  return CREDENTIAL_RE.test(text);
}

export function infersPhysicalActorFromCredential(text: string): boolean {
  const folded = text.toLowerCase();
  if (!isCredentialActivity(folded) && !/\baccess[- ]log\b/.test(folded)) return false;
  if (
    /\bdoes not (independently |conclusively )?prove who\b/.test(folded) ||
    /\bnot independently prove\b/.test(folded)
  ) {
    return false;
  }
  return (
    /\bphysically entered\b/.test(folded) ||
    /\bpersonally entered\b/.test(folded) ||
    /\baccessed the (records )?room\b/.test(folded) ||
    /\bthe witness entered\b/.test(folded) ||
    /\bproves .{0,60}entered\b/.test(folded) ||
    /\btherefore .{0,40}entered\b/.test(folded)
  );
}

export function isSequentialContractTermPair(textA: string, textB: string): boolean {
  if (!CONTRACT_TERM_RE.test(textA) || !CONTRACT_TERM_RE.test(textB)) return false;
  if (looksLikeOutboundNotice(textA) !== looksLikeOutboundNotice(textB)) return false;
  return SEQUENCE_RE.test(`${textA}\n${textB}`);
}

function looksLikeOutboundNotice(text: string): boolean {
  return /\b(notice of termination|default notice|hereby terminates|you have .{0,40}days.{0,80}to cure|days from this notice)\b/i.test(
    text,
  );
}

const DAY_WORDS: Array<[RegExp, number]> = [
  [/\bone hundred twenty\b/i, 120],
  [/\bninety\b/i, 90],
  [/\bsixty\b/i, 60],
  [/\bforty[-\s]five\b/i, 45],
  [/\bthirty\b/i, 30],
  [/\bfifteen\b/i, 15],
  [/\bten\b/i, 10],
];

export function extractDayQuantities(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(/\b(\d{1,3})\s*days?\b/gi)) {
    const n = Number(match[1]);
    if (n > 0 && n <= 365) found.add(n);
  }
  for (const match of text.matchAll(/\((\d{1,3})\)\s*days?\b/gi)) {
    const n = Number(match[1]);
    if (n > 0 && n <= 365) found.add(n);
  }
  for (const [re, n] of DAY_WORDS) {
    if (re.test(text) && /\bdays?\b/i.test(text)) found.add(n);
  }
  return [...found];
}

const DAY_WORD_VALUE: Record<string, number> = {
  ten: 10,
  fifteen: 15,
  thirty: 30,
  "forty-five": 45,
  "forty five": 45,
  sixty: 60,
  ninety: 90,
  "one hundred twenty": 120,
};

function parseDayToken(raw: string): number | null {
  const paren = raw.match(/\((\d{1,3})\)/);
  if (paren) return Number(paren[1]);
  const digits = raw.match(/\d{1,3}/);
  if (digits && !/[a-z]/i.test(raw.replace(/\(\d+\)/g, ""))) return Number(digits[0]);
  const folded = raw.toLowerCase().replace(/\s+/g, " ").replace(/\(\d+\)/g, "").trim();
  return DAY_WORD_VALUE[folded] ?? null;
}

/** Day counts tied to a requirement ("you have X days", "at least X days"), not quoted comparisons. */
export function extractOperativeDayQuantities(text: string): number[] {
  const found = new Set<number>();
  const re =
    /(?:you have|at least|within|no less than|not less than|effective)\s+((?:one hundred twenty|forty[-\s]five|ninety|sixty|thirty|fifteen|ten|\d{1,3})(?:\s*\(\d{1,3}\))?)\s*days/gi;
  for (const match of text.matchAll(re)) {
    const n = parseDayToken(match[1] ?? "");
    if (n && n > 0 && n <= 365) found.add(n);
  }
  return [...found];
}

export function hasConflictingDurations(textA: string, textB: string): boolean {
  if (!/\b(notice|cure|terminat|renew)\b/i.test(textA) || !/\b(notice|cure|terminat|renew)\b/i.test(textB)) {
    return false;
  }
  const a = extractOperativeDayQuantities(textA);
  const b = extractOperativeDayQuantities(textB);
  if (a.length === 0 || b.length === 0) return false;
  return a.some((left) => !b.includes(left)) && b.some((right) => !a.includes(right));
}

function extractPersonNames(text: string): Set<string> {
  const names = new Set<string>();
  const patterns = [
    /\b([A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+)\b/g,
    /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g,
    /\bassigned to ([A-Z][a-z]+(?:\s+[A-Z]\.?\s*[A-Z][a-z]+)?)/g,
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const name = (match[1] ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      if (name.length < 5) continue;
      if (/\b(room|office|building|exhibit|section|amendment|agreement|schedule|provision)\b/.test(name)) {
        continue;
      }
      if (/^(the |this |that )/.test(name)) continue;
      names.add(name);
    }
  }
  return names;
}

function namesOverlap(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return true;
  for (const left of a) {
    for (const right of b) {
      if (left.includes(right) || right.includes(left)) return true;
    }
  }
  return false;
}

export function actorsAreCompatible(textA: string, textB: string): boolean {
  return namesOverlap(extractPersonNames(textA), extractPersonNames(textB));
}

function namedActorsConflict(textA: string, textB: string): boolean {
  const a = extractPersonNames(textA);
  const b = extractPersonNames(textB);
  return a.size > 0 && b.size > 0 && !namesOverlap(a, b);
}

function hasDirectNegationConflict(textA: string, textB: string): boolean {
  const pairs: Array<[RegExp, RegExp]> = [
    [PHYSICAL_ENTRY_RE, PHYSICAL_DENIAL_RE],
    [/\breceived\b/i, /\b(did not receive|never received|didn't receive)\b/i],
    [/\bpaid\b/i, /\b(did not pay|never paid|didn't pay)\b/i],
    [/\bsigned\b/i, /\b(denied signing|did not sign|never signed)\b/i],
    [/\bpresent\b/i, /\b(absent|not present|was not there)\b/i],
    [/\bcompleted\b/i, /\b(never completed|unfinished|did not complete)\b/i],
  ];
  for (const [pos, neg] of pairs) {
    if ((pos.test(textA) && neg.test(textB)) || (pos.test(textB) && neg.test(textA))) return true;
  }
  return false;
}

export function isCredentialVersusPhysicalTestimony(textA: string, textB: string): boolean {
  const credA = isCredentialActivity(textA);
  const credB = isCredentialActivity(textB);
  if (credA === credB) return false;
  const testimony = credA ? textB : textA;
  const log = credA ? textA : textB;
  if (!PHYSICAL_DENIAL_RE.test(testimony)) return false;
  if (namedActorsConflict(testimony, log)) return false;
  return true;
}

const CONFLICT_FINDING_TYPE_RE = /(contradiction|inconsistency)/i;

export type DepositionFindingClassInput = {
  findingType: string;
  title: string;
  explanation?: string | null;
  supportingQuotes?: string[];
};

function rewriteConflictAsTension(text: string): string {
  return text
    .replace(/\bdirect contradictions?\b/gi, "evidentiary tension")
    .replace(/\bcontradictions?\b/gi, "evidentiary tension")
    .replace(/\binconsistenc(?:y|ies)\b/gi, "evidentiary tension");
}

function findingLooksLikeCredentialVersusTestimony(blob: string, quotes: string[]): boolean {
  if (isCredentialActivity(blob) && PHYSICAL_DENIAL_RE.test(blob)) return true;
  for (let i = 0; i < quotes.length; i += 1) {
    for (let j = i + 1; j < quotes.length; j += 1) {
      if (isCredentialVersusPhysicalTestimony(quotes[i] ?? "", quotes[j] ?? "")) return true;
    }
  }
  return false;
}

/**
 * Deposition findings labeled inconsistency/contradiction must follow the same
 * jurisdiction-independent evidence relation as the contradiction engine:
 * credential/system activity versus physical testimony is tension, not a
 * direct contradiction of two sworn propositions.
 */
export function refineDepositionFindingClass<T extends DepositionFindingClassInput>(finding: T): T {
  if (!CONFLICT_FINDING_TYPE_RE.test(finding.findingType)) return finding;
  const quotes = (finding.supportingQuotes ?? []).map((quote) => quote.trim()).filter(Boolean);
  const blob = [finding.title, finding.explanation ?? "", ...quotes].join("\n");

  if (findingLooksLikeCredentialVersusTestimony(blob, quotes)) {
    const rewritten = rewriteConflictAsTension(finding.explanation ?? "").trim();
    const explanation =
      rewritten && /does not independently prove who/i.test(rewritten)
        ? rewritten
        : [rewritten, EVIDENTIARY_TENSION_LIMITATION].filter(Boolean).join(" ");
    return {
      ...finding,
      findingType: "tension",
      title: rewriteConflictAsTension(finding.title),
      explanation,
    };
  }

  if (isImpreciseDateRestatement(blob, blob)) {
    return {
      ...finding,
      findingType: "testimony_statement",
      title: rewriteConflictAsTension(finding.title),
      explanation: rewriteConflictAsTension(finding.explanation ?? "") || finding.explanation,
    };
  }

  return finding;
}

function looksLikeDatedTransmittal(text: string): boolean {
  return TRANSMITTAL_RE.test(text) && extractExactDates(text).length > 0;
}

function exactDatesConflict(textA: string, textB: string): boolean {
  const a = extractExactDates(textA);
  const b = extractExactDates(textB);
  if (a.length === 0 || b.length === 0) return false;
  return a.some((left) =>
    b.some(
      (right) => left.month !== right.month || left.day !== right.day || left.year !== right.year,
    ),
  );
}

export function classifyEvidenceRelation(textA: string, textB: string): EvidenceRelation {
  if (isSequentialContractTermPair(textA, textB)) return "compatible";
  if (isCredentialVersusPhysicalTestimony(textA, textB)) return "tension";
  if (hasDirectNegationConflict(textA, textB)) {
    if (namedActorsConflict(textA, textB)) return "insufficient";
    if (isCredentialActivity(textA) || isCredentialActivity(textB)) return "tension";
    return "contradiction";
  }
  if (isImpreciseDateRestatement(textA, textB)) return "compatible";
  if (hasConflictingDurations(textA, textB)) return "contradiction";
  if (
    looksLikeDatedTransmittal(textA) &&
    looksLikeDatedTransmittal(textB) &&
    exactDatesConflict(textA, textB)
  ) {
    return "contradiction";
  }
  return "insufficient";
}

export function chunkContradictionScore(content: string): number {
  const text = content.toLowerCase();
  let score = 0;
  if (PHYSICAL_DENIAL_RE.test(text) || /\b(q\.|a\.)/.test(text)) score += 8;
  if (CREDENTIAL_RE.test(text)) score += 8;
  if (/\b(never|did not|didn't|denied)\b/.test(text)) score += 3;
  if (PHYSICAL_ENTRY_RE.test(text)) score += 2;
  if (/\b20\d{2}\b/.test(text)) score += 1;
  if (FILLER_RE.test(text)) score -= 8;
  if (CONTRACT_TERM_RE.test(text) && SEQUENCE_RE.test(text)) score -= 2;
  return score;
}

export function selectChunksForContradictionAnalysis(
  chunks: ProfessionalChunk[],
  limit = 48,
): ProfessionalChunk[] {
  if (chunks.length <= limit) return chunks;
  const byDoc = new Map<string, ProfessionalChunk[]>();
  for (const chunk of chunks) {
    const list = byDoc.get(chunk.documentId) ?? [];
    list.push(chunk);
    byDoc.set(chunk.documentId, list);
  }
  const perDoc = Math.max(2, Math.floor(limit / Math.max(1, byDoc.size)));
  const selected: ProfessionalChunk[] = [];
  const used = new Set<string>();
  for (const list of byDoc.values()) {
    const ranked = [...list].sort(
      (a, b) => chunkContradictionScore(b.content) - chunkContradictionScore(a.content),
    );
    for (const chunk of ranked.slice(0, perDoc)) {
      if (selected.length >= limit) break;
      selected.push(chunk);
      used.add(chunk.chunkId);
    }
  }
  const rest = chunks
    .filter((chunk) => !used.has(chunk.chunkId))
    .sort((a, b) => chunkContradictionScore(b.content) - chunkContradictionScore(a.content));
  for (const chunk of rest) {
    if (selected.length >= limit) break;
    selected.push(chunk);
  }
  return selected;
}

function clip(text: string, max = 400): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

type CandidateWithRelation = ContradictionCandidate & { relation?: EvidenceRelation };

export function sanitizeContradictionCandidate(
  candidate: CandidateWithRelation,
  textA: string,
  textB: string,
): ContradictionCandidate & { relation: "contradiction" | "tension" } {
  let relation: "contradiction" | "tension" =
    candidate.relation === "tension" || isCredentialVersusPhysicalTestimony(textA, textB)
      ? "tension"
      : "contradiction";
  if (isCredentialVersusPhysicalTestimony(textA, textB)) relation = "tension";
  const sideASummary = infersPhysicalActorFromCredential(candidate.sideA.summary)
    ? clip(textA)
    : candidate.sideA.summary;
  const sideBSummary = infersPhysicalActorFromCredential(candidate.sideB.summary)
    ? clip(textB)
    : candidate.sideB.summary;
  let explanation = candidate.explanation;
  let title = candidate.title;
  if (relation === "tension") {
    if (!/badge|access[- ]log|access granted/i.test(`${title}\n${explanation}`)) {
      explanation = EVIDENTIARY_TENSION_LIMITATION;
    }
    if (infersPhysicalActorFromCredential(`${title}\n${explanation}`)) {
      title = "Evidentiary tension between testimony and recorded activity";
      explanation = EVIDENTIARY_TENSION_LIMITATION;
    }
  }
  return {
    ...candidate,
    title,
    relation,
    explanation,
    sideA: { ...candidate.sideA, summary: sideASummary },
    sideB: { ...candidate.sideB, summary: sideBSummary },
  };
}

export function findDeterministicContradictionCandidates(
  chunks: ProfessionalChunk[],
): Array<ContradictionCandidate & { relation: "contradiction" | "tension" }> {
  const candidates: Array<ContradictionCandidate & { relation: "contradiction" | "tension" }> = [];
  for (let i = 0; i < chunks.length; i += 1) {
    for (let j = i + 1; j < chunks.length; j += 1) {
      const left = chunks[i]!;
      const right = chunks[j]!;
      if (left.documentId === right.documentId) continue;
      const relation = classifyEvidenceRelation(left.content, right.content);
      if (relation !== "contradiction" && relation !== "tension") continue;
      const durationConflict = hasConflictingDurations(left.content, right.content);
      const daysA = extractDayQuantities(left.content);
      const daysB = extractDayQuantities(right.content);
      candidates.push(
        sanitizeContradictionCandidate(
          {
            title: durationConflict
              ? "Conflicting notice or cure periods"
              : relation === "tension"
                ? "Evidentiary tension between testimony and recorded activity"
                : "Conflicting statements",
            explanation:
              relation === "tension"
                ? EVIDENTIARY_TENSION_LIMITATION
                : durationConflict
                  ? `Two Case documents state incompatible day periods (${daysA.join("/")} vs ${daysB.join("/")}) for notice, cure, termination, or renewal.`
                  : "Two source statements cannot reasonably both be true in the same scope.",
            confidence: "medium",
            relation,
            sideA: { chunkIds: [left.chunkId], summary: clip(left.content) },
            sideB: { chunkIds: [right.chunkId], summary: clip(right.content) },
          },
          left.content,
          right.content,
        ),
      );
    }
  }
  return candidates.sort((a, b) => {
    const scoreA = chunkContradictionScore(a.sideA.summary) + chunkContradictionScore(a.sideB.summary);
    const scoreB = chunkContradictionScore(b.sideA.summary) + chunkContradictionScore(b.sideB.summary);
    return scoreB - scoreA;
  });
}

export function refineContradictionCandidates(
  candidates: CandidateWithRelation[],
  chunkTextById: Map<string, string>,
): Array<ContradictionCandidate & { relation: "contradiction" | "tension" }> {
  const refined: Array<ContradictionCandidate & { relation: "contradiction" | "tension" }> = [];
  for (const candidate of candidates) {
    if (candidate.sideA.chunkIds.length < 1 || candidate.sideB.chunkIds.length < 1) continue;
    const textA = candidate.sideA.chunkIds.map((id) => chunkTextById.get(id) ?? "").join("\n");
    const textB = candidate.sideB.chunkIds.map((id) => chunkTextById.get(id) ?? "").join("\n");
    if (!textA.trim() || !textB.trim()) continue;
    const sideAKey = [...candidate.sideA.chunkIds].sort().join("|");
    const sideBKey = [...candidate.sideB.chunkIds].sort().join("|");
    if (sideAKey === sideBKey) continue;
    const combined = `${candidate.title}\n${candidate.explanation}\n${textA}\n${textB}`;
    if (
      isSequentialContractTermPair(textA, textB) ||
      isSequentialContractTermPair(candidate.title, candidate.explanation)
    ) {
      continue;
    }
    if (
      CONTRACT_TERM_RE.test(combined) &&
      SEQUENCE_RE.test(combined) &&
      !hasConflictingDurations(textA, textB) &&
      !PHYSICAL_DENIAL_RE.test(combined) &&
      !CREDENTIAL_RE.test(combined)
    ) {
      continue;
    }
    if (
      namedActorsConflict(textA, textB) &&
      !isCredentialVersusPhysicalTestimony(textA, textB) &&
      !hasConflictingDurations(textA, textB)
    ) {
      continue;
    }
    let relation = classifyEvidenceRelation(textA, textB);
    if (relation === "compatible" || relation === "insufficient") continue;
    refined.push(sanitizeContradictionCandidate({ ...candidate, relation }, textA, textB));
  }
  return refined;
}
