/**
 * useReportGenerator — React hook for CMA report generation API.
 *
 * Calls POST /api/v1/report/generate (new structured endpoint) and handles
 * loading state, error state, PDF download, and partial validation.
 *
 * Usage in a component:
 *   const { isLoading, error, reportResult, generateReport, downloadPDF } = useReportGenerator()
 *   const result = await generateReport(buildCMAReportInput(formData))
 *   if (result) downloadPDF(result.pdf_url, result.report_id)
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const API_BASE_URL =
  (import.meta as any).env?.VITE_CMA_API_URL ?? 'http://localhost:8000';

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReportKeyMetrics {
  dscr_average:   number;
  recommendation: string;
  credit_rating:  string;
  payback_months: number | null;
  scheme:         string;
  report_type:    string;
}

export interface BreakEvenPreviewYear {
  year: number;
  variable_expenses: number;
  contribution: number;
  contribution_pct: number;
  operating_fixed_expenses: number;
  net_profit: number;
  operating_bep_sales: number;
  operating_bep_pct: number;
  operating_bep_not_achievable: boolean;
  fixed_expenses: number;
  bep_sales: number;
  bep_pct: number;
  bep_not_achievable: boolean;
}

export interface ReportResult {
  report_id:          string;
  pdf_url:            string;
  validation_status:  'PASS' | 'WARNINGS' | 'PASS_WITH_WARNINGS' | 'FAIL';
  key_metrics:        ReportKeyMetrics;
  break_even:         BreakEvenPreviewYear[];
  validation_warnings?: string[];
}

export interface ValidationPreview {
  dscr_average:  number;
  year1_revenue: number;
  year1_pat:     number;
  break_even: BreakEvenPreviewYear[];
}

export interface SchemeInfo {
  id:           string;
  name:         string;
  max_loan:     number;
  subsidy_pct:  string;
  cma_required: boolean | string;
  min_dscr:     number | null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useReportGenerator() {
  const [isLoading,        setIsLoading]        = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [reportResult,     setReportResult]     = useState<ReportResult | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationPreview, setValidationPreview] = useState<ValidationPreview | null>(null);

  /**
   * Step 1 — Validate inputs before full generation.
   * Call on each form step completion for early feedback.
   * Returns true if valid (network errors are silent — don't block the user).
   */
  const validatePartial = useCallback(async (payload: object): Promise<boolean> => {
    setValidationPreview(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/report/validate`, {
        method:  'POST',
        headers: await getAuthHeaders(),
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(8000),
      });
      const data = await res.json();
      setValidationErrors(data.errors ?? []);
      setValidationPreview(data.preview ?? null);
      return data.valid === true;
    } catch {
      return true; // don't block user on network error during partial validation
    }
  }, []);

  /**
   * Step 2 — Generate the full CMA report + PDF.
   * Call on final form submit.
   */
  const generateReport = useCallback(async (payload: object): Promise<ReportResult | null> => {
    setIsLoading(true);
    setError(null);
    setReportResult(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/report/generate`, {
        method:  'POST',
        headers: await getAuthHeaders(),
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Report generation failed' }));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }

      const result: ReportResult = await res.json();
      setReportResult(result);
      return result;
    } catch (e: any) {
      setError(e.message ?? 'Unknown error');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Step 3 — Trigger browser PDF download.
   */
  const downloadPDF = useCallback((pdfUrl: string, reportId: string) => {
    const fullUrl = pdfUrl.startsWith('http') ? pdfUrl : `${API_BASE_URL}${pdfUrl}`;
    const link    = document.createElement('a');
    link.href     = fullUrl;
    link.download = `CMA_Report_${reportId}.pdf`;
    link.click();
  }, []);

  /**
   * Fetch available schemes for the scheme selector dropdown.
   */
  const getSchemes = useCallback(async (): Promise<SchemeInfo[]> => {
    try {
      const res  = await fetch(`${API_BASE_URL}/api/v1/report/schemes`);
      const data = await res.json();
      return data.schemes ?? [];
    } catch {
      return [];
    }
  }, []);

  /**
   * Check scheme eligibility for the current applicant.
   * Returns { eligible, reasons, subsidy } or null on error.
   */
  const checkEligibility = useCallback(async (
    schemeId: string,
    params: {
      project_cost:    number;
      social_category: string;
      area_type:       string;
      industry_type:   string;
      business_status: string;
    }
  ) => {
    try {
      const res  = await fetch(`${API_BASE_URL}/api/v1/report/schemes/${schemeId}/eligibility`, {
        method:  'POST',
        headers: await getAuthHeaders(),
        body:    JSON.stringify(params),
      });
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  return {
    isLoading,
    error,
    reportResult,
    validationErrors,
    validationPreview,
    validatePartial,
    generateReport,
    downloadPDF,
    getSchemes,
    checkEligibility,
  };
}
