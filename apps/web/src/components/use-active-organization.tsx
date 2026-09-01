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
import { USER_FACING_AUTH } from "@nyayagrid/auth/user-facing";
import { ACTIVE_ORG_STORAGE_KEY, safeAuthReturnTo } from "@/lib/auth-return";
import { resolveActiveOrganizationId } from "@/lib/workspace-ux";

export type OrgOption = { id: string; name: string; slug: string; type: string };

const STORAGE_KEY = ACTIVE_ORG_STORAGE_KEY;

type ActiveOrganizationValue = {
  organizations: OrgOption[];
  organizationId: string;
  selectOrganization: (id: string) => void;
  reloadOrganizations: () => Promise<OrgOption[]>;
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
      let redirecting = false;
      try {
        const res = await fetch("/api/v1/organizations");
        const data = await res.json();
        if (res.status === 401) {
          redirecting = true;
          const returnTo = safeAuthReturnTo(
            `${window.location.pathname}${window.location.search}`,
          );
          window.location.replace(
            `/sign-in?returnTo=${encodeURIComponent(returnTo)}&reason=session`,
          );
          return;
        }
        if (!res.ok) throw new Error(USER_FACING_AUTH.unavailable);
        const orgs = (data.organizations ?? []) as OrgOption[];
        if (cancelled) return;
        setOrganizations(orgs);
        const saved = localStorage.getItem(STORAGE_KEY);
        const selected = resolveActiveOrganizationId(orgs, saved);
        setOrganizationId(selected);
        if (selected) localStorage.setItem(STORAGE_KEY, selected);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : USER_FACING_AUTH.unavailable);
      } finally {
        if (!cancelled && !redirecting) setLoading(false);
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

  const reloadOrganizations = useCallback(async () => {
    const res = await fetch("/api/v1/organizations");
    const data = await res.json();
    if (res.status === 401) {
      throw new Error(USER_FACING_AUTH.unauthenticated);
    }
    if (!res.ok) throw new Error(USER_FACING_AUTH.unavailable);
    const orgs = (data.organizations ?? []) as OrgOption[];
    setOrganizations(orgs);
    const saved = localStorage.getItem(STORAGE_KEY);
    const selected = resolveActiveOrganizationId(orgs, saved);
    setOrganizationId(selected);
    if (selected) localStorage.setItem(STORAGE_KEY, selected);
    return orgs;
  }, []);

  const value = useMemo(
    () => ({
      organizations,
      organizationId,
      selectOrganization,
      reloadOrganizations,
      loading,
      error,
    }),
    [organizations, organizationId, selectOrganization, reloadOrganizations, loading, error],
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
