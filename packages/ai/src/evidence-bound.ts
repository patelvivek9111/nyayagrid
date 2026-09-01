type PassageLike = {
  chunkId: string;
  quote: string;
};

export const NYAYA_EVIDENCE_BOUND_MARKER = "Worked example (SYNTH evidence-bound)";
export const NYAYA_PREMISE_CHALLENGE_MARKER = "Worked example (SYNTH premise challenge)";
export const NYAYA_SILENCE_NOT_PROOF_MARKER = "Worked example (SYNTH silence)";
export const NYAYA_SOURCE_ROLE_MARKER = "Worked example (SYNTH source role)";
export const NYAYA_FUTURE_EFFECTIVE_MARKER = "Worked example (SYNTH future-effective)";
export const NYAYA_QUALIFIER_PRESERVE_MARKER = "Worked example (SYNTH qualifier)";

const QUALIFIER_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bdoes not independently prove\b/i, label: "does not independently prove" },
  { pattern: /\bdoes not establish\b/i, label: "does not establish" },
  { pattern: /\bdoes not prove\b/i, label: "does not prove" },
  { pattern: /\bapproximately\b/i, label: "approximately" },
  { pattern: /\balleged\b/i, label: "alleged" },
  { pattern: /\bdisputed\b/i, label: "disputed" },
  { pattern: /\bbelieved\b/i, label: "believed" },
  { pattern: /\bappears\b/i, label: "appears" },
  { pattern: /\bestimated\b/i, label: "estimated" },
  { pattern: /\bsubject to\b/i, label: "subject to" },
];

export type SourceQualifierHit = {
  chunkId: string;
  labels: string[];
};

export function extractSourceQualifiers(passages: PassageLike[]): SourceQualifierHit[] {
  const hits: SourceQualifierHit[] = [];
  for (const passage of passages) {
    const labels = QUALIFIER_PATTERNS.filter((row) => row.pattern.test(passage.quote)).map(
      (row) => row.label,
    );
    if (labels.length === 0) continue;
    hits.push({ chunkId: passage.chunkId, labels: [...new Set(labels)] });
  }
  return hits;
}

export function formatSourceQualifierBlock(passages: PassageLike[]): string {
  const hits = extractSourceQualifiers(passages);
  if (hits.length === 0) return "";
  return [
    "Detected hedge or limitation language in retrieved quotes. Preserve it. Do not convert it into certainty:",
    ...hits.map((hit) => `  qualifier ${hit.chunkId}: ${hit.labels.join(", ")}`),
  ].join("\n");
}

export const NYAYA_EVIDENCE_BOUND_RULES = [
  "Bind every claim to what the cited Sources actually establish. Do not silently upgrade observation into a stronger inferred fact.",
  "Treat Source text as: (1) the document states the proposition; (2) the evidence supports a conclusion with interpretation; (3) the evidence suggests but does not establish it; or (4) the evidence does not establish the asked proposition — say so.",
  "A system or activity record (for example ACCESS GRANTED, paid, sent, logged) establishes that recorded activity. It does not, by itself, establish who physically acted, who possessed a credential, or a person's exact movement unless another Source says so.",
  "Before answering why / how / explain-why questions, test whether the question's premise is established. If it is not, correct the premise. Do not invent motives to fill the question's form.",
  "Absence of a fact from one document is evidence about that document. It is not proof the event never occurred unless the broader record establishes that.",
  "Different sources establish different things. A signed in-force agreement generally controls contractual obligations over informal recollection. A log can establish recorded activity. Testimony establishes what the witness said. Do not use one source as proof of every related proposition.",
  "For contractual requirements, follow original term → amendment(s) → each instrument's effective date → the date the question cares about → the currently operative provision. A signed but not-yet-effective amendment does not replace the current term. A currently effective amendment does replace the provision it supersedes.",
  "If a Source uses qualifying language (may, approximately, alleged, believed, appears, estimated, disputed, subject to, does not independently prove), keep that qualification in the answer.",
  "A citation must support the strength of the claim, not merely a related weaker fact. If the Source only supports a weaker proposition, state the weaker proposition.",
  "When Sources clearly state the asked fact, answer it. Do not refuse merely because other documents exist or because a limitation appears on a different proposition.",
].join(" ");

export const NYAYA_EVIDENCE_BOUND_WORKED_EXAMPLE = `${NYAYA_EVIDENCE_BOUND_MARKER}: Question: At what time did the named person physically enter the vault? Source chunk_access_log: Credential assigned to that person — ACCESS GRANTED at 09:03. This log records credential activity; it does not independently prove who physically carried the credential. Correct output: evidenceState=partial, state that the log records that credential being granted access at 09:03, and that the log alone does not establish that the named person personally entered. Do not say the person physically entered at 09:03.`;

export const NYAYA_PREMISE_CHALLENGE_WORKED_EXAMPLE = `${NYAYA_PREMISE_CHALLENGE_MARKER}: Question: Explain why the parties made the second amendment retroactive to 1 June 2025. Source chunk_amend_future: This Second Amendment becomes effective 15 September 2028. Correct output: evidenceState=partial, reject the retroactivity premise, quote the future effective date, and do not invent motives for a supposed retroactive agreement.`;

export const NYAYA_SILENCE_NOT_PROOF_WORKED_EXAMPLE = `${NYAYA_SILENCE_NOT_PROOF_MARKER}: Question: Did the vendor ever issue a service credit? Source chunk_invoice: This invoice does not reflect any service credit. Correct output: evidenceState=partial, say this invoice does not show a credit. Do not conclude that no credit was ever issued unless other Sources prove that.`;

export const NYAYA_SOURCE_ROLE_WORKED_EXAMPLE = `${NYAYA_SOURCE_ROLE_MARKER}: Question: What notice period does the signed agreement require? Source chunk_email: I think the notice period is 60 days. Source chunk_amendment: Section 4 is amended to require thirty (30) days' written notice, effective immediately. Correct output: evidenceState=grounded, answer 30 days from the signed amendment. Treat the email as informal recollection, not the controlling term.`;

export const NYAYA_FUTURE_EFFECTIVE_WORKED_EXAMPLE = `${NYAYA_FUTURE_EFFECTIVE_MARKER}: Question: What notice period does the contract currently require? Source chunk_base: Notice shall be sixty (60) days. Source chunk_future_amend: The later amendment is signed and becomes effective 15 September 2028; thereafter notice shall be forty-five (45) days. Correct output: evidenceState=grounded, current notice remains 60 days because the later amendment is a not-yet-effective amendment. Do not treat the newest signed amendment as automatically current.`;

export const NYAYA_QUALIFIER_PRESERVE_WORKED_EXAMPLE = `${NYAYA_QUALIFIER_PRESERVE_MARKER}: Question: When did delivery occur? Source chunk_note: Delivery occurred on or about approximately 12 April 2026. Correct output: evidenceState=grounded, keep approximately / on or about. Do not convert that into an exact date presented as certain.`;
