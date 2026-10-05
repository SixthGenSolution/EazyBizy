/**
 * Dynamic Industry-Specific Fields Component
 * Shows/hides form sections based on selected industry type
 * Supports: Manufacturing, Service, Trading, Agriculture
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Factory,
  Wrench,
  Package,
  Truck,
  Users,
  Leaf,
  CloudRain,
} from "lucide-react";
import { GTABFormData, GTABIndustryType } from "@/types/gtab";
import { numberToWords } from "@/lib/numberToWords";
import SectionTitle from "@/components/gtab/SectionTitle";

interface DynamicIndustryFieldsProps {
  formData: GTABFormData;
  updateFormData: (updates: Partial<GTABFormData>) => void;
  industryType: GTABIndustryType;
}

const CurrencyInput = ({ label, value, onChange, placeholder = "₹ 0", showWords = false }) => {
  const words = showWords && value > 0 ? numberToWords(value) : "";
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
        <p className="text-xs font-medium text-primary/80">₹ {words}</p>
      )}
    </div>
  );
};

const PercentageInput = ({ label, value, onChange, placeholder = "0 %" }) => (
  <div className="space-y-2">
    <Label>{label}</Label>
    <Input
      type="number"
      className="h-12 rounded-xl"
      value={value || ""}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      placeholder={placeholder}
      min={0}
      max={100}
    />
  </div>
);

/**
 * MANUFACTURING INDUSTRY FIELDS
 * Production, Machinery, Raw Material sections
 */
const ManufacturingFields = ({
  formData,
  updateFormData,
}: DynamicIndustryFieldsProps) => (
  <>
    <SectionTitle
      icon={Factory}
      title="Production Specifications"
      subtitle="Daily/monthly production capacity and planning"
    />

    <div className="grid grid-cols-1 gap-4 sm:pl-14 md:grid-cols-3 md:gap-6">
      <CurrencyInput
        label="Expected Monthly Production Capacity (Units)"
        value={formData.production_capacity_units || 0}
        onChange={(v) =>
          updateFormData({ production_capacity_units: v })
        }
        placeholder="1000"
      />
      <CurrencyInput
        label="Production Cost per Unit (₹)"
        value={formData.production_cost_per_unit || 0}
        onChange={(v) =>
          updateFormData({ production_cost_per_unit: v })
        }
        placeholder="₹ 100"
      />
      <CurrencyInput
        label="Selling Price per Unit (₹)"
        value={formData.selling_price_per_unit || 0}
        onChange={(v) =>
          updateFormData({ selling_price_per_unit: v })
        }
        placeholder="₹ 200"
      />
      
    </div>

  </>
);

/**
 * SERVICE INDUSTRY FIELDS
 * Service Revenue, Staffing, Recurring Expenses
 */
const ServiceFields = ({
  formData,
  updateFormData,
}: DynamicIndustryFieldsProps) => (
  <>
    <SectionTitle
      icon={Wrench}
      title="Service Revenue Model"
      subtitle="Service delivery and revenue planning"
    />

    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      <CurrencyInput
        label="Expected Monthly Service Revenue (₹)"
        value={formData.expected_monthly_revenue || 0}
        onChange={(v) =>
          updateFormData({ expected_monthly_revenue: v })
        }
        placeholder="₹ 50,000"
        showWords
      />
      <Input
        className="h-12 rounded-xl"
        placeholder="Average service rate per customer/hour"
        value={formData.service_rate_unit || ""}
        onChange={(e) =>
          updateFormData({ service_rate_unit: e.target.value })
        }
      />
      <CurrencyInput
        label="Monthly Clients/Projects Targeted"
        value={formData.monthly_clients_count || 0}
        onChange={(v) =>
          updateFormData({ monthly_clients_count: v })
        }
        placeholder="20"
      />
      <PercentageInput
        label="Service Capacity Utilization % (Year 1)"
        value={formData.service_utilization_pct || 50}
        onChange={(v) =>
          updateFormData({ service_utilization_pct: v })
        }
        placeholder="50"
      />
    </div>

    <div className="border-t" />

    <SectionTitle
      icon={Users}
      title="Staffing"
      subtitle="Employee costs and HR planning"
    />

    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      <CurrencyInput
        label="Skilled Workers Count"
        value={formData.skilled_workers_count || 0}
        onChange={(v) =>
          updateFormData({ skilled_workers_count: v })
        }
        placeholder="2"
      />
      <CurrencyInput
        label="Skilled Worker Salary (Monthly ₹)"
        value={formData.skilled_workers_salary || 0}
        onChange={(v) =>
          updateFormData({ skilled_workers_salary: v })
        }
        placeholder="₹ 15,000"
        showWords
      />
      <CurrencyInput
        label="Semi-Skilled Workers Count"
        value={formData.semi_skilled_workers_count || 0}
        onChange={(v) =>
          updateFormData({ semi_skilled_workers_count: v })
        }
        placeholder="1"
      />
      <CurrencyInput
        label="Semi-Skilled Worker Salary (Monthly ₹)"
        value={formData.semi_skilled_workers_salary || 0}
        onChange={(v) =>
          updateFormData({ semi_skilled_workers_salary: v })
        }
        placeholder="₹ 10,000"
        showWords
      />
    </div>

    <div className="border-t" />

    <SectionTitle
      icon={Package}
      title="Recurring Expenses"
      subtitle="Ongoing operational costs"
    />

    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      <CurrencyInput
        label="Monthly Office Rent (₹)"
        value={formData.monthly_rent || 0}
        onChange={(v) => updateFormData({ monthly_rent: v })}
        placeholder="₹ 5,000"
        showWords
      />
      <CurrencyInput
        label="Electricity & Utilities (Monthly ₹)"
        value={formData.electricity_water_cost || 0}
        onChange={(v) =>
          updateFormData({ electricity_water_cost: v })
        }
        placeholder="₹ 2,000"
        showWords
      />
      <CurrencyInput
        label="Repair & Maintenance (Monthly ₹)"
        value={formData.repair_maintenance_cost || 0}
        onChange={(v) =>
          updateFormData({ repair_maintenance_cost: v })
        }
        placeholder="₹ 1,000"
        showWords
      />
      <CurrencyInput
        label="Telephone & Internet (Monthly ₹)"
        value={formData.telephone_internet_cost || 0}
        onChange={(v) =>
          updateFormData({ telephone_internet_cost: v })
        }
        placeholder="₹ 500"
        showWords
      />
    </div>
  </>
);

