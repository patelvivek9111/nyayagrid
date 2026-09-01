"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Button } from "@nyayagrid/ui";
import { IntelligenceDialog } from "@/components/ux/case-intelligence";
import {
  FirmEmpty,
  FirmError,
  FirmNotice,
  FirmPageHeader,
  FirmRow,
  FirmStatRow,
  FirmStatusText,
} from "@/components/ux/firm-workspace";
import {
  formatDurationMinutes,
  formatShortDate,
  timeSourceLabel,
  timeStatusLabel,
  timeSummary,
  type FirmTimeEntry,
} from "@/lib/firm-workspace-ux";

type MatterRow = { id: string; title: string };
type ConversationRow = { id: string; title: string | null };

export default function TimePage() {
  const { organizationId } = useActiveOrganization();
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [entries, setEntries] = useState<FirmTimeEntry[]>([]);
  const [matterId, setMatterId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState("6");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  async function load(orgId: string) {
    const [mattersRes, entriesRes] = await Promise.all([
      fetch(`/api/v1/matters?organizationId=${orgId}`),
      fetch(`/api/v1/time-entries?organizationId=${orgId}`),
    ]);
    const mattersData = await mattersRes.json();
    const entriesData = await entriesRes.json();
    if (!mattersRes.ok) throw new Error(mattersData?.error?.message ?? "Failed to load cases");
    if (!entriesRes.ok) throw new Error(entriesData?.error?.message ?? "Failed to load time");
    setMatters(mattersData.matters ?? []);
    setEntries(entriesData.entries ?? []);
  }

  useEffect(() => {
    if (!organizationId) return;
    load(organizationId).catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, [organizationId]);

  useEffect(() => {
    if (!matterId) {
      setConversations([]);
      return;
    }
    fetch(`/api/v1/matters/${matterId}/conversations`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) setConversations(data.conversations ?? []);
      })
      .catch(() => undefined);
  }, [matterId]);

  async function createManual(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || !matterId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          matterId,
          description,
          minutes: Number(minutes),
          source: "manual",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to create entry");
      setDescription("");
      setAddOpen(false);
      await load(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function suggestFromChat() {
    if (!organizationId || !matterId || !conversationId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/time-entries/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          matterId,
          conversationId,
          minutes: Number(minutes) || 6,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to suggest");
      setSuggestOpen(false);
      await load(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function review(entryId: string, action: "post" | "reject") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/time-entries/${entryId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to update");
      if (organizationId) await load(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const summary = timeSummary(entries);
  const matterTitle = (id: string) => matters.find((m) => m.id === id)?.title ?? "Case";

  return (
    <ProfessionalShell>
      <FirmPageHeader
        title="Time"
        description="Work recorded for this workspace. Suggestions stay unposted until a lawyer posts them."
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={!organizationId}
              onClick={() => setSuggestOpen(true)}
            >
              Suggest from chat
            </Button>
            <Button type="button" disabled={!organizationId} onClick={() => setAddOpen(true)}>
              + Add time entry
            </Button>
          </>
        }
      />
      <div className="mt-4">
        <FirmNotice>
          This is not a billable-rate engine. Totals are minutes, not amounts.
        </FirmNotice>
      </div>
      {error ? (
        <div className="mt-4">
          <FirmError message={error} />
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        <FirmStatRow
          items={[
            {
              label: "Unposted",
              value: `${formatDurationMinutes(summary.unpostedMinutes)} · ${summary.unpostedCount}`,
            },
            {
              label: "Posted",
              value: `${formatDurationMinutes(summary.postedMinutes)} · ${summary.postedCount}`,
            },
          ]}
        />

        {entries.length === 0 ? (
          <FirmEmpty
            title="No time entries yet."
            description="Record work on a case, or create a suggested entry from a case chat. Suggestions are not posted until you confirm them."
            action={
              <Button type="button" onClick={() => setAddOpen(true)}>
                + Add time entry
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <FirmRow
                  title={matterTitle(entry.matterId)}
                  subtitle={entry.description}
                  meta={`${formatDurationMinutes(entry.minutes)}${formatShortDate(entry.createdAt) ? ` · ${formatShortDate(entry.createdAt)}` : ""} · ${timeSourceLabel(entry.source)}`}
                  status={<FirmStatusText>{timeStatusLabel(entry.status)}</FirmStatusText>}
                  actions={
                    entry.status === "suggested" ? (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => review(entry.id, "post")}
                        >
                          Post
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => review(entry.id, "reject")}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : null
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <IntelligenceDialog
        open={addOpen}
        title="Add time entry"
        description="Record work on a case. Duration is stored in minutes."
        onClose={() => setAddOpen(false)}
      >
        <form className="flex flex-col gap-3" onSubmit={createManual}>
          <label className="text-sm font-semibold">
            Case
            <select
              className="mt-1 block w-full rounded border border-line px-2 py-1.5 font-normal"
              value={matterId}
              onChange={(e) => setMatterId(e.target.value)}
              required
            >
              <option value="">Select a case</option>
              {matters.map((matter) => (
                <option key={matter.id} value={matter.id}>
                  {matter.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Work description
            <input
              className="mt-1 block w-full rounded border border-line px-2 py-1.5 font-normal"
              placeholder="What did you work on?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </label>
          <label className="text-sm font-semibold">
            Duration (minutes)
            <input
              className="mt-1 block w-full rounded border border-line px-2 py-1.5 font-normal"
              type="number"
              min={1}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            Save entry
          </Button>
        </form>
      </IntelligenceDialog>

      <IntelligenceDialog
        open={suggestOpen}
        title="Suggest from chat"
        description="Create a suggested time entry from a case chat. It stays unposted until you post it."
        onClose={() => setSuggestOpen(false)}
      >
        <div className="flex flex-col gap-3">
          <label className="text-sm font-semibold">
            Case
            <select
              className="mt-1 block w-full rounded border border-line px-2 py-1.5 font-normal"
              value={matterId}
              onChange={(e) => setMatterId(e.target.value)}
            >
              <option value="">Select a case</option>
              {matters.map((matter) => (
                <option key={matter.id} value={matter.id}>
                  {matter.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Case chat
            <select
              className="mt-1 block w-full rounded border border-line px-2 py-1.5 font-normal"
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
            >
              <option value="">Select a case chat</option>
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.title || "Untitled chat"}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" disabled={busy || !conversationId} onClick={suggestFromChat}>
            Create suggestion
          </Button>
        </div>
      </IntelligenceDialog>
    </ProfessionalShell>
  );
}
