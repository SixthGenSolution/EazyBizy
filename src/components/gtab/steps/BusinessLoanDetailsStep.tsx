import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Briefcase, Factory, Landmark, MapPin, Info, Sparkles, ArrowRight, Lightbulb } from "lucide-react";
import AIAssistBadge from "@/components/AIAssistPanel";
import { recommendScheme } from "@/lib/aiEngine";
import { getStep3Tips } from "@/lib/caGuidance";

import {
  GTABFormData,
  BUSINESS_TYPE_OPTIONS,
  LOAN_SCHEME_OPTIONS,
  LOAN_PURPOSE_OPTIONS,
  NATURE_OF_BUSINESS_OPTIONS,
  IMPLEMENTING_AGENCY_OPTIONS,
} from "@/types/gtab";
import SectionTitle from "@/components/gtab/SectionTitle";

const fmtINR = (n: number) =>
  "₹" + Math.round(n).toLocaleString("en-IN");

interface BusinessLoanDetailsStepProps {
  formData: GTABFormData;
  updateFormData: (updates: Partial<GTABFormData>) => void;
}

// CA Tip box
const CATip = ({ tips }: { tips: string[] }) => (
  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1.5">
    <div className="flex items-center gap-2 text-amber-800 font-semibold text-xs uppercase tracking-wide">
      <Lightbulb className="w-3.5 h-3.5" />
      CA Guidance — Loan Approval Essentials
    </div>
    {tips.map((tip, i) => <p key={i} className="text-xs text-amber-700">• {tip}</p>)}
  </div>
);

// Scheme eligibility hints shown below the scheme dropdown
const SCHEME_HINTS: Record<string, { color: string; text: string }> = {
  pmegp:         { color: "bg-yellow-50 border-yellow-200 text-yellow-800", text: "Govt subsidy 15–35% held as TDR. New business only. Mfg ≤ Rs. 50L, Service ≤ Rs. 20L." },
  mudra_shishu:  { color: "bg-blue-50 border-blue-200 text-blue-800",       text: "Collateral-free micro loan up to Rs. 50,000. No CMA required." },
  mudra_kishor:  { color: "bg-blue-50 border-blue-200 text-blue-800",       text: "Collateral-free. Rs. 50K – Rs. 5L. Light CMA required." },
  mudra_tarun:   { color: "bg-blue-50 border-blue-200 text-blue-800",       text: "Collateral-free. Rs. 5L – Rs. 10L. Full CMA mandatory. 0.50% processing fee." },
  mudra_tarunplus: { color: "bg-blue-50 border-blue-200 text-blue-800",     text: "For borrowers who fully repaid a Tarun loan. Rs. 10L – Rs. 20L. Full CMA mandatory." },
  cgtmse:        { color: "bg-green-50 border-green-200 text-green-800",    text: "Govt guarantee 75–85% of default. No collateral. Up to Rs. 5 Crore. New & existing eligible." },
  normal_msme:   { color: "bg-slate-50 border-slate-200 text-slate-700",    text: "Standard PSU bank loan. Promoter contribution 20–25%. Full CMA for all amounts." },
};

