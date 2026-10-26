"""
CA-grade unit tests for all financial calculation modules.

Run:  python -m pytest backend/tests/test_calculations.py -v
      (from project root) or:
      cd backend && python -m pytest tests/test_calculations.py -v
"""
import sys, os, math, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from core.engine import DEFAULT_CAPACITY_SCHEDULE, INDUSTRY_DEFAULTS, R, calc_emi, dscr_label, recommendation


# ─────────────────────────────────────────────────────────────────────────────
# Helpers & fixtures
# ─────────────────────────────────────────────────────────────────────────────

def _make_assumptions(**kwargs):
    d = {
        "interest_rate_pct": 10.5,
        "tenure_months": 60,
        "moratorium_months": 0,
        "revenue_growth_pct": 7.0,
        "expense_growth_pct": 5.0,
        "salary_increase_pct": 10.0,
        "tax_rate_pct": 25.0,
        "depreciation_pct": 10.0,
        "building_dep_rate_pct": 5.0,
        "capacity_y1_pct": 60.0,
        "capacity_y2_pct": 75.0,
        "capacity_y3_pct": 95.0,
        "capacity_y4_pct": 100.0,
        "capacity_y5_pct": 100.0,
        "stock_holding_days": 30,
        "debtor_days": 30,
        "creditor_days": 15,
        "wip_days": 15,
        "fg_days": 30,
        "wc_loan_pct": 60.0,
    }
    d.update(kwargs)
    obj = types.SimpleNamespace(**d)
    return obj


def _make_production(**kwargs):
    d = {
        "input_qty_per_day": 100,
        "output_yield_pct": 100,
        "working_days_per_year": 300,
        "selling_price_per_unit": 500,
        "raw_material_cost_per_unit": 200,
    }
    d.update(kwargs)
    return types.SimpleNamespace(**d)


def _make_project(**kwargs):
    d = {
        "building_cost": 500000,
        "land_cost": 0,
        "preliminary_expenses": 50000,
        "tools_installation": 20000,
        "machinery_items": [
            types.SimpleNamespace(quantity=2, unit_price=300000),
        ],
    }
    d.update(kwargs)
    return types.SimpleNamespace(**d)


def _make_business(industry="manufacturing"):
    return types.SimpleNamespace(industry_type=industry)


def _make_data(industry="manufacturing", **overrides):
    assum = overrides.pop("assumptions", _make_assumptions())
    prod  = overrides.pop("production", _make_production())
    proj  = overrides.pop("project", _make_project())
    biz   = overrides.pop("business", _make_business(industry))
    manpower = overrides.pop("manpower", types.SimpleNamespace(
        skilled_count=2, skilled_salary=15000,
        semi_skilled_count=3, semi_skilled_salary=10000,
        unskilled_count=2, unskilled_salary=7000,
    ))
    expenses = overrides.pop("expenses", types.SimpleNamespace(
        raw_materials=0, electricity_water=5000, repair_maintenance=2000,
        transport_conveyance=3000, telephone_internet=1000,
        stationery=500, miscellaneous=1000, marketing=0,
        rent=0, monthly_rent=0,
    ))
    return types.SimpleNamespace(
        assumptions=assum, production=prod, project=proj,
        business=biz, manpower=manpower, expenses=expenses,
        **overrides,
    )


SCHEME_PMEGP = {
    "scheme": "pmegp",
    "term_loan": 1800000,
    "wc_loan": 120000,
    "promoter_amount": 200000,
    "promoter_pct": 10.0,
    "project_cost": 2000000,
    "margin_money": 0,
    "margin_money_pct": 0,
    "dscr_benchmark": 1.25,
}


# ─────────────────────────────────────────────────────────────────────────────
# 1. Loan Amortization
# ─────────────────────────────────────────────────────────────────────────────

class TestLoanSchedule:
    def test_returns_5_rows(self):
        from calculations.loan_schedule import calculate_loan_schedule
        data = _make_data()
        rows = calculate_loan_schedule(data, SCHEME_PMEGP)
        assert len(rows) == 5

    def test_principal_sums_to_term_loan(self):
        from calculations.loan_schedule import calculate_loan_schedule
        data = _make_data()
        rows = calculate_loan_schedule(data, SCHEME_PMEGP)
        tl = SCHEME_PMEGP["term_loan"]
        total_principal = sum(r["principal_paid"] for r in rows)
        assert abs(total_principal - tl) < 2, (
            f"Principal sum {total_principal} ≠ term loan {tl}"
        )

    def test_closing_balance_reaches_zero(self):
        from calculations.loan_schedule import calculate_loan_schedule
        data = _make_data()
        rows = calculate_loan_schedule(data, SCHEME_PMEGP)
        assert rows[-1]["closing_balance"] < 1  # last row closes out

    def test_opening_equals_previous_closing(self):
        from calculations.loan_schedule import calculate_loan_schedule
        data = _make_data()
        rows = calculate_loan_schedule(data, SCHEME_PMEGP)
        for i in range(1, len(rows)):
            prev_closing = rows[i-1]["closing_balance"]
            curr_opening = rows[i]["opening_balance"]
            assert abs(prev_closing - curr_opening) < 1, (
                f"Year {i+1}: opening {curr_opening} ≠ prev closing {prev_closing}"
            )

    def test_tenure_3_years_shows_only_3_active_rows(self):
        from calculations.loan_schedule import calculate_loan_schedule
        data = _make_data(assumptions=_make_assumptions(tenure_months=36))
        rows = calculate_loan_schedule(data, SCHEME_PMEGP)
        # rows 4 and 5 should be zeroes (padded)
        assert rows[3]["principal_paid"] == 0
        assert rows[4]["principal_paid"] == 0

    def test_half_yearly_instalment_is_moratorium_aware(self):
        # BUG FIX: pdf/generator.py and main.py each independently recomputed
        # half_yearly_instalment as term_loan/(tenure_years*2), ignoring
        # moratorium entirely — disagreeing with this function's own schedule
        # rows whenever moratorium > 0. Both callers now read the value off
        # these rows instead of recomputing it. Pin the correct math here:
        # instalment must be spread over the REPAYMENT years only.
        from calculations.loan_schedule import calculate_loan_schedule
        data = _make_data(assumptions=_make_assumptions(
            tenure_months=60, moratorium_months=12, interest_rate_pct=10.5,
        ))
        rows = calculate_loan_schedule(data, {"term_loan": 283830})
        tenure_years, moratorium_years = 5, 1
        repay_years = tenure_years - moratorium_years
        # Instalment is rounded to the nearest whole RUPEE (not paisa) — every
        # per-period principal figure displayed in the report is a whole
        # rupee, so the value actually repaid each period must match what's
        # shown, not a paisa-precise figure that displays differently.
        expected_wrong  = float(round(283830 / (tenure_years * 2)))   # the bug's formula
        expected_correct = float(round(283830 / (repay_years * 2)))
        assert rows[0]["half_yearly_instalment"] == expected_correct
        assert rows[0]["half_yearly_instalment"] != expected_wrong
        # And it must actually match the schedule's own principal repayments.
        assert rows[1]["principal_paid"] == R(expected_correct * 2, 2)

    def test_six_month_moratorium_is_not_rounded_up_to_a_full_year(self):
        """BUG FIX: moratorium used to be converted via math.ceil(months/12),
        so a 6-month moratorium was silently DOUBLED to a full 12-month
        moratorium — while the report kept displaying "Moratorium: 6
        Month(s)" everywhere, contradicting the schedule actually computed.
        A 6-month moratorium must skip principal for exactly the first
        half-year, not the first full year."""
        from calculations.loan_schedule import calculate_loan_schedule
        data = _make_data(assumptions=_make_assumptions(
            tenure_months=60, moratorium_months=6, interest_rate_pct=11.0,
        ))
        rows = calculate_loan_schedule(data, {"term_loan": 365438})
        # Repayment spans 5 years x 2 half-years, minus 1 half-year of
        # moratorium = 9 half-yearly instalments (NOT 8, which would be the
        # old bug's answer for a wrongly-doubled 12-month moratorium).
        # Rounded to the nearest whole rupee, not paisa — see comment on
        # test_half_yearly_instalment_is_moratorium_aware above.
        expected_half_inst = float(round(365438 / 9))
        assert rows[0]["half_yearly_instalment"] == expected_half_inst
        # Year 1 must show exactly ONE half-year of repayment (H2), not zero.
        assert rows[0]["principal_paid"] == R(expected_half_inst, 2)
        assert rows[0]["principal_paid"] > 0
        # Years 2-5 each get two full half-yearly instalments.
        assert rows[1]["principal_paid"] == R(expected_half_inst * 2, 2)
        # The loan must fully amortise to EXACTLY zero — the final
        # instalment absorbs whatever whole-rupee residual the other 8
        # periods' rounding left, same as a bank's own amortisation
        # schedule adjusts its last instalment, instead of leaving a
        # (previously silent) residual balance.
        assert rows[4]["closing_balance"] == 0

    def test_effective_moratorium_exposed_when_input_is_not_a_multiple_of_six(self):
        """BUG FIX: a moratorium not entered as a multiple of 6 months (e.g.
        9 months) rounds to the nearest half-year (here, 2 half-years = 12
        months) since the schedule can only skip whole half-yearly
        instalments — but the report kept displaying the raw, now-
        inaccurate 9-month request next to a schedule whose Year 1 shows a
        full 12 months of zero principal repaid. calculate_loan_schedule
        must expose what was ACTUALLY applied so the report can display
        that instead — the same class of bug as the earlier scheme-
        mandated-moratorium-override fix, just for a non-multiple-of-6
        input this time."""
        from calculations.loan_schedule import calculate_loan_schedule
        data = _make_data(assumptions=_make_assumptions(
            tenure_months=72, moratorium_months=9, interest_rate_pct=11.0,
        ))
        rows = calculate_loan_schedule(data, {"term_loan": 900000})
        # round(9/6) = round(1.5) = 2 half-years = 12 months (not 9).
        assert rows[0]["moratorium_months_effective"] == 12
        # Year 1 (both half-years) must show zero principal repaid, matching
        # the 12-month effective moratorium, not a partial 9-month one.
        assert rows[0]["principal_paid"] == 0

    def test_displayed_principal_instalments_sum_exactly_to_the_loan_amount(self):
        """BUG FIX: a CA reviewer caught this on a live report — loan
        Rs.31,64,125 over 13 half-yearly instalments displayed as "Rs.
        2,43,394" (the exact value, 2,43,394.23, truncated for display).
        Manually cross-checking 2,43,394 + 6x4,86,788 (the displayed
        per-year figures) gives Rs.31,64,122 — three rupees short of the
        loan, because paisa-precision instalments don't sum to a round
        number once every row is independently rounded for display.
        The schedule must be computed in whole rupees from the start (the
        unit everything is actually displayed in), with the final period
        absorbing the residual, so the displayed figures always foot
        exactly to the loan amount — no reader-visible gap."""
        from calculations.loan_schedule import calculate_loan_schedule
        data = _make_data(assumptions=_make_assumptions(
            tenure_months=84, moratorium_months=6, interest_rate_pct=10.5,
        ))
        rows = calculate_loan_schedule(data, {"term_loan": 3164125})
        assert rows[0]["half_yearly_instalment"] == 243394
        assert sum(row["principal_paid"] for row in rows) == 3164125
        assert rows[-1]["closing_balance"] == 0

    def test_mid_year_balance_correct_in_moratorium_transition_year(self):
        """BUG FIX: in a year that transitions out of moratorium mid-year
        (H1 still moratorium, H2 repaying — the case a 6-month moratorium
        always produces in Year 1), the balance does NOT move during H1, so
        the true mid-year balance equals the opening balance, NOT the
        arithmetic mean of opening and closing (which pdf/generator.py used
        to compute and would have understated it)."""
        from calculations.loan_schedule import calculate_loan_schedule
        data = _make_data(assumptions=_make_assumptions(
            tenure_months=60, moratorium_months=6, interest_rate_pct=11.0,
        ))
        rows = calculate_loan_schedule(data, {"term_loan": 365438})
        y1 = rows[0]
        assert y1["mid_year_balance"] == y1["opening_balance"]
        naive_average = R((y1["opening_balance"] + y1["closing_balance"]) / 2, 2)
        assert y1["mid_year_balance"] != naive_average
        # H1 accrues interest on the untouched opening balance; H2 accrues
        # on that same balance too (still unmoved going into H2).
        assert y1["interest_h1"] == R(y1["opening_balance"] * 0.11 / 2, 2)
        assert y1["interest_h2"] == R(y1["mid_year_balance"] * 0.11 / 2, 2)


