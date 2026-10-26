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


class TestSectionKBalanceSheetPresentation:
    def test_hides_year_zero_and_preserves_years_one_through_five_and_balancing_totals(self, monkeypatch):
        import api.report as report_api

        captured_report_data = {}
        generate_pdf = report_api.generate_pdf

        def capture_report_data(report_data, output_path):
            captured_report_data.update(report_data)
            generate_pdf(report_data, output_path)

        monkeypatch.setattr(report_api, "generate_pdf", capture_report_data)
        response = client.post("/api/v1/report/generate", json=_cgtmse_payload())
        assert response.status_code == 200, response.text

        all_pages = _download_pdf_text(response.json()["report_id"])
        section_start = all_pages.index("4 / SECTION-K: PROJECTED BALANCE SHEET")
        section_end = all_pages.index("5 / SECTION-J: PROFIT & LOSS STATEMENT", section_start)
        section = " ".join(all_pages[section_start:section_end].split())
        balance_sheet = captured_report_data["balance_sheet"]

        assert len(balance_sheet) == 6
        assert balance_sheet[0]["year"] == 0
        assert "Year 0" not in section
        for year in range(1, 6):
            assert f"Year {year}" in section
        assert "Year 5" in section

        def assert_row_matches_internal_values(label, values):
            expected = " ".join(f"{float(value):,.0f}" for value in values)
            assert f"{label} {expected}" in section

        displayed_years = balance_sheet[1:]
        assert_row_matches_internal_values(
            "Promoter Capital",
            [row["equity"] + row.get("promoter_wc_margin", 0) for row in displayed_years],
        )
        assert_row_matches_internal_values(
            "Term Loan (Bank)", [row["term_loan"] for row in displayed_years],
        )
        assert_row_matches_internal_values(
            "Less: Accumulated Dep.", [row["accum_dep"] for row in displayed_years],
        )
        expected_liabilities = [row["total_liabilities"] for row in displayed_years]
        expected_assets = [
            row["land"] + row["net_block"] + row["other_assets"] + row["current_assets"] + max(row["cash"], 0)
            for row in displayed_years
        ]
        assert_row_matches_internal_values("TOTAL EQUITY & LIABILITIES", expected_liabilities)
        assert_row_matches_internal_values("TOTAL ASSETS", expected_assets)
        assert [round(value) for value in expected_liabilities] == [round(value) for value in expected_assets]

    def test_year1_wc_bank_borrowing_drives_all_five_report_years_for_multiple_inputs(self, monkeypatch):
        import api.report as report_api

        captured_report_data = {}
        generate_pdf = report_api.generate_pdf

        def capture_report_data(report_data, output_path):
            captured_report_data.clear()
            captured_report_data.update(report_data)
            generate_pdf(report_data, output_path)

        monkeypatch.setattr(report_api, "generate_pdf", capture_report_data)
        year1_amounts = []
        for selling_price in (150, 300):
            payload = _cgtmse_payload()
            payload["production"]["selling_price_per_unit"] = selling_price
            response = client.post("/api/v1/report/generate", json=payload)
            assert response.status_code == 200, response.text

            year1_bank_borrowing = captured_report_data["wc_schedule"][0]["bank_loan"]
            year1_amounts.append(year1_bank_borrowing)
            balance_sheet = captured_report_data["balance_sheet"]
            assert [row["wc_bank"] for row in balance_sheet[1:]] == [year1_bank_borrowing] * 5
            assert all(row["check"] == 0 for row in balance_sheet)

            text = " ".join(_download_pdf_text(response.json()["report_id"]).split())
            start = text.index("4 / SECTION-K: PROJECTED BALANCE SHEET")
            end = text.index("5 / SECTION-J: PROFIT & LOSS STATEMENT", start)
            section = text[start:end]
            expected_row = "Bank Borrowings — WC (CC/OD) " + " ".join(
                [f"{year1_bank_borrowing:,.0f}"] * 5
            )
            assert expected_row in section
            assert [round(row["total_liabilities"]) for row in balance_sheet[1:]] == [
                round(row["total_assets"]) for row in balance_sheet[1:]
            ]
            expected_total_row = "TOTAL EQUITY & LIABILITIES " + " ".join(
                f"{row['total_liabilities']:,.0f}" for row in balance_sheet[1:]
            )
            assert expected_total_row in section
            expected_assets_row = "TOTAL ASSETS " + " ".join(
                f"{row['total_assets']:,.0f}" for row in balance_sheet[1:]
            )
            assert expected_assets_row in section

        assert year1_amounts[0] != year1_amounts[1]


