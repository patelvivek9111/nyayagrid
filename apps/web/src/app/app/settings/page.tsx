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
  FirmStatusText,
  FirmTabs,
} from "@/components/ux/firm-workspace";
import { SignOutControl } from "@/components/sign-out-control";
import { inviteStatusLabel, roleLabel } from "@/lib/firm-workspace-ux";

type InviteRow = {
  id: string;
  email: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
};
type MemberRow = { userId: string; email: string; name: string | null; roleKey: string };
type MatterRow = { id: string; title: string };
type NotificationRow = {
  id: string;
  title: string;
  body: string;
  kind: string;
  readAt: string | null;
};

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
  const [tab, setTab] = useState("members");
  const [inviteOpen, setInviteOpen] = useState(false);

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
    <ProfessionalShell>
      <FirmPageHeader
        title="Settings"
        description="Who has access to this workspace, and what they can do."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SignOutControl className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink/80 hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
            <Button type="button" disabled={!organizationId} onClick={() => setInviteOpen(true)}>
              + Invite member
            </Button>
          </div>
        }
      />
      <div className="mt-4">
        <FirmNotice>
          Holds, privacy, and training consent live on a separate page.{" "}
          <a className="font-semibold text-accent underline" href="/app/compliance">
            Holds & privacy
          </a>
        </FirmNotice>
      </div>
      {error ? (
        <div className="mt-4">
          <FirmError message={error} />
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        <FirmTabs
          value={tab}
          onChange={setTab}
          options={[
            { id: "members", label: "Members & access" },
            { id: "access", label: "Case access" },
            { id: "invitations", label: "Invitations", count: invites.length },
            { id: "notifications", label: "Notifications" },
          ]}
        />

        {tab === "members" ? (
          members.length === 0 ? (
            <FirmEmpty
              title="No members found."
              description="Invite a lawyer, staff member, or client guest to this workspace."
            />
          ) : (
            <ul className="space-y-2">
              {members.map((member) => (
                <li key={member.userId}>
                  <FirmRow
                    title={member.name?.trim() || member.email}
                    subtitle={member.email}
                    status={<FirmStatusText>{roleLabel(member.roleKey)}</FirmStatusText>}
                  />
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "access" ? (
          <div className="space-y-3 rounded-xl border border-line bg-white/80 p-4">
            <p className="text-sm text-ink/70">
              Client guests only see cases they are assigned to. Owners see every case.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <select
                className="rounded border border-line px-2 py-1.5 text-sm"
                value={assignUserId}
                onChange={(e) => setAssignUserId(e.target.value)}
                aria-label="Member"
              >
                <option value="">Member</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name?.trim() || member.email} ({roleLabel(member.roleKey)})
                  </option>
                ))}
              </select>
              <select
                className="rounded border border-line px-2 py-1.5 text-sm"
                value={assignMatterId}
                onChange={(e) => setAssignMatterId(e.target.value)}
                aria-label="Case"
              >
                <option value="">Case</option>
                {matters.map((matter) => (
                  <option key={matter.id} value={matter.id}>
                    {matter.title}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                disabled={busy || !assignUserId || !assignMatterId}
                onClick={assignToMatter}
              >
                Assign to case
              </Button>
            </div>
          </div>
        ) : null}

        {tab === "invitations" ? (
          invites.length === 0 ? (
            <FirmEmpty
              title="No invitations yet."
              description="Invite someone with an email and a role. Guest access is limited to assigned cases."
            />
          ) : (
            <ul className="space-y-2">
              {invites.map((inviteRow) => (
                <li key={inviteRow.id}>
                  <FirmRow
                    title={inviteRow.email}
                    status={<FirmStatusText>{inviteStatusLabel(inviteRow)}</FirmStatusText>}
                  />
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "notifications" ? (
          notifications.length === 0 ? (
            <FirmEmpty
              title="No in-app notifications yet."
              description="When this workspace has alerts, they will appear here."
            />
          ) : (
            <ul className="space-y-2">
              {notifications.map((note) => (
                <li key={note.id}>
                  <FirmRow title={note.title} subtitle={note.body} />
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <IntelligenceDialog
        open={inviteOpen}
        title="Invite member"
        description="Choose a role. Client guests only see cases they are assigned to."
        onClose={() => setInviteOpen(false)}
      >
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
            aria-label="Role"
          >
            <option value="client_guest">Client guest</option>
            <option value="lawyer">Lawyer</option>
            <option value="staff">Staff</option>
            <option value="owner">Organization owner</option>
          </select>
          <Button type="submit" disabled={busy}>
            Create invite
          </Button>
        </form>
        {lastToken ? (
          <p className="mt-3 break-all rounded border border-line bg-accent-soft/40 px-3 py-2 text-xs">
            Invite token (shown once): {lastToken}. Accept at <code>/invites/accept?token=…</code>
          </p>
        ) : null}
      </IntelligenceDialog>
    </ProfessionalShell>
  );
}
