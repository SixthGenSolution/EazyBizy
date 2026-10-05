import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ApplicationPreview from "./ApplicationPreview";
import { INITIAL_FORM_DATA } from "@/types/gtab";

const reportMocks = vi.hoisted(() => ({
  generateReport: vi.fn(),
  downloadPDF: vi.fn(),
}));

vi.mock("@/hooks/useReportGenerator", () => ({
  useReportGenerator: () => ({
    isLoading: false,
    error: null,
    reportResult: null,
    generateReport: reportMocks.generateReport,
    downloadPDF: reportMocks.downloadPDF,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const generatedReport = {
  report_id: "ABCD1234",
  pdf_url: "/api/v1/report/ABCD1234/download",
  validation_status: "PASS" as const,
  validation_warnings: [],
  key_metrics: {
    dscr_average: 1.5,
    recommendation: "MEETS VIABILITY BENCHMARKS",
    credit_rating: "A",
    payback_months: 36,
    scheme: "PMEGP",
    report_type: "CMA",
  },
};

describe("ApplicationPreview CMA report customization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportMocks.generateReport.mockResolvedValue(generatedReport);
  });

  it("closes with X without saving, generating a PDF, or changing the form", () => {
    const onEnsureSaved = vi.fn();
    const formData = { ...INITIAL_FORM_DATA, business_entity_name: "Keep This Business" };
    render(<ApplicationPreview formData={formData} onEnsureSaved={onEnsureSaved} />);

    fireEvent.click(screen.getByRole("button", { name: /Download CMA Report/i }));
    expect(screen.getByRole("heading", { name: "Customize Report" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(6);
    expect(screen.getByRole("radio", { name: "Navy" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("textbox", { name: "Prepared by" })).toHaveValue("EasyBizy");
    const bankSelect = screen.getByRole("combobox", { name: "To" });
    expect(bankSelect).toHaveValue("");
    expect(bankSelect.querySelectorAll("option")).toHaveLength(25);
    fireEvent.click(screen.getByRole("button", { name: "Close Customize Report" }));

    expect(screen.queryByRole("heading", { name: "Customize Report" })).not.toBeInTheDocument();
    expect(onEnsureSaved).not.toHaveBeenCalled();
    expect(reportMocks.generateReport).not.toHaveBeenCalled();
    expect(reportMocks.downloadPDF).not.toHaveBeenCalled();
    expect(screen.getByText("Keep This Business")).toBeInTheDocument();
    expect(formData.business_entity_name).toBe("Keep This Business");
  });

  it("closes with Cancel without generating or saving the report", () => {
    const onEnsureSaved = vi.fn();
    render(<ApplicationPreview formData={INITIAL_FORM_DATA} onEnsureSaved={onEnsureSaved} />);

    fireEvent.click(screen.getByRole("button", { name: /Download CMA Report/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("heading", { name: "Customize Report" })).not.toBeInTheDocument();
    expect(onEnsureSaved).not.toHaveBeenCalled();
    expect(reportMocks.generateReport).not.toHaveBeenCalled();
    expect(reportMocks.downloadPDF).not.toHaveBeenCalled();
  });

  it("sends the selected theme, prepared-by value, and bank through the existing generator", async () => {
    const onEnsureSaved = vi.fn().mockResolvedValue("application-1");
    render(<ApplicationPreview formData={INITIAL_FORM_DATA} onEnsureSaved={onEnsureSaved} />);

    fireEvent.click(screen.getByRole("button", { name: /Download CMA Report/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Royal Blue" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Prepared by" }), { target: { value: "A. Banker" } });
    fireEvent.change(screen.getByRole("combobox", { name: "To" }), { target: { value: "HDFC Bank" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate PDF" }));

    await waitFor(() => expect(reportMocks.generateReport).toHaveBeenCalledTimes(1));
    const payload = reportMocks.generateReport.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({ prepared_by: "A. Banker", report_theme: "Royal Blue" }));
    expect(payload).toEqual(expect.objectContaining({ to_bank: "HDFC Bank" }));
    expect(payload.business).toEqual(expect.objectContaining({ bank_name: "" }));
    expect(onEnsureSaved).toHaveBeenCalledTimes(1);
    expect(reportMocks.downloadPDF).toHaveBeenCalledWith(generatedReport.pdf_url, generatedReport.report_id);
    expect(screen.queryByRole("heading", { name: "Customize Report" })).not.toBeInTheDocument();
  });
});