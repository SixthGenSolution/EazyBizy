import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { IndianRupee, Info, Wallet, Lightbulb, Banknote, SlidersHorizontal } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { GTABFormData, type GTABWorkingCapitalPeriod } from "@/types/gtab";
import { getAnnualWorkingCapital, getMonthlyWorkingCapital } from "@/lib/workingCapital";
import { getFinancingPlan } from "@/lib/projectReport";
import { getStep8Tips } from "@/lib/caGuidance";
import { numberToWords } from "@/lib/numberToWords";
import SectionTitle from "@/components/gtab/SectionTitle";

interface WorkingCapitalStepProps {
  formData: GTABFormData;
  updateFormData: (updates: Partial<GTABFormData>) => void;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const CATip = ({ tips }: { tips: string[] }) => (
  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1.5">
    <div className="flex items-center gap-2 text-amber-800 font-semibold text-xs uppercase tracking-wide">
      <Lightbulb className="w-3.5 h-3.5" />
      CA Guidance — Working Capital Norms
    </div>
    {tips.map((tip, i) => <p key={i} className="text-xs text-amber-700">• {tip}</p>)}
  </div>
);

// Multiplier options shown in the picker
const WC_PICKER_OPTIONS = [
  { value: 1.5, label: "1.5×", tag: "Conservative", desc: "Low cycle — mainly service / lean ops" },
  { value: 2.0, label: "2.0×", tag: "Moderate",     desc: "Trading / short operating cycle" },
  { value: 2.5, label: "2.5×", tag: "Standard",     desc: "Manufacturing (Tandon Committee norm)" },
  { value: 3.0, label: "3.0×", tag: "Liberal",      desc: "Heavy manufacturing / export businesses" },
  { value: 3.5, label: "3.5×", tag: "Seasonal",     desc: "Agriculture / NABARD crop cycle norm" },
];

const WorkingCapitalStep = ({ formData, updateFormData }: WorkingCapitalStepProps) => {
  const annualWC  = getAnnualWorkingCapital(formData.working_capital_required, formData.working_capital_period);
  const monthlyWC = getMonthlyWorkingCapital(formData.working_capital_required, formData.working_capital_period);
  const plan      = getFinancingPlan(formData);

  // ── Multiplier picker state (user can override the CA default) ──────────
  const [userMultiplier, setUserMultiplier] = useState<number | null>(null);

  // ── Industry-specific WC multipliers (CA / RBI / NABARD norms) ──
  // Manufacturing 2.5x: RM holding + WIP + FG + debtor days = long operating cycle (Tandon Committee)
  // Trading       2.0x: stock holding + debtor days, no WIP/FG
  // Service       1.5x: no stock; just salary/overhead until payment collected
  // Agriculture   3.5x: full crop cycle (sowing → harvest → sale) per NABARD norms
  const WC_MULTIPLIERS: Record<string, { months: number; reason: string }> = {
    manufacturing: { months: 2.5, reason: "RM stock + WIP + Finished Goods + Debtor days (Tandon Committee norms)" },
    trading:       { months: 2.0, reason: "Stock holding + debtor days; no WIP or FG component" },
    service:       { months: 1.5, reason: "No inventory; covers salary, rent & overhead until payment collected" },
    agriculture:   { months: 3.5, reason: "Full crop cycle funding: seeds → cultivation → harvest → sale (NABARD norms)" },
  };
  const industryKey  = (formData.industry_type === "others" ? "manufacturing" : formData.industry_type || "manufacturing").toLowerCase();
  const wcNorm       = WC_MULTIPLIERS[industryKey] ?? WC_MULTIPLIERS["manufacturing"];

  const monthlyRawMat  = Number(formData.raw_material_cost || 0);
  const monthlySalary  = Number(formData.total_monthly_salary || 0);
  const monthlyRent    = Number(formData.monthly_rent || 0);
  const otherMonthly   = Number(formData.electricity_water_cost || 0) + Number(formData.repair_maintenance_cost || 0) + Number(formData.transport_cost || 0) + Number(formData.miscellaneous_cost || 0) + Number(formData.stationery_cost || 0) + Number(formData.telephone_internet_cost || 0) + Number(formData.marketing_cost || 0);
  const totalMonthly   = monthlyRawMat + monthlySalary + monthlyRent + otherMonthly;

  // Use user-selected multiplier if set, else fall back to industry norm
  const activeMultiplier = userMultiplier ?? wcNorm.months;
  const caWCSuggestion   = Math.round(totalMonthly * activeMultiplier);

  // Bank WC loan — RBI/Nayak Committee turnover method mandates a minimum of
  // 80% for MSE borrowers (turnover ≤ ₹5 crore), applied uniformly regardless
  // of industry — from actual financing plan.
  const bankWCLoan     = plan.workingCapitalLoan;
  const promoterMargin = Math.max(monthlyWC - bankWCLoan, 0);
  const wcBankPct      = plan.wcBankFinancePct;

  const industryLabel  = industryKey.charAt(0).toUpperCase() + industryKey.slice(1);
  const serviceActivity = `${formData.type_of_business || ""} ${formData.products_services || ""}`.toLowerCase();
  const serviceFloatSuggestion = (() => {
    if (industryKey !== "service") return null;
    if (/dtp|print|printing|xerox|photocopy|design/.test(serviceActivity)) {
      return "DTP / printing service: banks usually expect a 7-15 day billing float if most customers pay quickly.";
    }
    if (/software|saas|it|web|app|technology/.test(serviceActivity)) {
      return "Software / IT service: keep a 30-45 day billing float because invoices often clear after milestone approval.";
    }
    if (/consult|advisory|professional|training/.test(serviceActivity)) {
      return "Consulting / professional service: use a 30-60 day float where client approvals and collections are slower.";
    }
    if (/agency|marketing|advertising|media|creative/.test(serviceActivity)) {
      return "Agency service: a 15-30 day float is usually prudent for campaign billing and vendor payments.";
    }
    return "Service business: choose a float based on actual client billing cycle. Do not reduce below expected receivable days.";
  })();

  const activeOption   = WC_PICKER_OPTIONS.find(o => o.value === activeMultiplier);
  const caTips = [
    ...getStep8Tips({
      industry: formData.industry_type || "manufacturing",
      scheme: formData.loan_scheme || "normal_msme",
    }),
    `CA Norm for ${industryLabel}: WC ≈ ${wcNorm.months}× months of operating expenses. ${wcNorm.reason}.`,
    caWCSuggestion > 0
      ? `Using ${activeMultiplier}× multiplier (${activeOption?.tag ?? "Custom"}): ${fmt(totalMonthly)}/month × ${activeMultiplier} = ${fmt(caWCSuggestion)}.${userMultiplier && userMultiplier !== wcNorm.months ? ` (CA recommends ${wcNorm.months}× for ${industryLabel})` : ""}`
      : "Fill Step 9 expenses to get an industry-calibrated WC auto-suggestion.",
    `Bank funds ${Math.round(wcBankPct)}% of WC as Bank WC Loan (RBI/Nayak Committee turnover method — mandatory minimum 80% for MSE borrowers). You contribute ${100 - Math.round(wcBankPct)}% as Promoter Margin.`,
    ...(serviceFloatSuggestion ? [serviceFloatSuggestion] : []),
  ];

  return (
    <div className="mx-auto max-w-none space-y-4 sm:space-y-6">
      <Card className="gtab-card-light rounded-[0.9rem] border shadow-sm sm:rounded-2xl">
        <CardContent className="space-y-5 p-4 sm:space-y-7 sm:p-8">

          <SectionTitle icon={Wallet} title="Working Capital Requirement"
            subtitle="How much money you need to run the business month-to-month, BEFORE you collect from customers." />

          {/* CA Suggestion + Multiplier Picker */}
          <div className="rounded-2xl border border-teal-200/70 bg-gradient-to-br from-teal-50 via-white to-cyan-50 p-5 space-y-4 shadow-sm">

            {/* Header row */}
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100">
                <SlidersHorizontal className="w-4 h-4 text-teal-700" />
              </div>
              <div>
                <p className="text-sm font-bold text-teal-800 leading-tight">CA Working Capital Estimator</p>
                <p className="text-[11px] text-teal-600">Adjust the multiplier or use your industry default</p>
              </div>
              <span className="ml-auto text-[10px] font-bold uppercase tracking-widest bg-teal-100 text-teal-700 px-2.5 py-1 rounded-full border border-teal-200">
                {industryLabel} · CA: {wcNorm.months}×
              </span>
            </div>

            {/* Multiplier pill picker */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Choose Multiplier</p>
              <div className="flex flex-wrap gap-2">
                {WC_PICKER_OPTIONS.map((opt) => {
                  const isCADefault  = opt.value === wcNorm.months;
                  const isActive     = opt.value === activeMultiplier;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setUserMultiplier(opt.value)}
                      className={[
                        "relative flex flex-col items-center px-3 py-2 rounded-xl border text-left transition-all duration-200 group",
                        isActive
                          ? "border-teal-500 bg-teal-600 text-white shadow-[0_0_16px_rgba(0,194,209,0.35)] scale-[1.04]"
                          : "border-slate-200 bg-white text-slate-700 hover:border-teal-300 hover:bg-teal-50 hover:shadow-md",
                      ].join(" ")}
                    >
                      {isCADefault && (
                        <span className={[
                          "absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full whitespace-nowrap",
                          isActive ? "bg-white text-teal-700" : "bg-teal-500 text-white",
                        ].join(" ")}>
                          CA rec.
                        </span>
                      )}
                      <span className={`text-base font-extrabold ${isActive ? "text-white" : "text-teal-700"}`}>{opt.label}</span>
                      <span className={`text-[10px] font-semibold mt-0.5 ${isActive ? "text-teal-100" : "text-slate-500"}`}>{opt.tag}</span>
                    </button>
                  );
                })}
              </div>
              {activeMultiplier && (
                <p className="text-[11px] text-slate-500 italic">
                  {WC_PICKER_OPTIONS.find(o => o.value === activeMultiplier)?.desc}
                </p>
              )}
            </div>

            {/* Computed suggestion */}
            {caWCSuggestion > 0 ? (
              <div className="rounded-xl bg-teal-600/8 border border-teal-200 px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-teal-700 font-medium">
                    {fmt(totalMonthly)} × {activeMultiplier} months
                  </p>
                  <p className="text-2xl font-extrabold text-teal-700 tabular-nums">{fmt(caWCSuggestion)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateFormData({ working_capital_required: caWCSuggestion, working_capital_period: "monthly" })}
                  className="shrink-0 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-md hover:bg-teal-700 hover:shadow-[0_0_16px_rgba(0,194,209,0.4)] active:scale-95 transition-all duration-150"
                >
                  Use this →
                </button>
              </div>
            ) : (
              <p className="text-xs text-teal-600 italic">Fill Step 9 (Operating Expenses) to see the auto-suggestion.</p>
            )}
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <Label className="text-base font-semibold">Working Capital Requirement (₹) *</Label>
              <Input
                type="number"
                className="h-14 rounded-xl text-lg font-semibold"
                value={formData.working_capital_required || ""}
                onChange={(e) => updateFormData({ working_capital_required: parseFloat(e.target.value) || 0 })}
                placeholder={caWCSuggestion > 0 ? `e.g. ${caWCSuggestion.toLocaleString("en-IN")}` : "Enter amount"}
                min={0}
              />
              {formData.working_capital_required > 0 && (
                <p className="text-xs font-medium text-primary/80">₹ {numberToWords(formData.working_capital_required)}</p>
              )}
              <p className="text-xs text-muted-foreground">Enter the amount you'll need per month (or annually — select period below).</p>
            </div>

            <div className="space-y-3">
              <Label className="font-semibold">Is this a Monthly or Annual amount?</Label>
              <RadioGroup
                value={formData.working_capital_period}
                onValueChange={(v: GTABWorkingCapitalPeriod) => {
                  if (v === formData.working_capital_period) return;
                  // Rescale the entered number so it keeps meaning the same real
                  // amount — flipping the unit must not silently change the
                  // underlying WC requirement by 12x.
                  const currentAmount = Number(formData.working_capital_required || 0);
                  const convertedAmount = v === "annual" ? currentAmount * 12 : currentAmount / 12;
                  updateFormData({
                    working_capital_period: v,
                    working_capital_required: Math.round(convertedAmount),
                  });
                }}
                className="flex gap-8"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="monthly" id="monthly" />
                  <Label htmlFor="monthly" className="cursor-pointer font-medium">Monthly</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="annual" id="annual" />
                  <Label htmlFor="annual" className="cursor-pointer font-medium">Annual</Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          {/* WC Summary — monthly + annual */}
          {formData.working_capital_required > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
              <div className="p-5 rounded-xl bg-muted/40 border space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <IndianRupee className="w-4 h-4" />
                  <span className="text-sm font-medium">Monthly WC Required</span>
                </div>
                <p className="text-2xl font-bold">{fmt(monthlyWC)}</p>
              </div>
              <div className="p-5 rounded-xl bg-gradient-to-r from-primary to-primary/70 text-white space-y-1">
                <div className="flex items-center gap-2">
                  <IndianRupee className="w-4 h-4" />
                  <span className="text-sm font-medium">Annual WC Required</span>
                </div>
                <p className="text-2xl font-bold">{fmt(annualWC)}</p>
              </div>
            </div>
          )}

