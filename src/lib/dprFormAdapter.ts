import { CAPACITY_SCHEDULE } from "./capacitySchedule";

import type { MasterFormState, ProductItem, ProjectCostLine } from "@/types/dpr";
import type { GTABFormData, MachineryItem } from "@/types/gtab";
import {
  getFinancingPlan,
  getNormalizedProjectReportInputs,
  getProjectCostBreakdown,
  getProjectReportMachineryTotal,
  getProjectReportPromoterContribution,
} from "@/lib/projectReport";
import { getAnnualWorkingCapital, getMonthlyWorkingCapital } from "@/lib/workingCapital";

const titleize = (value?: string | null) =>
  value
    ? value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
    : "";

const fullName = (formData: GTABFormData) =>
  [formData.first_name, formData.middle_name, formData.last_name].filter(Boolean).join(" ");

const annualWorkingCapital = (formData: GTABFormData) =>
  getAnnualWorkingCapital(Number(formData.working_capital_required || 0), formData.working_capital_period);

const monthlyWorkingCapital = (formData: GTABFormData) =>
  getMonthlyWorkingCapital(Number(formData.working_capital_required || 0), formData.working_capital_period);

const getSchemeLabel = (formData: GTABFormData, fallback?: string | null) => {
  if (formData.loan_scheme === "other_scheme") {
    return formData.loan_scheme_other || fallback || "Other Scheme";
  }

  return fallback || titleize(formData.loan_scheme) || "Normal MSME";
};

const projectCostLines = (formData: GTABFormData): ProjectCostLine[] => {
  const report = getNormalizedProjectReportInputs(formData);
  const machineryTotal = getProjectReportMachineryTotal(formData);
  const costBreakdown = getProjectCostBreakdown(formData);
  const isTrading = formData.industry_type === "trading";
  const isService = formData.industry_type === "service";
  const isAgriculture = formData.industry_type === "agriculture";

  return [
    {
      code: 1,
      particulars: isTrading ? "Shop Security / Trade Location" : isService ? "Office Security / Service Location" : isAgriculture ? "Agriculture Land / Location" : "Land",
      amount: isTrading || isService ? 0 : Number(formData.land_cost || 0),
    },
    {
      code: 2,
      particulars: isTrading ? "Shop Setup / Renovation" : isService ? "Office Setup / Interior" : isAgriculture ? "Farm Setup / Storage / Shed" : "Factory / Shed",
      amount: Number(formData.shed_building_cost || report.project_cost.building_renovation || 0),
    },
    {
      code: 3,
      particulars: isTrading ? "Trading Fixtures / Equipment" : isService ? "Service Equipment / Fixed Assets" : isAgriculture ? "Agriculture Equipment / Tools" : "Plant & Machinery",
      amount: machineryTotal,
    },
    {
      code: 4,
      particulars: isTrading ? "Initial Stock & Initial Expenditure" : isService ? "Software, Tools & Initial Expenditure" : isAgriculture ? "Initial Inputs & Initial Expenditure" : "Initial Expenditure",
      amount:
        Number(formData.computers_cost || 0) +
        Number(formData.furniture_cost || 0) +
        Number(formData.electrification_cost || 0) +
        Number(formData.racks_storage_cost || 0) +
        Number(formData.transportation_cost || 0) +
        Number(formData.other_initial_expenditure || 0),
    },
    { code: 5, particulars: "Working Capital (Promoter Share)", amount: costBreakdown.promoterWorkingCapitalContribution },
  ];
};

const productItems = (formData: GTABFormData): ProductItem[] => {
  const report = getNormalizedProjectReportInputs(formData);
  const categories = report.revenue.product_categories;

  if (categories.length > 0) {
    return categories.map((item) => ({
      category: item.category || "Product / Service",
      units_per_month: Number(item.quantity_sold || item.units_monthly || 0),
      avg_price: Number(item.selling_price || item.avg_price || 0),
      monthly_revenue:
        Number(item.fixed_revenue || 0) ||
        Number(item.quantity_sold || item.units_monthly || 0) *
          Number(item.selling_price || item.avg_price || 0),
      mix_pct: 100 / categories.length,
    }));
  }

  return [
    {
      category: formData.products_services || formData.type_of_business || "Product / Service",
      units_per_month: 1,
      avg_price: Number(formData.expected_monthly_revenue || 0),
      monthly_revenue: Number(formData.expected_monthly_revenue || 0),
      mix_pct: 100,
    },
  ];
};

const machineryAt = (items: MachineryItem[], index: number) => items[index];

