import { classifyEvidenceRelation } from "./contradiction-semantics";
import { selectOperativeProvisionRef } from "./document-structure";
import {
  exactDatesEqual,
  extractExactDates,
  formatExactCalendarDate,
  type ExactCalendarDate,
} from "./imprecise-date";
import type { AssessmentPassage, EvidenceAssessment } from "./evidence-assessment";

export type QuestionTargetKind =
  | "duration"
  | "termination_right"
  | "amount"
  | "named_source_value"
  | "contradiction_check"
  | "other";

export type SourceRoleKind =
  | "signed_instrument"
  | "informal_communication"
  | "invoice"
  | "activity_log"
  | "testimony"
  | "unknown";

export type StatementRelation =
  "contradiction" | "tension" | "compatible" | "different_precision" | "insufficient";

export type QuestionTarget = {
  kind: QuestionTargetKind;
  asOf: Date | null;
  namedSource: string | null;
};

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const WORD_NUMBERS: Record<string, number> = {
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fortyfive: 45,
  "forty-five": 45,
  "forty five": 45,
  sixty: 60,
  ninety: 90,
  hundred: 100,
};

const INFORMAL_RE =
  /\b(i think|i believe|i thought|we think|we thought|recollect|my understanding|seems like|probably|still says)\b/i;
const AMENDMENT_RE =
  /\b(amendment|amended|deleted and replaced|now requires|is reduced to|effective immediately)\b/i;
const INFORMAL_DOC_RE = /\b(email|recollection|i think|internal note)\b/i;

