"""
calculations/sensitivity.py — Sensitivity analysis (CA standard, Section S, PDF §7.7)

CA Rule:
  Variable costs MUST scale proportionally with revenue change.
  Fixed costs remain CONSTANT across all scenarios.
  DSCR per scenario = (PAT + Dep + Interest) / (Principal + Interest)

CA AUDIT (this section): the original 6 scenarios only ever varied
REVENUE. A CA reviewer flagged that a bank-grade sensitivity analysis
must also stress the other levers that actually break a proposal —
raw-material cost, salary, receivable days (working capital), and
interest rate — plus at least one COMBINED downside, not just isolated
single-variable shocks. Each of those four is run through the SAME
calculation modules the base report uses (calculate_loan_schedule,
calculate_wc_by_year, calculate_income_statement) on a deep-copied,
single-field-mutated input, so a rate/day/cost shock this section
reports is guaranteed to match what the full report would show for
that same input — never a hand-rolled approximation.
"""
import copy
from core.engine import R, dscr_label
from calculations.dscr import term_loan_dscr
from calculations.loan_schedule import calculate_loan_schedule
from calculations.working_capital import calculate_wc_by_year
from calculations.income_statement import calculate_income_statement

_COGS_RATIO    = 0.50   # variable fraction of revenue
_MARKETING_PCT = 0.025  # also variable

# Stress magnitudes — deliberately explicit constants (not hidden inside a
# formula) so a reviewer can see exactly what "increase" means for each lever.
_RM_COST_INCREASE_PCT      = 10    # raw material / purchase cost +10%
_SALARY_INCREASE_PCT       = 10    # manpower salaries +10%
_RECEIVABLE_DAYS_INCREASE  = 15    # debtor days +15 days
_INTEREST_RATE_INCREASE_PP = 2.0   # interest rate +2 percentage points
_COMBINED_REVENUE_CHG_PCT  = -10   # combined scenario's own revenue shock


def _bump_rm_cost(d, pct_increase: float) -> None:
    """Raise raw-material/purchase cost by pct_increase%, on whichever of the
    three COGS-source fields is actually populated (mirrors the same
    priority order calculations/income_statement.py reads them in), so the
    shock lands correctly regardless of how this applicant described COGS."""
    factor = 1 + pct_increase / 100
    prod = getattr(d, "production", None)
    if prod is not None and float(getattr(prod, "raw_material_cost_per_unit", 0) or 0) > 0:
        prod.raw_material_cost_per_unit = float(prod.raw_material_cost_per_unit) * factor
    for p in (getattr(d, "products", None) or []):
        if float(getattr(p, "purchase_price", 0) or 0) > 0:
            p.purchase_price = float(p.purchase_price) * factor
    expenses = getattr(d, "expenses", None)
    if expenses is not None and float(getattr(expenses, "raw_materials", 0) or 0) > 0:
        expenses.raw_materials = float(expenses.raw_materials) * factor


def _bump_salaries(d, pct_increase: float) -> None:
    """Raise every manpower salary/wage field by pct_increase%."""
    factor = 1 + pct_increase / 100
    manpower = getattr(d, "manpower", None)
    if manpower is None:
        return
    for field in ("skilled_salary", "semi_skilled_salary", "unskilled_salary"):
        cur = float(getattr(manpower, field, 0) or 0)
        if cur > 0:
            setattr(manpower, field, cur * factor)


def _bump_receivable_days(d, extra_days: float) -> None:
    assum = getattr(d, "assumptions", None)
    if assum is None:
        return
    assum.debtor_days = float(getattr(assum, "debtor_days", 0) or 0) + extra_days


def _bump_interest_rate(d, extra_pp: float) -> None:
    assum = getattr(d, "assumptions", None)
    if assum is None:
        return
    assum.interest_rate_pct = float(getattr(assum, "interest_rate_pct", 9.5) or 9.5) + extra_pp


