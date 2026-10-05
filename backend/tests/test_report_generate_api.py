"""Integration tests for POST /api/v1/report/generate — checks that
scheme-level decisions made by schemes/router.py (moratorium overrides,
CGTMSE guarantee fee) actually reach the generated report, not just the
JSON response's key_metrics.

BUG this guards: route_scheme() resolves a scheme-specific moratorium
(e.g. CGTMSE defaults to 6 months via the Rules engine) into
scheme_data["moratorium_months"], but nothing downstream ever read that
key — calculate_loan_schedule() read data.assumptions.moratorium_months
directly, so the scheme's own mandated moratorium was silently ignored
whenever it differed from whatever the applicant's raw input happened to
contain (including the schema's own default of 0).
"""
import sys, os, re
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from main import app
from pypdf import PdfReader
from pypdf.generic import ContentStream
import io

client = TestClient(app)


def _cgtmse_payload(moratorium_months=0):
    """A minimal manufacturing CGTMSE payload. moratorium_months is
    deliberately set to something OTHER than CGTMSE's 6-month scheme
    default, to prove the scheme default — not the raw input — wins."""
    return {
        "scheme": "cgtmse",
        "loan_purpose": "Setting up a small manufacturing unit",
        "applicant": {"full_name": "Test Promoter", "mobile": "9999999999", "area_type": "Urban"},
        "business": {
            "business_name": "Test Manufacturing Co",
            "industry_type": "manufacturing",
            "business_status": "New Business",
            "location": "Pune", "district": "Pune",
        },
        "project": {
            "land_cost": 100000,
            "building_cost": 300000,
            "machinery_items": [{"name": "CNC Machine", "quantity": 1, "unit_price": 500000}],
        },
        "production": {
            "input_qty_per_day": 200, "working_days_per_year": 300,
            "selling_price_per_unit": 150, "raw_material_cost_per_unit": 60,
            "output_yield_pct": 95,
        },
        "assumptions": {
            "term_loan_pct": 85, "wc_loan_pct": 60, "interest_rate_pct": 10.5,
            "tenure_months": 60, "moratorium_months": moratorium_months,
            "revenue_growth_pct": 6, "expense_growth_pct": 5, "tax_rate_pct": 25,
            "depreciation_pct": 15, "building_dep_rate_pct": 5,
            "stock_holding_days": 30, "debtor_days": 30, "creditor_days": 15,
            "capacity_y1_pct": 60, "capacity_y2_pct": 70, "capacity_y3_pct": 80,
            "capacity_y4_pct": 85, "capacity_y5_pct": 90,
        },
        "expenses": {"rent": 20000},
        "manpower": {"skilled_count": 3, "skilled_salary": 15000},
    }


def _download_pdf_text(report_id: str) -> str:
    dl = client.get(f"/api/v1/report/{report_id}/download")
    assert dl.status_code == 200
    reader = PdfReader(io.BytesIO(dl.content))
    return "\n".join(page.extract_text() for page in reader.pages)


class TestReportCustomization:
    def test_custom_theme_prepared_by_and_bank_reach_generated_pdf(self):
        payload = _cgtmse_payload()
        payload["prepared_by"] = "A. Banker"
        payload["report_theme"] = "Teal"
        payload["business"]["bank_name"] = "State Bank of India (SBI)"
        payload["to_bank"] = "Kotak Mahindra Bank"

        response = client.post("/api/v1/report/generate", json=payload)
        assert response.status_code == 200, response.text
        report_id = response.json()["report_id"]
        download = client.get(f"/api/v1/report/{report_id}/download")
        assert download.status_code == 200

        reader = PdfReader(io.BytesIO(download.content))
        report_text = "\n".join(page.extract_text() for page in reader.pages)
        normalized_text = " ".join(report_text.split())
        assert "Prepared By" in normalized_text
        assert "A. Banker" in report_text
        assert "To" in normalized_text
        assert "Kotak Mahindra Bank" in normalized_text
        assert "Preferred Bank" in normalized_text
        assert "State Bank of India (SBI)" in normalized_text
        assert (
            "CGTMSE Cover: guarantee fee applicable | Collateral/Security: subject to CGTMSE eligibility, "
            "guarantee cover limits and lender policy — to be confirmed by the financing bank"
        ) in normalized_text

        expected_colors = ((15 / 255, 118 / 255, 110 / 255), (13 / 255, 148 / 255, 136 / 255))
        found_colors = set()
        for page in reader.pages:
            content = ContentStream(page.get_contents(), reader)
            for operands, operator in content.operations:
                if operator not in (b"rg", b"RG") or len(operands) < 3:
                    continue
                rgb = tuple(float(channel) for channel in operands[:3])
                for expected in expected_colors:
                    if all(abs(actual - target) < 0.001 for actual, target in zip(rgb, expected)):
                        found_colors.add(expected)
        assert found_colors == set(expected_colors), "Selected Teal cover and section accents were not applied"


class TestCgtmseMoratoriumOverride:
    def test_cgtmse_scheme_moratorium_default_applied_not_raw_input(self):
        # Applicant's raw input says 0 months; CGTMSE's scheme default is 6.
        resp = client.post("/api/v1/report/generate", json=_cgtmse_payload(moratorium_months=0))
        assert resp.status_code == 200, resp.text
        report_id = resp.json()["report_id"]
        text = _download_pdf_text(report_id)
        assert "Moratorium" in text
        assert "6 Month(s)" in text, (
            "CGTMSE's 6-month scheme-default moratorium must be applied and displayed, "
            "even though the raw input said 0 months"
        )

    def test_year1_has_no_principal_repayment_under_moratorium(self):
        resp = client.post("/api/v1/report/generate", json=_cgtmse_payload(moratorium_months=0))
        assert resp.status_code == 200, resp.text
        report_id = resp.json()["report_id"]
        text = _download_pdf_text(report_id)
        # The Term Loan Repayment section must show a nonzero half-yearly
        # instalment consistent with a moratorium actually being honoured
        # (i.e. NOT computed as if there were 10 full repayment half-years).
        assert "SECTION-H: TERM LOAN REPAYMENT" in text


