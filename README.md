# EazyBizy — Government Loan Assistance Platform

> **Version:** 3.4.0
> **Date:** 9 September 2026
> **Status:** Production Ready

## Release Note — Section M Net Profit Row

Section M now includes **Net Profit** immediately below **Operating Fixed Expenses** and before **Operating Break-Even Sales**. For each projected year, the value is calculated dynamically as `Contribution − Operating Fixed Expenses`. The current Section M operating fixed-expense definition is the corresponding Section J **Depreciation + Interest on WC + Interest on Term Loan**; therefore this Net Profit figure includes depreciation and both interest charges through that expense base. It is calculated from the same year-wise contribution and operating fixed-expense values already used for break-even analysis, with the existing whole-rupee rounding.

`backend/calculations/break_even.py` supplies the shared report/API values and `backend/core/engine.py` supplies the legacy report calculation path. `backend/pdf/builder.py` renders the row in the specified order, while `src/components/gtab/ApplicationPreview.tsx` displays the same generated values. The report does not hardcode year amounts or calculate Net Profit separately in the PDF or preview.

**Validation:** Focused backend calculation, legacy master-report calculation, and API/PDF integration checks passed (**11 passed**). They verify all five yearly formulas, the Section M row order and generated PDF values, preview values, and changed inputs. The application-preview test passed (**3 passed**), and `npm.cmd run build` passed. A fresh API-generated CMA PDF (`28FF5337`) returned **PASS**; Section M Net Profit matched Contribution less Operating Fixed Expenses for all five years and the PDF row order was confirmed. The PDF is available at [backend/generated_reports/CMA_Section_M_Net_Profit_Validation.pdf](backend/generated_reports/CMA_Section_M_Net_Profit_Validation.pdf).

## Release Note — 24 October 2026 (Section M Operating Fixed Expenses)

Section M's **Operating Fixed Expenses** are now calculated separately for each projected year as the sum of that year's **Depreciation + Interest on WC + Interest on Term Loan** from Section J. The values are derived from the shared projected income-statement rows; the figures in the report examples are not hardcoded. Operating Break-Even Sales is `Operating Fixed Expenses / Contribution Margin Ratio`; Operating BEP as % of Capacity is `Operating Break-Even Sales / Revenue at 100% Capacity`. Both are recalculated using each year's current contribution margin. The Financial Fixed Expenses and both financial BEP metrics continue to use their existing fixed-cost treatment, including any remaining fixed charge, plus that year's depreciation and interest. The generated report response and application preview use the same five-year break-even calculation as the PDF.

The calculation remains centralized in `backend/calculations/break_even.py`. The generated CMA PDF renders those same calculated values in `backend/pdf/builder.py`, and `/api/v1/report/validate` now includes the five-year break-even rows in its preview response so consumers can inspect the same metrics before generating the report. `src/hooks/useReportGenerator.ts` describes the typed preview response. Existing year-wise inputs, rounding, and zero-denominator handling are retained.

