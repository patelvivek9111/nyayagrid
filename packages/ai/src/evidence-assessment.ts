import { z } from "zod";
import {
  extractExactDates,
  exactDatesEqual,
} from "./imprecise-date";
import { isAffirmativeForbiddenClaim } from "./claim-boundary";
import {
  answerContainsOperativeValue,
  extractNamedInstrument,
  isGenericControlBoilerplate,
  namedInstrumentFromQuestion,
  passagesMentionInstrument,
  selectOperativeAssessment,
} from "./operative-facts";

export type AssessmentPassage = {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  page?: number | null;
  segmentRef?: string | null;
  quote: string;
};

type AssessmentAI = {
  generate(request: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    schemaName?: string;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<{ text: string; model: string }>;
};

export const EVIDENCE_ASSESSMENT_PROMPT_VERSION = "evidence-assessment-v1";
export const EVIDENCE_ASSESSMENT_MARKER = "EvidenceAssessment:";
export const ASSESSMENT_TIMEOUT_MS = 8_000;

export const evidenceStatusSchema = z.enum([
  "established",
  "supported",
  "suggested",
  "contradicted",
  "not_established",
  "insufficient",
]);

export const premiseStatusSchema = z.enum([
  "valid",
  "unsupported",
  "contradicted",
  "uncertain",
  "not_applicable",
]);

export const evidenceRoleSchema = z.enum(["direct", "corroborating", "contradicting", "limiting"]);

export const evidenceAssessmentSchema = z.object({
  proposition: z.string().min(1).max(800),
  status: evidenceStatusSchema,
  premiseStatus: premiseStatusSchema.default("not_applicable"),
  dateSensitive: z.boolean().default(false),
  relevantDate: z.string().max(40).optional().nullable(),
  operativeTerm: z.string().max(400).optional().nullable(),
  allowedClaim: z.string().min(1).max(1200),
  prohibitedOverclaims: z.array(z.string().max(400)).default([]),
  limitations: z.array(z.string().max(400)).default([]),
  evidence: z
    .array(
      z.object({
        chunkId: z.string().min(1),
        role: evidenceRoleSchema,
      }),
    )
    .default([]),
});

export type EvidenceAssessment = z.infer<typeof evidenceAssessmentSchema>;
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;
export type PremiseStatus = z.infer<typeof premiseStatusSchema>;

export type QuestionRisk = {
  highRisk: boolean;
  categories: string[];
};

export type EvidenceAssessmentResult = {
  assessment: EvidenceAssessment | null;
  triggered: boolean;
  categories: string[];
  source: "skipped" | "deterministic" | "llm" | "hybrid" | "failed";
  model: string | null;
  latencyMs: number;
  failure: string | null;
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

const ACTIVITY_RECORD_RE =
  /\b(access granted|access denied|login successful|logged in|session (?:opened|created)|wire (?:sent|received|posted)|transfer (?:posted|completed|sent)|device event|credential (?:used|accepted|granted)|badge accepted|lobby-turnstile|lobby turnstile)\b/i;

export function classifyQuestionRisk(question: string): QuestionRisk {
  const q = question.toLowerCase();
  const categories: string[] = [];
  if (
    /\bwhy did\b|\bexplain why\b|\bwhat caused\b|\bhow did\b|\bwhat made\b/i.test(q) ||
    /^\s*(why|explain)\b/i.test(question.trim())
  ) {
    categories.push("causal_or_premise");
  }
  if (/\bphysically\b|\bpersonally\b|\bwho (?:entered|used|initiated|logged|operated)\b/i.test(q)) {
    categories.push("actor_identity");
  }
  if (
    /\b(currently|as of|will apply|on \d|effective|operative)\b/i.test(q) &&
    /\b(amend|notice|term|require|provision|agreement|contract|cap|payment)\b/i.test(q)
  ) {
    categories.push("temporal_contract");
  }
  if (/\b(outstanding|balance|remaining principal)\b/i.test(q)) {
    categories.push("as_of_value");
  }
  if (/\b(ever|never|always|no .+ (?:was|were|ever) )/.test(q)) {
    categories.push("universal_negative");
  }
  if (/\b(inconsistent|contradict|conflict with)\b/i.test(q)) {
    categories.push("contradiction");
  }
  if (/\bat exactly what time\b|\bwhen did .{3,80} (enter|pay|file|send|sign)\b/i.test(q)) {
    categories.push("exact_event");
  }
  if (
    /\b(email|recollect|said the contract|still says)\b/i.test(q) &&
    /\b(require|notice|term|agreement|contract)\b/i.test(q)
  ) {
    categories.push("source_role");
  }
  return { highRisk: categories.length > 0, categories };
}

function asksProveNonOccurrence(question: string): boolean {
  return (
    /\b(never received|did not receive|never got|never delivered)\b/i.test(question) &&
    /\b(prove|show that|establish that|confirm that)\b/i.test(question)
  );
}

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

export function extractQuestionAsOfDate(question: string, now = new Date()): Date | null {
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

function parseDayCount(raw: string): number | null {
  const digits = raw.match(/(\d+)/);
  if (digits) return Number(digits[1]);
  const key = raw.toLowerCase().replace(/\s+/g, " ").trim();
  return WORD_NUMBERS[key] ?? WORD_NUMBERS[key.replace(" ", "")] ?? null;
}

type DurationTerm = {
  days: number;
  label: string;
  effectiveAt: number;
  chunkId: string;
  quote: string;
};

function extractDurationTerms(passages: AssessmentPassage[], noticeOnly: boolean): DurationTerm[] {
  const terms: DurationTerm[] = [];
  const durationRe =
    /\b((?:ten|fifteen|twenty|thirty|forty(?:[-\s]five)?|sixty|ninety|\d+)\s*(?:\((\d+)\)\s*)?days)\b/gi;
  for (const passage of passages) {
    const quote = passage.quote;
    if (!/\bdays\b/i.test(quote)) continue;
    for (const match of quote.matchAll(durationRe)) {
      const days = parseDayCount(match[1] ?? "");
      if (days == null) continue;
      const idx = match.index ?? 0;
      const window = quote.slice(Math.max(0, idx - 120), idx + match[0].length + 80);
      const windowLower = window.toLowerCase();
      if (noticeOnly && !/\bnotice\b/i.test(windowLower) && !/\bnotice\b/i.test(quote)) continue;
      const localDated =
        parseIsoOrNamedDate(
          window.match(
            /\bbecomes effective(?: on)?\s+(\d{4}-\d{2}-\d{2}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})/i,
          )?.[1] ?? "",
        ) ??
        parseIsoOrNamedDate(
          window.match(
            /\beffective(?: on)?\s+(\d{4}-\d{2}-\d{2}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})/i,
          )?.[1] ?? "",
        );
      const localImmediate = /\beffective immediately\b/i.test(window);
      const futureBound = /\bthereafter\b|\bbecomes effective\b/.test(windowLower);
      let effectiveAt = Number.NEGATIVE_INFINITY;
      if (localDated && (futureBound || /\beffective\b/i.test(window))) {
        effectiveAt = localDated.getTime();
      } else if (localImmediate) {
        effectiveAt = 0;
      }
      terms.push({
        days,
        label: `${days} days`,
        effectiveAt,
        chunkId: passage.chunkId,
        quote: passage.quote,
      });
    }
  }
  return terms;
}

function asksOperativeDuration(question: string): boolean {
  if (/\bshould\b.{0,60}\b(treat|requirement|controlling)\b/i.test(question)) return false;
  if (
    /\b(email says|recollect|still says)\b/i.test(question) &&
    !/\bnotice period\b/i.test(question)
  ) {
    return false;
  }
  return (
    /\bnotice period\b/i.test(question) ||
    (/\bnotice\b/i.test(question) && /\b(currently|as of|will apply|operative)\b/i.test(question))
  );
}

export function resolveOperativeDuration(params: {
  question: string;
  passages: AssessmentPassage[];
  now?: Date;
}): { term: DurationTerm; asOf: Date; laterTerms: DurationTerm[] } | null {
  if (!asksOperativeDuration(params.question)) return null;
  const asOf = extractQuestionAsOfDate(params.question, params.now);
  if (!asOf) return null;
  const noticeOnly = /\bnotice\b/i.test(params.question);
  const terms = extractDurationTerms(params.passages, noticeOnly);
  if (terms.length === 0) return null;
  const asOfMs = asOf.getTime();
  const eligible = terms.filter((term) => term.effectiveAt <= asOfMs);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => b.effectiveAt - a.effectiveAt || b.days - a.days);
  const laterTerms = terms.filter((term) => term.effectiveAt > asOfMs);
  return { term: eligible[0]!, asOf, laterTerms };
}

