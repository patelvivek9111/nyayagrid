"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, PageHeader, Panel } from "@nyayagrid/ui";

export default function AcceptInvitePage() {
  const [token, setToken] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") ?? "";
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function accept(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/v1/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Accept failed");
      setMessage("Invitation accepted. Open the client portal or professional workspace.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <PageHeader
        eyebrow="NyayaGrid"
        title="Accept invitation"
        description="Use the token from your invite email or the Settings page. The token cannot be recovered after it is created."
      />
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      {message ? <p className="mb-4 text-sm text-ink/80">{message}</p> : null}
      <Panel title="Token">
        <form className="flex flex-col gap-3" onSubmit={accept}>
          <textarea
            className="min-h-[80px] rounded border border-line px-2 py-1.5 text-sm"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
          <Button type="submit" disabled={busy || !token.trim()}>
            Accept invite
          </Button>
        </form>
        <p className="mt-3 text-sm">
          <Link className="font-semibold text-accent underline" href="/portal">
            Client portal
          </Link>
        </p>
      </Panel>
    </main>
  );
}
