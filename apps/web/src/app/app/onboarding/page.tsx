"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Button, Panel } from "@nyayagrid/ui";
import { continueHref, ORGANIZATION_SLUG_HTML_PATTERN, normalizeOrganizationSlugInput, slugFromFirmName } from "@/lib/first-run";

export default function OnboardingPage() {
  const router = useRouter();
  const { organizations, loading: orgLoading, selectOrganization, reloadOrganizations } =
    useActiveOrganization();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [type, setType] = useState<"firm" | "solo">("solo");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (orgLoading || organizations.length === 0) return;
    let cancelled = false;
    setRedirecting(true);
    const orgId = organizations[0]!.id;
    Promise.all([
      fetch(`/api/v1/matters?organizationId=${orgId}`).then(async (res) => {
        const data = await res.json();
        return res.ok ? ((data.matters ?? []) as unknown[]).length : 0;
      }),
      fetch(`/api/v1/organizations/${orgId}/capabilities?capability=matters.create`).then(
        async (res) => {
          const data = await res.json().catch(() => ({}));
          return {
            canCreate: res.ok,
            roleKey: typeof data.roleKey === "string" ? data.roleKey : null,
          };
        },
      ),
      fetch(`/api/v1/organizations/${orgId}/capabilities?capability=matters.view`).then(
        async (res) => {
          const data = await res.json().catch(() => ({}));
          return typeof data.roleKey === "string" ? data.roleKey : null;
        },
      ),
    ])
      .then(([caseCount, createCap, viewRole]) => {
        if (cancelled) return;
        router.replace(
          continueHref({
            organizationCount: organizations.length,
            caseCount,
            canCreateMatter: createCap.canCreate,
            roleKey: viewRole ?? createCap.roleKey,
          }),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setRedirecting(false);
          router.replace("/app/cases");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orgLoading, organizations, router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/v1/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug: normalizeOrganizationSlugInput(slug), type }),
      });
      const data = await response.json();
      if (!response.ok) {
        const details = data?.error?.details as { fieldErrors?: { slug?: string[] } } | undefined;
        setError(
          details?.fieldErrors?.slug?.[0] ??
            data?.error?.message ??
            "Failed to create organization",
        );
        return;
      }
      const orgId = data.organization.id as string;
      selectOrganization(orgId);
      await reloadOrganizations();
      router.replace("/app/cases/new");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  if (orgLoading || redirecting || organizations.length > 0) {
    return (
      <ProfessionalShell title="Set up your workspace">
        <p className="text-sm text-ink/70">Continuing to your Cases…</p>
      </ProfessionalShell>
    );
  }

  return (
    <ProfessionalShell title="Set up your workspace">
      <Panel title="Create your firm">
        <p className="mb-4 text-sm text-ink/70">
          Create a firm or solo practice, then add your first Case. Nyaya works from Case files.
        </p>
        <form className="flex max-w-lg flex-col gap-4" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1 text-sm">
            Firm or practice name
            <input
              className="rounded-md border border-line px-3 py-2"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugFromFirmName(e.target.value));
              }}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Short name
            <input
              className="rounded-md border border-line px-3 py-2"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(normalizeOrganizationSlugInput(e.target.value));
              }}
              pattern={ORGANIZATION_SLUG_HTML_PATTERN}
              title="Lowercase letters, numbers, and hyphens"
              autoComplete="off"
              spellCheck={false}
              required
            />
            <span className="font-normal text-xs text-ink/55">
              Lowercase letters, numbers, and hyphens only — used in the workspace URL.
            </span>
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
            {pending ? "Creating…" : "Create firm"}
          </Button>
        </form>
        {error ? <p className="mt-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      </Panel>
    </ProfessionalShell>
  );
}