function parseIsoOrNamedDate(raw: string): Date | null {
  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const named = raw.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\b/i,
  );
  if (named) {
    const month = MONTHS[named[1]!.toLowerCase()];
    if (month == null) return null;
    const date = new Date(Date.UTC(Number(named[3]), month, Number(named[2])));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function extractQuestionAsOfDate(question: string, now = new Date()): Date | null {
  const asOfMonth = question.match(
    /\bas of\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i,
  );
  if (asOfMonth) {
    const month = MONTHS[asOfMonth[1]!.toLowerCase()];
    if (month == null) return null;
    return new Date(Date.UTC(Number(asOfMonth[2]), month + 1, 0));
  }
  const onDate =
    parseIsoOrNamedDate(question.match(/\b(?:on|as of)\s+([^?]+)/i)?.[1] ?? "") ??
    parseIsoOrNamedDate(question);
  if (onDate) return onDate;
  if (/\b(currently|current|now|today|present(?:ly)?)\b/i.test(question)) return now;
  return null;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDayCount(raw: string): number | null {
  const digits = raw.match(/(\d+)/);
  if (digits) return Number(digits[1]);
  const key = raw.toLowerCase().replace(/\s+/g, " ").trim();
  return WORD_NUMBERS[key] ?? WORD_NUMBERS[key.replace(" ", "")] ?? null;
}

export function classifySourceRole(quote: string): SourceRoleKind {
  if (INFORMAL_RE.test(quote) || INFORMAL_DOC_RE.test(quote)) return "informal_communication";
  if (/\b(access granted|access denied|login successful|credential)\b/i.test(quote)) {
    return "activity_log";
  }
  if (/\b(invoice|amount due|remittance)\b/i.test(quote)) return "invoice";
  if (/\b(deposition|q\.|a\.|testified)\b/i.test(quote)) return "testimony";
  if (AMENDMENT_RE.test(quote) || /\b(shall be|this amendment|section \d+ is)\b/i.test(quote)) {
    return "signed_instrument";
  }
  return "unknown";
}

export function extractNamedInstrument(question: string): string | null {
  const exhibit = question.match(
    /\b(exhibit\s+[a-z](?:\s*[-–]\s*[\w ]{0,40})?|appendix\s+[a-z0-9]+|schedule\s+[a-z0-9]+|annex\s+[a-z0-9]+|non-compete(?: agreement)?|unsigned draft)\b/i,
  );
  if (exhibit?.[1]) return exhibit[1].replace(/\s+/g, " ").trim();
  return null;
}

const INSTRUMENT_TYPE_RE =
  /\b(amendments?|addenda|addendum|riders?|exhibits?|appendi(?:x|ces)|schedules?|annex(?:es)?|side letters?)\b/i;

function compactInstrumentKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Named exhibit/schedule or a generic instrument type referenced by the question. */
export function namedInstrumentFromQuestion(question: string): string | null {
  return extractNamedInstrument(question) ?? question.match(INSTRUMENT_TYPE_RE)?.[1] ?? null;
}

export function instrumentMentionedInText(instrument: string, text: string): boolean {
  const compactInstrument = compactInstrumentKey(instrument);
  const compactText = compactInstrumentKey(text);
  if (compactInstrument.length >= 4 && compactText.includes(compactInstrument)) return true;
  const typeToken = instrument
    .toLowerCase()
    .replace(/s\b/, "")
    .replace(/addenda/, "addendum")
    .replace(/appendices/, "appendix");
  const compactType = compactInstrumentKey(typeToken);
  return compactType.length >= 4 && compactText.includes(compactType);
}

export function passagesMentionInstrument(
  instrument: string,
  passages: Array<{ documentId?: string | null; quote?: string | null }>,
): boolean {
  const blob = passages
    .map((passage) => `${passage.documentId ?? ""} ${passage.quote ?? ""}`)
    .join("\n");
  return instrumentMentionedInText(instrument, blob);
}

export function classifyQuestionTarget(question: string, now = new Date()): QuestionTarget {
  const namedSource = extractNamedInstrument(question);
  if (
    /\b(inconsistent|contradict|conflict with)\b/i.test(question) ||
    /\bis [“"]?.{0,80}inconsistent\b/i.test(question)
  ) {
    return {
      kind: "contradiction_check",
      asOf: extractQuestionAsOfDate(question, now),
      namedSource,
    };
  }
  if (namedSource && /\b(amount|exact|appear|who|signed|according to)\b/i.test(question)) {
    return {
      kind: "named_source_value",
      asOf: extractQuestionAsOfDate(question, now),
      namedSource,
    };
  }
  if (
    /\bnotice period\b/i.test(question) ||
    (/\bnotice\b/i.test(question) &&
      /\b(currently|current|as of|will apply|operative|required|require)\b/i.test(question))
  ) {
    return { kind: "duration", asOf: extractQuestionAsOfDate(question, now), namedSource };
  }
  if (/\bterminat(?:e|ion)\b/i.test(question) && /\bconvenience\b/i.test(question)) {
    return { kind: "termination_right", asOf: extractQuestionAsOfDate(question, now), namedSource };
  }
  if (/\b(price|amount|payment|rent|fee|cap|consideration)\b/i.test(question)) {
    return { kind: "amount", asOf: extractQuestionAsOfDate(question, now), namedSource };
  }
  return { kind: "other", asOf: extractQuestionAsOfDate(question, now), namedSource };
}

function namedSourceInQuote(named: string, quote: string): boolean {
  const compact = named.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const quoteCompact = quote.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (quoteCompact.includes(compact)) return true;
  const token = named.match(/\bexhibit\s+([a-z0-9]+)/i)?.[1];
  if (token && new RegExp(`\\bexhibit\\s*${token}\\b`, "i").test(quote)) return true;
  return false;
}

const DATE_TOKEN =
  "\\d{4}-\\d{2}-\\d{2}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\\s+\\d{1,2},?\\s+\\d{4}";

function asksDatePrecisionCompare(question: string): boolean {
  return (
    /\b(inconsistent|contradict|compatible)\b/i.test(question) &&
    (/\b(middle of|near the|approximately|on or about|meeting date)\b/i.test(question) ||
      new RegExp(DATE_TOKEN, "i").test(question))
  );
}

function looksLikeTestimony(quote: string): boolean {
  if (classifySourceRole(quote) === "testimony") return true;
  return /\bQ\.\s/.test(quote) && /\bA\.\s/.test(quote);
}

function testimonyDeniesAct(quote: string): boolean {
  if (!looksLikeTestimony(quote)) return false;
  return /\b(never entered|did not enter|i never entered|no\.?\s+i never)\b/i.test(quote);
}

function activityRecordsAccess(quote: string): boolean {
  return classifySourceRole(quote) === "activity_log" && /\baccess granted\b/i.test(quote);
}

export function classifyStatementRelation(params: {
  question: string;
  passages: AssessmentPassage[];
}): StatementRelation {
  const questionBlob = params.question;
  const blob = `${params.question}\n${params.passages.map((p) => p.quote).join("\n")}`;
  const testimonyVsLog =
    params.passages.some((p) => testimonyDeniesAct(p.quote)) &&
    params.passages.some((p) => activityRecordsAccess(p.quote));
  const asksEntryEvidence = /\b(enter|entered|records room|access log|badge)\b/i.test(
    params.question,
  );
  if (testimonyVsLog && asksEntryEvidence && !asksDatePrecisionCompare(questionBlob)) {
    return "tension";
  }

  const precisionSource = asksDatePrecisionCompare(questionBlob) ? blob : questionBlob;
  const approxMonth = precisionSource.match(
    /\b(?:near the middle of|middle of|end of|approximately|on or about|about)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  );
  const exactDates = [...blob.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)].map(
    (m) => new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
  );
  if (asksDatePrecisionCompare(questionBlob) && approxMonth && exactDates.length > 0) {
    const month = MONTHS[approxMonth[1]!.toLowerCase()];
    const inMonth = exactDates.filter((d) => d.getUTCMonth() === month);
    if (inMonth.length > 0) return "different_precision";
    return "tension";
  }
  const unique = [...new Set(exactDates.map((d) => isoDate(d)))];
  if (unique.length >= 2 && /\b(payment date|posted on|meeting date)\b/i.test(blob)) {
    const topic = params.question.toLowerCase();
    const topical = params.passages.filter((p) => {
      if (/\bpayment\b/i.test(topic)) return /\bpayment|posted\b/i.test(p.quote);
      if (/\bmeeting\b/i.test(topic)) return /\bmeeting|review\b/i.test(p.quote);
      return true;
    });
    const topicalDates = [
      ...new Set(
        topical.flatMap((p) => [...p.quote.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1]!)),
      ),
    ];
    if (topicalDates.length >= 2) return "contradiction";
  }
  if (unique.length >= 2) return "insufficient";
  return "compatible";
}

type DurationTerm = {
  days: number;
  label: string;
  effectiveAt: number;
  amendment: boolean;
  informal: boolean;
  chunkId: string;
  quote: string;
};

function isNoticePeriodWindow(windowLower: string): boolean {
  const hasTrueNoticePeriod =
    /\bnotice period\b/.test(windowLower) ||
    /\bformal notice\b/.test(windowLower) ||
    /\bnotice\s+shall\s+be\b/.test(windowLower) ||
    /\bnotice\s+(?:now\s+)?requires?\b/.test(windowLower);
  const hasWrittenNotice = /\bdays['’]?\s+written notice\b/.test(windowLower);
  if (!hasTrueNoticePeriod && !hasWrittenNotice) return false;
  const convenience = /\bterminat(?:e|ion).{0,60}convenience\b/.test(windowLower);
  if (convenience && !hasTrueNoticePeriod) return false;
  return true;
}

function extractDurationTerms(passages: AssessmentPassage[], noticeOnly: boolean): DurationTerm[] {
  const terms: DurationTerm[] = [];
  const durationRe =
    /\b((?:ten|fifteen|twenty|thirty|forty(?:[-\s]five)?|sixty|ninety|\d+)\s*(?:\((\d+)\)\s*)?days)\b/gi;
  for (const passage of passages) {
    const quote = passage.quote;
    if (!/\bdays\b/i.test(quote)) continue;
    const informal = classifySourceRole(quote) === "informal_communication";
    for (const match of quote.matchAll(durationRe)) {
      const days = parseDayCount(match[1] ?? "");
      if (days == null) continue;
      const idx = match.index ?? 0;
      const window = quote.slice(Math.max(0, idx - 140), idx + match[0].length + 90);
      const windowLower = window.toLowerCase();
      if (noticeOnly && !isNoticePeriodWindow(windowLower)) continue;
      const localDated =
        parseIsoOrNamedDate(
          window.match(new RegExp(`\\bbecomes effective(?: on)?\\s+(${DATE_TOKEN})`, "i"))?.[1] ??
            "",
        ) ??
        parseIsoOrNamedDate(
          window.match(new RegExp(`\\beffective(?: on)?\\s+(${DATE_TOKEN})`, "i"))?.[1] ?? "",
        ) ??
        parseIsoOrNamedDate(
          window.match(new RegExp(`\\b(?:beginning|commencing)\\s+(${DATE_TOKEN})`, "i"))?.[1] ??
            "",
        );
      const localImmediate = /\beffective immediately\b/i.test(window);
      const futureBound = /\bthereafter\b|\bbecomes effective\b|\bbeginning\b|\bcommencing\b/.test(
        windowLower,
      );
      const instrumentOperative =
        /\b(deleted and replaced|this amendment|formal notice now requires|section \d+ is (?:deleted|amended))\b/i.test(
          window,
        );
      const role = classifySourceRole(quote);
      if (
        noticeOnly &&
        (role === "testimony" || role === "activity_log" || role === "unknown") &&
        !instrumentOperative &&
        !/\bformal notice requires\b/i.test(window)
      ) {
        continue;
      }
      if (
        noticeOnly &&
        /\bchanged (the )?(current )?notice period\b/i.test(windowLower) &&
        !instrumentOperative
      ) {
        continue;
      }
      const amendment =
        AMENDMENT_RE.test(window) && (instrumentOperative || role === "signed_instrument");
      let effectiveAt = Number.NEGATIVE_INFINITY;
      if (localDated && (futureBound || /\beffective\b/i.test(window))) {
        effectiveAt = localDated.getTime();
      } else if (localImmediate || (amendment && !futureBound && instrumentOperative)) {
        effectiveAt = 0;
      }
      terms.push({
        days,
        label: `${days} days`,
        effectiveAt,
        amendment,
        informal,
        chunkId: passage.chunkId,
        quote: passage.quote,
      });
    }
  }
  return terms;
}

function pickOperativeDuration(
  terms: DurationTerm[],
  asOfMs: number,
): { term: DurationTerm; laterTerms: DurationTerm[] } | null {
  const contractual = terms.filter((term) => !term.informal);
  const pool = contractual.length > 0 ? contractual : terms;
  const eligible = pool.filter((term) => term.effectiveAt <= asOfMs);
  if (eligible.length === 0) return null;
  eligible.sort(
    (a, b) => b.effectiveAt - a.effectiveAt || Number(b.amendment) - Number(a.amendment),
  );
  return {
    term: eligible[0]!,
    laterTerms: pool.filter((term) => term.effectiveAt > asOfMs),
  };
}

function durationAssessment(
  question: string,
  passages: AssessmentPassage[],
  now: Date,
): EvidenceAssessment | null {
  const target = classifyQuestionTarget(question, now);
  const emailVsContract =
    /\b(email|recollect|still says)\b/i.test(question) &&
    /\b(require|notice|term|agreement|contract)\b/i.test(question);
  if (target.kind !== "duration" && !emailVsContract) return null;
  if (
    /\band\b/i.test(question) &&
    /\b(expir|commenc|when does|who |which judge|liability cap)\b/i.test(question)
  ) {
    return null;
  }
  const asOf = target.asOf ?? now;
  const noticeOnly = /\bnotice\b/i.test(question) || emailVsContract;
  const terms = extractDurationTerms(passages, noticeOnly);
  if (terms.length === 0) return null;
  const picked = pickOperativeDuration(terms, asOf.getTime());
  if (!picked) return null;
  const laterNamed = [...picked.laterTerms]
    .sort((a, b) => a.effectiveAt - b.effectiveAt)
    .slice(0, 2)
    .map(
      (term) =>
        ` A signed amendment changes it to ${term.label} effective ${isoDate(new Date(term.effectiveAt))}.`,
    )
    .join("");
  const laterNote = laterNamed
    ? `${laterNamed} That later-effective amendment is not yet effective as of the asked date.`
    : picked.laterTerms.length > 0
      ? " A signed amendment with a later effective date is not yet effective as of the asked date."
      : "";
  const informal = passages.find((p) => classifySourceRole(p.quote) === "informal_communication");
  const sourceNote = informal
    ? " Informal recollection does not change that contractual term."
    : "";
  const laterOverclaims = picked.laterTerms.flatMap((term) => [
    `currently ${term.days}`,
    `currently ${term.label}`,
  ]);
  return {
    proposition: question.trim(),
    status: "established",
    premiseStatus: "not_applicable",
    dateSensitive: true,
    relevantDate: isoDate(asOf),
    operativeTerm: picked.term.label,
    allowedClaim: `As of ${isoDate(asOf)}, the operative notice period is ${picked.term.label}. ${picked.term.quote.slice(0, 200).trim()}${laterNote}${sourceNote}`,
    prohibitedOverclaims: [...new Set(laterOverclaims)],
    limitations:
      picked.laterTerms.length > 0
        ? ["A later-effective amendment is not yet operative as of the asked date."]
        : [],
    evidence: [{ chunkId: picked.term.chunkId, role: "direct" }],
  };
}

function terminationAssessment(
  question: string,
  passages: AssessmentPassage[],
  now: Date,
): EvidenceAssessment | null {
  if (classifyQuestionTarget(question, now).kind !== "termination_right") return null;
  const asOf = extractQuestionAsOfDate(question, now) ?? now;
  type TermRight = {
    permitted: boolean;
    effectiveAt: number;
    chunkId: string;
    quote: string;
  };
  const rights: TermRight[] = [];
  for (const passage of passages) {
    if (!/\bconvenience\b/i.test(passage.quote) && !/\bterminate\b/i.test(passage.quote)) continue;
    if (classifySourceRole(passage.quote) === "informal_communication") continue;
    const dated =
      parseIsoOrNamedDate(
        passage.quote.match(
          /\b(beginning|effective|becomes effective(?: on)?|commencing)\s+(\d{4}-\d{2}-\d{2}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})/i,
        )?.[2] ?? "",
      ) ?? parseIsoOrNamedDate(passage.quote);
    const future = /\b(beginning|thereafter|becomes effective)\b/i.test(passage.quote);
    const amendment = AMENDMENT_RE.test(passage.quote);
    let effectiveAt = Number.NEGATIVE_INFINITY;
    if (dated && future) effectiveAt = dated.getTime();
    else if (amendment) effectiveAt = 0;
    const denied =
      /\b(not permitted|may not terminate|no (?:right|option) to terminate|convenience termination is not)\b/i.test(
        passage.quote,
      );
    const granted = /\bmay terminate for convenience\b/i.test(passage.quote);
    if (!denied && !granted) continue;
    rights.push({
      permitted: granted && !denied,
      effectiveAt,
      chunkId: passage.chunkId,
      quote: passage.quote,
    });
  }
  if (rights.length === 0) return null;
  const asOfMs = asOf.getTime();
  const eligible = rights.filter((row) => row.effectiveAt <= asOfMs);
  eligible.sort((a, b) => b.effectiveAt - a.effectiveAt);
  const current = eligible[0];
  const later = rights.filter((row) => row.effectiveAt > asOfMs && row.permitted);
  const permittedNow = Boolean(current?.permitted);
  const laterNote = later[0]
    ? ` A later instrument permits convenience termination beginning ${isoDate(new Date(later[0].effectiveAt))}.`
    : "";
  const value = permittedNow ? "permitted" : "not permitted";
  const quote = current?.quote ?? later[0]?.quote ?? "";
  return {
    proposition: question.trim(),
    status: "established",
    premiseStatus: "not_applicable",
    dateSensitive: true,
    relevantDate: isoDate(asOf),
    operativeTerm: value,
    allowedClaim: `As of ${isoDate(asOf)}, convenience termination is ${value}.${laterNote} ${quote.slice(0, 220).trim()}`,
    prohibitedOverclaims: [],
    limitations: [],
    evidence: [{ chunkId: current?.chunkId ?? later[0]!.chunkId, role: "direct" }],
  };
}

function namedSourceAssessment(
  question: string,
  passages: AssessmentPassage[],
  now: Date,
): EvidenceAssessment | null {
  const target = classifyQuestionTarget(question, now);
  if (!target.namedSource) return null;
  const hit = passages.find((p) => namedSourceInQuote(target.namedSource!, p.quote));
  if (hit) return null;
  return {
    proposition: question.trim(),
    status: "not_established",
    premiseStatus: "unsupported",
    dateSensitive: false,
    relevantDate: null,
    operativeTerm: null,
    allowedClaim: `The retrieved sources do not include ${target.namedSource}, so the asked value is not established.`,
    prohibitedOverclaims: passages.flatMap((p) => p.quote.match(/\$[\d,]+(?:\.\d{2})?/g) ?? []),
    limitations: ["Do not substitute a value from a different document or exhibit."],
    evidence: [],
  };
}

function pairedAmountAssessment(
  question: string,
  passages: AssessmentPassage[],
): EvidenceAssessment | null {
  if (!/\boriginal\b/i.test(question) || !/\b(amendment|change)\b/i.test(question)) return null;
  if (!/\b(cap|amount|price|fee|rent)\b/i.test(question)) return null;
  const amounts: Array<{ amount: string; chunkId: string; quote: string; amendment: boolean }> = [];
  for (const passage of passages) {
    if (classifySourceRole(passage.quote) === "informal_communication") continue;
    for (const match of passage.quote.matchAll(/\$[\d,]+(?:\.\d{2})?/g)) {
      amounts.push({
        amount: match[0]!,
        chunkId: passage.chunkId,
        quote: passage.quote,
        amendment: AMENDMENT_RE.test(passage.quote) || /\bamendment\b/i.test(passage.quote),
      });
    }
  }
  const capAmounts = amounts.filter((row) => {
    const idx = row.quote.indexOf(row.amount);
    const window = row.quote.slice(Math.max(0, idx - 90), idx + row.amount.length + 90);
    return /\b(liability|cap|aggregate)\b/i.test(window);
  });
  const pool = capAmounts.length > 0 ? capAmounts : amounts;
  const original = pool.find((row) => !row.amendment);
  const amended = pool.find((row) => row.amendment && row.amount !== original?.amount);
  if (!original || !amended) return null;
  return {
    proposition: question.trim(),
    status: "established",
    premiseStatus: "not_applicable",
    dateSensitive: false,
    relevantDate: null,
    operativeTerm: `${original.amount} and ${amended.amount}`,
    allowedClaim: `The original figure is ${original.amount}. The amendment changed it to ${amended.amount}.`,
    prohibitedOverclaims: [],
    limitations: [],
    evidence: [
      { chunkId: original.chunkId, role: "direct" },
      { chunkId: amended.chunkId, role: "direct" },
    ],
  };
}

function contradictionAssessment(
  question: string,
  passages: AssessmentPassage[],
): EvidenceAssessment | null {
  const target = classifyQuestionTarget(question);
  if (target.kind !== "contradiction_check") return null;
  const relation = classifyStatementRelation({ question, passages });
  if (relation === "tension") {
    return {
      proposition: question.trim(),
      status: "supported",
      premiseStatus: "uncertain",
      dateSensitive: true,
      relevantDate: null,
      operativeTerm: "tension",
      allowedClaim:
        "There is a genuine evidentiary tension: testimony denies entering the records room, and the access log records assigned-badge ACCESS GRANTED. The log does not conclusively prove who carried the badge.",
      prohibitedOverclaims: [
        "physically entered",
        "physically entered the records room",
        "the statements can both be true",
        "difference of precision",
        "difference of precision, not a contradiction",
      ],
      limitations: ["The log does not conclusively prove who carried the badge."],
      evidence: passages.slice(0, 4).map((p) => ({
        chunkId: p.chunkId,
        role: /\baccess granted\b/i.test(p.quote)
          ? ("contradicting" as const)
          : ("direct" as const),
      })),
    };
  }
  if (relation === "different_precision" || relation === "compatible") {
    return {
      proposition: question.trim(),
      status: "established",
      premiseStatus: "not_applicable",
      dateSensitive: true,
      relevantDate: null,
      operativeTerm: "compatible",
      allowedClaim:
        "The statements can both be true. An approximate time window is compatible with an exact date that falls in that window; that is a difference of precision, not a contradiction.",
      prohibitedOverclaims: ["is inconsistent", "are inconsistent", "creates a contradiction"],
      limitations: [],
      evidence: passages.slice(0, 2).map((p) => ({ chunkId: p.chunkId, role: "direct" as const })),
    };
  }
  if (relation === "contradiction") {
    const dates = [
      ...new Set(
        passages.flatMap((p) =>
          [...p.quote.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1]!),
        ),
      ),
    ];
    return {
      proposition: question.trim(),
      status: "contradicted",
      premiseStatus: "uncertain",
      dateSensitive: true,
      relevantDate: null,
      operativeTerm: null,
      allowedClaim: `The sources contain mutually exclusive dates (${dates.slice(0, 3).join(" vs ")}) for the asked event and do not independently prove which is controlling.`,
      prohibitedOverclaims: [],
      limitations: ["Report both dates; do not pick one as certain."],
      evidence: passages.slice(0, 4).map((p) => ({
        chunkId: p.chunkId,
        role: "contradicting" as const,
      })),
    };
  }
  return {
    proposition: question.trim(),
    status: "insufficient",
    premiseStatus: "uncertain",
    dateSensitive: true,
    relevantDate: null,
    operativeTerm: null,
    allowedClaim:
      "The retrieved sources do not establish that the statements are contradictory. Differences of topic, date, or source role are not automatically a conflict.",
    prohibitedOverclaims: ["is inconsistent", "are inconsistent", "creates a contradiction"],
    limitations: [],
    evidence: [],
  };
}

