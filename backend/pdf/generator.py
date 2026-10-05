"""
pdf/generator.py
================
Bridge between the new structured report_data dict (produced by routers/report.py)
and the existing pdf_builder.build_pdf() function.

Usage
-----
    from pdf.generator import generate_pdf
    generate_pdf(report_data, "/tmp/CMA_ABC123.pdf")
"""

from __future__ import annotations
from core.engine import R, interest_coverage_ratio
from datetime import datetime as _datetime


def _fmt_date(raw: str) -> str:
    """Convert ISO date 'YYYY-MM-DD' → '01 April 2025'. Passes through if already formatted."""
    if not raw:
        return ""
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return _datetime.strptime(raw, fmt).strftime("%d %B %Y")
        except ValueError:
            continue
    return raw


def _format_enum_or_freetext(raw: str) -> str:
    """Title-case an underscore-separated ENUM token (e.g. "plus_two" ->
    "Plus Two"), but pass free text straight through unchanged.

    BUG FIX: this used to call .title() unconditionally on any value not
    matching a known enum key — including free text an applicant actually
    typed, like "Intermediate (12th)". Python's .title() capitalises after
    every non-letter boundary, including digits, so "12th" became "12Th".
    A value already containing a space or non-alphanumeric formatting is
    free text, not an enum code, and must not be re-cased at all.
    """
    raw = str(raw or "")
    if "_" in raw and " " not in raw:
        return raw.replace("_", " ").title()
    return raw


def _calc_gross_margin_pct(income: list, monthly: dict | None = None) -> float:
    """Return Year-1 gross margin % = (Revenue − COGS) / Revenue × 100."""
    # Priority 1: Use monthly_pnl if available (most fresh)
    if monthly and monthly.get("gross_margin_pct"):
        return float(monthly["gross_margin_pct"])
        
    if not income:
        return 0.0
    yr1 = income[0]
    rev  = float(yr1.get("revenue", yr1.get("sales", 0)) or 0)
    # COGS can be under many names across different engine modes
    cogs = float(yr1.get("cogs", yr1.get("raw_materials", yr1.get("direct_costs", 0))) or 0)
    
    if rev <= 0:
        return 0.0
    return R((rev - cogs) / rev * 100, 1)


def validate_report_data(report_data: dict, cma: dict, dpr: dict, inp: dict):
    """
    Pre-PDF validation gate. Logs warnings; raises ValueError for BLOCKING issues.

    BLOCKING (raises ValueError — PDF export prevented):
      - NaN / Infinity in any key financial field
      - Unresolved template placeholder strings in critical WC fields
      - Project cost line items do not sum to total_project_cost (>Rs.5 gap)
      - Means of finance total does not reconcile with project cost (>Rs.5 gap)
      - Loan schedule principal sum > term loan (amortization overrun)
      - Monthly P&L arithmetic chain inconsistency (GP, EBITDA, PAT, Surplus)

    NON-BLOCKING (logged as WARNING):
      - Avg DSCR inconsistency
      - Salary zero with employees > 0
      - WC loan mismatch between CMA and DPR
      - Break-even inconsistency
      - Sensitivity base case vs master engine revenue mismatch
      - Balance sheet reconciliation gaps
    """
    import logging, math
    logger = logging.getLogger("pdf_validator")
    blocking_errors = []
    validation_warnings = report_data.setdefault("validation_warnings", [])

    def _is_nan(v):
        try:
            f = float(v)
            return math.isnan(f) or math.isinf(f)
        except (TypeError, ValueError):
            return False

    # ── 1. NaN / Infinity guard on critical financial fields ─────────────────
    critical_fields = [
        "net_monthly_revenue", "ebitda_monthly", "pbt_monthly", "pat_monthly",
        "surplus_monthly", "dscr_y1", "avg_dscr", "roi_ebitda_pct", "roi_pat_pct",
        "total_project_cost", "annual_revenue", "annual_pat",
    ]
    for field in critical_fields:
        val = cma.get(field)
        if _is_nan(val):
            blocking_errors.append(f"NaN/Inf in cma['{field}'] = {val}")

    # ── 2. Unresolved template placeholder check (WC table) ──────────────────
    placeholder_keys = ["rm_wc", "wip_wc", "fg_wc"]
    for yr_wc in dpr.get("working_capital_years", []):
        for pk in placeholder_keys:
            v = yr_wc.get(pk)
            if isinstance(v, str):
                blocking_errors.append(
                    f"Unresolved WC placeholder: working_capital_years[year={yr_wc.get('year')}]['{pk}'] = '{v}'"
                )

    # ── 3. Project cost reconciliation ───────────────────────────────────────
    _items     = cma.get("project_cost_items", [])
    _items_sum = sum(float(it.get("amount", 0) or 0) for it in _items)
    _total_pc  = float(cma.get("total_project_cost", 0) or 0)
    if _items and abs(_items_sum - _total_pc) > 5:
        blocking_errors.append(
            f"Project cost reconciliation failed: items sum Rs.{_items_sum:,.0f} "
            f"≠ total_project_cost Rs.{_total_pc:,.0f} (gap Rs.{abs(_items_sum - _total_pc):,.0f})"
        )

    # ── 4. Means of finance reconciliation (NON-BLOCKING) ────────────────────
    # CA Rule: Term Loan + Promoter Equity + Subsidy must exactly equal Fixed Project Cost.
    # Use promoter_fixed_equity here. Total promoter contribution includes WC margin
    # and must not be mixed into fixed-project MoF.
    _mof_tl       = float(cma.get("term_loan",            0) or 0)
    _mof_promoter = float(cma.get("promoter_fixed_equity", cma.get("promoter_contribution", 0)) or 0)
    _mof_subsidy  = float(cma.get("margin_money",          0) or 0)
    _mof_total    = R(_mof_tl + _mof_promoter + _mof_subsidy, 2)
    _fixed_pc     = float(cma.get("fixed_project_cost",    0) or 0)
    if _fixed_pc > 0 and _mof_total > 0 and abs(_mof_total - _fixed_pc) > 5:
        validation_warnings.append(
            f"Means of Finance reconciliation warning: "
            f"TL Rs.{_mof_tl:,.0f} + Promoter Rs.{_mof_promoter:,.0f} + Subsidy Rs.{_mof_subsidy:,.0f} "
            f"= Rs.{_mof_total:,.0f} ≠ Fixed Project Cost Rs.{_fixed_pc:,.0f} "
            f"(gap Rs.{abs(_mof_total - _fixed_pc):,.0f}). PDF generated for review; revise MoF inputs before bank submission."
        )

    # ── 5. Loan amortization integrity ───────────────────────────────────────
    _tl_amount      = float(cma.get("term_loan", 0) or 0)
    _principal_sum  = sum(float(r.get("principal_paid", 0)) for r in report_data.get("loan_schedule", []))
    if _tl_amount > 0 and _principal_sum > _tl_amount + 5:
        blocking_errors.append(
            f"Loan amortization overrun: principal repaid Rs.{_principal_sum:,.0f} "
            f"> term loan Rs.{_tl_amount:,.0f}"
        )

    # ── Non-blocking checks ───────────────────────────────────────────────────
    avg_dscr = float(cma.get("avg_dscr", 0))
    if avg_dscr == 0 and float(cma.get("dscr_y1", 0)) > 0:
        logger.warning("VALIDATION WARN: Avg DSCR is 0 but Year 1 DSCR > 0 — check DSCR years list.")

    salary_total = float(cma.get("annual_salary_total", 0))
    if salary_total <= 0 and int(inp.get("num_employees", 0)) > 0:
        logger.warning("VALIDATION WARN: Annual salary total is 0 but num_employees > 0.")

    wc_loan_cma = float(cma.get("working_capital_loan", 0))
    wc_loan_dpr = float(dpr.get("project_cost", {}).get("wc_loan", 0))
    if abs(wc_loan_cma - wc_loan_dpr) > 5:
        logger.warning(
            f"VALIDATION WARN: WC Loan mismatch — CMA Rs.{wc_loan_cma:,.0f} vs DPR Rs.{wc_loan_dpr:,.0f}"
        )

    _be_val = cma.get("breakeven_months")
    if cma.get("payback_not_achievable") and _be_val is not None:
        try:
            if float(_be_val) > 0:
                logger.warning("VALIDATION WARN: Break-even marked not-achievable but months > 0.")
        except (TypeError, ValueError):
            pass

    # ── 6. Monthly P&L arithmetic chain (Item 1 / Item 11) ───────────────────
    # CA Rule: GP = Rev−COGS, EBITDA = Rev−OpEx, PBT = EBITDA−Dep−Int,
    #          PAT = PBT−Tax, Net Cash Surplus = PAT+Dep−Principal
    _mpnl = report_data.get("monthly_pnl") or {}
    _tol  = 2.0   # Rs. 2 rounding tolerance (R() rounds to 2dp)
    _pl_rev    = float(_mpnl.get("net_monthly_revenue",  0) or 0)
    _pl_cogs   = float(_mpnl.get("cogs_monthly",          0) or 0)
    _pl_gp     = float(_mpnl.get("gross_profit_monthly",  0) or 0)
    _pl_opex   = float(_mpnl.get("operating_monthly_exp",
                        _mpnl.get("total_monthly_exp",   0)) or 0)
    _pl_ebitda = float(_mpnl.get("ebitda_monthly",        0) or 0)
    _pl_dep    = float(_mpnl.get("monthly_dep",           0) or 0)
    _pl_int    = float(_mpnl.get("monthly_int_y1",        0) or 0)
    _pl_pbt    = float(_mpnl.get("pbt_monthly",           0) or 0)
    _pl_tax    = float(_mpnl.get("tax_monthly",           0) or 0)
    _pl_pat    = float(_mpnl.get("pat_monthly",           0) or 0)
    _pl_surpl  = float(_mpnl.get("surplus_monthly",       0) or 0)
    _pl_princ  = float(_mpnl.get("monthly_principal",     0) or 0)

    if _pl_rev > 0:
        _gp_expected = _pl_rev - _pl_cogs
        if abs(_pl_gp - _gp_expected) > _tol:
            blocking_errors.append(
                f"P&L arithmetic — Gross Profit: "
                f"Rs.{_pl_gp:,.0f} ≠ Rev Rs.{_pl_rev:,.0f} − COGS Rs.{_pl_cogs:,.0f} "
                f"= Rs.{_gp_expected:,.0f} (gap Rs.{abs(_pl_gp-_gp_expected):,.1f})")
        _ebitda_expected = _pl_rev - _pl_opex
        if abs(_pl_ebitda - _ebitda_expected) > _tol:
            blocking_errors.append(
                f"P&L arithmetic — EBITDA: "
                f"Rs.{_pl_ebitda:,.0f} ≠ Rev Rs.{_pl_rev:,.0f} − OpEx Rs.{_pl_opex:,.0f} "
                f"= Rs.{_ebitda_expected:,.0f} (gap Rs.{abs(_pl_ebitda-_ebitda_expected):,.1f})")
        _pbt_expected = _pl_ebitda - _pl_dep - _pl_int
        if abs(_pl_pbt - _pbt_expected) > _tol:
            blocking_errors.append(
                f"P&L arithmetic — PBT: "
                f"Rs.{_pl_pbt:,.0f} ≠ EBITDA Rs.{_pl_ebitda:,.0f} − Dep Rs.{_pl_dep:,.0f} "
                f"− Int Rs.{_pl_int:,.0f} = Rs.{_pbt_expected:,.0f} "
                f"(gap Rs.{abs(_pl_pbt-_pbt_expected):,.1f})")
        _pat_expected = _pl_pbt - _pl_tax
        if abs(_pl_pat - _pat_expected) > _tol:
            blocking_errors.append(
                f"P&L arithmetic — PAT: "
                f"Rs.{_pl_pat:,.0f} ≠ PBT Rs.{_pl_pbt:,.0f} − Tax Rs.{_pl_tax:,.0f} "
                f"= Rs.{_pat_expected:,.0f} (gap Rs.{abs(_pl_pat-_pat_expected):,.1f})")
        _surpl_expected = _pl_pat + _pl_dep - _pl_princ
        if abs(_pl_surpl - _surpl_expected) > _tol:
            blocking_errors.append(
                f"P&L arithmetic — Net Cash Surplus: "
                f"Rs.{_pl_surpl:,.0f} ≠ PAT Rs.{_pl_pat:,.0f} + Dep Rs.{_pl_dep:,.0f} "
                f"− Principal Rs.{_pl_princ:,.0f} = Rs.{_surpl_expected:,.0f} "
                f"(gap Rs.{abs(_pl_surpl-_surpl_expected):,.1f})")

    # ── 7. Balance sheet reconciliation (Item 9 / Item 11) ───────────────────
    # Total Assets must equal Total Liabilities for each year (accounting identity).
    for _pb in report_data.get("balance_sheet", [])[1:]:   # skip Year 0
        _yr_n = _pb.get("year", "?")
        _ta   = float(_pb.get("total_assets",      0) or 0)
        _tl2  = float(_pb.get("total_liabilities", 0) or 0)
        _gap  = float(_pb.get("check", abs(_ta - _tl2)) or 0)
        if _ta > 0 and abs(_gap) > 1:
            blocking_errors.append(
                f"Accounting integrity error: Balance sheet mismatch in Year {_yr_n}. "
                f"Assets Rs.{_ta:,.0f} ≠ Liabilities Rs.{_tl2:,.0f} "
                f"(gap Rs.{abs(_gap):,.0f})")

    # ── Non-blocking: Sensitivity base case vs master engine ─────────────────
    _sens = report_data.get("sensitivity") or []
    if _sens:
        _sens_base = next((s for s in _sens if s.get("change_pct", -999) == 0), None)
        if _sens_base:
            _s_base_rev  = float(_sens_base.get("monthly_revenue", 0) or 0)
            _master_rev  = float(cma.get("net_monthly_revenue", 0) or 0)
            if _s_base_rev > 0 and _master_rev > 0:
                _rev_gap_pct = abs(_master_rev - _s_base_rev) / _s_base_rev * 100
                if _rev_gap_pct > 1.0:
                    logger.warning(
                        f"VALIDATION WARN: Sensitivity Base Case revenue Rs.{_s_base_rev:,.0f} "
                        f"differs from master engine Rs.{_master_rev:,.0f} "
                        f"by {round(_rev_gap_pct, 1)}% — may show inconsistent numbers.")

    # ── Block PDF if any blocking errors found ────────────────────────────────
    if blocking_errors:
        raise ValueError(
            "PDF generation blocked — fix the following issues:\n" +
            "\n".join(f"  • {e}" for e in blocking_errors)
        )


