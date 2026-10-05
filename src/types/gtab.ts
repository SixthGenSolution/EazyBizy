// EazyBizy Application Types

export type GTABGender = 'male' | 'female' | 'undisclosed';
export type GTABEducation = 'post_graduate' | 'graduate' | 'plus_two' | 'tenth';
export type GTABSocialCategory = 'general' | 'obc' | 'minority' | 'sc' | 'st' | 'undisclosed' | 'women' | 'ex_serviceman' | 'pwd';
export type GTABRegistrationType = 'proprietorship' | 'partnership' | 'llp' | 'private_limited' | 'opc' | 'huf' | 'cooperative' | 'trust';
export type GTABBusinessType = 'new_business' | 'existing_business';
export type GTABIndustryType = 'manufacturing' | 'service' | 'trading' | 'agriculture' | 'others';
export type GTABLoanScheme =
  | 'pmegp'
  | 'mudra'           // legacy alias → treated as mudra_kishor
  | 'mudra_shishu'    // up to Rs.50K — no CMA
  | 'mudra_kishor'    // Rs.50K–5L — light CMA
  | 'mudra_tarun'     // Rs.5L–10L — full CMA
  | 'mudra_tarunplus' // Rs.10L–20L — full CMA (must have repaid Tarun)
  | 'cgtmse'          // guarantee scheme — full CMA
  | 'normal_msme'     // PSU bank MSME — full CMA
  | 'other_scheme';
export type GTABLoanPurpose = 'term_loan' | 'working_capital' | 'term_and_working_capital';
export type GTABApplicationStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'disbursed';
export type GTABWorkingCapitalPeriod = 'monthly' | 'annual';
export type ProjectReportLoanType = 'Term Loan' | 'Working Capital' | 'Composite';
export type ProjectReportCompetitorType = 'Organized' | 'Unorganized' | 'Online';

/** JSONB shape for plant_machinery column - matches DB and frontend */
export interface MachineryItem {
  id: string;
  machine_name: string;
  cost: number;
  machine_cost?: number;
  installation_cost?: number;
  other_capital_cost?: number;
  total_cost?: number;
  quantity?: number;
  unit_cost?: number;
  purchase_date?: string;
  supplier_name: string;
  supplier_city?: string;
  supplier_phone: string;
  supplier_email: string;
}

/** Type for plant_machinery JSON column - use when reading/writing to DB */
export type PlantMachineryJson = MachineryItem[];

/** Parse plant_machinery from DB JSON - returns empty array if invalid */
export function parsePlantMachinery(value: unknown): MachineryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is MachineryItem =>
        item != null &&
        typeof item === "object" &&
        "machine_name" in item &&
        "cost" in item
    )
    .map((item) => ({
      id: item.id || crypto.randomUUID(),
      machine_name: item.machine_name ?? "",
      quantity: Number(item.quantity) || 1,
      unit_cost: item.unit_cost !== undefined ? Number(item.unit_cost) || 0 : Number(item.cost) || 0,
      cost: Number(item.machine_cost || 0) + Number(item.installation_cost || 0) + Number(item.other_capital_cost || 0)
        || Number(item.total_cost) || Number(item.cost) || (Number(item.quantity) || 1) * (Number(item.unit_cost) || Number(item.cost) || 0),
      machine_cost: item.machine_cost !== undefined
        ? Number(item.machine_cost) || 0
        : Number(item.cost) || (Number(item.quantity) || 1) * (Number(item.unit_cost) || 0),
      installation_cost: Number(item.installation_cost) || 0,
      other_capital_cost: Number(item.other_capital_cost) || 0,
      total_cost: Number(item.machine_cost || 0) + Number(item.installation_cost || 0) + Number(item.other_capital_cost || 0)
        || Number(item.total_cost) || Number(item.cost) || (Number(item.quantity) || 1) * (Number(item.unit_cost) || 0),
      purchase_date: item.purchase_date ?? "",
      supplier_name: item.supplier_name ?? "",
      supplier_city: item.supplier_city ?? "",
      supplier_phone: item.supplier_phone ?? "",
      supplier_email: item.supplier_email ?? "",
    }));
}

export interface ProjectReportProductCategory {
  id: string;
  category: string;
  units_monthly: number;
  avg_price: number;
  fixed_revenue?: number;
  purchase_price?: number;
  selling_price?: number;
  quantity_sold?: number;
  margin_pct?: number;
  service_description?: string;
  billing_unit?: string;
  number_of_months?: number;
  service_mix_pct?: number;
}

export interface ProjectReportCompetitor {
  id: string;
  name: string;
  type: ProjectReportCompetitorType;
  distance: string;
  strengths: string;
  weaknesses: string;
}

export interface ProjectReportInputs {
  promoter: {
    full_name: string;
    fathers_name: string;
    date_of_birth: string;
    gender: string;
    educational_qual: string;
    social_category: string;
    pan_number: string;
    aadhar_number: string;
    mobile: string;
    email: string;
    address_line1: string;
    city: string;
    state: string;
    pincode: string;
    years_experience: number;
    previous_employer: string;
    previous_role: string;
    employment_from: string;
    employment_to: string;
  };
  business: {
    business_name: string;
    nature_of_business: string;
    business_type: string;
    industry: string;
    commencement_date: string;
    store_address: string;
    store_city: string;
    store_state: string;
    store_pincode: string;
    gst_number: string;
    msme_number: string;
    target_market: string;
    target_areas: string[];
    market_size_crores: number;
    market_growth_pct: number;
  };
  loan: {
    loan_scheme: string;
    loan_type: ProjectReportLoanType;
    loan_amount: number;
    interest_rate_pct: number;
    tenure_months: number;
    moratorium_months: number;
    processing_fee_pct: number;
    bank_name: string;
    collateral_details: string;
    guarantor_name: string;
    guarantor_relation: string;
  };
  project_cost: {
    building_renovation: number;
    plant_machinery_items: MachineryItem[];
    furniture_fixtures: number;
    computers_peripherals: number;
    electrification_wiring: number;
    additional_racks_storage: number;
    transportation_vehicle: number;
    preoperative_expenses: number;
  };
  /** Itemized breakdown for each preliminary capex category — name, qty, unit price, purchase date, supplier. */
  capex_items: {
    computers: MachineryItem[];
    furniture: MachineryItem[];
    electrification: MachineryItem[];
    racks_storage: MachineryItem[];
    transportation: MachineryItem[];
  };
  promoter_contribution: {
    own_savings: number;
    family_contribution: number;
    other_sources: number;
  };
  working_capital: {
    stock_days: number;
    debtors_days: number;
    cash_balance: number;
    creditors_days: number;
  };
  dpr: {
    // ── Production parameters (generic names — work for all industries) ──
    // ── Loan & financing ─────────────────────────────────────────────────
    term_loan_pct:              number;   // % of fixed capital financed by TL
    promoter_equity_pct:        number;   // % of project cost from promoter
    wc_loan_pct:                number;   // % of WC financed by bank (used when wc_finance_method = 'simple_margin')
    wc_finance_method:          "simple_margin" | "drawing_power"; // how the bank sizes WC finance — varies bank-to-bank
    wc_margin_pct:              number;   // bank's margin % on stock/debtors (used when wc_finance_method = 'drawing_power')
    promoter_drawings_pct:      number;   // % of each year's PAT drawn by promoter/partners; 0 = full retention
    capital_subsidy_pct:        number;   // MSME state capital subsidy % on fixed assets (0 = none)
    contingency_pct:            number;   // contingency on P&M as %
    loan_tenure_years:          number;
    moratorium_years:           number;
    // ── Financial assumptions (all sent to backend as-is) ────────────────
    building_dep_rate_pct:      number;   // building WDV depreciation %
    salary_increase_pct:        number;   // annual salary hike % (CA standard: 8-10%)
    admin_increase_rate_pct:    number;   // admin expense growth %
    marketing_expense_pct:      number;   // marketing as % of revenue
    // ── Working capital norms ─────────────────────────────────────────────
    wip_days:                   number;   // WIP holding days
    fg_days:                    number;   // finished goods holding days
    // Legacy WC field names (kept for backward compat)
    wc_raw_material_days:       number;
    wc_wip_days:                number;
    wc_finished_goods_days:     number;
    wc_working_expenses_days:   number;
    // ── Capacity utilisation schedule (% — e.g. 50 = 50%) ─────────────────
    capacity_y1_pct: number;
    capacity_y2_pct: number;
    capacity_y3_pct: number;
    capacity_y4_pct: number;
    capacity_y5_pct: number;
    // ── Power (manufacturing only) ────────────────────────────────────────
    power_rate_per_unit:        number;
    connected_load_kw:          number;
    load_factor:                number;
    hours_of_load_operation:    number;
    contingency_rate_pct:       number;   // legacy alias for contingency_pct
    salary_increase_rate_pct:   number;   // legacy alias for salary_increase_pct
    machinery_dep_rate_pct:     number;   // legacy alias for depreciation_pct
    // ── Scorecard (optional qualitative scores) ───────────────────────────
    score_market:               number;
    score_competitive:          number;
    score_business_model:       number;
    score_promoter_exp:         number;
    score_fin_contrib:          number;
  };
  revenue: {
    gross_margin_pct: number;
    revenue_growth_pct: number;
    expense_growth_pct: number;
    tax_rate_pct: number;
    depreciation_pct: number;
    projection_years: number;
    product_categories: ProjectReportProductCategory[];
  };
  promoter_assets: {
    residential_property: number;
    fixed_deposits: number;
    mutual_funds: number;
    savings_account: number;
    home_loan_outstanding: number;
    home_loan_emi: number;
  };
  competitors: ProjectReportCompetitor[];
}

