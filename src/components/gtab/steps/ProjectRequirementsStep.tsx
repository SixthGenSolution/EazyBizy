import { useEffect } from "react";
import { Plus, Trash2, Wrench, Building, Calculator, IndianRupee, Lightbulb, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GTABFormData, MachineryItem, EQUIPMENT_SUGGESTIONS, BUILDING_COST_HINTS } from "@/types/gtab";
import DynamicIndustryFields from "@/components/gtab/fields/DynamicIndustryFields";
import { getStep5Tips } from "@/lib/caGuidance";
import { getFinancingPlan } from "@/lib/projectReport";
import { numberToWords } from "@/lib/numberToWords";
import { CASuggestionTip } from "@/components/gtab/CASuggestionTip";
import { adviseProjectCostCeiling, adviseLandBuildingShare, advisePromoterMargin } from "@/lib/caAdvisory";
import SectionTitle from "@/components/gtab/SectionTitle";

// ── Format helpers ─────────────────────────────────────────────────────────────
const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

// ── CA AI Tip component ────────────────────────────────────────────────────────
const CATip = ({ tips }: { tips: string[] }) => (
  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1.5">
    <div className="flex items-center gap-2 text-amber-800 font-semibold text-xs uppercase tracking-wide">
      <Lightbulb className="w-3.5 h-3.5" />
      CA Guidance — What Banks Look For
    </div>
    {tips.map((tip, i) => (
      <p key={i} className="text-xs text-amber-700">• {tip}</p>
    ))}
  </div>
);

interface ProjectRequirementsStepProps {
  formData: GTABFormData;
  updateFormData: (updates: Partial<GTABFormData>) => void;
}