class TestCgtmseGuaranteeFeeInReport:
    def test_guarantee_fee_appears_as_an_expense_line(self):
        resp = client.post("/api/v1/report/generate", json=_cgtmse_payload())
        assert resp.status_code == 200, resp.text
        report_id = resp.json()["report_id"]
        text = _download_pdf_text(report_id)
        assert "CGTMSE Guarantee Fee" in text, (
            "CGTMSE's Annual Guarantee Fee must appear as a real expense line in the report"
        )


class TestRawMaterialSectionTotalMatchesItsOwnRows:
    def test_total_row_equals_sum_of_displayed_items(self):
        """BUG FIX: Section 12's "Raw Material & Consumables (at 100%
        Capacity)" table showed its Raw Material row at the 100%-capacity
        basis (input_qty x working_days x rate), but its own TOTAL row used
        to be the capacity-ADJUSTED actual Year-1 COGS instead — a
        different basis than the rows above it, so TOTAL never equalled
        the sum of the rows displayed in the same table."""
        resp = client.post("/api/v1/report/generate", json=_cgtmse_payload())
        assert resp.status_code == 200, resp.text
        report_id = resp.json()["report_id"]
        text = _download_pdf_text(report_id)
        # input_qty_per_day(200) x working_days(300) x rm_cost_per_unit(60) = 3,600,000
        assert "3,600,000" in text, "Raw Material row and TOTAL must both show the 100%-capacity figure"


class TestInterestCoverageMatchesEbitdaOverTotalInterest:
    def test_interest_coverage_uses_the_synced_ebitda_and_interest_not_a_stale_pre_sync_figure(self):
        """BUG FIX: a CA reviewer caught this on a live report — Section 29
        showed "Interest Coverage (EBITDA / Int) = 5.56x", but Section 14's
        own EBITDA (Rs.21,55,959), WC Interest (Rs.89,381) and Term Loan
        Interest (Rs.3,32,233) on the SAME report give EBITDA / (TL + WC
        interest) = 21,55,959 / 4,21,614 = 5.11x.

        Root cause: pdf/generator.py computed interest_coverage_y1 once,
        early, from calculate_monthly_pnl()'s own (pre-sync) EBITDA/interest
        figures — then never recomputed it after cma["ebitda_monthly"] and
        cma["monthly_int_y1"] were subsequently overwritten with the
        authoritative income_statement Year-1 figures (the same figures
        Section 14 displays). roi_ebitda_pct/roi_pat_pct/asset_turnover_y1
        were already re-synced at that point; interest_coverage_y1 was the
        one ratio left stale.
        """
        resp = client.post("/api/v1/report/generate", json=_cgtmse_payload())
        assert resp.status_code == 200, resp.text
        report_id = resp.json()["report_id"]
        text = _download_pdf_text(report_id)

        idx14 = text.find("SECTION-J: PROFIT & LOSS STATEMENT")
        idx29 = text.find("SECTION-U: KEY FINANCIAL RATIOS SUMMARY")
        assert idx14 != -1 and idx29 != -1

        def _year1_value(label: str, section_text: str) -> float:
            i = section_text.find(label)
            assert i != -1, f"{label!r} row not found"
            after = section_text[i + len(label):]
            m = re.search(r"[\d,]+", after)
            return float(m.group(0).replace(",", ""))

        sec14 = text[idx14:idx29]
        ebitda_y1  = _year1_value("EBITDA", sec14)
        wc_int_y1  = _year1_value("Less: Interest on WC", sec14)
        tl_int_y1  = _year1_value("Less: Interest on Term Loan", sec14)
        expected_coverage = round(ebitda_y1 / (wc_int_y1 + tl_int_y1), 2)

        sec29 = text[idx29:]
        i = sec29.find("Interest Coverage")
        assert i != -1, "Interest Coverage row not found in Section-U"
        m = re.search(r"[\d.]+", sec29[i + len("Interest Coverage"):])
        displayed_coverage = float(m.group(0))

        assert displayed_coverage == expected_coverage, (
            f"Displayed Interest Coverage ({displayed_coverage}x) must equal "
            f"Section 14's own EBITDA / (TL + WC interest) = {expected_coverage}x"
        )


