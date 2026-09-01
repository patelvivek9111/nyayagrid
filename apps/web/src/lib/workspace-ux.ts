import { humanizeKey } from "./plain-labels";

export type ReviewItemKind =
  | "event"
  | "fact"
  | "entity"
  | "deadline"
  | "graph"
  | "contractItem"
  | "finding"
  | "redline"
  | "memory";

export type ReviewQueueCategory =
  "all" | "facts" | "deadlines" | "memory" | "analysis" | "timeline" | "people" | "graph";

export type ReviewQueueEntry = {
  id: string;
  kind: ReviewItemKind;
  category: Exclude<ReviewQueueCategory, "all">;
  typeLabel: string;
  title: string;
  subtitle: string;
  item: Record<string, unknown>;
};

const ANALYSIS_KINDS = new Set<ReviewItemKind>(["contractItem", "finding", "redline"]);

export function isAnalysisReviewKind(kind: ReviewItemKind): boolean {
  return ANALYSIS_KINDS.has(kind);
}

export function findingBucket(finding: {
  runType?: string;
  findingType?: string;
}): "deposition" | "discovery" | "contradiction" | "other" {
  if (finding.runType === "deposition") return "deposition";
  if (finding.runType === "discovery") return "discovery";
  if (
    finding.runType === "contradiction" ||
    finding.findingType === "contradiction" ||
    finding.findingType === "tension"
  ) {
    return "contradiction";
  }
  return "other";
}

function sourceCount(item: Record<string, unknown>): number {
  return Array.isArray(item.sources) ? item.sources.length : 0;
}

function firstSourceTitle(item: Record<string, unknown>): string | null {
  const sources = item.sources as Array<{ documentTitle?: string | null }> | undefined;
  const title = sources?.[0]?.documentTitle?.trim();
  return title || null;
}

function sourceLabel(item: Record<string, unknown>): string {
  const title = firstSourceTitle(item);
  if (title) return title;
  const count = sourceCount(item);
  return `${count} source${count === 1 ? "" : "s"}`;
}

export function flattenReviewQueue(data: {
  events?: Array<Record<string, unknown>>;
  facts?: Array<Record<string, unknown>>;
  entities?: Array<Record<string, unknown>>;
  deadlines?: Array<Record<string, unknown>>;
  graphEdges?: Array<Record<string, unknown>>;
  memories?: Array<Record<string, unknown>>;
  analysis?: {
    contractItems?: Array<Record<string, unknown>>;
    findings?: Array<Record<string, unknown>>;
    redlines?: Array<Record<string, unknown>>;
  };
}): ReviewQueueEntry[] {
  const entries: ReviewQueueEntry[] = [];
  for (const item of data.events ?? []) {
    entries.push({
      id: String(item.id),
      kind: "event",
      category: "timeline",
      typeLabel: "Timeline events",
      title: String(item.title ?? "Suggested event"),
      subtitle: sourceLabel(item),
      item,
    });
  }
  for (const item of data.facts ?? []) {
    const label = String(item.label ?? "");
    const value = String(item.value ?? "");
    entries.push({
      id: String(item.id),
      kind: "fact",
      category: "facts",
      typeLabel: "Suggested fact",
      title: label && value ? `${label}: ${value}` : label || value || "Suggested fact",
      subtitle: sourceLabel(item),
      item,
    });
  }
  for (const item of data.entities ?? []) {
    entries.push({
      id: String(item.id),
      kind: "entity",
      category: "people",
      typeLabel: "Suggested person",
      title: String(item.displayName ?? "Suggested person"),
      subtitle: humanizeKey(String(item.entityType ?? "person")),
      item,
    });
  }
  for (const item of data.deadlines ?? []) {
    const inferred = item.dateKind === "inferred";
    entries.push({
      id: String(item.id),
      kind: "deadline",
      category: "deadlines",
      typeLabel: "Suggested deadline",
      title: String(item.title ?? "Suggested deadline"),
      subtitle: inferred ? "Inferred from case files" : "Date stated in source",
      item,
    });
  }
  for (const item of data.graphEdges ?? []) {
    entries.push({
      id: String(item.id),
      kind: "graph",
      category: "graph",
      typeLabel: "Suggested relationships",
      title: `${item.fromName ?? "From"} — ${humanizeKey(String(item.relationshipType ?? "related_to"))} → ${item.toName ?? "To"}`,
      subtitle: item.origin === "manual" ? "Manually added relationship" : "Suggested by Nyaya",
      item,
    });
  }
  for (const item of data.memories ?? []) {
    const sourced = sourceCount(item);
    entries.push({
      id: String(item.id),
      kind: "memory",
      category: "memory",
      typeLabel: "Nyaya Memory",
      title: String(item.title ?? "Suggested memory"),
      subtitle: sourced
        ? `Based on ${sourced} source${sourced === 1 ? "" : "s"}`
        : "Suggested by Nyaya",
      item,
    });
  }
  for (const item of data.analysis?.contractItems ?? []) {
    entries.push({
      id: String(item.id),
      kind: "contractItem",
      category: "analysis",
      typeLabel: "Analysis waiting for review",
      title: String(item.title ?? "Contract finding"),
      subtitle: String(
        item.documentTitle ?? humanizeKey(String(item.attention ?? item.category ?? "")),
      ),
      item,
    });
  }
  for (const item of data.analysis?.findings ?? []) {
    const contradiction = findingBucket(item) === "contradiction";
    entries.push({
      id: String(item.id),
      kind: "finding",
      category: "analysis",
      typeLabel: contradiction ? "Evidence conflict" : "Analysis waiting for review",
      title: String(item.title ?? "Analysis finding"),
      subtitle: contradiction
        ? "Nyaya does not choose which account is true."
        : String(item.documentTitle ?? humanizeKey(String(item.findingType ?? item.runType ?? ""))),
      item,
    });
  }
  for (const item of data.analysis?.redlines ?? []) {
    entries.push({
      id: String(item.id),
      kind: "redline",
      category: "analysis",
      typeLabel: "Analysis waiting for review",
      title: "Redline suggestion",
      subtitle: String(
        item.documentTitle ?? humanizeKey(String(item.issue ?? "Proposed clause change")),
      ),
      item,
    });
  }
  return entries;
}

