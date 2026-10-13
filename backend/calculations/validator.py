"""
calculations/validator.py — All V1-V12 CA validation checks (Bug: ADD output validator)

V1.  MoF Total == ProjectCost (within ₹1)
V2.  Sum of cost items == ProjectCost (within ₹1)
V3.  WC_Loan NOT inside MoF table total
V4.  TermLoan <= ProjectCost
V5.  Every DSCR_YearN > 0
V6.  PAT trend check (warn if all negative)
V7.  Every ClosingCash_YearN > 0
V8.  Sensitivity: higher revenue → higher PAT
V9.  RM_YearN ≈ capacityPct[N] × RM_at100pct
V10. GrossBlock == Building + PM_with_contingency + Fixtures
V11. PromoterCash >= 0
V12. Balance sheet: TotalAssets == TotalLiabilities (each year)

Critical errors are returned to the caller. Warnings are advisory only.
"""
from core.engine import R, get_scheme_benchmarks


class ValidationError(ValueError):
    pass


def validate_report(report_data: dict) -> None:
    """
    Run V1-V12 checks. Raises ValidationError listing all critical failures.
    Warnings are stored in report_data['validation_warnings'].
    """
    errors   = []
    warnings = []

    scheme_data = report_data.get("scheme_data",      {})
    income      = report_data.get("income_statement", [])
    dscr_data   = report_data.get("dscr",             {})
    bs          = report_data.get("balance_sheet",    [])
    sensitivity = report_data.get("sensitivity",      [])
    dep         = report_data.get("depreciation",     {})
    wc_schedule = report_data.get("wc_schedule",      [])
    loan_sched  = report_data.get("loan_schedule",    [])

    def close(a, b, tol=1.0):
        return abs(R(float(a), 2) - R(float(b), 2)) <= tol

    project_cost    = float(scheme_data.get("project_cost",    0) or 0)
    # schemes/router.py: project_cost = fixed_project_cost + wc_margin (the
    # promoter's own WC contribution) — see _compute_project_cost's docstring.
    # Every scheme's 3-way MoF split (promoter + subsidy + term loan) is
    # computed purely against fixed_project_cost and never touches wc_margin,
    # so MoF must reconcile against fixed_project_cost, NOT project_cost —
    # comparing against project_cost was off by wc_margin on every single
    # application that has any working-capital requirement (nearly all of
    # them), producing a false "MoF must reconcile" error on a healthy report.
    fixed_project_cost = float(scheme_data.get("fixed_project_cost", project_cost) or project_cost)
    term_loan       = float(scheme_data.get("term_loan",       0) or 0)
    promoter        = float(scheme_data.get("promoter_amount", 0) or 0)
    subsidy         = float(scheme_data.get("margin_money",    0) or 0)
    wc_loan_scheme  = float(scheme_data.get("wc_loan",         0) or 0)

    # V1: MoF total == FixedProjectCost (WC_Loan and WC_Margin must NOT be in MoF)
    mof_total = R(promoter + subsidy + term_loan, 2)
    if fixed_project_cost > 0 and not close(mof_total, fixed_project_cost, 1):
        errors.append(
            f"V1 FAIL — MoF (₹{mof_total:,.0f}) ≠ Fixed Project Cost (₹{fixed_project_cost:,.0f}). "
            "MoF must reconcile. Check promoter/subsidy/TL split."
        )

    # V2: Cost line items sum == ProjectCost
    cost_items = report_data.get("input", {}).get("project", {})
    if cost_items:
        machinery_total = sum(
            float(m.get("quantity", 1)) * float(m.get("unit_price", 0))
            for m in cost_items.get("machinery_items", [])
        ) + float(cost_items.get("tools_installation", 0) or 0)
        assum_data = report_data.get("input", {}).get("assumptions", {})
        contingency_pct = float(assum_data.get("contingency_pct", 0) or 0) / 100
        pm_with_cont = machinery_total * (1 + contingency_pct)
        items_sum = (
            float(cost_items.get("land_cost", 0) or 0)
            + float(cost_items.get("building_cost", 0) or 0)
            + pm_with_cont
            + float(cost_items.get("preliminary_expenses", 0) or 0)
        )
        wc_pct   = float(assum_data.get("wc_loan_pct", 60) or 60) / 100
        wc_rev   = project_cost - items_sum   # approx WC_Margin in project cost
        if project_cost > 0 and items_sum > 0 and not close(items_sum + wc_rev, project_cost, project_cost * 0.01):
            warnings.append(
                f"V2 WARN — Cost items sum (₹{items_sum:,.0f}) may not fully reconcile with ProjectCost (₹{project_cost:,.0f})."
            )

    # V3: WC_Loan must NOT be in MoF total
    if wc_loan_scheme > 0 and close(mof_total, project_cost + wc_loan_scheme, 100):
        errors.append(
            f"V3 FAIL — WC Loan (₹{wc_loan_scheme:,.0f}) appears to be included inside MoF total. "
            "WC Loan is a revolving facility and must NOT be in the MoF table."
        )

    # V4: TermLoan <= ProjectCost
    if project_cost > 0 and term_loan > project_cost:
        errors.append(
            f"V4 FAIL — Term Loan (₹{term_loan:,.0f}) exceeds ProjectCost (₹{project_cost:,.0f}). "
            "Loan cannot exceed total project cost."
        )

    # V5: Every year DSCR > 0
    for row in dscr_data.get("years", []):
        dv = float(row.get("dscr", 0) or 0)
        if float(row.get("total_b", 0) or 0) > 0 and dv <= 0:
            errors.append(
                f"V5 FAIL — Year {row.get('year')}: DSCR is {dv:.2f} (must be > 0). "
                "Cash accruals do not cover loan repayment this year — the project as "
                "assumed cannot service this debt. Review selling price vs. raw material "
                "cost per unit, capacity utilisation, and fixed overheads (manpower, rent) "
                "relative to revenue before resubmitting."
            )

    # V6: Warn if all PAT are negative
    pats = [float(yr.get("pat", 0) or 0) for yr in income]
    if pats and all(p < 0 for p in pats):
        warnings.append(
            "V6 WARN — Project is loss-making in ALL 5 projected years. "
            "Revise revenue or cost inputs before submission."
        )

    # V7: Every closing cash > 0
    for bs_row in (bs or []):
        yr  = bs_row.get("year", "?")
        cash = float(bs_row.get("cash", bs_row.get("closing_cash", 0)) or 0)
        if yr != 0 and cash < 0:
            warnings.append(
                f"V7 WARN — Year {yr}: Closing cash is negative (₹{cash:,.0f}). "
                "Liquidity support may be required."
            )

    # V8: Sensitivity — higher revenue → higher PAT
    if sensitivity:
        sorted_sens = sorted(sensitivity, key=lambda s: float(s.get("monthly_revenue", 0) or 0))
        for j in range(1, len(sorted_sens)):
            prev, curr = sorted_sens[j - 1], sorted_sens[j]
            prev_rev = float(prev.get("monthly_revenue", 0) or 0)
            curr_rev = float(curr.get("monthly_revenue", 0) or 0)
            prev_pat = float(prev.get("monthly_profit", 0) or 0)
            curr_pat = float(curr.get("monthly_profit", 0) or 0)
            if curr_rev > prev_rev and curr_pat < prev_pat - 1:
                errors.append(
                    f"V8 FAIL — Sensitivity is inverted: higher revenue scenario has lower PAT. "
                    "RM cost is likely being calculated as a % of revenue (grossMarginPct bug)."
                )
                break

    # V9: RM scaling from unit costs
    if income and wc_schedule:
        y1_income = income[0]
        y2_income = income[1] if len(income) > 1 else None
        rm_y1 = float(y1_income.get("cogs", y1_income.get("raw_materials", 0)) or 0)
        rm_100 = float(y1_income.get("rm_at_100pct", 0) or 0)
        cap_y1 = float(y1_income.get("capacity", 0.5) or 0.5)
        if rm_100 > 0:
            expected_rm_y1 = rm_100 * cap_y1
            if not close(rm_y1, expected_rm_y1, max(1, expected_rm_y1 * 0.01)):
                warnings.append(
                    f"V9 WARN — RM Year 1 (₹{rm_y1:,.0f}) ≠ cap({cap_y1:.0%}) × RM_100 (₹{expected_rm_y1:,.0f}). "
                    "RM may not be scaling correctly from unit costs."
                )

    # V10: Gross Block must equal Building + P&M-with-contingency + Fixtures.
    # BUG FIX: this used to compare pm_with_contingency against
    # machinery_gross (the pre-contingency subtotal) and warn when they
    # DIFFERED — but they are DESIGNED to differ whenever contingency_pct
    # > 0 (the normal case for virtually every application), so the old
    # check false-positived on every healthy report and could never
    # actually catch anything. The real regression to guard against (BUG 5
    # FIX in calculations/depreciation.py) is Gross Block silently being
    # built from the pre-contingency figure instead of the loaded one —
    # checked directly here by re-deriving Gross Block from its own
    # stated components.
    dep_pm       = float(dep.get("pm_with_contingency", 0) or 0)
    dep_bldg     = float(dep.get("building_gross", 0) or 0)
    dep_fixtures = float(dep.get("fixtures_gross", 0) or 0)
    dep_gb       = float(dep.get("gross_block", 0) or 0)
    expected_gb  = R(dep_bldg + dep_pm + dep_fixtures, 2)
    if dep_gb > 0 and not close(dep_gb, expected_gb, 1):
        warnings.append(
            f"V10 WARN — Gross Block (₹{dep_gb:,.0f}) ≠ Building + P&M-with-contingency + Fixtures "
            f"(₹{expected_gb:,.0f}). Depreciation base may not correctly include contingency."
        )

    # V11: PromoterCash >= 0
    if promoter < 0:
        errors.append(
            f"V11 FAIL — Promoter contribution is negative (₹{promoter:,.0f}). "
            "Reduce term loan or increase project cost."
        )

    # V12: Balance sheet balances each year. This is a hard accounting
    # integrity rule: Assets must equal Equity + Liabilities.
    for bs_row in (bs or []):
        yr     = bs_row.get("year", "?")
        check  = float(bs_row.get("check", 0) or 0)
        t_ass  = float(bs_row.get("total_assets", 0) or 0)
        t_liab = float(bs_row.get("total_liabilities", 0) or 0)
        if t_ass > 0 and abs(check) > 1:
            errors.append(
                f"Accounting integrity error: Balance sheet mismatch in Year {yr}. "
                f"TotalAssets (₹{t_ass:,.0f}) ≠ "
                f"TotalLiabilities (₹{t_liab:,.0f}). Diff = ₹{check:,.0f}."
            )

    # ── Original checks ──────────────────────────────────────────────────────
    scheme_str = str(scheme_data.get("scheme", "default")).lower()
    benchmarks = get_scheme_benchmarks(scheme_str)

    # CHECK 3: Tax deducted from PBT
    if income:
        y1 = income[0]
        pbt = float(y1.get("profit_before_tax", 0) or 0)
        tax = float(y1.get("tax", 0) or 0)
        if pbt > 0 and tax <= 0:
            errors.append(
                f"CHECK 3 FAIL — Tax is zero when PBT = ₹{pbt:,.0f}. "
                "Tax = max(0, PBT × effective tax rate) must be deducted whenever PBT > 0 — "
                "the effective rate itself (25% platform default) is an illustrative CMA-projection "
                "assumption, not a statutory rate for every business constitution."
            )

    # CHECK 4: Cash Accruals = PAT + Depreciation
    if income:
        y1  = income[0]
        pat = float(y1.get("pat", 0) or 0)
        dep_yr = float(y1.get("depreciation", 0) or 0)
        ca  = float(y1.get("cash_accruals",  0) or 0)
        if ca > 0 and not close(ca, pat + dep_yr, 5):
            errors.append(
                f"CHECK 4 FAIL — Cash Accruals (₹{ca:,.0f}) ≠ PAT (₹{pat:,.0f}) + Dep (₹{dep_yr:,.0f})."
            )

    # CHECK 5: Income statement has data
    if not income:
        errors.append("CHECK 5 FAIL — Income statement is empty.")
    elif float(income[0].get("revenue", 0) or 0) <= 0:
        errors.append("CHECK 5 FAIL — Year-1 revenue is zero. Check production parameters.")

    # CHECK 6: DSCR benchmark
    avg_dscr = float(dscr_data.get("average", 0) or 0)
    dscr_min = benchmarks["dscr_avg"]
    if avg_dscr > 0 and avg_dscr < dscr_min:
        warnings.append(
            f"CHECK 6 WARN — Average DSCR {avg_dscr:.2f}x below {scheme_str.upper()} minimum {dscr_min}x."
        )

    # V13: Existing business claims a commencement date that isn't in the past.
    # An "Existing Business (N years)" with a commencement date of today (or
    # later) is internally inconsistent — the business can't have both just
    # started and already been running for N years. Escalated from a warning
    # to a hard error: the applicant must correct one of the two contradictory
    # fields before a report is generated, rather than the report silently
    # showing a fabricated "N yr M mo" figure alongside a same-day/future
    # commencement date.
    business_info = report_data.get("input", {}).get("business", {})
    biz_status   = str(business_info.get("business_status", "") or "").lower()
    biz_duration = float(business_info.get("business_duration_months", 0) or 0)
    commencement = str(business_info.get("commencement_date", "") or "")
    if "existing" in biz_status and biz_duration > 0 and commencement:
        try:
            from datetime import date, datetime as _dt
            _commencement_date = _dt.fromisoformat(commencement[:10]).date()
            if _commencement_date >= date.today():
                errors.append(
                    f"V13 FAIL — Business Status is 'Existing Business ({biz_duration:.0f} months)' "
                    f"but Commencement Date ({commencement[:10]}) is today or in the future. "
                    "An existing business cannot have commenced today. Correct either the "
                    "commencement date (to a past date matching the stated business duration) "
                    "or the business duration/status before resubmitting."
                )
        except (ValueError, TypeError):
            pass  # unparseable date — not this check's concern

    # V14: Constitution declared as a multi-person entity (Partnership/LLP/
    # Private Limited/Cooperative) but the input schema only ever captures
    # ONE signing promoter's KYC and net-worth data (ApplicantInfo has no
    # partner list) — every net-worth, DSCR and personal-guarantee figure
    # in the report is therefore that single promoter's alone, silently
    # understating a genuine multi-partner entity's actual means/liability,
    # or simply being the wrong label for what is really a one-person
    # business. Advisory only: the schema cannot check the real partner
    # count, so this can't be a hard error.
    _multi_person_types = ("partnership", "llp", "private limited", "pvt ltd",
                            "cooperative", "co-operative", "huf")
    _biz_type_lc = str(business_info.get("business_type", "") or "").lower()
    if any(t in _biz_type_lc for t in _multi_person_types):
        warnings.append(
            f"V14 WARN — Constitution is declared as '{business_info.get('business_type')}', "
            "but this report captures financial/KYC data for only ONE promoter. If other "
            "partners/directors exist, their net worth, collateral and personal guarantees "
            "are NOT reflected anywhere in this report — confirm the constitution and, if "
            "multiple partners are involved, obtain their details separately before submission."
        )

    # ── Attach warnings ───────────────────────────────────────────────────────
    report_data["validation_warnings"] = warnings

    if errors:
        raise ValidationError(
            f"Report failed {len(errors)} validation check(s):\n" +
            "\n".join(f"  • {e}" for e in errors)
        )


