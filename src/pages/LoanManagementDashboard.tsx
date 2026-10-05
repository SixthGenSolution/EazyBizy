import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  FileText,
  FolderPlus,
  LayoutDashboard,
  LogOut,
  Menu,
  Maximize2,
  Minimize2,
  Minus,
  PencilLine,
  Percent,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  User,
  Users,
  X,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import GTABFormWizard from "@/components/gtab/GTABFormWizard";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "applications", label: "Applications", icon: FileText },
  { id: "documents", label: "Documents", icon: FolderPlus },
  { id: "loan-details", label: "Loan Details", icon: Percent },
  { id: "status-tracker", label: "Status Tracker", icon: Clock3 },
  { id: "settings", label: "Settings", icon: Settings },
];

const managementSectionRoutes: Record<string, string> = {
  dashboard: "/dashboard",
  applications: "/dashboard/applications",
  documents: "/dashboard/documents",
  "loan-details": "/dashboard/loan-details",
  "status-tracker": "/dashboard/status-tracker",
};

const getManagementSectionFromPath = (pathname: string) => {
  if (pathname === "/dashboard") {
    return "dashboard";
  }

  return (
    Object.entries(managementSectionRoutes).find(([, route]) => route === pathname)?.[0] ?? null
  );
};

type DocumentStatus = "pending" | "verified" | "rejected";
type LoanDocumentType = Database["public"]["Enums"]["loan_document_type"];
type UserLoanDocumentRow = Database["public"]["Tables"]["user_loan_documents"]["Row"];
type DocumentPersistenceMode = "user_loan_documents" | "application_json";

interface LoanApplicationDocumentCarrier {
  id: string;
  project_report_inputs: Json | null;
  created_at: string;
  updated_at: string;
}

interface NormalizedDocumentRecord {
  id: string;
  sourceApplicationId: string | null;
  documentType: LoanDocumentType;
  documentName: string;
  fileUrl: string;
  status: DocumentStatus;
  uploadedAt: string;
  rejectionReason: string | null;
}

interface DocumentRow {
  id: number;
  name: string;
  description: string;
  documentType: LoanDocumentType;
  status: DocumentStatus;
  helperText: string;
  fileName: string | null;
  previewUrl: string | null;
  recordId: string | null;
  sourceApplicationId: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  uploadedAt: string | null;
}

// Full document set a CA / banker verifies before sanction. All are optional —
// the applicant uploads whatever is available; the Credit Analyst reviews and
// downloads them on the Credit Analyst page.
const baseDocumentRows: Array<Pick<DocumentRow, "id" | "name" | "description" | "documentType">> = [
  {
    id: 1,
    name: "Aadhaar Card",
    description: "Government issued identity proof (KYC)",
    documentType: "aadhaar_card",
  },
  {
    id: 2,
    name: "PAN Card",
    description: "Permanent Account Number proof (KYC)",
    documentType: "pan_card",
  },
  {
    id: 3,
    name: "Bank Statement (6–12 months)",
    description: "Latest 6 to 12 months bank account statement",
    documentType: "bank_statement",
  },
  {
    id: 4,
    name: "Income Tax Returns (last 3 years)",
    description: "ITR with computation for the last 3 years, if available",
    documentType: "itr",
  },
  {
    id: 5,
    name: "Udyam Registration",
    description: "Udyam / MSME registration certificate",
    documentType: "udyam_registration",
  },
  {
    id: 6,
    name: "GST Returns",
    description: "Recent GST returns / GSTR filings, if registered",
    documentType: "gst_returns",
  },
  {
    id: 7,
    name: "CIBIL Report",
    description: "Credit bureau (CIBIL) report of the promoter / firm",
    documentType: "cibil_report",
  },
  {
    id: 8,
    name: "Project Report / Quotations",
    description: "Detailed project report and vendor quotations",
    documentType: "project_quotation",
  },
  {
    id: 9,
    name: "Machinery Quotations",
    description: "Proforma invoices / quotations for plant & machinery",
    documentType: "machinery_quotation",
  },
  {
    id: 10,
    name: "Land / Building Ownership Documents",
    description: "Ownership deed, rent agreement or lease for the premises",
    documentType: "property_documents",
  },
  {
    id: 11,
    name: "CA Net Worth Certificate",
    description: "Promoter net-worth certificate from a Chartered Accountant",
    documentType: "net_worth_certificate",
  },
  {
    id: 12,
    name: "Pollution / NOC",
    description: "Pollution control consent / NOC, if applicable to the activity",
    documentType: "pollution_noc",
  },
  {
    id: 13,
    name: "Project Implementation Schedule",
    description: "Timeline / phasing plan for setting up the unit",
    documentType: "implementation_schedule",
  },
];

const buildPendingDocumentRows = (): DocumentRow[] =>
  baseDocumentRows.map((doc) => ({
    ...doc,
    status: "pending",
    helperText: "Upload required",
    fileName: null,
    previewUrl: null,
    recordId: null,
    sourceApplicationId: null,
    storageBucket: null,
    storagePath: null,
    uploadedAt: null,
  }));

const DOCUMENT_STORAGE_BUCKETS = ["loan-documents", "profile-documents"] as const;

const parseStoredDocumentRef = (fileUrl: string | null) => {
  if (!fileUrl) {
    return null;
  }

  const prefixedBucket = DOCUMENT_STORAGE_BUCKETS.find((bucket) => fileUrl.startsWith(`${bucket}:`));
  if (prefixedBucket) {
    return {
      bucket: prefixedBucket,
      storagePath: fileUrl.slice(`${prefixedBucket}:`.length),
    };
  }

  try {
    const url = new URL(fileUrl);
    for (const bucket of DOCUMENT_STORAGE_BUCKETS) {
      const publicMarker = `/storage/v1/object/public/${bucket}/`;
      const signMarker = `/storage/v1/object/sign/${bucket}/`;
      const marker = url.pathname.includes(publicMarker) ? publicMarker : signMarker;
      const markerIndex = url.pathname.indexOf(marker);

      if (markerIndex !== -1) {
        return {
          bucket,
          storagePath: decodeURIComponent(url.pathname.slice(markerIndex + marker.length)),
        };
      }
    }
  } catch (error) {
    console.error("Unable to parse storage reference from file URL:", error);
  }

  return null;
};

const getUploadErrorMessage = (error: unknown) => {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "Unknown error";
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isMissingUserLoanDocumentsTableError = (error: unknown) => {
  const message = getUploadErrorMessage(error).toLowerCase();
  return message.includes("public.user_loan_documents") && message.includes("schema cache");
};

const toDocumentStatus = (status: unknown): DocumentStatus =>
  status === "verified" ? "verified" : status === "rejected" ? "rejected" : "pending";

const getUploadedDocumentsFromProjectReportInputs = (projectReportInputs: Json | null | undefined) => {
  if (!isObjectRecord(projectReportInputs)) {
    return {};
  }

  const uploadedDocuments = projectReportInputs.uploaded_documents;
  return isObjectRecord(uploadedDocuments) ? uploadedDocuments : {};
};

const getDocumentRowsFromNormalizedRecords = async (records: NormalizedDocumentRecord[]) => {
  const latestByType = new Map<LoanDocumentType, NormalizedDocumentRecord>();

  records.forEach((record) => {
    if (!latestByType.has(record.documentType)) {
      latestByType.set(record.documentType, record);
    }
  });

  return Promise.all(baseDocumentRows.map(async (doc) => {
    const record = latestByType.get(doc.documentType);

    if (!record) {
      return {
        ...doc,
        status: "pending" as const,
        helperText: "Upload required",
        fileName: null,
        previewUrl: null,
        recordId: null,
        sourceApplicationId: null,
        storageBucket: null,
        storagePath: null,
        uploadedAt: null,
      };
    }

    const status: DocumentStatus = record.status;
    const storedDocumentRef = parseStoredDocumentRef(record.fileUrl);
    const storageBucket = storedDocumentRef?.bucket ?? null;
    const storagePath = storedDocumentRef?.storagePath ?? null;
    let previewUrl: string | null = null;

    if (status === "verified" && storageBucket && storagePath) {
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from(storageBucket)
        .createSignedUrl(storagePath, 60 * 60);

      if (signedUrlError) {
        console.error(`Unable to create signed preview URL for ${doc.name}:`, signedUrlError);
      } else {
        previewUrl = signedUrlData.signedUrl;
      }
    }

    return {
      ...doc,
      status,
      helperText:
        status === "verified"
          ? "Verified"
          : status === "rejected"
            ? record.rejectionReason || "Re-upload required"
            : "Upload required",
      fileName: status === "verified" ? record.documentName : null,
      previewUrl,
      recordId: record.id,
      sourceApplicationId: record.sourceApplicationId,
      storageBucket,
      storagePath,
      uploadedAt: record.uploadedAt,
    };
  }));
};

const getDocumentRowsFromTableRecords = async (records: UserLoanDocumentRow[]) =>
  getDocumentRowsFromNormalizedRecords(
    records.map((record) => ({
      id: record.id,
      sourceApplicationId: record.loan_application_id,
      documentType: record.document_type,
      documentName: record.document_name,
      fileUrl: record.file_url,
      status: toDocumentStatus(record.status),
      uploadedAt: record.created_at,
      rejectionReason: record.rejection_reason,
    })),
  );

const getDocumentRowsFromApplicationRecords = async (applications: LoanApplicationDocumentCarrier[]) => {
  const normalizedRecords: NormalizedDocumentRecord[] = [];

  applications.forEach((application) => {
    const uploadedDocuments = getUploadedDocumentsFromProjectReportInputs(application.project_report_inputs);

    Object.entries(uploadedDocuments).forEach(([documentType, value]) => {
      if (!isObjectRecord(value)) {
        return;
      }

      const fileUrl = typeof value.file_url === "string" ? value.file_url : null;
      if (!fileUrl) {
        return;
      }

      normalizedRecords.push({
        id: `${application.id}:${documentType}`,
        sourceApplicationId: application.id,
        documentType: documentType as LoanDocumentType,
        documentName: typeof value.document_name === "string" ? value.document_name : documentType,
        fileUrl,
        status: toDocumentStatus(value.status),
        uploadedAt:
          typeof value.uploaded_at === "string"
            ? value.uploaded_at
            : application.updated_at || application.created_at,
        rejectionReason: typeof value.rejection_reason === "string" ? value.rejection_reason : null,
      });
    });
  });

  return getDocumentRowsFromNormalizedRecords(normalizedRecords);
};

const isPdfDocument = (documentRow: DocumentRow | null) =>
  Boolean(documentRow?.fileName?.toLowerCase().endsWith(".pdf") || documentRow?.previewUrl?.toLowerCase().includes(".pdf"));

const isImageDocument = (documentRow: DocumentRow | null) =>
  Boolean(documentRow?.fileName?.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)$/i) || documentRow?.previewUrl?.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i));

const createSignedPreviewUrl = async (bucket: string | null, storagePath: string | null) => {
  if (!bucket || !storagePath) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 60);

  if (error) {
    console.error("Unable to create signed preview URL:", error);
    return null;
  }

  return data.signedUrl;
};

const trackerSteps = [
  { label: "Submitted", status: "completed" },
  { label: "Under Review", status: "completed" },
  { label: "Verification", status: "active" },
  { label: "Approved / Rejected", status: "upcoming" },
];

const statusAlerts = [
  { label: "Business Registration Rejected", description: "Submit the business registration details again.", icon: ShieldCheck },
  { label: "EMI Due Reminder", description: "Your next EMI is due in 5 days.", icon: Bell },
  { label: "Verification in Progress", description: "Your documents are currently under review.", icon: Clock3 },
];

const summaryItems = [
  { label: "Total Applications", value: "128", trend: "+15%", trendType: "positive", sparkline: [10, 14, 18, 22, 20, 24, 26] },
  { label: "Approved", value: "45", trend: "+12%", trendType: "positive", sparkline: [6, 9, 12, 14, 18, 21, 24] },
  { label: "Pending", value: "67", trend: "+4%", trendType: "neutral", sparkline: [16, 18, 17, 19, 21, 20, 22] },
  { label: "Rejected", value: "16", trend: "-5%", trendType: "negative", sparkline: [8, 6, 7, 5, 6, 4, 5] },
];

const approvalMilestones = [
  { label: "Docs Verified", status: "completed" },
  { label: "Risk Assessment", status: "active" },
  { label: "Final Review", status: "upcoming" },
];

const loanTypes = [
  { label: "MSME", value: 45, dot: "bg-[#00C2D1]" },
  { label: "Mudra", value: 30, dot: "bg-[#D4AF37]" },
  { label: "PMEGP", value: 15, dot: "bg-[#94a3b8]" },
  { label: "Other", value: 10, dot: "bg-[#64748b]" },
];

const applicantStats = [
  { label: "Loan Requested", value: "₹10,00,000" },
  { label: "Loan Approved", value: "₹8,50,000" },
  { label: "Status", value: "Under Review" },
  { label: "Credit Score", value: "750" },
];

const loanSummaryItems = [
  { label: "Loan Amount", value: "₹8,50,000" },
  { label: "Interest Rate", value: "11.25%" },
  { label: "Tenure", value: "36 Months" },
  { label: "EMI", value: "₹27,730" },
  { label: "Processing Fee", value: "₹2,500" },
  { label: "Total Payable", value: "₹9,98,280" },
];

// Dynamic progress color based on percentage
const getProgressColor = (progress: number) => {
  if (progress >= 80) return "#22c55e"; // Green-500 for best (80-100%)
  if (progress >= 50) return "#00C2D1"; // Cyan/Blue for good (50-79%)
  return "#ef4444"; // Red-500 for bad (0-49%)
};

const getProgressLabel = (progress: number) => {
  if (progress >= 80) return "Excellent";
  if (progress >= 50) return "Good";
  return "At Risk";
};

const circularProgress = 85; // Change this value to see different colors (try 45 for red, 65 for blue)
const initialTrendData = [108, 132, 123, 159, 147, 190, 212, 235];

const panelClass = "rounded-[2rem] border border-white/10 bg-white/5 p-6 ring-1 ring-white/5 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,194,209,0.16)]";
const innerClass = "rounded-[1.5rem] border border-white/10 bg-[#061b34]/85 p-4 ring-1 ring-white/10";

interface SavedApplicationRow {
  id: string;
  business_entity_name: string | null;
  loan_scheme: string | null;
  total_project_cost: number | null;
  eligible_loan_amount: number | null;
  amount: number;
  status: string;
  created_at: string;
  current_step: number | null;
}

const formatCurrency = (amount: number | null | undefined) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount ?? 0);

