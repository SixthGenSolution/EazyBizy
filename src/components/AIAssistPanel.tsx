import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Sparkles,
  X,
  Send,
  User,
  Copy,
  CheckCheck,
  BarChart3,
  Plus,
  Trash2,
  PieChart,
  Circle,
} from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  text: string;
}

interface AIAssistBadgeProps {
  fieldLabel?: string;
  tooltip?: string;
  variant?: "default" | "inline";
  showDataChart?: boolean;
  onApply?: (text: string) => void;
}

interface AssistPanelProps {
  fieldLabel: string;
  onClose: () => void;
  onApply?: (text: string) => void;
}

type ChartType = "bar" | "pie" | "donut";

type ChartRow = Record<string, string>;

interface ChartState {
  columns: string[];
  rows: ChartRow[];
  chartType: ChartType;
}

const DEFAULT_FIELD_LABEL = "this field";
const QUICK_PROMPTS = ["Write a sample", "Make it formal", "Make it shorter", "Give me tips"];
const DATA_CHART_STORAGE_PREFIX = "eazybizy_data_chart_";

const getWelcomeMessage = (fieldLabel: string): Message => ({
  role: "assistant",
  text: `Hi! I'm here to help you fill in **${fieldLabel}**.\n\nClick a quick option below or type your question!`,
});

const getChartStorageKey = (fieldLabel: string) =>
  `${DATA_CHART_STORAGE_PREFIX}${fieldLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "field"}`;

const createEmptyRow = (columns: string[]): ChartRow =>
  columns.reduce<ChartRow>((acc, column) => {
    acc[column] = "";
    return acc;
  }, {});

const getDefaultChartData = (): ChartState => ({
  columns: ["Month", "Revenue", "Expenses", "Profit"],
  rows: [
    { Month: "Jan", Revenue: "50000", Expenses: "30000", Profit: "20000" },
    { Month: "Feb", Revenue: "65000", Expenses: "40000", Profit: "25000" },
    { Month: "Mar", Revenue: "80000", Expenses: "50000", Profit: "30000" },
    { Month: "Apr", Revenue: "95000", Expenses: "60000", Profit: "35000" },
  ],
  chartType: "bar",
});

const normalizeChartData = (value: unknown, fallback: ChartState): ChartState => {
  if (!value || typeof value !== "object") return fallback;

  const candidate = value as Partial<ChartState>;
  const columns =
    Array.isArray(candidate.columns) && candidate.columns.length
      ? candidate.columns.map(String)
      : fallback.columns;

  const rows =
    Array.isArray(candidate.rows) && candidate.rows.length
      ? candidate.rows.map((row) => {
          const normalized: ChartRow = {};
          columns.forEach((column) => {
            normalized[column] =
              row && typeof row === "object" && column in row
                ? String((row as Record<string, unknown>)[column] ?? "")
                : "";
          });
          return normalized;
        })
      : [createEmptyRow(columns)];

  return {
    columns,
    rows,
    chartType: candidate.chartType === "pie" || candidate.chartType === "donut" ? candidate.chartType : "bar",
  };
};

const readSavedChartData = (fieldLabel: string): ChartState => {
  if (typeof window === "undefined") return getDefaultChartData();

  try {
    const raw = window.localStorage.getItem(getChartStorageKey(fieldLabel));
    if (!raw) return getDefaultChartData();

    return normalizeChartData(JSON.parse(raw), getDefaultChartData());
  } catch {
    return getDefaultChartData();
  }
};