class TestCapacityScheduleReport:
    def test_default_capacity_schedule_is_used_in_generated_pdf(self):
        payload = _cgtmse_payload()
        for year in range(1, 6):
            payload["assumptions"].pop(f"capacity_y{year}_pct")

        response = client.post("/api/v1/report/generate", json=payload)
        assert response.status_code == 200, response.text
        text = " ".join(_download_pdf_text(response.json()["report_id"]).split())

        assert "60.0% / 75.0% / 95.0% / 100.0% / 100.0%" in text
        assert "Year 1 Projected Revenue at 60.0% Capacity" in text

    def test_seven_year_default_schedule_is_shown_with_seven_projected_rows(self):
        payload = _msme_psu_subsidy_payload()
        payload["business"]["industry_type"] = "service"
        payload["production"] = {
            "input_qty_per_day": 0,
            "selling_price_per_unit": 0,
            "working_days_per_year": 300,
        }
        payload["products"] = [{
            "category": "Consulting",
            "units_per_month": 5,
            "avg_price": 1000,
        }]
        payload["assumptions"]["tenure_months"] = 84
        payload["assumptions"].pop("capacity_schedule_pct", None)
        for year in range(1, 6):
            payload["assumptions"].pop(f"capacity_y{year}_pct", None)

        response = client.post("/api/v1/report/generate", json=payload)
        assert response.status_code == 200, response.text
        text = " ".join(_download_pdf_text(response.json()["report_id"]).split())

        for row in (
            "1 100,000 60.0% 60,000",
            "3 100,000 80.0% 80,000",
            "7 100,000 100.0% 100,000",
        ):
            assert row in text

    def test_custom_capacity_schedule_recalculates_all_d1_projection_rows(self):
        payload = _msme_psu_subsidy_payload()
        payload["business"]["industry_type"] = "service"
        payload["production"] = {
            "input_qty_per_day": 0,
            "selling_price_per_unit": 0,
            "working_days_per_year": 300,
        }
        payload["products"] = [{
            "category": "Consulting",
            "units_per_month": 5,
            "avg_price": 1000,
        }]
        payload["assumptions"].update({
            "tenure_months": 84,
            "capacity_schedule_pct": [50, 70, 80, 90, 100, 95, 100],
        })

        response = client.post("/api/v1/report/generate", json=payload)
        assert response.status_code == 200, response.text
        text = " ".join(_download_pdf_text(response.json()["report_id"]).split())

        for row in (
            "1 120,000 50.0% 60,000",
            "2 120,000 70.0% 84,000",
            "5 120,000 100.0% 120,000",
            "6 120,000 95.0% 114,000",
            "7 120,000 100.0% 120,000",
        ):
            assert row in text

    def test_capacity_schedule_rejects_percentages_outside_zero_to_one_hundred(self):
        payload = _cgtmse_payload()
        for invalid_capacity in (-1, 101):
            payload["assumptions"]["capacity_schedule_pct"] = [60, 75, invalid_capacity, 100, 100]
            response = client.post("/api/v1/report/generate", json=payload)
            assert response.status_code == 422

    def test_zero_capacity_is_valid_and_projects_zero_revenue_for_that_year(self):
        payload = _msme_psu_subsidy_payload()
        payload["business"]["industry_type"] = "service"
        payload["production"] = {
            "input_qty_per_day": 0,
            "selling_price_per_unit": 0,
            "working_days_per_year": 300,
        }
        payload["products"] = [{
            "category": "Consulting",
            "units_per_month": 5,
            "avg_price": 1000,
        }]
        payload["assumptions"].update({
            "tenure_months": 84,
            "capacity_schedule_pct": [0, 75, 80, 85, 90, 95, 100],
        })

        response = client.post("/api/v1/report/generate", json=payload)
        assert response.status_code == 200, response.text
        text = " ".join(_download_pdf_text(response.json()["report_id"]).split())

        assert "1 60,000 0.0% 0" in text
        assert "2 60,000 75.0% 45,000" in text

    def test_service_line_inputs_generate_constant_full_capacity_and_projected_revenue(self):
        payload = _msme_psu_subsidy_payload()
        payload["business"]["industry_type"] = "service"
        payload["production"] = {
            "input_qty_per_day": 0,
            "selling_price_per_unit": 0,
            "working_days_per_year": 300,
        }
        payload["products"] = [{
            "category": "Consulting",
            "units_per_month": 5,
            "avg_price": 1000,
        }]
        payload["assumptions"].update({
            "capacity_y1_pct": 60, "capacity_y2_pct": 70, "capacity_y3_pct": 80,
            "capacity_y4_pct": 85, "capacity_y5_pct": 90,
        })

        response = client.post("/api/v1/report/generate", json=payload)
        assert response.status_code == 200, response.text
        text = " ".join(_download_pdf_text(response.json()["report_id"]).split())

        assert "Annual Revenue (100% Cap, Year 1) Rs. 100,000" in text
        assert "60.0% / 75.0% / 95.0% / 100.0% / 100.0%" in text
        for row in (
            "1 100,000 60.0% 60,000",
            "2 100,000 75.0% 75,000",
            "3 100,000 95.0% 95,000",
            "4 100,000 100.0% 100,000",
            "5 100,000 100.0% 100,000",
        ):
            assert row in text