class TestSalesRealizationShowsTrue100PctCapacity:
    def test_manufacturing_products_table_scaled_to_100pct_not_year1_actual(self):
        """BUG FIX: Section 11's "Annual Sales Realization (Year 1, at 100%
        Capacity)" table, for a manufacturing/agriculture business with no
        real user-entered products list, fell back to pdf/generator.py's
        synthetic single-product fallback — whose units_per_month is the
        Year-1 ACTUAL (capacity-adjusted) quantity, not the 100%-capacity
        quantity the table's own header claims. Reported by a CA reviewer:
        a report showed "Quantity/month = 7,125" and "Rs.85.50L" under an
        "at 100% Capacity" heading, when the true 100%-capacity figures
        were 11,875 units/month and Rs.1,42,50,000.

        For this fixture: 100%-capacity output = 200/day x 300 days x 95%
        yield = 57,000 units/yr @ Rs.150 = Rs.85,50,000/yr (100% capacity),
        vs Year-1-actual (60% capacity) = Rs.51,30,000/yr. The table must
        show the former, not the latter.

        The synthetic fallback product's "category" is set from
        business.nature_of_business — that field must be non-empty (as a
        real applicant's would be) to reproduce the branch the bug lived
        in; the shared fixture leaves it blank, so it's set here.
        """
        payload = _cgtmse_payload()
        payload["business"]["nature_of_business"] = "Precision Machining of Automotive Components"
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        report_id = resp.json()["report_id"]
        text = _download_pdf_text(report_id)
        idx = text.find("Annual Revenue at 100% Installed Capacity")
        end = text.find("Revenue Build-Up", idx)
        assert idx != -1 and end != -1, "Section 11 sales realization table not found"
        section = text[idx:end]
        assert "4,750" in section, (
            "Quantity/Month must be scaled up to the true 100%-capacity figure (4,750), "
            "not the Year-1-actual (60%-capacity) quantity (2,850)"
        )
        assert "8,550,000" in section, (
            "Annual Revenue at 100% Installed Capacity table must show the true 100%-capacity "
            "annual revenue (Rs.85,50,000), not the Year-1-actual (60%-capacity) figure"
        )
        assert "5,130,000" not in section, (
            "Annual Revenue at 100% Installed Capacity table must not show the Year-1-actual "
            "(60%-capacity) revenue under a heading that claims 100% capacity"
        )


def _pmegp_trading_payload():
    """A minimal PMEGP trading payload with an itemized products list (the
    normal way to describe a trading business's stock) and no
    machinery_items — the combination that exposed several previously-
    undiscovered display bugs (Section 11's itemized-trading table, Section
    02's Fixed Project Cost, Section 19's Gross Block, and the "TOTAL" row
    for the raw items table)."""
    return {
        "scheme": "pmegp",
        "loan_purpose": "Setting up a wholesale hardware trading outlet",
        "applicant": {"full_name": "Test Trader", "mobile": "9999999999", "area_type": "Urban"},
        "business": {
            "business_name": "Test Hardware Traders",
            "industry_type": "trading", "business_status": "New Business",
            "location": "Nashik", "district": "Nashik",
        },
        "project": {
            "building_cost": 300000,
            "computers_cost": 80000,
            "furniture_cost": 150000,
            "electrification_cost": 70000,
            "racks_storage_cost": 250000,
            "transportation_cost": 250000,
            "tools_installation": 50000,
            "preliminary_expenses": 50000,
        },
        "production": {"working_days_per_year": 300, "hours_of_operation": 10},
        "products": [
            {"category": "Hardware Tools & Fittings", "units_per_month": 800, "avg_price": 300,
             "purchase_price": 180, "monthly_revenue": 240000, "mix_pct": 0},
        ],
        "assumptions": {
            "term_loan_pct": 75, "wc_loan_pct": 60, "interest_rate_pct": 11.0,
            "tenure_months": 60, "moratorium_months": 6,
            "revenue_growth_pct": 8, "expense_growth_pct": 5, "tax_rate_pct": 25,
            "depreciation_pct": 15, "building_dep_rate_pct": 10,
            "stock_holding_days": 45, "debtor_days": 20, "creditor_days": 30,
            "contingency_pct": 5,
            "capacity_y1_pct": 55, "capacity_y2_pct": 65, "capacity_y3_pct": 75,
            "capacity_y4_pct": 85, "capacity_y5_pct": 90,
        },
        "expenses": {"rent": 25000},
        "manpower": {"skilled_count": 1, "skilled_salary": 20000},
    }


def _year1_row_value(label: str, text: str) -> float:
    i = text.find(label)
    assert i != -1, f"{label!r} not found in report text"
    m = re.search(r"[\d,]+", text[i + len(label):])
    return float(m.group(0).replace(",", ""))


class TestTradingSectionsWithItemizedProductsList:
    """A trading business describing its stock via the itemized products
    list (purchase_price x units_per_month), rather than a flat monthly RM
    figure or manufacturing-style unit costs, is the normal/expected way to
    fill in this form for a wholesale trader — and exposed four distinct
    display bugs in one live report generation."""

    def test_section19_gross_value_matches_its_own_displayed_depreciation(self):
        """BUG FIX: the combined P&M+fixtures row's "Gross Value" used to
        show pm_with_contingency alone, omitting fixtures_gross — even
        though its own "Year 1 Dep" was computed off pm_with_contingency +
        fixtures_gross combined. That made the row self-contradictory
        (e.g. Rs.52,500 shown at a 15% rate next to a Rs.127,875 depreciation
        figure)."""
        resp = client.post("/api/v1/report/generate", json=_pmegp_trading_payload())
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        idx = text.find("Shop Equipment, Fixtures & Interiors (incl. fitting)")
        assert idx != -1
        row = text[idx:idx + 200]
        # Row cells, in order: Gross Value, Dep Rate ("15.0%"), Year 1 Dep.
        cells = re.findall(r"Rs\. ([\d,]+)|(\d+\.\d)%", row)
        gross_value = float(cells[0][0].replace(",", ""))
        year1_dep   = float(cells[2][0].replace(",", ""))
        dep_rate    = 0.15
        assert abs(gross_value * dep_rate - year1_dep) < 1, (
            f"Gross Value ({gross_value}) x Dep Rate must equal the row's own "
            f"Year 1 Dep ({year1_dep}) — they must not be computed off different bases"
        )

    def test_section19_items_total_does_not_double_count_tools_installation(self):
        """BUG FIX: when no machinery_items were entered, the fallback
        synthetic item was already valued at dep["machinery_gross"] — which
        ITSELF already includes tools_installation — then tools_installation
        was added a second time onto the displayed "TOTAL" row."""
        resp = client.post("/api/v1/report/generate", json=_pmegp_trading_payload())
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        idx = text.find("Plant & Equipment")
        assert idx != -1
        section = text[idx:idx + 100]
        assert "TOTAL" in section
        total = _year1_row_value("TOTAL", section)
        assert total == 50000, f"TOTAL must equal the single tools_installation item (Rs.50,000), got {total}"

    def test_section02_fixed_project_cost_matches_section07_total(self):
        """BUG FIX: Section 02's "Fixed Project Cost" was computed as just
        term_loan + promoter_fixed_equity, silently dropping the scheme's
        margin-money/capital subsidy (PMEGP here) — money that IS part of
        the fixed capital outlay. It must match Section 07/08's own total."""
        resp = client.post("/api/v1/report/generate", json=_pmegp_trading_payload())
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        exec_summary_value = _year1_row_value("Fixed Project Cost", text)
        section07_total = _year1_row_value("TOTAL (Initial Project Investment)", text)
        # Section 07's total also includes the WC margin — subtract it back out.
        wc_margin = _year1_row_value("Working Capital Margin (Promoter's Share)", text)
        assert abs(exec_summary_value - (section07_total - wc_margin)) < 1, (
            f"Section 02 Fixed Project Cost ({exec_summary_value}) must equal Section 07's "
            f"own fixed-cost total ({section07_total - wc_margin})"
        )

    def test_location_and_district_shown_once_when_identical(self):
        """BUG FIX: when location and district are the same value, this used
        to concatenate them with no separator ("Nashik  Nashik" / "Nashik,
        Nashik") — read as a typo/duplication by a reviewer."""
        resp = client.post("/api/v1/report/generate", json=_pmegp_trading_payload())
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "Nashik  Nashik" not in text
        assert "Nashik, Nashik" not in text


