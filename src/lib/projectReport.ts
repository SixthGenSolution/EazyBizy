import {
  GTABFormData,
  ProjectReportInputs,
  mergeProjectReportInputs,
} from "@/types/gtab";
import { getMonthlyWorkingCapital } from "@/lib/workingCapital";
import {
  calculatePMEGPSubsidy,
  calculatePMEGPPromoterContribution,
  calculatePMEGPBankFinance,
} from "@/lib/loanRulesEngine";
import { getSchemeRules } from "@/lib/schemeRulesStore";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(Number(value || 0), min), max);

const titleize = (value?: string | null) =>
  value
    ? value
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase())
    : "";

const buildFullName = (formData: GTABFormData) =>
  [formData.first_name, formData.middle_name, formData.last_name].filter(Boolean).join(" ");

const getLoanType = (loanPurpose: GTABFormData["loan_purpose"]): ProjectReportInputs["loan"]["loan_type"] => {
  if (loanPurpose === "working_capital") return "Working Capital";
  if (loanPurpose === "term_and_working_capital") return "Composite";
  return "Term Loan";
};

export const getProjectCostBreakdown = (formData: GTABFormData) => {
  const includesTermLoan = formData.loan_purpose !== "working_capital";
  const includesWorkingCapital = formData.loan_purpose !== "term_loan";
  const monthlyWorkingCapital = getMonthlyWorkingCapital(
    Number(formData.working_capital_required || 0),
    formData.working_capital_period,
  );
  const promoterWorkingCapitalPct = includesWorkingCapital
    ? 100 - getWorkingCapitalBankFinancePct(formData)
    : 0;
  const promoterWorkingCapitalContribution = Number(
    ((monthlyWorkingCapital * promoterWorkingCapitalPct) / 100).toFixed(2),
  );
  const machineryLineTotal = formData.plant_machinery.reduce(
    (sum, item) => sum + (Number(item.cost) || 0),
    0,
  );
  const toolsInstallation = Number(formData.machinery_installation_cost || 0);
  const sectionCTotal = machineryLineTotal + toolsInstallation;

  const fixedAssetCost =
    Number(formData.land_cost || 0) +
    Number(formData.shed_building_cost || 0) +
    sectionCTotal +
    Number(formData.computers_cost || 0) +
    Number(formData.furniture_cost || 0) +
    Number(formData.electrification_cost || 0) +
    Number(formData.racks_storage_cost || 0) +
    Number(formData.transportation_cost || 0) +
    Number(formData.other_initial_expenditure || 0);

  // Total project cost is the actual funding stack the applicant is using:
  // Term Loan Requested + Working Capital Facility Requested + Promoter Contribution.
  // The WC facility is a bank loan, not a hidden cost item, and the promoter
  // contribution must include both the fixed-capital equity and the WC margin.
  const termLoanBankFinancePct = getBankFinancePct(formData);
  const wcBankFinancePct = getWorkingCapitalBankFinancePct(formData);

  let termLoanAmount = 0;
  let promoterProjectContribution = 0;

  if (formData.loan_scheme === "pmegp") {
    const pmegpSubsidyAmount = includesTermLoan
      ? calculatePMEGPSubsidy(fixedAssetCost, formData.social_category, formData.area_type || "urban")
      : 0;
    promoterProjectContribution = includesTermLoan
      ? calculatePMEGPPromoterContribution(fixedAssetCost, formData.social_category)
      : 0;
    termLoanAmount = includesTermLoan
      ? calculatePMEGPBankFinance(fixedAssetCost, pmegpSubsidyAmount, promoterProjectContribution)
      : 0;
  } else {
    termLoanAmount = includesTermLoan
      ? Number(((fixedAssetCost * termLoanBankFinancePct) / 100).toFixed(2))
      : 0;
    promoterProjectContribution = Number(Math.max(fixedAssetCost - termLoanAmount, 0).toFixed(2));
  }

  const workingCapitalLoan = includesWorkingCapital
    ? Number(((monthlyWorkingCapital * wcBankFinancePct) / 100).toFixed(2))
    : 0;

  const promoterContribution = Number(
    (promoterProjectContribution + promoterWorkingCapitalContribution).toFixed(2),
  );

  return {
    fixedAssetCost,
    monthlyWorkingCapital,
    promoterWorkingCapitalContribution,
    promoterProjectContribution,
    promoterContribution,
    termLoanAmount,
    workingCapitalLoan,
    totalProjectCost: Number((termLoanAmount + workingCapitalLoan + promoterContribution).toFixed(2)),
  };
};

