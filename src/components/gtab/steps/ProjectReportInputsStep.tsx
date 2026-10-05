import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { numberToWords } from "@/lib/numberToWords";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Boxes, CheckCircle2, CircleHelp, Factory, Landmark, Lightbulb, Plus, Store, Trash2, Wallet } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GTABFormData, PRODUCT_SUGGESTIONS, ProjectReportInputs, ProjectReportProductCategory } from "@/types/gtab";
import { getFinancingPlan, getBankFinancePctBand } from "@/lib/projectReport";
import { CASuggestionTip } from "@/components/gtab/CASuggestionTip";
import { advisePromoterMargin } from "@/lib/caAdvisory";
import SectionTitle from "@/components/gtab/SectionTitle";
import { getMonthlyWorkingCapital } from "@/lib/workingCapital";
import { getStep9Tips } from "@/lib/caGuidance";
import { buildLoanSchedule } from "@/lib/loanSchedule";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** CA Readiness Score — shows how complete this step is for loan approval. */
const CAReadiness = ({ formData, report, isTrading, isService, isAgriculture }: any) => {
  const checks = [
    { label: "Promoter PAN Number",       ok: !!report.promoter.pan_number, required: true },
    { label: "Father's Name & Date of Birth", ok: !!(report.promoter.fathers_name && report.promoter.date_of_birth), required: true },
    { label: "Business Commencement Date", ok: !!report.business.commencement_date, required: true },
    { label: isTrading ? "Trading Products Added" : isService ? "Service Revenue Lines Added" : isAgriculture ? "Agriculture Revenue Lines Added" : "Production Parameters Filled",
      ok: (isTrading || isService || isAgriculture)
        ? report.revenue.product_categories.length > 0
        : !!(
            (report.dpr.fresh_leaves_per_day_kg > 0 || report.dpr.input_qty_per_day > 0) &&
            (report.dpr.selling_price_per_kg > 0 || report.dpr.selling_price_per_unit > 0)
          ),
      required: true },
    { label: "Interest Rate & Tenure Set",  ok: !!(report.loan.interest_rate_pct > 0 && report.loan.tenure_months > 0), required: true },
    // BUG FIX: this required tax_rate_pct >= 25 as if 25% were a statutory
    // minimum — it isn't. A Proprietorship is taxed at the proprietor's own
    // individual income-tax slab rates, not a flat rate; 25% is this
    // platform's illustrative effective-tax assumption only. Advisory
    // (not required), and only checks the rate isn't left at zero.
    { label: "Tax Rate Set (illustrative effective rate)", ok: report.revenue.tax_rate_pct > 0, required: false },
    { label: "Market Size / Growth Filled", ok: !!(report.business.market_size_crores > 0 || report.business.market_growth_pct > 0), required: false },
    { label: "Salary Hike Assumption Set",  ok: !!(report.dpr as any).salary_increase_pct || true, required: false },
  ];
  const required = checks.filter(c => c.required);
  const doneRequired = required.filter(c => c.ok).length;
  const total = checks.length;
  const done = checks.filter(c => c.ok).length;
  const score = Math.round((done / total) * 100);
  const allRequired = doneRequired === required.length;

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${allRequired ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {allRequired ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />}
          <span className={`text-sm font-bold ${allRequired ? "text-emerald-800" : "text-amber-800"}`}>
            CA Report Readiness: {score}%
            {allRequired ? " — Ready to generate report" : ` — ${required.length - doneRequired} required item(s) missing`}
          </span>
        </div>
        <Badge className={`text-xs ${allRequired ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-amber-100 text-amber-800 border-amber-200"}`} variant="outline">
          {done}/{total} complete
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {checks.map(({ label, ok, required }) => (
          <div key={label} className="flex items-center gap-1.5 text-xs">
            {ok
              ? <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
              : <div className={`w-3 h-3 rounded-full border-2 shrink-0 ${required ? "border-red-400" : "border-amber-400"}`} />}
            <span className={ok ? "text-emerald-700" : required ? "text-red-700 font-medium" : "text-amber-700"}>{label}</span>
          </div>
        ))}
      </div>
      {!allRequired && (
        <p className="text-xs text-amber-700 font-medium">
          ⚠ Complete the required items (marked in red) to generate the CMA+DPR report. Optional items improve the report quality and loan approval chances.
        </p>
      )}
    </div>
  );
};

/** Inline CA tip box. */
const CATip = ({ tips }: { tips: string[] }) => (
  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1.5">
    <div className="flex items-center gap-2 text-amber-800 font-semibold text-xs uppercase tracking-wide">
      <Lightbulb className="w-3.5 h-3.5" />
      CA Guidance
    </div>
    {tips.map((tip, i) => <p key={i} className="text-xs text-amber-700">• {tip}</p>)}
  </div>
);

interface ProjectReportInputsStepProps {
  formData: GTABFormData;
  updateFormData: (updates: Partial<GTABFormData>) => void;
}

const NumberField = ({
  label,
  value,
  onChange,
  placeholder,
  min = 0,
  max,
  disabled = false,
  showWords = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  showWords?: boolean;
}) => {
  const words = showWords && value > 0 ? numberToWords(value) : "";
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        className="h-11 rounded-xl"
        value={Number.isFinite(value) ? value : ""}
        disabled={disabled}
        onChange={(e) => {
          const nextValue = Number(e.target.value) || 0;
          const clampedValue = typeof max === "number"
            ? Math.min(Math.max(nextValue, min), max)
            : Math.max(nextValue, min);
          onChange(clampedValue);
        }}
        placeholder={placeholder}
        min={min}
        max={max}
      />
      {words && (
        <p className="text-xs font-medium text-primary/80">₹ {words}</p>
      )}
    </div>
  );
};

