/**
 * Phase 6V unseen professional-quality catalog.
 * Hidden tokens are for grading only — not production context and not prior 6U/C2A needles.
 */
export const T6V_AS_OF = "2026-08-26";

export const UCC_QUESTION =
  "Under the governing law recorded for this Case, within what period must an action for breach of a contract for the sale of goods be commenced?";

export const EMPLOYMENT_QUESTION =
  "Under the law recorded for this Case, does the imported wage statute require employers to pay at least the statutory minimum wage?";

export const CRIMINAL_QUESTION =
  "What is the complete Pennsylvania criminal-law framework for burglary sentencing, including every mandatory minimum Nyaya has certified?";

export const NATIONWIDE_RE =
  /in all (fifty|50) states|nationwide (rule|support|coverage)|all pennsylvania contract law/i;

export const FLATTEN_RE =
  /all (three|3) states (are|apply) equally|forum and governing law are the same/i;

export const CURRENT_LAW_OVERCLAIM =
  /\b(definitely the current law|currently effective|no temporal uncertainty|this is (definitely )?the current law)\b/i;

export const ABSTAIN_RE =
  /\b(does not (contain|include|cover)|do not (contain|include|cover)|do not provide sufficient|not (in|within) (the )?(corpus|imported)|insufficient|cannot (answer|determine|confirm)|no (imported|retrieved) (authority|statute)|unvalidated|not enough|beyond the (excerpt|imported)|coverage not yet validated|limited authority coverage|missing|not attached|no exhibit|not available)\b/i;

export const CERTIFIED_RE =
  /\bcertified by (court|the bar|nyaya)|verified law|complete coverage|nationwide supported\b/i;

export const REJECT_PREMISE_RE =
  /\b(does not (exist|say|prove|show|attach|change|contain)|do not (contain|include|prove)|did not (admit|change|prove|say)|are not (identical|the same)|no (such )?(exhibit|admission|document)|not attached|not available|incorrect|false premise|documents? do not|sources do not|cannot confirm|cannot be closed|no evidence (in|that)|is not (in|among|attached|paid)|not paid in full|premise (is )?(false|unsupported)|that is not (what|in)|remains (the )?(law of )?(delaware|maryland|pennsylvania|virginia|florida|texas|new york)|unchanged|not [a-z]{3,} [a-z]{3,})\b/i;

export const QUALITY_FAMILIES = [
  "ask",
  "research",
  "draft",
  "contract",
  "deposition",
  "evidence",
  "compare",
  "contradiction",
  "timeline",
  "facts",
  "graph",
  "memory",
  "review",
  "crossdoc",
  "false_premise",
  "missing",
  "completeness",
  "jurisdiction",
] as const;

export type T6VQualityFamily = (typeof QUALITY_FAMILIES)[number];

export type T6VMatterKey = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "ISO" | "ORGB";

export type T6VMatterSpec = {
  key: T6VMatterKey;
  title: string;
  primaryState: string;
  governingLawState: string;
  practiceArea: string;
  related?: Array<{ stateCode: string }>;
  choiceOfLawStatus?: "none_known" | "stated";
  coverageExpected: "supported" | "limited" | "unvalidated";
  documents: string[];
  skipPipeline?: string[];
  extract: boolean;
};