# ─────────────────────────────────────────────────────────────────────────────
# 2. Depreciation
# ─────────────────────────────────────────────────────────────────────────────

class TestDepreciation:
    def test_annual_dep_is_positive(self):
        from calculations.depreciation import calculate_depreciation
        data = _make_data()
        dep = calculate_depreciation(data, SCHEME_PMEGP)
        assert dep["annual_dep"] > 0

    def test_wdv_label_consistency(self):
        from calculations.depreciation import calculate_depreciation
        data = _make_data()
        dep = calculate_depreciation(data, SCHEME_PMEGP)
        # WDV: Year-1 building + machinery depreciation = annual_dep
        assert abs(dep["dep_building_wdv"] + dep["dep_machinery_wdv"] - dep["annual_dep"]) < 1
        assert dep["method"] == "WDV"

    def test_gross_block_equals_building_plus_pm(self):
        from calculations.depreciation import calculate_depreciation
        data = _make_data()
        dep = calculate_depreciation(data, SCHEME_PMEGP)
        expected_gross = dep["building_gross"] + dep["pm_with_contingency"]
        assert abs(dep["gross_block"] - expected_gross) < 1

    def test_year1_opening_wdv_is_reused_and_depreciation_uses_live_rates(self):
        from calculations.depreciation import calculate_depreciation
        data = _make_data()
        dep = calculate_depreciation(data, SCHEME_PMEGP)
        schedule = dep["schedule"]
        assert len(schedule) == 5
        assert [row["opening_wdv"] for row in schedule] == [schedule[0]["opening_wdv"]] * 5
        for row in schedule:
            assert row["building_depreciation"] == R(
                row["building_opening_wdv"] * data.assumptions.building_dep_rate_pct / 100
            )
            assert row["machinery_depreciation"] == R(
                row["machinery_opening_wdv"] * data.assumptions.depreciation_pct / 100
            )
            assert row["depreciation"] == R(
                row["building_depreciation"] + row["machinery_depreciation"]
            )

    def test_wdv_accumulated_depreciation_and_net_block_reconcile_each_year(self):
        from calculations.depreciation import calculate_depreciation

        dep = calculate_depreciation(_make_data(), SCHEME_PMEGP)
        schedule = dep["schedule"]
        accumulated = 0
        for row in schedule:
            accumulated += row["depreciation"]
            assert row["accumulated_depreciation"] == accumulated
            assert row["closing_wdv"] == dep["gross_block"] - accumulated
            assert row["closing_wdv"] == R(
                row["building_closing_wdv"] + row["machinery_closing_wdv"]
            )

    def test_wdv_never_goes_negative(self):
        from calculations.depreciation import calculate_depreciation
        data = _make_data()
        dep = calculate_depreciation(data, SCHEME_PMEGP)
        for row in dep["schedule"]:
            assert row["closing_wdv"] >= 0
            assert row["building_closing_wdv"] >= 0
            assert row["machinery_closing_wdv"] >= 0

    def test_wdv_5year_schedule_pinned_fixture_matches_frontend(self):
        """Pins the EXACT same fixture as src/lib/wdvDepreciation.test.ts's
        rounding-regression test, so backend and frontend can never silently
        drift apart again. Building=600000, machinery=1,200,000+80,000
        installation, fixtures=125,000, contingency=5%, rates 10%/5%."""
        from calculations.depreciation import calculate_depreciation
        data = _make_data(project=types.SimpleNamespace(
            building_cost=600000, land_cost=0, preliminary_expenses=0,
            tools_installation=80000,
            machinery_items=[
                types.SimpleNamespace(quantity=1, unit_price=900000),
                types.SimpleNamespace(quantity=1, unit_price=300000),
            ],
            computers_cost=30000, furniture_cost=20000, electrification_cost=50000,
            racks_storage_cost=25000, transportation_cost=0,
        ), assumptions=_make_assumptions(contingency_pct=5, depreciation_pct=10, building_dep_rate_pct=5))
        dep = calculate_depreciation(data, SCHEME_PMEGP)
        assert dep["gross_block"] == 2069000
        expected = [
            {"bld": 30000, "mach": 146900, "closing": 1892100},
            {"bld": 30000, "mach": 146900, "closing": 1715200},
            {"bld": 30000, "mach": 146900, "closing": 1538300},
            {"bld": 30000, "mach": 146900, "closing": 1361400},
            {"bld": 30000, "mach": 146900, "closing": 1184500},
        ]
        for i, exp in enumerate(expected):
            row = dep["schedule"][i]
            assert row["opening_wdv"] == dep["gross_block"]
            assert row["building_depreciation"] == exp["bld"], f"Year {i+1} building dep"
            assert row["machinery_depreciation"] == exp["mach"], f"Year {i+1} machinery dep"
            assert row["closing_wdv"] == exp["closing"], f"Year {i+1} closing WDV"


# ─────────────────────────────────────────────────────────────────────────────
# 3. Working Capital
# ─────────────────────────────────────────────────────────────────────────────