function activityPassages(passages: AssessmentPassage[]): AssessmentPassage[] {
  return passages.filter((p) => ACTIVITY_RECORD_RE.test(p.quote));
}

function asksPersonalAct(question: string): boolean {
  return /\bphysically\b|\bpersonally\b|\bwho (?:entered|used|initiated|logged|operated)\b/i.test(
    question,
  );
}

function hasActorCorroboration(
  passages: AssessmentPassage[],
  activity: AssessmentPassage[],
): boolean {
  const activityIds = new Set(activity.map((p) => p.chunkId));
  return passages.some((p) => {
    if (activityIds.has(p.chunkId)) return false;
    return /\b(video|camera|eyewitness|was seen|personally (?:used|entered|initiated)|used the (?:badge|credential|card))\b/i.test(
      p.quote,
    );
  });
}

function isUniversalNegativeQuestion(question: string): boolean {
  return /\b(ever|never)\b/i.test(question);
}

function asksWhetherEventOccurred(question: string): boolean {
  if (isUniversalNegativeQuestion(question)) return true;
  if (
    /\bactually\b/i.test(question) &&
    /\b(issue|pay|paid|issued|provided|credit)\b/i.test(question)
  ) {
    return true;
  }
  if (
    /\bdid\b.{0,80}\b(issue or pay|issue|pay)\b/i.test(question) &&
    !/\b(invoice|document|record)\s+(show|reflect|include)\b/i.test(question)
  ) {
    return true;
  }
  return false;
}

