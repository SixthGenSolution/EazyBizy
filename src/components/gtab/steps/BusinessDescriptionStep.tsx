import { useEffect, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GTABFormData, NATURE_OF_BUSINESS_OPTIONS } from "@/types/gtab";
import { Building2, Lightbulb, Target, Wand2 } from "lucide-react";
import AIAssistBadge from "@/components/AIAssistPanel";
import { getStep4Tips } from "@/lib/caGuidance";
import SectionTitle from "@/components/gtab/SectionTitle";

interface BusinessDescriptionStepProps {
  formData: GTABFormData;
  updateFormData: (updates: Partial<GTABFormData>) => void;
}

// ── Industry-aware smart defaults ────────────────────────────────────────────

function getNatureLabel(industry: string, typeOfBusiness: string): string {
  const key = industry as keyof typeof NATURE_OF_BUSINESS_OPTIONS;
  const opts = NATURE_OF_BUSINESS_OPTIONS[key] ?? [];
  return opts.find((o) => o.value === typeOfBusiness)?.label ?? typeOfBusiness ?? industry;
}

function buildDefaults(formData: GTABFormData) {
  const name     = [formData.first_name, formData.last_name].filter(Boolean).join(" ") || "The Promoter";
  const biz      = formData.business_entity_name || "the proposed enterprise";
  const city     = formData.city     || "the proposed location";
  const state    = formData.state    || "the state";
  const industry = formData.industry_type || "manufacturing";
  const nature   = getNatureLabel(industry, formData.type_of_business);
  const scheme   = (formData.loan_scheme || "").replace(/_/g, " ").toUpperCase() || "government scheme";

  const descriptions: Record<string, string> = {
    manufacturing: `${biz} is a proposed ${nature} unit to be established at ${city}, ${state}. The unit will manufacture and supply quality products using modern machinery and technology. The promoter, ${name}, brings relevant industry knowledge and entrepreneurial vision to make this project commercially viable. The unit aims to create direct employment for local youth and contribute to regional economic development. The project is planned to operate at 50% capacity in Year 1, scaling up to 80% by Year 5, in line with CA-standard projections.`,

    service: `${biz} is a proposed ${nature} enterprise to be set up at ${city}, ${state}. The business will provide professional, quality services to clients in the local and regional market. The promoter, ${name}, has hands-on experience in the service sector and has identified strong demand for quality ${nature} services in the area. The business model focuses on customer satisfaction, repeat engagements, and word-of-mouth referrals to build a sustainable client base. The enterprise will be funded under the ${scheme} scheme.`,

    trading: `${biz} is a proposed trading enterprise engaged in the purchase and sale of ${nature} goods at ${city}, ${state}. The business will procure products from established suppliers and distribute them to retail outlets, institutions, and end consumers in the region. The promoter, ${name}, has identified strong local demand and secured preliminary supplier contacts. Proper storage and display infrastructure will be put in place. The business is designed for quick inventory turnover and steady profit margins.`,

    agriculture: `${biz} is a proposed ${nature} enterprise to be established at ${city}, ${state}. The project involves ${nature} activities aimed at enhancing farm productivity and rural income. The promoter, ${name}, has agricultural land and relevant farming experience. The enterprise will adopt modern agronomic practices, quality inputs, and market-linked sales to ensure profitability. The project is eligible for the ${scheme} scheme and aims to generate employment for local farm labour.`,
  };

  const targets: Record<string, string> = {
    manufacturing: `The primary target market includes local retailers, wholesale distributors, and institutional buyers within ${state} and neighboring states. Export markets may be explored in later years. The growing domestic demand for quality manufactured goods ensures sustainable sales volumes throughout the 5-year projection period.`,

    service: `The target customers include individual consumers, small and medium businesses, and corporate clients in ${city} and surrounding areas of ${state} who require reliable ${nature} services. The business will attract clients through competitive pricing, quality delivery, and professional service standards. Repeat business and long-term contracts will form the revenue backbone.`,

    trading: `Target customers include retail shopkeepers, small businesses, institutions, and direct end consumers in ${city}, ${state}. The business will focus on building a loyal buyer base by ensuring consistent product availability, competitive pricing, and timely delivery. Seasonal demand peaks and festivals will be leveraged for higher sales volumes.`,

    agriculture: `The target market includes local agricultural produce buyers, mandis, food processors, and direct consumers in ${state}. With growing demand for quality farm produce, the enterprise will benefit from both government procurement schemes (MSP) and open market sales. Export potential will be explored as production scales up.`,
  };

  const advantages: Record<string, string> = {
    manufacturing: `The key competitive advantage is the promoter's domain expertise, cost-effective production using energy-efficient machinery, and strategic location close to raw material sources and markets. The enterprise will focus on quality, timely delivery, and competitive pricing to build lasting relationships with buyers.`,
    service: `The business offers personalized, high-quality service delivery at competitive rates. The promoter's experience, strong local networks, and customer-first approach differentiate this enterprise from larger, impersonal competitors. Quick turnaround and reliability will be the core USP.`,
    trading: `The competitive advantage includes established supplier relationships, prime retail location, diverse product portfolio, and efficient inventory management. The enterprise will focus on offering better product selection and pricing compared to existing local competitors.`,
    agriculture: `The enterprise benefits from owned agricultural land, access to quality inputs, and the promoter's farming experience. Modern cultivation techniques and direct market linkages ensure better price realization compared to traditional farming methods.`,
  };

  const experience: Record<string, string> = {
    manufacturing: `${name} has hands-on experience in the ${nature} sector including knowledge of manufacturing processes, raw material procurement, quality control, and market linkages. This prior experience significantly de-risks the project and supports successful business execution.`,
    service: `${name} has practical experience in providing ${nature} services and understands customer requirements, service delivery standards, and pricing dynamics in the local market. This background ensures smooth business launch and early profitability.`,
    trading: `${name} has experience in trade and commerce, including supplier negotiations, inventory management, and retail sales. This practical knowledge will be applied to build a profitable and well-managed trading enterprise.`,
    agriculture: `${name} has active farming experience and understanding of local crop patterns, seasonal cycles, and market pricing. This domain expertise, combined with the proposed modern practices, forms a strong foundation for the agri-enterprise.`,
  };

  const ind = descriptions[industry] ? industry : "manufacturing";
  return {
    business_description: descriptions[ind],
    target_market:        targets[ind],
    competitive_advantage: advantages[ind],
    promoter_experience:  experience[ind],
  };
}