export const getEstimatedProjectCost = (formData: GTABFormData) =>
  getProjectCostBreakdown(formData).totalProjectCost;

// Scheme-specific TL % bands (CA/RBI norms)
const SCHEME_TL_BAND: Record<string, [number, number]> = {
  pmegp:           [60, 90],   // backend overrides with subsidy calc, but clamp display
  mudra_shishu:    [80, 95],
  mudra_kishor:    [80, 95],
  mudra:           [80, 95],   // legacy alias
  mudra_tarun:     [75, 85],
  mudra_tarunplus: [75, 85],
  cgtmse:          [75, 85],
  normal_msme:     [70, 80],
  other_scheme:    [60, 90],
};

// Typical [min, max] band for Bank Finance on Fixed Capital %, per scheme —
// informational only (preset buttons / "typical range" hints). The actual
// percentage a bank offers varies bank-to-bank and must NEVER be force-
// clamped into this band; getBankFinancePct below only sanity-bounds to
// 0-100%, it does not enforce the scheme-typical range.
//
// Not sourced from the Rules & Rates engine: the DB stores a single
// term_loan_pct_default per scheme, not a [min,max] range, so there's no
// backend value to reconcile this band against — it stays a local UI
// heuristic (only consumed by caAdvisory.ts's advisePromoterMargin, and
// only for schemes where the user's own % genuinely drives the report).
export const getBankFinancePctBand = (formData: GTABFormData): [number, number] =>
  SCHEME_TL_BAND[formData.loan_scheme] ?? [0, 100];

export const getBankFinancePct = (formData: GTABFormData) => {
  const merged = mergeProjectReportInputs(formData.project_report_inputs);
  // Prefer the Rules & Rates engine's scheme default (fetched via
  // useSchemeRules) only when the user hasn't entered anything — schemes
  // that don't have a configured default (Mudra, PMEGP) keep the flat 75
  // fallback, which matches backend/models/input_schema.py's own default.
  const fetchedDefault = getSchemeRules(formData.loan_scheme)?.term_loan_pct_default;
  const raw = Number(merged.dpr.term_loan_pct || fetchedDefault || 75);
  // Banks set this per their own credit policy — never force it into a
  // scheme-typical band. Only guard basic numeric sanity (0-100%).
  return clamp(raw, 0, 100);
};

// RBI/Nayak Committee simplified turnover method (mandatory for MSE borrowers
// with turnover up to ₹5 crore — covers effectively all Mudra/PMEGP/CGTMSE/
// small-MSME applicants here): WC requirement = 25% of turnover, of which the
// bank finances a minimum of 20% of turnover = 80% of the assessed
// requirement, borrower margin = the remaining 20%.
//
// This is DELIBERATELY not sourced from the Rules & Rates engine's
// wc_loan_pct_default (60) — that DB value is the backend's conservative
// absolute-safety-net fallback (used only if literally nothing is
// supplied), while 80 here is the Nayak Committee ceiling this form's own
// default state (types/gtab.ts) initialises every new application to.
// They intentionally differ; reconciling them would lower every new
// application's default WC bank-finance % from 80 to 60.
const NAYAK_COMMITTEE_WC_BANK_FINANCE_PCT = 80;

export const getWorkingCapitalBankFinancePct = (formData: GTABFormData) => {
  const merged = mergeProjectReportInputs(formData.project_report_inputs);
  return clamp(Number(merged.dpr.wc_loan_pct || NAYAK_COMMITTEE_WC_BANK_FINANCE_PCT), 0, 100);
};

const getConfiguredPromoterEquityPct = (formData: GTABFormData) => {
  const merged = mergeProjectReportInputs(formData.project_report_inputs);
  return clamp(Number(merged.dpr.promoter_equity_pct || 30), 0, 100);
};

