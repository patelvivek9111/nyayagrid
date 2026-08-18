/** Turn stored keys into short labels a lawyer can read without guessing. */
const LABELS: Record<string, string> = {
  verified_context: "Confirmed fact",
  strategic_note: "Strategy note",
  entity_resolution: "Who this is",
  document_significance: "Why this file matters",
  factual_caveat: "Caution",
  user_instruction: "Your instruction",
  matter_preference: "Case preference",
  procedural_context: "Procedure",
  other: "Other",
  related_to: "Related to",
  party: "Party",
  counsel: "Counsel",
  witness: "Witness",
  matter_entity: "Person or organization",
  timeline_event: "Timeline event",
  document: "Document",
  task: "Task",
  deadline_candidate: "Deadline",
  uploaded: "Uploaded",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
  proposed: "Suggested",
  approved: "Confirmed",
  edited_and_approved: "Edited and confirmed",
  rejected: "Rejected",
  superseded: "Replaced",
  archived: "Archived",
  open: "Open",
  in_progress: "In progress",
  completed: "Done",
  awaiting_approval: "Needs your OK",
  planned: "Queued",
  running: "Working",
  draft: "Draft",
  in_review: "In review",
};

export function humanizeKey(value: string | null | undefined): string {
  if (!value) return "";
  const mapped = LABELS[value];
  if (mapped) return mapped;
  return value.replace(/[_-]+/g, " ");
}