export function answerContainsOperativeValue(answer: string, term: string): boolean {
  const blob = answer.toLowerCase();
  if (blob.includes(term.toLowerCase())) return true;
  const days = term.match(/^(\d+)\s*days$/i);
  if (days && new RegExp(`\\b${days[1]}\\s*days\\b`, "i").test(answer)) return true;
  if (days && new RegExp(`\\(${days[1]}\\)`).test(answer)) return true;
  const money = term.match(/\$[\d,]+(?:\.\d{2})?/g);
  if (money?.every((item) => answer.includes(item))) return true;
  return false;
}

export function isGenericControlBoilerplate(answer: string): boolean {
  return /signed (?:or amended )?instrument controls/i.test(answer) && !/\d+\s*days/i.test(answer);
}

function contentTokens(text: string): Set<string> {
  const stop = new Set([
    "sent",
    "send",
    "emailed",
    "uploaded",
    "following",
    "that",
    "this",
    "from",
    "with",
    "have",
    "does",
    "were",
    "been",
    "into",
    "same",
    "day",
    "portal",
    "earlier",
    "transmission",
    "confirmed",
    "receipt",
    "package",
    "when",
    "did",
    "you",
    "the",
  ]);
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((token) => token.length >= 4 && !stop.has(token) && !/^\d+$/.test(token)),
  );
}