const BusinessLoanDetailsStep = ({ formData, updateFormData }: BusinessLoanDetailsStepProps) => {
  const industryKey = (formData.industry_type || "manufacturing") as keyof typeof NATURE_OF_BUSINESS_OPTIONS;
  const natureOptions = NATURE_OF_BUSINESS_OPTIONS[industryKey] ?? NATURE_OF_BUSINESS_OPTIONS["manufacturing"];
  const schemeHint = SCHEME_HINTS[formData.loan_scheme];
  const isPmegp = formData.loan_scheme === "pmegp";

  // ── CA scheme recommendation (computed live from form data) ───────────────
  const rec = useMemo(() => recommendScheme(formData), [formData]);
  const showAdvisory = !rec.isSelectedOptimal && rec.best?.eligible && rec.switchBenefit;

  return (
    <div className="mx-auto max-w-none space-y-4 sm:space-y-6">
      <Card className="gtab-card-light rounded-[0.9rem] border shadow-sm sm:rounded-2xl">
        <CardContent className="space-y-5 p-4 sm:space-y-7 sm:p-8">

          {/* Business Details */}
          <SectionTitle
            icon={Briefcase}
            title="Business Details"
            subtitle="Tell us about your business"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">

            <div className="space-y-2">
              <Label>Business Status *</Label>
              <Select
                value={formData.business_type}
                onValueChange={(value: any) => updateFormData({ business_type: value })}
              >
                <SelectTrigger className="h-12 rounded-xl">
                  <SelectValue placeholder="Select business status" />
                </SelectTrigger>
                <SelectContent>
                  {BUSINESS_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formData.business_type === "existing_business" && (
              <>
                <div className="space-y-2">
                  <Label>How long in business? (Months) *</Label>
                  <Input
                    type="number"
                    className="h-12 rounded-xl"
                    value={formData.business_duration_months || ""}
                    onChange={(e) => updateFormData({ business_duration_months: parseInt(e.target.value) || 0 })}
                    placeholder="e.g. 24"
                    min={0}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-2 text-xs text-teal-800">
                    Existing business — enter last financial year's audited figures. These appear in the report so the banker sees your track record.
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Last FY Annual Turnover (₹) *</Label>
                  <Input
                    type="number"
                    className="h-12 rounded-xl"
                    value={formData.existing_annual_turnover || ""}
                    onChange={(e) => updateFormData({ existing_annual_turnover: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g. 2400000"
                    min={0}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Last FY Net Profit (₹) *</Label>
                  <Input
                    type="number"
                    className="h-12 rounded-xl"
                    value={formData.existing_annual_profit || ""}
                    onChange={(e) => updateFormData({ existing_annual_profit: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g. 300000"
                    min={0}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Existing Loan EMI / month (₹)</Label>
                  <Input
                    type="number"
                    className="h-12 rounded-xl"
                    value={formData.existing_monthly_emi || ""}
                    onChange={(e) => updateFormData({ existing_monthly_emi: parseFloat(e.target.value) || 0 })}
                    placeholder="0 if none"
                    min={0}
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Name of Business Entity <span className="text-red-500">*</span></Label>
                <AIAssistBadge variant="inline" fieldLabel="Name of Business Entity" tooltip="AI can suggest a suitable business name" showDataChart={false} onApply={(t) => updateFormData({ business_entity_name: t })} />
              </div>
              <Input
                className="h-12 rounded-xl"
                value={formData.business_entity_name}
                onChange={(e) => updateFormData({ business_entity_name: e.target.value })}
                placeholder="e.g., ABC Enterprises"
              />
            </div>

            {/* Industry — read-only display */}
            <div className="space-y-2">
              <Label>Industry</Label>
              <div className="flex h-12 items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-medium capitalize text-teal-800">
                <Factory className="h-4 w-4" />
                {formData.industry_type}
              </div>
            </div>

            {/* Nature of Business — dropdown based on industry */}
            <div className="space-y-2 md:col-span-2">
              <Label>Nature / Type of Business Activity *</Label>
              <Select
                value={formData.type_of_business || ""}
                onValueChange={(value) => updateFormData({
                  type_of_business: value,
                  business_activity_other: value === "other_manufacturing" ? formData.business_activity_other : "",
                })}
              >
                <SelectTrigger className="h-12 rounded-xl">
                  <SelectValue placeholder={`Select ${industryKey} activity`} />
                </SelectTrigger>
                <SelectContent>
                  {natureOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formData.type_of_business === "other_manufacturing" && (
                <Input
                  className="h-12 rounded-xl"
                  value={formData.business_activity_other || ""}
                  onChange={(e) => updateFormData({ business_activity_other: e.target.value })}
                  placeholder="Enter your manufacturing activity"
                />
              )}
            </div>

          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Loan Section */}
          <SectionTitle
            icon={Landmark}
            title="Loan Scheme & Purpose"
            subtitle="Select the government scheme and purpose of the loan"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">

            <div className="space-y-2 md:col-span-2">
              <Label>Loan Scheme *</Label>
              <Select
                value={formData.loan_scheme}
                onValueChange={(value: any) => updateFormData({ loan_scheme: value })}
              >
                <SelectTrigger className="h-12 rounded-xl">
                  <SelectValue placeholder="Select loan scheme" />
                </SelectTrigger>
                <SelectContent>
                  {LOAN_SCHEME_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Scheme hint */}
              {schemeHint && (
                <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${schemeHint.color}`}>
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{schemeHint.text}</span>
                </div>
              )}

              {/* ── CA AI Advisory: switch recommendation ─────────────────── */}
              {showAdvisory && rec.best && (
                <div className="rounded-2xl border border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 p-4 space-y-3 shadow-sm">
                  {/* Header */}
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
                      <Sparkles className="h-4 w-4 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-amber-800">CA AI Recommends a Better Scheme</p>
                      <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">{rec.switchBenefit}</p>
                    </div>
                  </div>

                  {/* Comparison row */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Current selection */}
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 space-y-0.5">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-red-500">Your Selection</p>
                      <p className="text-sm font-semibold text-red-700">{rec.selectedScheme?.name ?? formData.loan_scheme?.toUpperCase()}</p>
                      {rec.selectedScheme && (
                        <>
                          <p className="text-[11px] text-red-600">Subsidy: {rec.selectedScheme.subsidyAmount > 0 ? fmtINR(rec.selectedScheme.subsidyAmount) : "None"}</p>
                          {rec.selectedScheme.dscrUnderScheme > 0 && (
                            <p className="text-[11px] text-red-600">Est. DSCR: {rec.selectedScheme.dscrUnderScheme.toFixed(2)}x</p>
                          )}
                        </>
                      )}
                    </div>

                    {/* Recommended scheme */}
                    <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2.5 space-y-0.5">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">CA Recommends</p>
                      <p className="text-sm font-semibold text-emerald-700">{rec.best.name}</p>
                      {rec.subsidySavingsFromSwitch > 0 && (
                        <p className="text-[11px] font-semibold text-emerald-700">+ {fmtINR(rec.subsidySavingsFromSwitch)} FREE subsidy</p>
                      )}
                      {rec.best.dscrUnderScheme > 0 && (
                        <p className="text-[11px] text-emerald-600">
                          Est. DSCR: {rec.best.dscrUnderScheme.toFixed(2)}x
                          {rec.dscrGainFromSwitch > 0.05 && (
                            <span className="ml-1 text-emerald-700 font-semibold">(+{rec.dscrGainFromSwitch.toFixed(2)})</span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Switch button */}
                  <button
                    type="button"
                    onClick={() => updateFormData({ loan_scheme: rec.best!.id as any })}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-md hover:bg-amber-600 hover:shadow-[0_0_16px_rgba(245,158,11,0.4)] active:scale-95 transition-all duration-150"
                  >
                    Switch to {rec.best.name}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <p className="text-center text-[10px] text-amber-600">
                    You can always change the scheme again — this is just the CA recommendation.
                  </p>
                </div>
              )}
            </div>

            {formData.loan_scheme === "other_scheme" && (
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center justify-between">
                  <Label>Specify Scheme Name *</Label>
                  <AIAssistBadge variant="inline" fieldLabel="Specify Scheme Name" tooltip="AI can help identify the correct loan scheme" showDataChart={false} onApply={(t) => updateFormData({ loan_scheme_other: t })} />
                </div>
                <Input
                  className="h-12 rounded-xl"
                  value={formData.loan_scheme_other}
                  onChange={(e) => updateFormData({ loan_scheme_other: e.target.value })}
                  placeholder="Enter scheme name"
                />
              </div>
            )}

            <div className="space-y-2 md:col-span-2">
              <Label>Purpose of Loan *</Label>
              <Select
                value={formData.loan_purpose}
                onValueChange={(value: any) => updateFormData({ loan_purpose: value })}
              >
                <SelectTrigger className="h-12 rounded-xl md:w-1/2">
                  <SelectValue placeholder="Select loan purpose" />
                </SelectTrigger>
                <SelectContent>
                  {LOAN_PURPOSE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

          </div>

          {/* PMEGP-specific fields */}
          {isPmegp && (
            <>
              <div className="border-t" />
              <SectionTitle
                icon={MapPin}
                title="PMEGP Details"
                subtitle="Additional details required for PMEGP subsidy calculation"
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">

                {/* Area Type */}
                <div className="space-y-2">
                  <Label>Area Type *</Label>
                  <Select
                    value={formData.area_type || "rural"}
                    onValueChange={(value: any) => updateFormData({ area_type: value })}
                  >
                    <SelectTrigger className="h-12 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rural">Rural — General 25% / Special 35% subsidy</SelectItem>
                      <SelectItem value="urban">Urban — General 15% / Special 25% subsidy</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Implementing Agency */}
                <div className="space-y-2">
                  <Label>Implementing Agency *</Label>
                  <Select
                    value={formData.implementing_agency || "kvic"}
                    onValueChange={(value: any) => updateFormData({ implementing_agency: value })}
                  >
                    <SelectTrigger className="h-12 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMPLEMENTING_AGENCY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Second Loan */}
                <div className="space-y-2">
                  <Label>Is this a 2nd PMEGP Loan?</Label>
                  <Select
                    value={formData.is_second_loan ? "yes" : "no"}
                    onValueChange={(v) => updateFormData({ is_second_loan: v === "yes" })}
                  >
                    <SelectTrigger className="h-12 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no">No — First loan (Max Rs. 50L Mfg / Rs. 20L Svc)</SelectItem>
                      <SelectItem value="yes">Yes — Second loan (Max Rs. 1 Cr Mfg)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Negative list check badge */}
                <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 md:col-span-2">
                  <Info className="h-4 w-4 shrink-0" />
                  <span>
                    <strong>PMEGP Negative List:</strong> Tobacco, Alcohol, Pan Masala, and pure
                    Trading activities (no value addition) are <strong>NOT eligible</strong> under PMEGP.
                  </span>
                </div>

              </div>
            </>
          )}

          {/* CA Approval Guidance — industry + scheme aware */}
          <CATip tips={getStep3Tips({
            industry: formData.industry_type || "manufacturing",
            scheme: formData.loan_scheme || "normal_msme",
            isNewBusiness: formData.business_type !== "existing_business",
            areaType: formData.area_type,
            socialCategory: formData.social_category,
          })} />

        </CardContent>
      </Card>
    </div>
  );
};

export default BusinessLoanDetailsStep;
