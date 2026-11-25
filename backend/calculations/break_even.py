"""
calculations/break_even.py — Break-even analysis (CA standard, Section M)

CA Rules:
  Variable  = the five expense heads shown in Section J: Raw Materials / COGS,
              Utilities & Variable Exp, Labour & Wages, Admin & Overhead,
              and Marketing Expenses.
  Operating Fixed = Depreciation + Interest on WC + Interest on Term Loan.
  Financial Fixed = remaining fixed costs + Operating Fixed.
  BEP Sales = Fixed Costs / Contribution Margin Ratio
  BEP %     = BEP Sales / Annual Revenue at 100% capacity

CA AUDIT — Payback Period: the old formula was
  Payback = Total Project Cost / Annual Cash Accruals (Year 1 only, annualised)
which repeated the SAME Year-1-only estimate on every one of the 5 rows and
never showed its own working — a reviewer had no way to see WHY a report
said "35.1 months" or verify it. Payback is now computed as a transparent
CUMULATIVE cash-flow recovery: walk Year 1 -> Year 5's actual (declining-
or-growing) annual cash accruals, accumulate them, and find the exact
month the running total first equals the initial investment (interpolating
within the year it happens using that year's own monthly cash-accrual
rate) — the standard CA "payback period" method, and the full year-by-year
working is returned in `payback_calculation` so the report can show it,
not just assert the final number.
"""
from core.engine import R, annual_revenue_from_prod


def _calculate_cumulative_payback(income: list, initial_investment: float) -> dict:
    """Cumulative cash-flow payback: the month the running total of annual
    cash accruals first reaches `initial_investment`, interpolated within
    that year using its own monthly cash-accrual rate.

    Formula (explicit, for display):
      CumulativeCashAccrual(Year N) = sum(CashAccrual(Year 1..N))
      Payback = FullYears x 12 + (RemainingInvestment / MonthlyCashAccrualOfRecoveryYear)
      where FullYears = last year fully recovered before the investment is
      cleared, and RemainingInvestment = InitialInvestment - CumulativeCashAccrual(FullYears).
    """
    by_year = []
    cumulative = 0.0
    payback_months = None
    recovered_in_year = None
    for i, yr in enumerate(income):
        annual_ca = float(yr.get("cash_accruals", 0) or 0)
        opening_cumulative = cumulative
        cumulative = R(cumulative + annual_ca, 2)
        by_year.append({
            "year":                    yr.get("year", i + 1),
            "annual_cash_accrual":     annual_ca,
            "cumulative_cash_accrual": cumulative,
            "monthly_cash_accrual":    R(annual_ca / 12, 2),
        })
        if payback_months is None and annual_ca > 0 and cumulative >= initial_investment:
            remaining = R(initial_investment - opening_cumulative, 2)
            months_into_year = R(remaining / (annual_ca / 12), 1)
            payback_months = R(i * 12 + months_into_year, 1)
            recovered_in_year = yr.get("year", i + 1)

    return {
        "initial_investment": R(initial_investment, 2),
        "formula": (
            "Payback = FullYears x 12 + (Remaining Investment / Monthly Cash "
            "Accrual of Recovery Year), where Remaining Investment = Initial "
            "Investment - Cumulative Cash Accrual through the last fully-"
            "recovered year. Cash Accrual = PAT + Depreciation."
        ),
        "by_year":            by_year,
        "payback_months":     payback_months,
        "recovered_in_year":  recovered_in_year,
        "not_achievable":     payback_months is None,
    }


