"use client";

import { useState } from "react";
import { ProfessionalShell } from "@/components/shell";
import { Button, Panel } from "@nyayagrid/ui";

export default function OnboardingPage() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<"firm" | "solo">("solo");
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setResult("");
    try {
      const response = await fetch("/api/v1/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, type }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error?.message ?? "Failed to create organization");
      } else {
        setResult(`Created ${data.organization.name} (${data.organization.id})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <ProfessionalShell title="Workspace onboarding">
      <Panel title="Create organization">
        <form className="flex max-w-lg flex-col gap-4" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1 text-sm">
            Organization name
            <input
              className="rounded-md border border-line px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Slug
            <input
              className="rounded-md border border-line px-3 py-2"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              // A bare trailing "-" inside a character class is ambiguous under the newer
              // Unicode-mode ("v" flag) HTML pattern-matching some browsers now use to validate
              // this attribute, and throws `SyntaxError: Invalid character class` there instead of
              // just matching. Leading "-" is unambiguous in every mode.
              pattern="[-a-z0-9]+"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Type
            <select
              className="rounded-md border border-line px-3 py-2"
              value={type}
              onChange={(e) => setType(e.target.value as "firm" | "solo")}
            >
              <option value="solo">Solo lawyer</option>
              <option value="firm">Law firm</option>
            </select>
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create organization"}
          </Button>
        </form>
        {error ? <p className="mt-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}
        {result ? <p className="mt-4 text-sm text-accent">{result}</p> : null}
      </Panel>
    </ProfessionalShell>
  );
}