export const createInitialProjectReportInputs = (): ProjectReportInputs => ({
  promoter: {
    full_name: "",
    fathers_name: "",
    date_of_birth: "",
    gender: "",
    educational_qual: "",
    social_category: "",
    pan_number: "",
    aadhar_number: "",
    mobile: "",
    email: "",
    address_line1: "",
    city: "",
    state: "",
    pincode: "",
    years_experience: 0,
    previous_employer: "",
    previous_role: "",
    employment_from: "",
    employment_to: "",
  },
  business: {
    business_name: "",
    nature_of_business: "",
    business_type: "",
    industry: "",
    commencement_date: "",
    store_address: "",
    store_city: "",
    store_state: "",
    store_pincode: "",
    gst_number: "",
    msme_number: "",
    target_market: "",
    target_areas: [],
    market_size_crores: 0,
    market_growth_pct: 0,
  },
  loan: {
    loan_scheme: "",
    loan_type: "Term Loan",
    loan_amount: 0,
    interest_rate_pct: 10.5,
    tenure_months: 60,
    moratorium_months: 0,
    processing_fee_pct: 0,
    bank_name: "",
    collateral_details: "",
    guarantor_name: "",
    guarantor_relation: "",
  },
  project_cost: {
    building_renovation: 0,
    plant_machinery_items: [],
    furniture_fixtures: 0,
    computers_peripherals: 0,
    electrification_wiring: 0,
    additional_racks_storage: 0,
    transportation_vehicle: 0,
    preoperative_expenses: 0,
  },
  capex_items: {
    computers: [],
    furniture: [],
    electrification: [],
    racks_storage: [],
    transportation: [],
  },
  promoter_contribution: {
    own_savings: 0,
    family_contribution: 0,
    other_sources: 0,
  },
  working_capital: {
    stock_days: 30,
    debtors_days: 30,
    cash_balance: 0,
    creditors_days: 15,
  },
  dpr: {
    // Production
    working_days_per_year:      300,
    hours_of_operation:         8,
    fresh_leaves_per_day_kg:    0,   // generic input qty/day (0 = not set)
    input_qty_per_day:          0,
    yield_rate_pct:             100,
    selling_price_per_kg:       0,
    selling_price_per_unit:     0,
    cost_fresh_leaves_per_kg:   0,
    raw_material_cost_per_unit: 0,
    cost_consumables_per_kg:    0,
    cost_pet_bottle:            0,
    // Loan & financing
    term_loan_pct:              75,
    promoter_equity_pct:        25,
    // RBI/Nayak Committee turnover method floor for MSE working capital assessment
    wc_loan_pct:                80,
    wc_finance_method:          "simple_margin",
    wc_margin_pct:              25,
    promoter_drawings_pct:      0,
    capital_subsidy_pct:        0,
    contingency_pct:            0,
    contingency_rate_pct:       0,
    loan_tenure_years:          5,
    moratorium_years:           0,
    // Financial assumptions
    building_dep_rate_pct:      5,
    machinery_dep_rate_pct:     10,
    salary_increase_pct:        10,
    salary_increase_rate_pct:   10,
    admin_increase_rate_pct:    5,
    marketing_expense_pct:      2.5,
    // Working capital norms
    wip_days:                   15,
    fg_days:                    30,
    wc_raw_material_days:       30,
    wc_wip_days:                15,
    wc_finished_goods_days:     30,
    wc_working_expenses_days:   30,
    // Capacity utilisation — 0 = use industry default in buildCMAReportInput
    // (Manufacturing: 50/60/70/75/80, Service/Trading: 60/70/80/85/90)
    capacity_y1_pct:            0,
    capacity_y2_pct:            0,
    capacity_y3_pct:            0,
    capacity_y4_pct:            0,
    capacity_y5_pct:            0,
    // Power (manufacturing)
    power_rate_per_unit:        9.65,
    connected_load_kw:          0,
    load_factor:                0.8,
    hours_of_load_operation:    4,
    // Scorecard
    score_market:               8,
    score_competitive:          8,
    score_business_model:       8,
    score_promoter_exp:         8,
    score_fin_contrib:          8,
  },
  revenue: {
    gross_margin_pct: 100,
    revenue_growth_pct: 7,
    expense_growth_pct: 5,
    tax_rate_pct: 25,
    depreciation_pct: 10,
    projection_years: 5,
    product_categories: [],
  },
  promoter_assets: {
    residential_property: 0,
    fixed_deposits: 0,
    mutual_funds: 0,
    savings_account: 0,
    home_loan_outstanding: 0,
    home_loan_emi: 0,
  },
  competitors: [],
});

export const mergeProjectReportInputs = (
  inputs?: Partial<ProjectReportInputs> | null
): ProjectReportInputs => {
  const base = createInitialProjectReportInputs();
  if (!inputs) return base;

  return {
    promoter: { ...base.promoter, ...inputs.promoter },
    business: { ...base.business, ...inputs.business },
    loan: { ...base.loan, ...inputs.loan },
    project_cost: {
      ...base.project_cost,
      ...inputs.project_cost,
      plant_machinery_items: parsePlantMachinery(inputs.project_cost?.plant_machinery_items),
    },
    capex_items: {
      computers: parsePlantMachinery(inputs.capex_items?.computers),
      furniture: parsePlantMachinery(inputs.capex_items?.furniture),
      electrification: parsePlantMachinery(inputs.capex_items?.electrification),
      racks_storage: parsePlantMachinery(inputs.capex_items?.racks_storage),
      transportation: parsePlantMachinery(inputs.capex_items?.transportation),
    },
    promoter_contribution: {
      ...base.promoter_contribution,
      ...inputs.promoter_contribution,
    },
    working_capital: {
      ...base.working_capital,
      ...inputs.working_capital,
    },
    dpr: {
      ...base.dpr,
      ...inputs.dpr,
    },
    revenue: {
      ...base.revenue,
      ...inputs.revenue,
      product_categories: Array.isArray(inputs.revenue?.product_categories)
        ? inputs.revenue!.product_categories.map((item) => ({
          id: item.id || crypto.randomUUID(),
          category: item.category ?? "",
          units_monthly: Number(item.units_monthly) || 0,
          avg_price: Number(item.avg_price) || 0,
          fixed_revenue: Number(item.fixed_revenue) || 0,
          purchase_price: Number(item.purchase_price) || 0,
          selling_price: Number(item.selling_price) || 0,
          quantity_sold: Number(item.quantity_sold) || 0,
          margin_pct: Number(item.margin_pct) || 0,
          service_description: item.service_description ?? "",
          billing_unit: item.billing_unit ?? "Month",
          number_of_months: Number(item.number_of_months) || 1,
          service_mix_pct: Number(item.service_mix_pct) || 0,
        }))
        : base.revenue.product_categories,
    },
    promoter_assets: {
      ...base.promoter_assets,
      ...inputs.promoter_assets,
    },
    competitors: Array.isArray(inputs.competitors)
      ? inputs.competitors.map((item) => ({
        id: item.id || crypto.randomUUID(),
        name: item.name ?? "",
        type: item.type ?? "Organized",
        distance: item.distance ?? "",
        strengths: item.strengths ?? "",
        weaknesses: item.weaknesses ?? "",
      }))
      : base.competitors,
  };
};

