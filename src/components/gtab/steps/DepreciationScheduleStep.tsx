import { Layers3, Lightbulb } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { GTABFormData } from "@/types/gtab";
import { buildWdvDepreciationSchedule } from "@/lib/wdvDepreciation";
import SectionTitle from "@/components/gtab/SectionTitle";

interface DepreciationScheduleStepProps {
  formData: GTABFormData;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const DepreciationScheduleStep = ({ formData }: DepreciationScheduleStepProps) => {
  const dep = buildWdvDepreciationSchedule(formData);
  const hasAssets = dep.grossBlock > 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      <SectionTitle
        icon={Layers3}
        title="Depreciation Schedule (WDV Method)"
        subtitle="Auto-calculated from your Capital Expenditure (Step 7) and depreciation rates — nothing to enter here."
      />

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 space-y-1">
        <p className="flex items-center gap-1.5 font-semibold">
          <Lightbulb className="w-3.5 h-3.5" /> CA Guidance — Written Down Value (WDV)
        </p>
        <p>• WDV (reducing balance) is used exclusively — Income Tax Act depreciation is computed this way, never Straight Line.</p>
        <p>• Each year: Depreciation = Opening WDV × Rate; Closing WDV = Opening WDV − Depreciation, carried forward as next year's opening.</p>
        <p>• Building depreciates at {dep.buildingRatePct}% p.a. · Plant &amp; Machinery + Fixtures at {dep.machineryRatePct}% p.a.</p>
      </div>

      {!hasAssets ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No capital expenditure entered yet in Step 7 — the depreciation schedule will appear here automatically once building, machinery,
            or other fixed-asset costs are added.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-4 sm:p-6 space-y-3">
              <h4 className="text-sm font-semibold">Gross Block (Year 0)</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Building</p>
                  <p className="font-semibold">{fmt(dep.buildingGross)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Plant &amp; Machinery (incl. contingency)</p>
                  <p className="font-semibold">{fmt(dep.pmWithContingency)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Fixtures &amp; Other Assets</p>
                  <p className="font-semibold">{fmt(dep.fixturesGross)}</p>
                </div>
                <div className="rounded-lg border p-3 bg-primary/5">
                  <p className="text-xs text-muted-foreground">Total Gross Block</p>
                  <p className="font-semibold">{fmt(dep.grossBlock)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 sm:p-6 space-y-3 overflow-x-auto">
              <h4 className="text-sm font-semibold">5-Year WDV Schedule</h4>
              <table className="w-full text-xs sm:text-sm border-collapse min-w-[640px]">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2 px-2 font-medium">Particulars</th>
                    {dep.schedule.map((row) => (
                      <th key={row.year} className="text-right py-2 px-2 font-medium">Year {row.year}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-2 px-2 text-muted-foreground">Opening WDV</td>
                    {dep.schedule.map((row) => (
                      <td key={row.year} className="text-right py-2 px-2">{fmt(row.openingWdv)}</td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 px-2 text-muted-foreground">Depreciation (WDV × Rate)</td>
                    {dep.schedule.map((row) => (
                      <td key={row.year} className="text-right py-2 px-2">{fmt(row.depreciation)}</td>
                    ))}
                  </tr>
                  <tr className="border-b font-semibold">
                    <td className="py-2 px-2">Closing WDV (Net Block)</td>
                    {dep.schedule.map((row) => (
                      <td key={row.year} className="text-right py-2 px-2">{fmt(row.closingWdv)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground">
                Depreciation declines every year on the reducing balance — this schedule matches the CMA report PDF exactly.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 sm:p-6 space-y-3 overflow-x-auto">
              <h4 className="text-sm font-semibold">Building vs. Machinery + Fixtures — Break-up</h4>
              <table className="w-full text-xs sm:text-sm border-collapse min-w-[640px]">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2 px-2 font-medium">Particulars</th>
                    {dep.schedule.map((row) => (
                      <th key={row.year} className="text-right py-2 px-2 font-medium">Year {row.year}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-2 px-2 text-muted-foreground">Building — Depreciation</td>
                    {dep.schedule.map((row) => (
                      <td key={row.year} className="text-right py-2 px-2">{fmt(row.buildingDepreciation)}</td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 px-2 text-muted-foreground">Building — Closing WDV</td>
                    {dep.schedule.map((row) => (
                      <td key={row.year} className="text-right py-2 px-2">{fmt(row.buildingClosingWdv)}</td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 px-2 text-muted-foreground">Machinery + Fixtures — Depreciation</td>
                    {dep.schedule.map((row) => (
                      <td key={row.year} className="text-right py-2 px-2">{fmt(row.machineryDepreciation)}</td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 px-2 text-muted-foreground">Machinery + Fixtures — Closing WDV</td>
                    {dep.schedule.map((row) => (
                      <td key={row.year} className="text-right py-2 px-2">{fmt(row.machineryClosingWdv)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default DepreciationScheduleStep;
