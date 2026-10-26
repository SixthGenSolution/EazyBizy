import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ProjectReportInputsStep from "./ProjectReportInputsStep";
import { INITIAL_FORM_DATA, mergeProjectReportInputs, type GTABFormData } from "@/types/gtab";
import { buildCMAReportInput } from "@/lib/buildCMAReportInput";

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

describe("ProjectReportInputsStep — Bank Finance % is only editable where the backend honours it", () => {
  it("MSME scheme: Bank Finance on Fixed Capital % is a real editable input", () => {
    const formData = baseFormData({ loan_scheme: "normal_msme" as any });
    render(<ProjectReportInputsStep formData={formData} updateFormData={vi.fn()} />);

    expect(screen.getByText("Bank Finance on Fixed Capital %")).toBeTruthy();
    expect(screen.queryByText(/not bank-adjustable/i)).toBeNull();
  });

  it("PMEGP scheme: Bank Finance % shows the scheme-fixed note, not an editable field", () => {
    const formData = baseFormData({ loan_scheme: "pmegp" as any });
    render(<ProjectReportInputsStep formData={formData} updateFormData={vi.fn()} />);

    expect(screen.getByText(/Fixed by PMEGP scheme rules/i)).toBeTruthy();
    expect(screen.getByText(/not bank-adjustable/i)).toBeTruthy();
  });

  it("Mudra scheme: Bank Finance % shows the scheme-fixed note, not an editable field", () => {
    const formData = baseFormData({ loan_scheme: "mudra_kishor" as any });
    render(<ProjectReportInputsStep formData={formData} updateFormData={vi.fn()} />);

    expect(screen.getByText(/Fixed by Mudra scheme rules/i)).toBeTruthy();
  });

  it("CGTMSE scheme: Bank Finance % shows the scheme-fixed note, not an editable field", () => {
    const formData = baseFormData({ loan_scheme: "cgtmse" as any });
    render(<ProjectReportInputsStep formData={formData} updateFormData={vi.fn()} />);

    expect(screen.getByText(/Fixed by CGTMSE scheme rules/i)).toBeTruthy();
  });

  it("Annual Interest Rate % stays editable for every scheme (never scheme-formula-locked)", () => {
    for (const scheme of ["pmegp", "mudra_kishor", "cgtmse", "normal_msme"]) {
      const formData = baseFormData({ loan_scheme: scheme as any });
      const { unmount } = render(<ProjectReportInputsStep formData={formData} updateFormData={vi.fn()} />);
      expect(screen.getByText("Annual Interest Rate %")).toBeTruthy();
      unmount();
    }
  });
});