export const getFinancingPlan = (formData: GTABFormData) => {
  const {
    fixedAssetCost,
    monthlyWorkingCapital,
    promoterWorkingCapitalContribution,
    totalProjectCost,
  } = getProjectCostBreakdown(formData);
  const wcBankFinancePct = getWorkingCapitalBankFinancePct(formData);
  const includesTermLoan = formData.loan_purpose !== "working_capital";
  const includesWorkingCapital = formData.loan_purpose !== "term_loan";

  const isPMEGP = formData.loan_scheme === "pmegp";

  let termLoanAmount = 0;
  let termLoanBankFinancePct = 0;
  let promoterProjectContribution = 0;
  let pmegpSubsidyAmount = 0;

  if (isPMEGP) {
    // PMEGP is NOT "Term Loan = X% of Fixed Capital" — it's a statutory 3-way
    // split: Margin Money subsidy (15/25/35% by category × area, held as TDR)
    // + Promoter's own contribution (5%/10% by category) + Bank Term Loan
    // (the residual). See loanRulesEngine.ts calculatePMEGP* for the verified
    // formula (matches backend/schemes/pmegp.py).
    pmegpSubsidyAmount = includesTermLoan
      ? calculatePMEGPSubsidy(fixedAssetCost, formData.social_category, formData.area_type || "urban")
      : 0;
    promoterProjectContribution = includesTermLoan
      ? calculatePMEGPPromoterContribution(fixedAssetCost, formData.social_category)
      : 0;
    termLoanAmount = includesTermLoan
      ? calculatePMEGPBankFinance(fixedAssetCost, pmegpSubsidyAmount, promoterProjectContribution)
      : 0;
    termLoanBankFinancePct = fixedAssetCost > 0
      ? Number(((termLoanAmount / fixedAssetCost) * 100).toFixed(2))
      : 0;
  } else {
    // CA standard for other schemes: Term Loan applies to FIXED capital only
    // (not total project cost); Promoter fixed equity = fixed capital − term loan.
    termLoanBankFinancePct = getBankFinancePct(formData);
    termLoanAmount = includesTermLoan
      ? Number(((fixedAssetCost * termLoanBankFinancePct) / 100).toFixed(2))
      : 0;
    promoterProjectContribution = Number(
      Math.max(fixedAssetCost - termLoanAmount, 0).toFixed(2),
    );
  }

  const workingCapitalLoan = includesWorkingCapital
    ? Number(((monthlyWorkingCapital * wcBankFinancePct) / 100).toFixed(2))
    : 0;
  const totalBankFinance = Number((termLoanAmount + workingCapitalLoan).toFixed(2));
  // Total promoter contribution = fixed equity (or PMEGP promoter %) + WC margin
  const promoterContribution = Number(
    (promoterProjectContribution + promoterWorkingCapitalContribution).toFixed(2),
  );
  const totalFundingBase = Number((promoterContribution + totalBankFinance + pmegpSubsidyAmount).toFixed(2));
  const promoterEquityPct = totalProjectCost
    ? Number(((promoterContribution / totalProjectCost) * 100).toFixed(2))
    : getConfiguredPromoterEquityPct(formData);
  const totalBankFinancePct = totalProjectCost
    ? Number(((termLoanAmount / totalProjectCost) * 100).toFixed(2))
    : 0;

  // Invariant: total project cost = term loan + WC facility + promoter contribution.
  // PMEGP subsidy is a separate margin-money source and is not added to project cost.
  const projectMeansOfFinance = Number((termLoanAmount + workingCapitalLoan + promoterContribution).toFixed(2));
  if (import.meta.env?.DEV && Math.abs(totalProjectCost - projectMeansOfFinance) > 1) {
    console.warn("[projectReport] Project cost ≠ Term Loan + WC Facility + Promoter Contribution", { totalProjectCost, projectMeansOfFinance });
  }

  return {
    fixedAssetCost,
    monthlyWorkingCapital,
    totalProjectCost,
    totalFundingBase,
    termLoanBankFinancePct,
    wcBankFinancePct,
    termLoanAmount,
    workingCapitalLoan,
    totalBankFinance,
    totalBankFinancePct,
    pmegpSubsidyAmount,
    promoterProjectContribution,
    promoterWorkingCapitalContribution,
    promoterContribution,
    promoterEquityPct,
  };
};

export const getDerivedEligibleLoanAmount = (formData: GTABFormData) =>
  getFinancingPlan(formData).totalBankFinance;

