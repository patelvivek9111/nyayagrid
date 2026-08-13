"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type MatterChrome = {
  id: string;
  title: string;
  matterNumber: string;
  status: string;
};

type MatterChromeValue = {
  matterId: string;
  matter: MatterChrome | null;
  title: string;
  loading: boolean;
  error: string;
};

const MatterChromeContext = createContext<MatterChromeValue | null>(null);

export function MatterChromeProvider({
  matterId,
  children,
}: {
  matterId: string;
  children: ReactNode;
}) {
  const [matter, setMatter] = useState<MatterChrome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const res = await fetch(`/api/v1/matters/${matterId}/chrome`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load matter");
        if (cancelled) return;
        setMatter(data.matter as MatterChrome);
      } catch (err) {
        if (!cancelled) {
          setMatter(null);
          setError(err instanceof Error ? err.message : "Failed to load matter");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matterId]);

  const title = matter ? `${matter.matterNumber} — ${matter.title}` : "Matter";

  const value = useMemo(
    () => ({ matterId, matter, title, loading, error }),
    [matterId, matter, title, loading, error],
  );

  return <MatterChromeContext.Provider value={value}>{children}</MatterChromeContext.Provider>;
}

export function useMatterChrome(): MatterChromeValue {
  const ctx = useContext(MatterChromeContext);
  if (!ctx) {
    throw new Error("useMatterChrome must be used within MatterChromeProvider");
  }
  return ctx;
}
