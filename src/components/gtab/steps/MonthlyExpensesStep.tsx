import { useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { IndianRupee, Wallet, Users, Activity, Lightbulb } from "lucide-react";
import { GTABFormData } from "@/types/gtab";
import { getStep7Tips } from "@/lib/caGuidance";
import { CASuggestionTip } from "@/components/gtab/CASuggestionTip";
import { adviseOpexToRevenue } from "@/lib/caAdvisory";
import { numberToWords } from "@/lib/numberToWords";
import SectionTitle from "@/components/gtab/SectionTitle";

interface MonthlyExpensesStepProps {
  formData: GTABFormData;
  updateFormData: (updates: Partial<GTABFormData>) => void;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const CurrencyInput = ({
  label, value, onChange, placeholder = "₹ 0", hint,
}: {
  label: string; value: number; onChange: (v: number) => void; placeholder?: string; hint?: string;
}) => {
  const words = value > 0 ? numberToWords(value) : "";
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="number" className="h-12 rounded-xl"
        value={value || ""} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        placeholder={placeholder} min={0} />
      {words && (
        <p className="text-xs font-medium text-primary/80">₹ {words}</p>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
};

// CA AI Tip box — identical to Step 5 for visual consistency
const CATip = ({ tips }: { tips: string[] }) => (
  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1.5">
    <div className="flex items-center gap-2 text-amber-800 font-semibold text-xs uppercase tracking-wide">
      <Lightbulb className="w-3.5 h-3.5" />
      CA Guidance — What Banks Verify in Expenses
    </div>
    {tips.map((tip, i) => <p key={i} className="text-xs text-amber-700">• {tip}</p>)}
  </div>
);

type SalaryCategory = "skilled" | "semi_skilled" | "wages";

const SALARY_CONFIG: Record<SalaryCategory, { label: string; countLabel: string; countKey: keyof GTABFormData; salaryKey: keyof GTABFormData }> = {
  skilled:     { label: "Skilled Workers",          countLabel: "No. of Skilled Workers",         countKey: "skilled_workers_count",      salaryKey: "skilled_workers_salary" },
  semi_skilled:{ label: "Semi-Skilled Workers",     countLabel: "No. of Semi-Skilled Workers",    countKey: "semi_skilled_workers_count",  salaryKey: "semi_skilled_workers_salary" },
  wages:       { label: "Daily Wage / Unskilled",   countLabel: "No. of Daily Wage Workers",      countKey: "wages_count",                salaryKey: "wages_salary" },
};

const MonthlyExpensesStep = ({ formData, updateFormData }: MonthlyExpensesStepProps) => {
  const isTrading     = formData.industry_type === "trading";
  const isService     = formData.industry_type === "service";
  const isAgriculture = formData.industry_type === "agriculture";

  // ── Salary calculations — from actual inputs, no hardcodes ──────────────────
  const skilledTotal    = Number(formData.skilled_workers_count || 0) * Number(formData.skilled_workers_salary || 0);
  const semiTotal       = Number(formData.semi_skilled_workers_count || 0) * Number(formData.semi_skilled_workers_salary || 0);
  const wagesTotal      = Number(formData.wages_count || 0) * Number(formData.wages_salary || 0);
  const structuredTotal = skilledTotal + semiTotal + wagesTotal;
  const legacyTotal     = Number(formData.employee_count || 0) * Number(formData.salary_per_employee || 0);
  const totalSalary     = structuredTotal || legacyTotal;
  const totalEmployees  = Number(formData.skilled_workers_count || 0) + Number(formData.semi_skilled_workers_count || 0) + Number(formData.wages_count || 0);
  const avgSalaryPerEmp = totalEmployees > 0 ? Math.round(totalSalary / totalEmployees) : 0;

  // ── Total monthly expenses — all from form data ─────────────────────────────
  const rawMat    = Number(formData.raw_material_cost       || 0);
  const stationery= Number(formData.stationery_cost         || 0);
  const elec      = Number(formData.electricity_water_cost  || 0);
  const repair    = Number(formData.repair_maintenance_cost  || 0);
  const transport = Number(formData.transport_cost           || 0);
  const telecom   = Number(formData.telephone_internet_cost  || 0);
  const mktg      = Number(formData.marketing_cost           || 0);
  const misc      = Number(formData.miscellaneous_cost       || 0);
  const rent      = Number(formData.monthly_rent             || 0);
  const totalMonthlyExpenses = rent + totalSalary + rawMat + stationery + elec + repair + transport + telecom + mktg + misc;
  const annualExpenses = totalMonthlyExpenses * 12;

  // ── CA COGS ratio check ─────────────────────────────────────────────────────
  // CA norms: Manufacturing 55%, Trading 70%, Service 10% of revenue
  const expectedMonthlyRev = Number(formData.expected_monthly_revenue || 0);
  const cogsPct = expectedMonthlyRev > 0 ? Math.round((rawMat / expectedMonthlyRev) * 100) : 0;
  const caCogsNorm = isTrading ? 70 : isService ? 10 : 55;
  const cogsOk = cogsPct === 0 || (cogsPct >= caCogsNorm - 15 && cogsPct <= caCogsNorm + 15);
  const salaryPct = expectedMonthlyRev > 0 ? Math.round((totalSalary / expectedMonthlyRev) * 100) : 0;

  // ── Sync totals to formData so downstream steps have correct values ─────────
  useEffect(() => {
    const updates: Partial<GTABFormData> = {};
    if (formData.total_monthly_salary !== totalSalary) updates.total_monthly_salary = totalSalary;
    if (totalEmployees > 0 && formData.employee_count !== totalEmployees) updates.employee_count = totalEmployees;
    if (Object.keys(updates).length > 0) updateFormData(updates);
  }, [formData.skilled_workers_count, formData.skilled_workers_salary,
      formData.semi_skilled_workers_count, formData.semi_skilled_workers_salary,
      formData.wages_count, formData.wages_salary]);

  // ── CA tips — industry + scheme + live ratio aware ─────────────────────────
  const caTips = [
    ...getStep7Tips({
      industry: formData.industry_type || "manufacturing",
      scheme: formData.loan_scheme || "normal_msme",
      expectedMonthlyRevenue: expectedMonthlyRev,
      totalMonthlyExpenses,
    }),
    totalMonthlyExpenses > 0
      ? `Total Monthly Expenses: ${fmt(totalMonthlyExpenses)} → Annual: ${fmt(annualExpenses)}. EBITDA = Revenue − these expenses (before Dep & Interest). This flows directly into the P&L in your bank report.`
      : "Fill in all monthly expenses above to see your projected annual outflow and EBITDA.",
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-none space-y-4 sm:space-y-6">
      <Card className="gtab-card-light rounded-[0.9rem] border shadow-sm sm:rounded-2xl">
        <CardContent className="space-y-5 p-4 sm:space-y-7 sm:p-8">

          <CASuggestionTip advisories={[adviseOpexToRevenue(formData)]} onApply={updateFormData} />

          {/* ── Rent ─────────────────────────────────────────────────────────── */}
          <SectionTitle icon={Users} title="Fixed Monthly Costs — Rent & Salary"
            subtitle="These are FIXED costs. They appear in P&L every month regardless of production level." />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            <CurrencyInput
              label="Monthly Rent / Lease (₹)"
              value={formData.monthly_rent}
              onChange={(v) => updateFormData({ monthly_rent: v })}
              hint="Actual monthly rent as per agreement. Zero if owned premises."
            />
          </div>

          {/* ── Manpower / Salary ───────────────────────────────────────────── */}
          <div className="space-y-4">
            <p className="text-sm font-medium text-muted-foreground">
              Monthly Salary Outflow — Enter each worker category separately.
              The bank computes total annual wage bill = monthly total × 12.
            </p>

            {(["skilled", "semi_skilled", "wages"] as SalaryCategory[]).map((type) => {
              const cfg   = SALARY_CONFIG[type];
              const count = Number(formData[cfg.countKey] || 0);
              const sal   = Number(formData[cfg.salaryKey] || 0);
              const total = count * sal;
              return (
                <div key={type} className="grid grid-cols-1 gap-4 rounded-xl border bg-muted/20 p-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Worker Category</Label>
                    <Select value={type} onValueChange={() => {}}>
                      <SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skilled">Skilled Workers (Operators/Technicians)</SelectItem>
                        <SelectItem value="semi_skilled">Semi-Skilled Workers (Helpers)</SelectItem>
                        <SelectItem value="wages">Daily Wage / Unskilled Workers</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{cfg.label}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>{cfg.countLabel}</Label>
                    <Input type="number" className="h-12 rounded-xl" value={count || ""}
                      onChange={(e) => updateFormData({ [cfg.countKey]: parseInt(e.target.value) || 0 } as Partial<GTABFormData>)}
                      placeholder="0" min={0} />
                  </div>
                  <div className="space-y-2">
                    <Label>Monthly Salary per Worker (₹)</Label>
                    <Input type="number" className="h-12 rounded-xl" value={sal || ""}
                      onChange={(e) => updateFormData({ [cfg.salaryKey]: parseFloat(e.target.value) || 0 } as Partial<GTABFormData>)}
                      placeholder="₹ 0" min={0} />
                    {total > 0 && <p className="text-xs text-primary font-medium">{count} × {fmt(sal)} = {fmt(total)}/month</p>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Salary summary */}
          {totalSalary > 0 && (
            <div className="rounded-xl bg-primary/10 border border-primary/20 p-4 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Total Monthly Salary Outflow</span>
                <span className="text-lg font-bold text-primary">{fmt(totalSalary)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {totalEmployees} workers · Avg {fmt(avgSalaryPerEmp)}/worker · Annual wage bill: {fmt(totalSalary * 12)}
              </p>
              {salaryPct > 0 && (
                <p className={`text-xs font-medium ${salaryPct > 35 ? "text-amber-600" : "text-emerald-600"}`}>
                  Salary/Revenue ratio: {salaryPct}% {salaryPct > 35 ? "⚠ High — bank may flag. Target < 30%." : "✓ Within acceptable range."}
                </p>
              )}
            </div>
          )}

          <div className="border-t" />

          {/* ── Variable / Operating Expenses ──────────────────────────────── */}
          <SectionTitle icon={Activity} title="Variable & Operating Monthly Expenses"
            subtitle="These scale with business activity. Enter MONTHLY amounts. Backend multiplies by 12 for annual P&L." />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            <CurrencyInput
              label={isTrading ? "Monthly Purchase / Inventory Cost — COGS (₹)" : isService ? "Monthly Consumables / Direct Costs (₹)" : isAgriculture ? "Monthly Farm Inputs — Seeds/Fertiliser (₹)" : "Monthly Raw Material Cost — COGS (₹)"}
              value={formData.raw_material_cost}
              onChange={(v) => updateFormData({ raw_material_cost: v })}
              hint={`CA norm: ~${caCogsNorm}% of monthly revenue. ${cogsPct > 0 ? `Your ratio: ${cogsPct}%.` : ""}`}
            />
            <CurrencyInput
              label="Stationery / Office Supplies (₹)"
              value={formData.stationery_cost}
              onChange={(v) => updateFormData({ stationery_cost: v })}
              hint="Paper, pens, printed forms, consumables"
            />
            <CurrencyInput
              label="Electricity & Water Charges (₹)"
              value={formData.electricity_water_cost}
              onChange={(v) => updateFormData({ electricity_water_cost: v })}
              hint="Actual or estimated monthly EB bill. CA standard: variable with production."
            />
            <CurrencyInput
              label="Repair & Maintenance (₹)"
              value={formData.repair_maintenance_cost}
              onChange={(v) => updateFormData({ repair_maintenance_cost: v })}
              hint="Machine service, building upkeep. Typically 1-2% of asset value p.a."
            />
            <CurrencyInput
              label={isAgriculture ? "Transport / Distribution Cost (₹)" : "Transport & Conveyance (₹)"}
              value={formData.transport_cost}
              onChange={(v) => updateFormData({ transport_cost: v })}
            />
            <CurrencyInput
              label={isService ? "Telephone / Internet / Software Subscription (₹)" : "Telephone & Internet (₹)"}
              value={formData.telephone_internet_cost}
              onChange={(v) => updateFormData({ telephone_internet_cost: v })}
            />
            <CurrencyInput
              label="Marketing & Advertising (₹)"
              value={formData.marketing_cost}
              onChange={(v) => updateFormData({ marketing_cost: v })}
              hint="Pamphlets, digital ads, promotions. CA shows this as % of revenue."
            />
            <CurrencyInput
              label={isService ? "Professional Fees / Other Expenses (₹)" : "Miscellaneous Expenses (₹)"}
              value={formData.miscellaneous_cost}
              onChange={(v) => updateFormData({ miscellaneous_cost: v })}
              hint="Any other monthly running costs not covered above"
            />
          </div>

          {/* CA AI Tips */}
          <CATip tips={caTips} />

          <div className="border-t" />

          {/* ── Live Monthly Expense Summary ────────────────────────────────── */}
          <SectionTitle icon={Wallet} title="Monthly Expense Summary"
            subtitle="This flows directly into the 5-year P&L in the bank report." />

          <div className="rounded-xl bg-gradient-to-br from-[#0f1f35] to-[#1a3a5c] border border-primary/30 p-5 space-y-3">
            {[
              { label: "Rent (Fixed)", value: rent },
              { label: "Salary & Wages (Fixed)", value: totalSalary },
              { label: isTrading ? "Purchase / COGS (Variable)" : "Raw Material / COGS (Variable)", value: rawMat },
              { label: "Electricity & Water (Variable)", value: elec },
              { label: "Stationery (Variable)", value: stationery },
              { label: "Repair & Maintenance", value: repair },
              { label: "Transport & Conveyance", value: transport },
              { label: "Telephone & Internet", value: telecom },
              { label: "Marketing & Advertising (Variable)", value: mktg },
              { label: "Miscellaneous", value: misc },
            ].filter(r => r.value > 0).map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center py-1 border-b border-white/10">
                <span className="text-sm text-slate-300">{label}</span>
                <span className="text-sm font-semibold text-white tabular-nums">{fmt(value)}</span>
              </div>
            ))}

            <div className="flex justify-between items-center pt-2 border-t border-primary/40">
              <div>
                <p className="text-xs text-slate-400">TOTAL MONTHLY EXPENSES</p>
                <p className="text-xs text-slate-400 mt-0.5">Annual (× 12)</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-extrabold text-primary tabular-nums">{fmt(totalMonthlyExpenses)}</p>
                <p className="text-sm font-semibold text-slate-300 tabular-nums">{fmt(annualExpenses)}</p>
              </div>
            </div>

            {expectedMonthlyRev > 0 && totalMonthlyExpenses > 0 && (
              <div className="rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300 space-y-0.5">
                <p>Estimated Monthly EBITDA (before Dep & Interest): <strong className={expectedMonthlyRev - totalMonthlyExpenses > 0 ? "text-emerald-400" : "text-red-400"}>{fmt(expectedMonthlyRev - totalMonthlyExpenses)}</strong></p>
                <p className="text-slate-400">Based on expected monthly revenue of {fmt(expectedMonthlyRev)} (set in Step 4 — Business Profile)</p>
              </div>
            )}
          </div>

        </CardContent>
      </Card>
    </div>
  );
};

export default MonthlyExpensesStep;
