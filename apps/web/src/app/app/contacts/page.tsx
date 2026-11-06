"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Button } from "@nyayagrid/ui";
import { IntelligenceDialog } from "@/components/ux/case-intelligence";
import {
  FirmEmpty,
  FirmError,
  FirmLoading,
  FirmPageHeader,
  FirmRow,
  FirmStatusText,
} from "@/components/ux/firm-workspace";

type ContactRow = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  notes: string | null;
};

type ClientRow = { id: string; displayName: string };

type ClientLink = {
  id: string;
  clientId: string;
  clientDisplayName: string;
  relationshipRole: string;
};

const emptyForm = {
  displayName: "",
  email: "",
  phone: "",
  title: "",
  notes: "",
};

export default function ContactsPage() {
  const { organizationId, loading, error } = useActiveOrganization();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [links, setLinks] = useState<ClientLink[]>([]);
  const [linkClientId, setLinkClientId] = useState("");
  const [linkRole, setLinkRole] = useState("other");

  const selected = useMemo(
    () => contacts.find((c) => c.id === selectedId) ?? null,
    [contacts, selectedId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.displayName, c.email, c.phone, c.title]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [contacts, query]);

  async function load(orgId: string) {
    const [contactsRes, clientsRes] = await Promise.all([
      fetch(`/api/v1/contacts?organizationId=${orgId}`),
      fetch(`/api/v1/clients?organizationId=${orgId}`),
    ]);
    const contactsData = await contactsRes.json();
    const clientsData = await clientsRes.json();
    if (!contactsRes.ok) {
      throw new Error(contactsData?.error?.message ?? "Failed to load contacts");
    }
    setContacts(contactsData.contacts ?? []);
    if (clientsRes.ok) setClients(clientsData.clients ?? []);
  }

  async function loadLinks(contactId: string) {
    const res = await fetch(`/api/v1/contacts/${contactId}/clients`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load client links");
    setLinks(data.links ?? []);
  }

  useEffect(() => {
    if (!organizationId) return;
    load(organizationId).catch((err) => setMessage(err.message));
  }, [organizationId]);

  useEffect(() => {
    if (!selectedId) {
      setLinks([]);
      return;
    }
    loadLinks(selectedId).catch((err) => setMessage(err.message));
  }, [selectedId]);

  function openCreate() {
    setForm(emptyForm);
    setCreateOpen(true);
  }

  function openEdit(contact: ContactRow) {
    setSelectedId(contact.id);
    setForm({
      displayName: contact.displayName,
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      title: contact.title ?? "",
      notes: contact.notes ?? "",
    });
    setEditOpen(true);
  }

  async function createContact(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/v1/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          displayName: form.displayName,
          email: form.email || null,
          phone: form.phone || null,
          title: form.title || null,
          notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Could not create contact");
      setCreateOpen(false);
      setForm(emptyForm);
      await load(organizationId);
      setSelectedId(data.contact.id);
      setMessage(`Created contact ${data.contact.displayName}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not create contact");
    } finally {
      setBusy(false);
    }
  }

  async function saveContact(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || !selectedId) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/v1/contacts/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: form.displayName,
          email: form.email || null,
          phone: form.phone || null,
          title: form.title || null,
          notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Could not update contact");
      setEditOpen(false);
      await load(organizationId);
      setMessage(`Updated contact ${data.contact.displayName}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not update contact");
    } finally {
      setBusy(false);
    }
  }

  async function linkClient(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !linkClientId) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/v1/contacts/${selectedId}/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: linkClientId, relationshipRole: linkRole || "other" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Could not link client");
      setLinkClientId("");
      await loadLinks(selectedId);
      setMessage("Linked contact to client");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not link client");
    } finally {
      setBusy(false);
    }
  }

  async function unlinkClient(linkId: string) {
    if (!selectedId) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/v1/contacts/${selectedId}/clients?linkId=${linkId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "Could not unlink client");
      await loadLinks(selectedId);
      setMessage("Unlinked contact from client");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not unlink client");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <ProfessionalShell>
        <FirmLoading label="Loading contacts…" />
      </ProfessionalShell>
    );
  }

  if (error || !organizationId) {
    return (
      <ProfessionalShell>
        <FirmError message={error || "Select an organization to manage contacts."} />
      </ProfessionalShell>
    );
  }

  return (
    <ProfessionalShell>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <FirmPageHeader
          title="Contacts"
          description="Organization people distinct from clients — opposing counsel, witnesses, experts, and other contacts."
          actions={
            <Button type="button" onClick={openCreate}>
              New contact
            </Button>
          }
        />

        {message ? <FirmStatusText>{message}</FirmStatusText> : null}

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink/70">Search</span>
          <input
            className="w-full rounded border border-line bg-white px-3 py-2"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, email, phone, or title"
            aria-label="Search contacts"
          />
        </label>

        {filtered.length === 0 ? (
          <FirmEmpty
            title={contacts.length === 0 ? "No contacts yet" : "No matching contacts"}
            description={
              contacts.length === 0
                ? "Create a contact to track people who are not clients."
                : "Try a different search."
            }
          />
        ) : (
          <ul className="divide-y divide-line rounded border border-line bg-white">
            {filtered.map((contact) => (
              <li key={contact.id}>
                <FirmRow
                  title={contact.displayName}
                  subtitle={[contact.title, contact.email, contact.phone]
                    .filter(Boolean)
                    .join(" · ")}
                  meta={selectedId === contact.id ? "Selected" : undefined}
                  onClick={() => setSelectedId(contact.id)}
                  actions={
                    <Button type="button" variant="secondary" onClick={() => openEdit(contact)}>
                      Edit
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        )}

        {selected ? (
          <section
            className="space-y-4 rounded border border-line bg-white p-4"
            aria-label="Contact details"
          >
            <div>
              <h2 className="text-lg font-semibold text-ink">{selected.displayName}</h2>
              <p className="text-sm text-ink/70">
                {[selected.title, selected.email, selected.phone].filter(Boolean).join(" · ") ||
                  "No contact details"}
              </p>
              {selected.notes ? <p className="mt-2 text-sm text-ink/80">{selected.notes}</p> : null}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-ink">Linked clients</h3>
              {links.length === 0 ? (
                <p className="text-sm text-ink/55">Not linked to any client yet.</p>
              ) : (
                <ul className="space-y-2">
                  {links.map((link) => (
                    <li
                      key={link.id}
                      className="flex items-center justify-between gap-3 rounded border border-line px-3 py-2 text-sm"
                    >
                      <span>
                        {link.clientDisplayName}{" "}
                        <span className="text-ink/55">({link.relationshipRole})</span>
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void unlinkClient(link.id)}
                      >
                        Unlink
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <form className="flex flex-wrap items-end gap-2" onSubmit={linkClient}>
                <label className="text-sm">
                  <span className="mb-1 block text-ink/70">Client</span>
                  <select
                    className="rounded border border-line bg-white px-2 py-2"
                    value={linkClientId}
                    onChange={(e) => setLinkClientId(e.target.value)}
                    required
                  >
                    <option value="">Select client</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-ink/70">Role</span>
                  <input
                    className="rounded border border-line bg-white px-2 py-2"
                    value={linkRole}
                    onChange={(e) => setLinkRole(e.target.value)}
                    placeholder="other"
                  />
                </label>
                <Button type="submit" disabled={busy || !linkClientId}>
                  Link client
                </Button>
              </form>
            </div>
          </section>
        ) : null}
      </div>

      <IntelligenceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New contact"
        description="Contacts are organization-scoped and distinct from clients."
      >
        <ContactForm
          form={form}
          setForm={setForm}
          busy={busy}
          onSubmit={createContact}
          submitLabel="Create"
        />
      </IntelligenceDialog>

      <IntelligenceDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit contact"
        description="Update contact details for this organization."
      >
        <ContactForm
          form={form}
          setForm={setForm}
          busy={busy}
          onSubmit={saveContact}
          submitLabel="Save"
        />
      </IntelligenceDialog>
    </ProfessionalShell>
  );
}

function ContactForm({
  form,
  setForm,
  busy,
  onSubmit,
  submitLabel,
}: {
  form: typeof emptyForm;
  setForm: (value: typeof emptyForm) => void;
  busy: boolean;
  onSubmit: (event: FormEvent) => void;
  submitLabel: string;
}) {
  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Display name</span>
        <input
          className="w-full rounded border border-line px-3 py-2"
          required
          maxLength={300}
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Email</span>
        <input
          className="w-full rounded border border-line px-3 py-2"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Phone</span>
        <input
          className="w-full rounded border border-line px-3 py-2"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Title</span>
        <input
          className="w-full rounded border border-line px-3 py-2"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Notes</span>
        <textarea
          className="w-full rounded border border-line px-3 py-2"
          rows={3}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </label>
      <Button type="submit" disabled={busy || !form.displayName.trim()}>
        {busy ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