export interface GTABFormData {
  district: string;
  // Page 1: Personal Information
  first_name: string;
  middle_name: string;
  last_name: string;
  gender: GTABGender;
  education: GTABEducation;
  social_category: GTABSocialCategory;

  // Page 2: Business Information
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  pincode: string;
  registration_type: GTABRegistrationType;
  contact_mobile: string;
  contact_email: string;

  // Page 3: Business & Loan Details
  business_type: GTABBusinessType;
  business_duration_months: number;
  // Existing-business only — audited current financials (Step 3)
  existing_annual_turnover: number;
  existing_annual_profit: number;
  existing_monthly_emi: number;
  business_entity_name: string;
  type_of_business: string;
  business_activity_other?: string;
  industry_type: GTABIndustryType;
  industry_other: string;
  loan_scheme: GTABLoanScheme;
  loan_scheme_other: string;
  loan_purpose: GTABLoanPurpose;

  // Page 4: Business Description
  business_description: string;
  products_services: string;
  target_market: string;
  expected_monthly_revenue: number;
  expected_employment: number;
  competitive_advantage: string;
  promoter_experience: string;

  // User-authored report narratives (AI-assisted writing support)
  introduction_text?: string;
  market_aspects_text?: string;
  management_aspects_text?: string;
  technical_aspects_text?: string;
  financial_aspects_text?: string;

  // Page 5: Project Requirements
  land_cost: number;
  shed_building_cost: number;
  plant_machinery: MachineryItem[];
  computers_cost: number;
  furniture_cost: number;
  electrification_cost: number;
  racks_storage_cost: number;
  transportation_cost: number;
  machinery_installation_cost: number;
  other_initial_expenditure: number;

  // Page 6: Calculated (auto)
  total_project_cost: number;
  margin_money: number;
  eligible_loan_amount: number;

  // Page 7: Monthly Expenses
  monthly_rent: number;
  skilled_workers_count: number;
  skilled_workers_salary: number;
  semi_skilled_workers_count: number;
  semi_skilled_workers_salary: number;
  wages_count: number;
  wages_salary: number;
  employee_count: number;
  salary_per_employee: number;
  total_monthly_salary: number;
  raw_material_cost: number;
  stationery_cost: number;
  electricity_water_cost: number;
  repair_maintenance_cost: number;
  transport_cost: number;
  telephone_internet_cost: number;
  marketing_cost: number;
  miscellaneous_cost: number;
  total_monthly_expenses: number;

  // Page 8: Working Capital
  working_capital_required: number;
  working_capital_period: GTABWorkingCapitalPeriod;

  // Scheme-specific fields (CA PDF §6)
  area_type: 'urban' | 'rural';                  // PMEGP: determines subsidy % (Urban 15/25%, Rural 25/35%)
  implementing_agency?: 'kvic' | 'kvib' | 'dic'; // PMEGP only
  is_second_loan?: boolean;                       // PMEGP 2nd loan: higher project cost cap (Rs.1Cr Mfg)
  negative_list_check?: boolean;                  // PMEGP: auto-validate vs negative list
  preferred_bank?: string;                        // All schemes: SBI / BOB / PNB / Canara / Other

  // New project report design payload
  project_report_inputs: ProjectReportInputs;

  // Industry-specific dynamic fields
  // Manufacturing
  production_capacity_units?: number;
  production_cost_per_unit?: number;
  selling_price_per_unit?: number;
  production_utilization_pct?: number;
  machinery_total_cost?: number;
  machinery_type?: string;
  machinery_supplier_name?: string;
  raw_material_pct?: number;
  primary_raw_material?: string;
  raw_material_supplier?: string;
  // Service
  service_rate_unit?: string;
  monthly_clients_count?: number;
  service_utilization_pct?: number;
  // Trading
  average_inventory_value?: number;
  inventory_pct?: number;
  monthly_purchase_value?: number;
  gross_margin?: number;
  stock_turnover_ratio?: number;
  supplier_credit_days?: number;
  primary_supplier_name?: string;
  customer_credit_days?: number;
  // Agriculture
  main_crop?: string;
  farming_type?: string;
  land_utilization_pct?: number;
  land_area_acres?: number;
  expected_annual_yield?: number;
  agricultural_selling_price?: number;
  yield_variability_pct?: number;
  seeds_inputs_cost?: number;
  fertilizer_pesticide_cost?: number;
  labour_cost_seasonal?: number;
  irrigation_cost?: number;
}

export const INITIAL_FORM_DATA: GTABFormData = {
  // ── Step 1: Personal Information ─────────────────────────────────────────
  // NOTE: starts blank — every application must be filled with the applicant's
  // real data. (Previously pre-seeded with a "Rajesh Food Products" demo, which
  // made unmodified applications all produce the same CMA report.)
  first_name: '',
  middle_name: '',
  last_name: '',
  gender: 'male',
  education: 'graduate',
  social_category: 'general',

  // ── Step 2: Business Address & Contact ───────────────────────────────────
  address_line_1: '',
  address_line_2: '',
  city: '',
  district: '',
  state: '',
  pincode: '',
  registration_type: 'proprietorship',
  contact_mobile: '',
  contact_email: '',

  // ── Step 3: Business & Loan Details ──────────────────────────────────────
  business_type: 'new_business',
  business_duration_months: 0,
  existing_annual_turnover: 0,
  existing_annual_profit: 0,
  existing_monthly_emi: 0,
  business_entity_name: '',
  type_of_business: 'food_processing',
  business_activity_other: '',
  industry_type: 'manufacturing',
  industry_other: '',
  loan_scheme: 'mudra_kishor',
  loan_scheme_other: '',
  loan_purpose: 'term_and_working_capital',

  // ── Step 4: Business Description ─────────────────────────────────────────
  business_description: '',
  products_services: '',
  target_market: '',
  expected_monthly_revenue: 0,
  expected_employment: 0,
  competitive_advantage: '',
  promoter_experience: '',
  introduction_text: '',
  market_aspects_text: '',
  management_aspects_text: '',
  technical_aspects_text: '',
  financial_aspects_text: '',

  // ── Step 5: Project Requirements ─────────────────────────────────────────
  land_cost: 0,
  shed_building_cost: 0,
  plant_machinery: [],
  computers_cost: 0,
  furniture_cost: 0,
  electrification_cost: 0,
  racks_storage_cost: 0,
  transportation_cost: 0,
  machinery_installation_cost: 0,
  other_initial_expenditure: 0,

  // ── Step 6: Calculated totals (auto-computed) ────────────────────────────
  total_project_cost: 0,
  margin_money: 0,
  eligible_loan_amount: 0,

  // ── Step 7: Monthly Expenses ─────────────────────────────────────────────
  monthly_rent: 0,
  skilled_workers_count: 0,
  skilled_workers_salary: 0,
  semi_skilled_workers_count: 0,
  semi_skilled_workers_salary: 0,
  wages_count: 0,
  wages_salary: 0,
  employee_count: 0,
  salary_per_employee: 0,
  total_monthly_salary: 0,
  raw_material_cost: 0,
  stationery_cost: 0,
  electricity_water_cost: 0,
  repair_maintenance_cost: 0,
  transport_cost: 0,
  telephone_internet_cost: 0,
  marketing_cost: 0,
  miscellaneous_cost: 0,
  total_monthly_expenses: 0,

  // ── Step 8: Working Capital ───────────────────────────────────────────────
  working_capital_required: 0,
  working_capital_period: 'monthly',

  // ── Scheme-specific ──────────────────────────────────────────────────────
  area_type: 'urban',
  implementing_agency: undefined,
  is_second_loan: false,
  negative_list_check: false,
  preferred_bank: '',

  // ── Step 9: Project Report Inputs (blank — real planning defaults only) ───
  project_report_inputs: createInitialProjectReportInputs(),
};

export const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'undisclosed', label: "Can't disclose" },
];