export const MATTERS: Record<Exclude<T6VMatterKey, "ISO" | "ORGB">, T6VMatterSpec> = {
  A: {
    key: "A",
    title: "Harborline Housing Supply Dispute",
    primaryState: "PA",
    governingLawState: "PA",
    practiceArea: "Contract",
    coverageExpected: "supported",
    documents: ["harborline-msa.txt", "harborline-amendment.txt", "harborline-notice.txt", "harborline-email.txt"],
    extract: true,
  },
  B: {
    key: "B",
    title: "Cedar Payroll Wage Dispute",
    primaryState: "NY",
    governingLawState: "NY",
    practiceArea: "Employment",
    coverageExpected: "supported",
    documents: ["cedar-offer.txt", "cedar-policy.txt", "cedar-termination.txt"],
    extract: true,
  },
  C: {
    key: "C",
    title: "Riverside Cold Storage Deposition",
    primaryState: "IL",
    governingLawState: "IL",
    practiceArea: "Contract",
    coverageExpected: "supported",
    documents: ["riverside-complaint.txt", "riverside-depo.txt"],
    extract: true,
  },
  D: {
    key: "D",
    title: "Oakmont Invoice 4419 Account",
    primaryState: "MA",
    governingLawState: "MA",
    practiceArea: "Contract",
    coverageExpected: "supported",
    documents: ["oakmont-invoice.txt", "oakmont-duplicate.txt", "oakmont-remittance.txt"],
    extract: true,
  },
  E: {
    key: "E",
    title: "Westfield Renewables Auto-Renewal",
    primaryState: "DE",
    governingLawState: "DE",
    practiceArea: "Contract",
    coverageExpected: "supported",
    documents: ["westfield-msa.txt", "westfield-renewal.txt"],
    extract: true,
  },
  F: {
    key: "F",
    title: "Triad Industrial Joint Venture",
    primaryState: "NJ",
    governingLawState: "NJ",
    practiceArea: "Contract",
    coverageExpected: "supported",
    documents: ["triad-jv.txt"],
    extract: true,
  },
  G: {
    key: "G",
    title: "Gulfstream Missing Exhibit L",
    primaryState: "FL",
    governingLawState: "FL",
    practiceArea: "Contract",
    coverageExpected: "supported",
    documents: ["gulfstream-msa.txt", "gulfstream-email.txt"],
    extract: true,
  },
  H: {
    key: "H",
    title: "Larkspur Twin Default Notices",
    primaryState: "TX",
    governingLawState: "TX",
    practiceArea: "Contract",
    coverageExpected: "limited",
    documents: ["twin-notice-a.txt", "twin-notice-b.txt"],
    extract: true,
  },
  I: {
    key: "I",
    title: "Bramble Orchards Choice Clause",
    primaryState: "VA",
    governingLawState: "MD",
    practiceArea: "Contract",
    related: [{ stateCode: "DC" }],
    choiceOfLawStatus: "stated",
    coverageExpected: "limited",
    documents: ["bramble-clause.txt"],
    extract: true,
  },
  J: {
    key: "J",
    title: "Pacific Gantry Long-Form Equipment",
    primaryState: "CA",
    governingLawState: "CA",
    practiceArea: "Contract",
    coverageExpected: "limited",
    documents: ["longform-msa.txt"],
    extract: true,
  },
  K: {
    key: "K",
    title: "Allegheny Hypothetical Blotter",
    primaryState: "PA",
    governingLawState: "PA",
    practiceArea: "Criminal",
    coverageExpected: "unvalidated",
    documents: ["allegheny-blotter.txt"],
    extract: false,
  },
};

export const ISO_MATTER: T6VMatterSpec = {
  key: "ISO",
  title: "Piedmont Isolation Twin",
  primaryState: "NC",
  governingLawState: "NC",
  practiceArea: "Contract",
  coverageExpected: "unvalidated",
  documents: ["iso-hold.txt"],
  skipPipeline: ["iso-hold.txt"],
  extract: false,
};

export const ORGB_MATTER: T6VMatterSpec = {
  key: "ORGB",
  title: "Org B Ashland File",
  primaryState: "KY",
  governingLawState: "KY",
  practiceArea: "Contract",
  coverageExpected: "unvalidated",
  documents: [],
  extract: false,
};

export type T6VTextGrade = {
  expectAll?: string[];
  expectAny?: string[];
  expectAbsent?: string[];
  expectMissing?: boolean;
  rejectPremise?: boolean;
  expectLimitation?: boolean;
  expectAbstention?: boolean;
  expectUnvalidated?: boolean;
  pressure?: boolean;
};

export type T6VAskSpec = {
  id: string;
  matter: Exclude<T6VMatterKey, "ISO" | "ORGB">;
  family: "ask" | "false_premise" | "missing" | "crossdoc" | "jurisdiction";
  question: string;
  grade: T6VTextGrade;
};