def _build_project_cost_items(project: dict, wc_sched: list, industry: str = "manufacturing", machinery_gross: float = 0.0) -> list:
    """Build project cost line items whose sum equals total project cost (Fix #1)."""
    items = []
    code = 1
    land = float(project.get("land_cost", 0) or 0)
    if land > 0:
        items.append({"code": code, "particulars": "Land & Site Development", "amount": land})
        code += 1
    building = float(project.get("building_cost", 0) or 0)
    if building > 0:
        items.append({"code": code, "particulars": "Building / Civil Works", "amount": building})
        code += 1
    industry_key = str(industry or "manufacturing").lower()
    _raw_machinery_total = sum(
        float(m.get("quantity", 1)) * float(m.get("unit_price", 0))
        for m in project.get("machinery_items", [])
    ) + float(project.get("tools_installation", 0) or 0)
    # Use the contingency-loaded Gross Block figure when available — it's what
    # Means of Finance and the term-loan/equity split are actually sized against.
    # Falling back to the raw sum made "Initial Project Investment" silently
    # understate the true fixed cost by the whole contingency amount.
    machinery_total = float(machinery_gross) if machinery_gross > 0 else _raw_machinery_total
    if machinery_total > 0:
        if industry_key in ("service", "services"):
            machinery_label = "Office Infrastructure, Service Equipment & Tools"
        elif industry_key == "trading":
            machinery_label = "Shop Equipment, Fixtures & Interiors"
        else:
            machinery_label = "Plant, Machinery & Equipment (incl. contingency)"
        items.append({"code": code, "particulars": machinery_label, "amount": machinery_total})
        code += 1
    computers = float(project.get("computers_cost", 0) or 0)
    if computers > 0:
        items.append({"code": code, "particulars": "Computers & IT Equipment", "amount": computers})
        code += 1
    furniture = float(project.get("furniture_cost", 0) or 0)
    if furniture > 0:
        items.append({"code": code, "particulars": "Furniture & Fixtures", "amount": furniture})
        code += 1
    electrification = float(project.get("electrification_cost", 0) or 0)
    if electrification > 0:
        items.append({"code": code, "particulars": "Electrification & Wiring", "amount": electrification})
        code += 1
    racks = float(project.get("racks_storage_cost", 0) or 0)
    if racks > 0:
        items.append({"code": code, "particulars": "Racks, Shelving & Storage", "amount": racks})
        code += 1
    transport = float(project.get("transportation_cost", 0) or 0)
    if transport > 0:
        items.append({"code": code, "particulars": "Vehicles & Transportation", "amount": transport})
        code += 1
    prelim = float(project.get("preliminary_expenses", 0) or 0)
    if prelim > 0:
        items.append({"code": code, "particulars": "Preliminary & Pre-operative Expenses", "amount": prelim})
        code += 1
    wc_margin = float(wc_sched[0].get("margin", 0)) if wc_sched else 0.0
    if wc_margin > 0:
        items.append({"code": code, "particulars": "Working Capital Margin (Promoter's Share)", "amount": wc_margin})
    return items