/**
 * TRADING INDUSTRY FIELDS
 * Inventory, Purchase, Stock Turnover, Supplier Credit
 */
const TradingFields = ({
  formData,
  updateFormData,
}: DynamicIndustryFieldsProps) => (
  <>
    <SectionTitle
      icon={Package}
      title="Inventory Management"
      subtitle="Stock and inventory planning"
    />

    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      <CurrencyInput
        label="Average Inventory Value (₹)"
        value={formData.average_inventory_value || 0}
        onChange={(v) =>
          updateFormData({ average_inventory_value: v })
        }
        placeholder="₹ 100,000"
        showWords
      />
      <PercentageInput
        label="Inventory as % of Expected Monthly Sales"
        value={formData.inventory_pct || 30}
        onChange={(v) =>
          updateFormData({ inventory_pct: v })
        }
        placeholder="30"
      />
      <Input
        className="h-12 rounded-xl"
        placeholder="Primary products traded (e.g., Electronics, Textiles)"
        value={formData.products_services || ""}
        onChange={(e) =>
          updateFormData({ products_services: e.target.value })
        }
      />
    </div>

    <div className="border-t" />

    <SectionTitle
      icon={Truck}
      title="Purchase & Sales"
      subtitle="Procurement and revenue planning"
    />

    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      <CurrencyInput
        label="Expected Monthly Purchases (₹)"
        value={formData.monthly_purchase_value || 0}
        onChange={(v) =>
          updateFormData({ monthly_purchase_value: v })
        }
        placeholder="₹ 150,000"
        showWords
      />
      <CurrencyInput
        label="Expected Monthly Sales (₹)"
        value={formData.expected_monthly_revenue || 0}
        onChange={(v) =>
          updateFormData({ expected_monthly_revenue: v })
        }
        placeholder="₹ 200,000"
        showWords
      />
      <PercentageInput
        label="Gross Margin %"
        value={formData.gross_margin || 20}
        onChange={(v) =>
          updateFormData({ gross_margin: v })
        }
        placeholder="20"
      />
      <PercentageInput
        label="Stock Turnover Ratio (Times per Month)"
        value={formData.stock_turnover_ratio || 2}
        onChange={(v) =>
          updateFormData({ stock_turnover_ratio: v })
        }
        placeholder="2"
      />
    </div>

    <div className="border-t" />

    <SectionTitle
      icon={Package}
      title="Supplier Credit Terms"
      subtitle="Credit arrangement and payment cycle"
    />

    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      <CurrencyInput
        label="Supplier Credit Sought (Days)"
        value={formData.supplier_credit_days || 30}
        onChange={(v) =>
          updateFormData({ supplier_credit_days: v })
        }
        placeholder="30"
      />
      <Input
        className="h-12 rounded-xl"
        placeholder="Main supplier name"
        value={formData.primary_supplier_name || ""}
        onChange={(e) =>
          updateFormData({ primary_supplier_name: e.target.value })
        }
      />
      <CurrencyInput
        label="Customer Credit Period (Days)"
        value={formData.customer_credit_days || 0}
        onChange={(v) =>
          updateFormData({ customer_credit_days: v })
        }
        placeholder="0"
      />
    </div>
  </>
);

/**
 * AGRICULTURE INDUSTRY FIELDS
 * Crop/Project, Land, Yield, Seasonal Working Capital
 */
