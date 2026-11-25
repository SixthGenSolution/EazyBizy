import { describe, expect, it } from "vitest";
import { mergeSavedApplications, summarizeSavedApplications } from "./savedApplications";

describe("mergeSavedApplications", () => {
  it("includes existing legacy and current applications without changing IDs or statuses", () => {
    const legacy = [
      {
        id: "legacy-draft",
        business_entity_name: "Draft business",
        loan_scheme: "pmegp" as const,
        total_project_cost: 125000,
        eligible_loan_amount: 90000,
        status: "draft" as const,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        current_step: 4,
      },
      {
        id: "legacy-submitted",
        business_entity_name: "Submitted business",
        loan_scheme: "normal_msme" as const,
        total_project_cost: 95000,
        eligible_loan_amount: 75000,
        status: "submitted" as const,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T12:00:00Z",
        current_step: 10,
      },
      {
        id: "legacy-approved",
        business_entity_name: "Approved business",
        loan_scheme: "mudra" as const,
        total_project_cost: 200000,
        eligible_loan_amount: 150000,
        status: "approved" as const,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-03T00:00:00Z",
        current_step: 10,
      },
    ];
    const current = [
      {
        id: "current-pending",
        business_entity_name: "Pending business",
        loan_scheme: "normal_msme" as const,
        total_project_cost: 175000,
        eligible_loan_amount: 100000,
        amount: 100000,
        status: "pending",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-04T00:00:00Z",
        current_step: 6,
      },
      {
        id: "same-id",
        business_entity_name: "Current copy",
        loan_scheme: "mudra" as const,
        total_project_cost: 300000,
        eligible_loan_amount: 250000,
        amount: 250000,
        status: "rejected",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-05T00:00:00Z",
        current_step: 10,
      },
    ];
    const legacyDuplicate = {
      id: "same-id",
      business_entity_name: "Legacy copy",
      loan_scheme: "mudra" as const,
      total_project_cost: 100000,
      eligible_loan_amount: 80000,
      status: "submitted" as const,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      current_step: 8,
    };

    const merged = mergeSavedApplications(current, [...legacy, legacyDuplicate]);

    expect(merged.map(({ id }) => id)).toEqual([
      "same-id",
      "current-pending",
      "legacy-approved",
      "legacy-submitted",
      "legacy-draft",
    ]);
    expect(merged.map(({ status }) => status)).toEqual([
      "rejected",
      "pending",
      "approved",
      "submitted",
      "draft",
    ]);
    expect(merged[0]).toMatchObject({
      id: "same-id",
      business_entity_name: "Current copy",
      source: "loan_applications",
    });
    expect(merged[4]).toMatchObject({
      id: "legacy-draft",
      amount: 90000,
      current_step: 4,
      source: "gtab_applications",
    });
    expect(summarizeSavedApplications(merged)).toEqual({
      total: 5,
      active: 3,
      approved: 1,
      rejected: 1,
    });
  });
});