class TestMoratoriumDisplayMatchesEffectiveSchedule:
    def test_non_multiple_of_six_moratorium_shows_effective_value_with_explanatory_note(self):
        """BUG FIX: a 9-month moratorium request rounds to a 12-month
        effective moratorium (nearest half-year) since the half-yearly
        schedule can only skip whole instalments — the report used to
        display the raw "9 Month(s)" request next to a Section 21 schedule
        whose Year 1 shows a full 12 months of zero principal, silently
        disagreeing with what it claimed."""
        payload = _pmegp_trading_payload()
        payload["assumptions"]["moratorium_months"] = 9
        payload["assumptions"]["tenure_months"] = 60
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "12 Month(s)" in text, "Displayed moratorium must be the effective (rounded) value, not the raw 9-month request"
        assert "9 month(s) moratorium was requested" in text, "Must disclose the original request and the rounding applied"


def _msme_psu_subsidy_payload():
    """A minimal MSME_PSU payload with a state capital subsidy — exercises
    the crude-vs-real working-capital-estimate reconciliation bug."""
    return {
        "scheme": "msme_psu",
        "loan_purpose": "Purchase of printing equipment",
        "applicant": {"full_name": "Test Promoter", "mobile": "9999999999", "area_type": "Urban"},
        "business": {
            "business_name": "Test Printing Co",
            "industry_type": "service",
            "business_status": "New Business",
            "location": "Indore", "district": "Indore",
        },
        "project": {
            "building_cost": 100000,
            "machinery_items": [{"name": "Digital Press", "quantity": 1, "unit_price": 800000}],
            "tools_installation": 40000,
            "computers_cost": 80000,
            "furniture_cost": 30000,
            "electrification_cost": 40000,
            "preliminary_expenses": 20000,
        },
        "production": {"input_qty_per_day": 0, "selling_price_per_unit": 280000, "working_days_per_year": 300},
        "assumptions": {
            "term_loan_pct": 75, "wc_loan_pct": 60, "interest_rate_pct": 11.0,
            "tenure_months": 72, "moratorium_months": 6, "capital_subsidy_pct": 15,
            "revenue_growth_pct": 7, "expense_growth_pct": 6, "tax_rate_pct": 25,
            "depreciation_pct": 15, "building_dep_rate_pct": 10,
            "stock_holding_days": 15, "debtor_days": 15, "creditor_days": 20,
            "capacity_y1_pct": 85, "capacity_y2_pct": 90, "capacity_y3_pct": 95,
            "capacity_y4_pct": 98, "capacity_y5_pct": 100,
        },
        "expenses": {"rent": 15000, "raw_materials": 60000},
        "manpower": {"skilled_count": 1, "skilled_salary": 15000},
    }