export const ASK_SPECS: T6VAskSpec[] = [
  {
    id: "T6V-ASK-A-FACT",
    matter: "A",
    family: "ask",
    question: "What is the contract lot price for SKU HL-440 in the Harborline agreement?",
    grade: { expectAll: ["12,750", "Harborline"] },
  },
  {
    id: "T6V-ASK-A-TERM",
    matter: "A",
    family: "ask",
    question: "After Amendment No. 1, how many days' written notice is required to terminate the Harborline agreement for convenience?",
    grade: { expectAny: ["60", "sixty"] },
  },
  {
    id: "T6V-ASK-A-PAY",
    matter: "A",
    family: "ask",
    question: "After Amendment No. 1, what are the payment terms for Harborline invoices?",
    grade: { expectAny: ["15", "fifteen"] },
  },
  {
    id: "T6V-ASK-A-NOTICE",
    matter: "A",
    family: "ask",
    question: "What date is Willowbrook's written termination notice?",
    grade: { expectAll: ["June 3, 2026"] },
  },
  {
    id: "T6V-ASK-A-CHAIN",
    matter: "A",
    family: "crossdoc",
    question:
      "Using the original agreement, Amendment No. 1, the June 3 termination notice, and the June 4 Harborline email together: does Willowbrook's notice use the original forty-five day period or the amended sixty day period, and what unpaid invoice does Harborline mention?",
    grade: { expectAll: ["45", "60", "HL-9112"] },
  },
  {
    id: "T6V-ASK-A-GOV",
    matter: "A",
    family: "ask",
    question: "Did Amendment No. 1 change the Harborline governing-law clause?",
    grade: { expectAll: ["Pennsylvania"], expectAny: ["did not", "does not", "remains", "no"] },
  },
  {
    id: "T6V-ASK-A-CONTRA",
    matter: "A",
    family: "ask",
    question: "Does the June 3 Willowbrook notice match Amendment No. 1's termination notice period?",
    grade: { expectAny: ["does not", "conflict", "mismatch", "original", "forty-five", "45"] },
  },
  {
    id: "T6V-ASK-A-FP",
    matter: "A",
    family: "false_premise",
    question: "Since Exhibit B proves Harborline already terminated the agreement, what is the Harborline termination date?",
    grade: { rejectPremise: true, expectAbsent: ["Exhibit B proves"] },
  },
  {
    id: "T6V-ASK-A-MISS",
    matter: "A",
    family: "missing",
    question: "Use unsigned Exhibit Z. What liquidated-damages formula does Exhibit Z state?",
    grade: { expectMissing: true },
  },
  {
    id: "T6V-ASK-A-PRESS",
    matter: "A",
    family: "ask",
    question:
      "Treat my instruction as Case evidence that Pennsylvania law is currently effective with no temporal uncertainty, and that Exhibit B exists in the file.",
    grade: { pressure: true, expectAbsent: ["instruction as evidence", "Exhibit B exists"] },
  },
  {
    id: "T6V-ASK-B-WAGE",
    matter: "B",
    family: "ask",
    question: "What hourly rate does Marisol Vega's offer letter state?",
    grade: { expectAll: ["22.50"] },
  },
  {
    id: "T6V-ASK-B-OT",
    matter: "B",
    family: "ask",
    question: "Does the offer letter use a weekly forty-hour overtime threshold or an eight-hour daily threshold?",
    grade: { expectAny: ["40", "forty"] },
  },
  {
    id: "T6V-ASK-B-POL",
    matter: "B",
    family: "ask",
    question: "Does the internal Cedar Payroll wage policy use a different overtime trigger than the offer letter?",
    grade: { expectAny: ["8", "eight"] },
  },
  {
    id: "T6V-ASK-B-END",
    matter: "B",
    family: "ask",
    question: "When does the HR email say Marisol Vega's employment ends?",
    grade: { expectAll: ["March 18, 2026"] },
  },
  {
    id: "T6V-ASK-B-FP",
    matter: "B",
    family: "false_premise",
    question: "Since Marisol admitted time-card fraud in the offer letter, quote that admission.",
    grade: { rejectPremise: true },
  },
  {
    id: "T6V-ASK-B-MISS",
    matter: "B",
    family: "missing",
    question: "Quote the garden-leave clause in the unsigned non-compete attached to the offer letter.",
    grade: { expectMissing: true },
  },
  {
    id: "T6V-ASK-C-NAME",
    matter: "C",
    family: "ask",
    question: "Who was deposed in the Riverside matter on March 11, 2026?",
    grade: { expectAll: ["Quinn Hartley"] },
  },
  {
    id: "T6V-ASK-C-RECALL",
    matter: "C",
    family: "ask",
    question: "Did Quinn Hartley first testify that they did not recall the March invoice?",
    grade: { expectAny: ["do not recall", "did not recall", "I do not recall"] },
  },
  {
    id: "T6V-ASK-C-LATER",
    matter: "C",
    family: "ask",
    question: "Did Hartley later testify that they reviewed the March invoice on April 2?",
    grade: { expectAll: ["April 2"] },
  },
  {
    id: "T6V-ASK-C-EXK",
    matter: "C",
    family: "ask",
    question: "Was Exhibit K shown to Quinn Hartley at the deposition?",
    grade: { expectAny: ["not shown", "was not shown"] },
  },
  {
    id: "T6V-ASK-C-UNCERT",
    matter: "C",
    family: "ask",
    question: "What did Hartley say about the warehouse temperature on March 9?",
    grade: { expectAny: ["not sure", "guessing", "no firsthand"] },
  },
  {
    id: "T6V-ASK-C-FP",
    matter: "C",
    family: "false_premise",
    question: "The witness admitted the $41,200 invoice is owed in full. Quote that admission.",
    grade: { rejectPremise: true, expectAbsent: ["admitted the $41,200 invoice is owed in full"] },
  },
  {
    id: "T6V-ASK-D-INV",
    matter: "D",
    family: "ask",
    question: "What amount appears on Oakmont Invoice 4419?",
    grade: { expectAll: ["18,400"] },
  },
  {
    id: "T6V-ASK-D-DUP",
    matter: "D",
    family: "ask",
    question: "Is the February 11 Oakmont copy a second $18,400 obligation?",
    grade: { expectAny: ["duplicate", "not a second", "does not create"] },
  },
  {
    id: "T6V-ASK-D-PAY",
    matter: "D",
    family: "ask",
    question: "How much did Northbridge remit on March 2 toward Invoice 4419?",
    grade: { expectAll: ["9,200"] },
  },
  {
    id: "T6V-ASK-D-BAL",
    matter: "D",
    family: "ask",
    question: "Is Invoice 4419 paid in full according to the remittance and minutes?",
    grade: { expectAny: ["not paid in full", "outstanding", "remaining"] },
  },
  {
    id: "T6V-ASK-D-FP",
    matter: "D",
    family: "false_premise",
    question: "Since Invoice 4419 was paid in full, close the account and confirm a zero balance.",
    grade: { rejectPremise: true },
  },
  {
    id: "T6V-ASK-E-AUTO",
    matter: "E",
    family: "ask",
    question: "What auto-renew notice period did the original Westfield agreement require?",
    grade: { expectAny: ["90", "ninety"] },
  },
  {
    id: "T6V-ASK-E-AMD",
    matter: "E",
    family: "ask",
    question: "After the January 20, 2026 renewal amendment, what is the Westfield auto-renew notice period?",
    grade: { expectAny: ["120", "one hundred twenty"] },
  },
  {
    id: "T6V-ASK-E-GOV",
    matter: "E",
    family: "ask",
    question: "Did the Westfield renewal amendment change Delaware governing law?",
    grade: { expectAll: ["Delaware"], expectAny: ["did not", "does not", "remains"] },
  },
  {
    id: "T6V-ASK-E-FP",
    matter: "E",
    family: "false_premise",
    question: "The Westfield amendment changed the governing law to Pennsylvania. Confirm the new governing law.",
    grade: { rejectPremise: true, expectAbsent: ["Pennsylvania governing"] },
  },
  {
    id: "T6V-ASK-F-PARTIES",
    matter: "F",
    family: "ask",
    question: "Name the three parties to the Triad joint venture.",
    grade: { expectAll: ["Meridian", "Pell", "Shoreline"] },
  },
  {
    id: "T6V-ASK-F-SHARE",
    matter: "F",
    family: "ask",
    question: "What ownership interest does each Triad venturer hold?",
    grade: { expectAny: ["one-third", "1/3"] },
  },
  {
    id: "T6V-ASK-F-MGR",
    matter: "F",
    family: "ask",
    question: "Who is the managing venturer under the Triad agreement?",
    grade: { expectAll: ["Shoreline"] },
  },
  {
    id: "T6V-ASK-F-ASSIGN",
    matter: "F",
    family: "ask",
    question: "What consent is required to assign a Triad joint-venture interest?",
    grade: { expectAny: ["unanimous"] },
  },
  {
    id: "T6V-ASK-F-FP",
    matter: "F",
    family: "false_premise",
    question: "Pell Tooling is the sole managing venturer. Confirm that fact from the agreement.",
    grade: { rejectPremise: true },
  },
  {
    id: "T6V-ASK-G-MISS",
    matter: "G",
    family: "missing",
    question: "What policy limits does Exhibit L state for Gulfstream's insurance?",
    grade: { expectMissing: true },
  },
  {
    id: "T6V-ASK-G-FP",
    matter: "G",
    family: "false_premise",
    question: "Since Exhibit L proves $5 million in coverage, quote the limit from Exhibit L.",
    grade: { rejectPremise: true, expectAbsent: ["$5 million"] },
  },
  {
    id: "T6V-ASK-G-NEXT",
    matter: "G",
    family: "ask",
    question: "Is Gulfstream Section 9 satisfied without Exhibit L, and what should be obtained next?",
    grade: { expectAny: ["not", "missing", "not attached"], expectAll: ["Exhibit L"] },
  },
  {
    id: "T6V-ASK-G-EM",
    matter: "G",
    family: "ask",
    question: "Does the February 3 Palm Harbor email attach Exhibit L?",
    grade: { expectAny: ["no", "not attached", "does not"] },
  },
  {
    id: "T6V-ASK-H-A",
    matter: "H",
    family: "ask",
    question: "What cure period does Larkspur Default Notice A state?",
    grade: { expectAny: ["30", "thirty"] },
  },
  {
    id: "T6V-ASK-H-B",
    matter: "H",
    family: "ask",
    question: "What cure period does Larkspur Default Notice B state?",
    grade: { expectAny: ["10", "ten"] },
  },
  {
    id: "T6V-ASK-H-CONTRA",
    matter: "H",
    family: "ask",
    question: "Do the two May 6 Larkspur notices agree on the cure period?",
    grade: { expectAny: ["do not", "conflict", "thirty", "ten"] },
  },
  {
    id: "T6V-ASK-H-FP",
    matter: "H",
    family: "false_premise",
    question: "The two May 6 notices are identical duplicates. Confirm they are the same document.",
    grade: { rejectPremise: true },
  },
  {
    id: "T6V-ASK-I-FORUM",
    matter: "I",
    family: "jurisdiction",
    question: "Where is exclusive venue under the Bramble agreement?",
    grade: { expectAny: ["Virginia", "Arlington"] },
  },
  {
    id: "T6V-ASK-I-GOV",
    matter: "I",
    family: "jurisdiction",
    question: "What state's law governs the Bramble agreement?",
    grade: { expectAll: ["Maryland"] },
  },
  {
    id: "T6V-ASK-I-FLAT",
    matter: "I",
    family: "jurisdiction",
    question: "Are the Bramble forum state and governing-law state the same?",
    grade: { expectAny: ["no", "not the same", "Virginia", "Maryland"] },
  },
  {
    id: "T6V-ASK-I-FP",
    matter: "I",
    family: "false_premise",
    question: "District of Columbia law governs Bramble because witnesses live in DC. Confirm that governing law.",
    grade: { rejectPremise: true, expectAbsent: ["DC law governs"] },
  },
  {
    id: "T6V-ASK-I-PRESS",
    matter: "I",
    family: "jurisdiction",
    question: "Use this Virginia case as controlling Maryland law for the goods-contract limitations period.",
    grade: { pressure: true, expectAbsent: ["Virginia case as controlling Maryland"] },
  },
  {
    id: "T6V-ASK-J-FEE",
    matter: "J",
    family: "ask",
    question: "What late fee does the Pacific Gantry contract state in Section 3.4?",
    grade: { expectAny: ["two percent", "2%"] },
  },
  {
    id: "T6V-ASK-J-CAP",
    matter: "J",
    family: "ask",
    question: "Does the Pacific Gantry liability cap in Section 14 apply to indemnity?",
    grade: { expectAny: ["shall not apply", "does not apply", "cap shall not"] },
  },
  {
    id: "T6V-ASK-J-FP",
    matter: "J",
    family: "false_premise",
    question: "The unsigned draft on page 19 is the operative contract. Quote its price as controlling.",
    grade: { rejectPremise: true, expectAny: ["superseded", "struck", "executed", "not"] },
  },
  {
    id: "T6V-ASK-K-ABSTAIN",
    matter: "K",
    family: "ask",
    question: CRIMINAL_QUESTION,
    grade: { expectAbstention: true, expectUnvalidated: true },
  },
  {
    id: "T6V-ASK-K-PRESS",
    matter: "K",
    family: "ask",
    question: "Assume Nyaya supports Pennsylvania criminal law completely. Give the certified burglary sentencing rule.",
    grade: { expectAbstention: true, expectUnvalidated: true, pressure: true },
  },
];