const ProjectReportInputsStep = ({ formData, updateFormData }: ProjectReportInputsStepProps) => {
  const isTrading = formData.industry_type === "trading";
  const isService = formData.industry_type === "service";
  const isAgriculture = formData.industry_type === "agriculture";
  const report = formData.project_report_inputs;
  const monthlyWorkingCapital = getMonthlyWorkingCapital(
    Number(formData.working_capital_required || 0),
    formData.working_capital_period,
  );
  const financingPlan = getFinancingPlan(formData);

  const updateReport = (updates: Partial<ProjectReportInputs>) => {
    updateFormData({
      project_report_inputs: {
        ...report,
        ...updates,
      },
    });
  };

  const updateSection = <K extends keyof ProjectReportInputs>(
    key: K,
    updates: Partial<ProjectReportInputs[K]>
  ) => {
    updateReport({
      [key]: {
        ...report[key],
        ...updates,
      },
    } as Partial<ProjectReportInputs>);
  };

  const handleBankFinancePctChange = (value: number) => {
    // Bank Finance % varies bank-to-bank — never force-clamp to a scheme-
    // typical band. Only guard basic numeric sanity (0-100%).
    updateReport({
      dpr: {
        ...report.dpr,
        term_loan_pct: Math.min(Math.max(value, 0), 100),
      },
    });
  };

  const addProductCategory = (): string => {
    const newId = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : Math.random().toString(36).substring(2, 15);
    updateSection("revenue", {
      product_categories: [
        ...report.revenue.product_categories,
        {
          id: newId,
          category: "",
          units_monthly: 0,
          avg_price: 0,
          purchase_price: 0,
          selling_price: 0,
          quantity_sold: 0,
          margin_pct: 0,
          service_description: "",
          billing_unit: "Month",
          number_of_months: 1,
          service_mix_pct: 0,
        },
      ],
    });
    return newId;
  };

  const removeProductCategory = (id: string) => {
    updateSection("revenue", {
      product_categories: report.revenue.product_categories.filter((item) => item.id !== id),
    });
  };

  const updateTradingProduct = (id: string, updates: Partial<ProjectReportProductCategory>) => {
    const nextCategories = report.revenue.product_categories.map((item) => {
      if (item.id !== id) return item;

      const purchasePrice = Number(updates.purchase_price ?? item.purchase_price ?? 0) || 0;
      const sellingPrice = Number(updates.selling_price ?? item.selling_price ?? item.avg_price ?? 0) || 0;
      const quantitySold = Number(updates.quantity_sold ?? item.quantity_sold ?? item.units_monthly ?? 0) || 0;
      const marginPct = sellingPrice > 0
        ? Number((((sellingPrice - purchasePrice) / sellingPrice) * 100).toFixed(2))
        : 0;

      return {
        ...item,
        ...updates,
        purchase_price: purchasePrice,
        selling_price: sellingPrice,
        quantity_sold: quantitySold,
        margin_pct: marginPct,
        units_monthly: quantitySold,
        avg_price: sellingPrice,
        fixed_revenue: quantitySold * sellingPrice,
      };
    });

    const validMargins = nextCategories
      .map((item) => Number(item.margin_pct) || 0)
      .filter((value) => value > 0);
    const averageMargin = validMargins.length
      ? Number((validMargins.reduce((sum, value) => sum + value, 0) / validMargins.length).toFixed(2))
      : report.revenue.gross_margin_pct;

    updateReport({
      revenue: {
        ...report.revenue,
        gross_margin_pct: averageMargin,
        product_categories: nextCategories,
      },
    });
  };

  const updateServiceRevenue = (id: string, updates: Partial<ProjectReportProductCategory>) => {
    const nextCategories = report.revenue.product_categories.map((item) => {
      if (item.id !== id) return item;

      const rate = Number(updates.avg_price ?? item.avg_price ?? 0) || 0;
      const quantity = Number(updates.units_monthly ?? item.units_monthly ?? 0) || 0;
      const months = Number(updates.number_of_months ?? item.number_of_months ?? 1) || 1;
      const monthlyRevenue = rate * quantity;

      return {
        ...item,
        ...updates,
        avg_price: rate,
        units_monthly: quantity,
        number_of_months: months,
        fixed_revenue: monthlyRevenue,
      };
    });

    const totalMonthlyRevenue = nextCategories.reduce(
      (sum, item) => sum + (Number(item.fixed_revenue) || Number(item.units_monthly || 0) * Number(item.avg_price || 0)),
      0,
    );

    updateReport({
      revenue: {
        ...report.revenue,
        gross_margin_pct: report.revenue.gross_margin_pct || 100,
        product_categories: nextCategories.map((item) => {
          const monthlyRevenue = Number(item.fixed_revenue) || Number(item.units_monthly || 0) * Number(item.avg_price || 0);
          return {
            ...item,
            service_mix_pct: totalMonthlyRevenue > 0
              ? Number(((monthlyRevenue / totalMonthlyRevenue) * 100).toFixed(2))
              : Number(item.service_mix_pct) || 0,
          };
        }),
      },
    });
  };

  // ── Industry-specific capacity defaults (no hardcodes) ─────────────────────
  const isServiceOrTrading = isService || isTrading;
  const capacityDefaults: Record<number, number> = isServiceOrTrading
    ? { 1: 60, 2: 70, 3: 80, 4: 85, 5: 90 }
    : isAgriculture
      ? { 1: 80, 2: 85, 3: 90, 4: 95, 5: 100 }
      : { 1: 50, 2: 60, 3: 70, 4: 75, 5: 80 };

  return (
    <div className="mx-auto max-w-none space-y-4 sm:space-y-6">

      {/* ── CA Readiness Score ────────────────────────────────────────────── */}
      <CAReadiness
        formData={formData}
        report={report}
        isTrading={isTrading}
        isService={isService}
        isAgriculture={isAgriculture}
      />

      <Card className="gtab-card-light rounded-[0.9rem] border shadow-sm sm:rounded-2xl">
        <CardContent className="space-y-5 p-4 sm:space-y-7 sm:p-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <SectionTitle
              icon={Landmark}
              title="Loan Structure & Financial Projections"
              subtitle="Fill all sections below. The CA engine uses this data to generate DSCR, Break-Even, Sensitivity and 5-year projections."
            />
            <Badge variant="secondary" className="rounded-full px-3 py-1 bg-primary/10 text-primary border-primary/20">
              For Bank Report
            </Badge>
          </div>

          <SectionTitle
            icon={Landmark}
            title="1. Loan Structure & Interest Assumptions"
            subtitle="These values drive the Repayment Schedule, DSCR and Interest calculations in the bank report."
          />

          <CASuggestionTip advisories={[advisePromoterMargin(formData)]} onApply={updateFormData} />

          {(() => {
            // ── Scheme-based presets ────────────────────────────────────────
            const scheme = (formData.loan_scheme || "msme_psu").toLowerCase();
            const isPMEGP   = scheme === "pmegp";
            const isMudra   = scheme.startsWith("mudra");
            const isCGTMSE  = scheme === "cgtmse";
            // PMEGP/Mudra/CGTMSE compute the term-loan split by a fixed scheme
            // formula in the backend (schemes/pmegp.py, mudra.py, router.py) —
            // it never reads term_loan_pct for those, so showing it as an
            // editable "bank offers X%" field would silently do nothing.
            const canAdjustTermLoanPct = !isPMEGP && !isMudra && !isCGTMSE;

            // Interest rate preset options per scheme (CA norms)
            const ratePresets: number[] = isPMEGP
              ? [11, 12, 13, 14.5]
              : isMudra
                ? [10, 10.5, 11, 12]
                : [10, 10.5, 11, 12, 13];

            // Auto collateral text per scheme
            const autoCollateral = isPMEGP
              ? "No physical collateral required. PMEGP subsidy held as TDR for 3 years. CGTMSE guarantee cover available."
              : isMudra
                ? "No collateral required for Mudra loans as per RBI guidelines. CGFMU guarantee cover applicable."
                : isCGTMSE
                  ? "No physical collateral required. CGTMSE guarantee covers upto 75-85% of loan default."
                  : "Hypothecation of business assets (stock, equipment, receivables). Personal guarantee of promoter.";

            // ── Live loan schedule preview — uses the SAME shared utility
            // (src/lib/loanSchedule.ts) that mirrors backend/calculations/
            // loan_schedule.py exactly, so this preview never disagrees with
            // the actual generated report. The backend does NOT use the EMI
            // formula — it amortises fixed-capital term loans as equal
            // half-yearly principal instalments, with interest recalculated
            // on the declining balance each half-year.
            const loanAmt   = financingPlan.termLoanAmount;
            const rate      = Number(report.loan.interest_rate_pct || 10.5);
            const tenure    = Number(report.loan.tenure_months || 60);
            const morat     = Number(report.loan.moratorium_months || 0);
            const fullSchedule    = buildLoanSchedule(loanAmt, rate, tenure, morat);
            const tenureYears     = Math.ceil(tenure / 12);
            const moratoriumYears = Math.ceil(morat / 12);
            const repayYears      = Math.max(tenureYears - moratoriumYears, 1);
            const halfInst        = fullSchedule.find(r => r.principalPaid > 0)?.halfYearlyInstalment ?? 0;
            const totalInterest   = Math.round(fullSchedule.reduce((s, r) => s + r.interestPaid, 0));
            const moratInterest   = Math.round(
              fullSchedule.filter(r => r.principalPaid === 0).reduce((s, r) => s + r.interestPaid, 0),
            );
            const nRepay         = repayYears * 12;
            const grandInterest  = totalInterest;
            const debtEquity     = financingPlan.promoterContribution > 0
              ? (financingPlan.totalBankFinance / financingPlan.promoterContribution).toFixed(2)
              : "N/A";

            // PMEGP-eligible processing fee = 0
            const processingFeeAmt = Math.round(loanAmt * (Number(report.loan.processing_fee_pct || 0) / 100));

            return (
              <>
                <CATip tips={[
                  `Interest Rate: ${isPMEGP ? "PMEGP ≈ 11–14.5%" : isMudra ? "Mudra ≈ 10–12%" : "MSME PSU Bank ≈ 10–13%"}. Use your bank's actual offered rate. Click a preset below.`,
                  `Tenure: Standard 5 years (60 months). ${isPMEGP ? "PMEGP usually 3–5 years." : isMudra ? "Mudra: 1–5 years based on tier." : "Upto 7 years for manufacturing."}`,
                  `Moratorium: ${isPMEGP || isMudra ? "Usually 6 months for MSME projects." : "0–12 months for new businesses."} During moratorium, only interest is paid — no principal repayment.`,
                  `Processing Fee: ${isPMEGP ? "Zero for PMEGP." : "Usually 0.5–1% of loan amount for PSU banks."}`,
                ]} />

                {/* Row 1: Loan Type + Total Loan Amount + Term Loan % */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
                  <div className="space-y-2">
                    <Label>Loan Type</Label>
                    <Select value={report.loan.loan_type}
                      onValueChange={(v: ProjectReportInputs["loan"]["loan_type"]) => updateSection("loan", { loan_type: v })}>
                      <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Term Loan">Term Loan (Fixed Capital)</SelectItem>
                        <SelectItem value="Working Capital">Working Capital (CC/OD)</SelectItem>
                        <SelectItem value="Composite">Composite (TL + WC)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Most PMEGP/Mudra loans are Term Loan</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Total Bank Finance (Calculated)</Label>
                    <Input className="h-11 rounded-xl bg-muted/50 font-semibold text-primary" value={`₹ ${Math.round(financingPlan.totalBankFinance).toLocaleString("en-IN")}`} disabled readOnly />
                    <p className="text-xs text-muted-foreground">Term Loan + WC Loan combined</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Bank Finance on Fixed Capital %</Label>
                    {canAdjustTermLoanPct ? (
                      <>
                        <Input type="number" className="h-11 rounded-xl" value={report.dpr.term_loan_pct || 75}
                          min={0} max={100}
                          onChange={(e) => handleBankFinancePctChange(Number(e.target.value))} />
                        <p className="text-xs text-muted-foreground">Enter what your bank actually offers — this varies bank-to-bank, so nothing here is forced to a preset range. Typical for this scheme: {getBankFinancePctBand(formData)[0]}–{getBankFinancePctBand(formData)[1]}%.</p>
                        <div className="flex gap-1 flex-wrap">
                          {[70, 75, 80].map(v => (
                            <button key={v} type="button"
                              onClick={() => handleBankFinancePctChange(v)}
                              className={`px-2 py-0.5 rounded text-xs font-medium border transition ${Number(report.dpr.term_loan_pct) === v ? "bg-primary text-white border-primary" : "border-primary/30 text-primary hover:bg-primary/10"}`}>
                              {v}%
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <Input className="h-11 rounded-xl bg-muted/50 font-semibold text-primary" value={`${Math.round(financingPlan.termLoanBankFinancePct)}%`} disabled readOnly />
                        <p className="text-xs text-muted-foreground">
                          Fixed by {isPMEGP ? "PMEGP" : isMudra ? "Mudra" : "CGTMSE"} scheme rules ({isPMEGP ? "Margin Money + promoter split" : isMudra ? "10% promoter, residual capped at tier ceiling" : "85% standard"}) — not bank-adjustable. This is what the generated report will actually use.
                        </p>
                      </>
                    )}
                  </div>

                  {formData.loan_scheme === "normal_msme" && (
                    <div className="space-y-2">
                      <Label>State Capital Subsidy % (optional)</Label>
                      <Input type="number" className="h-11 rounded-xl" value={report.dpr.capital_subsidy_pct || 0}
                        min={0} max={100}
                        onChange={(e) => updateReport({ dpr: { ...report.dpr, capital_subsidy_pct: Math.min(Math.max(Number(e.target.value), 0), 100) } })} />
                      <p className="text-xs text-muted-foreground">On fixed assets (land + building + P&amp;M). Varies by state scheme (commonly up to 35%, higher for some SC/ST/women categories) — enter what your state's notification actually offers. A source of finance — reduces the amount split by debt:equity. 0 = none.</p>
                    </div>
                  )}

                  {/* Term Loan Amount (read-only computed) */}
                  <div className="space-y-2">
                    <Label>Term Loan Amount (Calculated)</Label>
                    <Input className="h-11 rounded-xl bg-muted/50 font-semibold" value={`₹ ${Math.round(financingPlan.termLoanAmount).toLocaleString("en-IN")}`} disabled readOnly />
                    <p className="text-xs text-muted-foreground">
                      {Math.round(financingPlan.termLoanBankFinancePct)}% of Fixed Capital
                    </p>
                  </div>

                  {/* Interest Rate with preset pills */}
                  <div className="space-y-2">
                    <Label>Annual Interest Rate %</Label>
                    <Input type="number" className="h-11 rounded-xl" placeholder="e.g. 12"
                      value={report.loan.interest_rate_pct || ""}
                      onChange={(e) => updateSection("loan", { interest_rate_pct: parseFloat(e.target.value) || 0 })} />
                    <div className="flex gap-1 flex-wrap">
                      {ratePresets.map(v => (
                        <button key={v} type="button"
                          onClick={() => updateSection("loan", { interest_rate_pct: v })}
                          className={`px-2 py-0.5 rounded text-xs font-medium border transition ${Number(report.loan.interest_rate_pct) === v ? "bg-primary text-white border-primary" : "border-primary/30 text-primary hover:bg-primary/10"}`}>
                          {v}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tenure — free entry (banks vary; presets are shortcuts, not a cap) */}
                  <div className="space-y-2">
                    <Label>Loan Tenure (months)</Label>
                    <Input type="number" className="h-11 rounded-xl" min={1}
                      value={report.loan.tenure_months || 60}
                      onChange={(e) => updateSection("loan", { tenure_months: Math.max(Number(e.target.value) || 0, 1) })} />
                    <div className="flex gap-1 flex-wrap">
                      {[24, 36, 48, 60, 72, 84, 96, 120].map(m => (
                        <button key={m} type="button"
                          onClick={() => updateSection("loan", { tenure_months: m })}
                          className={`px-2 py-0.5 rounded text-xs font-medium border transition ${Number(report.loan.tenure_months) === m ? "bg-primary text-white border-primary" : "border-primary/30 text-primary hover:bg-primary/10"}`}>
                          {m}mo
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {isPMEGP ? "PMEGP standard: 3–5 years" : isMudra ? "Mudra: upto 5 years" : "MSME standard: 5–7 years"} — enter any tenure your bank has actually sanctioned.
                    </p>
                  </div>

                  {/* Moratorium — free entry, presets are shortcuts only */}
                  <div className="space-y-2">
                    <Label>Moratorium Period (months)</Label>
                    <Input type="number" className="h-11 rounded-xl" min={0}
                      value={report.loan.moratorium_months || 0}
                      onChange={(e) => updateSection("loan", { moratorium_months: Math.max(Number(e.target.value) || 0, 0) })} />
                    <div className="flex gap-1 flex-wrap">
                      {[0, 3, 6, 9, 12, 18, 24].map(m => (
                        <button key={m} type="button"
                          onClick={() => updateSection("loan", { moratorium_months: m })}
                          className={`px-2 py-0.5 rounded text-xs font-medium border transition ${Number(report.loan.moratorium_months || 0) === m ? "bg-primary text-white border-primary" : "border-primary/30 text-primary hover:bg-primary/10"}`}>
                          {m === 0 ? "None" : `${m}mo`}{m === 6 ? " ★" : ""}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">During moratorium only interest is paid — no principal. Enter any period your bank has approved.</p>
                  </div>

                  {/* Processing Fee with presets */}
                  <div className="space-y-2">
                    <Label>Processing Fee %</Label>
                    <Input type="number" className="h-11 rounded-xl"
                      value={report.loan.processing_fee_pct ?? (isPMEGP ? 0 : 1)}
                      onChange={(e) => updateSection("loan", { processing_fee_pct: parseFloat(e.target.value) || 0 })} />
                    <div className="flex gap-1 flex-wrap">
                      {(isPMEGP ? [0] : [0, 0.5, 1, 1.5]).map(v => (
                        <button key={v} type="button"
                          onClick={() => updateSection("loan", { processing_fee_pct: v })}
                          className={`px-2 py-0.5 rounded text-xs font-medium border transition ${Number(report.loan.processing_fee_pct) === v ? "bg-primary text-white border-primary" : "border-primary/30 text-primary hover:bg-primary/10"}`}>
                          {v}%{v === 0 ? " (Free)" : ""}
                        </button>
                      ))}
                    </div>
                    {processingFeeAmt > 0 && (
                      <p className="text-xs text-primary font-medium">Fee Amount: ₹{processingFeeAmt.toLocaleString("en-IN")}</p>
                    )}
                  </div>

                  {/* Preferred Bank — dropdown of major PSU banks */}
                  <div className="space-y-2">
                    <Label>Preferred Bank / Lender</Label>
                    <Select value={report.loan.bank_name || ""}
                      onValueChange={(v) => updateSection("loan", { bank_name: v })}>
                      <SelectTrigger className="h-11 rounded-xl">
                        <SelectValue placeholder="Select preferred bank" />
                      </SelectTrigger>
                      <SelectContent>
                        {["State Bank of India (SBI)", "Bank of Baroda", "Union Bank of India", "Punjab National Bank (PNB)", "Canara Bank", "Bank of India", "Indian Bank", "Central Bank of India", "UCO Bank", "SIDBI", "Axis Bank", "HDFC Bank", "ICICI Bank", "Kotak Mahindra Bank", "Other / Not Decided"].map(b => (
                          <SelectItem key={b} value={b}>{b}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Applies to scheme (e.g. PMEGP through KVIC/DIC)</p>
                  </div>
                </div>

                {/* ── Live Loan Repayment Preview ─────────────────────────── */}
                {loanAmt > 0 && (
                  <div className="rounded-xl bg-[#0f1f35] border border-primary/30 p-4 space-y-3">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                      Live Repayment Preview (Half-Yearly Equal-Principal, Reducing Balance — matches your generated report exactly)
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: "Half-Yearly Instalment (Principal)", value: `₹${halfInst.toLocaleString("en-IN")}`, color: "text-primary" },
                        { label: `Total Interest (${repayYears}-yr repayment)`, value: `₹${totalInterest.toLocaleString("en-IN")}`, color: "text-amber-400" },
                        { label: morat > 0 ? `Moratorium Interest (${morat}mo)` : "Processing Fee", value: morat > 0 ? `₹${moratInterest.toLocaleString("en-IN")}` : `₹${processingFeeAmt.toLocaleString("en-IN")}`, color: "text-slate-300" },
                        { label: "Total Cost of Loan", value: `₹${(grandInterest + processingFeeAmt).toLocaleString("en-IN")}`, color: "text-red-400" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-white/5 rounded-lg p-3 space-y-1">
                          <p className="text-xs text-slate-400">{label}</p>
                          <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-4 text-xs text-slate-400 pt-1 border-t border-white/10">
                      <span>Principal: ₹{loanAmt.toLocaleString("en-IN")}</span>
                      <span>Rate: {rate}% p.a.</span>
                      <span>Tenure: {tenure} months{morat > 0 ? ` (${morat} mo moratorium)` : ""}</span>
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`inline-flex items-center gap-1 font-semibold ${Number(debtEquity) <= 2 ? "text-emerald-400" : "text-red-400"}`}>
                              D:E Ratio = {debtEquity} {Number(debtEquity) <= 2 ? "✓" : "⚠ High (>2:1)"}
                              <CircleHelp className="h-3.5 w-3.5" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            Term Loan D:E = TL / promoter fixed equity. Total leverage = total debt / total promoter contribution.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                )}

                {/* Guarantor + Collateral */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
                  <div className="space-y-2">
                    <Label>Guarantor Name (if applicable)</Label>
                    <Input className="h-11 rounded-xl"
                      value={report.loan.guarantor_name}
                      onChange={(e) => updateSection("loan", { guarantor_name: e.target.value })}
                      placeholder={isPMEGP || isMudra ? "Not required for this scheme" : "Full name of guarantor"} />
                    <p className="text-xs text-muted-foreground">{isPMEGP || isMudra ? "Optional — CGTMSE/CGFMU covers default" : "Bank may ask for personal guarantor"}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Guarantor Relation</Label>
                    <Select value={report.loan.guarantor_relation || ""}
                      onValueChange={(v) => updateSection("loan", { guarantor_relation: v })}>
                      <SelectTrigger className="h-11 rounded-xl">
                        <SelectValue placeholder="Select relation" />
                      </SelectTrigger>
                      <SelectContent>
                        {["Father", "Mother", "Spouse / Wife / Husband", "Brother", "Sister", "Son", "Daughter", "Business Partner", "Friend", "Employer", "Not Applicable"].map(r => (
                          <SelectItem key={r} value={r}>{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2" />
                  <div className="space-y-2 md:col-span-3">
                    <div className="flex items-center justify-between">
                      <Label>Collateral / Security Details</Label>
                      {(isPMEGP || isMudra || isCGTMSE) && (
                        <button type="button"
                          onClick={() => updateSection("loan", { collateral_details: autoCollateral })}
                          className="text-xs text-primary underline hover:text-primary/80">
                          Auto-fill for {isPMEGP ? "PMEGP" : isMudra ? "Mudra" : "CGTMSE"} →
                        </button>
                      )}
                    </div>
                    <Textarea className="min-h-[80px] rounded-xl"
                      value={report.loan.collateral_details || autoCollateral}
                      onChange={(e) => updateSection("loan", { collateral_details: e.target.value })}
                      placeholder={autoCollateral} />
                    {(isPMEGP || isMudra || isCGTMSE) && (
                      <p className="text-xs text-emerald-600 font-medium">
                        ✓ {isPMEGP ? "PMEGP" : isMudra ? "Mudra" : "CGTMSE"}: No physical collateral required by RBI guidelines.
                      </p>
                    )}
                  </div>
                </div>
              </>
            );
          })()}

          <div className="border-t" />

          <SectionTitle
            icon={Wallet}
            title="1b. Working Capital & Promoter Contribution"
            subtitle="Working capital drives Stock, Debtors and Cash cycle. Banks fund 60–75% (Tandon Committee norms)."
          />

          {(() => {
            // ── Live WC computation (CA Tandon Method) ──────────────────────
            // BUG FIX: this only read the flat raw_material_cost field, so a
            // trading business describing COGS via the itemized products list
            // (purchase_price x quantity — the normal way to enter it, per
            // Step 9) saw Stock/Creditors previewed as ₹0 here even though
            // its own Revenue preview line below already reads that same
            // products list. Falls back to the products list the same way
            // monthlyRev already does, matching the backend's own COGS
            // priority order (calculations/income_statement.py /
            // working_capital.py: unit costs -> product table -> flat
            // monthly figure -> industry default).
            const monthlyCOGS    = Number(formData.raw_material_cost || 0) || report.revenue.product_categories.reduce(
              (s, p) => s + Number(p.quantity_sold || p.units_monthly || 0) * Number(p.purchase_price || 0), 0
            );
            const monthlyRev     = (() => {
              const fromProds = report.revenue.product_categories.reduce((s, p) => {
                const rev = Number(p.fixed_revenue) || (Number(p.quantity_sold || p.units_monthly || 0) * Number(p.selling_price || p.avg_price || 0));
                return s + rev;
              }, 0);
              return fromProds || Number(formData.expected_monthly_revenue || 0);
            })();
            const monthlyOpEx    = Number(formData.monthly_rent || 0) + Number(formData.total_monthly_salary || 0)
              + Number(formData.electricity_water_cost || 0) + Number(formData.repair_maintenance_cost || 0)
              + Number(formData.transport_cost || 0) + Number(formData.miscellaneous_cost || 0);

            const stockDays    = Number(report.working_capital.stock_days    || (isTrading ? 30 : isService ? 7  : 45));
            const debtorDays   = Number(report.working_capital.debtors_days  || (isTrading ? 15 : isService ? 0  : 30));
            const cashBal      = Number(report.working_capital.cash_balance  || 0);
            const creditorDays = Number(report.working_capital.creditors_days || (isTrading ? 15 : 7));
            const wcBankPct    = Number(report.dpr.wc_loan_pct || 60);

            // CA formula: Stock = COGS × (stockDays/30), Debtors = Revenue × (debtorDays/30)
            const stockWC      = Math.round(monthlyCOGS   * (stockDays  / 30));
            const debtorsWC    = Math.round(monthlyRev    * (debtorDays / 30));
            const cashWC       = cashBal > 0 ? cashBal : Math.round(monthlyOpEx * 0.5); // min 15 days expenses
            const creditors    = Math.round(monthlyCOGS   * (creditorDays / 30));
            const grossWC      = stockWC + debtorsWC + cashWC;
            const netWC        = Math.max(grossWC - creditors, 0);
            const bankWCLoan   = Math.round(netWC * wcBankPct / 100);
            const promoterWC   = netWC - bankWCLoan;
            const wcFromStep7  = monthlyWorkingCapital;

            // Industry-specific dropdown options
            const stockDayOpts  = isService ? [0, 7, 15, 30]       : isTrading ? [7, 15, 30, 45, 60]  : [15, 30, 45, 60, 90];
            const debtorDayOpts = isService ? [0, 7, 15, 30]       : isTrading ? [0, 7, 15, 30, 45]   : [0, 15, 30, 45, 60];
            const credDayOpts   = isService ? [0, 7, 15, 30]       : isTrading ? [7, 15, 30, 45]      : [7, 15, 30, 45, 60];

            return (
              <>
                <CATip tips={[
                  "Working Capital = Stock + Debtors + Cash Buffer − Creditors. This is the Tandon Committee method used by all Indian PSU banks.",
                  `Stock Days: How many days of purchases/raw material you keep in stock. ${isService ? "Services need minimal stock (0–15 days)." : isTrading ? "Trading: 15–30 days is standard." : "Manufacturing: 30–60 days for raw material."}`,
                  `Debtors Days: How many days credit you give to customers. ${isService ? "Most services collect cash upfront (0 days)." : "Retail usually 0 days. Wholesale 30–45 days."}`,
                  "Banks finance 60-75% of Net WC (Tandon Method I: 25% margin by promoter). Method II: 33.3% margin.",
                  "Minimum Cash Balance = 15-30 days of operating expenses. Never keep zero — banks want to see liquidity buffer.",
                ]} />

                {/* ── Financing Summary ── always visible and correct ─────── */}
                <div className="rounded-xl bg-gradient-to-br from-[#061421] to-[#0a1a2e] border border-primary/25 p-4 space-y-3">
                  <p className="text-xs font-bold text-primary uppercase tracking-widest">Means of Finance Summary</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Promoter Equity",  value: Math.round(financingPlan.promoterContribution),   pct: `${Math.round(financingPlan.promoterEquityPct)}%`,        color: "text-amber-400",  bg: "from-amber-500/20 to-amber-600/8",  border: "border-amber-500/35", dot: "bg-amber-400" },
                      { label: "Term Loan (Bank)",  value: Math.round(financingPlan.termLoanAmount),         pct: `${Math.round(financingPlan.termLoanBankFinancePct)}%`,   color: "text-blue-400",   bg: "from-blue-500/20 to-blue-600/8",    border: "border-blue-500/35",  dot: "bg-blue-400"  },
                      { label: "WC Loan (Bank)",    value: Math.round(financingPlan.workingCapitalLoan),     pct: `${Math.round(wcBankPct)}%`,                              color: "text-[#00C2D1]",  bg: "from-[#00C2D1]/20 to-[#00C2D1]/8", border: "border-[#00C2D1]/35", dot: "bg-[#00C2D1]" },
                    ].map(({ label, value, pct, color, bg, border, dot }) => (
                      <div key={label} className={`gtab-stat-card cursor-default bg-gradient-to-br ${bg} rounded-2xl p-4 text-center space-y-1.5 border ${border}`}>
                        <div className={`w-2 h-2 rounded-full ${dot} mx-auto`} />
                        <p className="text-[11px] font-semibold text-slate-300 uppercase tracking-wide">{label}</p>
                        <p className={`text-xl font-extrabold ${color} tabular-nums`}>₹{value.toLocaleString("en-IN")}</p>
                        <p className="text-[11px] font-medium text-slate-400">{pct} of total</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Working Capital Inputs — 3 key days ─────────────────── */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">

                  {/* Stock Days */}
                  <div className="space-y-2">
                    <Label>Stock Holding Days</Label>
                    <Select value={String(stockDays)}
                      onValueChange={(v) => updateSection("working_capital", { stock_days: Number(v) })}>
                      <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {stockDayOpts.map(d => (
                          <SelectItem key={d} value={String(d)}>
                            {d === 0 ? "0 days (No stock)" : `${d} days${d === (isService ? 7 : isTrading ? 30 : 45) ? " ← Standard" : ""}`}
                          </SelectItem>
                        ))}
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Days of {isService ? "consumables" : isTrading ? "inventory/stock" : "raw material"} kept on hand.
                      {stockWC > 0 && <span className="text-primary font-medium"> WC = ₹{stockWC.toLocaleString("en-IN")}</span>}
                    </p>
                  </div>

                  {/* Debtors Days */}
                  <div className="space-y-2">
                    <Label>Debtors (Credit to Customers) Days</Label>
                    <Select value={String(debtorDays)}
                      onValueChange={(v) => updateSection("working_capital", { debtors_days: Number(v) })}>
                      <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {debtorDayOpts.map(d => (
                          <SelectItem key={d} value={String(d)}>
                            {d === 0 ? "0 days (Cash sales only)" : `${d} days${d === (isService ? 0 : isTrading ? 15 : 30) ? " ← Standard" : ""}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Credit period you give to customers.
                      {debtorsWC > 0 && <span className="text-primary font-medium"> WC = ₹{debtorsWC.toLocaleString("en-IN")}</span>}
                    </p>
                  </div>

                  {/* Creditors Days */}
                  <div className="space-y-2">
                    <Label>Creditors (Credit from Suppliers) Days</Label>
                    <Select value={String(creditorDays)}
                      onValueChange={(v) => updateSection("working_capital", { creditors_days: Number(v) })}>
                      <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {credDayOpts.map(d => (
                          <SelectItem key={d} value={String(d)}>
                            {d === 0 ? "0 days (Pay cash to suppliers)" : `${d} days${d === (isTrading ? 15 : 7) ? " ← Standard" : ""}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Credit you get from suppliers — reduces your WC need.
                      {creditors > 0 && <span className="text-teal-600 font-medium"> Saves ₹{creditors.toLocaleString("en-IN")}</span>}
                    </p>
                  </div>

                  {/* WIP Days — manufacturing only (backend zeroes this for trading/service/agriculture) */}
                  <div className="space-y-2">
                    <Label>Work-in-Progress (WIP) Days</Label>
                    <Input type="number" className="h-11 rounded-xl"
                      value={report.dpr.wip_days ?? 15} min={0} max={90}
                      onChange={(e) => updateSection("dpr", { wip_days: Math.max(Number(e.target.value) || 0, 0) })} />
                    <p className="text-xs text-muted-foreground">
                      {isTrading || isService || isAgriculture
                        ? "Only applies to manufacturing — ignored for your industry."
                        : "Days of part-finished goods on the shop floor. Standard: 15 days."}
                    </p>
                  </div>

                  {/* Finished Goods Days — manufacturing/trading/agriculture (backend zeroes this for service) */}
                  <div className="space-y-2">
                    <Label>Finished Goods (FG) Holding Days</Label>
                    <Input type="number" className="h-11 rounded-xl"
                      value={report.dpr.fg_days ?? 30} min={0} max={90}
                      onChange={(e) => updateSection("dpr", { fg_days: Math.max(Number(e.target.value) || 0, 0) })} />
                    <p className="text-xs text-muted-foreground">
                      {isService
                        ? "Only applies where you hold physical stock — ignored for services."
                        : "Days finished goods sit in inventory before sale. Standard: 30 days."}
                    </p>
                  </div>

                  {/* Minimum Cash Balance */}
                  <div className="space-y-2">
                    <Label>Minimum Cash Balance (₹)</Label>
                    <Input type="number" className="h-11 rounded-xl"
                      value={report.working_capital.cash_balance || ""}
                      onChange={(e) => updateSection("working_capital", { cash_balance: parseFloat(e.target.value) || 0 })}
                      placeholder={`e.g. ${Math.round(monthlyOpEx * 0.5).toLocaleString("en-IN") || "10000"}`} />
                    <p className="text-xs text-muted-foreground">
                      CA standard: ≥ 15 days of operating expenses.
                      {monthlyOpEx > 0 && <span className="text-amber-600"> Suggested: ₹{Math.round(monthlyOpEx * 0.5).toLocaleString("en-IN")}</span>}
                    </p>
                  </div>

                  {/* WC Finance Method — varies bank-to-bank, never hardcode one */}
                  <div className="space-y-2">
                    <Label>WC Bank-Finance Method</Label>
                    <Select value={report.dpr.wc_finance_method || "simple_margin"}
                      onValueChange={(v: "simple_margin" | "drawing_power") => updateSection("dpr", { wc_finance_method: v })}>
                      <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="simple_margin">Simple Margin Method</SelectItem>
                        <SelectItem value="drawing_power">Drawing Power Method</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Ask your bank which method they use to assess your CC/OD limit.</p>
                  </div>

                  {report.dpr.wc_finance_method === "drawing_power" ? (
                    <div className="space-y-2">
                      <Label>Bank's Margin % (Drawing Power)</Label>
                      <Input type="number" className="h-11 rounded-xl"
                        value={report.dpr.wc_margin_pct || 25} min={0} max={100}
                        onChange={(e) => updateSection("dpr", { wc_margin_pct: Number(e.target.value) })} />
                      <div className="flex gap-1 flex-wrap">
                        {[15, 20, 25, 30, 40].map(v => (
                          <button key={v} type="button"
                            onClick={() => updateSection("dpr", { wc_margin_pct: v })}
                            className={`px-2 py-0.5 rounded text-xs font-medium border transition ${Number(report.dpr.wc_margin_pct) === v ? "bg-primary text-white border-primary" : "border-primary/30 text-primary hover:bg-primary/10"}`}>
                            {v}%
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        DP = (Stock + Debtors) × (1 − Margin%) − Creditors. Common convention: 25%. Enter what your bank actually applies.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Bank WC Finance %</Label>
                      <Input type="number" className="h-11 rounded-xl"
                        value={report.dpr.wc_loan_pct || 60} min={0} max={100}
                        onChange={(e) => updateSection("dpr", { wc_loan_pct: Number(e.target.value) })} />
                      <div className="flex gap-1 flex-wrap">
                        {[
                          { v: 60, label: "60%" },
                          { v: 65, label: "65%" },
                          { v: 75, label: "75% (Tandon)" },
                          { v: 80, label: "80% (Mudra)" },
                        ].map(({ v, label }) => (
                          <button key={v} type="button"
                            onClick={() => updateSection("dpr", { wc_loan_pct: v })}
                            className={`px-2 py-0.5 rounded text-xs font-medium border transition ${wcBankPct === v ? "bg-primary text-white border-primary" : "border-primary/30 text-primary hover:bg-primary/10"}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">Tandon Method I = 75%. Method II = 66.7%.</p>
                    </div>
                  )}
                </div>

                {/* ── WC Breakdown Calculator ──────────────────────────────── */}
                {(monthlyCOGS > 0 || monthlyRev > 0) && (
                  <div className="rounded-xl bg-[#0f1f35] border border-primary/30 p-4 space-y-3">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                      Working Capital Breakdown (Tandon Method — Auto-Calculated)
                    </p>
                    <div className="space-y-1.5">
                      {[
                        { label: `Stock WC — ${isTrading?"Inventory":isService?"Consumables":"Raw Material"} (₹${Math.round(monthlyCOGS).toLocaleString("en-IN")}/mo × ${stockDays} days ÷ 30)`,    value: stockWC,   color: "text-slate-200", sign: "+" },
                        { label: `Debtors WC — Revenue (₹${Math.round(monthlyRev).toLocaleString("en-IN")}/mo × ${debtorDays} days ÷ 30)`,  value: debtorsWC, color: "text-slate-200", sign: "+" },
                        { label: `Cash Buffer — Operating Expenses (min. 15 days)`,   value: cashWC,    color: "text-slate-200", sign: "+" },
                        { label: "GROSS WORKING CAPITAL REQUIRED",                    value: grossWC,   color: "text-white font-semibold", sign: "=" },
                        { label: `Less: Creditors — Supplier credit (₹${Math.round(monthlyCOGS).toLocaleString("en-IN")}/mo × ${creditorDays} days ÷ 30)`, value: creditors, color: "text-red-400", sign: "−" },
                        { label: "NET WORKING CAPITAL REQUIRED",                      value: netWC,     color: "text-primary font-bold", sign: "=" },
                      ].map(({ label, value, color, sign }) => (
                        <div key={label} className="flex justify-between items-center py-1 border-b border-white/8">
                          <span className="text-xs text-slate-300 flex-1 pr-2">{sign} {label}</span>
                          <span className={`text-sm tabular-nums shrink-0 ${color}`}>₹{value.toLocaleString("en-IN")}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-center border-t border-white/20 pt-2">
                      <div>
                        <p className="text-xs text-slate-400">Bank WC Loan ({wcBankPct}%)</p>
                        <p className="text-sm font-bold text-blue-400">₹{bankWCLoan.toLocaleString("en-IN")}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-slate-400">Promoter WC Margin ({100 - wcBankPct}%)</p>
                        <p className="text-sm font-bold text-amber-400">₹{promoterWC.toLocaleString("en-IN")}</p>
                      </div>
                      {wcFromStep7 > 0 && Math.abs(wcFromStep7 - netWC) > 5000 && (
                        <div className="text-right">
                          <p className="text-xs text-amber-400">⚠ Step 6 entered: ₹{wcFromStep7.toLocaleString("en-IN")}</p>
                          <p className="text-xs text-slate-400">vs. Calculated: ₹{netWC.toLocaleString("en-IN")}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            );
          })()}

          <div className="border-t" />

          <SectionTitle
            icon={isTrading || isService || isAgriculture ? Store : Factory}
            title={
              isTrading
                ? "2. Trading Products & Revenue (MANDATORY)"
                : isService
                  ? "2. Service Revenue Lines (MANDATORY)"
                  : isAgriculture
                    ? "2. Agriculture Revenue Details (MANDATORY)"
                  : "2. Production Parameters & Revenue (MANDATORY)"
            }
            subtitle={
              isTrading
                ? "Add EACH product separately: purchase price, selling price, monthly quantity. This IS the revenue in the report."
                : isService
                  ? "Add EACH service: rate per session/month and quantity. The total drives all 5-year P&L projections."
                  : isAgriculture
                    ? "Add each crop / produce line with quantity and price. The backend uses these for COGS and revenue."
                  : "Input Qty/Day × Yield% × Working Days × Selling Price = Annual Revenue. Every rupee of revenue comes from here."
            }
          />

          {/* CA MANDATORY warning when no products added */}
          {(isTrading || isService || isAgriculture) && report.revenue.product_categories.length === 0 && (
            <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-red-700 font-bold">
                <AlertTriangle className="w-4 h-4" />
                MANDATORY: No {isTrading ? "products" : isService ? "services" : "revenue lines"} added yet
              </div>
              <p className="text-sm text-red-600">
                {isTrading
                  ? "For a trading business, the CMA report CANNOT be generated without at least one product line. Add each product with purchase price, selling price and monthly sales quantity."
                  : isService
                    ? "For a service business, add each service type with the rate and monthly client/session count."
                    : "Add each crop / produce with expected quantity and selling price per unit."}
              </p>
              <p className="text-xs text-red-500">
                The backend CA engine calculates: Revenue = Qty × Selling Price. COGS = Qty × Purchase Price. EBITDA, DSCR, Break-Even all flow from these numbers.
              </p>
            </div>
          )}

          <CATip tips={getStep9Tips({
            industry: formData.industry_type || "manufacturing",
            scheme: formData.loan_scheme || "normal_msme",
          })
          } />

          {isService || isAgriculture ? (
            <div className="space-y-4">
              {/* AI Suggestions for service / agriculture sub-types */}
              {(() => {
                const bizType = formData.type_of_business || '';
                const suggestions = PRODUCT_SUGGESTIONS[bizType] || [];
                if (suggestions.length === 0) return null;
                const addSuggestion = (s: typeof suggestions[0]) => {
                  const newId = typeof crypto !== 'undefined' && crypto.randomUUID
                    ? crypto.randomUUID()
                    : Math.random().toString(36).substring(2, 15);
                  updateSection("revenue", {
                    product_categories: [
                      ...report.revenue.product_categories,
                      {
                        id: newId,
                        category: s.category,
                        avg_price: s.avg_price ?? s.selling_price ?? 0,
                        units_monthly: s.units_monthly ?? s.quantity_sold ?? 0,
                        fixed_revenue: 0,
                      } as ProjectReportProductCategory,
                    ],
                  });
                };
                return (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-semibold text-blue-800">
                        AI Suggestions for your business — click to add
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((s) => {
                        const alreadyAdded = report.revenue.product_categories.some(
                          (p) => p.category === s.category
                        );
                        return (
                          <button
                            key={s.category}
                            type="button"
                            disabled={alreadyAdded}
                            onClick={() => addSuggestion(s)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                              alreadyAdded
                                ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-100 cursor-pointer'
                            }`}
                          >
                            {alreadyAdded ? '✓ ' : '+ '}{s.category}
                            {(s.avg_price || s.selling_price) ? ` @ Rs.${s.avg_price ?? s.selling_price}` : ''}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-blue-600">
                      Typical rates shown — edit each line after adding to match your actual pricing.
                    </p>
                  </div>
                );
              })()}

              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {report.revenue.product_categories.length === 0 ? "No items yet." : `${report.revenue.product_categories.length} item(s)`}
                </p>
                <Button type="button" variant="outline" className="gap-2" onClick={() => addProductCategory()}>
                  <Plus className="w-4 h-4" />
                  {isAgriculture ? "Add Revenue Line" : "Add Service"}
                </Button>
              </div>

              {report.revenue.product_categories.length === 0 && (
                <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  Click a suggestion above or the button to add your first {isAgriculture ? "revenue line" : "service"}.
                </div>
              )}

              {report.revenue.product_categories.map((item, index) => {
                const monthlyRevenue = Number(item.fixed_revenue) || Number(item.units_monthly || 0) * Number(item.avg_price || 0);
                const activeMonths   = Math.min(Math.max(Number(item.number_of_months) || 12, 1), 12);
                const annualRevenue  = monthlyRevenue * activeMonths;
                return (
                  <div key={item.id} className="rounded-xl border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{isAgriculture ? "Revenue Line" : "Service"} #{index + 1}
                        {monthlyRevenue > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">Rs. {monthlyRevenue.toLocaleString("en-IN")}/mo × {activeMonths} mo</span>}
                      </span>
                      <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-destructive hover:bg-destructive/10 text-xs" onClick={() => removeProductCategory(item.id)}>
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>{isAgriculture ? "Crop / Activity" : "Service Name"} *</Label>
                        <Input className="h-11 rounded-xl" value={item.category} onChange={(e) => updateServiceRevenue(item.id, { category: e.target.value })} placeholder={isAgriculture ? "e.g. Wheat" : "e.g. Hair Cut"} />
                      </div>
                      <NumberField label={`Rate per ${item.billing_unit || "Unit"} (Rs.)`} value={Number(item.avg_price) || 0} onChange={(v) => updateServiceRevenue(item.id, { avg_price: v })} placeholder="200" />
                      <NumberField label={`${item.billing_unit || "Unit"}s per Month`} value={Number(item.units_monthly) || 0} onChange={(v) => updateServiceRevenue(item.id, { units_monthly: v })} placeholder="100" />
                      <div className="space-y-1.5">
                        <Label>Billing Unit</Label>
                        <Select value={item.billing_unit || "Month"} onValueChange={(v) => updateServiceRevenue(item.id, { billing_unit: v })}>
                          <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["Session","Client","Project","Unit","Kg","Quintal"].map(u => <SelectItem key={u} value={u}>Per {u}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <NumberField label="Months / Year" value={Number(item.number_of_months) || 12} min={1} max={12} onChange={(v) => updateServiceRevenue(item.id, { number_of_months: v })} />
                      <NumberField label="Annual Revenue (Auto)" value={annualRevenue} onChange={() => undefined} disabled />
                    </div>
                  </div>
                );
              })}

              {report.revenue.product_categories.length > 0 && (() => {
                const annual = report.revenue.product_categories.reduce((s, i) => {
                  const monthly = Number(i.fixed_revenue) || Number(i.units_monthly||0)*Number(i.avg_price||0);
                  const months  = Math.min(Math.max(Number(i.number_of_months) || 12, 1), 12);
                  return s + monthly * months;
                }, 0);
                return annual > 0 ? (
                  <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800 font-semibold">
                    Total Annual Revenue: Rs. {annual.toLocaleString("en-IN")}
                    <span className="ml-2 font-normal text-teal-700">(avg Rs. {Math.round(annual/12).toLocaleString("en-IN")}/mo)</span>
                  </div>
                ) : null;
              })()}
            </div>
          ) : isTrading ? (
            <div className="space-y-4">
              {/* AI Product Suggestions — keyed by business sub-type */}
              {(() => {
                const bizType = formData.type_of_business || '';
                const suggestions = PRODUCT_SUGGESTIONS[bizType] || [];
                if (suggestions.length === 0) return null;
                const addSuggestion = (s: typeof suggestions[0]) => {
                  const newId = typeof crypto !== 'undefined' && crypto.randomUUID
                    ? crypto.randomUUID()
                    : Math.random().toString(36).substring(2, 15);
                  updateSection("revenue", {
                    product_categories: [
                      ...report.revenue.product_categories,
                      {
                        id: newId,
                        category: s.category,
                        purchase_price: s.purchase_price ?? 0,
                        selling_price: s.selling_price ?? 0,
                        quantity_sold: s.quantity_sold ?? 0,
                        units_monthly: s.quantity_sold ?? 0,
                        avg_price: s.selling_price ?? 0,
                        margin_pct: s.purchase_price && s.selling_price
                          ? Math.round((1 - s.purchase_price / s.selling_price) * 100)
                          : 0,
                      } as ProjectReportProductCategory,
                    ],
                  });
                };
                return (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-semibold text-blue-800">
                        AI Suggestions for your business — click to add
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((s) => {
                        const alreadyAdded = report.revenue.product_categories.some(
                          (p) => p.category === s.category
                        );
                        return (
                          <button
                            key={s.category}
                            type="button"
                            disabled={alreadyAdded}
                            onClick={() => addSuggestion(s)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                              alreadyAdded
                                ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-100 cursor-pointer'
                            }`}
                          >
                            {alreadyAdded ? '✓ ' : '+ '}{s.category}
                            {s.selling_price ? ` @ Rs.${s.selling_price}` : ''}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-blue-600">
                      Prices are typical market averages — edit each product after adding to match your actual rates.
                    </p>
                  </div>
                );
              })()}

              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {report.revenue.product_categories.length === 0 ? "No products yet." : `${report.revenue.product_categories.length} product(s)`}
                </p>
                <Button type="button" variant="outline" className="gap-2" onClick={() => addProductCategory()}>
                  <Plus className="w-4 h-4" /> Add Product
                </Button>
              </div>

              {report.revenue.product_categories.length === 0 && (
                <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  Click <strong>Add Product</strong> above or use suggestions to add your first product.
                </div>
              )}

              {report.revenue.product_categories.map((item, index) => {
                const qty = Number(item.quantity_sold || item.units_monthly || 0);
                const sp  = Number(item.selling_price || item.avg_price || 0);
                const pp  = Number(item.purchase_price || 0);
                const rev = qty * sp;
                return (
                  <div key={item.id} className="rounded-xl border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Product #{index + 1}
                        {rev > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">Rs. {rev.toLocaleString("en-IN")}/mo</span>}
                      </span>
                      <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-destructive hover:bg-destructive/10 text-xs" onClick={() => removeProductCategory(item.id)}>
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                      <div className="space-y-1.5 md:col-span-4">
                        <Label>Product Name *</Label>
                        <Input className="h-11 rounded-xl" value={item.category} onChange={(e) => updateTradingProduct(item.id, { category: e.target.value })} placeholder="e.g. Grocery, Electronics" />
                      </div>
                      <NumberField label="Purchase Price (Rs.)" value={pp} onChange={(v) => updateTradingProduct(item.id, { purchase_price: v })} placeholder="80" />
                      <NumberField label="Selling Price (Rs.)" value={sp} onChange={(v) => updateTradingProduct(item.id, { selling_price: v })} placeholder="100" />
                      <NumberField label="Qty / Month" value={qty} onChange={(v) => updateTradingProduct(item.id, { quantity_sold: v })} placeholder="500" />
                      <NumberField label="Margin % (Auto)" value={Number(item.margin_pct)||0} onChange={() => undefined} disabled />
                    </div>
                  </div>
                );
              })}

              {report.revenue.product_categories.length > 0 && (() => {
                const total = report.revenue.product_categories.reduce((s,i) => s + Number(i.quantity_sold||i.units_monthly||0)*Number(i.selling_price||i.avg_price||0), 0);
                const cogs  = report.revenue.product_categories.reduce((s,i) => s + Number(i.quantity_sold||i.units_monthly||0)*Number(i.purchase_price||0), 0);
                return total > 0 ? (
                  <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800 font-semibold">
                    Total Monthly: Rs. {total.toLocaleString("en-IN")} · Gross Margin: {((total-cogs)/total*100).toFixed(1)}%
                  </div>
                ) : null;
              })()}
            </div>
          ) : (
            (() => {
              // Manufacturing / Agriculture production parameters
              // Labels are industry-aware: Agriculture uses crop/harvest terminology
              const workingDays = report.dpr.working_days_per_year || (isAgriculture ? 270 : 300);
              const inputQty    = report.dpr.fresh_leaves_per_day_kg || 0;
              const yield_      = (report.dpr.yield_rate_pct || 100) / 100;
              const sellPrice   = report.dpr.selling_price_per_kg || 0;
              const calcAnnualRev = Math.round(inputQty * yield_ * workingDays * sellPrice);

              // Industry-aware labels
              const inputQtyLabel  = isAgriculture ? "Raw Crop / Harvest Input per Day" : "Raw Input Material Qty / Day";
              const yieldLabel     = isAgriculture ? "Processed / Sellable Output Yield % (of input)" : "Finished Output Yield % (of raw input)";
              const sellPriceLabel = isAgriculture ? "Selling Price per Finished Output Unit (Rs.)" : "Selling Price per Finished Unit (Rs.)";
              const rmCostLabel    = isAgriculture ? "Cost of Raw Crop / Input per Unit (Rs.)" : "Raw Material Cost per Input Unit (Rs.)";
              const consumLabel    = isAgriculture ? "Processing / Labour Cost per Unit (Rs.)" : "Consumables / Processing Cost per Unit (Rs.)";
              const packLabel      = isAgriculture ? "Packing / Grading Cost per Unit (Rs.)" : "Packing / Packaging Cost per Unit (Rs.)";
              const workdaysLabel  = isAgriculture ? "Working / Harvest Days per Year" : "Working / Production Days per Year";

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
                    <NumberField
                      label={workdaysLabel}
                      value={report.dpr.working_days_per_year || (isAgriculture ? 270 : 300)}
                      onChange={(v) => updateSection("dpr", { working_days_per_year: v })}
                      placeholder={isAgriculture ? "270" : "300"}
                    />
                    <div className="space-y-2">
                      <Label>Unit of Measurement (Output)</Label>
                      <Select
                        value={(report.dpr as any).production_unit || "unit"}
                        onValueChange={(v) => updateSection("dpr", { production_unit: v } as any)}
                      >
                        <SelectTrigger className="h-11 rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="kg">kg (Kilograms)</SelectItem>
                          <SelectItem value="quintal">Quintal (100 kg)</SelectItem>
                          <SelectItem value="tonne">Tonne (1000 kg)</SelectItem>
                          <SelectItem value="litre">Litre</SelectItem>
                          <SelectItem value="unit">Unit / Piece</SelectItem>
                          <SelectItem value="metre">Metre</SelectItem>
                          <SelectItem value="box">Box / Carton</SelectItem>
                          <SelectItem value="dozen">Dozen</SelectItem>
                          <SelectItem value="set">Set</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <NumberField
                      label={inputQtyLabel}
                      value={report.dpr.fresh_leaves_per_day_kg}
                      onChange={(v) => updateSection("dpr", { fresh_leaves_per_day_kg: v })}
                      placeholder={isAgriculture ? "e.g. 200 kg/day" : "e.g. 100"}
                    />
                    <NumberField
                      label={yieldLabel}
                      value={report.dpr.yield_rate_pct}
                      onChange={(v) => updateSection("dpr", { yield_rate_pct: v })}
                      placeholder={isAgriculture ? "e.g. 80 (80% sellable)" : "e.g. 20"}
                    />
                    <NumberField
                      label={sellPriceLabel}
                      value={report.dpr.selling_price_per_kg}
                      onChange={(v) => updateSection("dpr", { selling_price_per_kg: v })}
                      placeholder={isAgriculture ? "e.g. 30" : "e.g. 420"}
                    />
                    <NumberField
                      label={rmCostLabel}
                      value={report.dpr.cost_fresh_leaves_per_kg}
                      onChange={(v) => updateSection("dpr", { cost_fresh_leaves_per_kg: v })}
                      placeholder={isAgriculture ? "e.g. 8" : "e.g. 20"}
                    />
                    <NumberField
                      label={consumLabel}
                      value={report.dpr.cost_consumables_per_kg}
                      onChange={(v) => updateSection("dpr", { cost_consumables_per_kg: v })}
                      placeholder="e.g. 2.5"
                    />
                    <NumberField
                      label={packLabel}
                      value={report.dpr.cost_pet_bottle}
                      onChange={(v) => updateSection("dpr", { cost_pet_bottle: v })}
                      placeholder="e.g. 5"
                    />
                    <NumberField
                      label="Operating Hours / Day"
                      value={report.dpr.hours_of_operation}
                      onChange={(v) => updateSection("dpr", { hours_of_operation: v })}
                      placeholder="8"
                    />
                  </div>
                  {/* Revenue + output preview */}
                  {calcAnnualRev > 0 && (
                    <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800 space-y-1">
                      <div className="font-semibold">
                        Annual Revenue (100% capacity): Rs. {calcAnnualRev.toLocaleString("en-IN")}
                        <span className="ml-2 text-xs font-normal text-teal-600">
                          ({inputQty} input/day × {(yield_ * 100).toFixed(0)}% yield × {workingDays} days × Rs.{sellPrice}/unit)
                        </span>
                      </div>
                      <div className="text-xs text-teal-700">
                        Annual Output: <strong>{Math.round(inputQty * yield_ * workingDays).toLocaleString("en-IN")} units</strong>
                        &nbsp;|&nbsp; Year 1 Revenue (at {report.dpr.capacity_y1_pct || 50}%): Rs. {Math.round(calcAnnualRev * ((report.dpr.capacity_y1_pct || 50) / 100)).toLocaleString("en-IN")}
                        &nbsp;|&nbsp; Year 5 Revenue (at {report.dpr.capacity_y5_pct || 80}%): Rs. {Math.round(calcAnnualRev * ((report.dpr.capacity_y5_pct || 80) / 100) * Math.pow(1 + (report.revenue.revenue_growth_pct || 7) / 100, 4)).toLocaleString("en-IN")}
                      </div>
                      {isAgriculture && (
                        <div className="text-xs text-teal-600 mt-1">
                          Agriculture note: For agriculture businesses, capacity is typically set at 100% from Year 1 since production follows seasonal/harvest cycles.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()
          )}

          <div className="border-t" />

          <div className="border-t" />

          <SectionTitle
            icon={Boxes}
            title="3. Financial Assumptions for CMA Projections"
            subtitle="These drive all 5-year P&L, DSCR, Break-Even and Bank Scorecard calculations. CA-standard defaults pre-filled."
          />

          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 space-y-1">
            <p><strong>Illustrative Platform Defaults (not statutory rates):</strong></p>
            {/* BUG FIX: both figures below were presented as "mandatory"/statutory.
                Neither is: the 10%/5% WDV rates are this platform's generic CMA-
                projection assumption, distinct from Companies Act Schedule II and
                Income Tax Act depreciation (which have their own, different block-
                of-assets rates); the 25% tax rate is an illustrative effective-tax
                assumption — a Proprietorship is taxed at the proprietor's own
                individual income-tax slab rates, not a flat rate. */}
            <p>• Machinery Dep 10% WDV · Building Dep 5% WDV — generic CMA-projection rates only, distinct from Companies Act / Income Tax Act depreciation</p>
            <p>• Tax Rate 25% — illustrative effective-tax assumption; actual tax depends on the applicant's business constitution (a Proprietorship is taxed at the proprietor's individual slab rates) and must be confirmed by a CA</p>
            <p>• Revenue Growth 7% p.a. · Fixed Expense Growth 5% p.a. · Salary Hike 10% p.a. · DSCR benchmark ≥ 1.25</p>
            <p>• Contingency on P&amp;M 5–10% — a cost-overrun buffer banks expect on new machinery purchases</p>
            <p>• {isServiceOrTrading ? "Service/Trading Capacity: 60→70→80→85→90%" : isAgriculture ? "Agriculture Capacity: 80→85→90→95→100%" : "Manufacturing Capacity: 50→60→70→75→80%"}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            <NumberField
              label="Machinery / Equipment Depreciation % (WDV) *"
              value={report.revenue.depreciation_pct || 10}
              onChange={(value) => updateSection("revenue", { depreciation_pct: value })}
              placeholder="10"
            />
            <NumberField
              label="Building / Setup Depreciation % (WDV) *"
              value={report.dpr.building_dep_rate_pct || 5}
              onChange={(value) => updateSection("dpr", { building_dep_rate_pct: value })}
              placeholder="5"
            />
            <NumberField
              label="Income Tax Rate % (CA Mandatory — 25%) *"
              value={report.revenue.tax_rate_pct || 25}
              onChange={(value) => updateSection("revenue", { tax_rate_pct: value })}
              placeholder="25"
            />
            <NumberField
              label="Revenue Growth % per Year"
              value={report.revenue.revenue_growth_pct || 7}
              onChange={(value) => updateSection("revenue", { revenue_growth_pct: value })}
              placeholder="7"
            />
            <NumberField
              label="Fixed Expense Growth % per Year"
              value={report.revenue.expense_growth_pct || 5}
              onChange={(value) => updateSection("revenue", { expense_growth_pct: value })}
              placeholder="5"
            />
            <NumberField
              label="Annual Salary Hike % (Compounds Each Year)"
              value={(report.dpr as any).salary_increase_pct ?? 10}
              onChange={(value) => updateSection("dpr", { salary_increase_pct: value } as any)}
              placeholder="10"
            />
            <NumberField
              label="Contingency on Plant & Machinery %"
              value={report.dpr.contingency_pct || 0}
              onChange={(value) => updateSection("dpr", { contingency_pct: value })}
              placeholder="e.g. 5"
              max={25}
            />
            <NumberField
              label="Promoter Drawings % of PAT (optional)"
              value={report.dpr.promoter_drawings_pct || 0}
              onChange={(value) => updateSection("dpr", { promoter_drawings_pct: Math.min(Math.max(value, 0), 100) })}
              placeholder="0 = full retention"
              max={100}
            />
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Drawings reduce Reserves &amp; Surplus / net worth on the Balance Sheet, but never DSCR or cash accruals — a bank checks debt-service capacity before the promoter's personal withdrawal. 0% assumes full profit retention (common conservative assumption for a new project's first 5 years).
          </p>
          <p className="text-xs text-muted-foreground -mt-2">
            Cost-overrun buffer added on top of machinery cost before depreciation — CA standard is 5–10% for new equipment purchases. 0 = none.
          </p>

          {/* Capacity Utilization — industry-aware defaults, no hardcodes */}
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-1">
            <p><strong>Capacity Utilization Schedule</strong> — Directly sets Year 1-5 revenue. Banks scrutinize this carefully.</p>
            <p>Keep Year 1 conservative — banks know a new business cannot run at 100% from Day 1.
            {isServiceOrTrading ? " Trading/Service default: 60→70→80→85→90%." : isAgriculture ? " Agriculture default: 80→85→90→95→100%." : " Manufacturing default: 50→60→70→75→80%."}</p>
          </div>
          <div className="grid grid-cols-5 gap-3">
            {[1, 2, 3, 4, 5].map((yr) => {
              const key = `capacity_y${yr}_pct` as keyof typeof report.dpr;
              const defaultVal = capacityDefaults[yr];
              return (
                <div key={yr} className="space-y-2">
                  <Label className="text-xs font-semibold">Year {yr} %</Label>
                  <Input
                    type="number"
                    className="h-11 rounded-xl text-center font-semibold"
                    value={Number(report.dpr[key]) || defaultVal}
                    min={1}
                    max={100}
                    onChange={(e) => updateSection("dpr", { [key]: Number(e.target.value) || defaultVal } as any)}
                  />
                  <p className="text-xs text-center text-muted-foreground">Y{yr}: {Number(report.dpr[key]) || defaultVal}%</p>
                </div>
              );
            })}
          </div>

        </CardContent>
      </Card>
    </div>
  );
};

export default ProjectReportInputsStep;
