/**
 * CMA Report API Service
 *
 * Maps GTABFormData → CMAReportInput and calls the FastAPI backend
 * to get server-side financial calculations for the PDF report.
 *
 * The API URL is read from VITE_CMA_API_URL (defaults to http://localhost:8000).
 * If the API is unreachable the functions return null and the caller falls
 * back to the existing frontend calculations.
 */

import { GTABFormData } from "@/types/gtab";
import { getNormalizedProjectReportInputs } from "@/lib/projectReport";
import { buildDprFormStateFromGTAB } from "@/lib/dprFormAdapter";

// ── Types ────────────────────────────────────────────────────────────────────

/** Key financial numbers returned by the API and used in the PDF template. */
export interface CMAApiFinancials {
  // Revenue / P&L
  netMonthlyRevenue: number;
  monthlyEbitda: number;
  monthlyEbi: number;
  monthlyPat: number;
  monthlyEmi: number;
  netMonthlySurplus: number;
  annualRevenue: number;
  annualEbitda: number;
  annualPat: number;
  annualSurplus: number;
  ebitdaMarginPct: number;
  netMarginPct: number;

  // Loan
  totalLoanAmount: number;
  termLoanAmount: number;
  workingCapitalLoan: number;
  processingFeeAmount: number;
  totalInterestOutgo: number;
  monthlyInterestY1: number;
  monthlyDepreciation: number;

  // Ratios
  dscr: number;
  avgDscr5yr: number;
  roiEbitdaPct: number;
  roiPatPct: number;
  breakEvenMonths: number;
  breakEvenRevenue: number;
  marginOfSafety: number;
  currentRatio: number;
  interestCoverageY1: number;
  assetTurnoverY1: number;

  // Working capital
  stockRequirement: number;
  debtors: number;
  creditors: number;
  netWorkingCapital: number;
  totalCurrentAssets: number;
  totalCurrentLiabilities: number;

  // Scorecard / rating
  totalScore: number;
  creditRating: string;
  recommendation: string;
  riskLevel: string;

  // Projections (5 years)
  projections: Array<{
    year: number;
    sales: number;
    expenses: number;
    ebitda: number;
    depreciation: number;
    interest: number;
    profit_before_tax: number;
    tax: number;
    profit_after_tax: number;
    emi_paid: number;
    net_surplus: number;
    dscr: number;
  }>;

  // Repayment schedule (yearly)
  yearlyRepayment: Array<{
    year: number;
    opening_balance: number;
    interest_paid: number;
    principal_paid: number;
    emi_paid: number;
    closing_balance: number;
  }>;

  // Monthly cash flows (first 3 months)
  monthlyCashflows: Array<{
    month: number;
    opening: number;
    loan_inflow: number;
    sales: number;
    outflows: number;
    closing: number;
  }>;

  // Sensitivity
  sensitivity: Array<{
    scenario: string;
    change_pct: number;
    monthly_revenue: number;
    monthly_profit: number;
    dscr: number;
    status: string;
  }>;

  // PMEGP-specific (only present when scheme === "pmegp")
  marginMoney?: number;
  marginMoneyPct?: number;
  pmegpCategoryType?: string;
  pmegpTdrNote?: string;

  // Refs
  reportRef: string;
  applicationId: string;
  preparedOn: string;
}

// ── Config ───────────────────────────────────────────────────────────────────

import { API_BASE_URL } from "@/lib/apiBase";

// ── Note ──────────────────────────────────────────────────────────────────────
// fetchCMAReport uses buildDprFormStateFromGTAB (flat MasterInput) → /master/{industry}/calculate
// For the nested /api/v1/report/generate endpoint use buildCMAReportInput from buildCMAReportInput.ts


// ── API Call ─────────────────────────────────────────────────────────────────

/**
 * Calls the FastAPI backend to generate a fully-calculated CMA report.
 * Returns null (silently) if the API is unreachable so the caller can fall
 * back to the frontend calculations.
 */
