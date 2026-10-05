import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GTABFormData } from "@/types/gtab";
import {
  User, Building2, FileText, Wrench, DollarSign, Factory,
  Download, Landmark, TrendingUp, AlertCircle, CheckCircle2,
  Loader2, IndianRupee, Sparkles, X, XCircle,
} from "lucide-react";
import { getFinancingPlan, getNormalizedProjectReportInputs, getProjectReportMachineryTotal } from "@/lib/projectReport";
import { useToast } from "@/hooks/use-toast";
import { useReportGenerator } from "@/hooks/useReportGenerator";
import { buildCMAReportInput } from "@/lib/buildCMAReportInput";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { getMonthlyWorkingCapital } from "@/lib/workingCapital";
import { CMAAdvisoryPanel } from "./CMAAdvisoryPanel";
import { predictViability, recommendScheme } from "@/lib/aiEngine";
import { cn } from "@/lib/utils";

interface ApplicationPreviewProps {
  formData: GTABFormData;
  applicationId?: string | null;
  onSubmit?: () => void;
  onEnsureSaved?: () => Promise<string | null>;
  isSaving?: boolean;
}

const REPORT_THEMES = [
  { name: "Navy", swatch: "#173B63" },
  { name: "Teal", swatch: "#0D9488" },
  { name: "Royal Blue", swatch: "#2563EB" },
  { name: "Burgundy", swatch: "#7F1D3B" },
  { name: "Forest Green", swatch: "#166534" },
  { name: "Charcoal", swatch: "#334155" },
] as const;

const REPORT_BANKS = [
  "State Bank of India (SBI)", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra Bank",
  "Bank of Baroda", "Punjab National Bank", "Canara Bank", "Union Bank of India", "Bank of India",
  "Indian Bank", "Central Bank of India", "Indian Overseas Bank", "UCO Bank", "Bank of Maharashtra",
  "IDBI Bank", "Yes Bank", "Federal Bank", "IndusInd Bank", "RBL Bank", "South Indian Bank",
  "Bandhan Bank", "AU Small Finance Bank", "Other",
];

const fmt = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v || 0);