const getChartSeriesData = (data: ChartState) => {
  if (!data.columns.length || !data.rows.length) {
    return { labels: ["No data"], values: [0], seriesName: "Value" };
  }

  const labelColumn = data.columns[0];
  const valueColumns = data.columns.filter((column) => column !== labelColumn);
  const primaryColumn = valueColumns[0] || labelColumn;

  const labels = data.rows.map((row, index) => String(row[labelColumn] || `Row ${index + 1}`));
  const values = data.rows.map((row) => {
    const numeric = Number(String(row[primaryColumn] ?? "0").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(numeric) ? numeric : 0;
  });

  return {
    labels,
    values,
    seriesName: primaryColumn,
  };
};

const getAIResponse = async (fieldLabel: string, messages: Message[]): Promise<string> => {
  await new Promise((resolve) => setTimeout(resolve, 900));

  const lastMsg = messages[messages.length - 1]?.text?.toLowerCase() || "";
  const field = fieldLabel.toLowerCase();

  if (lastMsg.includes("shorter") || lastMsg.includes("brief") || lastMsg.includes("concise")) {
    return `Here's a concise version for **${fieldLabel}**:\n\nA focused, streamlined description that highlights the most important points clearly and professionally.`;
  }

  if (lastMsg.includes("formal") || lastMsg.includes("professional")) {
    return `Here's a formal version for **${fieldLabel}**:\n\nThis business entity operates with a commitment to excellence, delivering high-quality products and services in accordance with industry standards and regulatory requirements.`;
  }

  if (lastMsg.includes("example") || lastMsg.includes("sample")) {
    if (field.includes("business overview") || field.includes("business description")) {
      return `**Example for Business Overview:**\n\nABC Enterprises is a registered MSME specializing in eco-friendly packaging solutions. Established in 2022 in Pune, we manufacture biodegradable packaging for FMCG companies across Maharashtra. We serve 40+ clients with a monthly turnover of Rs 8 lakhs and plan to expand into Gujarat and Karnataka within 18 months.`;
    }

    if (field.includes("product") || field.includes("service")) {
      return `**Example for Products/Services:**\n\n1. Biodegradable carry bags (sizes: small, medium, large)\n2. Food-grade paper packaging boxes\n3. Custom printed packaging for retail brands\n\nAll products are BIS certified and manufactured using recycled kraft paper.`;
    }

    if (field.includes("market") || field.includes("customer")) {
      return `**Example for Target Market:**\n\nPrimary: FMCG companies and supermarkets in Tier 1 and Tier 2 cities\nSecondary: E-commerce sellers and kirana stores\nTarget age: Business owners aged 25-55\nGeography: Maharashtra, Gujarat, Karnataka`;
    }

    if (field.includes("competitive") || field.includes("usp")) {
      return `**Example for Competitive Advantage:**\n\nOur key differentiators are:\n- 48-hour delivery guarantee within a 200 km radius\n- ISO 9001 certified manufacturing process\n- 15% lower pricing than competitors due to in-house raw material processing\n- Custom branding and printing at no extra cost`;
    }

    if (field.includes("promoter") || field.includes("experience")) {
      return `**Example for Promoter Experience:**\n\nMr. Rajesh Shah, 38, holds a B.E. in Mechanical Engineering from VJTI Mumbai and has 12 years of experience in the packaging industry. He previously worked as Production Manager at Parle Products Pvt. Ltd. before founding ABC Enterprises in 2022.`;
    }

    if (field.includes("introduction")) {
      return `**Example Introduction:**\n\nThis project report presents the business plan for ABC Enterprises, a Pune-based MSME seeking a term loan of Rs 25 lakhs under the PMEGP scheme. The enterprise is engaged in eco-friendly packaging manufacturing and has demonstrated consistent growth since inception in 2022.`;
    }

    if (field.includes("collateral")) {
      return `**Example for Collateral Details:**\n\nResidential property at Plot No. 42, Sector 7, Pune - market value Rs 45 lakhs (owned by applicant, mortgage-free). Fixed deposit of Rs 3 lakhs in SBI. Vehicle RC of Tata Ace (2022 model) worth Rs 4.5 lakhs.`;
    }

    return `**Example for ${fieldLabel}:**\n\nHere is a sample entry that demonstrates the kind of information banks and lenders typically look for in this section. Be specific, use real numbers where possible, and keep the tone professional.`;
  }

  if (field.includes("business overview") || field.includes("business description")) {
    return `I can help you write a strong **Business Overview** for your bank submission.\n\nA good overview includes:\n- What your business does\n- Where it operates\n- How long it has been running\n- Monthly turnover or projections\n- Number of employees\n\nWould you like me to write a **sample**, make it **more formal**, or make it **shorter**?`;
  }

  if (field.includes("product") || field.includes("service")) {
    return `For **Products / Services**, banks want clear specifics.\n\nTry to include:\n- List of main products or services\n- Any certifications (BIS, FSSAI, ISO)\n- Pricing range or volume capacity\n\nType **"example"** and I'll write a sample for you!`;
  }

  if (field.includes("market") || field.includes("customer")) {
    return `For **Target Market**, describe:\n- Who your customers are (B2B or B2C)\n- Which cities or regions you serve\n- Approximate customer count\n\nType **"example"** for a sample!`;
  }

  if (field.includes("competitive") || field.includes("usp")) {
    return `Your **Competitive Advantage** should answer: Why would a customer choose you over others?\n\nStrong USPs include:\n- Price advantage\n- Faster delivery\n- Better quality or certification\n- Unique technology or process\n\nType **"example"** for a sample!`;
  }

  if (field.includes("promoter") || field.includes("experience")) {
    return `For **Promoter Experience**, include:\n- Your educational qualifications\n- Years of relevant work experience\n- Previous companies or roles\n- Any awards or recognition\n\nThis builds lender confidence. Type **"example"** for a sample!`;
  }

  if (field.includes("introduction")) {
    return `The **Introduction** section sets the tone for your entire project report.\n\nIt should cover:\n- Name and type of business\n- Loan amount and scheme applied for\n- Location and registration details\n- Brief purpose of the loan\n\nType **"example"** and I'll draft one for you!`;
  }

  if (field.includes("market aspects")) {
    return `**Market Aspects** should describe:\n- Size of the target market\n- Growth trends in your industry\n- Your market share or target share\n- Demand drivers for your product or service\n\nType **"example"** for a complete sample!`;
  }

  if (field.includes("management aspects")) {
    return `**Management Aspects** covers:\n- Organizational structure\n- Key team members and their roles\n- Management experience and expertise\n- Decision-making processes\n\nType **"example"** for a sample!`;
  }

  if (field.includes("technical aspects")) {
    return `**Technical Aspects** should explain:\n- Manufacturing process or service delivery\n- Machinery and equipment used\n- Location and infrastructure\n- Capacity and production details\n\nType **"example"** for a sample!`;
  }

  if (field.includes("financial aspects")) {
    return `**Financial Aspects** should include:\n- Total project cost breakdown\n- Means of finance (loan plus own contribution)\n- Projected revenue for 3-5 years\n- Break-even point\n\nType **"example"** for a sample!`;
  }

  if (field.includes("address")) {
    return `I can help format your **Address** properly for official documents.\n\nMake sure to include:\n- Building or plot number\n- Street and area name\n- City, State, Pincode\n\nType **"example"** for a sample!`;
  }

  if (field.includes("collateral")) {
    return `For **Collateral Details**, list all assets you can offer as security:\n- Property (with approximate market value)\n- Fixed deposits\n- Vehicles (with RC number)\n- Gold or jewellery\n- Machinery\n\nType **"example"** for a sample!`;
  }

  return `I can help you fill in **${fieldLabel}** with professional, bank-ready content.\n\nTry asking:\n- **"Write a sample"** and I'll draft a complete example\n- **"Make it formal"** for a professional tone\n- **"Make it shorter"** for a concise version\n\nWhat would you like?`;
};

const cleanMessageText = (text: string) =>
  text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^(Example for .+?:|Here's a .+?:)\n\n/i, "")
    .trim();

const renderText = (text: string) => {
  const lines = text.split("\n");

  return lines.map((line, index) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);

    return (
      <span key={`${line}-${index}`}>
        {parts.map((part, partIndex) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={`${part}-${partIndex}`}>{part.slice(2, -2)}</strong>
          ) : (
            <span key={`${part}-${partIndex}`}>{part}</span>
          ),
        )}
        {index < lines.length - 1 && <br />}
      </span>
    );
  });
};