class TestProjectCostSingleSourceOfTruth:
    """CA AUDIT: route_scheme() can only estimate Year-1 working capital with
    a crude heuristic ("1.5 months of 50%-capacity revenue") before the
    real, detailed WC schedule exists — every downstream consumer of
    scheme_data["project_cost"] (Payback Period's Initial Investment,
    Section 09's Promoter Share, the scorecard's ROI) used to silently read
    that crude estimate, disagreeing with Section 07's own item-summed
    Total Project Cost."""

    def test_payback_initial_investment_matches_section07_total_project_cost(self):
        resp = client.post("/api/v1/report/generate", json=_msme_psu_subsidy_payload())
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        section07_total = _year1_row_value("TOTAL (Initial Project Investment)", text)
        idx = text.find("Initial Investment (Total Project Cost)")
        assert idx != -1
        payback_initial_investment = _year1_row_value("Initial Investment (Total Project Cost)", text[idx:])
        assert payback_initial_investment == section07_total, (
            f"Section 28's Payback Period Initial Investment ({payback_initial_investment}) must equal "
            f"Section 07's own Total Project Cost ({section07_total}) — both describe the same project"
        )

    def test_promoter_share_of_total_funding_uses_subsidy_inclusive_fixed_cost(self):
        """Section 09's "Total Funding Requirement Promoter Share %" used to
        exclude the capital subsidy from its own Fixed Cost component
        (the same bug already fixed for Section 02's "Fixed Project Cost"),
        understating the true funding-requirement base."""
        resp = client.post("/api/v1/report/generate", json=_msme_psu_subsidy_payload())
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        fixed_cost = _year1_row_value("Fixed Project Cost", text)
        wc_total = _year1_row_value("Working Capital Requirement", text)
        promoter_total = _year1_row_value("Total Promoter Contribution", text)
        idx = text.find("Total Funding Requirement Promoter Share")
        assert idx != -1
        m = re.search(r"[\d.]+", text[idx + len("Total Funding Requirement Promoter Share"):])
        displayed_pct = float(m.group(0))
        expected_pct = round(promoter_total / (fixed_cost + wc_total) * 100, 1)
        assert displayed_pct == expected_pct, (
            f"Displayed {displayed_pct}% must equal Promoter Contribution / (Fixed Cost + WC Requirement) "
            f"= {expected_pct}%, both using the subsidy-inclusive Fixed Cost"
        )

    def test_term_loan_pct_shows_actual_effective_rate_not_the_raw_assumption(self):
        """Section 10 used to show the raw term_loan_pct assumption (e.g.
        75%) even when a capital subsidy meant the term loan actually funds
        a smaller share of the (subsidy-inclusive) Fixed Project Cost."""
        resp = client.post("/api/v1/report/generate", json=_msme_psu_subsidy_payload())
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        fixed_cost = _year1_row_value("Fixed Project Cost", text)
        # "A. Term Loan" heading's own "Amount" row — unambiguous, unlike
        # bare "Term Loan" which also matches "Term Loan %" / "Term Loan
        # Interest" / "Term Loan Requested" elsewhere on the page.
        term_loan = _year1_row_value("Amount", text[text.find("A. Term Loan"):])
        idx = text.find("Term Loan % (of Fixed Cost)")
        assert idx != -1, "Section 10 must label this as the effective rate, not a bare assumption"
        m = re.search(r"[\d.]+", text[idx + len("Term Loan % (of Fixed Cost)"):])
        displayed_pct = float(m.group(0))
        expected_pct = round(term_loan / fixed_cost * 100, 1)
        assert displayed_pct == expected_pct
        assert displayed_pct != 75.0, "fixture's subsidy must make the effective rate differ from the raw 75% assumption"


class TestConstitutionSinglePromoterDisclosure:
    """CA AUDIT: the input schema (ApplicantInfo) only ever captures ONE
    signing promoter's KYC/net-worth data — there is no partner list. A
    report whose declared constitution (business_type) is a multi-person
    entity (Partnership/LLP/Private Limited/Cooperative) is therefore
    silently missing every other partner's financials. This must be
    flagged as an advisory warning (V14), not silently accepted."""

    def test_partnership_constitution_triggers_v14_warning(self):
        payload = _msme_psu_subsidy_payload()
        payload["business"]["business_type"] = "Partnership"
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        warnings = resp.json().get("validation_warnings") or []
        assert any("V14" in w and "Partnership" in w for w in warnings), warnings

    def test_proprietorship_constitution_does_not_trigger_v14_warning(self):
        payload = _msme_psu_subsidy_payload()
        payload["business"]["business_type"] = "Proprietorship"
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        warnings = resp.json().get("validation_warnings") or []
        assert not any("V14" in w for w in warnings), warnings


class TestExistingLoanEmiDisclosure:
    def test_existing_emi_caveat_appears_when_reported(self):
        """CA AUDIT: existing_monthly_emi (Section 05) is a pre-existing
        obligation excluded from the PRIMARY Term Loan DSCR (by design —
        that DSCR is scoped to the new term loan only). It must still be
        disclosed, and must point the reader to the "Adjusted Term Loan
        DSCR" (Section 28) that actually accounts for it — not merely say
        it's ignored everywhere."""
        payload = _cgtmse_payload()
        payload["business"]["business_status"] = "Existing Business"
        payload["business"]["business_duration_months"] = 24
        payload["business"]["commencement_date"] = "2024-06-01"
        payload["business"]["existing_annual_turnover"] = 2000000
        payload["business"]["existing_annual_profit"] = 150000
        payload["business"]["existing_monthly_emi"] = 9000
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "existing business loan EMI of Rs.9,000/month" in text
        assert "Adjusted Term Loan DSCR" in text

    def test_adjusted_dscr_table_reflects_combined_existing_and_home_loan_emi(self):
        """The Adjusted DSCR in Section 28 must combine BOTH the existing
        business loan EMI (Section 05) and the promoter's personal home
        loan EMI (Section 09/net worth) — they are separate obligations,
        and both draw on the same cash accruals as the new term loan."""
        payload = _cgtmse_payload()
        payload["business"]["business_status"] = "Existing Business"
        payload["business"]["business_duration_months"] = 24
        payload["business"]["commencement_date"] = "2024-06-01"
        payload["business"]["existing_annual_turnover"] = 2000000
        payload["business"]["existing_annual_profit"] = 150000
        payload["business"]["existing_monthly_emi"] = 9000
        payload["promoter_net_worth"] = {"home_loan_emi": 5000}
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        # Normalize whitespace — ReportLab Paragraph-wraps this sentence
        # across lines, so pypdf's extracted text can carry a "\n" wherever
        # the layout happened to wrap, splitting an otherwise-contiguous
        # phrase in the raw string.
        flat = " ".join(text.split())
        assert "Combined existing EMI: Rs.14,000/month" in flat
        assert "personal home loan EMI of Rs.5,000/month" in flat