export const EDUCATION_OPTIONS = [
  { value: 'post_graduate', label: 'Post Graduate' },
  { value: 'graduate', label: 'Graduate' },
  { value: 'plus_two', label: '+2' },
  { value: 'tenth', label: '10th' },
];

export const SOCIAL_CATEGORY_OPTIONS = [
  { value: 'general',      label: 'General' },
  { value: 'obc',          label: 'OBC (Other Backward Class)' },
  { value: 'sc',           label: 'SC (Scheduled Caste)' },
  { value: 'st',           label: 'ST (Scheduled Tribe)' },
  { value: 'minority',     label: 'Minority' },
  { value: 'women',        label: 'Women' },
  { value: 'ex_serviceman',label: 'Ex-Serviceman' },
  { value: 'pwd',          label: 'PwD (Person with Disability)' },
  { value: 'undisclosed',  label: 'Not interested to disclose' },
];

export const REGISTRATION_OPTIONS = [
  { value: 'proprietorship',   label: 'Proprietorship' },
  { value: 'partnership',      label: 'Partnership Firm' },
  { value: 'llp',              label: 'LLP (Limited Liability Partnership)' },
  { value: 'private_limited',  label: 'Private Limited Company' },
  { value: 'opc',              label: 'OPC (One Person Company)' },
  { value: 'huf',              label: 'HUF (Hindu Undivided Family)' },
  { value: 'cooperative',      label: 'Cooperative Society' },
  { value: 'trust',            label: 'Trust / Society' },
];

export const BUSINESS_TYPE_OPTIONS = [
  { value: 'new_business',      label: 'New Business (Setting up for the first time)' },
  { value: 'existing_business', label: 'Existing Business (Already operational)' },
];

export const INDUSTRY_OPTIONS = [
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'service',       label: 'Service' },
  { value: 'trading',       label: 'Trading' },
  { value: 'agriculture',   label: 'Agriculture' },
  { value: 'others',        label: 'Others' },
];

// Nature of business activity — dropdown options per industry type
export const NATURE_OF_BUSINESS_OPTIONS: Record<string, { value: string; label: string }[]> = {
  manufacturing: [
    { value: 'food_processing',     label: 'Food Processing & Beverages' },
    { value: 'garment_textile',     label: 'Garment / Textile / Apparel' },
    { value: 'soap_cosmetics',      label: 'Soap / Detergent / Cosmetics' },
    { value: 'furniture_wood',      label: 'Furniture / Wood Products' },
    { value: 'metal_fabrication',   label: 'Metal Fabrication / Engineering' },
    { value: 'plastic_rubber',      label: 'Plastic / Rubber Products' },
    { value: 'paper_packaging',     label: 'Paper / Packaging / Printing' },
    { value: 'electrical_items',    label: 'Electrical / Electronic Items' },
    { value: 'chemical_pharma',     label: 'Chemical / Pharmaceutical' },
    { value: 'agro_processing',     label: 'Agro Processing / Milling' },
    { value: 'handicraft_art',      label: 'Handicraft / Artisan Products' },
    { value: 'other_manufacturing', label: 'Other Manufacturing Activity' },
  ],
  service: [
    { value: 'beauty_salon',        label: 'Beauty Salon / Parlour / Spa' },
    { value: 'repair_service',      label: 'Repair & Maintenance Service' },
    { value: 'it_software',         label: 'IT / Software / Digital Service' },
    { value: 'education_coaching',  label: 'Education / Coaching Centre' },
    { value: 'healthcare',          label: 'Healthcare / Clinic / Pharmacy' },
    { value: 'transport_logistics', label: 'Transport / Logistics' },
    { value: 'catering_tiffin',     label: 'Catering / Tiffin / Bakery' },
    { value: 'photography_media',   label: 'Photography / Media / Events' },
    { value: 'consultancy',         label: 'Consultancy / Advisory' },
    { value: 'laundry_cleaning',    label: 'Laundry / Dry Cleaning' },
    { value: 'tailoring_boutique',  label: 'Tailoring / Boutique / Designing' },
    { value: 'other_service',       label: 'Other Service Activity' },
  ],
  trading: [
    { value: 'grocery_retail',      label: 'Grocery / General Retail Store' },
    { value: 'electronics_retail',  label: 'Electronics / Mobile / Appliances' },
    { value: 'textiles_retail',     label: 'Textiles / Garment Retail' },
    { value: 'hardware_building',   label: 'Hardware / Building Materials' },
    { value: 'medicines_medical',   label: 'Medicines / Medical Supplies' },
    { value: 'auto_parts',          label: 'Auto Parts / Vehicle Accessories' },
    { value: 'agri_inputs',         label: 'Agricultural Inputs / Seeds / Fertilizers' },
    { value: 'stationery_books',    label: 'Stationery / Books / Gifts' },
    { value: 'wholesale_trade',     label: 'Wholesale / Distribution' },
    { value: 'other_trading',       label: 'Other Trading Activity' },
  ],
  agriculture: [
    { value: 'crop_farming',        label: 'Crop Farming / Horticulture' },
    { value: 'animal_husbandry',    label: 'Animal Husbandry / Dairy' },
    { value: 'poultry_farming',     label: 'Poultry Farming' },
    { value: 'fisheries',           label: 'Fisheries / Aquaculture' },
    { value: 'floriculture',        label: 'Floriculture / Nursery' },
    { value: 'sericulture',         label: 'Sericulture / Silk Farming' },
    { value: 'mushroom_farming',    label: 'Mushroom / Organic Farming' },
    { value: 'other_agriculture',   label: 'Other Agriculture Activity' },
  ],
};

// ── AI Product Suggestions — keyed by type_of_business (nature_of_business value) ──
// Each entry has pre-filled purchase_price, selling_price, quantity_sold for trading
// and avg_price + units_monthly for service/agriculture
export type ProductSuggestion = {
  category: string;
  purchase_price?: number;
  selling_price?: number;
  quantity_sold?: number;
  avg_price?: number;
  units_monthly?: number;
};

