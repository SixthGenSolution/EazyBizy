import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectReportInputsStep from "./ProjectReportInputsStep";
import { INITIAL_FORM_DATA, mergeProjectReportInputs, type GTABFormData } from "@/types/gtab";

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

    for (const year of ["Y1: 60%", "Y2: 75%", "Y3: 95%", "Y4: 100%", "Y5: 100%"])
      expect(screen.getByText(year)).toBeTruthy();
  });

  it("migrates only the exact legacy default and preserves a custom schedule", () => {
    const legacy = mergeProjectReportInputs({
      dpr: {
        ...INITIAL_FORM_DATA.project_report_inputs.dpr,
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
});
