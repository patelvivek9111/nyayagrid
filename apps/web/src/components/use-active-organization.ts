"use client";

import { useEffect, useState } from "react";

export type OrgOption = { id: string; name: string; slug: string; type: string };

const STORAGE_KEY = "nyayagrid.activeOrganizationId";

export function useActiveOrganization() {
  const [organizations, setOrganizations] = useState<OrgOption[]>([]);
  const [organizationId, setOrganizationId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/organizations");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load organizations");
        const orgs = (data.organizations ?? []) as OrgOption[];
        if (cancelled) return;
        setOrganizations(orgs);
        const saved = localStorage.getItem(STORAGE_KEY);
        const selected = orgs.find((o) => o.id === saved)?.id ?? orgs[0]?.id ?? "";
        setOrganizationId(selected);
        if (selected) localStorage.setItem(STORAGE_KEY, selected);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load orgs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function selectOrganization(id: string) {
    setOrganizationId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }

  return { organizations, organizationId, selectOrganization, loading, error };
}
