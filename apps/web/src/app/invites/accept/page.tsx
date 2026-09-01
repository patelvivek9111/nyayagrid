"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@nyayagrid/ui";
import { userFacingInviteMessage } from "@nyayagrid/auth/user-facing";
import { AuthShell } from "@/components/ux/auth-shell";
import { safeAuthReturnTo } from "@/lib/auth-return";

export default function AcceptInvitePage() {
  const router = useRouter();
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
      if (res.status === 401) {
        const returnTo = safeAuthReturnTo(
          `/invites/accept${token.trim() ? `?token=${encodeURIComponent(token.trim())}` : ""}`,
        );
        router.replace(`/sign-in?returnTo=${encodeURIComponent(returnTo)}&reason=session`);
        return;
      }
      if (!res.ok) {
        const code = typeof data?.error?.code === "string" ? data.error.code : "";
        throw new Error(userFacingInviteMessage(code));
      }
      setMessage("Invitation accepted. Opening your workspace…");
      router.push("/app/cases");
    } catch (err) {
      setError(err instanceof Error ? err.message : userFacingInviteMessage("INTERNAL"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Accept invitation"
      description="Sign in with the email your firm invited, then confirm this invitation to join the workspace."
    >
      {error ? (
        <p id="invite-error" className="text-sm text-[var(--ng-danger)]" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-ink/80" role="status">
          {message}
        </p>
      ) : null}
      <form className="flex flex-col gap-3" onSubmit={accept}>
        <label className="text-sm font-semibold text-ink" htmlFor="invite-token">
          Invitation
          <textarea
            id="invite-token"
            className="mt-1 min-h-[80px] w-full rounded border border-line px-2 py-1.5 text-sm font-normal"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            autoComplete="off"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "invite-token-help invite-error" : "invite-token-help"}
          />
        </label>
        <p id="invite-token-help" className="text-xs text-ink/55">
          Paste the invitation from your email. If it no longer works, ask your administrator for a
          new invitation.
        </p>
        <Button type="submit" disabled={busy || !token.trim()}>
          {busy ? "Accepting…" : "Accept invitation"}
        </Button>
      </form>
      <p className="text-sm text-ink/60">
        Need to sign in first?{" "}
        <Link className="font-semibold text-accent underline" href="/sign-in">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
