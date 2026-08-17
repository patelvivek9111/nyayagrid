"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Badge, Button, Panel } from "@nyayagrid/ui";

type MatterRow = { id: string; title: string };
type ConversationRow = { id: string; title: string | null };
type TimeEntry = {
  id: string;
  matterId: string;
  description: string;
  minutes: number;
  source: string;
  status: string;
};

export default function TimePage() {
  const { organizationId } = useActiveOrganization();
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [matterId, setMatterId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState("6");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  return (
    <ProfessionalShell title="Time">
      <p className="mb-4 text-sm text-ink/70">
        Suggestions stay unposted until a lawyer posts them. This is not a billable-rate engine.
      </p>
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title="New entry (suggested)">
          <form className="flex flex-col gap-3" onSubmit={createManual}>
            <select
              className="rounded border border-line px-2 py-1.5 text-sm"
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
            <input
              className="rounded border border-line px-2 py-1.5 text-sm"
              placeholder="What did you work on?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
            <input
              className="rounded border border-line px-2 py-1.5 text-sm"
              type="number"
              min={1}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              Save suggestion
            </Button>
          </form>
        </Panel>
        <Panel title="Suggest from chat">
          <div className="flex flex-col gap-3">
            <select
              className="rounded border border-line px-2 py-1.5 text-sm"
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
            >
              <option value="">Select a case chat</option>
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.title || conversation.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <Button type="button" disabled={busy || !conversationId} onClick={suggestFromChat}>
              Suggest from chat
            </Button>
          </div>
        </Panel>
      </div>

      <Panel title="Entries">
        {entries.length === 0 ? (
          <p className="text-sm text-ink/70">No time entries yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {entries.map((entry) => (
              <li key={entry.id} className="rounded border border-line px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{entry.description}</span>
                  <Badge>{entry.status}</Badge>
                </div>
                <p className="text-xs text-ink/50">
                  {entry.minutes} minutes · {entry.source}
                </p>
                {entry.status === "suggested" ? (
                  <div className="mt-2 flex gap-2">
                    <Button type="button" disabled={busy} onClick={() => review(entry.id, "post")}>
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
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </ProfessionalShell>
  );
}