class TestWorkingCapital:
    def test_returns_5_years(self):
        from calculations.working_capital import calculate_wc_by_year
        data = _make_data()
        wc = calculate_wc_by_year(data, SCHEME_PMEGP)
        assert len(wc) == 5

    def test_wc_interest_uses_11_5_percent_when_rate_is_missing_or_null(self):
        from calculations.working_capital import calculate_wc_by_year
        from core.financial_defaults import DEFAULT_WC_INTEREST_RATE_PCT

        for assumptions in (
            _make_assumptions(),
            _make_assumptions(wc_interest_rate_pct=None),
        ):
            wc = calculate_wc_by_year(
                _make_data(assumptions=assumptions), SCHEME_PMEGP
            )
            assert wc[0]["wc_interest"] == pytest.approx(
                wc[0]["bank_loan"] * DEFAULT_WC_INTEREST_RATE_PCT / 100
            )

    def test_wc_interest_preserves_custom_rate(self):
        from calculations.working_capital import calculate_wc_by_year

        wc = calculate_wc_by_year(
            _make_data(assumptions=_make_assumptions(wc_interest_rate_pct=13.25)),
            SCHEME_PMEGP,
        )
        assert wc[0]["wc_interest"] == pytest.approx(wc[0]["bank_loan"] * 0.1325)

    def test_creditor_days_reduce_wc(self):
        from calculations.working_capital import calculate_wc_by_year
        data_no_cred  = _make_data(assumptions=_make_assumptions(creditor_days=0))
        data_with_cred = _make_data(assumptions=_make_assumptions(creditor_days=30))
        wc_no  = calculate_wc_by_year(data_no_cred,   SCHEME_PMEGP)
        wc_yes = calculate_wc_by_year(data_with_cred, SCHEME_PMEGP)
        assert wc_yes[0]["total"] < wc_no[0]["total"], (
            "Positive creditor_days must reduce total WC requirement"
        )

    def test_service_business_has_no_stock(self):
        from calculations.working_capital import calculate_wc_by_year
        data = _make_data(industry="service")
        wc = calculate_wc_by_year(data, SCHEME_PMEGP)
        for yr in wc:
            assert yr["rm_stock"] == 0, "Service: RM stock must be 0"
            assert yr["wip"] == 0,     "Service: WIP must be 0"
            assert yr["fg"] == 0,      "Service: FG must be 0"

    def test_trading_has_no_wip(self):
        from calculations.working_capital import calculate_wc_by_year
        data = _make_data(industry="trading")
        wc = calculate_wc_by_year(data, SCHEME_PMEGP)
        for yr in wc:
            assert yr["wip"] == 0, f"Trading: WIP must be 0 (got {yr['wip']} in Year {yr['year']})"

    def test_total_equals_components_minus_creditors(self):
        from calculations.working_capital import calculate_wc_by_year
        data = _make_data()
        wc = calculate_wc_by_year(data, SCHEME_PMEGP)
        for yr in wc:
            expected = max(yr["rm_stock"] + yr["wip"] + yr["fg"] + yr["debtors"] - yr["creditors"], 0)
            assert abs(yr["total"] - expected) < 1, (
                f"Year {yr['year']}: WC total {yr['total']} ≠ components {expected}"
            )

    def test_year1_bank_loan_sets_facility_and_is_reused_in_each_year(self):
        from calculations.working_capital import calculate_wc_by_year
        from core.financial_defaults import DEFAULT_WC_INTEREST_RATE_PCT
        data = _make_data()
        wc = calculate_wc_by_year(data, SCHEME_PMEGP)
        year1_bank_loan = wc[0]["total"]
        assert wc[0]["bank_loan"] == year1_bank_loan
        for yr in wc:
            assert yr["bank_loan"] == year1_bank_loan
            assert yr["wc_interest"] == pytest.approx(
                year1_bank_loan * DEFAULT_WC_INTEREST_RATE_PCT / 100
            )

    def test_default_method_is_simple_margin(self):
        from calculations.working_capital import calculate_wc_by_year
        data = _make_data()
        wc = calculate_wc_by_year(data, SCHEME_PMEGP)
        for yr in wc:
            assert yr["wc_finance_method"] == "simple_margin"

    def test_drawing_power_never_exceeds_total_wc(self):
        from calculations.working_capital import calculate_wc_by_year
        data = _make_data(assumptions=_make_assumptions(
            wc_finance_method="drawing_power", wc_margin_pct=25.0,
        ))
        wc = calculate_wc_by_year(data, SCHEME_PMEGP)
        assert wc[0]["bank_loan"] <= wc[0]["total"] + 1
        assert all(yr["bank_loan"] == wc[0]["bank_loan"] for yr in wc)

    def test_drawing_power_matches_formula_exactly(self):
        from calculations.working_capital import calculate_wc_by_year
        data = _make_data(assumptions=_make_assumptions(
            wc_finance_method="drawing_power", wc_margin_pct=25.0,
        ))
        wc = calculate_wc_by_year(data, SCHEME_PMEGP)
        for yr in wc:
            margin = 0.25
            dp = max(
                (yr["rm_stock"] + yr["wip"] + yr["fg"]) * (1 - margin)
                + yr["debtors"] * (1 - margin)
                - yr["creditors"],
                0,
            )
            expected_bank_loan = min(dp, yr["total"])
            if yr["year"] == 1:
                assert abs(yr["bank_loan"] - expected_bank_loan) < 1, (
                    f"Year {yr['year']}: bank_loan {yr['bank_loan']} != DP formula {expected_bank_loan}"
                )
            else:
                assert yr["bank_loan"] == wc[0]["bank_loan"]

    def test_higher_margin_pct_reduces_drawing_power(self):
        from calculations.working_capital import calculate_wc_by_year
        data_low  = _make_data(assumptions=_make_assumptions(wc_finance_method="drawing_power", wc_margin_pct=10.0))
        data_high = _make_data(assumptions=_make_assumptions(wc_finance_method="drawing_power", wc_margin_pct=40.0))
        wc_low  = calculate_wc_by_year(data_low,  SCHEME_PMEGP)
        wc_high = calculate_wc_by_year(data_high, SCHEME_PMEGP)
        for lo, hi in zip(wc_low, wc_high):
            assert hi["bank_loan"] <= lo["bank_loan"], (
                "A higher bank margin % must never increase Drawing Power"
            )

    def test_drawing_power_and_simple_margin_can_genuinely_differ(self):
        """Prove the two methods aren't coincidentally producing the same
        number — with a real creditor balance, DP and simple-margin should
        diverge for the same underlying WC requirement."""
        from calculations.working_capital import calculate_wc_by_year
        data_simple = _make_data(assumptions=_make_assumptions(
            wc_finance_method="simple_margin", wc_loan_pct=60.0, creditor_days=30,
        ))
        data_dp = _make_data(assumptions=_make_assumptions(
            wc_finance_method="drawing_power", wc_margin_pct=25.0, creditor_days=30,
        ))
        wc_simple = calculate_wc_by_year(data_simple, SCHEME_PMEGP)
        wc_dp     = calculate_wc_by_year(data_dp,     SCHEME_PMEGP)
        assert any(
            abs(s["bank_loan"] - d["bank_loan"]) > 1
            for s, d in zip(wc_simple, wc_dp)
        ), "Simple Margin and Drawing Power should generally produce different bank finance"

    def test_trading_wc_uses_products_list_cogs_not_industry_default(self):
        """BUG FIX: _compute_rm_at_100pct in working_capital.py was missing
        the "product table COGS" priority that calculations/income_statement.py
        has, so a trading business describing COGS via an itemized products
        list (purchase_price x units_per_month — the normal way to enter it)
        fell through to the industry-default COGS ratio (70% for trading)
        instead of the applicant's own purchase costs. That gave Stock/
        Creditors a different, disagreeing COGS basis than the P&L, which
        computes COGS from the same products list correctly.

        Fixture: 1 product, 800 units/month @ purchase_price 180, monthly
        revenue Rs.240,000, capacity_y1 60% (fixture default), stock 30 days.
        Correct: rm_at_100pct = (800*180*12)/0.5 = Rs.3,456,000; Year-1 RM =
        3,456,000*0.5 = Rs.1,728,000; Stock (30/360) = Rs.144,000.
        The old bug's answer (rev-based, 70% ratio) would have been Rs.168,000.
        """
        from calculations.working_capital import calculate_wc_by_year
        products = [types.SimpleNamespace(
            units_per_month=800, purchase_price=180, avg_price=300,
            monthly_revenue=240000, category="Hardware Tools",
        )]
        data = _make_data(
            industry="trading",
            production=_make_production(input_qty_per_day=0, raw_material_cost_per_unit=0),
            expenses=types.SimpleNamespace(
                raw_materials=0, electricity_water=0, repair_maintenance=0,
                transport_conveyance=0, telephone_internet=0, stationery=0,
                miscellaneous=0, marketing=0, rent=0, monthly_rent=0,
            ),
            products=products,
        )
        wc = calculate_wc_by_year(data, SCHEME_PMEGP)
        assert abs(wc[0]["rm_stock"] - 144000) < 1, (
            f"Year 1 stock must be based on the products list's own purchase "
            f"cost (Rs.144,000), got {wc[0]['rm_stock']}"
        )
        assert abs(wc[0]["rm_stock"] - 168000) > 1, (
            "Year 1 stock must NOT match the old industry-default-ratio bug's answer (Rs.168,000)"
        )


# ─────────────────────────────────────────────────────────────────────────────
# 4. Income Statement
# ─────────────────────────────────────────────────────────────────────────────

class TestCapacityScheduleDefaults:
    def test_all_industries_share_the_five_year_capacity_schedule(self):
        expected = (0.60, 0.75, 0.95, 1.00, 1.00)
        assert DEFAULT_CAPACITY_SCHEDULE == expected
        assert all(tuple(defaults["capacity_schedule"]) == expected for defaults in INDUSTRY_DEFAULTS.values())

    def test_service_product_quantity_and_price_drive_constant_baseline_and_sales(self):
        from calculations.depreciation import calculate_depreciation
        from calculations.income_statement import calculate_income_statement
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from models.input_schema import ProductItem

        product = ProductItem(category="Consulting", units_per_month=5, avg_price=1000)
        assumptions = _make_assumptions(
            capacity_y1_pct=0, capacity_y2_pct=0, capacity_y3_pct=0,
            capacity_y4_pct=0, capacity_y5_pct=0,
        )
        data = _make_data(
            industry="service",
            production=_make_production(input_qty_per_day=0, selling_price_per_unit=0),
            assumptions=assumptions,
            products=[product],
        )
        dep = calculate_depreciation(data, SCHEME_PMEGP)
        loan = calculate_loan_schedule(data, SCHEME_PMEGP)
        working_capital = calculate_wc_by_year(data, SCHEME_PMEGP)
        income = calculate_income_statement(data, SCHEME_PMEGP, dep, loan, working_capital)

        baseline_revenue = 100_000
        assert product.monthly_revenue == 5_000
        assert [row["capacity"] for row in income] == list(DEFAULT_CAPACITY_SCHEDULE)
        for index, capacity in enumerate(DEFAULT_CAPACITY_SCHEDULE):
            expected_revenue = baseline_revenue * capacity
            assert income[index]["revenue"] == pytest.approx(expected_revenue)
            assert income[index]["revenue"] / capacity == pytest.approx(baseline_revenue)
            assert working_capital[index]["debtors"] == pytest.approx(expected_revenue * 30 / 360, abs=1)

    def test_legacy_master_report_applies_capacity_to_sales_wc_and_cash_flow(self):
        from main import MasterInput, master_calculate_for_industry

        current = MasterInput(industry="service", scheme="normal_msme")
        legacy = MasterInput(
            industry="service", scheme="normal_msme",
            capacity_y1=0.50, capacity_y2=0.60, capacity_y3=0.70,
            capacity_y4=0.75, capacity_y5=0.80,
        )
        current_report = master_calculate_for_industry(current, "service")
        legacy_report = master_calculate_for_industry(legacy, "service")
        current_dpr = current_report["dpr"]
        legacy_dpr = legacy_report["dpr"]

        current_year_two = current_dpr["profit_and_loss_years"][1]
        legacy_year_two = legacy_dpr["profit_and_loss_years"][1]
        assert [row["capacity"] for row in current_dpr["profit_and_loss_years"]] == list(DEFAULT_CAPACITY_SCHEDULE)
        assert current_year_two["revenue"] != legacy_year_two["revenue"]
        assert current_dpr["working_capital_years"][1]["total"] != legacy_dpr["working_capital_years"][1]["total"]
        assert current_dpr["cash_flow_years"][1]["closing_cash"] != legacy_dpr["cash_flow_years"][1]["closing_cash"]
        for income, break_even in zip(
            current_dpr["profit_and_loss_years"],
            current_dpr["breakeven_years"],
        ):
            expected_operating_fixed = R(
                income["depreciation"] + income["wc_interest"] + income["tl_interest"],
                2,
            )
            assert break_even["operating_fixed_expenses"] == expected_operating_fixed
            assert break_even["net_profit"] == R(
                break_even["contribution"] - expected_operating_fixed,
                2,
            )

    def test_master_pmegp_report_preserves_entered_financing_amounts(self):
        from main import MasterInput, master_calculate_for_industry

        report = master_calculate_for_industry(
            MasterInput(
                industry="service",
                scheme="PMEGP",
                loan_type="Composite",
                term_loan_amount=610_000,
                working_capital_loan=42_000,
                term_loan_amount_override=610_000,
                working_capital_loan_override=42_000,
                margin_money_override=95_000,
                promoter_contribution_override=250_000,
                promoter_contribution=250_000,
                social_category="General",
                area_type="Urban",
            ),
            "service",
        )

        cma = report["cma"]
        project_cost = report["dpr"]["project_cost"]
        assert cma["term_loan"] == 610_000
        assert cma["working_capital_loan"] == 42_000
        assert cma["margin_money"] == 95_000
        assert cma["promoter_contribution"] == 250_000
        assert project_cost["total_project_cost"] == 902_000
        assert any("scheme-based amount" in warning for warning in report["meta"]["warnings"])

