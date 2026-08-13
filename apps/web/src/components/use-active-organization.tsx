"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type OrgOption = { id: string; name: string; slug: string; type: string };

const STORAGE_KEY = "nyayagrid.activeOrganizationId";

type ActiveOrganizationValue = {
  organizations: OrgOption[];
  organizationId: string;
  selectOrganization: (id: string) => void;
  loading: boolean;
  error: string;
};

const ActiveOrganizationContext = createContext<ActiveOrganizationValue | null>(null);

export function ActiveOrganizationProvider({ children }: { children: ReactNode }) {
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

  const selectOrganization = useCallback((id: string) => {
    setOrganizationId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const value = useMemo(
    () => ({ organizations, organizationId, selectOrganization, loading, error }),
    [organizations, organizationId, selectOrganization, loading, error],
  );

  return (
    <ActiveOrganizationContext.Provider value={value}>{children}</ActiveOrganizationContext.Provider>
  );
}

export function useActiveOrganization(): ActiveOrganizationValue {
  const ctx = useContext(ActiveOrganizationContext);
  if (!ctx) {
    throw new Error("useActiveOrganization must be used within ActiveOrganizationProvider");
  }
  return ctx;
}