function isDocumentLocalAbsence(quote: string): boolean {
  return (
    /\b(this (invoice|document|record|statement)|the invoice)\b/i.test(quote) &&
    /\b(does not (reflect|show|include|contain)|no .{0,40} (reflected|shown|included))\b/i.test(
      quote,
    )
  );
}

function isUnstatedCurrentValueQuestion(
  question: string,
  passages: AssessmentPassage[],
): AssessmentPassage | null {
  if (!/\b(outstanding|balance|remaining (principal|amount|balance))\b/i.test(question)) {
    return null;
  }
  return (
    passages.find((p) =>
      /\bno change to (the )?original\b|\bdoes not (change|modify|alter) (the )?original\b|\boriginal .{0,40}unchanged\b/i.test(
        p.quote,
      ),
    ) ?? null
  );
}

function extractPremiseDate(question: string): Date | null {
  return parseIsoOrNamedDate(question);
}

function sourceEffectiveDates(
  passages: AssessmentPassage[],
): Array<{ date: Date; chunkId: string; quote: string }> {
  const out: Array<{ date: Date; chunkId: string; quote: string }> = [];
  for (const passage of passages) {
    const match = passage.quote.match(
      /\bbecomes effective(?: on)?\s+(\d{4}-\d{2}-\d{2}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})/i,
    );
    if (!match?.[1]) continue;
    const date = parseIsoOrNamedDate(match[1]);
    if (date) out.push({ date, chunkId: passage.chunkId, quote: passage.quote });
  }
  return out;
}

function isCausalQuestion(question: string): boolean {
  return /\bwhy did\b|\bexplain why\b|\bwhat caused\b|\bwhat made\b/i.test(question);
}

function asksFraudIntentPremise(question: string): boolean {
  return /\b(intentionally defraud|committed fraud|admitted fraud|intent(?:ionally)? to defraud)\b/i.test(
    question,
  );
}

function sourcesAffirmFraudIntent(passages: AssessmentPassage[]): boolean {
  return passages.some((p) => {
    if (isAffirmativeForbiddenClaim(p.quote, "intentionally defraud")) return true;
    if (isAffirmativeForbiddenClaim(p.quote, "committed fraud")) return true;
    if (isAffirmativeForbiddenClaim(p.quote, "admitted fraud")) return true;
    return /\b(confessed to fraud|pleaded guilty to fraud|intent to defraud)\b/i.test(p.quote);
  });
}

function asksCourtAssignmentIdentity(question: string): boolean {
  return (
    /\b(which judge|what judge|assigned judge|presiding judge|name of the judge)\b/i.test(
      question,
    ) ||
    /\b(docket number|case number|civil action number|index number)\b/i.test(question) ||
    /\bassigned to this (?:case|matter)\b/i.test(question)
  );
}