class TestIncomeStatement:
    def _get_income(self, **assum_kwargs):
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.income_statement import calculate_income_statement
        data = _make_data(assumptions=_make_assumptions(**assum_kwargs))
        dep = calculate_depreciation(data, SCHEME_PMEGP)
        loan = calculate_loan_schedule(data, SCHEME_PMEGP)
        wc = calculate_wc_by_year(data, SCHEME_PMEGP)
        return calculate_income_statement(data, SCHEME_PMEGP, dep, loan, wc)

    def test_returns_5_years(self):
        income = self._get_income()
        assert len(income) == 5

    def test_default_capacity_schedule_scales_revenue_costs_and_working_capital(self):
        from calculations.depreciation import calculate_depreciation
        from calculations.income_statement import calculate_income_statement
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year

        assumptions = _make_assumptions(
            capacity_y1_pct=0, capacity_y2_pct=0, capacity_y3_pct=0,
            capacity_y4_pct=0, capacity_y5_pct=0,
        )
        data = _make_data(assumptions=assumptions)
        dep = calculate_depreciation(data, SCHEME_PMEGP)
        loan = calculate_loan_schedule(data, SCHEME_PMEGP)
        working_capital = calculate_wc_by_year(data, SCHEME_PMEGP)
        income = calculate_income_statement(data, SCHEME_PMEGP, dep, loan, working_capital)

        annual_revenue_at_full_capacity = 100 * 300 * 500
        annual_raw_materials_at_full_capacity = 100 * 300 * 200
        for index, capacity in enumerate(DEFAULT_CAPACITY_SCHEDULE):
            expected_revenue = annual_revenue_at_full_capacity * capacity
            expected_raw_materials = annual_raw_materials_at_full_capacity * capacity * 1.05**index
            assert income[index]["capacity"] == capacity
            assert income[index]["revenue"] == pytest.approx(expected_revenue)
            assert income[index]["raw_materials"] == pytest.approx(expected_raw_materials)
            assert working_capital[index]["rm_stock"] == pytest.approx(
                expected_raw_materials * 30 / 360, abs=1,
            )
            assert working_capital[index]["wip"] == pytest.approx(
                expected_raw_materials * 15 / 360, abs=1,
            )
            assert working_capital[index]["fg"] == pytest.approx(
                expected_raw_materials * 30 / 360, abs=1,
            )
            assert working_capital[index]["creditors"] == pytest.approx(
                expected_raw_materials * 15 / 360, abs=1,
            )
            assert working_capital[index]["debtors"] == pytest.approx(
                expected_revenue * 30 / 360,
            )
            assert income[index]["cash_accruals"] == pytest.approx(
                income[index]["pat"] + income[index]["depreciation"],
            )

    def test_pbt_minus_tax_equals_pat(self):
        income = self._get_income()
        for yr in income:
            expected_pat = yr["profit_before_tax"] - yr["tax"]
            assert abs(yr["pat"] - expected_pat) < 1, (
                f"Year {yr['year']}: PAT {yr['pat']} ≠ PBT {yr['profit_before_tax']} - tax {yr['tax']}"
            )

    def test_tax_non_negative(self):
        income = self._get_income()
        for yr in income:
            assert yr["tax"] >= 0, f"Year {yr['year']}: Tax must be >= 0"

    def test_cash_accruals_equals_pat_plus_dep(self):
        income = self._get_income()
        for yr in income:
            expected = yr["pat"] + yr["depreciation"]
            assert abs(yr["cash_accruals"] - expected) < 1, (
                f"Year {yr['year']}: cash_accruals {yr['cash_accruals']} ≠ PAT+Dep {expected}"
            )

    def test_net_surplus_equals_cash_accruals_minus_principal(self):
        # BUG FIX: "net_surplus" was PAT - full TL Service (principal +
        # interest) — interest is already deducted once inside PAT, so
        # subtracting it again double-counted it, understating the true
        # cash position. CA rule (matches Section O2's "Net Cash Surplus"):
        # Cash Accruals (PAT + Dep) less TL Principal only.
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.income_statement import calculate_income_statement
        data = _make_data()
        dep  = calculate_depreciation(data, SCHEME_PMEGP)
        loan = calculate_loan_schedule(data, SCHEME_PMEGP)
        wc   = calculate_wc_by_year(data, SCHEME_PMEGP)
        income = calculate_income_statement(data, SCHEME_PMEGP, dep, loan, wc)
        for i, yr in enumerate(income):
            principal_paid = loan[i]["principal_paid"]
            interest_paid  = loan[i]["interest_paid"]
            expected = round(yr["cash_accruals"] - principal_paid, 2)
            assert abs(yr["net_surplus"] - expected) < 2, (
                f"Year {yr['year']}: net_surplus {yr['net_surplus']} != "
                f"cash_accruals - principal {expected}"
            )
            old_buggy = round(yr["pat"] - yr["emi_paid"], 2)  # PAT - (principal+interest)
            if interest_paid > 1:
                assert abs(yr["net_surplus"] - old_buggy) > 1, (
                    f"Year {yr['year']}: net_surplus must differ from the old double-counted "
                    "PAT - TL Service formula when TL interest is nonzero"
                )

    def test_cgtmse_guarantee_fee_is_actually_charged(self):
        """BUG FIX: schemes/cgtmse.py computes a real Annual Guarantee Fee
        and its own docstring says it "MUST be added to annual operating
        expenses" — but calculate_income_statement() accepted scheme_data
        as a parameter and never once read it, so the fee was silently
        dropped, overstating EBITDA/PAT/cash accruals/DSCR for every
        CGTMSE report. It must now show up as its own fixed expense,
        declining each year with the amortising loan balance (same base as
        interest), and must actually reduce EBITDA."""
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.income_statement import calculate_income_statement
        data = _make_data()
        cgtmse_scheme = {**SCHEME_PMEGP, "cgtmse_agf_pct": 1.0}  # 1% p.a. on outstanding
        dep  = calculate_depreciation(data, cgtmse_scheme)
        loan = calculate_loan_schedule(data, cgtmse_scheme)
        wc   = calculate_wc_by_year(data, cgtmse_scheme)
        income_with_fee = calculate_income_statement(data, cgtmse_scheme, dep, loan, wc)
        income_without_fee = calculate_income_statement(data, SCHEME_PMEGP, dep, loan, wc)
        for i, yr in enumerate(income_with_fee):
            expected_fee = round(loan[i]["opening_balance"] * 1.0 / 100, 2)
            assert abs(yr["cgtmse_fee"] - expected_fee) < 1, (
                f"Year {yr['year']}: cgtmse_fee {yr['cgtmse_fee']} != 1% of opening balance {expected_fee}"
            )
            if expected_fee > 0:
                assert yr["cgtmse_fee"] > 0
                # The fee must actually reduce EBITDA relative to an
                # otherwise-identical report with no CGTMSE fee.
                assert yr["ebitda"] < income_without_fee[i]["ebitda"]
        # Fee must decline year over year as the loan amortises (never flat).
        fees = [yr["cgtmse_fee"] for yr in income_with_fee if yr["cgtmse_fee"] > 0]
        assert fees == sorted(fees, reverse=True), "CGTMSE fee must decline as the loan amortises"

    def test_no_cgtmse_fee_when_scheme_is_not_cgtmse(self):
        income = self._get_income()
        for yr in income:
            assert yr.get("cgtmse_fee", 0) == 0

    def test_revenue_increases_with_growth(self):
        income = self._get_income(revenue_growth_pct=7.0)
        for i in range(1, 4):  # Years 2-4 (not 5 because cap schedule ends)
            assert income[i]["revenue"] >= income[i-1]["revenue"], (
                f"Year {income[i]['year']}: revenue should not decrease with positive growth"
            )

    def test_zero_drawings_by_default_matches_full_retention(self):
        """Default promoter_drawings_pct=0 -> reserves grow by exactly PAT
        each year (no silent change to the pre-existing behaviour)."""
        income = self._get_income()
        cumulative = 0.0
        for yr in income:
            cumulative += yr["pat"]
            assert abs(yr["reserves_surplus"] - cumulative) < 1

    def test_drawings_reduce_reserves_but_not_cash_accruals(self):
        """CA rule: Closing Reserves = Opening + PAT - Drawings. Drawings
        come out AFTER cash accruals are measured (DSCR must not see them)."""
        no_draw = self._get_income(promoter_drawings_pct=0.0)
        with_draw = self._get_income(promoter_drawings_pct=50.0)
        for a, b in zip(no_draw, with_draw):
            # cash_accruals (PAT+Dep) is a pre-drawings, operations-only figure —
            # must be identical regardless of the drawings assumption.
            assert abs(a["cash_accruals"] - b["cash_accruals"]) < 1
            # PAT itself is also unaffected (drawings aren't a P&L expense).
            assert abs(a["pat"] - b["pat"]) < 1
        # But reserves (net worth) must genuinely be lower with drawings,
        # in a profitable year.
        for a, b in zip(no_draw, with_draw):
            if a["pat"] > 0:
                assert b["reserves_surplus"] < a["reserves_surplus"]

    def test_drawings_never_apply_to_a_loss_year(self):
        """Can't draw against a loss — drawings = max(PAT, 0) x pct."""
        income = self._get_income(promoter_drawings_pct=100.0)
        for yr in income:
            if yr["pat"] < 0:
                assert yr["drawings"] == 0

    def test_full_drawings_of_100pct_pat_freezes_reserves(self):
        """100% drawings on every profitable year -> reserves should never
        exceed the highest single year's contribution (nothing compounds)."""
        income = self._get_income(promoter_drawings_pct=100.0)
        for yr in income:
            expected_reserves_delta = max(yr["pat"], 0) - yr["drawings"]
            assert abs(expected_reserves_delta) < 1  # drawings ~= pat when pat > 0

    def test_monthly_annual_cogs_reconcile(self):
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.income_statement import calculate_income_statement
        from calculations.monthly_pnl import calculate_monthly_pnl
        data = _make_data()
        dep  = calculate_depreciation(data, SCHEME_PMEGP)
        loan = calculate_loan_schedule(data, SCHEME_PMEGP)
        wc   = calculate_wc_by_year(data, SCHEME_PMEGP)
        income  = calculate_income_statement(data, SCHEME_PMEGP, dep, loan, wc)
        monthly = calculate_monthly_pnl(data, SCHEME_PMEGP, dep, loan, wc)
        # Monthly COGS × 12 should equal annual COGS (Year 1, same capacity)
        annual_cogs   = income[0]["cogs"]
        monthly_cogs12 = monthly["cogs_monthly"] * 12
        assert abs(annual_cogs - monthly_cogs12) < 100, (
            f"Monthly COGS×12 {monthly_cogs12} ≠ Annual COGS {annual_cogs} (gap > Rs.100)"
        )

    def test_emi_is_year1_actual_tl_service_not_flat_emi_formula(self):
        # BUG FIX: "emi" (displayed in the PDF as "Monthly TL Service") used
        # calc_emi() — the standard monthly-compounding EMI formula applied to
        # the full loan/tenure — which ignored moratorium entirely and matched
        # no real year's actual TL service. It must now equal Year-1's actual
        # interest+principal off the real half-yearly schedule, so during a
        # moratorium year (principal=0) it is interest-only, not a phantom EMI.
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.monthly_pnl import calculate_monthly_pnl
        data = _make_data(assumptions=_make_assumptions(
            tenure_months=60, moratorium_months=12, interest_rate_pct=10.5,
        ))
        scheme = {**SCHEME_PMEGP, "term_loan": 283830}
        dep  = calculate_depreciation(data, scheme)
        loan = calculate_loan_schedule(data, scheme)
        wc   = calculate_wc_by_year(data, scheme)
        monthly = calculate_monthly_pnl(data, scheme, dep, loan, wc)
        # emi = rounded monthly interest + rounded monthly principal, matching
        # how monthly_int/monthly_principal are already rounded elsewhere in
        # this same function (R()'s default is whole-rupee rounding).
        expected = R(R(loan[0]["interest_paid"] / 12) + R(loan[0]["principal_paid"] / 12), 2)
        assert monthly["emi"] == expected
        # Year 1 is a moratorium year: no principal, so emi is interest-only —
        # nowhere near the old flat-EMI formula's answer for this fixture.
        old_wrong = R(calc_emi(283830, 10.5, 60), 2)
        assert abs(monthly["emi"] - old_wrong) > 1000