class TestApplicantProfileFreeTextFields:
    def test_previous_employer_renders_as_a_paragraph_not_a_raw_string(self):
        """BUG FIX: "Previous Employer" is free text — a realistic value
        like "Guntur Mirchi Yard — Commission Agent Office" visually
        overflowed straight into the neighbouring "Previous Role" cell
        (plain strings don't wrap in a ReportLab Table; confirmed by
        rendering the page to an image — pypdf's text extraction doesn't
        reorder on visual overlap, so it can't catch this by itself).
        Fixed by Paragraph-wrapping the cell. This test pins the content
        survives that wrap; the layout fix itself was verified visually."""
        payload = _pmegp_trading_payload()
        payload["applicant"]["previous_employer"] = "Guntur Mirchi Yard — Commission Agent Office"
        payload["applicant"]["previous_role"] = "Grading & Quality Assistant"
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "Guntur Mirchi Yard" in text
        assert "Grading & Quality Assistant" in text

    def test_education_free_text_with_ordinal_is_not_mangled_by_title_case(self):
        """BUG FIX: any education value not matching a known enum key fell
        through to Python's .title(), which capitalises after every
        non-letter boundary — including digits — so free text like
        "Intermediate (12th)" became "Intermediate (12Th)"."""
        payload = _pmegp_trading_payload()
        payload["applicant"]["education"] = "Intermediate (12th)"
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "Intermediate (12th)" in text
        assert "12Th" not in text


class TestBalanceSheetFormatLabel:
    """CA AUDIT: "Schedule III Format" is a Companies Act, 2013 presentation
    framework — it applies to companies (Private Limited/OPC), not to a
    Proprietorship, Partnership, LLP, HUF or Cooperative. Section 24's
    title must reflect the applicant's actual constitution."""

    def test_proprietorship_gets_indicative_cma_format_label(self):
        payload = _cgtmse_payload()
        payload["business"]["business_type"] = "proprietorship"
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "Indicative CMA Format" in text
        assert "Schedule III Format" not in text

    def test_private_limited_keeps_schedule_iii_format_label(self):
        payload = _cgtmse_payload()
        payload["business"]["business_type"] = "private_limited"
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "Schedule III Format" in text


class TestRoeExcludesGovernmentSubsidy:
    """CA AUDIT: pb["equity"] used as the ROE denominator is Promoter Fixed
    Equity only — the Government/state capital subsidy is tracked
    separately in pb["margin_money"] and is never added into it — but the
    report never said so explicitly, leaving a reader to guess why ROE
    looked high relative to a Balance Sheet that also shows the subsidy
    inside Owners' Funds. Section 15 and Section 30's methodology must say
    so explicitly."""

    def test_roe_wording_explicitly_excludes_subsidy(self):
        payload = _msme_psu_subsidy_payload()
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        flat = " ".join(text.split())
        assert "excl. Subsidy" in flat or "excl. Govt. Subsidy" in flat
        assert "Average Promoter Equity" in flat
        assert "deliberately EXCLUDED from this denominator" in flat


class TestSubsidyAccountingTreatmentDisclosure:
    """CA AUDIT: the exact accounting treatment of a government/state
    capital subsidy depends on the specific scheme's conditions and the
    applicable accounting framework — this platform cannot assert one
    treatment (Capital Reserve vs Deferred Income vs netted against asset
    cost) as settled fact. Must be disclosed as indicative, with a place
    to record the scheme's own documentation."""

    def test_subsidy_note_is_indicative_not_asserted(self):
        payload = _msme_psu_subsidy_payload()
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        flat = " ".join(text.split())
        assert "This treatment is" in flat and "indicative" in flat
        assert "Capital Reserve" in flat and "Deferred Income" in flat

    def test_subsidy_scheme_details_shown_when_provided(self):
        payload = _msme_psu_subsidy_payload()
        payload["assumptions"]["capital_subsidy_scheme_details"] = (
            "MP State Capital Subsidy Scheme 2023, Order No. MSME/2023/451, "
            "Sanctioned 2024-08-01, Eligible Amount Rs.1,72,500, subject to 3-year lock-in."
        )
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        flat = " ".join(text.split())
        assert "MP State Capital Subsidy Scheme 2023" in flat
        assert "Order No. MSME/2023/451" in flat

    def test_subsidy_scheme_details_placeholder_shown_when_absent(self):
        payload = _msme_psu_subsidy_payload()
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        flat = " ".join(text.split())
        assert "Subsidy Scheme Details: not provided" in flat


class TestServiceWorkingCapitalCycleConsistency:
    """CA AUDIT: Section 16's own WC model for a SERVICE business never
    includes a Creditors/Payables Rs. line (no inventory bought on
    supplier credit) — but Section 18 used to always show "Less:
    Creditor/Payable Days" and net it against Receivable Days regardless,
    producing a Net Operating Cycle netted against a creditor figure with
    no corresponding Rs. amount anywhere in Section 16."""

    def test_service_business_section18_has_no_creditor_days_line(self):
        payload = _msme_psu_subsidy_payload()  # industry_type="service"
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        idx = text.find("Working Capital Cycle")
        section18 = text[idx:idx + 800]
        assert "Creditor" not in section18
        assert "NET OPERATING CYCLE" not in section18
        assert "Operating (Receivable) Cycle" in section18

    def test_manufacturing_business_section18_keeps_creditor_days_line(self):
        payload = _cgtmse_payload()  # industry_type="manufacturing"
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        idx = text.find("Working Capital Cycle")
        section18 = text[idx:idx + 800]
        assert "Creditor / Payable Days" in section18
        assert "NET OPERATING CYCLE" in section18


