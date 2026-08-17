"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Badge, Button, Panel } from "@nyayagrid/ui";

type InviteRow = {
  id: string;
  email: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
};
type MemberRow = { userId: string; email: string; name: string | null; roleKey: string };
type MatterRow = { id: string; title: string };
type NotificationRow = { id: string; title: string; body: string; kind: string; readAt: string | null };

export default function SettingsPage() {
  const { organizationId } = useActiveOrganization();
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState("client_guest");
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignMatterId, setAssignMatterId] = useState("");
  const [lastToken, setLastToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(orgId: string) {
    const [invitesRes, membersRes, mattersRes, notesRes] = await Promise.all([
      fetch(`/api/v1/organizations/${orgId}/invites`),
      fetch(`/api/v1/organizations/${orgId}/members`),
      fetch(`/api/v1/matters?organizationId=${orgId}`),
      fetch(`/api/v1/notifications?organizationId=${orgId}`),
    ]);
    const invitesData = await invitesRes.json();
    const membersData = await membersRes.json();
    const mattersData = await mattersRes.json();
    const notesData = await notesRes.json();
    if (invitesRes.ok) setInvites(invitesData.invites ?? []);
    if (membersRes.ok) setMembers(membersData.members ?? []);
    if (mattersRes.ok) setMatters(mattersData.matters ?? []);
    if (notesRes.ok) setNotifications(notesData.notifications ?? []);
    if (!invitesRes.ok && !membersRes.ok) {
      throw new Error(invitesData?.error?.message ?? "Failed to load settings");
    }
  }

  useEffect(() => {
    if (!organizationId) return;
    load(organizationId).catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, [organizationId]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setError("");
    setLastToken(null);
    try {
      const res = await fetch(`/api/v1/organizations/${organizationId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, roleKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Invite failed");
      setLastToken(data.token ?? null);
      setEmail("");
      await load(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function assignToMatter() {
    if (!assignMatterId || !assignUserId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${assignMatterId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: assignUserId, access: "read" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Assign failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProfessionalShell title="Settings">
      <div className="space-y-4">
        <Panel title="Members and roles">
          <p className="text-sm text-ink/70">
            NyayaGrid owns authorization. Organization memberships, roles, and capabilities are stored
            in PostgreSQL and enforced server-side. Identity providers authenticate only. SMTP is
            console-only in development. SSO (SAML/OIDC) is configured in Clerk Enterprise when a
            live Clerk app exists — see the in-repo user lifecycle note. Compliance (holds, audit
            export, training consent) is a separate screen.
          </p>
          <p className="mt-2 text-sm">
            <a className="font-semibold text-accent underline" href="/app/compliance">
              Compliance (holds, deletion, training consent)
            </a>
          </p>
        </Panel>

        {error ? <p className="text-sm text-[var(--ng-danger)]">{error}</p> : null}

        <Panel title="Invite a member">
          <form className="flex flex-col gap-3" onSubmit={invite}>
            <input
              className="rounded border border-line px-2 py-1.5 text-sm"
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <select
              className="rounded border border-line px-2 py-1.5 text-sm"
              value={roleKey}
              onChange={(e) => setRoleKey(e.target.value)}
            >
              <option value="client_guest">Client Guest</option>
              <option value="lawyer">Lawyer</option>
              <option value="staff">Staff</option>
              <option value="owner">Organization Owner</option>
            </select>
            <Button type="submit" disabled={busy}>
              Create invite
            </Button>
          </form>
          {lastToken ? (
            <p className="mt-3 break-all rounded border border-line bg-accent-soft/40 px-3 py-2 text-xs">
              Invite token (shown once): {lastToken}. Accept at{" "}
              <code>/invites/accept?token=…</code>
            </p>
          ) : null}
          <ul className="mt-3 space-y-1 text-sm">
            {invites.map((inviteRow) => (
              <li key={inviteRow.id} className="flex justify-between gap-2">
                <span>{inviteRow.email}</span>
                <Badge>
                  {inviteRow.acceptedAt ? "accepted" : inviteRow.revokedAt ? "revoked" : "pending"}
                </Badge>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Assign a member to a case">
          <p className="mb-3 text-sm text-ink/70">
            Client guests only see cases they are assigned to. Owners see every case.
          </p>
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded border border-line px-2 py-1.5 text-sm"
              value={assignUserId}
              onChange={(e) => setAssignUserId(e.target.value)}
            >
              <option value="">Member</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.email} ({member.roleKey})
                </option>
              ))}
            </select>
            <select
              className="rounded border border-line px-2 py-1.5 text-sm"
              value={assignMatterId}
              onChange={(e) => setAssignMatterId(e.target.value)}
            >
              <option value="">Case</option>
              {matters.map((matter) => (
                <option key={matter.id} value={matter.id}>
                  {matter.title}
                </option>
              ))}
            </select>
            <Button type="button" disabled={busy || !assignUserId || !assignMatterId} onClick={assignToMatter}>
              Assign (read)
            </Button>
          </div>
        </Panel>

        <Panel title="Notifications">
          {notifications.length === 0 ? (
            <p className="text-sm text-ink/70">No in-app notifications yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {notifications.map((note) => (
                <li key={note.id} className="rounded border border-line px-3 py-2">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{note.title}</span>
                    <Badge>{note.kind}</Badge>
                  </div>
                  <p className="text-xs text-ink/60">{note.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </ProfessionalShell>
  );
}