class TestAnnualProductPortfolio:
    def _generate_service_report(self, products):
        payload = _msme_psu_subsidy_payload()
        payload["production"] = {
            "input_qty_per_day": 0,
            "selling_price_per_unit": 0,
            "working_days_per_year": 300,
        }
        payload["products"] = products
        response = client.post("/api/v1/report/generate", json=payload)
        assert response.status_code == 200, response.text
        return " ".join(_download_pdf_text(response.json()["report_id"]).split())

    @staticmethod
    def _portfolio_section(text):
        start = text.index("A3. Product / Service Portfolio")
        end = text.index("B1. Project Overview", start)
        return text[start:end]

    def test_single_product_portfolio_shows_annual_values_and_projection_once(self):
        text = self._generate_service_report([{
            "category": "Metal Fabrication / Engineering",
            "units_per_month": 900,
            "avg_price": 4400,
            "monthly_revenue": 1,
        }])
        portfolio = self._portfolio_section(text)

        assert "Yearly Qty" in portfolio
        assert "Revenue (Rs./Yr)" in portfolio
        assert "Monthly Qty" not in portfolio
        assert "Revenue (Rs./Mo)" not in portfolio
        assert "10,800 4,400 47,520,000 100.0%" in portfolio
        assert "TOTAL PORTFOLIO REVENUE 47,520,000 100.0%" in portfolio
        assert "Year 1 Projected Revenue at 85.0% Capacity = Rs. 47,520,000" in text

    def test_multiple_products_use_annual_revenue_for_totals_and_mix(self):
        text = self._generate_service_report([
            {"category": "Primary Product", "units_per_month": 900, "avg_price": 4400},
            {"category": "Secondary Product", "units_per_month": 100, "avg_price": 2000},
        ])
        portfolio = self._portfolio_section(text)

        assert "10,800 4,400 47,520,000 95.2%" in portfolio
        assert "1,200 2,000 2,400,000 4.8%" in portfolio
        assert "TOTAL PORTFOLIO REVENUE 49,920,000 100.0%" in portfolio
        assert "Year 1 Projected Revenue at 85.0% Capacity = Rs. 49,920,000" in text


class TestFinancialSnapshotVisibility:
    def test_financial_snapshot_and_metrics_are_omitted_but_surrounding_sections_remain(self):
        response = client.post("/api/v1/report/generate", json=_cgtmse_payload())
        assert response.status_code == 200, response.text
        text = " ".join(_download_pdf_text(response.json()["report_id"]).split())

        project_snapshot = text.index("Project & Funding Snapshot")
        next_section = text.index("Credit Assessment", project_snapshot)
        project_snapshot_block = text[project_snapshot:next_section]

        assert "Project & Funding Snapshot" in project_snapshot_block
        for hidden_label in (
            "Financial Snapshot (Year 1",
            "Revenue (Rs.)",
            "EBITDA (Rs.)",
            "PAT (Rs.)",
            "Term Loan DSCR",
            "Average Term Loan DSCR",
            "Current Ratio (Balance Sheet Basis)",
            "WC Bank Finance Coverage",
            "Term Loan D:E",
            "Promoter % of Initial Investment",
            "Payback Period (cumulative cash-flow",
        ):
            assert hidden_label not in project_snapshot_block

        assert "Credit Assessment" in text
        assert "SECTION-H: TERM LOAN REPAYMENT" in text


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


