/**
 * CMAAdvisoryPanel — CA-grade advisory engine.
 *
 * Thinks like a Chartered Accountant:
 *  1. Reads every number the user actually entered (formData)
 *  2. Applies scheme-specific DSCR / equity benchmarks
 *  3. Applies industry-specific COGS / margin benchmarks
 *  4. Calculates the EXACT corrected value for each field
 *  5. Tells the user precisely: "Change Field X from ₹Y to ₹Z"
 *
 * Works for any user, any loan scheme, any industry.
 */

import { useState } from "react";
import {
  ChevronDown, ChevronUp, ArrowRight,
  TrendingUp, IndianRupee, BarChart2,
  CheckCircle, AlertTriangle, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GTABFormData } from "@/types/gtab";

// ─────────────────────────────────────────────────────────────────────────────
// CA Standard Benchmarks
// ─────────────────────────────────────────────────────────────────────────────

const INDUSTRY_BENCH: Record<string, {
  name: string;
  cogsMin: number; cogsMax: number;   // RM / direct cost as % of revenue
  fixedMin: number; fixedMax: number; // Fixed costs (salary+rent) as % of revenue
  grossMarginMin: number;             // Minimum acceptable gross margin
  labourMaxPct: number;               // Max labour as % of revenue (CA warning threshold)
}> = {
  manufacturing: { name: "Manufacturing", cogsMin: 0.40, cogsMax: 0.55, fixedMin: 0.15, fixedMax: 0.25, grossMarginMin: 0.45, labourMaxPct: 0.35 },
  trading:       { name: "Trading",       cogsMin: 0.65, cogsMax: 0.75, fixedMin: 0.08, fixedMax: 0.15, grossMarginMin: 0.25, labourMaxPct: 0.15 },
  service:       { name: "Service",       cogsMin: 0.10, cogsMax: 0.20, fixedMin: 0.40, fixedMax: 0.60, grossMarginMin: 0.80, labourMaxPct: 0.50 },
  agriculture:   { name: "Agriculture",  cogsMin: 0.35, cogsMax: 0.50, fixedMin: 0.15, fixedMax: 0.30, grossMarginMin: 0.50, labourMaxPct: 0.30 },
  others:        { name: "Business",     cogsMin: 0.40, cogsMax: 0.60, fixedMin: 0.15, fixedMax: 0.35, grossMarginMin: 0.40, labourMaxPct: 0.40 },
};

const SCHEME_BENCH: Record<string, {
  label: string; minDSCR: number;
  tlPct: number; subsidyPct: number; promoterPct: number;
  maxProjectCost: number;
}> = {
  pmegp:           { label: "PMEGP",          minDSCR: 1.25, tlPct: 0.75, subsidyPct: 0.15, promoterPct: 0.10, maxProjectCost: 5_000_000 },
  mudra:           { label: "MUDRA Kishor",   minDSCR: 1.10, tlPct: 0.90, subsidyPct: 0.00, promoterPct: 0.10, maxProjectCost: 500_000 },
  mudra_shishu:    { label: "MUDRA Shishu",   minDSCR: 1.10, tlPct: 0.90, subsidyPct: 0.00, promoterPct: 0.10, maxProjectCost: 50_000 },
  mudra_kishor:    { label: "MUDRA Kishor",   minDSCR: 1.10, tlPct: 0.90, subsidyPct: 0.00, promoterPct: 0.10, maxProjectCost: 500_000 },
  mudra_tarun:     { label: "MUDRA Tarun",    minDSCR: 1.25, tlPct: 0.90, subsidyPct: 0.00, promoterPct: 0.10, maxProjectCost: 1_000_000 },
  mudra_tarunplus: { label: "MUDRA Tarun+",   minDSCR: 1.25, tlPct: 0.90, subsidyPct: 0.00, promoterPct: 0.10, maxProjectCost: 2_000_000 },
  cgtmse:          { label: "CGTMSE",         minDSCR: 1.25, tlPct: 0.85, subsidyPct: 0.00, promoterPct: 0.15, maxProjectCost: 20_000_000 },
  normal_msme:     { label: "MSME",           minDSCR: 1.25, tlPct: 0.75, subsidyPct: 0.00, promoterPct: 0.25, maxProjectCost: 100_000_000 },
  other_scheme:    { label: "Other Scheme",   minDSCR: 1.25, tlPct: 0.75, subsidyPct: 0.00, promoterPct: 0.25, maxProjectCost: 100_000_000 },
};