export async function fetchCMAReport(
  formData: GTABFormData
): Promise<CMAApiFinancials | null> {
  try {
    const payload = buildDprFormStateFromGTAB(formData);
    const industry = formData.industry_type && formData.industry_type !== "others" ? formData.industry_type : "manufacturing";

    // OVERRIDE: Inject exact products from form data to prevent 1-unit fake summaries
    const ri = getNormalizedProjectReportInputs(formData);
    if (ri.revenue?.product_categories?.length > 0) {
      payload.products = ri.revenue.product_categories.map((p) => ({
        category: p.category || "Products/Services",
        units_per_month: Number(p.quantity_sold || p.units_monthly) || 1,
        avg_price: Number(p.selling_price || p.avg_price) || 0,
        purchase_price: Number(p.purchase_price) || 0,
        monthly_revenue: Number(p.fixed_revenue) || (Number(p.quantity_sold || p.units_monthly) || 0) * (Number(p.selling_price || p.avg_price) || 0),
        mix_pct: Number(p.service_mix_pct) || 0,
      }));
    }

    const response = await fetch(`${API_BASE_URL}/master/${industry}/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`CMA API returned ${response.status} — falling back to frontend calculations`);
      return null;
    }

    const json = await response.json();
    if (json?.cma && json?.dpr) {
      const c = json.cma;
      const d = json.dpr;
      const meta = json.meta ?? {};
      return {
        netMonthlyRevenue: c.net_monthly_revenue ?? 0,
        monthlyEbitda: c.ebitda_monthly ?? 0,
        monthlyEbi: (c.ebitda_monthly ?? 0) - (c.monthly_dep ?? 0),
        monthlyPat: c.pat_monthly ?? 0,
        monthlyEmi: c.emi ?? 0,
        netMonthlySurplus: c.surplus_monthly ?? 0,
        annualRevenue: c.annual_revenue ?? 0,
        annualEbitda: c.annual_ebitda ?? 0,
        annualPat: c.annual_pat ?? 0,
        annualSurplus: (c.annual_pat ?? 0) - (c.annual_emi ?? 0),
        ebitdaMarginPct: c.ebitda_margin_pct ?? 0,
        netMarginPct: c.net_margin_pct ?? 0,
        totalLoanAmount: c.total_loan ?? 0,
        termLoanAmount: c.term_loan ?? 0,
        workingCapitalLoan: c.working_capital_loan ?? 0,
        processingFeeAmount: c.processing_fee ?? 0,
        totalInterestOutgo: c.total_interest_outgo ?? 0,
        monthlyInterestY1: c.monthly_int_y1 ?? 0,
        monthlyDepreciation: c.monthly_dep ?? 0,
        dscr: c.dscr_y1 ?? 0,
        avgDscr5yr: c.avg_dscr_5yr ?? 0,
        roiEbitdaPct: c.roi_ebitda_pct ?? 0,
        roiPatPct: c.roi_pat_pct ?? 0,
        breakEvenMonths: c.breakeven_months ?? 0,
        breakEvenRevenue: c.breakeven_revenue ?? 0,
        marginOfSafety: c.margin_of_safety ?? 0,
        currentRatio: c.current_ratio ?? 0,
        interestCoverageY1: c.interest_coverage_y1 ?? 0,
        assetTurnoverY1: c.asset_turnover_y1 ?? 0,
        stockRequirement: c.stock_req ?? 0,
        debtors: c.debtors ?? 0,
        creditors: c.creditors ?? 0,
        netWorkingCapital: c.net_wc ?? 0,
        totalCurrentAssets: c.total_ca ?? 0,
        totalCurrentLiabilities: c.total_cl ?? 0,
        totalScore: c.total_score ?? 0,
        creditRating: c.credit_rating ?? "",
        recommendation: c.recommendation ?? "",
        riskLevel: c.risk_level ?? "",
        projections: c.projections_5yr ?? [],
        yearlyRepayment: c.yr_schedule ?? [],
        monthlyCashflows: [],
        sensitivity: c.sensitivity ?? [],
        marginMoney: c.margin_money ?? 0,
        marginMoneyPct: c.margin_money_pct ?? 0,
        pmegpCategoryType: meta.pmegp_finance?.category_type ?? "",
        pmegpTdrNote: c.tdr_note ?? meta.pmegp_finance?.tdr_note ?? "",
        reportRef: meta.report_id ?? "",
        applicationId: meta.report_id ?? "",
        preparedOn: meta.generated_on ?? "",
      };
    }
    const r = json.report;
    if (!r) return null;

    const s1 = r.section_1_executive_summary ?? {};
    const s5 = r.section_5_financial_analysis ?? {};
    const s6 = r.section_6_loan_assessment ?? {};
    const s7 = r.section_7_repayment_capability ?? {};
    const s8 = r.section_8_risk_analysis ?? {};
    const s9 = r.section_9_projections_and_forecasts ?? {};
    const meta = r.report_metadata ?? {};

    const pl = s5.monthly_profit_and_loss ?? {};
    const annual = s5.annual_summary ?? {};
    const loanSpec = s6.loan_specifications ?? {};
    const dscr = s7.dscr_analysis ?? {};
    const be = s7.break_even_analysis ?? {};
    const ret = s7.return_metrics ?? {};
    const wc = r.section_4_project_details?.working_capital_assessment ?? {};
    const scorecard = s6.weighted_scorecard ?? {};
    const keyMetrics = s1.key_metrics ?? {};

    return {
      netMonthlyRevenue: pl.net_monthly_revenue ?? keyMetrics.monthly_revenue ?? 0,
      monthlyEbitda: pl.ebitda ?? keyMetrics.monthly_ebitda ?? 0,
      monthlyEbi: pl.ebit ?? 0,
      monthlyPat: pl.profit_after_tax ?? 0,
      monthlyEmi: pl.debt_service_emi ?? loanSpec.monthly_emi ?? keyMetrics.monthly_emi ?? 0,
      netMonthlySurplus: pl.net_cash_surplus ?? 0,
      annualRevenue: annual.annual_revenue ?? 0,
      annualEbitda: annual.annual_ebitda ?? 0,
      annualPat: annual.annual_pat ?? 0,
      annualSurplus: keyMetrics.annual_surplus ?? 0,
      ebitdaMarginPct: pl.ebitda_margin_pct ?? 0,
      netMarginPct: annual.net_profit_margin_pct ?? 0,

      totalLoanAmount: loanSpec.total_loan_amount ?? keyMetrics.loan_amount ?? 0,
      termLoanAmount: loanSpec.term_loan_amount ?? 0,
      workingCapitalLoan: loanSpec.working_capital_loan ?? 0,
      processingFeeAmount: loanSpec.processing_fee_amount ?? 0,
      totalInterestOutgo: loanSpec.total_interest_outgo ?? ret.total_interest_outgo ?? 0,
      monthlyInterestY1: pl.less_interest ?? 0,
      monthlyDepreciation: pl.less_depreciation ?? 0,

      dscr: dscr.monthly_dscr ?? keyMetrics.dscr ?? 0,
      avgDscr5yr: dscr.average_dscr_5yr ?? 0,
      roiEbitdaPct: ret.roi_ebitda_basis_pct ?? keyMetrics.roi_ebitda_pct ?? 0,
      roiPatPct: ret.roi_pat_basis_pct ?? 0,
      breakEvenMonths: be.break_even_months ?? keyMetrics.break_even_months ?? 0,
      breakEvenRevenue: be.break_even_revenue_monthly ?? annual.break_even_revenue ?? 0,
      marginOfSafety: be.margin_of_safety_monthly ?? annual.margin_of_safety ?? 0,
      currentRatio: wc.current_ratio ?? 0,
      interestCoverageY1: ret.interest_coverage_year1 ?? 0,
      assetTurnoverY1: ret.asset_turnover_year1 ?? 0,

      stockRequirement: wc.stock_requirement ?? 0,
      debtors: wc.debtors ?? 0,
      creditors: wc.creditors ?? 0,
      netWorkingCapital: wc.net_working_capital ?? 0,
      totalCurrentAssets: wc.total_current_assets ?? 0,
      totalCurrentLiabilities: wc.total_current_liabilities ?? 0,

      totalScore: scorecard.total_score ?? s1.weighted_score ?? 0,
      creditRating: scorecard.credit_rating ?? s1.credit_rating ?? "",
      recommendation: scorecard.recommendation ?? s1.preliminary_recommendation ?? "",
      riskLevel: s1.risk_level ?? "",

      projections: s9.five_year_profitability ?? [],
      yearlyRepayment: s6.repayment_schedule?.yearly_summary ?? [],
      monthlyCashflows: s7.monthly_cashflow_first_3_months ?? [],
      sensitivity: s8.sensitivity_analysis ?? [],

      reportRef: meta.report_reference ?? "",
      applicationId: meta.application_id ?? "",
      preparedOn: meta.prepared_on ?? "",
    };
  } catch (err) {
    console.warn("CMA API unreachable — falling back to frontend calculations", err);
    return null;
  }
}