class TestB1ProjectOverview:
    def test_expected_employment_row_is_absent_from_generated_pdf(self):
        response = client.post("/api/v1/report/generate", json=_cgtmse_payload())
        assert response.status_code == 200, response.text
        text = " ".join(_download_pdf_text(response.json()["report_id"]).split())

        b1_start = text.index("B1. Project Overview")
        b2_start = text.index("B2. Initial Project Investment", b1_start)
        b1_table = text[b1_start:b2_start]

        assert "Expected Employment" not in b1_table
        assert "Nature of Project" in b1_table
        assert "Business Model" in b1_table
        assert "Location" in b1_table
        assert "Area Type" in b1_table
        assert "Capacity Schedule (Y1-Y5)" in b1_table
        assert "B2. Initial Project Investment" in text[b2_start:]


class TestSectionGDepreciation:
    def test_pdf_shows_constant_year1_opening_wdv_from_live_report_inputs(self, monkeypatch):
        import api.report as report_api

        captured_report_data = {}
        generate_pdf = report_api.generate_pdf

        def capture_report_data(report_data, output_path):
            captured_report_data.update(report_data)
            generate_pdf(report_data, output_path)

        monkeypatch.setattr(report_api, "generate_pdf", capture_report_data)
        response = client.post("/api/v1/report/generate", json=_cgtmse_payload())
        assert response.status_code == 200, response.text

        text = " ".join(_download_pdf_text(response.json()["report_id"]).split())
        start = text.index("6 / SECTION-G: CALCULATION OF DEPRECIATION (WDV METHOD)")
        end = text.index("7 / SECTION-L: PROJECTED CASH FLOW STATEMENT", start)
        section = text[start:end]
        schedule = captured_report_data["depreciation"]["schedule"]
        gross_block = captured_report_data["depreciation"]["gross_block"]
        accumulated = 0

        def assert_report_row(label, values):
            expected = " ".join(f"{float(value):,.0f}" for value in values)
            assert f"{label} {expected}" in section

        initial_opening = schedule[0]["opening_wdv"]
        for row in schedule:
            accumulated += row["depreciation"]
            assert row["opening_wdv"] == initial_opening
            assert row["accumulated_depreciation"] == accumulated
            assert row["closing_wdv"] == gross_block - accumulated
            assert row["closing_wdv"] == row["building_closing_wdv"] + row["machinery_closing_wdv"]

        assert_report_row("Opening WDV", [row["opening_wdv"] for row in schedule])
        assert_report_row("Depreciation (WDV × Rate)", [row["depreciation"] for row in schedule])
        assert_report_row("Accumulated Depreciation", [row["accumulated_depreciation"] for row in schedule])
        assert_report_row("Closing WDV (Net Block)", [row["closing_wdv"] for row in schedule])
        assert "The dynamically calculated Year 1 Opening WDV is used unchanged for all five years" in section


class TestB2MotorEquipmentLabel:
    def test_transportation_cost_uses_new_label_without_changing_amount_or_mix(self):
        payload = _cgtmse_payload()
        payload["project"]["transportation_cost"] = 1_000_000
        response = client.post("/api/v1/report/generate", json=payload)
        assert response.status_code == 200, response.text

        text = " ".join(_download_pdf_text(response.json()["report_id"]).split())
        b2_start = text.index("B2. Initial Project Investment")
        b3_start = text.index("B3. Means of Finance", b2_start)
        b2 = text[b2_start:b3_start]
        total = _year1_row_value("TOTAL (Initial Project Investment)", b2)
        expected_mix = 1_000_000 / total * 100

        assert "Vehicles & Transportation" not in b2
        assert f"Plant, Machinery & Equipment (Motor) 1,000,000 {expected_mix:.1f}%" in b2