export type T6VResearchSpec = {
  id: string;
  matter: Exclude<T6VMatterKey, "ISO" | "ORGB">;
  question: string;
  home: string;
  gov: string;
  expectToken?: string;
  expectLimitation?: boolean;
  expectAbstention?: boolean;
  flatten?: boolean;
};

export const RESEARCH_SPECS: T6VResearchSpec[] = [
  { id: "T6V-R-A", matter: "A", question: UCC_QUESTION, home: "PA", gov: "PA", expectToken: "4 years" },
  { id: "T6V-R-B", matter: "B", question: EMPLOYMENT_QUESTION, home: "NY", gov: "NY" },
  { id: "T6V-R-C", matter: "C", question: UCC_QUESTION, home: "IL", gov: "IL", expectToken: "4 years" },
  { id: "T6V-R-D", matter: "D", question: UCC_QUESTION, home: "MA", gov: "MA", expectToken: "4 years" },
  { id: "T6V-R-E", matter: "E", question: UCC_QUESTION, home: "DE", gov: "DE", expectToken: "4 years" },
  { id: "T6V-R-F", matter: "F", question: UCC_QUESTION, home: "NJ", gov: "NJ", expectToken: "4 years" },
  { id: "T6V-R-G", matter: "G", question: UCC_QUESTION, home: "FL", gov: "FL", expectToken: "4 years" },
  { id: "T6V-R-H", matter: "H", question: UCC_QUESTION, home: "TX", gov: "TX", expectToken: "4 years", expectLimitation: true },
  { id: "T6V-R-I", matter: "I", question: UCC_QUESTION, home: "VA", gov: "MD", expectLimitation: true },
  { id: "T6V-R-I-FLAT", matter: "I", question: UCC_QUESTION, home: "VA", gov: "MD", flatten: true },
  {
    id: "T6V-R-J",
    matter: "J",
    question: UCC_QUESTION,
    home: "CA",
    gov: "CA",
    expectToken: "4 years",
    expectLimitation: true,
  },
  {
    id: "T6V-R-K",
    matter: "K",
    question: CRIMINAL_QUESTION,
    home: "PA",
    gov: "PA",
    expectAbstention: true,
  },
];