def calculate_break_even(income: list, data, scheme_data: dict = None) -> list:
    """
    Compute break-even for each of the 5 projection years.

    Parameters
    ----------
    income       : 5-year income statement rows
    data         : CMAReportInput
    scheme_data  : scheme routing dict (contains project_cost)

    Returns list of 5 dicts. Every row carries the SAME project-level
    `payback_months` (and full `payback_calculation` breakdown) — it is a
    single cumulative-cash-flow metric for the whole project, not a
    per-year figure, but is repeated on each row so existing callers that
    read bep[0] keep working.
    """
    # Fallback only — see the per-year derivation below, which is what's
    # actually used whenever a year has both revenue and capacity.
    _annual_rev_100_fallback = annual_revenue_from_prod(data.production, getattr(getattr(data, "business", None), "industry_type", "manufacturing"))
    project_cost   = float((scheme_data or {}).get("project_cost", 0) or 0)

    _payback_calc = _calculate_cumulative_payback(income, project_cost) if project_cost > 0 else None

    result = []

    for i, yr in enumerate(income):
        rev       = float(yr.get("revenue",        0) or 0)
        cogs = float(yr.get("raw_materials", yr.get("cogs", 0)) or 0)
        utilities = float(yr.get("power", yr.get("other_variable", 0)) or 0)
        labour = float(yr.get("labour", 0) or 0)
        admin = float(yr.get("admin_expenses", 0) or 0)
        marketing = float(yr.get("marketing_expenses", yr.get("marketing", 0)) or 0)

        # Use the same five line items as Section J, once each, as the
        # variable-expense base for Section M.
        var_costs = R(cogs + utilities + labour + admin + marketing)

        # Labour and admin are included in variable expenses, so remove them
        # from the P&L fixed-cost aggregate before calculating any remaining
        # financial fixed charges (such as a guarantee fee).
        fixed_exp = float(yr.get("fixed_expenses", 0) or 0)
        remaining_fixed = R(fixed_exp - labour - admin)
        dep       = float(yr.get("depreciation",   0) or 0)
        wc_interest = float(yr.get("wc_interest", 0) or 0)
        tl_interest = float(yr.get("tl_interest", 0) or 0)
        op_fix_costs = R(dep + wc_interest + tl_interest)
        fix_costs = R(remaining_fixed + op_fix_costs)

        contrib   = R(rev - var_costs)
        cm_ratio  = R(contrib / rev, 4) if rev else 0
        net_profit = R(contrib - op_fix_costs)

        # BUG FIX: annual_rev_100 used to come only from annual_revenue_from_prod(),
        # which derives 100%-capacity revenue from production.input_qty_per_day /
        # selling_price_per_unit — manufacturing-only fields. For a trading (or
        # any) business whose revenue instead comes from the top-level products
        # list, that call returns 0, so "BEP as % of Capacity" silently showed
        # 0.0% every year regardless of the actual BEP. income_statement.py
        # already derived each year's true 100%-capacity revenue correctly
        # (from the products list when present); this year's own revenue ÷
        # capacity reconstructs that exact figure — the same technique
        # pdf/builder.py's own "Revenue at 100%" row uses — without needing to
        # re-derive it from raw production fields at all.
        cap = float(yr.get("capacity", 0) or 0)
        annual_rev_100 = R(rev / cap, 2) if cap else _annual_rev_100_fallback

        # CA Rule: BEP not achievable if contribution ≤ 0 OR BEP sales > 100% installed capacity
        bep_sales = R(fix_costs / cm_ratio) if cm_ratio > 0 else None
        bep_pct   = R(bep_sales / annual_rev_100, 4) if (bep_sales and annual_rev_100) else None
        # Mark N/A when BEP > 100% capacity — technically math works but operationally impossible
        bep_not_achievable = (cm_ratio <= 0) or (bep_pct is not None and bep_pct > 1.0)

        # Both break-even sales values use the same contribution ratio and
        # their respective fixed-cost bases.
        op_bep_sales = R(op_fix_costs / cm_ratio) if cm_ratio > 0 else None
        op_bep_pct   = R(op_bep_sales / annual_rev_100, 4) if (op_bep_sales and annual_rev_100) else None
        op_bep_not_achievable = (cm_ratio <= 0) or (op_bep_pct is not None and op_bep_pct > 1.0)

        # Payback Period — single project-level cumulative cash-flow metric
        # (see _calculate_cumulative_payback above), repeated on every row.
        payback_months = _payback_calc["payback_months"] if _payback_calc else None

        result.append({
            "year":               yr["year"],
            "revenue":            rev,
            "variable_expenses":  var_costs,
            "fixed_expenses":     fix_costs,
            "contribution":       contrib,
            "contribution_pct":   cm_ratio,
            "net_profit":         net_profit,
            "bep_sales":          bep_sales if bep_sales is not None else 0.0,
            "bep_pct":            bep_pct   if bep_pct   is not None else 0.0,
            "bep_not_achievable": bep_not_achievable,
            "operating_fixed_expenses":  op_fix_costs,
            "operating_bep_sales":       op_bep_sales if op_bep_sales is not None else 0.0,
            "operating_bep_pct":         op_bep_pct   if op_bep_pct   is not None else 0.0,
            "operating_bep_not_achievable": op_bep_not_achievable,
            # payback_months is None (→ "N/A") when not achievable, never 0
            "payback_months":     payback_months,
            "payback_not_achievable": _payback_calc is None or payback_months is None,
            "payback_calculation": _payback_calc,
        })

    return result
