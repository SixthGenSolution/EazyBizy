import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { User, GraduationCap, ShieldCheck, Briefcase } from "lucide-react";
import {
  GTABFormData,
  GENDER_OPTIONS,
  EDUCATION_OPTIONS,
  SOCIAL_CATEGORY_OPTIONS,
} from "@/types/gtab";
import SectionTitle from "@/components/gtab/SectionTitle";

interface PersonalInfoStepProps {
  formData: GTABFormData;
  updateFormData: (updates: Partial<GTABFormData>) => void;
}

const FieldLabel = ({ children, required }: { children: React.ReactNode; required?: boolean }) => (
  <Label className="text-sm font-semibold text-slate-800">
    {children}{required && <span className="ml-1 text-red-400">*</span>}
  </Label>
);

const fieldCls = "h-11 rounded-lg border-slate-300 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-0 transition-none";

const PersonalInfoStep = ({ formData, updateFormData }: PersonalInfoStepProps) => {
  const pri = formData.project_report_inputs;

  const updatePromoter = (updates: Partial<typeof pri.promoter>) => {
    updateFormData({
      project_report_inputs: {
        ...pri,
        promoter: { ...pri.promoter, ...updates },
      },
    });
  };

  return (
    <div className="mx-auto max-w-none space-y-4 sm:space-y-6">

      {/* ── Owner Name Card ────────────────────────────────────────────────── */}
      <Card className="gtab-card-light overflow-hidden rounded-[0.85rem] border border-slate-200 bg-white text-slate-900 shadow-[0_8px_22px_rgba(15,23,42,0.10)] sm:rounded-xl">
        <CardContent className="space-y-5 p-5 sm:space-y-7 sm:p-8">

          <SectionTitle icon={User} title="Owner / Promoter Name" subtitle="Full legal name as per Aadhaar / PAN" />

          {/* Name row */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            <div className="space-y-2">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <FieldLabel required>First Name</FieldLabel>
              </div>
              <Input
                className={fieldCls}
                value={formData.first_name}
                onChange={(e) => updateFormData({ first_name: e.target.value })}
                placeholder="First name"
              />
            </div>

            <div className="space-y-2">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <FieldLabel>Middle Name</FieldLabel>
              </div>
              <Input
                className={fieldCls}
                value={formData.middle_name}
                onChange={(e) => updateFormData({ middle_name: e.target.value })}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-2">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <FieldLabel required>Last Name</FieldLabel>
              </div>
              <Input
                className={fieldCls}
                value={formData.last_name}
                onChange={(e) => updateFormData({ last_name: e.target.value })}
                placeholder="Last name"
              />
            </div>
          </div>

          {/* Father's Name + DOB */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            <div className="space-y-2">
              <FieldLabel required>Father's / Husband's Name</FieldLabel>
              <Input
                className={fieldCls}
                value={pri?.promoter?.fathers_name || ""}
                onChange={(e) => updatePromoter({ fathers_name: e.target.value })}
                placeholder="Ramesh Kumar"
              />
            </div>
            <div className="space-y-2">
              <FieldLabel required>Date of Birth</FieldLabel>
              <DatePicker
                className="h-11 rounded-lg border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm transition-colors hover:border-slate-400 hover:bg-white focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 [&>svg]:text-[#1769d1]"
                value={pri?.promoter?.date_of_birth || ""}
                onChange={(v) => updatePromoter({ date_of_birth: v })}
                placeholder="Select date of birth"
                fromYear={1940}
                toYear={new Date().getFullYear()}
                disableFuture
              />
            </div>
          </div>

          <div className="border-t border-slate-200" />

          {/* Gender / Education / Social Category */}
          <SectionTitle icon={GraduationCap} title="Personal Details" subtitle="Demographic and educational information" />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            <div className="space-y-2">
              <FieldLabel required>Gender</FieldLabel>
              <Select value={formData.gender} onValueChange={(v: any) => updateFormData({ gender: v })}>
                <SelectTrigger className={fieldCls}>
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  {GENDER_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <FieldLabel required>Educational Qualification</FieldLabel>
              <Select value={formData.education} onValueChange={(v: any) => updateFormData({ education: v })}>
                <SelectTrigger className={fieldCls}>
                  <SelectValue placeholder="Select qualification" />
                </SelectTrigger>
                <SelectContent>
                  {EDUCATION_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <FieldLabel required>Social Category</FieldLabel>
              <Select value={formData.social_category} onValueChange={(v: any) => updateFormData({ social_category: v })}>
                <SelectTrigger className={fieldCls}>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {SOCIAL_CATEGORY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Years of experience */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            <div className="space-y-2">
              <FieldLabel>Years of Industry Experience</FieldLabel>
              <Input
                type="number"
                className={fieldCls}
                value={pri?.promoter?.years_experience ?? ""}
                onChange={(e) => updatePromoter({ years_experience: Number(e.target.value) || 0 })}
                placeholder="5"
                min={0}
                max={50}
              />
              <p className="text-xs text-slate-500">Relevant experience in this business / industry</p>
            </div>
          </div>

        </CardContent>
      </Card>

      {/* ── KYC Card ──────────────────────────────────────────────────────── */}
      <Card className="gtab-card-light overflow-hidden rounded-[0.85rem] border border-slate-200 bg-white text-slate-900 shadow-[0_8px_22px_rgba(15,23,42,0.10)] sm:rounded-xl">
        <CardContent className="space-y-5 p-5 sm:space-y-7 sm:p-8">

          <SectionTitle
            icon={ShieldCheck}
            title="KYC & Identity Documents"
            subtitle="PAN is required for Section A of the bank loan report"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            {/* PAN */}
            <div className="space-y-2">
              <FieldLabel required>PAN Number</FieldLabel>
              <Input
                className={`${fieldCls} tracking-widest uppercase`}
                value={pri?.promoter?.pan_number || ""}
                onChange={(e) => updatePromoter({ pan_number: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) })}
                placeholder="ABCDE1234F"
                maxLength={10}
              />
              {pri?.promoter?.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pri.promoter.pan_number) && (
                <p className="text-xs text-amber-400">Format: 5 letters · 4 digits · 1 letter — e.g. ABCDE1234F</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <p className="text-xs leading-5 text-slate-600">
              <span className="font-semibold text-blue-700">Demo data pre-filled.</span>{" "}
              Replace PAN with your actual details before submitting to the bank.
              This field auto-populates Section A of your project report.
            </p>
          </div>

        </CardContent>
      </Card>

      {/* ── Previous Employment Card ──────────────────────────────────────── */}
      <Card className="gtab-card-light overflow-hidden rounded-[0.85rem] border border-slate-200 bg-white text-slate-900 shadow-[0_8px_22px_rgba(15,23,42,0.10)] sm:rounded-xl">
        <CardContent className="space-y-5 p-5 sm:space-y-7 sm:p-8">

          <SectionTitle
            icon={Briefcase}
            title="Previous Employment"
            subtitle="Shows income history for the bank report — leave blank if self-employed / homemaker"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            <div className="space-y-2">
              <FieldLabel>Previous Employer</FieldLabel>
              <Input
                className={fieldCls}
                value={pri?.promoter?.previous_employer || ""}
                onChange={(e) => updatePromoter({ previous_employer: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel>Previous Role</FieldLabel>
              <Input
                className={fieldCls}
                value={pri?.promoter?.previous_role || ""}
                onChange={(e) => updatePromoter({ previous_role: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel>Employment From</FieldLabel>
              <DatePicker
                className="h-11 rounded-lg border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm transition-colors hover:border-slate-400 hover:bg-white focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 [&>svg]:text-[#1769d1]"
                value={pri?.promoter?.employment_from || ""}
                onChange={(v) => updatePromoter({ employment_from: v })}
                placeholder="Start date"
                toYear={new Date().getFullYear()}
                disableFuture
              />
            </div>
            <div className="space-y-2">
              <FieldLabel>Employment To</FieldLabel>
              <DatePicker
                className="h-11 rounded-lg border-slate-300 bg-white px-4 text-sm text-slate-900 shadow-sm transition-colors hover:border-slate-400 hover:bg-white focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 [&>svg]:text-[#1769d1]"
                value={pri?.promoter?.employment_to || ""}
                onChange={(v) => updatePromoter({ employment_to: v })}
                placeholder="End date"
                toYear={new Date().getFullYear()}
                disableFuture
              />
            </div>
          </div>

        </CardContent>
      </Card>

    </div>
  );
};

export default PersonalInfoStep;