function passagesIdentifyCourtAssignment(passages: AssessmentPassage[]): boolean {
  return passages.some((passage) =>
    /\b(?:hon(?:orable|\.)\s+[A-Z]|judge\s+[A-Z][a-z]+|presiding judge|docket\s*(?:no\.?|number|#)|case no\.|civil action no\.|index no\.)\b/i.test(
      passage.quote,
    ),
  );
}

function missingCourtIdentityAssessment(
  question: string,
  passages: AssessmentPassage[],
): EvidenceAssessment | null {
  if (!asksCourtAssignmentIdentity(question)) return null;
  if (passagesIdentifyCourtAssignment(passages)) return null;
  return {
    proposition: question.trim(),
    status: "insufficient",
    premiseStatus: "unsupported",
    dateSensitive: false,
    relevantDate: null,
    operativeTerm: null,
    allowedClaim:
      "The retrieved sources do not identify an assigned judicial officer or a case filing number.",
    prohibitedOverclaims: ["Hon.", "Honorable"],
    limitations: [
      "Do not supply a judicial officer, court assignment, or filing number from model memory.",
    ],
    evidence: [],
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function extractSingleAmountFact(
  question: string,
  passages: AssessmentPassage[],
): EvidenceAssessment | null {
  if (extractNamedInstrument(question)) return null;
  if (/\band\b/i.test(question) || /\bwhen\b/i.test(question)) return null;
  if (!/\b(price|amount|payment|rent|fee|cap|consideration)\b/i.test(question)) return null;
  const moneyPassages = passages.filter((p) => /\$[\d,]+|\d[\d,]*\s+dollars/i.test(p.quote));
  if (moneyPassages.length !== 1) return null;
  const passage = moneyPassages[0]!;
  const amount =
    passage.quote.match(/\$[\d,]+(?:\.\d{2})?/)?.[0] ??
    passage.quote.match(/[\d,]+\s+dollars/i)?.[0];
  if (!amount) return null;
  return {
    proposition: question.trim(),
    status: "established",
    premiseStatus: "not_applicable",
    dateSensitive: false,
    relevantDate: null,
    operativeTerm: amount,
    allowedClaim: `The source states ${amount}.`,
    prohibitedOverclaims: [],
    limitations: [],
    evidence: [{ chunkId: passage.chunkId, role: "direct" }],
  };
}

export function assessRetrievedEvidenceDeterministic(
  question: string,
  passages: AssessmentPassage[],
  now = new Date(),
): EvidenceAssessment | null {
  const activity = activityPassages(passages);

  if (/\b(admitted liability|admission of liability|silence.{0,40}admission)\b/i.test(question)) {
    const silence = passages.find((p) =>
      /silence.{0,80}not an admission|no admission of liability|absence of a denial is not proof/i.test(
        p.quote,
      ),
    );
    if (silence) {
      return {
        proposition: question.trim(),
        status: "insufficient",
        premiseStatus: "unsupported",
        dateSensitive: false,
        relevantDate: null,
        operativeTerm: null,
        allowedClaim:
          "I cannot establish an admission of liability from the available record. Silence or a missing denial is not an admission.",
        prohibitedOverclaims: ["admitted liability", "admission of liability", "silence is an admission"],
        limitations: ["Absence of a denial is not proof unless a source states that inference."],
        evidence: [{ chunkId: silence.chunkId, role: "limiting" }],
      };
    }
  }

  if (asksProveNonOccurrence(question)) {
    const affirmsAbsence = passages.some((p) => {
      if (isAffirmativeForbiddenClaim(p.quote, "never received")) return true;
      if (isAffirmativeForbiddenClaim(p.quote, "did not receive")) return true;
      return /\b(was not (?:received|delivered)|denied receipt)\b/i.test(p.quote);
    });
    const affirmsReceipt = passages.some(
      (p) =>
        !isAffirmativeForbiddenClaim(p.quote, "never received") &&
        !isAffirmativeForbiddenClaim(p.quote, "did not receive") &&
        /\b(received invoice|invoice was received|was received|acknowledged receipt|confirmed receipt)\b/i.test(
          p.quote,
        ),
    );
    if (affirmsAbsence && affirmsReceipt) {
      return {
        proposition: question.trim(),
        status: "contradicted",
        premiseStatus: "contradicted",
        dateSensitive: false,
        relevantDate: null,
        operativeTerm: null,
        allowedClaim:
          "The available record contains conflicting receipt evidence and does not establish non-receipt.",
        prohibitedOverclaims: ["never received", "did not receive", "proves non-receipt"],
        limitations: ["Do not resolve conflicting receipt statements by treating one side as proven."],
        evidence: passages.map((p) => ({ chunkId: p.chunkId, role: "limiting" as const })),
      };
    }
    if (!affirmsAbsence) {
      return {
        proposition: question.trim(),
        status: "insufficient",
        premiseStatus: "unsupported",
        dateSensitive: false,
        relevantDate: null,
        operativeTerm: null,
        allowedClaim:
          "The available record does not establish non-receipt. Absence of proof of receipt is not proof that the recipient never received the instrument.",
        prohibitedOverclaims: ["never received", "did not receive", "proves non-receipt"],
        limitations: ["Do not convert silence or missing delivery proof into proof of non-occurrence."],
        evidence: [],
      };
    }
  }

  if (
    asksPersonalAct(question) &&
    activity.length > 0 &&
    !hasActorCorroboration(passages, activity)
  ) {
    const record = activity[0]!;
    const activityKind = /access granted/i.test(record.quote)
      ? "ACCESS GRANTED"
      : "logged system or credential activity";
    return {
      proposition: question.trim(),
      status: "not_established",
      premiseStatus: "unsupported",
      dateSensitive: false,
      relevantDate: null,
      operativeTerm: null,
      allowedClaim: `The retrieved record shows ${activityKind}. It does not independently prove who performed the physical act.`,
      prohibitedOverclaims: [
        "physically entered",
        "personally entered",
        "personally used",
        "personally initiated",
      ],
      limitations: [
        "A system or activity record establishes the logged event. It does not, by itself, establish who physically acted.",
      ],
      evidence: activity.map((p) => ({ chunkId: p.chunkId, role: "limiting" as const })),
    };
  }

  if (
    asksPersonalAct(question) &&
    activity.length > 0 &&
    hasActorCorroboration(passages, activity)
  ) {
    const extra = passages.filter((p) => !activity.some((a) => a.chunkId === p.chunkId));
    return {
      proposition: question.trim(),
      status: "supported",
      premiseStatus: "valid",
      dateSensitive: false,
      relevantDate: null,
      operativeTerm: null,
      allowedClaim:
        `Independent evidence corroborates that the named person used the credential or performed the recorded act. ${extra[0]?.quote.slice(0, 220) ?? ""}`.trim(),
      prohibitedOverclaims: [],
      limitations: [],
      evidence: [
        ...activity.map((p) => ({ chunkId: p.chunkId, role: "direct" as const })),
        ...extra.slice(0, 2).map((p) => ({ chunkId: p.chunkId, role: "corroborating" as const })),
      ],
    };
  }

  if (isCausalQuestion(question) && asksFraudIntentPremise(question) && !sourcesAffirmFraudIntent(passages)) {
    const nearby = passages.find((p) =>
      /\b(invoice|received \d+ days|payment plan|does not state motive|does not state .{0,20}fraud)\b/i.test(
        p.quote,
      ),
    );
    return {
      proposition: question.trim(),
      status: "insufficient",
      premiseStatus: "unsupported",
      dateSensitive: false,
      relevantDate: null,
      operativeTerm: null,
      allowedClaim:
        "The available record does not establish that the named party intentionally defrauded anyone regarding the invoice. Nearby facts such as a late invoice or a payment-plan request are not proof of fraudulent intent. Do not invent a motive for an unsupported fraud premise.",
      prohibitedOverclaims: ["intentionally defraud", "committed fraud", "admitted fraud"],
      limitations: [
        "A late invoice or a request for a payment plan is not evidence of fraudulent intent.",
      ],
      evidence: nearby ? [{ chunkId: nearby.chunkId, role: "limiting" }] : [],
    };
  }

  if (isCausalQuestion(question)) {
    const claimed = extractPremiseDate(question);
    const effectives = sourceEffectiveDates(passages);
    const sourceSaysRetroactive = passages.some((p) =>
      /\b(retroactive|nunc pro tunc|backdated)\b/i.test(p.quote),
    );
    const later = claimed
      ? effectives.find((row) => row.date.getTime() - claimed.getTime() > 24 * 60 * 60 * 1000)
      : effectives[0];
    if (
      later &&
      !sourceSaysRetroactive &&
      (claimed || /\b(retroactive|nunc pro tunc|backdated)\b/i.test(question))
    ) {
      return {
        proposition: question.trim(),
        status: "not_established",
        premiseStatus: "contradicted",
        dateSensitive: true,
        relevantDate: isoDate(later.date),
        operativeTerm: null,
        allowedClaim: `The supplied documents do not support that premise. The instrument is not retroactive. ${later.quote.slice(0, 180).trim()} The parties did not agree to retroactive effect.`,
        prohibitedOverclaims: [
          "the parties made it retroactive",
          "agreed that it would be retroactive",
          "retroactive to align",
        ],
        limitations: ["Do not invent motives for an unsupported premise."],
        evidence: [{ chunkId: later.chunkId, role: "contradicting" }],
      };
    }
  }

  const missingCourtIdentity = missingCourtIdentityAssessment(question, passages);
  if (missingCourtIdentity) return missingCourtIdentity;

  const operative = selectOperativeAssessment(question, passages, now);
  if (operative) return operative;

  if (asksWhetherEventOccurred(question)) {
    const local = passages.find((p) => isDocumentLocalAbsence(p.quote));
    if (local) {
      return {
        proposition: question.trim(),
        status: "not_established",
        premiseStatus: "unsupported",
        dateSensitive: false,
        relevantDate: null,
        operativeTerm: null,
        allowedClaim: `${local.quote.slice(0, 220).trim()} Absence from this document does not prove the asked event occurred, was issued, or was paid.`,
        prohibitedOverclaims: [
          "never issued",
          "never provided",
          "was never",
          "no credit was ever",
          "did not issue or pay",
          "did not issue",
          "confirms that no",
        ],
        limitations: [
          "Silence in one record is not proof of a universal or actual-occurrence proposition.",
        ],
        evidence: [{ chunkId: local.chunkId, role: "limiting" }],
      };
    }
  }

  const unstated = isUnstatedCurrentValueQuestion(question, passages);
  if (unstated) {
    return {
      proposition: question.trim(),
      status: "not_established",
      premiseStatus: "unsupported",
      dateSensitive: true,
      relevantDate: null,
      operativeTerm: null,
      allowedClaim:
        "The documents say the original amount was not amended. They do not state the outstanding balance on the asked date.",
      prohibitedOverclaims: [
        "remains unchanged from the original",
        "remains at the original principal",
      ],
      limitations: [
        "A statement that an original figure was not amended is not the current outstanding amount.",
      ],
      evidence: [{ chunkId: unstated.chunkId, role: "limiting" }],
    };
  }

  const amountFact = extractSingleAmountFact(question, passages);
  if (amountFact) return amountFact;

  const missingInstrument = namedInstrumentFromQuestion(question);
  if (missingInstrument && !passagesMentionInstrument(missingInstrument, passages)) {
    return {
      proposition: question.trim(),
      status: "insufficient",
      premiseStatus: "unsupported",
      dateSensitive: false,
      relevantDate: null,
      operativeTerm: null,
      allowedClaim: `The retrieved documents do not include the ${missingInstrument} needed to determine that. What that instrument would show is not established without it.`,
      prohibitedOverclaims: [],
      limitations: [
        "Do not infer the missing instrument from a different document that happens to be retrieved.",
      ],
      evidence: [],
    };
  }

  const approx = passages.find((p) =>
    /\b(approximately|on or about|near the middle|about)\b/i.test(p.quote),
  );
  if (approx && /\bwhen did\b|\bwhat date\b/i.test(question)) {
    return {
      proposition: question.trim(),
      status: "supported",
      premiseStatus: "not_applicable",
      dateSensitive: true,
      relevantDate: null,
      operativeTerm: null,
      allowedClaim: approx.quote.slice(0, 280),
      prohibitedOverclaims: ["exactly"],
      limitations: ["Keep the source's qualifying language; do not convert it into an exact date."],
      evidence: [{ chunkId: approx.chunkId, role: "direct" }],
    };
  }

  return null;
}

export {
  classifyQuestionTarget,
  classifySourceRole,
  classifyStatementRelation,
  selectOperativeAssessment,
  answerContainsOperativeValue,
  namedInstrumentFromQuestion,
  instrumentMentionedInText,
  instrumentMentionIsDenial,
} from "./operative-facts";

export function formatEvidenceAssessmentForPrompt(assessment: EvidenceAssessment): string {
  const supporting = assessment.evidence
    .filter((item) => item.role === "direct" || item.role === "corroborating")
    .map((item) => item.chunkId);
  const challenging = assessment.evidence
    .filter((item) => item.role === "contradicting" || item.role === "limiting")
    .map((item) => item.chunkId);
  const conflictType =
    assessment.status === "contradicted"
      ? "transmittal_or_fact_conflict"
      : assessment.operativeTerm === "tension"
        ? "evidentiary_tension"
        : null;
  const conflictStatus =
    assessment.status === "contradicted"
      ? "disputed"
      : assessment.operativeTerm === "tension"
        ? "tension"
        : null;
  return [
    EVIDENCE_ASSESSMENT_MARKER,
    `proposition=${assessment.proposition}`,
    `status=${assessment.status}`,
    `premiseStatus=${assessment.premiseStatus}`,
    `dateSensitive=${assessment.dateSensitive}`,
    assessment.relevantDate ? `relevantDate=${assessment.relevantDate}` : null,
    assessment.operativeTerm ? `operativeTerm=${assessment.operativeTerm}` : null,
    conflictStatus ? `conflictStatus=${conflictStatus}` : null,
    conflictType ? `conflictType=${conflictType}` : null,
    supporting.length ? `supportingSourceIds=${supporting.join(",")}` : null,
    challenging.length ? `challengingSourceIds=${challenging.join(",")}` : null,
    assessment.operativeTerm === "tension" ? `evidenceRelation=tension` : null,
    `allowedClaim=${assessment.allowedClaim}`,
    assessment.prohibitedOverclaims.length
      ? `prohibitedOverclaims=${assessment.prohibitedOverclaims.join(" | ")}`
      : null,
    assessment.limitations.length ? `limitations=${assessment.limitations.join(" | ")}` : null,
    assessment.evidence.length
      ? `evidence=${assessment.evidence.map((e) => `${e.chunkId}:${e.role}`).join(", ")}`
      : null,
    "These constraints are binding. Do not exceed allowedClaim. Do not assert prohibitedOverclaims. If premiseStatus is unsupported or contradicted, correct the premise and do not invent motives. If operativeTerm is set, state that value explicitly in the answer for the asked date — including a future date after an amendment's effective date. Do not replace a requested number, date, or amount with a generic statement that a signed instrument controls. If status is established or supported, answer; do not refuse. If status is not_established or insufficient, do not assert a positive determination. If status is contradicted or conflictStatus is disputed, report each supporting and challenging source; do not silently pick one.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildEvidenceAssessmentSystemPrompt(): string {
  return [
    "You classify how retrieved Sources relate to the asked proposition.",
    "Do not write the user-facing legal answer. Do not invent facts.",
    "A system activity record establishes the logged event, not a person's physical act, unless another Source connects the actor.",
    "Absence from one document is not proof the event never occurred.",
    "If an amendment becomes effective on a date, it is operative on and after that date even if it is not operative today.",
    "If the question's premise conflicts with Sources, set premiseStatus to contradicted.",
    "Return JSON only matching {proposition,status,premiseStatus,dateSensitive,relevantDate,operativeTerm,allowedClaim,prohibitedOverclaims,limitations,evidence}.",
  ].join(" ");
}

export function parseEvidenceAssessmentFromPrompt(user: string): EvidenceAssessment | null {
  if (!user.includes(EVIDENCE_ASSESSMENT_MARKER)) return null;
  const block = user.slice(user.indexOf(EVIDENCE_ASSESSMENT_MARKER));
  const line = (key: string) =>
    block.match(new RegExp(`(?:^|\\n)${key}=(.*)$`, "m"))?.[1]?.trim() ?? "";
  const status = evidenceStatusSchema.safeParse(line("status"));
  if (!status.success) return null;
  const premise = premiseStatusSchema.safeParse(line("premiseStatus") || "not_applicable");
  const evidence = line("evidence")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const [chunkId, roleRaw] = part.split(":");
      const role = evidenceRoleSchema.safeParse(roleRaw);
      if (!chunkId || !role.success) return [];
      return [{ chunkId, role: role.data }];
    });
  return {
    proposition: line("proposition") || "question",
    status: status.data,
    premiseStatus: premise.success ? premise.data : "not_applicable",
    dateSensitive: line("dateSensitive") === "true",
    relevantDate: line("relevantDate") || null,
    operativeTerm: line("operativeTerm") || null,
    allowedClaim: line("allowedClaim") || "The sources do not establish the asked claim.",
    prohibitedOverclaims: line("prohibitedOverclaims")
      ? line("prohibitedOverclaims")
          .split("|")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
    limitations: line("limitations")
      ? line("limitations")
          .split("|")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
    evidence,
  };
}

export function buildEvidenceAssessmentUserPrompt(
  question: string,
  passages: AssessmentPassage[],
): string {
  return [
    `Question: ${question}`,
    "Sources:",
    ...passages.map((p) => `- chunkId=${p.chunkId} | quote=|${p.quote}|`),
  ].join("\n");
}

export function parseEvidenceAssessment(raw: unknown): EvidenceAssessment | null {
  const parsed = evidenceAssessmentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function mergeAssessments(
  deterministic: EvidenceAssessment | null,
  llm: EvidenceAssessment | null,
): EvidenceAssessment | null {
  if (deterministic && llm) {
    return {
      ...llm,
      status:
        deterministic.status === "established" || deterministic.status === "not_established"
          ? deterministic.status
          : llm.status,
      premiseStatus:
        deterministic.premiseStatus !== "not_applicable"
          ? deterministic.premiseStatus
          : llm.premiseStatus,
      operativeTerm: deterministic.operativeTerm ?? llm.operativeTerm,
      allowedClaim: deterministic.allowedClaim || llm.allowedClaim,
      prohibitedOverclaims: [
        ...new Set([...deterministic.prohibitedOverclaims, ...llm.prohibitedOverclaims]),
      ],
      limitations: [...new Set([...deterministic.limitations, ...llm.limitations])],
      dateSensitive: deterministic.dateSensitive || llm.dateSensitive,
      relevantDate: deterministic.relevantDate ?? llm.relevantDate,
    };
  }
  return deterministic ?? llm;
}

export async function assessRetrievedEvidence(params: {
  question: string;
  passages: AssessmentPassage[];
  ai?: AssessmentAI;
  now?: Date;
  signal?: AbortSignal;
}): Promise<EvidenceAssessmentResult> {
  const started = Date.now();
  const risk = classifyQuestionRisk(params.question);
  const deterministic = assessRetrievedEvidenceDeterministic(
    params.question,
    params.passages,
    params.now,
  );

  const resolvedByDeterministic =
    Boolean(deterministic?.operativeTerm) ||
    deterministic?.premiseStatus === "contradicted" ||
    deterministic?.premiseStatus === "unsupported" ||
    (deterministic?.prohibitedOverclaims.length ?? 0) > 0 ||
    deterministic?.status === "established";

  if (!risk.highRisk && !deterministic) {
    return {
      assessment: null,
      triggered: false,
      categories: risk.categories,
      source: "skipped",
      model: null,
      latencyMs: Date.now() - started,
      failure: null,
    };
  }

  if (resolvedByDeterministic || !params.ai || !risk.highRisk) {
    return {
      assessment: deterministic,
      triggered: Boolean(deterministic),
      categories: risk.categories,
      source: deterministic ? "deterministic" : "skipped",
      model: null,
      latencyMs: Date.now() - started,
      failure: null,
    };
  }

  try {
    const generation = await params.ai.generate({
      temperature: 0,
      schemaName: "evidence_assessment",
      signal: params.signal,
      messages: [
        { role: "system", content: buildEvidenceAssessmentSystemPrompt() },
        {
          role: "user",
          content: buildEvidenceAssessmentUserPrompt(params.question, params.passages),
        },
      ],
    });
    let raw: unknown;
    try {
      raw = JSON.parse(generation.text);
    } catch {
      raw = null;
    }
    const llm = raw ? parseEvidenceAssessment(raw) : null;
    if (!llm) {
      return {
        assessment: deterministic,
        triggered: true,
        categories: risk.categories,
        source: deterministic ? "deterministic" : "failed",
        model: generation.model,
        latencyMs: Date.now() - started,
        failure: "assessment_parse_failed",
      };
    }
    return {
      assessment: mergeAssessments(deterministic, llm),
      triggered: true,
      categories: risk.categories,
      source: deterministic ? "hybrid" : "llm",
      model: generation.model,
      latencyMs: Date.now() - started,
      failure: null,
    };
  } catch (error) {
    return {
      assessment: deterministic,
      triggered: true,
      categories: risk.categories,
      source: deterministic ? "deterministic" : "failed",
      model: null,
      latencyMs: Date.now() - started,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

type ConstrainedAnswer = {
  answer: string;
  evidenceState: "grounded" | "partial" | "insufficient";
  sources: Array<{
    chunkId?: string;
    documentId: string;
    documentVersionId: string;
    page?: number;
    paragraph?: string;
    quote: string;
  }>;
};

export function constrainCitedAnswer<T extends ConstrainedAnswer>(
  answer: T,
  assessment: EvidenceAssessment,
  passages: AssessmentPassage[],
): T {
  const overclaimHit = assessment.prohibitedOverclaims.find((phrase) =>
    isAffirmativeForbiddenClaim(answer.answer, phrase),
  );
  const premiseForced = assessment.premiseStatus === "contradicted";
  const premiseBroken =
    premiseForced ||
    (assessment.premiseStatus === "unsupported" &&
      !/\b(do not support|does not support|not established|do not establish|does not establish|premise)\b/i.test(
        answer.answer,
      ));
  const falseRefuse =
    (assessment.status === "established" ||
      assessment.status === "supported" ||
      assessment.status === "contradicted") &&
    (/do not provide sufficient evidence/i.test(answer.answer) ||
      answer.evidenceState === "insufficient" ||
      answer.evidenceState === "partial" ||
      isGenericControlBoilerplate(answer.answer)) &&
    Boolean(assessment.operativeTerm || assessment.allowedClaim);
  const missingOperative =
    Boolean(assessment.operativeTerm) &&
    (assessment.status === "established" || assessment.status === "supported") &&
    !answerContainsOperativeValue(answer.answer, assessment.operativeTerm ?? "");
  const abstentionViolation =
    (assessment.status === "not_established" || assessment.status === "insufficient") &&
    (answer.evidenceState === "grounded" || /\$[\d,]+/.test(answer.answer)) &&
    !/\b(do not|does not|not established|not include|not among)\b/i.test(answer.answer);

  const unsourcedDate = extractExactDates(answer.answer).some(
    (date) =>
      !passages.some((passage) =>
        extractExactDates(passage.quote).some((sourceDate) => exactDatesEqual(sourceDate, date)),
      ),
  );
  const shouldRewrite =
    Boolean(overclaimHit) ||
    premiseBroken ||
    falseRefuse ||
    abstentionViolation ||
    missingOperative ||
    (unsourcedDate &&
      (assessment.status === "established" || assessment.status === "supported"));

  const chunkIds = assessment.evidence.map((item) => item.chunkId);
  const citedFromAssessment = (chunkIds.length ? chunkIds : [])
    .map((id) => passages.find((p) => p.chunkId === id))
    .filter((p): p is AssessmentPassage => Boolean(p))
    .slice(0, 3)
    .map((p) => ({
      chunkId: p.chunkId,
      documentId: p.documentId,
      documentVersionId: p.documentVersionId,
      page: p.page ?? undefined,
      paragraph: p.segmentRef ?? undefined,
      quote: p.quote.slice(0, 400),
    }));
  const mergedSources = citedFromAssessment.length > 0 ? citedFromAssessment : answer.sources;

  if (assessment.status === "not_established" || assessment.status === "insufficient") {
    if (shouldRewrite || answer.evidenceState === "grounded" || answer.evidenceState === "partial") {
      const abstaining = /\b(not established|do not include|does not include|not among)\b/i.test(
        assessment.allowedClaim,
      );
      return {
        ...answer,
        answer: [assessment.allowedClaim, ...assessment.limitations].filter(Boolean).join(" "),
        evidenceState: abstaining || assessment.status === "insufficient" ? "insufficient" : "partial",
        sources: citedFromAssessment,
      };
    }
    return answer;
  }

  if (assessment.status === "contradicted") {
    const requiredDates = extractExactDates(assessment.allowedClaim);
    const answerDates = extractExactDates(answer.answer);
    const missingConflictDate = requiredDates.some(
      (needed) => !answerDates.some((have) => exactDatesEqual(have, needed)),
    );
    const pickedOne =
      requiredDates.length >= 2 &&
      /\b(no conflict|fully reconciled|definitely only)\b/i.test(answer.answer);
    if (
      shouldRewrite ||
      missingConflictDate ||
      pickedOne ||
      answer.evidenceState !== "grounded"
    ) {
      return {
        ...answer,
        answer: [assessment.allowedClaim, ...assessment.limitations].filter(Boolean).join(" "),
        evidenceState: "grounded",
        sources: mergedSources.length > 0 ? mergedSources : answer.sources,
      };
    }
  }

  if (!shouldRewrite) {
    if (citedFromAssessment.length > 0) {
      const have = new Set(answer.sources.map((source) => source.documentId));
      const extra = citedFromAssessment.filter((source) => !have.has(source.documentId));
    if (extra.length > 0) {
      return { ...answer, sources: [...answer.sources, ...extra] };
    }
    }
    return answer;
  }

  const grounded =
    assessment.status === "established" ||
    assessment.status === "supported" ||
    assessment.status === "contradicted"
      ? "grounded"
      : "partial";

  return {
    ...answer,
    answer: [assessment.allowedClaim, ...assessment.limitations].filter(Boolean).join(" "),
    evidenceState: grounded,
    sources: mergedSources.length > 0 ? mergedSources : answer.sources,
  };
}
