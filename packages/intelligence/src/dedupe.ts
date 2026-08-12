import { jaccard, tokenize } from "./provenance";

export type DedupeCandidate = {
  id?: string;
  eventType: string;
  title: string;
  description?: string | null;
  eventDate?: Date | null;
  actors?: string[] | null;
  status?: string;
};

/**
 * Conservative event dedupe: same type + same calendar day + high description similarity.
 * Uncertain matches are kept separate.
 */
export function findDuplicateTimelineEvent(
  candidate: DedupeCandidate,
  existing: DedupeCandidate[],
): DedupeCandidate | null {
  const candidateDay = dayKey(candidate.eventDate);
  const candidateTokens = tokenize(`${candidate.title} ${candidate.description ?? ""}`);
  const candidateActors = new Set((candidate.actors ?? []).map((a) => a.toLowerCase()));

  for (const row of existing) {
    if (row.status === "rejected") continue;
    if (row.eventType !== candidate.eventType) continue;

    const rowDay = dayKey(row.eventDate);
    if (candidateDay && rowDay && candidateDay !== rowDay) continue;
    if (!candidateDay && rowDay) continue;
    if (candidateDay && !rowDay) continue;

    const similarity = jaccard(candidateTokens, tokenize(`${row.title} ${row.description ?? ""}`));
    const actorOverlap =
      candidateActors.size === 0
        ? true
        : [...candidateActors].some((a) => (row.actors ?? []).some((b) => b.toLowerCase() === a));

    if (similarity >= 0.4 && actorOverlap) {
      return row;
    }
  }
  return null;
}

export function buildTimelineDedupeKey(params: {
  eventType: string;
  eventDate?: Date | null;
  title: string;
}): string {
  const day = dayKey(params.eventDate) ?? "unknown";
  const title = params.title.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
  return `${params.eventType}|${day}|${title}`;
}

function dayKey(date?: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}