          {/* Bank vs Promoter split — scheme-aware */}
          {monthlyWC > 0 && (
            <div className="rounded-xl bg-[#0f1f35] border border-primary/30 p-5 space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Working Capital — Bank & Promoter Split
              </p>
              <div className="flex justify-between items-center py-1.5 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-blue-400" />
                  <span className="text-sm text-slate-300">Bank WC Loan ({Math.round(wcBankPct)}% of WC)</span>
                </div>
                <span className="text-sm font-bold text-blue-400 tabular-nums">{fmt(bankWCLoan)}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-amber-400" />
                  <span className="text-sm text-slate-300">Promoter Margin on WC ({100 - Math.round(wcBankPct)}%)</span>
                </div>
                <span className="text-sm font-bold text-amber-400 tabular-nums">{fmt(promoterMargin)}</span>
              </div>
              <div className="flex justify-between items-center pt-1">
                <span className="text-sm font-bold text-white">Total WC Requirement</span>
                <span className="text-sm font-bold text-white tabular-nums">{fmt(monthlyWC)}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Bank WC Loan forms part of your Total Bank Finance. Promoter Margin is included in Initial Project Investment.
              </p>
            </div>
          )}

          {/* CA Tips */}
          <CATip tips={caTips} />

          <div className="border-t" />

