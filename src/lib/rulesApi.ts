/**
 * rulesApi.ts — fetches resolved scheme financing rules from the backend's
 * Rules & Rates engine (GET /api/v1/report/schemes/{scheme_id}/rules).
 *
 * This is the SAME engine backend/schemes/*.py uses to compute the actual
 * PDF (see backend/rules/engine.py) — fetching it here means the wizard's
 * live preview can stop keeping its own separate copy of PMEGP subsidy
 * tiers, promoter minimums, etc. Network failures return null; callers
 * fall back to their existing local defaults, matching the same
 * graceful-degradation pattern already used by useReportGenerator's
 * getSchemes()/checkEligibility().
 */

import { API_BASE_URL } from "@/lib/apiBase";

export interface PmegpSubsidyMatrixEntry {
  promoter_pct: number;
  subsidy_pct: number;
}

export interface SchemeFinancingRules {
  dscr_benchmark?: number;
  subsidy_matrix?: Record<
    "General_Urban" | "General_Rural" | "Special_Urban" | "Special_Rural",
    PmegpSubsidyMatrixEntry
  >;
  promoter_contribution_pct?: number;
  term_loan_pct_default?: number;
  wc_loan_pct_default?: number;
  interest_rate_pct_default?: number;
  moratorium_months_default?: number;
  promoter_floor_pct?: number;
  benchmarks?: {
    dscr_avg: number;
    current_ratio: number;
    debt_equity: number;
    ebitda_margin: number;
    net_margin: number;
    interest_coverage: number;
    tol_tnw: number;
    promoter_pct: number;
  };
  // Remaining fields (name, eligibility text, collateral notes, etc.) are
  // scheme metadata, not financing rates — not typed here, but present.
  [key: string]: unknown;
}

export async function fetchSchemeRules(schemeId: string): Promise<SchemeFinancingRules | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/report/schemes/${schemeId}/rules`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.rules ?? null) as SchemeFinancingRules | null;
  } catch {
    return null; // network error — caller falls back to local defaults
  }
}
