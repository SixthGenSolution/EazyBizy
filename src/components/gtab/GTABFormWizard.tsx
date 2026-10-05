import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Check, Save, Factory, Wrench, Store, Sprout, Layers3, CreditCard, Banknote, ShieldCheck, Landmark, BadgePercent, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useGTABValidation } from "@/hooks/useGTABValidation";
import { useSchemeRules } from "@/hooks/useSchemeRules";
import {
  GTABFormData,
  GTABIndustryType,
  INITIAL_FORM_DATA,
  mergeProjectReportInputs,
  parsePlantMachinery,
} from "@/types/gtab";
import type { Json } from "@/integrations/supabase/types";
import {
  getFinancingPlan,
} from "@/lib/projectReport";
import PersonalInfoStep from "./steps/PersonalInfoStep";
import BusinessInfoStep from "./steps/BusinessInfoStep";
import BusinessLoanDetailsStep from "./steps/BusinessLoanDetailsStep";
import BusinessDescriptionStep from "./steps/BusinessDescriptionStep";
import ProjectRequirementsStep from "./steps/ProjectRequirementsStep";
import ProjectSummaryStep from "./steps/ProjectSummaryStep";
import MonthlyExpensesStep from "./steps/MonthlyExpensesStep";
import WorkingCapitalStep from "./steps/WorkingCapitalStep";
import ProjectReportInputsStep from "./steps/ProjectReportInputsStep";
import DepreciationScheduleStep from "./steps/DepreciationScheduleStep";
import ApplicationPreview from "./ApplicationPreview";
import { ValidationStatus } from "./ValidationStatus";
import AIInsightPanel from "./AIInsightPanel";
import BankabilityBar from "./BankabilityBar";

const STEPS = [
  { id: 1, title: "KYC \u0026 Business Details", icon: "👤" },
  { id: 2, title: "Loan & Scheme", icon: "📋" },
  { id: 3, title: "Business Profile", icon: "📝" },
  { id: 4, title: "Financial Projections", icon: "🧾" },
  { id: 5, title: "Means of Finance", icon: "📊" },
  { id: 6, title: "Working Capital", icon: "🎯" },
  { id: 7, title: "Capital Expenditure", icon: "🔧" },
  { id: 8, title: "Depreciation Schedule", icon: "📉" },
  { id: 9, title: "Operating Expenses", icon: "💰" },
  { id: 10, title: "Final Review", icon: "👁️" },
];

const DEFAULT_TENURE_MONTHS = 60;
const NARRATIVE_DRAFT_PREFIX = "gtab-report-narratives:";
const APPLICATION_DRAFT_PREFIX = "gtab-application-draft:";
const SAVE_TIMEOUT_MS = 12000;

const INDUSTRY_CHOICES: Array<{
  value: Exclude<GTABIndustryType, "others">;
  label: string;
  description: string;
  icon: typeof Factory;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  iconBg: string;
  iconColor: string;
}> = [
  {
    value: "manufacturing",
    label: "Manufacturing",
    description: "Use machinery, raw material, production, working capital and CMA calculations.",
    icon: Factory,
    accent: "#1677ff",
    accentSoft: "bg-[#7EEAEA] text-slate-800 border-cyan-300",
    accentBorder: "border-cyan-300",
    iconBg: "#dbeafe",
    iconColor: "#1d4ed8",
  },
  {
    value: "service",
    label: "Service",
    description: "Service-specific fields will be added next.",
    icon: Wrench,
    accent: "#8b5cf6",
    accentSoft: "bg-[#7EEAEA] text-slate-800 border-cyan-300",
    accentBorder: "border-cyan-300",
    iconBg: "#ede9fe",
    iconColor: "#7c3aed",
  },
  {
    value: "trading",
    label: "Trading",
    description: "Trading-specific inventory and sales fields will be added next.",
    icon: Store,
    accent: "#10b981",
    accentSoft: "bg-[#7EEAEA] text-slate-800 border-cyan-300",
    accentBorder: "border-cyan-300",
    iconBg: "#dcfce7",
    iconColor: "#15803d",
  },
  {
    value: "agriculture",
    label: "Agriculture",
    description: "Agriculture-specific crop/project fields will be added next.",
    icon: Sprout,
    accent: "#f59e0b",
    accentSoft: "bg-[#7EEAEA] text-slate-800 border-cyan-300",
    accentBorder: "border-cyan-300",
    iconBg: "#fef3c7",
    iconColor: "#d97706",
  },
];

type SchemeChoice = {
  value: string;
  label: string;
  badge: string;
  badgeColor: 'teal' | 'gold' | 'green';
  description: string;
  maxLoan: string;
  subsidy: string;
  icon: typeof CreditCard;
  ready: boolean;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  iconBg?: string;
  iconColor?: string;
};

const SCHEME_CHOICES: SchemeChoice[] = [
  {
    value: "pmegp",
    label: "PMEGP",
    badge: "Subsidy",
    badgeColor: "gold",
    description: "Govt subsidy 15–35% of project cost held as TDR. For new manufacturing & service businesses.",
    maxLoan: "Rs. 50L (Mfg) / Rs. 20L (Svc)",
    subsidy: "15–35% margin money",
    icon: BadgePercent,
    ready: true,
    accent: "#f59e0b",
    accentSoft: "bg-[#7EEAEA] text-slate-800 border-cyan-300",
    accentBorder: "border-cyan-300",
    iconBg: "#fef3c7",
    iconColor: "#d97706",
  },
  {
    value: "mudra_shishu",
    label: "Mudra Shishu",
    badge: "Micro",
    badgeColor: "teal",
    description: "Collateral-free micro loan for very small businesses. No CMA required.",
    maxLoan: "Up to Rs. 50,000",
    subsidy: "No subsidy",
    icon: Banknote,
    ready: true,
    accent: "#14b8a6",
    accentSoft: "bg-[#7EEAEA] text-slate-800 border-cyan-300",
    accentBorder: "border-cyan-300",
    iconBg: "#ccfbf1",
    iconColor: "#0f766e",
  },
  {
    value: "mudra_kishor",
    label: "Mudra Kishor",
    badge: "Small",
    badgeColor: "teal",
    description: "Collateral-free loan for growing micro enterprises. Light CMA required.",
    maxLoan: "Rs. 50K – Rs. 5L",
    subsidy: "No subsidy",
    icon: CreditCard,
    ready: true,
    accent: "#0ea5e9",
    accentSoft: "bg-[#7EEAEA] text-slate-800 border-cyan-300",
    accentBorder: "border-cyan-300",
    iconBg: "#fce7f3",
    iconColor: "#be185d",
  },
  {
    value: "mudra_tarun",
    label: "Mudra Tarun",
    badge: "Medium",
    badgeColor: "teal",
    description: "Collateral-free loan for established micro businesses. Full CMA mandatory.",
    maxLoan: "Rs. 5L – Rs. 10L",
    subsidy: "No subsidy",
    icon: TrendingUp,
    ready: true,
    accent: "#8b5cf6",
    accentSoft: "bg-[#7EEAEA] text-slate-800 border-cyan-300",
    accentBorder: "border-cyan-300",
    iconBg: "#dcfce7",
    iconColor: "#15803d",
  },
  {
    value: "mudra_tarunplus",
    label: "Mudra TarunPlus",
    badge: "Medium+",
    badgeColor: "teal",
    description: "Only for borrowers who have fully repaid a Tarun loan. Collateral-free, full CMA mandatory.",
    maxLoan: "Rs. 10L – Rs. 20L",
    subsidy: "No subsidy",
    icon: TrendingUp,
    ready: true,
    accent: "#ec4899",
    accentSoft: "bg-[#7EEAEA] text-slate-800 border-cyan-300",
    accentBorder: "border-cyan-300",
    iconBg: "#ffedd5",
    iconColor: "#c2410c",
  },
  {
    value: "cgtmse",
    label: "CGTMSE",
    badge: "Guarantee",
    badgeColor: "green",
    description: "Bank loan with Govt guarantee covering 75–85% of default risk. No collateral needed.",
    maxLoan: "Up to Rs. 5 Crore",
    subsidy: "Guarantee only",
    icon: ShieldCheck,
    ready: true,
    accent: "#10b981",
    accentSoft: "bg-[#7EEAEA] text-slate-800 border-cyan-300",
    accentBorder: "border-cyan-300",
    iconBg: "#ede9fe",
    iconColor: "#7c3aed",
  },
  {
    value: "normal_msme",
    label: "MSME PSU Bank",
    badge: "Standard",
    badgeColor: "teal",
    description: "Standard PSU bank MSME loan. Full CMA required. Best for existing businesses.",
    maxLoan: "Rs. 10 Crore+",
    subsidy: "No subsidy",
    icon: Landmark,
    ready: true,
    accent: "#ef4444",
    accentSoft: "bg-[#7EEAEA] text-slate-800 border-cyan-300",
    accentBorder: "border-cyan-300",
    iconBg: "#fce7f3",
    iconColor: "#be185d",
  },
];