const CurrencyInput = ({
  label,
  value,
  onChange,
  placeholder = "₹ 0",
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  hint?: string;
}) => {
  const words = value > 0 ? numberToWords(value) : "";
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        className="h-12 rounded-xl"
        value={value || ""}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        placeholder={placeholder}
        min={0}
      />
      {words && (
        <p className="text-xs font-medium text-primary/80">
          ₹ {words}
        </p>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
};

const itemCost = (m: MachineryItem) => {
  if (m.machine_cost !== undefined || m.installation_cost !== undefined || m.other_capital_cost !== undefined) {
    return Number(m.machine_cost ?? (Number(m.quantity || 1) * Number(m.unit_cost || 0)))
      + Number(m.installation_cost || 0)
      + Number(m.other_capital_cost || 0);
  }
  if (m.total_cost !== undefined) return Number(m.total_cost) || 0;
  return Number(m.cost) || Number(m.quantity || 1) * Number(m.unit_cost || 0);
};
const sumItems = (items: MachineryItem[]) => (items || []).reduce((s, m) => s + itemCost(m), 0);

const CostBreakdownFields = ({
  machineCost,
  installationCost,
  otherCapitalCost,
  totalCost,
  onChange,
}: {
  machineCost: number;
  installationCost: number;
  otherCapitalCost: number;
  totalCost: number;
  onChange: (field: "machine_cost" | "installation_cost" | "other_capital_cost", value: number) => void;
}) => (
  <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
    <div className="space-y-1.5">
      <Label>Machine Cost (₹) *</Label>
      <Input type="number" className="h-11 rounded-xl" value={machineCost || ""} min={0}
        onChange={(e) => onChange("machine_cost", Number(e.target.value) || 0)} />
    </div>
    <span className="hidden pb-3 text-lg md:block">+</span>
    <div className="space-y-1.5">
      <Label>Installation Cost (₹) *</Label>
      <Input type="number" className="h-11 rounded-xl" value={installationCost || ""} min={0}
        onChange={(e) => onChange("installation_cost", Number(e.target.value) || 0)} />
    </div>
    <span className="hidden pb-3 text-lg md:block">+</span>
    <div className="space-y-1.5">
      <Label>Other Capital Cost (₹) *</Label>
      <Input type="number" className="h-11 rounded-xl" value={otherCapitalCost || ""} min={0}
        onChange={(e) => onChange("other_capital_cost", Number(e.target.value) || 0)} />
    </div>
    <span className="hidden pb-3 text-lg md:block">=</span>
    <div className="space-y-1.5">
      <Label>Total Cost (₹)</Label>
      <Input type="number" className="h-11 rounded-xl bg-muted" value={totalCost || ""} readOnly />
    </div>
  </div>
);

/** Itemized "add as many as you need" list — name, qty, unit price, purchase date, supplier per row. */
const CostItemList = ({
  items,
  onChange,
  addLabel,
  namePlaceholder,
}: {
  items: MachineryItem[];
  onChange: (items: MachineryItem[]) => void;
  addLabel: string;
  namePlaceholder: string;
}) => {
  const total = sumItems(items);

  const addItem = () => {
    const newId = crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    onChange([
      ...items,
      { id: newId, machine_name: "", cost: 0, machine_cost: 0, installation_cost: 0, other_capital_cost: 0, total_cost: 0, quantity: 1, unit_cost: 0, purchase_date: "", supplier_name: "", supplier_city: "", supplier_phone: "", supplier_email: "" },
    ]);
  };
  const updateItem = (id: string, updates: Partial<MachineryItem>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  };
  const updateBreakdown = (id: string, field: "machine_cost" | "installation_cost" | "other_capital_cost", value: number) => {
    onChange(items.map((item) => {
      if (item.id !== id) return item;
      const machineCost = field === "machine_cost"
        ? value
        : Number(item.machine_cost ?? (Number(item.quantity || 1) * Number(item.unit_cost || 0)));
      const installationCost = field === "installation_cost" ? value : Number(item.installation_cost || 0);
      const otherCapitalCost = field === "other_capital_cost" ? value : Number(item.other_capital_cost || 0);
      const totalCost = machineCost + installationCost + otherCapitalCost;
      return { ...item, [field]: value, total_cost: totalCost, cost: totalCost };
    }));
  };
  const removeItem = (id: string) => {
    onChange(items.filter((item) => item.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {items.length === 0 ? "No items added yet. Click Add to start." : `${items.length} item(s) · Total: ${fmt(total)}`}
        </p>
        <Button type="button" variant="outline" onClick={addItem} className="gap-2 border-primary/40 text-primary hover:bg-primary/10">
          <Plus className="w-4 h-4" />
          {addLabel}
        </Button>
      </div>

      {items.length === 0 && (
        <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Click "{addLabel}" to add your first item.
        </div>
      )}

      {items.map((item, index) => {
        const cost = itemCost(item);
        return (
          <div key={item.id} className="rounded-xl border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">
                Item #{index + 1}
                {cost > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">{fmt(cost)}</span>}
              </span>
              <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-destructive hover:bg-destructive/10 text-xs" onClick={() => removeItem(item.id)}>
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              <div className="space-y-1.5 md:col-span-2">
                <Label>Item Name *</Label>
                <Input className="h-11 rounded-xl" value={item.machine_name}
                  onChange={(e) => updateItem(item.id, { machine_name: e.target.value })}
                  placeholder={namePlaceholder} />
              </div>
              <div className="space-y-1.5">
                <Label>Quantity (Nos.)</Label>
                <Input type="number" className="h-11 rounded-xl" value={item.quantity || 1} min={1}
                  onChange={(e) => {
                    const qty = Number(e.target.value) || 1;
                    const uc = Number(item.unit_cost || 0);
                    const machineCost = qty * uc;
                    const totalCost = machineCost + Number(item.installation_cost || 0) + Number(item.other_capital_cost || 0);
                    updateItem(item.id, { quantity: qty, unit_cost: uc, machine_cost: machineCost, total_cost: totalCost, cost: totalCost });
                  }} />
              </div>
              <div className="space-y-1.5">
                <Label>Unit Price (₹) *</Label>
                <Input type="number" className="h-11 rounded-xl" value={item.unit_cost || ""} placeholder="₹ 0"
                  onChange={(e) => {
                    const uc = parseFloat(e.target.value) || 0;
                    const qty = item.quantity || 1;
                    const machineCost = qty * uc;
                    const totalCost = machineCost + Number(item.installation_cost || 0) + Number(item.other_capital_cost || 0);
                    updateItem(item.id, { unit_cost: uc, machine_cost: machineCost, total_cost: totalCost, cost: totalCost });
                  }} />
              </div>
              <div className="space-y-1.5">
                <Label>Date of Purchase</Label>
                <DatePicker
                  className="h-11 rounded-xl"
                  value={item.purchase_date || ""}
                  onChange={(v) => updateItem(item.id, { purchase_date: v })}
                  placeholder="Select date"
                  disableFuture
                />
              </div>
            </div>

            {cost > 0 && <div className="text-xs text-muted-foreground">Total for this item: <strong>{fmt(cost)}</strong></div>}

            {(() => {
              const machineCost = Number(item.machine_cost ?? (Number(item.quantity || 1) * Number(item.unit_cost || 0)));
              const installationCost = Number(item.installation_cost || 0);
              const otherCapitalCost = Number(item.other_capital_cost || 0);
              const totalCost = machineCost + installationCost + otherCapitalCost;
              return (
                <CostBreakdownFields
                  machineCost={machineCost}
                  installationCost={installationCost}
                  otherCapitalCost={otherCapitalCost}
                  totalCost={totalCost}
                  onChange={(field, value) => updateBreakdown(item.id, field, value)}
                />
              );
            })()}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Supplier / Vendor Name</Label>
                <Input className="h-11 rounded-xl" value={item.supplier_name}
                  onChange={(e) => updateItem(item.id, { supplier_name: e.target.value })}
                  placeholder="Supplier name" />
              </div>
              <div className="space-y-1.5">
                <Label>Supplier City</Label>
                <Input className="h-11 rounded-xl" value={item.supplier_city || ""}
                  onChange={(e) => updateItem(item.id, { supplier_city: e.target.value })}
                  placeholder="City" />
              </div>
              <div className="space-y-1.5">
                <Label>Supplier Phone</Label>
                <Input className="h-11 rounded-xl" value={item.supplier_phone}
                  onChange={(e) => updateItem(item.id, { supplier_phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                  placeholder="10-digit mobile" />
              </div>
              <div className="space-y-1.5">
                <Label>Supplier Email</Label>
                <Input type="email" className="h-11 rounded-xl" value={item.supplier_email}
                  onChange={(e) => updateItem(item.id, { supplier_email: e.target.value })}
                  placeholder="supplier@email.com" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const ProjectRequirementsStep = ({ formData, updateFormData }: ProjectRequirementsStepProps) => {
  const isTrading      = formData.industry_type === "trading";
  const isService      = formData.industry_type === "service";
  const isAgriculture  = formData.industry_type === "agriculture";
  const isManufacturing= formData.industry_type === "manufacturing";
  const isPMEGP        = formData.loan_scheme === "pmegp";

  const pri = formData.project_report_inputs;
  const capexItems = pri?.capex_items ?? { computers: [], furniture: [], electrification: [], racks_storage: [], transportation: [] };

  const updateCapexItems = (category: keyof typeof capexItems, items: MachineryItem[]) => {
    updateFormData({
      project_report_inputs: {
        ...pri,
        capex_items: { ...capexItems, [category]: items },
      },
    });
  };

  // ── Live cost calculations (all from actual form data — no hardcodes) ────────
  const landCost         = Number(formData.land_cost            || 0);
  const buildingCost     = Number(formData.shed_building_cost   || 0);
  const machineryTotal   = sumItems(formData.plant_machinery || []);
  // These 5 categories are itemized — their totals are always derived live from
  // capex_items, not read from the (possibly one-render-stale) scalar fields.
  const computersCost    = sumItems(capexItems.computers);
  const furnitureCost    = sumItems(capexItems.furniture);
  const electrification  = sumItems(capexItems.electrification);
  const racksCost        = sumItems(capexItems.racks_storage);
  const transportCost    = sumItems(capexItems.transportation);
  const installCost      = Number(formData.machinery_installation_cost || 0);
  const otherCost        = Number(formData.other_initial_expenditure || 0);
  const preliminaryTotal = computersCost + furnitureCost + electrification + racksCost + transportCost + installCost + otherCost;
  const fixedCapital     = landCost + buildingCost + machineryTotal + preliminaryTotal;

  // Use getFinancingPlan for ALL financing numbers — scheme-aware, no hardcodes.
  // Patch in the live itemized totals so this render never uses a stale scalar.
  const plan = getFinancingPlan({
    ...formData,
    computers_cost: computersCost,
    furniture_cost: furnitureCost,
    electrification_cost: electrification,
    racks_storage_cost: racksCost,
    transportation_cost: transportCost,
  });
  const totalProjectCost   = plan.totalProjectCost || fixedCapital;
  const termLoanAmount     = plan.termLoanAmount;
  const wcLoan             = plan.workingCapitalLoan;
  const promoterEquity     = plan.promoterContribution;
  const promoterPct        = plan.promoterEquityPct;
  const totalBankFinance   = plan.totalBankFinance;
  const tlBankPct          = plan.termLoanBankFinancePct;

  // Margin money only applies to PMEGP — computed as residual after equity + term loan
  const marginMoney = isPMEGP
    ? Math.max(totalProjectCost - promoterEquity - termLoanAmount - wcLoan, 0)
    : 0;

  // ── Sync computed totals back to formData so Step 6 & 8 (and the backend
  // report pipeline, which reads these scalars directly) always have latest ──
  useEffect(() => {
    const updates: Partial<GTABFormData> = {};
    if (formData.total_project_cost !== totalProjectCost) {
      updates.total_project_cost = totalProjectCost;
    }
    const eligibleLoan = Math.round(totalBankFinance);
    if (formData.eligible_loan_amount !== eligibleLoan) {
      updates.eligible_loan_amount = eligibleLoan;
    }
    if (formData.computers_cost !== computersCost) updates.computers_cost = computersCost;
    if (formData.furniture_cost !== furnitureCost) updates.furniture_cost = furnitureCost;
    if (formData.electrification_cost !== electrification) updates.electrification_cost = electrification;
    if (formData.racks_storage_cost !== racksCost) updates.racks_storage_cost = racksCost;
    if (formData.transportation_cost !== transportCost) updates.transportation_cost = transportCost;
    if (Object.keys(updates).length > 0) updateFormData(updates);
  }, [totalProjectCost, totalBankFinance, computersCost, furnitureCost, electrification, racksCost, transportCost]);

  // ── Machinery handlers ─────────────────────────────────────────────────────
  const addMachineryItem = () => {
    const newId = crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    const newItem: MachineryItem = {
      id: newId, machine_name: "", cost: 0, machine_cost: 0, installation_cost: 0, other_capital_cost: 0, total_cost: 0, quantity: 1, unit_cost: 0, purchase_date: "",
      supplier_name: "", supplier_city: "", supplier_phone: "", supplier_email: "",
    };
    updateFormData({ plant_machinery: [...(formData.plant_machinery || []), newItem] });
  };

  const updateMachineryItem = (id: string, updates: Partial<MachineryItem>) => {
    updateFormData({
      plant_machinery: (formData.plant_machinery || []).map((item) =>
        item.id === id ? { ...item, ...updates } : item
      ),
    });
  };

  const removeMachineryItem = (id: string) => {
    updateFormData({
      plant_machinery: (formData.plant_machinery || []).filter((item) => item.id !== id),
    });
  };

  // ── CA tips — scheme & industry aware (from caGuidance engine) ───────────
  const caTips = [
    ...getStep5Tips({
      industry: formData.industry_type || "manufacturing",
      scheme: formData.loan_scheme || "normal_msme",
      projectCost: totalProjectCost,
      loanAmount: termLoanAmount,
    }),
    totalProjectCost > 0 && termLoanAmount > 0
      ? `Financing split: Term Loan ${fmt(termLoanAmount)} (${pct(tlBankPct)} of Fixed Capital) + Promoter Equity ${fmt(promoterEquity)}. Working Capital is funded separately.`
      : "Fill in your project costs above to see the exact financing split.",
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-none space-y-4 sm:space-y-8">

      <Card className="gtab-card-light rounded-[0.9rem] border shadow-sm sm:rounded-2xl">
        <CardContent className="space-y-6 p-4 sm:space-y-10 sm:p-8">

          <CASuggestionTip
            advisories={[adviseProjectCostCeiling(formData), adviseLandBuildingShare(formData), advisePromoterMargin(formData)]}
            onApply={updateFormData}
          />

          {/* ── Business Projections ────────────────────────────────────────── */}
          <SectionTitle
            icon={TrendingUp}
            title="Business Projections"
            subtitle="Expected financial and employment projections"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            <div className="space-y-2">
              <Label>Expected Monthly Revenue (₹)</Label>
              <Input
                type="number"
                className="h-12 rounded-xl"
                value={formData.expected_monthly_revenue || ""}
                onChange={(e) => updateFormData({ expected_monthly_revenue: Number(e.target.value) || 0 })}
                placeholder="e.g., 500000"
                min={0}
              />
              {formData.expected_monthly_revenue > 0 && (
                <p className="text-xs font-medium text-primary/80">₹ {numberToWords(formData.expected_monthly_revenue)}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Expected Direct Employment</Label>
              <Input
                type="number"
                className="h-12 rounded-xl"
                value={formData.expected_employment || ""}
                onChange={(e) => updateFormData({ expected_employment: Number(e.target.value) || 0 })}
                placeholder="e.g., 10"
                min={0}
              />
            </div>
          </div>

          <div className="border-t" />

          {/* ── Fixed Capital (Infrastructure) ─────────────────────────────── */}
          <SectionTitle
            icon={Building}
            title={isTrading ? "Shop / Store Setup Costs" : isService ? "Office / Outlet Setup Costs" : isAgriculture ? "Farm & Storage Infrastructure" : "Fixed Capital — Infrastructure"}
            subtitle={isManufacturing ? "Land, building/shed. Actual construction or purchase cost from approved valuer." : "Setup and renovation cost for your business premises."}
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            {isManufacturing && (
              <CurrencyInput
                label="Land Cost (₹)"
                value={formData.land_cost}
                onChange={(v) => updateFormData({ land_cost: v })}
                hint="Market value / registered value from sale deed"
              />
            )}
            <div className="space-y-2">
              <CurrencyInput
                label={isTrading ? "Shop Setup / Renovation Cost (₹)" : isService ? "Office Rent Deposit (₹)" : isAgriculture ? "Farm Shed / Storage Construction (₹)" : "Factory Shed / Building Cost (₹)"}
                value={formData.shed_building_cost}
                onChange={(v) => updateFormData({ shed_building_cost: v })}
                hint={isManufacturing ? "Construction cost @ prevailing rate per sq.ft × built-up area" : isService ? "Advance rent / security deposit paid to the landlord before occupying the premises" : "Actual renovation/setup quotation amount"}
              />
              {(() => {
                const hint = BUILDING_COST_HINTS[formData.industry_type || "manufacturing"];
                if (!hint) return null;
                return (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 flex gap-2 items-start">
                    <Lightbulb className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-700">
                      <span className="font-semibold">CA norm:</span> Typical range Rs.{Math.round(hint.min / 1000)}K–{Math.round(hint.max / 1000)}K — {hint.note}
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="border-t" />

          {/* ── Plant & Machinery / Equipment ──────────────────────────────── */}
          <SectionTitle
            icon={Wrench}
            title={isTrading ? "Trading Assets & Equipment" : isService ? "Service Equipment & Tools" : isAgriculture ? "Farm Machinery & Equipment" : "Plant & Machinery / Equipment"}
            subtitle="Add each item separately — name, quantity, unit price and supplier details. Bank verifies these against quotations."
          />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {(formData.plant_machinery || []).length === 0
                  ? "No items added yet. Click Add to start."
                  : `${(formData.plant_machinery || []).length} item(s) · Total: ${fmt(machineryTotal)}`}
              </p>
              <Button type="button" variant="outline" onClick={addMachineryItem} className="gap-2 border-primary/40 text-primary hover:bg-primary/10">
                <Plus className="w-4 h-4" />
                {isTrading || isService ? "Add Asset / Equipment" : isAgriculture ? "Add Farm Equipment" : "Add Machinery"}
              </Button>
            </div>

            {(formData.plant_machinery || []).length === 0 && (
              <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                Add each {isManufacturing ? "machine" : "asset"} as a separate line item with supplier details.<br />
                <span className="text-xs">Use AI Suggestions below or click "Add" to start.</span>
              </div>
            )}

            {/* AI Equipment Suggestions panel */}
            {(() => {
              const bizType = formData.type_of_business || '';
              const suggestions = EQUIPMENT_SUGGESTIONS[bizType] || [];
              if (suggestions.length === 0) return null;
              return (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-semibold text-blue-800">
                      AI Equipment Suggestions (CA norms) — click to add
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((s) => {
                      const alreadyAdded = (formData.plant_machinery || []).some(m => m.machine_name === s.machine_name);
                      return (
                        <button
                          key={s.machine_name}
                          type="button"
                          disabled={alreadyAdded}
                          onClick={() => {
                            const newId = crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
                            updateFormData({
                              plant_machinery: [
                                ...(formData.plant_machinery || []),
                                {
                                  id: newId,
                                  machine_name: s.machine_name,
                                  quantity: s.quantity,
                                  unit_cost: s.unit_cost,
                                  cost: s.quantity * s.unit_cost,
                                  machine_cost: s.quantity * s.unit_cost,
                                  installation_cost: 0,
                                  other_capital_cost: 0,
                                  total_cost: s.quantity * s.unit_cost,
                                  purchase_date: '',
                                  supplier_name: '',
                                  supplier_city: '',
                                  supplier_phone: '',
                                  supplier_email: '',
                                },
                              ],
                            });
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                            alreadyAdded
                              ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                              : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-100 cursor-pointer'
                          }`}
                        >
                          {alreadyAdded ? '✓ ' : '+ '}{s.machine_name} @ {fmt(s.unit_cost)} × {s.quantity}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-blue-600">Typical market prices — edit each item after adding. Bank requires quotations for items above Rs. 50,000.</p>
                </div>
              );
            })()}

            {(formData.plant_machinery || []).map((item, index) => {
              const machineCost = Number(item.machine_cost ?? item.cost ?? (Number(item.quantity || 1) * Number(item.unit_cost || 0)));
              const installationCost = Number(item.installation_cost || 0);
              const otherCapitalCost = Number(item.other_capital_cost || 0);
              const totalCost = machineCost + installationCost + otherCapitalCost;
              return (
                <div key={item.id} className="rounded-xl border bg-card p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">
                      Item #{index + 1}
                      {totalCost > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">{fmt(totalCost)}</span>}
                    </span>
                    <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-destructive hover:bg-destructive/10 text-xs" onClick={() => removeMachineryItem(item.id)}>
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </Button>
                  </div>

                  {/* Name + Qty + Unit Price → auto-computes Total */}
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                    <div className="space-y-1.5 md:col-span-2">
                      <Label>Item / Asset Name *</Label>
                      <Input className="h-11 rounded-xl" value={item.machine_name}
                        onChange={(e) => updateMachineryItem(item.id, { machine_name: e.target.value })}
                        placeholder={isManufacturing ? "e.g. Flour Mill Machine" : "e.g. Billing Counter / Laptop"} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Quantity (Nos.)</Label>
                      <Input type="number" className="h-11 rounded-xl" value={item.quantity || 1} min={1}
                        onChange={(e) => {
                          const qty = Number(e.target.value) || 1;
                          const uc = Number(item.unit_cost || item.cost || 0);
                          const nextMachineCost = qty * uc;
                          updateMachineryItem(item.id, {
                            quantity: qty,
                            unit_cost: uc,
                            machine_cost: nextMachineCost,
                            total_cost: nextMachineCost + installationCost + otherCapitalCost,
                            cost: nextMachineCost + installationCost + otherCapitalCost,
                          });
                        }} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Unit Price (₹) *</Label>
                      <Input type="number" className="h-11 rounded-xl" value={item.unit_cost || item.cost || ""} placeholder="₹ 0"
                        onChange={(e) => {
                          const uc = parseFloat(e.target.value) || 0;
                          const qty = item.quantity || 1;
                          const nextMachineCost = qty * uc;
                          updateMachineryItem(item.id, {
                            unit_cost: uc,
                            machine_cost: nextMachineCost,
                            total_cost: nextMachineCost + installationCost + otherCapitalCost,
                            cost: nextMachineCost + installationCost + otherCapitalCost,
                          });
                        }} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Date of Purchase</Label>
                      <DatePicker
                        className="h-11 rounded-xl"
                        value={item.purchase_date || ""}
                        onChange={(v) => updateMachineryItem(item.id, { purchase_date: v })}
                        placeholder="Select date"
                        disableFuture
                      />
                    </div>
                  </div>
                  {/* Auto-computed total shown when both qty and price entered */}
                  <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
                    <div className="space-y-1.5">
                      <Label>Machine Cost (₹) *</Label>
                      <Input type="number" className="h-11 rounded-xl" value={machineCost || ""} min={0}
                        onChange={(e) => {
                          const nextMachineCost = Number(e.target.value) || 0;
                          updateMachineryItem(item.id, {
                            machine_cost: nextMachineCost,
                            total_cost: nextMachineCost + installationCost + otherCapitalCost,
                            cost: nextMachineCost + installationCost + otherCapitalCost,
                          });
                        }} />
                    </div>
                    <span className="hidden pb-3 text-lg md:block">+</span>
                    <div className="space-y-1.5">
                      <Label>Installation Cost (₹) *</Label>
                      <Input type="number" className="h-11 rounded-xl" value={installationCost || ""} min={0}
                        onChange={(e) => {
                          const nextInstallationCost = Number(e.target.value) || 0;
                          updateMachineryItem(item.id, {
                            installation_cost: nextInstallationCost,
                            total_cost: machineCost + nextInstallationCost + otherCapitalCost,
                            cost: machineCost + nextInstallationCost + otherCapitalCost,
                          });
                        }} />
                    </div>
                    <span className="hidden pb-3 text-lg md:block">+</span>
                    <div className="space-y-1.5">
                      <Label>Other Capital Cost (₹) *</Label>
                      <Input type="number" className="h-11 rounded-xl" value={otherCapitalCost || ""} min={0}
                        onChange={(e) => {
                          const nextOtherCapitalCost = Number(e.target.value) || 0;
                          updateMachineryItem(item.id, {
                            other_capital_cost: nextOtherCapitalCost,
                            total_cost: machineCost + installationCost + nextOtherCapitalCost,
                            cost: machineCost + installationCost + nextOtherCapitalCost,
                          });
                        }} />
                    </div>
                    <span className="hidden pb-3 text-lg md:block">=</span>
                    <div className="space-y-1.5">
                      <Label>Total Cost (₹)</Label>
                      <Input type="number" className="h-11 rounded-xl bg-muted" value={totalCost || ""} readOnly />
                    </div>
                  </div>

                  {/* Supplier details — bank requires these for items > ₹50K */}
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="space-y-1.5">
                      <Label>Supplier / Vendor Name</Label>
                      <Input className="h-11 rounded-xl" value={item.supplier_name}
                        onChange={(e) => updateMachineryItem(item.id, { supplier_name: e.target.value })}
                        placeholder="Supplier name" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Supplier City</Label>
                      <Input className="h-11 rounded-xl" value={item.supplier_city || ""}
                        onChange={(e) => updateMachineryItem(item.id, { supplier_city: e.target.value })}
                        placeholder="City" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Supplier Phone</Label>
                      <Input className="h-11 rounded-xl" value={item.supplier_phone}
                        onChange={(e) => updateMachineryItem(item.id, { supplier_phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                        placeholder="10-digit mobile" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Supplier Email</Label>
                      <Input type="email" className="h-11 rounded-xl" value={item.supplier_email}
                        onChange={(e) => updateMachineryItem(item.id, { supplier_email: e.target.value })}
                        placeholder="supplier@email.com" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t" />

          {/* ── Preliminary / Other Setup Expenses ─────────────────────────── */}
          <div className="space-y-6">
            <div className="space-y-3">
              <p className="text-sm font-semibold">{isAgriculture ? "Equipment / Power Tools" : "Computers / Laptops / Printers"}</p>
              <CostItemList
                items={capexItems.computers}
                onChange={(items) => updateCapexItems("computers", items)}
                addLabel="Add Item"
                namePlaceholder="e.g. Laptop / Printer"
              />
            </div>

            <div className="border-t" />

            <div className="space-y-3">
              <p className="text-sm font-semibold">{isTrading ? "Furniture / Racks / Display Units" : isAgriculture ? "Storage Racks / Poly-house Fixtures" : "Furniture & Office Fixtures"}</p>
              <CostItemList
                items={capexItems.furniture}
                onChange={(items) => updateCapexItems("furniture", items)}
                addLabel="Add Item"
                namePlaceholder="e.g. Office Chairs / Display Rack"
              />
            </div>

            <div className="border-t" />

            <div className="space-y-3">
              <p className="text-sm font-semibold">Electrification / Internal Wiring / Power Backup</p>
              <p className="text-xs text-muted-foreground -mt-2">Internal wiring, meter, generator, stabiliser</p>
              <CostItemList
                items={capexItems.electrification}
                onChange={(items) => updateCapexItems("electrification", items)}
                addLabel="Add Item"
                namePlaceholder="e.g. Generator / Stabiliser"
              />
            </div>

            <div className="border-t" />

            <div className="space-y-3">
              <p className="text-sm font-semibold">{isTrading ? "Initial Inventory / Opening Stock" : isService ? "Software Licenses / Subscriptions" : isAgriculture ? "Seeds, Fertilisers, Initial Inputs" : "Storage Racks / Material Handling"}</p>
              <CostItemList
                items={capexItems.racks_storage}
                onChange={(items) => updateCapexItems("racks_storage", items)}
                addLabel="Add Item"
                namePlaceholder={isService ? "e.g. Accounting Software License" : "e.g. Storage Rack"}
              />
            </div>

            <div className="border-t" />

            <div className="space-y-3">
              <p className="text-sm font-semibold">{isAgriculture ? "Farm Vehicle / Transport" : "Transport / Vehicle / Loading Cost"}</p>
              <CostItemList
                items={capexItems.transportation}
                onChange={(items) => updateCapexItems("transportation", items)}
                addLabel="Add Item"
                namePlaceholder="e.g. Delivery Vehicle / Handcart"
              />
            </div>

            {(isManufacturing || !isService) && <div className="border-t" />}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
              {isManufacturing && (
                <CurrencyInput
                  label="Machinery Installation & Commissioning (₹)"
                  value={formData.machinery_installation_cost}
                  onChange={(v) => updateFormData({ machinery_installation_cost: v })}
                  hint="Labour + transport for installation — typically 5–10% of machine cost"
                />
              )}
              {!isService && (
                <CurrencyInput
                  label={isAgriculture ? "Advance Payment / Pre-Operative Costs (₹)" : "Pre-Operative / Other Initial Expenditure (₹)"}
                  value={formData.other_initial_expenditure}
                  onChange={(v) => updateFormData({ other_initial_expenditure: v })}
                  hint="Registration, legal, license, advance rent, brand setup"
                />
              )}
            </div>
          </div>

          {/* CA AI Tips */}
          <CATip tips={caTips} />

        </CardContent>
      </Card>

      <DynamicIndustryFields
        formData={formData}
        updateFormData={updateFormData}
        industryType={formData.industry_type}
      />

      {/* ── Live Project Cost & Means of Finance Calculator ────────────────── */}
      <Card className="gtab-card-finance rounded-[0.9rem] border-2 border-primary/40 bg-[#0f1f35] shadow-xl sm:rounded-2xl">
        <CardContent className="p-4 sm:p-6 space-y-5">

          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="bg-primary/20 p-2 rounded-xl">
              <Calculator className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Live Investment Statement</h3>
              <p className="text-xs text-slate-400">Updates as you fill costs · Exactly as it appears in the CMA Report</p>
            </div>
            <Badge className="ml-auto bg-primary text-white border-0 text-xs font-bold px-3">
              {fmt(totalProjectCost)}
            </Badge>
          </div>

          <div className="border-t border-white/10" />

          {/* Cost Breakdown — Section A */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">A. Fixed Capital</p>
            {[
              { label: "Land", value: landCost, show: isManufacturing },
              { label: isTrading ? "Shop Setup / Renovation" : isService ? "Office Rent Deposit" : isAgriculture ? "Farm Shed / Storage" : "Shed / Factory Building", value: buildingCost, show: true },
              { label: isManufacturing ? "Plant & Machinery" : isAgriculture ? "Farm Equipment" : "Assets & Equipment", value: machineryTotal, show: true },
            ].filter(r => r.show).map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center py-1 border-b border-white/8">
                <span className="text-sm text-slate-300">{label}</span>
                <span className={`text-sm font-semibold tabular-nums ${value > 0 ? "text-white" : "text-slate-500"}`}>{value > 0 ? fmt(value) : "₹ 0"}</span>
              </div>
            ))}

            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">B. Preliminary / Initial Expenditure</p>
            {[
              { label: isAgriculture ? "Equipment / Tools" : "Computers / Laptops", value: computersCost, show: true },
              { label: isTrading ? "Furniture / Racks / Display" : "Furniture & Fixtures", value: furnitureCost, show: true },
              { label: "Electrification & Power Backup", value: electrification, show: true },
              { label: isTrading ? "Initial Inventory / Stock" : isService ? "Software / Licenses" : isAgriculture ? "Seeds / Inputs" : "Racks & Storage", value: racksCost, show: true },
              { label: isAgriculture ? "Farm Transport / Vehicle" : "Transport / Loading", value: transportCost, show: true },
              { label: "Machinery Installation", value: installCost, show: isManufacturing },
              { label: "Other Pre-Operative Expenses", value: otherCost, show: !isService },
            ].filter(r => r.show).map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center py-1 border-b border-white/8">
                <span className="text-sm text-slate-300">{label}</span>
                <span className={`text-sm font-semibold tabular-nums ${value > 0 ? "text-white" : "text-slate-500"}`}>{value > 0 ? fmt(value) : "₹ 0"}</span>
              </div>
            ))}

            <div className="flex justify-between items-center pt-1">
              <span className="text-sm font-semibold text-slate-200">Sub-Total (A + B)</span>
              <span className={`text-sm font-bold tabular-nums ${fixedCapital > 0 ? "text-emerald-400" : "text-slate-500"}`}>{fixedCapital > 0 ? fmt(fixedCapital) : "₹ 0"}</span>
            </div>

            {plan.monthlyWorkingCapital > 0 && (
              <div className="flex justify-between items-center py-1 border-b border-white/8">
                <span className="text-sm text-slate-300">C. Working Capital Margin (Promoter's Share)</span>
                <span className="text-sm font-semibold text-white tabular-nums">{fmt(plan.promoterWorkingCapitalContribution)}</span>
              </div>
            )}
          </div>

          <div className="border-t border-white/10" />

          {/* Total Project Cost */}
          <div className="rounded-xl bg-primary/20 border border-primary/40 px-4 py-3 flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Fixed Capital + WC Margin</p>
              <p className="text-sm font-bold text-white flex items-center gap-1">
                <IndianRupee className="w-3.5 h-3.5" /> TOTAL PROJECT COST
              </p>
            </div>
            <span className="text-2xl font-extrabold text-primary tabular-nums">{fmt(totalProjectCost)}</span>
          </div>

          <div className="border-t border-white/10" />

          {/* Means of Finance — scheme-aware, no hardcodes */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Means of Finance (CA Standard)</p>

            <div className="flex justify-between items-center py-1.5 border-b border-white/8">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                <span className="text-sm text-slate-300">Promoter's Own Contribution ({pct(promoterPct)})</span>
              </div>
              <span className="text-sm font-bold text-amber-400 tabular-nums">{fmt(promoterEquity)}</span>
            </div>

            {isPMEGP && marginMoney > 0 && (
              <div className="flex justify-between items-center py-1.5 border-b border-white/8">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-purple-400 shrink-0" />
                  <span className="text-sm text-slate-300">PMEGP Margin Money Subsidy</span>
                </div>
                <span className="text-sm font-bold text-purple-400 tabular-nums">{fmt(marginMoney)}</span>
              </div>
            )}

            <div className="flex justify-between items-center py-1.5 border-b border-white/8">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-400 shrink-0" />
                <span className="text-sm text-slate-300">Bank Term Loan ({pct(tlBankPct)} of Fixed Capital)</span>
              </div>
              <span className="text-sm font-bold text-blue-400 tabular-nums">{fmt(termLoanAmount)}</span>
            </div>

            {wcLoan > 0 && (
              <div className="flex justify-between items-center py-1.5 border-b border-white/8">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-teal-400 shrink-0" />
                  <span className="text-sm text-slate-300">Bank WC Loan ({pct(plan.wcBankFinancePct)}% of WC requirement)</span>
                </div>
                <span className="text-sm font-bold text-teal-400 tabular-nums">{fmt(wcLoan)}</span>
              </div>
            )}

            <div className="flex justify-between items-center pt-1">
              <span className="text-sm font-bold text-white">TOTAL FINANCE</span>
              <span className="text-sm font-bold text-white tabular-nums">
                {fmt(promoterEquity + marginMoney + termLoanAmount + wcLoan)}
              </span>
            </div>
          </div>

        </CardContent>
      </Card>

    </div>
  );
};

export default ProjectRequirementsStep;