          {/* Application Summary */}
          <SectionTitle icon={IndianRupee} title="Application Summary" subtitle="Verify before proceeding to Promoter Net Worth (Step 9)" />

          <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-50 via-white to-blue-50 border border-indigo-100 shadow-sm space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[
                { label: "Applicant", value: [formData.first_name, formData.middle_name, formData.last_name].filter(Boolean).join(" ") },
                { label: "Business Name", value: formData.business_entity_name || "—" },
                { label: "Loan Scheme", value: formData.loan_scheme === "other_scheme" ? formData.loan_scheme_other : (formData.loan_scheme || "—")?.toUpperCase() },
                { label: "Industry", value: formData.industry_type === "others" ? formData.industry_other : formData.industry_type },
              ].map(({ label, value }) => (
                <div key={label} className="space-y-1 p-3 rounded-lg bg-white/60 border border-indigo-100 border-l-4 border-l-indigo-500 pl-4">
                  <span className="text-xs text-gray-700 uppercase tracking-wide font-semibold">{label}</span>
                  <p className="font-bold text-base text-black">{value}</p>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-indigo-100 space-y-3">
              {[
                { label: "Initial Project Investment (Fixed Capital + WC Margin)", value: plan.totalProjectCost, color: "text-indigo-700" },
                { label: "Total Bank Finance (Term Loan + WC Loan)", value: plan.totalBankFinance, color: "text-emerald-600" },
                { label: "Promoter's Own Contribution", value: plan.promoterContribution, color: "text-amber-700" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className={`text-lg font-bold ${color}`}>{fmt(value)}</span>
                </div>
              ))}
            </div>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <b>Next Step — Promoter Net Worth (Step 9):</b> Enter production parameters, revenue assumptions, promoter details and financial projections. The backend CA engine will calculate DSCR, Break-Even, Sensitivity and generate the full CMA+DPR report.
            </AlertDescription>
          </Alert>

        </CardContent>
      </Card>
    </div>
  );
};

export default WorkingCapitalStep;
