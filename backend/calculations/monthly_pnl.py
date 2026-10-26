"""
calculations/monthly_pnl.py — Year-1 monthly P&L snapshot (CA standard, Section O)

Industry-specific CA norms:
  Manufacturing : COGS 55%  | Fixed 20%
  Service       : COGS 10%  | Fixed 55%
  Trading       : COGS 70%  | Fixed 10%

CA Rule (PDF §7.5):
  Net Cash Surplus = PAT + Monthly Dep - Monthly Principal
  NOT: PAT - Full EMI (double-counts interest already in PAT)
"""
from core.engine import R, annual_revenue_from_prod, get_industry_defaults

_DEFAULT_TAX = 0.25


def calculate_monthly_pnl(
    data, scheme_data: dict, dep: dict,
    loan_schedule: list, wc_schedule: list,
) -> dict:
    """Year-1 monthly P&L snapshot (Section O equivalent)."""
    assum    = data.assumptions
    industry = str(getattr(getattr(data, "business", None), "industry_type", "manufacturing") or "manufacturing").lower()
    ind      = get_industry_defaults(industry)

    rate_pct  = float(getattr(assum, "interest_rate_pct", 9.5) or 9.5)
    tenure_mo = int(getattr(assum, "tenure_months",       60)   or 60)
    tax_rate  = float(getattr(assum, "tax_rate_pct", _DEFAULT_TAX * 100) or (_DEFAULT_TAX * 100)) / 100
    if tax_rate <= 0:
        tax_rate = _DEFAULT_TAX

    annual_dep  = float(dep.get("annual_dep", 0) or 0)
    annual_rev  = annual_revenue_from_prod(data.production, industry)

    # Year-1 capacity: prefer user-entered value; fall back to industry default
    _user_cap_y1 = float(getattr(assum, "capacity_y1_pct", 0) or 0) / 100
    cap_y1       = _user_cap_y1 if _user_cap_y1 > 0 else ind["capacity_schedule"][0]

    # SINGLE SOURCE OF TRUTH: product table entries are the user's actual Year-1 monthly revenue.
    # Use them directly; do NOT apply capacity scaling on top of user-entered actuals.
    _product_monthly = sum(
        float(getattr(p, "monthly_revenue", 0) or 0)
        for p in (getattr(data, "products", None) or [])
    )
    if _product_monthly > 0:
        monthly_rev = R(_product_monthly)
    else:
        monthly_rev = R(annual_rev * cap_y1 / 12)

    # Industry-appropriate cost structure — user COGS override takes precedence
    cogs_ratio   = ind["cogs_ratio"]
    fixed_ratio  = ind["fixed_ratio"]
    mktg_ratio   = ind["marketing_ratio"]

    # ── COGS: 4-priority logic matching income_statement exactly ──────────────
    # Priority 1: unit costs from production (manufacturing)
    prod_data   = getattr(data, "production", None)
    rm_per_unit = float(getattr(prod_data, "raw_material_cost_per_unit", 0) or 0) if prod_data else 0.0
    input_qty   = float(getattr(prod_data, "input_qty_per_day",          0) or 0) if prod_data else 0.0
    work_days   = float(getattr(prod_data, "working_days_per_year",    300) or 300) if prod_data else 300.0
    expenses_data_tmp = getattr(data, "expenses", None)
    monthly_rm_inp = float(getattr(expenses_data_tmp, "raw_materials", 0) or 0) if expenses_data_tmp else 0.0

    # Priority 2: product table COGS — purchase_price × units_per_month (trading)
    _product_cogs = sum(
        float(getattr(p, "units_per_month", 0) or 0) * float(getattr(p, "purchase_price", 0) or 0)
        for p in (getattr(data, "products", None) or [])
    )

    if rm_per_unit > 0 and input_qty > 0:
        rm_at_100pct = input_qty * work_days * rm_per_unit
    elif _product_cogs > 0 and cap_y1 > 0:
        rm_at_100pct = (_product_cogs * 12) / cap_y1
    elif monthly_rm_inp > 0 and cap_y1 > 0:
        # Priority 3: back-calculate from user-entered monthly RM at Year-1 capacity
        rm_at_100pct = (monthly_rm_inp * 12) / cap_y1
    else:
        # Priority 4: industry default ratio applied to annual revenue
        rm_at_100pct = annual_rev * cogs_ratio

    monthly_cogs      = R(rm_at_100pct * cap_y1 / 12)   # exact monthly COGS matching annual model
    monthly_marketing = R(monthly_rev * mktg_ratio)      # variable (may be overridden below)

    # ── Actual fixed expenses (salary + rent) ────────────────────────────────
    # Prefer user-entered actual salary/rent over industry default ratio.
    manpower_data   = getattr(data, "manpower", None)
    expenses_data   = getattr(data, "expenses", None)

    _actual_salary = 0.0
    if manpower_data:
        _skilled      = float(getattr(manpower_data, "skilled_count",      0) or 0) * float(getattr(manpower_data, "skilled_salary",      0) or 0)
        _semi         = float(getattr(manpower_data, "semi_skilled_count", 0) or 0) * float(getattr(manpower_data, "semi_skilled_salary", 0) or 0)
        _unskilled    = float(getattr(manpower_data, "unskilled_count",    0) or 0) * float(getattr(manpower_data, "unskilled_salary",    0) or 0)
        _actual_salary = R(_skilled + _semi + _unskilled)

    _actual_rent = float(getattr(expenses_data, "monthly_rent", getattr(expenses_data, "rent", 0)) or 0) if expenses_data else 0.0

    # Use actual salary+rent if available; otherwise fall back to industry default
    if _actual_salary > 0 or _actual_rent > 0:
        monthly_fixed_exp = R(_actual_salary + _actual_rent)
    else:
        monthly_fixed_exp = R(annual_rev * cap_y1 * fixed_ratio / 12)

    # ── Actual variable expenses (electricity, transport, marketing, etc.) ──────
    _actual_marketing = float(getattr(expenses_data, "marketing", 0) or 0) if expenses_data else 0.0
    _actual_var_expenses = 0.0
    if expenses_data:
        _actual_var_expenses = R(
            float(getattr(expenses_data, "electricity_water",    0) or 0) +
            float(getattr(expenses_data, "repair_maintenance",   0) or 0) +
            float(getattr(expenses_data, "transport_conveyance", 0) or 0) +
            float(getattr(expenses_data, "telephone_internet",   0) or 0) +
            float(getattr(expenses_data, "stationery",           0) or 0) +
            float(getattr(expenses_data, "miscellaneous",        0) or 0)
        )
    # If user entered actual marketing cost, use it directly; suppress ratio-based marketing
    if _actual_marketing > 0:
        monthly_marketing = R(_actual_marketing)
        mktg_ratio = 0.0

    gross       = R(monthly_rev - monthly_cogs)
    # variable_total = COGS + marketing + other variable expenses (for Section O sub-total)
    _variable_subtotal = R(monthly_cogs + monthly_marketing + _actual_var_expenses)
    total_opex  = R(_variable_subtotal + monthly_fixed_exp)
    ebitda      = R(monthly_rev - total_opex)
    monthly_dep = R(annual_dep / 12)

    # "EMI" here means Year-1 TL debt service (interest + principal) — read off the
    # actual half-yearly reducing-balance schedule below, NOT calc_emi()'s standard
    # monthly-compounding formula. This platform never uses EMI for the TL; calc_emi()
    # ignored moratorium entirely and disagreed with every other TL figure in the report.
    term_loan  = float(scheme_data.get("term_loan", 0) or 0)
    monthly_int       = R(float(loan_schedule[0]["interest_paid"]) / 12)   # TL interest only
    monthly_principal = R(float(loan_schedule[0]["principal_paid"]) / 12)  # TL principal only
    emi        = R(monthly_int + monthly_principal, 2)
    # Add WC interest (separate revolving charge)
    wc_y1 = wc_schedule[0] if wc_schedule else {}
    monthly_wc_int = R(float(wc_y1.get("wc_interest", 0) or 0) / 12)

    # CA P&L: TL interest + WC interest both deducted from EBIT to get PBT
    ebit   = R(ebitda - monthly_dep)
    pbt    = R(ebit - monthly_int - monthly_wc_int)
    tax    = R(max(pbt * tax_rate, 0))
    pat    = R(pbt - tax)

    # CA CORRECT: Net Cash Surplus = PAT + Dep - TL Principal (WC principal not repaid — revolving)
    surplus = R(pat + monthly_dep - monthly_principal)

    # Combined monthly interest for display and scorecard
    total_monthly_int = R(monthly_int + monthly_wc_int)

    return {
        "gross_monthly_revenue":   monthly_rev,
        "net_monthly_revenue":     monthly_rev,
        "cogs_monthly":            monthly_cogs,
        "rent":                    R(_actual_rent),
        "gross_profit_monthly":    gross,
        "variable_total":          _variable_subtotal,   # COGS + marketing + actual var expenses
        "fixed_total":             monthly_fixed_exp,
        "fixed_salary":            R(monthly_fixed_exp - _actual_rent),    # used in Section E/O salary display
        "mktg_monthly":            monthly_marketing,
        "operating_monthly_exp":   total_opex,
        "total_monthly_exp":       total_opex,
        "ebitda_monthly":          ebitda,
        "ebitda_margin_pct":       R(ebitda / monthly_rev * 100, 2) if monthly_rev else 0,
        "monthly_dep":             monthly_dep,
        "monthly_int_y1":          total_monthly_int,  # TL + WC interest combined for display
        "monthly_tl_int":          monthly_int,
        "monthly_wc_int":          monthly_wc_int,
        "pbt_monthly":             pbt,
        "tax_monthly":             tax,
        "pat_monthly":             pat,
        # CA CORRECT formula:
        "surplus_monthly":         surplus,
        "emi":                     emi,                  # TL EMI only
        "monthly_principal":       monthly_principal,    # TL principal only
        "annual_revenue":          R(monthly_rev * 12),
        "annual_ebitda":           R(ebitda * 12),
        "annual_pat":              R(pat * 12),
        "annual_emi":              R(emi * 12),
        "net_margin_pct":          R(pat / monthly_rev * 100, 2) if monthly_rev else 0,
        # ROI: guard against project_cost=0 — return 0 instead of ∞
        "roi_ebitda_pct":          R(ebitda * 12 / float(scheme_data.get("project_cost") or 0) * 100, 2)
                                   if float(scheme_data.get("project_cost") or 0) > 0 else 0.0,
        "roi_pat_pct":             R(pat   * 12 / float(scheme_data.get("project_cost") or 0) * 100, 2)
                                   if float(scheme_data.get("project_cost") or 0) > 0 else 0.0,
        "stock_req":               float(wc_y1.get("stock",    0)),
        "debtors":                 float(wc_y1.get("debtors",  0)),
        "creditors":               float(wc_y1.get("creditors", 0)),
        "cash_min":                0.0,
        "total_ca":                float(wc_y1.get("total",    0)),
        "total_cl":                float(wc_y1.get("bank_loan", 0)),
        "net_wc":                  float(wc_y1.get("margin",   0)),
        # NOT a Current Ratio (Total Current Assets / Total Current Liabilities) —
        # this is WC Requirement / WC Bank Finance, i.e. how many times the
        # arranged WC bank facility covers the assessed WC requirement.
        # Kept under the old "current_ratio" key too for any other legacy
        # consumer, but the PDF must read/label it as WC Bank Finance Coverage.
        "wc_bank_finance_coverage_ratio": R(float(wc_y1.get("total", 0)) / max(float(wc_y1.get("bank_loan", 1)), 1), 2),
        "current_ratio":           R(float(wc_y1.get("total", 0)) / max(float(wc_y1.get("bank_loan", 1)), 1), 2),
        "current_portion_tl":      monthly_principal,
        "industry":                industry,
        "cogs_ratio_pct":          round(cogs_ratio * 100, 1),
        "fixed_ratio_pct":         round(fixed_ratio * 100, 1),
        "gross_margin_pct":        R(gross / monthly_rev * 100, 2) if monthly_rev else 0.0,
    }