// ── CA Tip box ───────────────────────────────────────────────────────────────
const CATip = ({ tips }: { tips: string[] }) => (
  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1.5">
    <div className="flex items-center gap-2 text-amber-800 font-semibold text-xs uppercase tracking-wide">
      <Lightbulb className="w-3.5 h-3.5" />
      CA Guidance — What Banks Read First
    </div>
    {tips.map((tip, i) => <p key={i} className="text-xs text-amber-700">• {tip}</p>)}
  </div>
);

// ── Component ────────────────────────────────────────────────────────────────

const BusinessDescriptionStep = ({ formData, updateFormData }: BusinessDescriptionStepProps) => {

  // Auto-fill all empty narrative fields when step mounts
  useEffect(() => {
    const missing =
      !formData.business_description ||
      !formData.target_market;

    if (missing) {
      const defaults = buildDefaults(formData);
      const patch: Partial<GTABFormData> = {};
      if (!formData.business_description)  patch.business_description  = defaults.business_description;
      if (!formData.target_market)         patch.target_market         = defaults.target_market;
      if (!formData.competitive_advantage) patch.competitive_advantage = defaults.competitive_advantage;
      if (!formData.promoter_experience)   patch.promoter_experience   = defaults.promoter_experience;
      if (Object.keys(patch).length > 0) updateFormData(patch);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Regenerate all fields with fresh defaults (user-triggered)
  const regenerateAll = useCallback(() => {
    const defaults = buildDefaults(formData);
    updateFormData(defaults);
  }, [formData, updateFormData]);

  return (
    <div className="mx-auto max-w-none space-y-4 sm:space-y-6">
      <Card className="gtab-card-light rounded-[0.9rem] border shadow-sm sm:rounded-2xl">
        <CardContent className="space-y-5 p-4 sm:space-y-7 sm:p-8">

          {/* AI Default Banner */}
          <div className="flex items-center justify-between rounded-xl border border-[#00C2D1]/25 bg-[#00C2D1]/8 px-4 py-3">
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-[#0a8a96]">AI-generated defaults</span> have been applied based on your business type.
              Edit any field to customise for your report.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={regenerateAll}
              className="ml-4 shrink-0 gap-1.5 rounded-lg text-xs font-semibold border-[#00C2D1]/40 text-[#0a8a96] hover:bg-[#00C2D1]/10"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Regenerate All
            </Button>
          </div>

          <SectionTitle
            icon={Building2}
            title="Business Overview"
            subtitle="Describe your business for the CMA report"
          />

          <div className="space-y-6">
            {/* Hero field — full width, the longest and most important narrative */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Business Overview *</Label>
                <AIAssistBadge
                  fieldLabel="Business Overview"
                  tooltip="AI can help you write a compelling business overview"
                  onApply={(text) => updateFormData({ business_description: text })}
                />
              </div>
              <Textarea
                className="min-h-[120px] rounded-xl"
                value={formData.business_description || ""}
                onChange={(e) => updateFormData({ business_description: e.target.value })}
                placeholder="Describe your business, products/services, target market and uniqueness..."
              />
              <p className="text-xs text-muted-foreground">This will be included in your bank submission report</p>
            </div>

            {/* Paired fields — balances width vs. height instead of stacking full-width */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Products / Services Offered *</Label>
                  <AIAssistBadge
                    fieldLabel="Products / Services Offered"
                    tooltip="AI can help describe your products and services"
                    onApply={(text) => updateFormData({ products_services: text })}
                  />
                </div>
                <Textarea
                  className="min-h-[120px] rounded-xl"
                  value={formData.products_services || ""}
                  onChange={(e) => updateFormData({ products_services: e.target.value })}
                  placeholder="Describe your main products or services..."
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Target Market / Customers *</Label>
                  <AIAssistBadge
                    fieldLabel="Target Market / Customers"
                    tooltip="AI can help you identify your target market"
                    onApply={(text) => updateFormData({ target_market: text })}
                  />
                </div>
                <Textarea
                  className="min-h-[120px] rounded-xl"
                  value={formData.target_market || ""}
                  onChange={(e) => updateFormData({ target_market: e.target.value })}
                  placeholder="Who are your target customers?"
                />
              </div>
            </div>
          </div>

          <div className="border-t" />

          <SectionTitle
            icon={Target}
            title="Competitive Advantage"
            subtitle="What makes your business unique?"
          />

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Competitive Advantage / USP</Label>
                <AIAssistBadge
                  fieldLabel="Competitive Advantage / USP"
                  tooltip="AI can help you articulate your unique selling proposition"
                  onApply={(text) => updateFormData({ competitive_advantage: text })}
                />
              </div>
              <Textarea
                className="min-h-[120px] rounded-xl"
                value={formData.competitive_advantage || ""}
                onChange={(e) => updateFormData({ competitive_advantage: e.target.value })}
                placeholder="Explain your unique selling proposition..."
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Promoter Experience & Background</Label>
                <AIAssistBadge
                  fieldLabel="Promoter Experience & Background"
                  tooltip="AI can help you present your experience professionally"
                  onApply={(text) => updateFormData({ promoter_experience: text })}
                />
              </div>
              <Textarea
                className="min-h-[120px] rounded-xl"
                value={formData.promoter_experience || ""}
                onChange={(e) => updateFormData({ promoter_experience: e.target.value })}
                placeholder="Describe your relevant experience and qualifications..."
              />
            </div>
          </div>

          <CATip tips={getStep4Tips({
            industry: formData.industry_type || "manufacturing",
            scheme: formData.loan_scheme || "normal_msme",
            isNewBusiness: formData.business_type !== "existing_business",
          })} />

        </CardContent>
      </Card>
    </div>
  );
};

export default BusinessDescriptionStep;
