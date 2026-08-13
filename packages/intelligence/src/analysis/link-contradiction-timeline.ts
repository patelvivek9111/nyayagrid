/**
 * Read-only linking between contradiction findings and timeline events.
 *
 * Never merges, approves, or collapses dual-sided conflicts into one “truth” event.
 * Callers must treat related IDs as navigation hints only.
 */
import { jaccard, tokenize } from "../provenance";

export type FindingSideSource = {
  side?: string | null;
  chunkId?: string | null;
  documentId?: string | null;
  supportingText?: string | null;
};

export type TimelineLinkCandidate = {
  id: string;
  title: string;
  description?: string | null;
  eventDate?: Date | string | null;
  actors?: string[] | null;
  status?: string | null;
  sources?: Array<{
    chunkId?: string | null;
    documentId?: string | null;
    supportingText?: string | null;
  }>;
};

export type ContradictionTimelineLink = {
  eventId: string;
  /** Which finding side(s) the event appears related to — never collapses the conflict. */
  side: "A" | "B" | "both" | "unknown";
  reasons: Array<
    "shared_chunk" | "shared_document" | "date_overlap" | "actor_overlap" | "text_overlap"
  >;
  score: number;
};

export type ContradictionTimelineLinkResult = {
  relatedTimelineEventIds: string[];
  sideAEventIds: string[];
  sideBEventIds: string[];
  links: ContradictionTimelineLink[];
  /** Product invariant: this helper never auto-merges conflicting sides. */
  autoMergeForbidden: true;
};

const DATE_PATTERNS: RegExp[] = [
  /\b((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\b/gi,
  /\b(\d{4}-\d{2}-\d{2})\b/g,
  /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g,
];

function dayKey(date?: Date | string | null): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseMentionedDays(text: string): Set<string> {
  const days = new Set<string>();
  for (const pattern of DATE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1] ?? match[0];
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        days.add(parsed.toISOString().slice(0, 10));
      }
    }
  }
  return days;
}

function sideOf(source: FindingSideSource): "A" | "B" | "unknown" {
  if (source.side === "A" || source.side === "B") return source.side;
  return "unknown";
}

function scoreEventAgainstSide(params: {
  sideText: string;
  sideChunkIds: Set<string>;
  sideDocIds: Set<string>;
  sideDays: Set<string>;
  event: TimelineLinkCandidate;
}): { score: number; reasons: ContradictionTimelineLink["reasons"] } {
  const reasons: ContradictionTimelineLink["reasons"] = [];
  let score = 0;

  const eventChunkIds = new Set(
    (params.event.sources ?? []).map((s) => s.chunkId).filter(Boolean) as string[],
  );
  const eventDocIds = new Set(
    (params.event.sources ?? []).map((s) => s.documentId).filter(Boolean) as string[],
  );

  for (const chunkId of params.sideChunkIds) {
    if (eventChunkIds.has(chunkId)) {
      score += 0.55;
      reasons.push("shared_chunk");
      break;
    }
  }
  for (const docId of params.sideDocIds) {
    if (eventDocIds.has(docId)) {
      score += 0.25;
      reasons.push("shared_document");
      break;
    }
  }

  const eventDay = dayKey(params.event.eventDate);
  if (eventDay && params.sideDays.has(eventDay)) {
    score += 0.35;
    reasons.push("date_overlap");
  }

  const actors = (params.event.actors ?? []).map((a) => a.toLowerCase()).filter(Boolean);
  const sideLower = params.sideText.toLowerCase();
  if (actors.some((a) => a.length >= 3 && sideLower.includes(a))) {
    score += 0.2;
    reasons.push("actor_overlap");
  }

  const eventBlob = `${params.event.title} ${params.event.description ?? ""} ${(params.event.sources ?? [])
    .map((s) => s.supportingText ?? "")
    .join(" ")}`;
  const similarity = jaccard(tokenize(params.sideText), tokenize(eventBlob));
  if (similarity >= 0.28) {
    score += similarity * 0.35;
    reasons.push("text_overlap");
  }

  return { score, reasons: [...new Set(reasons)] };
}

