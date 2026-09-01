import { and, eq, isNull } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { jurisdictionCoverage } from "@nyayagrid/database";
import type { CoverageStatus, ForumType } from "./types";

export function defaultCoverageStatus(): CoverageStatus {
  return "unvalidated";
}

export function isCertifiedCoverageLabel(status: CoverageStatus | string | null | undefined): boolean {
  return status === "supported";
}

export async function lookupJurisdictionCoverage(params: {
  db: Database;
  stateCode?: string | null;
  forumType?: ForumType | null;
  practiceArea?: string | null;
}): Promise<{ status: CoverageStatus; byPracticeArea: boolean }> {
  const state = params.stateCode?.toUpperCase() ?? null;
  const forum = params.forumType ?? "state";
  const practice = params.practiceArea?.trim() || null;

  if (practice) {
    const [exact] = await params.db
      .select()
      .from(jurisdictionCoverage)
      .where(
        and(
          state ? eq(jurisdictionCoverage.stateCode, state) : isNull(jurisdictionCoverage.stateCode),
          eq(jurisdictionCoverage.forumType, forum),
          eq(jurisdictionCoverage.practiceArea, practice),
        ),
      )
      .limit(1);
    if (exact) {
      const status = exact.status as CoverageStatus;
      return {
        status: status === "supported" || status === "limited" ? status : "unvalidated",
        byPracticeArea: true,
      };
    }
  }

  const [stateWide] = await params.db
    .select()
    .from(jurisdictionCoverage)
    .where(
      and(
        state ? eq(jurisdictionCoverage.stateCode, state) : isNull(jurisdictionCoverage.stateCode),
        eq(jurisdictionCoverage.forumType, forum),
        isNull(jurisdictionCoverage.practiceArea),
      ),
    )
    .limit(1);
  if (stateWide) {
    const status = stateWide.status as CoverageStatus;
    return {
      status: status === "supported" || status === "limited" ? status : "unvalidated",
      byPracticeArea: false,
    };
  }

  return { status: "unvalidated", byPracticeArea: Boolean(practice) };
}