const AgricultureFields = ({
  formData,
  updateFormData,
}: DynamicIndustryFieldsProps) => (
  <>
    <SectionTitle
      icon={Leaf}
      title="Crop / Project Details"
      subtitle="Agricultural commodity and project information"
    />

    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      <Input
        className="h-12 rounded-xl"
        placeholder="Main crop (e.g., Wheat, Cotton, Spice)"
        value={formData.main_crop || ""}
        onChange={(e) => updateFormData({ main_crop: e.target.value })}
      />
      <Input
        className="h-12 rounded-xl"
        placeholder="Farming type (e.g., Organic, Hydroponics, Dairy)"
        value={formData.farming_type || ""}
        onChange={(e) => updateFormData({ farming_type: e.target.value })}
      />
      <PercentageInput
        label="Land Utilization % (Area under cultivation)"
        value={formData.land_utilization_pct || 80}
        onChange={(v) =>
          updateFormData({ land_utilization_pct: v })
        }
        placeholder="80"
      />
    </div>

    <div className="border-t" />

    <SectionTitle
      icon={Leaf}
      title="Land Details"
      subtitle="Agricultural land and asset investment"
    />

    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      <CurrencyInput
        label="Land Area (Acres)"
        value={formData.land_area_acres || 0}
        onChange={(v) =>
          updateFormData({ land_area_acres: v })
        }
        placeholder="2.5"
      />
      <CurrencyInput
        label="Land Cost (₹)"
        value={formData.land_cost || 0}
        onChange={(v) =>
          updateFormData({ land_cost: v })
        }
        placeholder="₹ 500,000"
        showWords
      />
      <CurrencyInput
        label="Farm Setup / Storage Shed Cost (₹)"
        value={formData.shed_building_cost || 0}
        onChange={(v) =>
          updateFormData({ shed_building_cost: v })
        }
        placeholder="₹ 50,000"
        showWords
      />
    </div>

    <div className="border-t" />

    <SectionTitle
      icon={CloudRain}
      title="Yield & Production"
      subtitle="Expected harvest and seasonal productivity"
    />

    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      <CurrencyInput
        label="Expected Annual Yield (Units/Quintals)"
        value={formData.expected_annual_yield || 0}
        onChange={(v) =>
          updateFormData({ expected_annual_yield: v })
        }
        placeholder="100"
      />
      <CurrencyInput
        label="Selling Price per Unit (₹)"
        value={formData.agricultural_selling_price || 0}
        onChange={(v) =>
          updateFormData({ agricultural_selling_price: v })
        }
        placeholder="₹ 5,000"
      />
      <PercentageInput
        label="Crop Yield Variability % (Season to season)"
        value={formData.yield_variability_pct || 15}
        onChange={(v) =>
          updateFormData({ yield_variability_pct: v })
        }
        placeholder="15"
      />
    </div>

    <div className="border-t" />

    <SectionTitle
      icon={CloudRain}
      title="Seasonal Working Capital"
      subtitle="Working capital requirements during growing season"
    />

    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      <CurrencyInput
        label="Seeds & Inputs Cost (₹)"
        value={formData.seeds_inputs_cost || 0}
        onChange={(v) =>
          updateFormData({ seeds_inputs_cost: v })
        }
        placeholder="₹ 20,000"
        showWords
      />
      <CurrencyInput
        label="Fertilizer & Pesticide Cost (₹)"
        value={formData.fertilizer_pesticide_cost || 0}
        onChange={(v) =>
          updateFormData({ fertilizer_pesticide_cost: v })
        }
        placeholder="₹ 10,000"
        showWords
      />
      <CurrencyInput
        label="Labour Cost During Season (₹)"
        value={formData.labour_cost_seasonal || 0}
        onChange={(v) =>
          updateFormData({ labour_cost_seasonal: v })
        }
        placeholder="₹ 30,000"
        showWords
      />
      <CurrencyInput
        label="Irrigation / Water Cost (₹)"
        value={formData.irrigation_cost || 0}
        onChange={(v) =>
          updateFormData({ irrigation_cost: v })
        }
        placeholder="₹ 5,000"
        showWords
      />
    </div>
  </>
);

/**
 * Main DynamicIndustryFields Component
 * Renders industry-specific sections
 */
const DynamicIndustryFields = ({
  formData,
  updateFormData,
  industryType,
}: DynamicIndustryFieldsProps) => {
  const props = { formData, updateFormData, industryType };

  return (
    <Card className="rounded-[0.9rem] border shadow-sm sm:rounded-2xl">
      <CardContent className="space-y-5 p-4 sm:space-y-7 sm:p-8">
        {industryType === "manufacturing" && (
          <ManufacturingFields {...props} />
        )}
        {industryType === "service" && <ServiceFields {...props} />}
        {industryType === "trading" && <TradingFields {...props} />}
        {industryType === "agriculture" && (
          <AgricultureFields {...props} />
        )}
      </CardContent>
    </Card>
  );
};

export default DynamicIndustryFields;
