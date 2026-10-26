/**
 * aiEngine.ts — Rule-based AI engine (no external API required).
 *
 * Features:
 *   1. recommendScheme()         → best scheme(s) for the applicant
 *   2. getFieldBenchmarks()      → industry-typical value ranges by step
 *   3. predictViability()        → pre-submission DSCR + bank-score estimate
 *   4. generateBusinessPlanDraft() → template-based business plan text
 */

import type { GTABFormData } from '@/types/gtab';
import { getFinancingPlan } from '@/lib/projectReport';
import { getSchemeRules } from '@/lib/schemeRulesStore';
import { getYear1LoanFigures, calculateDscr } from '@/lib/loanSchedule';
import { CAPACITY_SCHEDULE } from '@/lib/capacitySchedule';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SchemeOption {
  id: string;
  name: string;
  maxLoan: number;
  subsidy: string;
  subsidyPct: number;          // 0-1 fraction of project cost that is free govt money
  tlPct: number;               // term loan as fraction of project cost
  minDSCR: number;             // minimum DSCR required by this scheme
  collateral: boolean;
  cmaRequired: boolean;
  score: number;               // 0-100 composite CA match score
  dscrUnderScheme: number;     // estimated DSCR if user switches to this scheme
  subsidyAmount: number;       // ₹ value of subsidy for this project
  pros: string[];
  cons: string[];
  eligible: boolean;
  eligibilityReason?: string;
}

export interface SchemeRecommendation {
  best: SchemeOption | null;
  all: SchemeOption[];
  summary: string;
  selectedSchemeId: string;    // what the user actually picked
  selectedScheme: SchemeOption | null;
  isSelectedOptimal: boolean;
  switchBenefit: string;       // plain-English reason to switch (if any)
  subsidySavingsFromSwitch: number;  // ₹ the user is leaving on the table
  dscrGainFromSwitch: number;  // estimated DSCR gain from switching to best
}

export interface FieldBenchmark {
  field: string;
  label: string;
  typical: string;
  low: number;
  high: number;
  unit: string;
  tip: string;
}

export interface ViabilityIssue {
  severity: 'error' | 'warning' | 'ok';
  label: string;
  detail: string;
  fix?: string;
}

