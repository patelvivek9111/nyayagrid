"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { FilterChipBar } from "@/components/ux/case-intelligence";
import { VerifiedBadge } from "@/components/ux/trust";
import {
  FirmEmpty,
  FirmError,
  FirmNotice,
  FirmPageHeader,
  FirmRow,
  FirmStatusText,
} from "@/components/ux/firm-workspace";
import {
  calendarKindLabel,
  calendarTrustLabel,
  filterCalendarEvents,
  formatCalendarWhen,
  groupCalendarEventsByDate,
  type FirmCalendarEvent,
} from "@/lib/firm-workspace-ux";

export default function CalendarPage() {
  const { organizationId } = useActiveOrganization();
  const [events, setEvents] = useState<FirmCalendarEvent[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

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

  const visible = useMemo(() => filterCalendarEvents(events, filter), [events, filter]);
  const groups = useMemo(() => groupCalendarEventsByDate(visible), [visible]);

  return (
    <ProfessionalShell>
      <FirmPageHeader
        title="Calendar"
        description="What is coming up on cases you can access — verified deadlines and task due dates."
      />
      <div className="mt-4">
        <FirmNotice>
          This list is built from case deadlines and tasks. It is not Outlook or Google Calendar
          sync.
        </FirmNotice>
      </div>
      {error ? (
        <div className="mt-4">
          <FirmError message={error} />
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        <FilterChipBar
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All", count: events.length },
            { id: "deadlines", label: "Deadlines" },
            { id: "tasks", label: "Tasks" },
          ]}
        />

        {visible.length === 0 ? (
          <FirmEmpty
            title="No upcoming dated work."
            description="Verified deadlines and task due dates will appear here."
          />
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.dateKey}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/45">
                  {group.dateLine}
                </h2>
                <ul className="space-y-2">
                  {group.items.map((event) => {
                    const when = formatCalendarWhen(event.dueAt, event.timezone);
                    const verified = event.source === "verified_deadline";
                    return (
                      <li key={`${event.kind}-${event.id}`}>
                        <FirmRow
                          title={event.title}
                          subtitle={event.matterTitle}
                          meta={when.timeLine ?? undefined}
                          status={
                            verified ? (
                              <VerifiedBadge>
                                {calendarTrustLabel(event.source, event.kind)}
                              </VerifiedBadge>
                            ) : (
                              <FirmStatusText>{calendarKindLabel(event.kind)}</FirmStatusText>
                            )
                          }
                          actions={
                            <Link
                              href={`/app/cases/${event.matterId}`}
                              className="text-xs font-semibold text-accent underline"
                            >
                              Open case
                            </Link>
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </ProfessionalShell>
  );
}