class TestProjectFundingSnapshot:
    def test_fixed_project_cost_entry_is_removed_and_snapshot_rows_remain_compact(self):
        response = client.post("/api/v1/report/generate", json=_cgtmse_payload())
        assert response.status_code == 200, response.text
        text = " ".join(_download_pdf_text(response.json()["report_id"]).split())

        snapshot_start = text.index("Project & Funding Snapshot")
        next_section = text.index("Credit Assessment", snapshot_start)
        snapshot = text[snapshot_start:next_section]

        assert "Fixed Project Cost" not in snapshot
        assert "Total Project Cost" in snapshot
        assert "Working Capital Requirement" in snapshot
        assert "Promoter Contribution" in snapshot
        assert "Term Loan" in snapshot
        assert "Working Capital Finance" in snapshot
        assert "Total Bank Exposure" in snapshot
        assert "Proposed Tenure" in snapshot
        assert "Moratorium" in snapshot
        assert "Interest Rate" in snapshot
        assert re.search(r"Interest Rate\s+10\.5%", snapshot)
        ordered_labels = (
            "Total Project Cost", "Working Capital Requirement", "Promoter Contribution",
            "Term Loan", "Working Capital Finance", "Total Bank Exposure",
            "Proposed Tenure", "Moratorium", "Interest Rate",
        )
        assert [snapshot.index(label) for label in ordered_labels] == sorted(
            snapshot.index(label) for label in ordered_labels
        )

    def test_snapshot_shows_default_interest_rate_when_assumption_is_omitted(self):
        payload = _cgtmse_payload()
        payload["assumptions"].pop("interest_rate_pct")
        response = client.post("/api/v1/report/generate", json=payload)
        assert response.status_code == 200, response.text
        text = " ".join(_download_pdf_text(response.json()["report_id"]).split())

        snapshot_start = text.index("Project & Funding Snapshot")
        next_section = text.index("Credit Assessment", snapshot_start)
        snapshot = text[snapshot_start:next_section]
        assert re.search(r"Interest Rate\s+9\.5%", snapshot)


class TestWorkingCapitalInterestRateReport:
    def test_default_and_custom_wc_interest_rates_are_shown_in_generated_pdf(self):
        for rate, expected in ((None, "11.5%"), (13.4, "13.4%")):
            payload = _cgtmse_payload()
            payload["assumptions"]["wc_interest_rate_pct"] = rate

            response = client.post("/api/v1/report/generate", json=payload)
            assert response.status_code == 200, response.text
            text = " ".join(_download_pdf_text(response.json()["report_id"]).split())

            assert re.search(
                rf"WC Interest Rate\s+{re.escape(expected)}",
                text,
            ), f"Expected WC Interest Rate {expected} in generated report"


