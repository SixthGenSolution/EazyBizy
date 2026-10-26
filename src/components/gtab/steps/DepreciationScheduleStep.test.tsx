import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DepreciationScheduleStep from "./DepreciationScheduleStep";
import { INITIAL_FORM_DATA, type GTABFormData } from "@/types/gtab";

describe("DepreciationScheduleStep", () => {
  it("shows an empty-state message when no capex has been entered", () => {
    render(<DepreciationScheduleStep formData={INITIAL_FORM_DATA} />);
    expect(screen.getByText(/No capital expenditure entered yet/i)).toBeTruthy();
  });

  it("renders the WDV schedule and Year 1-5 columns once capex is present", () => {
    const formData: GTABFormData = {
      ...INITIAL_FORM_DATA,
      shed_building_cost: 1_000_000,
      plant_machinery: [
        { id: "1", machine_name: "Lathe", cost: 500_000, quantity: 1, unit_cost: 500_000, supplier_name: "", supplier_phone: "", supplier_email: "" },
      ],
    };
    render(<DepreciationScheduleStep formData={formData} />);
    expect(screen.getByText(/Depreciation Schedule \(WDV Method\)/i)).toBeTruthy();
    expect(screen.getAllByText("Year 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Year 5").length).toBeGreaterThan(0);
    expect(screen.getByText("Accumulated Depreciation")).toBeTruthy();
    expect(screen.getByText(/Closing WDV \(Net Block\)/i)).toBeTruthy();
    expect(screen.getByText(/Opening WDV is the dynamically calculated Year 1 amount, held constant/i)).toBeTruthy();
    expect(screen.queryByText(/SLM/i)).toBeNull();
  });
});