# ─────────────────────────────────────────────────────────────────────────────
# 5. DSCR
# ─────────────────────────────────────────────────────────────────────────────

class TestDSCR:
    def _get_dscr(self):
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.income_statement import calculate_income_statement
        from calculations.dscr import calculate_dscr
        data = _make_data()
        dep  = calculate_depreciation(data, SCHEME_PMEGP)
        loan = calculate_loan_schedule(data, SCHEME_PMEGP)
        wc   = calculate_wc_by_year(data, SCHEME_PMEGP)
        income = calculate_income_statement(data, SCHEME_PMEGP, dep, loan, wc)
        return calculate_dscr(income, loan, SCHEME_PMEGP)

    def test_dscr_y1_positive(self):
        dscr = self._get_dscr()
        assert dscr["dscr_y1"] > 0

    def test_avg_dscr_is_mean_of_years(self):
        dscr = self._get_dscr()
        active = [r["dscr"] for r in dscr["years"] if r.get("total_b", 0) > 0]
        expected_avg = R(sum(active) / len(active), 2) if active else 0
        assert abs(dscr["average"] - expected_avg) < 0.01

    def test_numerator_includes_tl_interest_not_wc(self):
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.income_statement import calculate_income_statement
        from calculations.dscr import calculate_dscr
        data = _make_data()
        dep  = calculate_depreciation(data, SCHEME_PMEGP)
        loan = calculate_loan_schedule(data, SCHEME_PMEGP)
        wc   = calculate_wc_by_year(data, SCHEME_PMEGP)
        income = calculate_income_statement(data, SCHEME_PMEGP, dep, loan, wc)
        dscr   = calculate_dscr(income, loan, SCHEME_PMEGP)
        yr1 = dscr["years"][0]
        expected_total_a = yr1["cash_accruals"] + yr1["tl_interest"]
        assert abs(yr1["total_a"] - expected_total_a) < 1


# ─────────────────────────────────────────────────────────────────────────────
# 6. Break-Even
# ─────────────────────────────────────────────────────────────────────────────

class TestBreakEven:
    def _get_bep(self, data=None):
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.income_statement import calculate_income_statement
        from calculations.break_even import calculate_break_even
        data = data or _make_data()
        dep  = calculate_depreciation(data, SCHEME_PMEGP)
        loan = calculate_loan_schedule(data, SCHEME_PMEGP)
        wc   = calculate_wc_by_year(data, SCHEME_PMEGP)
        income = calculate_income_statement(data, SCHEME_PMEGP, dep, loan, wc)
        return calculate_break_even(income, data, SCHEME_PMEGP)

    def test_returns_5_years(self):
        bep = self._get_bep()
        assert len(bep) == 5

    def test_bep_formula_correct(self):
        bep = self._get_bep()
        for yr in bep:
            if yr["contribution_pct"] > 0:
                expected_bep = yr["fixed_expenses"] / yr["contribution_pct"]
                assert abs(yr["bep_sales"] - expected_bep) < 10, (
                    f"Year {yr['year']}: BEP sales formula mismatch"
                )

    def test_contribution_equals_revenue_minus_variable(self):
        bep = self._get_bep()
        for yr in bep:
            expected = yr["revenue"] - yr["variable_expenses"]
            assert abs(yr["contribution"] - expected) < 1

    def test_variable_expenses_and_bep_metrics_match_section_j_for_all_years(self):
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.income_statement import calculate_income_statement
        from calculations.break_even import calculate_break_even

        data = _make_data()
        dep = calculate_depreciation(data, SCHEME_PMEGP)
        loan = calculate_loan_schedule(data, SCHEME_PMEGP)
        wc = calculate_wc_by_year(data, SCHEME_PMEGP)
        income = calculate_income_statement(data, SCHEME_PMEGP, dep, loan, wc)
        bep = calculate_break_even(income, data, SCHEME_PMEGP)

        assert len(bep) == len(income) == 5
        for pnl, row in zip(income, bep):
            expected_variable = R(
                pnl["raw_materials"] + pnl["power"] + pnl["labour"]
                + pnl["admin_expenses"] + pnl["marketing_expenses"]
            )
            assert row["variable_expenses"] == expected_variable

            expected_contribution = R(pnl["revenue"] - expected_variable)
            expected_margin = R(expected_contribution / pnl["revenue"], 4) if pnl["revenue"] else 0
            remaining_fixed = R(pnl["fixed_expenses"] - pnl["labour"] - pnl["admin_expenses"])
            expected_operating_fixed = R(
                pnl["depreciation"] + pnl["wc_interest"] + pnl["tl_interest"]
            )
            expected_net_profit = R(expected_contribution - expected_operating_fixed)
            expected_financial_fixed = R(remaining_fixed + expected_operating_fixed)
            expected_operating_bep = R(expected_operating_fixed / expected_margin) if expected_margin > 0 else 0
            expected_financial_bep = R(expected_financial_fixed / expected_margin) if expected_margin > 0 else 0
            annual_revenue_at_capacity = pnl["revenue"] / pnl["capacity"] if pnl["capacity"] else 0

            assert row["contribution"] == expected_contribution
            assert row["contribution_pct"] == expected_margin
            assert row["operating_fixed_expenses"] == expected_operating_fixed
            assert row["net_profit"] == expected_net_profit
            assert row["fixed_expenses"] == expected_financial_fixed
            assert row["operating_bep_sales"] == expected_operating_bep
            assert row["bep_sales"] == expected_financial_bep
            if expected_operating_bep and annual_revenue_at_capacity:
                assert row["operating_bep_pct"] == R(expected_operating_bep / annual_revenue_at_capacity, 4)
            if expected_financial_bep and annual_revenue_at_capacity:
                assert row["bep_pct"] == R(expected_financial_bep / annual_revenue_at_capacity, 4)

    def test_variable_expenses_and_dependent_metrics_respond_to_changed_inputs(self):
        baseline = self._get_bep()
        changed_data = _make_data(
            manpower=types.SimpleNamespace(
                skilled_count=5, skilled_salary=25000,
                semi_skilled_count=4, semi_skilled_salary=18000,
                unskilled_count=3, unskilled_salary=12000,
            ),
            expenses=types.SimpleNamespace(
                raw_materials=0, electricity_water=12000, repair_maintenance=6000,
                transport_conveyance=8000, telephone_internet=3000,
                stationery=1500, miscellaneous=2500, marketing=18000,
                rent=35000, monthly_rent=35000,
            ),
        )
        changed = self._get_bep(changed_data)

        assert changed[0]["variable_expenses"] != baseline[0]["variable_expenses"]
        assert changed[0]["contribution"] != baseline[0]["contribution"]
        assert changed[0]["contribution_pct"] != baseline[0]["contribution_pct"]
        assert changed[0]["operating_bep_sales"] != baseline[0]["operating_bep_sales"]
        assert changed[0]["bep_sales"] != baseline[0]["bep_sales"]

    def test_zero_revenue_and_capacity_remain_safe(self):
        from calculations.break_even import calculate_break_even

        data = _make_data()
        row = calculate_break_even(
            [{
                "year": 1, "revenue": 0, "capacity": 0, "raw_materials": 0,
                "power": 0, "labour": 0, "admin_expenses": 0,
                "marketing_expenses": 0, "fixed_expenses": 0,
                "depreciation": 0, "interest": 0,
            }],
            data,
            SCHEME_PMEGP,
        )[0]
        assert row["contribution_pct"] == 0
        assert row["operating_bep_sales"] == 0
        assert row["operating_bep_pct"] == 0
        assert row["bep_sales"] == 0
        assert row["bep_pct"] == 0
        assert row["operating_bep_not_achievable"]
        assert row["bep_not_achievable"]

    def test_bep_pct_of_capacity_nonzero_for_products_list_based_business(self):
        """BUG FIX: "BEP as % of Capacity" used annual_revenue_from_prod(),
        which derives 100%-capacity revenue from production.input_qty_per_day
        / selling_price_per_unit — manufacturing-only fields. A trading (or
        any) business whose revenue instead comes from the top-level products
        list has both fields at 0, so that call returned 0 and bep_pct was
        always None -> displayed as a flat 0.0% every year, regardless of the
        actual break-even point. Each year's own revenue / capacity already
        reconstructs the correct 100%-capacity figure (same technique
        pdf/builder.py's "Revenue at 100%" row uses) without needing those
        production fields at all."""
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.income_statement import calculate_income_statement
        from calculations.break_even import calculate_break_even
        products = [types.SimpleNamespace(
            units_per_month=800, purchase_price=180, avg_price=300,
            monthly_revenue=240000, category="Hardware Tools",
        )]
        data = _make_data(
            industry="trading",
            production=_make_production(input_qty_per_day=0, raw_material_cost_per_unit=0, selling_price_per_unit=0),
            expenses=types.SimpleNamespace(
                raw_materials=0, electricity_water=0, repair_maintenance=0,
                transport_conveyance=0, telephone_internet=0, stationery=0,
                miscellaneous=0, marketing=0, rent=0, monthly_rent=0,
            ),
            products=products,
        )
        dep    = calculate_depreciation(data, SCHEME_PMEGP)
        loan   = calculate_loan_schedule(data, SCHEME_PMEGP)
        wc     = calculate_wc_by_year(data, SCHEME_PMEGP)
        income = calculate_income_statement(data, SCHEME_PMEGP, dep, loan, wc)
        bep    = calculate_break_even(income, data, SCHEME_PMEGP)
        assert bep[0]["contribution_pct"] > 0, "fixture must have a positive contribution margin"
        assert bep[0]["bep_pct"] > 0, (
            "BEP as % of Capacity must not be 0 when the business has a real "
            "products-list-based 100%-capacity revenue and a positive contribution margin"
        )


# ─────────────────────────────────────────────────────────────────────────────
# 7. ROI Consistency
# ─────────────────────────────────────────────────────────────────────────────

