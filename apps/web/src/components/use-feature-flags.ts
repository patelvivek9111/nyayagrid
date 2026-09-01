"use client";

import { useEffect, useState } from "react";
import type { FeatureFlagState } from "@nyayagrid/platform";

const STAGING_DEFAULTS: FeatureFlagState = {
  agents: false,
  professor: false,
  guide: false,
  research: false,
  ocr: false,
  live_ai: false,
};

export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlagState>(STAGING_DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/features")
      .then(async (res) => {
        const data = await res.json();
        if (!cancelled && res.ok && data.flags) setFlags(data.flags);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { flags, loaded };
}