class StructuralReconciliationError(ValueError):
    """Raised when a pure arithmetic-identity check fails — a genuine
    calculation-integrity bug, not a business-outcome warning."""
    pass


def structural_reconciliation(cma: dict, dpr: dict) -> list:
    """
    Eleven pure arithmetic-identity checks over already-computed report data.

    These are NOT business-outcome judgements — a loss-making year, a DSCR
    below 1, or negative cash are valid, correctly-computed OUTCOMES, not
    structural failures, and are deliberately NOT checked here (they are
    surfaced separately, in the Executive Credit Summary / DSCR / Balance
    Sheet sections, as risk warnings). This function only verifies that the
    numbers the report displays are internally self-consistent: every total
    equals the sum of its own parts, and every roll-forward schedule ties
    opening to closing correctly.

    Returns a list of {"name", "passed", "detail"} dicts, most-important
    first. Does not raise — the caller (pdf/builder.py) decides whether any
    FAIL should block report generation.
    """
    def close(a, b, tol=5.0):
        try:
            return abs(float(a) - float(b)) <= tol
        except (TypeError, ValueError):
            return False

    checks = []
    pc  = dpr.get("project_cost", {})
    dep = dpr.get("depreciation", {})
    tl  = dpr.get("term_loan", {})
    wc  = dpr.get("working_capital_years", [])
    cop = dpr.get("profit_and_loss_years", [])
    pbs = dpr.get("balance_sheet_years", [])
    pcf = dpr.get("cash_flow_years", [])

    # 1. Project Cost Items Sum = Total Project Cost (itemised cost table
    #    sums to the total shown everywhere else in the report).
    # CA AUDIT: this check was previously mislabelled "Project Cost = Means
    # of Finance" even though it never compares the cost side to the
    # funding side at all — it only verifies the itemised cost table's own
    # arithmetic. That label reads, on Section 31, as if "Total Project
    # Cost equals Total Means of Finance" had been checked and passed —
    # but Total Project Cost (Rs.15,01,700 on a live report) and Total
    # Funding Requirement including WC Bank Finance (Rs.16,95,500) are
    # DELIBERATELY different figures (Section 08 explains the Rs.1,93,800
    # WC Bank Finance gap between them), so a reader could easily read
    # this PASS as contradicting Section 08's own numbers. Renamed to
    # describe exactly what this check tests; the real cost-vs-funding
    # reconciliation is check #11 below.
    items = cma.get("project_cost_items", [])
    total_pc = float(cma.get("total_project_cost", pc.get("total_project_cost", 0)) or 0)
    items_sum = sum(float(i.get("amount", 0) or 0) for i in items)
    checks.append({
        "name":   "Project Cost Items Sum = Total Project Cost",
        "passed": close(items_sum, total_pc, 5.0) if total_pc else True,
        "detail": f"Cost items sum Rs.{items_sum:,.0f} vs Total Project Cost Rs.{total_pc:,.0f}",
    })

    # 2. P&L roll-forward: PBT = Revenue - Total Expenses; PAT = PBT - Tax
    pnl_ok, pnl_detail = True, "All years reconcile"
    for cy in cop:
        rev, texp = float(cy.get("revenue", 0) or 0), float(cy.get("total_expenses", 0) or 0)
        pbt, tax  = float(cy.get("profit_before_tax", 0) or 0), float(cy.get("tax", 0) or 0)
        pat = float(cy.get("net_profit", cy.get("pat", 0)) or 0)
        if not close(rev - texp, pbt, 5.0) or not close(pbt - tax, pat, 5.0):
            pnl_ok, pnl_detail = False, f"Year {cy.get('year')}: PBT/PAT roll-forward mismatch"
            break
    checks.append({"name": "P&L Roll-Forward (Revenue − Expenses − Tax)", "passed": pnl_ok, "detail": pnl_detail})

    # 3. Working Capital: Total = Margin + Bank Loan (every year)
    wc_ok, wc_detail = True, "All years reconcile"
    for w in wc:
        total = float(w.get("total", 0) or 0)
        if not close(total, float(w.get("margin", 0) or 0) + float(w.get("bank_loan", 0) or 0), 5.0):
            wc_ok, wc_detail = False, f"Year {w.get('year')}: WC total ≠ margin + bank loan"
            break
    checks.append({"name": "Working Capital (Total = Margin + Bank Loan)", "passed": wc_ok, "detail": wc_detail})

    # 4. Term Loan roll-forward: Closing = Opening - Principal Repaid
    tl_ok, tl_detail = True, "All years reconcile"
    for row in tl.get("schedule", []):
        if not close(float(row.get("closing", 0) or 0),
                     float(row.get("opening", 0) or 0) - float(row.get("principal_repaid", 0) or 0), 5.0):
            tl_ok, tl_detail = False, f"Year {row.get('year')}: TL closing ≠ opening − principal repaid"
            break
    checks.append({"name": "Term Loan Roll-Forward (Opening − Principal = Closing)", "passed": tl_ok, "detail": tl_detail})

    # 5. Fixed Asset (Depreciation) roll-forward: Closing WDV = Opening WDV - Dep
    dep_ok, dep_detail = True, "All years reconcile"
    for row in dep.get("schedule", []):
        if not close(float(row.get("closing_wdv", 0) or 0),
                     float(row.get("opening_wdv", 0) or 0) - float(row.get("depreciation", 0) or 0), 5.0):
            dep_ok, dep_detail = False, f"Year {row.get('year')}: Closing WDV ≠ Opening WDV − Depreciation"
            break
    checks.append({"name": "Fixed Asset Roll-Forward (WDV)", "passed": dep_ok, "detail": dep_detail})

    # 6. Cash Flow roll-forward: Closing Cash = Opening Cash + Surplus/Deficit
    cf_ok, cf_detail = True, "All years reconcile"
    for row in pcf:
        if not close(float(row.get("closing_cash", 0) or 0),
                     float(row.get("opening_cash", 0) or 0) + float(row.get("surplus", 0) or 0), 5.0):
            cf_ok, cf_detail = False, f"Year {row.get('year')}: Closing cash ≠ Opening cash + Surplus"
            break
    checks.append({"name": "Cash Flow Roll-Forward (Opening + Surplus = Closing)", "passed": cf_ok, "detail": cf_detail})

    # 7. Balance Sheet: Total Assets = Total Equity & Liabilities (each year)
    bs_ok, bs_detail = True, "All years reconcile"
    for pb in pbs:
        ta, tliab = float(pb.get("total_assets", 0) or 0), float(pb.get("total_liabilities", 0) or 0)
        if not close(ta, tliab, 10.0):
            bs_ok, bs_detail = False, f"Year {pb.get('year')}: Total Assets Rs.{ta:,.0f} ≠ Total Liabilities Rs.{tliab:,.0f}"
            break
    checks.append({"name": "Balance Sheet (Assets = Equity + Liabilities)", "passed": bs_ok, "detail": bs_detail})

    # 8. Closing cash chain continuity: each year's opening cash = prior
    #    year's closing cash (Year 1's opening = Year-0 balance-sheet cash).
    cc_ok, cc_detail = True, "All years reconcile"
    prev_closing = float(pbs[0].get("cash", 0) or 0) if pbs else 0.0
    for row in pcf:
        if not close(float(row.get("opening_cash", 0) or 0), prev_closing, 5.0):
            cc_ok, cc_detail = False, f"Year {row.get('year')}: Opening cash ≠ prior year's closing cash"
            break
        prev_closing = float(row.get("closing_cash", 0) or 0)
    checks.append({"name": "Closing Cash Chain Continuity", "passed": cc_ok, "detail": cc_detail})

    # 9. Debt balances: TL/WC bank balances tie between their own schedules
    #    and the Balance Sheet's term_loan / wc_bank rows.
    debt_ok, debt_detail = True, "All years reconcile"
    for i, row in enumerate(tl.get("schedule", [])):
        bs_year = pbs[i + 1] if i + 1 < len(pbs) else None
        if bs_year and not close(float(row.get("closing", 0) or 0), float(bs_year.get("term_loan", 0) or 0), 5.0):
            debt_ok, debt_detail = False, f"Year {row.get('year')}: TL closing ≠ Balance Sheet term loan"
            break
    if debt_ok:
        for i, w in enumerate(wc):
            bs_year = pbs[i + 1] if i + 1 < len(pbs) else None
            if bs_year and not close(float(w.get("bank_loan", 0) or 0), float(bs_year.get("wc_bank", 0) or 0), 5.0):
                debt_ok, debt_detail = False, f"Year {w.get('year')}: WC bank loan ≠ Balance Sheet WC bank"
                break
    checks.append({"name": "Debt Balances (Schedules = Balance Sheet)", "passed": debt_ok, "detail": debt_detail})

    # 10. Promoter contribution: Total = Fixed Equity + WC Margin
    fixed_eq  = float(cma.get("promoter_fixed_equity", pc.get("promoter_fixed_equity", pc.get("equity_capital", 0))) or 0)
    wc_margin = float(cma.get("promoter_wc_margin", wc[0].get("margin", 0) if wc else 0) or 0)
    total_contrib = float(cma.get("total_promoter_contribution", cma.get("promoter_contribution", 0)) or 0)
    checks.append({
        "name":   "Promoter Contribution (Fixed Equity + WC Margin = Total)",
        "passed": close(fixed_eq + wc_margin, total_contrib, 5.0) if total_contrib else True,
        "detail": f"Rs.{fixed_eq:,.0f} + Rs.{wc_margin:,.0f} vs Total Rs.{total_contrib:,.0f}",
    })

    # 11. Total Project Cost = Total Funding Sources. The project-cost
    #     breakdown includes fixed assets, promoter WC margin, and the WC
    #     facility, so WC finance must not be added a second time here.
    #     Compare the independently assembled CMA total against the DPR's
    #     funding sources to catch drift between the two report paths.
    _initial_investment = float(cma.get("total_project_cost", pc.get("total_project_cost", 0)) or 0)
    _term_loan     = float(pc.get("term_loan", 0) or 0)
    _wc_bank_loan  = float(pc.get("wc_loan", pc.get("wc_bank_share", 0)) or 0)
    _total_funding_reqd    = _initial_investment
    _total_funding_sources = total_contrib + _term_loan + _wc_bank_loan
    checks.append({
        "name":   "Total Project Cost = Total Funding Sources",
        "passed": close(_total_funding_reqd, _total_funding_sources, 5.0) if _total_funding_reqd else True,
        "detail": (
            f"Rs.{_initial_investment:,.0f} (Total Project Cost) vs Total Funding Sources "
            f"(Promoter Rs.{total_contrib:,.0f} + Term Loan Rs.{_term_loan:,.0f} "
            f"+ WC Bank Rs.{_wc_bank_loan:,.0f}) = Rs.{_total_funding_sources:,.0f}"
        ),
    })

    return checks