class TestROI:
    def test_roi_ebitda_formula(self):
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.monthly_pnl import calculate_monthly_pnl
        data = _make_data()
        dep  = calculate_depreciation(data, SCHEME_PMEGP)
        loan = calculate_loan_schedule(data, SCHEME_PMEGP)
        wc   = calculate_wc_by_year(data, SCHEME_PMEGP)
        monthly = calculate_monthly_pnl(data, SCHEME_PMEGP, dep, loan, wc)
        tpc = float(SCHEME_PMEGP.get("project_cost", 1))
        expected_roi = R(monthly["annual_ebitda"] / tpc * 100, 2)
        assert abs(monthly["roi_ebitda_pct"] - expected_roi) < 0.1, (
            f"ROI EBITDA {monthly['roi_ebitda_pct']} ≠ expected {expected_roi}"
        )

    def test_roi_pat_formula(self):
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.monthly_pnl import calculate_monthly_pnl
        data = _make_data()
        dep  = calculate_depreciation(data, SCHEME_PMEGP)
        loan = calculate_loan_schedule(data, SCHEME_PMEGP)
        wc   = calculate_wc_by_year(data, SCHEME_PMEGP)
        monthly = calculate_monthly_pnl(data, SCHEME_PMEGP, dep, loan, wc)
        tpc = float(SCHEME_PMEGP.get("project_cost", 1))
        expected_roi = R(monthly["annual_pat"] / tpc * 100, 2)
        assert abs(monthly["roi_pat_pct"] - expected_roi) < 0.1


# ─────────────────────────────────────────────────────────────────────────────
# 8. Balance Sheet
# ─────────────────────────────────────────────────────────────────────────────

class TestBalanceSheet:
    def _get_bs(self):
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.income_statement import calculate_income_statement
        from calculations.balance_sheet import calculate_balance_sheet
        data = _make_data()
        dep  = calculate_depreciation(data, SCHEME_PMEGP)
        loan = calculate_loan_schedule(data, SCHEME_PMEGP)
        wc   = calculate_wc_by_year(data, SCHEME_PMEGP)
        income = calculate_income_statement(data, SCHEME_PMEGP, dep, loan, wc)
        return calculate_balance_sheet(data, SCHEME_PMEGP, income, dep, loan, wc)

    def test_balance_sheet_balances(self):
        bs = self._get_bs()
        for row in bs:
            diff = row.get("check", 999)
            assert abs(diff) < 2, (
                f"Year {row['year']}: BS out of balance by Rs.{diff:,.0f}"
            )

    def test_returns_6_rows_year0_to_year5(self):
        bs = self._get_bs()
        assert len(bs) == 6
        assert bs[0]["year"] == 0
        assert bs[-1]["year"] == 5

    def test_net_block_decreases_with_depreciation(self):
        bs = self._get_bs()
        for i in range(1, len(bs) - 1):
            assert bs[i+1]["net_block"] <= bs[i]["net_block"] + 1, (
                f"Net block should decrease Year {bs[i]['year']} → Year {bs[i+1]['year']}"
            )

    def test_year0_needs_no_phantom_short_term_funding(self):
        # BUG FIX: Year 0's "Short-Term Funding Gap" was showing a large phantom
        # liability (Rs.879,145 in the real report this was found on) purely
        # from a formula bug, not any real shortfall — the initial financing
        # structure (promoter equity + term loan + promoter WC margin + WC bank
        # loan) fully funds the initial assets (fixed + WC) by construction.
        # Root causes: (1) other_assets used total "project_cost" (which nets in
        # only the promoter's WC margin) instead of "fixed_project_cost", and
        # then subtracted the FULL WC requirement again — double-counting WC and
        # dropping preliminary/fixture costs from assets; (2) the promoter's WC
        # margin was never added to the liabilities side even though it funds
        # part of current_assets.
        import types
        from calculations.balance_sheet import calculate_balance_sheet
        scheme_data = {
            "term_loan": 283830, "wc_loan": 398205, "promoter_amount": 189220,
            "margin_money": 0, "project_cost": 1402195, "fixed_project_cost": 473050,
        }
        dep = {"gross_block": 423050, "annual_dep": 27305}
        loan_schedule = [{"closing_balance": 283830}] * 5
        wc_schedule = [{"total": 1327350, "bank_loan": 398205, "margin": 929145}] * 5
        income = [{"year": i + 1, "depreciation": 27305, "reserves_surplus": 0} for i in range(5)]
        data = types.SimpleNamespace(project=types.SimpleNamespace(land_cost=0))

        bs = calculate_balance_sheet(data, scheme_data, income, dep, loan_schedule, wc_schedule)
        assert bs[0]["short_term_funding"] == 0
        assert bs[0]["other_assets"] == 50000  # preliminary/fixture costs, no longer dropped
        assert bs[0]["promoter_wc_margin"] == 929145
        assert bs[0]["check"] == 0  # still balances

    @pytest.mark.parametrize("year1_bank_borrowing", [125000, 7864200])
    def test_projected_wc_borrowing_uses_year1_value_for_all_years(self, year1_bank_borrowing):
        import types
        from calculations.balance_sheet import calculate_balance_sheet

        scheme_data = {
            "term_loan": 900000, "wc_loan": year1_bank_borrowing, "promoter_amount": 500000,
            "margin_money": 0, "project_cost": 1800000, "fixed_project_cost": 1300000,
        }
        dep = {"gross_block": 1200000, "annual_dep": 100000}
        loan_schedule = [
            {"closing_balance": balance}
            for balance in (800000, 600000, 400000, 200000, 0)
        ]
        wc_schedule = [
            {"total": total, "bank_loan": bank, "margin": 0}
            for total, bank in (
                (300000, year1_bank_borrowing),
                (400000, year1_bank_borrowing + 100000),
                (500000, year1_bank_borrowing + 200000),
                (600000, year1_bank_borrowing + 300000),
                (700000, year1_bank_borrowing + 400000),
            )
        ]
        income = [
            {"year": year, "depreciation": 100000, "reserves_surplus": 50000 * year}
            for year in range(1, 6)
        ]
        data = types.SimpleNamespace(project=types.SimpleNamespace(land_cost=0))

        bs = calculate_balance_sheet(data, scheme_data, income, dep, loan_schedule, wc_schedule)

        assert [row["wc_bank"] for row in bs] == [year1_bank_borrowing] * 6
        for row in bs:
            assert row["check"] == 0
            assert row["total_assets"] == row["total_liabilities"]

    def test_funding_shortfall_shows_as_negative_cash_not_a_fake_liability(self):
        # BUG FIX: a genuine cash shortfall used to be hidden by clamping
        # cash to zero and adding a "Short-Term Funding" LIABILITY for the
        # difference — a facility the report itself disclosed elsewhere as
        # "not arranged", which is self-contradictory (an unarranged
        # facility is not a liability). Cash must now go negative instead,
        # and total_liabilities must NOT include the shortfall at all.
        import types
        from calculations.balance_sheet import calculate_balance_sheet
        scheme_data = {
            "term_loan": 283830, "wc_loan": 398205, "promoter_amount": 189220,
            "margin_money": 0, "project_cost": 1402195, "fixed_project_cost": 473050,
        }
        dep = {"gross_block": 423050, "annual_dep": 27305}
        loan_schedule = [{"closing_balance": 283830}] * 5
        wc_schedule = [{"total": 1327350, "bank_loan": 398205, "margin": 929145}] * 5
        # Deep Year-1 loss with no offsetting reserves — a real, unfunded shortfall.
        income = [{"year": 1, "depreciation": 27305, "reserves_surplus": -1614519}]
        data = types.SimpleNamespace(project=types.SimpleNamespace(land_cost=0))

        bs = calculate_balance_sheet(data, scheme_data, income, dep, loan_schedule, wc_schedule)
        row = bs[1]  # Year 1
        assert row["cash"] < 0, "a genuine shortfall must show as negative cash"
        assert row["short_term_funding"] == abs(row["cash"])  # informational only
        base_equity_liabilities = (
            row["equity"] + row["margin_money"] + row["reserves"] + row["term_loan"]
            + row["wc_bank"] + row["promoter_wc_margin"]
        )
        assert row["total_liabilities"] == round(base_equity_liabilities, 2), (
            "total_liabilities must equal arranged equity+liabilities only — "
            "the shortfall must NOT be added on top as a fake liability"
        )
        assert row["check"] == 0  # still balances, via negative cash


# ─────────────────────────────────────────────────────────────────────────────
# 8b. Cash Flow ↔ Balance Sheet reconciliation
# ─────────────────────────────────────────────────────────────────────────────

class TestCashFlowReconciliation:
    """
    BUG FIX: the Cash Flow Statement (Section L) never accounted for the
    promoter's WC margin growing year over year (a real cash source, added to
    the balance sheet's liabilities in the fix above) — so "Surplus/Deficit"
    fell short of the balance sheet's own Closing Cash by exactly that amount,
    with no explanation. A cash flow statement's Sources minus Uses MUST equal
    the change in cash for that period — always, by definition. These tests
    pin that identity so it can never silently drift again.
    """

    def _get_bs_income_loan_wc(self, scheme_data=None):
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.income_statement import calculate_income_statement
        from calculations.balance_sheet import calculate_balance_sheet
        scheme_data = scheme_data or SCHEME_PMEGP
        data = _make_data()
        dep  = calculate_depreciation(data, scheme_data)
        loan = calculate_loan_schedule(data, scheme_data)
        wc   = calculate_wc_by_year(data, scheme_data)
        income = calculate_income_statement(data, scheme_data, dep, loan, wc)
        bs = calculate_balance_sheet(data, scheme_data, income, dep, loan, wc)
        return bs, income, loan, wc

    def test_profitable_scenario_reconciles_every_year(self):
        from pdf.generator import _build_cash_flow
        bs, income, loan, wc = self._get_bs_income_loan_wc()
        cf = _build_cash_flow(income, loan, wc, bs)
        for row in cf:
            implied_delta = round(row["closing_cash"] - row["opening_cash"], 2)
            assert abs(row["surplus"] - implied_delta) < 2, (
                f"Year {row['year']}: Surplus/Deficit ({row['surplus']}) must equal "
                f"Closing Cash - Opening Cash ({implied_delta})"
            )

    def test_loss_making_scenario_with_growing_wc_margin_reconciles(self):
        # Pinned regression: growing promoter_wc_margin (WC requirement rising
        # each year, per the user-reported fixture) is exactly the term the
        # old code dropped. Deep losses (negative reserves_surplus) exercise
        # the "Additional Short-Term Funding" path too.
        import types
        from calculations.balance_sheet import calculate_balance_sheet
        from pdf.generator import _build_cash_flow
        scheme_data = {
            "term_loan": 283830, "wc_loan": 398205, "promoter_amount": 189220,
            "margin_money": 0, "project_cost": 1402195, "fixed_project_cost": 473050,
        }
        dep = {"gross_block": 423050, "annual_dep": 27305}
        loan_schedule = [
            {"closing_balance": 283830, "principal_paid": 0},
            {"closing_balance": 212873, "principal_paid": 70957},
            {"closing_balance": 141915, "principal_paid": 70958},
            {"closing_balance": 70958,  "principal_paid": 70957},
            {"closing_balance": 0,      "principal_paid": 70958},
        ]
        wc_schedule = [
            {"total": 1327350, "bank_loan": 398205, "margin": 929145},
            {"total": 1491701, "bank_loan": 447510, "margin": 1044191},
            {"total": 1659569, "bank_loan": 497871, "margin": 1161698},
            {"total": 1772132, "bank_loan": 531640, "margin": 1240492},
            {"total": 1888785, "bank_loan": 566636, "margin": 1322149},
        ]
        reserves = [-1614519, -3255957, -4878524, -6447939, -7932755]
        cash_accruals = [-1587214, -1616113, -1599062, -1547584, -1464525]
        depreciation  = [27305, 25325, 23505, 21831, 20291]  # real WDV schedule (declining)
        income = [
            {"year": i + 1, "depreciation": depreciation[i], "reserves_surplus": reserves[i],
             "cash_accruals": cash_accruals[i], "drawings": 0}
            for i in range(5)
        ]
        data = types.SimpleNamespace(project=types.SimpleNamespace(land_cost=0))
        bs = calculate_balance_sheet(data, scheme_data, income, dep, loan_schedule, wc_schedule)
        cf = _build_cash_flow(income, loan_schedule, wc_schedule, bs)
        for row in cf:
            implied_delta = round(row["closing_cash"] - row["opening_cash"], 2)
            assert abs(row["surplus"] - implied_delta) < 2, (
                f"Year {row['year']}: Surplus/Deficit ({row['surplus']}) must equal "
                f"Closing Cash - Opening Cash ({implied_delta}) — "
                f"inc_wc_margin={row.get('inc_wc_margin')}"
            )
            # The old bug always understated surplus by inc_wc_margin, which is
            # non-zero here (margin genuinely grows) — assert we're not
            # accidentally back to the broken formula.
            if row.get("inc_wc_margin", 0):
                broken_surplus = round(row["surplus"] - row["inc_wc_margin"], 2)
                assert row["surplus"] != broken_surplus


