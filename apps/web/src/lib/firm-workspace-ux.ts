import { humanizeKey } from "./plain-labels";

export type FirmClientRow = {
  id: string;
  displayName: string;
  clientType: string;
  email: string | null;
  status: string;
};

export type FirmCalendarEvent = {
  id: string;
  kind: "deadline" | "task";
  title: string;
  dueAt: string | null;
  timezone: string | null;
  matterId: string;
  matterTitle: string;
  source?: string;
};

export type FirmTimeEntry = {
  id: string;
  matterId: string;
  description: string;
  minutes: number;
  source: string;
  status: string;
  createdAt?: string | Date | null;
};

export type FirmInvoiceRow = {
  id: string;
  invoiceNumber: string;
  status: string;
  matterId: string;
  totalMinutes: number;
  createdAt?: string | Date | null;
};

export type FirmInboxEmail = {
  id: string;
  fromAddress: string;
  subject: string;
  body: string;
  status: string;
  documentId: string | null;
  matterId?: string | null;
  createdAt?: string | Date | null;
};

export function clientTypeLabel(type: string | null | undefined): string {
  if (type === "individual") return "Individual";
  if (type === "organization") return "Organization";
  return humanizeKey(type) || "Client";
}

export function clientStatusLabel(status: string | null | undefined): string {
  return humanizeKey(status) || "Active";
}

export function filterClients(
  clients: FirmClientRow[],
  opts: { query?: string; typeFilter?: string },
): FirmClientRow[] {
  const q = (opts.query ?? "").trim().toLowerCase();
  const typeFilter = opts.typeFilter ?? "all";
  return clients.filter((client) => {
    if (typeFilter === "individuals" && client.clientType !== "individual") return false;
    if (typeFilter === "organizations" && client.clientType !== "organization") return false;
    if (typeFilter === "active" && client.status !== "active") return false;
    if (!q) return true;
    return (
      client.displayName.toLowerCase().includes(q) || (client.email ?? "").toLowerCase().includes(q)
    );
  });
}

export function countMattersForClient(
  matters: Array<{
    clientId?: string | null;
    clientDisplayName?: string | null;
    status?: string | null;
  }>,
  client: Pick<FirmClientRow, "id" | "displayName">,
): number {
  return matters.filter((matter) => {
    if (matter.clientId && matter.clientId === client.id) return true;
    return (matter.clientDisplayName ?? "") === client.displayName;
  }).length;
}

export function calendarKindLabel(kind: string): string {
  if (kind === "deadline") return "Deadline";
  if (kind === "task") return "Task";
  return humanizeKey(kind) || "Item";
}

export function calendarTrustLabel(source: string | null | undefined, kind: string): string {
  if (source === "verified_deadline") return "Verified";
  return calendarKindLabel(kind);
}

export function formatCalendarWhen(
  dueAt: string | null,
  timezone: string | null,
): { dateLine: string; timeLine: string | null } {
  if (!dueAt) return { dateLine: "Date unknown", timeLine: null };
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return { dateLine: "Date unknown", timeLine: null };
  const tzOpts = timezone ? { timeZone: timezone } : undefined;
  const dateLine = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...tzOpts,
  });
  const timeLine = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...tzOpts,
  });
  return {
    dateLine,
    timeLine: timezone ? `${timeLine} (${timezone})` : timeLine,
  };
}

export function filterCalendarEvents(
  events: FirmCalendarEvent[],
  filter: string,
): FirmCalendarEvent[] {
  if (filter === "deadlines") return events.filter((e) => e.kind === "deadline");
  if (filter === "tasks") return events.filter((e) => e.kind === "task");
  return events;
}

export function groupCalendarEventsByDate(events: FirmCalendarEvent[]): Array<{
  dateKey: string;
  dateLine: string;
  items: FirmCalendarEvent[];
}> {
  const groups = new Map<string, { dateLine: string; items: FirmCalendarEvent[] }>();
  for (const event of events) {
    const when = formatCalendarWhen(event.dueAt, event.timezone);
    const dateKey = event.dueAt ? event.dueAt.slice(0, 10) : "unknown";
    const existing = groups.get(dateKey);
    if (existing) existing.items.push(event);
    else groups.set(dateKey, { dateLine: when.dateLine, items: [event] });
  }
  return [...groups.entries()].map(([dateKey, group]) => ({ dateKey, ...group }));
}

export function formatDurationMinutes(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${hours}h ${rest}m`;
}

export function timeStatusLabel(status: string | null | undefined): string {
  return humanizeKey(status) || "Suggested";
}

export function timeSourceLabel(source: string | null | undefined): string {
  if (source === "manual") return "Entered by you";
  if (source === "suggested" || source === "conversation") return "From chat";
  return humanizeKey(source);
}

export function timeSummary(entries: Array<{ minutes: number; status: string }>): {
  unpostedMinutes: number;
  postedMinutes: number;
  unpostedCount: number;
  postedCount: number;
} {
  let unpostedMinutes = 0;
  let postedMinutes = 0;
  let unpostedCount = 0;
  let postedCount = 0;
  for (const entry of entries) {
    if (entry.status === "posted") {
      postedMinutes += entry.minutes;
      postedCount += 1;
    } else if (entry.status !== "rejected") {
      unpostedMinutes += entry.minutes;
      unpostedCount += 1;
    }
  }
  return { unpostedMinutes, postedMinutes, unpostedCount, postedCount };
}

export function invoiceStatusLabel(status: string | null | undefined): string {
  return humanizeKey(status) || "Draft";
}

export function billingSummary(invoices: Array<{ status: string }>): {
  draftCount: number;
  issuedCount: number;
} {
  return {
    draftCount: invoices.filter((row) => row.status === "draft").length,
    issuedCount: invoices.filter((row) => row.status === "issued").length,
  };
}

export function inboxStatusLabel(status: string | null | undefined): string {
  return humanizeKey(status) || "Pending";
}

export function inboxBucket(status: string | null | undefined): "pending" | "filed" | "other" {
  if (status === "pending") return "pending";
  if (status === "filed") return "filed";
  return "other";
}

export function filterInbox(emails: FirmInboxEmail[], tab: string): FirmInboxEmail[] {
  if (tab === "pending") return emails.filter((email) => inboxBucket(email.status) === "pending");
  if (tab === "filed") return emails.filter((email) => inboxBucket(email.status) === "filed");
  return emails;
}

export function roleLabel(roleKey: string | null | undefined): string {
  return humanizeKey(roleKey) || "Member";
}

export function inviteStatusLabel(invite: {
  acceptedAt: string | null;
  revokedAt: string | null;
}): string {
  if (invite.acceptedAt) return "Accepted";
  if (invite.revokedAt) return "Revoked";
  return "Pending";
}

export function holdStatusLabel(releasedAt: string | null | undefined): string {
  return releasedAt ? "Released" : "Active";
}

export function holdScopeLabel(
  matterId: string | null | undefined,
  matterTitle?: string | null,
): string {
  if (!matterId) return "Whole organization";
  return matterTitle?.trim() || "Case";
}

export function deletionStatusLabel(status: string | null | undefined): string {
  return humanizeKey(status) || "Pending";
}

export function researchSessionKindLabel(matterId: string | null | undefined): string {
  return matterId ? "Linked to case" : "Firm research";
}

export function authorityRelationshipLabel(value: string | null | undefined): string {
  if (value === "controlling") return "Controlling";
  if (value === "persuasive") return "Persuasive";
  if (value === "out_of_jurisdiction") return "Other jurisdiction";
  if (value === "unknown") return "Relationship unknown";
  return humanizeKey(value);
}

export function formatShortDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