def generate_pdf(report_data: dict, output_path: str) -> None:
    """
    Generate a CMA+DPR PDF from the assembled report_data dict.

    Constructs the ``inp``, ``cma``, and ``dpr`` dicts that pdf_builder.build_pdf
    expects, then delegates to it.

    Parameters
    ----------
    report_data : dict
        Output of the /api/v1/report/generate endpoint — contains keys:
        input, scheme_data, depreciation, loan_schedule, wc_schedule,
        income_statement, dscr, monthly_pnl, break_even, balance_sheet,
        scorecard, sensitivity.
    output_path : str
        Absolute path for the output PDF file.
    """
    from .builder import build_pdf

    raw_input  = report_data.get("input") or {}
    scheme     = report_data.get("scheme_data") or {}
    dep        = report_data.get("depreciation") or {}
    loan_sched = report_data.get("loan_schedule") or []
    wc_sched   = report_data.get("wc_schedule") or []
    income     = report_data.get("income_statement") or []
    dscr_data  = report_data.get("dscr") or {}
    monthly    = report_data.get("monthly_pnl") or {}
    bep        = report_data.get("break_even") or []
    bs         = report_data.get("balance_sheet") or []
    scorecard  = report_data.get("scorecard") or {}
    sensitivity = report_data.get("sensitivity") or []

    # ── Build inp (flat dict for pdf_builder) ─────────────────────────────────
    applicant    = raw_input.get("applicant", {})
    business     = raw_input.get("business", {})
    project      = raw_input.get("project", {})
    prod         = raw_input.get("production", {})
    assum        = raw_input.get("assumptions", {})
    expenses     = raw_input.get("expenses", {})
    manpower_inp = raw_input.get("manpower", {})
    narrative    = raw_input.get("narrative", {}) or {}

    inp = {
        # Applicant
        "title":              "Ms." if str(applicant.get("gender","")).lower() == "female" else "Mr.",
        "entrepreneur_name":  applicant.get("full_name", ""),
        "full_name":          applicant.get("full_name", ""),
        "fathers_name":       applicant.get("fathers_name", ""),
        "date_of_birth":      _fmt_date(applicant.get("date_of_birth", "")),
        "gender":             str(applicant.get("gender", "")).capitalize(),
        "education":          {
                                  "post_graduate": "Post Graduate",
                                  "graduate":      "Graduate",
                                  "plus_two":      "+2 / Higher Secondary",
                                  "tenth":         "10th / SSC",
                              }.get(str(applicant.get("education", "")).lower(),
                                    _format_enum_or_freetext(applicant.get("education", ""))),
        "social_category":    str(applicant.get("social_category", "General")),
        "pan_number":         applicant.get("pan_number", ""),
        "aadhar_number":      applicant.get("aadhar_number", ""),
        "mobile":             applicant.get("mobile", ""),
        "email":              applicant.get("email", ""),
        "prepared_by":        raw_input.get("prepared_by", ""),
        "report_theme":       raw_input.get("report_theme", "Navy"),
        "to_bank":            raw_input.get("to_bank", ""),
        "address":            applicant.get("address", ""),
        "years_of_experience": int(applicant.get("years_experience", 0) or 0),
        "previous_employer":  applicant.get("previous_employer", ""),
        "previous_role":      applicant.get("previous_role", ""),
        "business_status":    business.get("business_status", "New Business"),
        # Business
        "business_name":      business.get("business_name", ""),
        "nature_of_business": business.get("nature_of_business", ""),
        "business_type":      {
                                  "proprietorship":  "Proprietorship",
                                  "partnership":     "Partnership Firm",
                                  "llp":             "LLP (Limited Liability Partnership)",
                                  "private_limited": "Private Limited Company",
                                  "opc":             "OPC (One Person Company)",
                                  "huf":             "HUF (Hindu Undivided Family)",
                                  "cooperative":     "Cooperative Society",
                                  "trust":           "Trust / Society",
                              }.get(str(business.get("business_type", "")).lower(),
                                    _format_enum_or_freetext(business.get("business_type", ""))),
        "industry":           business.get("industry_type", ""),
        "commencement_date":  _fmt_date(business.get("commencement_date", "")),
        "primary_location":   business.get("location", ""),
        "market_size":        "",
        "market_growth":      "",
        "expected_employment": int(business.get("expected_employment", 0) or 0),
        "gross_margin_pct":   _calc_gross_margin_pct(income),
        "location":           business.get("location", ""),
        "district":           business.get("district", ""),
        "area_type":          applicant.get("area_type", "Rural"),
        "implementing_agency": business.get("implementing_agency", ""),
        "gst_number":               business.get("gst_number", ""),
        "msme_number":              business.get("msme_number", ""),
        "business_duration_months": int(business.get("business_duration_months", 0) or 0),
        "existing_annual_turnover": float(business.get("existing_annual_turnover", 0) or 0),
        "existing_annual_profit":   float(business.get("existing_annual_profit", 0) or 0),
        "existing_monthly_emi":     float(business.get("existing_monthly_emi", 0) or 0),
        "scheme_label":             business.get("scheme_label", ""),
        "primary_raw_material":     business.get("primary_raw_material", ""),
        "raw_material_supplier":    business.get("raw_material_supplier", ""),
        "bank_name":          business.get("bank_name", ""),
        # Loan display fields (Step 9 loan section)
        "collateral":  business.get("collateral_details", "") or "Hypothecation of assets",
        "guarantor":   (
            (business.get("guarantor_name", "") or "").strip() +
            (" (" + (business.get("guarantor_relation", "") or "").strip() + ")"
             if (business.get("guarantor_relation", "") or "").strip() else "")
        ).strip() or "As per sanction",
        # Competitors from Step 9 (list of dicts: name, type, distance, strengths, weaknesses)
        "competitors": raw_input.get("competitors") or [],
        "scheme":             business.get("scheme_label") or scheme.get("scheme", "PMEGP"),
        "loan_type":          {
                                  "term_loan":                "Term Loan",
                                  "working_capital":          "Working Capital",
                                  "term_and_working_capital": "Term Loan + Working Capital (Composite)",
                              }.get(str(raw_input.get("loan_purpose", "") or ""), "Term Loan"),
        # Production (DPR fields)
        "working_days_per_year": int(prod.get("working_days_per_year", 300) or 300),
        "fresh_leaves_per_day_kg": float(prod.get("input_qty_per_day", 0) or 0),
        "yield_rate":         float(prod.get("output_yield_pct", 100) or 100) / 100,
        "hours_of_operation": float(prod.get("hours_of_operation", 8) or 8),
        "selling_price_per_kg": float(prod.get("selling_price_per_unit", 0) or 0),
        "cost_fresh_leaves_per_kg": float(prod.get("raw_material_cost_per_unit", 0) or 0),
        "cost_consumables_per_kg":  0,
        "cost_pet_bottle":          0,
        # Machinery (from project)
        "cost_per_sqft":      500,
        "built_up_area_sqft": float(project.get("building_cost", 0) or 0) / 500,
        # Manpower — from manpower_inp (filled by buildCMAReportInput.ts)
        "promoter_daily_wage":       0,
        "num_skilled_workers":       int(manpower_inp.get("skilled_count", 0) or 0),
        "skilled_worker_daily_wage": R(float(manpower_inp.get("skilled_salary", 0) or 0) / 26),
        "num_semi_skilled_workers":  int(manpower_inp.get("semi_skilled_count", 0) or 0),
        "semi_skilled_daily_wage":   R(float(manpower_inp.get("semi_skilled_salary", 0) or 0) / 26),
        "unskilled_daily_wage":      R(float(manpower_inp.get("unskilled_salary", 0) or 0) / 26),
        # Financial assumptions — all read from user input, never hardcoded
        "capital_subsidy_scheme_details": assum.get("capital_subsidy_scheme_details", "") or "",
        "promoter_drawings_pct": float(assum.get("promoter_drawings_pct", 0) or 0),
        "contingency_rate":   float(assum.get("contingency_pct", 0) or 0) / 100,
        "term_loan_pct":      float(assum.get("term_loan_pct", 75) or 75) / 100,
        "wc_loan_pct":        float(assum.get("wc_loan_pct", 60) or 60) / 100,
        "term_loan_interest": float(assum.get("interest_rate_pct", 10.5) or 10.5) / 100,
        "wc_interest_rate":   float(assum.get("interest_rate_pct", 10.5) or 10.5) / 100,
        "salary_increase_rate": float(assum.get("salary_increase_pct", 10) or 10) / 100,
        "admin_increase_rate":  float(assum.get("expense_growth_pct", 5) or 5) / 100,
        # marketing_expense_pct: derive from income Year 1 (marketing / revenue) so it
        # reflects whatever the user actually entered (absolute amount or industry default).
        "marketing_expense_pct": (
            R(float(income[0].get("marketing", income[0].get("marketing_expenses", 0)) or 0) /
              max(float(income[0].get("revenue", 1) or 1), 1), 4)
            if income else 0.0
        ),
        "building_dep_rate_wdv":  float(assum.get("building_dep_rate_pct", 5) or 5) / 100,
        "machinery_dep_rate_wdv": float(assum.get("depreciation_pct", 10) or 10) / 100,
        "revenue_growth_pct":  float(assum.get("revenue_growth_pct", 7) or 7),
        "salary_increase_pct": float(assum.get("salary_increase_pct", 10) or 10),
        "admin_increase_pct":  float(assum.get("expense_growth_pct", 5) or 5),
        "tax_rate_pct":        float(assum.get("tax_rate_pct", 25) or 25),
        "stock_holding_days":  int(assum.get("stock_holding_days", 30) or 30),
        "debtor_days":         (int(assum["debtor_days"]) if assum.get("debtor_days") is not None else 30),
        "creditor_days":       int(assum.get("creditor_days", 15) or 15),
        "wip_days":            int(assum.get("wip_days", 15) or 15),
        "fg_days":             int(assum.get("fg_days", 30) or 30),
        "wc_raw_material_days": int(assum.get("stock_holding_days", 30) or 30),
        "wc_wip_days":         int(assum.get("wip_days", 15) or 15),
        "wc_finished_goods_days": int(assum.get("fg_days", 30) or 30),
        "wc_working_expenses_days": 30,
        "loan_tenure_years":   max(int(float(assum.get("tenure_months", 60) or 60) / 12), 1),
        # CA AUDIT: display the moratorium the loan schedule ACTUALLY
        # applied (rounded to the nearest half-year, since repayment runs
        # on a half-yearly cycle), not the raw applicant input — a 9-month
        # request rounds to a 12-month effective moratorium (2 half-years),
        # and showing "9 Month(s)" next to a schedule with a full Year 1 of
        # zero principal repaid would silently disagree with the schedule
        # a reader can see right below it.
        "moratorium_months":   int(loan_sched[0].get("moratorium_months_effective", 0)) if loan_sched else int(float(assum.get("moratorium_months", 0) or 0)),
        "moratorium_months_requested": int(float(assum.get("moratorium_months", 0) or 0)),
        "moratorium_years":    max((int(loan_sched[0].get("moratorium_months_effective", 0)) if loan_sched else int(float(assum.get("moratorium_months", 0) or 0))) / 12, 0),
        # products: now in CMAReportInput schema — no longer silently dropped by FastAPI
        "products_list": (
            raw_input.get("products") or
            raw_input.get("manufacturing_products") or
            raw_input.get("trading_products") or
            raw_input.get("service_products") or
            raw_input.get("agriculture_products") or
            []
        ),
        # Alias so builder.py can read products from inp directly (used in Section D)
        "products": (
            raw_input.get("products") or
            raw_input.get("manufacturing_products") or
            raw_input.get("trading_products") or
            raw_input.get("service_products") or
            []
        ),
        # Expense fields — from expenses dict (filled by buildCMAReportInput.ts)
        "rent":                float(expenses.get("monthly_rent", expenses.get("rent", 0)) or 0),
        "num_employees":       (
            int(manpower_inp.get("skilled_count", 0) or 0) +
            int(manpower_inp.get("semi_skilled_count", 0) or 0) +
            int(manpower_inp.get("unskilled_count", 0) or 0)
        ) or int(business.get("expected_employment", 0) or 0),
        "salary_per_employee": _avg_salary(manpower_inp),
        "stationery":          float(expenses.get("stationery", 0) or 0),
        "electricity_water":   float(expenses.get("electricity_water", 0) or 0),
        "repair_maintenance":  float(expenses.get("repair_maintenance", 0) or 0),
        "transport_conveyance": float(expenses.get("transport_conveyance", 0) or 0),
        "telephone_internet":  float(expenses.get("telephone_internet", 0) or 0),
        "miscellaneous":       float(expenses.get("miscellaneous", 0) or 0),
        # Capacity — read from user assumptions (frontend sends capacity_y*_pct)
        "capacity_y1": float(assum.get("capacity_y1_pct", 50) or 50) / 100,
        "capacity_y2": float(assum.get("capacity_y2_pct", 60) or 60) / 100,
        "capacity_y3": float(assum.get("capacity_y3_pct", 70) or 70) / 100,
        "capacity_y4": float(assum.get("capacity_y4_pct", 75) or 75) / 100,
        "capacity_y5": float(assum.get("capacity_y5_pct", 80) or 80) / 100,
        # Step 4 narrative texts (appear verbatim in PDF sections A4+)
        "business_description":    narrative.get("business_description", ""),
        "products_services":       narrative.get("products_services", ""),
        "target_market":           narrative.get("target_market", ""),
        "competitive_advantage":   narrative.get("competitive_advantage", ""),
        "promoter_experience":     narrative.get("promoter_experience", ""),
        "introduction_text":       narrative.get("introduction_text", ""),
        "market_aspects_text":     narrative.get("market_aspects_text", ""),
        "management_aspects_text": narrative.get("management_aspects_text", ""),
        "technical_aspects_text":  narrative.get("technical_aspects_text", ""),
        "financial_aspects_text":  narrative.get("financial_aspects_text", ""),
    }

    # ── Build CMA dict ────────────────────────────────────────────────────────
    yr1_sched   = loan_sched[0] if loan_sched else {}
    wc_y1       = wc_sched[0]   if wc_sched   else {}
    tenure_yrs  = max(int(float(assum.get("tenure_months", 60) or 60) // 12), 1)
    # BUG FIX: when the applicant describes volume/pricing via the
    # production section's per-unit fields (selling_price_per_unit) rather
    # than an explicit products list — the normal way to describe a
    # per-job/per-unit service business — this fallback used to show a
    # meaningless "Qty: 1 @ Rs.<entire month's revenue>" row instead of the
    # applicant's own per-unit price. Derive units_per_month from the real
    # selling price when one was actually entered.
    _fallback_revenue   = float(monthly.get("net_monthly_revenue", 0) or 0)
    _fallback_unit_price = float(prod.get("selling_price_per_unit", 0) or 0)
    if _fallback_unit_price > 0:
        _fallback_avg_price = _fallback_unit_price
        _fallback_units_per_month = R(_fallback_revenue / _fallback_unit_price, 2)
    else:
        _fallback_avg_price = _fallback_revenue
        _fallback_units_per_month = 1
    products    = [
        {
            "category":       f"{business.get('nature_of_business','Product/Service')}",
            "units_per_month": _fallback_units_per_month,
            "avg_price":       _fallback_avg_price,
            "monthly_revenue": _fallback_revenue,
            "mix_pct":         100,
        }
    ]

    # ── Single source of truth for total project cost ─────────────────────────
    # Build items once; compute total from them (never fall back to a stored total
    # that may include/exclude WC differently). This total is used for ALL ROI,
    # D:E, and asset-turnover calculations to guarantee cross-section consistency.
    _industry_key   = str(business.get("industry_type", "") or inp.get("industry", "manufacturing")).lower()
    _pc_items       = _build_project_cost_items(project, wc_sched, _industry_key, float(dep.get("pm_with_contingency", 0) or 0))
    _pc_items_sum   = R(sum(item["amount"] for item in _pc_items), 2)
    _scheme_pc      = float(scheme.get("project_cost", 0) or 0)
    # If line items sum to non-zero, use that; fall back to scheme total only when
    # no items are entered (e.g. legacy/simple inputs).
    _total_pc       = _pc_items_sum if _pc_items_sum > 0 else _scheme_pc

    _term_loan      = float(scheme.get("term_loan", 0))
    _wc_bank_loan   = float(wc_sched[0].get("bank_loan", 0)) if wc_sched else 0.0
    _wc_margin      = float(wc_sched[0].get("margin", 0)) if wc_sched else 0.0
    _fixed_pc_master = float(scheme.get("fixed_project_cost", 0) or 0) or R(_total_pc - _wc_margin, 2)
    _promoter_fixed_equity = float(scheme.get("promoter_amount", 0) or 0)
    _total_promoter_contribution = R(_promoter_fixed_equity + _wc_margin, 2)
    _total_bank_exp = R(_term_loan + _wc_bank_loan, 2)

    # Marketing expense % from user assumptions (not hardcoded)
    _mktg_pct_raw = float(assum.get("marketing_pct", assum.get("marketing_expense_pct", 0)) or 0)
    if _mktg_pct_raw > 0:
        inp["marketing_expense_pct"] = _mktg_pct_raw / 100 if _mktg_pct_raw > 1 else _mktg_pct_raw

    # ── Product table: single source of truth for revenue display ────────────
    # Compute mix_pct from each product's actual monthly_revenue share.
    _raw_products = inp.get("products_list") or []
    _display_products = []
    if _raw_products:
        _total_prod_rev = sum(float(p.get("monthly_revenue", 0) or 0) for p in _raw_products)
        for _p in _raw_products:
            _pc = dict(_p)
            _rev = float(_pc.get("monthly_revenue", 0) or 0)
            _pc["mix_pct"] = round(_rev / _total_prod_rev * 100, 1) if _total_prod_rev > 0 else 0.0
            _display_products.append(_pc)
    # gross_monthly_revenue = product table sum when available; else from monthly_pnl
    _gross_monthly_rev = (
        sum(float(p.get("monthly_revenue", 0) or 0) for p in _raw_products)
        if _raw_products
        else float(monthly.get("net_monthly_revenue", 0))
    )

    cma = {
        **monthly,
        # Alias: pdf_builder Section O reads current_principal_monthly
        "current_principal_monthly": float(monthly.get("monthly_principal", 0) or 0),
        "products":           _display_products if _display_products else products,
        "gross_monthly_revenue": _gross_monthly_rev,
        # Single source of truth — used for ALL ROI, D:E, turnover across all sections
        "project_cost_items": _pc_items,
        "total_project_cost": _total_pc,
        "fixed_project_cost": _fixed_pc_master,
        "term_loan":            _term_loan,
        "wc_bank_loan":         _wc_bank_loan,
        "working_capital_loan": _wc_bank_loan,
        # Total Bank Exposure = TL + WC facility (CA/PSU bank standard label)
        "total_loan":           _total_bank_exp,
        "total_bank_exposure":  _total_bank_exp,
        "rent":               float(monthly.get("rent", 0)) or float(expenses.get("monthly_rent", expenses.get("rent", 0)) or 0),
        "promoter_fixed_equity": _promoter_fixed_equity,
        "promoter_wc_margin":    _wc_margin,
        "promoter_contribution": _total_promoter_contribution,
        "total_promoter_contribution": _total_promoter_contribution,
        "promoter_pct":       float(scheme.get("promoter_pct", 10)),
        "margin_money":       float(scheme.get("margin_money", 0) or 0),
        "margin_money_pct":   float(scheme.get("margin_money_pct", 0) or 0),
        "cgtmse_annual_fee":  float(scheme.get("cgtmse_annual_fee", 0) or 0),
        "cgtmse_agf_pct":     float(scheme.get("cgtmse_agf_pct", 0) or 0),
        "cgtmse_coverage_pct": float(scheme.get("cgtmse_coverage_pct", 0) or 0),
        # Loan schedule filtered to actual tenure (no zero-padded rows shown in PDF)
        "yr_schedule":        loan_sched[:tenure_yrs],
        "projections_5yr":    income,
        "dscr_y1":            float(dscr_data.get("dscr_y1", 0)),
        "avg_dscr_5yr":       round(float(dscr_data.get("average", 0)), 2),
        "avg_dscr":           round(float(dscr_data.get("average", 0)), 2),
        "dscr_label":         dscr_data.get("dscr_label", ""),
        "breakeven_months":   (None if (bep and bep[0].get("payback_not_achievable")) else
                               float(bep[0].get("payback_months") or 0) if bep else 0.0),
        "payback_not_achievable": bool(bep[0].get("payback_not_achievable", False) if bep else True),
        "payback_calculation": bep[0].get("payback_calculation") if bep else None,
        "breakeven_revenue":  float(bep[0].get("bep_sales", 0) / 12 if bep else 0),
        "margin_of_safety":   R(((float(monthly.get("net_monthly_revenue", 0)) - float(bep[0].get("bep_sales", 0) / 12 if bep and bep[0].get("bep_sales", 0) > 0 else 0)) / float(monthly.get("net_monthly_revenue", 1)) * 100), 2) if float(monthly.get("net_monthly_revenue", 0)) > 0 and bep and bep[0].get("bep_sales", 0) > 0 else 0.0,
        "scorecard":          scorecard.get("items", []),
        "total_score":        scorecard.get("total_score", 0),
        "credit_rating":      scorecard.get("credit_rating", "B"),
        "recommendation":     scorecard.get("recommendation", "REFER FOR REVIEW"),
        "risk_level":         scorecard.get("risk_level", "MODERATE"),
        "risk_matrix":        scorecard.get("risk_matrix", []),
        "is_high_leverage":   scorecard.get("is_high_leverage", False),
        "leverage_caveat":    scorecard.get("leverage_caveat"),
        "scorecard_de_ratio":       scorecard.get("de_ratio"),
        "scorecard_total_leverage": scorecard.get("total_leverage"),
        "sensitivity":        sensitivity,
        "processing_fee":     R(float(scheme.get("term_loan", 0)) * float(business.get("processing_fee_pct", 0) or 0) / 100, 2),
        # CA AUDIT: sum the SAME per-year whole-rupee-rounded figures Section
        # 21's table (and dpr["term_loan"]["total_interest"], below) use —
        # one rounding convention, so this never lands a rupee away from
        # what a reader gets by adding up the displayed per-year rows.
        "total_interest_outgo": R(sum(R(r.get("interest_paid", 0)) for r in loan_sched[:tenure_yrs])),
        "total_wc_interest_outgo": R(sum(w.get("wc_interest", 0) for w in wc_sched), 2),
        "interest_coverage_y1": interest_coverage_ratio(
            float(monthly.get("ebitda_monthly", 0)),
            float(monthly.get("monthly_tl_int", 0)),
            float(monthly.get("monthly_wc_int", 0)),
        ),
        # ROI and turnover use _total_pc as the single denominator across all sections
        "roi_ebitda_pct":     R(float(monthly.get("annual_ebitda", 0)) / _total_pc * 100, 2) if _total_pc > 0 else float(monthly.get("roi_ebitda_pct", 0)),
        "roi_pat_pct":        R(float(monthly.get("annual_pat", 0)) / _total_pc * 100, 2) if _total_pc > 0 else float(monthly.get("roi_pat_pct", 0)),
        "asset_turnover_y1":  R(float(monthly.get("annual_revenue", 0)) / _total_pc, 2) if _total_pc > 0 else 0.0,
        "yr1_interest":       float(yr1_sched.get("interest_paid", 0)),
        "gross_margin_pct":   _calc_gross_margin_pct(income, monthly),
        "promoter_net_worth": raw_input.get("promoter_net_worth", {}),
    }

    # ── P1: Master Engine Sync ────────────────────────────────────────────────
    # Override monthly-derived annual figures with income-statement Year 1 values.
    # This guarantees exec summary, 5-yr highlights, and detailed P&L all show
    # the same numbers (never two different Revenue/PAT/EBITDA on same report).
    if income:
        _yr1 = income[0]
        _is_rev    = float(_yr1.get("revenue",    _yr1.get("sales",       0)) or 0)
        _is_ebitda = float(_yr1.get("ebitda",                              0)  or 0)
        _is_pat    = float(_yr1.get("net_profit",  _yr1.get("pat",        0)) or 0)
        _is_dep    = float(_yr1.get("depreciation",       0) or 0)
        _is_int    = float(_yr1.get("interest",           0) or 0)
        _is_pbt    = float(_yr1.get("profit_before_tax",  0) or 0)
        _is_tax    = float(_yr1.get("tax",                0) or 0)
        _is_cogs   = float(_yr1.get("cogs", _yr1.get("raw_materials", 0)) or 0)
        _is_var    = (
            _is_cogs +
            float(_yr1.get("power", _yr1.get("other_variable", 0)) or 0) +
            float(_yr1.get("marketing", _yr1.get("marketing_expenses", 0)) or 0)
        )
        _is_fixed  = float(_yr1.get("fixed_expenses", _yr1.get("total_fixed", 0)) or 0)
        if _is_rev > 0:
            cma["annual_revenue"]    = R(_is_rev,    2)
            cma["net_monthly_revenue"] = R(_is_rev / 12, 2)
            cma["gross_monthly_revenue"] = R(_is_rev / 12, 2)
        cma["cogs_monthly"]     = R(_is_cogs / 12, 2)
        cma["gross_profit_monthly"] = R((_is_rev - _is_cogs) / 12, 2)
        cma["variable_total"]   = R(_is_var / 12, 2)
        cma["fixed_total"]      = R(_is_fixed / 12, 2)
        cma["total_monthly_exp"] = R((_is_var + _is_fixed) / 12, 2)
        cma["operating_monthly_exp"] = cma["total_monthly_exp"]
        cma["monthly_dep"]      = R(_is_dep / 12, 2)
        cma["monthly_int_y1"]   = R(_is_int / 12, 2)
        cma["monthly_tl_int"]   = R(float(_yr1.get("tl_interest", 0) or 0) / 12, 2)
        cma["monthly_wc_int"]   = R(float(_yr1.get("wc_interest", 0) or 0) / 12, 2)
        cma["pbt_monthly"]      = R(_is_pbt / 12, 2)
        cma["tax_monthly"]      = R(_is_tax / 12, 2)
        cma["pat_monthly"]      = R(_is_pat / 12, 2)
        cma["surplus_monthly"]  = R(cma["pat_monthly"] + cma["monthly_dep"] - cma.get("current_principal_monthly", 0), 2)
        if _is_ebitda != 0:
            cma["annual_ebitda"]     = R(_is_ebitda, 2)
            cma["ebitda_monthly"]    = R(_is_ebitda / 12, 2)
            if _is_rev > 0:
                cma["ebitda_margin_pct"] = R(_is_ebitda / _is_rev * 100, 2)
        cma["annual_pat"] = R(_is_pat, 2)
        if _is_rev > 0:
            cma["net_margin_pct"] = R(_is_pat / _is_rev * 100, 2)
        # Re-sync derived ratios using the now-consistent annual figures
        if _total_pc > 0:
            cma["roi_ebitda_pct"]    = R(cma["annual_ebitda"] / _total_pc * 100, 2)
            cma["roi_pat_pct"]       = R(cma["annual_pat"]    / _total_pc * 100, 2)
            cma["asset_turnover_y1"] = R(cma["annual_revenue"] / _total_pc, 2)
        # BUG FIX: interest_coverage_y1 was computed once, earlier, from
        # monthly_pnl's own (pre-sync) EBITDA/interest figures — then never
        # recomputed after cma["ebitda_monthly"]/cma["monthly_tl_int"]/
        # cma["monthly_wc_int"] were just overwritten above with the
        # authoritative income_statement Year-1 figures. A CA reviewer
        # caught the resulting mismatch on a live report: Section 29 showed
        # "5.56x" using the stale monthly_pnl basis, while EBITDA / (TL + WC
        # interest) from every OTHER figure on the same report (Section
        # 21's Total Interest, Section 29's own EBITDA margin) gives 5.11x.
        # Calls the single shared formula (core.engine.interest_coverage_ratio)
        # so this can never re-diverge into a locally re-derived ratio.
        cma["interest_coverage_y1"] = interest_coverage_ratio(
            cma["ebitda_monthly"], cma.get("monthly_tl_int", 0), cma.get("monthly_wc_int", 0),
        )
        # Also surface scheme DSCR benchmark into cma for dynamic narrative
        cma["dscr_benchmark"] = float(scheme.get("dscr_benchmark", 1.25) or 1.25)

    # ── P2/P3: Sensitivity base case sync to master financial engine ──────────
    # After P1 sync, ensure the sensitivity Base Case row (chg=0) exactly matches
    # cma["net_monthly_revenue"]. If income_statement and monthly_pnl diverge
    # (capacity scaling edge-case), proportionally rescale all scenario values.
    _master_monthly_rev = float(cma.get("net_monthly_revenue", 0) or 0)
    if sensitivity and _master_monthly_rev > 0:
        _sens_base = next((s for s in sensitivity if s.get("change_pct", -999) == 0), None)
        if _sens_base:
            _s_rev = float(_sens_base.get("monthly_revenue", 0) or 0)
            if _s_rev > 0 and abs(_master_monthly_rev - _s_rev) / _s_rev > 0.005:
                _scale = _master_monthly_rev / _s_rev
                # Structural scenarios (raw material / salary / receivable
                # days / interest rate / combined) are deliberately excluded
                # — they were computed by re-running the actual engine on a
                # mutated input, not derived from the revenue-only base
                # case, so rescaling them by a revenue-reconciliation factor
                # would corrupt their own correctly-computed figures.
                for _s in sensitivity:
                    if _s.get("type") == "structural":
                        continue
                    for _k in ("monthly_revenue", "monthly_cogs", "monthly_variable",
                               "monthly_ebitda", "monthly_profit"):
                        if _k in _s:
                            _s[_k] = R(float(_s[_k]) * _scale, 2)
                cma["sensitivity"] = sensitivity

    # ── Build DPR dict from balance sheet and income ──────────────────────────
    dpr = _build_dpr_from_report(scheme, dep, income, bs, wc_sched, loan_sched, bep, dscr_data, inp, manpower_inp, project, raw_input)
    
    # ── Point 4: Unified Salary Source & Labor Consistency ────────────────────
    cma["annual_salary_total"] = dpr["manpower"].get("total_wages", 0)
    if dpr.get("profit_and_loss_years"):
        dpr["profit_and_loss_years"][0]["labour"] = cma["annual_salary_total"]

    # ── Fix #6: Employee count derives from HR table, not user's free-text estimate ──
    _hr_total_staff = (
        int(dpr["manpower"].get("num_skilled",   0) or 0) +
        int(dpr["manpower"].get("num_semi",      0) or 0) +
        int(dpr["manpower"].get("num_unskilled", 0) or 0)
    )
    if _hr_total_staff > 0:
        inp["expected_employment"] = _hr_total_staff

    # ── Point 3: Break-even Consistency ───────────────────────────────────────
    for b in dpr.get("breakeven_years", []):
        if b.get("contribution", 0) <= 0:
            b["bep_not_achievable"] = True

    # ── Point 8: PDF Consistency Validator ────────────────────────────────────
    validate_report_data(report_data, cma, dpr, inp)

    build_pdf(inp, cma, dpr, output_path)


# ── Internal helper ───────────────────────────────────────────────────────────

def _avg_salary(manpower_inp: dict) -> float:
    """Weighted average monthly salary across all employee categories."""
    total_cost = (
        float(manpower_inp.get("skilled_count", 0) or 0) * float(manpower_inp.get("skilled_salary", 0) or 0) +
        float(manpower_inp.get("semi_skilled_count", 0) or 0) * float(manpower_inp.get("semi_skilled_salary", 0) or 0) +
        float(manpower_inp.get("unskilled_count", 0) or 0) * float(manpower_inp.get("unskilled_salary", 0) or 0)
    )
    total_heads = (
        float(manpower_inp.get("skilled_count", 0) or 0) +
        float(manpower_inp.get("semi_skilled_count", 0) or 0) +
        float(manpower_inp.get("unskilled_count", 0) or 0)
    )
    return R(total_cost / total_heads) if total_heads > 0 else 0.0


def _build_dpr_from_report(
    scheme, dep, income, bs, wc_sched, loan_sched, bep, dscr_data, inp, manpower_inp=None, project=None, raw_input=None
) -> dict:
    """Construct a DPR-compatible dict from report components for pdf_builder."""
    raw_input = raw_input or {}
    tl = float(scheme.get("term_loan", 0) or 0)
    # FIX: wc_loan from wc_sched (authoritative) — scheme_data may not have wc_loan
    wc_loan = float(wc_sched[0].get("bank_loan", 0) if wc_sched else scheme.get("wc_loan", 0) or 0)
    promoter = float(scheme.get("promoter_amount", 0) or 0)
    # Compute master project cost from line items (same logic as generate_pdf's _total_pc)
    _dpr_pc_items = _build_project_cost_items(project or {}, wc_sched, inp.get("industry", inp.get("industry_type", "manufacturing")), float(dep.get("pm_with_contingency", 0) or 0))
    _dpr_pc_sum   = R(sum(item["amount"] for item in _dpr_pc_items), 2)
    _scheme_pc    = float(scheme.get("project_cost", tl + promoter) or 0)
    total_proj    = _dpr_pc_sum if _dpr_pc_sum > 0 else _scheme_pc
    gross_block = float(dep.get("gross_block", 0) or 0)
    annual_dep  = float(dep.get("annual_dep", 0) or 0)
    rate = float(inp.get("term_loan_interest", 0.105) or 0.105)
    tenure_yrs = int(inp.get("loan_tenure_years", 5) or 5)
    wc_margin = float(wc_sched[0].get("margin", 0) if wc_sched else 0)
    total_promoter = promoter + wc_margin
    de_ratio = round((tl + wc_loan) / total_promoter, 2) if total_promoter else 0

    # Project cost dict
    pc = {
        "building_cost":    float(dep.get("building_gross", 0)),
        "machinery_cost":   float(dep.get("machinery_gross", 0)),
        "contingency":      0.0,
        "working_capital":  float(wc_sched[0]["total"] if wc_sched else 0),
        "wc_bank_share":    wc_loan,
        "total_project_cost": total_proj,
        "equity_capital":   promoter,
        "promoter_fixed_equity": promoter,
        "promoter_wc_margin": wc_margin,
        "total_promoter_contribution": total_promoter,
        "margin_money":     float(scheme.get("margin_money", 0) or 0),
        "margin_money_pct": float(scheme.get("margin_money_pct", 0) or 0),
        "term_loan":        tl,
        "wc_loan":          wc_loan,
        "total_finance":    R(promoter + float(scheme.get("margin_money",0) or 0) + tl),  # WC loan is a separate revolving facility — not part of Means of Finance
        "debt_equity_ratio": de_ratio,
    }

    # Term loan dict — Fix #5: schedule rows match actual loan tenure (not hardcoded 5)
    # Read the half-yearly instalment straight off the actual schedule rather than
    # recomputing tl/(tenure_yrs*2) — that formula ignores moratorium and disagrees
    # with the schedule's own principal_repaid figures whenever moratorium > 0.
    hi = R(loan_sched[0]["half_yearly_instalment"]) if loan_sched else 0.0
    # BUG FIX: "mid" used to be the arithmetic mean of opening/closing, and
    # int_h1/int_h2 a naive half-split of the year's total interest. Both
    # are wrong in a year that transitions out of moratorium mid-year (H1
    # still in moratorium, H2 repaying) — the balance doesn't move until
    # H2, so it's not the average of opening and closing, and the two
    # halves' interest isn't necessarily equal either. Read the real,
    # separately-tracked H1/H2 figures straight off the schedule instead.
    tl_schedule = [
        {
            "year":             r["year"],
            "opening":          R(r["opening_balance"]),
            "mid":              R(r.get("mid_year_balance", (r["opening_balance"] + r["closing_balance"]) / 2)),
            "closing":          R(r["closing_balance"]),
            "int_h1":           R(r.get("interest_h1", r["interest_paid"] / 2)),
            "int_h2":           R(r.get("interest_h2", r["interest_paid"] / 2)),
            "total_interest":   R(r["interest_paid"]),
            "principal_repaid": R(r["principal_paid"]),
        }
        for r in loan_sched[:tenure_yrs]  # FIX #5: use actual tenure
    ]
    tl_dict = {
        "amount":                tl,
        "interest_rate":         rate,
        "half_yearly_instalment": hi,
        # CA AUDIT: one rounding convention only — sum the SAME per-year
        # whole-rupee-rounded figures Section 21's table displays
        # (tl_schedule[i]["total_interest"]), not the raw unrounded
        # interest_paid values. Rounding the raw sum once, separately from
        # rounding each displayed row, could land a rupee away from what a
        # reader gets by manually adding up the rows shown on the page.
        "total_interest":        R(sum(row["total_interest"] for row in tl_schedule)),
        "schedule":              tl_schedule,
    }

    # Manpower — from real manpower_inp if provided
    mp = manpower_inp or {}
    _skilled_count        = int(float(mp.get("skilled_count",      0) or 0))
    _semi_skilled_count   = int(float(mp.get("semi_skilled_count", 0) or 0))
    _unskilled_count      = int(float(mp.get("unskilled_count",    0) or 0))
    _skilled_salary       = float(mp.get("skilled_salary",      0) or 0)
    _semi_skilled_salary  = float(mp.get("semi_skilled_salary", 0) or 0)
    _unskilled_salary     = float(mp.get("unskilled_salary",    0) or 0)

    # Per-worker annual salary (× 12 months)
    _skilled_per_annual      = R(_skilled_salary      * 12)
    _semi_skilled_per_annual = R(_semi_skilled_salary * 12)

    # Total wages for all workers of each category
    _skilled_total      = R(_skilled_per_annual      * _skilled_count)
    _semi_skilled_total = R(_semi_skilled_per_annual * _semi_skilled_count)
    _unskilled_total    = R(_unskilled_salary * 12   * _unskilled_count)
    _total_wages        = R(_skilled_total + _semi_skilled_total + _unskilled_total)

    _unskilled_per_annual = R(_unskilled_salary * 12)
    manpower = {
        "promoter_annual":          0,
        # per-worker annual wage — used in the "Annual Wage" column of Section E
        "skilled_per_annual":       _skilled_per_annual,
        "semi_skilled_per_annual":  _semi_skilled_per_annual,
        "unskilled_per_annual":     _unskilled_per_annual,
        # total wages for ALL workers in that category — used in the "Total" column
        "skilled_total":            _skilled_total,
        "semi_skilled_total":       _semi_skilled_total,
        "unskilled_total":          _unskilled_total,
        # legacy keys for compatibility
        "skilled_annual":           _skilled_per_annual, # MUST be per-worker to avoid multiplication bug
        "semi_skilled_annual":      _semi_skilled_per_annual,
        "unskilled_annual":         _unskilled_per_annual,
        "num_skilled":              _skilled_count,
        "num_semi":                 _semi_skilled_count,
        "num_unskilled":            _unskilled_count,
        "base_wages":               _total_wages,
        "benefits":                 R(_total_wages * 0.10),   # 10% PF/ESI estimate
        "total_wages":              R(_total_wages * 1.10),
    }

    # Machinery (detailed from input)
    project_dict = project or {}
    machinery_items = project_dict.get("machinery_items", [])
    formatted_items = []
    
    if machinery_items:
        for m in machinery_items:
            qty = float(m.get("quantity", 1))
            price = float(m.get("unit_price", 0))
            formatted_items.append({
                "name":          str(m.get("name", "Equipment")),
                "qty":           qty,
                "unit_price":    price,
                "total":         qty * price,
                "supplier_name":  str(m.get("supplier_name", "") or ""),
                "supplier_city":  str(m.get("supplier_city", "") or ""),
                "supplier_phone": str(m.get("supplier_phone", "") or ""),
            })
    else:
        _fallback_asset_name = (
            "Office Infrastructure / Service Equipment"
            if str(inp.get("industry", inp.get("industry_type", ""))).lower() in ("service", "services")
            else "Plant & Equipment"
        )
        formatted_items = [{
            "name": _fallback_asset_name,
            "qty": 1.0,
            "unit_price": float(dep.get("machinery_gross", 0)),
            "total": float(dep.get("machinery_gross", 0))
        }]
                            
    tools_installation = float(project_dict.get("tools_installation", 0))

    # BUG FIX: when no machinery_items were entered, formatted_items falls
    # back to a single synthetic row valued at dep["machinery_gross"] —
    # which ALREADY includes tools_installation (calculations/depreciation.py's
    # machinery_base = sum(machinery_items) + tools_installation). Adding
    # tools_installation again here double-counted it (e.g. Rs.50,000
    # tools_installation, no machinery_items, displayed a "TOTAL" of
    # Rs.100,000 instead of Rs.50,000). dep["machinery_gross"] is already
    # the single source of truth in both branches — sum(formatted_items) +
    # tools_installation reconstructs it exactly when machinery_items ARE
    # present, so just use it directly instead of re-deriving it.
    machinery_total = float(dep.get("machinery_gross", 0)) or (
        float(sum(float(item.get("total", 0)) for item in formatted_items)) + tools_installation
    )

    machinery = {
        "items": formatted_items,
        "tools_installation": tools_installation, 
        "section_c_total": machinery_total,
        "total": machinery_total,
    }

    # Raw materials — derive from income statement Year 1 COGS
    cogs_y1 = float(income[0].get("cogs", income[0].get("raw_materials", 0)) if income else 0)
    rm_cost_per_unit = float(inp.get("cost_fresh_leaves_per_kg", 0) or 0)
    working_days = int(inp.get("working_days_per_year", 300) or 300)
    input_qty    = float(inp.get("fresh_leaves_per_day_kg", 0) or 0)
    annual_leaves_qty = input_qty * working_days
    # Raw materials aggregation
    rm_items = (
        raw_input.get("manufacturing_raw_materials", []) or
        raw_input.get("trading_products", []) or
        raw_input.get("service_products", []) or
        []
    )
    formatted_rm_items = []
    for rm_item in rm_items:
        qty = float(rm_item.get("annual_qty", rm_item.get("units_per_month", 0) * 12))
        rate = float(rm_item.get("unit_price", rm_item.get("purchase_price", 0)))
        total = float(rm_item.get("total_cost", qty * rate))
        if total > 0:
            formatted_rm_items.append({
                "name": rm_item.get("name") or rm_item.get("category") or "Material",
                "unit_price": rate,
                "annual_qty": qty,
                "total_cost": total
            })

    # BUG FIX: "leaves_cost" below is deliberately an "at 100% Capacity"
    # figure (input_qty x working_days x rate — the section's own stated
    # basis, per its "Raw Material & Consumables (at 100% Capacity)"
    # heading), but "total" used to be cogs_y1 — the capacity-ADJUSTED
    # actual Year-1 COGS. The row and its own TOTAL were on two different
    # bases, so TOTAL never equalled the sum of the rows shown above it.
    # TOTAL must sum the rows actually displayed in this table (Section 12).
    _leaves_cost_100pct = R(rm_cost_per_unit * annual_leaves_qty) if annual_leaves_qty > 0 else R(cogs_y1)
    raw_materials = {
        "items":            formatted_rm_items,
        "leaves_cost":      _leaves_cost_100pct,
        "consumables_cost": 0,
        "bottles_cost":     0,
        "total":            _leaves_cost_100pct,
        "annual_leaves_qty": annual_leaves_qty,
    }

    # P&L years — use income_statement field aliases directly (they include all needed names)
    cop = []
    for yr in income:
        cogs_val       = float(yr.get("cogs",       yr.get("raw_materials", 0)) or 0)
        other_var_val  = float(yr.get("other_variable", 0) or 0)   # electricity, transport, etc.
        # FIX: Use "labour" (salary only) not "fixed_expenses" (salary+rent combined).
        # fixed_expenses = salary + rent. Using it as "labour" caused Y2+ salary = salary+rent.
        fixed_val      = float(yr.get("labour", yr.get("fixed_expenses", 0)) or 0)
        mktg_val       = float(yr.get("marketing",  yr.get("marketing_expenses", 0)) or 0)
        tl_int_val     = float(yr.get("tl_interest", 0) or 0)
        wc_int_val     = float(yr.get("wc_interest", 0) or 0)
        dep_val        = float(yr.get("depreciation", annual_dep) or annual_dep)
        rev_val        = float(yr.get("revenue", 0) or 0)
        # Rent
        rent_per_month = float(inp.get("rent", inp.get("monthly_rent", 0)) or 0)
        total_exp_val  = float(yr.get("total_expenses", 0) or 0)
        ebitda_val     = float(yr.get("ebitda", 0) or 0)
        total_variable = float(yr.get("total_variable", cogs_val + other_var_val) or (cogs_val + other_var_val))
        cop.append({
            "year":               yr["year"],
            "capacity":           float(yr.get("capacity", 0.5)),
            "revenue":            rev_val,
            "raw_materials":      cogs_val,
            "gross_profit":       float(yr.get("gross_profit", rev_val - cogs_val) or (rev_val - cogs_val)),
            "power":              other_var_val,   # electricity/transport shown as "power charges" row
            "labour":             fixed_val,
            "total_variable":     total_variable,
            "ebitda":             ebitda_val,
            "depreciation":       dep_val,
            "admin_expenses":     float(yr.get("admin_expenses", 0) or 0),  # rent/overhead (separate from salary)
            "marketing_expenses": mktg_val,
            "cgtmse_fee":         float(yr.get("cgtmse_fee", 0) or 0),
            "wc_interest":        wc_int_val,
            "tl_interest":        tl_int_val,
            "total_expenses":     total_exp_val,
            "profit_before_tax":  float(yr.get("profit_before_tax", 0) or 0),
            "tax":                float(yr.get("tax", 0) or 0),
            "net_profit":         float(yr.get("pat", yr.get("net_profit", 0)) or 0),
            "reserves_surplus":   float(yr.get("reserves_surplus", 0) or 0),
            "cash_accruals":      float(yr.get("cash_accruals", 0) or 0),
        })

    # WC years — Fix #3: include creditors so the "Less: Creditors" row in Section I renders correctly
    wc_years = []
    wc_loan_yr1 = float(wc_loan or (wc_sched[0].get("bank_loan", 0) if wc_sched else 0))
    for w in wc_sched:
        b_loan = wc_loan_yr1 if w["year"] == 1 else w["bank_loan"]
        # Resolve WC component values — wc_schedule uses rm_stock/wip/fg keys
        _rm_val  = float(w.get("rm_stock", w.get("stock", 0)) or 0)
        _wip_val = float(w.get("wip", 0) or 0)
        _fg_val  = float(w.get("fg", 0) or 0)
        _deb_val = float(w.get("debtors", 0) or 0)
        _cred_val = float(w.get("creditors", 0) or 0)
        _cash_reserve_val = float(w.get("cash_reserve", 0) or 0)
        _salary_float_val = float(w.get("salary_float", 0) or 0)
        _expense_float_val = float(w.get("expense_float", 0) or 0)
        wc_years.append({
            "year":       w["year"],
            # Primary keys used by builder.py _wc() (direct lookup — no fallback needed)
            "rm_stock":   _rm_val,
            "wip":        _wip_val,
            "fg":         _fg_val,
            # Legacy aliases for backward compatibility
            "rm_wc":      _rm_val,
            "wip_wc":     _wip_val,
            "fg_wc":      _fg_val,
            "debtors":    _deb_val,
            "creditors":  _cred_val,
            "cash_reserve": _cash_reserve_val,
            "salary_float": _salary_float_val,
            "expense_float": _expense_float_val,
            "we_wc":      0,
            "total":      w["total"],
            "bank_loan":  b_loan,
            "margin":     R(w["total"] - b_loan, 2),
            "wc_interest": w["wc_interest"],
        })

    # DSCR years
    dscr_years = []
    for d in dscr_data.get("years", []):
        dscr_years.append({
            "year": d["year"], "cash_accruals": d.get("cash_accruals", 0),
            "tl_interest": d.get("tl_interest", d.get("interest", 0)),  # BUG 8 fix: key renamed
            "total_a": d.get("total_a", 0),
            "tl_repayment": d.get("principal", 0), "total_b": d.get("total_b", 0), "dscr": d.get("dscr", 0),
            # CA AUDIT: Adjusted DSCR (incl. existing EMI obligations) —
            # propagate through, since builder.py's Section 28 reads from
            # THIS rebuilt dict (dpr["dscr"]), not calculate_dscr()'s raw
            # output directly.
            "existing_emi_annual":      d.get("existing_emi_annual", 0),
            "adjusted_cash_accruals":   d.get("adjusted_cash_accruals", d.get("cash_accruals", 0)),
            "adjusted_total_a":         d.get("adjusted_total_a", d.get("total_a", 0)),
            "adjusted_dscr":            d.get("adjusted_dscr", d.get("dscr", 0)),
        })

    # Revenue at 100% capacity = Year-1 revenue ÷ Year-1 capacity (before growth)
    _rev_100 = 0.0
    if income:
        _y1_rev = float(income[0].get("revenue", 0) or 0)
        _y1_cap = float(income[0].get("capacity", 0.5) or 0.5)
        _y1_growthfactor = 1.0   # Year 1 is (1+g)^0 = 1.0, so no adjustment needed
        _rev_100 = R(_y1_rev / _y1_cap) if _y1_cap > 0 else _y1_rev
    # Annual output = input_qty_per_day × working_days × yield% / 100
    _input_qty  = float(inp.get("fresh_leaves_per_day_kg", 0) or 0)
    _working_d  = int(inp.get("working_days_per_year", 300) or 300)
    _yield_pct  = float(inp.get("yield_rate", 1.0) or 1.0)   # already decimal (e.g. 0.80)
    _annual_out = R(_input_qty * _working_d * _yield_pct) if _input_qty > 0 else 0.0

    # Revenue at 100% = annual_output × selling_price (manufacturing)
    # For service/trading (input_qty=0), revenue_at_100pct already computed from capacity split
    _sell_price = float(inp.get("selling_price_per_kg", 0) or 0)
    if _input_qty > 0 and _sell_price > 0:
        _rev_100_mfg = R(_annual_out * _sell_price)
        if _rev_100_mfg > 0:
            _rev_100 = _rev_100_mfg   # override with formula-based value

    return {
        "project_summary": {
            "entrepreneur_name": inp.get("entrepreneur_name", ""),
            "title": inp.get("title", ""), "location": inp.get("location", ""),
            "district": inp.get("district", ""),
            "annual_production_kg": _annual_out,
            "revenue_at_100pct":    _rev_100,
        },
        "machinery":             machinery,
        "raw_materials":         raw_materials,
        "manpower":              manpower,
        "project_cost":          pc,
        "depreciation":          dep,
        "term_loan":             tl_dict,
        "working_capital_years": wc_years,
        "profit_and_loss_years": cop,
        "balance_sheet_years":   bs,
        "cash_flow_years":       _build_cash_flow(income, loan_sched, wc_sched, bs),
        "breakeven_years":       bep,
        "dscr":                  {
            "years": dscr_years, "average": float(dscr_data.get("average", 0)),
            "existing_annual_emi":   float(dscr_data.get("existing_annual_emi", 0)),
            "average_adjusted_dscr": float(dscr_data.get("average_adjusted_dscr", dscr_data.get("average", 0))),
            "adjusted_dscr_label":   dscr_data.get("adjusted_dscr_label", dscr_data.get("dscr_label", "")),
            "has_existing_emi":      bool(dscr_data.get("has_existing_emi", False)),
        },
        "profitability": {
            "reference_year": 3,
            "sales": float(income[2]["revenue"] if len(income) > 2 else 0),
            # total_proj is already computed from line-item sums above (same as _total_pc in generate_pdf)
            "total_investment": total_proj,
            # BUG FIX: "capital_employed" was Promoter Fixed Equity ALONE — comparing a whole
            # year's PAT/PBIDT against only the thinnest equity slice produced extreme,
            # economically-meaningless percentages (e.g. -857%). Capital Employed (CA/ROCE
            # convention) = long-term funds actually deployed = Promoter Equity + Term Loan.
            "promoter_equity":  promoter,
            "total_debt":       tl,
            "capital_employed": R(promoter + tl, 2),
            "pbidt": float(income[2].get("ebitda", 0) if len(income) > 2 else 0),
            "pbidt_pct_sales": R(float(income[2].get("ebitda", 0) if len(income) > 2 else 0) / max(float(income[2].get("revenue", 1) if len(income) > 2 else 1), 1) * 100),
            # EBIT = EBITDA − Depreciation (before interest/tax) — the single
            # numerator ROCE uses, per the standard ROCE = EBIT ÷ Capital
            # Employed definition. Both EBITDA and Depreciation are already
            # computed by the income-statement engine; this is a direct
            # formula application, not an independent recalculation.
            "ebit": R(float(income[2].get("ebitda", 0) if len(income) > 2 else 0) - float(income[2].get("depreciation", 0) if len(income) > 2 else 0), 2),
            "pat": float(income[2].get("pat", 0) if len(income) > 2 else 0),
            "pat_pct_sales": R(float(income[2].get("pat", 0) if len(income) > 2 else 0) / max(float(income[2].get("revenue", 1) if len(income) > 2 else 1), 1) * 100),
        },
    }


def _build_cash_flow(income: list, loan_sched: list, wc_sched: list, bs: list) -> list:
    """
    Build 5-year indirect-method cash flow statement reconciled with the balance sheet.

    CA standard indirect method:
      Sources = Cash Accruals + WC loan increase
      Uses    = TL principal repayment + WC loan decrease + increase in current assets
      Opening cash for Year 1 = Year 0 balance-sheet cash (project launch position).
      Closing cash each year must equal the corresponding balance-sheet cash balance.

    bs[0] = Year 0 (startup), bs[1] = Year 1, ..., bs[5] = Year 5.
    income[i] / loan_sched[i] / wc_sched[i] are Year (i+1) data.
    """
    rows = []
    # Opening cash = Year 0 balance sheet cash (funded by equity + TL + WC loan minus fixed assets and initial WC)
    closing_prev = float(bs[0].get("cash", 0)) if bs else 0.0

    for i in range(5):
        yr_income    = income[i]     if i < len(income)     else {}
        yr_loan      = loan_sched[i] if i < len(loan_sched) else {}

        # Current year BS = bs[i+1]; previous year BS = bs[i]
        yr_bs_cur    = bs[i + 1] if (i + 1) < len(bs) else {}
        yr_bs_prev   = bs[i]     if i < len(bs)        else {}

        cash_acc     = float(yr_income.get("cash_accruals", 0) or 0)
        drawings     = float(yr_income.get("drawings",      0) or 0)
        tl_principal = float(yr_loan.get("principal_paid",  0) or 0)

        # WC bank-loan change (year-over-year from balance sheet)
        wc_cur  = float(yr_bs_cur.get("wc_bank",  0) or 0)
        wc_prev = float(yr_bs_prev.get("wc_bank", 0) or 0)
        inc_wc_loan = R(wc_cur - wc_prev)

        # Operating current assets change (stock + debtors − creditors, no cash)
        ca_cur  = float(yr_bs_cur.get("current_assets",  0) or 0)
        ca_prev = float(yr_bs_prev.get("current_assets", 0) or 0)
        inc_ca  = R(ca_cur - ca_prev)

        # BUG FIX: the balance sheet's promoter_wc_margin liability (the
        # promoter injecting more WC margin as WC requirement grows each
        # year) is a real cash source that this statement never accounted
        # for — leaving "Surplus/Deficit" short of the balance sheet's own
        # Closing Cash by exactly that amount every year.
        wcm_cur  = float(yr_bs_cur.get("promoter_wc_margin",  0) or 0)
        wcm_prev = float(yr_bs_prev.get("promoter_wc_margin", 0) or 0)
        inc_wc_margin = R(wcm_cur - wcm_prev)

        # BUG FIX: an "Inc. in Short-Term Funding" source used to be added
        # here to force this statement to reconcile with a fake balance-
        # sheet liability. That liability no longer exists — a funding
        # shortfall now shows up directly as negative cash — so no separate
        # funding term is needed at all; Sources - Uses already equals the
        # true change in cash (which can be negative) without it.
        total_sources = R(cash_acc + max(inc_wc_loan, 0) + max(inc_wc_margin, 0))
        total_uses    = R(tl_principal + drawings + max(-inc_wc_loan, 0) + max(inc_ca, 0) + max(-inc_wc_margin, 0))
        surplus       = R(total_sources - total_uses)
        # Balance sheet is the single source of truth for closing cash,
        # which may legitimately be negative (an unfunded shortfall).
        closing_cash  = R(float(yr_bs_cur.get("cash", 0) or 0))

        rows.append({
            "year":               i + 1,
            "opening_cash":       R(closing_prev),
            "cash_accruals":      cash_acc,
            "inc_wc_loan":        R(inc_wc_loan),
            "inc_wc_margin":      R(inc_wc_margin),
            "total_sources":      total_sources,
            "inc_current_assets": R(inc_ca),
            "tl_repayment":       R(tl_principal),
            "drawings":           R(drawings),
            "total_uses":         total_uses,
            "surplus":            surplus,
            "closing_cash":       closing_cash,
        })
        closing_prev = closing_cash
    return rows