def _run_structural_scenario(data, scheme_data, dep, mutate_fns, revenue_chg_pct: float = 0.0):
    """Deep-copy `data`, apply each mutate_fn to it, then re-run the loan
    schedule / working capital / income statement through the SAME modules
    the base report uses. Optionally also apply a revenue % shock on top,
    using the identical proportional-variable-cost technique the original
    revenue-only scenarios use (fixed costs constant).

    Returns the Year-1 row plus the resolved loan/WC schedules, so the
    caller can pull whatever figures it needs (interest, principal, DSCR).
    """
    d2 = copy.deepcopy(data)
    for fn in mutate_fns:
        fn(d2)
    loan2   = calculate_loan_schedule(d2, scheme_data)
    wc2     = calculate_wc_by_year(d2, scheme_data)
    income2 = calculate_income_statement(d2, scheme_data, dep, loan2, wc2)
    yr1 = dict(income2[0])

    if revenue_chg_pct:
        chg = revenue_chg_pct / 100
        rev      = float(yr1.get("revenue", 0) or 0)
        cogs     = float(yr1.get("cogs", 0) or 0)
        other_var = float(yr1.get("other_variable", 0) or 0)
        marketing = float(yr1.get("marketing", 0) or 0)
        fixed_exp = float(yr1.get("fixed_expenses", 0) or 0)
        dep_yr    = float(yr1.get("depreciation", 0) or 0)
        interest  = float(yr1.get("interest", 0) or 0)
        tl_int    = float(yr1.get("tl_interest", interest) or 0)
        wc_int    = float(yr1.get("wc_interest", 0) or 0)
        tax_rate  = (float(yr1.get("tax", 0) or 0) / float(yr1["profit_before_tax"])) if float(yr1.get("profit_before_tax", 0) or 0) > 0 else 0.25

        new_rev  = R(rev * (1 + chg), 2)
        new_var  = R((cogs + other_var + marketing) * (1 + chg), 2)
        new_ebitda = R(new_rev - new_var - fixed_exp, 2)
        new_ebit   = R(new_ebitda - dep_yr, 2)
        new_pbt    = R(new_ebit - interest, 2)
        new_tax    = R(max(new_pbt * tax_rate, 0), 2)
        new_pat    = R(new_pbt - new_tax, 2)
        yr1["revenue"] = new_rev
        # BUG FIX: cogs/other_variable/marketing must be scaled by the same
        # (1 + chg) factor used to compute new_var/new_ebitda above — leaving
        # them at their pre-shock values made the displayed "COGS" cell
        # self-contradictory against the EBITDA shown in the same row
        # (e.g. "Combined Downside" showed the Raw-Material-Cost-mutated
        # COGS without the -10% revenue shock also applied to it).
        yr1["cogs"] = R(cogs * (1 + chg), 2)
        yr1["other_variable"] = R(other_var * (1 + chg), 2)
        yr1["marketing"] = R(marketing * (1 + chg), 2)
        yr1["ebitda"]  = new_ebitda
        yr1["pat"] = yr1["net_profit"] = new_pat
        yr1["cash_accruals"] = R(new_pat + dep_yr, 2)
        yr1["tl_interest"] = tl_int
        yr1["wc_interest"] = wc_int

    return yr1, loan2, wc2


