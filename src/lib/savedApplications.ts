import type { Database } from "@/integrations/supabase/types";

export type SavedApplicationSource = "loan_applications" | "gtab_applications";

export interface SavedApplication {
  id: string;
  business_entity_name: string | null;
  loan_scheme: string | null;
  total_project_cost: number | null;
  eligible_loan_amount: number | null;
  amount: number;
  status: string;
  created_at: string;
  updated_at: string;
  current_step: number | null;
  source: SavedApplicationSource;
}

type LoanApplicationSummary = Pick<
  Database["public"]["Tables"]["loan_applications"]["Row"],
  | "id"
  | "business_entity_name"
  | "loan_scheme"
  | "total_project_cost"
  | "eligible_loan_amount"
  | "amount"
  | "status"
  | "created_at"
  | "updated_at"
  | "current_step"
>;

type LegacyApplicationSummary = Pick<
  Database["public"]["Tables"]["gtab_applications"]["Row"],
  | "id"
  | "business_entity_name"
  | "loan_scheme"
  | "total_project_cost"
  | "eligible_loan_amount"
  | "status"
  | "created_at"
  | "updated_at"
  | "current_step"
>;

export const mergeSavedApplications = (
  loanApplications: readonly LoanApplicationSummary[],
  legacyApplications: readonly LegacyApplicationSummary[],
): SavedApplication[] => {
  const applications = new Map<string, SavedApplication>();

  for (const application of legacyApplications) {
    applications.set(application.id, {
      ...application,
      amount: application.eligible_loan_amount ?? 0,
      status: application.status ?? "draft",
      source: "gtab_applications",
    });
  }

  for (const application of loanApplications) {
    applications.set(application.id, { ...application, source: "loan_applications" });
  }

  return [...applications.values()].sort(
    (left, right) =>
      new Date(right.updated_at || right.created_at).getTime() -
      new Date(left.updated_at || left.created_at).getTime(),
  );
};

export const summarizeSavedApplications = (applications: readonly SavedApplication[]) => ({
  total: applications.length,
  active: applications.filter((application) =>
    ["pending", "submitted", "under_review", "draft"].includes(application.status),
  ).length,
  approved: applications.filter((application) =>
    ["approved", "disbursed"].includes(application.status),
  ).length,
  rejected: applications.filter((application) => application.status === "rejected").length,
});