const fmt = (n: number) =>
  "₹" + Math.round(n).toLocaleString("en-IN");

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

// ─────────────────────────────────────────────────────────────────────────────
// CA Diagnosis Engine — reads actual formData, calculates exact corrections
// ─────────────────────────────────────────────────────────────────────────────

interface Fix { step: string; where: string; current: string; correct: string; why: string }
interface Advisory {
  id: string; severity: "critical" | "warning";
  icon: React.ElementType; title: string; summary: string;
  diagnosis: string; fixes: Fix[]; impact: string;
}

function diagnose(warnings: string[], fd: GTABFormData): Advisory[] {
  const advisories: Advisory[] = [];
  const industry = (fd.industry_type || "manufacturing").toLowerCase();
  const scheme   = (fd.loan_scheme   || "pmegp").toLowerCase();
  const bench    = INDUSTRY_BENCH[industry] || INDUSTRY_BENCH.manufacturing;
  const schemeCfg = SCHEME_BENCH[scheme]   || SCHEME_BENCH.pmegp;

  // ── Extract all financial data from formData ──────────────────────────────
  const monthlyRev   = Number(fd.expected_monthly_revenue || 0);
  const annualRev    = monthlyRev * 12;
  const monthlyRM    = Number(fd.raw_material_cost || 0);
  const annualRM     = monthlyRM * 12;
  const monthlyRent  = Number(fd.monthly_rent || 0);
  const skilledPay   = (Number(fd.skilled_workers_count || 0)) * (Number(fd.skilled_workers_salary || 0));
  const semiPay      = (Number(fd.semi_skilled_workers_count || 0)) * (Number(fd.semi_skilled_workers_salary || 0));
  const wagesPay     = (Number(fd.wages_count || 0)) * (Number(fd.wages_salary || 0));
  const monthlySalary = skilledPay + semiPay + wagesPay;
  const totalStaff   = (Number(fd.skilled_workers_count || 0)) + (Number(fd.semi_skilled_workers_count || 0)) + (Number(fd.wages_count || 0));
  const totalExpenses = Number(fd.total_monthly_expenses || 0) || (monthlyRM + monthlySalary + monthlyRent + Number(fd.electricity_water_cost || 0) + Number(fd.miscellaneous_cost || 0));
  const projectCost  = Number(fd.total_project_cost || 0);
  const machineryTotal = (fd.plant_machinery || []).reduce((s, m) => s + Number(m.cost || 0), 0);
  const buildingCost = Number(fd.shed_building_cost || 0);
  const landCost     = Number(fd.land_cost || 0);

  // Loan structure from scheme
  const termLoan   = projectCost * schemeCfg.tlPct;
  const subsidy    = projectCost * schemeCfg.subsidyPct;
  const promoterCash = projectCost - termLoan - subsidy;
  const tenureYrs  = Number(fd.project_report_inputs?.loan?.tenure_months || 60) / 12 || 5;
  const intRate    = Number(fd.project_report_inputs?.loan?.interest_rate_pct || 10.5) / 100;
  const annualTLRepay = termLoan / tenureYrs;
  // Half-yearly reducing balance interest estimate Year 1
  const annualTLInterest = termLoan * intRate * 0.9; // approximate
  const minCashAccruals  = schemeCfg.minDSCR * (annualTLRepay + annualTLInterest) - annualTLInterest;
  const annualDep        = (machineryTotal * 0.10) + (buildingCost * 0.05);
  const minAnnualPAT     = Math.max(minCashAccruals - annualDep, 0);
  const minMonthlyPAT    = minAnnualPAT / 12;

  // Current RM ratio
  const rmRatio  = monthlyRev > 0 ? monthlyRM / monthlyRev : 0;
  // Correct RM target (midpoint of industry bench)
  const targetRM = monthlyRev * ((bench.cogsMin + bench.cogsMax) / 2);
  // Minimum revenue required for current RM
  const minRevForRM = monthlyRM > 0 ? monthlyRM / bench.cogsMax : 0;
  // Revenue needed to cover all expenses + min PAT
  const requiredRevenue = Math.max(totalExpenses + minMonthlyPAT, minRevForRM);

  // Extract warning codes
  const codes = new Set(warnings.map(w => w.match(/^(V\d+)/i)?.[1]?.toUpperCase()).filter(Boolean) as string[]);
  const hasDSCR = codes.has("V5") || warnings.some(w => w.includes("DSCR is -") || w.includes("DSCR"));
  const hasLoss = codes.has("V6") || warnings.some(w => w.includes("loss-making"));
  const hasCash = codes.has("V7") || warnings.some(w => w.includes("Closing cash"));
  const hasSens = codes.has("V8") || warnings.some(w => w.includes("inverted") || w.includes("Sensitivity"));

  // ── Issue 1: RM cost miscalculation / negative DSCR ─────────────────────
  if (hasDSCR || hasSens) {
    const rmProblem = rmRatio > bench.cogsMax + 0.05; // RM is clearly too high
    const fixes: Fix[] = [];

    if (monthlyRev > 0 && rmProblem) {
      fixes.push({
        step: "Step 8",
        where: "Monthly Expenses → Raw Material Cost",
        current: `${fmt(monthlyRM)}/month  (${pct(rmRatio)} of revenue — too high)`,
        correct: `${fmt(targetRM)}/month  (${pct((bench.cogsMin + bench.cogsMax) / 2)} of revenue — ${bench.name} standard)`,
        why: `For ${bench.name}, Raw Material should be ${pct(bench.cogsMin)}–${pct(bench.cogsMax)} of revenue. ` +
             `Your current RM (${fmt(monthlyRM)}) is ${pct(rmRatio)} of revenue (${fmt(monthlyRev)}). ` +
             `${rmRatio > 1 ? "This is MORE than your total revenue — check if you entered an annual figure as monthly." : "Reduce it to the correct monthly amount."}`
      });
    }

    if (monthlyRev > 0 && monthlyRev < requiredRevenue) {
      fixes.push({
        step: "Step 6",
        where: "Revenue Details → Selling Price / Monthly Revenue",
        current: `${fmt(monthlyRev)}/month`,
        correct: `${fmt(requiredRevenue)}/month minimum to achieve DSCR ≥ ${schemeCfg.minDSCR} for ${schemeCfg.label}`,
        why: `To repay ${fmt(termLoan)} term loan over ${tenureYrs} years at ${(intRate * 100).toFixed(1)}% interest ` +
             `under ${schemeCfg.label}, your business needs to earn at least ${fmt(minAnnualPAT)}/year net profit. ` +
             `At current expenses of ${fmt(totalExpenses)}/month, you need at least ${fmt(requiredRevenue)}/month revenue.`
      });
    }

    if (!rmProblem && monthlyRev === 0) {
      fixes.push({
        step: "Step 6 / Step 9",
        where: "Revenue Details OR Production Details",
        current: "Monthly Revenue = ₹0 (not entered)",
        correct: `Enter your expected monthly revenue. Minimum needed: ${fmt(requiredRevenue > 0 ? requiredRevenue : minRevForRM)}/month`,
        why: `The system cannot calculate profitability without a revenue figure. ` +
             `Based on your project cost of ${fmt(projectCost)}, you need at least ${fmt(requiredRevenue > 0 ? requiredRevenue : 50000)}/month to be viable.`
      });
    }

    // Always add unit-cost fix for manufacturing
    if (industry === "manufacturing" || industry === "agriculture") {
      const cats = fd.project_report_inputs?.revenue?.product_categories ?? [];
      const hasUnitCost = cats.some(c => Number(c.selling_price || c.avg_price) > 0);
      if (!hasUnitCost) {
        fixes.push({
          step: "Step 9",
          where: "Production Details → Raw Material Cost Per Unit + Input Quantity",
          current: "Unit-level production data not entered",
          correct: "Enter: Input Qty/day, RM cost/unit, and Selling price/unit separately",
          why: "Without per-unit costs, the system estimates RM as a ratio of revenue, which causes calculation errors. " +
               "Unit-level data gives the most accurate profitability projection that banks trust."
        });
      }
    }

    const dscrNums = warnings.filter(w => w.includes("DSCR is")).map(w => parseFloat(w.match(/DSCR is ([-\d.]+)/)?.[1] ?? "0")).filter(n => !isNaN(n));
    const worstDSCR = dscrNums.length ? Math.min(...dscrNums) : null;

    advisories.push({
      id: "dscr",
      severity: "critical",
      icon: TrendingUp,
      title: `Loan Repayment Capacity Too Low for ${schemeCfg.label}`,
      summary: worstDSCR !== null
        ? `DSCR = ${worstDSCR.toFixed(2)} (need ≥ ${schemeCfg.minDSCR}). The projected profit is not enough to repay the loan.`
        : `Projected profit is not enough to meet ${schemeCfg.label} repayment requirements (DSCR ≥ ${schemeCfg.minDSCR}).`,
      diagnosis:
        `${schemeCfg.label} requires DSCR ≥ ${schemeCfg.minDSCR}, meaning your annual net profit + depreciation ` +
        `must be at least ${fmt(minCashAccruals)} to comfortably repay ${fmt(termLoan)} term loan over ${tenureYrs} years. ` +
        (rmProblem
          ? `Your Raw Material cost (${pct(rmRatio)} of revenue) is outside the ${bench.name} range of ${pct(bench.cogsMin)}–${pct(bench.cogsMax)}, causing projected losses.`
          : `Your total expenses (${fmt(totalExpenses)}/month) leave insufficient profit margin.`),
      fixes,
      impact: `Fix these values and the DSCR will improve above ${schemeCfg.minDSCR}. ${schemeCfg.label} loans are approvable at DSCR ≥ ${schemeCfg.minDSCR}.`
    });
  }

  // ── Issue 2: Loss-making project ─────────────────────────────────────────
  if (hasLoss && !hasDSCR) {
    const monthlyProfit = monthlyRev - totalExpenses;
    const fixes: Fix[] = [];

    if (monthlyRev > 0 && totalExpenses > monthlyRev) {
      const gap = totalExpenses - monthlyRev;
      // Find the biggest cost driver
      const rmShare = monthlyRM / totalExpenses;

      fixes.push({
        step: "Step 8",
        where: "Monthly Expenses — Review each line",
        current: `Total expenses: ${fmt(totalExpenses)}/month  vs  Revenue: ${fmt(monthlyRev)}/month  (gap: ${fmt(gap)})`,
        correct: `Total expenses must be below ${fmt(monthlyRev * (1 - 0.05))}/month to earn 5% minimum net margin`,
        why: `For ${schemeCfg.label}, the minimum viable net margin is 5–10% to service the loan. ` +
             `Your biggest cost is ${rmShare > 0.5 ? `Raw Material (${pct(rmShare)} of total costs = ${fmt(monthlyRM)}/month)` : `Salary (${fmt(monthlySalary)}/month)`}. ` +
             `Review if any amount was entered annually but treated as monthly.`
      });

      if (monthlyRev > 0) {
        const revNeeded = totalExpenses / 0.90; // 10% margin
        fixes.push({
          step: "Step 6",
          where: "Revenue Details → Selling Price",
          current: `Revenue: ${fmt(monthlyRev)}/month`,
          correct: `Revenue: ${fmt(revNeeded)}/month (increase selling price by ${pct((revNeeded - monthlyRev) / monthlyRev)})`,
          why: `Alternatively, increase revenue to cover costs plus a 10% profit margin. Check market prices in your area.`
        });
      }
    }

    advisories.push({
      id: "losses",
      severity: "critical",
      icon: IndianRupee,
      title: "Business Shows Losses in All 5 Projected Years",
      summary: `Monthly expenses (${fmt(totalExpenses)}) exceed monthly revenue (${fmt(monthlyRev)}) by ${fmt(Math.abs(totalExpenses - monthlyRev))}. Banks will not approve this.`,
      diagnosis:
        `A viable project must show profit from Year 2 at latest. ` +
        `Current model: Revenue ${fmt(monthlyRev)}/month - Expenses ${fmt(totalExpenses)}/month = ` +
        `${monthlyRev > totalExpenses ? "Profit" : "Loss"} ${fmt(Math.abs(monthlyRev - totalExpenses))}/month. ` +
        `Net profit margin = ${monthlyRev > 0 ? ((monthlyRev - totalExpenses) / monthlyRev * 100).toFixed(1) : "N/A"}% ` +
        `(${schemeCfg.label} requires ≥ 5–10%).`,
      fixes,
      impact: `Achieving a 10% net margin (${fmt(monthlyRev * 0.10)}/month profit) will qualify your project for ${schemeCfg.label}.`
    });
  }

  // ── Issue 3: Negative closing cash / WC shortfall ─────────────────────────
  if (hasCash) {
    const cashYearNums = warnings.filter(w => w.includes("Closing cash")).map(w => {
      const yr  = w.match(/Year (\d+)/)?.[1] ?? "?";
      const amt = w.match(/₹([-\d,]+)/)?.[1]?.replace(/,/g, "") ?? "0";
      return { yr, amt: Math.abs(parseInt(amt)) };
    });
    const maxShortfall = cashYearNums.reduce((m, c) => Math.max(m, c.amt), 0);
    const extraContrib = Math.ceil(maxShortfall / 10000) * 10000; // round up to nearest 10K

    const fixes: Fix[] = [{
      step: "Step 4",
      where: "Means of Finance → Your Contribution (Margin Money)",
      current: `Promoter contribution: ${fmt(promoterCash)} (${pct(schemeCfg.promoterPct)} of project cost — meets scheme minimum)`,
      correct: `Increase contribution by ${fmt(extraContrib)} to create a working capital buffer. Total: ${fmt(promoterCash + extraContrib)}`,
      why: `Even though ${pct(schemeCfg.promoterPct)} meets the ${schemeCfg.label} minimum, your first-year working capital ` +
           `requirement exceeds the WC bank loan. Adding ${fmt(extraContrib)} as extra promoter margin resolves the cash shortfall.`
    }, {
      step: "Step 5",
      where: "Working Capital → Bank Finance Percentage",
      current: "Bank WC finance: 60% of WC requirement (default)",
      correct: "Increase to 70–75% bank finance for WC to reduce cash strain",
      why: "A higher WC bank finance % means more revolving credit available for day-to-day operations, preventing cash from going negative."
    }];

    advisories.push({
      id: "cash",
      severity: "warning",
      icon: BarChart2,
      title: `Working Capital Shortfall in ${cashYearNums.length} Year${cashYearNums.length > 1 ? "s" : ""}`,
      summary: `Closing cash goes negative in ${cashYearNums.map(c => `Year ${c.yr}`).join(", ")}. Maximum shortfall: ${fmt(maxShortfall)}.`,
      diagnosis:
        `This means your loan repayments + operating costs will consume more cash than the business generates in ` +
        `those years. This is common in early years when capacity is low (50–60%) but fixed costs are full. ` +
        `A buffer of ${fmt(extraContrib)} in promoter funds will cover this gap.`,
      fixes,
      impact: `Adding ${fmt(extraContrib)} promoter buffer resolves cash shortfall in all years. This is a minor adjustment, not a fundamental problem.`
    });
  }

  // ── Issue 4: Salary / Labour too high ────────────────────────────────────
  if (monthlyRev > 0 && monthlySalary > 0 && (monthlySalary / monthlyRev) > bench.labourMaxPct && !hasDSCR) {
    const labourRatio = monthlySalary / monthlyRev;
    const maxAllowed  = monthlyRev * bench.labourMaxPct;
    const excess      = monthlySalary - maxAllowed;

    advisories.push({
      id: "labour",
      severity: "warning",
      icon: Wrench,
      title: "Staff Cost Is High Relative to Revenue",
      summary: `Monthly salary (${fmt(monthlySalary)}) = ${pct(labourRatio)} of revenue. ${bench.name} norm is ≤ ${pct(bench.labourMaxPct)}.`,
      diagnosis:
        `You have ${totalStaff} staff with total monthly payroll of ${fmt(monthlySalary)}. ` +
        `At ${fmt(monthlyRev)} monthly revenue, this leaves ${pct(1 - labourRatio - (monthlyRM / monthlyRev))} ` +
        `for RM + overhead + profit — too thin for loan repayment.`,
      fixes: [{
        step: "Step 8",
        where: "Manpower → Staff Headcount / Salary",
        current: `${totalStaff} staff × avg salary = ${fmt(monthlySalary)}/month (${pct(labourRatio)} of revenue)`,
        correct: `Salary should be ≤ ${fmt(maxAllowed)}/month. Consider hiring ${Math.ceil(maxAllowed / (monthlySalary / totalStaff))} staff instead of ${totalStaff}, OR stage hiring in Year 2.`,
        why: `Banks apply a labour cost benchmark of ${pct(bench.labourMaxPct)} of revenue for ${bench.name}. ` +
             `Excess of ${fmt(excess)}/month reduces net margin by ${pct(excess / monthlyRev)}.`
      }],
      impact: `Reducing salary by ${fmt(excess)}/month adds ${fmt(excess * 12)}/year to net profit, improving DSCR by approx ${((excess * 12) / Math.max(annualTLRepay + annualTLInterest, 1)).toFixed(2)}x.`
    });
  }

  return advisories;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const SEV = {
  critical: {
    headerBg: "bg-red-50 border-red-200",
    badgeBg: "bg-red-500",
    badgeText: "bg-red-100 text-red-700 border-red-200",
    stepTag: "bg-red-100 text-red-700",
    fixRowBg: "bg-red-50/50",
    dot: "bg-red-500",
  },
  warning: {
    headerBg: "bg-amber-50 border-amber-200",
    badgeBg: "bg-amber-500",
    badgeText: "bg-amber-100 text-amber-700 border-amber-200",
    stepTag: "bg-amber-100 text-amber-700",
    fixRowBg: "bg-amber-50/50",
    dot: "bg-amber-500",
  },
};

interface Props {
  warnings: string[];
  formData: GTABFormData;
  onGoToStep?: (stepIndex: number) => void;
}

export function CMAAdvisoryPanel({ warnings, formData, onGoToStep }: Props) {
  const advisories = diagnose(warnings, formData);
  const [open, setOpen] = useState<Set<string>>(new Set(["dscr"]));

  if (advisories.length === 0) return null;

  const criticals = advisories.filter(a => a.severity === "critical").length;
  const scheme    = SCHEME_BENCH[(fd => (fd.loan_scheme || "pmegp").toLowerCase())(formData)]?.label ?? "your scheme";

  const toggle = (id: string) =>
    setOpen(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">

      {/* ── Panel header ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-4 bg-slate-50 border-b border-slate-200">
        <div className="flex-1">
          <p className="font-bold text-slate-800 text-sm">
            CA Review — {advisories.length} {advisories.length === 1 ? "Issue" : "Issues"} Found
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            PDF downloaded successfully. Fix these before submitting to the bank.
          </p>
        </div>
        <div className="flex gap-2">
          {criticals > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              {criticals} Critical
            </span>
          )}
          {advisories.length - criticals > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              {advisories.length - criticals} Advisory
            </span>
          )}
        </div>
      </div>

      {/* ── Advisory cards ────────────────────────────────────────────────── */}
      <div className="divide-y divide-slate-100">
        {advisories.map((adv, idx) => {
          const cfg    = SEV[adv.severity];
          const isOpen = open.has(adv.id);
          const Icon   = adv.icon;

          return (
            <div key={adv.id}>
              {/* Card header */}
              <button
                onClick={() => toggle(adv.id)}
                className="w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
              >
                <div className={`mt-0.5 w-7 h-7 rounded-full ${cfg.badgeBg} flex items-center justify-center shrink-0`}>
                  <Icon className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.badgeText}`}>
                      {adv.severity === "critical" ? "CRITICAL" : "ADVISORY"} #{idx + 1}
                    </span>
                    <p className="text-sm font-semibold text-slate-800">{adv.title}</p>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{adv.summary}</p>
                </div>
                <span className="shrink-0 text-slate-400 mt-1">
                  {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </span>
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="px-5 pb-5 space-y-4">

                  {/* Diagnosis */}
                  <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">CA Diagnosis</p>
                    <p className="text-sm text-slate-600 leading-relaxed">{adv.diagnosis}</p>
                  </div>

                  {/* Fix steps */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">What to Change</p>
                    <div className="space-y-3">
                      {adv.fixes.map((fix, fi) => (
                        <div key={fi} className={`rounded-xl border border-slate-200 overflow-hidden`}>
                          {/* Fix header */}
                          <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 border-b border-slate-200">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.stepTag}`}>{fix.step}</span>
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                            <span className="text-xs font-medium text-slate-600">{fix.where}</span>
                            {onGoToStep && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const num = parseInt(fix.step.replace(/\D/g, ""));
                                  if (!isNaN(num)) onGoToStep(num - 1);
                                }}
                                className="ml-auto text-[10px] h-6 px-2 rounded-lg text-slate-500 hover:text-slate-800"
                              >
                                Go there →
                              </Button>
                            )}
                          </div>

                          {/* Current vs Correct */}
                          <div className="grid grid-cols-2 divide-x divide-slate-200">
                            <div className="px-4 py-3 bg-red-50/60">
                              <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide mb-1">Current (Problem)</p>
                              <p className="text-xs text-red-700 font-mono leading-relaxed">{fix.current}</p>
                            </div>
                            <div className="px-4 py-3 bg-emerald-50/60">
                              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide mb-1">Change To (Fix)</p>
                              <p className="text-xs text-emerald-700 font-mono leading-relaxed">{fix.correct}</p>
                            </div>
                          </div>

                          {/* Why */}
                          <div className="px-4 py-2.5 bg-white border-t border-slate-100">
                            <p className="text-[11px] text-slate-500 leading-relaxed">{fix.why}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Impact */}
                  <div className="flex items-start gap-2.5 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
                    <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide mb-0.5">Expected Outcome</p>
                      <p className="text-xs text-emerald-700 leading-relaxed">{adv.impact}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-t border-slate-200">
        <p className="text-[11px] text-slate-400">
          Based on {scheme} norms · {INDUSTRY_BENCH[(formData.industry_type || "manufacturing").toLowerCase()]?.name || "Standard"} benchmarks · RBI/CA standard
        </p>
        <span className="text-[11px] text-slate-400">Fix above → Download again</span>
      </div>
    </div>
  );
}
