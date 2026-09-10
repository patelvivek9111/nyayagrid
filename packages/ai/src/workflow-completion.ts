/**
 * Deterministic workflow-completion audit.
 * Required obligations are completed or explicitly marked unavailable — never silently omitted.
 */

export type ObligationStatus = "completed" | "unavailable" | "not_established" | "not_applicable";

export type WorkflowObligation = {
  id: string;
  status: ObligationStatus;
  detail: string;
};

export type WorkflowCompletionAudit = {
  obligations: WorkflowObligation[];
  silentOmissions: string[];
  carryForwardNotes: string[];
};

export function extractPartiesFromAgreementText(text: string): string[] {
  const match = text.match(/Parties:\s*([^\n]+?)\s+and\s+([^\n.]+)/i);
  if (!match) return [];
  return [match[1]!.trim(), match[2]!.trim()].filter((name) => name.length > 1);
}

/**
 * Preserve both sides of a meeting-date conflict from ingested document text.
 * Amendment effective dates are not treated as meeting dates.
 */
export function extractUnresolvedMeetingDateConflict(texts: string[]): string | null {
  const dates = new Set<string>();
  for (const text of texts) {
    if (!/\b(meeting|file-review|file review)\b/i.test(text)) continue;
    const looksLikeInstrumentOnly =
      /\b(amendment|effective 20|signed 20)\b/i.test(text) &&
      !/\b(minutes|calendar|deposition|witness|hallway|file-review|file review meeting)\b/i.test(
        text,
      );
    if (looksLikeInstrumentOnly) continue;
    for (const match of text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)) {
      dates.add(match[1]!);
    }
  }
  if (dates.size < 2) return null;
  const ordered = [...dates].sort();
  return `Sources conflict on the in-person file-review meeting date: ${ordered.join(" versus ")}. Both accounts remain in the Case record; the conflict is unresolved.`;
}

function containsNeedle(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

export function auditWorkflowObligations(input: {
  parties: string[];
  factsText: string;
  entityText: string;
  contradictionText: string;
  draftText: string;
  stepsCompleted: boolean;
  completedStepCount: number;
  requiredStepCount: number;
}): WorkflowCompletionAudit {
  const identityHay = `${input.factsText}\n${input.entityText}`;
  const obligations: WorkflowObligation[] = [];
  const silentOmissions: string[] = [];
  const carryForwardNotes: string[] = [];

  for (const party of input.parties) {
    const found = containsNeedle(identityHay, party);
    obligations.push({
      id: `party:${party}`,
      status: found ? "completed" : "not_established",
      detail: found
        ? `Identified ${party}`
        : `${party} is not established in extracted facts or entities`,
    });
    if (!found) {
      silentOmissions.push(`party:${party}`);
      carryForwardNotes.push(
        `${party} is not established from extracted intelligence. The agreement names the party if that instrument is in the file.`,
      );
    }
  }

  const contradictionPresent =
    input.contradictionText.trim().length > 40 ||
    /conflict|inconsistent|unresolved|versus/i.test(input.contradictionText);
  obligations.push({
    id: "contradiction",
    status: contradictionPresent ? "completed" : "not_established",
    detail: contradictionPresent
      ? "Meeting-date conflict preserved"
      : "Meeting-date conflict is not established from current findings",
  });
  if (!contradictionPresent) {
    silentOmissions.push("contradiction");
    carryForwardNotes.push(
      "A meeting-date conflict is not established from contradiction findings. Both retrieved dates remain unresolved if present in the file.",
    );
  }

  const stepsOk =
    input.stepsCompleted && input.completedStepCount >= input.requiredStepCount;
  obligations.push({
    id: "workflow_steps",
    status: stepsOk ? "completed" : "unavailable",
    detail: stepsOk
      ? "All required workflow steps completed"
      : `Workflow incomplete: ${input.completedStepCount}/${input.requiredStepCount} steps`,
  });
  if (!stepsOk) silentOmissions.push("workflow_steps");

  const draftPresent = input.draftText.trim().length > 20;
  obligations.push({
    id: "draft",
    status: draftPresent ? "completed" : "unavailable",
    detail: draftPresent ? "Work product drafted" : "Work product draft is unavailable",
  });
  if (!draftPresent) silentOmissions.push("draft");

  return { obligations, silentOmissions, carryForwardNotes };
}

export function formatUnavailableObligations(audit: WorkflowCompletionAudit): string {
  return audit.carryForwardNotes.join("\n");
}
