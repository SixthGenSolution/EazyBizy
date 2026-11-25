"""
schemes/router.py — Master scheme router.

CA-Standard Project Finance Formula:
  Fixed Project Cost  = sum of fixed assets only (capex)
  Term Loan           = Fixed Project Cost × bank_finance_pct
  Promoter Fixed Eq.  = Fixed Project Cost − Term Loan
  Promoter WC Margin  = WC_Required × (1 − wc_loan_pct)
  WC Bank Loan        = WC_Required × wc_loan_pct
  Total Project Cost  = Term Loan + WC Bank Loan + Promoter Contribution
  Total Bank Exposure = Term Loan + WC Bank Loan

  WC Loan is a REVOLVING facility — never mixed with term loan or fixed project cost.

Scheme-specific financing-split rates (term-loan %, DSCR benchmark,
moratorium override) are read from the Rules & Rates engine
(rules/engine.py), never hardcoded in this module.
"""

from models.input_schema import CMAReportInput, SchemeType, SocialCategory
from rules            import get_default_engine, normalize_scheme_id
from schemes.pmegp   import calculate_pmegp_finance, validate_pmegp
from schemes.mudra   import calculate_mudra_finance, validate_mudra
from schemes.cgtmse  import calculate_cgtmse_fee
from schemes.msme    import calculate_msme_finance

SPECIAL_CATEGORIES = {
    SocialCategory.SC, SocialCategory.ST, SocialCategory.OBC,
    SocialCategory.Minority, SocialCategory.Women,
    SocialCategory.ExServiceman, SocialCategory.PwD,
}

_MUDRA_SCHEMES = {
    SchemeType.Mudra_Shishu,
    SchemeType.Mudra_Kishor,
    SchemeType.Mudra_Tarun,
    SchemeType.Mudra_TarunPlus,
}


def route_scheme(data: CMAReportInput) -> dict:
    """
    Dispatch to the correct scheme calculator.
    Returns a dict with at minimum:
        promoter_amount, promoter_pct, term_loan, term_loan_pct,
        margin_money, margin_money_pct, project_cost,
        wc_loan, wc_loan_note,
        scheme, report_type, dscr_benchmark, moratorium_months
    """
    scheme                       = data.scheme
    engine                       = get_default_engine()
    fixed_pc, wc_margin, wc_loan = _compute_project_cost(data)
    promoter_total               = round(float(data.promoter_contribution or 0)) if hasattr(data, "promoter_contribution") else 0

    def total_project_cost(finance: dict) -> int:
        return round(
            float(finance.get("term_loan", 0) or 0)
            + float(finance.get("promoter_amount", 0) or 0)
            + wc_margin
            + wc_loan
        )

    if scheme == SchemeType.PMEGP:
        validate_pmegp(fixed_pc, data.business.industry_type, data.business.business_status)
        cat     = "Special" if data.applicant.social_category in SPECIAL_CATEGORIES else "General"
        finance = calculate_pmegp_finance(fixed_pc, cat, data.applicant.area_type)
        return {
            **finance,
            "project_cost":      total_project_cost(finance),
            "fixed_project_cost": round(fixed_pc),
            "wc_margin":         round(wc_margin),
            "wc_loan":           round(wc_loan),
            "wc_loan_note":      f"Working Capital Facility (Revolving): ₹{round(wc_loan):,} — included in total project cost, separate from fixed project cost",
            "scheme":            "PMEGP",
            "report_type":       "FULL_CMA",
            "dscr_benchmark":    engine.get_dscr_benchmark("pmegp"),
            "moratorium_months": data.assumptions.moratorium_months,
        }

    if scheme in _MUDRA_SCHEMES:
        validate_mudra(fixed_pc, scheme)
        finance = calculate_mudra_finance(fixed_pc, scheme)
        tier_key = scheme.value.strip().lower().replace("-", "_").replace(" ", "_")
        report_type = {
            "mudra_shishu": "SIMPLIFIED",
            "mudra_kishor": "LIGHT_CMA",
        }.get(tier_key, "FULL_CMA")
        dscr_bench = engine.get_dscr_benchmark(tier_key)
        moratorium = engine.get_moratorium_months_default(tier_key)
        if moratorium is None:
            moratorium = data.assumptions.moratorium_months
        return {
            **finance,
            "project_cost":      total_project_cost(finance),
            "fixed_project_cost": round(fixed_pc),
            "wc_margin":         round(wc_margin),
            "wc_loan":           round(wc_loan),
            "wc_loan_note":      f"Working Capital Facility (Revolving): ₹{round(wc_loan):,} — included in total project cost, separate from fixed project cost",
            "scheme":            scheme.value,
            "report_type":       report_type,
            "dscr_benchmark":    dscr_bench,
            "moratorium_months": moratorium,
        }

    if scheme == SchemeType.CGTMSE:
        # CA standard: TL = fixed % of fixed capital only (Rules Master), Promoter = residual
        tl_pct     = engine.get_term_loan_pct_default("cgtmse")
        loan       = round(fixed_pc * tl_pct)
        promoter   = round(fixed_pc - loan)
        cgtmse     = calculate_cgtmse_fee(loan)
        moratorium = engine.get_moratorium_months_default("cgtmse")
        if moratorium is None:
            moratorium = data.assumptions.moratorium_months
        return {
            "promoter_amount":     promoter,
            "promoter_pct":        round(promoter / fixed_pc * 100, 1) if fixed_pc else 0,
            "term_loan":           loan,
            "term_loan_pct":       round(tl_pct * 100, 1),
            "margin_money":        0,
            "margin_money_pct":    0,
            "cgtmse_annual_fee":   cgtmse["annual_fee"],
            "cgtmse_agf_pct":      cgtmse["agf_rate_pct"],
            "cgtmse_coverage_pct": cgtmse["coverage_pct"],
            "cgtmse_note":         cgtmse["note"],
            "project_cost":        total_project_cost({"term_loan": loan, "promoter_amount": promoter}),
            "fixed_project_cost":  round(fixed_pc),
            "wc_margin":           round(wc_margin),
            "wc_loan":             round(wc_loan),
            "wc_loan_note":        f"Working Capital Facility (Revolving): ₹{round(wc_loan):,} — included in total project cost, separate from fixed project cost",
            "scheme":              "CGTMSE",
            "report_type":         "FULL_CMA",
            "dscr_benchmark":      engine.get_dscr_benchmark("cgtmse"),
            "moratorium_months":   moratorium,
        }

    if scheme == SchemeType.MSME_PSU:
        finance = calculate_msme_finance(fixed_pc, data)
        return {
            **finance,
            "project_cost":      total_project_cost(finance),
            "fixed_project_cost": round(fixed_pc),
            "wc_margin":         round(wc_margin),
            "wc_loan":           round(wc_loan),
            "wc_loan_note":      f"Working Capital Facility (Revolving): ₹{round(wc_loan):,} — included in total project cost, separate from fixed project cost",
            "scheme":            "MSME",
            "report_type":       "FULL_CMA",
            "dscr_benchmark":    engine.get_dscr_benchmark("msme_psu"),
            "moratorium_months": data.assumptions.moratorium_months,
        }

    raise ValueError(f"Unsupported scheme: {scheme!r}")