export interface ViabilityPrediction {
  score: number;            // 0-100
  band: 'strong' | 'good' | 'review' | 'weak';
  dscrEstimate: number;
  grossMarginPct: number;
  monthlyProfit: number;
  recommendation: string;
  issues: ViabilityIssue[];
  strengths: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SCHEME RECOMMENDER
// ─────────────────────────────────────────────────────────────────────────────

const SPECIAL_CATEGORIES = ['sc', 'st', 'obc', 'minority', 'women', 'ex_serviceman', 'pwd'];

function pmegpSubsidyPct(category: string, area: string): number {
  const isSpecial = SPECIAL_CATEGORIES.includes(category?.toLowerCase());
  const matrixKey = `${isSpecial ? 'Special' : 'General'}_${area === 'rural' ? 'Rural' : 'Urban'}` as
    'General_Urban' | 'General_Rural' | 'Special_Urban' | 'Special_Rural';
  // Prefer the backend Rules & Rates engine (fetched via useSchemeRules) —
  // falls back to the local figures below only before the first fetch
  // resolves, matching the same pattern used in loanRulesEngine.ts.
  const fetched = getSchemeRules('pmegp')?.subsidy_matrix?.[matrixKey]?.subsidy_pct;
  if (fetched != null) return fetched;
  if (area === 'rural') return isSpecial ? 35 : 25;
  return isSpecial ? 25 : 15;
}

// ── DSCR helper: estimate DSCR for a given effective term loan ───────────────
// Uses the same half-yearly equal-principal, reducing-balance schedule the
// backend actually amortises with (src/lib/loanSchedule.ts) instead of a
// "x0.9" reducing-balance guess, so this comparison table doesn't disagree
// with the real report.
function estimateDSCR(annualCashAccruals: number, termLoan: number, tenureYrs: number, intRatePct: number): number {
  if (termLoan <= 0 || tenureYrs <= 0) return 0;
  const { interestPaid, principalPaid } = getYear1LoanFigures(termLoan, intRatePct, tenureYrs * 12, 0);
  return calculateDscr(annualCashAccruals, interestPaid, principalPaid);
}

export function recommendScheme(formData: GTABFormData): SchemeRecommendation {
  const financing    = getFinancingPlan(formData);
  const projectCost  = financing.totalProjectCost;
  const loanAmount   = financing.totalBankFinance;
  const industry     = (formData.industry_type || 'manufacturing').toLowerCase();
  const category     = formData.social_category || 'general';
  const area         = formData.area_type || 'urban';
  const isNew        = formData.business_type !== 'existing_business';
  const isSecond     = formData.is_second_loan ?? false;
  const selectedSchemeId = (formData.loan_scheme || 'pmegp').toLowerCase();

  // ── Base financial data for DSCR estimates ─────────────────────────────────
  const ri           = formData.project_report_inputs;
  const intRatePct   = Number(ri?.loan?.interest_rate_pct || 9.5);
  const tenureYrs    = Number(ri?.loan?.tenure_months || 60) / 12 || 5;
  const monthlyRev   = Number(formData.expected_monthly_revenue || 0);
  const monthlyExp   =
    Number(formData.raw_material_cost       || 0) +
    Number(formData.monthly_rent            || 0) +
    Number(formData.electricity_water_cost  || 0) +
    Number(formData.repair_maintenance_cost || 0) +
    Number(formData.transport_cost          || 0) +
    Number(formData.miscellaneous_cost      || 0) +
    (Number(formData.skilled_workers_count    || 0) * Number(formData.skilled_workers_salary    || 0)) +
    (Number(formData.semi_skilled_workers_count || 0) * Number(formData.semi_skilled_workers_salary || 0)) +
    (Number(formData.wages_count            || 0) * Number(formData.wages_salary            || 0));
  const machineryTotal = (formData.plant_machinery || []).reduce(
    (s, m) => s + Number(m.unit_cost || m.cost || 0) * Number(m.quantity || 1), 0);
  const annualDep    = machineryTotal * 0.10 + Number(formData.shed_building_cost || 0) * 0.05;
  const annualCashAccruals = Math.max((monthlyRev - monthlyExp) * 12 + annualDep, 0);

  const options: SchemeOption[] = [];

  // ── helper to build a scheme with computed DSCR ───────────────────────────
  const makeScheme = (
    base: Omit<SchemeOption, 'dscrUnderScheme' | 'subsidyAmount'>,
    effectiveTermLoan: number,
    subsidyAmt: number,
  ): SchemeOption => ({
    ...base,
    // Prefer the fetched Rules & Rates benchmark over the caller's local
    // fallback literal — keeps this comparison table in sync with an
    // admin edit made via the Rules Admin UI without a code change.
    minDSCR: getSchemeRules(base.id)?.benchmarks?.dscr_avg ?? base.minDSCR,
    subsidyAmount: subsidyAmt,
    dscrUnderScheme: annualCashAccruals > 0 ? estimateDSCR(annualCashAccruals, effectiveTermLoan, tenureYrs, intRatePct) : 0,
  });

  // ── Mudra Shishu (≤ 50,000) ──────────────────────────────────────────────
  const shishuOk   = loanAmount <= 50000;
  const shishuLoan = projectCost * 0.90;
  options.push(makeScheme({
    id: 'mudra_shishu', name: 'Mudra Shishu',
    maxLoan: 50000, subsidy: 'None', subsidyPct: 0, tlPct: 0.90, minDSCR: 1.10,
    collateral: false, cmaRequired: false,
    score: shishuOk ? 70 : 20,
    pros: ['No collateral', 'No CMA needed', 'Fastest approval'],
    cons: ['Maximum Rs.50,000 only', 'No govt subsidy'],
    eligible: shishuOk,
    eligibilityReason: shishuOk ? undefined : 'Loan amount exceeds Rs.50,000 limit',
  }, shishuLoan, 0));

  // ── Mudra Kishor (50K - 5L) ───────────────────────────────────────────────
  const kishorOk   = loanAmount > 50000 && loanAmount <= 500000;
  const kishorLoan = projectCost * 0.90;
  options.push(makeScheme({
    id: 'mudra_kishor', name: 'Mudra Kishor',
    maxLoan: 500000, subsidy: 'None', subsidyPct: 0, tlPct: 0.90, minDSCR: 1.10,
    collateral: false, cmaRequired: true,
    score: kishorOk ? 75 : loanAmount <= 500000 ? 60 : 25,
    pros: ['No collateral required', 'Collateral-free up to Rs.5L', 'Light CMA documentation'],
    cons: ['No govt subsidy', 'CMA report needed'],
    eligible: kishorOk,
    eligibilityReason: kishorOk ? undefined : loanAmount <= 50000 ? 'Consider Shishu for smaller amounts' : 'Exceeds Rs.5L limit',
  }, kishorLoan, 0));

  // ── Mudra Tarun (5L - 10L) ────────────────────────────────────────────────
  const tarunOk   = loanAmount > 500000 && loanAmount <= 1000000;
  const tarunLoan = projectCost * 0.90;
  options.push(makeScheme({
    id: 'mudra_tarun', name: 'Mudra Tarun',
    maxLoan: 1000000, subsidy: 'None', subsidyPct: 0, tlPct: 0.90, minDSCR: 1.25,
    collateral: false, cmaRequired: true,
    score: tarunOk ? 72 : 20,
    pros: ['No collateral', 'Up to Rs.10L', 'Priority sector lending'],
    cons: ['No subsidy', 'Full CMA required'],
    eligible: tarunOk,
    eligibilityReason: tarunOk ? undefined : 'Loan must be Rs.5L–10L',
  }, tarunLoan, 0));

  // ── Mudra Tarun Plus (10L - 20L) ──────────────────────────────────────────
  const tarunPlusOk   = loanAmount > 1000000 && loanAmount <= 2000000;
  const tarunPlusLoan = projectCost * 0.90;
  options.push(makeScheme({
    id: 'mudra_tarunplus', name: 'Mudra Tarun Plus',
    maxLoan: 2000000, subsidy: 'None', subsidyPct: 0, tlPct: 0.90, minDSCR: 1.25,
    collateral: false, cmaRequired: true,
    score: tarunPlusOk ? 70 : 15,
    pros: ['No collateral', 'Up to Rs.20L'],
    cons: ['Requires previous Mudra Tarun repayment', 'No subsidy'],
    eligible: tarunPlusOk,
    eligibilityReason: tarunPlusOk ? undefined : 'Requires loan Rs.10L–20L and prior Mudra Tarun repayment',
  }, tarunPlusLoan, 0));

  // ── PMEGP ─────────────────────────────────────────────────────────────────
  const pmegpIndustryOk = ['manufacturing', 'service'].includes(industry);
  const pmegpMaxCost    = industry === 'manufacturing'
    ? (isSecond ? 10000000 : 5000000)
    : (isSecond ? 3000000 : 2000000);
  const pmegpCostOk   = projectCost >= 100000 && projectCost <= pmegpMaxCost;
  const pmegpOk       = pmegpIndustryOk && pmegpCostOk && isNew;
  const subsidyPctVal = pmegpSubsidyPct(category, area) / 100;
  const subsidyAmt    = Math.round(projectCost * subsidyPctVal);
  // PMEGP: term loan = 75% of project cost; subsidy is FREE (not repaid)
  const pmegpTermLoan = projectCost * 0.75;
  // DSCR-boosted score: subsidy reduces effective principal, improving DSCR
  const pmegpDSCR     = annualCashAccruals > 0 ? estimateDSCR(annualCashAccruals, pmegpTermLoan, tenureYrs, intRatePct) : 0;
  const pmegpScore    = pmegpOk
    ? Math.round(88 + (subsidyPctVal >= 0.25 ? 7 : 0) + (pmegpDSCR >= 1.5 ? 5 : 0))
    : 10;
  options.push(makeScheme({
    id: 'pmegp', name: 'PMEGP',
    maxLoan: pmegpMaxCost * 0.75,
    subsidy: `${Math.round(subsidyPctVal * 100)}% Margin Money`,
    subsidyPct: subsidyPctVal, tlPct: 0.75, minDSCR: 1.25,
    collateral: true, cmaRequired: true,
    score: pmegpScore,
    pros: [
      `${Math.round(subsidyPctVal * 100)}% govt subsidy — Rs.${subsidyAmt.toLocaleString('en-IN')} FREE (never repaid)`,
      'Reduces effective loan, boosting DSCR automatically',
      area === 'rural' ? 'Rural: extra 10% subsidy benefit' : 'Urban scheme available',
    ],
    cons: [
      'New businesses only (no existing business)',
      'Manufacturing & Service sectors only',
      'Subsidy locked as TDR for 3 years (available after repayment)',
    ],
    eligible: pmegpOk,
    eligibilityReason: pmegpOk ? undefined
      : !pmegpIndustryOk ? 'PMEGP: only Manufacturing & Service'
      : !isNew ? 'PMEGP: only for new businesses'
      : `Project cost must be ≤ Rs.${(pmegpMaxCost / 100000).toFixed(0)}L`,
  }, pmegpTermLoan, subsidyAmt));

  // ── CGTMSE ────────────────────────────────────────────────────────────────
  const cgtmseOk   = loanAmount >= 100000 && loanAmount <= 20000000;
  const cgtmseLoan = projectCost * 0.85;
  options.push(makeScheme({
    id: 'cgtmse', name: 'CGTMSE',
    maxLoan: 20000000, subsidy: 'Guarantee cover 75-85%', subsidyPct: 0, tlPct: 0.85, minDSCR: 1.25,
    collateral: false, cmaRequired: true,
    score: cgtmseOk ? 78 : 30,
    pros: ['Collateral-free up to Rs.2 Cr', 'All industry types', 'New & existing businesses'],
    cons: ['Annual guarantee fee (0.37–1.35%)', 'Full CMA report required'],
    eligible: cgtmseOk,
    eligibilityReason: cgtmseOk ? undefined : 'Loan must be Rs.1L–2Cr',
  }, cgtmseLoan, 0));

  // ── MSME PSU Bank ─────────────────────────────────────────────────────────
  const msmeOk   = loanAmount >= 100000;
  const msmeLoan = projectCost * 0.75;
  // Prefer the backend Rules & Rates engine's scorecard benchmark — the
  // local 1.25 fallback here matches core/engine.py's SCHEME_BENCHMARKS
  // (this used to say 1.50, disagreeing with the backend outright).
  const msmeMinDSCR = getSchemeRules('msme_psu')?.benchmarks?.dscr_avg ?? 1.25;
  options.push(makeScheme({
    id: 'msme_psu', name: 'MSME Bank Loan',
    maxLoan: 50000000, subsidy: 'None', subsidyPct: 0, tlPct: 0.75, minDSCR: msmeMinDSCR,
    collateral: true, cmaRequired: true,
    score: msmeOk ? 65 : 30,
    pros: ['All industries', 'New & existing businesses', 'Higher loan amounts'],
    cons: ['Collateral required', 'No subsidy', `Stricter DSCR (≥${msmeMinDSCR}) norms`],
    eligible: msmeOk,
    eligibilityReason: msmeOk ? undefined : 'Minimum Rs.1L loan amount',
  }, msmeLoan, 0));

  // ── Sort: eligible first, then by DSCR-weighted score ────────────────────
  const sorted = [...options].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    // DSCR-boost: if DSCR exceeds scheme minimum comfortably, score goes up
    const aDSCRBonus = a.dscrUnderScheme >= a.minDSCR * 1.2 ? 5 : 0;
    const bDSCRBonus = b.dscrUnderScheme >= b.minDSCR * 1.2 ? 5 : 0;
    return (b.score + bDSCRBonus) - (a.score + aDSCRBonus);
  });

  const best           = sorted.find((s) => s.eligible) ?? null;
  const selectedScheme = sorted.find((s) => s.id === selectedSchemeId) ?? null;
  const isSelectedOptimal = best?.id === selectedSchemeId;

  // ── Build switch benefit message ──────────────────────────────────────────
  let switchBenefit           = '';
  let subsidySavingsFromSwitch = 0;
  let dscrGainFromSwitch       = 0;

  if (!isSelectedOptimal && best && selectedScheme) {
    subsidySavingsFromSwitch = best.subsidyAmount - (selectedScheme?.subsidyAmount ?? 0);
    dscrGainFromSwitch       = best.dscrUnderScheme - (selectedScheme?.dscrUnderScheme ?? 0);

    if (best.id === 'pmegp' && subsidySavingsFromSwitch > 0) {
      switchBenefit =
        `Switching from ${selectedScheme?.name ?? 'current scheme'} to PMEGP gives you a FREE ` +
        `Rs.${subsidySavingsFromSwitch.toLocaleString('en-IN')} government subsidy (never repaid). ` +
        `This reduces your effective bank loan and improves DSCR` +
        (dscrGainFromSwitch > 0.05 ? ` by ~${dscrGainFromSwitch.toFixed(2)}x` : '') + '.';
    } else if (best.subsidyAmount === 0 && (selectedScheme?.subsidyAmount ?? 0) === 0) {
      switchBenefit =
        `${best.name} is better suited to your loan size (${best.name} max: Rs.${(best.maxLoan / 100000).toFixed(0)}L). ` +
        (dscrGainFromSwitch > 0.05 ? `DSCR improves by ${dscrGainFromSwitch.toFixed(2)}x under ${best.name}.` : '');
    } else {
      switchBenefit = `${best.name} offers better terms than ${selectedScheme?.name ?? 'your current scheme'} for your project profile.`;
    }
  }

  // ── Summary text ─────────────────────────────────────────────────────────
  const subsidyPctDisplay = Math.round(subsidyPctVal * 100);
  let summary = '';
  if (best) {
    if (best.id === 'pmegp') {
      summary = `PMEGP is your best option — Rs.${subsidyAmt.toLocaleString('en-IN')} (${subsidyPctDisplay}%) is FREE government money. This reduces your loan and improves DSCR automatically.`;
    } else if (best.id === 'mudra_shishu') {
      summary = 'Mudra Shishu is ideal for your loan size — no CMA, no collateral, fastest approval.';
    } else if (best.id === 'mudra_kishor') {
      summary = 'Mudra Kishor suits your loan amount — collateral-free with minimal documentation.';
    } else if (best.id === 'cgtmse') {
      summary = 'CGTMSE gives you a government-backed guarantee — no collateral needed up to Rs.2 Cr.';
    } else {
      summary = `${best.name} is the recommended scheme based on your project profile and loan amount.`;
    }
  } else {
    summary = 'No scheme currently matches — review your project cost and industry type.';
  }

  return {
    best,
    all: sorted,
    summary,
    selectedSchemeId,
    selectedScheme,
    isSelectedOptimal,
    switchBenefit,
    subsidySavingsFromSwitch,
    dscrGainFromSwitch,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SMART FIELD BENCHMARKS (industry-typical value ranges)
// ─────────────────────────────────────────────────────────────────────────────

export function getFieldBenchmarks(
  industry: string,
  loanAmount: number,
): FieldBenchmark[] {
  const ind = industry?.toLowerCase() || 'manufacturing';
  const scale = loanAmount <= 500000 ? 'micro' : loanAmount <= 2500000 ? 'small' : 'medium';

  const benchmarks: Record<string, FieldBenchmark[]> = {
    manufacturing: [
      { field: 'rent', label: 'Monthly Rent / Shed', typical: 'Rs.5,000–20,000', low: scale === 'micro' ? 3000 : 8000, high: scale === 'micro' ? 10000 : 25000, unit: '₹/month', tip: 'Manufacturing needs a larger space — factor in shed/godown cost.' },
      { field: 'electricity', label: 'Electricity / Power', typical: 'Rs.3,000–15,000', low: 2000, high: 20000, unit: '₹/month', tip: 'Machinery-heavy units need 3-phase power — check load factor.' },
      { field: 'raw_materials', label: 'Raw Material Cost', typical: '40–60% of revenue', low: 0, high: 0, unit: '% of revenue', tip: 'Keep RM cost below 60% of monthly revenue to maintain a healthy margin.' },
      { field: 'skilled_salary', label: 'Skilled Worker Salary', typical: 'Rs.12,000–22,000/month', low: 12000, high: 22000, unit: '₹/month per worker', tip: 'SBI benchmarks skilled wages in MSME at Rs.12,000–22,000 per month.' },
      { field: 'unskilled_salary', label: 'Unskilled Labour', typical: 'Rs.8,000–14,000/month', low: 8000, high: 14000, unit: '₹/month per worker', tip: 'Align with state minimum wage to avoid labour law issues.' },
      { field: 'marketing', label: 'Marketing Expense', typical: 'Rs.2,000–8,000/month', low: 1500, high: 10000, unit: '₹/month', tip: 'Banks accept 1–3% of turnover as marketing — higher needs justification.' },
      { field: 'repair', label: 'Repair & Maintenance', typical: 'Rs.1,000–5,000/month', low: 1000, high: 6000, unit: '₹/month', tip: 'Typically 1–2% of machinery cost per year.' },
    ],
    service: [
      { field: 'rent', label: 'Office / Shop Rent', typical: 'Rs.3,000–15,000', low: scale === 'micro' ? 2000 : 5000, high: scale === 'micro' ? 8000 : 18000, unit: '₹/month', tip: 'Service businesses can often start from home to reduce costs.' },
      { field: 'electricity', label: 'Electricity / Internet', typical: 'Rs.800–3,000', low: 500, high: 4000, unit: '₹/month', tip: 'Service businesses typically have lower power costs than manufacturing.' },
      { field: 'skilled_salary', label: 'Staff Salary', typical: 'Rs.10,000–25,000/month', low: 10000, high: 30000, unit: '₹/month per staff', tip: 'Staff salary for service is 40–65% of revenue — monitor this ratio.' },
      { field: 'marketing', label: 'Marketing / Digital', typical: 'Rs.2,000–10,000/month', low: 1500, high: 12000, unit: '₹/month', tip: 'Digital marketing (Google/social) is effective for service businesses.' },
      { field: 'telephone', label: 'Telephone / Internet', typical: 'Rs.500–2,000/month', low: 500, high: 3000, unit: '₹/month', tip: 'Include business broadband and mobile data costs.' },
    ],
    trading: [
      { field: 'rent', label: 'Shop / Godown Rent', typical: 'Rs.5,000–25,000', low: scale === 'micro' ? 4000 : 8000, high: scale === 'micro' ? 12000 : 30000, unit: '₹/month', tip: 'Location matters most for trading — high-traffic location justifies higher rent.' },
      { field: 'raw_materials', label: 'Purchase / COGS', typical: '70–85% of revenue', low: 0, high: 0, unit: '% of revenue', tip: 'Trading margin is typically 15–30%. Ensure purchase cost stays ≤ 85% of sales.' },
      { field: 'electricity', label: 'Electricity / Utilities', typical: 'Rs.1,500–6,000', low: 1000, high: 8000, unit: '₹/month', tip: 'Cold storage or heavy equipment will increase this significantly.' },
      { field: 'transport', label: 'Transport / Conveyance', typical: 'Rs.2,000–10,000', low: 1500, high: 15000, unit: '₹/month', tip: 'Include delivery costs to customers and procurement trips.' },
      { field: 'marketing', label: 'Marketing', typical: 'Rs.1,000–5,000/month', low: 1000, high: 7000, unit: '₹/month', tip: 'Banks accept ≤2% of trading turnover as marketing expense.' },
    ],
    agriculture: [
      { field: 'rent', label: 'Land Rent / Lease', typical: 'Rs.2,000–8,000/month', low: 1500, high: 10000, unit: '₹/month', tip: 'Land lease is often seasonal — mention seasonal cycle in Step 9.' },
      { field: 'electricity', label: 'Irrigation / Power', typical: 'Rs.1,000–5,000', low: 800, high: 6000, unit: '₹/month', tip: 'Drip irrigation reduces this by 30-40% vs flood irrigation.' },
      { field: 'raw_materials', label: 'Seeds / Fertilizer / Input', typical: '30–50% of revenue', low: 0, high: 0, unit: '% of revenue', tip: 'Input costs in agriculture are seasonal — average across 12 months.' },
      { field: 'skilled_salary', label: 'Labour Cost', typical: 'Rs.300–500/day per labourer', low: 300, high: 600, unit: '₹/day', tip: 'Match prevailing local agricultural wage rates for credibility.' },
      { field: 'transport', label: 'Transport to Mandi', typical: 'Rs.1,000–4,000/month', low: 800, high: 5000, unit: '₹/month', tip: 'Include transport to APMC mandi or collection centre.' },
    ],
  };

  return benchmarks[ind] ?? benchmarks['manufacturing'];
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. VIABILITY PREDICTOR
// ─────────────────────────────────────────────────────────────────────────────

export function predictViability(formData: GTABFormData): ViabilityPrediction {
  const industry = (formData.industry_type || 'manufacturing').toLowerCase();
  // Scheme-specific DSCR benchmark (Mudra Shishu/Kishor genuinely need only
  // 1.10, not the full-CMA 1.25) — prefer the fetched Rules & Rates value.
  const dscrBenchmark = getSchemeRules(formData.loan_scheme)?.benchmarks?.dscr_avg ?? 1.25;

  // ── Revenue ──────────────────────────────────────────────────────────────
  const cats = formData.project_report_inputs?.revenue?.product_categories ?? [];
  let monthlyRevenue = Number(formData.expected_monthly_revenue || 0);
  if (cats.length > 0) {
    const fromCats = cats.reduce((s, c) => {
      const fixed = Number(c.fixed_revenue || 0);
      const qty   = Number(c.units_monthly || c.quantity_sold || 0);
      const price = Number(c.avg_price || c.selling_price || 0);
      return s + (fixed || qty * price);
    }, 0);
    if (fromCats > 0) monthlyRevenue = fromCats;
  }

  // ── Monthly Expenses ──────────────────────────────────────────────────────
  const monthlyExpenses =
    Number(formData.raw_material_cost          || 0) +
    Number(formData.monthly_rent               || 0) +
    Number(formData.electricity_water_cost     || 0) +
    Number(formData.repair_maintenance_cost    || 0) +
    Number(formData.transport_cost             || 0) +
    Number(formData.telephone_internet_cost    || 0) +
    Number(formData.marketing_cost             || 0) +
    Number(formData.miscellaneous_cost         || 0) +
    Number(formData.stationery_cost            || 0);

  // ── Monthly Salary ────────────────────────────────────────────────────────
  const monthlySalary =
    (Number(formData.skilled_workers_count    || 0) * Number(formData.skilled_workers_salary    || 0)) +
    (Number(formData.semi_skilled_workers_count || 0) * Number(formData.semi_skilled_workers_salary || 0)) +
    (Number(formData.wages_count              || 0) * Number(formData.wages_salary              || 0));

  const totalMonthlyExpenses = monthlyExpenses + monthlySalary;

  // ── Financing ─────────────────────────────────────────────────────────────
  const financing   = getFinancingPlan(formData);
  const loanAmount  = financing.totalBankFinance;
  const ri               = formData.project_report_inputs;
  const interestRatePct  = Number(ri?.loan?.interest_rate_pct || 9.5);
  const tenureMonths     = Number(ri?.loan?.tenure_months || 60);
  const moratoriumMonths = Number(ri?.loan?.moratorium_months || 0);

  // Year-1 interest/principal from the same half-yearly equal-principal,
  // reducing-balance schedule the backend actually amortises with (not a
  // flat-interest EMI approximation).
  const { interestPaid: annualInterest, principalPaid: annualPrincipal } =
    getYear1LoanFigures(loanAmount, interestRatePct, tenureMonths, moratoriumMonths);
  const annualDebtService = annualInterest + annualPrincipal;
  const monthlyEMI         = annualDebtService / 12;

  // ── DSCR estimate ─────────────────────────────────────────────────────────
  const annualRevenue  = monthlyRevenue * 12;
  const annualExpenses = totalMonthlyExpenses * 12;
  // Rough depreciation: 10% of plant & machinery
  const machineryTotal = (formData.plant_machinery || []).reduce(
    (s, m) => s + Number(m.unit_cost || m.cost || 0) * Number(m.quantity || 1), 0
  );
  const annualDepreciation = machineryTotal * 0.10;
  const cashAccruals = Math.max(annualRevenue - annualExpenses - annualDepreciation * 0, 0);
  const dscrEstimate  = calculateDscr(cashAccruals, annualInterest, annualPrincipal);

  // ── Gross margin ──────────────────────────────────────────────────────────
  const cogs         = Number(formData.raw_material_cost || 0) * 12;
  const grossProfit  = annualRevenue - cogs;
  const grossMarginPct = annualRevenue > 0 ? (grossProfit / annualRevenue) * 100 : 0;

  // ── Monthly profit ────────────────────────────────────────────────────────
  const monthlyProfit = monthlyRevenue - totalMonthlyExpenses - monthlyEMI;

  // ── Issues ────────────────────────────────────────────────────────────────
  const issues: ViabilityIssue[] = [];
  const strengths: string[] = [];

  if (monthlyRevenue === 0) {
    issues.push({ severity: 'error', label: 'Revenue is zero', detail: 'No revenue entered — bank cannot evaluate viability.', fix: 'Fill expected monthly revenue in Step 4 or add product categories in Step 9.' });
  } else {
    strengths.push(`Monthly revenue: Rs.${monthlyRevenue.toLocaleString('en-IN')}`);
  }

  if (dscrEstimate > 0 && dscrEstimate < 1.0) {
    issues.push({ severity: 'error', label: `DSCR ${dscrEstimate.toFixed(2)}x (min 1.0)`, detail: 'Cash flow insufficient to cover loan repayment.', fix: 'Increase revenue, reduce loan amount, or extend tenure to 7 years.' });
  } else if (dscrEstimate >= 1.0 && dscrEstimate < dscrBenchmark) {
    issues.push({ severity: 'warning', label: `DSCR ${dscrEstimate.toFixed(2)}x (needs ${dscrBenchmark}+)`, detail: 'Marginal debt coverage — bank will scrutinize.', fix: 'Consider increasing revenue projections or reducing expenses.' });
  } else if (dscrEstimate >= dscrBenchmark) {
    strengths.push(`DSCR ${dscrEstimate.toFixed(2)}x — meets bank minimum`);
  }

  if (grossMarginPct > 0 && grossMarginPct < 15 && industry !== 'trading') {
    issues.push({ severity: 'warning', label: `Gross margin ${grossMarginPct.toFixed(0)}%`, detail: 'Low margin — bank may question sustainability.', fix: 'Reduce raw material cost or increase selling price.' });
  } else if (grossMarginPct >= 20) {
    strengths.push(`Healthy gross margin ${grossMarginPct.toFixed(0)}%`);
  }

  if (industry === 'trading' && grossMarginPct > 80) {
    issues.push({ severity: 'warning', label: `Trading margin ${grossMarginPct.toFixed(0)}% (unusually high)`, detail: 'Banks may query margins above 50% for trading.', fix: 'Verify purchase price vs selling price in product lines.' });
  }

  if (monthlySalary === 0 && (Number(formData.skilled_workers_count) + Number(formData.semi_skilled_workers_count) + Number(formData.wages_count)) > 0) {
    issues.push({ severity: 'error', label: 'Employees with zero salary', detail: 'Staff count entered but no salary amount provided.', fix: 'Add monthly salary in Step 7 for each worker category.' });
  }

  if (monthlyRevenue > 0 && totalMonthlyExpenses > 0 && totalMonthlyExpenses > monthlyRevenue * 1.2) {
    issues.push({ severity: 'error', label: 'Expenses exceed revenue by >20%', detail: 'Business will operate at a loss from day one.', fix: 'Review and reduce expenses, or increase revenue projections.' });
  }

  if (financing.totalProjectCost > 0 && loanAmount === 0) {
    issues.push({ severity: 'warning', label: 'No loan amount', detail: 'Project cost entered but loan amount is zero.', fix: 'Check financing details in Step 3 or Project Report Inputs (Step 9).' });
  }

  if ((formData.plant_machinery?.length ?? 0) === 0 && industry === 'manufacturing') {
    issues.push({ severity: 'warning', label: 'No machinery listed', detail: 'Manufacturing project with no machinery — required for CMA.', fix: 'Add plant & machinery items in Step 5.' });
  }

  if (strengths.length === 0 && issues.filter(i => i.severity === 'error').length === 0) {
    strengths.push('Basic financial data entered');
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  let score = 60;
  if (monthlyRevenue > 0) score += 10;
  if (dscrEstimate >= dscrBenchmark + 0.25) score += 20;
  else if (dscrEstimate >= dscrBenchmark) score += 12;
  else if (dscrEstimate >= 1.0) score += 5;
  else if (dscrEstimate > 0) score -= 20;
  if (grossMarginPct >= 20) score += 10;
  else if (grossMarginPct >= 10) score += 5;
  else if (grossMarginPct > 0 && grossMarginPct < 5) score -= 10;
  score -= issues.filter(i => i.severity === 'error').length * 12;
  score -= issues.filter(i => i.severity === 'warning').length * 4;
  score = Math.max(0, Math.min(100, score));

  const band: ViabilityPrediction['band'] =
    score >= 80 ? 'strong' :
    score >= 65 ? 'good' :
    score >= 45 ? 'review' : 'weak';

  const recommendation =
    band === 'strong' ? 'Strong profile — ready to generate report.' :
    band === 'good'   ? 'Good profile — minor improvements will strengthen the application.' :
    band === 'review' ? 'Needs attention — fix the flagged issues before submission.' :
                        'Weak profile — address critical errors before generating the report.';

  return { score, band, dscrEstimate, grossMarginPct, monthlyProfit, recommendation, issues, strengths };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. BUSINESS PLAN DRAFT GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

export function generateBusinessPlanDraft(formData: GTABFormData): string {
  const name     = [formData.first_name, formData.last_name].filter(Boolean).join(' ') || 'The Applicant';
  const biz      = formData.business_entity_name || 'the proposed enterprise';
  const city     = formData.city || 'the proposed location';
  const state    = formData.state || 'India';
  const industry = (formData.industry_type || 'manufacturing').toLowerCase();
  const products = formData.products_services || '';
  const scheme   = formData.loan_scheme || 'MSME';
  const dscrNorm = getSchemeRules(scheme)?.benchmarks?.dscr_avg ?? 1.25;
  const financing = getFinancingPlan(formData);
  const loanAmt  = financing.totalBankFinance;
  const cats     = formData.project_report_inputs?.revenue?.product_categories ?? [];
  const productList = cats.map(c => c.category).filter(Boolean).join(', ');
  const loanFmt  = `Rs.${(loanAmt / 100000).toFixed(1)} Lakh`;
  const savedCapacitySchedule = formData.project_report_inputs?.dpr;
  const savedCapacityValues = [
    savedCapacitySchedule?.capacity_y1_pct,
    savedCapacitySchedule?.capacity_y2_pct,
    savedCapacitySchedule?.capacity_y3_pct,
    savedCapacitySchedule?.capacity_y4_pct,
    savedCapacitySchedule?.capacity_y5_pct,
  ];
  const capacitySchedule = CAPACITY_SCHEDULE.map((defaultCapacity, index) =>
    Number(savedCapacityValues[index]) || defaultCapacity,
  );
  const capacityScheduleText = capacitySchedule
    .map((capacity, index) => `${capacity}% in Year ${index + 1}`)
    .join(', ');

  const templates: Record<string, string> = {
    manufacturing: `
**Introduction**
${biz} is a proposed manufacturing enterprise to be established by ${name} at ${city}, ${state}. The unit seeks a term loan of ${loanFmt} under the ${scheme.toUpperCase()} scheme to finance plant, machinery, and working capital requirements.

**Business Overview**
The enterprise will be engaged in the manufacture of ${productList || products || 'products as specified in the project report'}. The production process utilises modern machinery with adequate capacity to meet current and projected demand in the target market. The promoter brings relevant technical and managerial expertise to ensure smooth operations from day one.

**Market Opportunity**
The ${industry} sector in ${state} is witnessing sustained growth driven by domestic consumption and government initiatives under the MSME Development Act. The enterprise is well-positioned to cater to local and regional demand with competitive pricing and quality assurance.

**Financial Viability**
The project has been appraised on a five-year horizon. Revenue projections use the capacity schedule: ${capacityScheduleText}. The DSCR exceeds the minimum benchmark of ${dscrNorm} applicable to the ${scheme.toUpperCase()} scheme, confirming adequate cash flow for loan servicing. The break-even point is achievable within the first operational year.

**Promoter Background**
${name} is a qualified and experienced promoter with a sound understanding of the ${industry} sector. The enterprise will create direct employment for skilled and semi-skilled workers, contributing to local economic development.
    `.trim(),

    service: `
**Introduction**
${biz} is a proposed service enterprise to be promoted by ${name} at ${city}, ${state}. A loan of ${loanFmt} is sought under the ${scheme.toUpperCase()} scheme to meet setup costs and initial working capital requirements.

**Business Overview**
The enterprise will render professional services in ${productList || products || 'the service domain described in the project report'}. Service delivery will be carried out from a dedicated office / premises with trained staff. The business model is designed for repeat clientele and steady monthly revenue.

**Market Potential**
The service sector in ${city} presents a growing demand driven by urbanisation, digital adoption, and evolving consumer preferences. The enterprise targets ${cats.length > 0 ? 'multiple service lines as detailed in the revenue schedule' : 'a clearly defined customer segment'}, enabling consistent revenue from the first month of operations.

**Financial Summary**
The five-year financial projections demonstrate a healthy gross margin and positive cash flow from Year 1. Loan repayment is fully covered by projected cash accruals, with a DSCR above the ${dscrNorm} norm applicable to the selected scheme.

**Promoter Profile**
${name} has the requisite professional background to manage and grow the enterprise. The venture will contribute to local employment and skill development in the service sector.
    `.trim(),

    trading: `
**Introduction**
${biz} is a proposed trading enterprise to be set up by ${name} at ${city}, ${state}. A working capital and term loan of ${loanFmt} is applied for under the ${scheme.toUpperCase()} scheme to finance inventory procurement and business setup.

**Business Description**
The enterprise will trade in ${productList || products || 'goods as specified in the project report'}. The business will source products from established suppliers and distribute to retail customers, wholesale buyers, or both. Margins are derived from the spread between purchase price and selling price.

**Market Analysis**
${city} and the surrounding region present a ready market for the proposed product categories. The trading business benefits from low entry barriers, established supply chains, and growing consumer spending in the ${state} market.

**Financial Projections**
Revenue projections are built on conservatively estimated monthly sales volumes and prevailing market prices. The gross margin is maintained within the industry benchmark of 15–30%. Working capital requirements have been calculated using the Tandon Committee Method, and the DSCR comfortably covers loan obligations.

**Promoter Details**
${name} has the commercial acumen and market contacts to successfully operate this trading enterprise. The business will generate direct employment and contribute to local trade ecosystem.
    `.trim(),

    agriculture: `
**Introduction**
${biz} is an agriculture-based enterprise proposed by ${name} at ${city}, ${state}. A project loan of ${loanFmt} is being sought under the ${scheme.toUpperCase()} scheme to finance farm infrastructure, equipment, and seasonal working capital.

**Project Description**
The project involves ${productList || products || 'agricultural activities as described in the project report'}. The enterprise leverages available land, seasonal cycles, and modern farming practices to optimise yield and marketable output.

**Market & Revenue**
Produce will be sold through local mandis, direct buyers, or agri-processing units, as applicable. Revenue projections are based on prevailing market prices and conservative yield estimates. Capacity is scheduled to ramp from 80% in Year 1 to 100% by Year 3.

**Financial Viability**
The project generates positive net surplus from Year 1. Loan repayment is structured to align with harvest and revenue cycles. DSCR and other financial indicators meet the benchmarks prescribed for the selected scheme.

**Promoter Background**
${name} has practical experience in agriculture and related activities, ensuring sound technical management of the project. The enterprise supports local food security and rural livelihoods.
    `.trim(),
  };

  return templates[industry] ?? templates['manufacturing'];
}