export const getPromoterEquityPct = (formData: GTABFormData) =>
  getFinancingPlan(formData).promoterEquityPct;

export const getNormalizedProjectReportInputs = (formData: GTABFormData): ProjectReportInputs => {
  const merged = mergeProjectReportInputs(formData.project_report_inputs);
  const fullName = buildFullName(formData);
  const financingPlan = getFinancingPlan(formData);
  const normalizedLoanAmount = financingPlan.totalBankFinance;
  const promoterContributionAmount = financingPlan.promoterContribution;

  return mergeProjectReportInputs({
    ...merged,
    promoter: {
      ...merged.promoter,
      full_name: merged.promoter.full_name || fullName,
      gender: merged.promoter.gender || titleize(formData.gender),
      educational_qual: merged.promoter.educational_qual || titleize(formData.education),
      social_category: merged.promoter.social_category || titleize(formData.social_category),
      mobile: merged.promoter.mobile || formData.contact_mobile,
      email: merged.promoter.email || formData.contact_email,
      address_line1: merged.promoter.address_line1 || formData.address_line_1,
      city: merged.promoter.city || formData.city,
      state: merged.promoter.state || formData.state,
      pincode: merged.promoter.pincode || formData.pincode,
    },
    business: {
      ...merged.business,
      business_name: merged.business.business_name || formData.business_entity_name,
      nature_of_business:
        merged.business.nature_of_business || formData.type_of_business || formData.business_description,
      business_type: merged.business.business_type || titleize(formData.registration_type),
      industry:
        merged.business.industry ||
        (formData.industry_type === "others" ? formData.industry_other : titleize(formData.industry_type)),
      store_address:
        merged.business.store_address ||
        [formData.address_line_1, formData.address_line_2].filter(Boolean).join(", "),
      store_city: merged.business.store_city || formData.city,
      store_state: merged.business.store_state || formData.state,
      store_pincode: merged.business.store_pincode || formData.pincode,
      target_market: merged.business.target_market || formData.target_market,
    },
    loan: {
      ...merged.loan,
      loan_scheme: merged.loan.loan_scheme || titleize(formData.loan_scheme),
      loan_type: merged.loan.loan_type || getLoanType(formData.loan_purpose),
      loan_amount: normalizedLoanAmount,
    },
    project_cost: {
      ...merged.project_cost,
      building_renovation: merged.project_cost.building_renovation || Number(formData.shed_building_cost || 0),
      plant_machinery_items:
        merged.project_cost.plant_machinery_items.length > 0
          ? merged.project_cost.plant_machinery_items
          : formData.plant_machinery,
      furniture_fixtures: merged.project_cost.furniture_fixtures || Number(formData.furniture_cost || 0),
      computers_peripherals:
        merged.project_cost.computers_peripherals || Number(formData.computers_cost || 0),
      electrification_wiring:
        merged.project_cost.electrification_wiring || Number(formData.electrification_cost || 0),
      additional_racks_storage:
        merged.project_cost.additional_racks_storage || Number(formData.racks_storage_cost || 0),
      transportation_vehicle:
        merged.project_cost.transportation_vehicle || Number(formData.transportation_cost || 0),
      preoperative_expenses:
        merged.project_cost.preoperative_expenses || Number(formData.other_initial_expenditure || 0),
    },
    promoter_contribution: {
      ...merged.promoter_contribution,
      own_savings: promoterContributionAmount || Number(formData.margin_money || 0),
      family_contribution: 0,
      other_sources: 0,
    },
    dpr: {
      ...merged.dpr,
      promoter_equity_pct: financingPlan.promoterEquityPct,
    },
  });
};

export const getProjectReportMachineryTotal = (formData: GTABFormData) =>
  getNormalizedProjectReportInputs(formData).project_cost.plant_machinery_items.reduce(
    (sum, item) =>
      sum +
      (Number(item.cost) ||
        (Number(item.quantity) || 1) * (Number(item.unit_cost) || 0)),
    0
  ) + Number(formData.machinery_installation_cost || 0);

export const getProjectReportPromoterContribution = (
  formData: GTABFormData,
  _totalProjectCost = getEstimatedProjectCost(formData),
) => getFinancingPlan(formData).promoterContribution;
