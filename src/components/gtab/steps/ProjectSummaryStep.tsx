import { AlertCircle, IndianRupee, BarChart3, Lightbulb, Landmark } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GTABFormData, ProjectReportInputs } from "@/types/gtab";
import { getFinancingPlan, getPromoterEquityPct } from "@/lib/projectReport";
import { getMonthlyWorkingCapital } from "@/lib/workingCapital";
import { getStep6Tips } from "@/lib/caGuidance";
import SectionTitle from "@/components/gtab/SectionTitle";

interface ProjectSummaryStepProps {
  formData: GTABFormData;
  updateFormData: (updates: Partial<GTABFormData>) => void;
  totals: {
    total_project_cost: number;
    margin_money: number;
    eligible_loan_amount: number;
  };
}

const CATip = ({ tips }: { tips: string[] }) => (
  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1.5">
    <div className="flex items-center gap-2 text-amber-800 font-semibold text-xs uppercase tracking-wide">
      <Lightbulb className="w-3.5 h-3.5" />
      CA Guidance — Verify Before Proceeding
    </div>
    {tips.map((tip, i) => <p key={i} className="text-xs text-amber-700">• {tip}</p>)}
  </div>
);

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
};

// Schemes where the bank actually sets its own Term Loan / WC Loan % and the
// backend honours whatever the user enters — PMEGP/Mudra/CGTMSE compute a
// scheme-mandated split by formula instead, so editing % there wouldn't
// change the generated report (see schemes/*.py, backend/rules/engine.py).
const SCHEMES_WITH_BANK_ADJUSTABLE_PCT = ["normal_msme", "msme_psu", "other_scheme"];