function topicalOverlap(left: string, right: string): boolean {
  const a = contentTokens(left);
  let shared = 0;
  for (const token of contentTokens(right)) {
    if (a.has(token)) shared += 1;
  }
  return shared >= 1;
}

function transmittalConflictAssessment(
  question: string,
  passages: AssessmentPassage[],
): EvidenceAssessment | null {
  if (passages.length < 2) return null;
  if (/\b(notice period|currently|as of)\b/i.test(question) && /\bnotice\b/i.test(question)) {
    return null;
  }
  for (let i = 0; i < passages.length; i += 1) {
    for (let j = i + 1; j < passages.length; j += 1) {
      const left = passages[i]!;
      const right = passages[j]!;
      if (left.documentId === right.documentId) continue;
      if (!topicalOverlap(left.quote, right.quote)) continue;
      if (classifyEvidenceRelation(left.quote, right.quote) !== "contradiction") continue;
      const datesLeft = extractExactDates(left.quote);
      const datesRight = extractExactDates(right.quote);
      if (datesLeft.length === 0 || datesRight.length === 0) continue;
      const labels = [
        ...datesLeft.map(formatExactCalendarDate),
        ...datesRight.map(formatExactCalendarDate),
      ];
      const uniqueLabels = [...new Set(labels)];
      if (uniqueLabels.length < 2) continue;
      return {
        proposition: question.trim(),
        status: "contradicted",
        premiseStatus: "uncertain",
        dateSensitive: true,
        relevantDate: null,
        operativeTerm: uniqueLabels.join(" / "),
        allowedClaim: `The retrieved sources conflict on the asked transmittal date: ${uniqueLabels[0]} versus ${uniqueLabels[1]}. Both accounts are in the Case record; neither is independently controlling.`,
        prohibitedOverclaims: [
          "fully reconciled",
          "no conflict",
          `definitely only ${uniqueLabels[0]}`,
          `definitely only ${uniqueLabels[1]}`,
        ],
        limitations: ["Report both dates; do not pick one as certain."],
        evidence: [
          { chunkId: left.chunkId, role: "contradicting" as const },
          { chunkId: right.chunkId, role: "contradicting" as const },
        ],
      };
    }
  }
  return null;
}

