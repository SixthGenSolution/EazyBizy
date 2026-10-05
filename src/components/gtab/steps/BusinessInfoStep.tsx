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
import { DatePicker } from "@/components/ui/date-picker";
import { MapPin, Phone, Building2, TrendingUp } from "lucide-react";

import { GTABFormData, REGISTRATION_OPTIONS, INDIAN_STATES } from "@/types/gtab";
import SectionTitle from "@/components/gtab/SectionTitle";

interface BusinessInfoStepProps {
  formData: GTABFormData;
  updateFormData: (updates: Partial<GTABFormData>) => void;
}

const Req = () => <span className="ml-0.5 text-red-500">*</span>;

const BusinessInfoStep = ({ formData, updateFormData }: BusinessInfoStepProps) => {
  const pri = formData.project_report_inputs;

  const updateBusiness = (updates: Partial<typeof pri.business>) => {
    updateFormData({
      project_report_inputs: {
        ...pri,
        business: { ...pri.business, ...updates },
      },
    });
  };

  return (
    <div className="mx-auto max-w-none space-y-4 sm:space-y-6">

      <Card className="gtab-card-light rounded-[0.9rem] border shadow-sm sm:rounded-2xl">
        <CardContent className="space-y-5 p-4 sm:space-y-7 sm:p-8">

          {/* Address Section */}
          <SectionTitle
            icon={MapPin}
            title="Business Address"
            subtitle="Where is your business located?"
          />

          <div className="space-y-6">

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Address Line 1 <Req /></Label>
              </div>
              <Input
                className="h-12 rounded-xl"
                value={formData.address_line_1}
                onChange={(e) => updateFormData({ address_line_1: e.target.value })}
                placeholder="Building No., Street Name"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Address Line 2</Label>
              </div>
              <Input
                className="h-12 rounded-xl"
                value={formData.address_line_2}
                onChange={(e) => updateFormData({ address_line_2: e.target.value })}
                placeholder="Landmark, Area (optional)"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4 md:gap-6">

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>City <Req /></Label>
                </div>
                <Input
                  className="h-12 rounded-xl"
                  value={formData.city}
                  onChange={(e) => updateFormData({ city: e.target.value })}
                  placeholder="Enter city"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>District</Label>
                </div>
                <Input
                  className="h-12 rounded-xl"
                  value={formData.district}
                  onChange={(e) => updateFormData({ district: e.target.value })}
                  placeholder="Enter district"
                />
              </div>

              <div className="space-y-2">
                <Label>State <Req /></Label>
                <Select
                  value={formData.state}
                  onValueChange={(value) => updateFormData({ state: value })}
                >
                  <SelectTrigger className="h-12 rounded-xl">
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDIAN_STATES.map((state) => (
                      <SelectItem key={state} value={state}>
                        {state}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Pincode <Req /></Label>
                </div>
                <Input
                  className="h-12 rounded-xl"
                  value={formData.pincode}
                  onChange={(e) =>
                    updateFormData({
                      pincode: e.target.value.replace(/\D/g, "").slice(0, 6),
                    })
                  }
                  placeholder="6-digit pincode"
                  maxLength={6}
                />
              </div>

            </div>

          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Registration Section */}
          <SectionTitle
            icon={Building2}
            title="Business Registration"
            subtitle="Select your business registration details"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">

            <div className="space-y-2">
              <Label>Type of Registration <Req /></Label>
              <Select
                value={formData.registration_type}
                onValueChange={(value: any) =>
                  updateFormData({ registration_type: value })
                }
              >
                <SelectTrigger className="h-12 rounded-xl">
                  <SelectValue placeholder="Select registration type" />
                </SelectTrigger>
                <SelectContent>
                  {REGISTRATION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Contact Section */}
          <SectionTitle
            icon={Phone}
            title="Contact Information"
            subtitle="How can we reach you?"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Contact Mobile Number <Req /></Label>
              </div>
              <Input
                type="tel"
                inputMode="numeric"
                className="h-12 rounded-xl"
                value={formData.contact_mobile}
                onChange={(e) =>
                  updateFormData({
                    contact_mobile: e.target.value
                      .replace(/\D/g, "")
                      .slice(0, 10),
                  })
                }
                placeholder="10-digit mobile number"
                maxLength={10}
              />
              {formData.contact_mobile && formData.contact_mobile.length !== 10 && (
                <p className="text-xs text-amber-500">Mobile number must be exactly 10 digits.</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Email ID <Req /></Label>
              </div>
              <Input
                type="email"
                className="h-12 rounded-xl"
                value={formData.contact_email}
                onChange={(e) =>
                  updateFormData({ contact_email: e.target.value })
                }
                placeholder="your@email.com"
              />
              {formData.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contact_email) && (
                <p className="text-xs text-amber-500">Enter a valid email, e.g. name@gmail.com</p>
              )}
            </div>

          </div>

        </CardContent>
      </Card>

      <Card className="gtab-card-light rounded-[0.9rem] border shadow-sm sm:rounded-2xl">
        <CardContent className="space-y-5 p-4 sm:space-y-7 sm:p-8">

          <SectionTitle
            icon={TrendingUp}
            title="Business Profile Details"
            subtitle="Registration and market details for the CMA report cover page"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            <div className="space-y-2">
              <Label>Commencement Date</Label>
              <DatePicker
                className="h-12 rounded-xl"
                value={pri?.business?.commencement_date || ""}
                onChange={(v) => updateBusiness({ commencement_date: v })}
                placeholder="Business start date"
              />
            </div>
            <div className="space-y-2">
              <Label>GST Number</Label>
              <Input
                className="h-12 rounded-xl uppercase"
                value={pri?.business?.gst_number || ""}
                onChange={(e) => updateBusiness({ gst_number: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-2">
              <Label>MSME / UDYAM Number</Label>
              <Input
                className="h-12 rounded-xl"
                value={pri?.business?.msme_number || ""}
                onChange={(e) => updateBusiness({ msme_number: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Market Size (Crores)</Label>
              <Input
                type="number"
                className="h-12 rounded-xl"
                value={pri?.business?.market_size_crores || ""}
                onChange={(e) => updateBusiness({ market_size_crores: Number(e.target.value) || 0 })}
                min={0}
              />
            </div>
            <div className="space-y-2">
              <Label>Market Growth %</Label>
              <Input
                type="number"
                className="h-12 rounded-xl"
                value={pri?.business?.market_growth_pct || ""}
                onChange={(e) => updateBusiness({ market_growth_pct: Number(e.target.value) || 0 })}
                min={0}
              />
            </div>
          </div>

        </CardContent>
      </Card>
    </div>
  );
};

export default BusinessInfoStep;