const ProjectSummaryStep = ({ formData, updateFormData, totals }: ProjectSummaryStepProps) => {
  const machineryTotal = (formData.plant_machinery || []).reduce(
    (sum, item) => sum + (Number(item.cost) || (Number(item.quantity || 1) * Number(item.unit_cost || 0)) || 0),
    0
  );
  const monthlyWorkingCapital = getMonthlyWorkingCapital(
    formData.working_capital_required,
    formData.working_capital_period,
  );
  const promoterEquityPct = getPromoterEquityPct(formData);
  const financingPlan = getFinancingPlan(formData);
  const report = formData.project_report_inputs;
  const canAdjustPct = SCHEMES_WITH_BANK_ADJUSTABLE_PCT.includes(formData.loan_scheme);

  const updateReport = (updates: Partial<ProjectReportInputs>) => {
    updateFormData({
      project_report_inputs: {
        ...report,
        ...updates,
      },
    });
  };

  const updateDpr = (updates: Partial<ProjectReportInputs["dpr"]>) => {
    updateReport({ dpr: { ...report.dpr, ...updates } });
  };

  // CA standard: project cost = fixed capital + promoter's WC margin only.
  // The full WC requirement is a revolving bank facility — NOT part of project cost.
  const costBreakdown = [
    { label: "Land Cost",                           value: formData.land_cost },
    { label: "Shed / Building Cost",                value: formData.shed_building_cost },
    { label: "Plant & Machinery",                   value: machineryTotal },
    { label: "Computers / Laptops / Printers",      value: formData.computers_cost },
    { label: "Furniture & Fixtures",                value: formData.furniture_cost },
    { label: "Electrification & Power Backup",      value: formData.electrification_cost },
    { label: "Racks & Storage",                     value: formData.racks_storage_cost },
    { label: "Transportation Cost",                 value: formData.transportation_cost },
    { label: "Machinery Installation",              value: formData.machinery_installation_cost },
    { label: "Pre-Operative / Other Expenses",      value: formData.other_initial_expenditure },
    { label: "Working Capital Margin (Promoter's Share)", value: financingPlan.promoterWorkingCapitalContribution },
  ];

  return (
    <div className="mx-auto max-w-none space-y-4 sm:space-y-6">

      <Card className="gtab-card-light rounded-[0.9rem] border shadow-sm sm:rounded-2xl">
        <CardContent className="space-y-5 p-4 sm:space-y-7 sm:p-8">

          {/* Cost Breakdown */}
          <SectionTitle
            icon={BarChart3}
            title="Investment Summary"
            subtitle="Review full project costing and loan eligibility"
          />

          <div className="space-y-4">
            {costBreakdown
              .filter(item => Number(item.value) > 0)
              .map((item, index) => (
              <div
                key={index}
                className="flex justify-between items-center border-b border-white/10 pb-3 text-sm"
              >
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-semibold">
                  {formatCurrency(Number(item.value) || 0)}
                </span>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Summary Cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">

            <div className="p-6 rounded-xl bg-primary/10 border border-primary/20">
              <div className="flex items-center gap-2 text-primary mb-2">
                <IndianRupee className="w-5 h-5" />
                <span className="text-sm font-medium">Initial Project Investment</span>
              </div>

              <p className="text-2xl font-bold">
                {formatCurrency(totals.total_project_cost)}
              </p>
            </div>

            <div className="p-6 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-center gap-2 text-amber-600 mb-2">
                <IndianRupee className="w-5 h-5" />
                <span className="text-sm font-semibold">{`Promoter's Contribution (${Number(promoterEquityPct).toFixed(1)}%)`}</span>
              </div>

              <p className="text-2xl font-bold text-amber-700">
                {formatCurrency(totals.margin_money)}
              </p>

              <p className="text-xs text-amber-700/70 mt-1">
                Own Equity Investment
              </p>
            </div>

            <div className="p-6 rounded-xl bg-gradient-to-r from-primary to-primary/70 text-white">
              <div className="flex items-center gap-2 mb-2">
                <IndianRupee className="w-5 h-5" />
                <span className="text-sm font-medium">Total Bank Finance</span>
              </div>

              <p className="text-2xl font-bold">
                {formatCurrency(totals.eligible_loan_amount)}
              </p>

              <p className="text-xs opacity-80 mt-1">
                {`Term Loan ${financingPlan.termLoanBankFinancePct}% of Fixed Investment + WC ${financingPlan.wcBankFinancePct}%`}
              </p>
            </div>

          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Means of Finance Breakdown — Term Loan / Working Capital / Promoter Contribution as clear input-style fields */}
          <SectionTitle
            icon={Landmark}
            title="Means of Finance Breakdown"
            subtitle="How this project will be funded — term loan, working capital and your own contribution"
          />

          <div className={`grid grid-cols-1 gap-4 md:gap-6 ${formData.loan_scheme === "pmegp" ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
            <div className="space-y-2">
              <Label>Term Loan Amount (₹)</Label>
              <Input readOnly value={formatCurrency(financingPlan.termLoanAmount)} className="h-12 rounded-xl font-semibold" />
              {canAdjustPct ? (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={0} max={100} className="h-9 w-24 rounded-lg text-sm"
                      value={report.dpr.term_loan_pct || ""}
                      placeholder={String(financingPlan.termLoanBankFinancePct)}
                      onChange={(e) => updateDpr({ term_loan_pct: Math.min(Math.max(Number(e.target.value) || 0, 0), 100) })}
                    />
                    <span className="text-xs text-muted-foreground">% of Fixed Capital — set to whatever your bank actually offers</span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {financingPlan.termLoanBankFinancePct}% of Fixed Capital — fixed by {formData.loan_scheme.toUpperCase()} scheme rules, not bank-adjustable
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Working Capital Loan Amount (₹)</Label>
              <Input readOnly value={formatCurrency(financingPlan.workingCapitalLoan)} className="h-12 rounded-xl font-semibold" />
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={0} max={100} className="h-9 w-24 rounded-lg text-sm"
                  value={report.dpr.wc_loan_pct || ""}
                  placeholder={String(financingPlan.wcBankFinancePct)}
                  onChange={(e) => updateDpr({ wc_loan_pct: Math.min(Math.max(Number(e.target.value) || 0, 0), 100) })}
                />
                <span className="text-xs text-muted-foreground">% of monthly working capital — set to whatever your bank actually offers</span>
              </div>
            </div>
            {formData.loan_scheme === "pmegp" && (
              <div className="space-y-2">
                <Label>Government Subsidy — Margin Money (₹)</Label>
                <Input readOnly value={formatCurrency(financingPlan.pmegpSubsidyAmount)} className="h-12 rounded-xl font-semibold" />
                <p className="text-xs text-muted-foreground">PMEGP margin money subsidy, held as TDR for 3 years</p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Promoter's Contribution (₹)</Label>
              <Input readOnly value={formatCurrency(financingPlan.promoterContribution)} className="h-12 rounded-xl font-semibold" />
              <p className="text-xs text-muted-foreground">{Number(promoterEquityPct).toFixed(1)}% of total project cost — your own equity</p>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Loan Details */}
          <SectionTitle
            icon={IndianRupee}
            title="Selected Loan Details"
            subtitle="Review selected business and loan configuration"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 gap-4 text-sm">

            <div>
              <span className="text-muted-foreground">Loan Scheme:</span>
              <p className="font-semibold">
                {formData.loan_scheme === "other_scheme"
                  ? (formData.loan_scheme_other || "Other Scheme")
                  : formData.loan_scheme === "pmegp"          ? "PMEGP"
                  : formData.loan_scheme === "mudra_shishu"   ? "Mudra — Shishu (up to ₹50K)"
                  : formData.loan_scheme === "mudra_kishor"   ? "Mudra — Kishor (₹50K–₹5L)"
                  : formData.loan_scheme === "mudra_tarun"    ? "Mudra — Tarun (₹5L–₹10L)"
                  : formData.loan_scheme === "mudra_tarunplus"? "Mudra — Tarun Plus (₹10L–₹20L)"
                  : formData.loan_scheme === "cgtmse"         ? "CGTMSE"
                  : formData.loan_scheme === "normal_msme"    ? "MSME Loan (General)"
                  : formData.loan_scheme?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
              </p>
            </div>

            <div>
              <span className="text-muted-foreground">Loan Purpose:</span>
              <p className="font-semibold">
                {formData.loan_purpose === "term_loan"                ? "Term Loan (Fixed Capital)"
                 : formData.loan_purpose === "working_capital"        ? "Working Capital Only"
                 : formData.loan_purpose === "term_and_working_capital"? "Term Loan + Working Capital (Composite)"
                 : formData.loan_purpose?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "—"}
              </p>
            </div>

            <div>
              <span className="text-muted-foreground">Industry:</span>
              <p className="font-semibold">
                {formData.industry_type === "others"
                  ? (formData.industry_other || "Others")
                  : (formData.industry_type?.replace(/\b\w/g, c => c.toUpperCase()) || "—")}
              </p>
            </div>

            <div>
              <span className="text-muted-foreground">Business Type / Activity:</span>
              <p className="font-semibold">
                {formData.type_of_business?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "—"}
              </p>
            </div>

          </div>

          {/* CA Approval Guidance — industry + scheme aware */}
          <CATip tips={getStep6Tips({
            industry: formData.industry_type || "manufacturing",
            scheme: formData.loan_scheme || "normal_msme",
            projectCost: financingPlan.totalProjectCost,
            loanAmount: financingPlan.totalBankFinance,
          })} />

          {/* Info Alert */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              The final loan amount is subject to bank verification and approval.
              You can modify project costs before final submission.
            </AlertDescription>
          </Alert>

        </CardContent>
      </Card>

    </div>
  );
};

export default ProjectSummaryStep;