class TestTotalDebtSchedulePastFiveYears:
    """CA AUDIT: Year 6+ used to show Total Debt as "Rs.0*" whenever the
    Term Loan happened to be fully amortised by then — reading as "Total
    Debt is zero", when really the WC Bank Loan component (the other half
    of Total Debt) is simply unprojected that far, not zero."""

    def test_total_debt_beyond_year5_shows_not_projected_not_zero(self):
        payload = _cgtmse_payload()
        payload["assumptions"]["tenure_months"] = 84  # 7 years > 5-year WC projection
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        idx = text.find("H2. Total Debt Schedule")
        assert idx != -1
        section22 = text[idx:idx + 1200]
        assert "Not Projected" in section22
        assert "Rs.0*" not in section22 and "0*" not in section22.replace("Not Projected*", "")


class TestOperatingVsFinancialBreakEven:
    """CA AUDIT: "Fixed Expenses" in the break-even calc includes BOTH
    Depreciation and ALL Interest (Term Loan + WC) — a bare "BEP Sales"
    label reads as a pure operating break-even to a CA/banker when it's
    actually a financial one. Both must be shown, correctly labelled, and
    Financial BEP must always be >= Operating BEP for a leveraged project."""

    def test_both_bep_variants_shown_with_correct_labels(self):
        payload = _msme_psu_subsidy_payload()
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        flat = " ".join(text.split())
        assert "Operating Break-Even Sales (Excl. Financing Costs)" in flat
        assert "Financial Break-Even Sales (Incl. Dep & Interest)" in flat

    def test_financial_bep_at_least_operating_bep_every_year(self):
        payload = _msme_psu_subsidy_payload()
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        report_id = resp.json()["report_id"]
        dl = client.get(f"/api/v1/report/{report_id}/download")
        text = _download_pdf_text(report_id)
        idx = text.find("SECTION-M: BREAK EVEN POINT ANALYSIS")
        section25 = text[idx:idx + 1600]
        op_idx = section25.find("Operating Break-Even Sales")
        fin_idx = section25.find("Financial Break-Even Sales")
        assert op_idx != -1 and fin_idx != -1
        op_vals = re.findall(r"[\d,]+", section25[op_idx:op_idx + 200])[:5]
        fin_vals = re.findall(r"[\d,]+", section25[fin_idx:fin_idx + 200])[:5]
        op_nums = [float(v.replace(",", "")) for v in op_vals]
        fin_nums = [float(v.replace(",", "")) for v in fin_vals]
        assert len(op_nums) == 5 and len(fin_nums) == 5
        for o, f in zip(op_nums, fin_nums):
            assert f >= o


class TestPromoterDrawingsDisclosure:
    """CA AUDIT: promoter_drawings_pct defaults to 0% — PAT is projected as
    fully retained with no personal withdrawal assumed. For an
    owner-operated business this is a real, silent assumption worth
    surfacing rather than leaving unstated."""

    def test_zero_drawings_triggers_disclosure(self):
        payload = _msme_psu_subsidy_payload()
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "Promoter Drawings assumption is 0%" in text

    def test_nonzero_drawings_does_not_trigger_disclosure(self):
        payload = _msme_psu_subsidy_payload()
        payload["assumptions"]["promoter_drawings_pct"] = 40
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "Promoter Drawings assumption is 0%" not in text


class TestLongNatureOfBusinessTextNotTruncated:
    """CA AUDIT: nature_of_business is free text — a full business
    description (e.g. "Manufacturing and packaging of RO-purified
    drinking water in 20-litre jars for local retail and institutional
    supply") used to be silently cut at 60 characters with no ellipsis on
    the cover page, and used as a synthetic fallback product's "category"
    (a plain, un-wrapped string) in the "Annual Revenue at 100% Installed
    Capacity" table, where it overflowed into the price/quantity columns."""

    _LONG_DESC = ("Manufacturing and packaging of RO-purified drinking water "
                  "in 20-litre jars for local retail and institutional supply")

    def test_cover_page_shows_full_text_not_60_char_cutoff(self):
        """Scoped to JUST the cover page (before the first section) —
        the full description also legitimately appears elsewhere in the
        document (Section-A's own Business Overview), so a whole-document
        text search can't distinguish "shown in full on the cover page"
        from "the 60-char cutoff happened, but the full text still shows
        up later." Only a cover-page-scoped check catches the truncation."""
        payload = _cgtmse_payload()
        payload["business"]["nature_of_business"] = self._LONG_DESC
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        flat = " ".join(text.split())
        # Scope to the dark cover banner specifically — the "Field/
        # Details" table right below it (on the same physical cover
        # page) has its own, separately-fixed, untruncated "Business
        # Type / Loan Purpose" row, which would otherwise make this
        # assertion pass regardless of whether the banner itself was cut.
        cover_banner = flat[:flat.find("Applicant / Business Name")]
        assert self._LONG_DESC in cover_banner

    def test_project_overview_business_model_row_shows_full_text(self):
        """The "Business Model" row specifically used `_nature_biz[:60]`
        (character-level truncation, distinct from the "Nature of
        Project" row just above it, which was never sliced) — scope to
        that one row so the fix is actually exercised, not just the
        untruncated "Nature of Project" row next to it."""
        payload = _cgtmse_payload()
        payload["business"]["nature_of_business"] = self._LONG_DESC
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        flat = " ".join(text.split())
        idx = flat.find("Business Model")
        assert idx != -1
        assert self._LONG_DESC in flat[idx:idx + 200]

    def test_synthetic_fallback_product_name_in_revenue_table_not_truncated(self):
        """No explicit products list -> generator.py synthesizes one whose
        category is the long nature_of_business string; the "Annual
        Revenue at 100% Installed Capacity" table must render it in full,
        Paragraph-wrapped, not as a plain string overflowing the row."""
        payload = _cgtmse_payload()
        payload["business"]["nature_of_business"] = self._LONG_DESC
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        flat = " ".join(text.split())
        idx = flat.find("Annual Revenue at 100% Installed Capacity")
        assert idx != -1
        assert self._LONG_DESC in flat[idx:idx + 400]