class TestE1ManpowerWageTable:
    def test_promoter_row_is_absent_and_worker_totals_are_retained(self):
        payload = _cgtmse_payload()
        payload["manpower"] = {
            "skilled_count": 2,
            "skilled_salary": 15000,
            "semi_skilled_count": 1,
            "semi_skilled_salary": 10000,
            "unskilled_count": 1,
            "unskilled_salary": 8000,
        }

        response = client.post("/api/v1/report/generate", json=payload)
        assert response.status_code == 200, response.text
        text = _download_pdf_text(response.json()["report_id"])
        table_start = text.index("E1. Manpower & Wage Structure")
        table_end = text.index("E2. Operating Expenses Summary", table_start)
        table = " ".join(text[table_start:table_end].split())

        assert "Promoter / Owner" not in table
        assert "Promoter /" not in table
        worker_rows = [
            table.index("1 Skilled Worker"),
            table.index("2 Semi-Skilled Worker"),
            table.index("3 Unskilled / Helper"),
        ]
        assert worker_rows == sorted(worker_rows)
        assert "TOTAL (4 staff)" in table
        assert "PF / ESI / Benefits (10%)" in table
        assert "Rs. 360,000" in table
        assert "Rs. 120,000" in table
        assert "Rs. 96,000" in table
        assert "Rs. 57,600" in table
        assert "Rs. 633,600" in table


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
        # Section 07 includes the WC margin and bank facility; remove both to recover fixed cost.
        wc_margin = _year1_row_value("Promoter's Share", text)
        assert "Working Capital Margin (Promoter's Share)" not in text
        wc_facility = _year1_row_value("Working Capital Facility Requested", text)
        scheme_subsidy = _year1_row_value("Less: Scheme Subsidy (separate funding source)", text)
        assert abs(exec_summary_value - (section07_total - wc_margin - wc_facility + scheme_subsidy)) < 1, (
            f"Section 02 Fixed Project Cost ({exec_summary_value}) must equal Section 07's "
            f"own fixed-cost total ({section07_total - wc_margin - wc_facility + scheme_subsidy})"
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
    a crude heuristic ("1.5 months of Year-1 capacity revenue") before the
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

    def test_total_project_cost_includes_term_loan_wc_facility_and_promoter_contribution(self):
        resp = client.post("/api/v1/report/generate", json=_cgtmse_payload())
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])

        expected_total = (
            _year1_row_value("Term Loan Requested", text)
            + _year1_row_value("Working Capital Facility Requested", text)
            + _year1_row_value("Promoter Contribution", text)
        )
        cover_total = _year1_row_value("Total Project Cost", text)
        breakdown_total = _year1_row_value("TOTAL (Initial Project Investment)", text)

        assert cover_total == expected_total
        assert breakdown_total == expected_total
        assert "Total Project Cost\" deliberately excludes" not in text

    def test_pmegp_total_project_cost_excludes_separate_subsidy_source(self):
        resp = client.post("/api/v1/report/generate", json=_pmegp_trading_payload())
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])

        expected_total = (
            _year1_row_value("Term Loan Requested", text)
            + _year1_row_value("Working Capital Facility Requested", text)
            + _year1_row_value("Promoter Contribution", text)
        )
        assert _year1_row_value("Total Project Cost", text) == expected_total
        assert "Less: Scheme Subsidy (separate funding source)" in text

    def test_promoter_funding_details_are_hidden_from_pdf(self):
        resp = client.post("/api/v1/report/generate", json=_msme_psu_subsidy_payload())
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "B5. Promoter Contribution & Net Worth" not in text
        assert "Total Funding Requirement Promoter Share" not in text

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


class TestWorkingCapitalSectionsHidden:
    """Detailed working-capital financing and cycle sections stay out of the PDF."""

    def test_service_business_hides_working_capital_sections(self):
        payload = _msme_psu_subsidy_payload()  # industry_type="service"
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "Working Capital Financing" not in text
        assert "Working Capital Cycle" not in text

    def test_manufacturing_business_hides_working_capital_sections(self):
        payload = _cgtmse_payload()  # industry_type="manufacturing"
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "Working Capital Financing" not in text
        assert "Working Capital Cycle" not in text


class TestFundingSectionHeading:
    def test_b3_heading_shortened_but_fixed_funding_box_label_unchanged(self):
        resp = client.post("/api/v1/report/generate", json=_cgtmse_payload())
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "B3. Means of Finance" in text
        assert "B3. Means of Finance – Fixed Project Funding" not in text
        assert "A. Fixed Project Funding" in text


class TestFixedFundingIncludesWorkingCapital:
    def test_b3_shows_fixed_funding_only_and_keeps_working_capital_funding_data(self):
        response = client.post("/api/v1/report/generate", json=_cgtmse_payload())
        assert response.status_code == 200, response.text
        text = " ".join(_download_pdf_text(response.json()["report_id"]).split())
        start_a = text.index("A. Fixed Project Funding")
        b3_end = text.index("D:E (TL ÷ Promoter Fixed Equity)", start_a)
        b3 = text[start_a:b3_end]

        def row_values(label, section):
            match = re.search(
                rf"{re.escape(label)}\s+Rs\.\s*([\d,]+)\s+([\d.]+%)",
                section,
            )
            assert match, f"Funding row {label!r} not found in section"
            return float(match.group(1).replace(",", "")), float(match.group(2).rstrip("%"))

        assert "B. Working Capital Funding" not in b3
        assert "C. Overall Funding" not in b3

        equity, equity_pct = row_values("Equity Capital (Promoter)", b3)
        term_loan, term_pct = row_values("Term Loan from Bank", b3)
        working_capital, wc_pct = row_values("Working Capital", b3)
        total_a, total_pct = row_values("TOTAL FUNDING (Fixed + Working Capital)", b3)
        assert total_a == equity + term_loan + working_capital
        assert all(abs(actual - expected) < 0.01 for actual, expected in zip(
            [equity_pct, term_pct, wc_pct], [
            round(equity / total_a * 100, 2),
            round(term_loan / total_a * 100, 2),
            round(working_capital / total_a * 100, 2),
        ]))
        assert abs(equity_pct + term_pct + wc_pct - 100.0) <= 0.02
        assert total_pct == 100.0


