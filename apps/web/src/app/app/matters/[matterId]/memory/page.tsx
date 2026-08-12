"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { MatterShell } from "@/components/shell";
import { Badge, Button, Panel } from "@nyayagrid/ui";

export default function MatterMemoryPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [memories, setMemories] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [memoryType, setMemoryType] = useState("verified_context");
  const [importance, setImportance] = useState("normal");
  const [hint, setHint] = useState("");
  const [supersedeId, setSupersedeId] = useState("");

  async function load() {
    const res = await fetch(`/api/v1/matters/${matterId}/memory`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load memory");
    setMemories(json.memories ?? []);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [matterId]);

  const active = memories.filter(
    (m) => (m.status === "approved" || m.status === "edited_and_approved") && !m.supersededBy,
  );
  const proposed = memories.filter((m) => m.status === "proposed");
  const historical = memories.filter(
    (m) => m.status === "superseded" || m.status === "archived" || m.status === "rejected",
  );

  async function createManual(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          memoryType,
          importance,
          supersedesId: supersedeId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Create failed");
      setTitle("");
      setContent("");
      setSupersedeId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function propose() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "propose", hint }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Propose failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Propose failed");
    } finally {
      setBusy(false);
    }
  }

  async function review(memoryId: string, action: "approve" | "reject" | "archive") {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/memory/${memoryId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Review failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <MatterShell matterId={matterId} title="Nyaya Memory">
      {error ? <p className="mb-3 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge>{active.length} active</Badge>
        <Badge>{proposed.length} proposed</Badge>
        <Badge>{historical.length} historical</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Active memories">
          {active.length === 0 ? (
            <p className="text-sm text-ink/70">No active memories yet.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {active.map((memory) => (
                <li key={memory.id} className="rounded border border-line p-3">
                  <div className="font-semibold">{memory.title}</div>
                  <div className="text-xs text-ink/60">
                    {memory.memoryType} · {memory.importance} · {memory.origin}
                  </div>
                  <p className="mt-1">{memory.content}</p>
                  <Button
                    className="mt-2"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => review(memory.id, "archive")}
                  >
                    Archive
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Proposed memories">
          <div className="mb-3 flex gap-2">
            <input
              className="flex-1 rounded border border-line px-2 py-1.5 text-sm"
              placeholder="Optional hint for proposal"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
            />
            <Button disabled={busy} onClick={propose}>
              Propose
            </Button>
          </div>
          {proposed.length === 0 ? (
            <p className="text-sm text-ink/70">
              No proposals. Nyaya may suggest durable context, but nothing is saved without
              approval.
            </p>
          ) : (
            <ul className="space-y-3 text-sm">
              {proposed.map((memory) => (
                <li key={memory.id} className="rounded border border-line p-3">
                  <div className="font-semibold">{memory.title}</div>
                  <p className="mt-1">{memory.content}</p>
                  <div className="mt-2 flex gap-2">
                    <Button disabled={busy} onClick={() => review(memory.id, "approve")}>
                      Approve
                    </Button>
                    <Button
                      disabled={busy}
                      variant="ghost"
                      onClick={() => review(memory.id, "reject")}
                    >
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Create / supersede memory">
          <form className="space-y-2" onSubmit={createManual}>
            <input
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <textarea
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
              placeholder="Content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              rows={4}
            />
            <select
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
              value={memoryType}
              onChange={(e) => setMemoryType(e.target.value)}
            >
              <option value="verified_context">verified_context</option>
              <option value="strategic_note">strategic_note</option>
              <option value="entity_resolution">entity_resolution</option>
              <option value="document_significance">document_significance</option>
              <option value="factual_caveat">factual_caveat</option>
              <option value="user_instruction">user_instruction</option>
              <option value="matter_preference">matter_preference</option>
              <option value="procedural_context">procedural_context</option>
              <option value="other">other</option>
            </select>
            <select
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
              value={importance}
              onChange={(e) => setImportance(e.target.value)}
            >
              <option value="low">low</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
            <select
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
              value={supersedeId}
              onChange={(e) => setSupersedeId(e.target.value)}
            >
              <option value="">Do not supersede</option>
              {active.map((m) => (
                <option key={m.id} value={m.id}>
                  Supersede: {m.title}
                </option>
              ))}
            </select>
            <Button disabled={busy} type="submit">
              Save approved memory
            </Button>
          </form>
        </Panel>

        <Panel title="Historical / superseded">
          {historical.length === 0 ? (
            <p className="text-sm text-ink/70">No superseded or archived memories.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {historical.map((memory) => (
                <li key={memory.id}>
                  <span className="font-semibold">{memory.title}</span> · {memory.status}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </MatterShell>
  );
}
