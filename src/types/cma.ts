export interface CMAApplicantProfile {
  name: string;
  father_spouse_name: string;
  dob: string;
  pan: string;
  aadhaar: string;
  mobile: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  education: string;
  experience_years: number;
}

export interface CMABusinessProfile {
  entity_name: string;
  constitution: 'Proprietorship' | 'Partnership' | 'LLP' | 'Pvt Ltd';
  activity: 'Manufacturing' | 'Trading' | 'Service';
  gst_number: string;
  udyam_registration: string;
  iec?: string;
  shop_act?: string;
  commencement_date: string;
}

export interface CMALoanRequirement {
  purpose: string;
  loan_type: string;
  scheme: string;
  amount: number;
  preferred_bank: string;
  tenure_months: number;
  moratorium_months: number;
  interest_rate: number;
}

export interface CMAProjectCost {
  land: number;
  building: number;
  plant_machinery: number;
  electrical: number;
  furniture: number;
  computers: number;
  vehicles: number;
  office_equipment: number;
  generator_ups: number;
  preliminary_expenses: number;
  registration_license: number;
  consultancy_fees: number;
  marketing_launch: number;
  contingency: number;
  initial_stock: number;
  cash_margin: number;
  receivables_support: number;
}

export interface CMAMeansOfFinance {
  promoter_contribution: number;
  unsecured_loans: number;
  subsidy: number;
  term_loan: number;
  working_capital_loan: number;
  other_funding: number;
}

export interface CMAHistoricalFinancial {
  year: string;
  sales: number;
  purchases: number;
  gross_profit: number;
  salary: number;
  rent: number;
  utilities: number;
  admin_expenses: number;
  marketing: number;
  depreciation: number;
  interest: number;
  tax: number;
  pat: number;
  cash: number;
  debtors: number;
  creditors: number;
  stock: number;
  term_loan_outstanding: number;
  wc_outstanding: number;
  net_fixed_assets: number;
  net_worth: number;
}

export interface CMAProductRevenueModel {
  product_name: string;
  unit: string;
  purchase_cost: number;
  selling_price: number;
  monthly_qty: number;
  growth_pct: number;
}

export interface CMAManpower {
  designation: string;
  headcount: number;
  monthly_salary: number;
  annual_increment_pct: number;
}

export interface CMAOperatingExpenses {
  rent: number;
  electricity: number;
  water: number;
  telephone: number;
  internet: number;
  transport: number;
  repair: number;
  stationery: number;
  marketing: number;
  insurance: number;
  professional_fees: number;
  misc: number;
}

export interface CMAWCNorms {
  rm_holding_days: number;
  wip_days: number;
  fg_days: number;
  receivable_days: number;
  creditor_days: number;
  cash_holding_days: number;
}

export interface CMAPromoterNetWorth {
  residential_property: number;
  commercial_property: number;
  fd: number;
  savings: number;
  mutual_funds: number;
  shares: number;
  gold: number;
  other_assets: number;
  liabilities: number;
}

export interface CMACollateralItem {
  type: string;
  description: string;
  market_value: number;
  forced_sale_value: number;
  owner: string;
}

export interface CMAFormData {
  applicant: CMAApplicantProfile;
  business: CMABusinessProfile;
  loan: CMALoanRequirement;
  project_cost: CMAProjectCost;
  means_of_finance: CMAMeansOfFinance;
  historical_financials: CMAHistoricalFinancial[];
  products: CMAProductRevenueModel[];
  manpower: CMAManpower[];
  opex: CMAOperatingExpenses;
  wc_norms: CMAWCNorms;
  export_sales_pct: number;
  depreciation_rates: Record<string, number>;
  tax_rate: number;
  promoter_net_worth: CMAPromoterNetWorth;
  guarantor?: {
    name: string;
    relation: string;
    net_worth: number;
  };
  collateral?: {
    primary_security: string;
    collateral_items: CMACollateralItem[];
    cgtmse_covered: boolean;
    cgtmse_coverage_pct: number;
    cgtmse_fee_pct?: number;
    insurance_arranged: boolean;
  };
  ca_recommendation?: {
    rating: 'green' | 'amber' | 'red';
    recommendation: 'Recommend' | 'Conditional' | 'Decline';
    notes: string;
    strengths?: string;
    weaknesses?: string;
    risk_mitigants?: string;
    covenants?: string[];
  };
  assumptions: {
    revenue_growth: number;
    cogs_growth: number;
    expense_growth: number;
    salary_increment: number;
    interest_change: number;
  };
}

export const INITIAL_CMA_DATA: CMAFormData = {
  applicant: {
    name: '', father_spouse_name: '', dob: '', pan: '', aadhaar: '',
    mobile: '', email: '', address: '', city: '', state: '', pincode: '',
    education: '', experience_years: 0
  },
  business: {
    entity_name: '', constitution: 'Proprietorship', activity: 'Manufacturing',
    gst_number: '', udyam_registration: '', commencement_date: ''
  },
  loan: {
    purpose: '', loan_type: '', scheme: '', amount: 0, preferred_bank: '',
    tenure_months: 60, moratorium_months: 6, interest_rate: 9.5
  },
  project_cost: {
    land: 0, building: 0, plant_machinery: 0, electrical: 0, furniture: 0,
    computers: 0, vehicles: 0, office_equipment: 0, generator_ups: 0,
    preliminary_expenses: 0, registration_license: 0, consultancy_fees: 0,
    marketing_launch: 0, contingency: 0, initial_stock: 0, cash_margin: 0,
    receivables_support: 0
  },
  means_of_finance: {
    promoter_contribution: 0, unsecured_loans: 0, subsidy: 0,
    term_loan: 0, working_capital_loan: 0, other_funding: 0
  },
  historical_financials: [],
  products: [],
  manpower: [],
  opex: {
    rent: 0, electricity: 0, water: 0, telephone: 0, internet: 0,
    transport: 0, repair: 0, stationery: 0, marketing: 0, insurance: 0,
    professional_fees: 0, misc: 0
  },
  wc_norms: {
    rm_holding_days: 60, wip_days: 15, fg_days: 30,
    receivable_days: 45, creditor_days: 30, cash_holding_days: 15
  },
  export_sales_pct: 0,
  depreciation_rates: {
    building: 5, plant_machinery: 10, furniture: 10,
    vehicles: 15, computers: 40, office_equipment: 10
  },
  tax_rate: 25,
  promoter_net_worth: {
    residential_property: 0, commercial_property: 0, fd: 0, savings: 0,
    mutual_funds: 0, shares: 0, gold: 0, other_assets: 0, liabilities: 0
  },
  assumptions: {
    revenue_growth: 10, cogs_growth: 5, expense_growth: 5,
    salary_increment: 8, interest_change: 0
  }
};