# ─────────────────────────────────────────────────────────────────────────────
# 9. Sensitivity Analysis
# ─────────────────────────────────────────────────────────────────────────────

class TestSensitivity:
    def _get_sensitivity(self):
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.monthly_pnl import calculate_monthly_pnl
        from calculations.sensitivity import calculate_sensitivity
        data = _make_data()
        dep  = calculate_depreciation(data, SCHEME_PMEGP)
        loan = calculate_loan_schedule(data, SCHEME_PMEGP)
        wc   = calculate_wc_by_year(data, SCHEME_PMEGP)
        monthly = calculate_monthly_pnl(data, SCHEME_PMEGP, dep, loan, wc)
        return calculate_sensitivity(data, SCHEME_PMEGP, monthly), monthly

    def test_base_case_matches_live_model(self):
        sens, monthly = self._get_sensitivity()
        base = next(s for s in sens if s["scenario"] == "Base Case")
        assert abs(base["monthly_revenue"] - monthly["net_monthly_revenue"]) < 1, (
            "Sensitivity base case revenue must match live model"
        )

    def test_higher_revenue_gives_higher_profit(self):
        sens, _ = self._get_sensitivity()
        ordered = sorted(sens, key=lambda s: s["monthly_revenue"])
        for i in range(len(ordered) - 1):
            assert ordered[i]["monthly_profit"] <= ordered[i+1]["monthly_profit"] + 1, (
                "Higher revenue must give higher (or equal) profit in sensitivity"
            )

    def test_dscr_monotone_with_revenue(self):
        sens, _ = self._get_sensitivity()
        ordered = sorted(sens, key=lambda s: s["monthly_revenue"])
        for i in range(len(ordered) - 1):
            assert ordered[i]["dscr"] <= ordered[i+1]["dscr"] + 0.01, (
                "DSCR must be monotonically non-decreasing with revenue"
            )

    def test_dscr_uses_the_shared_term_loan_dscr_formula(self):
        """BUG FIX: sensitivity used to compute DSCR with TOTAL (TL+WC)
        interest, silently diverging from the main DSCR schedule's TL-only
        formula whenever WC interest was nonzero (a business with WC
        borrowing would show two different, unreconcilable DSCR figures for
        the same scenario). It must now call calculations/dscr.py's
        term_loan_dscr() with TL-only interest — the exact same formula
        function the main DSCR schedule uses."""
        from calculations.dscr import term_loan_dscr
        sens, monthly = self._get_sensitivity()
        assert float(monthly.get("monthly_wc_int", 0)) > 0, (
            "fixture must have nonzero WC interest for this test to be meaningful"
        )
        base = next(s for s in sens if s["scenario"] == "Base Case")
        monthly_tl_int = float(monthly.get("monthly_tl_int", monthly.get("monthly_int_y1", 0)))
        monthly_principal = float(monthly.get("monthly_principal", 0))
        cash_accruals = base["monthly_profit"] + float(monthly.get("monthly_dep", 0))
        _, _, expected_dscr = term_loan_dscr(cash_accruals, monthly_tl_int, monthly_principal)
        assert abs(base["dscr"] - expected_dscr) < 0.02, (
            f"Sensitivity DSCR {base['dscr']} must match term_loan_dscr() {expected_dscr} "
            "computed with TL-only interest"
        )


class TestSensitivityStructuralScenarios:
    """CA AUDIT: the original sensitivity suite only ever varied revenue. A
    bank-grade sensitivity analysis must also stress raw-material cost,
    salary, receivable days, and interest rate — each re-running the full
    engine on a mutated input — plus one combined downside scenario."""

    def _get_full_sensitivity(self):
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.income_statement import calculate_income_statement
        from calculations.monthly_pnl import calculate_monthly_pnl
        from calculations.sensitivity import calculate_sensitivity
        data = _make_data(assumptions=_make_assumptions(wc_loan_pct=60.0))
        dep    = calculate_depreciation(data, SCHEME_PMEGP)
        loan   = calculate_loan_schedule(data, SCHEME_PMEGP)
        wc     = calculate_wc_by_year(data, SCHEME_PMEGP)
        income = calculate_income_statement(data, SCHEME_PMEGP, dep, loan, wc)
        monthly = calculate_monthly_pnl(data, SCHEME_PMEGP, dep, loan, wc)
        return calculate_sensitivity(data, SCHEME_PMEGP, monthly, income, dep)

    def test_all_five_structural_scenarios_present(self):
        sens = self._get_full_sensitivity()
        names = {s["scenario"] for s in sens if s.get("type") == "structural"}
        assert names == {
            "Raw Material Cost +10%", "Salary Increase +10%",
            "Receivable Days +15", "Interest Rate +2.0pp", "Combined Downside",
        }

    def test_raw_material_increase_reduces_ebitda_only(self):
        sens = self._get_full_sensitivity()
        base = next(s for s in sens if s["scenario"] == "Base Case")
        rm   = next(s for s in sens if s["scenario"] == "Raw Material Cost +10%")
        assert rm["monthly_revenue"] == base["monthly_revenue"], "RM shock must not change revenue"
        assert rm["monthly_cogs"] > base["monthly_cogs"], "RM +10% must raise COGS"
        assert rm["monthly_ebitda"] < base["monthly_ebitda"], "RM +10% must reduce EBITDA"
        assert rm["monthly_profit"] < base["monthly_profit"], "RM +10% must reduce PAT"

    def test_salary_increase_reduces_ebitda_only(self):
        sens = self._get_full_sensitivity()
        base   = next(s for s in sens if s["scenario"] == "Base Case")
        salary = next(s for s in sens if s["scenario"] == "Salary Increase +10%")
        assert salary["monthly_revenue"] == base["monthly_revenue"], "Salary shock must not change revenue"
        assert salary["monthly_cogs"] == base["monthly_cogs"], "Salary shock must not change COGS"
        assert salary["monthly_ebitda"] < base["monthly_ebitda"], "Salary +10% must reduce EBITDA"

    def test_receivable_days_leaves_ebitda_unchanged_but_can_affect_pat(self):
        sens = self._get_full_sensitivity()
        base = next(s for s in sens if s["scenario"] == "Base Case")
        recv = next(s for s in sens if s["scenario"] == "Receivable Days +15")
        # Receivable days affect Working Capital / WC interest, not the P&L
        # revenue/COGS/EBITDA line itself.
        assert recv["monthly_revenue"] == base["monthly_revenue"]
        assert recv["monthly_ebitda"]  == base["monthly_ebitda"]
        assert recv["monthly_profit"] <= base["monthly_profit"] + 1, (
            "Higher receivable days must not IMPROVE profit (more WC interest, never less)"
        )

    def test_interest_rate_increase_reduces_pat_and_dscr_only(self):
        sens = self._get_full_sensitivity()
        base = next(s for s in sens if s["scenario"] == "Base Case")
        rate = next(s for s in sens if s["scenario"] == "Interest Rate +2.0pp")
        assert rate["monthly_revenue"] == base["monthly_revenue"]
        assert rate["monthly_ebitda"]  == base["monthly_ebitda"], "Interest rate must not affect EBITDA"
        assert rate["monthly_profit"] < base["monthly_profit"], "Higher rate must reduce PAT"
        assert rate["dscr"] <= base["dscr"] + 0.01, "Higher rate must not improve DSCR"

    def test_combined_downside_is_worse_than_any_single_lever(self):
        sens = self._get_full_sensitivity()
        combined = next(s for s in sens if s["scenario"] == "Combined Downside")
        singles  = [s for s in sens if s.get("type") == "structural" and s["scenario"] != "Combined Downside"]
        for single in singles:
            assert combined["monthly_profit"] <= single["monthly_profit"] + 1, (
                f"Combined Downside PAT ({combined['monthly_profit']}) must be worse than "
                f"{single['scenario']} alone ({single['monthly_profit']})"
            )

    def test_every_structural_row_is_internally_consistent(self):
        """BUG FIX: a structural scenario combined with a revenue shock
        (only "Combined Downside" today) used to leave monthly_cogs at its
        pre-revenue-shock value while EBITDA was computed from the
        correctly revenue-scaled COGS — so the displayed COGS cell
        contradicted the displayed EBITDA cell in the same row. Every row's
        own displayed figures must foot: Revenue - COGS - Other Variable -
        Marketing - Fixed = EBITDA."""
        sens = self._get_full_sensitivity()
        for s in sens:
            if s.get("type") != "structural":
                continue
            implied_ebitda = s["monthly_revenue"] - s["monthly_variable"] - s["monthly_fixed"]
            assert abs(implied_ebitda - s["monthly_ebitda"]) < 1, (
                f"{s['scenario']}: Revenue - Variable - Fixed ({implied_ebitda}) must equal "
                f"the displayed EBITDA ({s['monthly_ebitda']})"
            )


# ─────────────────────────────────────────────────────────────────────────────
# 10. Business Type Engine
# ─────────────────────────────────────────────────────────────────────────────

