"""
calculations/income_statement.py — 5-year P&L (CA standard, Section J)

Industry-specific CA norms (from INDUSTRY_DEFAULTS):
  Manufacturing : COGS 55%  | Fixed 20% | Gross Margin ~45%
  Service       : COGS 10%  | Fixed 55% | Gross Margin ~75%
  Trading       : COGS 70%  | Fixed 10% | Gross Margin ~30%

CA Rules (PDF §7.3):
  BUG 1 FIX: RM = capacityPct[N] × RM_at100pct (from unit costs), NOT revenue × grossMarginPct
  BUG 2 FIX: Variable costs scale with capacity; Fixed costs (salaries, rent) do NOT scale with capacity
  BUG 9 FIX: Revenue Y1 = cap[0] × rev_100; Y2-5 = prev_rev × (1 + rev_g)
  Tax = max(0, PBT × 25%) — MANDATORY.
  Cash Accruals = PAT + Depreciation (NOT PBT + Dep).
"""
from core.engine import DEFAULT_CAPACITY_SCHEDULE, R, annual_revenue_from_prod, get_industry_defaults

_DEFAULT_TAX_RATE  = 0.25
_ADMIN_GROWTH      = 0.05


def _product_monthly_cogs(data) -> float:
    """Sum purchase_price × units_per_month from products list (trading COGS source)."""
    products = getattr(data, "products", None)
    if not products:
        return 0.0
    return sum(
        float(getattr(p, "units_per_month", 0) or 0) * float(getattr(p, "purchase_price", 0) or 0)
        for p in products
    )


def _compute_rm_at_100pct(data, annual_rev_100: float, cogs_ratio: float, capacities: list) -> float:
    """
    CA-grade COGS calculation — four priority levels:

    Priority 1 (Most accurate): Production unit costs
        RM_at_100 = input_qty_per_day × working_days × rm_cost_per_unit

    Priority 2 (Product table COGS — trading):
        RM_at_100 = sum(purchase_price × units_per_month) × 12 / capacity_y1
        Single source of truth when product table has purchase prices.

    Priority 3 (User-entered monthly RM in expenses step):
        RM_at_100 = expenses.raw_materials × 12 / capacity_y1

    Priority 4 (Last resort — industry default ratio):
        RM_at_100 = annual_rev_100 × cogs_ratio
    """
    cap_y1 = float(capacities[0]) if capacities else 0.50

    # Priority 1: unit costs from production parameters (manufacturing)
    prod        = data.production
    rm_per_unit = float(getattr(prod, "raw_material_cost_per_unit", 0) or 0)
    input_qty   = float(getattr(prod, "input_qty_per_day", 0) or 0)
    work_days   = float(getattr(prod, "working_days_per_year", 300) or 300)

    if rm_per_unit > 0 and input_qty > 0:
        return input_qty * work_days * rm_per_unit

    # Priority 2: product table COGS — purchase_price × units_per_month (trading)
    prod_cogs = _product_monthly_cogs(data)
    if prod_cogs > 0 and cap_y1 > 0:
        return (prod_cogs * 12) / cap_y1

    # Priority 3: monthly RM from expenses (raw_material_cost field in the form)
    expenses    = getattr(data, "expenses", None)
    monthly_rm  = float(getattr(expenses, "raw_materials", 0) or 0) if expenses else 0.0
    if monthly_rm > 0 and cap_y1 > 0:
        return (monthly_rm * 12) / cap_y1

    # Priority 4: industry default ratio (last resort — least accurate)
    return annual_rev_100 * cogs_ratio


