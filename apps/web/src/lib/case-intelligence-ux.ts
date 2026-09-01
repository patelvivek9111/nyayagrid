import { USER_FACING_AUTH } from "@nyayagrid/auth/user-facing";
import { formatMatterCalendarDate } from "./matter-dates";
import { humanizeKey } from "./plain-labels";

export const GRAPH_RELATIONSHIP_OPTIONS = [
  "related_to",
  "works_for",
  "party_to",
  "signed",
  "sent",
  "received",
  "attended",
  "mentioned_in",
  "supports",
  "contradicts",
  "occurred_before",
  "occurred_after",
  "represents",
  "assigned_to",
  "alleges",
  "paid",
  "owns",
  "communicates_with",
  "supported_by",
  "participated_in",
  "contains_fact",
] as const;

export type TrustStatusKind = "verified" | "suggested" | "needs_review" | "disputed" | "archived";

export function isVerifiedStatus(status: string | null | undefined): boolean {
  return status === "approved" || status === "edited_and_approved";
}

export function trustStatusFromRecord(input: {
  status?: string | null;
  badge?: string | null;
  disputed?: boolean;
}): TrustStatusKind {
  if (input.disputed) return "disputed";
  if (
    input.badge === "historical" ||
    input.status === "archived" ||
    input.status === "superseded"
  ) {
    return "archived";
  }
  if (input.badge === "suggested" || input.status === "proposed") return "suggested";
  if (isVerifiedStatus(input.status) || input.badge === "verified" || input.status === "reviewed") {
    return "verified";
  }
  if (input.status === "rejected") return "archived";
  return "needs_review";
}

export function sourceCountLabel(count: number): string {
  if (count <= 0) return "No sources";
  if (count === 1) return "View source";
  return `View sources (${count})`;
}

export type TimelineEventLike = {
  id: string;
  title: string;
  description?: string | null;
  eventType?: string | null;
  eventDate?: string | Date | null;
  eventDateEnd?: string | Date | null;
  datePrecision?: string | null;
  origin?: string | null;
  status?: string | null;
  relatedFindingIds?: string[] | null;
  sources?: unknown[] | null;
};

export type TimelineFilter = "all" | "communications" | "deadlines" | "disputed" | "suggested";

export function isCommunicationEventType(eventType: string | null | undefined): boolean {
  const value = (eventType ?? "").toLowerCase();
  return /communicat|email|notice|letter|call|sent|received|correspondence/.test(value);
}

export function isDeadlineEventType(eventType: string | null | undefined): boolean {
  const value = (eventType ?? "").toLowerCase();
  return /deadline|due|filing|hearing/.test(value);
}

export function isDisputedTimelineEvent(event: TimelineEventLike): boolean {
  return (event.relatedFindingIds ?? []).length > 0;
}

export function filterTimelineEvents(
  events: TimelineEventLike[],
  proposed: TimelineEventLike[],
  filter: TimelineFilter,
): TimelineEventLike[] {
  if (filter === "suggested") return proposed;
  const source = filter === "all" ? events : events;
  return source.filter((event) => {
    if (filter === "communications") return isCommunicationEventType(event.eventType);
    if (filter === "deadlines") return isDeadlineEventType(event.eventType);
    if (filter === "disputed") return isDisputedTimelineEvent(event);
    return true;
  });
}

export function formatTimelineDateCertainty(event: TimelineEventLike): string {
  if (!event.eventDate) return "Date unknown";
  const precision = (event.datePrecision ?? "").toLowerCase();
  if (!precision || precision === "unknown") return "Recorded date";
  return humanizeKey(event.datePrecision) || "Recorded date";
}

export function formatTimelineDateLine(event: TimelineEventLike): string {
  const start = formatMatterCalendarDate(event.eventDate ?? null, { dateUnknownLabel: "" });
  const end = event.eventDateEnd
    ? formatMatterCalendarDate(event.eventDateEnd, { dateUnknownLabel: "" })
    : "";
  if (start && end && start !== end) return `${start} – ${end}`;
  if (start) return start;
  return "Date unknown";
}

export type TimelineDateGroup<T extends TimelineEventLike> = {
  key: string;
  label: string;
  events: T[];
};

