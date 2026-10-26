import { describe, it, expect } from "vitest";
import { buildWdvDepreciationSchedule } from "./wdvDepreciation";
import { INITIAL_FORM_DATA, type GTABFormData } from "@/types/gtab";

function makeFormData(overrides: Partial<GTABFormData> = {}): GTABFormData {
  return {
    ...INITIAL_FORM_DATA,
    shed_building_cost: 1_000_000,
    plant_machinery: [
      { id: "1", machine_name: "Lathe", cost: 500_000, quantity: 1, unit_cost: 500_000, supplier_name: "", supplier_phone: "", supplier_email: "" },
    ],
    machinery_installation_cost: 20_000,
    computers_cost: 50_000,
    furniture_cost: 30_000,
    electrification_cost: 0,
    racks_storage_cost: 0,
    transportation_cost: 0,
    project_report_inputs: {
      ...INITIAL_FORM_DATA.project_report_inputs,
      dpr: {
        ...INITIAL_FORM_DATA.project_report_inputs.dpr,
        contingency_pct: 5,
        building_dep_rate_pct: 5,
      },
      revenue: {
        ...INITIAL_FORM_DATA.project_report_inputs.revenue,
        depreciation_pct: 10,
      },
    },
    ...overrides,
  } as GTABFormData;
}

describe("buildWdvDepreciationSchedule", () => {
  it("computes gross block with contingency on P&M only", () => {
    const dep = buildWdvDepreciationSchedule(makeFormData());
    // machinery base = 500000 + 20000 = 520000; +5% contingency = 546000
    expect(dep.pmWithContingency).toBeCloseTo(546_000, 2);
    expect(dep.fixturesGross).toBeCloseTo(80_000, 2); // computers + furniture
    expect(dep.buildingGross).toBe(1_000_000);
    expect(dep.grossBlock).toBeCloseTo(1_000_000 + 546_000 + 80_000, 2);
  });

  it("reuses the dynamically calculated Year-1 opening WDV in all five years", () => {
    const dep = buildWdvDepreciationSchedule(makeFormData());
    expect(dep.schedule).toHaveLength(5);
    expect(dep.schedule.map((row) => row.openingWdv)).toEqual(
      Array(5).fill(dep.schedule[0].openingWdv),
    );
    expect(new Set(dep.schedule.map((row) => row.depreciation)).size).toBe(1);
  });

  it("reconciles depreciation rates, accumulated depreciation, and closing net block", () => {
    const dep = buildWdvDepreciationSchedule(makeFormData());
    let accumulatedDepreciation = 0;

    dep.schedule.forEach((row) => {
      expect(row.buildingDepreciation).toBe(
        Math.round(row.buildingOpeningWdv * dep.buildingRatePct / 100),
      );
      expect(row.machineryDepreciation).toBe(
        Math.round(row.machineryOpeningWdv * dep.machineryRatePct / 100),
      );
      expect(row.depreciation).toBe(
        row.buildingDepreciation + row.machineryDepreciation,
      );
      accumulatedDepreciation += row.depreciation;
      expect(row.accumulatedDepreciation).toBe(accumulatedDepreciation);
      expect(row.closingWdv).toBe(dep.grossBlock - accumulatedDepreciation);
      expect(row.closingWdv).toBe(row.buildingClosingWdv + row.machineryClosingWdv);
    });
  });

  it("never lets closing WDV go negative", () => {
    const dep = buildWdvDepreciationSchedule(makeFormData());
    for (const row of dep.schedule) {
      expect(row.closingWdv).toBeGreaterThanOrEqual(0);
      expect(row.buildingClosingWdv).toBeGreaterThanOrEqual(0);
      expect(row.machineryClosingWdv).toBeGreaterThanOrEqual(0);
    }
  });

  it("matches the backend's Year-1 math exactly: dep = opening x rate", () => {
    const dep = buildWdvDepreciationSchedule(makeFormData());
    const year1 = dep.schedule[0];
    expect(year1.buildingDepreciation).toBeCloseTo(1_000_000 * 0.05, 2);
    expect(year1.machineryDepreciation).toBeCloseTo((546_000 + 80_000) * 0.10, 2);
  });

  it("recalculates every year from changed asset costs and rates", () => {
    const baseline = buildWdvDepreciationSchedule(makeFormData());
    const changed = buildWdvDepreciationSchedule(
      makeFormData({
        shed_building_cost: 600_000,
        project_report_inputs: {
          ...INITIAL_FORM_DATA.project_report_inputs,
          dpr: { ...INITIAL_FORM_DATA.project_report_inputs.dpr, building_dep_rate_pct: 8 },
          revenue: { ...INITIAL_FORM_DATA.project_report_inputs.revenue, depreciation_pct: 12 },
        },
      }),
    );
    expect(changed.schedule.map((row) => row.openingWdv)).toEqual(
      Array(5).fill(changed.schedule[0].openingWdv),
    );
    expect(changed.schedule[0].openingWdv).not.toBe(baseline.schedule[0].openingWdv);
    expect(changed.schedule[0].depreciation).not.toBe(baseline.schedule[0].depreciation);
    expect(changed.schedule[4].closingWdv).not.toBe(baseline.schedule[4].closingWdv);
  });

  it("returns an all-zero schedule when no capex has been entered", () => {
    const dep = buildWdvDepreciationSchedule(
      makeFormData({
        shed_building_cost: 0,
        plant_machinery: [],
        machinery_installation_cost: 0,
        computers_cost: 0,
        furniture_cost: 0,
        electrification_cost: 0,
        racks_storage_cost: 0,
        transportation_cost: 0,
      }),
    );
    expect(dep.grossBlock).toBe(0);
    expect(dep.schedule.every((row) => row.depreciation === 0)).toBe(true);
  });
});