interface GTABFormWizardProps {
  applicationId?: string;
  initialStep?: number;
  draftMode?: "fresh" | "resume";
  onComplete?: () => void;
}

export interface GTABFormWizardHandle {
  saveDraft: () => Promise<void>;
  ensureApplicationSaved: () => Promise<string | null>;
}

interface StoredApplicationDraft {
  currentStep?: number;
  formData?: Partial<GTABFormData>;
  updatedAt?: string;
  progressPercentage?: number;
  stepTitle?: string;
  isIndustryConfirmed?: boolean;
}

const clampStep = (step?: number) => {
  if (!step || !Number.isFinite(step)) return 1;
  return Math.min(Math.max(Math.trunc(step), 1), STEPS.length);
};

const scrollFormToTop = () => {
  // The form lives inside a Dialog (overflow-y-auto), so window.scrollTo won't work.
  // Walk up the DOM from the wizard shell and scroll the first scrollable ancestor.
  const shell = document.querySelector(".gtab-application-shell");
  if (!shell) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  let el: HTMLElement | null = shell.parentElement;
  while (el) {
    const { overflowY } = window.getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
      el.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    el = el.parentElement;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
};

const GTABFormWizard = forwardRef<GTABFormWizardHandle, GTABFormWizardProps>(({ applicationId, initialStep, draftMode = "resume", onComplete }, ref) => {
  const [currentStep, setCurrentStep] = useState(() => clampStep(initialStep));
  const [formData, setFormData] = useState<GTABFormData>(INITIAL_FORM_DATA);
  const [isIndustryConfirmed, setIsIndustryConfirmed] = useState(Boolean(applicationId));
  const [isSchemeConfirmed,   setIsSchemeConfirmed]   = useState(Boolean(applicationId));
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [appId, setAppId] = useState<string | null>(applicationId || null);
  const [gtabLoanTypeId, setGtabLoanTypeId] = useState<string | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  // Validation hook
  const validation = useGTABValidation(formData);

  // Fetches resolved financing rules (PMEGP subsidy tiers, promoter %,
  // DSCR benchmark, etc.) from the backend's Rules & Rates engine and
  // writes them into schemeRulesStore — loanRulesEngine.ts's PMEGP
  // calculation functions pick these up automatically everywhere they're
  // called (getFinancingPlan, ApplicationPreview, BankabilityBar, ...),
  // with no other call site needing to change.
  useSchemeRules(formData.loan_scheme);

  const validateCurrentStep = () => {
    // Nothing hard-blocks Next/Save Draft on any step. Marked-* fields, scheme
    // eligibility, and financial ratios are informational only (ValidationStatus
    // panel) so users can save and move on, then come back to fix inputs later.
    return { canProceed: true, message: "" };
  };

  const withTimeout = async <T,>(promise: PromiseLike<T>, timeoutMs = SAVE_TIMEOUT_MS): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Request timed out. Please try again."));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const getNarrativeDraftKey = (id?: string | null) =>
    `${NARRATIVE_DRAFT_PREFIX}${id || user?.id || "new"}`;

  const getApplicationDraftKey = (id?: string | null) =>
    `${APPLICATION_DRAFT_PREFIX}${id || user?.id || "new"}`;

  const loadNarrativeDraft = (id?: string | null): Partial<GTABFormData> => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(getNarrativeDraftKey(id));
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Partial<GTABFormData>;
      return {
        introduction_text: parsed.introduction_text || "",
        market_aspects_text: parsed.market_aspects_text || "",
        management_aspects_text: parsed.management_aspects_text || "",
        technical_aspects_text: parsed.technical_aspects_text || "",
        financial_aspects_text: parsed.financial_aspects_text || "",
      };
    } catch {
      return {};
    }
  };

  const saveNarrativeDraft = (id: string | null, data: GTABFormData) => {
    if (typeof window === "undefined") return;
    try {
      const draft = {
        introduction_text: data.introduction_text || "",
        market_aspects_text: data.market_aspects_text || "",
        management_aspects_text: data.management_aspects_text || "",
        technical_aspects_text: data.technical_aspects_text || "",
        financial_aspects_text: data.financial_aspects_text || "",
      };
      const payload = JSON.stringify(draft);
      window.localStorage.setItem(getNarrativeDraftKey(id), payload);
      // Also mirror to the user-scoped key so the "Resume Draft" flow (which reads
      // the user.id key, not the appId key) always sees the latest edits.
      if (user?.id && id && id !== user.id) {
        window.localStorage.setItem(getNarrativeDraftKey(null), payload);
      }
    } catch {
      // Ignore storage failures to avoid blocking submit flow.
    }
  };

  const parseStoredApplicationDraft = (raw: string): StoredApplicationDraft => {
    const parsed = JSON.parse(raw) as StoredApplicationDraft | Partial<GTABFormData>;
    if ("formData" in parsed) return parsed as StoredApplicationDraft;
    return { formData: parsed as Partial<GTABFormData> };
  };

  const loadApplicationDraftPayload = (id?: string | null): StoredApplicationDraft => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(getApplicationDraftKey(id));
      if (!raw) return {};
      return parseStoredApplicationDraft(raw);
    } catch {
      return {};
    }
  };

  const loadApplicationDraft = (id?: string | null): Partial<GTABFormData> => {
    try {
      const parsed = loadApplicationDraftPayload(id).formData || {};
      return {
        ...parsed,
        plant_machinery: parsePlantMachinery(parsed.plant_machinery),
        project_report_inputs: mergeProjectReportInputs(parsed.project_report_inputs),
      };
    } catch {
      return {};
    }
  };

  const saveApplicationDraft = (id: string | null, data: GTABFormData, step = currentStep) => {
    if (typeof window === "undefined") return;
    try {
      const stepToStore = clampStep(step);
      const payload = JSON.stringify({
        currentStep: stepToStore,
        formData: {
          ...data,
          project_report_inputs: data.project_report_inputs,
        },
        updatedAt: new Date().toISOString(),
        progressPercentage: Math.round((stepToStore / STEPS.length) * 100),
        stepTitle: STEPS[stepToStore - 1]?.title || "",
        isIndustryConfirmed,
      });
      window.localStorage.setItem(getApplicationDraftKey(id), payload);
      // Also mirror to the user-scoped key so "Resume Draft" (which reads the
      // user.id key, not the appId key) restores the latest edits after logout.
      if (user?.id && id && id !== user.id) {
        window.localStorage.setItem(getApplicationDraftKey(null), payload);
      }
    } catch {
      // Local draft backup is best effort only.
    }
  };

  const saveLocalDraft = (step = currentStep, data = formData) => {
    const dataToSave = {
      ...data,
      ...calculateTotals(data),
    };
    saveNarrativeDraft(appId, dataToSave);
    saveApplicationDraft(appId, dataToSave, step);
  };

  useImperativeHandle(ref, () => ({
    saveDraft: async () => {
      saveLocalDraft(currentStep, formData);
    },
    ensureApplicationSaved: async () => saveProgress(false, currentStep, formData, { silent: true }),
  }));

  // Load existing application if ID provided
  useEffect(() => {
    if (applicationId) {
      setIsIndustryConfirmed(true);
      loadApplication(applicationId);
    }
  }, [applicationId]);

  // Autosave a half-filled report on every edit (debounced) so nothing is lost
  // on logout/close. saveProgress writes localStorage always + Supabase if
  // logged in, so the draft is restored on return.
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (isLoading) return;                       // don't clobber during initial load
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void saveProgress(false, currentStep, formData, { silent: true });
    }, 1500);
    return () => clearTimeout(autosaveTimer.current);
  }, [formData, currentStep, isLoading]);

  useEffect(() => {
    if (applicationId) return;
    if (!user?.id) return;
    if (draftMode !== "resume") {
      setFormData(INITIAL_FORM_DATA);
      setCurrentStep(clampStep(initialStep));
      setIsIndustryConfirmed(false);
      setAppId(null);
      return;
    }
    const localDraft = loadApplicationDraftPayload(null);
    const localApplication = loadApplicationDraft(null);
    const localNarratives = loadNarrativeDraft(null);
    if (Object.keys(localApplication).length > 0 || Object.keys(localNarratives).length > 0) {
      setFormData((prev) => ({ ...prev, ...localApplication, ...localNarratives }));
      setCurrentStep(clampStep(localDraft.currentStep || initialStep));
      setIsIndustryConfirmed(Boolean(localDraft.isIndustryConfirmed || localApplication.industry_type));
      setIsSchemeConfirmed(Boolean(localDraft.isIndustryConfirmed || localApplication.loan_scheme));
    }
  }, [applicationId, draftMode, initialStep, user?.id]);

  useEffect(() => {
    if (!gtabLoanTypeId) {
      void fetchGtabLoanTypeId().catch((error) => {
        console.error("Unable to prefetch EazyBizy loan type:", error);
      });
    }
  }, [gtabLoanTypeId]);

  const fetchGtabLoanTypeId = async () => {
    if (gtabLoanTypeId) return gtabLoanTypeId;

    try {
      const preferred = await withTimeout(
        supabase
          .from("loan_types")
          .select("id")
          .eq("name", "EazyBizy MSME")
          .maybeSingle()
      );

      if (preferred.error) throw preferred.error;
      if (preferred.data?.id) {
        setGtabLoanTypeId(preferred.data.id);
        return preferred.data.id;
      }

      const fallback = await withTimeout(
        supabase
          .from("loan_types")
          .select("id")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle()
      );

      if (fallback.error) throw fallback.error;
      if (fallback.data?.id) {
        setGtabLoanTypeId(fallback.data.id);
        return fallback.data.id;
      }

      return null;
    } catch (error) {
      console.error("Error fetching loan type:", error);
      return null;
    }
  };

  const loadApplication = async (id: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("loan_applications")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;

      if (data) {
        const parsedMachinery = parsePlantMachinery(data.plant_machinery);
        const localApplication = loadApplicationDraft(id);
        const localNarratives = loadNarrativeDraft(id);

        setFormData({
          ...INITIAL_FORM_DATA,
          first_name: data.first_name || '',
          middle_name: data.middle_name || '',
          last_name: data.last_name || '',
          gender: data.gender || 'male',
          education: data.education || 'graduate',
          social_category: data.social_category || 'general',
          address_line_1: data.address_line_1 || '',
          address_line_2: data.address_line_2 || '',
          city: data.city || '',
          state: data.state || '',
          pincode: data.pincode || '',
          registration_type: data.registration_type || 'proprietorship',
          contact_mobile: data.contact_mobile || '',
          contact_email: data.contact_email || '',
          business_type: data.business_type || 'new_business',
          business_duration_months: data.business_duration_months || 0,
          business_entity_name: data.business_entity_name || '',
          type_of_business: data.type_of_business || '',
          business_activity_other: data.business_activity_other || '',
          industry_type: data.industry_type || 'manufacturing',
          industry_other: data.industry_other || '',
          loan_scheme: data.loan_scheme || 'mudra',
          loan_scheme_other: data.loan_scheme_other || '',
          loan_purpose: data.loan_purpose || 'term_loan',
          business_description: data.business_description || '',
          products_services: data.products_services || '',
          target_market: data.target_market || '',
          expected_monthly_revenue: Number(data.expected_monthly_revenue) || 0,
          expected_employment: data.expected_employment || 0,
          competitive_advantage: data.competitive_advantage || '',
          promoter_experience: data.promoter_experience || '',
          land_cost: Number(data.land_cost) || 0,
          shed_building_cost: Number(data.shed_building_cost) || 0,
          plant_machinery: parsedMachinery,
          computers_cost: Number(data.computers_cost) || 0,
          furniture_cost: Number(data.furniture_cost) || 0,
          electrification_cost: Number(data.electrification_cost) || 0,
          racks_storage_cost: Number(data.racks_storage_cost) || 0,
          transportation_cost: Number(data.transportation_cost) || 0,
          machinery_installation_cost: Number(data.machinery_installation_cost) || 0,
          other_initial_expenditure: Number(data.other_initial_expenditure) || 0,
          total_project_cost: Number(data.total_project_cost) || 0,
          margin_money: Number(data.margin_money) || 0,
          eligible_loan_amount: Number(data.eligible_loan_amount) || 0,
          monthly_rent: Number(data.monthly_rent) || 0,
          skilled_workers_count: Number(data.skilled_workers_count) || 0,
          skilled_workers_salary: Number(data.skilled_workers_salary) || 0,
          semi_skilled_workers_count: Number(data.semi_skilled_workers_count) || 0,
          semi_skilled_workers_salary: Number(data.semi_skilled_workers_salary) || 0,
          wages_count: Number(data.wages_count) || 0,
          wages_salary: Number(data.wages_salary) || 0,
          employee_count: data.employee_count || 0,
          salary_per_employee: Number(data.salary_per_employee) || 0,
          total_monthly_salary: Number(data.total_monthly_salary) || 0,
          raw_material_cost: Number(data.raw_material_cost) || 0,
          stationery_cost: Number(data.stationery_cost) || 0,
          electricity_water_cost: Number(data.electricity_water_cost) || 0,
          repair_maintenance_cost: Number(data.repair_maintenance_cost) || 0,
          transport_cost: Number(data.transport_cost) || 0,
          telephone_internet_cost: Number(data.telephone_internet_cost) || 0,
          marketing_cost: Number(data.marketing_cost) || 0,
          miscellaneous_cost: Number(data.miscellaneous_cost) || 0,
          total_monthly_expenses: Number(data.total_monthly_expenses) || 0,
          working_capital_required: Number(data.working_capital_required) || 0,
          working_capital_period: data.working_capital_period ?? "monthly",
          project_report_inputs: mergeProjectReportInputs(data.project_report_inputs as any),
          // Narrative texts — load from DB (with localStorage fallback via localNarratives)
          introduction_text:        data.introduction_text        || '',
          market_aspects_text:      data.market_aspects_text      || '',
          management_aspects_text:  data.management_aspects_text  || '',
          technical_aspects_text:   data.technical_aspects_text   || '',
          financial_aspects_text:   data.financial_aspects_text   || '',
          // Scheme + address extras
          area_type: (data.area_type ?? 'rural') as 'urban' | 'rural',
          district: data.district || '',
          implementing_agency: (data.implementing_agency ?? undefined) as 'kvic' | 'kvib' | 'dic' | undefined,
          is_second_loan: data.is_second_loan ?? false,
          negative_list_check: data.negative_list_check ?? false,
          preferred_bank: data.preferred_bank || '',
          // Industry-specific fields — restore from JSONB
          ...((isd: any) => !isd ? {} : {
            production_capacity_units:   isd.production_capacity_units,
            production_cost_per_unit:    isd.production_cost_per_unit,
            selling_price_per_unit:      isd.selling_price_per_unit,
            production_utilization_pct:  isd.production_utilization_pct,
            machinery_total_cost:        isd.machinery_total_cost,
            machinery_type:              isd.machinery_type,
            machinery_supplier_name:     isd.machinery_supplier_name,
            raw_material_pct:            isd.raw_material_pct,
            primary_raw_material:        isd.primary_raw_material,
            raw_material_supplier:       isd.raw_material_supplier,
            service_rate_unit:           isd.service_rate_unit,
            monthly_clients_count:       isd.monthly_clients_count,
            service_utilization_pct:     isd.service_utilization_pct,
            average_inventory_value:     isd.average_inventory_value,
            inventory_pct:               isd.inventory_pct,
            monthly_purchase_value:      isd.monthly_purchase_value,
            gross_margin:                isd.gross_margin,
            stock_turnover_ratio:        isd.stock_turnover_ratio,
            supplier_credit_days:        isd.supplier_credit_days,
            primary_supplier_name:       isd.primary_supplier_name,
            customer_credit_days:        isd.customer_credit_days,
            main_crop:                   isd.main_crop,
            farming_type:                isd.farming_type,
            land_utilization_pct:        isd.land_utilization_pct,
            land_area_acres:             isd.land_area_acres,
            expected_annual_yield:       isd.expected_annual_yield,
            agricultural_selling_price:  isd.agricultural_selling_price,
            yield_variability_pct:       isd.yield_variability_pct,
            seeds_inputs_cost:           isd.seeds_inputs_cost,
            fertilizer_pesticide_cost:   isd.fertilizer_pesticide_cost,
            labour_cost_seasonal:        isd.labour_cost_seasonal,
            irrigation_cost:             isd.irrigation_cost,
          })(data.industry_specific_data),
          ...localApplication,
          ...localNarratives,
        });
        setCurrentStep(initialStep ? clampStep(initialStep) : data.current_step || 1);
      }
    } catch (error: any) {
      toast({
        title: "Error loading application",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const updateFormData = (updates: Partial<GTABFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const selectIndustry = (industryType: Exclude<GTABIndustryType, "others">) => {
    updateFormData({
      industry_type: industryType,
      industry_other: "",
      type_of_business: "",
      business_activity_other: "",
      land_cost: 0,
      shed_building_cost: 0,
      plant_machinery: [],
      machinery_installation_cost: 0,
      computers_cost: 0,
      furniture_cost: 0,
      electrification_cost: 0,
      racks_storage_cost: 0,
      transportation_cost: 0,
      other_initial_expenditure: 0,
    });
  };

  const confirmIndustry = () => {
    if (!["manufacturing", "service", "trading", "agriculture"].includes(formData.industry_type)) {
      toast({
        title: "Industry fields coming next",
        description: "Manufacturing, Service, Trading and Agriculture are ready now.",
        variant: "destructive",
      });
      return;
    }
    setIsIndustryConfirmed(true);
    setIsSchemeConfirmed(false); // show scheme picker next
    scrollFormToTop();
  };

  const selectScheme = (schemeValue: string) => {
    updateFormData({ loan_scheme: schemeValue as GTABFormData["loan_scheme"] });
  };

  const confirmScheme = () => {
    if (!formData.loan_scheme) {
      toast({ title: "Select a loan scheme", description: "Choose the scheme that best fits your project.", variant: "destructive" });
      return;
    }
    setIsSchemeConfirmed(true);
    setTimeout(scrollFormToTop, 0);
  };

  // Calculate totals
  const calculateTotals = (data: GTABFormData = formData) => {
    // getFinancingPlan (→ getProjectCostBreakdown) is the single source of
    // truth for Total Project Cost: Fixed Capital + promoter's WC margin
    // only — never the full WC requirement. Don't duplicate that formula here.
    const financingPlan = getFinancingPlan(data);
    const normalizedProjectCost = financingPlan.totalProjectCost;
    const marginMoney = financingPlan.promoterContribution;
    const eligibleLoanAmount = financingPlan.totalBankFinance;

    const structuredMonthlySalary =
      Number(data.skilled_workers_count || 0) * Number(data.skilled_workers_salary || 0) +
      Number(data.semi_skilled_workers_count || 0) * Number(data.semi_skilled_workers_salary || 0) +
      Number(data.wages_count || 0) * Number(data.wages_salary || 0);
    const totalMonthlySalary =
      structuredMonthlySalary ||
      Number(data.employee_count || 0) * Number(data.salary_per_employee || 0);

    const totalMonthlyExpenses =
      Number(data.monthly_rent || 0) +
      totalMonthlySalary +
      Number(data.raw_material_cost || 0) +
      Number(data.stationery_cost || 0) +
      Number(data.electricity_water_cost || 0) +
      Number(data.repair_maintenance_cost || 0) +
      Number(data.transport_cost || 0) +
      Number(data.telephone_internet_cost || 0) +
      Number(data.marketing_cost || 0) +
      Number(data.miscellaneous_cost || 0);

    return {
      total_project_cost: normalizedProjectCost,
      margin_money: marginMoney,
      eligible_loan_amount: eligibleLoanAmount,
      total_monthly_salary: totalMonthlySalary,
      total_monthly_expenses: totalMonthlyExpenses,
    };
  };

  const saveProgress = async (
    submit = false,
    stepOverride?: number,
    dataOverride?: GTABFormData,
    options: { silent?: boolean } = {},
  ): Promise<string | null> => {
    const stepToPersist = stepOverride ?? currentStep;
    const baseData = dataOverride ?? formData;
    const totals = calculateTotals(baseData);
    const dataToSave: GTABFormData = {
      ...baseData,
      ...totals,
    };
    saveNarrativeDraft(appId, dataToSave);
    saveApplicationDraft(appId, dataToSave, stepToPersist);

    if (!user) {
      if (!options.silent) {
        toast({
          title: "Saved in this browser",
          description: "Login is required to sync this application to Supabase.",
          variant: "destructive",
        });
      }
      return null;
    }

    if (isSaving) return appId;

    setIsSaving(true);
    const safetyTimer = setTimeout(() => {
      setIsSaving(false);
      toast({
        title: "Save timed out",
        description: "The request took too long. Please try again.",
        variant: "destructive",
      });
    }, SAVE_TIMEOUT_MS + 2000);

    try {
      const loanTypeId = await fetchGtabLoanTypeId();
      if (!loanTypeId) {
        throw new Error(
          "Supabase is missing the EazyBizy MSME loan type. Run the loan type SQL migration, then save again.",
        );
      }

      // Convert plant_machinery to JSON-compatible format
      const plantMachineryJson = dataToSave.plant_machinery.map(item => ({
        id: item.id,
        machine_name: item.machine_name,
        quantity: Number(item.quantity) || 1,
        unit_cost: Number(item.unit_cost) || Number(item.cost) || 0,
        cost:
          Number(item.cost) ||
          (Number(item.quantity) || 1) * (Number(item.unit_cost) || Number(item.cost) || 0),
        machine_cost: Number(item.machine_cost) || Number(item.cost) || 0,
        installation_cost: Number(item.installation_cost) || 0,
        other_capital_cost: Number(item.other_capital_cost) || 0,
        total_cost: Number(item.total_cost) || Number(item.cost) || 0,
        purchase_date: item.purchase_date,
        supplier_name: item.supplier_name,
        supplier_city: item.supplier_city,
        supplier_phone: item.supplier_phone,
        supplier_email: item.supplier_email,
      }));



      const applicationData = {
        user_id: user.id,
        loan_type_id: loanTypeId,
        amount: totals.eligible_loan_amount,
        tenure_months: DEFAULT_TENURE_MONTHS,
        first_name: dataToSave.first_name,
        middle_name: dataToSave.middle_name,
        last_name: dataToSave.last_name,
        gender: dataToSave.gender,
        education: dataToSave.education,
        social_category: dataToSave.social_category,
        address_line_1: dataToSave.address_line_1,
        address_line_2: dataToSave.address_line_2,
        city: dataToSave.city,
        state: dataToSave.state,
        pincode: dataToSave.pincode,
        registration_type: dataToSave.registration_type,
        contact_mobile: dataToSave.contact_mobile,
        contact_email: dataToSave.contact_email,
        business_type: dataToSave.business_type,
        business_duration_months: dataToSave.business_duration_months,
        business_entity_name: dataToSave.business_entity_name,
        type_of_business: dataToSave.type_of_business,
        industry_type: dataToSave.industry_type,
        industry_other: dataToSave.industry_other,
        loan_scheme: dataToSave.loan_scheme,
        loan_scheme_other: dataToSave.loan_scheme_other,
        loan_purpose: dataToSave.loan_purpose,
        business_description: dataToSave.business_description,
        products_services: dataToSave.products_services,
        target_market: dataToSave.target_market,
        expected_monthly_revenue: dataToSave.expected_monthly_revenue,
        expected_employment: dataToSave.expected_employment,
        competitive_advantage: dataToSave.competitive_advantage,
        promoter_experience: dataToSave.promoter_experience,
        land_cost: dataToSave.land_cost,
        shed_building_cost: dataToSave.shed_building_cost,
        plant_machinery: plantMachineryJson,
        computers_cost: dataToSave.computers_cost,
        furniture_cost: dataToSave.furniture_cost,
        electrification_cost: dataToSave.electrification_cost,
        racks_storage_cost: dataToSave.racks_storage_cost,
        transportation_cost: dataToSave.transportation_cost,
        machinery_installation_cost: dataToSave.machinery_installation_cost,
        other_initial_expenditure: dataToSave.other_initial_expenditure,
        monthly_rent: dataToSave.monthly_rent,
        skilled_workers_count: dataToSave.skilled_workers_count,
        skilled_workers_salary: dataToSave.skilled_workers_salary,
        semi_skilled_workers_count: dataToSave.semi_skilled_workers_count,
        semi_skilled_workers_salary: dataToSave.semi_skilled_workers_salary,
        wages_count: dataToSave.wages_count,
        wages_salary: dataToSave.wages_salary,
        employee_count: dataToSave.employee_count,
        salary_per_employee: dataToSave.salary_per_employee,
        raw_material_cost: dataToSave.raw_material_cost,
        stationery_cost: dataToSave.stationery_cost,
        electricity_water_cost: dataToSave.electricity_water_cost,
        repair_maintenance_cost: dataToSave.repair_maintenance_cost,
        transport_cost: dataToSave.transport_cost,
        telephone_internet_cost: dataToSave.telephone_internet_cost,
        marketing_cost: dataToSave.marketing_cost,
        miscellaneous_cost: dataToSave.miscellaneous_cost,
        working_capital_required: dataToSave.working_capital_required,
        working_capital_period: dataToSave.working_capital_period,
        project_report_inputs: dataToSave.project_report_inputs as unknown as Json,
        // Narrative texts — saved to DB so they survive browser cache clear
        introduction_text:        dataToSave.introduction_text        || null,
        market_aspects_text:      dataToSave.market_aspects_text      || null,
        management_aspects_text:  dataToSave.management_aspects_text  || null,
        technical_aspects_text:   dataToSave.technical_aspects_text   || null,
        financial_aspects_text:   dataToSave.financial_aspects_text   || null,
        area_type: dataToSave.area_type,
        district: dataToSave.district || dataToSave.city || null,
        implementing_agency: dataToSave.implementing_agency ?? null,
        is_second_loan: dataToSave.is_second_loan ?? false,
        negative_list_check: dataToSave.negative_list_check ?? false,
        preferred_bank: dataToSave.preferred_bank || null,
        industry_specific_data: {
          // Manufacturing
          production_capacity_units:   dataToSave.production_capacity_units,
          production_cost_per_unit:    dataToSave.production_cost_per_unit,
          selling_price_per_unit:      dataToSave.selling_price_per_unit,
          production_utilization_pct:  dataToSave.production_utilization_pct,
          machinery_total_cost:        dataToSave.machinery_total_cost,
          machinery_type:              dataToSave.machinery_type,
          machinery_supplier_name:     dataToSave.machinery_supplier_name,
          raw_material_pct:            dataToSave.raw_material_pct,
          primary_raw_material:        dataToSave.primary_raw_material,
          raw_material_supplier:       dataToSave.raw_material_supplier,
          // Service
          service_rate_unit:           dataToSave.service_rate_unit,
          monthly_clients_count:       dataToSave.monthly_clients_count,
          service_utilization_pct:     dataToSave.service_utilization_pct,
          // Trading
          average_inventory_value:     dataToSave.average_inventory_value,
          inventory_pct:               dataToSave.inventory_pct,
          monthly_purchase_value:      dataToSave.monthly_purchase_value,
          gross_margin:                dataToSave.gross_margin,
          stock_turnover_ratio:        dataToSave.stock_turnover_ratio,
          supplier_credit_days:        dataToSave.supplier_credit_days,
          primary_supplier_name:       dataToSave.primary_supplier_name,
          customer_credit_days:        dataToSave.customer_credit_days,
          // Agriculture
          main_crop:                   dataToSave.main_crop,
          farming_type:                dataToSave.farming_type,
          land_utilization_pct:        dataToSave.land_utilization_pct,
          land_area_acres:             dataToSave.land_area_acres,
          expected_annual_yield:       dataToSave.expected_annual_yield,
          agricultural_selling_price:  dataToSave.agricultural_selling_price,
          yield_variability_pct:       dataToSave.yield_variability_pct,
          seeds_inputs_cost:           dataToSave.seeds_inputs_cost,
          fertilizer_pesticide_cost:   dataToSave.fertilizer_pesticide_cost,
          labour_cost_seasonal:        dataToSave.labour_cost_seasonal,
          irrigation_cost:             dataToSave.irrigation_cost,
        } as unknown as Json,
        ...totals,
        current_step: stepToPersist,
        status: submit ? "submitted" as const : "draft" as const,
        submitted_at: submit ? new Date().toISOString() : null,
      };

      const persistApplicationData = async (payload: Record<string, unknown>) => {
        if (appId) {
          const { error } = await withTimeout(
            supabase
              .from("loan_applications")
              .update(payload as never)
              .eq("id", appId)
          );

          if (error) throw error;
          return appId;
        }

        const { data, error } = await withTimeout(
          supabase
            .from("loan_applications")
            .insert(payload as never)
            .select("id")
            .single()
        );

        if (error) throw error;
        return data.id as string;
      };

      let savedId: string;
      try {
        savedId = await persistApplicationData(applicationData);
      } catch (error: any) {
        const message = `${error?.message || ""} ${error?.details || ""}`;
        if (!message.includes("project_report_inputs")) throw error;

        const { project_report_inputs: _projectReportInputs, ...fallbackData } = applicationData;
        savedId = await persistApplicationData(fallbackData);
      }

      if (!appId) {
        setAppId(savedId);
      }
      saveNarrativeDraft(savedId, dataToSave);
      saveApplicationDraft(savedId, dataToSave, stepToPersist);

      if (!options.silent) {
        toast({
          title: submit ? "Application Submitted!" : "Progress Saved",
          description: submit
            ? "Your EazyBizy application has been submitted successfully."
            : "Your progress has been saved.",
        });
      }

      if (submit && onComplete) {
        onComplete();
      }
      return savedId;
    } catch (error: any) {
      saveApplicationDraft(appId, dataToSave, stepToPersist);
      if (!options.silent) {
        toast({
          title: "Saved locally, Supabase sync failed",
          description: `${error.message || "Remote save failed."} Your browser draft is safe.`,
          variant: "destructive",
        });
      }
      return appId;
    } finally {
      clearTimeout(safetyTimer);
      setIsSaving(false);
    }
  };

  const nextStep = async () => {
    const stepValidation = validateCurrentStep();
    if (!stepValidation.canProceed) {
      toast({
        title: "Please fix validation errors",
        description: stepValidation.message,
        variant: "destructive",
      });
      return;
    }

    if (currentStep < STEPS.length) {
      const nextStepNumber = currentStep + 1;
      let nextFormData = formData;
      if (currentStep === 7 || currentStep === 9) {
        nextFormData = { ...formData, ...calculateTotals(formData) };
        setFormData(nextFormData);
      }
      // Auto-save local draft on every step advance
      saveLocalDraft(currentStep, nextFormData);
      // Fire Supabase save in background — don't block navigation
      void saveProgress(false, currentStep, nextFormData, { silent: true });
      setCurrentStep(nextStepNumber);
      scrollFormToTop();
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = () => {
    if (isSaving) return;
    saveProgress(true, currentStep);
  };

  const progress = (currentStep / STEPS.length) * 100;
  const totals = calculateTotals();

  // Per-step completeness (raw inputs only — banker-critical fields per step).
  // Drives the ✓ / amber-gap markers in the stepper.
  const isStepComplete = (id: number): boolean => {
    const p = formData.project_report_inputs?.promoter;
    switch (id) {
      case 1: return !!(
        formData.first_name && formData.last_name && p?.pan_number && p?.date_of_birth
        && formData.address_line_1 && formData.city && formData.state && formData.pincode && formData.contact_mobile?.length === 10
      );
      case 2: return !!(formData.business_entity_name && formData.loan_scheme && formData.type_of_business);
      case 3: return !!(formData.business_description || formData.products_services);
      case 4: {
        const r = formData.project_report_inputs;
        return (r?.revenue?.product_categories?.length ?? 0) > 0
          || Number(r?.dpr?.selling_price_per_unit || 0) > 0
          || Number(r?.dpr?.selling_price_per_kg || 0) > 0;
      }
      case 5: return Number(totals.total_project_cost) > 0;
      case 6: return true; // working capital is optional at input stage
      case 7: return Number(totals.total_project_cost) > 0 || (formData.plant_machinery?.length ?? 0) > 0;
      case 8: return true; // depreciation schedule is auto-calculated, always complete
      case 9: return Number(totals.total_monthly_expenses) > 0;
      case 10: return true;
      default: return false;
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-4 sm:space-y-6">
            <PersonalInfoStep formData={formData} updateFormData={updateFormData} />
            <BusinessInfoStep formData={formData} updateFormData={updateFormData} />
          </div>
        );
      case 2:
        return <BusinessLoanDetailsStep formData={formData} updateFormData={updateFormData} />;
      case 3:
        return <BusinessDescriptionStep formData={formData} updateFormData={updateFormData} />;
      case 4:
        return <ProjectReportInputsStep formData={formData} updateFormData={updateFormData} />;
      case 5:
        return (
          <ProjectSummaryStep
            formData={formData}
            updateFormData={updateFormData}
            totals={totals}
          />
        );
      case 6:
        return <WorkingCapitalStep formData={formData} updateFormData={updateFormData} />;
      case 7:
        return <ProjectRequirementsStep formData={formData} updateFormData={updateFormData} />;
      case 8:
        return <DepreciationScheduleStep formData={formData} />;
      case 9:
        return <MonthlyExpensesStep formData={formData} updateFormData={updateFormData} />;
      case 10:
        return (
          <ApplicationPreview
            formData={formData}
            applicationId={appId}
            onSubmit={handleSubmit}
            onEnsureSaved={() => saveProgress(false, currentStep, formData, { silent: true })}
            isSaving={isSaving}
          />
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isIndustryConfirmed) {
    const selectedIndustry = INDUSTRY_CHOICES.find((choice) => choice.value === formData.industry_type);
    const canContinueIndustry = ["manufacturing", "service", "trading", "agriculture"].includes(formData.industry_type);

    return (
      <div className="mx-auto w-full max-w-none rounded-[1.25rem] bg-[#030608] p-3 text-gray-900 sm:p-5">
        <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white text-slate-900 shadow-[0_8px_22px_rgba(15,23,42,0.10)]">
          <div className="border-b border-slate-200 bg-white px-5 py-5 sm:px-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] border border-[#1677ff]/20 bg-[#1677ff]/10 text-[#1677ff]">
                  <Layers3 className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-2xl font-bold text-gray-900">Choose Industry</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                    Select the industry first so the application shows the right input fields and calculations.
                  </p>
                </div>
              </div>
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[#1677ff]/30 bg-[#1677ff]/10 px-3 py-1.5 text-xs font-semibold text-[#1677ff] shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-[#1677ff] opacity-70" />
                Step Setup
              </span>
            </div>
          </div>

          <div className="bg-white p-5 sm:p-7">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {INDUSTRY_CHOICES.map((choice) => {
              const Icon = choice.icon;
              const checked = formData.industry_type === choice.value;
              const isReady = ["manufacturing", "service", "trading", "agriculture"].includes(choice.value);
              const checkedStyle = checked
                ? `border-2 ${choice.accentBorder} shadow-[0_10px_24px_rgba(15,23,42,0.08)] ring-1 ring-offset-0 ${choice.accentSoft}`
                : `border ${choice.accentBorder} ${choice.accentSoft} hover:shadow-md`;

              return (
                <div
                  key={choice.value}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectIndustry(choice.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectIndustry(choice.value);
                    }
                  }}
                  className={`group flex min-h-[150px] items-start gap-4 rounded-[1.1rem] border p-5 text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-slate-300 ${checkedStyle}`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(nextChecked) => {
                      if (nextChecked) selectIndustry(choice.value);
                    }}
                    className={`mt-1 h-5 w-5 rounded-full border-2 bg-transparent ${
                      checked
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 data-[state=checked]:bg-slate-900"
                    }`}
                  />
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] border-0"
                          style={{ backgroundColor: choice.iconBg, color: choice.iconColor }}
                        >
                          <Icon className="h-6 w-6" />
                        </span>
                        <span className="text-lg font-bold text-gray-900">{choice.label}</span>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                          isReady
                            ? "border-transparent text-white"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                        style={isReady ? { backgroundColor: choice.accent } : undefined}
                      >
                        {isReady ? "Ready" : "Next"}
                      </span>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-slate-600">{choice.description}</p>
                  </div>
                </div>
              );
            })}
            </div>

            {!canContinueIndustry ? (
              <div className="mt-5 rounded-[1rem] border border-[#D4AF37]/25 bg-[#D4AF37]/10 px-4 py-3 text-sm leading-6 text-[#F5D778]">
                {selectedIndustry?.label} is selected. Its custom input fields are not configured yet, so the current
                manufacturing calculations and API payload will stay locked.
              </div>
            ) : null}

            <div className="mt-7 flex justify-end">
              <Button
                onClick={confirmIndustry}
                className="h-12 min-w-[160px] gap-2 rounded-lg bg-[#1677ff] px-6 font-bold text-white shadow-[0_10px_20px_rgba(22,119,255,0.24)] hover:bg-[#0f66d6]"
              >
                Continue
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2: Choose Loan Scheme ─────────────────────────────────────────────
  if (isIndustryConfirmed && !isSchemeConfirmed) {
    const badgeClass = (color: SchemeChoice['badgeColor']) => {
      if (color === 'gold')  return 'border-[#D4AF37]/30 bg-[#D4AF37]/10 text-[#F5D778]';
      if (color === 'green') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300';
      return 'border-[#1677ff]/20 bg-[#1677ff]/10 text-[#1677ff]';
    };

    return (
      <div className="mx-auto w-full max-w-none rounded-[1.25rem] bg-[#030608] p-3 text-gray-900 sm:p-5">
        <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white text-slate-900 shadow-[0_8px_22px_rgba(15,23,42,0.10)]">

          {/* Header */}
          <div className="border-b border-slate-200 bg-white px-5 py-5 sm:px-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                {/* Back to industry */}
                <button
                  onClick={() => setIsIndustryConfirmed(false)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-[#1677ff]/40 hover:text-[#1677ff] transition"
                  aria-label="Back to industry"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] border border-[#1677ff]/20 bg-[#1677ff]/10 text-[#1677ff]">
                  <CreditCard className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold text-gray-900">Choose Loan Scheme</h2>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-500">
                      Industry: <span className="font-semibold capitalize text-[#1677ff]">{formData.industry_type}</span>
                    </span>
                  </div>
                  <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">
                    Select the government scheme that best matches your project size and category.
                    This drives the financing split, subsidy calculation, and CMA structure.
                  </p>
                </div>
              </div>
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[#1677ff]/30 bg-[#1677ff]/10 px-3 py-1.5 text-xs font-semibold text-[#1677ff] shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-[#1677ff] opacity-70" />
                Step Setup
              </span>
            </div>
          </div>

          {/* Scheme cards */}
          <div className="bg-white p-5 sm:p-7">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {SCHEME_CHOICES.map((scheme) => {
                const Icon = scheme.icon;
                const checked = formData.loan_scheme === scheme.value;
                const checkedStyle = checked
                  ? `border-2 ${scheme.accentBorder} shadow-[0_10px_24px_rgba(15,23,42,0.08)] ring-1 ring-offset-0 ${scheme.accentSoft}`
                  : `border ${scheme.accentBorder} ${scheme.accentSoft} hover:shadow-md`;

                return (
                  <div
                    key={scheme.value}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectScheme(scheme.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectScheme(scheme.value); }}}
                    className={`group flex min-h-[170px] flex-col gap-3 rounded-[1.1rem] border p-5 text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-slate-300 cursor-pointer ${checkedStyle}`}
                  >
                    {/* Card header */}
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => { if (v) selectScheme(scheme.value); }}
                        className={`shrink-0 h-5 w-5 rounded-full border-2 bg-transparent ${
                          checked ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'
                        }`}
                      />
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.8rem] border-0"
                        style={{ backgroundColor: scheme.iconBg, color: scheme.iconColor }}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-base font-bold text-gray-900 leading-tight">{scheme.label}</span>
                        <span
                          className={`w-fit rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                            checked ? `${scheme.accentSoft} border-transparent` : badgeClass(scheme.badgeColor)
                          }`}
                        >
                          {scheme.badge}
                        </span>
                      </div>
                    </div>

                    {/* Description */}
                    <p className="flex-1 text-sm leading-5 text-slate-700">{scheme.description}</p>

                    {/* Key numbers */}
                    <div className="mt-auto grid grid-cols-2 gap-2 border-t border-cyan-300/50 pt-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Max Loan</p>
                        <p className="mt-0.5 text-xs font-semibold text-slate-800">{scheme.maxLoan}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Subsidy</p>
                        <p className={`mt-0.5 text-xs font-semibold ${scheme.subsidy !== 'No subsidy' ? 'text-amber-600' : 'text-slate-500'}`}>{scheme.subsidy}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* PMEGP area type (only when PMEGP selected) */}
            {formData.loan_scheme === 'pmegp' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-5 rounded-[1rem] border border-amber-200 bg-amber-50/70 p-4"
              >
                  <p className="mb-3 text-sm font-semibold text-amber-700">
                  PMEGP — Area Type <span className="font-normal text-slate-500">(affects subsidy %)</span>
                </p>
                <div className="flex gap-3">
                  {[
                    { value: 'rural',  label: 'Rural',  note: 'General 25% / Special 35%' },
                    { value: 'urban',  label: 'Urban',  note: 'General 15% / Special 25%' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateFormData({ area_type: opt.value as 'urban' | 'rural' })}
                      className={`flex flex-1 flex-col rounded-[0.8rem] border p-3 text-left transition ${
                        formData.area_type === opt.value
                          ? 'border-amber-400 bg-amber-100'
                          : 'border-slate-200 bg-white hover:border-amber-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`h-4 w-4 rounded-full border-2 ${formData.area_type === opt.value ? 'border-[#D4AF37] bg-[#D4AF37]' : 'border-white/30'}`} />
                        <span className="text-sm font-semibold text-gray-900">{opt.label}</span>
                      </div>
                      <span className="mt-1 text-xs text-amber-700">{opt.note}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            <div className="mt-7 flex items-center justify-between">
              <button
                onClick={() => setIsIndustryConfirmed(false)}
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 transition"
              >
                <ChevronLeft className="h-4 w-4" />
                Back to Industry
              </button>
              <Button
                onClick={confirmScheme}
                disabled={!formData.loan_scheme}
                className="h-12 min-w-[160px] gap-2 rounded-lg bg-[#1677ff] px-6 font-bold text-white shadow-[0_10px_20px_rgba(22,119,255,0.24)] hover:bg-[#0f66d6] disabled:opacity-50"
              >
                Continue
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="gtab-application-shell mx-auto w-full max-w-none overflow-x-hidden rounded-[1.25rem] bg-[#030608] p-3 text-gray-900 sm:p-5">
      {/* AI Insight Panel — floats as right-side panel across all steps */}
      {currentStep < 10 && (
        <AIInsightPanel
          formData={formData}
          currentStep={currentStep}
          onSwitchScheme={(schemeId) => updateFormData({ loan_scheme: schemeId as any })}
        />
      )}
      {/* Progress Header — a distinct raised panel, not flat white-on-white */}
      <div className="relative rounded-[0.85rem] border border-slate-200 bg-white p-4 pb-5 shadow-[0_8px_22px_rgba(15,23,42,0.10)] sm:p-6 sm:pb-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="min-w-0 text-3xl font-extrabold leading-tight text-gray-900">
            {STEPS[currentStep - 1].title}
          </h2>
          <span className="shrink-0 text-lg font-medium text-gray-500" style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.01em' }}>
            Step {currentStep} of {STEPS.length}
          </span>
        </div>
        <Progress value={progress} className="mt-5 h-2 bg-slate-100 shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] [&>div]:bg-[#1677ff]" />

        {/* Step Indicators — click any step to jump directly */}
        {/* lg:grid-cols must equal STEPS.length (currently 10) — a mismatch
            here is exactly what wrapped "Final Review" onto its own row. */}

        {/* Mobile-only: all step circles in a scrollable row */}
        <div className="mt-5 flex snap-x gap-2 overflow-x-auto px-1 py-2 lg:hidden">
          {STEPS.map((step) => {
            const isActive   = step.id === currentStep;
            const isDone     = step.id < currentStep;
            const isComplete = isStepComplete(step.id);
            const isGap      = isDone && !isComplete;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => {
                  if (step.id === currentStep) return;
                  saveLocalDraft(currentStep, formData);
                  void saveProgress(false, currentStep, formData, { silent: true });
                  setCurrentStep(step.id);
                  scrollFormToTop();
                }}
                className="flex shrink-0 snap-start flex-col items-center gap-1"
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-all duration-200
                    ${isActive
                      ? "border-[#1677ff] bg-[#1677ff] text-white shadow-[0_0_0_3px_rgba(22,119,255,0.16),0_4px_10px_-2px_rgba(22,119,255,0.35)] -translate-y-0.5"
                      : isComplete
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-600"
                        : isGap
                          ? "border-amber-400 bg-amber-50 text-amber-600"
                          : "border-gray-300 bg-white text-gray-400"
                    }`}
                >
                  {isComplete && !isActive ? <Check className="w-3 h-3" /> : step.id}
                </div>
              </button>
            );
          })}
        </div>

        <div className="gtab-step-scroll mt-6 hidden snap-x gap-4 overflow-x-auto pb-3 pt-2 lg:grid lg:grid-cols-10 lg:gap-2 lg:overflow-visible lg:pb-2 lg:pt-0">
          {STEPS.map((step) => {
            const isActive   = step.id === currentStep;
            const isDone     = step.id < currentStep;
            const isFuture   = step.id > currentStep;
            const isComplete = isStepComplete(step.id);
            const isGap      = isDone && !isComplete; // visited but missing required data

            return (
              <button
                key={step.id}
                type="button"
                onClick={() => {
                  if (step.id === currentStep) return;
                  // Auto-save current state before jumping
                  saveLocalDraft(currentStep, formData);
                  void saveProgress(false, currentStep, formData, { silent: true });
                  setCurrentStep(step.id);
                  scrollFormToTop();
                }}
                title={`Go to ${step.title}`}
                className={`flex min-w-[108px] shrink-0 snap-start flex-col items-center text-center sm:min-w-[118px] lg:min-w-0
                  transition-opacity
                  ${isFuture ? "opacity-60 hover:opacity-100" : ""}
                  ${isActive ? "cursor-default" : "cursor-pointer"}
                `}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-medium transition-all duration-200
                    ${isActive
                      ? "border-[#1677ff] bg-[#1677ff] text-white shadow-[0_0_0_3px_rgba(22,119,255,0.16),0_6px_14px_-2px_rgba(22,119,255,0.35),0_2px_4px_rgba(15,23,42,0.15)] -translate-y-0.5"
                      : isComplete
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-600 shadow-[0_3px_8px_-1px_rgba(16,185,129,0.3),0_1px_2px_rgba(15,23,42,0.06)] hover:bg-emerald-500/25 hover:-translate-y-0.5"
                        : isGap
                          ? "border-amber-400 bg-amber-50 text-amber-600 shadow-[0_3px_8px_-1px_rgba(217,119,6,0.25)] hover:bg-amber-100 hover:-translate-y-0.5"
                          : "border-gray-300 bg-white text-gray-500 shadow-[0_2px_5px_rgba(15,23,42,0.08)] hover:border-[#1677ff] hover:text-[#1677ff] hover:-translate-y-0.5"
                    }`}
                  title={isGap ? "Some required details are missing" : undefined}
                >
                  {isComplete ? <Check className="w-4 h-4" /> : step.id}
                </div>
                <span
                  className={`gtab-step-label mt-2 block w-full max-w-[104px] whitespace-normal text-center sm:max-w-[112px] lg:max-w-[92px] ${
                    isActive ? "font-semibold text-[#1677ff]" : isDone ? "text-[#1677ff]" : "text-gray-400"
                  }`}
                >
                  {step.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bankability strip — live figures a banker checks first (money steps) */}
      {currentStep >= 4 && currentStep <= 9 && (
        <div className="mt-4">
          <BankabilityBar formData={formData} />
        </div>
      )}

      {/* Form Content */}
      <div className="mt-4 min-w-0 sm:mt-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden rounded-[0.85rem] border border-slate-200 bg-white p-2 shadow-[0_8px_22px_rgba(15,23,42,0.10)] sm:p-6 md:p-8"
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>
      </div>

      {/* Validation Status */}
      <div className="mt-4">
        <ValidationStatus validation={validation} currentStep={currentStep} formData={formData} onNavigate={(s) => setCurrentStep(clampStep(s))} />
      </div>

      {/* Navigation Buttons */}
      <div className="gtab-action-bar relative mt-4 grid grid-cols-1 gap-3 rounded-[0.85rem] border border-slate-200 bg-white p-3 shadow-[0_8px_22px_rgba(15,23,42,0.10)] sm:mt-6 sm:flex sm:flex-row sm:justify-between sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        <Button
          variant="outline"
          onClick={prevStep}
          disabled={currentStep === 1}
          className="h-12 w-full rounded-[1.05rem] border border-white/80 bg-white text-sm font-semibold text-slate-900 shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_8px_18px_rgba(15,23,42,0.18)] transition-all hover:-translate-y-0.5 hover:bg-slate-100 hover:text-slate-900 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.18),0_12px_22px_rgba(15,23,42,0.24)] disabled:cursor-not-allowed disabled:opacity-60 sm:h-11 sm:w-auto"
        >
          <ChevronLeft className="w-4 h-4" />
          Previous
        </Button>

        <div className="grid grid-cols-2 gap-3 sm:flex sm:gap-2">
          <Button
            variant="outline"
            onClick={() => saveProgress(false)}
            disabled={isSaving}
            className="h-12 rounded-[1.05rem] border border-white/80 bg-white text-sm font-semibold text-slate-900 shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_8px_18px_rgba(15,23,42,0.18)] transition-all hover:-translate-y-0.5 hover:bg-slate-100 hover:text-slate-900 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.18),0_12px_22px_rgba(15,23,42,0.24)] disabled:cursor-not-allowed disabled:opacity-60 sm:h-11"
          >
            <Save className="w-4 h-4" />
            {isSaving ? "Saving..." : "Save Draft"}
          </Button>

          {currentStep < STEPS.length ? (
            <Button
              onClick={nextStep}
              className="h-12 rounded-lg bg-[#1677ff] text-sm font-bold text-white shadow-[0_2px_4px_rgba(15,23,42,0.15),0_12px_22px_-4px_rgba(22,119,255,0.32)] transition-transform hover:-translate-y-0.5 hover:bg-[#0f66d6] hover:shadow-[0_4px_8px_rgba(15,23,42,0.18),0_16px_26px_-4px_rgba(22,119,255,0.38)] active:translate-y-0 sm:h-11"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
});

export default GTABFormWizard;
