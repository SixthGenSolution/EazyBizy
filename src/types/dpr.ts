export interface ProductItem {
  category: string;
  units_per_month: number;
  avg_price: number;
  monthly_revenue: number;
  mix_pct: number;
}

export interface ProjectCostLine {
  code: number;
  particulars: string;
  amount: number;
}

export interface MasterFormState {
  // Step 1
  entrepreneur_name: string;
  title: string;
  full_name: string;
  fathers_name: string;
  date_of_birth: string;
  gender: string;
  education: string;
  social_category: string;
  pan_number: string;
  aadhar_number: string;
  mobile: string;
  email: string;
  address: string;
  years_of_experience: number;
  previous_employer: string;
  previous_role: string;
  business_status: string;

  // Step 2
  business_name: string;
  nature_of_business: string;
  business_type: string;
  industry: string;
  commencement_date: string;
  store_address: string;
  primary_location: string;
  market_size: string;
  market_growth: string;
  expected_employment: number;
  gross_margin_pct: number;
  location: string;
  district: string;
  scheme: string;
  loan_type: string;
  area_type?: string;

  // Step 3
  products: ProductItem[];
  project_cost_items: ProjectCostLine[];

  // Step 4
  term_loan_amount: number;
  working_capital_loan: number;
  promoter_contribution: number;
  term_loan_amount_override?: number;
  working_capital_loan_override?: number;
  margin_money_override?: number;
  promoter_contribution_override?: number;
  total_working_capital_requirement: number;
  loan_interest_rate_pct: number;
  tenure_months: number;
  moratorium_months: number;
  processing_fee_pct: number;
  collateral: string;
  guarantor: string;

  // Step 5
  rent: number;
  num_employees: number;
  salary_per_employee: number;
  stationery: number;
  electricity_water: number;
  repair_maintenance: number;
  transport_conveyance: number;
  telephone_internet: number;
  marketing_advertising: number;
  miscellaneous: number;
  raw_material_monthly: number;
  marketing_expense_pct_cma: number;

  // Step 6
  working_days_per_year: number;
  fresh_leaves_per_day_kg: number;
  yield_rate_pct: number;
  selling_price_per_kg: number;
  cost_fresh_leaves_per_kg: number;
  cost_consumables_per_kg: number;
  cost_pet_bottle: number;
  hours_of_operation: number;

  // Step 7
  cost_per_sqft: number;
  built_up_area_sqft: number;
  machine1_name: string;
  machine1_qty: number;
  machine1_base_price: number;
  machine2_name: string;
  machine2_qty: number;
  machine2_base_price: number;
  machine3_name: string;
  machine3_qty: number;
  machine3_base_price: number;
  machine4_name: string;
  machine4_qty: number;
  machine4_price: number;

  // Step 8
  promoter_daily_wage: number;
  skilled_worker_daily_wage: number;
  num_skilled_workers: number;
  semi_skilled_daily_wage: number;
  num_semi_skilled_workers: number;
  hr_perquisites_rate_pct: number;
  admin_expense_per_month: number;

  // Step 9
  contingency_rate_pct: number;
  term_loan_pct_pct: number;
  wc_loan_pct_pct: number;
  term_loan_interest_pct: number;
  wc_interest_rate_pct: number;
  wc_interest_rate: number;
  salary_increase_rate_pct: number;
  admin_increase_rate_pct: number;
  marketing_expense_pct_pct: number;
  power_rate_per_unit: number;
  connected_load_kw: number;
  load_factor: number;
  hours_of_load_operation: number;
  building_dep_rate_pct: number;
  machinery_dep_rate_pct: number;

  // Step 10
  wc_raw_material_days: number;
  wc_wip_days: number;
  wc_finished_goods_days: number;
  wc_working_expenses_days: number;
  capacity_y1_pct: number;
  capacity_y2_pct: number;
  capacity_y3_pct: number;
  capacity_y4_pct: number;
  capacity_y5_pct: number;
  capacity_schedule_pct: number[];
  loan_tenure_years: number;
  moratorium_years: number;

  // Step 11
  cma_building_assets: number;
  cma_machinery_assets: number;
  cma_building_dep_pct: number;
  cma_machinery_dep_pct: number;
  cma_dep_rate_pct: number;
  revenue_growth_pct: number;
  salary_increase_pct: number;
  admin_increase_pct: number;
  tax_rate_pct: number;
  stock_holding_days: number;
  debtor_days: number;
  creditor_days: number;
  minimum_cash_balance: number;
  sc_market: number;
  sc_competitive: number;
  sc_business_model: number;
  sc_promoter_exp: number;
  sc_fin_contrib: number;
}

export interface DPRCalculationResult {
  success: boolean;
  data: {
    meta: {
      report_id: string;
      entrepreneur_name: string;
      generated_on: string;
      total_project_cost: number;
    };
    dpr: {
      project_cost: {
        total_project_cost: number;
        equity_capital: number;
        term_loan: number;
        wc_loan: number;
        debt_equity_ratio: number;
      };
      profit_and_loss_years: Array<{
        year: number;
        capacity: number;
        revenue: number;
        net_profit: number;
        cash_accruals: number;
      }>;
      dscr: {
        average: number;
        years: Array<{
          year: number;
          dscr: number;
        }>;
      };
      breakeven_years: Array<{
        year: number;
        bep_sales: number;
        bep_pct: number;
      }>;
    };
    cma: {
      net_monthly_revenue: number;
      ebitda_monthly: number;
      emi: number;
      credit_rating: string;
      recommendation: string;
      risk_level: string;
      dscr_y1: number;
      roi_ebitda_pct: number;
    };
  };
}