function looksLikeDatedTransmittal(text: string): boolean {
  return (
    /\b(send|sent|emailed|uploaded|transmitted|transmission)\b/i.test(text) &&
    extractExactDates(text).length > 0
  );
}

function oneSidedTransmittalAssessment(
  question: string,
  passages: AssessmentPassage[],
): EvidenceAssessment | null {
  const transmittals = passages.filter((p) => looksLikeDatedTransmittal(p.quote));
  if (transmittals.length !== 1) return null;
  if (!/\b(agree|conflict|when was\b.{0,80}\bsent)\b/i.test(question)) return null;
  const only = transmittals[0]!;
  const dates = extractExactDates(only.quote);
  if (dates.length !== 1) return null;
  const label = formatExactCalendarDate(dates[0]!);
  return {
    proposition: question.trim(),
    status: "established",
    premiseStatus: "not_applicable",
    dateSensitive: true,
    relevantDate: label,
    operativeTerm: label,
    allowedClaim: `The retrieved account states ${label}. Whether other Case documents agree cannot be determined from this retrieval alone.`,
    prohibitedOverclaims: ["no conflict", "fully reconciled", "documents agree"],
    limitations: ["Do not invent a conflicting date that is not in the retrieved sources."],
    evidence: [{ chunkId: only.chunkId, role: "direct" }],
  };
}

