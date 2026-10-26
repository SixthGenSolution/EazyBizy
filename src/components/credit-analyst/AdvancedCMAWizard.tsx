import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  ChevronRight,
  ChevronLeft,
  Save,
  Plus,
  Trash2,
  TrendingUp,
  Settings,
  History,
  PieChart,
  Percent,
  Building2,
  AlertCircle,
  User,
  Briefcase,
  IndianRupee,
  Factory,
  Users,
  Wallet,
  ShieldCheck,
  Zap,
  Info,
  BookOpen,
  Calculator as CalcIcon,
  BarChart3,
  Target,
  FileCheck,
  Award,
  TrendingDown,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Lightbulb,
  ChevronDown,
  Lock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { CMAFormData, INITIAL_CMA_DATA } from "@/types/cma";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { validateReport, type ValidationResult } from "@/lib/cmaValidator";

// Indian-format currency helper, shared across all wizard steps.
const fmt = (n: number) => n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : `₹${Math.round(n).toLocaleString('en-IN')}`;

// Map free-text values from the source loan application onto the wizard's
// canonical enums, so the Select prefills instead of showing blank (and the
// backend/report never receives an off-enum constitution/activity string).
const normalizeConstitution = (v?: string): CMAFormData['business']['constitution'] => {
  const s = (v || '').toLowerCase();
  if (s.includes('llp') || s.includes('liability partnership')) return 'LLP';
  if (s.includes('partner')) return 'Partnership';
  if (s.includes('pvt') || s.includes('private') || s.includes('limited') || s.includes('company') || s.includes('ltd')) return 'Pvt Ltd';
  return 'Proprietorship';
};
const normalizeActivity = (v?: string): CMAFormData['business']['activity'] => {
  const s = (v || '').toLowerCase();
  if (s.includes('trad') || s.includes('retail') || s.includes('wholesale') || s.includes('distribut')) return 'Trading';
  if (s.includes('serv')) return 'Service';
  return 'Manufacturing';
};

interface AdvancedCMAWizardProps {
  isOpen: boolean;
  onClose: () => void;
  applicationId: string;
  initialData?: Partial<CMAFormData>;
  // Public demo: pre-filled sample, watermarked PDF, Excel/CSV admin-only.
  demoMode?: boolean;
}

const steps = [
  { id: 'applicant',    title: 'Applicant Profile',     icon: User },
  { id: 'business',     title: 'Business Profile',      icon: Briefcase },
  { id: 'loan',         title: 'Loan Requirement',      icon: IndianRupee },
  { id: 'cost',         title: 'Project Cost',          icon: Factory },
  { id: 'finance',      title: 'Means of Finance',      icon: Wallet },
  { id: 'historical',   title: 'Historical Financials', icon: History },
  { id: 'products',     title: 'Revenue Model',         icon: TrendingUp },
  { id: 'manpower',     title: 'Manpower',              icon: Users },
  { id: 'opex',         title: 'Operating Expenses',    icon: Zap },
  { id: 'wc_norms',     title: 'WC Norms',              icon: PieChart },
  { id: 'depreciation', title: 'Depreciation',          icon: Settings },
  { id: 'net_worth',    title: 'Promoter Net Worth',    icon: Wallet },
  { id: 'guarantor',    title: 'Guarantor',             icon: ShieldCheck },
  { id: 'collateral',   title: 'Collateral & Security', icon: FileCheck },
  { id: 'assumptions',  title: 'Assumptions & Projections', icon: BarChart3 },
  { id: 'scorecard',    title: 'CA Scorecard',          icon: Award },
];

const INDIAN_BANKS = [
    "State Bank of India",
    "HDFC Bank",
    "ICICI Bank",
    "Punjab National Bank",
    "Bank of Baroda",
    "Axis Bank",
    "Canara Bank",
    "Union Bank of India",
    "IDBI Bank",
    "IndusInd Bank",
    "Kotak Mahindra Bank",
    "Bank of India",
    "Central Bank of India",
    "Indian Overseas Bank",
    "UCO Bank",
    "Yes Bank",
    "Federal Bank",
    "South Indian Bank",
    "Karnataka Bank",
    "Other Scheduled Bank"
];

// ─── Live metrics computed from form data ────────────────────────────────────
interface LiveMetrics {
  totalProjectCost: number;
  mofTotal: number;
  mofBalance: number;
  monthlyRevenue: number;
  monthlyPayroll: number;
  monthlyOpex: number;
  monthlyRM: number;
  monthlySurplus: number;
  annualRevenue: number;
  ebitda: number;
  estimatedDSCR: number;
  deRatio: number;
  promoterPct: number;
  netWorth: number;
  termLoan: number;
  wcLoan: number;
}

function computeLiveMetrics(formData: CMAFormData): LiveMetrics {
  const pc = formData.project_cost;
  const mof = formData.means_of_finance;
  const totalProjectCost = Object.values(pc).reduce((a, b) => a + (b as number), 0);
  const mofTotal = (mof.promoter_contribution || 0) + (mof.unsecured_loans || 0) + (mof.subsidy || 0) + (mof.term_loan || 0) + (mof.other_funding || 0);
  const mofBalance = mofTotal - totalProjectCost;

  const monthlyRevenue = formData.products.reduce((a, p) => a + p.selling_price * p.monthly_qty, 0);
  const monthlyPayroll = formData.manpower.reduce((a, m) => a + m.monthly_salary * m.headcount, 0);
  const monthlyOpex = Object.values(formData.opex).reduce((a, b) => a + (b as number), 0);
  const monthlyRM = formData.products.reduce((a, p) => a + p.purchase_cost * p.monthly_qty, 0);

  const annualDepr =
    (pc.building * ((formData.depreciation_rates.building || 5) / 100)) +
    (pc.plant_machinery * ((formData.depreciation_rates.plant_machinery || 10) / 100)) +
    (pc.furniture * ((formData.depreciation_rates.furniture || 10) / 100)) +
    (pc.computers * ((formData.depreciation_rates.computers || 40) / 100)) +
    (pc.vehicles * ((formData.depreciation_rates.vehicles || 15) / 100));

  const r = formData.loan.interest_rate / 100 / 12;
  const n = formData.loan.tenure_months || 1;
  const monthlyEMI = mof.term_loan > 0 && r > 0
    ? mof.term_loan * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
    : mof.term_loan > 0 ? mof.term_loan / n : 0;

  const monthlyCosts = monthlyRM + monthlyPayroll + monthlyOpex + (annualDepr / 12) + monthlyEMI;
  const monthlySurplus = monthlyRevenue - monthlyCosts;
  const annualRevenue = monthlyRevenue * 12;
  const annualOpCosts = (monthlyRM + monthlyPayroll + monthlyOpex) * 12 + annualDepr;
  const annualInterest = mof.term_loan * (formData.loan.interest_rate / 100);
  const ebitda = annualRevenue - annualOpCosts;
  const annualInstallment = monthlyEMI * 12;
  const estimatedDSCR =
    (annualInstallment + annualInterest) > 0
      ? (ebitda + annualDepr) / (annualInstallment + annualInterest)
      : 0;

  const deRatio = mof.promoter_contribution > 0 ? mof.term_loan / mof.promoter_contribution : 0;
  const promoterPct = totalProjectCost > 0 ? (mof.promoter_contribution / totalProjectCost) * 100 : 0;
  const netWorth = Object.entries(formData.promoter_net_worth).reduce(
    (a, [k, v]) => k === 'liabilities' ? a - (v as number) : a + (v as number), 0
  );

  return {
    totalProjectCost, mofTotal, mofBalance, monthlyRevenue, monthlyPayroll,
    monthlyOpex, monthlyRM, monthlySurplus, annualRevenue, ebitda,
    estimatedDSCR: Math.max(0, estimatedDSCR), deRatio, promoterPct, netWorth,
    termLoan: mof.term_loan, wcLoan: mof.working_capital_loan || 0,
  };
}

interface Insight { level: 'good' | 'warn' | 'error' | 'info'; text: string; }

function getStepInsights(stepId: string, m: LiveMetrics, fd: CMAFormData): Insight[] {
  const out: Insight[] = [];
  switch (stepId) {
    case 'applicant':
      if (!fd.applicant.pan) out.push({ level: 'warn', text: 'PAN not entered — required for credit assessment.' });
      if (!fd.applicant.aadhaar) out.push({ level: 'warn', text: 'Aadhaar not entered — required for KYC compliance.' });
      if (fd.applicant.experience_years < 2) out.push({ level: 'warn', text: 'Less than 2 years experience — bank may question promoter capability.' });
      if (fd.applicant.experience_years >= 5) out.push({ level: 'good', text: `${fd.applicant.experience_years} years experience — strong promoter profile.` });
      break;
    case 'business':
      if (!fd.business.udyam_registration) out.push({ level: 'info', text: 'Udyam registration not filled — recommended for MSME scheme benefits.' });
      if (!fd.business.gst_number && fd.business.constitution !== 'Proprietorship') out.push({ level: 'warn', text: 'GST number absent — may be required for larger loans.' });
      break;
    case 'loan':
      if (fd.loan.interest_rate < 7) out.push({ level: 'warn', text: 'Interest rate below 7% — verify with bank; likely MCLR-linked rate.' });
      if (fd.loan.interest_rate > 16) out.push({ level: 'warn', text: 'Interest rate above 16% — check if this is correct; will impact DSCR.' });
      if (fd.loan.tenure_months < 36) out.push({ level: 'info', text: 'Short tenure increases EMI burden. Standard MSME tenure: 60–84 months.' });
      if (fd.loan.moratorium_months > 0) out.push({ level: 'good', text: `${fd.loan.moratorium_months}-month moratorium reduces early cashflow pressure.` });
      if (!fd.loan.preferred_bank) out.push({ level: 'info', text: 'No bank selected — select to match scheme eligibility (SBI for PMEGP, etc.).' });
      break;
    case 'cost':
      if (m.totalProjectCost === 0) out.push({ level: 'error', text: 'Project cost is zero — fill in all capital expenditure items.' });
      if (m.totalProjectCost > 0 && m.totalProjectCost < 50000) out.push({ level: 'warn', text: 'Very low project cost. Verify all items are included.' });
      if (fd.project_cost.plant_machinery === 0 && fd.business.activity === 'Manufacturing') out.push({ level: 'warn', text: 'Manufacturing activity but no plant & machinery cost — review.' });
      if (fd.project_cost.contingency === 0 && m.totalProjectCost > 200000) out.push({ level: 'info', text: 'Consider adding 3–5% contingency on project cost.' });
      break;
    case 'finance':
      if (Math.abs(m.mofBalance) > 1) out.push({ level: 'error', text: `MoF gap of ₹${Math.abs(m.mofBalance).toLocaleString('en-IN')} — sources must exactly equal project cost.` });
      else out.push({ level: 'good', text: 'Means of Finance is balanced.' });
      if (m.deRatio > 3) out.push({ level: 'error', text: `D:E ratio ${m.deRatio.toFixed(1)}:1 — most banks cap at 3:1 for MSME loans.` });
      else if (m.deRatio > 2) out.push({ level: 'warn', text: `D:E ratio ${m.deRatio.toFixed(1)}:1 — moderate leverage; acceptable but monitor.` });
      else if (m.deRatio > 0) out.push({ level: 'good', text: `D:E ratio ${m.deRatio.toFixed(1)}:1 — within comfortable range.` });
      if (m.promoterPct < 10) out.push({ level: 'error', text: `Promoter contribution ${m.promoterPct.toFixed(1)}% — minimum 10% required by most schemes.` });
      else if (m.promoterPct < 15) out.push({ level: 'warn', text: `Promoter contribution ${m.promoterPct.toFixed(1)}% — borderline; consider increasing to 15%+.` });
      break;
    case 'historical':
      if (fd.historical_financials.length === 0) out.push({ level: 'info', text: 'No historical data — acceptable for new businesses; add 2–3 years for existing firms.' });
      if (fd.historical_financials.length > 0) {
        const lastYear = fd.historical_financials[fd.historical_financials.length - 1];
        if (lastYear.pat < 0) out.push({ level: 'warn', text: 'Last year shows a net loss — bank will scrutinise repayment capacity.' });
        if (lastYear.net_worth > 0 && lastYear.net_worth < m.termLoan * 0.3) out.push({ level: 'warn', text: 'Net worth is less than 30% of loan amount — may need collateral support.' });
      }
      break;
    case 'products':
      if (fd.products.length === 0) out.push({ level: 'error', text: 'No products/services added — revenue model is required for CMA projections.' });
      if (m.monthlyRevenue === 0 && fd.products.length > 0) out.push({ level: 'warn', text: 'Revenue is zero — check selling price and monthly quantities.' });
      if (m.monthlyRevenue > 0 && m.monthlyRM / m.monthlyRevenue > 0.75) out.push({ level: 'warn', text: `COGS is ${((m.monthlyRM / m.monthlyRevenue) * 100).toFixed(0)}% of revenue — very thin margins.` });
      if (m.annualRevenue > 0 && m.termLoan > 0 && m.annualRevenue < m.termLoan * 0.5) out.push({ level: 'warn', text: 'Annual revenue less than 50% of loan amount — repayment risk.' });
      if (m.monthlyRevenue > 0) out.push({ level: 'info', text: `Projected annual revenue: ₹${(m.annualRevenue / 100000).toFixed(1)} Lakhs at 100% capacity.` });
      break;
    case 'manpower':
      if (fd.manpower.length === 0) out.push({ level: 'info', text: 'No manpower added — add at least one salary entry for accurate cost projections.' });
      if (m.monthlyPayroll > 0 && m.monthlyRevenue > 0 && m.monthlyPayroll / m.monthlyRevenue > 0.4) out.push({ level: 'warn', text: `Payroll is ${((m.monthlyPayroll / m.monthlyRevenue) * 100).toFixed(0)}% of revenue — high labour intensity.` });
      if (m.monthlyPayroll > 0) out.push({ level: 'info', text: `Monthly payroll: ₹${m.monthlyPayroll.toLocaleString('en-IN')} | Annual: ₹${(m.monthlyPayroll * 12 / 100000).toFixed(1)}L` });
      break;
    case 'opex':
      if (m.monthlyOpex === 0) out.push({ level: 'warn', text: 'Operating expenses are zero — fill in at least electricity, rent, and misc costs.' });
      if (m.monthlyRevenue > 0) {
        const opexPct = (m.monthlyOpex / m.monthlyRevenue) * 100;
        if (opexPct > 30) out.push({ level: 'warn', text: `Opex is ${opexPct.toFixed(0)}% of revenue — very high overhead structure.` });
        else out.push({ level: 'info', text: `Opex-to-Revenue: ${opexPct.toFixed(1)}%` });
      }
      break;
    case 'wc_norms':
      if (fd.wc_norms.receivable_days > 90) out.push({ level: 'warn', text: 'Debtor days >90 — bank will question cash conversion cycle. Justify with industry norms.' });
      if (fd.wc_norms.rm_holding_days > 90) out.push({ level: 'warn', text: 'Raw material holding >90 days — review procurement frequency.' });
      if (fd.wc_norms.creditor_days < 15) out.push({ level: 'info', text: 'Very short creditor days — consider negotiating better supplier credit terms.' });
      if (fd.wc_norms.receivable_days <= 45 && fd.wc_norms.rm_holding_days <= 60) out.push({ level: 'good', text: 'WC norms within Tandon Committee Method II guidelines.' });
      break;
    case 'depreciation':
      out.push({ level: 'info', text: 'Income Tax rates: Building 5%, P&M 15%, Furniture 10%, Vehicles 15%, Computers 40%. Companies Act rates differ.' });
      break;
    case 'net_worth':
      if (m.netWorth <= 0) out.push({ level: 'error', text: 'Net worth is zero or negative — bank will require justification.' });
      else if (m.netWorth < m.termLoan) out.push({ level: 'warn', text: `Net worth ₹${(m.netWorth / 100000).toFixed(1)}L is less than loan ₹${(m.termLoan / 100000).toFixed(1)}L — collateral may be needed.` });
      else out.push({ level: 'good', text: `Net worth ₹${(m.netWorth / 100000).toFixed(1)}L covers loan amount — strong personal guarantee.` });
      break;
    case 'guarantor':
      if (fd.guarantor && !fd.guarantor.name) out.push({ level: 'info', text: 'Guarantor details optional for CGTMSE-covered loans but required for collateral-backed cases.' });
      break;
    case 'collateral':
      if (!fd.collateral?.primary_security) out.push({ level: 'warn', text: 'Primary security description is blank — required for bank sanction letter.' });
      if (!fd.collateral?.cgtmse_covered && (fd.collateral?.collateral_items?.length || 0) === 0) out.push({ level: 'warn', text: 'No collateral added and CGTMSE not enabled — loan may be unsecured.' });
      if (fd.collateral?.cgtmse_covered) out.push({ level: 'good', text: `CGTMSE coverage at ${fd.collateral.cgtmse_coverage_pct}% — reduces collateral requirement significantly.` });
      if (!fd.collateral?.insurance_arranged) out.push({ level: 'warn', text: 'Insurance not arranged — banks mandate fire/allied perils insurance on hypothecated assets.' });
      break;
    case 'scorecard':
      if (m.estimatedDSCR >= 1.5 && m.deRatio <= 2.5 && m.promoterPct >= 15) out.push({ level: 'good', text: 'All key parameters look bankable — strong case for approval.' });
      if (m.estimatedDSCR < 1.25) out.push({ level: 'error', text: 'DSCR below 1.25 — recommend restructuring loan tenure or reducing project cost.' });
      if (m.deRatio > 3) out.push({ level: 'error', text: 'D:E ratio exceeds 3:1 — increase promoter equity before submission.' });
      out.push({ level: 'info', text: 'Use the recommendation section to record your final CA opinion for audit trail.' });
      break;
    case 'assumptions':
      if (fd.assumptions.revenue_growth > 25) out.push({ level: 'warn', text: `Revenue growth of ${fd.assumptions.revenue_growth}% is aggressive — bank may request sensitivity analysis.` });
      if (fd.assumptions.revenue_growth >= 10 && fd.assumptions.revenue_growth <= 20) out.push({ level: 'good', text: 'Revenue growth assumption is within acceptable RBI/MSME benchmarks.' });
      if (m.estimatedDSCR >= 1.5) out.push({ level: 'good', text: `Est. DSCR ${m.estimatedDSCR.toFixed(2)} — strong repayment capacity.` });
      else if (m.estimatedDSCR >= 1.25) out.push({ level: 'info', text: `Est. DSCR ${m.estimatedDSCR.toFixed(2)} — meets minimum benchmark of 1.25.` });
      else if (m.estimatedDSCR > 0) out.push({ level: 'error', text: `Est. DSCR ${m.estimatedDSCR.toFixed(2)} — below 1.25 minimum. Increase revenue or reduce loan.` });
      break;
  }
  return out;
}