def calculate_sensitivity(data, scheme_data: dict, monthly: dict, income_statement: list | None = None, dep: dict | None = None) -> list:
    """
    Run the CA-standard sensitivity suite: 6 revenue scenarios (+20% to
    -30%, unchanged from the original spec), plus 4 single-lever structural
    stress scenarios (raw-material cost, salary, receivable days, interest
    rate) and 1 combined downside scenario. `dep` (the depreciation
    schedule) is required for the structural scenarios — when omitted (e.g.
    an older caller), only the 6 revenue scenarios are returned.

    Base case uses the Year-1 master income statement. Variable costs scale with
    revenue; fixed costs stay constant. DSCR uses CA standard formula per scenario.
    """
    yr1 = (income_statement or [{}])[0] if income_statement else {}
    if yr1:
        base_rev   = float(yr1.get("revenue", yr1.get("sales", 0)) or 0) / 12
        base_cogs  = float(yr1.get("cogs", yr1.get("raw_materials", 0)) or 0) / 12
        base_var   = (
            float(yr1.get("cogs", yr1.get("raw_materials", 0)) or 0) +
            float(yr1.get("power", yr1.get("other_variable", 0)) or 0) +
            float(yr1.get("marketing", yr1.get("marketing_expenses", 0)) or 0)
        ) / 12
        base_fixed  = float(yr1.get("fixed_expenses", yr1.get("total_fixed", 0)) or 0) / 12
        monthly_dep = float(yr1.get("depreciation", 0) or 0) / 12
        # Total interest (TL + WC) — used for P&L (PBT/PAT) only.
        monthly_int = float(yr1.get("interest", 0) or 0) / 12
        # TL-ONLY interest — used for the Term Loan DSCR formula below, so the
        # sensitivity DSCR matches the main DSCR schedule's definition exactly
        # (which deliberately excludes WC interest).
        monthly_tl_int = float(yr1.get("tl_interest", yr1.get("interest", 0)) or 0) / 12
        master_pbt  = float(yr1.get("profit_before_tax", 0) or 0)
        master_tax  = float(yr1.get("tax", 0) or 0)
        tax_rate    = (master_tax / master_pbt) if master_pbt > 0 else 0.25
    else:
        base_rev       = float(monthly.get("net_monthly_revenue", 0) or 0)
        base_cogs      = float(monthly.get("cogs_monthly", monthly.get("raw_material_monthly", 0)) or 0)
        base_var       = float(monthly.get("variable_total", 0) or 0) or R(base_rev * _COGS_RATIO)
        base_fixed     = float(monthly.get("fixed_total",         0) or 0)
        monthly_dep    = float(monthly.get("monthly_dep",         0) or 0)
        monthly_int    = float(monthly.get("monthly_int_y1",      0) or 0)
        monthly_tl_int = float(monthly.get("monthly_tl_int", monthly_int) or 0)
        tax_rate       = float(monthly.get("tax_monthly", 0) / max(float(monthly.get("pbt_monthly", 1) or 1), 0.001)) \
                         if monthly.get("pbt_monthly", 0) and monthly.get("pbt_monthly", 0) > 0 else 0.25
    monthly_prin   = float(monthly.get("monthly_principal",   0) or 0)

    scenarios = [
        ("Best Case",     0.20),
        ("Optimistic",    0.10),
        ("Base Case",     0.00),
        ("Conservative", -0.10),
        ("Pessimistic",  -0.20),
        ("Worst Case",   -0.30),
    ]

    result = []
    for label, chg in scenarios:
        # Revenue changes
        s_rev = R(base_rev * (1 + chg), 2)

        # Variable costs scale proportionally with revenue (CA spec).
        # Monotonic guarantee: higher revenue → lower variable cost ratio → better EBITDA,
        # assuming variable cost ratio < 100%. We do NOT cap the scaling with revenue.
        s_var = R(base_var * (1 + chg), 2)

        # Fixed costs stay constant regardless of revenue level
        s_ebitda = R(s_rev - s_var - base_fixed, 2)
        s_ebit   = R(s_ebitda - monthly_dep, 2)
        s_pbt    = R(s_ebit - monthly_int, 2)
        s_tax    = R(max(s_pbt * tax_rate, 0), 2)
        s_pat    = R(s_pbt - s_tax, 2)

        # Term Loan DSCR — calls the EXACT SAME formula function as the main
        # DSCR schedule (calculations/dscr.py::term_loan_dscr), using TL-only
        # interest, so this can never diverge from the main report's DSCR.
        s_cash_accruals = R(s_pat + monthly_dep, 2)
        _, _, s_dscr = term_loan_dscr(s_cash_accruals, monthly_tl_int, monthly_prin)

        # COGS for this scenario (variable portion only, scaled with revenue)
        s_cogs = R(base_cogs * (1 + chg), 2)

        result.append({
            "scenario":         label,
            "type":             "revenue",
            "change_pct":       int(chg * 100),
            "monthly_revenue":  s_rev,
            "monthly_cogs":     s_cogs,
            "monthly_variable": s_var,
            "monthly_fixed":    base_fixed,
            "monthly_ebitda":   s_ebitda,
            "monthly_profit":   s_pat,
            "dscr":             s_dscr,
            "status":           dscr_label(s_dscr),
        })

    # ── Structural single-lever + combined scenarios ───────────────────────
    # Only runnable when we have real CMAReportInput-shaped data, a real
    # scheme_data dict, and the depreciation schedule to feed
    # calculate_income_statement — i.e. the live report-generation path.
    if dep is not None and income_statement:
        _structural = [
            ("Raw Material Cost +{}%".format(_RM_COST_INCREASE_PCT),
             [lambda d: _bump_rm_cost(d, _RM_COST_INCREASE_PCT)], 0.0),
            ("Salary Increase +{}%".format(_SALARY_INCREASE_PCT),
             [lambda d: _bump_salaries(d, _SALARY_INCREASE_PCT)], 0.0),
            ("Receivable Days +{}".format(_RECEIVABLE_DAYS_INCREASE),
             [lambda d: _bump_receivable_days(d, _RECEIVABLE_DAYS_INCREASE)], 0.0),
            ("Interest Rate +{}pp".format(_INTEREST_RATE_INCREASE_PP),
             [lambda d: _bump_interest_rate(d, _INTEREST_RATE_INCREASE_PP)], 0.0),
            ("Combined Downside",
             [lambda d: _bump_rm_cost(d, _RM_COST_INCREASE_PCT),
              lambda d: _bump_salaries(d, _SALARY_INCREASE_PCT),
              lambda d: _bump_receivable_days(d, _RECEIVABLE_DAYS_INCREASE),
              lambda d: _bump_interest_rate(d, _INTEREST_RATE_INCREASE_PP)],
             _COMBINED_REVENUE_CHG_PCT),
        ]
        for label, mutate_fns, rev_chg in _structural:
            s_yr1, s_loan, s_wc = _run_structural_scenario(data, scheme_data, dep, mutate_fns, rev_chg)
            s_cash_accruals = float(s_yr1.get("cash_accruals", 0) or 0)
            s_tl_int  = float(s_yr1.get("tl_interest", s_yr1.get("interest", 0)) or 0)
            s_tl_prin = float(s_loan[0]["principal_paid"])
            _, _, s_dscr = term_loan_dscr(s_cash_accruals, s_tl_int, s_tl_prin)
            result.append({
                "scenario":         label,
                "type":             "structural",
                "change_pct":       rev_chg,
                "monthly_revenue":  R(float(s_yr1.get("revenue", 0) or 0) / 12, 2),
                "monthly_cogs":     R(float(s_yr1.get("cogs", 0) or 0) / 12, 2),
                "monthly_variable": R((float(s_yr1.get("cogs", 0) or 0) + float(s_yr1.get("other_variable", 0) or 0) + float(s_yr1.get("marketing", 0) or 0)) / 12, 2),
                "monthly_fixed":    R(float(s_yr1.get("fixed_expenses", 0) or 0) / 12, 2),
                "monthly_ebitda":   R(float(s_yr1.get("ebitda", 0) or 0) / 12, 2),
                "monthly_profit":   R(float(s_yr1.get("pat", s_yr1.get("net_profit", 0)) or 0) / 12, 2),
                "dscr":             s_dscr,
                "status":           dscr_label(s_dscr),
            })

    return result