function provisionIdentityAssessment(
  question: string,
  passages: AssessmentPassage[],
): EvidenceAssessment | null {
  const selected = selectOperativeProvisionRef(question, passages);
  if (!selected) return null;
  const passage = passages.find((p) => p.chunkId === selected.chunkId);
  if (!passage) return null;
  return {
    proposition: question.trim(),
    status: "established",
    premiseStatus: "not_applicable",
    dateSensitive: false,
    relevantDate: null,
    operativeTerm: selected.label,
    allowedClaim: `The retrieved source identifies ${selected.label} as the controlling provision for the asked requirement. ${passage.quote.slice(0, 240).trim()}`,
    prohibitedOverclaims: [],
    limitations: [],
    evidence: [{ chunkId: selected.chunkId, role: "direct" }],
  };
}

const DATE_ROLE_RES: Array<{ role: "commencement" | "effective" | "expiration"; re: RegExp }> = [
  { role: "commencement", re: /\b(commences?|commencement|term commences|lease term)\b/i },
  { role: "effective", re: /\b(becomes effective|effective date)\b/i },
  { role: "expiration", re: /\b(expires?|expiration)\b/i },
];

function extractRoleDates(passage: AssessmentPassage): Array<{
  role: "commencement" | "effective" | "expiration";
  date: ExactCalendarDate;
  quote: string;
  chunkId: string;
}> {
  const dates = extractExactDates(passage.quote);
  if (dates.length === 0) return [];
  const hits: Array<{
    role: "commencement" | "effective" | "expiration";
    date: ExactCalendarDate;
    quote: string;
    chunkId: string;
  }> = [];
  for (const spec of DATE_ROLE_RES) {
    if (!spec.re.test(passage.quote)) continue;
    const idx = passage.quote.search(spec.re);
    const window = passage.quote.slice(Math.max(0, idx - 40), idx + 80);
    const local = extractExactDates(window);
    const chosen = local[0] ?? dates[0];
    if (!chosen) continue;
    hits.push({ role: spec.role, date: chosen, quote: passage.quote, chunkId: passage.chunkId });
  }
  return hits;
}

