"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Badge, Panel } from "@nyayagrid/ui";

type CalendarEvent = {
  id: string;
  kind: "deadline" | "task";
  title: string;
  dueAt: string | null;
  timezone: string | null;
  matterId: string;
  matterTitle: string;
};

export default function CalendarPage() {
  const { organizationId } = useActiveOrganization();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!organizationId) return;
    fetch(`/api/v1/calendar?organizationId=${organizationId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load calendar");
        setEvents(data.events ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [organizationId]);

  return (
    <ProfessionalShell title="Calendar">
      <p className="mb-4 text-sm text-ink/70">
        Verified deadlines (with timezone when recorded) and task due dates for cases you can
        access. This is not Outlook or Google Calendar sync.
      </p>
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      <Panel title="Upcoming">
        {events.length === 0 ? (
          <p className="text-sm text-ink/70">No dated deadlines or tasks yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {events.map((event) => (
              <li key={`${event.kind}-${event.id}`} className="rounded border border-line px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link className="font-semibold text-accent underline" href={`/app/cases/${event.matterId}`}>
                    {event.title}
                  </Link>
                  <Badge>{event.kind}</Badge>
                </div>
                <p className="text-xs text-ink/60">
                  {event.matterTitle}
                  {event.dueAt
                    ? ` · ${event.dueAt}${event.timezone ? ` (${event.timezone})` : ""}`
                    : " · date unknown"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </ProfessionalShell>
  );
}
