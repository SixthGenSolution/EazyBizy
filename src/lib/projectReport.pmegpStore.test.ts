import { describe, it, expect, afterEach } from "vitest";
import { getBankFinancePct, getFinancingPlan } from "./projectReport";
import { setSchemeRules, clearSchemeRulesStore } from "./schemeRulesStore";
import { INITIAL_FORM_DATA, type GTABFormData } from "@/types/gtab";
import { buildDprFormStateFromGTAB } from "@/lib/dprFormAdapter";

function msmeFormData(termLoanPct = 0): GTABFormData {
  return {
    ...INITIAL_FORM_DATA,
    loan_scheme: "msme_psu" as any,
    project_report_inputs: {
      ...INITIAL_FORM_DATA.project_report_inputs,
      dpr: { ...INITIAL_FORM_DATA.project_report_inputs.dpr, term_loan_pct: termLoanPct },
    },
  } as GTABFormData;
}

describe("getBankFinancePct — Rules Master default", () => {
  afterEach(() => clearSchemeRulesStore());

  it("falls back to the flat 75 when nothing is fetched and the user left the field blank", () => {
    expect(getBankFinancePct(msmeFormData(0))).toBe(75);
  });

  it("prefers the fetched scheme default over the flat 75 fallback", () => {
    setSchemeRules("msme_psu", { term_loan_pct_default: 82 });
    expect(getBankFinancePct(msmeFormData(0))).toBe(82);
  });

  it("the user's own entered value always wins over any default", () => {
    setSchemeRules("msme_psu", { term_loan_pct_default: 82 });
    expect(getBankFinancePct(msmeFormData(68))).toBe(68);
  });
});

describe("getFinancingPlan — total project cost", () => {
  it("uses term loan + working capital facility + promoter contribution for the total project cost", () => {
    const formData = {
      ...INITIAL_FORM_DATA,
      loan_scheme: "normal_msme",
      loan_purpose: "term_and_working_capital",
      land_cost: 100000,
      working_capital_required: 100000,
      working_capital_period: "monthly" as const,
      project_report_inputs: {
        ...INITIAL_FORM_DATA.project_report_inputs,
        dpr: {
          ...INITIAL_FORM_DATA.project_report_inputs.dpr,
          term_loan_pct: 70,
          wc_loan_pct: 50,
        },
      },
    } as GTABFormData;

    const plan = getFinancingPlan(formData);

    expect(plan.termLoanAmount).toBe(70000);
    expect(plan.workingCapitalLoan).toBe(50000);
    expect(plan.promoterContribution).toBe(80000);
    expect(plan.totalProjectCost).toBe(200000);
    expect(plan.totalProjectCost).toBe(plan.termLoanAmount + plan.workingCapitalLoan + plan.promoterContribution);
  });

  it("uses saved financing amount overrides instead of recalculating them", () => {
    const formData = {
      ...INITIAL_FORM_DATA,
      loan_scheme: "pmegp",
      loan_purpose: "term_and_working_capital",
      land_cost: 1_000_000,
      working_capital_required: 100_000,
      project_report_inputs: {
        ...INITIAL_FORM_DATA.project_report_inputs,
        dpr: {
          ...INITIAL_FORM_DATA.project_report_inputs.dpr,
          term_loan_amount_override: 610_000,
          working_capital_loan_override: 42_000,
          margin_money_override: 95_000,
          promoter_contribution_override: 250_000,
        },
      },
    } as GTABFormData;

    const plan = getFinancingPlan(formData);

    expect(plan.termLoanAmount).toBe(610_000);
    expect(plan.workingCapitalLoan).toBe(42_000);
    expect(plan.pmegpSubsidyAmount).toBe(95_000);
    expect(plan.promoterContribution).toBe(250_000);
    expect(plan.totalProjectCost).toBe(902_000);
  });

  it("passes manual financing amounts through to backend request data", () => {
    const formData = {
      ...INITIAL_FORM_DATA,
      project_report_inputs: {
        ...INITIAL_FORM_DATA.project_report_inputs,
        dpr: {
          ...INITIAL_FORM_DATA.project_report_inputs.dpr,
          term_loan_amount_override: 610_000,
          working_capital_loan_override: 42_000,
          margin_money_override: 95_000,
          promoter_contribution_override: 250_000,
        },
      },
    } as GTABFormData;

    const request = buildDprFormStateFromGTAB(formData);

    expect(request).toEqual(expect.objectContaining({
      term_loan_amount_override: 610_000,
      working_capital_loan_override: 42_000,
      margin_money_override: 95_000,
      promoter_contribution_override: 250_000,
      term_loan_amount: 610_000,
      working_capital_loan: 42_000,
      promoter_contribution: 250_000,
    }));
  });
});