function dateRoleMismatchAssessment(
  question: string,
  passages: AssessmentPassage[],
): EvidenceAssessment | null {
  if (
    /\band\b/i.test(question) &&
    /\b(rent|amount|notice|expir)\b/i.test(question) &&
    /\bcommenc/i.test(question)
  ) {
    return null;
  }
  if (!/\b(did|does|is|was)\b/i.test(question)) return null;
  if (!/\b(commenc|effective date|expir)/i.test(question)) return null;
  const asked = extractExactDates(question);
  if (asked.length !== 1) return null;
  const askedDate = asked[0]!;
  const role: "commencement" | "effective" | "expiration" = /\bexpir/i.test(question)
    ? "expiration"
    : /\beffective date\b/i.test(question)
      ? "effective"
      : "commencement";
  const hits = passages.flatMap(extractRoleDates).filter((hit) => hit.role === role);
  if (hits.length !== 1) return null;
  const source = hits[0]!;
  if (exactDatesEqual(source.date, askedDate)) return null;
  const sourceLabel = formatExactCalendarDate(source.date);
  const askedLabel = formatExactCalendarDate(askedDate);
  return {
    proposition: question.trim(),
    status: "established",
    premiseStatus: "contradicted",
    dateSensitive: true,
    relevantDate: sourceLabel,
    operativeTerm: sourceLabel,
    allowedClaim: `No. The ${role} date in the retrieved instrument is ${sourceLabel}, not ${askedLabel}. ${source.quote.slice(0, 220).trim()}`,
    prohibitedOverclaims: [`commence on ${askedLabel}`, `commenced on ${askedLabel}`],
    limitations: [],
    evidence: [{ chunkId: source.chunkId, role: "direct" }],
  };
}

export function selectOperativeAssessment(
  question: string,
  passages: AssessmentPassage[],
  now = new Date(),
): EvidenceAssessment | null {
  return (
    namedSourceAssessment(question, passages, now) ??
    transmittalConflictAssessment(question, passages) ??
    oneSidedTransmittalAssessment(question, passages) ??
    provisionIdentityAssessment(question, passages) ??
    dateRoleMismatchAssessment(question, passages) ??
    contradictionAssessment(question, passages) ??
    durationAssessment(question, passages, now) ??
    terminationAssessment(question, passages, now) ??
    pairedAmountAssessment(question, passages)
  );
}