const AssistPanel = ({ fieldLabel, onClose, onApply }: AssistPanelProps) => {
  const [messages, setMessages] = useState<Message[]>([getWelcomeMessage(fieldLabel)]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const send = async (text: string) => {
    const nextText = text.trim();
    if (!nextText || loading) return;

    const userMessage: Message = { role: "user", text: nextText };
    const updatedMessages = [...messages, userMessage];

    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    const reply = await getAIResponse(fieldLabel, updatedMessages);
    setMessages([...updatedMessages, { role: "assistant", text: reply }]);
    setLoading(false);
  };

  const handleApply = (text: string) => {
    if (!onApply) return;

    onApply(cleanMessageText(text));
    onClose();
  };

  const handleCopy = async (text: string, index: number) => {
    const cleanText = cleanMessageText(text);

    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(cleanText);
    setCopiedIndex(index);
    window.setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      <div
        className="fixed bottom-6 right-6 z-[80] flex flex-col overflow-hidden shadow-2xl"
        style={{
          width: "min(360px, calc(100vw - 24px))",
          height: "min(520px, calc(100vh - 24px))",
          background: "hsl(220 24% 12%)",
          border: "1px solid hsl(220 20% 20%)",
          borderRadius: "20px",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex flex-shrink-0 items-center justify-between px-4 py-3"
          style={{
            background: "hsl(174 72% 56% / 0.10)",
            borderBottom: "1px solid hsl(220 20% 20%)",
          }}
        >
          <div className="flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: "hsl(174 72% 56% / 0.20)" }}
            >
              <Sparkles className="h-3.5 w-3.5" style={{ color: "hsl(174 72% 56%)" }} />
            </div>
            <div>
              <p className="text-xs font-semibold leading-tight text-white">AI Assist</p>
              <p className="text-[10px] leading-tight" style={{ color: "hsl(174 72% 56%)" }}>
                {fieldLabel}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={`Close AI assist for ${fieldLabel}`}
            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3" style={{ scrollbarWidth: "thin" }}>
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={cn("flex gap-2", message.role === "user" ? "flex-row-reverse" : "flex-row")}
            >
              <div
                className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
                style={{
                  background:
                    message.role === "assistant" ? "hsl(174 72% 56% / 0.20)" : "hsl(220 20% 25%)",
                }}
              >
                {message.role === "assistant" ? (
                  <Sparkles className="h-3 w-3" style={{ color: "hsl(174 72% 56%)" }} />
                ) : (
                  <User className="h-3 w-3 text-gray-300" />
                )}
              </div>

              <div
                className={cn(
                  "flex max-w-[82%] flex-col gap-1",
                  message.role === "user" ? "items-end" : "items-start",
                )}
              >
                <div
                  className="rounded-2xl px-3 py-2 text-xs leading-relaxed"
                  style={{
                    background:
                      message.role === "user" ? "hsl(174 72% 56% / 0.18)" : "hsl(220 20% 18%)",
                    color: message.role === "user" ? "hsl(174 72% 75%)" : "#e2e8f0",
                    borderRadius:
                      message.role === "user" ? "18px 4px 18px 18px" : "4px 18px 18px 18px",
                  }}
                >
                  {renderText(message.text)}
                </div>

                {message.role === "assistant" && index > 0 && (
                  <div className="flex gap-1.5">
                    {onApply && (
                      <button
                        type="button"
                        onClick={() => handleApply(message.text)}
                        className="rounded-full px-2.5 py-1 text-[10px] font-medium transition-all hover:opacity-90 active:scale-95"
                        style={{
                          background: "hsl(174 72% 56%)",
                          color: "hsl(220 26% 8%)",
                        }}
                      >
                        Apply to field
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleCopy(message.text, index)}
                      className="rounded-full px-2.5 py-1 text-[10px] font-medium transition-all hover:opacity-80"
                      style={{
                        background: "hsl(220 20% 22%)",
                        color: "#94a3b8",
                      }}
                    >
                      {copiedIndex === index ? (
                        <span className="flex items-center gap-1">
                          <CheckCheck className="h-2.5 w-2.5" />
                          Copied
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Copy className="h-2.5 w-2.5" />
                          Copy
                        </span>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-2">
              <div
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
                style={{ background: "hsl(174 72% 56% / 0.20)" }}
              >
                <Sparkles className="h-3 w-3" style={{ color: "hsl(174 72% 56%)" }} />
              </div>

              <div
                className="flex items-center gap-1 rounded-2xl px-3 py-2.5"
                style={{ background: "hsl(220 20% 18%)", borderRadius: "4px 18px 18px 18px" }}
              >
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    className="h-1.5 w-1.5 animate-bounce rounded-full"
                    style={{
                      background: "hsl(174 72% 56%)",
                      animationDelay: `${dot * 0.15}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div
          className="flex flex-shrink-0 flex-wrap gap-1.5 border-t px-3 pb-1 pt-2"
          style={{ borderColor: "hsl(220 20% 18%)" }}
        >
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void send(prompt)}
              disabled={loading}
              className="rounded-full px-2.5 py-1 text-[10px] transition-all hover:opacity-90 disabled:opacity-40"
              style={{
                background: "hsl(174 72% 56% / 0.10)",
                border: "1px solid hsl(174 72% 56% / 0.25)",
                color: "hsl(174 72% 65%)",
              }}
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="flex flex-shrink-0 gap-2 px-3 pb-3 pt-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void send(input);
              }
            }}
            placeholder="Ask anything about this field..."
            disabled={loading}
            className="flex-1 rounded-xl px-3 py-2 text-xs outline-none disabled:opacity-50"
            style={{
              background: "hsl(220 20% 18%)",
              border: "1px solid hsl(220 20% 26%)",
              color: "#e2e8f0",
            }}
          />

          <button
            type="button"
            onClick={() => void send(input)}
            disabled={loading || !input.trim()}
            className="flex h-8 w-8 items-center justify-center rounded-xl transition-all hover:opacity-90 disabled:opacity-30 active:scale-95"
            style={{ background: "hsl(174 72% 56%)" }}
          >
            <Send className="h-3.5 w-3.5" style={{ color: "hsl(220 26% 8%)" }} />
          </button>
        </div>
      </div>
    </>
  );
};

const formatCellValue = (value: string) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";

  const numeric = Number(trimmed.replace(/,/g, ""));
  if (Number.isFinite(numeric)) {
    return numeric.toLocaleString("en-IN");
  }

  return trimmed;
};

const DataChartModal = memo(({ fieldLabel, onClose }: { fieldLabel: string; onClose: () => void }) => {
  const [data, setData] = useState<ChartState>(() => readSavedChartData(fieldLabel));

  useEffect(() => {
    setData(readSavedChartData(fieldLabel));
  }, [fieldLabel]);

  const totalRows = data.rows.length;
  const totalColumns = data.columns.length;

  const addRow = () => {
    setData((current) => ({
      ...current,
      rows: [...current.rows, createEmptyRow(current.columns)],
    }));
  };

  const addColumn = () => {
    setData((current) => {
      const nextColumnName = `Column ${current.columns.length + 1}`;
      return {
        ...current,
        columns: [...current.columns, nextColumnName],
        rows: current.rows.map((row) => ({ ...row, [nextColumnName]: "" })),
      };
    });
  };

  const deleteRow = (rowIndex: number) => {
    if (data.rows.length <= 1) return;
    setData((current) => ({
      ...current,
      rows: current.rows.filter((_, index) => index !== rowIndex),
    }));
  };

  const deleteLastRow = () => deleteRow(data.rows.length - 1);

  const deleteColumn = (columnIndex: number) => {
    if (data.columns.length <= 1) return;
    setData((current) => {
      const nextColumns = current.columns.filter((_, index) => index !== columnIndex);
      return {
        ...current,
        columns: nextColumns,
        rows: current.rows.map((row) => {
          const nextRow: ChartRow = {};
          nextColumns.forEach((column) => {
            nextRow[column] = row[column] ?? "";
          });
          return nextRow;
        }),
      };
    });
  };

  const updateRowCell = (rowIndex: number, column: string, value: string) => {
    setData((current) => ({
      ...current,
      rows: current.rows.map((row, index) =>
        index === rowIndex ? { ...row, [column]: value } : row,
      ),
    }));
  };

  const handleSave = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(getChartStorageKey(fieldLabel), JSON.stringify(data));
    }
    onClose();
  };

  const chartPreview = useMemo(() => getChartSeriesData(data), [data]);
  const chartData = useMemo(() => {
    const chartPalette = ["#2dd4bf", "#8b5cf6", "#fbbf24", "#60a5fa", "#34d399", "#f472b6"];
    const series = data.columns.slice(1).map((column, seriesIndex) => ({
      name: column,
      values: data.rows.map((row) => Number(String(row[column] ?? "0").replace(/[^0-9.-]/g, "")) || 0),
      color: chartPalette[seriesIndex % chartPalette.length],
    }));
    const maxValue = Math.max(...series.flatMap((item) => item.values), 1);
    const legendEntries = series.map((item) => ({ label: item.name, color: item.color }));
    const pieSegments = chartPreview.values.reduce<{ start: number; end: number; color: string }[]>(
      (acc, value, index) => {
        const safeValue = Number.isFinite(value) ? value : 0;
        const total = chartPreview.values.reduce((sum, item) => sum + (Number.isFinite(item) ? item : 0), 0) || 1;
        const start = acc.length ? acc[acc.length - 1].end : 0;
        const end = start + (safeValue / total) * 100;
        acc.push({ start, end, color: chartPalette[index % chartPalette.length] });
        return acc;
      },
      [],
    );

    return { chartPalette, maxValue, legendEntries, multiSeries: series, pieSegments };
  }, [chartPreview, data]);
  const { chartPalette, maxValue, legendEntries, multiSeries, pieSegments } = chartData;

  const pieGradient = pieSegments.length
    ? pieSegments.map((segment) => `${segment.color} ${segment.start}% ${segment.end}%`).join(", ")
    : "#2dd4bf 0% 100%";

  const chartBody = (() => {
    if (data.chartType === "bar") {
      const groupWidth = 58;
      const barGap = 8;
      const singleBarWidth = 12;
      const chartWidth = 320;
      const chartHeight = 200;

      return (
        <div className="mt-5">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-56 w-full">
            {[0, 1, 2, 3].map((tick) => {
              const y = 30 + tick * 42;
              const value = (maxValue / 3) * (3 - tick);
              return (
                <g key={tick}>
                  <line x1="38" x2="300" y1={y} y2={y} stroke="#334155" strokeDasharray="3 4" />
                  <text x="0" y={y + 4} fill="#94a3b8" fontSize="10">
                    {value.toLocaleString("en-IN")}
                  </text>
                </g>
              );
            })}

            {chartPreview.labels.map((label, index) => {
              const xBase = 52 + index * groupWidth;
              return (
                <g key={`${label}-${index}`}>
                  {multiSeries.map((series, seriesIndex) => {
                    const value = series.values[index] ?? 0;
                    const barHeight = Math.max(12, (value / maxValue) * 120);
                    const x = xBase + seriesIndex * (singleBarWidth + barGap);
                    const y = 150 - barHeight;
                    return (
                      <rect
                        key={`${label}-${series.name}`}
                        x={x}
                        y={y}
                        width={singleBarWidth}
                        height={barHeight}
                        rx={4}
                        fill={series.color}
                      />
                    );
                  })}
                  <text x={xBase + 12} y="172" fill="#cbd5e1" fontSize="10" textAnchor="middle">
                    {label.length > 5 ? label.slice(0, 5) : label}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            {legendEntries.map((entry) => (
              <div key={entry.label} className="flex items-center gap-2 text-[10px] text-slate-300">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: entry.color }} />
                {entry.label}
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (data.chartType === "pie") {
      return (
        <div className="mt-5 flex flex-col items-center justify-center gap-4">
          <div
            className="relative flex h-44 w-44 items-center justify-center rounded-full border border-cyan-500/20 shadow-inner"
            style={{ background: `conic-gradient(${pieGradient})` }}
          >
            <div className="h-20 w-20 rounded-full bg-slate-950/95" />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 text-[10px] text-slate-300">
            {legendEntries.map((entry) => (
              <div key={entry.label} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: entry.color }} />
                {entry.label}
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="mt-5 flex flex-col items-center justify-center gap-4">
        <div
          className="relative flex h-44 w-44 items-center justify-center rounded-full border border-cyan-500/20 shadow-inner"
          style={{ background: `conic-gradient(${pieGradient})` }}
        >
          <div className="absolute inset-[24%] rounded-full bg-slate-950/95" />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 text-[10px] text-slate-300">
          {legendEntries.map((entry) => (
            <div key={entry.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: entry.color }} />
              {entry.label}
            </div>
          ))}
        </div>
      </div>
    );
  })();

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/50 pointer-events-auto" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[90] w-[min(920px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[22px] border border-cyan-500/20 bg-[#091827] shadow-[0_30px_60px_rgba(2,6,23,0.72)] pointer-events-auto"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
        <div className="flex items-start justify-between border-b border-slate-700/70 bg-[#0d1d2f]/90 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
              <BarChart3 className="h-4 w-4" />
            </div>
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-white">Data & Chart</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-[11px] text-slate-400">Add your data, choose a chart type and save it to this section.</DialogPrimitive.Description>
            </div>
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/5"
            aria-label="Close data and chart"
          >
            <X className="h-4 w-4 text-slate-300" />
          </button>
        </div>

        <div className="grid gap-5 p-5 md:grid-cols-[1.6fr_0.9fr]">
          <div className="overflow-hidden rounded-2xl border border-slate-700/80 bg-[#0b1522]/80">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-700/80 bg-[#101f30]/80 p-3">
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/15"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Row
              </button>
              <button
                type="button"
                onClick={deleteLastRow}
                disabled={totalRows <= 1}
                className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Row
              </button>
              <button
                type="button"
                onClick={addColumn}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/15"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Column
              </button>

              {data.columns.length > 1 && (
                <button
                  type="button"
                  onClick={() => deleteColumn(totalColumns - 1)}
                  className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-500/15"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Column
                </button>
              )}
            </div>

            <div className="max-h-[500px] overflow-auto p-3">
              <table className="min-w-full border-separate border-spacing-1 text-left text-xs">
                <thead>
                  <tr>
                    {data.columns.map((column, columnIndex) => (
                      <th key={columnIndex} className="min-w-[130px] rounded-xl bg-[#101c2c] p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="w-full px-1 py-1 text-[11px] font-semibold text-slate-100">{column}</span>
                          {data.columns.length > 1 && (
                            <button
                              type="button"
                              onClick={() => deleteColumn(columnIndex)}
                              className="text-slate-400 hover:text-rose-300"
                              aria-label={`Delete column ${columnIndex + 1}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`}>
                      {data.columns.map((column, columnIndex) => (
                        <td key={`${rowIndex}-${columnIndex}`} className="rounded-xl bg-[#101c2c] p-2">
                          <input
                            value={formatCellValue(row[column] ?? "")}
                            onChange={(event) => updateRowCell(rowIndex, column, event.target.value)}
                            className="w-full bg-transparent px-1 py-1 text-[11px] text-slate-100 outline-none placeholder:text-slate-500"
                            placeholder="Enter value"
                          />
                        </td>
                      ))}

                      {data.rows.length > 1 && (
                        <td className="w-9 rounded-xl bg-[#101c2c] p-2 text-center">
                          <button
                            type="button"
                            onClick={() => deleteRow(rowIndex)}
                            className="text-slate-400 hover:text-rose-300"
                            aria-label={`Delete row ${rowIndex + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700/80 bg-[#0b1522]/80 p-4">
            <div className="mb-4">
              <p className="text-sm font-semibold text-slate-100">Chart Type</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { key: "bar", label: "Bar Chart", icon: <BarChart3 className="h-4 w-4" /> },
                { key: "pie", label: "Pie Chart", icon: <PieChart className="h-4 w-4" /> },
                { key: "donut", label: "Ring Chart", icon: <Circle className="h-4 w-4" /> },
              ].map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setData((current) => ({ ...current, chartType: option.key as ChartType }))}
                  className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border px-2 py-2 text-[11px] font-medium transition-all ${
                    data.chartType === option.key
                      ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-100 shadow-inner"
                      : "border-slate-700 bg-slate-800/90 text-slate-300 hover:bg-slate-700/80"
                  }`}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>

            <div className="mt-5 rounded-2xl border border-slate-700/80 bg-[#0e1b2e] p-3">
              <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-slate-400">
                <span>Preview</span>
                <span>{data.chartType}</span>
              </div>
              {chartBody}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-xl border border-cyan-500/40 bg-cyan-500 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-cyan-400"
              >
                Save
              </button>
            </div>
          </div>
        </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
});
DataChartModal.displayName = "DataChartModal";

const AIAssistPanel = ({
  fieldLabel = DEFAULT_FIELD_LABEL,
  tooltip = "Get AI help for this field",
  variant = "default",
  showDataChart = true,
  onApply,
}: AIAssistBadgeProps) => {
  const [open, setOpen] = useState(false);
  const [dataChartOpen, setDataChartOpen] = useState(false);
  const closeDataChart = useCallback(() => setDataChartOpen(false), []);

  const trigger = (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Open AI assist for ${fieldLabel}`}
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border transition-all hover:-translate-y-0.5 hover:shadow-sm",
          "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
          variant === "inline" ? "shrink-0 px-1.5 py-1 text-[10px] sm:px-2" : "px-2.5 py-1 text-[11px] font-medium",
        )}
      >
        <Sparkles className={cn("shrink-0", variant === "inline" ? "h-3 w-3" : "h-3.5 w-3.5")} />
        <span>{variant === "inline" ? "AI" : "AI Assist"}</span>
      </button>

      {showDataChart && (
        <button
          type="button"
          aria-label={`Open data and chart for ${fieldLabel}`}
          onClick={() => setDataChartOpen(true)}
          className={cn(
            "inline-flex items-center justify-center rounded-full border border-cyan-500/30 bg-slate-900/80 text-cyan-300 transition-all hover:-translate-y-0.5 hover:shadow-sm",
            variant === "inline" ? "h-5 w-5" : "h-7 w-7",
          )}
          title="Data & Chart"
        >
          <BarChart3 className={variant === "inline" ? "h-2.75 w-2.75" : "h-3.5 w-3.5"} />
        </button>
      )}
    </div>
  );

  return (
    <>
      {tooltip ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="top">{tooltip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        trigger
      )}

      {open && <AssistPanel fieldLabel={fieldLabel} onClose={() => setOpen(false)} onApply={onApply} />}
      {showDataChart && dataChartOpen && <DataChartModal fieldLabel={fieldLabel} onClose={closeDataChart} />}
    </>
  );
};

export default AIAssistPanel;