def _compute_project_cost(data: CMAReportInput) -> tuple:
    """
    CA-Standard: compute fixed project cost, WC margin, and WC bank loan separately.

    Fixed Project Cost = Land + Building + (P&M × (1+contingency)) + Fixtures + Prelim
    Promoter WC Margin = WC_Required × (1 − wc_loan_pct)
    WC Bank Loan       = WC_Required × wc_loan_pct
    Total Project Cost = Fixed Project Cost + Promoter WC Margin  (caller computes this)

    Returns (fixed_project_cost, wc_margin, wc_loan)
    """
    contingency_pct = float(getattr(data.assumptions, "contingency_pct", 0) or 0) / 100
    wc_loan_pct_raw = getattr(data.assumptions, "wc_loan_pct", None)
    wc_loan_pct     = (
        float(wc_loan_pct_raw) / 100 if wc_loan_pct_raw
        else get_default_engine().get_wc_loan_pct_default(normalize_scheme_id(data.scheme.value))
    )

    machinery_base = sum(
        float(m.quantity) * float(m.unit_price)
        for m in data.project.machinery_items
    ) + float(data.project.tools_installation or 0)

    pm_with_contingency = machinery_base * (1 + contingency_pct)

    fixtures = (
        float(getattr(data.project, "computers_cost",       0) or 0)
        + float(getattr(data.project, "furniture_cost",     0) or 0)
        + float(getattr(data.project, "electrification_cost", 0) or 0)
        + float(getattr(data.project, "racks_storage_cost", 0) or 0)
        + float(getattr(data.project, "transportation_cost", 0) or 0)
    )
    fixed_project_cost = (
        float(data.project.land_cost           or 0)
        + float(data.project.building_cost     or 0)
        + pm_with_contingency
        + fixtures
        + float(data.project.preliminary_expenses or 0)
    )

    wc_total  = _estimate_initial_wc(data)
    wc_margin = wc_total * (1 - wc_loan_pct)   # promoter's WC contribution
    wc_loan   = wc_total * wc_loan_pct          # bank's revolving WC facility

    return fixed_project_cost, wc_margin, wc_loan


def _estimate_initial_wc(data: CMAReportInput) -> float:
    """Estimate Year-1 WC requirement using 1.5 months of Year-1 capacity revenue."""
    from core.engine import DEFAULT_CAPACITY_SCHEDULE, annual_revenue_from_prod
    annual_rev = annual_revenue_from_prod(data.production)
    if annual_rev <= 0:
        return 0.0
    cap_y1 = float(getattr(data.assumptions, "capacity_y1_pct", DEFAULT_CAPACITY_SCHEDULE[0] * 100) or DEFAULT_CAPACITY_SCHEDULE[0] * 100) / 100
    return annual_rev * cap_y1 / 12 * 1.5
