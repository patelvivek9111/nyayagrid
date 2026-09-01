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
import type { UiJurisdictionContract } from "@/lib/case-jurisdiction";
import { CaseDetailsPanel } from "@/components/ux/case-details-panel";

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
  clientDisplayName: string | null;
  organizationId: string | null;
  jurisdictionContext: UiJurisdictionContract | null;
  canEdit: boolean;
  reviewPendingCount: number;
  canReview: boolean;
  canReviewAnalysis: boolean;
  canUpload: boolean;
  detailsOpen: boolean;
  openCaseDetails: () => void;
  closeCaseDetails: () => void;
  refreshChrome: () => Promise<void>;
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
  const [clientDisplayName, setClientDisplayName] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [jurisdictionContext, setJurisdictionContext] = useState<UiJurisdictionContract | null>(
    null,
  );
  const [canEdit, setCanEdit] = useState(false);
  const [reviewPendingCount, setReviewPendingCount] = useState(0);
  const [canReview, setCanReview] = useState(false);
  const [canReviewAnalysis, setCanReviewAnalysis] = useState(false);
  const [canUpload, setCanUpload] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadChrome = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setError("");
    }
    const res = await fetch(`/api/v1/matters/${matterId}/chrome`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load matter");
    setMatter(data.matter as MatterChrome);
    setClientDisplayName(data.client?.displayName ?? null);
    setOrganizationId(data.organizationId ?? null);
    setJurisdictionContext((data.jurisdictionContext as UiJurisdictionContract | null) ?? null);
    setCanEdit(Boolean(data.canEdit));
    setReviewPendingCount(
      typeof data.review?.pendingCount === "number" ? data.review.pendingCount : 0,
    );
    setCanReview(Boolean(data.review?.canReview));
    setCanReviewAnalysis(Boolean(data.review?.canReviewAnalysis));
    setCanUpload(Boolean(data.canUpload));
  }, [matterId]);

  const refreshChrome = useCallback(async () => {
    try {
      await loadChrome({ silent: true });
    } catch {
      // Badge refresh is best-effort; Review page surfaces hard errors.
    }
  }, [loadChrome]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    loadChrome()
      .catch((err) => {
        if (!cancelled) {
          setMatter(null);
          setError(err instanceof Error ? err.message : "Failed to load matter");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadChrome]);

  const title = matter ? `${matter.matterNumber} — ${matter.title}` : "Matter";

  const openCaseDetails = useCallback(() => setDetailsOpen(true), []);
  const closeCaseDetails = useCallback(() => setDetailsOpen(false), []);

  const value = useMemo(
    () => ({
      matterId,
      matter,
      title,
      loading,
      error,
      clientDisplayName,
      organizationId,
      jurisdictionContext,
      canEdit,
      reviewPendingCount,
      canReview,
      canReviewAnalysis,
      canUpload,
      detailsOpen,
      openCaseDetails,
      closeCaseDetails,
      refreshChrome,
    }),
    [
      matterId,
      matter,
      title,
      loading,
      error,
      clientDisplayName,
      organizationId,
      jurisdictionContext,
      canEdit,
      reviewPendingCount,
      canReview,
      canReviewAnalysis,
      canUpload,
      detailsOpen,
      openCaseDetails,
      closeCaseDetails,
      refreshChrome,
    ],
  );

  return (
    <MatterChromeContext.Provider value={value}>
      {children}
      <CaseDetailsPanel
        open={detailsOpen}
        onClose={closeCaseDetails}
        matterId={matterId}
        organizationId={organizationId}
        canEdit={canEdit}
        onSaved={refreshChrome}
      />
    </MatterChromeContext.Provider>
  );
}

export function useMatterChrome(): MatterChromeValue {
  const ctx = useContext(MatterChromeContext);
  if (!ctx) {
    throw new Error("useMatterChrome must be used within MatterChromeProvider");
  }
  return ctx;
}