const formatApplicationId = (id: string) => `APP${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

// Enhanced sparkline function with area fill support
const getSparklinePaths = (data: number[]) => {
  const width = 140;
  const height = 40;
  const padding = 4;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(max - min, 1);

  const points = data.map((value, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(data.length - 1, 1);
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return { x, y };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  // Create area path for gradient fill
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

  return { line: linePath, area: areaPath, points };
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));

const getLoanSchemeName = (scheme: string | null) => {
  const labels: Record<string, string> = {
    mudra: "Mudra Loan",
    pmegp: "PMEGP Loan",
    normal_msme: "MSME Loan",
    other_scheme: "Other Scheme",
  };

  if (!scheme) {
    return "Loan details pending";
  }

  return labels[scheme] || scheme.replace(/_/g, " ");
};

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    draft: "Draft",
    submitted: "Submitted",
    under_review: "Under Review",
    approved: "Approved",
    rejected: "Rejected",
    disbursed: "Disbursed",
    pending: "Pending",
    verified: "Verified",
  };

  return labels[status] || status.replace(/_/g, " ");
};

const getStatusBadgeClass = (status: string) => {
  switch (status) {
    case "approved":
    case "disbursed":
      return "border-[#00C2D1]/30 bg-[#00C2D1]/10 text-[#7BE7F0]";
    case "rejected":
      return "border-[#D65C76]/30 bg-[#D65C76]/10 text-[#F4A6B7]";
    case "draft":
      return "border-[#D4AF37]/30 bg-[#D4AF37]/10 text-[#F5D778]";
    default:
      return "border-white/10 bg-white/5 text-slate-200";
  }
};

const parseSummaryValue = (value: string) => Number(value.replace(/[^\d.-]/g, ""));

const LoanManagementDashboard = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [applications, setApplications] = useState<SavedApplicationRow[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAppId, setEditingAppId] = useState<string | undefined>();
  const [applicationFlow, setApplicationFlow] = useState<"fresh" | "resume">("fresh");
  const [searchQuery, setSearchQuery] = useState("");
  const [applicationStatusFilter, setApplicationStatusFilter] = useState("all");
  const [loanDetailSearch, setLoanDetailSearch] = useState("");
  const [documentSearch, setDocumentSearch] = useState("");
  const [selectedSection, setSelectedSection] = useState("dashboard");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [loanAmount, setLoanAmount] = useState("850000");
  const [interestRate, setInterestRate] = useState(11.25);
  const [tenure, setTenure] = useState(36);
  const [applicationTrend, setApplicationTrend] = useState<number[]>(initialTrendData);
  const routeSection = useMemo(() => getManagementSectionFromPath(location.pathname), [location.pathname]);
  const backOrigin = typeof (location.state as { from?: string } | null)?.from === "string"
    ? (location.state as { from?: string }).from
    : undefined;
  const isMainManagementPage = location.pathname === "/dashboard";
  const isDashboardPage = isMainManagementPage || routeSection === "dashboard";
  const activeSection = isMainManagementPage ? selectedSection : routeSection ?? selectedSection;
  const isLoanDetailsPage = routeSection === "loan-details";
  const showOverviewSection = !isLoanDetailsPage && isDashboardPage;
  const showApplicationManagementSection = !isLoanDetailsPage && routeSection === "applications";
  const showDocumentSection = !isLoanDetailsPage && routeSection === "documents";
  const showStatusTrackerSection = !isLoanDetailsPage && routeSection === "status-tracker";
  const showLoanSummarySection = !isLoanDetailsPage && routeSection === "status-tracker";
  const showPerformanceInsightsSection = !isLoanDetailsPage && isDashboardPage;
  const showEmiSection = !isLoanDetailsPage && isDashboardPage;
  const isApplicationsPage = routeSection === "applications";
  const isDocumentsPage = routeSection === "documents";
  const userName =
    typeof user?.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name
      : user?.email?.split("@")[0] ?? "User";
  const headerEyebrow = isApplicationsPage ? "Loan Application Management" : isDocumentsPage ? "Document Management" : "Dashboard";
  const headerTitle = isApplicationsPage
    ? "Manage Application Flow"
    : isDocumentsPage
      ? "Checklist"
      : `Welcome, ${userName}.`;
  const headerDescription = isApplicationsPage
    ? "Track every application, monitor completion in real time, and jump back into the active step without losing momentum."
    : isDocumentsPage
      ? "Upload and verify the required documents to proceed."
      : "Here's your updated loan dashboard with live application status, approvals, and key performance trends.";

  // Dynamic color based on progress
  const progressColor = getProgressColor(circularProgress);
  const progressLabel = getProgressLabel(circularProgress);

  const loanAmountNumber = useMemo(() => {
    const numeric = Number(loanAmount.replace(/\D/g, "") || "0");
    return Math.max(numeric, 0);
  }, [loanAmount]);

  const monthlyInterestRate = useMemo(() => interestRate / 12 / 100, [interestRate]);

  const emiPayment = useMemo(() => {
    if (loanAmountNumber <= 0 || tenure <= 0) {
      return 0;
    }

    if (monthlyInterestRate === 0) {
      return loanAmountNumber / tenure;
    }

    const factor = Math.pow(1 + monthlyInterestRate, tenure);
    return loanAmountNumber * monthlyInterestRate * factor / (factor - 1);
  }, [loanAmountNumber, monthlyInterestRate, tenure]);

  const totalPayment = useMemo(() => emiPayment * tenure, [emiPayment, tenure]);
  const totalInterest = useMemo(() => Math.max(totalPayment - loanAmountNumber, 0), [totalPayment, loanAmountNumber]);

  const resetEmiCalculator = () => {
    setLoanAmount("0");
    setInterestRate(11.25);
    setTenure(36);
  };

  const handleLoanAmountInput = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value.replace(/\D/g, "");
    if (rawValue === "") {
      setLoanAmount("");
      return;
    }

    const sanitized = rawValue.replace(/^0+/, "");
    setLoanAmount(sanitized === "" ? "0" : sanitized);
  };

  const handleLoanAmountBlur = () => {
    if (loanAmount === "") {
      setLoanAmount("0");
    }
  };

  const handleSectionNavigation = (sectionId: string) => {
    if (sectionId === "settings") {
      navigate("/settings", { state: backOrigin ? { from: backOrigin } : undefined });
      return;
    }

    const route = managementSectionRoutes[sectionId];
    if (route) {
      navigate(route, { state: backOrigin ? { from: backOrigin } : undefined });
      return;
    }

    setSelectedSection(sectionId);
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim().length > 0) {
      if (!isMainManagementPage) {
        navigate(managementSectionRoutes.applications, { state: backOrigin ? { from: backOrigin } : undefined });
        return;
      }

      setSelectedSection("applications");
      const element = document.getElementById("applications");
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  };

  useEffect(() => {
    if (routeSection) {
      setSelectedSection(routeSection);
      return;
    }
    setSelectedSection("dashboard");
  }, [routeSection]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileMenuOpen]);

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const [documentRows, setDocumentRows] = useState<DocumentRow[]>(() => buildPendingDocumentRows());
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [selectedDocumentName, setSelectedDocumentName] = useState<string | null>(null);
  const [activePreviewDocument, setActivePreviewDocument] = useState<DocumentRow | null>(null);
  const [documentActionInProgress, setDocumentActionInProgress] = useState<LoanDocumentType | null>(null);
  const [documentPersistenceMode, setDocumentPersistenceMode] = useState<DocumentPersistenceMode>("user_loan_documents");
  const [previewZoom, setPreviewZoom] = useState(100);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);

  const handleUpload = () => {
    setSelectedDocumentName(null);
    uploadInputRef.current?.click();
  };

  const handleDocumentUpload = (documentName: string) => {
    setSelectedDocumentName(documentName);
    uploadInputRef.current?.click();
  };

  const handlePreviewZoomChange = (direction: "in" | "out") => {
    setPreviewZoom((current) => {
      const delta = direction === "in" ? 10 : -10;
      return Math.min(200, Math.max(60, current + delta));
    });
  };

  const handlePreviewDownload = () => {
    if (!activePreviewDocument?.previewUrl) {
      return;
    }

    const link = document.createElement("a");
    link.href = activePreviewDocument.previewUrl;
    link.download = activePreviewDocument.fileName ?? activePreviewDocument.name;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
  };

  const handleTogglePreviewFullscreen = async () => {
    const previewViewport = previewViewportRef.current;
    if (!previewViewport) {
      return;
    }

    if (document.fullscreenElement === previewViewport) {
      await document.exitFullscreen();
      return;
    }

    await previewViewport.requestFullscreen();
  };

  const fetchDefaultLoanTypeId = async () => {
    const preferred = await supabase
      .from("loan_types")
      .select("id")
      .eq("name", "EazyBizy MSME")
      .maybeSingle();

    if (preferred.error) {
      throw preferred.error;
    }

    if (preferred.data?.id) {
      return preferred.data.id;
    }

    const fallback = await supabase
      .from("loan_types")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (fallback.error) {
      throw fallback.error;
    }

    if (fallback.data?.id) {
      return fallback.data.id;
    }

    throw new Error("No loan type found. Run the loan type migration before uploading documents.");
  };

  const ensureUploadApplicationId = async (userId: string) => {
    const existingApplicationId = applications[0]?.id;
    if (existingApplicationId) {
      return existingApplicationId;
    }

    const loanTypeId = await fetchDefaultLoanTypeId();
    const { data, error } = await supabase
      .from("loan_applications")
      .insert({
        user_id: userId,
        loan_type_id: loanTypeId,
        amount: 0,
        tenure_months: 12,
        status: "draft",
        current_step: 1,
      })
      .select("id, business_entity_name, loan_scheme, total_project_cost, eligible_loan_amount, amount, status, created_at, current_step")
      .single();

    if (error) {
      throw error;
    }

    setApplications((prev) => [data as SavedApplicationRow, ...prev]);
    return data.id;
  };

  const fetchDocumentsFromApplicationFallback = async (userId: string) => {
    const { data, error } = await supabase
      .from("loan_applications")
      .select("id, project_report_inputs, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    const nextRows = await getDocumentRowsFromApplicationRecords((data as LoanApplicationDocumentCarrier[]) ?? []);
    setDocumentRows(nextRows);
    setDocumentPersistenceMode("application_json");
  };

  const saveDocumentToApplicationFallback = async (
    userId: string,
    applicationId: string,
    documentType: LoanDocumentType,
    documentPayload: Record<string, Json>,
  ) => {
    const { data, error } = await supabase
      .from("loan_applications")
      .select("project_report_inputs")
      .eq("id", applicationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const currentProjectReportInputs = isObjectRecord(data?.project_report_inputs)
      ? data.project_report_inputs
      : {};
    const currentUploadedDocuments = getUploadedDocumentsFromProjectReportInputs(data?.project_report_inputs);
    const nextProjectReportInputs = {
      ...currentProjectReportInputs,
      uploaded_documents: {
        ...currentUploadedDocuments,
        [documentType]: documentPayload,
      },
    };

    const { error: updateError } = await supabase
      .from("loan_applications")
      .update({ project_report_inputs: nextProjectReportInputs as Json })
      .eq("id", applicationId)
      .eq("user_id", userId);

    if (updateError) {
      throw updateError;
    }

    setDocumentPersistenceMode("application_json");
  };

  const deleteDocumentFromApplicationFallback = async (
    userId: string,
    applicationId: string,
    documentType: LoanDocumentType,
  ) => {
    const { data, error } = await supabase
      .from("loan_applications")
      .select("project_report_inputs")
      .eq("id", applicationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const currentProjectReportInputs = isObjectRecord(data?.project_report_inputs)
      ? data.project_report_inputs
      : {};
    const currentUploadedDocuments = {
      ...getUploadedDocumentsFromProjectReportInputs(data?.project_report_inputs),
    };

    delete currentUploadedDocuments[documentType];

    const nextProjectReportInputs = {
      ...currentProjectReportInputs,
      uploaded_documents: currentUploadedDocuments,
    };

    const { error: updateError } = await supabase
      .from("loan_applications")
      .update({ project_report_inputs: nextProjectReportInputs as Json })
      .eq("id", applicationId)
      .eq("user_id", userId);

    if (updateError) {
      throw updateError;
    }

    setDocumentPersistenceMode("application_json");
  };

  const fetchDocuments = async (userId: string) => {
    setDocumentsLoading(true);

    const { data, error } = await supabase
      .from("user_loan_documents")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) {
      if (isMissingUserLoanDocumentsTableError(error)) {
        console.warn("user_loan_documents is missing in Supabase. Falling back to loan_applications.project_report_inputs.");

        try {
          await fetchDocumentsFromApplicationFallback(userId);
        } catch (fallbackError) {
          console.error("Error loading fallback document store:", fallbackError);
          setDocumentRows(buildPendingDocumentRows());
          toast({
            variant: "destructive",
            title: "Could not load documents",
            description: "Your document store is not available right now.",
          });
        }

        setDocumentsLoading(false);
        return;
      }

      console.error("Error fetching user documents:", error);
      setDocumentRows(buildPendingDocumentRows());
      toast({
        variant: "destructive",
        title: "Could not load documents",
        description: "Only your uploaded documents should appear here, but they could not be loaded right now.",
      });
    } else {
      const nextRows = await getDocumentRowsFromTableRecords((data as UserLoanDocumentRow[]) ?? []);
      setDocumentRows(nextRows);
      setDocumentPersistenceMode("user_loan_documents");
    }

    setDocumentsLoading(false);
  };

  const uploadDocumentToAvailableBucket = async (storagePath: string, file: File) => {
    let lastError: unknown = null;

    for (const bucket of DOCUMENT_STORAGE_BUCKETS) {
      const { error } = await supabase.storage
        .from(bucket)
        .upload(storagePath, file, { upsert: true });

      if (!error) {
        return { bucket };
      }

      lastError = error;
      console.error(`Document upload failed in bucket ${bucket}:`, error);
    }

    throw lastError ?? new Error("No configured storage bucket accepted the upload.");
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    event.preventDefault();
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/jpg",
    ];

    if (!allowedTypes.includes(file.type)) {
      toast({
        variant: "destructive",
        title: "Invalid file type",
        description: "Please upload PDF, JPG, or PNG files only.",
      });
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: "Maximum file size is 5MB.",
      });
      event.target.value = "";
      return;
    }

    if (!user?.id) {
      toast({
        variant: "destructive",
        title: "Please sign in again",
        description: "We could not find your session for this upload.",
      });
      event.target.value = "";
      return;
    }

    const nextDocumentIndex = selectedDocumentName
      ? documentRows.findIndex((row) => row.name === selectedDocumentName)
      : documentRows.findIndex((row) => row.status !== "verified");

    if (nextDocumentIndex === -1) {
      toast({
        title: selectedDocumentName ? "Document not found" : "All documents verified",
        description: selectedDocumentName
          ? "Please choose a valid document row before uploading."
          : "No further uploads are required.",
      });
      setSelectedDocumentName(null);
      event.target.value = "";
      return;
    }

    const targetDocument = documentRows[nextDocumentIndex];
    setDocumentActionInProgress(targetDocument.documentType);

    try {
      const activeApplicationId = await ensureUploadApplicationId(user.id);
      const extension = file.name.split(".").pop()?.toLowerCase() || "file";
      const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${user.id}/${activeApplicationId}/${targetDocument.documentType}-${Date.now()}-${sanitizedFileName || `document.${extension}`}`;
      const { bucket } = await uploadDocumentToAvailableBucket(storagePath, file);
      const uploadedAt = new Date().toISOString();
      let persistedRecordId = targetDocument.recordId;

      const payload = {
        loan_application_id: activeApplicationId,
        user_id: user.id,
        document_type: targetDocument.documentType,
        document_name: file.name,
        file_url: `${bucket}:${storagePath}`,
        file_size: file.size,
        status: "verified" as const,
        verified_at: uploadedAt,
      };

      if (documentPersistenceMode === "application_json") {
        await saveDocumentToApplicationFallback(user.id, activeApplicationId, targetDocument.documentType, {
          document_type: targetDocument.documentType,
          document_name: file.name,
          file_url: `${bucket}:${storagePath}`,
          file_size: file.size,
          status: "verified",
          uploaded_at: uploadedAt,
          rejection_reason: null,
        });
      } else {
        try {
          if (targetDocument.recordId) {
            const { error: updateError } = await supabase
              .from("user_loan_documents")
              .update(payload)
              .eq("id", targetDocument.recordId)
              .eq("user_id", user.id);

            if (updateError) {
              throw updateError;
            }
          } else {
            const { data: insertedRecord, error: insertError } = await supabase
              .from("user_loan_documents")
              .insert(payload)
              .select("id")
              .single();

            if (insertError) {
              throw insertError;
            }

            persistedRecordId = insertedRecord?.id ?? persistedRecordId;
          }
        } catch (persistenceError) {
          if (!isMissingUserLoanDocumentsTableError(persistenceError)) {
            await supabase.storage.from(bucket).remove([storagePath]);
            throw persistenceError;
          }

          await saveDocumentToApplicationFallback(user.id, activeApplicationId, targetDocument.documentType, {
            document_type: targetDocument.documentType,
            document_name: file.name,
            file_url: `${bucket}:${storagePath}`,
            file_size: file.size,
            status: "verified",
            uploaded_at: uploadedAt,
            rejection_reason: null,
          });

          persistedRecordId = `${activeApplicationId}:${targetDocument.documentType}`;
        }
      }

      if (targetDocument.storageBucket && targetDocument.storagePath && targetDocument.storagePath !== storagePath) {
        const { error: removePreviousFileError } = await supabase.storage
          .from(targetDocument.storageBucket)
          .remove([targetDocument.storagePath]);

        if (removePreviousFileError) {
          console.error("Error removing previous document file:", removePreviousFileError);
        }
      }

      const previewUrl = await createSignedPreviewUrl(bucket, storagePath);
      const nextDocumentRow: DocumentRow = {
        ...targetDocument,
        status: "verified",
        helperText: "Verified",
        fileName: file.name,
        previewUrl,
        recordId: persistedRecordId,
        sourceApplicationId: activeApplicationId,
        storageBucket: bucket,
        storagePath,
        uploadedAt,
      };

      setDocumentRows((currentRows) =>
        currentRows.map((row) =>
          row.documentType === targetDocument.documentType ? nextDocumentRow : row,
        ),
      );
      setActivePreviewDocument((currentDocument) =>
        currentDocument?.documentType === targetDocument.documentType ? nextDocumentRow : currentDocument,
      );
      toast({
        title: "Document uploaded",
        description: `${targetDocument.name} has been uploaded and verified for your account.`,
      });
    } catch (error) {
      console.error("Error uploading document:", error);
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: `We could not upload ${targetDocument.name}. ${getUploadErrorMessage(error)}`,
      });
    } finally {
      setDocumentActionInProgress(null);
      setSelectedDocumentName(null);
      event.target.value = "";
    }
  };

  const handleDeleteDocument = async () => {
    if (!user?.id || !activePreviewDocument) {
      return;
    }

    const documentToDelete = activePreviewDocument;
    setDocumentActionInProgress(documentToDelete.documentType);

    try {
      if (documentToDelete.storageBucket && documentToDelete.storagePath) {
        const { error: storageError } = await supabase.storage
          .from(documentToDelete.storageBucket)
          .remove([documentToDelete.storagePath]);

        if (storageError) {
          throw storageError;
        }
      }

      if (documentPersistenceMode === "application_json") {
        const fallbackApplicationId = documentToDelete.sourceApplicationId ?? applications[0]?.id;
        if (fallbackApplicationId) {
          await deleteDocumentFromApplicationFallback(user.id, fallbackApplicationId, documentToDelete.documentType);
        }
      } else {
        try {
          const { error: deleteError } = await supabase
            .from("user_loan_documents")
            .delete()
            .eq("user_id", user.id)
            .eq("document_type", documentToDelete.documentType);

          if (deleteError) {
            throw deleteError;
          }
        } catch (deleteError) {
          if (!isMissingUserLoanDocumentsTableError(deleteError)) {
            throw deleteError;
          }

          const fallbackApplicationId = documentToDelete.sourceApplicationId ?? applications[0]?.id;
          if (fallbackApplicationId) {
            await deleteDocumentFromApplicationFallback(user.id, fallbackApplicationId, documentToDelete.documentType);
          }
      }
      }

      setActivePreviewDocument(null);
      const resetDocumentRow: DocumentRow = {
        ...documentToDelete,
        status: "pending",
        helperText: "Upload required",
        fileName: null,
        previewUrl: null,
        recordId: null,
        storageBucket: null,
        storagePath: null,
        uploadedAt: null,
      };

      setDocumentRows((currentRows) =>
        currentRows.map((row) =>
          row.documentType === documentToDelete.documentType ? resetDocumentRow : row,
        ),
      );
      toast({
        title: "Document deleted",
        description: `${documentToDelete.name} is back to pending for your account.`,
      });
    } catch (error) {
      console.error("Error deleting document:", error);
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: `We could not remove ${documentToDelete.name}. ${getUploadErrorMessage(error)}`,
      });
    } finally {
      setDocumentActionInProgress(null);
    }
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // Handle download of all records
  const handleDownloadAllRecords = () => {
    const rows = filteredLoanDetailRows.length ? filteredLoanDetailRows : applicationRows;
    const csv = ["Payment Date,Description,Amount,Status"]
      .concat(
        rows.map((row) =>
          `"${row.date}","${row.businessName}","${formatCurrency(row.amount)}","${row.statusLabel}"`,
        ),
      )
      .join("\n");

    downloadFile(csv, "loan-payment-records.csv");
  };

  // Handle download of single record
  const handleDownloadSingleRecord = (row: typeof filteredLoanDetailRows[0]) => {
    const csv = "Payment Date,Description,Amount,Status\n" +
      `"${row.date}","${row.businessName}","${formatCurrency(row.amount)}","${row.statusLabel}"`;
    
    downloadFile(csv, `payment-record-${row.id}.csv`);
    
    toast({
      title: "Download Started",
      description: `Payment record for ${row.businessName} is downloading.`,
    });
  };

  const handleDownloadAllDocuments = () => {
    const documents = filteredDocumentRows.length ? filteredDocumentRows : documentRows;
    const csv = ["Document Name,Status"]
      .concat(documents.map((doc) => `"${doc.name}","${getStatusLabel(doc.status)}"`))
      .join("\n");

    downloadFile(csv, "loan-documents.csv");
  };

  const handleViewSummary = () => {
    if (!isMainManagementPage) {
      navigate(managementSectionRoutes.applications, { state: backOrigin ? { from: backOrigin } : undefined });
      return;
    }

    setSelectedSection("applications");
    const element = document.getElementById("applications");
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [loading, user, navigate]);

  const fetchApplications = async (userId: string) => {
    setApplicationsLoading(true);

    const { data, error } = await supabase
      .from("loan_applications")
      .select("id, business_entity_name, loan_scheme, total_project_cost, eligible_loan_amount, amount, status, created_at, current_step")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Error fetching saved applications:", error);
      setApplications([]);
      toast({
        variant: "destructive",
        title: "Could not load applications",
        description: "Your saved applications could not be loaded right now.",
      });
    } else {
      setApplications((data as SavedApplicationRow[]) ?? []);
    }

    setApplicationsLoading(false);
  };

  useEffect(() => {
    if (user?.id) {
      void fetchApplications(user.id);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      void fetchDocuments(user.id);
      return;
    }

    setDocumentRows(buildPendingDocumentRows());
    setActivePreviewDocument(null);
  }, [user?.id]);

  useEffect(() => {
    if (activePreviewDocument) {
      setPreviewZoom(100);
    }
  }, [activePreviewDocument]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsPreviewFullscreen(document.fullscreenElement === previewViewportRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const totalApplicationsSummary = useMemo(
    () => ({ label: "Total Applications", value: String(applications.length), trend: String(applications.length), trendType: "neutral" as const }),
    [applications],
  );

  const approvedSummary = useMemo(() => {
    const n = applications.filter((a) => ["approved", "disbursed"].includes(a.status)).length;
    return { label: "Approved", value: String(n), trend: n > 0 ? `+${n}` : "0", trendType: "positive" as const };
  }, [applications]);

  const pendingSummary = useMemo(() => {
    const n = applications.filter((a) => ["submitted", "under_review", "draft"].includes(a.status)).length;
    return { label: "Active", value: String(n), trend: `${n} active`, trendType: "neutral" as const };
  }, [applications]);

  const rejectedSummary = useMemo(() => {
    const n = applications.filter((a) => a.status === "rejected").length;
    return { label: "Rejected", value: String(n), trend: n > 0 ? `-${n}` : "0", trendType: n > 0 ? "negative" as const : "neutral" as const };
  }, [applications]);

  const smartSummaryStats = useMemo(() => {
    const total = parseSummaryValue(totalApplicationsSummary.value);
    const approved = parseSummaryValue(approvedSummary.value);
    const pending = parseSummaryValue(pendingSummary.value);
    const rejected = parseSummaryValue(rejectedSummary.value);

    return {
      total,
      totalTrend: totalApplicationsSummary.trend,
      items: [
        {
          key: "approved",
          label: approvedSummary.label,
          value: approved,
          percentage: total > 0 ? (approved / total) * 100 : 0,
          trend: approvedSummary.trend,
          icon: Check,
          accentClass: "bg-[#00C2D1]",
          softAccentClass: "bg-[#00C2D1]/15 text-[#7BE7F0] border-[#00C2D1]/20",
          progressClass: "bg-[#00C2D1]",
        },
        {
          key: "pending",
          label: pendingSummary.label,
          value: pending,
          percentage: total > 0 ? (pending / total) * 100 : 0,
          trend: pendingSummary.trend,
          icon: Clock3,
          accentClass: "bg-[#D4AF37]",
          softAccentClass: "bg-[#D4AF37]/15 text-[#F5D778] border-[#D4AF37]/20",
          progressClass: "bg-[#D4AF37]",
        },
        {
          key: "rejected",
          label: rejectedSummary.label,
          value: rejected,
          percentage: total > 0 ? (rejected / total) * 100 : 0,
          trend: rejectedSummary.trend,
          icon: X,
          accentClass: "bg-white/70",
          softAccentClass: "bg-white/10 text-white border-white/10",
          progressClass: "bg-white/60",
        },
      ],
    };
  }, [approvedSummary, pendingSummary, rejectedSummary, totalApplicationsSummary]);

  const [animatedSummaryValues, setAnimatedSummaryValues] = useState<Record<string, number>>({
    total: 0,
    approved: 0,
    pending: 0,
    rejected: 0,
  });

  useEffect(() => {
    const targets = {
      total: smartSummaryStats.total,
      approved: smartSummaryStats.items[0]?.value ?? 0,
      pending: smartSummaryStats.items[1]?.value ?? 0,
      rejected: smartSummaryStats.items[2]?.value ?? 0,
    };

    const duration = 900;
    let frameId = 0;
    const startTime = performance.now();

    const tick = (currentTime: number) => {
      const progress = Math.min((currentTime - startTime) / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);

      setAnimatedSummaryValues({
        total: Math.round(targets.total * easedProgress),
        approved: Math.round(targets.approved * easedProgress),
        pending: Math.round(targets.pending * easedProgress),
        rejected: Math.round(targets.rejected * easedProgress),
      });

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    frameId = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frameId);
  }, [smartSummaryStats]);

  const loanTypeSeries = useMemo(() => loanTypes.map((item) => item.value), []);

  const summaryStatusSeries = useMemo(
    () => smartSummaryStats.items.map((item) => item.value),
    [smartSummaryStats],
  );

  const summaryStatusDonutOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        id: "summary-status-donut",
        type: "donut",
        toolbar: { show: false },
        foreColor: "#e2e8f0",
        background: "transparent",
        fontFamily: "inherit",
        animations: {
          enabled: true,
          easing: "easeinout",
          speed: 850,
          animateGradually: {
            enabled: true,
            delay: 120,
          },
          dynamicAnimation: {
            enabled: true,
            speed: 350,
          },
        },
      },
      labels: smartSummaryStats.items.map((item) => item.label),
      colors: ["#00C2D1", "#D4AF37", "rgba(255,255,255,0.72)"],
      legend: { show: false },
      dataLabels: { enabled: false },
      stroke: {
        colors: ["#0b2141"],
        width: 5,
      },
      plotOptions: {
        pie: {
          expandOnClick: false,
          donut: {
            size: "72%",
            labels: {
              show: true,
              name: {
                show: true,
                offsetY: -10,
                color: "#94a3b8",
                fontSize: "13px",
              },
              value: {
                show: true,
                offsetY: 10,
                color: "#ffffff",
                fontSize: "28px",
                fontWeight: 700,
                formatter: (value) => `${Math.round(Number(value))}`,
              },
              total: {
                show: true,
                label: "Applications",
                color: "#94a3b8",
                fontSize: "13px",
                fontWeight: 500,
                formatter: () => `${smartSummaryStats.total}`,
              },
            },
          },
        },
      },
      tooltip: {
        theme: "dark",
        style: { fontSize: "13px" },
        y: {
          formatter: (value: number) => `${value} applications`,
        },
      },
      states: {
        hover: {
          filter: {
            type: "lighten",
            value: 0.08,
          },
        },
        active: {
          filter: {
            type: "none",
            value: 0,
          },
        },
      },
      responsive: [
        {
          breakpoint: 640,
          options: {
            plotOptions: {
              pie: {
                donut: {
                  size: "68%",
                  labels: {
                    value: {
                      fontSize: "22px",
                    },
                  },
                },
              },
            },
          },
        },
      ],
    }),
    [smartSummaryStats],
  );

  // Enhanced Donut Chart Options
  const donutChartOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        id: "loan-type-donut",
        type: "donut",
        toolbar: { show: false },
        foreColor: "#e2e8f0",
        background: "transparent",
        fontFamily: "inherit",
      },
      plotOptions: {
        pie: {
          donut: {
            size: "65%",
            labels: {
              show: true,
              name: {
                show: true,
                fontSize: "14px",
                color: "#94a3b8",
                offsetY: -10,
              },
              value: {
                show: true,
                fontSize: "24px",
                color: "#ffffff",
                fontWeight: 600,
                offsetY: 5,
                formatter: (val) => `${val}%`,
              },
              total: {
                show: true,
                label: "Total",
                fontSize: "14px",
                color: "#94a3b8",
                fontWeight: 500,
                formatter: () => "100%",
              },
            },
          },
          expandOnClick: true,
        },
      },
      labels: loanTypes.map((item) => item.label),
      colors: ["#00C2D1", "#D4AF37", "#94a3b8", "#64748b"],
      dataLabels: { 
        enabled: true,
        formatter: (val) => `${Math.round(Number(val))}%`,
        style: {
          colors: ["#fff"],
          fontWeight: 600,
          fontSize: "14px",
        },
        dropShadow: {
          enabled: true,
          top: 1,
          left: 1,
          blur: 2,
          opacity: 0.8,
        },
      },
      stroke: { 
        colors: ["#0b1220"], 
        width: 3 
      },
      tooltip: {
        theme: "dark",
        background: "#0b2141",
        borderColor: "#00C2D1",
        borderWidth: 1,
        style: {
          fontSize: "14px",
        },
        y: { 
          formatter: (value: number) => `${value}% of total loans`,
          title: { formatter: (seriesName) => seriesName + ":" }
        },
      },
      legend: { 
        show: false,
      },
      responsive: [
        {
          breakpoint: 768,
          options: {
            chart: { height: 280 },
            plotOptions: {
              pie: {
                donut: {
                  labels: {
                    value: { fontSize: "18px" },
                    total: { fontSize: "12px" },
                  },
                },
              },
            },
          },
        },
      ],
    }),
    [],
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      setApplicationTrend((prevTrend) => {
        const lastValue = prevTrend[prevTrend.length - 1] ?? 235;
        const delta = Math.round(Math.random() * 16 - 6);
        const nextValue = Math.max(95, Math.min(260, lastValue + delta));
        return [...prevTrend.slice(-7), nextValue];
      });
    }, 4200);

    return () => window.clearInterval(interval);
  }, []);

  // Enhanced Application Trend Options
  const applicationTrendOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        id: "applications-trend",
        type: "area",
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: {
          enabled: true,
          easing: "easeinout",
          speed: 800,
          animateGradually: { enabled: true, delay: 150 },
          dynamicAnimation: { enabled: true, speed: 800 },
        },
        dropShadow: {
          enabled: true,
          top: 4,
          left: 0,
          blur: 8,
          color: "#00C2D1",
          opacity: 0.3,
        },
        foreColor: "#e2e8f0",
        background: "transparent",
        fontFamily: "inherit",
      },
      stroke: { 
        curve: "smooth", 
        width: 3, 
        colors: ["#00C2D1"],
        lineCap: "round"
      },
      fill: {
        type: "gradient",
        gradient: {
          shade: "dark",
          type: "vertical",
          shadeIntensity: 0.5,
          gradientToColors: ["rgba(0, 194, 209, 0.05)"],
          inverseColors: false,
          opacityFrom: 0.4,
          opacityTo: 0.1,
          stops: [0, 100],
        },
      },
      markers: {
        size: 5,
        colors: ["#061b34"],
        strokeColors: ["#00C2D1"],
        strokeWidth: 2,
        hover: { size: 7 },
        discrete: [
          {
            seriesIndex: 0,
            dataPointIndex: applicationTrend.length - 1,
            fillColor: "#00C2D1",
            strokeColor: "#ffffff",
            size: 8,
          },
        ],
      },
      xaxis: {
        categories: applicationTrend.map((_, index) => `Week ${index + 1}`),
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: { 
          style: { 
            colors: "#94a3b8", 
            fontSize: "12px",
            fontWeight: 500
          },
          rotate: 0,
          hideOverlappingLabels: true,
        },
        crosshairs: {
          show: true,
          stroke: { color: "#00C2D1", width: 1, dashArray: 4 },
        },
      },
      yaxis: {
        min: Math.min(...applicationTrend) - 20,
        max: Math.max(...applicationTrend) + 20,
        tickAmount: 5,
        labels: { 
          style: { 
            colors: "#94a3b8", 
            fontSize: "12px",
            fontWeight: 500
          },
          formatter: (value: number) => Math.round(value).toString(),
        },
      },
      grid: {
        borderColor: "rgba(148,163,184,0.15)",
        strokeDashArray: 4,
        yaxis: { lines: { show: true } },
        xaxis: { lines: { show: false } },
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
      },
      tooltip: {
        theme: "dark",
        background: "#0b2141",
        borderColor: "#00C2D1",
        borderWidth: 1,
        style: {
          fontSize: "13px",
          color: "#fff",
        },
        y: { 
          formatter: (value: number) => `${value} applications`,
          title: { formatter: () => "Applications:" }
        },
        x: { show: true },
      },
      dataLabels: { enabled: false },
      legend: { show: false },
      responsive: [
        {
          breakpoint: 768,
          options: {
            chart: { height: 220 },
            markers: { size: 4 },
            xaxis: {
              labels: { style: { fontSize: "10px" } }
            }
          },
        },
      ],
    }),
    [applicationTrend],
  );

  const handleLogout = async () => {
    setIsMobileMenuOpen(false);
    await signOut();
    navigate("/");
  };

  const handleBackToWelcome = () => {
    navigate("/home");
  };

  const handleMobileSupportNavigation = () => {
    navigate("/contact", { state: { from: location.pathname } });
  };

  const handleNewApplication = () => {
    setEditingAppId(undefined);
    setApplicationFlow("fresh");
    setIsModalOpen(true);
  };

  const handleOpenApplication = (applicationId: string) => {
    setEditingAppId(applicationId);
    setApplicationFlow("resume");
    setIsModalOpen(true);
  };

  const latestSavedApplication = applications[0];
  const latestDraftApplication = applications.find((application) => application.status === "draft");
  const applicationRows = applications.map((application) => ({
    id: formatApplicationId(application.id),
    type: getLoanSchemeName(application.loan_scheme),
    amount: application.eligible_loan_amount ?? application.amount ?? application.total_project_cost ?? 0,
    status: application.status,
    statusLabel: getStatusLabel(application.status),
    date: formatDate(application.created_at),
    applicationId: application.id,
    businessName: application.business_entity_name || "saved application",
    progress: Math.round(Math.min(Math.max(application.current_step ?? 0, 0), 10) * (100 / 10)),
  }));

  const filteredApplicationRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return applicationRows.filter((row) => {
      const matchesQuery =
        query.length === 0
        || row.id.toLowerCase().includes(query)
        || row.type.toLowerCase().includes(query)
        || row.statusLabel.toLowerCase().includes(query)
        || row.businessName.toLowerCase().includes(query);
      const matchesStatus =
        applicationStatusFilter === "all"
        || row.status.toLowerCase() === applicationStatusFilter;

      return matchesQuery && matchesStatus;
    });
  }, [applicationRows, applicationStatusFilter, searchQuery]);

  const filteredLoanDetailRows = useMemo(() => {
    const query = loanDetailSearch.trim().toLowerCase();
    if (!query) {
      return applicationRows;
    }

    return applicationRows.filter((row) =>
      row.id.toLowerCase().includes(query) ||
      row.type.toLowerCase().includes(query) ||
      row.businessName.toLowerCase().includes(query) ||
      row.statusLabel.toLowerCase().includes(query)
    );
  }, [applicationRows, loanDetailSearch]);

  const filteredDocumentRows = useMemo(() => {
    const query = documentSearch.trim().toLowerCase();
    if (!query) {
      return documentRows;
    }

    return documentRows.filter((doc) =>
      doc.name.toLowerCase().includes(query) ||
      doc.description.toLowerCase().includes(query) ||
      doc.helperText.toLowerCase().includes(query) ||
      (doc.fileName?.toLowerCase().includes(query) ?? false) ||
      getStatusLabel(doc.status).toLowerCase().includes(query)
    );
  }, [documentRows, documentSearch]);

  const dynamicAlerts = useMemo(() => {
    const alerts: Array<{ label: string; description: string; icon: typeof Bell }> = [];
    const latest = applications[0];
    if (latest) {
      if (latest.status === "rejected") {
        alerts.push({ label: "Application Rejected", description: "Your application was rejected. Please review and resubmit.", icon: ShieldCheck });
      } else if (["approved", "disbursed"].includes(latest.status)) {
        alerts.push({ label: "Application Approved!", description: "Congratulations! Your loan application has been approved.", icon: CheckCheck });
      } else if (latest.status === "under_review") {
        alerts.push({ label: "Under Review", description: "Your application is currently being reviewed by our team.", icon: Clock3 });
      } else if (latest.status === "submitted") {
        alerts.push({ label: "Submitted Successfully", description: "Your application is received and pending review.", icon: Check });
      }
    }
    const pendingDocs = documentRows.filter((d) => d.status === "pending").length;
    if (pendingDocs > 0) {
      alerts.push({ label: `${pendingDocs} Document${pendingDocs > 1 ? "s" : ""} Pending`, description: "Upload the required documents to proceed with your application.", icon: FileText });
    }
    if (alerts.length === 0) {
      alerts.push({ label: "All up to date", description: "No new notifications at this time.", icon: Bell });
    }
    return alerts;
  }, [applications, documentRows]);

  const documentSummary = useMemo(() => {
    const total = documentRows.length;
    const verified = documentRows.filter((doc) => doc.status === "verified").length;
    const pending = documentRows.filter((doc) => doc.status === "pending").length;
    const rejected = documentRows.filter((doc) => doc.status === "rejected").length;
    const completion = total > 0 ? Math.round((verified / total) * 100) : 0;

    return {
      total,
      verified,
      pending,
      rejected,
      completion,
    };
  }, [documentRows]);

  const applicationFlowSteps = useMemo(
    () => [
      { step: 1, title: "Personal Information", status: "completed", timestamp: "14 May 2026, 22:38" },
      { step: 2, title: "Business Details", status: "completed", timestamp: "15 May 2026, 01:38" },
      { step: 3, title: "Documents Upload", status: "completed", timestamp: "15 May 2026, 04:38" },
      { step: 4, title: "Loan Details", status: "completed", timestamp: "15 May 2026, 07:38" },
      { step: 5, title: "Purpose of Loan", status: "completed", timestamp: "15 May 2026, 10:38" },
      { step: 6, title: "Bank Details", status: "completed", timestamp: "15 May 2026, 13:38" },
      { step: 7, title: "Guarantor / Co-applicant", status: "completed", timestamp: "15 May 2026, 16:38" },
      { step: 8, title: "Declaration & Consent", status: "completed", timestamp: "15 May 2026, 19:38" },
      { step: 9, title: "Review Application", status: "completed", timestamp: "15 May 2026, 22:38" },
      { step: 10, title: "Submit Application", status: "active", timestamp: "16 May 2026, 01:38" },
    ],
    [],
  );

  const completedApplicationSteps = applicationFlowSteps.filter((step) => step.status === "completed").length;
  const totalApplicationSteps = applicationFlowSteps.length;
  const applicationProgressPercent = totalApplicationSteps > 0
    ? Math.round((completedApplicationSteps / totalApplicationSteps) * 100)
    : 0;
  const currentApplicationStep = applicationFlowSteps.find((step) => step.status === "active") ?? applicationFlowSteps[applicationFlowSteps.length - 1];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#061421]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-[#00C2D1]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#061421] text-slate-100">
      <aside className="fixed left-0 top-0 z-20 hidden h-full w-72 flex-col border-r border-white/10 bg-[#061b34]/95 p-6 shadow-[24px_0_80px_rgba(0,0,0,0.16)] backdrop-blur-xl lg:flex">
        <div className="mb-10">
          <p className="text-xs uppercase tracking-[0.32em] text-slate-400">Loan Management</p>
          <h1 className="mt-3 text-2xl font-semibold text-white">Loan Management System</h1>
        </div>
        <nav className="space-y-1 text-sm font-medium">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSectionNavigation(item.id)}
                aria-current={active ? "page" : undefined}
                className={`group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all duration-200 ${
                  active
                    ? "bg-[linear-gradient(90deg,rgba(0,194,209,0.18),rgba(0,194,209,0.06))] text-white shadow-[0_8px_24px_rgba(0,194,209,0.2)] ring-1 ring-[#00C2D1]/15"
                    : "text-slate-400 hover:bg-[linear-gradient(90deg,rgba(0,194,209,0.08),rgba(0,194,209,0.02))] hover:text-white hover:shadow-[0_4px_12px_rgba(0,194,209,0.08)]"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="mt-auto rounded-[1.75rem] border border-white/10 bg-white/5 p-5 text-sm text-slate-200 shadow-sm">
          <p className="font-semibold text-white">Need Help?</p>
          <p className="mt-2 text-xs text-slate-400">Contact our support team for fast assistance.</p>
          <button type="button" onClick={() => navigate("/contact")} className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-[#00C2D1] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#00b3c3]">
            Contact Support
          </button>
        </div>
      </aside>

      <div
        className={`fixed inset-0 z-40 bg-[#020814]/72 backdrop-blur-sm transition duration-300 lg:hidden ${
          isMobileMenuOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setIsMobileMenuOpen(false)}
        aria-hidden="true"
      />
      <div
        id="mobile-dashboard-menu"
        className={`fixed inset-y-0 left-0 z-50 flex w-[88vw] max-w-sm flex-col border-r border-[#00C2D1]/30 bg-[linear-gradient(180deg,rgba(7,21,41,0.98),rgba(8,27,49,0.98))] shadow-[24px_0_80px_rgba(0,0,0,0.4)] transition-transform duration-300 ease-out lg:hidden ${
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Mobile navigation menu"
      >
        <div className="flex items-start justify-between border-b border-[#00C2D1]/20 px-5 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-[1.35rem] bg-white shadow-[0_10px_30px_rgba(255,255,255,0.12)]">
              <img src="/logo.png" alt="EazyBizy logo" className="h-10 w-10 object-contain" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Loan Dashboard</p>
              <h2 className="mt-1 text-xl font-semibold text-white">EazyBizy</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(false)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#00C2D1]/25 bg-[#0b2141] text-slate-100 transition hover:border-[#00C2D1] hover:bg-[#0d2853]"
            aria-label="Close mobile menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-5">
          <div className="space-y-3">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    handleSectionNavigation(item.id);
                  }}
                  aria-current={active ? "page" : undefined}
                  className={`flex w-full items-center gap-4 rounded-[1.45rem] border px-4 py-4 text-left transition ${
                    active
                      ? "border-[#00C2D1]/40 bg-[linear-gradient(90deg,rgba(0,194,209,0.16),rgba(11,33,65,0.96))] text-white shadow-[0_14px_34px_rgba(0,194,209,0.16)]"
                      : "border-white/8 bg-[#0a1f3a]/88 text-slate-200 hover:border-[#00C2D1]/25 hover:bg-[#0d2853]"
                  }`}
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#00C2D1]/15 bg-[#061421]">
                    <Icon className="h-5 w-5 text-[#7BE7F0]" />
                  </span>
                  <span className="text-sm font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-[#00C2D1]/20 px-4 pb-6 pt-5">
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => {
                setIsMobileMenuOpen(false);
                navigate("/profile");
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[1.35rem] border border-[#D4AF37]/35 bg-[linear-gradient(180deg,rgba(212,175,55,0.22),rgba(164,122,8,0.2))] px-4 py-3.5 text-sm font-semibold text-[#F6DC7A] transition hover:bg-[linear-gradient(180deg,rgba(212,175,55,0.28),rgba(164,122,8,0.24))]"
            >
              <User className="h-4 w-4" />
              Profile
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[1.35rem] border border-[#D4AF37]/35 bg-[linear-gradient(180deg,rgba(212,175,55,0.18),rgba(212,175,55,0.08))] px-4 py-3.5 text-sm font-semibold text-[#F6DC7A] transition hover:bg-[linear-gradient(180deg,rgba(212,175,55,0.26),rgba(212,175,55,0.12))]"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </div>
      </div>

      <main className="min-h-screen overflow-x-hidden overflow-y-auto px-3 pb-28 pt-4 sm:px-6 sm:py-5 lg:ml-72 lg:px-8 lg:pb-5">
        <div className="grid gap-4">
          <section className="rounded-[2rem] border border-[#00C2D1]/20 bg-[linear-gradient(180deg,rgba(8,27,49,0.98),rgba(7,23,43,0.96))] px-4 py-4 shadow-[0_24px_60px_rgba(0,0,0,0.22)] ring-1 ring-[#00C2D1]/10 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  if (isDashboardPage) {
                    handleBackToWelcome();
                    return;
                  }

                  navigate("/dashboard", { state: backOrigin ? { from: backOrigin } : undefined });
                }}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#00C2D1]/45 bg-[#0b2445] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#10305a]"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>

              <button
                type="button"
                onClick={handleMobileSupportNavigation}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[linear-gradient(90deg,#2ad6e8,#47d68d)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_34px_rgba(42,214,232,0.24)] transition hover:brightness-105"
              >
                Support
              </button>
            </div>

            <div className="mt-5 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.36em] text-slate-400">LOAN MANAGEMENT</p>
                <h1 className="mt-3 break-words text-[2rem] font-semibold leading-tight text-white sm:text-[2.2rem]">Loan Management System</h1>
              </div>

              <button
                type="button"
                onClick={() => setIsMobileMenuOpen((open) => !open)}
                aria-expanded={isMobileMenuOpen}
                aria-label="Open loan management menu"
                aria-controls="mobile-dashboard-menu"
                className={`inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.45rem] border transition ${
                  isMobileMenuOpen
                    ? "border-[#00C2D1]/45 bg-[#0d3154] text-white"
                    : "border-[#2f4f75] bg-[#102847] text-white hover:border-[#00C2D1]/35 hover:bg-[#123153]"
                }`}
              >
                {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </section>
          <header
            id="dashboard"
            className={`rounded-[2rem] border border-white/10 bg-white/5 p-4 ring-1 ring-white/10 backdrop-blur-xl shadow-[0_25px_100px_rgba(0,194,209,0.18)] sm:p-5 ${
              isDocumentsPage
                ? "grid gap-5 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(0,194,209,0.08),transparent_38%),linear-gradient(180deg,rgba(10,30,56,0.97),rgba(8,26,48,0.97))] px-4 py-6 sm:px-8 sm:py-7 xl:grid-cols-[1.15fr_1.55fr] xl:items-center"
                : isApplicationsPage
                  ? "grid gap-5 bg-[radial-gradient(circle_at_top,rgba(0,194,209,0.14),transparent_34%),linear-gradient(180deg,rgba(10,30,56,0.96),rgba(7,25,47,0.96))] p-4 sm:gap-6 sm:p-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.8fr)]"
                  : "grid gap-4 sm:grid-cols-[1.7fr_1fr] lg:grid-cols-[1.5fr_0.8fr_0.7fr]"
            }`}
          >
            <div className={isDocumentsPage ? "max-w-4xl" : ""}>
              <button
                type="button"
                onClick={handleBackToWelcome}
                className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#00C2D1]/45 bg-[#0b2445] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#10305a]"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Home
              </button>
              <p className="text-xs uppercase tracking-[0.32em] text-slate-400">{headerEyebrow}</p>
              <h2 className="mt-2 break-words text-[1.95rem] font-semibold leading-tight text-white sm:text-4xl">{headerTitle}</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">{headerDescription}</p>
            </div>
            {isDocumentsPage ? (
              <div className="grid gap-3 rounded-[1.75rem] border border-[#d4af37]/12 bg-[linear-gradient(180deg,rgba(13,39,73,0.96),rgba(9,31,58,0.96))] p-4 sm:grid-cols-2 xl:grid-cols-5 xl:gap-0 xl:p-0">
                {[
                  { label: "Total Documents", value: documentSummary.total, color: "text-[#9beaf3]" },
                  { label: "Verified", value: documentSummary.verified, color: "text-[#6ae5b0]" },
                  { label: "Pending", value: documentSummary.pending, color: "text-[#f2d15f]" },
                  { label: "Rejected", value: documentSummary.rejected, color: "text-white" },
                  { label: "Completion", value: `${documentSummary.completion}%`, color: "text-[#62e6ff]" },
                ].map((item, index) => (
                  <div
                    key={item.label}
                    className={`flex min-h-[174px] flex-col justify-between rounded-[1.3rem] px-4 py-4 sm:px-5 xl:rounded-none xl:px-6 xl:py-5 ${index < 4 ? "xl:border-r xl:border-[#d4af37]/12" : ""}`}
                  >
                    <p className="min-h-[2.75rem] text-xs uppercase tracking-[0.28em] text-slate-400">{item.label}</p>
                    <p className={`whitespace-nowrap text-5xl font-semibold leading-none ${item.color}`}>{item.value}</p>
                  </div>
                ))}
              </div>
            ) : isApplicationsPage ? (
              <div className="grid w-full gap-3 self-start lg:justify-self-end lg:min-w-[320px]">
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={handleNewApplication}
                    className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-[1.35rem] bg-[linear-gradient(90deg,#2ad6e8,#1ea7ff)] px-5 py-4 text-center text-sm font-semibold text-white shadow-[0_18px_50px_rgba(0,194,209,0.28)] transition hover:brightness-105"
                  >
                    <Plus className="h-4 w-4" />
                    Create New Application
                  </button>
                  <button
                    type="button"
                    onClick={() => latestSavedApplication ? handleOpenApplication(latestSavedApplication.id) : handleNewApplication()}
                    className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-[1.35rem] border border-white/12 bg-[#0d2543]/80 px-5 py-4 text-center text-sm font-medium text-slate-100 transition hover:border-[#00C2D1]/45 hover:bg-[#0f2b4f]"
                  >
                    <PencilLine className="h-4 w-4" />
                    Edit Application
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => latestDraftApplication ? handleOpenApplication(latestDraftApplication.id) : handleNewApplication()}
                  className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-[1.35rem] border border-white/10 bg-[#0c1f3a]/90 px-5 py-4 text-center text-sm font-medium text-slate-100 transition hover:border-[#D4AF37]/35 hover:bg-[#102747]"
                >
                  <FileText className="h-4 w-4" />
                  Save Draft
                </button>
              </div>
            ) : !isDocumentsPage ? (
              <>
                <div className="flex items-center gap-3 rounded-[1.5rem] border border-white/10 bg-[#06203a]/80 p-3">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(event) => handleSearchChange(event.target.value)}
                      placeholder="Search applicant, loan, documents..."
                      className="w-full rounded-2xl border border-transparent bg-[#0b2141] p-3 pl-11 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#00C2D1]/50 focus:ring-2 focus:ring-[#00C2D1]/20"
                    />
                  </div>
                  <div className="relative">
                    <button type="button" onClick={() => setNotificationsOpen((o) => !o)} className="relative inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2141] text-slate-100 transition hover:bg-[#0d2853]">
                      <Bell className="h-5 w-5" />
                      {dynamicAlerts.some((a) => a.label !== "All up to date") && (
                        <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-[#D4AF37] ring-2 ring-[#061421]" />
                      )}
                    </button>
                    {notificationsOpen && (
                      <div className="absolute right-0 top-14 z-50 w-80 rounded-[1.5rem] border border-white/10 bg-[#081b34] shadow-[0_20px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl">
                        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                          <p className="text-sm font-semibold text-white">Notifications</p>
                          <button type="button" onClick={() => setNotificationsOpen(false)} className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
                        </div>
                        <div className="max-h-72 overflow-y-auto">
                          {dynamicAlerts.map((alert, idx) => {
                            const Icon = alert.icon;
                            return (
                              <div key={idx} className="flex items-start gap-3 border-b border-white/[0.05] px-4 py-3 last:border-0">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#00C2D1]/10">
                                  <Icon className="h-4 w-4 text-[#00C2D1]" />
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-white">{alert.label}</p>
                                  <p className="mt-0.5 text-xs text-slate-400">{alert.description}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-white/10 bg-[#06203a]/80 p-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Admin User</p>
                    <p className="mt-1 font-semibold text-white">{userName}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => navigate("/profile")} className="inline-flex items-center gap-2 rounded-2xl border border-[#00C2D1]/25 bg-[#0b2141] px-4 py-3 text-sm text-slate-100 transition hover:border-[#00C2D1] hover:bg-[#0d2853]">
                      <User className="h-4 w-4" />
                      Profile
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={handleLogout} className="inline-flex items-center gap-2 rounded-2xl border border-[#00C2D1]/20 bg-[#0b2141] px-4 py-3 text-sm text-slate-100 transition hover:border-[#00C2D1] hover:bg-[#0d2853]">
                      <LogOut className="h-4 w-4 text-[#7BE7F0]" />
                      Logout
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </header>
          {isLoanDetailsPage ? (
            <section id="loan-detail-view" className="grid gap-6">
              <article className={`${panelClass}`}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.32em] text-slate-400">Loan Details</p>
                    <h2 className="mt-2 text-4xl font-semibold text-white">User: Your Records & Payments</h2>
                    <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300">Detailed loan insights, repayment history and document access for your current application.</p>
                  </div>
                  <div className="rounded-[1.75rem] border border-white/10 bg-[#06203a]/80 p-4 text-sm text-slate-300">
                    <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Loan status</p>
                    <p className="mt-2 text-xl font-semibold text-white">In Progress</p>
                  </div>
                </div>
                <div className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_1fr]">
                  <div className="rounded-[1.75rem] border border-white/10 bg-[#0b2141]/90 p-6">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Personal Financial Overview</p>
                        <h3 className="mt-2 text-2xl font-semibold text-white">Current Loan: {loanSummaryItems[0]?.value} (Personal Loan)</h3>
                      </div>
                      <span className="rounded-full bg-[#00C2D1]/10 px-3 py-2 text-sm font-semibold text-[#00C2D1]">Live overview</span>
                    </div>
                    <div className="mt-6 grid gap-4 sm:grid-cols-2">
                      <div className="rounded-[1.5rem] border border-white/10 bg-[#061b34]/80 p-4">
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Payment Status</p>
                        <p className="mt-2 text-lg font-semibold text-white">In Progress</p>
                      </div>
                      <div className="rounded-[1.5rem] border border-white/10 bg-[#061b34]/80 p-4">
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Overall Progress</p>
                        <p className="mt-2 text-lg font-semibold text-white">70%</p>
                      </div>
                      <div className="rounded-[1.5rem] border border-white/10 bg-[#061b34]/80 p-4">
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Next Due Date</p>
                        <p className="mt-2 text-lg font-semibold text-white">15 Jun 2024</p>
                      </div>
                      <div className="rounded-[1.5rem] border border-white/10 bg-[#061b34]/80 p-4">
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Current Loan Type</p>
                        <p className="mt-2 text-lg font-semibold text-white">Personal Loan</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[1.75rem] border border-white/10 bg-[#0b2141]/90 p-6">
                    <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Loan Overview</p>
                    <div className="mt-4 grid gap-4">
                      {loanSummaryItems.map((item) => (
                        <div key={item.label} className="rounded-[1.5rem] border border-white/10 bg-[#061b34]/80 p-4">
                          <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{item.label}</p>
                          <p className="mt-2 text-lg font-semibold text-white">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-[1.75rem] border border-white/10 bg-[#0b2141]/90 p-6">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">My Repayment History</p>
                        <h3 className="mt-2 text-2xl font-semibold text-white">Recent payments</h3>
                      </div>
                      <button type="button" onClick={handleDownloadAllRecords} className="inline-flex items-center gap-2 rounded-2xl bg-[#00C2D1] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#00adc4]">Download All Records</button>
                    </div>
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={loanDetailSearch}
                          onChange={(event) => setLoanDetailSearch(event.target.value)}
                          placeholder="Search payments..."
                          className="w-full rounded-2xl border border-transparent bg-[#061421] p-3 pl-11 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#00C2D1]/50 focus:ring-2 focus:ring-[#00C2D1]/20"
                        />
                      </div>
                    </div>
                    <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#061b34]/80">
                      <table className="min-w-full divide-y divide-white/10 text-left text-sm text-slate-300">
                        <thead className="bg-[#071c35]/95">
                          <tr>
                            {["Payment Date", "Description", "Amount", "Status", "Action"].map((heading) => (
                              <th key={heading} className="px-4 py-4 text-xs uppercase tracking-[0.25em] text-slate-500">
                                {heading}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                          {filteredLoanDetailRows.map((row) => (
                            <tr key={row.id} className="transition-colors duration-200 hover:bg-white/5">
                              <td className="px-4 py-4">{row.date}</td>
                              <td className="px-4 py-4">{row.businessName}</td>
                              <td className="px-4 py-4">{formatCurrency(row.amount)}</td>
                              <td className="px-4 py-4">
                                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(row.status)}`}>
                                  {row.statusLabel}
                                </span>
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex flex-wrap items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenApplication(row.applicationId)}
                                    className="rounded-2xl bg-[#0b2141] px-4 py-2 text-xs font-semibold text-[#00C2D1] transition hover:bg-[#0d2853] hover:text-white"
                                  >
                                    View
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadSingleRecord(row)}
                                    className="inline-flex items-center gap-2 rounded-2xl bg-[#D4AF37]/15 px-4 py-2 text-xs font-semibold text-[#D4AF37] transition hover:bg-[#D4AF37]/25"
                                    title="Download this record"
                                  >
                                    <Download className="h-3 w-3" />
                                    Download
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="rounded-[1.75rem] border border-white/10 bg-[#0b2141]/90 p-6">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Accessible Loan Documents</p>
                        <h3 className="mt-2 text-2xl font-semibold text-white">Ready to download</h3>
                      </div>
                      <button type="button" onClick={handleDownloadAllDocuments} className="inline-flex items-center gap-2 rounded-2xl bg-[#D4AF37]/15 px-4 py-3 text-sm font-semibold text-[#D4AF37] transition hover:bg-[#d4af3760]">Download All Documents</button>
                    </div>
                    <div className="mt-5 relative">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={documentSearch}
                          onChange={(event) => setDocumentSearch(event.target.value)}
                          placeholder="Search documents..."
                          className="w-full rounded-2xl border border-transparent bg-[#061421] p-3 pl-11 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#00C2D1]/50 focus:ring-2 focus:ring-[#00C2D1]/20"
                        />
                      </div>
                    </div>
                    <div className="mt-5 space-y-3">
                      {filteredDocumentRows.map((doc) => (
                        <div key={doc.name} className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-white/10 bg-[#061b34]/80 px-4 py-4">
                          <div>
                            <p className="font-medium text-white">{doc.name}</p>
                            <p className="text-xs text-slate-400">{doc.helperText}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => handleUpload()} className="rounded-2xl bg-[#0b2141] px-3 py-2 text-xs font-semibold text-[#00C2D1] transition hover:bg-[#0d2853]">Upload</button>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${doc.status === "verified" ? "bg-[#00C2D1]/10 text-[#00C2D1]" : doc.status === "pending" ? "bg-white/10 text-slate-200" : "bg-[#D4AF37]/10 text-[#D4AF37]"}`}>{getStatusLabel(doc.status)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            </section>
          ) : showOverviewSection ? (
          <section className="grid gap-4 xl:grid-cols-12 xl:items-start">
            <article id="applications" className={`${panelClass} xl:col-span-8`}>
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-[#00C2D1]/15 text-[#00C2D1]"><User className="h-8 w-8" /></div>
                  <div>
                    <p className="text-sm uppercase tracking-[0.28em] text-slate-400">Applicant overview</p>
                    <h3 className="mt-2 text-2xl font-semibold text-white">{userName}</h3>
                    <p className="mt-1 text-sm text-slate-300">
                      {applications.length > 0
                        ? `${applications.length} application${applications.length !== 1 ? "s" : ""} — ${getStatusLabel(applications[0]?.status ?? "draft")}`
                        : "No applications yet."}
                    </p>
                  </div>
                </div>
                <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-auto lg:grid-cols-4">
                  {[
                    { label: "Applications", value: String(applications.length), accent: "border-[#00C2D1]/20 bg-gradient-to-br from-[#00C2D1]/10 to-[#061b34]/80", glow: "hover:shadow-[0_8px_24px_rgba(0,194,209,0.2)] hover:border-[#00C2D1]/40" },
                    { label: "Approved", value: String(applications.filter((a) => ["approved", "disbursed"].includes(a.status)).length), accent: "border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-[#061b34]/80", glow: "hover:shadow-[0_8px_24px_rgba(34,197,94,0.2)] hover:border-emerald-500/40" },
                    { label: "Status", value: applications[0] ? getStatusLabel(applications[0].status) : "—", accent: "border-[#D4AF37]/20 bg-gradient-to-br from-[#D4AF37]/10 to-[#061b34]/80", glow: "hover:shadow-[0_8px_24px_rgba(212,175,55,0.2)] hover:border-[#D4AF37]/40" },
                    { label: "Docs Done", value: `${documentRows.filter((d) => d.status === "verified").length}/${documentRows.length}`, accent: "border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-[#061b34]/80", glow: "hover:shadow-[0_8px_24px_rgba(139,92,246,0.2)] hover:border-violet-500/40" },
                  ].map((item) => (
                    <div key={item.label} className={`rounded-[1.5rem] border p-4 transition-all duration-300 ${item.accent} ${item.glow} hover:-translate-y-0.5`}>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{item.label}</p>
                      <p className="mt-2 text-lg font-semibold text-white">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.25fr_0.75fr]">
                <div className="relative overflow-hidden rounded-[1.75rem] border border-[#00C2D1]/15 bg-gradient-to-br from-[#0d2a4a]/90 to-[#061421]/95 p-5 transition-all duration-300 hover:border-[#00C2D1]/30 hover:shadow-[0_16px_40px_rgba(0,194,209,0.12)]">
                  <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-[#00C2D1]/[0.07] blur-2xl" />
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Approval Progress</p>
                      <p className={`mt-2 text-3xl font-bold ${progressColor === "#ef4444" ? "text-red-400" : progressColor === "#22c55e" ? "text-emerald-400" : "text-[#00C2D1]"}`}>
                        {circularProgress}%
                      </p>
                      <p className={`mt-1 text-sm font-medium ${progressColor === "#ef4444" ? "text-red-400/70" : progressColor === "#22c55e" ? "text-emerald-400/70" : "text-cyan-400/70"}`}>
                        {progressLabel}
                      </p>
                    </div>
                    <div className="relative h-28 w-28 rounded-full bg-[#0f2b4f] p-3">
                      <svg viewBox="0 0 96 96" className="h-full w-full">
                        {/* Background track */}
                        <circle 
                          cx="48" 
                          cy="48" 
                          r="38" 
                          stroke="rgba(255,255,255,0.1)" 
                          strokeWidth="10" 
                          fill="none" 
                        />
                        {/* Progress ring with dynamic color */}
                        <circle 
                          cx="48" 
                          cy="48" 
                          r="38" 
                          stroke={progressColor} 
                          strokeWidth="10" 
                          fill="none" 
                          strokeLinecap="round" 
                          strokeDasharray="238" 
                          strokeDashoffset={238 - (238 * circularProgress) / 100} 
                          transform="rotate(-90 48 48)"
                          style={{ transition: "stroke 0.5s ease" }}
                        />
                      </svg>
                      {/* Center icon indicating status */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        {progressColor === "#ef4444" ? (
                          <span className="text-red-400 text-2xl">!</span>
                        ) : progressColor === "#22c55e" ? (
                          <Check className="h-6 w-6 text-emerald-400" />
                        ) : (
                          <Clock3 className="h-6 w-6 text-cyan-400" />
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {approvalMilestones.map((milestone) => (
                      <div
                        key={milestone.label}
                        className={`flex items-center gap-2 rounded-2xl border px-3 py-2 transition-all duration-200 ${
                          milestone.status === "completed"
                            ? "border-emerald-500/25 bg-emerald-500/10 hover:border-emerald-500/40"
                            : milestone.status === "active"
                              ? "border-cyan-400/25 bg-cyan-400/10 hover:border-cyan-400/40"
                              : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <span className={`h-2 w-2 rounded-full ${milestone.status === "completed" ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" : milestone.status === "active" ? "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)] animate-pulse" : "bg-slate-600"}`} />
                        <p className={`text-xs font-semibold ${milestone.status === "completed" ? "text-emerald-400" : milestone.status === "active" ? "text-cyan-300" : "text-slate-500"}`}>{milestone.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="relative overflow-hidden rounded-[1.75rem] border border-[#D4AF37]/15 bg-gradient-to-br from-[#1a1200]/60 to-[#061421]/90 p-5 transition-all duration-300 hover:border-[#D4AF37]/30 hover:shadow-[0_16px_40px_rgba(212,175,55,0.12)]">
                  <div className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full bg-[#D4AF37]/[0.08] blur-2xl" />
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Submission Date</p>
                      <p className="mt-2 text-lg font-semibold text-white">{applications[0] ? formatDate(applications[0].created_at) : "—"}</p>
                    </div>
                    <div className={`rounded-3xl px-3 py-2 text-sm font-semibold ${["approved","disbursed"].includes(applications[0]?.status ?? "") ? "bg-emerald-500/10 text-emerald-400" : applications[0]?.status === "rejected" ? "bg-red-500/10 text-red-400" : "bg-[#D4AF37]/10 text-[#D4AF37]"}`}>
                      {applications[0] ? getStatusLabel(applications[0].status) : "—"}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2">
                    <div className="rounded-[1.25rem] border border-[#00C2D1]/15 bg-[#00C2D1]/[0.06] p-3 transition hover:border-[#00C2D1]/30 hover:bg-[#00C2D1]/10">
                      <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Loan Type</p>
                      <p className="mt-1.5 text-base font-semibold text-white">{applications[0] ? getLoanSchemeName(applications[0].loan_scheme) : "—"}</p>
                    </div>
                    <div className="rounded-[1.25rem] border border-[#D4AF37]/15 bg-[#D4AF37]/[0.06] p-3 transition hover:border-[#D4AF37]/30 hover:bg-[#D4AF37]/10">
                      <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Applicant ID</p>
                      <p className="mt-1.5 text-base font-semibold text-[#F5D778]">{applications[0] ? formatApplicationId(applications[0].id) : "—"}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Applications — fills vertical gap */}
              <div className="mt-4 overflow-hidden rounded-[1.75rem] border border-white/[0.08] bg-[#071c35]/80">
                <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Recent Applications</p>
                  <button
                    type="button"
                    onClick={() => handleSectionNavigation("applications")}
                    className="text-xs font-medium text-[#00C2D1] transition hover:text-[#7BE7F0]"
                  >
                    View all →
                  </button>
                </div>
                {applicationsLoading ? (
                  <div className="px-5 py-6 text-center text-xs text-slate-500">Loading…</div>
                ) : applications.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
                    <p className="text-sm text-slate-400">No applications yet.</p>
                    <button
                      type="button"
                      onClick={handleNewApplication}
                      className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#00C2D1] to-[#0891b2] px-4 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(0,194,209,0.3)] transition hover:brightness-110"
                    >
                      <Plus className="h-3.5 w-3.5" /> Start Application
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.05]">
                    {applications.slice(0, 5).map((app) => (
                      <div
                        key={app.id}
                        className="flex items-center gap-3 px-5 py-3 transition-colors duration-150 hover:bg-white/[0.03]"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-white">{formatApplicationId(app.id)}</p>
                          <p className="text-xs text-slate-500">{getLoanSchemeName(app.loan_scheme)} · {formatDate(app.created_at)}</p>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusBadgeClass(app.status)}`}>
                          {getStatusLabel(app.status)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleOpenApplication(app.id)}
                          className="shrink-0 rounded-xl bg-[#00C2D1]/10 px-3 py-1.5 text-xs font-medium text-[#00C2D1] transition hover:bg-[#00C2D1]/20 hover:shadow-[0_4px_12px_rgba(0,194,209,0.2)]"
                        >
                          Open
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
            <aside id="reports" className={`${panelClass} bg-[#061b34]/95 xl:col-span-4`}>
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-xs uppercase tracking-[0.28em] text-slate-400">Summary</p><h3 className="mt-2 text-2xl font-semibold text-white">Quick Snapshot</h3></div>
                <button type="button" onClick={handleViewSummary} className="inline-flex items-center gap-2 rounded-2xl border border-[#00C2D1]/25 bg-[#0b2141] px-4 py-3 text-sm text-slate-100 transition hover:border-[#00C2D1] hover:bg-[#0d2853]"><Eye className="h-4 w-4" />View</button>
              </div>
              <div className="relative mt-6 overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(0,194,209,0.18),transparent_30%),linear-gradient(180deg,rgba(11,33,65,0.95),rgba(6,27,52,0.96))] p-5 shadow-[0_24px_80px_rgba(0,194,209,0.12)] ring-1 ring-white/5 sm:p-6">
                <div className="pointer-events-none absolute inset-x-8 top-0 h-24 rounded-full bg-[#00C2D1]/10 blur-3xl" />
                <div className="relative flex h-full flex-col">
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.32em] text-slate-400">Total Applications</p>
                      <p className="mt-2 text-4xl font-semibold leading-none text-white">
                        {animatedSummaryValues.total}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 rounded-full border border-[#00C2D1]/20 bg-[#00C2D1]/10 px-3 py-1.5 text-sm font-semibold text-[#7BE7F0]">
                      {smartSummaryStats.totalTrend}
                    </span>
                  </div>

                  <div className="py-3">
                    <div className="mx-auto max-w-[260px]">
                      <Chart
                        options={summaryStatusDonutOptions}
                        series={summaryStatusSeries}
                        type="donut"
                        height={200}
                        width="100%"
                      />
                    </div>
                  </div>

                  <div className="grid gap-2">
                    {smartSummaryStats.items.map((item) => {
                      const Icon = item.icon;
                      const animatedValue = animatedSummaryValues[item.key] ?? item.value;
                      const gradientMap: Record<string, string> = {
                        approved: "from-[#00C2D1]/10 to-[#061421]/80 border-[#00C2D1]/20 hover:border-[#00C2D1]/40 hover:shadow-[0_12px_30px_rgba(0,194,209,0.18)]",
                        pending:  "from-[#D4AF37]/10 to-[#061421]/80 border-[#D4AF37]/20 hover:border-[#D4AF37]/40 hover:shadow-[0_12px_30px_rgba(212,175,55,0.18)]",
                        rejected: "from-white/5 to-[#061421]/80 border-white/10 hover:border-white/20 hover:shadow-[0_12px_30px_rgba(255,255,255,0.06)]",
                      };
                      const cardGradient = gradientMap[item.key] ?? gradientMap.rejected;

                      return (
                        <div
                          key={item.key}
                          className={`group relative overflow-hidden rounded-[1.25rem] border bg-gradient-to-br p-3.5 transition-all duration-300 hover:-translate-y-0.5 ${cardGradient}`}
                        >
                          {/* subtle shimmer line at top */}
                          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border ${item.softAccentClass}`}>
                                <Icon className="h-3.5 w-3.5" />
                              </span>
                              <div>
                                <p className="text-sm font-semibold text-white">{item.label}</p>
                                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{item.percentage.toFixed(0)}% of total</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="tabular-nums text-2xl font-bold text-white">{animatedValue}</p>
                              <p className="text-[11px] text-slate-400">{item.percentage.toFixed(1)}%</p>
                            </div>
                          </div>
                          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div
                              className={`h-full rounded-full ${item.progressClass} transition-[width] duration-1000 ease-out`}
                              style={{ width: `${Math.max(item.percentage, 4)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </aside>
          </section>
          ) : null}

          {isDocumentsPage ? (
          <section id="documents" className="grid gap-4">
            <input
              ref={uploadInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={handleFileChange}
            />

            <article className="rounded-[2rem] border border-[#00C2D1]/35 bg-[linear-gradient(180deg,rgba(7,25,51,0.98),rgba(6,22,42,0.98))] p-4 shadow-[0_28px_100px_rgba(0,194,209,0.1)] ring-1 ring-[#00C2D1]/10 sm:p-6">
              <div className="flex flex-col gap-5 border-b border-white/10 pb-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.5rem] border border-[#00C2D1]/20 bg-[#0b2d4f] text-[#9beaf3] shadow-[0_0_0_1px_rgba(0,194,209,0.12)]">
                    <FolderPlus className="h-7 w-7" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-semibold text-white sm:text-[2rem]">Required Loan Documents</h3>
                    <p className="mt-2 text-base text-slate-300">
                      Please upload the following documents to proceed with your loan application.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-[1.75rem] border border-[#d4af37]/15 bg-[linear-gradient(180deg,rgba(8,25,49,0.98),rgba(8,24,44,0.98))]">
                {documentsLoading ? (
                  <div className="px-5 py-10 text-center text-base text-slate-300">
                    Loading your documents...
                  </div>
                ) : filteredDocumentRows.map((doc, index) => {
                  const isVerified = doc.status === "verified";
                  const isRejected = doc.status === "rejected";
                  const isWorking = documentActionInProgress === doc.documentType;
                  const statusColorClass = isVerified
                    ? "text-[#59e3a6]"
                    : isRejected
                      ? "text-[#f19ab0]"
                      : "text-[#f3cf63]";
                  const statusBadgeClass = isVerified
                    ? "border-[#2ecf8f]/25 bg-[#123a39] text-[#74ebb7]"
                    : isRejected
                      ? "border-[#f19ab0]/20 bg-[#3a2430] text-[#f7bfd0]"
                      : "border-[#d4af37]/25 bg-[#2b3240] text-[#f3cf63]";

                  return (
                    <div
                      key={doc.id}
                      className={`grid gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1.3fr)_260px_250px] lg:items-center lg:px-6 ${index < filteredDocumentRows.length - 1 ? "border-b border-white/10" : ""}`}
                    >
                      <div className="flex items-start gap-5">
                        <div className="flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-[1.2rem] border border-[#d4af37]/18 bg-[linear-gradient(180deg,rgba(25,67,108,0.85),rgba(9,38,74,0.95))] text-3xl font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                          {doc.id}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-2xl font-semibold text-white">{doc.name}</h4>
                          <p className="mt-1 text-lg text-slate-400">{doc.description}</p>
                          {doc.fileName ? (
                            <p className="mt-3 truncate text-sm text-[#7fc8dd]">Uploaded file: {doc.fileName}</p>
                          ) : null}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className={`flex items-center gap-3 text-xl font-medium ${statusColorClass}`}>
                          <span className={`h-3 w-3 rounded-full ${isVerified ? "bg-[#2ee59d] shadow-[0_0_12px_rgba(46,229,157,0.8)]" : isRejected ? "bg-[#f19ab0]" : "bg-[#f3cf63] shadow-[0_0_10px_rgba(243,207,99,0.55)]"}`} />
                          {getStatusLabel(doc.status)}
                        </div>
                        <p className="text-base text-slate-400">{doc.helperText}</p>
                        {isVerified ? (
                          <button
                            type="button"
                            onClick={() => setActivePreviewDocument(doc)}
                            className="inline-flex items-center gap-2 rounded-full border border-[#00C2D1]/30 bg-[#0c2b4a] px-4 py-2 text-sm font-medium text-[#9beaf3] transition hover:bg-[#10385c]"
                          >
                            <Eye className="h-4 w-4" />
                            Preview
                          </button>
                        ) : null}
                      </div>

                      <div className="flex flex-col gap-3 lg:items-end">
                        <button
                          type="button"
                          onClick={() => handleDocumentUpload(doc.name)}
                          disabled={isWorking}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[#35cce4]/60 bg-[#103857] px-5 py-4 text-base font-medium text-[#c2fbff] transition hover:bg-[#124264] lg:max-w-[240px]"
                        >
                          <Upload className="h-4 w-4" />
                          {isWorking ? "Uploading..." : "Upload"}
                        </button>
                        <div className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-5 py-4 text-base font-medium lg:max-w-[240px] ${statusBadgeClass}`}>
                          {isVerified ? <Check className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                          {getStatusLabel(doc.status)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          </section>
          ) : null}

          {isApplicationsPage ? (
          <section id="applications" className="grid gap-6">
            <article className="overflow-hidden rounded-[2rem] border border-cyan-200/80 bg-white/95 p-4 shadow-[0_28px_100px_rgba(0,194,209,0.12)] ring-1 ring-cyan-100 sm:p-6">
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.34em] text-cyan-700">Step 10 of 10</p>
                    <h3 className="mt-3 break-words text-[1.95rem] font-semibold leading-tight text-slate-950 sm:text-[2.6rem]">Application Progress</h3>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
                      Track every stage of your loan application in one view.
                    </p>
                  </div>
                  <div className="flex w-full max-w-full flex-col items-center gap-4 self-start rounded-[1.7rem] border border-cyan-200 bg-cyan-50/80 px-4 py-4 text-center sm:w-auto sm:flex-row sm:px-5">
                    <div className="relative flex h-[72px] w-[72px] items-center justify-center sm:h-[84px] sm:w-[84px]">
                      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                        <circle cx="60" cy="60" r="38" fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="10" />
                        <circle
                          cx="60"
                          cy="60"
                          r="38"
                          fill="none"
                          stroke="#31d4ea"
                          strokeWidth="10"
                          strokeLinecap="round"
                          strokeDasharray={2 * Math.PI * 38}
                          strokeDashoffset={(2 * Math.PI * 38) * (1 - applicationProgressPercent / 100)}
                        />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-4xl font-semibold leading-none text-[#55e1ff] sm:text-5xl">{applicationProgressPercent}%</p>
                      <p className="mt-2 text-lg text-slate-600 sm:text-xl">Complete</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 [perspective:1400px] sm:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-10">
                  {applicationFlowSteps.map((step) => {
                    const isCompleted = step.status === "completed";
                    const isActive = step.status === "active";

                    return (
                      <article
                        key={step.step}
                        className={`group relative flex min-h-[250px] flex-col items-center overflow-hidden rounded-[1.65rem] border px-4 py-5 text-center transition-all duration-300 ease-out [transform-style:preserve-3d] will-change-transform hover:-translate-y-2.5 hover:[transform:perspective(900px)_rotateX(6deg)_scale(1.035)] sm:min-h-[300px] 2xl:px-2 ${
                          isCompleted
                            ? "border-cyan-200 bg-[linear-gradient(155deg,rgba(255,255,255,0.98),rgba(236,254,255,0.96))] shadow-[0_18px_40px_-12px_rgba(0,194,209,0.28)] hover:shadow-[0_38px_74px_-18px_rgba(0,194,209,0.55)]"
                            : "border-[#f5d778]/45 bg-[linear-gradient(155deg,rgba(24,66,98,0.96),rgba(13,46,80,0.96))] shadow-[0_20px_48px_-12px_rgba(212,175,55,0.34)] ring-1 ring-[#f5d778]/20 hover:shadow-[0_42px_82px_-18px_rgba(212,175,55,0.5)]"
                        }`}
                      >
                        {/* top light sheen for glassy depth */}
                        <span className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),transparent)]" />
                        {/* pulsing ring on the active step */}
                        {isActive && (
                          <span className="pointer-events-none absolute inset-0 animate-pulse rounded-[1.65rem] ring-1 ring-[#f5d778]/40" />
                        )}

                        <div className={`relative flex h-14 w-14 items-center justify-center rounded-2xl border text-lg font-bold transition-transform duration-300 group-hover:scale-110 group-hover:[transform:translateZ(34px)] ${
                          isCompleted
                            ? "border-[#49d9ef]/45 bg-[linear-gradient(145deg,#1a4f72,#0d2f4c)] text-white shadow-[0_10px_22px_rgba(0,194,209,0.35),inset_0_1px_0_rgba(255,255,255,0.25)]"
                            : "border-[#f5d778]/60 bg-[linear-gradient(145deg,#d4af37,#a9821f)] text-[#1a1205] shadow-[0_10px_24px_rgba(212,175,55,0.5),inset_0_1px_0_rgba(255,255,255,0.4)]"
                        }`}>
                          {isCompleted ? <Check className="h-6 w-6" /> : step.step}
                        </div>
                        <p className="relative mt-5 w-full text-base font-semibold text-slate-950 sm:mt-6 sm:text-lg">Step {step.step}</p>
                        <p className="relative mt-3 w-full max-w-[10rem] text-base leading-7 tracking-tight text-slate-700 [overflow-wrap:normal] [word-break:normal] sm:text-[1.05rem] sm:leading-9 2xl:text-[0.95rem] 2xl:leading-8">
                          {step.title.split(" ").map((word, index) => (
                            <span key={`${word}-${index}`} className="mr-1 inline-block whitespace-nowrap last:mr-0">
                              {word}
                            </span>
                          ))}
                        </p>
                        <p className="relative mt-auto w-full whitespace-normal pt-6 text-xs leading-5 text-slate-500 [overflow-wrap:normal] [word-break:normal] sm:pt-8 sm:text-sm">{step.timestamp}</p>
                        <div className={`relative mt-6 inline-flex min-h-[36px] items-center justify-center rounded-full border px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.2em] ${isCompleted ? "border-[#2cd39f]/30 bg-[#123f3c] text-[#8ff0c5]" : "border-[#f5d778]/40 bg-[#3a2f12] text-[#f7e39c]"}`}>
                          {isCompleted ? "Completed" : "In Progress"}
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                  {[
                    {
                      label: "Completed",
                      value: `${completedApplicationSteps} / ${totalApplicationSteps}`,
                    },
                    {
                      label: "Current Step",
                      value: currentApplicationStep.title,
                    },
                    {
                      label: "Next Action",
                      value: "Submit for final review",
                    },
                    {
                      label: "Last Updated",
                      value: "14 May 2026, 22:38",
                    },
                    {
                      label: "Estimated Time",
                      value: "2-4 mins",
                    },
                  ].map((item) => (
                    <div key={item.label} className="flex min-h-[132px] flex-col justify-between rounded-[1.55rem] border border-cyan-200 bg-cyan-50/45 px-5 py-5">
                      <p className="text-sm text-cyan-800">{item.label}</p>
                      <p className="text-[1.05rem] font-semibold leading-8 text-slate-950">{item.value}</p>
                    </div>
                  ))}
                  <div className="flex min-h-[132px] flex-col justify-between rounded-[1.55rem] border border-cyan-200 bg-cyan-50/45 px-5 py-5">
                    <p className="text-sm text-cyan-800">Continue</p>
                    <button
                      type="button"
                      onClick={() => latestSavedApplication ? handleOpenApplication(latestSavedApplication.id) : handleNewApplication()}
                      className="inline-flex items-center justify-center gap-2 rounded-[1.15rem] border border-[#34d0e6]/42 bg-[#103857] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#124264]"
                    >
                      Continue Step
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-start gap-4 rounded-[1.6rem] border border-cyan-200 bg-cyan-50/70 px-4 py-5 sm:px-5">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.15rem] border border-[#35d2e8]/25 bg-[#10334e] text-[#9becff]">
                    <CheckCheck className="h-6 w-6" />
                  </div>
                  <p className="text-base leading-7 text-slate-800 sm:text-lg">
                    Keep going - complete the remaining steps to submit your application.
                  </p>
                </div>
              </div>
            </article>

            <article className="rounded-[2rem] border border-[#00C2D1]/18 bg-[linear-gradient(180deg,rgba(7,25,51,0.98),rgba(6,21,43,0.98))] p-4 shadow-[0_26px_90px_rgba(0,194,209,0.08)] ring-1 ring-white/5 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative max-w-[620px] flex-1">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => handleSearchChange(event.target.value)}
                    placeholder="Search applications..."
                    className="w-full rounded-[1.2rem] border border-white/10 bg-[#081b34] py-3 pl-11 pr-4 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#00C2D1]/45 focus:ring-2 focus:ring-[#00C2D1]/15"
                  />
                </div>
                <div className="relative w-full sm:w-auto">
                  <SlidersHorizontal className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <select
                    value={applicationStatusFilter}
                    onChange={(event) => setApplicationStatusFilter(event.target.value)}
                    className="w-full appearance-none rounded-[1.2rem] border border-white/10 bg-[#081b34] py-3 pl-11 pr-10 text-sm text-slate-100 outline-none transition focus:border-[#00C2D1]/45 focus:ring-2 focus:ring-[#00C2D1]/15 sm:min-w-[190px]"
                  >
                    <option value="all">All Status</option>
                    <option value="draft">Draft</option>
                    <option value="pending">Pending</option>
                    <option value="submitted">Submitted</option>
                    <option value="under_review">In Progress</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              </div>

              <div className="mt-5 grid gap-4 sm:hidden">
                {applicationsLoading ? (
                  <div className="rounded-[1.65rem] border border-white/10 bg-[#091d37]/88 px-4 py-8 text-center text-sm text-slate-400">
                    Loading saved applications...
                  </div>
                ) : filteredApplicationRows.length === 0 ? (
                  <div className="rounded-[1.65rem] border border-white/10 bg-[#091d37]/88 px-4 py-8 text-center text-sm text-slate-400">
                    No saved applications yet. Start a new application and it will appear here.
                  </div>
                ) : (
                  filteredApplicationRows.map((row) => (
                    <article key={row.id} className="rounded-[1.65rem] border border-white/10 bg-[#091d37]/88 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.12)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Application ID</p>
                          <p className="mt-2 break-all text-sm font-semibold text-white">{row.id}</p>
                        </div>
                        <span className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold ${getStatusBadgeClass(row.status)}`}>
                          {row.statusLabel}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Loan Type</p>
                          <p className="mt-1 text-sm text-slate-200">{row.type}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Amount</p>
                            <p className="mt-1 text-sm font-medium text-white">{formatCurrency(row.amount)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Last Updated</p>
                            <p className="mt-1 text-sm text-slate-200">{row.date}</p>
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Progress</p>
                            <span className="text-sm font-medium text-white">{row.progress}%</span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-[linear-gradient(90deg,#28d5e8,#26b8ff)]"
                              style={{ width: `${Math.max(row.progress, 6)}%` }}
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenApplication(row.applicationId)}
                          aria-label={`Continue ${row.businessName}`}
                          className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-[1.1rem] border border-[#2ecfe6]/30 bg-[#0d2f4e] px-4 py-3 text-sm font-medium text-[#bbf6ff] transition hover:bg-[#124264]"
                        >
                          Continue Step {Math.max(Math.floor(row.progress / 10), 1)}
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>

              <div className="table-scroll-shell mt-5 hidden overflow-x-auto rounded-[1.65rem] border border-white/10 bg-[#091d37]/88 sm:block">
                <div className="dashboard-scrollbar max-h-[38rem] overflow-y-auto overscroll-contain scroll-smooth">
                  <table className="min-w-[980px] w-full divide-y divide-white/10 text-left text-sm text-slate-300">
                    <thead className="bg-[#0a213d]/95 backdrop-blur-xl">
                      <tr>
                        {["Application ID", "Loan Type", "Amount", "Status", "Last Updated", "Progress", "Action"].map((heading) => (
                          <th key={heading} className="sticky top-0 z-10 bg-[#0a213d]/95 px-5 py-5 text-xs uppercase tracking-[0.3em] text-slate-500 backdrop-blur-xl">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {applicationsLoading ? (
                        <tr>
                          <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                            Loading saved applications...
                          </td>
                        </tr>
                      ) : filteredApplicationRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                            No saved applications yet. Start a new application and it will appear here.
                          </td>
                        </tr>
                      ) : (
                        filteredApplicationRows.map((row) => (
                          <tr key={row.id} className="transition-colors duration-200 hover:bg-white/5">
                            <td className="px-5 py-4 font-medium text-white">{row.id}</td>
                            <td className="px-5 py-4">{row.type}</td>
                            <td className="px-5 py-4">{formatCurrency(row.amount)}</td>
                            <td className="px-5 py-4">
                              <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(row.status)}`}>
                                {row.statusLabel}
                              </span>
                            </td>
                            <td className="px-5 py-4">{row.date}</td>
                            <td className="px-5 py-4">
                              <div className="min-w-[140px]">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-sm font-medium text-white">{row.progress}%</span>
                                </div>
                                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                                  <div
                                    className="h-full rounded-full bg-[linear-gradient(90deg,#28d5e8,#26b8ff)]"
                                    style={{ width: `${Math.max(row.progress, 6)}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <button
                                type="button"
                                onClick={() => handleOpenApplication(row.applicationId)}
                                aria-label={`Continue ${row.businessName}`}
                                className="inline-flex items-center gap-2 rounded-[1rem] border border-[#2ecfe6]/30 bg-[#0d2f4e] px-4 py-2.5 text-sm font-medium text-[#bbf6ff] transition hover:bg-[#124264]"
                              >
                                Step {Math.max(Math.floor(row.progress / 10), 1)}
                                <ArrowRight className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </article>
          </section>
          ) : !isDocumentsPage && (showApplicationManagementSection || showDocumentSection) ? (
          <section className={`grid gap-6 ${showApplicationManagementSection && showDocumentSection ? "xl:grid-cols-12" : ""}`}>
            {showApplicationManagementSection ? (
            <article className={`${panelClass} ${showDocumentSection ? "xl:col-span-8" : ""}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div><p className="text-xs uppercase tracking-[0.28em] text-slate-400">Application Management</p><h3 className="mt-2 text-xl font-semibold text-white sm:text-2xl">Manage application flow</h3></div>
                <div className="grid w-full gap-3 sm:flex sm:w-auto sm:flex-wrap">
                  <button type="button" onClick={handleNewApplication} className="w-full rounded-2xl bg-[#00C2D1] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#00adc4] sm:w-auto">Create New Application</button>
                  <button type="button" onClick={() => latestSavedApplication ? handleOpenApplication(latestSavedApplication.id) : handleNewApplication()} className="w-full rounded-2xl border border-white/10 bg-[#0b2141] px-4 py-3 text-sm text-slate-100 transition hover:border-[#00C2D1] sm:w-auto">Edit Application</button>
                  <button type="button" onClick={() => latestDraftApplication ? handleOpenApplication(latestDraftApplication.id) : handleNewApplication()} className="w-full rounded-2xl border border-white/10 bg-[#0b2141] px-4 py-3 text-sm text-slate-100 transition hover:border-[#D4AF37] sm:w-auto">Save Draft</button>
                </div>
              </div>
              <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-[#061b34]/90 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-xs uppercase tracking-[0.28em] text-slate-400">Step 3 of 6</p><h4 className="mt-2 text-xl font-semibold text-white">Application progress</h4></div>
                  <span className="inline-flex self-start rounded-full bg-[#00C2D1]/15 px-3 py-2 text-sm font-semibold text-[#00C2D1]">Business Info</span>
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {["Personal Info", "Loan Info", "Business Info", "Documents", "Review", "Submit"].map((label, index) => {
                    const state = index < 2 ? "completed" : index === 2 ? "active" : "upcoming";
                    return (
                      <div key={label} className={`rounded-[1.5rem] border px-4 py-3 text-sm ${state === "completed" ? "border-[#00C2D1]/30 bg-[#00C2D1]/10 text-white" : state === "active" ? "border-[#00C2D1]/50 bg-[#0c2c52] text-white" : "border-white/10 bg-[#0b2141]/70 text-slate-300"}`}>
                        <div className="flex items-center justify-between gap-2"><p className="font-medium">{label}</p>{state === "completed" ? <Check className="h-4 w-4 text-[#00C2D1]" /> : null}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="table-scroll-shell mt-6 overflow-x-auto rounded-[1.75rem] border border-white/10 bg-[#061b34]/90">
                <div className="dashboard-scrollbar max-h-[40rem] overflow-y-auto overscroll-contain scroll-smooth">
                <table className="min-w-[720px] w-full divide-y divide-white/10 text-left text-sm text-slate-300">
                  <thead className="bg-[#071c35]/95 backdrop-blur-xl">
                    <tr>
                      {["Application ID", "Loan Type", "Amount", "Status", "Date", "Continue"].map((heading) => (
                        <th key={heading} className="sticky top-0 z-10 bg-[#071c35]/95 px-4 py-4 text-xs uppercase tracking-[0.25em] text-slate-500 backdrop-blur-xl">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {applicationsLoading ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                          Loading saved applications...
                        </td>
                      </tr>
                    ) : filteredApplicationRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                          No saved applications yet. Start a new application and it will appear here.
                        </td>
                      </tr>
                    ) : (
                      filteredApplicationRows.map((row) => (
                      <tr key={row.id} className="transition-colors duration-200 hover:bg-white/5">
                        <td className="px-4 py-4 font-medium text-white">{row.id}</td>
                        <td className="px-4 py-4">{row.type}</td>
                        <td className="px-4 py-4">{formatCurrency(row.amount)}</td>
                        <td className="px-4 py-4"><span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(row.status)}`}>{row.statusLabel}</span></td>
                        <td className="px-4 py-4">{row.date}</td>
                        <td className="px-4 py-4">
                          <button 
                            type="button" 
                            onClick={() => handleOpenApplication(row.applicationId)} 
                            aria-label={`Continue ${row.businessName}`} 
                            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#00C2D1]/15 text-[#00C2D1] transition hover:bg-[#00C2D1]/25 hover:scale-105 active:scale-95"
                          >
                            <ChevronRight className="h-5 w-5" />
                          </button>
                        </td>
                      </tr>
                    )))}
                  </tbody>
                </table>
                </div>
              </div>
            </article>
            ) : null}
            {showDocumentSection ? (
            <aside id="documents" className={`${panelClass} bg-[#0b2141]/90 ${showApplicationManagementSection ? "xl:col-span-4" : ""}`}>
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-xs uppercase tracking-[0.28em] text-slate-400">Document Management</p><h3 className="mt-2 text-2xl font-semibold text-white">Upload & checklist</h3></div>
                <button onClick={handleUpload} className="inline-flex items-center gap-2 rounded-2xl bg-[#00C2D1] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#00adc4]"><Upload className="h-4 w-4" />Upload</button>
              </div>
              <input
                ref={uploadInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={handleFileChange}
              />
              <p className="mt-3 text-sm text-slate-400">Accepted files: PDF, JPG, PNG. Max size 5MB.</p>
              <div className="mt-6 space-y-3">
                {documentRows.map((doc) => (
                  <div key={doc.name} className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-white/10 bg-[#061b34]/80 px-4 py-4">
                    <div>
                      <p className="font-medium text-white">{doc.name}</p>
                      <p className="text-xs text-slate-400">{doc.helperText}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDocumentUpload(doc.name)}
                        className="rounded-2xl bg-[#0b2141] px-3 py-2 text-xs font-semibold text-[#00C2D1] transition hover:bg-[#0d2853]"
                      >
                        Upload
                      </button>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${doc.status === "verified" ? "bg-[#00C2D1]/10 text-[#00C2D1]" : doc.status === "pending" ? "bg-white/10 text-slate-200" : "bg-[#D4AF37]/10 text-[#D4AF37]"}`}>{getStatusLabel(doc.status)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
            ) : null}
          </section>
          ) : null}

          {showStatusTrackerSection || showLoanSummarySection ? (
          <section className={`grid gap-6 ${showStatusTrackerSection && showLoanSummarySection ? "xl:grid-cols-12" : ""}`}>
            {showStatusTrackerSection ? (
            <article id="status-tracker" className={`${panelClass} ${showLoanSummarySection ? "xl:col-span-6" : ""}`}>
              <div><p className="text-xs uppercase tracking-[0.28em] text-slate-400">Status Tracker</p><h3 className="mt-2 text-2xl font-semibold text-white">Application timeline</h3></div>
              <div className="mt-6 space-y-4">
                {trackerSteps.map((step, index) => (
                  <div key={step.label} className="flex items-start gap-4 rounded-[1.5rem] border border-white/10 bg-[#061b34]/80 p-4">
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${step.status === "completed" ? "bg-[#00C2D1] text-[#061421]" : step.status === "active" ? "bg-[#D4AF37]/15 text-[#D4AF37]" : "bg-white/5 text-slate-300"}`}>{step.status === "completed" ? <Check className="h-4 w-4" /> : index + 1}</div>
                    <div className="flex-1"><p className="font-semibold text-white">{step.label}</p><p className="text-sm text-slate-400">{step.status === "completed" ? "Completed" : step.status === "active" ? "In progress" : "Upcoming"}</p></div>
                  </div>
                ))}
              </div>
            </article>
            ) : null}
            {showLoanSummarySection ? (
            <article id="loan-details" className={`${panelClass} bg-[#061b34]/95 ${showStatusTrackerSection ? "xl:col-span-6" : ""}`}>
              <div><p className="text-xs uppercase tracking-[0.28em] text-slate-400">Loan Details</p><h3 className="mt-2 text-2xl font-semibold text-white">Current loan summary</h3></div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {loanSummaryItems.map((item) => (
                  <div key={item.label} className="rounded-[1.5rem] border border-white/10 bg-[#0b2141]/80 p-4">
                    <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{item.label}</p>
                    <p className="mt-2 text-lg font-semibold text-white">{item.value}</p>
                  </div>
                ))}
              </div>
            </article>
            ) : null}
          </section>
          ) : null}

          {showPerformanceInsightsSection ? (
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Total Applications", value: String(applications.length), color: "text-[#7BE7F0]", border: "border-[#00C2D1]/20", bg: "bg-gradient-to-br from-[#00C2D1]/10 to-[#061421]/80", glow: "hover:border-[#00C2D1]/40 hover:shadow-[0_12px_32px_rgba(0,194,209,0.2)]" },
              { label: "Active / Under Review", value: String(applications.filter((a) => ["submitted","under_review","draft"].includes(a.status)).length), color: "text-[#F5D778]", border: "border-[#D4AF37]/20", bg: "bg-gradient-to-br from-[#D4AF37]/10 to-[#061421]/80", glow: "hover:border-[#D4AF37]/40 hover:shadow-[0_12px_32px_rgba(212,175,55,0.2)]" },
              { label: "Approved", value: String(applications.filter((a) => ["approved","disbursed"].includes(a.status)).length), color: "text-[#6ae5b0]", border: "border-emerald-500/20", bg: "bg-gradient-to-br from-emerald-500/10 to-[#061421]/80", glow: "hover:border-emerald-500/40 hover:shadow-[0_12px_32px_rgba(34,197,94,0.2)]" },
              { label: "Docs Verified", value: `${documentRows.filter((d) => d.status === "verified").length} / ${documentRows.length}`, color: "text-slate-200", border: "border-violet-500/20", bg: "bg-gradient-to-br from-violet-500/10 to-[#061421]/80", glow: "hover:border-violet-500/40 hover:shadow-[0_12px_32px_rgba(139,92,246,0.2)]" },
            ].map((item) => (
              <div key={item.label} className={`relative overflow-hidden rounded-[1.5rem] border ${item.border} ${item.bg} p-4 transition-all duration-300 hover:-translate-y-0.5 ${item.glow}`}>
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{item.label}</p>
                <p className={`mt-2 text-2xl font-bold ${item.color}`}>{item.value}</p>
              </div>
            ))}
          </section>
          ) : null}

          {showEmiSection ? (
          <section className="grid gap-4 xl:grid-cols-12">
            <article className={`${panelClass} xl:col-span-8`}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div><p className="text-xs uppercase tracking-[0.28em] text-slate-400">EMI Calculator</p><h3 className="mt-2 text-2xl font-semibold text-white">Estimate your monthly payment</h3></div>
                <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-[#0b2141] px-4 py-3 text-sm text-slate-100"><span className="h-2.5 w-2.5 rounded-full bg-[#00C2D1]" />Chart ready</div>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <label className="rounded-[1.5rem] border border-white/10 bg-[#061b34]/85 p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Loan amount</p>
                  <input
                    type="number"
                    min={1000}
                    max={10000000}
                    step={1000}
                    inputMode="numeric"
                    value={loanAmount}
                    onChange={handleLoanAmountInput}
                    onBlur={handleLoanAmountBlur}
                    className="mt-3 w-full rounded-2xl border border-white/10 bg-[#0b2141] px-4 py-3 text-sm text-white outline-none focus:border-[#00C2D1] focus:ring-2 focus:ring-[#00C2D1]/20"
                  />
                </label>
                <label className="rounded-[1.5rem] border border-white/10 bg-[#061b34]/85 p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Interest rate (%)</p>
                  <input type="number" min={0} step={0.01} value={interestRate} onChange={(event) => setInterestRate(Number(event.target.value))} className="mt-3 w-full rounded-2xl border border-white/10 bg-[#0b2141] px-4 py-3 text-sm text-white outline-none focus:border-[#00C2D1] focus:ring-2 focus:ring-[#00C2D1]/20" />
                </label>
                <label className="rounded-[1.5rem] border border-white/10 bg-[#061b34]/85 p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Tenure (months)</p>
                  <input type="number" min={1} value={tenure} onChange={(event) => setTenure(Number(event.target.value))} className="mt-3 w-full rounded-2xl border border-white/10 bg-[#0b2141] px-4 py-3 text-sm text-white outline-none focus:border-[#00C2D1] focus:ring-2 focus:ring-[#00C2D1]/20" />
                </label>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <div className="rounded-[1.5rem] border border-white/10 bg-[#061b34]/90 p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Estimated EMI</p>
                  <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(Math.round(emiPayment))}</p>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-[#061b34]/90 p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Total payable</p>
                  <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(Math.round(totalPayment))}</p>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-[#061b34]/90 p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Total interest</p>
                  <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(Math.round(totalInterest))}</p>
                </div>
              </div>
              
              {/* START OF NEW DONUT CHART SECTION - REPLACE THIS BLOCK */}
              <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-[#0b2141]/90 p-6">
                <div className="flex items-center justify-between gap-3 mb-6">
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Payment Breakdown</p>
                    <h3 className="mt-2 text-xl font-semibold text-white">Principal vs Interest</h3>
                  </div>
                  <span className="rounded-full bg-[#00C2D1]/10 px-4 py-2 text-sm text-[#00C2D1] font-medium">
                    {formatCurrency(totalPayment)} Total
                  </span>
                </div>
                
                <div className="flex flex-col lg:flex-row items-center gap-8">
                  <div className="w-full lg:w-1/2">
                    <Chart
                      options={{
                        chart: {
                          type: "donut",
                          toolbar: { show: false },
                          background: "transparent",
                          fontFamily: "inherit",
                        },
                        labels: ["Principal Amount", "Interest Payable", "Processing Fee"],
                        colors: ["#00C2D1", "#D4AF37", "#94a3b8"],
                        plotOptions: {
                          pie: {
                            donut: {
                              size: "70%",
                              labels: {
                                show: true,
                                total: {
                                  show: true,
                                  label: "Total Payable",
                                  fontSize: "14px",
                                  color: "#94a3b8",
                                  formatter: () => formatCurrency(totalPayment),
                                },
                                value: {
                                  fontSize: "18px",
                                  fontWeight: 600,
                                  color: "#ffffff",
                                },
                              },
                            },
                            expandOnClick: true,
                          },
                        },
                        dataLabels: {
                          enabled: true,
                          formatter: (val) => `${Math.round(Number(val))}%`,
                          style: {
                            colors: ["#fff"],
                            fontWeight: 600,
                          },
                        },
                        stroke: {
                          show: true,
                          colors: ["#0b2141"],
                          width: 3,
                        },
                        tooltip: {
                          theme: "dark",
                          y: {
                            formatter: (value) => formatCurrency(Number(value)),
                            title: { formatter: (seriesName) => seriesName + ":" },
                          },
                        },
                        legend: {
                          position: "bottom",
                          horizontalAlign: "center",
                          fontSize: "12px",
                          // cast to any to satisfy Apex/React typings
                          markers: ({ width: 10, height: 10, offsetX: 0, offsetY: 0 } as any),
                          itemMargin: { horizontal: 10, vertical: 5 },
                        },
                        responsive: [
                          {
                            breakpoint: 768,
                            options: {
                              chart: { height: 280 },
                              plotOptions: { pie: { donut: { labels: { value: { fontSize: "16px" } } } } },
                            },
                          },
                        ],
                      }}
                      series={[loanAmountNumber, Math.round(totalInterest), 2500]}
                      type="donut"
                      height={320}
                      width="100%"
                    />
                  </div>
                  
                  <div className="w-full lg:w-1/2 grid grid-cols-1 gap-4">
                    <div className="rounded-[1.5rem] border border-[#00C2D1]/20 bg-[#00C2D1]/5 p-5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="h-4 w-4 rounded-full bg-[#00C2D1]"></span>
                        <div>
                          <p className="text-sm text-[#00C2D1] font-medium">Principal Amount</p>
                          <p className="text-xs text-slate-400 mt-0.5">Base loan amount</p>
                        </div>
                      </div>
                      <p className="text-lg font-semibold text-white">{formatCurrency(loanAmountNumber)}</p>
                    </div>
                    
                    <div className="rounded-[1.5rem] border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="h-4 w-4 rounded-full bg-[#D4AF37]"></span>
                        <div>
                          <p className="text-sm text-[#D4AF37] font-medium">Interest Payable</p>
                          <p className="text-xs text-slate-400 mt-0.5">Cost of borrowing</p>
                        </div>
                      </div>
                      <p className="text-lg font-semibold text-white">{formatCurrency(Math.round(totalInterest))}</p>
                    </div>
                    
                    <div className="rounded-[1.5rem] border border-[#94a3b8]/20 bg-[#94a3b8]/5 p-5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="h-4 w-4 rounded-full bg-[#94a3b8]"></span>
                        <div>
                          <p className="text-sm text-[#94a3b8] font-medium">Processing Fee</p>
                          <p className="text-xs text-slate-400 mt-0.5">One-time charges</p>
                        </div>
                      </div>
                      <p className="text-lg font-semibold text-white">{formatCurrency(2500)}</p>
                    </div>
                    
                    <div className="rounded-[1.5rem] border border-white/10 bg-[#061b34]/80 p-5 flex items-center justify-between mt-2">
                      <p className="text-sm text-slate-300">Interest Rate</p>
                      <p className="text-lg font-semibold text-[#00C2D1]">{interestRate}% p.a.</p>
                    </div>
                  </div>
                </div>
              </div>
              {/* END OF NEW DONUT CHART SECTION */}
              
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" onClick={resetEmiCalculator} className="rounded-2xl border border-white/10 bg-[#0b2141] px-4 py-3 text-sm text-slate-100 transition hover:border-[#00C2D1] hover:bg-[#0d2853]">Reset</button>
                <button type="button" onClick={() => toast({ title: "EMI updated", description: "Your monthly estimate has been recalculated." })} className="rounded-2xl bg-[#00C2D1] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#00adc4]">Calculate EMI</button>
              </div>
            </article>
            <aside className={`${panelClass} bg-[#0b2141]/95 xl:col-span-4`}>
              <div><p className="text-xs uppercase tracking-[0.28em] text-slate-400">Important Alerts</p><h3 className="mt-2 text-2xl font-semibold text-white">Action required</h3></div>
              <div className="mt-6 space-y-4">
                {statusAlerts.map((alert) => {
                  const Icon = alert.icon;
                  return <div key={alert.label} className="rounded-[1.5rem] border border-white/10 bg-[#061b34]/80 p-4"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#00C2D1]/15 text-[#00C2D1]"><Icon className="h-5 w-5" /></div><div><p className="font-semibold text-white">{alert.label}</p><p className="text-sm text-slate-400">{alert.description}</p></div></div></div>;
                })}
              </div>
            </aside>
          </section>
          ) : null}

        </div>
      </main>

      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          setIsModalOpen(open);
          if (!open) {
            setEditingAppId(undefined);
            setApplicationFlow("fresh");
          }
          if (!open && user?.id) {
            void fetchApplications(user.id);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto bg-white text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900">EazyBizy Loan Application</DialogTitle>
          </DialogHeader>
          <GTABFormWizard
            applicationId={editingAppId}
            draftMode={applicationFlow}
            onComplete={() => {
              setIsModalOpen(false);
              setEditingAppId(undefined);
              setApplicationFlow("fresh");
              if (user?.id) {
                void fetchApplications(user.id);
              }
              toast({
                title: "Application Submitted!",
                description: "Your saved applications have been updated.",
              });
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(activePreviewDocument)}
        onOpenChange={(open) => {
          if (!open) {
            setActivePreviewDocument(null);
          }
        }}
      >
        <DialogContent closeButtonClassName="hidden" className="flex h-[min(92vh,980px)] w-[min(96vw,1080px)] max-w-[1080px] flex-col overflow-hidden border border-[#34d6ee]/30 bg-[radial-gradient(circle_at_top,rgba(0,194,209,0.12),transparent_35%),linear-gradient(180deg,rgba(8,24,44,0.98),rgba(4,16,31,0.99))] p-0 text-slate-100 shadow-[0_40px_120px_rgba(0,194,209,0.22)]">
          {activePreviewDocument ? (
            <div className="relative flex min-h-0 flex-1 flex-col">
              <div className="pointer-events-none absolute inset-x-16 top-0 h-28 rounded-full bg-[#00C2D1]/12 blur-3xl" />
              <div className="relative border-b border-white/10 px-5 py-5 sm:px-7">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.35rem] border border-[#00C2D1]/20 bg-[#0b2d4f]/90 text-[#9beaf3] shadow-[0_0_0_1px_rgba(0,194,209,0.16)]">
                      <FileText className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <DialogHeader className="space-y-0 text-left">
                        <DialogTitle className="text-[1.8rem] font-semibold text-white">
                          {activePreviewDocument.name}
                        </DialogTitle>
                      </DialogHeader>
                      <p className="mt-1 text-sm text-slate-400">{activePreviewDocument.description}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-2 rounded-full border border-[#2ecf8f]/25 bg-[#123a39] px-3 py-1 text-xs font-semibold text-[#74ebb7]">
                          <span className="h-2 w-2 rounded-full bg-[#2ee59d] shadow-[0_0_10px_rgba(46,229,157,0.7)]" />
                          Verified
                        </span>
                        <span className="inline-flex max-w-full truncate rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                          {activePreviewDocument.fileName ?? "Uploaded document"}
                        </span>
                        <span className="inline-flex rounded-full border border-[#d4af37]/15 bg-[#d4af37]/10 px-3 py-1 text-xs text-[#f2d15f]">
                          {activePreviewDocument.uploadedAt ? `Uploaded ${formatDate(activePreviewDocument.uploadedAt)}` : "Ready to preview"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    title="Remove / Un-upload"
                    onClick={() => void handleDeleteDocument()}
                    disabled={documentActionInProgress === activePreviewDocument.documentType}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#ff6b7d]/40 bg-[radial-gradient(circle_at_center,rgba(255,93,120,0.18),rgba(103,24,39,0.92))] text-[#ffc2cb] shadow-[0_0_24px_rgba(255,93,120,0.25)] transition hover:scale-[1.03] hover:border-[#ff7b8c] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="Remove or un-upload document"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
                <div className="flex min-h-full flex-col rounded-[1.7rem] border border-white/10 bg-[linear-gradient(180deg,rgba(9,27,51,0.92),rgba(5,18,34,0.98))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.25rem] border border-white/10 bg-[#081a31]/85 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handlePreviewZoomChange("out")}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-200 transition hover:border-[#00C2D1]/35 hover:bg-[#0d2846]"
                        aria-label="Zoom out"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <div className="inline-flex min-w-[96px] items-center justify-center rounded-2xl border border-[#00C2D1]/15 bg-[#0b2141]/90 px-4 py-2 text-sm font-semibold text-[#9beaf3]">
                        {previewZoom}%
                      </div>
                      <button
                        type="button"
                        onClick={() => handlePreviewZoomChange("in")}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-200 transition hover:border-[#00C2D1]/35 hover:bg-[#0d2846]"
                        aria-label="Zoom in"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handlePreviewDownload}
                        disabled={!activePreviewDocument.previewUrl}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-200 transition hover:border-[#00C2D1]/35 hover:bg-[#0d2846] disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Download document"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleTogglePreviewFullscreen()}
                        disabled={!activePreviewDocument.previewUrl}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-200 transition hover:border-[#00C2D1]/35 hover:bg-[#0d2846] disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Toggle fullscreen"
                      >
                        {isPreviewFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div
                    ref={previewViewportRef}
                    className="mt-3 min-h-0 flex-1 overflow-auto rounded-[1.45rem] border border-[#00C2D1]/12 bg-[radial-gradient(circle_at_top,rgba(0,194,209,0.06),transparent_26%),linear-gradient(180deg,rgba(5,19,36,0.98),rgba(3,12,24,1))] p-3 sm:p-5"
                  >
                    <div className="flex min-h-[340px] items-start justify-center sm:min-h-[420px]">
                      {activePreviewDocument.previewUrl ? (
                        <div
                          className="origin-top transition-transform duration-200 ease-out"
                          style={{ transform: `scale(${previewZoom / 100})` }}
                        >
                          {isPdfDocument(activePreviewDocument) ? (
                            <iframe
                              src={activePreviewDocument.previewUrl}
                              title={activePreviewDocument.name}
                              className="h-[min(62vh,760px)] w-[min(72vw,720px)] min-w-[260px] rounded-[1.1rem] border border-white/10 bg-white shadow-[0_24px_60px_rgba(0,0,0,0.28)] sm:w-[min(68vw,760px)]"
                            />
                          ) : isImageDocument(activePreviewDocument) ? (
                            <img
                              src={activePreviewDocument.previewUrl}
                              alt={activePreviewDocument.name}
                              className="max-h-[min(62vh,760px)] max-w-[min(72vw,720px)] rounded-[1.1rem] border border-white/10 object-contain shadow-[0_24px_60px_rgba(0,0,0,0.28)] sm:max-w-[min(68vw,760px)]"
                            />
                          ) : (
                            <div className="flex min-h-[280px] w-[min(72vw,720px)] min-w-[260px] items-center justify-center rounded-[1.1rem] border border-dashed border-white/10 bg-[#071727] px-6 py-10 text-center text-slate-300 sm:w-[min(68vw,760px)]">
                              Preview is not supported for this file type. Use download to inspect the uploaded document.
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex min-h-[280px] w-full items-center justify-center rounded-[1.1rem] border border-dashed border-white/10 bg-[#071727] px-6 py-10 text-center text-slate-300">
                          A preview is not available for this document yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-[1.35rem] border border-[#00C2D1]/10 bg-[#0a203a]/70 px-4 py-3 text-sm text-slate-300">
                  If this is the wrong document, remove it to upload the correct file.
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={() => void handleDeleteDocument()}
                    disabled={documentActionInProgress === activePreviewDocument.documentType}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#ff6b7d]/40 bg-transparent px-5 py-3 text-sm font-semibold text-[#ffb7c1] transition hover:bg-[#4a2330]/55 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                    {documentActionInProgress === activePreviewDocument.documentType ? "Removing..." : "Remove Document"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePreviewDocument(null)}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(90deg,#18cde4,#1697d7)] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_40px_rgba(0,194,209,0.22)] transition hover:brightness-105"
                  >
                    Close
                  </button>
                </div>

                <p className="mt-3 text-xs text-slate-500">
                  Removing this document will allow you to upload a new file.
                </p>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LoanManagementDashboard;
