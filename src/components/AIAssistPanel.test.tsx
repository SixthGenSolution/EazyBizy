import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AIAssistBadge from "@/components/AIAssistPanel";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

let originalScrollYDescriptor: PropertyDescriptor | undefined;
let originalLocalStorageDescriptor: PropertyDescriptor | undefined;

describe("Data & Chart modal close button", () => {
  beforeEach(() => {
    originalScrollYDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
    originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 480 });
    document.body.style.overflow = "auto";
    document.body.style.position = "relative";
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.body.style.overflow = "";
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.style.paddingRight = "";
    document.body.style.pointerEvents = "";
    if (originalScrollYDescriptor) {
      Object.defineProperty(window, "scrollY", originalScrollYDescriptor);
    } else {
      Reflect.deleteProperty(window, "scrollY");
    }
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(window, "localStorage", originalLocalStorageDescriptor);
    } else {
      Reflect.deleteProperty(window, "localStorage");
    }
  });

  it("closes repeatedly without submitting or unmounting the Business Profile form", () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onDialogOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onDialogOpenChange}>
        <DialogContent onInteractOutside={(event) => event.preventDefault()}>
          <DialogTitle>Business Profile</DialogTitle>
          <form onSubmit={onSubmit}>
            <input aria-label="Business Profile value" defaultValue="Preserve this value" />
            <AIAssistBadge fieldLabel="Business Overview" tooltip="" />
          </form>
        </DialogContent>
      </Dialog>,
    );

    const openButton = screen.getByRole("button", { name: "Open data and chart for Business Overview" });
    const businessValue = screen.getByRole("textbox", { name: "Business Profile value" });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.click(openButton);
      expect(screen.getByText("Data & Chart")).toBeInTheDocument();
      expect(document.body.style.pointerEvents).toBe("none");
      expect(screen.getByRole("button", { name: "Close data and chart" }).closest(".pointer-events-auto")).toBeTruthy();

      const closeButton = screen.getByRole("button", { name: "Close data and chart" });
      fireEvent.pointerDown(closeButton);
      fireEvent.click(closeButton);

      expect(screen.queryByText("Data & Chart")).not.toBeInTheDocument();
      expect(screen.getByText("Business Profile")).toBeInTheDocument();
      expect(onDialogOpenChange).not.toHaveBeenCalledWith(false);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(businessValue).toHaveValue("Preserve this value");
      expect(document.body.style.position).toBe("relative");
      expect(document.body.style.pointerEvents).toBe("none");
      expect(window.scrollY).toBe(480);
    }
  });

  it("keeps headings read-only and saves editable values, rows, columns, and chart type for reopening", () => {
    const savedValues = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => savedValues.get(key) ?? null,
        setItem: (key: string, value: string) => savedValues.set(key, value),
      },
    });
    render(
      <Dialog open>
        <DialogContent onInteractOutside={(event) => event.preventDefault()}>
          <DialogTitle>Business Profile</DialogTitle>
          <AIAssistBadge fieldLabel="Chart persistence" tooltip="" />
        </DialogContent>
      </Dialog>,
    );
    const openButton = screen.getByRole("button", { name: "Open data and chart for Chart persistence" });
    fireEvent.click(openButton);

    expect(screen.getByText("Month")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Column name 1" })).not.toBeInTheDocument();

    const monthValue = screen.getByDisplayValue("Jan");
    monthValue.focus();
    fireEvent.pointerDown(monthValue);
    fireEvent.click(monthValue);
    expect(screen.getByText("Business Profile")).toBeInTheDocument();
    expect(document.activeElement).toBe(monthValue);
    fireEvent.change(monthValue, { target: { value: "January 2025" } });
    expect(monthValue).toHaveValue("January 2025");
    expect(document.activeElement).toBe(monthValue);

    const revenueValue = screen.getAllByDisplayValue("50,000")[0];
    const getBarHeights = () => Array.from(document.body.querySelectorAll<SVGRectElement>("svg rect"))
      .map((bar) => bar.getAttribute("height"));
    const initialBarHeights = getBarHeights();
    fireEvent.change(revenueValue, { target: { value: "51234" } });
    expect(getBarHeights()).not.toEqual(initialBarHeights);
    expect(revenueValue).toHaveValue("51,234");

    const initialEmptyCellCount = screen.getAllByPlaceholderText("Enter value").length;
    fireEvent.click(screen.getByRole("button", { name: "Add Row" }));
    expect(screen.getAllByPlaceholderText("Enter value")).toHaveLength(initialEmptyCellCount + 4);
    fireEvent.click(screen.getByRole("button", { name: "Delete Row", exact: true }));
    expect(screen.getAllByPlaceholderText("Enter value")).toHaveLength(initialEmptyCellCount);

    fireEvent.click(screen.getByRole("button", { name: "Delete row 4" }));
    expect(screen.queryByDisplayValue("Apr")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Column" }));
    expect(screen.getByRole("columnheader", { name: /Column 5/ })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Column name 5" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ring Chart" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByText("Data & Chart")).not.toBeInTheDocument();
    expect(screen.getByText("Business Profile")).toBeInTheDocument();

    fireEvent.click(openButton);
    expect(screen.getByText("Month")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Column 5/ })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Column name/ })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("January 2025")).toBeInTheDocument();
    expect(screen.getByDisplayValue("51,234")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ring Chart" })).toHaveClass("border-cyan-500/40");
    expect(screen.queryByDisplayValue("Apr")).not.toBeInTheDocument();
  });
});