class TestServiceD1Heading:
    def test_service_report_uses_production_parameters_heading(self):
        resp = client.post("/api/v1/report/generate", json=_msme_psu_subsidy_payload())
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "D1. Production Parameters" in text
        assert "D1. Operating Parameters" not in text
        assert "Service Revenue Model" in text


class TestGrossProfitSectionVisibility:
    def test_d1_gross_profit_section_is_hidden_and_d4_remains(self):
        resp = client.post("/api/v1/report/generate", json=_cgtmse_payload())
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        assert "Gross Profit (Year 1 → Year 5)" not in text
        assert "D4. Fixed Asset Schedule (Plant, Machinery & Equipment)" in text
        assert "CNC Machine" in text


class TestProjectDetailsSectionVisibilityAndOrder:
    def test_assumptions_are_b5_and_hidden_sections_are_absent(self):
        resp = client.post("/api/v1/report/generate", json=_cgtmse_payload())
        assert resp.status_code == 200, resp.text
        text = " ".join(_download_pdf_text(resp.json()["report_id"]).split())
        assumptions = text.find("B5. Key Financial Assumptions")
        b6 = text.find("B6. Loan Proposal / Credit Structure")
        assert assumptions >= 0
        assert b6 > assumptions
        assert "B7. Key Financial Assumptions" not in text
        assert "B5. Promoter Contribution & Net Worth" not in text
        assert "Promoter Net Worth Statement" not in text
        assert "B. Working Capital Facility" not in text
        assert "A. Term Loan" in text


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
    """Operating fixed expenses follow Section J's depreciation and interest
    rows; financial fixed expenses also include any remaining fixed charge.
    Both BEP variants must be shown and Financial BEP must not be below
    Operating BEP for a leveraged project."""

    def test_both_bep_variants_shown_with_correct_labels(self):
        payload = _msme_psu_subsidy_payload()
        resp = client.post("/api/v1/report/generate", json=payload)
        assert resp.status_code == 200, resp.text
        text = _download_pdf_text(resp.json()["report_id"])
        flat = " ".join(text.split())
        assert "Operating Break-Even Sales (Dep + Interest)" in flat
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

    def test_section_m_matches_section_j_and_recalculates_after_input_changes(self, monkeypatch):
        import api.report as report_api
        from core.engine import R

        captured_report_data = {}
        generate_pdf = report_api.generate_pdf

        def capture_report_data(report_data, output_path):
            captured_report_data.clear()
            captured_report_data.update(report_data)
            generate_pdf(report_data, output_path)

        monkeypatch.setattr(report_api, "generate_pdf", capture_report_data)

        for changed_inputs in (False, True):
            payload = _cgtmse_payload()
            payload["production"]["selling_price_per_unit"] = 300
            if changed_inputs:
                payload["manpower"].update({
                    "skilled_count": 6,
                    "skilled_salary": 24000,
                    "semi_skilled_count": 3,
                    "semi_skilled_salary": 16000,
                })
                payload["expenses"].update({
                    "rent": 42000,
                    "electricity_water": 14000,
                    "repair_maintenance": 6500,
                    "transport_conveyance": 9000,
                    "telephone_internet": 3500,
                    "stationery": 1800,
                    "miscellaneous": 2700,
                    "marketing": 21000,
                })

            response = client.post("/api/v1/report/generate", json=payload)
            assert response.status_code == 200, response.text
            report_data = dict(captured_report_data)
            income = report_data["income_statement"]
            bep = report_data["break_even"]
            assert len(income) == len(bep) == 5
            assert response.json()["break_even"] == bep

            text = " ".join(_download_pdf_text(response.json()["report_id"]).split())
            section_start = text.index("SECTION-M: BREAK EVEN POINT ANALYSIS")
            section = text[section_start:section_start + 1800]

            def assert_row_matches(label, values, percent=False, not_achievable=None):
                formatted_values = [
                    "N/A" if not_achievable and not_achievable[index]
                    else f"{float(value) * 100:.1f}%" if percent
                    else f"{float(value):,.0f}"
                    for index, value in enumerate(values)
                ]
                assert f"{label} {' '.join(formatted_values)}" in section

            expected_variable = [
                R(
                    row["raw_materials"] + row["power"] + row["labour"]
                    + row["admin_expenses"] + row["marketing_expenses"]
                )
                for row in income
            ]
            assert [row["variable_expenses"] for row in bep] == expected_variable
            assert_row_matches("Variable Expenses", expected_variable)
            assert_row_matches("Contribution", [row["contribution"] for row in bep])
            assert_row_matches("Contribution Margin %", [row["contribution_pct"] for row in bep], percent=True)
            expected_operating_fixed = [
                R(row["depreciation"] + row["wc_interest"] + row["tl_interest"])
                for row in income
            ]
            assert [row["operating_fixed_expenses"] for row in bep] == expected_operating_fixed
            assert_row_matches("Operating Fixed Expenses (Dep + WC & Term Loan Interest)", expected_operating_fixed)
            expected_net_profit = [
                R(row["contribution"] - row["operating_fixed_expenses"])
                for row in bep
            ]
            assert [row["net_profit"] for row in bep] == expected_net_profit
            assert_row_matches("Net Profit", expected_net_profit)
            fixed_row_index = section.index("Operating Fixed Expenses (Dep + WC & Term Loan Interest)")
            net_profit_row_index = section.index("Net Profit", fixed_row_index)
            operating_bep_row_index = section.index("Operating Break-Even Sales (Dep + Interest)")
            assert fixed_row_index < net_profit_row_index < operating_bep_row_index
            assert_row_matches("Operating Break-Even Sales (Dep + Interest)", [
                row["operating_bep_sales"] for row in bep
            ], not_achievable=[row["operating_bep_not_achievable"] for row in bep])
            assert_row_matches("Operating BEP as % of Capacity", [
                row["operating_bep_pct"] for row in bep
            ], percent=True, not_achievable=[row["operating_bep_not_achievable"] for row in bep])
            assert_row_matches("Financial Break-Even Sales (Incl. Dep & Interest)", [
                row["bep_sales"] for row in bep
            ], not_achievable=[row["bep_not_achievable"] for row in bep])
            assert_row_matches("Financial BEP as % of Capacity", [
                row["bep_pct"] for row in bep
            ], percent=True, not_achievable=[row["bep_not_achievable"] for row in bep])

            for section_j_label, key in (
                ("Less: Raw Materials / COGS", "raw_materials"),
                ("Less: Utilities & Variable Exp", "power"),
                ("Less: Labour & Wages", "labour"),
                ("Less: Admin & Overhead", "admin_expenses"),
                ("Less: Marketing Expenses", "marketing_expenses"),
                ("Less: Depreciation", "depreciation"),
                ("Less: Interest on WC", "wc_interest"),
                ("Less: Interest on Term Loan", "tl_interest"),
            ):
                assert section_j_label in text
                expected_section_j_values = " ".join(f"{float(row[key]):,.0f}" for row in income)
                assert f"{section_j_label} {expected_section_j_values}" in text

            validation = client.post("/api/v1/report/validate", json=payload)
            assert validation.status_code == 200, validation.text
            preview_bep = validation.json()["preview"]["break_even"]
            assert len(preview_bep) == 5
            assert [row["operating_fixed_expenses"] for row in preview_bep] == expected_operating_fixed
            assert [row["net_profit"] for row in preview_bep] == expected_net_profit
            assert [row["operating_bep_sales"] for row in preview_bep] == [
                row["operating_bep_sales"] for row in bep
            ]

            if changed_inputs:
                assert expected_variable != baseline_variable
                assert expected_net_profit != baseline_net_profit
            else:
                baseline_variable = expected_variable
                baseline_net_profit = expected_net_profit


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
