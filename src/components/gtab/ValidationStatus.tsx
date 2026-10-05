/**
 * ValidationStatus — CA Credit Score Coach
 * Shows exactly WHAT to fix, HOW to fix it, WHICH STEP, and how many points it adds.
 * Never blocks navigation — always informational.
 */

import { AlertTriangle, CheckCircle, CheckCircle2, Info, TrendingUp, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GTABValidationResult } from "@/hooks/useGTABValidation";
import { GTABFormData } from "@/types/gtab";

interface ValidationStatusProps {
  validation: GTABValidationResult;
  currentStep: number;
  formData?: GTABFormData;
  onNavigate?: (step: number) => void;   // jump to the step that fixes an issue
}

// Score colour band
const scoreBand = (score: number) => {
  if (score >= 85) return { label: "Strongly Approvable", color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", bar: "bg-emerald-500" };
  if (score >= 70) return { label: "Approvable",          color: "text-green-600",   bg: "bg-green-50 border-green-200",     bar: "bg-green-500" };
  if (score >= 55) return { label: "Under Review",        color: "text-amber-600",   bg: "bg-amber-50 border-amber-200",     bar: "bg-amber-500" };
  return             { label: "Needs Improvement",        color: "text-red-600",     bg: "bg-red-50 border-red-200",         bar: "bg-red-500" };
};

// ── Actionable improvement items ──────────────────────────────────────────────
interface ImprovementAction {
  points: number;        // how many score points this fix adds
  priority: "critical" | "important" | "optional";
  issue: string;         // what's wrong (plain language)
  fix: string;           // exactly what to do
  step: number;          // which wizard step to go to
  stepLabel: string;     // step description
  section?: string;      // which section in that step
}

function buildImprovementActions(formData: GTABFormData | undefined, validation: GTABValidationResult): ImprovementAction[] {
  if (!formData) return [];
  const actions: ImprovementAction[] = [];
  const pri = formData.project_report_inputs;
  const isTrading  = formData.industry_type === "trading";
  const isService  = formData.industry_type === "service";
  const score      = validation.bankScore.credit_score;

  // ── 1. Experience = 0 → -8 points ────────────────────────────────────────
  const exp = pri?.promoter?.years_experience ?? 0;
  if (exp === 0) {
    actions.push({
      points: 8, priority: "critical",
      issue: "Years of experience = 0. Bank scores zero-experience promoters as HIGH RISK.",
      fix: "Enter your years of experience in this trade/field. Even 1–2 years of working in a similar shop or sector counts. Self-employment, previous job, or family business experience all qualify.",
      step: 9, stepLabel: "Step 9 → Promoter Profile", section: "Section 1 — Promoter Profile",
    });
  } else if (exp < 3) {
    actions.push({
      points: 3, priority: "important",
      issue: `Only ${exp} year(s) of experience. Banks prefer 3+ years.`,
      fix: "Add employment history (employment from/to dates) in Promoter Profile to show your background in this trade.",
      step: 9, stepLabel: "Step 9 → Promoter Profile", section: "Employment From / To",
    });
  }

  // ── 2. No products added for trading/service → revenue = 0 → REJECT ────
  const productCount = pri?.revenue?.product_categories?.length ?? 0;
  if ((isTrading || isService) && productCount === 0) {
    actions.push({
      points: 20, priority: "critical",
      issue: `No ${isTrading ? "products" : "services"} added. Revenue = ₹0 → DSCR = 0 → automatic REJECT.`,
      fix: `Go to Step 9 → Section 4 and click "Add ${isTrading ? "Product" : "Service"}". Add EACH item you sell with its purchase price, selling price, and monthly quantity. This is the MOST IMPORTANT field — without it, the report shows zero revenue.`,
      step: 9, stepLabel: `Step 9 → ${isTrading ? "Trading Products" : "Service Revenue"}`, section: "Section 4 — Revenue",
    });
  }

  // ── 3. Gross margin too low → deduction ───────────────────────────────────
  const gmPct = formData.gross_margin || pri?.revenue?.gross_margin_pct || 0;
  const totalRev = pri?.revenue?.product_categories?.reduce((s, p) => {
    return s + (Number(p.fixed_revenue) || Number(p.quantity_sold || p.units_monthly || 0) * Number(p.selling_price || p.avg_price || 0));
  }, 0) ?? 0;
  const totalCogs = pri?.revenue?.product_categories?.reduce((s, p) => {
    return s + (Number(p.quantity_sold || p.units_monthly || 0) * Number(p.purchase_price || 0));
  }, 0) ?? 0;
  const computedGM = totalRev > 0 ? Math.round(((totalRev - totalCogs) / totalRev) * 100) : gmPct;

  if (isTrading && productCount > 0 && computedGM < 15) {
    actions.push({
      points: 8, priority: "critical",
      issue: `Gross Margin = ${computedGM}% — too low. Banks expect ≥ 20-25% for trading. Your selling price vs purchase price gap is very thin.`,
      fix: `Step 9 → Products → Review each product: increase Selling Price or reduce Purchase Price to achieve ≥ 20% margin. Example: If you buy at ₹80, sell at ₹100 (25% margin) not ₹85 (6% margin).`,
      step: 9, stepLabel: "Step 9 → Trading Products", section: "Purchase Price vs Selling Price",
    });
  } else if (isTrading && computedGM < 20 && computedGM >= 15) {
    actions.push({
      points: 4, priority: "important",
      issue: `Gross Margin = ${computedGM}%. Target ≥ 20% for better score.`,
      fix: "Slightly increase selling price or reduce purchase cost to hit 20%+ gross margin.",
      step: 9, stepLabel: "Step 9 → Trading Products", section: "Section 4 — Products",
    });
  }

  // ── 4. PAN or Aadhaar missing ─────────────────────────────────────────────
  const hasPAN    = !!(pri?.promoter?.pan_number?.trim());
  const hasAadhar = !!(pri?.promoter?.aadhar_number?.trim());
  if (!hasPAN || !hasAadhar) {
    actions.push({
      points: 5, priority: "critical",
      issue: `${!hasPAN ? "PAN" : ""}${!hasPAN && !hasAadhar ? " and " : ""}${!hasAadhar ? "Aadhaar" : ""} number missing. Mandatory for KYC — bank will reject without these.`,
      fix: "Step 9 → Promoter Profile → Enter your PAN (10-character alphanumeric) and Aadhaar (12-digit) numbers.",
      step: 9, stepLabel: "Step 9 → Promoter Profile", section: "PAN & Aadhaar",
    });
  }

  // ── 5. Loan amount too high → debt-equity ratio > 3 ─────────────────────
  const tl = formData.eligible_loan_amount || 0;
  const pc = formData.total_project_cost || 0;
  const promoterAmt = pc - tl;
  const deRatio = promoterAmt > 0 ? tl / promoterAmt : 0;
  if (deRatio > 3) {
    actions.push({
      points: 8, priority: "critical",
      issue: `Debt-Equity Ratio = ${deRatio.toFixed(1)} : 1 (very high). Banks want ≤ 2 : 1. You're borrowing too much relative to your own contribution.`,
      fix: "Reduce loan amount OR increase your own equity contribution. Go to Step 5 → increase project scope funded by promoter, or reduce the Term Loan % in Step 9 → Loan Structure.",
      step: 5, stepLabel: "Step 5 → Project Requirements", section: "Means of Finance",
    });
  } else if (deRatio > 2) {
    actions.push({
      points: 4, priority: "important",
      issue: `Debt-Equity Ratio = ${deRatio.toFixed(1)} : 1. Target ≤ 2 : 1 for better score.`,
      fix: "Slightly increase your promoter equity or reduce the bank finance % in Step 9.",
      step: 9, stepLabel: "Step 9 → Loan Structure", section: "Bank Finance on Term Loan %",
    });
  }

  // ── 6. Working capital = 0 ─────────────────────────────────────────────
  const wc = formData.working_capital_required || 0;
  if (wc === 0) {
    actions.push({
      points: 5, priority: "important",
      issue: "Working Capital = ₹0. Every business needs working capital to buy stock, pay salaries and run day-to-day operations.",
      fix: "Step 6 → Working Capital → Enter your monthly working capital need (typically 1.5× monthly expenses).",
      step: 6, stepLabel: "Step 6 → Working Capital",
    });
  }

  // ── 7. Monthly expenses = 0 with employees ──────────────────────────────
  const totalExpenses = formData.total_monthly_salary || 0;
  const totalEmp = (formData.skilled_workers_count || 0) + (formData.semi_skilled_workers_count || 0) + (formData.wages_count || 0);
  if (totalEmp > 0 && totalExpenses === 0) {
    actions.push({
      points: 5, priority: "critical",
      issue: `${totalEmp} employees listed but monthly salary = ₹0. Report will show incorrect P&L.`,
      fix: "Step 9 → Monthly Expenses → Enter salary for each worker category (skilled/semi-skilled/wages).",
      step: 9, stepLabel: "Step 9 → Monthly Expenses", section: "Salary Section",
    });
  }

  // ── 8. Tax rate = 0 (would materially overstate profitability) ──────────
  // BUG FIX: this used to assert 25% is "mandatory under Income Tax Act" —
  // it isn't a statutory rate for every constitution (a Proprietorship is
  // taxed at the proprietor's own individual slab rates, not a flat rate).
  // The genuine concern is leaving tax at 0%, not falling short of 25%.
  const taxRate = pri?.revenue?.tax_rate_pct ?? 0;
  if (taxRate === 0) {
    actions.push({
      points: 3, priority: "important",
      issue: "Tax Rate = 0%. This materially overstates profitability — set an illustrative effective tax rate (25% is this platform's default assumption; actual tax depends on the applicant's business constitution and must be confirmed by a CA).",
      fix: "Step 9 → Financial Assumptions → Set an effective Tax Rate.",
      step: 9, stepLabel: "Step 9 → Financial Assumptions", section: "Tax Rate %",
    });
  }

  // ── 9. No commencement date ──────────────────────────────────────────────
  if (!pri?.business?.commencement_date) {
    actions.push({
      points: 2, priority: "optional",
      issue: "Business commencement date missing.",
      fix: "Step 9 → Business Details → Enter the proposed start date for the business.",
      step: 9, stepLabel: "Step 9 → Business Details",
    });
  }

  // ── 10. No competitor analysis ──────────────────────────────────────────
  const competitorCount = pri?.competitors?.length ?? 0;
  if (competitorCount === 0 && score < 70) {
    actions.push({
      points: 3, priority: "optional",
      issue: "No competitor analysis. Banks view this as lack of market research.",
      fix: "Step 9 → Section 7 → Competitor Analysis → Add 2-3 known competitors (name, type, strengths, weaknesses).",
      step: 9, stepLabel: "Step 9 → Competitor Analysis",
    });
  }

  // ── 11. Interest rate = 0 ───────────────────────────────────────────────
  const intRate = pri?.loan?.interest_rate_pct ?? 0;
  if (intRate === 0) {
    actions.push({
      points: 4, priority: "important",
      issue: "Interest rate = 0%. DSCR calculation will be wrong — report will be unrealistic.",
      fix: "Step 9 → Loan Structure → Enter the actual interest rate (PMEGP: ~12%, Mudra: ~10.5%, MSME: ~11%).",
      step: 9, stepLabel: "Step 9 → Loan Structure", section: "Annual Interest Rate %",
    });
  }

  // Sort by impact: critical first, then by points
  const order: Record<string, number> = { critical: 0, important: 1, optional: 2 };
  return actions.sort((a, b) => order[a.priority] - order[b.priority] || b.points - a.points);
}

// ── What's going well ──────────────────────────────────────────────────────────
function buildPositives(formData: GTABFormData | undefined, validation: GTABValidationResult): string[] {
  if (!formData) return [];
  const good: string[] = [];
  const pri = formData.project_report_inputs;

  if ((formData.total_project_cost || 0) > 0) good.push("Project cost documented with line items.");
  if ((formData.eligible_loan_amount || 0) > 0) good.push(`Eligible loan amount: ₹${Math.round(formData.eligible_loan_amount || 0).toLocaleString("en-IN")}`);
  if (validation.scheme.eligible) good.push(`Eligible for ${validation.scheme.scheme_name}`);
  if ((pri?.promoter?.pan_number?.trim())) good.push("PAN number provided ✓");
  if ((pri?.promoter?.aadhar_number?.trim())) good.push("Aadhaar number provided ✓");
  const exp = pri?.promoter?.years_experience ?? 0;
  if (exp >= 3) good.push(`Promoter has ${exp} years of experience ✓`);
  const productCount = pri?.revenue?.product_categories?.length ?? 0;
  if (productCount > 0) good.push(`${productCount} revenue line(s) added ✓`);
  if (validation.scheme.subsidy_amount && validation.scheme.subsidy_amount > 0)
    good.push(`Govt subsidy available: ₹${validation.scheme.subsidy_amount.toLocaleString("en-IN")}`);
  const intRate = pri?.loan?.interest_rate_pct ?? 0;
  if (intRate > 0) good.push(`Interest rate set: ${intRate}% p.a. ✓`);
  const taxRate = pri?.revenue?.tax_rate_pct ?? 0;
  if (taxRate >= 25) good.push("Tax rate set to 25% (CA standard) ✓");

  return good;
}

export function ValidationStatus({ validation, currentStep, formData, onNavigate }: ValidationStatusProps) {
  // Step 2 — scheme eligibility
  const showSchemeCard = currentStep === 2;
  // Step 10 — full credit score coach
  const showScoreCard  = currentStep === 10;

  // Non-step-9 hints (steps 1-8)
  const { warnings: stepWarnings, infos: stepInfos } = (() => {
    switch (currentStep) {
      case 1: return { warnings: validation.applicant.warnings, infos: validation.applicant.errors.map(e => `Review: ${e}`) };
      case 2: return { warnings: validation.scheme.warnings, infos: validation.scheme.errors.map(e => `Scheme note: ${e}`) };
      case 4: case 5: case 6: case 7:
        return { warnings: validation.financial.warnings, infos: validation.financial.errors.map(e => `Financial note: ${e}`) };
      default: return { warnings: [], infos: [] };
    }
  })();

  const band    = scoreBand(validation.bankScore.credit_score);
  const score   = validation.bankScore.credit_score;
  const rec     = validation.bankScore.recommendation;
  const isReject  = rec === "REJECT";
  const actions   = buildImprovementActions(formData, validation);
  const positives = buildPositives(formData, validation);

  const critical  = actions.filter(a => a.priority === "critical");
  const important = actions.filter(a => a.priority === "important");
  const optional  = actions.filter(a => a.priority === "optional");
  const potentialGain = actions.reduce((s, a) => s + a.points, 0);
  const projectedScore = Math.min(score + potentialGain, 100);

  // ── Non-step-10 inline warnings ───────────────────────────────────────────
  if (!showScoreCard && !showSchemeCard) {
    if (stepWarnings.length === 0 && stepInfos.length === 0) return null;
    return (
      <div className="space-y-2 mt-2">
        {stepWarnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <p className="text-sm font-semibold text-amber-700">Review before proceeding</p>
            </div>
            <ul className="space-y-1">
              {stepWarnings.map((w, i) => <li key={i} className="text-xs text-amber-800 flex items-start gap-1.5"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />{w}</li>)}
            </ul>
          </div>
        )}
        {stepInfos.length > 0 && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
            <ul className="space-y-1">
              {stepInfos.map((n, i) => <li key={i} className="text-xs text-blue-800 flex items-start gap-1.5"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />{n}</li>)}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // ── Step 2: Scheme eligibility card ──────────────────────────────────────
  if (showSchemeCard) {
    return (
      <div className="mt-2">
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${validation.scheme.eligible ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
          {validation.scheme.eligible
            ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            : <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
          <div>
            <p className={`text-sm font-semibold ${validation.scheme.eligible ? "text-emerald-700" : "text-amber-700"}`}>
              {validation.scheme.eligible ? `✓ Eligible for ${validation.scheme.scheme_name}` : `Scheme note — adjust if needed`}
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              Max loan: ₹{validation.scheme.loan_amount_range[1].toLocaleString("en-IN")}
              {validation.scheme.subsidy_amount ? ` | Subsidy: ₹${validation.scheme.subsidy_amount.toLocaleString("en-IN")}` : ""}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 9: Full Credit Score Coach ──────────────────────────────────────
  return (
    <div className="space-y-4 mt-2">

      {/* ── Score Header ──────────────────────────────────────────────────── */}
      <div className={`rounded-2xl border p-5 space-y-3 ${band.bg}`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <TrendingUp className={`h-6 w-6 ${band.color}`} />
            <div>
              <p className={`text-xl font-extrabold ${band.color}`}>
                Credit Score: {score} / 100
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                Recommendation: <span className={`font-bold ${isReject ? "text-red-600" : "text-green-600"}`}>{rec}</span>
                {potentialGain > 0 && ` · Fix all issues below to reach ~${projectedScore}/100`}
              </p>
            </div>
          </div>
          <Badge
            onClick={() => { const first = actions[0]; if (first && onNavigate) onNavigate(first.step); }}
            className={`${band.color} bg-white/80 border-0 font-bold text-sm px-3 py-1 ${actions.length && onNavigate ? "cursor-pointer hover:bg-white" : ""}`}
            title={actions.length ? "Go to the first issue to fix" : undefined}
          >{band.label}{actions.length && onNavigate ? " →" : ""}</Badge>
        </div>

        {/* Progress bars */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>0</span>
            <div className="flex-1 bg-slate-200 rounded-full h-3 relative overflow-hidden">
              <div className={`absolute left-0 top-0 h-full rounded-full transition-all ${band.bar}`} style={{ width: `${score}%` }} />
              {projectedScore > score && (
                <div className="absolute left-0 top-0 h-full rounded-full bg-emerald-300/50" style={{ width: `${projectedScore}%` }} />
              )}
              {/* Target markers */}
              <div className="absolute top-0 h-full border-l-2 border-amber-500 border-dashed" style={{ left: "55%" }} />
              <div className="absolute top-0 h-full border-l-2 border-emerald-600 border-dashed" style={{ left: "70%" }} />
            </div>
            <span>100</span>
          </div>
          <div className="flex justify-between text-xs text-slate-500 px-4">
            <span className="text-red-500">REJECT &lt;55</span>
            <span className="text-amber-500">REVIEW 55+</span>
            <span className="text-green-600">APPROVE 70+</span>
            <span className="text-emerald-600">STRONG 85+</span>
          </div>
        </div>

        {/* Target gap */}
        {score < 70 && (
          <div className="rounded-xl bg-white/70 border border-white px-4 py-2.5 text-sm">
            <span className="font-semibold text-slate-700">
              {score < 55 ? `You need ${70 - score} more points to move from REJECT → APPROVE.` : `You need ${70 - score} more points for APPROVE.`}
            </span>
            {potentialGain >= 70 - score && (
              <span className="text-emerald-700 font-bold ml-1">✓ Fixable! Follow the improvement plan below.</span>
            )}
          </div>
        )}

        {score >= 70 && (
          <div className="rounded-xl bg-emerald-100 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-800 font-semibold">
            ✓ Score is in approvable range! Fix remaining issues to improve from {rec} → STRONGLY APPROVE.
          </div>
        )}
      </div>

      {/* ── Critical Issues ────────────────────────────────────────────────── */}
      {critical.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <p className="text-sm font-bold text-red-700 uppercase tracking-wide">
              🔴 CRITICAL — Fix These First (+{critical.reduce((s, a) => s + a.points, 0)} pts)
            </p>
          </div>
          {critical.map((action, i) => (
            <div key={i} className="rounded-xl border-2 border-red-200 bg-red-50 p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-red-800">{action.issue}</p>
                <Badge className="bg-red-100 text-red-700 border-red-200 shrink-0 font-bold">+{action.points} pts</Badge>
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.(action.step)}
                disabled={!onNavigate}
                className={`w-full text-left flex items-start gap-2 bg-white/70 rounded-lg p-3 ${onNavigate ? "cursor-pointer hover:bg-white transition-colors" : ""}`}
              >
                <ArrowRight className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-red-700 mb-0.5">{action.stepLabel} {onNavigate && <span className="underline">— Fix this</span>}</p>
                  <p className="text-xs text-red-700">{action.fix}</p>
                  {action.section && <p className="text-xs text-red-500 mt-0.5 italic">→ {action.section}</p>}
                </div>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Important Issues ───────────────────────────────────────────────── */}
      {important.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-amber-500" />
            <p className="text-sm font-bold text-amber-700 uppercase tracking-wide">
              🟡 IMPORTANT — High Impact (+{important.reduce((s, a) => s + a.points, 0)} pts)
            </p>
          </div>
          {important.map((action, i) => (
            <div key={i} className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-amber-800">{action.issue}</p>
                <Badge className="bg-amber-100 text-amber-700 border-amber-200 shrink-0 font-bold">+{action.points} pts</Badge>
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.(action.step)}
                disabled={!onNavigate}
                className={`w-full text-left flex items-start gap-2 bg-white/70 rounded-lg p-3 ${onNavigate ? "cursor-pointer hover:bg-white transition-colors" : ""}`}
              >
                <ArrowRight className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-amber-700 mb-0.5">{action.stepLabel} {onNavigate && <span className="underline">— Fix this</span>}</p>
                  <p className="text-xs text-amber-700">{action.fix}</p>
                  {action.section && <p className="text-xs text-amber-500 mt-0.5 italic">→ {action.section}</p>}
                </div>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Optional improvements ────────────────────────────────────────── */}
      {optional.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-blue-400" />
            <p className="text-sm font-bold text-blue-700 uppercase tracking-wide">
              🔵 OPTIONAL — Boosts Report Quality (+{optional.reduce((s, a) => s + a.points, 0)} pts)
            </p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-2">
            {optional.map((action, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-blue-800">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                <span><strong>+{action.points} pts</strong> — {action.fix} ({action.stepLabel})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── What's going well ─────────────────────────────────────────────── */}
      {positives.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <p className="text-sm font-bold text-emerald-700">✅ WHAT'S GOOD — Keep These</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
            {positives.map((p, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />{p}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── All clear message ────────────────────────────────────────────── */}
      {actions.length === 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto mb-2" />
          <p className="text-sm font-bold text-emerald-700">All critical items are complete!</p>
          <p className="text-xs text-emerald-600 mt-1">Your application looks strong. Proceed to Download Report.</p>
        </div>
      )}

      {/* ── Govt subsidy note ─────────────────────────────────────────────── */}
      {validation.scheme.subsidy_amount && validation.scheme.subsidy_amount > 0 && (
        <div className="rounded-xl bg-purple-50 border border-purple-200 px-4 py-3 text-sm text-purple-800 font-medium">
          🎁 Government Subsidy Available: ₹{validation.scheme.subsidy_amount.toLocaleString("en-IN")} — This does not need to be repaid!
        </div>
      )}

    </div>
  );
}
