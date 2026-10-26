"""Tests for calculations/validator.py — the report-generation validator
whose warnings/errors are surfaced directly to the user via the
/api/v1/report/generate response's `validation_warnings` field.

V1 REGRESSION: schemes/router.py's scheme_data["project_cost"] deliberately
INCLUDES the promoter's own working-capital margin (project_cost =
fixed_project_cost + wc_margin — see router.py's _compute_project_cost
docstring), while every scheme's 3-way MoF split (promoter + subsidy +
term loan) is computed purely against fixed_project_cost and never touches
wc_margin. V1 used to compare mof_total against project_cost, which is off
by wc_margin on literally every application that has any working-capital
requirement — a false "MoF must reconcile" error shown to the user on an
otherwise-healthy report. Fixed to compare against fixed_project_cost.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from calculations.validator import validate_report, ValidationError, structural_reconciliation


def _scheme_data(**overrides):
    base = {
        "promoter_amount": 105450,
        "term_loan": 1265400,
        "margin_money": 738150,
        "fixed_project_cost": 2109000,   # promoter + term_loan + margin_money
        "wc_margin": 80156,              # promoter's own WC contribution — NOT in the MoF split
        "wc_loan": 320625,
        "project_cost": 2189156,         # = fixed_project_cost + wc_margin (by design)
    }
    base.update(overrides)
    return base


def _minimal_income_row():
    """Minimal income-statement row that clears CHECK 3/4/5 on its own —
    tests below only care about V1/V5, not these unrelated checks."""
    return {"year": 1, "revenue": 100.0, "profit_before_tax": 0.0, "tax": 0.0,
            "pat": 0.0, "depreciation": 0.0, "cash_accruals": 0.0, "capacity": 0.5}


def _minimal_report_data(scheme_data, income=None):
    return {
        "scheme_data":      scheme_data,
        "income_statement": income if income is not None else [_minimal_income_row()],
        "dscr":             {"years": []},
        "balance_sheet":    [],
        "sensitivity":      [],
        "depreciation":     {},
        "wc_schedule":      [],
        "loan_schedule":    [],
        "input":            {},
    }


class TestV1MeansOfFinanceReconciliation:
    def test_healthy_application_with_wc_margin_does_not_false_positive(self):
        """The exact regression case: a real application with a nonzero
        wc_margin (the normal case for virtually every project) must NOT
        trigger V1, since MoF (promoter+subsidy+TL) correctly reconciles
        to fixed_project_cost, not the WC-inclusive project_cost."""
        report_data = _minimal_report_data(_scheme_data())
        # V1 is error-level (raises ValidationError) — the call must not raise.
        validate_report(report_data)

    def test_zero_wc_margin_still_reconciles(self):
        scheme_data = _scheme_data(wc_margin=0, project_cost=2109000)
        report_data = _minimal_report_data(scheme_data)
        validate_report(report_data)

    def test_genuine_mof_drift_is_still_caught(self):
        """A REAL mismatch — e.g. promoter_amount corrupted/wrong — must
        still raise V1. The fix must not silence genuine drift."""
        scheme_data = _scheme_data(promoter_amount=999999)  # now genuinely wrong
        report_data = _minimal_report_data(scheme_data)
        with pytest.raises(ValidationError) as exc:
            validate_report(report_data)
        assert "V1 FAIL" in str(exc.value)

    def test_large_wc_margin_does_not_false_positive(self):
        """Larger WC margins (bigger working-capital-heavy projects) must
        not scale up the old false-positive gap."""
        scheme_data = _scheme_data(wc_margin=500000, project_cost=2609000)
        report_data = _minimal_report_data(scheme_data)
        validate_report(report_data)


class TestV13BusinessStatusVsCommencementDate:
    """BUG: an applicant marked 'Existing Business' with N months of
    operating history but a commencement date of today (or later) is
    internally inconsistent — an existing business can't have just
    commenced. V13 is a HARD ERROR (escalated from an earlier warning-only
    design): the applicant must correct one of the two contradictory input
    fields before any report — which would otherwise show a fabricated
    "N yr M mo" business-age figure alongside a same-day/future
    commencement date — is generated at all."""

    def _report_data_with_business(self, business):
        report_data = _minimal_report_data(_scheme_data())
        report_data["input"] = {"business": business}
        return report_data

    def test_existing_business_commencing_today_blocks_generation(self):
        from datetime import date
        report_data = self._report_data_with_business({
            "business_status": "Existing Business",
            "business_duration_months": 24,
            "commencement_date": date.today().isoformat(),
        })
        with pytest.raises(ValidationError) as exc:
            validate_report(report_data)
        assert "V13 FAIL" in str(exc.value)

    def test_existing_business_with_past_commencement_does_not_block(self):
        report_data = self._report_data_with_business({
            "business_status": "Existing Business",
            "business_duration_months": 24,
            "commencement_date": "2023-01-01",
        })
        validate_report(report_data)  # must not raise

    def test_new_business_commencing_today_does_not_block(self):
        from datetime import date
        report_data = self._report_data_with_business({
            "business_status": "New Business",
            "business_duration_months": 0,
            "commencement_date": date.today().isoformat(),
        })
        validate_report(report_data)  # must not raise


class TestV10GrossBlockContingency:
    """BUG FIX: V10 used to compare pm_with_contingency against
    machinery_gross (the pre-contingency subtotal) and warn when they
    DIFFERED — but they are designed to differ whenever contingency_pct
    > 0 (virtually every real application), so the old check
    false-positived on every healthy report using a contingency loading
    at all, and could never actually catch a real regression."""

    def test_healthy_report_with_contingency_does_not_false_positive(self):
        report_data = _minimal_report_data(_scheme_data())
        report_data["depreciation"] = {
            "building_gross": 300000.0,
            "machinery_gross": 700000.0,       # pre-contingency
            "pm_with_contingency": 735000.0,   # +5% contingency — DIFFERS from machinery_gross by design
            "fixtures_gross": 0.0,
            "gross_block": 1035000.0,          # building + pm_with_contingency + fixtures
        }
        validate_report(report_data)  # must not raise, must not warn V10
        assert not any("V10 WARN" in w for w in report_data["validation_warnings"])

    def test_gross_block_not_matching_its_own_components_is_still_caught(self):
        report_data = _minimal_report_data(_scheme_data())
        report_data["depreciation"] = {
            "building_gross": 300000.0,
            "machinery_gross": 700000.0,
            "pm_with_contingency": 735000.0,
            "fixtures_gross": 0.0,
            "gross_block": 700000.0,  # WRONG — used pre-contingency machinery_gross instead
        }
        validate_report(report_data)
        assert any("V10 WARN" in w for w in report_data["validation_warnings"])


class TestV5DscrMessageIsActionable:
    def test_dscr_failure_message_does_not_blame_a_fixed_bug(self):
        """The V5 message used to say 'likely RM is calculated from
        grossMarginPct instead of unit costs' — that bug was already fixed
        elsewhere (income_statement.py's BUG 1 FIX), so blaming it again
        here is stale and misleading. The message must give real CA
        guidance instead."""
        scheme_data = _scheme_data()
        report_data = _minimal_report_data(scheme_data)
        report_data["dscr"] = {"years": [
            {"year": 1, "dscr": -3.71, "total_b": 100000},
        ]}
        with pytest.raises(ValidationError) as exc:
            validate_report(report_data)
        message = str(exc.value)
        assert "V5 FAIL" in message
        assert "grossMarginPct" not in message


def _consistent_cma_dpr():
    """A minimal but internally self-consistent cma/dpr pair — every check in
    structural_reconciliation should PASS against this fixture. Mirrors the
    field names pdf/generator.py's _build_dpr_from_report actually produces."""
    dpr = {
        "project_cost": {
            "total_project_cost": 1000.0,
            "promoter_fixed_equity": 200.0,
            "promoter_wc_margin": 100.0,
            "total_promoter_contribution": 300.0,
            "term_loan": 500.0,
            "wc_loan": 200.0,
        },
        "depreciation": {
            "gross_block": 100.0,
            "schedule": [
                {"year": 1, "opening_wdv": 100.0, "depreciation": 10.0, "accumulated_depreciation": 10.0, "closing_wdv": 90.0},
                {"year": 2, "opening_wdv": 100.0, "depreciation": 10.0, "accumulated_depreciation": 20.0, "closing_wdv": 80.0},
            ],
        },
        "term_loan": {"schedule": [
            {"year": 1, "opening": 500.0, "closing": 400.0, "principal_repaid": 100.0},
            {"year": 2, "opening": 400.0, "closing": 300.0, "principal_repaid": 100.0},
        ]},
        "working_capital_years": [
            {"year": 1, "total": 300.0, "margin": 100.0, "bank_loan": 200.0},
            {"year": 2, "total": 330.0, "margin": 110.0, "bank_loan": 220.0},
        ],
        "profit_and_loss_years": [
            {"year": 1, "revenue": 1000.0, "total_expenses": 800.0, "profit_before_tax": 200.0, "tax": 50.0, "net_profit": 150.0},
            {"year": 2, "revenue": 1100.0, "total_expenses": 850.0, "profit_before_tax": 250.0, "tax": 60.0, "net_profit": 190.0},
        ],
        "cash_flow_years": [
            {"year": 1, "opening_cash": 0.0,  "surplus": 50.0, "closing_cash": 50.0},
            {"year": 2, "opening_cash": 50.0, "surplus": 30.0, "closing_cash": 80.0},
        ],
        "balance_sheet_years": [
            {"year": 0, "cash": 0.0,  "total_assets": 1000.0, "total_liabilities": 1000.0, "term_loan": 500.0, "wc_bank": 200.0, "current_assets": 300.0},
            {"year": 1, "cash": 50.0, "total_assets": 1050.0, "total_liabilities": 1050.0, "term_loan": 400.0, "wc_bank": 200.0, "current_assets": 300.0},
            {"year": 2, "cash": 80.0, "total_assets": 1130.0, "total_liabilities": 1130.0, "term_loan": 300.0, "wc_bank": 220.0, "current_assets": 330.0},
        ],
    }
    cma = {
        "project_cost_items": [
            {"code": 1, "particulars": "Building", "amount": 500.0},
            {"code": 2, "particulars": "Machinery", "amount": 300.0},
            {"code": 3, "particulars": "Working Capital Facility Requested", "amount": 200.0},
        ],
        # Total Project Cost = fixed assets (700) + WC margin (100) + WC
        # facility (200) = 1,000; all sources must reconcile to this total.
        "total_project_cost": 1000.0,
        "promoter_fixed_equity": 200.0,
        "promoter_wc_margin": 100.0,
        "total_promoter_contribution": 300.0,
    }
    return cma, dpr


class TestStructuralReconciliation:
    """The 11 pure arithmetic-identity checks shown in the PDF's Section 31
    ('Financial Model Reconciliation') — deliberately distinct from
    business-outcome warnings (a loss-making year is a valid OUTCOME, not a
    structural failure, and must never be flagged here)."""

    def test_consistent_data_passes_every_check(self):
        cma, dpr = _consistent_cma_dpr()
        checks = structural_reconciliation(cma, dpr)
        assert len(checks) == 11
        failed = [c["name"] for c in checks if not c["passed"]]
        assert failed == [], f"Unexpected FAILs against a self-consistent fixture: {failed}"

    def test_broken_loan_rollforward_is_caught(self):
        cma, dpr = _consistent_cma_dpr()
        dpr["term_loan"]["schedule"][0]["closing"] = 999.0  # corrupt it
        checks = structural_reconciliation(cma, dpr)
        tl_check = next(c for c in checks if c["name"].startswith("Term Loan Roll-Forward"))
        assert tl_check["passed"] is False

    def test_nonconstant_year1_depreciation_opening_is_caught(self):
        cma, dpr = _consistent_cma_dpr()
        dpr["depreciation"]["schedule"][1]["opening_wdv"] = 90.0
        checks = structural_reconciliation(cma, dpr)
        dep_check = next(c for c in checks if c["name"].startswith("Fixed Asset WDV"))
        assert dep_check["passed"] is False

    def test_broken_project_cost_items_is_caught(self):
        cma, dpr = _consistent_cma_dpr()
        cma["project_cost_items"][0]["amount"] = 1.0  # no longer sums to total
        checks = structural_reconciliation(cma, dpr)
        pc_check = next(c for c in checks if c["name"] == "Project Cost Items Sum = Total Project Cost")
        assert pc_check["passed"] is False

    def test_funding_reconciliation_check_name_does_not_overclaim_means_of_finance(self):
        """The funding reconciliation is distinct from the itemised-cost
        check and compares the complete project total against its sources."""
        cma, dpr = _consistent_cma_dpr()
        checks = structural_reconciliation(cma, dpr)
        names = [c["name"] for c in checks]
        assert "Project Cost = Means of Finance" not in names
        assert "Total Project Cost = Total Funding Sources" in names

    def test_broken_funding_reconciliation_is_caught(self):
        """dpr["project_cost"]["term_loan"] is read independently of
        cma["total_project_cost"] — corrupting only the former must break
        this check without needing cma to also be corrupted, proving the
        two sides are genuinely cross-checked, not the same number
        restated on both sides."""
        cma, dpr = _consistent_cma_dpr()
        dpr["project_cost"]["term_loan"] = 999.0
        checks = structural_reconciliation(cma, dpr)
        funding_check = next(
            c for c in checks
            if c["name"] == "Total Project Cost = Total Funding Sources"
        )
        assert funding_check["passed"] is False

    def test_business_outcome_is_never_flagged_as_structural(self):
        """A loss-making, negative-cash year is a valid, correctly-computed
        OUTCOME — it must not fail any structural check as long as every
        total still equals the sum of its own parts."""
        cma, dpr = _consistent_cma_dpr()
        for cy in dpr["profit_and_loss_years"]:
            cy["profit_before_tax"] = -500.0
            cy["tax"] = 0.0
            cy["net_profit"] = -500.0
            cy["total_expenses"] = cy["revenue"] + 500.0
        for row in dpr["cash_flow_years"]:
            row["surplus"] = -500.0
            row["closing_cash"] = row["opening_cash"] - 500.0
        dpr["balance_sheet_years"][1]["cash"] = -500.0
        dpr["cash_flow_years"][0]["opening_cash"] = dpr["balance_sheet_years"][0]["cash"]
        dpr["cash_flow_years"][0]["closing_cash"] = dpr["cash_flow_years"][0]["opening_cash"] + dpr["cash_flow_years"][0]["surplus"]
        dpr["cash_flow_years"][1]["opening_cash"] = dpr["cash_flow_years"][0]["closing_cash"]
        dpr["cash_flow_years"][1]["closing_cash"] = dpr["cash_flow_years"][1]["opening_cash"] + dpr["cash_flow_years"][1]["surplus"]
        checks = structural_reconciliation(cma, dpr)
        pnl_check = next(c for c in checks if c["name"].startswith("P&L Roll-Forward"))
        cf_check  = next(c for c in checks if c["name"].startswith("Cash Flow Roll-Forward"))
        assert pnl_check["passed"] is True
        assert cf_check["passed"] is True