describe("capacity schedule defaults and saved data", () => {
  it("shows the shared five-year schedule in the capacity inputs", () => {
    const formData = baseFormData({});
    render(<ProjectReportInputsStep formData={formData} updateFormData={vi.fn()} />);

    for (const [year, value] of [60, 75, 95, 100, 100].entries())
      expect(screen.getByLabelText(`Year ${year + 1} capacity percentage`).getAttribute("value")).toBe(String(value));
    expect(screen.queryByLabelText("Year 6 capacity percentage")).toBeNull();
  });

  it("migrates only the exact legacy default and preserves a custom schedule", () => {
    const legacy = mergeProjectReportInputs({
      dpr: {
        ...INITIAL_FORM_DATA.project_report_inputs.dpr,
        capacity_schedule_pct: undefined,
        capacity_y1_pct: 50,
        capacity_y2_pct: 60,
        capacity_y3_pct: 70,
        capacity_y4_pct: 75,
        capacity_y5_pct: 80,
      },
    });
    const custom = mergeProjectReportInputs({
      dpr: {
        ...INITIAL_FORM_DATA.project_report_inputs.dpr,
        capacity_schedule_pct: undefined,
        capacity_y1_pct: 55,
        capacity_y2_pct: 68,
        capacity_y3_pct: 82,
        capacity_y4_pct: 94,
        capacity_y5_pct: 100,
      },
    });

    expect([
      legacy.dpr.capacity_y1_pct,
      legacy.dpr.capacity_y2_pct,
      legacy.dpr.capacity_y3_pct,
      legacy.dpr.capacity_y4_pct,
      legacy.dpr.capacity_y5_pct,
    ]).toEqual([60, 75, 95, 100, 100]);
    expect([
      custom.dpr.capacity_y1_pct,
      custom.dpr.capacity_y2_pct,
      custom.dpr.capacity_y3_pct,
      custom.dpr.capacity_y4_pct,
      custom.dpr.capacity_y5_pct,
    ]).toEqual([55, 68, 82, 94, 100]);
  });

  it("uses the seven-year defaults and creates seven editable inputs for an 84-month duration", () => {
    const updateFormData = vi.fn();
    const { rerender } = render(
      <ProjectReportInputsStep formData={baseFormData({})} updateFormData={updateFormData} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "84mo" }));
    const savedInputs = updateFormData.mock.calls.at(-1)?.[0].project_report_inputs;
    expect(savedInputs.dpr.capacity_schedule_pct).toEqual([60, 75, 80, 85, 90, 95, 100]);

    rerender(
      <ProjectReportInputsStep
        formData={baseFormData({ project_report_inputs: savedInputs })}
        updateFormData={updateFormData}
      />,
    );
    for (let year = 1; year <= 7; year++)
      expect(screen.getByLabelText(`Year ${year} capacity percentage`)).toBeTruthy();
    expect(screen.queryByLabelText("Year 8 capacity percentage")).toBeNull();
  });

  it("validates entered percentages and saves valid edits to the selected year", () => {
    const updateFormData = vi.fn();
    render(<ProjectReportInputsStep formData={baseFormData({})} updateFormData={updateFormData} />);
    const yearTwoInput = screen.getByLabelText("Year 2 capacity percentage");

    fireEvent.change(yearTwoInput, { target: { value: "101" } });
    expect(screen.getByText("Enter a numeric percentage from 0 to 100.")).toBeTruthy();
    expect(updateFormData).not.toHaveBeenCalled();

    fireEvent.change(yearTwoInput, { target: { value: "0" } });
    expect(updateFormData.mock.calls.at(-1)?.[0].project_report_inputs.dpr.capacity_schedule_pct[1]).toBe(0);

    fireEvent.change(yearTwoInput, { target: { value: "82.5" } });
    expect(screen.queryByText("Enter a numeric percentage from 0 to 100.")).toBeNull();
    expect(updateFormData.mock.calls.at(-1)?.[0].project_report_inputs.dpr.capacity_schedule_pct[1]).toBe(82.5);
  });

  it("recalculates previews and sends saved custom values in the report request", () => {
    const schedule = [50, 70, 80, 90, 100, 95, 100];
    const savedInputs = mergeProjectReportInputs({
      loan: {
        ...INITIAL_FORM_DATA.project_report_inputs.loan,
        tenure_months: 84,
      },
      dpr: {
        ...INITIAL_FORM_DATA.project_report_inputs.dpr,
        capacity_schedule_pct: schedule,
      },
      revenue: {
        ...INITIAL_FORM_DATA.project_report_inputs.revenue,
        product_categories: [{
          id: "consulting",
          category: "Consulting",
          units_monthly: 5,
          avg_price: 1000,
          fixed_revenue: 0,
          number_of_months: 12,
        }],
      },
    });
    const formData = baseFormData({ project_report_inputs: savedInputs });
    render(<ProjectReportInputsStep formData={formData} updateFormData={vi.fn()} />);

    expect(screen.getByText("Year 3 projected revenue: Rs. 96,000")).toBeTruthy();
    expect(buildCMAReportInput(formData).assumptions.capacity_schedule_pct).toEqual(schedule);
    expect(mergeProjectReportInputs(savedInputs).dpr.capacity_schedule_pct).toEqual(schedule);
  });

  it("recalculates the displayed projected revenue after changing a yearly percentage", () => {
    const updateFormData = vi.fn();
    const initial = baseFormData({
      project_report_inputs: mergeProjectReportInputs({
        revenue: {
          ...INITIAL_FORM_DATA.project_report_inputs.revenue,
          product_categories: [{
            id: "consulting",
            category: "Consulting",
            units_monthly: 5,
            avg_price: 1000,
            fixed_revenue: 0,
            number_of_months: 12,
          }],
        },
      }),
    });
    const { rerender } = render(
      <ProjectReportInputsStep formData={initial} updateFormData={updateFormData} />,
    );

    fireEvent.change(screen.getByLabelText("Year 3 capacity percentage"), { target: { value: "80" } });
    const nextInputs = updateFormData.mock.calls.at(-1)?.[0].project_report_inputs;
    rerender(
      <ProjectReportInputsStep
        formData={baseFormData({ project_report_inputs: nextInputs })}
        updateFormData={updateFormData}
      />,
    );

    expect(screen.getByText("Year 3 projected revenue: Rs. 80,000")).toBeTruthy();
  });
});

describe("working-capital interest rate defaults and saved data", () => {
  it("uses 11.5% when no saved rate exists and preserves explicit saved rates", () => {
    expect(mergeProjectReportInputs().loan.wc_interest_rate_pct).toBe(11.5);
    expect(mergeProjectReportInputs({
      loan: {
        ...INITIAL_FORM_DATA.project_report_inputs.loan,
        wc_interest_rate_pct: 13.25,
      },
    }).loan.wc_interest_rate_pct).toBe(13.25);
    expect(mergeProjectReportInputs({
      loan: {
        ...INITIAL_FORM_DATA.project_report_inputs.loan,
        wc_interest_rate_pct: null,
      },
    }).loan.wc_interest_rate_pct).toBe(11.5);
  });

  it("migrates an explicit legacy saved WC rate without replacing it", () => {
    const saved = mergeProjectReportInputs({
      dpr: {
        ...INITIAL_FORM_DATA.project_report_inputs.dpr,
        wc_interest_rate_pct: 12.75,
      },
    });
    expect(saved.loan.wc_interest_rate_pct).toBe(12.75);
  });

  it("exposes an editable WC interest rate and stores an empty value for fallback", () => {
    const updateFormData = vi.fn();
    render(<ProjectReportInputsStep formData={baseFormData({})} updateFormData={updateFormData} />);

    const wcRateInput = screen.getByDisplayValue("11.5");
    expect(wcRateInput).toBeTruthy();
    fireEvent.change(wcRateInput, { target: { value: "" } });
    expect(updateFormData.mock.calls.at(-1)?.[0].project_report_inputs.loan.wc_interest_rate_pct).toBeNull();
  });
});

describe("annual interest rate defaults and saved data", () => {
  it("shows the 9.5% default and saves edits to project report inputs", () => {
    const updateFormData = vi.fn();
    render(<ProjectReportInputsStep formData={baseFormData({})} updateFormData={updateFormData} />);

    const interestRateInput = screen.getByDisplayValue("9.5");
    expect(interestRateInput).toBeTruthy();
    fireEvent.change(interestRateInput, { target: { value: "12.25" } });

    expect(updateFormData.mock.calls.at(-1)?.[0].project_report_inputs.loan.interest_rate_pct).toBe(12.25);
    expect(mergeProjectReportInputs({
      loan: {
        ...INITIAL_FORM_DATA.project_report_inputs.loan,
        interest_rate_pct: 12.25,
      },
    }).loan.interest_rate_pct).toBe(12.25);
  });
});