const SectionCard = ({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) => (
  <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white text-slate-800">
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-3 text-base font-semibold text-slate-800">
        <div className="bg-primary/10 p-2 rounded-xl"><Icon className="w-4 h-4 text-primary" /></div>
        {title}
      </CardTitle>
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);

const Row = ({ label, value }: { label: string; value?: string | number | null }) => (
  <div className="space-y-0.5">
    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">{label}</p>
    <p className="text-sm font-semibold text-slate-800">{value || <span className="text-slate-400 font-normal italic">Not provided</span>}</p>
  </div>
);

const ApplicationPreview = ({ formData, applicationId, onSubmit, onEnsureSaved, isSaving }: ApplicationPreviewProps) => {
  const { toast } = useToast();
  const { isLoading: isCMALoading, error: cmaError, reportResult: cmaResult, generateReport: generateCMAReport, downloadPDF: downloadCMAPDF } = useReportGenerator();
  const [customizeReportOpen, setCustomizeReportOpen] = useState(false);
  const [reportTheme, setReportTheme] = useState<(typeof REPORT_THEMES)[number]["name"]>("Navy");
  const [preparedBy, setPreparedBy] = useState("EasyBizy");
  const [reportBank, setReportBank] = useState("");

  const reportInputs   = getNormalizedProjectReportInputs(formData);
  const financingPlan  = getFinancingPlan(formData);
  const machineryTotal = getProjectReportMachineryTotal(formData);
  const monthlyWC      = getMonthlyWorkingCapital(formData.working_capital_required, formData.working_capital_period);

  // AI pre-submission checks
  const viability       = useMemo(() => predictViability(formData), [formData]);
  const schemeRec       = useMemo(() => recommendScheme(formData), [formData]);
  const hasAIErrors     = viability.issues.some(i => i.severity === 'error');
  const bandColorClass  = viability.band === 'strong' ? 'border-emerald-300 bg-emerald-50'
                        : viability.band === 'good'   ? 'border-blue-300 bg-blue-50'
                        : viability.band === 'review' ? 'border-amber-300 bg-amber-50'
                        : 'border-red-300 bg-red-50';
  const bandTextClass   = viability.band === 'strong' ? 'text-emerald-800'
                        : viability.band === 'good'   ? 'text-blue-800'
                        : viability.band === 'review' ? 'text-amber-800'
                        : 'text-red-800';
  const scoreColor      = viability.band === 'strong' ? '#059669'
                        : viability.band === 'good'   ? '#2563eb'
                        : viability.band === 'review' ? '#d97706'
                        : '#dc2626';

  const handleDownloadReport = () => setCustomizeReportOpen(true);

  const handleGenerateReport = async () => {
    await onEnsureSaved?.();
    const payload = buildCMAReportInput(formData, {
      frontPageColor: reportTheme,
      preparedBy: preparedBy.trim() || "EasyBizy",
      bankName: reportBank || undefined,
    });
    const result  = await generateCMAReport(payload);
    if (result) {
      // Always download the PDF — warnings are informational only
      downloadCMAPDF(result.pdf_url, result.report_id);
      setCustomizeReportOpen(false);
      const hasWarnings = (result.validation_warnings?.length ?? 0) > 0;
      toast({
        title: hasWarnings ? "⚠️ Report downloaded with warnings" : "✅ Report ready — downloading now",
        description: hasWarnings
          ? `${result.validation_warnings!.length} issue(s) found. Check the warnings below.`
          : `${result.key_metrics.scheme} | ${result.key_metrics.credit_rating} | Avg DSCR ${result.key_metrics.dscr_average}`,
        variant: hasWarnings ? "default" : "default",
      });
    }
    // If result is null, the error is shown in the error panel below (not as a blocking popup)
  };

  return (
    <div className="mx-auto w-full max-w-none space-y-5">

      {/* Header */}
      <div className="text-center space-y-1 pb-2">
        <h2 className="text-2xl font-bold">Application Preview</h2>
        <p className="text-sm text-muted-foreground">Review your details below, then click Download Report</p>
      </div>

      {/* CMA Result — shown after generation */}
      {cmaResult && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          {(() => {
            const rec = cmaResult.key_metrics.recommendation?.toUpperCase() ?? '';
            const isReject  = rec === 'REJECT';
            const isApprove = rec.includes('APPROVE');
            const boxClass  = isReject
              ? "border-red-300 bg-red-50"
              : isApprove
                ? "border-emerald-300 bg-emerald-50"
                : "border-amber-300 bg-amber-50";
            const iconColor = isReject ? "text-red-600" : "text-emerald-600";
            const payback   = cmaResult.key_metrics.payback_months;
            const paybackDisplay = payback == null ? "N/A" : `${payback} months`;
            return (
          <div className={`rounded-2xl border p-5 ${boxClass}`}>
            <div className="flex flex-wrap items-center gap-4">
              <CheckCircle2 className={`w-7 h-7 shrink-0 ${iconColor}`} />
              <div className="flex-1 min-w-0">
                <p className={cn("text-lg font-bold", isReject ? "text-red-800" : isApprove ? "text-emerald-800" : "text-amber-800")}>{cmaResult.key_metrics.recommendation} — {cmaResult.key_metrics.credit_rating}</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Scheme: {cmaResult.key_metrics.scheme} | DSCR (5yr avg): {cmaResult.key_metrics.dscr_average} | Payback: {paybackDisplay}
                </p>
              </div>
              <Badge className={`text-white border-0 ${isReject ? "bg-red-600" : isApprove ? "bg-emerald-600" : "bg-amber-600"}`}>{cmaResult.validation_status}</Badge>
            </div>
            {cmaResult.validation_warnings?.length > 0 && (
              <div className="mt-3 space-y-1">
                {cmaResult.validation_warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-amber-700 text-xs">
                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />{w}
                  </div>
                ))}
              </div>
            )}
          </div>
            );
          })()}
        </motion.div>
      )}

      {/* ── Personal Info ──────────────────────────────────────────────────────── */}
      <SectionCard icon={User} title="Personal Information">
        <div className="grid md:grid-cols-3 gap-4">
          <Row label="Full Name" value={[formData.first_name, formData.middle_name, formData.last_name].filter(Boolean).join(" ")} />
          <Row label="Father's Name" value={reportInputs.promoter.fathers_name} />
          <Row label="Date of Birth" value={reportInputs.promoter.date_of_birth} />
          <Row label="Gender" value={formData.gender} />
          <Row label="Education" value={formData.education} />
          <Row label="Social Category" value={formData.social_category} />
          <Row label="PAN Number" value={reportInputs.promoter.pan_number} />
          <Row label="Aadhaar" value={reportInputs.promoter.aadhar_number} />
          <Row label="Experience" value={`${reportInputs.promoter.years_experience || 0} years`} />
          <Row label="Mobile" value={formData.contact_mobile} />
          <Row label="Email" value={formData.contact_email} />
          <Row label="Address" value={[formData.address_line_1, formData.city, formData.state, formData.pincode].filter(Boolean).join(", ")} />
        </div>
      </SectionCard>

      {/* ── Business Info ──────────────────────────────────────────────────────── */}
      <SectionCard icon={Building2} title="Business Information">
        <div className="grid md:grid-cols-3 gap-4">
          <Row label="Business Name" value={formData.business_entity_name} />
          <Row label="Registration" value={formData.registration_type} />
          <Row label="Industry" value={formData.industry_type} />
          <Row label="Nature of Business" value={formData.business_activity_other || formData.type_of_business} />
          <Row label="Business Type" value={formData.business_type} />
          <Row label="Loan Scheme" value={formData.loan_scheme} />
          <Row label="Area Type" value={formData.area_type} />
          <Row label="Loan Purpose" value={formData.loan_purpose} />
          <Row label="Expected Employment" value={`${formData.expected_employment || 0} persons`} />
        </div>
      </SectionCard>

      {/* ── Investment & Finance ─────────────────────────────────────────────── */}
      <SectionCard icon={IndianRupee} title="Investment & Financing">
        <div className="grid md:grid-cols-3 gap-4">
          <Row label="Initial Project Investment" value={fmt(formData.total_project_cost)} />
          <Row label="Term Loan (Bank)"          value={fmt(financingPlan.termLoanAmount)} />
          <Row label="Working Capital Loan"      value={fmt(financingPlan.workingCapitalLoan)} />
          <Row label="Total Bank Finance"        value={fmt(financingPlan.totalBankFinance)} />
          <Row label="Promoter Contribution"     value={fmt(financingPlan.promoterContribution)} />
          <Row label="Promoter %"                value={`${financingPlan.promoterEquityPct}%`} />
          <Row label="Machinery Total"           value={fmt(machineryTotal)} />
          <Row label="Shed / Building"           value={fmt(formData.shed_building_cost)} />
          <Row label="Monthly WC Requirement"    value={fmt(monthlyWC)} />
        </div>
      </SectionCard>

      {/* ── Loan & Financial Assumptions ──────────────────────────────────────── */}
      <SectionCard icon={Landmark} title="Loan & Financial Assumptions">
        <div className="grid md:grid-cols-3 gap-4">
          <Row label="Interest Rate"     value={`${reportInputs.loan.interest_rate_pct || 10.5}% p.a.`} />
          <Row label="Tenure"            value={`${reportInputs.loan.tenure_months || 60} months`} />
          <Row label="Moratorium"        value={`${reportInputs.loan.moratorium_months || 0} months`} />
          <Row label="Bank Name"         value={reportInputs.loan.bank_name} />
          <Row label="Tax Rate"          value={`${reportInputs.revenue.tax_rate_pct || 25}%`} />
          <Row label="Revenue Growth"    value={`${reportInputs.revenue.revenue_growth_pct || 10}% p.a.`} />
          <Row label="Depreciation"      value={`${reportInputs.revenue.depreciation_pct || 10}%`} />
          <Row label="Stock Days"        value={`${reportInputs.working_capital.stock_days || 30} days`} />
          <Row label="Debtor Days"       value={`${reportInputs.working_capital.debtors_days || 30} days`} />
        </div>
      </SectionCard>

      {/* ── Monthly Expenses ───────────────────────────────────────────────────── */}
      <SectionCard icon={DollarSign} title="Monthly Expenses">
        <div className="grid md:grid-cols-3 gap-4">
          <Row label="Total Monthly Expenses"    value={fmt(formData.total_monthly_expenses)} />
          <Row label="Rent"                      value={fmt(formData.monthly_rent)} />
          <Row label="Raw Material Cost"         value={fmt(formData.raw_material_cost)} />
          <Row label="Skilled Workers"           value={`${formData.skilled_workers_count || 0} × ${fmt(formData.skilled_workers_salary || 0)}`} />
          <Row label="Semi-Skilled Workers"      value={`${formData.semi_skilled_workers_count || 0} × ${fmt(formData.semi_skilled_workers_salary || 0)}`} />
          <Row label="Wages"                     value={`${formData.wages_count || 0} × ${fmt(formData.wages_salary || 0)}`} />
          <Row label="Electricity & Water"       value={fmt(formData.electricity_water_cost)} />
          <Row label="Marketing"                 value={fmt(formData.marketing_cost)} />
          <Row label="Misc / Others"             value={fmt(formData.miscellaneous_cost)} />
        </div>
      </SectionCard>

      {/* ── Plant & Machinery ─────────────────────────────────────────────────── */}
      {formData.plant_machinery?.length > 0 && (
        <SectionCard icon={Factory} title={`Plant & Machinery (${formData.plant_machinery.length} items)`}>
          <div className="space-y-3">
            {formData.plant_machinery.map((item, idx) => (
              <div key={item.id} className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{item.machine_name || `Machine #${idx + 1}`}</p>
                  <p className="text-xs text-slate-500">{item.supplier_name}</p>
                </div>
                <p className="text-sm font-bold text-primary shrink-0">{fmt(item.cost)}</p>
              </div>
            ))}
            <div className="flex justify-end pt-2 border-t border-slate-200">
              <p className="text-sm font-bold">Total: <span className="text-primary ml-1">{fmt(machineryTotal)}</span></p>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── AI Pre-submission Viability Check ──────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <div className={cn('rounded-2xl border p-4 space-y-3', bandColorClass)}>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl shrink-0"
              style={{ background: `${scoreColor}25` }}>
              <Sparkles className="w-4 h-4" style={{ color: scoreColor }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className={cn("text-sm font-bold", bandTextClass)}>AI Pre-Submission Check</p>
                <Badge className="text-white border-0 text-[10px]" style={{ background: scoreColor }}>
                  Score {viability.score}/100
                </Badge>
                {schemeRec.best && (
                  <Badge className="border text-[10px]" style={{ borderColor: `${scoreColor}60`, color: scoreColor, background: `${scoreColor}15` }}>
                    Best: {schemeRec.best.name}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-600 mt-0.5">{viability.recommendation}</p>
            </div>
          </div>

          {/* Key metrics row */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Est. DSCR', value: viability.dscrEstimate > 0 ? `${viability.dscrEstimate.toFixed(2)}x` : 'N/A', ok: viability.dscrEstimate >= 1.25 },
              { label: 'Gross Margin', value: `${viability.grossMarginPct.toFixed(0)}%`, ok: viability.grossMarginPct >= 15 },
              { label: 'Monthly Surplus', value: viability.monthlyProfit >= 0 ? `+${fmt(viability.monthlyProfit)}` : fmt(viability.monthlyProfit), ok: viability.monthlyProfit >= 0 },
            ].map(m => (
              <div key={m.label} className="rounded-xl p-3 text-center bg-white border border-slate-200 shadow-sm">
                <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">{m.label}</p>
                <p className={cn('text-sm font-bold mt-1', m.ok ? 'text-emerald-600' : 'text-amber-600')}>{m.value}</p>
              </div>
            ))}
          </div>

          {/* Issues */}
          {viability.issues.length > 0 && (
            <div className="space-y-1.5">
              {viability.issues.map((issue, i) => (
                <div key={i} className={cn('rounded-lg px-3 py-2 flex items-start gap-2 text-xs border',
                  issue.severity === 'error' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200')}>
                  {issue.severity === 'error'
                    ? <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                    : <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />}
                  <div>
                    <span className={cn("font-semibold", issue.severity === 'error' ? 'text-red-800' : 'text-amber-800')}>{issue.label}</span>
                    {issue.fix && <span className="text-blue-600 ml-1.5">→ {issue.fix}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Strengths */}
          {viability.strengths.length > 0 && viability.issues.filter(i => i.severity === 'error').length === 0 && (
            <div className="flex flex-wrap gap-1.5">
              {viability.strengths.map(s => (
                <div key={s} className="flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
                  <CheckCircle2 className="w-3 h-3" />{s}
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Action Buttons ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 justify-end pt-2">
        {/* Primary: Download Report */}
        <Button
          type="button"
          onClick={handleDownloadReport}
          disabled={isCMALoading}
          size="lg"
          className="gap-2 bg-[#D4AF37] hover:bg-[#f0c84b] text-[#061421] font-bold shadow-[0_12px_24px_rgba(212,175,55,0.30)] px-8 text-base"
        >
          {isCMALoading
            ? <><Loader2 className="w-5 h-5 animate-spin" /> Generating Report…</>
            : <><Download className="w-5 h-5" /> Download CMA Report</>}
        </Button>

        {/* Secondary: Submit Application */}
        <Button
          onClick={onSubmit}
          disabled={isSaving || isCMALoading}
          size="lg"
          className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 text-base shadow-[0_12px_24px_rgba(16,185,129,0.30)] transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-60"
        >
          {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
          {isSaving ? "Submitting…" : "Submit Application"}
        </Button>
      </div>

      <DialogPrimitive.Root open={customizeReportOpen} onOpenChange={setCustomizeReportOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/50" />
          <DialogPrimitive.Content
            className="fixed left-1/2 top-1/2 z-[101] max-h-[calc(100dvh-24px)] w-[min(600px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <DialogPrimitive.Title className="text-lg font-semibold">Customize Report</DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1 text-sm text-slate-500">
                  Choose the cover theme and report recipient before generating the CMA PDF.
                </DialogPrimitive.Description>
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setCustomizeReportOpen(false);
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close Customize Report"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Front Page Colour</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {REPORT_THEMES.map((theme) => (
                  <button
                    key={theme.name}
                    type="button"
                    role="radio"
                    aria-checked={reportTheme === theme.name}
                    onClick={() => setReportTheme(theme.name)}
                    className={`flex items-center gap-2 rounded-xl border p-2.5 text-left text-sm transition-colors ${
                      reportTheme === theme.name ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span className="h-8 w-8 shrink-0 rounded-lg border border-black/10" style={{ backgroundColor: theme.swatch }} />
                    <span>{theme.name}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="cma-prepared-by" className="text-sm font-medium">Prepared by</label>
                <input
                  id="cma-prepared-by"
                  value={preparedBy}
                  onChange={(event) => setPreparedBy(event.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="cma-report-bank" className="text-sm font-medium">To</label>
                <select
                  id="cma-report-bank"
                  value={reportBank}
                  onChange={(event) => setReportBank(event.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                >
                  <option value="">[Select Bank]</option>
                  {REPORT_BANKS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setCustomizeReportOpen(false)}
                className="h-10 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleGenerateReport()}
                disabled={isCMALoading}
                className="h-10 rounded-lg bg-[#1677ff] px-4 text-sm font-semibold text-white hover:bg-[#0f66d6] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCMALoading ? "Generating…" : "Generate PDF"}
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* Smart CA Advisory Panel — actionable suggestions, not raw errors */}
      {cmaResult?.validation_warnings && cmaResult.validation_warnings.length > 0 && (
        <CMAAdvisoryPanel
          warnings={cmaResult.validation_warnings}
          formData={formData}
        />
      )}

      {/* Server/network error — only when PDF could not be generated at all */}
      {cmaError && !cmaResult && (
        <div className="rounded-2xl border border-red-200 bg-red-50 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 bg-red-100 border-b border-red-200">
            <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center shrink-0">
              <AlertCircle className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-semibold text-red-900 text-sm">Report Could Not Be Generated</p>
              <p className="text-xs text-red-700">A server error occurred. Check the API is running.</p>
            </div>
          </div>
          <div className="px-5 py-3 space-y-1">
            <p className="text-sm text-red-800">{cmaError}</p>
            <p className="text-xs text-red-500">
              Run{' '}
              <code className="bg-red-100 border border-red-200 px-1.5 py-0.5 rounded text-red-700 font-mono">npm run api</code>
              {' '}in your terminal and try again.
            </p>
          </div>
        </div>
      )}

    </div>
  );
};

export default ApplicationPreview;
