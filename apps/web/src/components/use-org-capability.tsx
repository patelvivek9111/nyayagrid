"use client";

import { useEffect, useState } from "react";

type CapabilityState = {
  allowed: boolean | null;
  roleKey: string | null;
  loading: boolean;
};

export function useOrgCapability(organizationId: string, capability: string): CapabilityState {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [roleKey, setRoleKey] = useState<string | null>(null);
  const [resolvedFor, setResolvedFor] = useState<string | null>(null);

  // Derived: pending whenever orgId is set and we have not finished a fetch for it.
  // Avoids one-frame false "ready" when organizationId transitions from empty → set.
  const loading = Boolean(organizationId) && resolvedFor !== organizationId;

  useEffect(() => {
    if (!organizationId) {
      setAllowed(null);
      setRoleKey(null);
      setResolvedFor(null);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/v1/organizations/${organizationId}/capabilities?capability=${encodeURIComponent(capability)}`,
    )
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) {
          setAllowed(true);
          setRoleKey(typeof data.roleKey === "string" ? data.roleKey : null);
        } else {
          setAllowed(false);
          setRoleKey(typeof data.roleKey === "string" ? data.roleKey : null);
        }
        setResolvedFor(organizationId);
      })
      .catch(() => {
        if (!cancelled) {
          setAllowed(false);
          setRoleKey(null);
          setResolvedFor(organizationId);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, capability]);

  return { allowed, roleKey, loading };
}