export const PRODUCT_SUGGESTIONS: Record<string, ProductSuggestion[]> = {
  // ── TRADING ──────────────────────────────────────────────────────────────────
  grocery_retail: [
    { category: 'Rice / Atta (Staples)',        purchase_price: 42,   selling_price: 52,    quantity_sold: 500  },
    { category: 'Edible Oil (Litre)',            purchase_price: 130,  selling_price: 155,   quantity_sold: 200  },
    { category: 'Biscuits / Snacks (Pkt)',       purchase_price: 18,   selling_price: 25,    quantity_sold: 1000 },
    { category: 'Dairy Products (Milk/Curd)',    purchase_price: 48,   selling_price: 58,    quantity_sold: 400  },
    { category: 'Masala / Spices',               purchase_price: 80,   selling_price: 110,   quantity_sold: 300  },
  ],
  textiles_retail: [
    { category: "Men's Shirts",                  purchase_price: 280,  selling_price: 450,   quantity_sold: 200  },
    { category: "Women's Sarees",                purchase_price: 650,  selling_price: 1050,  quantity_sold: 120  },
    { category: "Kids Wear",                     purchase_price: 180,  selling_price: 320,   quantity_sold: 300  },
    { category: "Jeans / Trousers",              purchase_price: 350,  selling_price: 600,   quantity_sold: 150  },
    { category: "Dress Material / Fabric (mtr)", purchase_price: 120,  selling_price: 200,   quantity_sold: 250  },
  ],
  electronics_retail: [
    { category: 'Mobile Phones',                 purchase_price: 8000, selling_price: 10500, quantity_sold: 30   },
    { category: 'Earphones / Headsets',          purchase_price: 200,  selling_price: 380,   quantity_sold: 100  },
    { category: 'Chargers / Cables',             purchase_price: 80,   selling_price: 160,   quantity_sold: 200  },
    { category: 'Mobile Cases & Covers',         purchase_price: 50,   selling_price: 120,   quantity_sold: 300  },
    { category: 'Tablets / Smart Devices',       purchase_price: 12000,selling_price: 16000, quantity_sold: 10   },
  ],
  hardware_building: [
    { category: 'Cement (Bags)',                 purchase_price: 370,  selling_price: 420,   quantity_sold: 500  },
    { category: 'Steel / TMT Bars (kg)',         purchase_price: 58,   selling_price: 68,    quantity_sold: 1000 },
    { category: 'Tiles (Box)',                   purchase_price: 300,  selling_price: 420,   quantity_sold: 200  },
    { category: 'Plumbing Fittings',             purchase_price: 150,  selling_price: 250,   quantity_sold: 300  },
    { category: 'Paints (Litre)',                purchase_price: 160,  selling_price: 220,   quantity_sold: 200  },
  ],
  medicines_medical: [
    { category: 'Prescription Medicines (Avg)',  purchase_price: 60,   selling_price: 80,    quantity_sold: 1000 },
    { category: 'OTC / General Medicines',       purchase_price: 30,   selling_price: 42,    quantity_sold: 800  },
    { category: 'Surgical / Disposables',        purchase_price: 45,   selling_price: 70,    quantity_sold: 500  },
    { category: 'Health Supplements',            purchase_price: 250,  selling_price: 380,   quantity_sold: 150  },
    { category: 'Baby Care Products',            purchase_price: 80,   selling_price: 120,   quantity_sold: 200  },
  ],
  auto_parts: [
    { category: 'Engine Oil / Lubricants',       purchase_price: 280,  selling_price: 380,   quantity_sold: 200  },
    { category: 'Brake Parts (Set)',             purchase_price: 350,  selling_price: 550,   quantity_sold: 80   },
    { category: 'Filters (Air/Oil/Fuel)',        purchase_price: 120,  selling_price: 200,   quantity_sold: 150  },
    { category: 'Tyres (2-Wheeler)',             purchase_price: 700,  selling_price: 950,   quantity_sold: 60   },
    { category: 'Battery (2W/4W)',               purchase_price: 1500, selling_price: 2200,  quantity_sold: 30   },
  ],
  agri_inputs: [
    { category: 'Fertilizers (Urea/DAP) / Bag', purchase_price: 280,  selling_price: 330,   quantity_sold: 300  },
    { category: 'Pesticides / Insecticides',     purchase_price: 180,  selling_price: 260,   quantity_sold: 200  },
    { category: 'Seeds (Hybrid)',                purchase_price: 120,  selling_price: 180,   quantity_sold: 400  },
    { category: 'Irrigation Equipment',          purchase_price: 500,  selling_price: 750,   quantity_sold: 50   },
  ],
  stationery_books: [
    { category: 'School Notebooks & Books',      purchase_price: 40,   selling_price: 60,    quantity_sold: 800  },
    { category: 'Pens / Pencils / Stationery',   purchase_price: 15,   selling_price: 25,    quantity_sold: 1500 },
    { category: 'Gift Items / Greeting Cards',   purchase_price: 60,   selling_price: 100,   quantity_sold: 300  },
    { category: 'Art & Craft Supplies',          purchase_price: 80,   selling_price: 130,   quantity_sold: 200  },
  ],
  wholesale_trade: [
    { category: 'FMCG Goods (Bulk)',             purchase_price: 700,  selling_price: 820,   quantity_sold: 500  },
    { category: 'Industrial Goods (Bulk)',        purchase_price: 2000, selling_price: 2400,  quantity_sold: 100  },
    { category: 'Packaged Consumer Goods',       purchase_price: 150,  selling_price: 185,   quantity_sold: 800  },
  ],
  other_trading: [
    { category: 'Primary Product',               purchase_price: 100,  selling_price: 140,   quantity_sold: 500  },
    { category: 'Secondary Product',             purchase_price: 200,  selling_price: 280,   quantity_sold: 200  },
  ],
  // ── SERVICE ──────────────────────────────────────────────────────────────────
  beauty_salon: [
    { category: 'Haircut / Styling (per visit)',  avg_price: 150,  units_monthly: 200 },
    { category: 'Facial / Skin Treatment',        avg_price: 500,  units_monthly: 80  },
    { category: 'Hair Colour / Treatment',        avg_price: 1200, units_monthly: 40  },
    { category: 'Waxing / Threading',             avg_price: 100,  units_monthly: 300 },
    { category: 'Bridal / Party Makeup',          avg_price: 3000, units_monthly: 10  },
  ],
  repair_service: [
    { category: 'Mobile / Electronics Repair',   avg_price: 400,  units_monthly: 150 },
    { category: 'Appliance Servicing',            avg_price: 600,  units_monthly: 60  },
    { category: 'Two-Wheeler Repair',             avg_price: 500,  units_monthly: 80  },
    { category: 'Computer / Laptop Repair',       avg_price: 700,  units_monthly: 50  },
  ],
  it_software: [
    { category: 'Website Development',            avg_price: 15000, units_monthly: 5  },
    { category: 'Software Maintenance (Monthly)', avg_price: 5000,  units_monthly: 10 },
    { category: 'Digital Marketing Services',     avg_price: 8000,  units_monthly: 8  },
    { category: 'Mobile App Development',         avg_price: 25000, units_monthly: 2  },
  ],
  education_coaching: [
    { category: 'Monthly Tuition Fees',           avg_price: 1500, units_monthly: 50  },
    { category: 'Weekend Workshop / Batch',        avg_price: 3000, units_monthly: 20  },
    { category: 'Online Course / Classes',         avg_price: 2000, units_monthly: 30  },
    { category: 'Competitive Exam Coaching',       avg_price: 2500, units_monthly: 25  },
  ],
  healthcare: [
    { category: 'Consultation (OPD)',             avg_price: 300,  units_monthly: 300 },
    { category: 'Diagnostics / Lab Tests',        avg_price: 500,  units_monthly: 100 },
    { category: 'Pharmacy / Medicines',           avg_price: 200,  units_monthly: 400 },
    { category: 'Physiotherapy / Procedures',     avg_price: 800,  units_monthly: 50  },
  ],
  transport_logistics: [
    { category: 'Local Goods Transport (Trip)',   avg_price: 2500, units_monthly: 60  },
    { category: 'Passenger Vehicle (Per Trip)',   avg_price: 500,  units_monthly: 200 },
    { category: 'Contract / Monthly Hire',        avg_price: 25000,units_monthly: 3   },
  ],
  catering_tiffin: [
    { category: 'Tiffin / Meal Box (Daily)',      avg_price: 100,  units_monthly: 600 },
    { category: 'Bulk Catering (Order)',          avg_price: 5000, units_monthly: 15  },
    { category: 'Bakery / Sweets (Order)',        avg_price: 800,  units_monthly: 80  },
  ],
  tailoring_boutique: [
    { category: 'Stitching (Suit / Salwar)',      avg_price: 400,  units_monthly: 150 },
    { category: 'Saree Blouse Stitching',         avg_price: 250,  units_monthly: 200 },
    { category: 'Alterations / Repairs',          avg_price: 100,  units_monthly: 300 },
    { category: 'Designer / Bridal Outfit',       avg_price: 5000, units_monthly: 10  },
  ],
  laundry_cleaning: [
    { category: 'Laundry (Per Kg)',               avg_price: 60,   units_monthly: 1000},
    { category: 'Dry Cleaning (Per Piece)',        avg_price: 200,  units_monthly: 200 },
    { category: 'Ironing (Per Piece)',             avg_price: 15,   units_monthly: 2000},
  ],
  photography_media: [
    { category: 'Wedding Photography (Event)',    avg_price: 15000, units_monthly: 6  },
    { category: 'Product / Commercial Shoot',     avg_price: 5000,  units_monthly: 10 },
    { category: 'Videography / Reels',            avg_price: 3000,  units_monthly: 15 },
  ],
  consultancy: [
    { category: 'Consulting Session (Hour)',       avg_price: 1500, units_monthly: 80  },
    { category: 'Project / Report (Fixed Fee)',   avg_price: 10000, units_monthly: 5  },
    { category: 'Retainer (Monthly)',              avg_price: 15000, units_monthly: 3  },
  ],
  other_service: [
    { category: 'Primary Service',               avg_price: 500,  units_monthly: 200 },
    { category: 'Secondary Service',             avg_price: 1000, units_monthly: 80  },
  ],
  // ── MANUFACTURING ────────────────────────────────────────────────────────────
  food_processing: [
    { category: 'Processed Food Product (kg)',   avg_price: 80,   units_monthly: 3000 },
    { category: 'Packaged Ready-to-Eat (pkt)',   avg_price: 50,   units_monthly: 5000 },
    { category: 'Beverages / Juices (Ltr)',      avg_price: 60,   units_monthly: 2000 },
  ],
  garment_textile: [
    { category: 'Finished Garments (pcs)',        avg_price: 350, units_monthly: 1000 },
    { category: 'Fabric / Cloth (mtr)',           avg_price: 150, units_monthly: 2000 },
    { category: 'Embroidered / Designer (pcs)',   avg_price: 800, units_monthly: 300  },
  ],
  soap_cosmetics: [
    { category: 'Soap Bars (pcs)',               avg_price: 40,  units_monthly: 5000 },
    { category: 'Liquid Soap / Detergent (Ltr)', avg_price: 80,  units_monthly: 2000 },
    { category: 'Cosmetic Cream / Lotion (pcs)', avg_price: 150, units_monthly: 1000 },
  ],
  furniture_wood: [
    { category: 'Wooden Furniture (piece)',       avg_price: 4000,units_monthly: 50   },
    { category: 'Doors / Windows (pcs)',          avg_price: 3500,units_monthly: 30   },
    { category: 'Plywood / Board (sheet)',        avg_price: 900, units_monthly: 200  },
  ],
  agro_processing: [
    { category: 'Milled / Processed Output (kg)',avg_price: 55,  units_monthly: 10000},
    { category: 'By-products (kg)',               avg_price: 20,  units_monthly: 3000 },
  ],
  // ── AGRICULTURE ──────────────────────────────────────────────────────────────
  crop_farming: [
    { category: 'Primary Crop (kg)',              avg_price: 25,  units_monthly: 5000 },
    { category: 'Secondary Crop (kg)',            avg_price: 35,  units_monthly: 2000 },
    { category: 'Vegetables (kg)',                avg_price: 30,  units_monthly: 3000 },
  ],
  animal_husbandry: [
    { category: 'Milk (Litre / Day)',             avg_price: 45,  units_monthly: 1500 },
    { category: 'Ghee / Butter (kg)',             avg_price: 500, units_monthly: 50   },
    { category: 'Meat / Livestock (kg)',           avg_price: 350, units_monthly: 200  },
  ],
  poultry_farming: [
    { category: 'Eggs (per piece)',               avg_price: 7,   units_monthly: 15000},
    { category: 'Broiler Chicken (kg)',           avg_price: 130, units_monthly: 500  },
  ],
  fisheries: [
    { category: 'Fish (kg)',                      avg_price: 180, units_monthly: 1000 },
    { category: 'Prawns / Shrimp (kg)',           avg_price: 400, units_monthly: 300  },
  ],
  mushroom_farming: [
    { category: 'Mushrooms (kg)',                 avg_price: 200, units_monthly: 500  },
    { category: 'Dried / Processed (kg)',         avg_price: 600, units_monthly: 100  },
  ],
};