// ─── CA & Banker's Lens — proactive, calculation-aware guidance per step ───────
// Best-practice tips a CA / banker would give while preparing or appraising the
// CMA. Pure rule/maths based (no external calls). Dynamic where numbers help.
function getStepTips(stepId: string, m: LiveMetrics, fd: CMAFormData): Insight[] {
  const t: Insight[] = [];
  const L = (n: number) => `₹${(n / 100000).toFixed(1)}L`;
  switch (stepId) {
    case 'applicant':
      t.push({ level: 'info', text: 'Bankers weigh promoter experience in the SAME line of business heavily — 3+ relevant years materially improves approval odds.' });
      t.push({ level: 'info', text: 'Keep name, PAN & Aadhaar identical across all documents — mismatches are a leading cause of sanction delays.' });
      t.push({ level: 'info', text: 'A qualification relevant to the activity (technical/trade) strengthens the promoter profile in the appraisal note.' });
      break;
    case 'business':
      t.push({ level: 'info', text: 'Udyam registration unlocks PMEGP/CGTMSE benefits and priority-sector classification — register if pending.' });
      t.push({ level: 'info', text: 'Banks cross-check GST returns against projected sales; for a proprietorship the promoter’s net worth IS the firm’s net worth.' });
      t.push({ level: 'info', text: 'Match the constitution to the scheme — PMEGP suits proprietorship/partnership; larger limits suit Pvt Ltd/LLP.' });
      break;
    case 'loan':
      t.push({ level: 'info', text: 'Match term-loan tenure to asset life; Working Capital is a revolving annual facility, not a term loan.' });
      t.push({ level: 'info', text: 'A 6–12 month moratorium aligned to break-even is viewed favourably — repayment starts when cash flow does.' });
      t.push({ level: 'info', text: 'Use a realistic rate (current MSME ~9–12%). Understating it inflates DSCR and invites rejection at appraisal.' });
      break;
    case 'cost': {
      const soft = fd.project_cost.preliminary_expenses + fd.project_cost.marketing_launch + fd.project_cost.consultancy_fees + fd.project_cost.registration_license;
      const softPct = m.totalProjectCost > 0 ? (soft / m.totalProjectCost) * 100 : 0;
      t.push({ level: 'info', text: 'Bankers fund “hard” assets readily. Keep soft costs (preliminary, marketing, consultancy) within ~10–15% of project cost.' });
      if (softPct > 15) t.push({ level: 'warn', text: `Soft costs are ${softPct.toFixed(0)}% of project cost — above ~15% draws scrutiny; shift to capitalised assets where valid.` });
      t.push({ level: 'info', text: 'Add 3–5% contingency — under-provisioning causes overruns the bank won’t refinance later.' });
      t.push({ level: 'info', text: 'Land is often excluded from bank-financed project cost unless freehold and independently valued.' });
      break;
    }
    case 'finance':
      t.push({ level: 'info', text: 'Promoter contribution ≥ 15% (vs the 10% floor) improves approval odds and pricing — show real skin-in-the-game.' });
      t.push({ level: 'info', text: 'Means of Finance must equal Project Cost to the rupee. WC bank finance is shown separately as a revolving limit.' });
      if (m.deRatio > 0) t.push({ level: m.deRatio <= 2 ? 'good' : 'info', text: `Target D:E ≤ 2:1 for comfort (3:1 is the outer MSME limit). You are at ${m.deRatio.toFixed(2)}:1.` });
      break;
    case 'historical':
      t.push({ level: 'info', text: '2–3 years of audited financials with rising sales and positive PAT is the strongest credit signal.' });
      t.push({ level: 'info', text: 'Reconcile historical sales to GST/ITR filings — bankers verify, and gaps erode credibility.' });
      t.push({ level: 'info', text: 'Enter Net Fixed Assets per year so the report shows a tallied audited Balance Sheet column alongside projections.' });
      break;
    case 'products': {
      const gm = m.monthlyRevenue > 0 ? (1 - m.monthlyRM / m.monthlyRevenue) * 100 : 0;
      t.push({ level: 'info', text: 'Justify Year-1 revenue against installed capacity and last year’s actuals — avoid jumps over ~25–30%.' });
      if (m.monthlyRevenue > 0) t.push({ level: gm >= 20 ? 'good' : 'warn', text: `Gross margin is ~${gm.toFixed(0)}%. Below 20% is a red flag (esp. trading); manufacturing should show clear value addition.` });
      t.push({ level: 'info', text: 'Back selling price and volumes with evidence (quotations, orders, rate cards) — bankers ask for proof of demand.' });
      break;
    }
    case 'manpower':
      t.push({ level: 'info', text: 'Payroll above ~35–40% of revenue signals labour-heavy operations — ensure it stays sustainable after scale-up.' });
      t.push({ level: 'info', text: 'Include realistic promoter remuneration — a zero promoter salary artificially inflates profit and DSCR.' });
      break;
    case 'opex':
      t.push({ level: 'info', text: 'Keep opex defensible against the historical run-rate; sudden drops look optimistic to an appraiser.' });
      t.push({ level: 'info', text: 'Power, rent and marketing should scale with capacity utilisation rather than staying flat across years.' });
      break;
    case 'wc_norms':
      t.push({ level: 'info', text: 'Tandon Method-II: the bank funds 75% of the working-capital gap; the remaining 25% is promoter margin.' });
      t.push({ level: 'info', text: 'Receivables ≤ 45 days and inventory ≤ 60 days keep the cash-conversion cycle bank-friendly.' });
      t.push({ level: 'info', text: 'Negotiating longer supplier credit (creditor days) shrinks the funding gap — but stay within industry norms.' });
      break;
    case 'depreciation':
      t.push({ level: 'info', text: 'Use WDV (Income-Tax) rates consistently across years — mixing SLM and WDV distorts the projected net block.' });
      t.push({ level: 'info', text: 'Higher early depreciation lowers taxable profit but also lowers book PAT — bankers read DSCR on cash accruals (PAT + dep).' });
      break;
    case 'net_worth':
      t.push({ level: m.netWorth >= m.termLoan && m.termLoan > 0 ? 'good' : 'info', text: `Promoter net worth ≥ loan amount = strong personal guarantee (yours: ${L(m.netWorth)} vs loan ${L(m.termLoan)}).` });
      t.push({ level: 'info', text: 'List liquid assets (FD, mutual funds) separately — they reassure bankers on margin and contingency cover.' });
      break;
    case 'guarantor':
      t.push({ level: 'info', text: 'A guarantor with independent, verifiable net worth strengthens a thin-file or first-generation proposal.' });
      break;
    case 'collateral':
      t.push({ level: 'info', text: 'CGTMSE can replace collateral up to ₹5 Cr — remember to budget the guarantee fee in the projections.' });
      t.push({ level: 'info', text: 'Hypothecation of current + fixed assets is standard primary security; fire/allied-perils insurance is mandatory.' });
      break;
    case 'scorecard':
      t.push({ level: 'info', text: 'A clean sanction usually needs all three: DSCR ≥ 1.5 (min 1.25), D:E ≤ 2, promoter ≥ 15%.' });
      t.push({ level: 'info', text: 'Record your CA opinion and any conditions — the sanctioning committee and audit trail rely on it.' });
      break;
    case 'assumptions':
      t.push({ level: 'info', text: 'Conservative assumptions (growth ≤ 15%) are more credible — banks run a downside (−10% sales) sensitivity anyway.' });
      t.push({ level: 'info', text: 'Keep COGS growth tied to revenue growth; decoupling them breaks the projection logic an appraiser will test.' });
      break;
    default:
      t.push({ level: 'info', text: 'Fill each field as a banker would expect — consistent, evidence-backed, and conservative.' });
  }
  return t;
}

// ─── WC auto-calculator (Tandon Method II) ───────────────────────────────────
function computeWCFromNorms(fd: CMAFormData, m: LiveMetrics) {
  const wc = fd.wc_norms;
  const rmHolding    = m.monthlyRM    * (wc.rm_holding_days   / 30);
  const wipHolding   = (m.monthlyRM + m.monthlyPayroll + m.monthlyOpex) * 0.5 * (wc.wip_days / 30);
  const fgHolding    = (m.monthlyRM + m.monthlyPayroll + m.monthlyOpex) * (wc.fg_days / 30);
  const debtors      = m.monthlyRevenue * (wc.receivable_days  / 30);
  const creditors    = m.monthlyRM     * (wc.creditor_days     / 30);
  const cashNeeded   = (m.monthlyPayroll + m.monthlyOpex) * (wc.cash_holding_days / 30);
  const grossWC      = rmHolding + wipHolding + fgHolding + debtors + cashNeeded;
  const netWC        = Math.max(0, grossWC - creditors);
  const bankFinance  = Math.round(netWC * 0.75);
  const promoterMargin = Math.round(netWC * 0.25);
  return { rmHolding, wipHolding, fgHolding, debtors, creditors, cashNeeded, grossWC, netWC, bankFinance, promoterMargin };
}

// ─── 5-year P&L projection ────────────────────────────────────────────────────
function compute5YearProjection(fd: CMAFormData, m: LiveMetrics) {
  const r  = fd.loan.interest_rate / 100 / 12;
  const n  = fd.loan.tenure_months || 60;
  const tl = fd.means_of_finance.term_loan;
  const monthlyEMI = tl > 0 && r > 0
    ? tl * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
    : tl > 0 ? tl / n : 0;

  const annualDepr =
    (fd.project_cost.building         * ((fd.depreciation_rates.building         || 5) / 100)) +
    (fd.project_cost.plant_machinery  * ((fd.depreciation_rates.plant_machinery  || 10) / 100)) +
    (fd.project_cost.furniture        * ((fd.depreciation_rates.furniture        || 10) / 100)) +
    (fd.project_cost.computers        * ((fd.depreciation_rates.computers        || 40) / 100)) +
    (fd.project_cost.vehicles         * ((fd.depreciation_rates.vehicles         || 15) / 100));

  const rows = [];
  let outstandingLoan = tl;
  let rev0 = m.annualRevenue;
  let cogs0 = m.monthlyRM * 12;
  let sal0 = m.monthlyPayroll * 12;
  let opex0 = m.monthlyOpex * 12;
  const morat = fd.loan.moratorium_months || 0;

  for (let yr = 1; yr <= 5; yr++) {
    const gR  = fd.assumptions.revenue_growth / 100;
    const gC  = fd.assumptions.cogs_growth / 100;
    const gE  = fd.assumptions.expense_growth / 100;
    const gS  = fd.assumptions.salary_increment / 100;
    const revenue = yr === 1 ? rev0 : rev0 * Math.pow(1 + gR, yr - 1);
    const cogs    = yr === 1 ? cogs0 : cogs0 * Math.pow(1 + gC, yr - 1);
    const salary  = yr === 1 ? sal0 : sal0 * Math.pow(1 + gS, yr - 1);
    const opex    = yr === 1 ? opex0 : opex0 * Math.pow(1 + gE, yr - 1);
    const depr    = Math.max(0, annualDepr * Math.pow(0.85, yr - 1));
    // Simple interest on declining balance
    const interest = outstandingLoan * (fd.loan.interest_rate / 100);
    const isInMorat = (yr - 1) * 12 < morat;
    const principalRepaid = isInMorat ? 0 : Math.min(outstandingLoan, monthlyEMI * 12 - interest);
    const debtService = isInMorat ? interest : monthlyEMI * 12;
    outstandingLoan = Math.max(0, outstandingLoan - (isInMorat ? 0 : principalRepaid));

    const grossProfit = revenue - cogs;
    const ebitda = grossProfit - salary - opex;
    const ebit   = ebitda - depr;
    const pbt    = ebit - interest;
    const tax    = Math.max(0, pbt * (fd.tax_rate / 100));
    const pat    = pbt - tax;
    const cashAccruals = pat + depr;
    const dscr   = debtService > 0 ? (pat + depr + interest) / debtService : 0;
    rows.push({ yr, revenue, cogs, grossProfit, salary, opex, ebitda, depr, interest, pat, cashAccruals, debtService, dscr });
  }
  return rows;
}

// ─── Break-Even Analysis ──────────────────────────────────────────────────────
function computeBreakEven(fd: CMAFormData, m: LiveMetrics) {
  const fixedCosts = m.monthlyPayroll + m.monthlyOpex;
  const variableRatio = m.monthlyRevenue > 0 ? m.monthlyRM / m.monthlyRevenue : 0;
  const contributionRatio = 1 - variableRatio;
  const bepMonthlyRevenue = contributionRatio > 0 ? fixedCosts / contributionRatio : 0;
  const bepAnnualRevenue  = bepMonthlyRevenue * 12;
  const bepUtilisation    = m.annualRevenue > 0 ? (bepAnnualRevenue / m.annualRevenue) * 100 : 0;
  const safetyMargin      = m.annualRevenue > 0 ? ((m.annualRevenue - bepAnnualRevenue) / m.annualRevenue) * 100 : 0;
  return { bepMonthlyRevenue, bepAnnualRevenue, bepUtilisation, safetyMargin, contributionRatio, fixedCosts };
}

// ─── EMI Repayment Schedule (year-wise) ──────────────────────────────────────
function computeEMISchedule(fd: CMAFormData) {
  const tl = fd.means_of_finance.term_loan;
  const r  = fd.loan.interest_rate / 100 / 12;
  const n  = fd.loan.tenure_months || 60;
  const morat = fd.loan.moratorium_months || 0;
  const monthlyEMI = tl > 0 && r > 0
    ? tl * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
    : tl > 0 ? tl / n : 0;

  const rows = [];
  let outstanding = tl;
  const years = Math.ceil(n / 12);
  for (let yr = 1; yr <= Math.min(years, 7); yr++) {
    const monthsThisYear = Math.min(12, n - (yr - 1) * 12);
    const isInMorat = (yr - 1) * 12 < morat;
    let totalInterest = 0, totalPrincipal = 0;
    const openingBal = outstanding;
    for (let mo = 0; mo < monthsThisYear; mo++) {
      const intMo = outstanding * r;
      totalInterest += intMo;
      if (!isInMorat) {
        const prinMo = monthlyEMI - intMo;
        totalPrincipal += Math.max(0, prinMo);
        outstanding = Math.max(0, outstanding - Math.max(0, prinMo));
      }
    }
    rows.push({
      yr, openingBal, totalInterest: Math.round(totalInterest),
      totalPrincipal: Math.round(totalPrincipal),
      totalEMI: Math.round(isInMorat ? totalInterest : monthlyEMI * monthsThisYear),
      closingBal: Math.round(outstanding), isInMorat
    });
  }
  return { rows, monthlyEMI: Math.round(monthlyEMI) };
}

// ─── Sensitivity Analysis ─────────────────────────────────────────────────────
function computeSensitivity(fd: CMAFormData, m: LiveMetrics) {
  const scenarios = [-30, -20, -10, 0, 10, 20];
  const r  = fd.loan.interest_rate / 100 / 12;
  const n  = fd.loan.tenure_months || 60;
  const tl = fd.means_of_finance.term_loan;
  const monthlyEMI = tl > 0 && r > 0
    ? tl * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
    : tl > 0 ? tl / n : 0;
  const annualDepr =
    (fd.project_cost.building         * ((fd.depreciation_rates.building         || 5) / 100)) +
    (fd.project_cost.plant_machinery  * ((fd.depreciation_rates.plant_machinery  || 10) / 100)) +
    (fd.project_cost.furniture        * ((fd.depreciation_rates.furniture        || 10) / 100)) +
    (fd.project_cost.computers        * ((fd.depreciation_rates.computers        || 40) / 100)) +
    (fd.project_cost.vehicles         * ((fd.depreciation_rates.vehicles         || 15) / 100));
  const annualInterest    = tl * (fd.loan.interest_rate / 100);
  const annualInstallment = monthlyEMI * 12;

  return scenarios.map(pct => {
    const revenue  = m.annualRevenue  * (1 + pct / 100);
    const cogs     = m.monthlyRM * 12 * (1 + pct / 100);
    const salary   = m.monthlyPayroll * 12;
    const opex     = m.monthlyOpex    * 12;
    const ebitda   = revenue - cogs - salary - opex;
    const pat      = ebitda - annualDepr - annualInterest;
    const cashAcc  = pat + annualDepr;
    const dscr     = (annualInstallment + annualInterest) > 0
      ? (cashAcc + annualInterest) / (annualInstallment + annualInterest) : 0;
    return { pct, revenue, cogs, ebitda: Math.round(ebitda), pat: Math.round(pat), dscr: Math.max(0, dscr) };
  });
}