export function reviewCategoryCounts(
  entries: ReviewQueueEntry[],
): Record<ReviewQueueCategory, number> {
  const counts: Record<ReviewQueueCategory, number> = {
    all: entries.length,
    facts: 0,
    deadlines: 0,
    memory: 0,
    analysis: 0,
    timeline: 0,
    people: 0,
    graph: 0,
  };
  for (const entry of entries) counts[entry.category] += 1;
  return counts;
}

export function filterReviewQueue(
  entries: ReviewQueueEntry[],
  category: ReviewQueueCategory,
): ReviewQueueEntry[] {
  if (category === "all") return entries;
  return entries.filter((entry) => entry.category === category);
}

export function activityKindLabel(kind: string): string {
  if (kind === "document") return "Document uploaded";
  if (kind === "note") return "Note";
  if (kind === "artifact") return "Nyaya answer saved";
  return humanizeKey(kind);
}

export function taskStatusLabel(status: string | null | undefined): string {
  return humanizeKey(status) || "Open";
}

export function taskPriorityLabel(priority: string | null | undefined): string {
  if (!priority) return "";
  const label = humanizeKey(priority);
  if (/priority$/i.test(label)) return label;
  return `${label} priority`;
}

export const SUGGESTED_CHAT_PROMPTS = [
  "Walk me through the chronology of this case.",
  "What do the key documents say about the main terms?",
  "Who is involved, and what is each person's role?",
  "Are there inconsistencies across the files?",
] as const;

/** Presentation-only: a workspace switcher is useful only when the user can enter more than one org. */
export function shouldShowWorkspaceSwitcher(accessibleOrganizationCount: number): boolean {
  return accessibleOrganizationCount > 1;
}

/** Saved org if still a membership; otherwise the only org, the first org, or none. */
export function resolveActiveOrganizationId(
  organizations: ReadonlyArray<{ id: string }>,
  savedId: string | null | undefined,
): string {
  if (organizations.length === 0) return "";
  if (savedId && organizations.some((org) => org.id === savedId)) return savedId;
  return organizations[0]?.id ?? "";
}