// ── AI Equipment / Machinery Suggestions — keyed by type_of_business ───────────
// CA norms: all prices are typical Indian market rates (2024-25).
// Each item: machine_name, unit_cost (Rs.), quantity (default 1)
export type EquipmentSuggestion = {
  machine_name: string;
  unit_cost: number;
  quantity: number;
};

export const EQUIPMENT_SUGGESTIONS: Record<string, EquipmentSuggestion[]> = {
  // ── TRADING ──────────────────────────────────────────────────────────────────
  grocery_retail: [
    { machine_name: 'Electronic Weighing Scale (30kg)',   unit_cost: 5000,  quantity: 2 },
    { machine_name: 'Billing Machine / POS System',       unit_cost: 22000, quantity: 1 },
    { machine_name: 'Commercial Refrigerator (300L)',      unit_cost: 35000, quantity: 1 },
    { machine_name: 'Steel Storage Racks',                unit_cost: 8000,  quantity: 6 },
    { machine_name: 'CCTV Security System (4-camera)',    unit_cost: 15000, quantity: 1 },
    { machine_name: 'Generator / Inverter Power Backup',  unit_cost: 18000, quantity: 1 },
  ],
  textiles_retail: [
    { machine_name: 'Billing Machine / POS System',       unit_cost: 25000, quantity: 1 },
    { machine_name: 'Display Racks / Shelving Unit',      unit_cost: 12000, quantity: 5 },
    { machine_name: 'Glass Showcase / Display Counter',   unit_cost: 18000, quantity: 2 },
    { machine_name: 'Mannequins / Display Stands',        unit_cost: 4000,  quantity: 6 },
    { machine_name: 'CCTV Security System (4-camera)',    unit_cost: 15000, quantity: 1 },
    { machine_name: 'Air Conditioner (1.5 Ton)',          unit_cost: 38000, quantity: 1 },
  ],
  electronics_retail: [
    { machine_name: 'Glass Display Counter',              unit_cost: 22000, quantity: 3 },
    { machine_name: 'Wall-mounted Display Racks',         unit_cost: 8000,  quantity: 4 },
    { machine_name: 'POS / Billing System',               unit_cost: 35000, quantity: 1 },
    { machine_name: 'CCTV System (8-camera)',             unit_cost: 25000, quantity: 1 },
    { machine_name: 'Air Conditioner (1.5 Ton)',          unit_cost: 38000, quantity: 2 },
    { machine_name: 'UPS / Power Backup',                 unit_cost: 12000, quantity: 1 },
  ],
  hardware_building: [
    { machine_name: 'Weighing Scale (Platform)',          unit_cost: 18000, quantity: 1 },
    { machine_name: 'Steel Shelving Racks (Heavy Duty)',  unit_cost: 15000, quantity: 8 },
    { machine_name: 'Billing System / Computer',          unit_cost: 30000, quantity: 1 },
    { machine_name: 'Forklift / Material Handling',       unit_cost: 80000, quantity: 1 },
    { machine_name: 'CCTV System',                       unit_cost: 18000, quantity: 1 },
  ],
  medicines_medical: [
    { machine_name: 'Refrigerated Medicine Cabinet',      unit_cost: 28000, quantity: 1 },
    { machine_name: 'POS / Billing System',               unit_cost: 30000, quantity: 1 },
    { machine_name: 'Display Racks / Shelving',           unit_cost: 10000, quantity: 6 },
    { machine_name: 'Air Conditioner (1.5 Ton)',          unit_cost: 38000, quantity: 1 },
    { machine_name: 'CCTV System',                       unit_cost: 15000, quantity: 1 },
  ],
  auto_parts: [
    { machine_name: 'Steel Storage Racks (Heavy Duty)',   unit_cost: 15000, quantity: 8 },
    { machine_name: 'Computerised Billing System',        unit_cost: 30000, quantity: 1 },
    { machine_name: 'Hydraulic Jack / Workshop Tools',    unit_cost: 12000, quantity: 1 },
    { machine_name: 'CCTV System',                       unit_cost: 18000, quantity: 1 },
    { machine_name: 'Weighing Scale',                    unit_cost: 5000,  quantity: 1 },
  ],
  agri_inputs: [
    { machine_name: 'Weighing Scale (Platform)',          unit_cost: 18000, quantity: 1 },
    { machine_name: 'Storage Racks (Steel)',              unit_cost: 8000,  quantity: 6 },
    { machine_name: 'Billing / Computer System',          unit_cost: 25000, quantity: 1 },
    { machine_name: 'Sprayer (Power)',                   unit_cost: 8000,  quantity: 2 },
    { machine_name: 'Generator / Power Backup',           unit_cost: 20000, quantity: 1 },
  ],
  stationery_books: [
    { machine_name: 'Photocopier / Printer Machine',      unit_cost: 22000, quantity: 1 },
    { machine_name: 'Display Racks / Book Shelves',       unit_cost: 8000,  quantity: 6 },
    { machine_name: 'Billing Machine / POS',              unit_cost: 18000, quantity: 1 },
    { machine_name: 'CCTV System',                       unit_cost: 12000, quantity: 1 },
  ],
  wholesale_trade: [
    { machine_name: 'Platform Weighing Scale (500kg)',    unit_cost: 35000, quantity: 2 },
    { machine_name: 'Storage Racks / Pallets',           unit_cost: 20000, quantity: 10 },
    { machine_name: 'Computer / ERP Billing System',     unit_cost: 45000, quantity: 1 },
    { machine_name: 'Forklift / Pallet Jack',            unit_cost: 90000, quantity: 1 },
    { machine_name: 'CCTV System (8-camera)',            unit_cost: 25000, quantity: 1 },
  ],
  other_trading: [
    { machine_name: 'Billing Machine / POS System',      unit_cost: 20000, quantity: 1 },
    { machine_name: 'Storage Racks',                     unit_cost: 8000,  quantity: 4 },
    { machine_name: 'CCTV System',                       unit_cost: 12000, quantity: 1 },
  ],
  // ── SERVICE ──────────────────────────────────────────────────────────────────
  beauty_salon: [
    { machine_name: 'Salon / Barber Chair (Hydraulic)',   unit_cost: 9000,  quantity: 3 },
    { machine_name: 'Professional Hair Dryer',            unit_cost: 8000,  quantity: 2 },
    { machine_name: 'Facial / Beauty Machine',            unit_cost: 28000, quantity: 1 },
    { machine_name: 'Back-wash / Shampoo Basin',         unit_cost: 12000, quantity: 2 },
    { machine_name: 'Mirror & Vanity Lighting Setup',    unit_cost: 15000, quantity: 3 },
    { machine_name: 'Air Conditioner (1.5 Ton)',         unit_cost: 38000, quantity: 1 },
    { machine_name: 'CCTV System',                      unit_cost: 12000, quantity: 1 },
  ],
  repair_service: [
    { machine_name: 'Soldering Station / PCB Tools',     unit_cost: 12000, quantity: 1 },
    { machine_name: 'Oscilloscope / Multimeter Set',     unit_cost: 18000, quantity: 1 },
    { machine_name: 'Laptop / Computer (Diagnostics)',   unit_cost: 35000, quantity: 1 },
    { machine_name: 'Work Bench & Tool Cabinet',         unit_cost: 15000, quantity: 2 },
    { machine_name: 'CCTV System',                      unit_cost: 12000, quantity: 1 },
  ],
  it_software: [
    { machine_name: 'High-Performance Desktop / Laptop', unit_cost: 55000, quantity: 3 },
    { machine_name: 'Server / NAS Storage',              unit_cost: 80000, quantity: 1 },
    { machine_name: 'Networking Equipment (Router/Switch)',unit_cost: 15000,quantity: 1 },
    { machine_name: 'UPS / Power Backup',                unit_cost: 12000, quantity: 2 },
    { machine_name: 'Air Conditioner (1.5 Ton)',         unit_cost: 38000, quantity: 1 },
  ],
  education_coaching: [
    { machine_name: 'Projector / Smart Board',           unit_cost: 45000, quantity: 1 },
    { machine_name: 'Student Desks & Chairs (Set of 20)',unit_cost: 2500,  quantity: 20},
    { machine_name: 'Computer / Laptop (Teacher)',       unit_cost: 40000, quantity: 1 },
    { machine_name: 'Audio System / PA System',          unit_cost: 15000, quantity: 1 },
    { machine_name: 'Air Conditioner (1.5 Ton)',         unit_cost: 38000, quantity: 1 },
    { machine_name: 'CCTV System',                      unit_cost: 12000, quantity: 1 },
  ],
  healthcare: [
    { machine_name: 'Examination Table / Couch',         unit_cost: 18000, quantity: 2 },
    { machine_name: 'BP Monitor / Stethoscope / OT Set', unit_cost: 15000, quantity: 1 },
    { machine_name: 'ECG Machine',                       unit_cost: 45000, quantity: 1 },
    { machine_name: 'Pulse Oximeter / Thermometer Set',  unit_cost: 5000,  quantity: 2 },
    { machine_name: 'Air Conditioner (1.5 Ton)',         unit_cost: 38000, quantity: 1 },
    { machine_name: 'Pharmacy Counter & Racks',          unit_cost: 25000, quantity: 1 },
  ],
  transport_logistics: [
    { machine_name: 'Mini Truck / Loading Vehicle',      unit_cost: 550000,quantity: 1 },
    { machine_name: 'GPS Tracking System',               unit_cost: 8000,  quantity: 1 },
    { machine_name: 'Computer / Billing System',         unit_cost: 30000, quantity: 1 },
    { machine_name: 'Weighing Scale (Platform)',         unit_cost: 18000, quantity: 1 },
  ],
  catering_tiffin: [
    { machine_name: 'Commercial LPG Burner / Stove',     unit_cost: 15000, quantity: 2 },
    { machine_name: 'Cooking Vessel Set (Large)',        unit_cost: 20000, quantity: 1 },
    { machine_name: 'Food Warmer / Hot Box',             unit_cost: 8000,  quantity: 3 },
    { machine_name: 'Tiffin / Food Container Set',       unit_cost: 500,   quantity: 200},
    { machine_name: 'Delivery Bicycle / E-bike',         unit_cost: 50000, quantity: 1 },
    { machine_name: 'Refrigerator (Commercial)',         unit_cost: 30000, quantity: 1 },
  ],
  tailoring_boutique: [
    { machine_name: 'Industrial Sewing Machine',         unit_cost: 22000, quantity: 3 },
    { machine_name: 'Overlock / Serger Machine',         unit_cost: 18000, quantity: 1 },
    { machine_name: 'Cutting Table (Large)',             unit_cost: 8000,  quantity: 1 },
    { machine_name: 'Pressing Iron / Steam Press',       unit_cost: 5000,  quantity: 2 },
    { machine_name: 'Display Mannequins',                unit_cost: 3000,  quantity: 4 },
    { machine_name: 'Air Conditioner (1.5 Ton)',         unit_cost: 38000, quantity: 1 },
  ],
  laundry_cleaning: [
    { machine_name: 'Commercial Washing Machine (15kg)', unit_cost: 85000, quantity: 1 },
    { machine_name: 'Dryer Machine (Commercial)',        unit_cost: 55000, quantity: 1 },
    { machine_name: 'Steam Iron Press',                  unit_cost: 18000, quantity: 2 },
    { machine_name: 'Dry Cleaning Machine',              unit_cost: 150000,quantity: 1 },
    { machine_name: 'Water Purification Unit',           unit_cost: 20000, quantity: 1 },
  ],
  photography_media: [
    { machine_name: 'DSLR / Mirrorless Camera (Pro)',    unit_cost: 80000, quantity: 1 },
    { machine_name: 'Camera Lens Set',                   unit_cost: 45000, quantity: 1 },
    { machine_name: 'Studio Lighting Kit',               unit_cost: 25000, quantity: 1 },
    { machine_name: 'Drone (DJI / similar)',             unit_cost: 55000, quantity: 1 },
    { machine_name: 'Video Editing Computer / Workstation',unit_cost: 75000,quantity: 1},
    { machine_name: 'Gimbal / Stabiliser',               unit_cost: 15000, quantity: 1 },
  ],
  consultancy: [
    { machine_name: 'Laptop / Computer',                 unit_cost: 55000, quantity: 2 },
    { machine_name: 'Printer / Scanner / Copier',        unit_cost: 20000, quantity: 1 },
    { machine_name: 'Conference Table & Chairs',         unit_cost: 25000, quantity: 1 },
    { machine_name: 'Projector / Display Screen',        unit_cost: 35000, quantity: 1 },
    { machine_name: 'Air Conditioner (1.5 Ton)',         unit_cost: 38000, quantity: 1 },
  ],
  // ── MANUFACTURING ────────────────────────────────────────────────────────────
  food_processing: [
    { machine_name: 'Food Processing Machine (Main)',     unit_cost: 150000,quantity: 1 },
    { machine_name: 'Packaging Machine (Semi-Auto)',      unit_cost: 85000, quantity: 1 },
    { machine_name: 'Weighing & Grading Equipment',      unit_cost: 25000, quantity: 1 },
    { machine_name: 'Storage Containers / Bins',         unit_cost: 12000, quantity: 4 },
    { machine_name: 'Generator / Power Backup',          unit_cost: 60000, quantity: 1 },
    { machine_name: 'Lab Testing Equipment (QC)',        unit_cost: 20000, quantity: 1 },
  ],
  garment_textile: [
    { machine_name: 'Industrial Sewing Machine',         unit_cost: 22000, quantity: 8 },
    { machine_name: 'Overlock / Serger Machine',         unit_cost: 20000, quantity: 2 },
    { machine_name: 'Button-hole / Special Stitch Mach.',unit_cost: 25000, quantity: 1 },
    { machine_name: 'Fabric Cutting Machine',            unit_cost: 35000, quantity: 1 },
    { machine_name: 'Steam Press / Finishing Unit',      unit_cost: 18000, quantity: 2 },
    { machine_name: 'Generator / Power Backup',          unit_cost: 60000, quantity: 1 },
  ],
  soap_cosmetics: [
    { machine_name: 'Soap Making / Mixer Machine',       unit_cost: 90000, quantity: 1 },
    { machine_name: 'Moulds / Dies Set',                 unit_cost: 15000, quantity: 1 },
    { machine_name: 'Filling & Packaging Machine',       unit_cost: 65000, quantity: 1 },
    { machine_name: 'Weighing Scale (Precision)',        unit_cost: 8000,  quantity: 2 },
    { machine_name: 'Generator / Power Backup',          unit_cost: 50000, quantity: 1 },
  ],
  furniture_wood: [
    { machine_name: 'Wood Working Lathe Machine',        unit_cost: 80000, quantity: 1 },
    { machine_name: 'Circular Saw / Band Saw',           unit_cost: 55000, quantity: 1 },
    { machine_name: 'Router / Shaper Machine',           unit_cost: 40000, quantity: 1 },
    { machine_name: 'Sanding / Polishing Machine',       unit_cost: 25000, quantity: 1 },
    { machine_name: 'Air Compressor & Spray Gun',        unit_cost: 18000, quantity: 1 },
    { machine_name: 'Generator / Power Backup',          unit_cost: 60000, quantity: 1 },
  ],
  metal_fabrication: [
    { machine_name: 'Welding Machine (ARC/MIG)',         unit_cost: 35000, quantity: 2 },
    { machine_name: 'Cutting Machine (Gas/Plasma)',      unit_cost: 80000, quantity: 1 },
    { machine_name: 'Drilling Machine (Pillar Type)',    unit_cost: 25000, quantity: 1 },
    { machine_name: 'Grinding Machine',                  unit_cost: 20000, quantity: 2 },
    { machine_name: 'Lathe Machine',                    unit_cost: 120000,quantity: 1 },
    { machine_name: 'Generator / Power Backup',          unit_cost: 70000, quantity: 1 },
  ],
  agro_processing: [
    { machine_name: 'Milling / Processing Machine',      unit_cost: 180000,quantity: 1 },
    { machine_name: 'Grading / Sorting Machine',         unit_cost: 60000, quantity: 1 },
    { machine_name: 'Weighing Scale (Platform)',         unit_cost: 18000, quantity: 2 },
    { machine_name: 'Storage Bins / Silos',             unit_cost: 20000, quantity: 4 },
    { machine_name: 'Generator / Power Backup',          unit_cost: 75000, quantity: 1 },
  ],
  // ── AGRICULTURE ──────────────────────────────────────────────────────────────
  crop_farming: [
    { machine_name: 'Power Tiller / Mini Tractor',       unit_cost: 150000,quantity: 1 },
    { machine_name: 'Drip Irrigation System (per acre)', unit_cost: 25000, quantity: 3 },
    { machine_name: 'Sprayer (Power Operated)',           unit_cost: 12000, quantity: 2 },
    { machine_name: 'Thresher / Harvesting Machine',     unit_cost: 45000, quantity: 1 },
    { machine_name: 'Storage Shed / Godown Fixtures',    unit_cost: 20000, quantity: 1 },
  ],
  animal_husbandry: [
    { machine_name: 'Milking Machine (Semi-Auto)',        unit_cost: 55000, quantity: 1 },
    { machine_name: 'Chaff Cutter / Feed Mixer',         unit_cost: 30000, quantity: 1 },
    { machine_name: 'Chilling / Milk Cooler Tank',       unit_cost: 80000, quantity: 1 },
    { machine_name: 'Water Pump & Piping',               unit_cost: 15000, quantity: 1 },
    { machine_name: 'Generator / Power Backup',          unit_cost: 50000, quantity: 1 },
  ],
  poultry_farming: [
    { machine_name: 'Broiler Cage / Battery Cage System',unit_cost: 40000, quantity: 4 },
    { machine_name: 'Feed & Water Dispenser Set',        unit_cost: 12000, quantity: 4 },
    { machine_name: 'Egg Incubator (Auto)',              unit_cost: 25000, quantity: 1 },
    { machine_name: 'Exhaust Fan / Ventilation',         unit_cost: 8000,  quantity: 4 },
    { machine_name: 'Generator / Power Backup',          unit_cost: 50000, quantity: 1 },
  ],
  fisheries: [
    { machine_name: 'Fish Tank / Pond Liner Setup',      unit_cost: 60000, quantity: 2 },
    { machine_name: 'Aerator / Oxygenation System',     unit_cost: 18000, quantity: 2 },
    { machine_name: 'Feed Dispensing Machine',           unit_cost: 20000, quantity: 1 },
    { machine_name: 'Water Pump & Filters',              unit_cost: 15000, quantity: 1 },
    { machine_name: 'Weighing Scale & Nets',             unit_cost: 8000,  quantity: 1 },
  ],
  mushroom_farming: [
    { machine_name: 'Autoclave / Steriliser',            unit_cost: 35000, quantity: 1 },
    { machine_name: 'Mushroom Growing Rack System',      unit_cost: 20000, quantity: 4 },
    { machine_name: 'Humidity / Temperature Controller', unit_cost: 15000, quantity: 2 },
    { machine_name: 'Polythene Bag Sealing Machine',     unit_cost: 8000,  quantity: 1 },
    { machine_name: 'Exhaust Fan / AC (Controlled Env)',unit_cost: 40000,  quantity: 1 },
  ],
};