export const buildDprFormStateFromGTAB = (formData: GTABFormData): MasterFormState => {
  const report = getNormalizedProjectReportInputs(formData);
  const name = fullName(formData) || report.promoter.full_name || "Applicant";
  const products = productItems(formData);
  const costItems = projectCostLines(formData);
  const totalProjectCost = costItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const machineryItems = report.project_cost.plant_machinery_items;
  const dpr = report.dpr;
  const machineryTotal = getProjectReportMachineryTotal(formData);
  const financingPlan = getFinancingPlan(formData);
  const promoterContribution =
    getProjectReportPromoterContribution(formData, totalProjectCost) || Number(formData.margin_money || 0);
  const monthlyWorkingCapitalRequirement = monthlyWorkingCapital(formData);
  const termLoanAmount = financingPlan.termLoanAmount;
  const wcLoan = financingPlan.workingCapitalLoan;
  const skilledWorkers = Number(formData.skilled_workers_count || 0);
  const semiSkilledWorkers = Number(formData.semi_skilled_workers_count || 0);
  const wagesWorkers = Number(formData.wages_count || 0);
  const structuredEmployeeCount = skilledWorkers + semiSkilledWorkers + wagesWorkers;
  const structuredMonthlySalary =
    skilledWorkers * Number(formData.skilled_workers_salary || 0) +
    semiSkilledWorkers * Number(formData.semi_skilled_workers_salary || 0) +
    wagesWorkers * Number(formData.wages_salary || 0);
  const salaryPerEmployee =
    structuredEmployeeCount > 0
      ? structuredMonthlySalary / structuredEmployeeCount
      : Number(formData.salary_per_employee || 0);
  const primaryMachine = machineryAt(machineryItems, 0);
  const secondMachine = machineryAt(machineryItems, 1);
  const thirdMachine = machineryAt(machineryItems, 2);
  const fourthMachine = machineryAt(machineryItems, 3);

  return {
    entrepreneur_name: name,
    title: formData.gender === "female" ? "Ms." : "Mr.",
    full_name: name,
    area_type: formData.area_type === 'urban' ? 'Urban' : 'Rural',
    fathers_name: report.promoter.fathers_name,
    date_of_birth: report.promoter.date_of_birth || "1985-01-01",
    gender: titleize(formData.gender),
    education: titleize(formData.education),
    social_category: titleize(formData.social_category),
    pan_number: report.promoter.pan_number,
    aadhar_number: report.promoter.aadhar_number,
    mobile: formData.contact_mobile || report.promoter.mobile,
    email: formData.contact_email || report.promoter.email,
    address: [formData.address_line_1, formData.address_line_2, formData.city, formData.state, formData.pincode]
      .filter(Boolean)
      .join(", "),
    years_of_experience: Number(report.promoter.years_experience || formData.business_duration_months / 12 || 0),
    previous_employer: report.promoter.previous_employer,
    previous_role: report.promoter.previous_role || formData.promoter_experience,
    business_status: titleize(formData.business_type),

    business_name: formData.business_entity_name || report.business.business_name || "Proposed Business",
    nature_of_business: formData.type_of_business || report.business.nature_of_business || formData.business_description,
    business_type: titleize(formData.registration_type),
    industry: formData.industry_type === "others" ? formData.industry_other : titleize(formData.industry_type),
    commencement_date: report.business.commencement_date || new Date().toISOString().slice(0, 10),
    store_address: report.business.store_address || formData.address_line_1,
    primary_location: [formData.city, formData.state].filter(Boolean).join(", "),
    market_size: report.business.market_size_crores
      ? `${report.business.market_size_crores} Crores`
      : formData.target_market,
    market_growth: report.business.market_growth_pct
      ? `${report.business.market_growth_pct}%`
      : "As per market conditions",
    expected_employment: Number(formData.expected_employment || structuredEmployeeCount || formData.employee_count || 0),
    gross_margin_pct: Number(report.revenue.gross_margin_pct || 100),
    location: formData.city || report.business.store_city,
    district: formData.district || formData.city,
    scheme: getSchemeLabel(formData, report.loan.loan_scheme),
    loan_type: report.loan.loan_type || titleize(formData.loan_purpose),

    products,
    project_cost_items: costItems,

    term_loan_amount: termLoanAmount,
    working_capital_loan: wcLoan,
    promoter_contribution: promoterContribution,
    total_working_capital_requirement: monthlyWorkingCapitalRequirement,
    loan_interest_rate_pct: Number(report.loan.interest_rate_pct || 9.5),
    tenure_months: Number(report.loan.tenure_months || 60),
    moratorium_months: Number(report.loan.moratorium_months || 0),
    processing_fee_pct: Number(report.loan.processing_fee_pct || 1),
    collateral: report.loan.collateral_details,
    guarantor: [report.loan.guarantor_name, report.loan.guarantor_relation].filter(Boolean).join(" - "),

    rent: Number(formData.monthly_rent || 0),
    num_employees: Number(structuredEmployeeCount || formData.employee_count || 0),
    salary_per_employee: salaryPerEmployee,
    stationery: Number(formData.stationery_cost || 0),
    electricity_water: Number(formData.electricity_water_cost || 0),
    repair_maintenance: Number(formData.repair_maintenance_cost || 0),
    transport_conveyance: Number(formData.transport_cost || 0),
    telephone_internet: Number(formData.telephone_internet_cost || 0),
    marketing_advertising: Number(formData.marketing_cost || 0),
    miscellaneous: Number(formData.miscellaneous_cost || 0),
    raw_material_monthly: Number(formData.raw_material_cost || 0),
    marketing_expense_pct_cma: 0,

    working_days_per_year: Number(dpr.working_days_per_year || 300),
    fresh_leaves_per_day_kg: Number(dpr.fresh_leaves_per_day_kg || 100),
    yield_rate_pct: Number(dpr.yield_rate_pct || 20),
    selling_price_per_kg: Number(dpr.selling_price_per_kg || products[0]?.avg_price || 1),
    cost_fresh_leaves_per_kg: Number(dpr.cost_fresh_leaves_per_kg || 20),
    cost_consumables_per_kg: Number(dpr.cost_consumables_per_kg || 2.5),
    cost_pet_bottle: Number(dpr.cost_pet_bottle || 9.5),
    hours_of_operation: Number(dpr.hours_of_operation || 8),

    cost_per_sqft: 500,
    built_up_area_sqft: Number(formData.shed_building_cost || 0) > 0 ? Number(formData.shed_building_cost || 0) / 500 : 0,
    machine1_name: primaryMachine?.machine_name || "Primary Machinery",
    machine1_qty: Number(primaryMachine?.quantity || 1),
    machine1_base_price: Number(primaryMachine?.unit_cost || primaryMachine?.cost || machineryTotal || 0),
    machine2_name: secondMachine?.machine_name || "Secondary Machinery",
    machine2_qty: Number(secondMachine?.quantity || 1),
    machine2_base_price: Number(secondMachine?.unit_cost || secondMachine?.cost || 0),
    machine3_name: thirdMachine?.machine_name || "Additional Machinery",
    machine3_qty: Number(thirdMachine?.quantity || 1),
    machine3_base_price: Number(thirdMachine?.unit_cost || thirdMachine?.cost || 0),
    machine4_name: fourthMachine?.machine_name || "Tools & Installation",
    machine4_qty: Number(fourthMachine?.quantity || 1),
    machine4_price:
      Number(fourthMachine?.cost || fourthMachine?.unit_cost || 0) +
      Number(formData.machinery_installation_cost || 0),

    promoter_daily_wage: salaryPerEmployee ? salaryPerEmployee / 25 : 0,
    skilled_worker_daily_wage: formData.skilled_workers_salary
      ? Number(formData.skilled_workers_salary || 0) / 25
      : salaryPerEmployee ? salaryPerEmployee / 25 : 0,
    num_skilled_workers: skilledWorkers || Math.max(Number(formData.employee_count || 0) - 1, 0),
    semi_skilled_daily_wage: formData.semi_skilled_workers_salary
      ? Number(formData.semi_skilled_workers_salary || 0) / 30
      : salaryPerEmployee ? salaryPerEmployee / 30 : 0,
    num_semi_skilled_workers: semiSkilledWorkers,
    hr_perquisites_rate_pct: 10,
    admin_expense_per_month:
      Number(formData.stationery_cost || 0) +
      Number(formData.telephone_internet_cost || 0) +
      Number(formData.miscellaneous_cost || 0),

    contingency_rate_pct: Number(dpr.contingency_rate_pct || 10),
    term_loan_pct_pct:
      totalProjectCost > 0
        ? Number(((termLoanAmount / totalProjectCost) * 100).toFixed(2))
        : Number(dpr.term_loan_pct || 70),
    wc_loan_pct_pct:
      monthlyWorkingCapitalRequirement > 0
        ? Number(((wcLoan / monthlyWorkingCapitalRequirement) * 100).toFixed(2))
        : Number(dpr.wc_loan_pct || 60),
    term_loan_interest_pct: Number(report.loan.interest_rate_pct || 9.5),
    // WC interest = TL interest + 1.5% (CA standard — WC OD rate is higher than TL)
    wc_interest_rate_pct: Number(report.loan.interest_rate_pct || 9.5) + 1.5,
    salary_increase_rate_pct: Number((dpr as any).salary_increase_pct || dpr.salary_increase_rate_pct || 10),
    admin_increase_rate_pct: Number(dpr.admin_increase_rate_pct || report.revenue.expense_growth_pct || 5),
    marketing_expense_pct_pct: Number(dpr.marketing_expense_pct || 2.5),
    power_rate_per_unit: Number(dpr.power_rate_per_unit || 9.65),
    connected_load_kw: Number(dpr.connected_load_kw || 7),
    load_factor: Number(dpr.load_factor || 0.8),
    hours_of_load_operation: Number(dpr.hours_of_load_operation || 4),
    building_dep_rate_pct: Number(dpr.building_dep_rate_pct || report.revenue.depreciation_pct || 5),
    machinery_dep_rate_pct: Number(dpr.machinery_dep_rate_pct || report.revenue.depreciation_pct || 10),

    wc_raw_material_days: Number(dpr.wc_raw_material_days || report.working_capital.stock_days || 30),
    wc_wip_days: Number(dpr.wc_wip_days || 5),
    wc_finished_goods_days: Number(dpr.wc_finished_goods_days || report.working_capital.stock_days || 30),
    wc_working_expenses_days: Number(dpr.wc_working_expenses_days || 30),
    capacity_y1_pct: Number(dpr.capacity_y1_pct || CAPACITY_SCHEDULE[0]),
    capacity_y2_pct: Number(dpr.capacity_y2_pct || CAPACITY_SCHEDULE[1]),
    capacity_y3_pct: Number(dpr.capacity_y3_pct || CAPACITY_SCHEDULE[2]),
    capacity_y4_pct: Number(dpr.capacity_y4_pct || CAPACITY_SCHEDULE[3]),
    capacity_y5_pct: Number(dpr.capacity_y5_pct || CAPACITY_SCHEDULE[4]),
    loan_tenure_years: Number(dpr.loan_tenure_years || Math.max(Math.ceil(Number(report.loan.tenure_months || 60) / 12), 1)),
    // FIX: moratorium in months → years. Math.ceil so 6 months → 1 year (bank year 1 is moratorium)
    moratorium_years: Math.ceil(Number(report.loan.moratorium_months || 0) / 12),

    cma_building_assets: Number(formData.shed_building_cost || 0),
    cma_machinery_assets: machineryTotal,
    // FIX: use actual user-entered depreciation rates, not hardcoded values
    cma_building_dep_pct: Number(dpr.building_dep_rate_pct || 5),
    cma_machinery_dep_pct: Number(dpr.machinery_dep_rate_pct || report.revenue.depreciation_pct || 10),
    cma_dep_rate_pct: Number(report.revenue.depreciation_pct || 10),
    revenue_growth_pct: Number(report.revenue.revenue_growth_pct || 7),
    salary_increase_pct: Number((dpr as any).salary_increase_pct || dpr.salary_increase_rate_pct || 10),
    admin_increase_pct: Number(report.revenue.expense_growth_pct || 5),
    // FIX: tax rate must default to 25% (CA mandatory), never 0
    tax_rate_pct: Number(report.revenue.tax_rate_pct || 25),
    stock_holding_days: Number(report.working_capital.stock_days || 30),
    debtor_days: Number(report.working_capital.debtors_days || 30),
    creditor_days: Number(report.working_capital.creditors_days || 15),
    minimum_cash_balance: Number(report.working_capital.cash_balance || monthlyWorkingCapitalRequirement || 0),
    sc_market: Number(dpr.score_market || 8),
    sc_competitive: Number(dpr.score_competitive || 8),
    sc_business_model: Number(dpr.score_business_model || 8),
    // FIX: auto-compute promoter experience score from actual years entered in Step 9
    sc_promoter_exp: (() => {
      const yrs = Number(report.promoter.years_experience || 0);
      if (yrs >= 10) return 10;
      if (yrs >= 5)  return 9;
      if (yrs >= 3)  return 8;
      if (yrs >= 1)  return 6;
      return 4; // 0 years = weak score
    })(),
    sc_fin_contrib: Number(dpr.score_fin_contrib || (promoterContribution > 0 ? 8 : 5)),
    // Bank / lender name from Step 9 Loan Structure
    bank_name: report.loan.bank_name || '',
    preferred_bank: report.loan.bank_name || '',
  };
};