class TestGenericRawMaterialTableOmitsPhantomZeroRows:
    """CA AUDIT: "Consumables" and "Packing Material" are legacy rows from
    a specific (leaf/tea-style) business model — generator.py always
    hardcodes both to 0 for the generic single-rate
    raw_material_cost_per_unit model every other manufacturing payload
    uses, so every such report showed two meaningless "Rs.0" rows."""

    def test_zero_cost_consumables_and_packing_rows_are_omitted(self):
        payload = _cgtmse_payload()
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        idx = text.find("D3. Raw Materials & Consumables Cost (100% Capacity)")
        assert idx != -1
        section = text[idx:idx + 500]
        # The row itself is "Raw Material & Consumables" — that's the only
        # legitimate occurrence of "Consumables" (inside the heading and
        # that one row); a standalone "Consumables" row would add a second.
        assert section.count("Consumables") == 2, section  # heading + the one combined row
        assert "Packing Material" not in section
        assert "Raw Material & Consumables" in section


class TestFixedAssetSupplierReferenceTableWraps:
    """CA AUDIT: a real machinery name (e.g. "Automatic Jar Rinsing,
    Filling & Capping Machine") is unbounded free text — the Supplier /
    Vendor Reference table's Equipment/Asset column used to render it as
    a plain string, overflowing straight into the Supplier Name column
    (this table's column is much narrower than the main machinery table's,
    so the same name that fit fine there did not fit here)."""

    def test_long_machinery_and_supplier_names_both_appear_in_full(self):
        payload = _cgtmse_payload()
        long_name = "Automatic Jar Rinsing, Filling & Capping Machine"
        long_supplier = "Shakti Pharmatech Private Limited"
        payload["project"]["machinery_items"][0] = {
            "name": long_name, "quantity": 1, "unit_price": 300000,
            "supplier_name": long_supplier, "supplier_city": "Ahmedabad",
        }
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        flat = " ".join(text.split())
        idx = flat.find("Supplier / Vendor Reference")
        assert idx != -1
        section = flat[idx:idx + 400]
        assert long_name in section
        assert long_supplier in section


class TestAdjustedDscrCaptionMatchesActualEmiSources:
    """CA AUDIT: for a New Business (Section-A correctly shows "No
    existing banking facilities"), the Adjusted DSCR caption used to
    unconditionally claim BOTH an "existing business loan EMI" AND a
    "personal home loan EMI" regardless of which actually had a nonzero
    value — reading as a direct contradiction of Section-A's own,
    correct disclosure when only the home loan EMI was real."""

    def test_new_business_with_only_home_loan_emi_does_not_mention_business_loan(self):
        payload = _msme_psu_subsidy_payload()
        payload["business"]["business_status"] = "New Business"
        payload["business"]["existing_monthly_emi"] = 0
        payload["promoter_net_worth"] = {"home_loan_emi": 4000}
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        flat = " ".join(text.split())
        idx = flat.find("Combined existing EMI")
        assert idx != -1
        caption = flat[idx:idx + 250]
        assert "existing business loan EMI" not in caption
        assert "personal home loan EMI" in caption

    def test_existing_business_with_both_emis_mentions_both(self):
        payload = _cgtmse_payload()
        payload["business"]["business_status"] = "Existing Business"
        payload["business"]["business_duration_months"] = 24
        payload["business"]["commencement_date"] = "2024-06-01"
        payload["business"]["existing_annual_turnover"] = 2000000
        payload["business"]["existing_annual_profit"] = 150000
        payload["business"]["existing_monthly_emi"] = 9000
        payload["promoter_net_worth"] = {"home_loan_emi": 5000}
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        flat = " ".join(text.split())
        idx = flat.find("Combined existing EMI")
        assert idx != -1
        caption = flat[idx:idx + 250]
        assert "existing business loan EMI" in caption
        assert "personal home loan EMI" in caption


class TestCollateralWordingIsHedgedNotCategorical:
    """CA AUDIT: "No collateral required" (PMEGP/Mudra/CGTMSE) was stated
    as flat fact for every report of that scheme, regardless of the
    applicant's actual sanctioned exposure or the lender's own policy —
    each scheme's collateral exemption is conditional, not an
    unconditional guarantee this platform can certify."""

    def test_pmegp_collateral_wording_is_hedged(self):
        payload = _msme_psu_subsidy_payload()
        payload["scheme"] = "pmegp"
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "No collateral required" not in text
        assert "to be confirmed by the financing bank" in text


class TestHalfYearlyLabelIsPrincipalOnly:
    def test_label_says_principal_repayment_not_bare_instalment(self):
        payload = _cgtmse_payload()
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "Half-Yearly Principal Repayment" in text
        assert "Half-Yearly Instalment" not in text


class TestViabilityGradeDisclaimerPresent:
    def test_executive_summary_banner_has_not_a_bank_rating_disclaimer(self):
        payload = _cgtmse_payload()
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        flat = " ".join(text.split())
        assert "not a bank sanction rating" in flat
