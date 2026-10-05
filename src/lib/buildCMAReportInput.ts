/**
 * buildCMAReportInput.ts
 *
 * Maps GTABFormData → CMAReportInput (POST /api/v1/report/generate).
 *
 * Revenue strategy by industry:
 *   Manufacturing : input_qty_per_day × yield% × working_days × selling_price_per_unit
 *   Service       : input_qty = 0, selling_price_per_unit = total monthly revenue × 12
 *   Trading       : input_qty = 0, selling_price_per_unit = total monthly revenue × 12
 */

import type { GTABFormData } from '@/types/gtab';
import { NATURE_OF_BUSINESS_OPTIONS } from '@/types/gtab';
import { getNormalizedProjectReportInputs, getProjectReportMachineryTotal } from '@/lib/projectReport';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve dropdown value → human-readable label for the PDF report. */
function resolveNatureLabel(industryType: string, value: string): string {
  const key = (industryType || 'manufacturing') as keyof typeof NATURE_OF_BUSINESS_OPTIONS;
  const options = NATURE_OF_BUSINESS_OPTIONS[key] ?? NATURE_OF_BUSINESS_OPTIONS['manufacturing'];
  return options.find((o) => o.value === value)?.label ?? value;
}

// Effective monthly revenue = annual ÷ 12, where annual = line monthly ×
// number_of_months (honours seasonal businesses). Backend multiplies this by
// 12, so annual stays correct. ponytail: bridge kept here to leave backend ×12
// contract untouched; move months into the payload if the API ever needs it.
const monthsFactor = (item: { number_of_months?: number }) =>
  Math.min(Math.max(Number(item.number_of_months) || 12, 1), 12) / 12;

/** Aggregate effective monthly revenue from Step 9 service lines (seasonal-aware). */
function getServiceMonthlyRevenue(formData: GTABFormData): number {
  const cats = formData.project_report_inputs?.revenue?.product_categories ?? [];
  return cats.reduce((sum, item) => {
    const monthly = Number(item.fixed_revenue) || (Number(item.units_monthly || 0) * Number(item.avg_price || 0));
    return sum + monthly * monthsFactor(item);
  }, 0);
}

/** Aggregate effective monthly revenue from Step 9 trading lines (seasonal-aware). */
function getTradingMonthlyRevenue(formData: GTABFormData): number {
  const cats = formData.project_report_inputs?.revenue?.product_categories ?? [];
  return cats.reduce((sum, item) => {
    const qty   = Number(item.quantity_sold || item.units_monthly || 0);
    const price = Number(item.selling_price || item.avg_price || 0);
    return sum + qty * price * monthsFactor(item);
  }, 0);
}

// self-check: 8-month line @10k/mo → effective monthly 6 667 → backend ×12 = 80k/yr
if (import.meta.env?.DEV) {
  const fd = { project_report_inputs: { revenue: { product_categories: [{ fixed_revenue: 10000, number_of_months: 8 }] } } } as unknown as GTABFormData;
  console.assert(Math.round(getServiceMonthlyRevenue(fd) * 12) === 80000, "revenue annualization broken");
}

/** Aggregate monthly COGS from Step 9 trading product lines (purchase_price × qty).
 *  Used when Step 7 raw_material_cost is blank — avoids falling through to 70% default. */
function getTradingMonthlyCOGS(formData: GTABFormData): number {
  const cats = formData.project_report_inputs?.revenue?.product_categories ?? [];
  return cats.reduce((sum, item) => {
    const qty = Number(item.quantity_sold || item.units_monthly || 0);
    const pp  = Number(item.purchase_price || 0);
    return sum + qty * pp;
  }, 0);
}

// ── Social category normalisation ─────────────────────────────────────────────

const SOCIAL_CATEGORY_MAP: Record<string, string> = {
  general:       'General',
  sc:            'SC',
  st:            'ST',
  obc:           'OBC',
  minority:      'Minority',
  women:         'Women',
  ex_serviceman: 'ExServiceman',
  pwd:           'PwD',
  undisclosed:   'General',
};

function normaliseSocialCategory(raw: string): string {
  return SOCIAL_CATEGORY_MAP[raw?.toLowerCase()] ?? 'General';
}

// ── Scheme ID normalisation ────────────────────────────────────────────────────