class TestBusinessTypeEngine:
    def test_service_zero_cogs_ratio(self):
        from core.engine import get_industry_defaults
        ind = get_industry_defaults("service")
        assert ind["stock_days"] == 0

    def test_trading_high_cogs_ratio(self):
        from core.engine import get_industry_defaults
        ind = get_industry_defaults("trading")
        assert ind["cogs_ratio"] >= 0.65

    def test_manufacturing_has_wip(self):
        from calculations.working_capital import calculate_wc_by_year
        data = _make_data(industry="manufacturing",
                          assumptions=_make_assumptions(wip_days=15))
        wc = calculate_wc_by_year(data, SCHEME_PMEGP)
        assert wc[0]["wip"] > 0, "Manufacturing: WIP must be > 0 when wip_days > 0"

    def test_income_statement_switches_by_industry(self):
        from calculations.depreciation import calculate_depreciation
        from calculations.loan_schedule import calculate_loan_schedule
        from calculations.working_capital import calculate_wc_by_year
        from calculations.income_statement import calculate_income_statement
        # Manufacturing: uses unit-cost production (high RM ratio)
        mfg_data = _make_data(industry="manufacturing")
        # Service: no production unit costs — falls back to industry default ratio (10% COGS)
        svc_prod = _make_production(
            input_qty_per_day=0,            # service: no units
            raw_material_cost_per_unit=0,
            selling_price_per_unit=1200000, # monthly revenue = Rs.12L
        )
        svc_data = _make_data(
            industry="service",
            production=svc_prod,
            expenses=types.SimpleNamespace(
                raw_materials=0, electricity_water=2000, repair_maintenance=0,
                transport_conveyance=0, telephone_internet=1000, stationery=500,
                miscellaneous=500, marketing=0, rent=10000, monthly_rent=10000,
            ),
        )
        dep  = calculate_depreciation(mfg_data, SCHEME_PMEGP)
        loan = calculate_loan_schedule(mfg_data, SCHEME_PMEGP)
        wc   = calculate_wc_by_year(mfg_data, SCHEME_PMEGP)
        mfg_income = calculate_income_statement(mfg_data, SCHEME_PMEGP, dep, loan, wc)

        dep2  = calculate_depreciation(svc_data, SCHEME_PMEGP)
        loan2 = calculate_loan_schedule(svc_data, SCHEME_PMEGP)
        wc2   = calculate_wc_by_year(svc_data, SCHEME_PMEGP)
        svc_income = calculate_income_statement(svc_data, SCHEME_PMEGP, dep2, loan2, wc2)
        # Service COGS ratio (10%) must be lower than manufacturing COGS ratio (55%)
        svc_cogs_pct = svc_income[0]["cogs"] / svc_income[0]["revenue"]
        mfg_cogs_pct = mfg_income[0]["cogs"] / mfg_income[0]["revenue"]
        assert svc_cogs_pct < mfg_cogs_pct, (
            f"Service COGS% {svc_cogs_pct:.2%} must be < Manufacturing COGS% {mfg_cogs_pct:.2%}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# 11. Engine helpers
# ─────────────────────────────────────────────────────────────────────────────

class TestEngineHelpers:
    def test_recommendation_no_strongly_approve(self):
        for score in [5.0, 6.5, 7.0, 8.5, 9.0, 10.0]:
            rec = recommendation(score)
            assert "STRONGLY" not in rec, (
                f"'STRONGLY APPROVE' must not appear in recommendation (score={score})"
            )

    def test_dscr_label_thresholds(self):
        assert dscr_label(2.0) == "Excellent"
        assert dscr_label(1.5) == "Very Good"
        assert dscr_label(1.25) == "Good"
        assert dscr_label(1.0) == "Acceptable"
        assert dscr_label(0.9) == "Poor"

    def test_R_rounds_correctly(self):
        assert R(1234.567, 0) == 1235
        assert R(1234.567, 2) == 1234.57
        assert R(0.0, 0) == 0.0

    def test_calc_emi_positive(self):
        emi = calc_emi(1000000, 10.5, 60)
        assert emi > 0
        # Total repayment should be more than principal (interest)
        assert emi * 60 > 1000000


# ─────────────────────────────────────────────────────────────────────────────
# PDF project cost items — must match the actual financed (contingency-loaded) basis
# ─────────────────────────────────────────────────────────────────────────────

class TestPdfProjectCostItems:
    def test_motor_equipment_label_preserves_initial_investment_amounts(self):
        from pdf.generator import _build_project_cost_items

        project = {
            "building_cost": 8_048_000,
            "machinery_items": [{"quantity": 1, "unit_price": 2_064_000}],
            "computers_cost": 500_000,
            "furniture_cost": 1_000_000,
            "transportation_cost": 1_000_000,
            "preliminary_expenses": 200_000,
        }
        items = _build_project_cost_items(
            project,
            [{"margin": 0, "bank_loan": 7_864_200}],
            machinery_gross=2_064_000,
        )
        motor_equipment = next(
            item for item in items
            if item["particulars"] == "Plant, Machinery & Equipment (Motor)"
        )
        total = sum(item["amount"] for item in items)

        assert motor_equipment["amount"] == 1_000_000
        assert total == 20_676_200
        assert round(motor_equipment["amount"] / total * 100, 1) == 4.8
        assert not any(item["particulars"] == "Vehicles & Transportation" for item in items)

    def test_machinery_line_uses_loaded_gross_not_raw_sum(self):
        # BUG FIX: the "Initial Project Investment" table's equipment line used
        # the raw machinery_items sum, while Means of Finance / Gross Block
        # elsewhere in the same PDF used the contingency-loaded figure — making
        # the headline investment total silently understate what's actually
        # being financed by the whole contingency amount. The items builder now
        # takes the loaded Gross Block figure and uses it when provided.
        from pdf.generator import _build_project_cost_items
        project = {
            "building_cost": 300000,
            "machinery_items": [
                {"quantity": 1, "unit_price": 18000},
                {"quantity": 1, "unit_price": 35000},
                {"quantity": 1, "unit_price": 12000},
                {"quantity": 1, "unit_price": 12000},
                {"quantity": 2, "unit_price": 15000},
            ],  # raw sum = 107,000
            "preliminary_expenses": 50000,
        }
        wc_sched = [{"margin": 929145}]
        loaded_gross = 123050  # 107,000 x 1.15 (15% contingency)

        items_without_loading = _build_project_cost_items(project, wc_sched, "service")
        items_with_loading    = _build_project_cost_items(project, wc_sched, "service", machinery_gross=loaded_gross)

        equip_raw   = next(i for i in items_without_loading if "Equipment" in i["particulars"])["amount"]
        equip_loaded = next(i for i in items_with_loading if "Equipment" in i["particulars"])["amount"]

        assert equip_raw == 107000
        assert equip_loaded == 123050
        total_with_loading = sum(i["amount"] for i in items_with_loading)
        assert total_with_loading == 300000 + 123050 + 50000 + 929145

    def test_generator_wires_pm_with_contingency_not_pre_contingency_machinery_gross(self):
        # BUG FIX (regression in the fix above): pdf/generator.py's real call
        # site passed dep["machinery_gross"], but depreciation.py documents
        # that field as explicitly PRE-contingency (used for Gross Block only
        # via "pm_with_contingency"). Passing the wrong key silently
        # reintroduced the exact bug this class exists to prevent — the items
        # sum stopped matching scheme_data["fixed_project_cost"] again.
        from models.input_schema import CMAReportInput, MachineryItem
        from schemes.router import route_scheme
        from calculations.depreciation import calculate_depreciation
        from pdf.generator import _build_project_cost_items

        inp = CMAReportInput()
        inp.business.industry_type = "service"
        inp.assumptions.contingency_pct = 15
        inp.project.building_cost = 300000
        inp.project.preliminary_expenses = 50000
        inp.project.machinery_items = [MachineryItem(name="Equip", quantity=1, unit_price=107000)]

        scheme_data = route_scheme(inp)
        dep = calculate_depreciation(inp, scheme_data)
        items = _build_project_cost_items(
            inp.project.model_dump(), [{"margin": 0}], "service",
            float(dep.get("pm_with_contingency", 0) or 0),
        )
        assert sum(i["amount"] for i in items) == scheme_data["fixed_project_cost"]


# ─────────────────────────────────────────────────────────────────────────────
# PDF Section O1 — itemized rows must foot to their own displayed totals
# ─────────────────────────────────────────────────────────────────────────────

class TestO1ExpenseBreakdown:
    def test_salary_residual_absorbs_pf_benefits_loading(self):
        # BUG FIX (pinned): income_statement.py loads Year-1 salary by
        # hr_perquisites_rate (10% default) when computing the authoritative
        # "fixed_total" that P1 sync writes into cma, but monthly_pnl.py's own
        # "fixed_salary" (raw, no loading) fed this table directly — so the
        # displayed rows summed to Rs.6,400 less than "TOTAL MONTHLY EXPENSES"
        # for this exact fixture. Salary must now absorb that loading as the
        # residual against fixed_total, so Rent + Salary == fixed_total exactly.
        from pdf.builder import _o1_expense_breakdown
        cma = {
            "rent": 0, "fixed_total": 70400,          # 64,000 salary x 1.10 PF loading
            "cogs_monthly": 45900, "mktg_monthly": 22950,
            "variable_total": 98450, "total_monthly_exp": 168850,
        }
        inp = {
            "stationery": 2500, "electricity_water": 12600, "repair_maintenance": 2000,
            "transport_conveyance": 6000, "telephone_internet": 1500, "miscellaneous": 5000,
        }
        row = _o1_expense_breakdown(cma, inp)
        assert row["rent"] + row["salary"] == row["fixed_total"] == 70400
        assert row["salary"] == 70400  # the old bug would have shown 64,000 here
        other_sum = (
            row["stationery"] + row["electricity_water"] + row["repair_maintenance"]
            + row["transport_conveyance"] + row["telephone_internet"] + row["miscellaneous"]
        )
        assert round(row["cogs"] + row["marketing"] + other_sum, 2) == row["variable_total"] == 98450
        assert round(row["fixed_total"] + row["variable_total"], 2) == row["total_monthly_exp"] == 168850

    def test_no_drift_when_raw_items_already_match_totals(self):
        # When the raw itemized inputs already tie out exactly to the
        # authoritative totals, the scale factor must be a no-op (1.0) — this
        # fix should never distort an already-correct breakdown.
        from pdf.builder import _o1_expense_breakdown
        cma = {
            "rent": 10000, "fixed_total": 74000,
            "cogs_monthly": 472800, "mktg_monthly": 2500,
            "variable_total": 504900, "total_monthly_exp": 578900,
        }
        inp = {
            "stationery": 2500, "electricity_water": 12600, "repair_maintenance": 2000,
            "transport_conveyance": 6000, "telephone_internet": 1500, "miscellaneous": 5000,
        }
        row = _o1_expense_breakdown(cma, inp)
        assert row["salary"] == 64000
        assert row["stationery"] == 2500
        assert row["electricity_water"] == 12600
        assert row["miscellaneous"] == 5000


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
