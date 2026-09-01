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
  const [loading, setLoading] = useState(Boolean(organizationId));

  useEffect(() => {
    if (!organizationId) {
      setAllowed(null);
      setRoleKey(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
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
      })
      .catch(() => {
        if (!cancelled) setAllowed(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, capability]);

  return { allowed, roleKey, loading };
}