// ─── CA Scorecard ─────────────────────────────────────────────────────────────
interface ScorecardParam {
  label: string; value: string; score: number; maxScore: number;
  status: 'good' | 'warn' | 'bad'; comment: string;
}
function computeScorecard(m: LiveMetrics, fd: CMAFormData): ScorecardParam[] {
  const params: ScorecardParam[] = [];

  // DSCR
  const dscrScore = m.estimatedDSCR >= 1.5 ? 20 : m.estimatedDSCR >= 1.25 ? 14 : m.estimatedDSCR >= 1.0 ? 8 : 2;
  params.push({ label: 'DSCR (Debt Service Coverage)', value: m.estimatedDSCR > 0 ? m.estimatedDSCR.toFixed(2) : '—',
    score: dscrScore, maxScore: 20,
    status: m.estimatedDSCR >= 1.5 ? 'good' : m.estimatedDSCR >= 1.25 ? 'warn' : 'bad',
    comment: m.estimatedDSCR >= 1.5 ? 'Excellent — strong repayment capacity.' : m.estimatedDSCR >= 1.25 ? 'Acceptable — meets minimum benchmark.' : 'Below 1.25 — high default risk.' });

  // D:E Ratio
  const deScore = m.deRatio <= 1.5 ? 15 : m.deRatio <= 2.5 ? 10 : m.deRatio <= 3 ? 6 : 2;
  params.push({ label: 'Debt:Equity Ratio', value: m.deRatio > 0 ? `${m.deRatio.toFixed(2)}:1` : '—',
    score: deScore, maxScore: 15,
    status: m.deRatio <= 1.5 ? 'good' : m.deRatio <= 3 ? 'warn' : 'bad',
    comment: m.deRatio <= 1.5 ? 'Conservative leverage — low financial risk.' : m.deRatio <= 3 ? 'Moderate leverage — within acceptable range.' : 'High leverage — exceeds 3:1 norm.' });

  // Promoter contribution %
  const pcScore = m.promoterPct >= 25 ? 15 : m.promoterPct >= 15 ? 10 : m.promoterPct >= 10 ? 7 : 3;
  params.push({ label: 'Promoter Contribution %', value: `${m.promoterPct.toFixed(1)}%`,
    score: pcScore, maxScore: 15,
    status: m.promoterPct >= 15 ? 'good' : m.promoterPct >= 10 ? 'warn' : 'bad',
    comment: m.promoterPct >= 15 ? 'Strong skin-in-the-game.' : m.promoterPct >= 10 ? 'Meets minimum — consider increasing.' : 'Below 10% — weak promoter commitment.' });

  // Net Worth vs Loan
  const nwRatio = m.termLoan > 0 ? m.netWorth / m.termLoan : 0;
  const nwScore = nwRatio >= 1.5 ? 15 : nwRatio >= 1.0 ? 10 : nwRatio >= 0.5 ? 6 : 2;
  params.push({ label: 'Net Worth vs Term Loan', value: nwRatio > 0 ? `${nwRatio.toFixed(2)}x` : '—',
    score: nwScore, maxScore: 15,
    status: nwRatio >= 1.0 ? 'good' : nwRatio >= 0.5 ? 'warn' : 'bad',
    comment: nwRatio >= 1.0 ? 'Net worth covers loan — strong personal guarantee.' : nwRatio >= 0.5 ? 'Partial coverage — collateral support advised.' : 'Low net worth — CGTMSE or collateral essential.' });

  // Revenue assumption
  const revG = fd.assumptions?.revenue_growth ?? 10;
  const revScore = revG <= 15 ? 15 : revG <= 20 ? 10 : revG <= 25 ? 6 : 3;
  params.push({ label: 'Revenue Growth Assumption', value: `${revG}%/yr`,
    score: revScore, maxScore: 15,
    status: revG <= 15 ? 'good' : revG <= 20 ? 'warn' : 'bad',
    comment: revG <= 15 ? 'Conservative — credible to bank.' : revG <= 20 ? 'Moderate — justify with market data.' : 'Aggressive — may trigger bank sensitivity queries.' });

  // Historical track record
  const histCount = fd.historical_financials?.length ?? 0;
  const histScore = histCount >= 3 ? 10 : histCount >= 1 ? 6 : 3;
  params.push({ label: 'Historical Track Record', value: histCount > 0 ? `${histCount} year(s)` : 'New Unit',
    score: histScore, maxScore: 10,
    status: histCount >= 2 ? 'good' : histCount === 1 ? 'warn' : 'bad',
    comment: histCount >= 2 ? 'Established track record — reduces credit risk.' : histCount === 1 ? 'Limited history — first-gen entrepreneur risk.' : 'New unit — projections unvalidated by actuals.' });

  // MoF Balance
  const mofOk = Math.abs(m.mofBalance) < 2;
  params.push({ label: 'Means of Finance Balance', value: mofOk ? 'Balanced' : `Gap ₹${Math.abs(m.mofBalance).toLocaleString('en-IN')}`,
    score: mofOk ? 10 : 0, maxScore: 10,
    status: mofOk ? 'good' : 'bad',
    comment: mofOk ? 'MoF balances exactly — no funding gap.' : 'MoF gap present — report will be rejected by bank.' });

  return params;
}