def calculate_income_statement(
    data, scheme_data: dict, dep: dict,
    loan_schedule: list, wc_schedule: list,
) -> list:
    """
    Build a 5-year income statement.
    """
    assum        = data.assumptions
    industry     = str(getattr(getattr(data, "business", None), "industry_type", "manufacturing") or "manufacturing").lower()
    ind_defaults = get_industry_defaults(industry)

    rev_g        = float(getattr(assum, "revenue_growth_pct",  7.0) or 7.0) / 100
    exp_g        = float(getattr(assum, "expense_growth_pct",  5.0) or 5.0) / 100
    # BUG 2 FIX: Use salary_increase_pct (not exp_g) for salary compounding
    salary_hike  = float(getattr(assum, "salary_increase_pct", 10.0) or 10.0) / 100
    tax_rate     = float(getattr(assum, "tax_rate_pct", _DEFAULT_TAX_RATE * 100) or (_DEFAULT_TAX_RATE * 100)) / 100
    if tax_rate <= 0:
        tax_rate = _DEFAULT_TAX_RATE
    # CA: Closing Reserves = Opening Reserves + PAT − Drawings. 0 = full
    # retention (conservative default for a new project), never invented.
    drawings_pct = float(getattr(assum, "promoter_drawings_pct", 0.0) or 0.0) / 100

    annual_dep     = float(dep.get("annual_dep", 0) or 0)
    # WDV — each year has its own (declining) depreciation figure; fall back
    # to the flat Year-1 value only if a real schedule wasn't supplied.
    dep_schedule   = dep.get("schedule") or []
    annual_rev_100 = annual_revenue_from_prod(data.production, industry)

    # Capacity schedule — resolve FIRST so _compute_rm_at_100pct can use cap_y1
    user_caps = [
        getattr(assum, "capacity_y1_pct", None),
        getattr(assum, "capacity_y2_pct", None),
        getattr(assum, "capacity_y3_pct", None),
        getattr(assum, "capacity_y4_pct", None),
        getattr(assum, "capacity_y5_pct", None),
    ]
    if all(v is not None and float(v or 0) > 0 for v in user_caps):
        capacities = [float(v or 0) / 100 for v in user_caps]
    else:
        capacities = ind_defaults.get("capacity_schedule", DEFAULT_CAPACITY_SCHEDULE)

    # SINGLE SOURCE OF TRUTH: product table entries are the user's actual Year-1 expected revenue.
    # Back-calculate annual_rev_100 so that annual_rev_100 × cap_y1 = product_monthly × 12 exactly.
    # This ensures Section D total and income_statement Year-1 revenue are identical.
    _product_monthly = sum(
        float(getattr(p, "monthly_revenue", 0) or 0)
        for p in (getattr(data, "products", None) or [])
    )
    if _product_monthly > 0 and capacities[0] > 0:
        annual_rev_100 = R(_product_monthly * 12 / capacities[0])

    # CA: cogs_ratio only used as last-resort fallback inside _compute_rm_at_100pct.
    # Do NOT use cogs_pct_override — it was the source of the inverted sensitivity bug.
    cogs_ratio = ind_defaults["cogs_ratio"]
    mktg_ratio = ind_defaults["marketing_ratio"]

    # CA Priority: unit costs → product table COGS → monthly RM from expenses → industry ratio
    rm_at_100pct = _compute_rm_at_100pct(data, annual_rev_100, cogs_ratio, capacities)

    # gross_margin_pct is computed per-year inside the loop from (rev - cogs) / rev

    # Actual expenses from user input
    manpower_data  = getattr(data, "manpower", None)
    expenses_data  = getattr(data, "expenses", None)

    _actual_monthly_salary = 0.0
    if manpower_data:
        _actual_monthly_salary = R(
            float(getattr(manpower_data, "skilled_count",      0) or 0) * float(getattr(manpower_data, "skilled_salary",      0) or 0) +
            float(getattr(manpower_data, "semi_skilled_count", 0) or 0) * float(getattr(manpower_data, "semi_skilled_salary", 0) or 0) +
            float(getattr(manpower_data, "unskilled_count",    0) or 0) * float(getattr(manpower_data, "unskilled_salary",    0) or 0)
        )
    _actual_monthly_rent = float(getattr(expenses_data, "rent", 0) or 0) if expenses_data else 0.0
    _hr_benefits_rate    = float(getattr(assum, "hr_perquisites_rate", 0.10) or 0.10)
    # BUG 2 FIX: Base salary for year-over-year compounding (does NOT scale with capacity)
    _annual_salary_base  = R(_actual_monthly_salary * 12 * (1 + _hr_benefits_rate))
    _annual_rent_base    = R(_actual_monthly_rent * 12)
    _actual_fixed_base   = R(_annual_salary_base + _annual_rent_base) if (_actual_monthly_salary or _actual_monthly_rent) else 0.0

    _actual_monthly_marketing = float(getattr(expenses_data, "marketing", 0) or 0) if expenses_data else 0.0
    _actual_monthly_var = 0.0
    if expenses_data:
        _actual_monthly_var = R(
            float(getattr(expenses_data, "electricity_water",    0) or 0) +
            float(getattr(expenses_data, "repair_maintenance",   0) or 0) +
            float(getattr(expenses_data, "transport_conveyance", 0) or 0) +
            float(getattr(expenses_data, "telephone_internet",   0) or 0) +
            float(getattr(expenses_data, "stationery",           0) or 0) +
            float(getattr(expenses_data, "miscellaneous",        0) or 0)
            # marketing is tracked separately below so it appears correctly in PDF output
        )

    yr1_rev_at_cap = annual_rev_100 * capacities[0]
    if _actual_fixed_base > 0:
        fixed_base = _actual_fixed_base
    else:
        fixed_base = yr1_rev_at_cap * ind_defaults["fixed_ratio"]

    # BUG FIX: scheme_data was accepted as a parameter but never actually
    # read — for a CGTMSE-covered loan, schemes/cgtmse.py computes a real
    # Annual Guarantee Fee (its own docstring says "MUST be added to annual
    # operating expenses in the CMA") and router.py stores it on scheme_data,
    # but nothing downstream ever added it to any expense line, so CGTMSE
    # reports silently omitted a mandatory recurring cost — overstating
    # EBITDA, PAT, cash accruals and DSCR. AGF is charged on the outstanding
    # (guaranteed) loan balance each year, same base as term-loan interest,
    # so it correctly declines as the loan amortises rather than staying
    # flat on the original sanctioned amount.
    _cgtmse_agf_pct = float((scheme_data or {}).get("cgtmse_agf_pct", 0) or 0)

    result              = []
    cumulative_reserves = 0.0

    for i in range(5):
        yr  = i + 1
        cap = capacities[i] if i < len(capacities) else capacities[-1]

        # Keep Year 1 full-capacity revenue as the fixed baseline; utilization alone
        # determines each year's projected revenue.
        rev = R(annual_rev_100 * cap)

        # RM scales with capacity (volume) AND compounds by cost inflation (exp_g),
        # mirroring revenue's price growth so gross margin stays realistic rather
        # than expanding every year on flat unit costs.
        cogs      = R(rm_at_100pct * cap * (1 + exp_g) ** i)
        # BUG 2 FIX: When user enters absolute marketing cost, compound it by exp_g so it
        # appears correctly in the "marketing" output key (and therefore in the PDF).
        # If no absolute amount, fall back to industry default ratio applied to revenue.
        if _actual_monthly_marketing > 0:
            marketing = R(_actual_monthly_marketing * 12 * (1 + exp_g) ** i)
        else:
            marketing = R(rev * mktg_ratio)
        other_var = R(_actual_monthly_var * 12 * (1 + rev_g) ** i) if _actual_monthly_var > 0 else 0.0

        # BUG 2 FIX: Fixed costs do NOT scale with capacity — only compound by hike/growth rate
        if _actual_fixed_base > 0:
            salary_exp     = R(_annual_salary_base * (1 + salary_hike) ** i)
            rent_admin_exp = R(_annual_rent_base * (1 + exp_g) ** i)
            fixed_exp      = R(salary_exp + rent_admin_exp)
        else:
            salary_exp     = 0.0
            rent_admin_exp = 0.0
            fixed_exp      = R(fixed_base * (1 + exp_g) ** i)

        # CGTMSE Annual Guarantee Fee — charged on the outstanding term loan
        # balance (same base as interest), so it declines with the loan.
        # Genuinely a fixed cost (independent of capacity/volume), so it is
        # folded into fixed_exp — every downstream consumer that reads
        # "fixed_expenses" (e.g. calculations/break_even.py) picks it up
        # automatically — and also exposed under its own key for display.
        cgtmse_fee = R(float(loan_schedule[i]["opening_balance"]) * _cgtmse_agf_pct / 100, 2) if _cgtmse_agf_pct > 0 else 0.0
        fixed_exp  = R(fixed_exp + cgtmse_fee)

        total_opex = R(cogs + marketing + other_var + fixed_exp)
        ebitda     = R(rev - total_opex)
        # WDV: pull this year's own depreciation from the schedule (declining
        # each year on the reducing WDV balance) — never the same figure
        # repeated across all 5 years like SLM would give.
        dep_yr     = R(float(dep_schedule[i]["depreciation"])) if i < len(dep_schedule) else R(annual_dep)

        interest   = float(loan_schedule[i]["interest_paid"])
        wc_int     = float(wc_schedule[i]["wc_interest"]) if wc_schedule else 0.0
        emi_paid   = float(loan_schedule[i]["emi_paid"])
        principal_paid = float(loan_schedule[i]["principal_paid"])

        ebit = R(ebitda - dep_yr)
        pbt  = R(ebit - interest - wc_int)
        tax  = R(max(pbt * tax_rate, 0))
        pat  = R(pbt - tax)

        cash_accruals        = R(pat + dep_yr)
        # CA: drawings reduce retained earnings but are NOT a P&L expense —
        # they come out of PAT after tax, same as a dividend would for a company.
        drawings             = R(max(pat, 0) * drawings_pct)
        cumulative_reserves  = R(cumulative_reserves + pat - drawings)

        result.append({
            "year":               yr,
            "capacity":           cap,
            "revenue":            rev,
            "sales":              rev,
            "cogs":               cogs,
            "raw_materials":      cogs,
            "power":              other_var,
            "other_variable":     other_var,
            "total_variable":     R(cogs + other_var),
            "marketing":          marketing,
            "marketing_expenses": marketing,
            "labour":             salary_exp if _actual_fixed_base > 0 else fixed_exp,
            "admin_expenses":     rent_admin_exp,
            "cgtmse_fee":         cgtmse_fee,
            "fixed_expenses":     fixed_exp,
            "total_fixed":        R(fixed_exp + marketing),
            "total_expenses":     R(total_opex + dep_yr + interest + wc_int),
            "expenses":           total_opex,
            "operating_expenses": total_opex,
            "gross_profit":       R(rev - cogs),
            "gross_margin_pct":   round((rev - cogs) / rev * 100, 2) if rev > 0 else 0.0,  # per-year
            "ebitda":             ebitda,
            "depreciation":       dep_yr,
            "ebit":               ebit,
            "interest":           R(interest + wc_int),
            "tl_interest":        interest,
            "wc_interest":        wc_int,
            "profit_before_tax":  pbt,
            "tax":                tax,
            "tax_rate_pct":       round(tax_rate * 100, 1),
            "pat":                pat,
            "net_profit":         pat,
            "profit_after_tax":   pat,
            "cash_accruals":      cash_accruals,
            "drawings":           drawings,
            "reserves_surplus":   cumulative_reserves,
            "emi_paid":           emi_paid,
            # BUG FIX: was PAT - full TL Service (principal + interest) — interest
            # is already deducted once inside PAT, so subtracting it again here
            # double-counted it. CA rule (matches Section O2's "Net Cash Surplus"
            # and monthly_pnl.py's own documented formula): Cash Accruals (PAT +
            # Dep) less TL Principal only.
            "net_surplus":        R(cash_accruals - principal_paid),
            "dscr":               0.0,
            "industry":           industry,
            "cogs_ratio_pct":     round((cogs / rev * 100) if rev > 0 else 0, 1),
            "rm_at_100pct":       rm_at_100pct,
            "gross_margin_pct_readonly": round((rev - cogs) / rev * 100, 2) if rev > 0 else 0.0,
        })

    return result