export function groupTimelineEventsByDate<T extends TimelineEventLike>(
  events: T[],
): TimelineDateGroup<T>[] {
  const groups = new Map<string, TimelineDateGroup<T>>();
  for (const event of events) {
    const label = formatTimelineDateLine(event);
    const existing = groups.get(label);
    if (existing) existing.events.push(event);
    else groups.set(label, { key: label, label, events: [event] });
  }
  return [...groups.values()];
}

export type EvidenceDocumentRow = {
  document?: { id?: string; title?: string | null; processingState?: string | null };
  id?: string;
  title?: string | null;
  processingState?: string | null;
  important?: boolean;
  reviewState?: { important?: boolean } | null;
  linkedEvents?: unknown[];
  linkedFacts?: unknown[];
  linkedEntities?: unknown[];
  linkedGraphEdges?: unknown[];
};

export type EvidencePreview = {
  kind: "Event" | "Fact" | "Person" | "Connection";
  label: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function unwrapEvidencePreviews(row: EvidenceDocumentRow): EvidencePreview[] {
  const previews: EvidencePreview[] = [];
  for (const item of row.linkedEvents ?? []) {
    const rec = asRecord(item);
    const event = asRecord(rec?.event) ?? rec;
    const label = String(event?.title ?? event?.label ?? "").trim();
    if (label) previews.push({ kind: "Event", label });
  }
  for (const item of row.linkedFacts ?? []) {
    const rec = asRecord(item);
    const fact = asRecord(rec?.fact) ?? rec;
    const statement = String(fact?.statement ?? "").trim();
    const label = String(fact?.label ?? fact?.title ?? "").trim();
    const value = String(fact?.value ?? "").trim();
    const text =
      statement || (label && value && label !== value ? `${label} — ${value}` : label || value);
    if (text) previews.push({ kind: "Fact", label: text });
  }
  for (const item of row.linkedEntities ?? []) {
    const rec = asRecord(item);
    const entity = asRecord(rec?.entity) ?? rec;
    const label = String(entity?.displayName ?? rec?.displayName ?? entity?.name ?? "").trim();
    if (label) previews.push({ kind: "Person", label });
  }
  for (const item of row.linkedGraphEdges ?? []) {
    const rec = asRecord(item);
    const edge = asRecord(rec?.edge) ?? rec;
    const fromName = String(asRecord(rec?.fromNode)?.displayName ?? rec?.fromName ?? "").trim();
    const toName = String(asRecord(rec?.toNode)?.displayName ?? rec?.toName ?? "").trim();
    const rel = humanizeKey(
      String(edge?.relationshipType ?? rec?.relationshipType ?? "related_to"),
    );
    const label = fromName && toName ? `${fromName} · ${rel} · ${toName}` : rel;
    if (label) previews.push({ kind: "Connection", label });
  }
  return previews;
}

export function evidenceLinkSummary(previews: EvidencePreview[]): string {
  const events = previews.filter((p) => p.kind === "Event").length;
  const facts = previews.filter((p) => p.kind === "Fact").length;
  const people = previews.filter((p) => p.kind === "Person").length;
  const connections = previews.filter((p) => p.kind === "Connection").length;
  const parts: string[] = [];
  if (events) parts.push(`${events} event${events === 1 ? "" : "s"}`);
  if (facts) parts.push(`${facts} fact${facts === 1 ? "" : "s"}`);
  if (people) parts.push(`${people} ${people === 1 ? "person" : "people"}`);
  if (connections) parts.push(`${connections} connection${connections === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export type EvidenceMatrixIssue = {
  issueKey?: string;
  label?: string;
  supporting?: Array<{ rationale?: string; documentId?: string | null }>;
  contrary?: Array<{ rationale?: string; documentId?: string | null }>;
  gaps?: Array<{ rationale?: string }>;
};

export function evidenceMatrixIssues(matrix: unknown): EvidenceMatrixIssue[] {
  if (Array.isArray(matrix)) return matrix as EvidenceMatrixIssue[];
  const rec = asRecord(matrix);
  if (Array.isArray(rec?.issues)) return rec.issues as EvidenceMatrixIssue[];
  return [];
}

export function memoryGroupId(memoryType: string): string {
  if (memoryType === "verified_context") return "confirmed_facts";
  if (memoryType === "strategic_note") return "strategy";
  if (memoryType === "user_instruction") return "instructions";
  if (memoryType === "matter_preference") return "preferences";
  return "other";
}

export function memoryGroupLabel(groupId: string): string {
  if (groupId === "confirmed_facts") return "Confirmed facts";
  if (groupId === "strategy") return "Case strategy";
  if (groupId === "instructions") return "Attorney instructions";
  if (groupId === "preferences") return "Client preferences";
  return "Other memory";
}

export function peopleKindFilter(
  entityType: string | null | undefined,
  roles: Array<{ role: string }> | null | undefined,
  filter: "all" | "people" | "organizations" | "parties" | "witnesses",
): boolean {
  const type = (entityType ?? "").toLowerCase();
  const roleText = (roles ?? []).map((r) => r.role.toLowerCase());
  if (filter === "all") return true;
  if (filter === "people") return type !== "organization";
  if (filter === "organizations") return type === "organization";
  if (filter === "parties") return roleText.some((r) => r.includes("party"));
  if (filter === "witnesses") return roleText.some((r) => r.includes("witness"));
  return true;
}

export function graphNodeFilterType(
  nodeType: string,
): "people" | "organizations" | "documents" | "events" | "facts" | "other" {
  const type = nodeType.toLowerCase();
  if (type === "person" || type === "client") return "people";
  if (type === "organization") return "organizations";
  if (type === "document") return "documents";
  if (type === "event" || type === "deadline") return "events";
  if (type === "fact") return "facts";
  return "other";
}

/** Stored types that stay labeled on the canvas without hover or selection. Do not invent types. */
const ALWAYS_VISIBLE_GRAPH_RELATIONSHIP_TYPES = new Set(["contradicts"]);

export function isAlwaysVisibleGraphRelationship(relationshipType: string): boolean {
  return ALWAYS_VISIBLE_GRAPH_RELATIONSHIP_TYPES.has(relationshipType);
}

export function graphCanvasEdgeLabel(relationshipType: string): string {
  return humanizeKey(relationshipType);
}

export function shouldShowGraphCanvasEdgeLabel(input: {
  relationshipType: string;
  hovered: boolean;
  selected: boolean;
  connectedToSelectedNode: boolean;
}): boolean {
  if (input.hovered || input.selected || input.connectedToSelectedNode) return true;
  return isAlwaysVisibleGraphRelationship(input.relationshipType);
}

export function graphCanvasEdgeLabelPriority(input: {
  hovered: boolean;
  selected: boolean;
  alwaysVisible: boolean;
  connectedToSelectedNode: boolean;
}): number {
  if (input.hovered) return 100;
  if (input.selected) return 90;
  if (input.alwaysVisible) return 50;
  if (input.connectedToSelectedNode) return 20;
  return 0;
}

export type GraphEdgeLabelCandidate = {
  id: string;
  x: number;
  y: number;
  priority: number;
};

export function pickVisibleGraphEdgeLabelIds(
  candidates: GraphEdgeLabelCandidate[],
  minDistance = 36,
): Set<string> {
  const sorted = [...candidates].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  );
  const kept: GraphEdgeLabelCandidate[] = [];
  for (const candidate of sorted) {
    const collides = kept.some(
      (existing) => Math.hypot(existing.x - candidate.x, existing.y - candidate.y) < minDistance,
    );
    if (collides && candidate.priority < 90) continue;
    kept.push(candidate);
  }
  return new Set(kept.map((item) => item.id));
}

export function userFacingLoadError(
  kind: "timeline" | "evidence" | "people" | "graph" | "memory" | "home" | "chats" | "documents" | "review",
  status?: number,
): string {
  if (status === 401) return USER_FACING_AUTH.unauthenticated;
  if (status === 403) return USER_FACING_AUTH.forbidden;
  if (kind === "timeline") return "We couldn't load the case timeline. Try again.";
  if (kind === "evidence") return "We couldn't load case evidence. Try again.";
  if (kind === "people") return "We couldn't load people and organizations. Try again.";
  if (kind === "graph") return "We couldn't load the case graph. Try again.";
  if (kind === "home") return "We couldn't load this matter. Try again.";
  if (kind === "chats") return "We couldn't load this conversation. Try again.";
  if (kind === "documents") return "We couldn't load documents. Try again.";
  if (kind === "review") return "We couldn't load the review queue. Try again.";
  return "We couldn't load case memory. Try again.";
}

export function askNyayaHref(matterId: string): string {
  return `/app/cases/${matterId}/chats`;
}