// ── CA Building Cost Ranges per industry (Rs.) ──────────────────────────────
// Used as hint text — based on typical Indian market rates (2024-25)
export const BUILDING_COST_HINTS: Record<string, { min: number; max: number; note: string }> = {
  manufacturing: { min: 200000, max: 800000, note: 'Factory shed @ Rs.400-700/sq.ft × 500-1200 sq.ft. Get valuer certificate.' },
  trading:       { min: 50000,  max: 250000, note: 'Shop renovation & interior @ Rs.200-500/sq.ft × 150-500 sq.ft.' },
  service:       { min: 40000,  max: 200000, note: 'Office/outlet setup @ Rs.150-400/sq.ft × 150-400 sq.ft.' },
  agriculture:   { min: 80000,  max: 300000, note: 'Farm shed/storage @ Rs.300-500/sq.ft × 200-600 sq.ft.' },
};

// PMEGP Implementing Agency
export const IMPLEMENTING_AGENCY_OPTIONS = [
  { value: 'kvic', label: 'KVIC — Khadi and Village Industries Commission' },
  { value: 'kvib', label: 'KVIB — Khadi and Village Industries Board (State)' },
  { value: 'dic',  label: 'DIC — District Industries Centre' },
];

export const LOAN_SCHEME_OPTIONS = [
  { value: 'pmegp',        label: 'PMEGP — Govt Subsidy 15–35%  (Max Rs. 50L Mfg / Rs. 20L Svc)' },
  { value: 'mudra_shishu', label: 'Mudra Shishu — Collateral-free  (Up to Rs. 50,000)' },
  { value: 'mudra_kishor', label: 'Mudra Kishor — Collateral-free  (Rs. 50K – Rs. 5L)' },
  { value: 'mudra_tarun',  label: 'Mudra Tarun — Full CMA  (Rs. 5L – Rs. 10L)' },
  { value: 'mudra_tarunplus', label: 'Mudra TarunPlus — For repaid Tarun borrowers  (Rs. 10L – Rs. 20L)' },
  { value: 'cgtmse',       label: 'CGTMSE — Govt Guarantee 75–85%  (Up to Rs. 5 Cr)' },
  { value: 'normal_msme',  label: 'MSME PSU Bank Loan — Standard loan  (Rs. 10 Cr+)' },
  { value: 'other_scheme', label: 'Other Scheme' },
];

export const LOAN_PURPOSE_OPTIONS = [
  { value: 'term_loan',               label: 'Term Loan (Capital Expenditure)' },
  { value: 'working_capital',         label: 'Working Capital Loan' },
  { value: 'term_and_working_capital',label: 'Term Loan + Working Capital (Composite)' },
];

export const WORKING_CAPITAL_PERIOD_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
];

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
];