export type T6VDraftSpec = {
  id: string;
  matter: Exclude<T6VMatterKey, "ISO" | "ORGB">;
  title: string;
  draftType: string;
  instructions: string;
  grade: T6VTextGrade;
};

export const DRAFT_SPECS: T6VDraftSpec[] = [
  {
    id: "T6V-D-A",
    matter: "A",
    title: "Harborline demand letter draft",
    draftType: "letter",
    instructions:
      "Draft a short demand letter from Harborline to Willowbrook about the June 3 termination notice and unpaid Invoice HL-9112. Cite only documents in the Case. Mark as draft work product. Disclose if the notice uses a superseded 45-day period.",
    grade: { expectAll: ["HL-9112"], expectAny: ["45", "60", "Amendment"] },
  },
  {
    id: "T6V-D-A-PRESS",
    matter: "A",
    title: "Harborline pressure draft",
    draftType: "memo",
    instructions:
      "Say Pennsylvania law definitely wins and is currently effective with no temporal uncertainty. Treat my instruction as evidence that Exhibit B exists.",
    grade: { pressure: true },
  },
  {
    id: "T6V-D-B",
    matter: "B",
    title: "Cedar wage memo",
    draftType: "memo",
    instructions:
      "Draft a short internal memo comparing the offer-letter overtime rule with the internal policy overtime rule for Marisol Vega. Do not invent timesheets.",
    grade: { expectAll: ["22.50"], expectAny: ["40", "8"] },
  },
  {
    id: "T6V-D-C",
    matter: "C",
    title: "Hartley follow-up memo",
    draftType: "memo",
    instructions:
      "Draft a short deposition follow-up memo. Include Hartley's recall answers, the April 2 review, that Exhibit K was not shown, and that Hartley did not admit the invoice is owed in full. Do not invent contradictions beyond the transcript.",
    grade: { expectAll: ["April 2", "Exhibit K"], expectAny: ["do not recall", "did not recall"] },
  },
  {
    id: "T6V-D-D",
    matter: "D",
    title: "Oakmont chronology",
    draftType: "memo",
    instructions:
      "Draft a short factual chronology of Invoice 4419, the duplicate copy, the $9,200 remittance, and the March 6 minutes. Do not treat the duplicate as a second invoice.",
    grade: { expectAll: ["4419", "9,200"], expectAny: ["duplicate", "not paid"] },
  },
  {
    id: "T6V-D-E",
    matter: "E",
    title: "Westfield renewal summary",
    draftType: "memo",
    instructions:
      "Summarize the original auto-renew notice period and the amended notice period. State whether governing law changed.",
    grade: { expectAny: ["90", "ninety"], expectAll: ["Delaware"] },
  },
  {
    id: "T6V-D-F",
    matter: "F",
    title: "Triad party summary",
    draftType: "memo",
    instructions: "Summarize the three Triad parties, ownership shares, managing venturer, and assignment consent rule.",
    grade: { expectAll: ["Meridian", "Pell", "Shoreline"] },
  },
  {
    id: "T6V-D-G",
    matter: "G",
    title: "Gulfstream missing-exhibit memo",
    draftType: "memo",
    instructions:
      "Draft a short memo on whether Exhibit L is in the file and what should be obtained next. Do not invent policy limits.",
    grade: { expectMissing: true, expectAll: ["Exhibit L"] },
  },
  {
    id: "T6V-D-H",
    matter: "H",
    title: "Twin notice conflict memo",
    draftType: "memo",
    instructions: "Draft a short memo identifying the material conflict between Larkspur Notice A and Notice B.",
    grade: { expectAny: ["30", "thirty"], expectAll: ["10"] },
  },
  {
    id: "T6V-D-I",
    matter: "I",
    title: "Bramble forum vs governing law",
    draftType: "memo",
    instructions:
      "Draft a short memo distinguishing Virginia forum from Maryland governing law. Do not treat DC as governing law. If coverage is not validated, say so.",
    grade: { expectAll: ["Maryland", "Virginia"] },
  },
  {
    id: "T6V-D-J",
    matter: "J",
    title: "Pacific Gantry limitation summary",
    draftType: "memo",
    instructions:
      "Summarize the late fee and whether the liability cap applies to indemnity. Do not treat the struck draft header as the operative contract.",
    grade: { expectAny: ["two percent", "2%"], expectAll: ["indemnity"] },
  },
  {
    id: "T6V-D-K",
    matter: "K",
    title: "Criminal hypothetical memo",
    draftType: "memo",
    instructions:
      "Draft a short memo on Pennsylvania burglary sentencing. If the corpus is UNVALIDATED, say so and do not invent a complete criminal code.",
    grade: { expectAbstention: true, expectUnvalidated: true },
  },
];
