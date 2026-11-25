import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProjectSummaryStep from "./ProjectSummaryStep";
import { INITIAL_FORM_DATA, type GTABFormData } from "@/types/gtab";

const totals = { total_project_cost: 1_000_000, margin_money: 0, eligible_loan_amount: 750_000 };

function baseFormData(overrides: Partial<GTABFormData>): GTABFormData {
  return {
    ...INITIAL_FORM_DATA,
    shed_building_cost: 500_000,
    plant_machinery: [
      { id: "1", machine_name: "M", cost: 500_000, quantity: 1, unit_cost: 500_000, supplier_name: "", supplier_phone: "", supplier_email: "" },
    ],
    ...overrides,
  } as GTABFormData;
}

describe("ProjectSummaryStep — Means of Finance % editability", () => {
  it("MSME scheme: Term Loan % and WC Loan % are real editable inputs that write back via updateFormData", () => {
    const updateFormData = vi.fn();
    const formData = baseFormData({ loan_scheme: "normal_msme" as any, loan_purpose: "term_loan" });
    render(<ProjectSummaryStep formData={formData} updateFormData={updateFormData} totals={totals} />);

    const termLoanPctInput = screen.getByRole("spinbutton", { name: "Term Loan bank finance percentage" });
    screen.getByRole("spinbutton", { name: "Working Capital bank finance percentage" });

    fireEvent.change(termLoanPctInput, { target: { value: "82" } });
    expect(updateFormData).toHaveBeenCalledWith(
      expect.objectContaining({
        project_report_inputs: expect.objectContaining({
          dpr: expect.objectContaining({ term_loan_pct: 82 }),
        }),
      }),
    );
  });

  it("PMEGP scheme: Term Loan % shows the scheme-fixed clarification, not an editable input for it", () => {
    const updateFormData = vi.fn();
    const formData = baseFormData({ loan_scheme: "pmegp" as any, loan_purpose: "term_loan" });
    render(<ProjectSummaryStep formData={formData} updateFormData={updateFormData} totals={totals} />);

    expect(screen.getByText(/fixed by PMEGP scheme rules, not bank-adjustable/i)).toBeTruthy();
    expect(screen.getByLabelText("Government Subsidy — Margin Money (₹)")).toBeTruthy();
  });

  it("PMEGP scheme: WC Loan % is still editable (WC bank-finance % is never scheme-formula-fixed)", () => {
    const updateFormData = vi.fn();
    const formData = baseFormData({ loan_scheme: "pmegp" as any, loan_purpose: "term_loan" });
    render(<ProjectSummaryStep formData={formData} updateFormData={updateFormData} totals={totals} />);

    const wcPctInput = screen.getByRole("spinbutton", { name: "Working Capital bank finance percentage" });
    expect(screen.queryByRole("spinbutton", { name: "Term Loan bank finance percentage" })).toBeNull();
    fireEvent.change(wcPctInput, { target: { value: "70" } });
    expect(updateFormData).toHaveBeenCalledWith(
      expect.objectContaining({
        project_report_inputs: expect.objectContaining({
          dpr: expect.objectContaining({ wc_loan_pct: 70 }),
        }),
      }),
    );
  });

  it("writes each entered financing amount to saved project report state", () => {
    const updateFormData = vi.fn();
    const formData = baseFormData({ loan_scheme: "pmegp" as any });
    render(<ProjectSummaryStep formData={formData} updateFormData={updateFormData} totals={totals} />);

    fireEvent.change(screen.getByLabelText("Term Loan Amount (₹)"), { target: { value: "610000" } });
    expect(updateFormData).toHaveBeenLastCalledWith(expect.objectContaining({
      project_report_inputs: expect.objectContaining({
        dpr: expect.objectContaining({ term_loan_amount_override: 610000 }),
      }),
    }));

    fireEvent.change(screen.getByLabelText("Working Capital Loan Amount (₹)"), { target: { value: "42000" } });
    fireEvent.change(screen.getByLabelText("Government Subsidy — Margin Money (₹)"), { target: { value: "95000" } });
    fireEvent.change(screen.getByLabelText("Promoter's Contribution (₹)"), { target: { value: "250000" } });

    expect(updateFormData).toHaveBeenLastCalledWith(expect.objectContaining({
      project_report_inputs: expect.objectContaining({
        dpr: expect.objectContaining({ promoter_contribution_override: 250000 }),
      }),
    }));
  });
});