// Collapsible best-practice tips panel shown on every step.
const BankerTips = ({ tips }: { tips: Insight[] }) => {
  const [open, setOpen] = useState(true);
  if (!tips.length) return null;
  const dot: Record<string, string> = {
    good: 'text-emerald-400', warn: 'text-amber-400', error: 'text-rose-400', info: 'text-teal-400',
  };
  return (
    <div className="mb-6 rounded-2xl border border-teal-500/20 bg-gradient-to-br from-teal-500/[0.07] to-emerald-500/[0.04] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-teal-500/[0.05] transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-teal-300">
          <Lightbulb size={16} className="text-amber-400" />
          CA &amp; Banker's Lens — Tips for this step
        </span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          {tips.map((tip, i) => (
            <div key={i} className="flex items-start gap-2.5 text-xs text-slate-300 leading-relaxed">
              <span className={`shrink-0 mt-0.5 font-black ${dot[tip.level]}`}>▸</span>
              <span>{tip.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const InsightCard = ({ insights }: { insights: Insight[] }) => {
  if (!insights.length) return null;
  const colors: Record<string, string> = {
    good:  'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
    warn:  'bg-amber-500/10  border-amber-500/30  text-amber-300',
    error: 'bg-rose-500/10   border-rose-500/30   text-rose-300',
    info:  'bg-blue-500/10   border-blue-500/30   text-blue-300',
  };
  const icons: Record<string, string> = { good: '✓', warn: '⚠', error: '✕', info: 'ℹ' };
  return (
    <div className="space-y-2 mb-6">
      {insights.map((ins, i) => (
        <div key={i} className={`flex items-start gap-2 px-4 py-2.5 rounded-xl border text-xs font-medium ${colors[ins.level]}`}>
          <span className="shrink-0 font-black">{icons[ins.level]}</span>
          <span>{ins.text}</span>
        </div>
      ))}
    </div>
  );
};

export const AdvancedCMAWizard = ({ isOpen, onClose, applicationId, initialData, demoMode = false }: AdvancedCMAWizardProps) => {
  const { isAdmin } = useAdminAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<CMAFormData>({ ...INITIAL_CMA_DATA, ...initialData });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [showFormulas, setShowFormulas] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [showValidationPanel, setShowValidationPanel] = useState(false);
  const { toast } = useToast();
  const liveMetrics = useMemo(() => computeLiveMetrics(formData), [formData]);

  useEffect(() => {
    // Demo mode uses the pre-filled sample — never hit Supabase.
    if (isOpen && applicationId && !demoMode) {
      fetchApplicationData();
    }
  }, [isOpen, applicationId, demoMode]);

  const fetchApplicationData = async () => {
    setIsLoadingData(true);
    try {
      const { data, error } = await supabase
        .from('loan_applications')
        .select('*')
        .eq('id', applicationId)
        .single();

      if (error) throw error;

      if (data) {
        // 1. If a saved CMA draft exists and has content, load it directly
        //    Check both top-level cma_data column and nested project_report_inputs.cma_data
        const savedDraft = (data as any).cma_data || (data.project_report_inputs as any)?.cma_data;
        if (savedDraft && typeof savedDraft === 'object' && Object.keys(savedDraft).length > 0) {
            // Merge over defaults so drafts saved by older versions (missing
            // assumptions / historical_financials / etc.) don't break later steps.
            setFormData({ ...INITIAL_CMA_DATA, ...savedDraft });
            toast({ title: "Draft Loaded", description: "Your previously saved CMA progress has been restored." });
            setIsLoadingData(false);
            return;
        }

        // 2. Otherwise, perform a Deep Map from project_report_inputs
        const pri = data.project_report_inputs as any;
        const promoter = pri?.promoter || {};
        const biz = pri?.business || {};
        const pLoan = pri?.loan || {};
        const pCost = pri?.project_cost || {};
        const pAssets = pri?.promoter_assets || {};
        const pWc = pri?.working_capital || {};
        const pRevenue = pri?.revenue || {};
        const schemeStr = (pLoan.loan_scheme || data.loan_scheme || '').toLowerCase();
        const isCgtmse = schemeStr.includes('cgtmse');

        const mappedData: Partial<CMAFormData> = {
          applicant: {
            ...INITIAL_CMA_DATA.applicant,
            name: promoter.full_name || `${data.first_name || ''} ${data.last_name || ''}`.trim(),
            father_spouse_name: promoter.fathers_name || '',
            dob: promoter.date_of_birth || '',
            pan: promoter.pan_number || '',
            aadhaar: promoter.aadhar_number || '',
            email: promoter.email || data.contact_email || '',
            mobile: promoter.mobile || data.contact_mobile || '',
            address: promoter.address_line1 || data.address_line_1 || '',
            city: promoter.city || data.city || '',
            state: promoter.state || data.state || '',
            pincode: promoter.pincode || data.pincode || '',
            education: promoter.educational_qual || data.education || '',
            experience_years: Number(promoter.years_experience) || 0,
          },
          business: {
            ...INITIAL_CMA_DATA.business,
            entity_name: biz.business_name || data.business_entity_name || '',
            constitution: normalizeConstitution(biz.business_type || data.registration_type),
            activity: normalizeActivity(biz.industry || data.industry_type),
            gst_number: biz.gst_number || '',
            udyam_registration: biz.msme_number || '',
            commencement_date: biz.commencement_date || '',
          },
          loan: {
            ...INITIAL_CMA_DATA.loan,
            amount: Number(pLoan.loan_amount) || Number(data.eligible_loan_amount) || 0,
            scheme: pLoan.loan_scheme || data.loan_scheme || '',
            purpose: pLoan.loan_type || data.loan_purpose || '',
            preferred_bank: pLoan.bank_name || data.preferred_bank || '',
            tenure_months: Number(pLoan.tenure_months) || 60,
            moratorium_months: Number(pLoan.moratorium_months) || 6,
            interest_rate: Number(pLoan.interest_rate_pct) || 9.5,
          },
          project_cost: {
            land: Number(data.land_cost) || 0,
            building: Number(pCost.building_renovation) || Number(data.shed_building_cost) || 0,
            plant_machinery: Array.isArray(data.plant_machinery) 
              ? (data.plant_machinery as any[]).reduce((sum: number, item: any) => sum + (Number(item.cost || item.unit_cost) || 0), 0)
              : 0,
            electrical: Number(pCost.electrification_wiring) || Number(data.electrification_cost) || 0,
            furniture: Number(pCost.furniture_fixtures) || Number(data.furniture_cost) || 0,
            computers: Number(pCost.computers_peripherals) || Number(data.computers_cost) || 0,
            vehicles: Number(pCost.transportation_vehicle) || Number(data.transportation_cost) || 0,
            office_equipment: Number(pCost.additional_racks_storage) || Number(data.racks_storage_cost) || 0,
            generator_ups: 0,
            preliminary_expenses: Number(pCost.preoperative_expenses) || Number(data.other_initial_expenditure) || 0,
            registration_license: 0,
            consultancy_fees: 0,
            marketing_launch: 0,
            contingency: 0,
            initial_stock: 0,
            cash_margin: 0,
            receivables_support: 0,
          },
          opex: {
            ...INITIAL_CMA_DATA.opex,
            rent: Number(data.monthly_rent) || 0,
            electricity: Number(data.electricity_water_cost) || 0,
            marketing: Number(data.marketing_cost) || 0,
            repair: Number(data.repair_maintenance_cost) || 0,
            stationery: Number(data.stationery_cost) || 0,
            transport: Number(data.transport_cost) || 0,
            telephone: Number(data.telephone_internet_cost) || 0,
            misc: Number(data.miscellaneous_cost) || 0,
          },
          wc_norms: {
            rm_holding_days: Number(pWc.stock_days) || 60,
            wip_days: 15,
            fg_days: 30,
            receivable_days: Number(pWc.debtors_days) || 45,
            creditor_days: Number(pWc.creditors_days) || 30,
            cash_holding_days: 15,
          },
          promoter_net_worth: {
            residential_property: Number(pAssets.residential_property) || 0,
            commercial_property: 0,
            fd: Number(pAssets.fixed_deposits) || 0,
            savings: Number(pAssets.savings_account) || 0,
            mutual_funds: Number(pAssets.mutual_funds) || 0,
            shares: 0,
            gold: 0,
            other_assets: 0,
            liabilities: Number(pAssets.home_loan_outstanding) || 0,
          },
          products: Array.isArray(pRevenue?.product_categories)
            ? pRevenue.product_categories.map((cat: any) => ({
                product_name: cat.category || 'Product',
                unit: cat.billing_unit || 'Nos',
                purchase_cost: Number(cat.purchase_price) || 0,
                selling_price: Number(cat.selling_price) || Number(cat.avg_price) || 0,
                monthly_qty: Number(cat.units_monthly) || 0,
                growth_pct: 10
              }))
            : [],
          means_of_finance: {
            term_loan: Number(data.eligible_loan_amount) || 0,
            subsidy: Number(data.margin_money) || 0,
            promoter_contribution: Math.max(0,
              Number(data.total_project_cost || 0)
              - Number(data.eligible_loan_amount || 0)
              - Number(data.margin_money || 0)
            ),
            working_capital_loan: Number(pWc?.wc_bank_finance || pWc?.wc_loan || 0),
            unsecured_loans: 0,
            other_funding: 0,
          },
          manpower: [
            ...(Number(data.skilled_workers_count) > 0 ? [{
              designation: 'Skilled Worker',
              headcount: Number(data.skilled_workers_count),
              monthly_salary: Number(data.skilled_workers_salary) || 0,
              annual_increment_pct: 8,
            }] : []),
            ...(Number(data.semi_skilled_workers_count) > 0 ? [{
              designation: 'Semi-Skilled Worker',
              headcount: Number(data.semi_skilled_workers_count),
              monthly_salary: Number(data.semi_skilled_workers_salary) || 0,
              annual_increment_pct: 8,
            }] : []),
            ...(Number(data.wages_count) > 0 ? [{
              designation: 'Helper / Labour',
              headcount: Number(data.wages_count),
              monthly_salary: Number(data.wages_salary) || 0,
              annual_increment_pct: 5,
            }] : []),
            ...(Number(data.employee_count) > 0 ? [{
              designation: 'Office Staff',
              headcount: Number(data.employee_count),
              monthly_salary: Number(data.salary_per_employee) || 0,
              annual_increment_pct: 8,
            }] : []),
          ].filter(m => m.headcount > 0),
          // Growth & tax assumptions from the applicant's project report (were
          // previously ignored — the CA report defaulted to 10% growth / 25% tax).
          assumptions: {
            ...INITIAL_CMA_DATA.assumptions,
            revenue_growth: Number(pRevenue.revenue_growth_pct) || INITIAL_CMA_DATA.assumptions.revenue_growth,
            expense_growth: Number(pRevenue.expense_growth_pct) || INITIAL_CMA_DATA.assumptions.expense_growth,
          },
          tax_rate: Number(pRevenue.tax_rate_pct) || INITIAL_CMA_DATA.tax_rate,
          // Guarantor & collateral captured on the applicant side — pre-fill so
          // the CA reviews/edits rather than re-keying from scratch.
          ...(pLoan.guarantor_name ? {
            guarantor: {
              name: pLoan.guarantor_name,
              relation: pLoan.guarantor_relation || '',
              net_worth: 0,
            },
          } : {}),
          ...(pLoan.collateral_details || isCgtmse ? {
            collateral: {
              primary_security: pLoan.collateral_details || '',
              collateral_items: [],
              cgtmse_covered: isCgtmse,
              cgtmse_coverage_pct: isCgtmse ? 75 : 0,
              cgtmse_fee_pct: 1,
              insurance_arranged: false,
            },
          } : {}),
        };

        // Rebuild from a clean base (not prev) so no field from a previously
        // opened application can linger into this one — each application must
        // produce its own report, never a copy of the last one.
        setFormData({ ...INITIAL_CMA_DATA, ...mappedData });
        toast({ title: "Data Imported", description: "Applicant data has been loaded into the wizard." });
      }
    } catch (error: any) {
      console.error("Error fetching application data:", error);
      toast({ variant: "destructive", title: "Sync Failed", description: "Could not load applicant data." });
    } finally {
      setIsLoadingData(false);
    }
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const runFrontendValidation = (): ValidationResult => {
    const totalProjectCost = Object.values(formData.project_cost).reduce((a, b) => a + b, 0);
    const mof = formData.means_of_finance;
    const mofTotal = mof.promoter_contribution + (mof.subsidy ?? 0) + mof.term_loan;
    const wcLoan = mof.working_capital_loan ?? 0;

    const baseRevenue = formData.products.reduce((s, p) => s + p.selling_price * p.monthly_qty * 12, 0);
    const baseRM      = formData.products.reduce((s, p) => s + p.purchase_cost * p.monthly_qty * 12, 0);

    return validateReport({
      projectCost:       totalProjectCost,
      termLoan:          mof.term_loan,
      subsidyAmt:        mof.subsidy ?? 0,
      promoterCash:      mof.promoter_contribution,
      wcLoan,
      pmWithContingency: formData.project_cost.plant_machinery,
      grossBlockPM:      formData.project_cost.plant_machinery,
      rmAt100pct:        baseRM,
      revenueAt100pct:   baseRevenue,
      costItemsSum:      totalProjectCost,
      wcLoanInMoF:       Math.abs(mofTotal + wcLoan - totalProjectCost) < 1 && wcLoan > 0,
      years: [], // populated by backend; frontend does partial validation
      sensitivityScenarios: [],
    });
  };

  const handleSubmit = async (format: 'pdf' | 'excel' | 'csv' = 'pdf') => {
    // Demo mode: Excel & CSV are admin-only (they carry the full raw dataset).
    if (demoMode && (format === 'excel' || format === 'csv') && !isAdmin) {
      toast({
        variant: "destructive",
        title: "Locked in demo",
        description: `${format.toUpperCase()} export is available to admins only. The watermarked PDF is free to download.`,
      });
      return;
    }
    // Run validation — warn but NEVER block download
    const vResult = runFrontendValidation();
    setValidationResult(vResult);
    if (vResult.criticalErrors.length > 0) {
      toast({
        variant: "destructive",
        title: `${vResult.criticalErrors.length} validation issue${vResult.criticalErrors.length > 1 ? 's' : ''} found`,
        description: vResult.criticalErrors[0]?.message + (vResult.criticalErrors.length > 1 ? ` (+${vResult.criticalErrors.length - 1} more)` : '') + " — generating anyway.",
      });
    } else if (vResult.warnings.length > 0) {
      toast({
        title: `${vResult.warnings.length} advisory warning${vResult.warnings.length > 1 ? 's' : ''}`,
        description: vResult.warnings[0]?.message + " — generating report.",
      });
    }

    setIsSubmitting(true);
    try {
      const apiUrl = import.meta.env.VITE_CMA_API_URL || 'http://localhost:8000';
      const { data: { session } } = await supabase.auth.getSession();
      // In demo mode the PDF is watermarked (demo=true). Admin Excel/CSV go via
      // the normal path (no demo flag) so they receive clean files.
      const demoFlag = demoMode && format === 'pdf' ? '&demo=true' : '';
      // Cache-buster: the URL is otherwise identical for every download, so a
      // browser/proxy cache could serve a stale file ("same report always").
      // A unique param + no-store guarantees the current formData is rendered.
      const bust = `&_t=${Date.now()}`;
      const response = await fetch(`${apiUrl}/api/cma/download?format=${format}${demoFlag}${bust}`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errorMessage = typeof errData.detail === 'string'
          ? errData.detail
          : JSON.stringify(errData.detail) || 'Failed to generate CMA Pack';
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        throw new Error("The server returned an empty file. Please try again.");
      }
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const extension = format === 'pdf' ? 'pdf' : format === 'excel' ? 'xlsx' : 'csv';
      const namePart = demoMode ? 'DEMO' : applicationId;
      a.download = `CMA_Report_${namePart}_${new Date().toISOString().split('T')[0]}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke on the next tick — revoking synchronously can abort the download
      // in some browsers before it has actually started.
      setTimeout(() => window.URL.revokeObjectURL(url), 4000);

      toast({ title: `CMA ${format.toUpperCase()} Generated`, description: "Your file has been downloaded." });
      // In demo mode keep the wizard open so the user can try other formats /
      // review the on-screen figures; only auto-close for a real application.
      if (format === 'pdf' && !demoMode) onClose();
    } catch (error: any) {
      console.error("CMA Export Error:", error);
      toast({
        variant: "destructive",
        title: "Download Failed",
        description: error.message || "Could not reach the report server. Make sure the backend is running.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    // Demo mode has no backing DB row (applicationId is `demo-<scheme>`), so
    // there is nothing to persist — don't attempt a write that would 0-row.
    if (demoMode) {
      toast({ title: "Demo mode", description: "Saving is disabled in the Live Demo — this is a read-only sample." });
      return;
    }
    setIsSubmitting(true);
    try {
      const { data: existing } = await supabase
        .from('loan_applications')
        .select('project_report_inputs')
        .eq('id', applicationId)
        .single();
      const merged = { ...(existing?.project_report_inputs as any || {}), cma_data: formData };
      const { data: saved, error } = await supabase
        .from('loan_applications')
        .update({
            project_report_inputs: merged,
            cma_data: formData,
            updated_at: new Date().toISOString()
        })
        .eq('id', applicationId)
        .select('id');

      if (error) throw error;
      // RLS returns 0 rows (no error) when no UPDATE policy matches — surface it.
      if (!saved || saved.length === 0) {
        throw new Error("Draft not saved — you may not have permission to update this application. Ensure the credit-analyst UPDATE policy is applied to the database.");
      }

      toast({ title: "Draft Saved", description: "CMA progress has been saved to the database." });
    } catch (error: any) {
      console.error("Save Draft Error:", error);
      toast({ variant: "destructive", title: "Save Failed", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStep = () => {
    const stepId = steps[currentStep].id;
    const insights = getStepInsights(stepId, liveMetrics, formData);
    switch (stepId) {
      case 'applicant':
        return (
          <div className="space-y-6">
            <h3 className="text-xl font-bold">Step 1 — Applicant / Entity Profile</h3>
            <InsightCard insights={insights} />
            <div className="grid grid-cols-2 gap-4">
              {['name', 'father_spouse_name', 'dob', 'pan', 'aadhaar', 'mobile', 'email', 'address', 'city', 'state', 'pincode', 'education'].map(field => (
                <div key={field} className="space-y-2">
                  <Label className="capitalize">{field.replace(/_/g, ' ')}</Label>
                  <Input value={(formData.applicant as any)[field]} onChange={e => setFormData({...formData, applicant: {...formData.applicant, [field]: e.target.value}})} />
                </div>
              ))}
              <div className="space-y-2">
                <Label>Experience (Years)</Label>
                <Input type="number" value={formData.applicant.experience_years} onChange={e => setFormData({...formData, applicant: {...formData.applicant, experience_years: parseInt(e.target.value) || 0}})} />
              </div>
            </div>
          </div>
        );
      case 'business':
        return (
          <div className="space-y-6">
            <h3 className="text-xl font-bold">Business Profile</h3>
            <InsightCard insights={insights} />
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Entity Name</Label>
                    <Input value={formData.business.entity_name} onChange={e => setFormData({...formData, business: {...formData.business, entity_name: e.target.value}})} />
                </div>
                <div className="space-y-2">
                    <Label>Constitution</Label>
                    <Select value={formData.business.constitution} onValueChange={v => setFormData({...formData, business: {...formData.business, constitution: v as any}})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Proprietorship">Proprietorship</SelectItem>
                            <SelectItem value="Partnership">Partnership</SelectItem>
                            <SelectItem value="LLP">LLP</SelectItem>
                            <SelectItem value="Pvt Ltd">Pvt Ltd</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>Activity</Label>
                    <Select value={formData.business.activity} onValueChange={v => setFormData({...formData, business: {...formData.business, activity: v as any}})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Manufacturing">Manufacturing</SelectItem>
                            <SelectItem value="Trading">Trading</SelectItem>
                            <SelectItem value="Service">Service</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>GST Number</Label>
                    <Input value={formData.business.gst_number} onChange={e => setFormData({...formData, business: {...formData.business, gst_number: e.target.value}})} />
                </div>
                <div className="space-y-2">
                    <Label>Udyam Registration</Label>
                    <Input value={formData.business.udyam_registration} onChange={e => setFormData({...formData, business: {...formData.business, udyam_registration: e.target.value}})} />
                </div>
                <div className="space-y-2">
                    <Label>Commencement Date</Label>
                    <Input type="date" value={formData.business.commencement_date} onChange={e => setFormData({...formData, business: {...formData.business, commencement_date: e.target.value}})} />
                </div>
            </div>
          </div>
        );
      case 'loan':
        return (
          <div className="space-y-6">
            <h3 className="text-xl font-bold">Step 2 — Loan Requirement</h3>
            <InsightCard insights={insights} />
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 col-span-2">
                    <Label>Loan Purpose</Label>
                    <Input value={formData.loan.purpose} onChange={e => setFormData({...formData, loan: {...formData.loan, purpose: e.target.value}})} />
                </div>
                <div className="space-y-2">
                    <Label>Loan Amount</Label>
                    <Input type="number" value={formData.loan.amount} onChange={e => setFormData({...formData, loan: {...formData.loan, amount: parseFloat(e.target.value) || 0}})} />
                    <p className="text-[10px] text-slate-500 italic">CA Tip: Should match the sum of Project Cost - Margin.</p>
                </div>
                <div className="space-y-2">
                    <Label>Preferred Bank</Label>
                    <Select value={formData.loan.preferred_bank} onValueChange={v => setFormData({...formData, loan: {...formData.loan, preferred_bank: v}})}>
                        <SelectTrigger className="bg-slate-950/50 border-slate-800"><SelectValue placeholder="Select Bank" /></SelectTrigger>
                        <SelectContent className="bg-slate-900 border-slate-800 text-white">
                            {INDIAN_BANKS.map(bank => <SelectItem key={bank} value={bank}>{bank}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>Tenure (Months)</Label>
                    <Input type="number" value={formData.loan.tenure_months} onChange={e => setFormData({...formData, loan: {...formData.loan, tenure_months: parseInt(e.target.value) || 0}})} />
                </div>
                <div className="space-y-2">
                    <Label>Interest Rate (%)</Label>
                    <Input type="number" value={formData.loan.interest_rate} onChange={e => setFormData({...formData, loan: {...formData.loan, interest_rate: parseFloat(e.target.value) || 0}})} />
                </div>
            </div>
          </div>
        );
      case 'cost':
        return (
          <div className="space-y-6">
            <h3 className="text-xl font-bold">Step 3 — Project Cost</h3>
            <InsightCard insights={insights} />
            <div className="grid grid-cols-3 gap-4">
              {Object.entries(formData.project_cost).map(([key, value]) => (
                <div key={key} className="space-y-2">
                  <Label className="capitalize text-xs font-semibold text-slate-400">{key.replace(/_/g, ' ')}</Label>
                  <Input type="number" value={value as number} onChange={e => setFormData({...formData, project_cost: {...formData.project_cost, [key]: parseFloat(e.target.value) || 0}})} className="bg-slate-950/50 border-slate-800" />
                </div>
              ))}
            </div>
            <div className="p-6 bg-teal-500/10 border border-teal-500/20 rounded-2xl flex justify-between items-center mt-6">
                <span className="font-bold text-lg">Total Project Cost</span>
                <span className="text-3xl font-black text-teal-400">₹ {Object.values(formData.project_cost).reduce((a, b) => a + b, 0).toLocaleString()}</span>
            </div>
            <div className="p-4 bg-slate-950/50 border border-slate-800/50 rounded-xl">
                <p className="text-[10px] text-slate-500 flex items-center gap-2">
                    <CalcIcon size={12} className="text-teal-500" />
                    Formula: Sum of (Fixed Assets + Preliminary Exp + Margin for WC)
                </p>
            </div>
          </div>
        );
      case 'finance': {
          const mof = formData.means_of_finance;
          const mofTotal = (mof.promoter_contribution || 0) + (mof.unsecured_loans || 0) + (mof.subsidy || 0) + (mof.term_loan || 0) + (mof.other_funding || 0);
          const mofGap   = liveMetrics.totalProjectCost - mofTotal;
          const wcLoan   = mof.working_capital_loan || 0;
          // Functional setState so these never read a stale closure of formData.
          // Balances Means of Finance to Project Cost in BOTH directions:
          //   • short  → promoter equity is topped up to fill the gap
          //   • excess → the term loan is trimmed so sources don't exceed cost
          // (promoter can't go negative, so a promoter-only plug can't fix an
          //  over-funded sheet — which is why the old button looked "dead").
          const autoBalance = () => setFormData(prev => {
            const pc = Object.values(prev.project_cost).reduce((a, b) => a + (b || 0), 0);
            const m = prev.means_of_finance;
            const otherFixed = (m.subsidy || 0) + (m.unsecured_loans || 0) + (m.other_funding || 0);
            let termLoan = m.term_loan || 0;
            let promoter = pc - otherFixed - termLoan;
            if (promoter < 0) {
              // Sources already exceed project cost → trim the term loan to fit
              // and set the promoter margin to the residual (>= 0).
              termLoan = Math.max(0, pc - otherFixed);
              promoter = Math.max(0, pc - otherFixed - termLoan);
            }
            return {
              ...prev,
              means_of_finance: {
                ...m,
                term_loan: Math.round(termLoan),
                promoter_contribution: Math.round(promoter),
              },
            };
          });
          const syncTermLoan = () => setFormData(prev => ({
            ...prev, means_of_finance: { ...prev.means_of_finance, term_loan: prev.loan.amount }
          }));
          const mofRows = [
            { key: 'promoter_contribution', label: 'Promoter Equity / Own Funds', color: 'text-teal-400' },
            { key: 'subsidy',               label: 'Govt Subsidy / Margin Money',  color: 'text-emerald-400' },
            { key: 'term_loan',             label: 'Term Loan from Bank',           color: 'text-blue-400' },
            { key: 'unsecured_loans',       label: 'Unsecured Loans',               color: 'text-amber-400' },
            { key: 'other_funding',         label: 'Other Funding',                 color: 'text-slate-400' },
          ];
          return (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">Step 4 — Means of Finance</h3>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="text-blue-400 border-blue-500/30 text-xs" onClick={syncTermLoan}>
                    ↓ Sync Term Loan from Step 3
                  </Button>
                  <Button type="button" size="sm" className="bg-teal-600 hover:bg-teal-500 text-xs" onClick={autoBalance}>
                    ⚡ Auto-Balance Promoter Equity
                  </Button>
                </div>
              </div>
              <InsightCard insights={insights} />

              {/* MoF Table */}
              <div className="rounded-2xl overflow-hidden border border-slate-700">
                <div className="bg-slate-800/60 grid grid-cols-3 gap-0 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <span>Source</span><span className="text-right">Amount (₹)</span><span className="text-right">% of Cost</span>
                </div>
                {mofRows.map(row => (
                  <div key={row.key} className="grid grid-cols-3 gap-0 px-4 py-3 border-t border-slate-800 items-center">
                    <span className={`text-sm font-semibold ${row.color}`}>{row.label}</span>
                    <div className="flex justify-end">
                      <Input type="number" value={(mof as any)[row.key] || 0}
                        onChange={e => setFormData({...formData, means_of_finance: {...mof, [row.key]: parseFloat(e.target.value) || 0}})}
                        className="w-36 text-right bg-slate-950/50 border-slate-700 font-mono" />
                    </div>
                    <span className="text-right text-xs text-slate-400 font-mono">
                      {liveMetrics.totalProjectCost > 0 ? (((mof as any)[row.key] || 0) / liveMetrics.totalProjectCost * 100).toFixed(1) : '—'}%
                    </span>
                  </div>
                ))}
                <div className="grid grid-cols-3 gap-0 px-4 py-3 border-t border-slate-600 bg-slate-800/40 font-bold">
                  <span>TOTAL (Fixed Project Cost)</span>
                  <span className="text-right font-mono text-teal-400">₹{mofTotal.toLocaleString('en-IN')}</span>
                  <span className="text-right text-xs font-mono text-slate-400">
                    {liveMetrics.totalProjectCost > 0 ? ((mofTotal / liveMetrics.totalProjectCost) * 100).toFixed(1) : '—'}%
                  </span>
                </div>
              </div>

              {/* Balance indicator */}
              {Math.abs(mofGap) > 1 ? (
                <div className="flex items-center justify-between p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl">
                  <div className="flex items-center gap-2 text-rose-400">
                    <AlertCircle size={18} />
                    <span className="text-sm font-bold">MoF gap: ₹{Math.abs(mofGap).toLocaleString('en-IN')} {mofGap > 0 ? 'SHORT' : 'EXCESS'}</span>
                  </div>
                  <Button type="button" size="sm" className="bg-rose-600 hover:bg-rose-500 text-xs" onClick={autoBalance}>Fix Now</Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm font-bold">
                  ✓ Means of Finance is balanced — Project Cost = ₹{liveMetrics.totalProjectCost.toLocaleString('en-IN')}
                </div>
              )}

              {/* D:E + Promoter % summary */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'D:E Ratio', value: liveMetrics.deRatio > 0 ? `${liveMetrics.deRatio.toFixed(2)} : 1` : '—', ok: liveMetrics.deRatio <= 3 },
                  { label: 'Promoter %', value: `${liveMetrics.promoterPct.toFixed(1)}%`, ok: liveMetrics.promoterPct >= 10 },
                  { label: 'Term Loan', value: `₹${(mof.term_loan/100000).toFixed(1)}L`, ok: true },
                  { label: 'WC Bank Loan', value: `₹${(wcLoan/100000).toFixed(1)}L`, ok: true },
                ].map(item => (
                  <div key={item.label} className="p-3 bg-slate-800/40 rounded-xl border border-slate-700 text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">{item.label}</p>
                    <p className={`text-lg font-black mt-1 ${item.ok ? 'text-teal-400' : 'text-rose-400'}`}>{item.value}</p>
                  </div>
                ))}
              </div>

              {/* WC Loan (revolving) */}
              <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl space-y-2">
                <Label className="text-xs font-bold text-amber-400">Working Capital Bank Facility (Revolving — NOT part of project cost)</Label>
                <Input type="number" value={wcLoan}
                  onChange={e => setFormData({...formData, means_of_finance: {...mof, working_capital_loan: parseFloat(e.target.value) || 0}})}
                  className="bg-slate-950/50 border-slate-700 max-w-xs" />
                <p className="text-[10px] text-slate-500">Auto-calculated in Step 9 (WC Norms) → use "Push to MoF" button there.</p>
              </div>

              <div className="p-3 bg-slate-950/50 border border-slate-800 rounded-xl text-[10px] text-slate-500 flex items-center gap-2">
                <CalcIcon size={12} className="text-teal-500 shrink-0" />
                Formula: Promoter Equity + Term Loan + Subsidy + Unsecured Loans = Total Project Cost (must balance exactly). WC is separate revolving facility.
              </div>
            </div>
          );
        }
      case 'historical': {
        const histFields: { key: keyof typeof formData.historical_financials[0]; label: string; section: string }[] = [
          { key: 'year',                  label: 'Financial Year',        section: 'Header' },
          { key: 'sales',                 label: 'Sales / Revenue',       section: 'P&L' },
          { key: 'purchases',             label: 'Purchases / COGS',      section: 'P&L' },
          { key: 'gross_profit',          label: 'Gross Profit',          section: 'P&L' },
          { key: 'salary',                label: 'Salary & Wages',        section: 'P&L' },
          { key: 'rent',                  label: 'Rent',                  section: 'P&L' },
          { key: 'utilities',             label: 'Utilities',             section: 'P&L' },
          { key: 'admin_expenses',        label: 'Admin Expenses',        section: 'P&L' },
          { key: 'marketing',             label: 'Marketing',             section: 'P&L' },
          { key: 'depreciation',          label: 'Depreciation',          section: 'P&L' },
          { key: 'interest',              label: 'Interest Paid',         section: 'P&L' },
          { key: 'tax',                   label: 'Tax',                   section: 'P&L' },
          { key: 'pat',                   label: 'Net Profit (PAT)',      section: 'P&L' },
          { key: 'cash',                  label: 'Cash & Bank',           section: 'Balance Sheet' },
          { key: 'debtors',               label: 'Debtors / Receivables', section: 'Balance Sheet' },
          { key: 'creditors',             label: 'Creditors / Payables',  section: 'Balance Sheet' },
          { key: 'stock',                 label: 'Stock / Inventory',     section: 'Balance Sheet' },
          { key: 'term_loan_outstanding', label: 'Term Loan O/S',         section: 'Balance Sheet' },
          { key: 'wc_outstanding',        label: 'WC Loan O/S',           section: 'Balance Sheet' },
          { key: 'net_fixed_assets',      label: 'Net Fixed Assets',      section: 'Balance Sheet' },
          { key: 'net_worth',             label: 'Net Worth / Equity',    section: 'Balance Sheet' },
        ];
        const emptyHF = { year: String(new Date().getFullYear() - 1), sales: 0, purchases: 0, gross_profit: 0, salary: 0, rent: 0, utilities: 0, admin_expenses: 0, marketing: 0, depreciation: 0, interest: 0, tax: 0, pat: 0, cash: 0, debtors: 0, creditors: 0, stock: 0, term_loan_outstanding: 0, wc_outstanding: 0, net_fixed_assets: 0, net_worth: 0 };
        return (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-bold">Step 5 — Historical Financials</h3>
              <Button onClick={() => setFormData({...formData, historical_financials: [...formData.historical_financials, {...emptyHF}]})} variant="outline" className="border-teal-500/30 text-teal-400">
                <Plus size={18} className="mr-2" /> Add Year
              </Button>
            </div>
            <InsightCard insights={insights} />
            {formData.historical_financials.length === 0 ? (
              <div className="py-12 border-2 border-dashed border-slate-800 rounded-3xl text-center text-slate-500">
                No historical data. Skip for new businesses. Add 2–3 years for existing firms.
              </div>
            ) : (
              <div className="space-y-6">
                {formData.historical_financials.map((hf, idx) => {
                  const update = (key: string, val: number | string) => {
                    const n = [...formData.historical_financials];
                    (n[idx] as any)[key] = typeof val === 'string' ? val : (parseFloat(val as any) || 0);
                    setFormData({...formData, historical_financials: n});
                  };
                  const plFields = histFields.filter(f => f.section === 'P&L' && f.key !== 'year');
                  const bsFields = histFields.filter(f => f.section === 'Balance Sheet');
                  return (
                    <Card key={idx} className="bg-slate-800/40 border-slate-700 rounded-2xl">
                      <CardContent className="p-6 space-y-6">
                        <div className="flex justify-between items-center border-b border-slate-700 pb-4">
                          <div className="flex items-center gap-3">
                            <Label className="text-xs text-slate-400">Financial Year</Label>
                            <Input value={hf.year} onChange={e => update('year', e.target.value)} className="w-28 bg-slate-950/50 border-slate-700 font-bold text-teal-400" />
                          </div>
                          <Button size="sm" variant="ghost" className="text-rose-400" onClick={() => setFormData({...formData, historical_financials: formData.historical_financials.filter((_, i) => i !== idx)})}>
                            <Trash2 size={16} />
                          </Button>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-teal-500 mb-3">Profit & Loss</p>
                          <div className="grid grid-cols-3 gap-3">
                            {plFields.map(f => (
                              <div key={f.key} className="space-y-1">
                                <Label className="text-[10px] uppercase font-semibold text-slate-500">{f.label}</Label>
                                <Input type="number" value={(hf as any)[f.key]} onChange={e => update(f.key, e.target.value)} className="bg-slate-950/50 border-slate-800" />
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-3">Balance Sheet</p>
                          <div className="grid grid-cols-3 gap-3">
                            {bsFields.map(f => (
                              <div key={f.key} className="space-y-1">
                                <Label className="text-[10px] uppercase font-semibold text-slate-500">{f.label}</Label>
                                <Input type="number" value={(hf as any)[f.key]} onChange={e => update(f.key, e.target.value)} className="bg-slate-950/50 border-slate-800" />
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 p-4 bg-slate-950/30 rounded-xl border border-slate-800">
                          <div><p className="text-[10px] text-slate-500">Gross Margin</p><p className="font-bold text-sm text-emerald-400">{hf.sales > 0 ? ((hf.gross_profit / hf.sales) * 100).toFixed(1) : '—'}%</p></div>
                          <div><p className="text-[10px] text-slate-500">Net Margin</p><p className="font-bold text-sm text-teal-400">{hf.sales > 0 ? ((hf.pat / hf.sales) * 100).toFixed(1) : '—'}%</p></div>
                          <div><p className="text-[10px] text-slate-500">Net Worth</p><p className="font-bold text-sm text-white">₹{(hf.net_worth / 100000).toFixed(1)}L</p></div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        );
      }
      case 'products': {
          const updateProduct = (idx: number, key: string, val: any) => {
            const n = [...formData.products];
            (n[idx] as any)[key] = val;
            setFormData({...formData, products: n});
          };
          const totalMonthlyRev  = formData.products.reduce((a, p) => a + p.selling_price * p.monthly_qty, 0);
          const totalMonthlyCOGS = formData.products.reduce((a, p) => a + p.purchase_cost * p.monthly_qty, 0);
          const grossMarginPct   = totalMonthlyRev > 0 ? ((totalMonthlyRev - totalMonthlyCOGS) / totalMonthlyRev * 100) : 0;
          return (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">Step 6 — Revenue Model</h3>
                <Button onClick={() => setFormData({...formData, products: [...formData.products, { product_name: '', unit: 'Nos', purchase_cost: 0, selling_price: 0, monthly_qty: 0, growth_pct: 10 }]})} variant="outline" className="border-teal-500/30 text-teal-400 text-xs">
                  <Plus size={14} className="mr-1" /> Add Product / Service
                </Button>
              </div>
              <InsightCard insights={insights} />

              {/* Product rows */}
              <div className="rounded-2xl overflow-hidden border border-slate-700">
                <div className="bg-slate-800/60 grid grid-cols-12 gap-2 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <span className="col-span-3">Product / Service</span>
                  <span>Unit</span>
                  <span className="text-right">Cost (₹)</span>
                  <span className="text-right">Price (₹)</span>
                  <span className="text-right">Qty/Mo</span>
                  <span className="text-right">Margin%</span>
                  <span className="text-right">Monthly Rev</span>
                  <span className="text-right">Yr Growth%</span>
                  <span className="col-span-2"></span>
                </div>
                {formData.products.map((p, idx) => {
                  const margin = p.selling_price > 0 ? ((p.selling_price - p.purchase_cost) / p.selling_price * 100) : 0;
                  const monthlyRev = p.selling_price * p.monthly_qty;
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-slate-800 items-center">
                      <Input value={p.product_name} onChange={e => updateProduct(idx,'product_name',e.target.value)} placeholder="Product name" className="col-span-3 bg-slate-950/50 border-slate-700 text-xs h-8" />
                      <Input value={p.unit} onChange={e => updateProduct(idx,'unit',e.target.value)} placeholder="Nos" className="bg-slate-950/50 border-slate-700 text-xs h-8" />
                      <Input type="number" value={p.purchase_cost} onChange={e => updateProduct(idx,'purchase_cost',parseFloat(e.target.value)||0)} className="bg-slate-950/50 border-slate-700 text-xs h-8 text-right" />
                      <Input type="number" value={p.selling_price} onChange={e => updateProduct(idx,'selling_price',parseFloat(e.target.value)||0)} className="bg-slate-950/50 border-slate-700 text-xs h-8 text-right" />
                      <Input type="number" value={p.monthly_qty} onChange={e => updateProduct(idx,'monthly_qty',parseFloat(e.target.value)||0)} className="bg-slate-950/50 border-slate-700 text-xs h-8 text-right" />
                      <span className={`text-xs font-bold text-right ${margin >= 20 ? 'text-emerald-400' : margin > 0 ? 'text-amber-400' : 'text-rose-400'}`}>{margin.toFixed(1)}%</span>
                      <span className="text-xs font-mono text-right text-teal-400">₹{(monthlyRev/1000).toFixed(1)}K</span>
                      <Input type="number" value={p.growth_pct} onChange={e => updateProduct(idx,'growth_pct',parseFloat(e.target.value)||0)} className="bg-slate-950/50 border-slate-700 text-xs h-8 text-right" />
                      <Button size="sm" variant="ghost" className="col-span-2 text-rose-400 h-8 text-xs" onClick={() => setFormData({...formData, products: formData.products.filter((_,i) => i !== idx)})}><Trash2 size={14}/></Button>
                    </div>
                  );
                })}
                {formData.products.length === 0 && (
                  <div className="py-8 text-center text-slate-500 text-sm border-t border-slate-800">No products added yet. Click "+ Add Product / Service" above.</div>
                )}
              </div>

              {/* Export / domestic sales split */}
              <div className="p-4 bg-slate-800/40 border border-slate-700 rounded-2xl">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Export Sales (% of turnover)</p>
                    <p className="text-xs text-slate-400">Splits Gross Sales into Domestic vs Export on Form II. Leave 0 for a fully domestic unit.</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Input type="number" min={0} max={100}
                      value={formData.export_sales_pct}
                      onChange={e => setFormData({ ...formData, export_sales_pct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) })}
                      className="w-24 bg-slate-950/50 border-slate-700 text-sm h-9 text-right" />
                    <span className="text-slate-400 text-sm">%</span>
                  </div>
                </div>
                {formData.export_sales_pct > 0 && totalMonthlyRev > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-700 flex justify-between text-xs">
                    <span className="text-slate-400">Domestic ₹{(totalMonthlyRev * 12 * (1 - formData.export_sales_pct/100) / 100000).toFixed(1)}L / yr</span>
                    <span className="text-teal-400">Export ₹{(totalMonthlyRev * 12 * formData.export_sales_pct/100 / 100000).toFixed(1)}L / yr</span>
                  </div>
                )}
              </div>

              {/* Revenue summary grid */}
              {totalMonthlyRev > 0 && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-teal-500/10 border border-teal-500/20 rounded-2xl space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-teal-500">Revenue Summary</p>
                    {[
                      { label: 'Monthly Revenue',  v: `₹${totalMonthlyRev.toLocaleString('en-IN')}` },
                      { label: 'Annual Revenue',   v: `₹${(totalMonthlyRev*12/100000).toFixed(1)}L` },
                      { label: 'Monthly COGS',     v: `₹${totalMonthlyCOGS.toLocaleString('en-IN')}` },
                      { label: 'Gross Margin',     v: `${grossMarginPct.toFixed(1)}%` },
                    ].map(row => (
                      <div key={row.label} className="flex justify-between text-sm">
                        <span className="text-slate-400">{row.label}</span>
                        <span className="font-bold text-white">{row.v}</span>
                      </div>
                    ))}
                  </div>
                  <div className="p-4 bg-slate-800/40 border border-slate-700 rounded-2xl space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Capacity Utilisation</p>
                    {[50, 70, 100].map(cap => (
                      <div key={cap} className="flex justify-between text-sm">
                        <span className="text-slate-400">{cap}% Capacity</span>
                        <span className="font-mono font-bold text-white">₹{(totalMonthlyRev * cap / 100 * 12 / 100000).toFixed(1)}L / yr</span>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-slate-700 flex justify-between text-sm">
                      <span className="text-slate-400">Break-even target</span>
                      <span className="font-mono font-bold text-amber-400">
                        {(liveMetrics.monthlyPayroll + liveMetrics.monthlyOpex) > 0
                          ? `₹${((liveMetrics.monthlyPayroll + liveMetrics.monthlyOpex) / 100000).toFixed(1)}L / mo`
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        }
      case 'manpower': {
          const totalMonthlyPayroll = formData.manpower.reduce((a, m) => a + m.monthly_salary * m.headcount, 0);
          const annualPayrollY1 = totalMonthlyPayroll * 12;
          const payrollPctRev = liveMetrics.monthlyRevenue > 0 ? (totalMonthlyPayroll / liveMetrics.monthlyRevenue) * 100 : 0;
          const updateManpower = (idx: number, key: string, val: any) => {
            const n = [...formData.manpower];
            (n[idx] as any)[key] = val;
            setFormData({...formData, manpower: n});
          };
          return (
            <div className="space-y-5">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold">Step 7 — Manpower & Payroll</h3>
                <Button onClick={() => setFormData({...formData, manpower: [...formData.manpower, { designation: '', headcount: 1, monthly_salary: 15000, annual_increment_pct: 8 }]})} variant="outline" className="border-teal-500/30 text-teal-400 text-xs">
                  <Plus size={14} className="mr-1" /> Add Staff Category
                </Button>
              </div>
              <InsightCard insights={insights} />

              {/* Manpower table */}
              <div className="rounded-2xl overflow-hidden border border-slate-700">
                <div className="bg-slate-800/60 grid grid-cols-12 gap-2 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <span className="col-span-4">Designation / Category</span>
                  <span className="text-right">Count</span>
                  <span className="col-span-2 text-right">Salary / Head (₹/mo)</span>
                  <span className="col-span-2 text-right">Increment %</span>
                  <span className="col-span-2 text-right">Monthly Cost</span>
                  <span></span>
                </div>
                {formData.manpower.map((m, idx) => {
                  const rowCost = m.monthly_salary * m.headcount;
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-slate-800 items-center">
                      <Input value={m.designation} onChange={e => updateManpower(idx, 'designation', e.target.value)} placeholder="e.g. Skilled Worker" className="col-span-4 bg-slate-950/50 border-slate-700 text-xs h-8" />
                      <Input type="number" value={m.headcount} onChange={e => updateManpower(idx, 'headcount', parseInt(e.target.value) || 0)} className="bg-slate-950/50 border-slate-700 text-xs h-8 text-right" />
                      <Input type="number" value={m.monthly_salary} onChange={e => updateManpower(idx, 'monthly_salary', parseFloat(e.target.value) || 0)} className="col-span-2 bg-slate-950/50 border-slate-700 text-xs h-8 text-right" />
                      <div className="col-span-2 flex items-center gap-1">
                        <Input type="number" value={m.annual_increment_pct} onChange={e => updateManpower(idx, 'annual_increment_pct', parseFloat(e.target.value) || 0)} className="bg-slate-950/50 border-slate-700 text-xs h-8 text-right" />
                        <span className="text-slate-500 text-xs">%</span>
                      </div>
                      <span className="col-span-2 text-xs font-mono font-bold text-right text-emerald-400">₹{rowCost.toLocaleString('en-IN')}</span>
                      <Button size="sm" variant="ghost" className="text-rose-400 h-8 px-1" onClick={() => setFormData({...formData, manpower: formData.manpower.filter((_,i) => i !== idx)})}><Trash2 size={14}/></Button>
                    </div>
                  );
                })}
                {formData.manpower.length === 0 && (
                  <div className="py-8 text-center text-slate-500 text-sm border-t border-slate-800">No staff added yet.</div>
                )}
                <div className="grid grid-cols-12 gap-2 px-3 py-3 border-t border-slate-600 bg-slate-800/40 font-bold text-sm">
                  <span className="col-span-4">TOTAL HEADCOUNT</span>
                  <span className="text-right text-teal-400">{formData.manpower.reduce((a,m) => a + m.headcount, 0)}</span>
                  <span className="col-span-2"></span><span className="col-span-2"></span>
                  <span className="col-span-2 text-right font-mono text-emerald-400">₹{totalMonthlyPayroll.toLocaleString('en-IN')}</span>
                  <span></span>
                </div>
              </div>

              {/* Payroll projection (Year 1–3) */}
              {totalMonthlyPayroll > 0 && (
                <div className="rounded-2xl border border-slate-700 overflow-hidden">
                  <div className="bg-slate-800/60 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400 grid grid-cols-5 gap-2">
                    <span className="col-span-2">Projection</span>
                    {[1,2,3].map(y => <span key={y} className="text-right">Year {y}</span>)}
                  </div>
                  {formData.manpower.map((m, idx) => {
                    const rowY1 = m.monthly_salary * m.headcount * 12;
                    const inc = 1 + (m.annual_increment_pct || 0) / 100;
                    return (
                      <div key={idx} className="grid grid-cols-5 gap-2 px-4 py-2 border-t border-slate-800 text-xs items-center">
                        <span className="col-span-2 text-slate-400 truncate">{m.designation || `Category ${idx+1}`} ×{m.headcount}</span>
                        <span className="text-right font-mono text-white">₹{(rowY1/100000).toFixed(1)}L</span>
                        <span className="text-right font-mono text-slate-300">₹{(rowY1*inc/100000).toFixed(1)}L</span>
                        <span className="text-right font-mono text-slate-300">₹{(rowY1*inc*inc/100000).toFixed(1)}L</span>
                      </div>
                    );
                  })}
                  <div className="grid grid-cols-5 gap-2 px-4 py-3 border-t border-slate-600 bg-slate-800/40 font-bold text-xs">
                    <span className="col-span-2 text-slate-300">TOTAL PAYROLL (Annual)</span>
                    {[0,1,2].map(yr => {
                      const total = formData.manpower.reduce((a, m) => {
                        const inc = 1 + (m.annual_increment_pct || 0) / 100;
                        return a + m.monthly_salary * m.headcount * 12 * Math.pow(inc, yr);
                      }, 0);
                      return <span key={yr} className="text-right font-mono text-emerald-400">₹{(total/100000).toFixed(1)}L</span>;
                    })}
                  </div>
                </div>
              )}

              {/* Summary metrics */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Monthly Payroll', value: `₹${totalMonthlyPayroll.toLocaleString('en-IN')}`, color: 'text-emerald-400' },
                  { label: 'Annual (Yr 1)', value: `₹${(annualPayrollY1/100000).toFixed(1)}L`, color: 'text-teal-400' },
                  { label: '% of Revenue', value: payrollPctRev > 0 ? `${payrollPctRev.toFixed(1)}%` : '—', color: payrollPctRev > 40 ? 'text-rose-400' : payrollPctRev > 25 ? 'text-amber-400' : 'text-emerald-400' },
                ].map(item => (
                  <div key={item.label} className="p-3 bg-slate-800/40 rounded-xl border border-slate-700 text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">{item.label}</p>
                    <p className={`text-lg font-black mt-1 ${item.color}`}>{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        }
      case 'opex':
          return (
              <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-bold">Step 8 — Operating Expenses</h3>
                    <p className="text-xs text-amber-400/90 mt-1">
                      ⚠️ Enter each expense as a <b>MONTHLY</b> amount — the engine annualises it (×12) in all projections.
                    </p>
                  </div>
                  <InsightCard insights={insights} />
                  <div className="grid grid-cols-3 gap-4">
                      {Object.entries(formData.opex).map(([key, value]) => (
                          <div key={key} className="space-y-1">
                              <Label className="capitalize text-xs font-semibold text-slate-500">{key.replace(/_/g, ' ')} <span className="text-slate-600 normal-case">(₹/mo)</span></Label>
                              <Input type="number" value={value as number} placeholder="₹ / month" onChange={e => setFormData({...formData, opex: {...formData.opex, [key]: parseFloat(e.target.value) || 0}})} />
                          </div>
                      ))}
                  </div>
                  <div className="p-6 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex justify-between items-center mt-6">
                      <span className="font-bold text-lg">Total Monthly Opex</span>
                      <span className="text-3xl font-black text-amber-400">₹ {Object.values(formData.opex).reduce((a, b) => a + (b as number), 0).toLocaleString()}</span>
                  </div>
              </div>
          );
      case 'wc_norms': {
          const wcCalc = computeWCFromNorms(formData, liveMetrics);
          const normLabels: Record<string, { label: string; tip: string }> = {
            rm_holding_days:   { label: 'Raw Material Holding',  tip: 'Days of RM stock kept. Manufacturing: 45–90 days; Trading: 15–30 days.' },
            wip_days:          { label: 'WIP / Processing Days', tip: 'Time to convert RM to finished goods. Service: 0 days.' },
            fg_days:           { label: 'Finished Goods Stock',  tip: 'Days of FG kept before sale. Standard: 15–30 days.' },
            receivable_days:   { label: 'Debtor Collection Days',tip: 'Credit period given to customers. RBI norm: ≤90 days.' },
            creditor_days:     { label: 'Creditor Payment Days', tip: 'Credit period received from suppliers. Reduces WC need.' },
            cash_holding_days: { label: 'Cash/Buffer Days',      tip: 'Operating cash cushion. Standard: 7–15 days.' },
          };
          const pushWCToMoF = () => {
            setFormData({...formData, means_of_finance: {...formData.means_of_finance, working_capital_loan: wcCalc.bankFinance}});
          };
          return (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">Step 9 — WC Norms (Tandon Method II)</h3>
                <Button size="sm" className="bg-teal-600 hover:bg-teal-500 text-xs gap-1" onClick={pushWCToMoF}>
                  <Zap size={12} /> Push WC Finance to MoF
                </Button>
              </div>
              <InsightCard insights={insights} />

              {/* Sliders */}
              <div className="grid grid-cols-2 gap-6">
                {Object.entries(formData.wc_norms).map(([key, value]) => {
                  const meta = normLabels[key] || { label: key.replace(/_/g,' '), tip: '' };
                  return (
                    <div key={key} className="space-y-3 p-4 bg-slate-800/40 border border-slate-700 rounded-2xl">
                      <div className="flex justify-between items-center">
                        <div>
                          <Label className="font-bold text-slate-200 text-sm">{meta.label}</Label>
                          {meta.tip && <p className="text-[10px] text-slate-500 mt-0.5">{meta.tip}</p>}
                        </div>
                        <span className="text-teal-400 font-black text-xl">{value}<span className="text-xs font-normal text-slate-500 ml-1">days</span></span>
                      </div>
                      <Slider
                        value={[value as number]}
                        max={key === 'cash_holding_days' ? 30 : 180}
                        step={1}
                        onValueChange={vals => setFormData({...formData, wc_norms: {...formData.wc_norms, [key]: vals[0]}})}
                        className="py-2"
                      />
                    </div>
                  );
                })}
              </div>

              {/* Tandon Method II WC Breakdown */}
              {liveMetrics.monthlyRevenue > 0 && (
                <div className="rounded-2xl border border-slate-700 overflow-hidden">
                  <div className="bg-slate-800/60 px-4 py-2.5 text-[9px] font-black uppercase tracking-widest text-slate-400 grid grid-cols-3 gap-2">
                    <span className="col-span-2">Working Capital Component</span>
                    <span className="text-right">Amount (₹)</span>
                  </div>
                  {[
                    { label: 'Raw Material Stock',     val: wcCalc.rmHolding,   color: 'text-slate-300' },
                    { label: 'Work-in-Progress',        val: wcCalc.wipHolding,  color: 'text-slate-300' },
                    { label: 'Finished Goods Stock',    val: wcCalc.fgHolding,   color: 'text-slate-300' },
                    { label: 'Debtors / Receivables',   val: wcCalc.debtors,     color: 'text-slate-300' },
                    { label: 'Cash & Buffer',           val: wcCalc.cashNeeded,  color: 'text-slate-300' },
                  ].map(row => (
                    <div key={row.label} className="grid grid-cols-3 gap-2 px-4 py-2 border-t border-slate-800 text-xs">
                      <span className={`col-span-2 ${row.color}`}>{row.label}</span>
                      <span className="text-right font-mono text-white">₹{Math.round(row.val).toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                  <div className="grid grid-cols-3 gap-2 px-4 py-2 border-t border-slate-700 bg-slate-800/40 text-xs font-bold">
                    <span className="col-span-2 text-teal-400">Gross Working Capital</span>
                    <span className="text-right font-mono text-teal-400">₹{Math.round(wcCalc.grossWC).toLocaleString('en-IN')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-4 py-2 border-t border-slate-800 text-xs">
                    <span className="col-span-2 text-rose-400">Less: Creditors (Sundry)</span>
                    <span className="text-right font-mono text-rose-400">–₹{Math.round(wcCalc.creditors).toLocaleString('en-IN')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-4 py-2 border-t border-slate-700 bg-slate-800/40 text-xs font-bold">
                    <span className="col-span-2 text-amber-400">Net Working Capital (NWC)</span>
                    <span className="text-right font-mono text-amber-400">₹{Math.round(wcCalc.netWC).toLocaleString('en-IN')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-4 py-2.5 border-t border-slate-600 bg-teal-500/10 text-sm font-black">
                    <span className="col-span-2 text-teal-300">Bank Finance — 75% of NWC</span>
                    <span className="text-right font-mono text-teal-300">₹{wcCalc.bankFinance.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-4 py-2 border-t border-slate-700 text-xs bg-slate-800/20">
                    <span className="col-span-2 text-slate-400">Promoter Margin — 25% of NWC</span>
                    <span className="text-right font-mono text-slate-400">₹{wcCalc.promoterMargin.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              )}

              <div className="p-3 bg-slate-950/50 border border-slate-800 rounded-xl text-[10px] text-slate-500 flex items-start gap-2">
                <Info size={12} className="text-teal-500 shrink-0 mt-0.5" />
                <span>Tandon Committee Method II: Bank finances 75% of Net Working Capital Gap. Promoter contributes remaining 25% as margin money. Click "Push WC Finance to MoF" to sync the bank finance figure to Step 4.</span>
              </div>
            </div>
          );
        }
      case 'depreciation':
          return (
              <div className="space-y-6">
                  <h3 className="text-xl font-bold">Step 10 — Depreciation Rates</h3>
                  <InsightCard insights={insights} />
                  <div className="grid grid-cols-2 gap-4">
                      {Object.entries(formData.depreciation_rates).map(([key, value]) => (
                          <div key={key} className="p-4 bg-slate-800/40 border border-slate-700 rounded-2xl flex justify-between items-center">
                              <Label className="capitalize font-bold">{key.replace(/_/g, ' ')}</Label>
                              <div className="flex items-center gap-2">
                                  <Input type="number" value={value} onChange={e => setFormData({...formData, depreciation_rates: {...formData.depreciation_rates, [key]: parseFloat(e.target.value) || 0}})} className="w-20 text-center font-bold text-teal-400" />
                                  <span className="text-slate-500">%</span>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>
          );
      case 'net_worth':
          return (
              <div className="space-y-6">
                  <h3 className="text-xl font-bold">Step 12 — Promoter Net Worth</h3>
                  <InsightCard insights={insights} />
                  <div className="grid grid-cols-2 gap-4">
                      {Object.entries(formData.promoter_net_worth).map(([key, value]) => (
                          <div key={key} className="space-y-1">
                              <Label className="capitalize text-xs font-semibold text-slate-500">{key.replace(/_/g, ' ')}</Label>
                              <Input type="number" value={value as number} onChange={e => setFormData({...formData, promoter_net_worth: {...formData.promoter_net_worth, [key]: parseFloat(e.target.value) || 0}})} />
                          </div>
                      ))}
                  </div>
                  <div className="p-6 bg-teal-500/10 border border-teal-500/20 rounded-2xl flex justify-between items-center mt-6">
                      <span className="font-bold text-lg">Total Promoter Net Worth</span>
                      <span className="text-3xl font-black text-teal-400">₹ {(Object.entries(formData.promoter_net_worth).reduce((a, [k, v]) => k === 'liabilities' ? a - (v as number) : a + (v as number), 0)).toLocaleString()}</span>
                  </div>
              </div>
          );
      case 'guarantor':
          return (
            <div className="space-y-6">
              <h3 className="text-xl font-bold">Step 13 — Guarantor Details</h3>
              <InsightCard insights={insights} />
              <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300 flex items-start gap-2">
                <Info size={14} className="mt-0.5 shrink-0" />
                <span>Guarantor is optional for CGTMSE-covered loans. Required when collateral is pledged or promoter net worth is insufficient. Details appear on the CMA cover page.</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 col-span-2">
                  <Label>Guarantor Full Name</Label>
                  <Input
                    value={formData.guarantor?.name || ''}
                    placeholder="Enter guarantor's full legal name"
                    onChange={e => setFormData({...formData, guarantor: {...(formData.guarantor || {name:'',relation:'',net_worth:0}), name: e.target.value}})}
                    className="bg-slate-950/50 border-slate-800"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Relationship to Promoter</Label>
                  <Select
                    value={formData.guarantor?.relation || ''}
                    onValueChange={v => setFormData({...formData, guarantor: {...(formData.guarantor || {name:'',relation:'',net_worth:0}), relation: v}})}
                  >
                    <SelectTrigger className="bg-slate-950/50 border-slate-800"><SelectValue placeholder="Select relation" /></SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-800 text-white">
                      {['Spouse','Father','Mother','Brother','Sister','Business Partner','Friend','Other'].map(r => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Guarantor Net Worth (₹)</Label>
                  <Input
                    type="number"
                    value={formData.guarantor?.net_worth || 0}
                    onChange={e => setFormData({...formData, guarantor: {...(formData.guarantor || {name:'',relation:'',net_worth:0}), net_worth: parseFloat(e.target.value) || 0}})}
                    className="bg-slate-950/50 border-slate-800"
                  />
                </div>
              </div>
              {(formData.guarantor?.net_worth || 0) > 0 && (
                <div className="p-4 bg-teal-500/10 border border-teal-500/20 rounded-xl flex justify-between items-center">
                  <span className="text-sm font-semibold text-slate-300">Combined Coverage (Promoter + Guarantor Net Worth)</span>
                  <span className="text-xl font-black text-teal-400">
                    ₹{((liveMetrics.netWorth + (formData.guarantor?.net_worth || 0)) / 100000).toFixed(1)}L
                  </span>
                </div>
              )}
            </div>
          );
      case 'collateral': {
          const col = formData.collateral || { primary_security: '', collateral_items: [], cgtmse_covered: false, cgtmse_coverage_pct: 75, cgtmse_fee_pct: 1, insurance_arranged: false };
          const setCol = (patch: Partial<typeof col>) => setFormData({...formData, collateral: {...col, ...patch}});
          const totalMarketVal = col.collateral_items.reduce((a, c) => a + c.market_value, 0);
          const totalFSV       = col.collateral_items.reduce((a, c) => a + c.forced_sale_value, 0);
          const coverageRatio  = liveMetrics.termLoan > 0 ? totalFSV / liveMetrics.termLoan : 0;
          return (
            <div className="space-y-5">
              <h3 className="text-xl font-bold">Step 14 — Collateral &amp; Security</h3>
              <InsightCard insights={insights} />

              {/* Primary Security */}
              <div className="p-4 bg-slate-800/40 border border-slate-700 rounded-2xl space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-500">Primary Security (Hypothecation)</p>
                <Input
                  value={col.primary_security}
                  placeholder="e.g. Hypothecation of Plant & Machinery, Stocks and Book Debts"
                  onChange={e => setCol({ primary_security: e.target.value })}
                  className="bg-slate-950/50 border-slate-700"
                />
                <p className="text-[10px] text-slate-500">Standard: Hypothecation of all assets created from bank finance — stocks, debtors, plant & machinery.</p>
              </div>

              {/* Collateral Items Table */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Collateral / Secondary Security</p>
                  <Button size="sm" variant="outline" className="border-teal-500/30 text-teal-400 text-xs"
                    onClick={() => setCol({ collateral_items: [...col.collateral_items, { type: 'Property', description: '', market_value: 0, forced_sale_value: 0, owner: '' }] })}>
                    <Plus size={12} className="mr-1" /> Add Collateral
                  </Button>
                </div>
                {col.collateral_items.length > 0 && (
                  <div className="rounded-xl overflow-hidden border border-slate-700">
                    <div className="bg-slate-800/60 grid grid-cols-12 gap-1 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      <span className="col-span-2">Type</span>
                      <span className="col-span-3">Description</span>
                      <span className="col-span-2">Owner</span>
                      <span className="col-span-2 text-right">Market Val</span>
                      <span className="col-span-2 text-right">FSV (₹)</span>
                      <span></span>
                    </div>
                    {col.collateral_items.map((item, idx) => {
                      const upd = (key: string, val: any) => {
                        const n = [...col.collateral_items]; (n[idx] as any)[key] = val; setCol({ collateral_items: n });
                      };
                      return (
                        <div key={idx} className="grid grid-cols-12 gap-1 px-3 py-2 border-t border-slate-800 items-center">
                          <Select value={item.type} onValueChange={v => upd('type', v)}>
                            <SelectTrigger className="col-span-2 bg-slate-950/50 border-slate-700 text-xs h-8"><SelectValue /></SelectTrigger>
                            <SelectContent className="bg-slate-900 border-slate-700 text-white">
                              {['Property','FD/NSC','Shares','Gold','Vehicle','Other'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Input value={item.description} onChange={e => upd('description', e.target.value)} placeholder="Address/details" className="col-span-3 bg-slate-950/50 border-slate-700 text-xs h-8" />
                          <Input value={item.owner} onChange={e => upd('owner', e.target.value)} placeholder="Owner name" className="col-span-2 bg-slate-950/50 border-slate-700 text-xs h-8" />
                          <Input type="number" value={item.market_value} onChange={e => upd('market_value', parseFloat(e.target.value)||0)} className="col-span-2 bg-slate-950/50 border-slate-700 text-xs h-8 text-right" />
                          <Input type="number" value={item.forced_sale_value} onChange={e => upd('forced_sale_value', parseFloat(e.target.value)||0)} className="col-span-2 bg-slate-950/50 border-slate-700 text-xs h-8 text-right" />
                          <Button size="sm" variant="ghost" className="text-rose-400 h-8 px-1" onClick={() => setCol({ collateral_items: col.collateral_items.filter((_,i)=>i!==idx) })}><Trash2 size={12}/></Button>
                        </div>
                      );
                    })}
                    <div className="grid grid-cols-12 gap-1 px-3 py-2 border-t border-slate-600 bg-slate-800/40 text-xs font-bold">
                      <span className="col-span-7 text-slate-300">TOTALS</span>
                      <span className="col-span-2 text-right text-teal-400">₹{(totalMarketVal/100000).toFixed(1)}L</span>
                      <span className="col-span-2 text-right text-amber-400">₹{(totalFSV/100000).toFixed(1)}L</span>
                      <span></span>
                    </div>
                  </div>
                )}
              </div>

              {/* CGTMSE + Insurance */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-800/40 border border-slate-700 rounded-2xl space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">CGTMSE Coverage</p>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setCol({ cgtmse_covered: !col.cgtmse_covered })}
                      className={`w-10 h-5 rounded-full transition-colors ${col.cgtmse_covered ? 'bg-teal-500' : 'bg-slate-600'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full mx-auto transition-transform ${col.cgtmse_covered ? 'translate-x-2.5' : '-translate-x-2.5'}`}></div>
                    </button>
                    <span className="text-sm font-semibold">{col.cgtmse_covered ? 'Covered' : 'Not Covered'}</span>
                  </div>
                  {col.cgtmse_covered && (
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-400">Coverage %</Label>
                      <Select value={String(col.cgtmse_coverage_pct)} onValueChange={v => setCol({ cgtmse_coverage_pct: Number(v) })}>
                        <SelectTrigger className="bg-slate-950/50 border-slate-700 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-slate-900 border-slate-700 text-white">
                          {[50,75,85].map(p => <SelectItem key={p} value={String(p)}>{p}% (Up to ₹{p===85?'5L':p===75?'2Cr':'5Cr'})</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Label className="text-xs text-slate-400 pt-1">Annual Guarantee Fee (% p.a.)</Label>
                      <div className="flex items-center gap-2">
                        <Input type="number" step="0.01" min={0} max={5}
                          value={col.cgtmse_fee_pct ?? 1}
                          onChange={e => setCol({ cgtmse_fee_pct: Math.min(5, Math.max(0, parseFloat(e.target.value) || 0)) })}
                          className="bg-slate-950/50 border-slate-700 text-xs h-8 w-24 text-right" />
                        <span className="text-[10px] text-slate-500">charged on TL outstanding; flows into the P&L (Form II)</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="p-4 bg-slate-800/40 border border-slate-700 rounded-2xl space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Insurance</p>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setCol({ insurance_arranged: !col.insurance_arranged })}
                      className={`w-10 h-5 rounded-full transition-colors ${col.insurance_arranged ? 'bg-teal-500' : 'bg-slate-600'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full mx-auto transition-transform ${col.insurance_arranged ? 'translate-x-2.5' : '-translate-x-2.5'}`}></div>
                    </button>
                    <span className="text-sm font-semibold">{col.insurance_arranged ? 'Arranged' : 'Pending'}</span>
                  </div>
                  <p className="text-[10px] text-slate-500">Banks require fire & allied perils insurance on hypothecated assets, assigned to the bank.</p>
                </div>
              </div>

              {/* Coverage Summary */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Collateral FSV', value: `₹${(totalFSV/100000).toFixed(1)}L`, ok: totalFSV > 0 },
                  { label: 'Coverage Ratio (FSV/TL)', value: coverageRatio > 0 ? `${coverageRatio.toFixed(2)}x` : '—', ok: coverageRatio >= 1 || col.cgtmse_covered },
                  { label: 'CGTMSE', value: col.cgtmse_covered ? `${col.cgtmse_coverage_pct}% Covered` : 'Not Covered', ok: col.cgtmse_covered },
                ].map(item => (
                  <div key={item.label} className="p-3 bg-slate-800/40 rounded-xl border border-slate-700 text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">{item.label}</p>
                    <p className={`text-base font-black mt-1 ${item.ok ? 'text-teal-400' : 'text-amber-400'}`}>{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        }
      case 'assumptions': {
          const projection = compute5YearProjection(formData, liveMetrics);
          const assumptionMeta: Record<string, { label: string; tip: string; max: number }> = {
            revenue_growth:   { label: 'Revenue Growth / Year',    tip: 'Acceptable: 10–20%. Above 25% requires justification.', max: 50 },
            cogs_growth:      { label: 'COGS Growth / Year',       tip: 'Usually tracks raw material inflation. Typical: 5–10%.', max: 30 },
            expense_growth:   { label: 'Opex Growth / Year',       tip: 'Admin/utility cost escalation. Typical: 5–8%.', max: 30 },
            salary_increment: { label: 'Salary Increment / Year',  tip: 'Annual increment for manpower. Typical: 8–10%.', max: 30 },
          };
          const dscrColor = (d: number) => d >= 1.5 ? 'text-emerald-400' : d >= 1.25 ? 'text-amber-400' : 'text-rose-400';
          const pnlRows: { key: keyof typeof projection[0]; label: string; bold?: boolean; indent?: boolean }[] = [
            { key: 'revenue',      label: 'Revenue (Gross Sales)',       bold: true },
            { key: 'cogs',         label: 'Less: COGS / Purchases',      indent: true },
            { key: 'grossProfit',  label: 'Gross Profit',                bold: true },
            { key: 'salary',       label: 'Less: Salary & Wages',        indent: true },
            { key: 'opex',         label: 'Less: Operating Expenses',    indent: true },
            { key: 'ebitda',       label: 'EBITDA',                      bold: true },
            { key: 'depr',         label: 'Less: Depreciation',          indent: true },
            { key: 'interest',     label: 'Less: Interest',              indent: true },
            { key: 'pat',          label: 'Net Profit (PAT)',             bold: true },
            { key: 'cashAccruals', label: 'Cash Accruals (PAT + Depr)',  bold: true },
            { key: 'debtService',  label: 'Debt Service (EMI)',           indent: true },
          ];
          return (
            <div className="space-y-5">
              <h3 className="text-xl font-bold">Step 14 — Growth Assumptions & 5-Year Projections</h3>
              <InsightCard insights={insights} />

              {/* Growth assumption sliders */}
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(formData.assumptions).filter(([k]) => assumptionMeta[k]).map(([key, value]) => {
                  const meta = assumptionMeta[key];
                  return (
                    <div key={key} className="p-4 bg-slate-800/40 border border-slate-700 rounded-2xl space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <Label className="font-bold text-slate-200 text-sm">{meta.label}</Label>
                          <p className="text-[10px] text-slate-500 mt-0.5">{meta.tip}</p>
                        </div>
                        <span className={`font-black text-xl ${(value as number) > 25 ? 'text-amber-400' : 'text-teal-400'}`}>{value}<span className="text-xs font-normal text-slate-500 ml-0.5">%</span></span>
                      </div>
                      <Slider
                        value={[value as number]}
                        max={meta.max}
                        step={0.5}
                        onValueChange={vals => setFormData({...formData, assumptions: {...formData.assumptions, [key]: vals[0]}})}
                        className="py-2"
                      />
                    </div>
                  );
                })}
                {/* Tax rate */}
                <div className="p-4 bg-slate-800/40 border border-slate-700 rounded-2xl space-y-2">
                  <div className="flex justify-between items-center">
                    <Label className="font-bold text-slate-200 text-sm">Income Tax Rate</Label>
                    <span className="text-teal-400 font-black text-xl">{formData.tax_rate ?? 25}<span className="text-xs font-normal text-slate-500 ml-0.5">%</span></span>
                  </div>
                  <Slider
                    value={[formData.tax_rate ?? 25]}
                    min={0} max={40} step={1}
                    onValueChange={vals => setFormData({...formData, tax_rate: vals[0]})}
                    className="py-2"
                  />
                  <p className="text-[10px] text-slate-500">Proprietorship/Partnership: 30%. New Pvt Ltd (concessional): 22%.</p>
                </div>
              </div>

              {/* 5-Year P&L Projection */}
              {projection.length > 0 && liveMetrics.annualRevenue > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">5-Year Projected P&L</p>
                  <div className="rounded-2xl border border-slate-700 overflow-hidden text-xs">
                    <div className="bg-slate-800/60 grid grid-cols-7 gap-0 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      <span className="col-span-2 px-3 py-2 border-r border-slate-700">Line Item</span>
                      {[1,2,3,4,5].map(y => <span key={y} className="px-2 py-2 text-right border-r border-slate-700 last:border-0">Yr {y}</span>)}
                    </div>
                    {pnlRows.map(row => (
                      <div key={String(row.key)} className={`grid grid-cols-7 gap-0 border-t border-slate-800 ${row.bold ? 'bg-slate-800/30' : ''}`}>
                        <span className={`col-span-2 px-3 py-2 border-r border-slate-700 ${row.bold ? 'font-bold text-teal-300' : 'text-slate-400 pl-5'}`}>{row.label}</span>
                        {projection.map((yr) => {
                          const v = yr[row.key] as number;
                          const isNeg = v < 0;
                          return (
                            <span key={yr.yr} className={`px-2 py-2 text-right font-mono border-r border-slate-800 last:border-0 ${row.bold ? 'font-bold' : ''} ${row.key === 'pat' && isNeg ? 'text-rose-400' : row.bold ? 'text-white' : 'text-slate-400'}`}>
                              {isNeg ? `(${fmt(Math.abs(v))})` : fmt(v)}
                            </span>
                          );
                        })}
                      </div>
                    ))}
                    {/* DSCR row */}
                    <div className="grid grid-cols-7 gap-0 border-t border-slate-600 bg-slate-950/60">
                      <span className="col-span-2 px-3 py-2.5 border-r border-slate-700 font-black text-amber-300">DSCR</span>
                      {projection.map(yr => (
                        <span key={yr.yr} className={`px-2 py-2.5 text-right font-black font-mono border-r border-slate-800 last:border-0 ${dscrColor(yr.dscr)}`}>
                          {yr.dscr > 0 ? yr.dscr.toFixed(2) : '—'}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>DSCR ≥ 1.50 — Excellent</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>1.25–1.50 — Acceptable</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block"></span>Below 1.25 — Risk</span>
                  </div>
                </div>
              )}

              {liveMetrics.annualRevenue === 0 && (
                <div className="py-10 border-2 border-dashed border-slate-800 rounded-2xl text-center text-slate-500 text-sm">
                  Add products and revenue in Step 6 to see 5-year projections here.
                </div>
              )}

              {/* Sensitivity Analysis */}
              {liveMetrics.annualRevenue > 0 && (() => {
                const sensitivity = computeSensitivity(formData, liveMetrics);
                return (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Sensitivity Analysis — DSCR Impact at Revenue Scenarios</p>
                    <div className="rounded-2xl border border-slate-700 overflow-hidden text-xs">
                      <div className="bg-slate-800/60 grid grid-cols-6 gap-0 text-[9px] font-black uppercase tracking-widest text-slate-400">
                        {['Revenue Scenario','Revenue','COGS','EBITDA','PAT','DSCR'].map((h,i) => (
                          <span key={i} className={`px-3 py-2 border-r border-slate-700 last:border-0 ${i > 0 ? 'text-right' : ''}`}>{h}</span>
                        ))}
                      </div>
                      {sensitivity.map((row, i) => {
                        const isBase = row.pct === 0;
                        const dc = row.dscr >= 1.5 ? 'text-emerald-400' : row.dscr >= 1.25 ? 'text-amber-400' : 'text-rose-400';
                        return (
                          <div key={i} className={`grid grid-cols-6 gap-0 border-t border-slate-800 ${isBase ? 'bg-teal-500/5' : ''}`}>
                            <span className={`px-3 py-2 border-r border-slate-700 font-bold ${isBase ? 'text-teal-400' : row.pct < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                              {isBase ? 'Base Case' : `${row.pct > 0 ? '+' : ''}${row.pct}%`}
                            </span>
                            <span className="px-3 py-2 text-right border-r border-slate-700 font-mono text-slate-300">{fmt(row.revenue)}</span>
                            <span className="px-3 py-2 text-right border-r border-slate-700 font-mono text-slate-400">{fmt(row.cogs)}</span>
                            <span className={`px-3 py-2 text-right border-r border-slate-700 font-mono ${row.ebitda < 0 ? 'text-rose-400' : 'text-slate-300'}`}>{row.ebitda < 0 ? `(${fmt(Math.abs(row.ebitda))})` : fmt(row.ebitda)}</span>
                            <span className={`px-3 py-2 text-right border-r border-slate-700 font-mono ${row.pat < 0 ? 'text-rose-400' : 'text-slate-300'}`}>{row.pat < 0 ? `(${fmt(Math.abs(row.pat))})` : fmt(row.pat)}</span>
                            <span className={`px-3 py-2 text-right font-black font-mono ${dc}`}>{row.dscr > 0 ? row.dscr.toFixed(2) : '—'}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2">Banks run stress scenarios at -20% and -30% revenue. DSCR must stay above 1.00 even at worst case.</p>
                  </div>
                );
              })()}

              {/* Break-Even */}
              {liveMetrics.annualRevenue > 0 && (() => {
                const bep = computeBreakEven(formData, liveMetrics);
                return (
                  <div className="p-4 bg-slate-800/40 border border-slate-700 rounded-2xl">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Break-Even Analysis</p>
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: 'BEP Monthly Revenue', value: fmt(bep.bepMonthlyRevenue), ok: bep.bepMonthlyRevenue < liveMetrics.monthlyRevenue },
                        { label: 'BEP Annual Revenue',  value: fmt(bep.bepAnnualRevenue),  ok: bep.bepAnnualRevenue < liveMetrics.annualRevenue },
                        { label: 'BEP Utilisation %',   value: `${bep.bepUtilisation.toFixed(1)}%`,  ok: bep.bepUtilisation < 70 },
                        { label: 'Safety Margin',        value: `${bep.safetyMargin.toFixed(1)}%`,  ok: bep.safetyMargin > 20 },
                      ].map(item => (
                        <div key={item.label} className="text-center">
                          <p className="text-[10px] text-slate-500 uppercase tracking-widest">{item.label}</p>
                          <p className={`text-sm font-black mt-1 ${item.ok ? 'text-teal-400' : 'text-amber-400'}`}>{item.value}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2">Contribution Ratio: {(bep.contributionRatio*100).toFixed(1)}% | Fixed Costs: ₹{(bep.fixedCosts/100000).toFixed(1)}L/mo</p>
                  </div>
                );
              })()}
            </div>
          );
        }
      case 'scorecard': {
          const scorecard = computeScorecard(liveMetrics, formData);
          const totalScore    = scorecard.reduce((a, p) => a + p.score, 0);
          const maxScore      = scorecard.reduce((a, p) => a + p.maxScore, 0);
          const scorePct      = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
          const autoRating    = scorePct >= 70 ? 'green' : scorePct >= 50 ? 'amber' : 'red';
          const autoLabel     = scorePct >= 70 ? 'Low Risk' : scorePct >= 50 ? 'Medium Risk' : 'High Risk';
          const caRec = formData.ca_recommendation || { rating: autoRating as any, recommendation: scorePct >= 70 ? 'Recommend' as const : scorePct >= 50 ? 'Conditional' as const : 'Decline' as const, notes: '', strengths: '', weaknesses: '', risk_mitigants: '', covenants: [] as string[] };
          const setRec = (patch: Partial<typeof caRec>) => setFormData({...formData, ca_recommendation: {...caRec, ...patch}});
          const emiSched = computeEMISchedule(formData);

          const statusIcon = (s: 'good'|'warn'|'bad') =>
            s === 'good' ? <CheckCircle2 size={14} className="text-emerald-400 shrink-0" /> :
            s === 'warn' ? <MinusCircle size={14} className="text-amber-400 shrink-0" /> :
                           <XCircle size={14} className="text-rose-400 shrink-0" />;

          return (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">Step 16 — CA Scorecard &amp; Recommendation</h3>
                <div className={`px-4 py-1.5 rounded-full text-sm font-black ${autoRating === 'green' ? 'bg-emerald-500/20 text-emerald-400' : autoRating === 'amber' ? 'bg-amber-500/20 text-amber-400' : 'bg-rose-500/20 text-rose-400'}`}>
                  {autoLabel} — {scorePct.toFixed(0)}/ 100
                </div>
              </div>
              <InsightCard insights={insights} />

              {/* Score bar */}
              <div className="p-4 bg-slate-800/40 border border-slate-700 rounded-2xl">
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-slate-400 font-bold">Overall Credit Score</span>
                  <span className="font-black text-white">{totalScore} / {maxScore}</span>
                </div>
                <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${scorePct >= 70 ? 'bg-emerald-500' : scorePct >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                    style={{ width: `${scorePct}%` }} />
                </div>
                <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                  <span>0 — High Risk</span><span>50 — Medium</span><span>70+ — Recommend</span>
                </div>
              </div>

              {/* Parameter breakdown */}
              <div className="space-y-2">
                {scorecard.map((param, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-slate-800/30 border border-slate-700/50 rounded-xl">
                    {statusIcon(param.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-200">{param.label}</span>
                        <span className={`text-xs font-black ml-2 shrink-0 ${param.status === 'good' ? 'text-emerald-400' : param.status === 'warn' ? 'text-amber-400' : 'text-rose-400'}`}>{param.value}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">{param.comment}</p>
                    </div>
                    <div className="shrink-0 text-right w-16">
                      <span className="text-xs font-black text-slate-300">{param.score}</span>
                      <span className="text-[10px] text-slate-500">/{param.maxScore}</span>
                      <div className="h-1 bg-slate-700 rounded-full mt-1">
                        <div className={`h-full rounded-full ${param.status === 'good' ? 'bg-emerald-500' : param.status === 'warn' ? 'bg-amber-500' : 'bg-rose-500'}`}
                          style={{ width: `${(param.score/param.maxScore)*100}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Loan Repayment Schedule */}
              {emiSched.rows.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Loan Repayment Schedule</p>
                  <div className="rounded-2xl border border-slate-700 overflow-hidden text-xs">
                    <div className="bg-slate-800/60 grid grid-cols-6 gap-0 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      {['Year','Opening Bal','EMI (Annual)','Interest','Principal','Closing Bal'].map((h, i) => (
                        <span key={i} className={`px-3 py-2 border-r border-slate-700 last:border-0 ${i > 0 ? 'text-right' : ''}`}>{h}</span>
                      ))}
                    </div>
                    {emiSched.rows.map(row => (
                      <div key={row.yr} className={`grid grid-cols-6 gap-0 border-t border-slate-800 ${row.isInMorat ? 'bg-amber-500/5' : ''}`}>
                        <span className="px-3 py-2 border-r border-slate-700 font-bold text-slate-300">
                          Year {row.yr}{row.isInMorat ? ' 🕐' : ''}
                        </span>
                        <span className="px-3 py-2 text-right border-r border-slate-700 font-mono text-slate-300">{fmt(row.openingBal)}</span>
                        <span className="px-3 py-2 text-right border-r border-slate-700 font-mono text-slate-400">{fmt(row.totalEMI)}</span>
                        <span className="px-3 py-2 text-right border-r border-slate-700 font-mono text-rose-400">{fmt(row.totalInterest)}</span>
                        <span className="px-3 py-2 text-right border-r border-slate-700 font-mono text-teal-400">{fmt(row.totalPrincipal)}</span>
                        <span className="px-3 py-2 text-right font-mono text-white font-bold">{fmt(row.closingBal)}</span>
                      </div>
                    ))}
                    <div className="grid grid-cols-6 gap-0 border-t border-slate-600 bg-slate-800/40 text-[10px] font-bold px-3 py-2">
                      <span className="text-slate-300">Monthly EMI</span>
                      <span className="col-span-5 text-right text-teal-400">₹{emiSched.monthlyEMI.toLocaleString('en-IN')} / month</span>
                    </div>
                  </div>
                  {formData.loan.moratorium_months > 0 && <p className="text-[10px] text-amber-500 mt-1">🕐 = Moratorium period — interest only, no principal repayment.</p>}
                </div>
              )}

              {/* CA Recommendation */}
              <div className="p-5 bg-slate-800/40 border border-slate-700 rounded-2xl space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">CA Recommendation</p>
                <div className="grid grid-cols-3 gap-3">
                  {(['Recommend','Conditional','Decline'] as const).map(opt => {
                    const colors = opt === 'Recommend' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' :
                                   opt === 'Conditional' ? 'border-amber-500/40 bg-amber-500/10 text-amber-400' :
                                   'border-rose-500/40 bg-rose-500/10 text-rose-400';
                    const selected = caRec.recommendation === opt;
                    return (
                      <button key={opt} onClick={() => setRec({ recommendation: opt, rating: opt === 'Recommend' ? 'green' : opt === 'Conditional' ? 'amber' : 'red' })}
                        className={`p-3 rounded-xl border-2 text-sm font-black transition-all ${selected ? colors : 'border-slate-700 text-slate-500 hover:border-slate-600'}`}>
                        {opt === 'Recommend' ? '✓ Recommend' : opt === 'Conditional' ? '⚠ Conditional' : '✕ Decline'}
                      </button>
                    );
                  })}
                </div>
                {/* Credit Appraisal Note — structured CA / banker write-up */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-emerald-400">Strengths</Label>
                    <textarea value={caRec.strengths || ''} onChange={e => setRec({ strengths: e.target.value })} rows={3}
                      placeholder="e.g. Promoter brings 40% equity; healthy 45% margin; strong collateral cover."
                      className="w-full bg-slate-950/50 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 resize-none focus:outline-none focus:border-teal-500" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-rose-400">Risk Factors / Weaknesses</Label>
                    <textarea value={caRec.weaknesses || ''} onChange={e => setRec({ weaknesses: e.target.value })} rows={3}
                      placeholder="e.g. First-generation promoter; sector cyclicality; single large customer."
                      className="w-full bg-slate-950/50 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 resize-none focus:outline-none focus:border-teal-500" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-teal-400">Risk Mitigants</Label>
                    <textarea value={caRec.risk_mitigants || ''} onChange={e => setRec({ risk_mitigants: e.target.value })} rows={3}
                      placeholder="e.g. CGTMSE cover; collateral 1.5x FSV; escrow of receivables."
                      className="w-full bg-slate-950/50 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 resize-none focus:outline-none focus:border-teal-500" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400">CA Remarks / Justification</Label>
                    <textarea value={caRec.notes} onChange={e => setRec({ notes: e.target.value })} rows={3}
                      placeholder="Overall justification for the recommendation..."
                      className="w-full bg-slate-950/50 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 resize-none focus:outline-none focus:border-teal-500" />
                  </div>
                </div>

                {/* Sanction covenants / conditions — editable list */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-slate-400">Sanction Covenants / Conditions</Label>
                    <Button size="sm" variant="outline" className="border-teal-500/30 text-teal-400 text-xs h-7"
                      onClick={() => setRec({ covenants: [...(caRec.covenants || []), ''] })}>
                      <Plus size={12} className="mr-1" /> Add Covenant
                    </Button>
                  </div>
                  {(caRec.covenants || []).map((cov, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 w-5 shrink-0">{idx + 1}.</span>
                      <Input value={cov}
                        onChange={e => { const n = [...(caRec.covenants || [])]; n[idx] = e.target.value; setRec({ covenants: n }); }}
                        placeholder="e.g. Hypothecation to be perfected before first disbursement"
                        className="bg-slate-950/50 border-slate-700 text-sm h-9" />
                      <Button size="sm" variant="ghost" className="text-rose-400 h-8 px-1 shrink-0"
                        onClick={() => setRec({ covenants: (caRec.covenants || []).filter((_, i) => i !== idx) })}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))}
                  {(caRec.covenants || []).length === 0 && (
                    <p className="text-[10px] text-slate-600">No covenants added. These appear as sanction conditions in the Credit Appraisal Note.</p>
                  )}
                </div>
              </div>
            </div>
          );
        }
      default:
        return <div className="py-20 text-center text-slate-500">Step {currentStep + 1}: {steps[currentStep].title}</div>;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[95vh] overflow-hidden flex flex-col p-0 border-slate-700 bg-slate-900 text-white shadow-2xl rounded-2xl">
        <DialogHeader className="p-6 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-lg shadow-teal-500/20">
              <Zap size={24} />
            </div>
            <div>
              <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                CA-Grade CMA Wizard
                {demoMode && (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    Live Demo · Sample Data
                  </span>
                )}
              </DialogTitle>
              <div className="flex items-center gap-3 mt-1">
                  <div className="flex-1 h-1.5 w-48 bg-slate-800 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
                        className="h-full bg-gradient-to-r from-teal-500 to-emerald-500"
                      />
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      {Math.round(((currentStep + 1) / steps.length) * 100)}% Complete
                  </span>
              </div>
            </div>
            <div className="ml-auto">
                <Button 
                    variant="outline" 
                    onClick={() => setShowFormulas(!showFormulas)}
                    className="border-slate-700 bg-slate-800/50 hover:bg-slate-700 text-teal-400 gap-2 rounded-xl"
                >
                    <BookOpen size={18} />
                    <span className="hidden sm:inline">Formula Guide</span>
                </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-64 border-r border-slate-800 bg-slate-950/40 p-4 space-y-1 overflow-y-auto scrollbar-hide">
            {steps.map((step, index) => (
              <button
                key={step.id}
                onClick={() => setCurrentStep(index)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all group ${currentStep === index
                  ? 'bg-teal-500/10 text-teal-400 border border-teal-500/30'
                  : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
              >
                <div className={`p-1.5 rounded-lg ${currentStep === index ? 'bg-teal-500/20' : 'bg-slate-800'}`}>
                  <step.icon size={14} />
                </div>
                {step.title}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden flex flex-col bg-slate-900/50">
            {/* ── Live CA Metrics Bar ── */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 px-6 py-3 bg-slate-950/60 border-b border-slate-800/80 text-[11px] font-mono">
              {[
                { label: 'Project Cost', value: `₹${(liveMetrics.totalProjectCost/100000).toFixed(1)}L`, ok: liveMetrics.totalProjectCost > 0 },
                { label: 'MoF Balance', value: Math.abs(liveMetrics.mofBalance) < 2 ? '✓ Balanced' : `${liveMetrics.mofBalance > 0 ? '+' : ''}₹${(liveMetrics.mofBalance/100000).toFixed(1)}L`, ok: Math.abs(liveMetrics.mofBalance) < 2 },
                { label: 'Monthly Rev', value: `₹${(liveMetrics.monthlyRevenue/100000).toFixed(1)}L`, ok: liveMetrics.monthlyRevenue > 0 },
                { label: 'Monthly Surplus', value: `₹${(liveMetrics.monthlySurplus/100000).toFixed(1)}L`, ok: liveMetrics.monthlySurplus > 0 },
                { label: 'Est. DSCR', value: liveMetrics.estimatedDSCR > 0 ? liveMetrics.estimatedDSCR.toFixed(2) : '—', ok: liveMetrics.estimatedDSCR >= 1.25 },
                { label: 'D:E', value: liveMetrics.deRatio > 0 ? `${liveMetrics.deRatio.toFixed(1)}:1` : '—', ok: liveMetrics.deRatio > 0 && liveMetrics.deRatio <= 3 },
                { label: 'Promoter %', value: liveMetrics.promoterPct > 0 ? `${liveMetrics.promoterPct.toFixed(1)}%` : '—', ok: liveMetrics.promoterPct >= 10 },
                { label: 'Net Worth', value: liveMetrics.netWorth > 0 ? `₹${(liveMetrics.netWorth/100000).toFixed(1)}L` : '—', ok: liveMetrics.netWorth >= liveMetrics.termLoan },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <span className="text-slate-500 uppercase tracking-wider">{item.label}</span>
                  <span className={`font-bold ${item.ok ? 'text-emerald-400' : 'text-amber-400'}`}>{item.value}</span>
                </div>
              ))}
            </div>
            <ScrollArea className="flex-1 p-10">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="max-w-4xl mx-auto"
                >
                  <BankerTips tips={getStepTips(steps[currentStep].id, liveMetrics, formData)} />
                  {renderStep()}
                </motion.div>
              </AnimatePresence>
            </ScrollArea>

            <div className="p-6 border-t border-slate-800 bg-slate-950/80 backdrop-blur-md flex items-center justify-between">
              <div className="flex gap-2">
                <Button variant="ghost" onClick={handleBack} disabled={currentStep === 0} className="rounded-xl px-6 h-12">
                    <ChevronLeft className="mr-2 h-5 w-5" /> Back
                </Button>
                <Button variant="ghost" onClick={handleSaveDraft} disabled={isSubmitting} className="rounded-xl px-4 h-12 text-slate-400 hover:text-teal-400">
                    <Save className="mr-2 h-4 w-4" /> Save Draft
                </Button>
              </div>

              <div className="flex items-center gap-2">
                {/* Download buttons — in demo mode CSV/Excel are admin-only */}
                <Button
                  onClick={() => handleSubmit('csv')}
                  disabled={isSubmitting || (demoMode && !isAdmin)}
                  variant="outline"
                  size="sm"
                  title={demoMode && !isAdmin ? 'Locked — admin only in demo' : undefined}
                  className="border-slate-700 hover:bg-slate-800 text-xs h-9"
                >
                  {demoMode && !isAdmin && <Lock size={11} className="mr-1" />} CSV
                </Button>
                <Button
                  onClick={() => handleSubmit('excel')}
                  disabled={isSubmitting || (demoMode && !isAdmin)}
                  variant="outline"
                  size="sm"
                  title={demoMode && !isAdmin ? 'Locked — admin only in demo' : undefined}
                  className="border-slate-700 hover:bg-slate-800 text-xs h-9"
                >
                  {demoMode && !isAdmin && <Lock size={11} className="mr-1" />} Excel
                </Button>
                <Button
                  onClick={() => handleSubmit('pdf')}
                  disabled={isSubmitting}
                  size="sm"
                  className="bg-gradient-to-r from-teal-600 to-emerald-600 px-5 h-9 rounded-xl font-bold text-xs"
                >
                  {isSubmitting ? 'Generating...' : demoMode ? 'PDF (Watermarked)' : 'PDF Pack'}
                </Button>
                {currentStep < steps.length - 1 && (
                  <Button onClick={handleNext} className="bg-teal-600 hover:bg-teal-500 px-6 h-12 rounded-xl font-bold ml-2">
                    Next <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Validation Panel — advisory only, download always allowed */}
        {showValidationPanel && validationResult && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute inset-0 z-[60] bg-slate-950/95 flex flex-col p-8 overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <AlertCircle size={22} className="text-amber-400" />
                Pre-Download Review
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setShowValidationPanel(false)} className="text-slate-400 hover:text-white">
                ✕ Close
              </Button>
            </div>
            <p className="text-xs text-slate-500 mb-6">These are CA advisory checks. Download is always permitted — review and fix at your discretion.</p>

            {validationResult.criticalErrors.length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-widest text-rose-400 mb-3">
                  Issues to Review ({validationResult.criticalErrors.length})
                </p>
                <div className="space-y-2">
                  {validationResult.criticalErrors.map((e, i) => (
                    <div key={i} className="flex gap-3 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl">
                      <span className="text-rose-400 font-bold text-xs shrink-0">{e.code}</span>
                      <span className="text-rose-300 text-xs">{e.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {validationResult.warnings.length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-widest text-amber-400 mb-3">
                  Advisory Warnings ({validationResult.warnings.length})
                </p>
                <div className="space-y-2">
                  {validationResult.warnings.map((w, i) => (
                    <div key={i} className="flex gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                      <span className="text-amber-400 font-bold text-xs shrink-0">{w.code}</span>
                      <span className="text-amber-300 text-xs">{w.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {validationResult.criticalErrors.length === 0 && validationResult.warnings.length === 0 && (
              <div className="p-4 bg-teal-500/10 border border-teal-500/30 rounded-xl mb-6">
                <p className="text-teal-400 font-semibold text-sm">✓ All checks passed — no issues found.</p>
              </div>
            )}

            <div className="mt-auto pt-6 flex gap-3 border-t border-slate-800">
              <Button variant="outline" className="border-slate-700" onClick={() => setShowValidationPanel(false)}>
                Fix Issues First
              </Button>
              <Button variant="outline" className="border-slate-700 text-slate-300" onClick={() => { setShowValidationPanel(false); handleSubmit('csv'); }} disabled={isSubmitting}>
                CSV
              </Button>
              <Button variant="outline" className="border-slate-700 text-slate-300" onClick={() => { setShowValidationPanel(false); handleSubmit('excel'); }} disabled={isSubmitting}>
                Excel
              </Button>
              <Button className="bg-gradient-to-r from-teal-600 to-emerald-600 px-8 font-bold" onClick={() => { setShowValidationPanel(false); handleSubmit('pdf'); }} disabled={isSubmitting}>
                {isSubmitting ? 'Generating...' : 'Download PDF Anyway'}
              </Button>
            </div>
          </motion.div>
        )}

        {showFormulas && (
            <motion.div 
                initial={{ opacity: 0, x: 300 }}
                animate={{ opacity: 1, x: 0 }}
                className="absolute right-0 top-[89px] bottom-0 w-[400px] bg-slate-950 border-l border-slate-800 z-50 p-6 shadow-2xl overflow-y-auto"
            >
                <div className="flex items-center justify-between mb-8">
                    <h3 className="text-xl font-bold text-teal-400 flex items-center gap-2">
                        <CalcIcon size={20} />
                        Banking Formulas
                    </h3>
                    <Button variant="ghost" size="sm" onClick={() => setShowFormulas(false)}>Close</Button>
                </div>

                <div className="space-y-8 text-sm">
                    <section className="space-y-3">
                        <h4 className="text-slate-200 font-bold uppercase tracking-wider text-xs">Working Capital (MPBF)</h4>
                        <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 space-y-2">
                            <p className="text-teal-400 font-mono font-bold">0.75 * (CA - OCL) - Net Working Capital</p>
                            <p className="text-slate-400 text-[11px]">Tandon Committee Method II: Bank provides 75% of the working capital gap.</p>
                            <div className="mt-2 pt-2 border-t border-slate-800/50">
                                <p className="text-[10px] text-amber-400 font-semibold flex items-center gap-1">
                                    <ShieldCheck size={10} /> CA Master Insight:
                                </p>
                                <p className="text-[10px] text-slate-500 italic">Always ensure Current Ratio &gt; 1.33 to pass Method II. Banks look for a minimum 25% promoter margin in working capital.</p>
                            </div>
                        </div>
                    </section>

                    <section className="space-y-3">
                        <h4 className="text-slate-200 font-bold uppercase tracking-wider text-xs">Debt Service Coverage (DSCR)</h4>
                        <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 space-y-2">
                            <p className="text-teal-400 font-mono font-bold">(PAT + Depr + Int) / (Installment + Int)</p>
                            <p className="text-slate-400 text-[11px]">Measures ability to pay back term loans.</p>
                            <div className="mt-2 pt-2 border-t border-slate-800/50">
                                <p className="text-[10px] text-amber-400 font-semibold flex items-center gap-1">
                                    <ShieldCheck size={10} /> CA Master Insight:
                                    </p>
                                <p className="text-[10px] text-slate-500 italic">Ideal range: 1.50 to 2.00. Below 1.25 is a rejection risk; above 3.00 suggests under-utilization of debt.</p>
                            </div>
                        </div>
                    </section>

                    <section className="space-y-3">
                        <h4 className="text-slate-200 font-bold uppercase tracking-wider text-xs">Break-Even Point (BEP)</h4>
                        <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 space-y-2">
                            <p className="text-teal-400 font-mono font-bold">Fixed Costs / (Sales - Variable Costs)</p>
                            <p className="text-slate-400 text-[11px]">Expressed as % of capacity or sales.</p>
                            <div className="mt-2 pt-2 border-t border-slate-800/50">
                                <p className="text-[10px] text-amber-400 font-semibold flex items-center gap-1">
                                    <ShieldCheck size={10} /> CA Master Insight:
                                </p>
                                <p className="text-[10px] text-slate-500 italic">Target BEP &lt; 60%. If BEP is high, suggest increasing sales price or reducing fixed overheads in the projections.</p>
                            </div>
                        </div>
                    </section>

                    <section className="space-y-3">
                        <h4 className="text-slate-200 font-bold uppercase tracking-wider text-xs">Net Working Capital (NWC)</h4>
                        <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 space-y-2">
                            <p className="text-teal-400 font-mono font-bold">Current Assets - Current Liabilities</p>
                            <p className="text-slate-400 text-[11px]">Represents liquidity available to run day-to-day operations.</p>
                        </div>
                    </section>
                </div>

                <div className="mt-12 p-4 bg-teal-500/5 border border-teal-500/20 rounded-xl">
                    <p className="text-[10px] text-slate-500 leading-relaxed italic">
                        Note: These calculations adhere to RBI guidelines and the Tandon Committee recommendations commonly followed by Indian Scheduled Commercial Banks.
                    </p>
                </div>
            </motion.div>
        )}
      </DialogContent>
    </Dialog>
  );
};