**Files modified:** [backend/calculations/break_even.py](backend/calculations/break_even.py), [backend/api/report.py](backend/api/report.py), [backend/pdf/builder.py](backend/pdf/builder.py), [backend/tests/test_calculations.py](backend/tests/test_calculations.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [src/hooks/useReportGenerator.ts](src/hooks/useReportGenerator.ts), [src/components/gtab/ApplicationPreview.tsx](src/components/gtab/ApplicationPreview.tsx), [src/components/gtab/ApplicationPreview.test.tsx](src/components/gtab/ApplicationPreview.test.tsx), [README.md](README.md).

**Validation:** Focused Section M calculation tests passed (**7 passed**). Section M API/PDF integration tests passed (**3 passed**), verifying each year's operating fixed expense against Section J depreciation and interest, recalculating both operating BEP metrics, matching preview and generated-report values, and checking dynamic inputs. The application preview test verifies the five-year Section M table. The frontend production build passed. A fresh CMA PDF was generated and its five Section M operating fixed-expense values were reconciled to the three Section J source rows; report validation returned **PASS**.

## Release Note — 24 October 2026 (Section M Variable Expenses)

Section M, **Break Even Point Analysis**, now calculates each year's Variable Expenses from the corresponding Section J **Profit & Loss Statement** values: Raw Materials / COGS, Utilities & Variable Exp, Labour & Wages, Admin & Overhead, and Marketing Expenses. It uses each year's projected income-statement row, so changes to operating inputs flow through the same calculation used to generate the CMA PDF.

Contribution is recalculated as Income from Operations less these five expense heads, and Contribution Margin % remains Contribution divided by Income from Operations. Because Labour & Wages and Admin & Overhead are now included in Variable Expenses, they are removed from the fixed-expense aggregate to prevent double counting. Operating Fixed Expenses use the explicitly documented depreciation-plus-interest formula in the 24 October follow-up note; Financial Fixed Expenses additionally retain any other fixed charge. Operating and Financial Break-Even Sales use their respective fixed costs divided by Contribution Margin; each BEP as a percentage of capacity continues to use the year's revenue at 100% capacity. Existing whole-rupee / percentage rounding and safe zero-denominator handling are retained.

**Calculation flow:** `backend/calculations/income_statement.py` provides the five Section J expense values; `backend/calculations/break_even.py` calculates Variable Expenses, Contribution, margins, and both BEP variants once; `backend/api/report.py` passes the same results into the generated report; and `backend/pdf/generator.py` / `backend/pdf/builder.py` render the shared P&L and Section M values. No separate PDF formula or hardcoded year values are introduced.

**Files modified:** [backend/calculations/break_even.py](backend/calculations/break_even.py), [backend/tests/test_calculations.py](backend/tests/test_calculations.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [README.md](README.md).

**Validation:** The focused break-even tests passed (**7 passed**), including all five projection years, dependent BEP formulas, zero revenue/capacity, and changed inputs. The Section M PDF integration test passed (**1 passed**) for baseline and changed inputs, checking Section J expenses against Section M's rendered values. `npm run build` passed. A fresh API-generated report returned **PASS**; its downloaded PDF was saved to [backend/generated_reports/CMA_Section_M_Validation.pdf](backend/generated_reports/CMA_Section_M_Validation.pdf) and verified to contain the five Section J expense rows and all Section M variable/dependent metric rows.

## Release Note — 23 October 2026 (B3 Means of Finance Presentation)

The generated PDF's **B3. Means of Finance** section now displays only **A. Fixed Project Funding**. The rendered **B. Working Capital Funding** and **C. Overall Funding** subsections are hidden to keep the funding section concise and avoid duplicated presentation. Section A's rows, figures, percentages, calculations, and styling are unchanged. Working-capital and overall-funding calculation data remain intact and continue to be available to the rest of the application; only their B3 subsection rendering was removed. Spacing after the remaining funding table is tightened to keep the page balanced.

**Files modified:** [backend/pdf/builder.py](backend/pdf/builder.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [README.md](README.md).

**Verification:** Focused report-generation integration tests passed (**2 passed**), regenerating a sample PDF and confirming Section A's data and percentages remain unchanged while B and C are absent from B3. Python compilation passed.

## Release Note — 24 October 2026 (Section G WDV Opening Basis)

Section G now uses the dynamically calculated Year 1 Opening WDV unchanged as the opening basis for each of Years 1–5; it no longer carries the prior year's Closing WDV into the next year's opening. The existing building and Plant & Machinery + Fixtures rates remain unchanged. For each year, `Depreciation = Year 1 Opening WDV × applicable rate`, `Accumulated Depreciation = prior-year Accumulated Depreciation + current-year Depreciation`, and `Closing WDV (Net Block) = Gross Block − Accumulated Depreciation`. Building and machinery/fixtures remain separately calculated at their existing rates, and rounding remains whole-rupee at each calculation step.

The shared logic is implemented in `backend/calculations/depreciation.py` for CMA report generation and mirrored in `src/lib/wdvDepreciation.ts` for the wizard schedule. `backend/pdf/builder.py` and `src/components/gtab/steps/DepreciationScheduleStep.tsx` explain the same formulas without changing the schedule's table design. Tests cover five-year constant openings, rate-based depreciation, cumulative depreciation/net block reconciliation, changed inputs, and PDF values/text.

**Files modified:** [backend/calculations/depreciation.py](backend/calculations/depreciation.py), [backend/calculations/validator.py](backend/calculations/validator.py), [backend/pdf/builder.py](backend/pdf/builder.py), [backend/tests/test_calculations.py](backend/tests/test_calculations.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [backend/tests/test_validator.py](backend/tests/test_validator.py), [src/lib/wdvDepreciation.ts](src/lib/wdvDepreciation.ts), [src/lib/wdvDepreciation.test.ts](src/lib/wdvDepreciation.test.ts), [src/components/gtab/steps/DepreciationScheduleStep.tsx](src/components/gtab/steps/DepreciationScheduleStep.tsx), [src/components/gtab/steps/DepreciationScheduleStep.test.tsx](src/components/gtab/steps/DepreciationScheduleStep.test.tsx).

**Verification:** Focused backend depreciation, Section G PDF/API, and structural reconciliation tests passed (**15 passed**). Frontend WDV helper and schedule tests passed (**9 passed**). The production frontend build and Python compilation passed. A fresh live-API report (`6872E89C`) returned **PASS**; PDF text confirmed Year 1 Opening WDV was 800,000 in every year, depreciation was 90,000 each year, accumulated depreciation increased by the annual amount, and closing WDV matched gross block less accumulated depreciation. The fresh PDF is at [backend/generated_reports/CMA_Section_G_Constant_Opening_Validation.pdf](backend/generated_reports/CMA_Section_G_Constant_Opening_Validation.pdf).

## Release Note — 23 October 2026 (Section G WDV Roll-Forward)

Section G, **Calculation of Depreciation (WDV Method)**, now exposes the same explicit roll-forward in the live depreciation schedule and generated PDF: yearly depreciation is opening WDV multiplied by the applicable existing asset-class rate; closing WDV is opening WDV less depreciation and becomes the next year's opening WDV; accumulated depreciation is the prior accumulated amount plus current-year depreciation; and net block is gross block less accumulated depreciation. Gross block remains unchanged through the projection unless future asset additions or disposals are modeled. Existing building and machinery/fixture rates and whole-rupee rounding are preserved. Only the Section G schedule and its corresponding frontend schedule display are affected; other CMA sections and layouts remain unchanged.

**Files modified:** [backend/calculations/depreciation.py](backend/calculations/depreciation.py), [backend/pdf/builder.py](backend/pdf/builder.py), [backend/tests/test_calculations.py](backend/tests/test_calculations.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [src/lib/wdvDepreciation.ts](src/lib/wdvDepreciation.ts), [src/lib/wdvDepreciation.test.ts](src/lib/wdvDepreciation.test.ts), [src/components/gtab/steps/DepreciationScheduleStep.tsx](src/components/gtab/steps/DepreciationScheduleStep.tsx), [src/components/gtab/steps/DepreciationScheduleStep.test.tsx](src/components/gtab/steps/DepreciationScheduleStep.test.tsx), [README.md](README.md).

**Verification:** Backend depreciation tests passed (**7 passed**), including five-year opening/closing continuity, accumulated depreciation, and net-block reconciliation. The generated-PDF Section G test passed (**1 passed**) with values checked against the live report schedule. Frontend WDV calculation and schedule-rendering tests passed (**9 passed**). Python compilation and the production frontend build/type check passed.

## Release Note — 23 October 2026 (B2 Motor Equipment Label)

In the generated PDF's **B2. Initial Project Investment** table, the **Vehicles & Transportation** row is now labeled **Plant, Machinery & Equipment (Motor)**. This is a display-label change only; the transportation-cost amount, its percentage allocation, the total initial project investment, and all other financial calculations and report formatting remain unchanged.

**Files modified:** [backend/pdf/generator.py](backend/pdf/generator.py), [backend/tests/test_calculations.py](backend/tests/test_calculations.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [README.md](README.md).

**Verification:** The project-cost item test confirms the supplied example remains Rs. 1,000,000, 4.8% of Rs. 20,676,200. The generated-PDF integration test verifies the new label, amount, and calculated allocation without changing the report table layout.

## Release Note — 23 October 2026 (Constant WC Borrowings in Projected Balance Sheet)

In Section K, **Bank Borrowings — WC (CC/OD)** now uses the calculated Year 1 working-capital bank borrowing amount for Year 1 and every subsequent projected year through Year 5. The amount is derived from `wc_schedule[0]["bank_loan"]`; it is not hardcoded, so different Year 1 working-capital amounts carry through correctly. The five-year WC calculation schedule also reuses that Year 1 bank amount and calculates WC interest from the same fixed borrowing amount for each year.

This rule is applied in the five-year working-capital schedule and while building the projected balance-sheet rows, so interest, cash-flow schedules, balance-sheet calculations, and the Section K PDF all use the same Year 1-derived bank borrowing. The annual working-capital requirements/assets and other financial inputs remain unchanged. The existing balance-sheet reconciliation calculates cash as the balancing amount so `Total Assets = Total Equity & Liabilities` remains true in the calculated balance sheet. Other report formatting is unchanged.

**Files modified:** [backend/calculations/working_capital.py](backend/calculations/working_capital.py), [backend/calculations/balance_sheet.py](backend/calculations/balance_sheet.py), [backend/tests/test_calculations.py](backend/tests/test_calculations.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [README.md](README.md).

**Verification:** The full backend calculation suite completed with **88 passed, 2 failed**; the two failures are the pre-existing drawing-power financing formula assertions. The full report-generation API suite completed with **65 passed, 2 failed**; both failures are pre-existing assertions for the “Fixed Project Cost” label removed in the 15 October 2026 report update. Targeted checks passed for the Year 1-derived borrowing and balance-sheet reconciliation (**6 passed**) and the generated PDF with two different Year 1 borrowing amounts, all five Section K values, and displayed totals (**1 passed**). The production frontend build passed.

## Release Note — 23 October 2026 (Section K Year 0 Presentation)

Section K, **Projected Balance Sheet**, now displays only **Year 1 through Year 5**. The Year 0 column header and its values are omitted from the balance-sheet table and any related additional-funding memo table. This is a presentation-only change: Year 0 remains in the internal balance-sheet data and continues to support calculations that require opening balances. Depreciation, loan repayment, working capital, cash, equity/liabilities, asset totals, and all other formulas remain unchanged.

The Year 1–5 figures continue to be taken from their original calculated rows. **Total Equity & Liabilities** continues to equal **Total Assets** for each displayed year. The existing table styling, colors, borders, headings, and formatting are retained; the five displayed year columns use the available table width.

**Files modified:** [backend/pdf/builder.py](backend/pdf/builder.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [README.md](README.md).

**Verification:** The Section K generated-PDF integration test confirms Year 0 is absent from the rendered section, Year 1–5 and representative line values match the unchanged internal balance-sheet calculations, and equity/liability totals equal asset totals for all displayed years. The full report-generation integration suite completed with **64 passed, 2 failed**; both failures are existing assertions for the “Fixed Project Cost” label removed in the 15 October 2026 report update. The production frontend build and TypeScript check passed.

## Release Note — 23 October 2026 (Editable Duration-Based Capacity Schedule)

The project report form now creates editable yearly capacity-percentage inputs from the selected **Project Duration / Loan Tenure**. The number of fields is `ceil(tenure months ÷ 12)` (capped at 20 years). Defaults remain **60%, 75%, 95%, 100%, 100%** for five years and are **60%, 75%, 80%, 85%, 90%, 95%, 100%** for seven years. Users may enter numeric values from 0% through 100%; invalid drafts are shown with an inline validation message and are not saved or sent to the API.

The yearly schedule is persisted with the existing project-report form data and restored when saved projects are reopened. Saved five-year custom schedules remain intact, while older projects without a saved schedule use duration-appropriate defaults. The schedule array is sent to both report-generation adapters and takes precedence over the legacy Year 1–5 fields.

For every displayed year, the D1 report computes:

- `Projected Revenue = 100% Capacity Revenue × Capacity Percentage ÷ 100`
- `100% Capacity Revenue` is derived from the existing monthly product/revenue inputs and the Year 1 capacity; monthly user inputs are not multiplied by 12 a second time.

The D1 capacity table retains its existing headings, columns, styling, explanatory notes, and layout, but now contains one row per selected project year (including six- and seven-year durations). The first five annual calculation and working-capital projections use the submitted schedule; existing five-year financial statement layouts are unchanged. A 0% year reports zero projected revenue while preserving a calculable full-capacity baseline for subsequent years.

**Files modified:** [src/lib/capacitySchedule.ts](src/lib/capacitySchedule.ts), [src/types/gtab.ts](src/types/gtab.ts), [src/types/dpr.ts](src/types/dpr.ts), [src/components/gtab/steps/ProjectReportInputsStep.tsx](src/components/gtab/steps/ProjectReportInputsStep.tsx), [src/components/gtab/steps/ProjectReportInputsStep.test.tsx](src/components/gtab/steps/ProjectReportInputsStep.test.tsx), [src/lib/buildCMAReportInput.ts](src/lib/buildCMAReportInput.ts), [src/lib/dprFormAdapter.ts](src/lib/dprFormAdapter.ts), [backend/models/input_schema.py](backend/models/input_schema.py), [backend/calculations/income_statement.py](backend/calculations/income_statement.py), [backend/calculations/working_capital.py](backend/calculations/working_capital.py), [backend/pdf/generator.py](backend/pdf/generator.py), [backend/pdf/builder.py](backend/pdf/builder.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [README.md](README.md).

**Verification:** The focused form tests passed (**15 passed**). The generated-PDF capacity tests passed (**6 passed**), covering five- and seven-year defaults, custom schedule formulas, valid zero capacity, and rejection below 0% or above 100%. Python module compilation, the production frontend build, and TypeScript checking passed. The full report API suite completed with **63 passed, 2 failed**; both failures are pre-existing assertions for the **Fixed Project Cost** label removed in the 15 October 2026 report update. The backend calculation suite completed with **86 passed, 2 failed**; both failures are existing drawing-power working-capital formula assertions, unrelated to the capacity schedule.

## Release Note — 23 October 2026 (B3 Means of Finance)

Section B3.A, **Fixed Project Funding**, now includes a **Working Capital** row immediately below **Term Loan from Bank**. This row displays the working-capital bank facility. The displayed subtotal now covers the funding sources in that table, and each source's percentage is calculated against that subtotal:

- `B3.A total = promoter fixed equity + term loan + applicable subsidy + working-capital bank finance`
- `Source percentage = source amount ÷ B3.A total × 100`

Percentages in B3.A are shown to two decimal places. As an illustration, the supplied figures (Rs. 2,856,500 equity, Rs. 8,569,500 term loan, and Rs. 9,165,600 working capital) total Rs. 20,591,600; the respective percentages are 13.87%, 41.62%, and 44.51%, totaling 100.00%.

Section B3.B remains the detail of the working-capital requirement, split between promoter margin and bank finance; it is not an additional source to add again to B3.A. Section B3.C continues to calculate total bank funding as `term loan + working-capital bank finance`, total promoter funding from fixed equity and promoter WC margin, and overall funding as promoter funding + total bank funding + other subsidy/TDR funding. Thus the B3.A WC line is a disclosure of the same facility, not an additional calculation input, and working capital is counted only once in B3.C.

**Files modified:** [backend/pdf/builder.py](backend/pdf/builder.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [README.md](README.md).

**Verification:** The focused funding integration checks passed (**2 passed**) and Python compilation passed. The full backend suite reports **207 passed, 4 failed**: two drawing-power working-capital calculation assertions and two pre-existing report assertions looking for Fixed Project Cost in other report sections. The B3.A/B/C funding reconciliation test passes.

## Release Note — 23 October 2026 (Annual Product Portfolio)

Section A3, **Product / Service Portfolio**, now displays annualized product values while users continue entering monthly quantities:

- **Yearly Qty** = `units_per_month × 12`
- **Yearly Revenue** = `Yearly Qty × avg_price`
- **Portfolio revenue** = sum of each product's yearly revenue
- **Mix %** = each product's yearly revenue ÷ portfolio revenue × 100

The product model derives its monthly revenue from monthly quantity and average price when both are present, keeping product calculations consistent even when a stale derived monthly amount is included. Monthly quantities and prices remain the inputs; annual financial projections continue annualizing monthly revenue once, with the existing capacity schedule. The PDF uses the same table styling and its total and mix values are derived from annual product revenues.

**Files modified:** [backend/models/input_schema.py](backend/models/input_schema.py), [backend/pdf/builder.py](backend/pdf/builder.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [README.md](README.md).

**Verification:** Generated-PDF integration tests cover single- and multiple-product portfolios, annual quantity/revenue, portfolio totals, mix percentages, stale monthly revenue normalization, and Year 1 projection amounts. Both focused portfolio tests pass. The full backend suite reports **207 passed, 3 failed**: two working-capital drawing-power assertions and one fixed-project-cost PDF assertion, all outside this change.

## Release Note — 15 October 2026 (Project & Funding Snapshot)

Removed the **Fixed Project Cost** label/value entry from the Project & Funding Snapshot in generated CMA PDFs. The remaining fields retain their original order and use the existing four-column layout; the final row is compacted with merged cells so no empty snapshot cells remain. No calculations or other report sections were changed.

**Files modified:** [backend/pdf/builder.py](backend/pdf/builder.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [README.md](README.md).

## Release Note — 15 October 2026 (B1 Project Overview)

Removed the **Expected Employment** row and its cells from Section B, B1 (Project Overview) in generated CMA PDFs. All other B1 project details and report sections remain unchanged.

**Files modified:** [backend/pdf/builder.py](backend/pdf/builder.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [README.md](README.md).

## Release Note — 15 October 2026 (E1 Manpower Table)

Removed the Promoter / Owner row from Section E, E1 (Manpower & Wage Structure) in the generated CMA PDF. Remaining skilled, semi-skilled, and unskilled/helper rows are numbered sequentially. The staff count, annual wage totals, and PF / ESI / Benefits totals continue to include only the applicable employee categories; existing employee and benefits calculations are unchanged.

**Files modified:** [backend/pdf/builder.py](backend/pdf/builder.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [README.md](README.md).

## Release Note — 15 October 2026 (Working Capital Interest Rate)

### WC Interest Rate Default and Input

The default **Working Capital (WC) Interest Rate** is **11.5%**. Users can edit it independently of the Term Loan Interest Rate in the project report's loan and financial assumptions.

An empty, null, or missing WC rate resolves to 11.5% in both report-generation paths. The effective rate is applied to working-capital interest in the five-year projections and related totals, ratios, sensitivity calculations, and the generated CMA report's Key Financial Assumptions table. Term Loan interest remains a separate input and its existing formulas and defaults are unchanged.

Explicit saved WC rates are preserved when existing projects are reopened. Legacy projects with a saved custom WC rate in their DPR assumptions are migrated into the editable WC-rate field; projects without a saved custom value use 11.5%.

The canonical default is maintained in [financial_defaults.json](financial_defaults.json) and shared by the frontend and backend.

**Files modified:**
- Shared default: [financial_defaults.json](financial_defaults.json)
- Editable field and saved-project normalization: [src/types/gtab.ts](src/types/gtab.ts), [src/types/dpr.ts](src/types/dpr.ts), [src/components/gtab/steps/ProjectReportInputsStep.tsx](src/components/gtab/steps/ProjectReportInputsStep.tsx)
- CMA input mapping and preview: [src/lib/financialDefaults.ts](src/lib/financialDefaults.ts), [src/lib/buildCMAReportInput.ts](src/lib/buildCMAReportInput.ts), [src/lib/dprFormAdapter.ts](src/lib/dprFormAdapter.ts), [src/components/gtab/ApplicationPreview.tsx](src/components/gtab/ApplicationPreview.tsx)
- Backend calculation and report generation: [backend/core/financial_defaults.py](backend/core/financial_defaults.py), [backend/core/engine.py](backend/core/engine.py), [backend/models/input_schema.py](backend/models/input_schema.py), [backend/calculations/working_capital.py](backend/calculations/working_capital.py), [backend/calculations/sensitivity.py](backend/calculations/sensitivity.py), [backend/main.py](backend/main.py), [backend/pdf/generator.py](backend/pdf/generator.py)
- Tests: [backend/tests/test_calculations.py](backend/tests/test_calculations.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [src/components/gtab/steps/ProjectReportInputsStep.test.tsx](src/components/gtab/steps/ProjectReportInputsStep.test.tsx)
- Documentation: [README.md](README.md)

## Release Note — 13 October 2026 (Interest Rate Update)

### Term Loan Interest Rate Default Update

The default **Term Loan Interest Rate** has been updated from 10.5% to **9.5%** throughout the application.

This change applies to:
1. **User Input Form**: The default value in the loan details section is now 9.5%.
2. **Generated CMA Report**: If no rate is explicitly provided by the user, the report now defaults to 9.5%.
3. **Calculation Engine**: All dependent values, including interest amounts, repayment schedules, and total interest outgo, are automatically recalculated based on this new default.

Existing user inputs that were explicitly entered are preserved and not overwritten.

**Files modified:**
- Backend Models: [backend/main.py](backend/main.py)
- Form Adapter: [src/lib/dprFormAdapter.ts](src/lib/dprFormAdapter.ts)
- PDF Generation: [backend/pdf/generator.py](backend/pdf/generator.py)
- Documentation: [README.md](README.md)

## Release Note — 13 October 2026 (Balance Sheet Merge)

### Projected Balance Sheet Update (Section K)

Merged the **"Equity / Promoter Capital"** and **"Promoter's WC Margin"** rows into a single row named **"Promoter Capital"** in the Projected Balance Sheet.

The value is now calculated dynamically for each year (Year 0 to Year 5) as:
`Promoter Capital = Equity / Promoter Capital + Promoter's WC Margin`

This ensures that Net Worth, totals, and all dependent calculations remain correct without double-counting while simplifying the report layout.

**Files modified:**
- PDF Generation: [backend/pdf/builder.py](backend/pdf/builder.py)
- Documentation: [README.md](README.md)

## Release Note — 12 October 2026 (WC Reconciliation)

### Working Capital Finance Reconciliation

Corrected the backend logic to ensure that the **Working Capital Requirement** and **Working Capital Finance** always match exactly. Previously, a margin percentage was applied, causing the finance amount to be lower than the assessed requirement. In the current financial model, the bank funds 100% of the assessed working capital requirement.

This change ensures that:
1. **Working Capital Requirement == Working Capital Finance** in all report sections and projections.
2. **Total Bank Exposure** correctly equals the sum of the Term Loan and the full Working Capital Finance.
3. All dependent balance sheet, cash flow, and P&L calculations consistently use this reconciled amount.
4. No hardcoded values are used; the reconciliation is driven by the core calculation engine.

**Files modified:**
- Backend calculations: [backend/calculations/working_capital.py](backend/calculations/working_capital.py)
- Calculation engine: [backend/core/engine.py](backend/core/engine.py)
- Documentation: [README.md](README.md)

**Verification:**
- Backend tests: `cd backend && .venv/bin/pytest tests/test_calculations.py -q` → **Passed**.
- PDF verification: Generated report now shows matching values for Working Capital Requirement and Finance.


## Release Note — 12 October 2026

### Capacity schedule update

The default five-year capacity utilization schedule is now **60%, 75%, 95%, 100%, 100%** for all project types. Applicant-entered schedules continue to be honored. Saved projects that contain the exact previous default (50%, 60%, 70%, 75%, 80%) are migrated to the new default when loaded; other custom schedules are preserved.

Capacity is applied in both backend report paths. Annual production-linked sales and raw-material costs use each year's capacity and growth assumptions. Working-capital sales/debtor estimates now follow the same capacity ramp as the P&L; stock, WIP, finished goods, cash accruals, and cash flow consequently recalculate from the updated projections. The generated PDF uses the same schedule for its overview and projection tables.

**Files modified:**

- Shared schedule source: [capacity_schedule.json](capacity_schedule.json)
- Backend defaults and calculations: [backend/core/engine.py](backend/core/engine.py), [backend/main.py](backend/main.py), [backend/api/report.py](backend/api/report.py), [backend/calculations/income_statement.py](backend/calculations/income_statement.py), [backend/calculations/working_capital.py](backend/calculations/working_capital.py), [backend/models/input_schema.py](backend/models/input_schema.py), [backend/schemes/router.py](backend/schemes/router.py)
- PDF generation: [backend/pdf/generator.py](backend/pdf/generator.py), [backend/pdf/builder.py](backend/pdf/builder.py)
- Frontend defaults, saved data, and narrative: [src/lib/capacitySchedule.ts](src/lib/capacitySchedule.ts), [src/types/gtab.ts](src/types/gtab.ts), [src/lib/buildCMAReportInput.ts](src/lib/buildCMAReportInput.ts), [src/lib/dprFormAdapter.ts](src/lib/dprFormAdapter.ts), [src/lib/aiEngine.ts](src/lib/aiEngine.ts), [src/components/gtab/steps/ProjectReportInputsStep.tsx](src/components/gtab/steps/ProjectReportInputsStep.tsx), [tsconfig.app.json](tsconfig.app.json)
- Tests: [backend/tests/test_calculations.py](backend/tests/test_calculations.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [src/components/gtab/steps/ProjectReportInputsStep.test.tsx](src/components/gtab/steps/ProjectReportInputsStep.test.tsx)
- Documentation: [README.md](README.md)

**Verification:**

- Backend: `.venv/bin/pytest -q` from `backend/` → **197 passed**.
- Frontend: `npx vitest run --reporter=default` → **20 files, 78 tests passed**.
- Production build: `npm run build` → **passed**; Vite reported the existing non-blocking large-chunk warning.
- Pylance syntax checks: all modified backend Python files checked → **no syntax errors**.

### Revenue baseline and zero-revenue correction

Product/service line monthly revenue is now derived from `units_per_month × avg_price` when the request omits `monthly_revenue`. The root cause was that this field defaulted to zero while the projection engine used it as the sole product-table revenue input, ignoring otherwise valid quantity and price values.

The Year 1 full-capacity annual revenue is calculated from the entered project inputs and held constant for all five years. Annual projected sales use only `Year 1 full-capacity revenue × yearly capacity percentage`; revenue escalation is not applied to this baseline. The same capacity-only projected revenue drives the P&L and working-capital debtor calculation, without applying capacity twice. Exact legacy manufacturing, service/trading, and agriculture default ramps are normalized to the shared schedule; custom schedules remain unchanged.

**Files modified:** [backend/models/input_schema.py](backend/models/input_schema.py), [backend/api/report.py](backend/api/report.py), [backend/calculations/income_statement.py](backend/calculations/income_statement.py), [backend/calculations/working_capital.py](backend/calculations/working_capital.py), [backend/pdf/builder.py](backend/pdf/builder.py), [backend/tests/test_calculations.py](backend/tests/test_calculations.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [README.md](README.md).

**Verification:** full backend suite `.venv/bin/pytest tests -q` from `backend/` → **200 passed**. The live API generated and verified a service-project PDF with a constant Rs.100,000 full-capacity baseline and projected revenues of Rs.60,000, Rs.75,000, Rs.95,000, Rs.100,000, and Rs.100,000. Python syntax checks reported no errors.

### PDF financial snapshot visibility

The generated PDF omits the complete **Financial Snapshot (Year 1 → Year 5)** block, including its Revenue, EBITDA, PAT, and Term Loan DSCR table and all six summary metrics below it. The PDF story elements are removed before layout, so the Project & Funding Snapshot and following sections remain, without an extra gap. Calculations, stored values, API responses, and other report content are unchanged.

**Files modified:** [backend/pdf/builder.py](backend/pdf/builder.py), [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py), [README.md](README.md).

**Verification:** `cd backend && .venv/bin/pytest tests/test_report_generate_api.py -q` → **52 passed**. The PDF integration test verifies the Financial Snapshot and metrics are absent while Project & Funding Snapshot, Credit Assessment, and Term Loan Repayment remain present.

### B2 promoter-share label

In the generated PDF's **B2. Initial Project Investment** table, the label **Working Capital Margin (Promoter's Share)** is rendered as **Promoter's Share**. This is a display-only label change in [backend/pdf/builder.py](backend/pdf/builder.py); the source project-cost item, amounts, percentages, calculations, and other report content are unchanged. The PDF assertion is in [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py).

**Verification:** `.venv/bin/pytest tests/test_report_generate_api.py::TestTradingSectionsWithItemizedProductsList::test_section02_fixed_project_cost_matches_section07_total -q` from `backend/` → **1 passed**. The test confirms the new label and existing amount reconciliation, and verifies the old label is absent from the generated PDF.

## Release Note — 9 October 2026

### Fixes applied

This update corrects the total project cost calculation across the shared financing logic so the app now uses the actual user-entered funding stack dynamically:

Total Project Cost = Term Loan Requested + Working Capital Facility Requested + Promoter Contribution

**Updated file paths:**

- [backend/api/report.py](backend/api/report.py)
- [backend/calculations/validator.py](backend/calculations/validator.py)
- [backend/core/engine.py](backend/core/engine.py)
- [backend/pdf/builder.py](backend/pdf/builder.py)
- [backend/pdf/generator.py](backend/pdf/generator.py)
- [backend/schemes/router.py](backend/schemes/router.py)
- [backend/tests/test_report_generate_api.py](backend/tests/test_report_generate_api.py)
- [backend/tests/test_validator.py](backend/tests/test_validator.py)
- [src/components/gtab/GTABFormWizard.tsx](src/components/gtab/GTABFormWizard.tsx)
- [src/components/gtab/steps/ProjectRequirementsStep.tsx](src/components/gtab/steps/ProjectRequirementsStep.tsx)
- [src/components/gtab/steps/ProjectSummaryStep.tsx](src/components/gtab/steps/ProjectSummaryStep.tsx)
- [src/components/gtab/steps/WorkingCapitalStep.tsx](src/components/gtab/steps/WorkingCapitalStep.tsx)
- [src/lib/projectReport.pmegpStore.test.ts](src/lib/projectReport.pmegpStore.test.ts)
- [src/lib/projectReport.ts](src/lib/projectReport.ts)
- [README.md](README.md)

**What changed:**

- Updated shared frontend and backend calculations, CMA/PDF tables, summaries, and reconciliation checks to derive totals dynamically from the entered term loan, working-capital facility, and promoter contribution.
- Kept scheme subsidy separate from promoter contribution and showed it as a separate source in PMEGP reports.
- Corrected the JavaScript initialization order bug that caused `Cannot access 'includesWorkingCapital' before initialization` during rendering and test runs.
- Generated sample: [generated_reports/Total_Project_Cost_Sample_2026-10-09.pdf](generated_reports/Total_Project_Cost_Sample_2026-10-09.pdf). It reports Rs.1,687,500 = Rs.765,000 term loan + Rs.472,500 working-capital facility + Rs.450,000 promoter contribution; validation passed.

**Verification:**

- Frontend tests: `npx vitest run --reporter=basic` → 20 test files passed, 76 tests passed.
- Backend tests: `cd backend && .venv/bin/pytest -q` → 193 passed.
- Production build: `npm run build` → Vite production build completed successfully. Vite reported a non-blocking large-chunk warning.

## Release Note — 13 October 2026

### Editable Means of Finance amounts

Term Loan Amount, Working Capital Loan Amount, PMEGP Government Subsidy (Margin Money), and Promoter's Contribution can now be entered directly in the Means of Finance Breakdown. Manual amounts are stored with the application draft, restored when resuming it, and take precedence over calculated defaults in the financing summary and report requests. Percentage controls remain available; changing a percentage returns that amount to its calculated value. PMEGP rule deviations and amounts outside supported financing limits are shown for review, while PMEGP reports retain the entered values and include a scheme-rule warning when they differ from the prescribed split.

---

## What is EazyBizy?

EazyBizy is a full-stack fintech platform that helps businesses apply for government loan schemes (PMEGP, Mudra, MSME, CGTMSE). It includes a multi-step GTAB application wizard, a full Credit Analyst (CA) workstation with 16-step CMA report generation, an admin panel, an AI chatbot, and a learning module.

**Stack:** React + TypeScript · Vite · Supabase · Tailwind CSS · shadcn/ui · Python FastAPI (CMA backend)

---

## What Changed in v3.4.0 (9 September 2026)

### Backend Changes

- **Depreciation rebuilt as WDV (Written Down Value / reducing-balance) only** — no more straight-line. Depreciation now correctly declines every year and feeds the P&L, Balance Sheet, and the generated PDF consistently.
- **Centralised loan-scheme financing rules** — subsidy %, promoter-contribution minimums, DSCR benchmarks, and default bank-finance % for PMEGP/Mudra/MSME/CGTMSE now come from one shared engine instead of being hardcoded in several places (which had quietly drifted out of sync with each other).
- **Fixed a false-positive validation error** that was incorrectly flagging Means of Finance as "not reconciling" on nearly every generated report, even when the numbers were correct.
- **Fixed DSCR scoring** to use the correct benchmark for each scheme (Mudra Shishu/Kishor have a lower requirement than other schemes) instead of one flat number applied to everyone.
- **Corrected stale guidance text** that referenced outdated thresholds/bug descriptions no longer applicable.
- **Removed hard caps** on Loan Tenure, Moratorium, and State Capital Subsidy % — these vary by bank/state scheme and are no longer artificially restricted.

### UI Changes

- Added a new **Depreciation Schedule** step to the loan wizard — an automatic, read-only 5-year schedule computed from your existing entries, no extra data entry required.
- **Means of Finance step**: Term Loan and Working Capital percentages can now be edited directly on that step instead of needing to navigate to a later step.
- Added a new **admin screen** for managing loan-scheme rates without needing direct database access.
- General visual polish across the loan application wizard — clearer depth/elevation on cards and buttons, a more organised layout on the Business Profile step, and a fix for the step indicator wrapping onto two rows.

---

## What Changed in v3.3.0 (18 July 2026)

Focus of this release: making the **Credit Analyst CMA report genuinely bankable** — computed and presented exactly the way an Indian bank's credit officer recomputes it (RBI / Tandon / Nayak conventions) — plus a public Live Demo, and a set of RLS / reliability fixes.

### Bankable CMA Engine (RBI-format, single source of truth)

The report is now built from **one shared section builder** — `backend/cma/report_sections.py` `build_sections(results)` — consumed identically by the Excel (`excel_report.py`), PDF (`pdf_report.py`) and CSV (`csv_report.py`) renderers. **Change a section once → it propagates to all three formats**, so PDF, Excel and CSV are guaranteed replicas.

**20 ordered sections** covering the standard bank CMA form set: Executive Summary, Form I (Particulars of Borrower), Promoter's Net Worth, CA Observations & Recommendation, Credit Appraisal Note, Operating Statement (Form II), Balance Sheet (Form III), Depreciation Chart (WDV), Comparative Statement (Form IV), Ratio Analysis, Turnover Method (Nayak), MPBF (Tandon I & II), Assessed Bank Finance (ABF), Security & Collateral Coverage, Term-Loan Repayment Schedule, Fund Flow (Form VI), Cash Flow (Form V), DSCR, Break-Even (Form VII), Sensitivity.

**Engine correctness (as a CA / banker recomputes it):**

| Area | Treatment |
|---|---|
| Term loan | Reducing-balance interest, equal-principal instalments over (tenure − moratorium); interest accrues during moratorium |
| DSCR | (PAT + Depreciation + Preliminary write-off + TL interest) / (TL principal + TL interest) — WC interest correctly excluded |
| MPBF | Tandon Method I & II on chargeable current assets (excludes surplus cash) |
| Balance sheet | Always tallies (cash as residual); RM/WIP/FG valued at proper cost bases; flags funding gaps |
| Operating statement | COGS from unit costs (not margin); salary fixed with increments; WDV depreciation; CGTMSE guarantee fee flows through EBITDA |

**Banker-grade refinements (v3.3.0):**

- **Current Portion of Term Loan (CPTL)** now included in current liabilities for the current ratio & NWC, and shown as its own line in **Form III** and **Form IV** (term loan shown net of current portion — a classified balance sheet). The current ratio is now **identical** across CA Observations, Ratio Analysis and the Balance Sheet — no contradictory figures for a banker to catch.
- **Inventory holding period** measured against COGS (not sales), so it isn't understated by the gross margin.
- **Preliminary / pre-operative expenditure amortised over 5 years** (Sec 35D) — a non-cash below-EBITDA charge, added back in DSCR cash accruals and released from the balance sheet, with cash-flow and fund-flow reconciliation preserved. Shown as "Less: Preliminary Expenses Written Off" in Form II and the DSCR add-back.
- New analyst inputs wired end-to-end (frontend → Pydantic intake → report): export/domestic sales split, CGTMSE guarantee-fee rate, Collateral & Guarantor, and an editable **Credit Appraisal Note** (strengths / weaknesses / risk mitigants / sanction covenants).

Deliberately kept conservative (bankable as-is): constant gross margin across years (banks strike out margin-expansion assumptions); promoter unsecured loans treated as quasi-equity subject to a subordination covenant.

### Public Live Demo — one approved sample per loan scheme

"View Live Demo" on the Credit Analyst dashboard opens a scheme picker with **six distinct, engine-verified, APPROVED (RECOMMEND) sample proposals** — Mudra Kishor, Mudra Tarun, Mudra TarunPlus, PMEGP, CGTMSE, and MSME PSU. Each is a genuinely different business (garments, food processing, CNC auto-components, handicrafts, plastics moulding, precision engineering) calibrated to a realistic DSCR (2.6–4.1). Source: `src/lib/cmaDemoData.ts`.

- **PDF** is public but **watermarked** ("EAZYBIZY DEMO", diagonal stamp).
- **Excel / CSV are admin-only** — buttons locked for non-admins (frontend) **and** the backend returns `403` for `excel`/`csv` on the demo path so the lock can't be bypassed.

### Reliability & Security Fixes

| Fix | Detail |
|---|---|
| Delete didn't persist | Added RLS **DELETE** policy for credit analysts (`20260711120000_credit_analyst_delete_policy.sql`); frontend now `.select()`s the deleted row and surfaces an honest error instead of a silent RLS no-op |
| Approvals / drafts didn't persist | Added RLS **UPDATE** policy for credit analysts (`20260718120000_credit_analyst_update_policy.sql`); approve/reject and Save Draft now detect 0-row RLS no-ops |
| Infinite loading spinner | Fixed `useCreditAnalystAuth` deadlock (was `await`-ing `getUser()` inside `onAuthStateChange`); now uses `getSession()`, defers the callback, and has an 8s watchdog |
| "Same report every time" | Download URL is cache-busted (`_t` param + `no-store` on request and response); the report always renders fresh from the posted data |
| Every application looked like "Rajesh Food Products" | Removed the demo-data seeding from the GTAB intake form (`INITIAL_FORM_DATA` and the `PersonalInfoStep` auto-fill effect); new applications start blank |
| Download reliability | Blob URL revoked after a delay (was aborting downloads in some browsers); empty-response guard |

### ⚠️ Migrations to apply (Supabase → SQL Editor)

These two RLS policies **must be run against the live database** or credit analysts can't delete/approve:

- `supabase/migrations/20260711120000_credit_analyst_delete_policy.sql` (DELETE)
- `supabase/migrations/20260718120000_credit_analyst_update_policy.sql` (UPDATE)

A one-time cleanup script for old seeded demo rows is provided at `supabase/cleanup_seeded_demo_applications.sql` (manual — not a migration).

---

## What Changed in v3.2.0 (29 May 2026)

### Credit Analyst Workstation — Major Expansion

The CA workstation (`AdvancedCMAWizard`) has been expanded from a basic form to a full 16-step professional CMA preparation tool.

#### New Steps Added

- **Collateral & Security (Step 14)** — Primary security description, collateral items table (Type / Description / Owner / Market Value / FSV), CGTMSE toggle with coverage percentage, insurance arrangement flag, and live coverage ratio summary
- **CA Scorecard (Step 16)** — 7-parameter 100-point scoring model, full EMI repayment schedule table (year-wise principal + interest), CA Recommendation (Recommend / Conditional / Decline), CA Remarks textarea

#### Enhanced Steps

- **Manpower (Step 8)** — Per-row monthly cost calculation, 3-year payroll projection table, summary metrics (monthly payroll, annual Year 1, % of projected revenue)
- **WC Norms (Step 10)** — Sliders with banker guidance tips, live Tandon Method II breakdown (Gross WC → Less Creditors → Net WC Gap → Bank Finance 75% → Promoter Margin 25%), "Push WC Finance to MoF" one-click button
- **Assumptions & Projections (Step 15)** — Assumption sliders with context tips, 5-year P&L projection table with DSCR traffic-light color coding (green ≥1.25, amber ≥1.0, red <1.0), Sensitivity Analysis table (−30% to +20% revenue scenarios), Break-Even Analysis metrics

#### New Helper Computations (all live/auto-updating)

| Function | Output |
|---|---|
| `computeBreakEven()` | BEP monthly/annual revenue, utilisation %, contribution ratio, safety margin |
| `computeEMISchedule()` | Year-wise loan repayment with moratorium support |
| `computeSensitivity()` | 6 revenue scenarios with revenue / COGS / EBITDA / PAT / DSCR |
| `computeScorecard()` | 7-parameter 100-point CA scoring |

#### Download Always Proceeds

Downloads (PDF / Excel / CSV) previously hard-blocked when validation failed. Now validation issues show as warning toasts but the report always generates. Download buttons are visible on all 16 steps, not just the final one.

---

### Backend — Bug Fixes

| Issue | Fix |
|---|---|
| `'mpbf_method_2'` KeyError on PDF download | Changed to `.get("method2", ...)` in `api/cma.py` |
| `'sales'` KeyError causing repeated 500 errors | Full rewrite of `pdf/cma_generator.py` to match the actual data structure produced by `report_builder.py` |
| Pydantic validator blocking all downloads with 422 | Changed `raise ValueError(...)` to advisory `print(...)` in `cma/intake_mapper.py` — report always generates |

---

### Security Fixes

**HIGH — Path Traversal** (`backend/main.py`)

- Added `_safe_filename()` helper that strips all characters except `[a-zA-Z0-9 _-]` and caps length at 64
- All three locations where `entrepreneur_name` was used directly in `os.path.join()` now pass through `_safe_filename()` first
- Prevents inputs like `../../etc/passwd` from escaping the reports directory

**MEDIUM — Internal Error Leakage** (`main.py`, `api/cma.py`, `api/report.py`)

- All `detail=str(e)` on HTTP 500 responses replaced with generic `"... failed. Check server logs."`
- Actual exception details still print to server stdout for debugging but never reach the HTTP response body
- Business-logic 422 validation messages (from `PMEGPValidationError` / `ValueError`) intentionally kept as-is

---

### Supabase Schema — New Migration

**File:** `supabase/migrations/20260529120000_add_cma_data_column.sql`

Run this in Supabase Dashboard → SQL Editor to add the CA workstation columns:

| Column | Type | Purpose |
|---|---|---|
| `cma_data` | JSONB | Full CA wizard draft (CMAFormData JSON) |
| `cma_submitted_at` | TIMESTAMPTZ | When CA last generated/submitted |
| `cma_status` | TEXT | `draft` / `review` / `approved` / `rejected` |
| `ca_remarks` | TEXT | Internal CA notes |
| `employee_count` | INTEGER | Mapped from GTAB Step 7 |
| `salary_per_employee` | NUMERIC | Mapped from GTAB Step 7 |
| `total_project_cost` | NUMERIC | Denormalised for dashboard display |
| `margin_money` | NUMERIC | PMEGP/Mudra subsidy amount |
| `eligible_loan_amount` | NUMERIC | Final sanctioned loan |

A GIN index on `cma_data` is also created for fast dashboard `hasCmaDraft` checks.

---

### Types Updated

`src/types/cma.ts` — Added `CMACollateralItem` interface, `collateral` block, and `ca_recommendation` block to `CMAFormData`.

---

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Fill in your Supabase URL and anon key

# Run dev server
npm run dev

# Build for production
npm run build
```

### Python CMA Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

---

## Project Structure

```
EazyBizy/
├── src/
│   ├── components/
│   │   ├── credit-analyst/  # AdvancedCMAWizard (16-step CA workstation)
│   │   ├── gtab/            # GTAB wizard steps, AIInsightPanel, CMAAdvisoryPanel
│   │   └── ui/              # shadcn/ui components
│   ├── pages/               # Route pages (Auth, Dashboard, Admin, Credit Analyst, etc.)
│   ├── hooks/               # Auth and form hooks
│   ├── lib/                 # aiEngine, cmaValidator, schemes, buildCMAReportInput
│   └── types/               # TypeScript types (cma.ts, gtab.ts, dpr.ts)
├── backend/
│   ├── api/                 # FastAPI routes (cma.py, report.py)
│   ├── cma/                 # CMA engine + report:
│   │                        #   engine: intake_mapper, operating_statement, balance_sheet, ratios,
│   │                        #           cashflow, fund_flow, mpbf, loan_schedule, depreciation,
│   │                        #           breakeven, sensitivity, historical
│   │                        #   report: report_sections.py (single source) → excel_report / pdf_report / csv_report
│   ├── pdf/                 # Legacy PDF builder (superseded by cma/pdf_report.py)
│   ├── calculations/        # Income statement, DSCR, loan schedule, depreciation (WDV), working capital, validator
│   ├── schemes/             # PMEGP, Mudra, MSME, CGTMSE scheme logic and router
│   ├── rules/               # Rules & Rates engine — single source of truth for scheme financing %, DSCR benchmarks
│   └── models/              # Pydantic input schema
├── supabase/
│   ├── functions/           # Edge functions (generate-cma-report, process-loan, format-report)
│   └── migrations/          # All DB schema migrations (run in order)
└── public/
```

### Funding Calculation Flow 6/10/2026(hidden)

The report's Means of Finance tables calculate Working Capital Funding and Overall Funding in `backend/pdf/builder.py`.

**Working Capital Funding** combines the working-capital margin with the working-capital loan. `_b2_wc_margin` is the Working Capital margin, and `_b2_wc_loan` is the Working Capital loan. Their sum, rounded to two decimal places, is stored in `_b2_wc_total`:

```python
_b2_wc_total = R(_b2_wc_margin + _b2_wc_loan, 2)
```

The report uses `_b2_wc_total` as the total Working Capital Funding value in the Working Capital Funding table.

**Overall Funding (B3.C)** first combines the Term Loan and Working Capital Loan into total bank exposure, then adds the displayed Promoter Contribution and margin money:

```python
_total_bank_exp = pc["term_loan"] + _b2_wc_loan
_total_funding = display_promoter_contribution + _total_bank_exp + _b2_margin_money
```

Here, `_total_bank_exp` is the combined bank exposure from the Term Loan (`pc["term_loan"]`) and Working Capital Loan (`_b2_wc_loan`). `_total_funding` combines the displayed Promoter Contribution (`display_promoter_contribution`), that total bank exposure, and margin money (`_b2_margin_money`). The result is shown in the report's Overall Funding table.

The **B3.A** table also displays `_b2_wc_loan` as a Working Capital source and includes it in that table's percentage denominator. **B3.B** remains the facility breakdown. These are repeated views of one facility: the B3.C calculation adds the working-capital bank loan once, not once per table.

### PDF Section Visibility

The detailed **Working Capital Financing** and **Working Capital Cycle** sections are hidden from generated PDFs in `backend/pdf/builder.py`. Their section-building code and calculations remain unchanged; their PDF story elements are removed before layout, so the remaining content is repaginated without those sections.

In the same file, **Key Financial Assumptions** is rendered with the heading **B5. Key Financial Assumptions**. The **Promoter Contribution & Net Worth** section and the **B. Working Capital Facility** subsection are omitted from the PDF by excluding their generated story elements. Their source code, data, and calculations remain intact. The remaining sections reflow through the normal PDF layout and pagination. Tests in `backend/tests/test_report_generate_api.py` verify the new heading, preserved Term Loan section, and absence of the hidden sections.

The D1 **Gross Profit (Year 1 → Year 5)** subsection is also hidden from PDF output in `backend/pdf/builder.py`: only its bounded story-element range, including the preceding spacer, is omitted before layout. The D4 heading and fixed-asset table remain intact and flow directly after the preceding content. The calculation and table-building code remain unchanged. `backend/tests/test_report_generate_api.py` verifies that Gross Profit is absent and both the D4 heading and its table content remain present.

No other report sections or output formats are changed.

---

## CA Workstation — 16 Steps

| # | Step | Purpose |
|---|---|---|
| 1 | Applicant Profile | Personal details, PAN, Aadhaar, experience |
| 2 | Business Profile | Entity name, constitution, GST, UDYAM |
| 3 | Loan Requirement | Purpose, type, scheme, amount, tenure, rate |
| 4 | Project Cost | Land, building, machinery, pre-op expenses, WC |
| 5 | Means of Finance | Promoter equity, term loan, WC loan, subsidy |
| 6 | Historical Financials | 1–3 years of audited P&L and balance sheet data |
| 7 | Revenue Model | Products/services, price, quantity, growth % |
| 8 | Manpower | Designation, headcount, salary, 3-year payroll projection |
| 9 | Operating Expenses | Rent, utilities, transport, insurance, professional fees |
| 10 | WC Norms | Holding days, Tandon Method II live calculator |
| 11 | Depreciation | Asset-wise WDV rates |
| 12 | Promoter Net Worth | Properties, FDs, gold, liabilities |
| 13 | Guarantor | Guarantor details and net worth |
| 14 | Collateral & Security | Primary security, collateral items, CGTMSE, insurance |
| 15 | Assumptions & Projections | 5-year P&L, DSCR, sensitivity, break-even |
| 16 | CA Scorecard | 100-point scoring, EMI schedule, CA recommendation |

---

## Version History

| Version | Date | Summary |
|---------|------|---------|
| 3.4.0 | 9 September 2026 | WDV-only depreciation with a new auto-calculated wizard step; centralised loan-scheme financing rules with a new admin management screen; fixed a false-positive validation error and scheme-specific DSCR scoring; removed unnecessary caps on Tenure/Moratorium/Subsidy %; Means of Finance step made directly editable; general UI polish |
| 3.3.0 | 18 July 2026 | Bankable CMA engine (20-section RBI/Tandon/Nayak report from a single shared source → identical PDF/Excel/CSV); banker-grade refinements (CPTL in current ratio + Form III/IV, inventory@COGS, Sec-35D preliminary write-off); public Live Demo with 6 approved per-scheme samples (watermarked PDF, admin-locked Excel/CSV); RLS delete + update policies; auth-deadlock spinner fix; download cache-bust; removed GTAB "Rajesh" demo seeding |
| 3.2.0 | 29 May 2026 | CA workstation 16-step expansion, break-even/sensitivity/scorecard/collateral, security fixes (path traversal, error leakage), backend bug fixes (mpbf KeyError, sales KeyError, Pydantic 422 block), Supabase migration for CA columns |
| 3.1.0 | 24 May 2026 | AI engine, CMA advisory panel, backend calculation overhaul, schemes API, GTAB WC step expansion |
| 3.0.0 | 15 May 2026 | CMA reconciliation refactor, Application Preview step, theme overhaul, git setup |
| 2.0.0 | 3 Feb 2026 | Credit analyst dashboard, GTAB wizard, Supabase schema, AI chatbot |
| 1.0.0 | Jan 2026 | Initial project — landing page, auth, loan schemes |

---