const SCHEME_MAP: Record<string, string> = {
  pmegp:           'pmegp',
  mudra:           'mudra_kishor',  // default Mudra tier when unspecified
  mudra_shishu:    'mudra_shishu',
  mudra_kishor:    'mudra_kishor',
  mudra_tarun:     'mudra_tarun',
  mudra_tarunplus: 'mudra_tarunplus',
  cgtmse:          'cgtmse',
  normal_msme:     'msme_psu',
  msme_psu:        'msme_psu',
  msme_loan:       'msme_psu',
  other_scheme:    'msme_psu',
};

function normaliseScheme(raw: string): string {
  return SCHEME_MAP[raw?.toLowerCase()] ?? 'msme_psu';
}

// ── Main builder ───────────────────────────────────────────────────────────────

export interface CMAReportCustomization {
  frontPageColor: "Navy" | "Teal" | "Royal Blue" | "Burgundy" | "Forest Green" | "Charcoal";
  preparedBy: string;
  bankName?: string;
}

export function buildCMAReportInput(
  formData: GTABFormData,
  customization?: CMAReportCustomization,
): object {
  const ri             = getNormalizedProjectReportInputs(formData);
  const machineryTotal = getProjectReportMachineryTotal(formData);
  const dpr            = ri.dpr;
  const industry       = (formData.industry_type === 'others'
    ? (formData.industry_other || 'manufacturing')
    : (formData.industry_type || 'manufacturing')).toLowerCase();

  const fullName = [formData.first_name, formData.middle_name, formData.last_name]
    .filter(Boolean).join(' ');

  // ── Machinery items (with supplier details for PDF Section C) ────────────
  const machineryItems = (formData.plant_machinery ?? []).map((m) => ({
    name:           m.machine_name  || 'Machinery',
    quantity:       Number(m.quantity || 1),
    unit_price:     Number(m.unit_cost || m.cost || 0),
    supplier_name:  m.supplier_name  || '',
    supplier_city:  m.supplier_city  || '',
    supplier_phone: m.supplier_phone || '',
  }));
  if (machineryItems.length === 0 && machineryTotal > 0) {
    machineryItems.push({ name: 'Plant & Machinery', quantity: 1, unit_price: machineryTotal, supplier_name: '', supplier_city: '', supplier_phone: '' });
  }

  // ── Fixed assets & preliminary expenses ──────────────────────────────────
  // Computers, furniture, electrification, racks, transport = depreciable FIXED ASSETS
  // only other_initial_expenditure is true pre-operative (non-depreciable)
  const preliminaryExpenses = Number(formData.other_initial_expenditure || 0);

  // ── Revenue computation by industry ──────────────────────────────────────
  // Manufacturing: qty/day × yield × days × price  (computed in backend)
  // Service/Trading: set input_qty=0, pass total monthly revenue as selling_price_per_unit
  //   Backend: annual = selling_price_per_unit × 12  (when price > 5000)
  let inputQtyPerDay        = 0;
  let outputYieldPct        = 100;
  let sellingPricePerUnit   = 0;
  let rawMaterialCostPerUnit = 0;

  if (industry === 'service' || industry === 'agriculture') {
    // Aggregate from Step 9 revenue lines (service-style product categories)
    // Agriculture uses the same product_category UI as service in Step 9
    const fromLines = getServiceMonthlyRevenue(formData);
    sellingPricePerUnit = fromLines || Number(formData.expected_monthly_revenue || 0);
    inputQtyPerDay = 0;
    outputYieldPct = 100;

  } else if (industry === 'trading') {
    // Aggregate from Step 9 trading product lines
    const fromLines = getTradingMonthlyRevenue(formData);
    sellingPricePerUnit = fromLines || Number(formData.expected_monthly_revenue || 0);
    inputQtyPerDay = 0;
    outputYieldPct = 100;

  } else {
    // Manufacturing / Agriculture: Step 9 DPR fields take priority; Step 5 DynamicIndustryFields as fallback
    // production_capacity_units (monthly) ÷ 25 working days → daily input qty fallback
    const step5DailyQty = formData.production_capacity_units
      ? Math.round(Number(formData.production_capacity_units) / 25) : 0;

    inputQtyPerDay = Number(dpr.fresh_leaves_per_day_kg || dpr.input_qty_per_day || step5DailyQty || 0);
    outputYieldPct = Number(dpr.yield_rate_pct || 100);
    rawMaterialCostPerUnit = Number(
      dpr.cost_fresh_leaves_per_kg ||
      dpr.raw_material_cost_per_unit ||
      formData.production_cost_per_unit ||   // Step 5 DynamicIndustryFields fallback
      0
    );

    const prodPrice = Number(
      dpr.selling_price_per_kg ||
      dpr.selling_price_per_unit ||
      formData.selling_price_per_unit ||     // Step 5 DynamicIndustryFields fallback
      0
    );
    if (inputQtyPerDay > 0 && prodPrice > 0) {
      sellingPricePerUnit = prodPrice;
    } else {
      inputQtyPerDay      = 0;
      sellingPricePerUnit = prodPrice || Number(formData.expected_monthly_revenue || 0);
    }
  }

  // ── Assemble payload ──────────────────────────────────────────────────────
  return {
    prepared_by: customization?.preparedBy ?? "EasyBizy",
    report_theme: customization?.frontPageColor ?? "Navy",
    scheme: normaliseScheme(formData.loan_scheme),

    applicant: {
      full_name:         fullName || ri.promoter.full_name || '',
      fathers_name:      ri.promoter.fathers_name || '',
      date_of_birth:     ri.promoter.date_of_birth  || '',
      gender:            formData.gender             || 'male',
      education:         formData.education          || '',
      social_category:   normaliseSocialCategory(formData.social_category),
      area_type:         formData.area_type === 'urban' ? 'Urban' : 'Rural',
      pan_number:        ri.promoter.pan_number      || '',
      aadhar_number:     ri.promoter.aadhar_number   || '',
      mobile:            formData.contact_mobile     || '',
      email:             formData.contact_email      || '',
      address: [
        formData.address_line_1, formData.address_line_2, formData.city, formData.state, formData.pincode,
      ].filter(Boolean).join(', '),
      years_experience:  Number(ri.promoter.years_experience || 0),
      previous_employer: ri.promoter.previous_employer || '',
      previous_role:     ri.promoter.previous_role     || '',
    },

    // loan_purpose used in PDF Section P header (not for calculation)
    loan_purpose: formData.loan_purpose || 'term_loan',

    business: {
      business_name:       formData.business_entity_name    || '',
      nature_of_business:  resolveNatureLabel(industry, formData.type_of_business)
                             || formData.products_services  || '',
      business_type:       formData.registration_type       || 'proprietorship',
      industry_type:       industry,
      business_status:     formData.business_type === 'existing_business'
                             ? 'Existing Business' : 'New Business',
      commencement_date:   ri.business.commencement_date    || new Date().toISOString().slice(0, 10),
      location:            `${formData.city || ''}, ${formData.state || ''}`.replace(/^,\s*|,\s*$/g, ''),
      district:            formData.district || formData.city || '',
      expected_employment:      Number(formData.expected_employment || 0),
      implementing_agency:      formData.implementing_agency ?? undefined,
      is_second_loan:           formData.is_second_loan ?? false,
      gst_number:               ri.business.gst_number  || '',
      msme_number:              ri.business.msme_number || '',
      bank_name:                ri.loan.bank_name || '',
      business_duration_months: Number(formData.business_duration_months || 0),
      existing_annual_turnover: formData.business_type === 'existing_business' ? Number(formData.existing_annual_turnover || 0) : 0,
      existing_annual_profit:   formData.business_type === 'existing_business' ? Number(formData.existing_annual_profit || 0) : 0,
      existing_monthly_emi:     formData.business_type === 'existing_business' ? Number(formData.existing_monthly_emi || 0) : 0,
      scheme_label:             (formData.loan_scheme === 'other_scheme' && formData.loan_scheme_other)
                                  ? formData.loan_scheme_other
                                  : '',
      primary_raw_material:  formData.primary_raw_material  || '',
      raw_material_supplier: formData.raw_material_supplier || '',
      collateral_details:    ri.loan.collateral_details || '',
      guarantor_name:        ri.loan.guarantor_name     || '',
      guarantor_relation:    ri.loan.guarantor_relation || '',
      processing_fee_pct:    Number(ri.loan.processing_fee_pct || 0),
    },

    to_bank: customization?.bankName || '',

    project: {
      land_cost:            Number(formData.land_cost                  || 0),
      building_cost:        Number(formData.shed_building_cost         || 0),
      machinery_items:      machineryItems,
      tools_installation:   Number(formData.machinery_installation_cost || 0),
      // Fixed assets — sent separately so backend can depreciate and itemise them correctly
      computers_cost:       Number(formData.computers_cost             || 0),
      furniture_cost:       Number(formData.furniture_cost             || 0),
      electrification_cost: Number(formData.electrification_cost       || 0),
      racks_storage_cost:   Number(formData.racks_storage_cost         || 0),
      transportation_cost:  Number(formData.transportation_cost        || 0),
      // Only true pre-operative expense (non-depreciable)
      preliminary_expenses: preliminaryExpenses,
    },

    production: {
      // For service/trading: input_qty_per_day = 0 triggers monthly-revenue path in backend
      input_qty_per_day:          inputQtyPerDay,
      output_yield_pct:           outputYieldPct,
      working_days_per_year:      Number(dpr.working_days_per_year || 300),
      selling_price_per_unit:     sellingPricePerUnit,
      raw_material_cost_per_unit: rawMaterialCostPerUnit,
      hours_of_operation:         Number(dpr.hours_of_operation   || 8),
    },

    assumptions: {
      // ── Loan structure ──────────────────────────────────────────────────
      term_loan_pct:          Number(dpr.term_loan_pct               || 75),
      wc_loan_pct:            Number(dpr.wc_loan_pct                 || 60),
      wc_finance_method:      dpr.wc_finance_method                  || "simple_margin",
      wc_margin_pct:          Number(dpr.wc_margin_pct               || 25),
      promoter_drawings_pct:  Number(dpr.promoter_drawings_pct       || 0),
      capital_subsidy_pct:    Number(dpr.capital_subsidy_pct         || 0),
      interest_rate_pct:      Number(ri.loan.interest_rate_pct       || 10.5),
      tenure_months:          Number(ri.loan.tenure_months           || 60),
      moratorium_months:      Number(ri.loan.moratorium_months       || 0),
      // ── Growth assumptions ───────────────────────────────────────────────
      revenue_growth_pct:     Number(ri.revenue.revenue_growth_pct   || 7),
      expense_growth_pct:     Number(ri.revenue.expense_growth_pct   || 5),
      salary_increase_pct:    Number(dpr.salary_increase_pct         || 10),
      // ── Tax & depreciation ───────────────────────────────────────────────
      tax_rate_pct:           Number(ri.revenue.tax_rate_pct         || 25),
      depreciation_pct:       Number(ri.revenue.depreciation_pct     || 10),
      building_dep_rate_pct:  Number(dpr.building_dep_rate_pct       || 5),
      contingency_pct:        Number(dpr.contingency_pct             || 0),
      // ── Working capital norms ────────────────────────────────────────────
      stock_holding_days:     Number(ri.working_capital.stock_days   || 30),
      // Step 5 DynamicIndustryFields: supplier_credit_days / customer_credit_days as fallback for trading
      debtor_days:            Number(ri.working_capital.debtors_days  ?? formData.customer_credit_days ?? 30),
      creditor_days:          Number(ri.working_capital.creditors_days || formData.supplier_credit_days || 15),
      wip_days:               Number(dpr.wip_days                    || 15),
      fg_days:                Number(dpr.fg_days                     || 30),
      // ── Capacity utilisation — dpr defaults are 0 so || fallback picks industry schedule
      // Manufacturing: 50/60/70/75/80 | Service/Trading: 60/70/80/85/90 | Agriculture: 80/85/90/95/100
      capacity_y1_pct: Number(dpr.capacity_y1_pct) || (industry === 'agriculture' ? 80 : ['service','trading'].includes(industry) ? 60 : 50),
      capacity_y2_pct: Number(dpr.capacity_y2_pct) || (industry === 'agriculture' ? 85 : ['service','trading'].includes(industry) ? 70 : 60),
      capacity_y3_pct: Number(dpr.capacity_y3_pct) || (industry === 'agriculture' ? 90 : ['service','trading'].includes(industry) ? 80 : 70),
      capacity_y4_pct: Number(dpr.capacity_y4_pct) || (industry === 'agriculture' ? 95 : ['service','trading'].includes(industry) ? 85 : 75),
      capacity_y5_pct: Number(dpr.capacity_y5_pct) || (industry === 'agriculture' ? 100 : ['service','trading'].includes(industry) ? 90 : 80),
      // cogs_pct_override REMOVED — backend now uses expenses.raw_materials (Priority 2)
      // or production unit costs (Priority 1). Override was the root cause of inverted DSCR.
      cogs_pct_override: 0,
    },

    products: ri.revenue.product_categories.length > 0
      ? ri.revenue.product_categories.map((p) => ({
          category:        p.category || 'Products/Services',
          units_per_month: Number(p.quantity_sold || p.units_monthly) || 1,
          avg_price:       Number(p.selling_price || p.avg_price)     || 0,
          purchase_price:  Number(p.purchase_price)                   || 0,
          monthly_revenue: Number(p.fixed_revenue) ||
            (Number(p.quantity_sold || p.units_monthly) || 0) * (Number(p.selling_price || p.avg_price) || 0),
          mix_pct: Number(p.service_mix_pct) || 0,
        }))
      : [],

    // ── Monthly operating expenses → backend P&L Section E ─────────────────
    // CA FIX: raw_materials is now sent here — backend uses it as COGS base
    // when production unit costs are not provided (Priority 2 path).
    expenses: {
      // For trading: prefer Step 9 purchase_price × qty totals; fall back to Step 7 field.
      // This prevents COGS from silently falling through to the 70% industry default.
      raw_materials: industry === 'trading'
        ? (getTradingMonthlyCOGS(formData) || Number(formData.raw_material_cost || 0))
        : Number(formData.raw_material_cost || 0),
      rent:                Number(formData.monthly_rent              || 0),
      electricity_water:   Number(formData.electricity_water_cost    || 0),
      repair_maintenance:  Number(formData.repair_maintenance_cost   || 0),
      transport_conveyance:Number(formData.transport_cost            || 0),
      telephone_internet:  Number(formData.telephone_internet_cost   || 0),
      marketing:           Number(formData.marketing_cost            || 0),
      miscellaneous:       Number(formData.miscellaneous_cost        || 0),
      stationery:          Number(formData.stationery_cost           || 0),
    },

    // ── Manpower — PDF Section E (staff headcount and monthly salary per category) ──
    manpower: {
      skilled_count:          Number(formData.skilled_workers_count       || 0),
      skilled_salary:         Number(formData.skilled_workers_salary      || 0),
      semi_skilled_count:     Number(formData.semi_skilled_workers_count  || 0),
      semi_skilled_salary:    Number(formData.semi_skilled_workers_salary || 0),
      unskilled_count:        Number(formData.wages_count                 || 0),
      unskilled_salary:       Number(formData.wages_salary                || 0),
    },

    // ── Step 4 narrative texts → PDF A4 sections (Introduction, Market, etc.) ──
    narrative: {
      business_description:    formData.business_description    || '',
      products_services:       formData.products_services       || '',
      target_market:           formData.target_market           || '',
      competitive_advantage:   formData.competitive_advantage   || '',
      promoter_experience:     formData.promoter_experience     || '',
      introduction_text:       formData.introduction_text       || '',
      market_aspects_text:     formData.market_aspects_text     || '',
      management_aspects_text: formData.management_aspects_text || '',
      technical_aspects_text:  formData.technical_aspects_text  || '',
      financial_aspects_text:  formData.financial_aspects_text  || '',
    },

    // ── Competitors from Step 9 — appear in PDF Section A6 ───────────────────
    competitors: (ri.competitors ?? []).map((c) => ({
      name:       c.name       || '',
      type:       c.type       || 'Organized',
      distance:   c.distance   || '',
      strengths:  c.strengths  || '',
      weaknesses: c.weaknesses || '',
    })),

    // ── Promoter Net Worth — bank uses this for credit assessment & collateral ──
    // Shown in PDF Section Q (Promoter Background & Net Worth Statement)
    promoter_net_worth: {
      residential_property:    Number(ri.promoter_assets.residential_property || 0),
      fixed_deposits:          Number(ri.promoter_assets.fixed_deposits       || 0),
      savings_account:         Number(ri.promoter_assets.savings_account      || 0),
      mutual_funds:            Number(ri.promoter_assets.mutual_funds         || 0),
      home_loan_outstanding:   Number(ri.promoter_assets.home_loan_outstanding || 0),
      home_loan_emi:           Number(ri.promoter_assets.home_loan_emi        || 0),
    },
  };
}