/**
 * Link a dual-sided contradiction/tension finding to related timeline events.
 * Related events remain separate; sides stay dual until a human reviews them.
 */
export function linkContradictionToTimelineEvents(params: {
  finding: {
    title?: string | null;
    explanation?: string | null;
    findingType?: string | null;
    sources: FindingSideSource[];
  };
  events: TimelineLinkCandidate[];
  /** Minimum score to keep a link (default 0.35). */
  minScore?: number;
}): ContradictionTimelineLinkResult {
  const minScore = params.minScore ?? 0.35;
  const sources = params.finding.sources ?? [];
  const sideA = sources.filter((s) => sideOf(s) === "A");
  const sideB = sources.filter((s) => sideOf(s) === "B");

  const buildSide = (sideSources: FindingSideSource[]) => {
    const text = sideSources.map((s) => s.supportingText ?? "").join(" ");
    return {
      text: `${params.finding.title ?? ""} ${params.finding.explanation ?? ""} ${text}`,
      chunkIds: new Set(sideSources.map((s) => s.chunkId).filter(Boolean) as string[]),
      docIds: new Set(sideSources.map((s) => s.documentId).filter(Boolean) as string[]),
      days: parseMentionedDays(text),
    };
  };

  const a = buildSide(sideA.length ? sideA : sources);
  const b = buildSide(sideB.length ? sideB : []);

  const byEvent = new Map<string, ContradictionTimelineLink>();

  for (const event of params.events) {
    if (event.status === "rejected") continue;

    const scoreA = scoreEventAgainstSide({
      sideText: a.text,
      sideChunkIds: a.chunkIds,
      sideDocIds: a.docIds,
      sideDays: a.days,
      event,
    });
    const scoreB =
      sideB.length > 0
        ? scoreEventAgainstSide({
            sideText: b.text,
            sideChunkIds: b.chunkIds,
            sideDocIds: b.docIds,
            sideDays: b.days,
            event,
          })
        : { score: 0, reasons: [] as ContradictionTimelineLink["reasons"] };

    const best = Math.max(scoreA.score, scoreB.score);
    if (best < minScore) continue;

    let side: ContradictionTimelineLink["side"] = "unknown";
    if (scoreA.score >= minScore && scoreB.score >= minScore) side = "both";
    else if (scoreA.score >= minScore) side = "A";
    else if (scoreB.score >= minScore) side = "B";

    byEvent.set(event.id, {
      eventId: event.id,
      side,
      reasons: [...new Set([...scoreA.reasons, ...scoreB.reasons])],
      score: Number(best.toFixed(3)),
    });
  }

  const links = [...byEvent.values()].sort((x, y) => y.score - x.score);
  const sideAEventIds = links.filter((l) => l.side === "A" || l.side === "both").map((l) => l.eventId);
  const sideBEventIds = links.filter((l) => l.side === "B" || l.side === "both").map((l) => l.eventId);

  return {
    relatedTimelineEventIds: links.map((l) => l.eventId),
    sideAEventIds,
    sideBEventIds,
    links,
    autoMergeForbidden: true,
  };
}

/** Inverse index: timeline event → related contradiction finding IDs (still no merge). */
export function linkTimelineEventsToContradictionFindings(params: {
  events: TimelineLinkCandidate[];
  findings: Array<{
    id: string;
    title?: string | null;
    explanation?: string | null;
    findingType?: string | null;
    sources: FindingSideSource[];
  }>;
  minScore?: number;
}): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const finding of params.findings) {
    const type = (finding.findingType ?? "").toLowerCase();
    if (type && type !== "contradiction" && type !== "tension") continue;
    const linked = linkContradictionToTimelineEvents({
      finding,
      events: params.events,
      minScore: params.minScore,
    });
    for (const eventId of linked.relatedTimelineEventIds) {
      const list = map.get(eventId) ?? [];
      if (!list.includes(finding.id)) list.push(finding.id);
      map.set(eventId, list);
    }
  }
  return map;
}
