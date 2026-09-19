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
  FirmTabs,
} from "@/components/ux/firm-workspace";
import { SignOutControl } from "@/components/sign-out-control";
import { refreshClerkSessionKeepAlive } from "@/components/clerk-session-keep-alive";
import { inviteStatusLabel, roleLabel } from "@/lib/firm-workspace-ux";
import { USER_FACING_AUTH } from "@nyayagrid/auth/user-facing";
import { formatByteSize, formatTokenCount } from "@nyayagrid/platform/usage-format";

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

type AccountPayload = {
  profile: { name: string | null; email: string };
  organization: { name: string; slug: string };
  membership: { roleKey: string; roleName: string };
  permissions: {
    manageOrganization: boolean;
    inviteMembers: boolean;
    manageCompliance: boolean;
    editMatters: boolean;
  };
  security: { profileUrl: string | null };
  plan: {
    name: string;
    access: string;
    ai: string;
    storage: string;
    seats: string;
    billingLive: boolean;
    note: string;
  };
};

type UsagePayload = {
  period: { key: string; label: string };
  completeness: string;
  scope: "personal" | "organization";
  canViewOrganizationUsage: boolean;
  ai: {
    modelRequests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    byFeature: Record<
      "ask" | "research" | "draft" | "analysis" | "compare" | "processing" | "other",
      number
    >;
  };
  byMember?: Array<{
    email: string;
    name: string | null;
    modelRequests: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  documents?: { total: number; uploadedThisPeriod: number; storageBytes: number };
  cases?: { active: number; createdThisPeriod: number };
  members?: { active: number };
};

const FEATURE_LABELS = {
  ask: "Ask Nyaya",
  research: "Research",
  draft: "Draft",
  analysis: "Analysis",
  compare: "Compare",
  processing: "Document processing",
  other: "Other",
} as const;

export default function SettingsPage() {
  const { organizationId } = useActiveOrganization();
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState("lawyer");
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignMatterId, setAssignMatterId] = useState("");
  const [lastInvite, setLastInvite] = useState<{
    token: string;
    emailDelivered: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("account");
  const [firmTab, setFirmTab] = useState("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [account, setAccount] = useState<AccountPayload | null>(null);
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [usagePeriod, setUsagePeriod] = useState<"current" | "previous">("current");
  const [usageScope, setUsageScope] = useState<"organization" | "me">("organization");
  const [displayName, setDisplayName] = useState("");

  const canInvite = account?.permissions.inviteMembers === true;
  const canManage = account?.permissions.manageOrganization === true;
  const canAssign = account?.permissions.editMatters === true;

  async function loadAccount(orgId: string) {
    const res = await fetch(`/api/v1/organizations/${orgId}/account`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load account");
    setAccount(data);
    setDisplayName(data.profile?.name ?? "");
    return data as AccountPayload;
  }

  async function loadUsage(orgId: string, period: "current" | "previous", scope: "organization" | "me") {
    const res = await fetch(
      `/api/v1/organizations/${orgId}/usage?period=${period}&scope=${scope}`,
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load usage");
    setUsage(data);
  }

  async function loadFirm(orgId: string, permissions: AccountPayload["permissions"]) {
    const [invitesRes, membersRes, mattersRes, notesRes] = await Promise.all([
      permissions.inviteMembers
        ? fetch(`/api/v1/organizations/${orgId}/invites`)
        : Promise.resolve(null),
      permissions.manageOrganization
        ? fetch(`/api/v1/organizations/${orgId}/members`)
        : Promise.resolve(null),
      fetch(`/api/v1/matters?organizationId=${orgId}`),
      fetch(`/api/v1/notifications?organizationId=${orgId}`),
    ]);
    if (invitesRes) {
      const invitesData = await invitesRes.json();
      if (invitesRes.ok) setInvites(invitesData.invites ?? []);
    } else {
      setInvites([]);
    }
    if (membersRes) {
      const membersData = await membersRes.json();
      if (membersRes.ok) setMembers(membersData.members ?? []);
    } else {
      setMembers([]);
    }
    const mattersData = mattersRes ? await mattersRes.json() : {};
    const notesData = notesRes ? await notesRes.json() : {};
    if (mattersRes.ok) setMatters(mattersData.matters ?? []);
    if (notesRes.ok) setNotifications(notesData.notifications ?? []);
  }

  async function load(orgId: string, period = usagePeriod, scope = usageScope) {
    setLoading(true);
    const nextAccount = await loadAccount(orgId);
    const resolvedScope = nextAccount.permissions.manageOrganization ? scope : "me";
    if (!nextAccount.permissions.manageOrganization) {
      setFirmTab("access");
      setUsageScope("me");
    }
    await Promise.all([
      loadUsage(orgId, period, resolvedScope),
      loadFirm(orgId, nextAccount.permissions),
    ]);
    setLoading(false);
  }

  useEffect(() => {
    if (!organizationId) return;
    load(organizationId).catch((err) => {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Failed");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: displayName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Could not update name");
      if (account) {
        setAccount({ ...account, profile: { ...account.profile, name: data.name } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || !canInvite) return;
    setBusy(true);
    setError("");
    setLastInvite(null);
    try {
      const res = await fetch(`/api/v1/organizations/${organizationId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, roleKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Invite failed");
      if (typeof data.token === "string" && data.token.length > 0) {
        setLastInvite({
          token: data.token,
          emailDelivered: data.emailDelivered === true,
        });
      }
      setEmail("");
      await loadFirm(organizationId, account!.permissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function ensureClerkSessionForMutation(): Promise<boolean> {
    const keep = await refreshClerkSessionKeepAlive();
    if (keep === "handshake") return false;
    if (keep === "signed-out") {
      setError(USER_FACING_AUTH.unauthenticated);
      return false;
    }
    return true;
  }

  async function assignToMatter() {
    if (!organizationId || !account) return;
    if (!assignMatterId || !assignUserId || !canAssign) {
      setError("Select a client guest and a case before assigning.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (!(await ensureClerkSessionForMutation())) return;
      const res = await fetch(`/api/v1/matters/${assignMatterId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: assignUserId, access: "read" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data?.error?.code === "CLERK_HANDSHAKE") {
        window.location.reload();
        return;
      }
      if (res.status === 401) {
        throw new Error(USER_FACING_AUTH.unauthenticated);
      }
      if (res.status === 403) {
        throw new Error(data?.error?.message ?? USER_FACING_AUTH.forbidden);
      }
      if (!res.ok) throw new Error(data?.error?.message ?? "Assign failed");
      setSuccess("Case access assigned.");
      setAssignUserId("");
      setAssignMatterId("");
      await loadFirm(organizationId, account.permissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    if (!organizationId || !canInvite) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/v1/organizations/${organizationId}/invites/${inviteId}/revoke`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Revoke failed");
      await loadFirm(organizationId, account!.permissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function changeUsagePeriod(next: "current" | "previous") {
    if (!organizationId) return;
    setUsagePeriod(next);
    try {
      await loadUsage(organizationId, next, canManage ? usageScope : "me");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function changeUsageScope(next: "organization" | "me") {
    if (!organizationId || !canManage) return;
    setUsageScope(next);
    try {
      await loadUsage(organizationId, usagePeriod, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  const tabs = [
    { id: "account", label: "My account" },
    { id: "firm", label: "Firm" },
    { id: "usage", label: "Usage" },
    { id: "plan", label: "Plan" },
  ];

  return (
    <ProfessionalShell>
      <FirmPageHeader
        title="Settings"
        description="Your account, this firm, and how much NyayaGrid you have used."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SignOutControl className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink/80 hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
            {canInvite ? (
              <Button type="button" disabled={!organizationId} onClick={() => setInviteOpen(true)}>
                + Invite member
              </Button>
            ) : null}
          </div>
        }
      />
      {account?.permissions.manageCompliance ? (
        <div className="mt-4">
          <FirmNotice>
            Holds, privacy, and training consent live on a separate page.{" "}
            <a className="font-semibold text-accent underline" href="/app/compliance">
              Holds & privacy
            </a>
          </FirmNotice>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <FirmError message={error} />
        </div>
      ) : null}
      {success ? (
        <div className="mt-4">
          <FirmNotice>{success}</FirmNotice>
        </div>
      ) : null}
      {loading ? <p className="mt-6 text-sm text-ink/60">Loading settings…</p> : null}

      <div className="mt-6 space-y-4">
        <FirmTabs value={tab} onChange={setTab} options={tabs} />

        {tab === "account" && account ? (
          <div className="space-y-4">
            <section className="rounded-xl border border-line bg-white/80 p-4">
              <h2 className="text-sm font-semibold text-ink">Profile</h2>
              <p className="mt-1 text-sm text-ink/65">
                Your sign-in email is managed by NyayaGrid’s identity provider. You can update the
                name shown in this workspace.
              </p>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink/45">Email</dt>
                  <dd className="mt-0.5">{account.profile.email}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink/45">Role</dt>
                  <dd className="mt-0.5">{account.membership.roleName}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink/45">Firm</dt>
                  <dd className="mt-0.5">{account.organization.name}</dd>
                </div>
              </dl>
              <form className="mt-4 flex max-w-md flex-col gap-2" onSubmit={saveName}>
                <label className="text-xs font-semibold uppercase tracking-wide text-ink/45" htmlFor="display-name">
                  Display name
                </label>
                <input
                  id="display-name"
                  className="rounded border border-line px-2 py-1.5 text-sm"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={120}
                  required
                />
                <div>
                  <Button type="submit" disabled={busy}>
                    Save name
                  </Button>
                </div>
              </form>
            </section>
            <section className="rounded-xl border border-line bg-white/80 p-4">
              <h2 className="text-sm font-semibold text-ink">Security & sessions</h2>
              <p className="mt-1 text-sm text-ink/65">
                Password, email, and signed-in devices are managed in the NyayaGrid account portal.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {account.security.profileUrl ? (
                  <a
                    className="inline-flex min-h-11 items-center rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink/80 hover:bg-black/[0.03]"
                    href={account.security.profileUrl}
                  >
                    Manage sign-in & security
                  </a>
                ) : null}
                <SignOutControl className="inline-flex min-h-11 items-center rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink/80 hover:bg-black/[0.03]" />
              </div>
            </section>
            <section>
              <h2 className="mb-2 text-sm font-semibold text-ink">Notifications</h2>
              <p className="mb-3 text-sm text-ink/65">
                In-app alerts for this workspace. Email preference controls are not available yet.
              </p>
              {notifications.length === 0 ? (
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
              )}
            </section>
          </div>
        ) : null}

        {tab === "firm" && account ? (
          <div className="space-y-4">
            <p className="text-sm text-ink/70">
              {account.organization.name}
              {canManage ? "" : " — members and invitations are managed by the firm owner."}
            </p>
            <FirmTabs
              value={firmTab}
              onChange={setFirmTab}
              options={
                canManage
                  ? [
                      { id: "members", label: "Members & access" },
                      { id: "access", label: "Case access" },
                      { id: "invitations", label: "Invitations", count: invites.length },
                    ]
                  : [{ id: "access", label: "Case access" }]
              }
            />

            {firmTab === "members" && canManage ? (
              members.length === 0 ? (
                <FirmEmpty
                  title="No members found."
                  description="Invite a lawyer, staff member, or client guest to this firm."
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

            {firmTab === "access" ? (
              <div className="space-y-3 rounded-xl border border-line bg-white/80 p-4">
                <p className="text-sm text-ink/70">
                  Client guests only see cases they are assigned to. Owners see every case.
                </p>
                {canAssign && canManage ? (
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
                      onClick={() => void assignToMatter()}
                    >
                      {busy ? "Assigning…" : "Assign to case"}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-ink/65">
                    Case assignments are made by a lawyer or owner with edit access.
                  </p>
                )}
              </div>
            ) : null}

            {firmTab === "invitations" && canInvite ? (
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
                        actions={
                          !inviteRow.acceptedAt && !inviteRow.revokedAt ? (
                            <Button
                              type="button"
                              disabled={busy}
                              onClick={() => revokeInvite(inviteRow.id)}
                            >
                              Revoke
                            </Button>
                          ) : null
                        }
                      />
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        ) : null}

        {tab === "usage" && usage ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink/70">
                Usage period: {usage.period.label}
                {usage.scope === "personal" ? " · My usage" : " · Firm usage"}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold"
                  onClick={() => void changeUsagePeriod("current")}
                >
                  This month
                </button>
                <button
                  type="button"
                  className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold"
                  onClick={() => void changeUsagePeriod("previous")}
                >
                  Previous month
                </button>
                {canManage ? (
                  <>
                    <button
                      type="button"
                      className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold"
                      onClick={() => void changeUsageScope("organization")}
                    >
                      Firm
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold"
                      onClick={() => void changeUsageScope("me")}
                    >
                      Mine
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            <p className="text-xs text-ink/50">
              {usage.completeness} Provider cost is not billed to this firm.
            </p>
            <FirmStatRow
              items={[
                { label: "Nyaya activity", value: String(usage.ai.modelRequests) },
                { label: "Tokens", value: formatTokenCount(usage.ai.totalTokens) },
                ...(usage.documents
                  ? [
                      { label: "Documents", value: String(usage.documents.total) },
                      { label: "Storage", value: formatByteSize(usage.documents.storageBytes) },
                    ]
                  : []),
              ]}
            />
            {usage.ai.modelRequests === 0 ? (
              <FirmEmpty
                title="No Nyaya activity in this period."
                description="Ask Nyaya, Research, Draft, Analysis, Compare, and document processing are counted after they run."
              />
            ) : null}
            <section className="rounded-xl border border-line bg-white/80 p-4">
              <h2 className="text-sm font-semibold text-ink">Feature usage</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {(Object.keys(FEATURE_LABELS) as Array<keyof typeof FEATURE_LABELS>).map((key) => (
                  <li key={key} className="flex justify-between gap-4">
                    <span>{FEATURE_LABELS[key]}</span>
                    <span className="font-semibold">{usage.ai.byFeature[key] ?? 0}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink/50">
                Input {formatTokenCount(usage.ai.inputTokens)} · Output{" "}
                {formatTokenCount(usage.ai.outputTokens)}
              </p>
            </section>
            {usage.scope === "organization" && usage.documents && usage.cases && usage.members ? (
              <section className="rounded-xl border border-line bg-white/80 p-4">
                <h2 className="text-sm font-semibold text-ink">Workspace</h2>
                <ul className="mt-3 space-y-2 text-sm">
                  <li className="flex justify-between gap-4">
                    <span>Documents uploaded this period</span>
                    <span className="font-semibold">{usage.documents.uploadedThisPeriod}</span>
                  </li>
                  <li className="flex justify-between gap-4">
                    <span>Active cases</span>
                    <span className="font-semibold">{usage.cases.active}</span>
                  </li>
                  <li className="flex justify-between gap-4">
                    <span>Cases created this period</span>
                    <span className="font-semibold">{usage.cases.createdThisPeriod}</span>
                  </li>
                  <li className="flex justify-between gap-4">
                    <span>Members</span>
                    <span className="font-semibold">{usage.members.active}</span>
                  </li>
                </ul>
              </section>
            ) : null}
            {usage.byMember && usage.byMember.length > 0 ? (
              <section>
                <h2 className="mb-2 text-sm font-semibold text-ink">Usage by member</h2>
                <ul className="space-y-2">
                  {usage.byMember.map((row) => (
                    <li key={row.email}>
                      <FirmRow
                        title={row.name?.trim() || row.email}
                        subtitle={row.email}
                        status={
                          <FirmStatusText>
                            {row.modelRequests} requests · {formatTokenCount(row.inputTokens + row.outputTokens)}{" "}
                            tokens
                          </FirmStatusText>
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === "plan" && account ? (
          <section className="rounded-xl border border-line bg-white/80 p-4">
            <h2 className="text-sm font-semibold text-ink">{account.plan.name}</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/45">Access</dt>
                <dd className="mt-0.5">{account.plan.access}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/45">AI usage</dt>
                <dd className="mt-0.5">{account.plan.ai}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/45">Storage</dt>
                <dd className="mt-0.5">{account.plan.storage}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/45">Seats</dt>
                <dd className="mt-0.5">{account.plan.seats}</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-ink/65">{account.plan.note}</p>
            <p className="mt-2 text-sm text-ink/65">
              Client time invoices are on{" "}
              <a className="font-semibold text-accent underline" href="/app/billing">
                Billing
              </a>
              . Subscription billing is not live.
            </p>
          </section>
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
            <option value="lawyer">Lawyer</option>
            <option value="staff">Staff</option>
            <option value="client_guest">Client guest</option>
          </select>
          <Button type="submit" disabled={busy}>
            Create invite
          </Button>
        </form>
        {lastInvite ? (
          <div className="mt-3 space-y-2 rounded border border-line bg-accent-soft/40 px-3 py-2 text-xs">
            <p>
              {lastInvite.emailDelivered
                ? "SMTP accepted the invite email. A one-time fallback link is shown here once."
                : "Invite email was not delivered. Use this one-time accept link."}
            </p>
            <p>
              Send it only to the invited address over a private channel. Do not paste it in Slack,
              SMS, or a public chat. If it is lost, revoke the invitation and create a new one. This
              link cannot be recovered after you leave this dialog.
            </p>
            <p className="break-all font-mono">
              {typeof window !== "undefined"
                ? `${window.location.origin}/invites/accept?token=${encodeURIComponent(lastInvite.token)}`
                : `/invites/accept?token=${encodeURIComponent(lastInvite.token)}`}
            </p>
          </div>
        ) : null}
      </IntelligenceDialog>
    </ProfessionalShell>
  );
}
