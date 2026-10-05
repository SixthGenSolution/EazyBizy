"""
pdf_builder.py  —  Generates the full Combined CMA + DPR PDF.
Call:  build_pdf(inp_dict, cma_data, dpr_data, output_path)

REBUILD NOTE: the report is organised into three layers, per an explicit
restructuring request:
  Layer 1 — Banker Summary       (Sections 01-10): cover, credit summary,
            loan proposal, applicant/project/funding — a banker should be
            able to decide from this layer alone.
  Layer 2 — Financial Analysis   (Sections 11-30): assumptions through
            revenue, costs, P&L, working capital, assets, debt, cash flow,
            balance sheet, DSCR, ratios, break-even, sensitivity, risk.
  Layer 3 — Methodology & Audit  (Sections 31-34): formula definitions,
            reconciliation status, declaration.

Every number still comes from the same single calculation engine
(calculations/*.py via pdf/generator.py) — this file only changed WHERE
each figure is displayed and REMOVED duplicate restatements of the same
figure across multiple sections. No calculation logic was touched.

Sections deliberately removed as duplicates/empty (per explicit request):
  - "Profitability Index" as a separate late-report page -> merged into
    Financial Analysis right after the P&L (Section-B).
  - Q1 (Repayment Coverage) and old Section N (DSCR detail) restated DSCR
    twice -> merged into one DSCR & Debt Servicing section (26).
  - Q3 (Promoter Net Worth) was disconnected from promoter contribution ->
    merged into Promoter Contribution (10).
  - Q4 (Internal Viability Assessment) repeated ratios already in Q2 ->
    merged into Financial Ratio Analysis (27) as the closing verdict row.
  - The old standalone "SECTION IX — Executive Financial Summary" (AI
    observations) duplicated the cover-page Executive Observations ->
    merged into Executive Credit Summary (02).
  - Sensitivity Analysis: 6 scenarios reduced to 5 (dropped the +20% "Best
    Case" extreme, which added a scenario without changing the reading).
  - Form IV: the live calculation pipeline never populates it (a legacy,
    field-name-incompatible pipeline does) — removed entirely rather than
    risk showing fabricated zeros, or a header with nothing under it.
  - Appendix's separately-repeated "P&L Formula Chain" and "Initial
    Investment Structure" paragraphs — both already fully shown, once,
    as actual tables in Sections 08/09/15 — removed from the appendix to
    avoid restating the same structure a third time in prose.
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table,
    TableStyle, PageBreak, HRFlowable
)
from datetime import datetime
from contextvars import ContextVar
from core.engine import dscr_label, R, validate_cma_dpr
from calculations.validator import structural_reconciliation, StructuralReconciliationError

# ── Scheme name resolver (for display in PDF) ─────────────────────────────────
_SCHEME_DISPLAY: dict = {
    "pmegp":           "PMEGP — Pradhan Mantri Employment Generation Programme",
    "mudra":           "Mudra Loan — Kishor Category",
    "mudra_shishu":    "Mudra Loan -- Shishu Category (upto Rs.50,000)",
    "mudra_kishor":    "Mudra Loan -- Kishor Category (Rs.50K - Rs.5L)",
    "mudra_tarun":     "Mudra Loan -- Tarun Category (Rs.5L - Rs.10L)",
    "mudra_tarunplus": "Mudra Loan -- TarunPlus Category (Rs.10L - Rs.20L)",
    "cgtmse":          "CGTMSE — Credit Guarantee Fund Trust for Micro & Small Enterprises",
    "msme_psu":        "Normal MSME Term Loan — PSU Bank Finance",
    "normal_msme":     "Normal MSME Term Loan — PSU Bank Finance",
    "other_scheme":    "MSME Bank Loan",
}

def scheme_display(raw: str) -> str:
    """Return the full official scheme name for PDF display."""
    key = (raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    return _SCHEME_DISPLAY.get(key) or raw.title() or "MSME Bank Loan"

def scheme_short(raw: str) -> str:
    """Return short form: PMEGP / Mudra Kishor / CGTMSE / MSME."""
    key = (raw or "").strip().lower().replace(" ", "_")
    short_map = {
        "pmegp": "PMEGP", "mudra": "Mudra Kishor", "mudra_shishu": "Mudra Shishu",
        "mudra_kishor": "Mudra Kishor", "mudra_tarun": "Mudra Tarun",
        "mudra_tarunplus": "Mudra TarunPlus", "cgtmse": "CGTMSE",
        "msme_psu": "MSME PSU", "normal_msme": "MSME PSU", "other_scheme": "MSME Loan",
    }
    return short_map.get(key) or raw.upper()[:15] or "MSME"

# ── Colours ───────────────────────────────────────────────────────────────────
DG  = colors.HexColor("#0B1F3A")
MG  = colors.HexColor("#173B63")
LG  = colors.HexColor("#DCEAF7")
ALT = colors.HexColor("#F6FAFE")
RED = colors.HexColor("#F8D7DA")
AMB = colors.HexColor("#FFF3CD")
# BUG FIX: this was "#D6EAF8" — a pale BLUE, not green — so every "PASS" /
# "Low Risk" banner that used GRN rendered indistinguishably from LG/ALT's
# blue tones instead of actually reading as green.
GRN = colors.HexColor("#D4EDDA")
GRY = colors.HexColor("#CBD5E1")
W   = colors.white
BLK = colors.black
DGR = colors.HexColor("#334155")
MUTED = colors.HexColor("#64748B")

_DEFAULT_REPORT_THEME = {"dark": DG, "accent": MG, "light": LG}
_REPORT_THEMES = {
    "Navy": {"dark": DG, "accent": MG, "light": LG},
    "Teal": {"dark": colors.HexColor("#0F766E"), "accent": colors.HexColor("#0D9488"), "light": colors.HexColor("#CCFBF1")},
    "Royal Blue": {"dark": colors.HexColor("#1D4ED8"), "accent": colors.HexColor("#2563EB"), "light": colors.HexColor("#DBEAFE")},
    "Burgundy": {"dark": colors.HexColor("#6B1D36"), "accent": colors.HexColor("#7F1D3B"), "light": colors.HexColor("#FCE7EF")},
    "Forest Green": {"dark": colors.HexColor("#14532D"), "accent": colors.HexColor("#166534"), "light": colors.HexColor("#DCFCE7")},
    "Charcoal": {"dark": colors.HexColor("#1F2937"), "accent": colors.HexColor("#334155"), "light": colors.HexColor("#E2E8F0")},
}
_ACTIVE_REPORT_THEME: ContextVar[dict] = ContextVar("active_cma_report_theme", default=_DEFAULT_REPORT_THEME)


def _theme_color(role: str):
    return _ACTIVE_REPORT_THEME.get()[role]

# ── Styles ────────────────────────────────────────────────────────────────────
def _s(name, **kw): return ParagraphStyle(name, **kw)
ST = {
    "cover_title":  _s("ct", fontSize=22, textColor=W,   alignment=TA_CENTER, leading=28, fontName="Helvetica-Bold"),
    "cover_sub":    _s("cs", fontSize=12, textColor=LG,  alignment=TA_CENTER, leading=18, fontName="Helvetica"),
    "cover_body":   _s("cb", fontSize=10, textColor=W,   alignment=TA_CENTER, leading=15, fontName="Helvetica"),
    "h1":           _s("h1", fontSize=12, textColor=W,   leading=17, fontName="Helvetica-Bold"),
    "h2":           _s("h2", fontSize=10, textColor=DG,  leading=14, fontName="Helvetica-Bold", spaceBefore=4, spaceAfter=2),
    "normal":       _s("nm", fontSize=8.5,textColor=DGR, leading=13, fontName="Helvetica"),
    "bold":         _s("bd", fontSize=8.5,textColor=BLK, leading=13, fontName="Helvetica-Bold"),
    "small":        _s("sm", fontSize=7,  textColor=MUTED, leading=11, fontName="Helvetica"),
    "bullet":       _s("bl", fontSize=8.5,textColor=DGR, leading=13, fontName="Helvetica",
                        leftIndent=10, bulletIndent=0, spaceAfter=1),
    "rec_approve":  _s("ra", fontSize=14, textColor=W,   alignment=TA_CENTER, leading=20, fontName="Helvetica-Bold"),
    "rec_box":      _s("rb", fontSize=9,  textColor=DGR, alignment=TA_CENTER, leading=13, fontName="Helvetica"),
    # For free-text table VALUES that need Paragraph-wrapping (ReportLab
    # does not auto-wrap plain strings) — black, matching every other
    # plain-string table cell's default text colour, instead of "normal"'s
    # dark-grey body-text tone which would look inconsistent inside a table.
    "table_cell":   _s("tc", fontSize=8.5,textColor=BLK, leading=11, fontName="Helvetica"),
}


def _theme_style(name: str, color_role: str):
    base_style = ST[name]
    return ParagraphStyle(f"{base_style.name}_{color_role}", parent=base_style, textColor=_theme_color(color_role))

# ── Format helpers ────────────────────────────────────────────────────────────
def rs(v):
    try:    return f"Rs. {float(v):,.0f}"
    except: return str(v)

def rp(v):
    try:    return f"{float(v)*100:.1f}%"
    except: return str(v)

def rp2(v):
    try:    return f"{float(v):.1f}%"
    except: return str(v)

def r(v):
    try:    return f"{float(v):,.0f}"
    except: return str(v)

def r2(v):
    try:    return f"{float(v):,.2f}"
    except: return str(v)

def pof(num, den):
    try:    return f"{float(num)/float(den)*100:.1f}%"
    except: return "N/A"

def location_district(inp: dict) -> str:
    """"Location" / "District" combined for display. When they're the same
    value (common for a single-location small business), showing both
    concatenated ("Nashik  Nashik" / "Nashik, Nashik") reads as a
    typo/duplication to a reviewer — show it once instead."""
    loc  = str(inp.get("primary_location", "") or "").strip()
    dist = str(inp.get("district", "") or "").strip()
    if not dist or dist.lower() == loc.lower():
        return loc
    if not loc:
        return dist
    return f"{loc}, {dist}"

def _o1_expense_breakdown(cma: dict, inp: dict) -> dict:
    """Section O1's itemized monthly expense rows — reconciled to foot exactly
    to their own displayed Sub-Total Fixed / Sub-Total Variable / TOTAL MONTHLY
    EXPENSES.

    BUG FIX: "fixed_total"/"variable_total"/"total_monthly_exp" are synced to
    the annual income-statement's Year-1 figures (P1: Master Engine Sync in
    generator.py) — which apply a PF/benefits loading to salary that
    monthly_pnl.py's own (unsynced) "fixed_salary" never did. That left this
    table's own listed rows short of its own displayed total whenever that
    loading applied. Salary is derived as the residual against the
    authoritative fixed_total; the "other variable" items are scaled
    proportionally (relative shares preserved) against the authoritative
    variable_total — same technique used for the capacity/revenue table fix.
    """
    rent        = float(cma.get("rent") or inp.get("rent", 0) or inp.get("monthly_rent", 0) or 0)
    fixed_total = float(cma.get("fixed_total", 0) or 0)
    salary      = max(fixed_total - rent, 0)

    cogs         = float(cma.get("cogs_monthly", cma.get("raw_material_monthly", 0)) or 0)
    marketing    = float(cma.get("mktg_monthly", 0) or 0)
    variable_total = float(cma.get("variable_total", 0) or 0)
    other_items = {
        "stationery":           float(inp.get("stationery",           0) or 0),
        "electricity_water":    float(inp.get("electricity_water",    0) or 0),
        "repair_maintenance":   float(inp.get("repair_maintenance",   0) or 0),
        "transport_conveyance": float(inp.get("transport_conveyance", 0) or 0),
        "telephone_internet":   float(inp.get("telephone_internet",   0) or 0),
        "miscellaneous":        float(inp.get("miscellaneous",        0) or 0),
    }
    other_var_raw    = sum(other_items.values())
    other_var_target = max(variable_total - cogs - marketing, 0)
    other_scale      = (other_var_target / other_var_raw) if other_var_raw else 1

    return {
        "rent": rent, "salary": salary, "fixed_total": fixed_total,
        "cogs": cogs, "marketing": marketing, "variable_total": variable_total,
        "total_monthly_exp": float(cma.get("total_monthly_exp", 0) or 0),
        **{k: v * other_scale for k, v in other_items.items()},
    }

def _fmt_payback(cma):
    """Return payback months as string or 'N/A' — never '0 months'."""
    if cma.get("payback_not_achievable"):
        return "N/A"
    be = cma.get("breakeven_months", 0)
    if str(be).upper() == "N/A" or not be:
        return "N/A"
    try:
        v = float(be)
        return "N/A" if v <= 0 else str(round(v, 1))
    except Exception:
        return "N/A"

def _display_risk_matrix(industry: str) -> list:
    """Industry-specific displayed risks only; does not affect calculations."""
    key = str(industry or "manufacturing").lower()
    if key in ("service", "services"):
        return [
            {"category": "Client Payment Delays", "description": "Delayed collections may stretch working capital and EMI servicing.", "probability": "Medium", "impact": "High", "net_risk": "High"},
            {"category": "Customer Churn", "description": "Loss of recurring clients can reduce monthly billing visibility.", "probability": "Medium", "impact": "Medium", "net_risk": "Medium"},
            {"category": "Pricing Pressure", "description": "Competitive quotations may compress service margins.", "probability": "Medium", "impact": "Medium", "net_risk": "Medium"},
            {"category": "Manpower Dependency", "description": "Delivery quality depends on skilled staff availability and retention.", "probability": "Medium", "impact": "High", "net_risk": "High"},
            {"category": "Technology Obsolescence", "description": "Tools, software, or service platforms may require periodic upgrades.", "probability": "Low", "impact": "Medium", "net_risk": "Medium"},
            {"category": "GST / Compliance", "description": "Invoice, GST return, and TDS compliance delays may affect receivables.", "probability": "Low", "impact": "Medium", "net_risk": "Medium"},
        ]
    if key == "trading":
        return [
            {"category": "Inventory Obsolescence", "description": "Slow-moving stock may require discounting or write-downs.", "probability": "Medium", "impact": "High", "net_risk": "High"},
            {"category": "Stock Shrinkage", "description": "Pilferage, expiry, or storage losses can reduce gross margin.", "probability": "Medium", "impact": "Medium", "net_risk": "Medium"},
            {"category": "Supplier Dependency", "description": "Concentration with few suppliers can disrupt availability and pricing.", "probability": "Medium", "impact": "Medium", "net_risk": "Medium"},
            {"category": "Demand Fluctuation", "description": "Seasonality or local demand changes may affect turnover.", "probability": "Medium", "impact": "Medium", "net_risk": "Medium"},
            {"category": "Price Competition", "description": "Local competitors or online sellers may pressure selling prices.", "probability": "High", "impact": "Medium", "net_risk": "High"},
        ]
    return [
        {"category": "Raw Material Volatility", "description": "Input price movement can affect gross margin and cash cycle.", "probability": "Medium", "impact": "High", "net_risk": "High"},
        {"category": "Machine Breakdown", "description": "Equipment downtime can interrupt production and dispatches.", "probability": "Medium", "impact": "High", "net_risk": "High"},
        {"category": "WIP Delays", "description": "Longer processing cycle may increase working capital requirement.", "probability": "Medium", "impact": "Medium", "net_risk": "Medium"},
        {"category": "Production Disruption", "description": "Power, labour, or supply disruption may reduce capacity utilisation.", "probability": "Medium", "impact": "High", "net_risk": "High"},
        {"category": "Quality Failures", "description": "Rejection, rework, or warranty claims can reduce profitability.", "probability": "Low", "impact": "High", "net_risk": "Medium"},
    ]

def _scheme_advisory(inp: dict, cma: dict) -> str:
    scheme = str(inp.get("scheme", "")).lower()
    promoter_pct = float(cma.get("promoter_pct", 0) or 0)
    if "pmegp" in scheme:
        return "PMEGP advisory: verify eligible project-cost limit, category-wise promoter margin, and subsidy/TDR lock-in with DIC/KVIC before bank submission."
    if "mudra" in scheme:
        return "Mudra advisory: ensure loan amount fits the selected Shishu/Kishor/Tarun/TarunPlus band and the activity is non-farm micro enterprise."
    if "cgtmse" in scheme or "msme" in scheme:
        return "CGTMSE/PSU advisory: confirm Udyam registration, collateral-free eligibility, guarantee cover, and bank-specific promoter margin norms."
    if promoter_pct < 10:
        return "Margin advisory: promoter contribution appears below common MSME comfort levels; bank may request higher margin or support."
    return "Scheme advisory: final eligibility, margin, and guarantee treatment remain subject to bank and scheme guidelines."

# ── Table style builders ──────────────────────────────────────────────────────
def BTS(alt=True):
    cmds: list = [
        ("BACKGROUND",     (0,0),(-1, 0), _theme_color("accent")),
        ("TEXTCOLOR",      (0,0),(-1, 0), W),
        ("FONTNAME",       (0,0),(-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",       (0,0),(-1,-1), 8),
        ("GRID",           (0,0),(-1,-1), 0.4, GRY),
        ("TOPPADDING",     (0,0),(-1,-1), 3),
        ("BOTTOMPADDING",  (0,0),(-1,-1), 3),
        ("LEFTPADDING",    (0,0),(-1,-1), 4),
        ("RIGHTPADDING",   (0,0),(-1,-1), 4),
        ("VALIGN",         (0,0),(-1,-1), "MIDDLE"),
    ]
    if alt:
        cmds.append(("ROWBACKGROUNDS", (0,1),(-1,-1), [W, ALT]))
    return TableStyle(cmds)

def TOT(row):
    return TableStyle([
        ("FONTNAME",   (0,row),(-1,row), "Helvetica-Bold"),
        ("BACKGROUND", (0,row),(-1,row), _theme_color("light")),
    ])

def RISK_COLOR(row, level):
    # BUG FIX: _display_risk_matrix() returns "High"/"Medium"/"Low" (title
    # case), but this compared against "HIGH"/"MEDIUM" (upper case) — every
    # row silently fell through to the else branch, so no risk row was ever
    # actually colour-coded by severity.
    lvl = str(level).upper()
    bg = RED if lvl == "HIGH" else AMB if lvl == "MEDIUM" else GRN
    return TableStyle([("BACKGROUND",(0,row),(-1,row),bg)])

def SEC(title, story):
    t = Table([[Paragraph(title, ST["h1"])]], colWidths=[170*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(-1,-1), _theme_color("accent")),
        ("TOPPADDING",    (0,0),(-1,-1), 7),
        ("BOTTOMPADDING", (0,0),(-1,-1), 7),
        ("LEFTPADDING",   (0,0),(-1,-1), 8),
    ]))
    story.append(t)
    story.append(Spacer(1, 4))

def PB(story): story.append(PageBreak())

def H2(text, story):
    story.append(Paragraph(text, _theme_style("h2", "dark")))

def NL(story, h=4): story.append(Spacer(1, h))

def _box(title, story):
    """A light boxed sub-heading — used for A/B/C style groupings within a section."""
    t = Table([[Paragraph(title, _theme_style("h2", "dark"))]], colWidths=[170*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(-1,-1), _theme_color("light")),
        ("TOPPADDING",    (0,0),(-1,-1), 5),
        ("BOTTOMPADDING", (0,0),(-1,-1), 5),
        ("LEFTPADDING",   (0,0),(-1,-1), 8),
        ("BOX",           (0,0),(-1,-1), 1.2, _theme_color("accent")),
    ]))
    story.append(t)
    NL(story, 2)

# ── Main builder ──────────────────────────────────────────────────────────────
def _build_pdf_content(inp: dict, cma: dict, dpr: dict, output_path: str):
    doc = SimpleDocTemplate(
        output_path, pagesize=A4,
        leftMargin=18*mm, rightMargin=18*mm,
        topMargin=18*mm,  bottomMargin=18*mm,
    )
    story = []
    pc  = dpr["project_cost"]
    dep = dpr["depreciation"]
    mc  = dpr["machinery"]
    rm  = dpr["raw_materials"]
    man = dpr["manpower"]
    tl  = dpr["term_loan"]
    wc  = dpr["working_capital_years"]
    cop = dpr["profit_and_loss_years"]
    pbs = dpr["balance_sheet_years"]
    pcf = dpr["cash_flow_years"]
    bep = dpr["breakeven_years"]
    dscr= dpr["dscr"]
    prof= dpr["profitability"]
    ps  = dpr["project_summary"]
    primary_product = (
        inp.get("products", [{}])[0].get("category")
        if inp.get("products") else "Primary Product / Service"
    ) or "Primary Product / Service"
    # Single industry variable used by all sections for conditional labels
    _industry = str(inp.get("industry", inp.get("industry_type", "manufacturing"))).lower()
    _is_trading   = _industry == "trading"
    _is_service   = _industry == "service"
    _is_agri      = _industry in ("agriculture", "agro_processing", "agro-processing")
    _is_mfg       = not (_is_trading or _is_service or _is_agri)
    _is_trading_service = not _is_mfg
    display_total_project_cost = (
        cma.get("total_project_cost")
        or sum(float(item.get("amount", 0) or 0) for item in cma.get("project_cost_items", []))
        or pc["total_project_cost"]
    )
    display_loan_amount = cma.get("total_loan") or R(pc["term_loan"] + pc["wc_loan"], 2)
    display_promoter_fixed_equity = (
        cma.get("promoter_fixed_equity")
        or pc.get("promoter_fixed_equity")
        or pc.get("equity_capital")
        or 0
    )
    # BUG FIX: this used to be computed as just term_loan + promoter_fixed_equity,
    # silently dropping the scheme's margin-money/capital subsidy (e.g. PMEGP) —
    # money that IS part of the fixed capital outlay, just not funded by the
    # promoter's own cash or the bank. Section-B's own Means-of-Finance total
    # ("TOTAL (Fixed Project Cost)") already includes it; this must match.
    _display_margin_money = pc.get("margin_money", 0) or cma.get("margin_money", 0) or 0
    display_fixed_project_cost = R(pc["term_loan"] + display_promoter_fixed_equity + _display_margin_money, 2)
    display_promoter_wc_margin = cma.get("promoter_wc_margin") or (wc[0].get("margin", 0) if wc else 0)
    display_promoter_contribution = (
        cma.get("total_promoter_contribution")
        or cma.get("promoter_contribution")
        or pc.get("total_promoter_contribution")
        or R(display_promoter_fixed_equity + display_promoter_wc_margin, 2)
    )
    _scheme_raw   = inp.get("scheme", "MSME")
    _scheme_full  = scheme_display(_scheme_raw)
    _scheme_short = scheme_short(_scheme_raw)
    _is_pmegp  = "pmegp" in _scheme_raw.lower()
    _is_mudra  = "mudra" in _scheme_raw.lower()
    _is_cgtmse = "cgtmse" in _scheme_raw.lower()
    _subsidy_label = "Govt Subsidy — PMEGP" if _is_pmegp else "State Capital Subsidy"
    _industry_str = str(inp.get("industry", inp.get("industry_type", "Manufacturing"))).title()
    _nature_biz   = inp.get("nature_of_business", inp.get("business_description", ""))
    _promoter_name= f"{inp.get('title','').strip()} {inp.get('full_name', inp.get('entrepreneur_name',''))}".strip()
    _bank_name    = inp.get("bank_name", inp.get("preferred_bank", ""))
    _to_bank      = str(inp.get("to_bank", "") or "").strip()
    _prepared_by  = str(inp.get("prepared_by", "") or "").strip()
    ref_no = f"CMA/{_scheme_short}/{datetime.now().strftime('%Y%m')}/{str(abs(hash(inp.get('entrepreneur_name','X'))))[:6]}"

    # Single source of truth for "100%-capacity revenue" per year — it is NOT
    # constant across years (it grows with the revenue-escalation assumption,
    # independently of the capacity ramp-up), so both Section-D and Section
    # 14 must read this SAME computed list rather than each restating (or, as
    # Section-J previously did, flatly repeating) a Year-1-only figure.
    _rev100_by_year = []
    for _cy in cop:
        _cap_pct = float(_cy.get("capacity", 0) or 0)
        _cy_rev  = float(_cy.get("revenue", 0) or 0)
        _rev100_by_year.append(R(_cy_rev / _cap_pct, 2) if _cap_pct else _cy_rev)

    # WC Bank Finance Coverage (mislabeled "Current Ratio" in earlier drafts):
    # it is WC Requirement ÷ WC Bank Finance — how many times the assessed WC
    # requirement is the arranged WC bank facility, NOT Total Current Assets
    # ÷ Total Current Liabilities. Kept under its old key too for safety.
    _wc_bank_coverage = float(cma.get("wc_bank_finance_coverage_ratio", cma.get("current_ratio", 0)) or 0)
    # A genuine Current Ratio, computed from the actual projected Balance
    # Sheet (Year 1): Total Current Assets (WC current assets + cash, floored
    # at 0 — see Section-K) ÷ Total Current Liabilities (WC bank borrowing,
    # the only current liability this balance sheet models; the term loan is
    # carried entirely as a long-term liability).
    _bs_y1 = pbs[1] if len(pbs) > 1 else {}
    _bs_current_assets = float(_bs_y1.get("current_assets", 0) or 0) + max(float(_bs_y1.get("cash", 0) or 0), 0)
    _bs_current_liabilities = max(float(_bs_y1.get("wc_bank", 0) or 0), 1)
    _true_current_ratio = R(_bs_current_assets / _bs_current_liabilities, 2)

    # ════════════════════════════════════════════════════════════════
    # PART I — BANKER / CREDIT SUMMARY  (Sections 01-10)
    # ════════════════════════════════════════════════════════════════

    # ── SECTION 01 — COVER PAGE ────────────────────────────────────────
    NL(story, int(15*mm))
    cover = Table([
        [Paragraph("Business Loan Feasibility Report", ST["cover_title"])],
        [Paragraph("Indicative Financial Assessment Based on Applicant Inputs", _theme_style("cover_sub", "light"))],
        [Spacer(1, 6)],
        [Paragraph(f"Scheme: {_scheme_short}", _theme_style("cover_sub", "light"))],
        [Spacer(1, 4)],
        [Paragraph(f"{_promoter_name}", _theme_style("cover_sub", "light"))],
        [Paragraph(f"{inp.get('business_name','')}", ST["cover_body"])],
        [Spacer(1, 4)],
        # BUG FIX: nature_of_business is free text and used to be silently
        # truncated to 60 characters with no ellipsis — a longer sentence
        # (e.g. a full business description) got cut off mid-word with no
        # indication text was missing. This row's own Table cell auto-sizes
        # to its Paragraph's height, so it can simply wrap instead.
        [Paragraph(f"{_industry_str} | {_nature_biz if _nature_biz else 'Business Activity'}", ST["cover_body"])],
    ], colWidths=[170*mm])
    cover.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(-1,-1), _theme_color("dark")),
        ("TOPPADDING",    (0,0),(-1,-1), 10),
        ("BOTTOMPADDING", (0,0),(-1,-1), 10),
    ]))
    story.append(cover)
    NL(story, int(8*mm))

    # CA AUDIT: "No collateral required" / "Collateral-free" used to be
    # stated as flat fact for every PMEGP/Mudra/CGTMSE report, regardless
    # of the specific applicant's sanctioned exposure or the lender's own
    # policy — each of these schemes' collateral exemption is conditional
    # (loan-size thresholds, eligibility, guarantee-cover limits), not an
    # unconditional guarantee this platform can certify. Reworded to defer
    # to the financing bank's own verification, on every scheme branch.
    scheme_note = ""
    if _is_pmegp:
        mm_pct = cma.get("margin_money_pct", 0)
        mm_amt = cma.get("margin_money", 0)
        scheme_note = (f"PMEGP Subsidy: {mm_pct:.0f}% = Rs.{mm_amt:,.0f} (TDR held for 3 yrs) | "
                        "Collateral/Security: subject to applicable PMEGP guidelines, lender policy "
                        "and sanctioned exposure — to be confirmed by the financing bank")
    elif _is_mudra:
        scheme_note = ("Mudra Loan | Collateral/Security: RBI guidelines exempt collateral up to the "
                        "prescribed Mudra limit, with CGFMU guarantee cover — final requirement subject "
                        "to lender policy and sanctioned exposure")
    elif _is_cgtmse:
        scheme_note = ("CGTMSE Cover: guarantee fee applicable | Collateral/Security: subject to CGTMSE "
                        "eligibility, guarantee cover limits and lender policy — to be confirmed by the "
                        "financing bank")
    else:
        scheme_note = "Standard MSME Term Loan | Collateral/Security: subject to bank credit policy"

    scheme_note_style = ParagraphStyle(
        "scheme_notice",
        parent=ST["small"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=12,
        textColor=W,
        alignment=TA_LEFT,
    )
    scheme_banner = Table([[Paragraph(scheme_note, scheme_note_style)]], colWidths=[170*mm])
    scheme_banner.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1), _theme_color("accent")),("TEXTCOLOR",(0,0),(-1,-1), W),
        ("TOPPADDING",(0,0),(-1,-1), 5),("BOTTOMPADDING",(0,0),(-1,-1), 5),
        ("LEFTPADDING",(0,0),(-1,-1), 8),
    ]))
    story.append(scheme_banner)
    NL(story, int(6*mm))

    # BUG FIX: this value used to be truncated at 40 chars with no ellipsis
    # and no wrapping — for anything longer than that, the tail (often the
    # whole second word, e.g. "...and IT" instead of "...and IT Services")
    # was silently cut off. Wrapped in a Paragraph so the full text always
    # shows, across as many lines as it needs.
    _loan_purpose_cell = Paragraph(
        f"{_industry_str}" + (f" | {_nature_biz}" if _nature_biz else ""), ST["table_cell"]
    )
    info = Table([
        ["Field", "Details"],
        ["Applicant / Business Name", f"{_promoter_name}  —  {inp.get('business_name','')}"],
        ["Business Type / Loan Purpose", _loan_purpose_cell],
        ["Total Project Cost",   rs(display_total_project_cost)],
        ["Term Loan Requested",  rs(pc["term_loan"])],
        ["Working Capital Facility Requested", rs(R(cma.get("working_capital_loan", pc.get("wc_loan", 0)) or 0, 2))],
        ["Total Bank Exposure",  rs(display_loan_amount)],
        ["Promoter Contribution",rs(display_promoter_contribution)],
        ["Prepared By",          _prepared_by or "—"],
        ["To",                   _to_bank or "—"],
        ["Preferred Bank",       _bank_name or "As per applicant's choice"],
        ["Report Reference",     ref_no],
        ["Date Prepared",        datetime.now().strftime("%d %B %Y")],
        ["Valid Until",          f"{inp.get('report_validity_days', 120)} days from date of preparation"],
    ], colWidths=[65*mm, 105*mm])
    info.setStyle(BTS())
    story.append(info)
    NL(story, int(8*mm))
    story.append(Paragraph(
        "Preliminary financial assessment only. Final bank appraisal subject to independent verification "
        "by the financial institution. Not for public circulation. CONFIDENTIAL.", ST["small"]))
    PB(story)

    # ── SECTION 02 — EXECUTIVE CREDIT SUMMARY ──────────────────────────
    _avg_dscr_val   = float(cma.get("avg_dscr", 0) or 0)
    _annual_pat_v   = float(cma.get("annual_pat", 0) or 0)
    _annual_ebitda_v = float(cma.get("annual_ebitda", 0) or 0)
    _is_not_bankable = (
        _avg_dscr_val < 1.25
        or _annual_pat_v < 0
        or _annual_ebitda_v < 0
        or cma.get("payback_not_achievable", False)
        or "REJECT" in str(cma.get("recommendation", "")).upper()
    )
    if _is_not_bankable:
        _reasons = []
        if _avg_dscr_val < 1.25:
            _reasons.append(f"Term Loan DSCR {round(_avg_dscr_val,2)}x is below the 1.25x illustrative benchmark")
        if _annual_pat_v < 0:
            _reasons.append("Net Profit (PAT) is negative")
        if _annual_ebitda_v < 0:
            _reasons.append("EBITDA is negative — operating losses")
        if cma.get("payback_not_achievable", False):
            _reasons.append("Payback period not achievable")
        # This platform assesses viability — it does not impersonate the
        # sanctioning bank's own credit decision.
        nb_tbl = Table(
            [[Paragraph("⚠ FINANCIAL VIABILITY ASSESSMENT — HIGH RISK UNDER CURRENT ASSUMPTIONS", ST["rec_approve"])]],
            colWidths=[170*mm]
        )
        nb_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0,0),(-1,-1), colors.HexColor("#B71C1C")),
            ("TOPPADDING",    (0,0),(-1,-1), 8),
            ("BOTTOMPADDING", (0,0),(-1,-1), 8),
        ]))
        story.append(nb_tbl)
        NL(story, 3)
        story.append(Paragraph(
            "Reasons: " + " | ".join(_reasons) + ". "
            "Revise revenue projections, reduce costs, or adjust loan tenure before bank submission.",
            ST["small"]))
        NL(story, 6)
    # ════════════════════════════════════════════════════════════════════════════
    # EXECUTIVE CREDIT SUMMARY
    # ════════════════════════════════════════════════════════════════════════════

    SEC("EXECUTIVE CREDIT SUMMARY", story)

    # Neutral feasibility-assessment labels, never lending-decision language.
    _rec_raw = cma.get("recommendation", "") or ""
    _rec_display_map = {
        "APPROVED":                "MEETS VIABILITY BENCHMARKS",
        "APPROVE":                 "MEETS VIABILITY BENCHMARKS",
        "APPROVE WITH CONDITIONS": "CONDITIONALLY VIABLE — SEE CONDITIONS",
        "REFER FOR REVIEW":        "REQUIRES FURTHER REVIEW",
        "REJECT":                  "DOES NOT MEET VIABILITY BENCHMARKS",
    }
    _rec_display = str(_rec_display_map.get(_rec_raw, _rec_raw or ""))
    # CA AUDIT: a "Good"/"Strong" viability grade driven purely by DSCR/ROI
    # must not read as an unqualified pass when leverage is high (Section
    # 29's own D:E/Total Leverage benchmarks) — scorecard.py already caps
    # the Viability Grade and recommendation one notch in this case; make
    # the headline banner say so explicitly too, in the exact wording.
    if cma.get("leverage_caveat"):
        _rec_display = "FINANCIALLY VIABLE BUT HIGHLY LEVERAGED"
    rec_color = _theme_color("dark") if "VIABLE" in _rec_display or "MEETS" in _rec_display else colors.HexColor("#B71C1C")
    rec_box = Table([[Paragraph(_rec_display, ST["rec_approve"])]], colWidths=[170*mm])
    rec_box.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(-1,-1), rec_color),
        ("TOPPADDING",    (0,0),(-1,-1), 8),
        ("BOTTOMPADDING", (0,0),(-1,-1), 8),
    ]))
    story.append(rec_box)
    NL(story, 2)
    story.append(Paragraph(
        "This banner and the Viability Grade / Risk Level / Weighted Score used throughout this report "
        "are model-derived indicators computed from the stated assumptions — they are not a bank "
        "sanction rating, credit grade, or lending decision. The sanctioning bank's own credit "
        "appraisal governs any actual lending decision.",
        ST["small"]))
    NL(story, 5)

    H2("Project & Funding Snapshot", story)
    _exec_wc_loan   = R(cma.get("working_capital_loan", pc.get("wc_loan", 0)) or 0, 2)
    _exec_wc_margin = R(float(wc[0].get("margin", 0) if wc else 0), 2)
    _exec_wc_total  = R(_exec_wc_margin + _exec_wc_loan, 2)
    snap = Table([
        ["Particular", "Amount / Value", "Particular", "Amount / Value"],
        ["Total Project Cost",          rs(display_total_project_cost), "Fixed Project Cost", rs(display_fixed_project_cost)],
        ["Working Capital Requirement", rs(_exec_wc_total),             "Promoter Contribution", rs(display_promoter_contribution)],
        ["Term Loan",                   rs(pc["term_loan"]),            "Working Capital Finance", rs(_exec_wc_loan)],
        ["Total Bank Exposure",         rs(display_loan_amount),        "Proposed Tenure", f"{inp.get('loan_tenure_years',5)} years"],
        ["Moratorium",                  f"{int(inp.get('moratorium_months', inp.get('moratorium_years', 0) * 12) or 0)} months", "Interest Rate", rp(tl.get("interest_rate", inp.get("term_loan_interest",0)))],
    ], colWidths=[45*mm,40*mm,45*mm,40*mm])
    snap.setStyle(BTS())
    story.append(snap)
    NL(story, 5)

    H2("Financial Snapshot (Year 1 → Year 5)", story)
    fin_snap = Table(
        [["Metric"] + [f"Year {i+1}" for i in range(5)]] +
        [
            ["Revenue (Rs.)"]      + [r(cy["revenue"])       for cy in cop],
            ["EBITDA (Rs.)"]       + [r(cy.get("ebitda", 0)) for cy in cop],
            ["PAT (Rs.)"]          + [r(cy["net_profit"])    for cy in cop],
            ["Term Loan DSCR"]     + [str(d["dscr"])         for d in dscr["years"]],
        ],
        colWidths=[35*mm]+[27*mm]*5
    )
    fin_snap.setStyle(BTS())
    story.append(fin_snap)
    NL(story, 3)
    story.append(Paragraph(
        f"<b>Average Term Loan DSCR:</b> {cma.get('avg_dscr', dscr['average'])}  |  "
        f"<b>Current Ratio (Balance Sheet Basis):</b> {r2(_true_current_ratio)}  |  "
        f"<b>WC Bank Finance Coverage:</b> {r2(_wc_bank_coverage)}x  |  "
        f"<b>Term Loan D:E:</b> {round(pc['term_loan'] / max(display_promoter_fixed_equity, 1), 2) if display_promoter_fixed_equity else 0} : 1  |  "
        f"<b>Promoter % of Initial Investment:</b> {pof(display_promoter_contribution, display_total_project_cost)}  |  "
        f"<b>Payback Period (cumulative cash-flow, Section-N):</b> " + ("Not achievable under current projections" if (cma.get("payback_not_achievable") or str(cma.get("breakeven_months","")).upper()=="N/A" or float(cma.get("breakeven_months",0) if isinstance(cma.get("breakeven_months"),(int,float)) else 0)==0) else f"within {round(float(cma.get('breakeven_months',0)),1)} months"),
        ST["small"]))
    NL(story, 5)

    H2("Credit Assessment", story)
    _obs_dscr_bench   = float(cma.get("dscr_benchmark", 1.25) or 1.25)
    _obs_avg_dscr     = float(cma.get("avg_dscr", dscr["average"]) or 0)
    _obs_annual_pat   = float(cma.get("annual_pat", 0) or 0)
    strengths, weaknesses = [], []
    if display_promoter_contribution > 0.1 * display_total_project_cost:
        strengths.append(f"Promoter contribution represents {pof(display_promoter_contribution, display_total_project_cost)} of initial project investment.")
    _wc_coverage_val = float(cma.get("wc_bank_finance_coverage_ratio", cma.get("current_ratio", 0)) or 0)
    if _wc_coverage_val > 0:
        _wc_bank_share_pct = round(100 / _wc_coverage_val, 1) if _wc_coverage_val else 0
        strengths.append(
            f"Working Capital Bank Finance Coverage of {r2(_wc_coverage_val)}x — the assessed WC "
            f"requirement is {r2(_wc_coverage_val)}x the arranged WC bank facility (WC bank finance "
            f"funds {_wc_bank_share_pct}% of the requirement; the promoter's WC margin funds the remainder)."
        )
    if float(man.get("promoter_annual", 0) or 0) <= 0:
        weaknesses.append("Promoter remuneration not considered — profitability may be overstated.")
    # CA AUDIT: promoter_drawings_pct (Section-L's Cash Flow "Less:
    # Promoter Drawings" row) defaults to 0% — PAT is fully retained with
    # no assumed personal withdrawal. That's a real, silent assumption:
    # for an owner-operated business the promoter/partners almost always
    # draw SOME funds for personal living expenses, so Reserves and
    # Closing Cash in this report will run higher than a scenario with a
    # realistic drawings assumption. Surfaced explicitly rather than left
    # as an unstated default.
    _drawings_pct = float(inp.get("promoter_drawings_pct", 0) or 0)
    if _drawings_pct <= 0:
        weaknesses.append(
            "Promoter Drawings assumption is 0% (Section-L) — PAT is projected as fully retained with "
            "no personal withdrawal assumed. If the promoter/partners actually draw funds for personal "
            "use, Reserves and Closing Cash will be lower than shown; confirm the intended drawings "
            "level before relying on the projected cash position."
        )
    if _obs_avg_dscr < _obs_dscr_bench:
        weaknesses.append(f"Average Term Loan DSCR of {round(_obs_avg_dscr,2)}x is below the {_obs_dscr_bench}x illustrative benchmark.")
    if _obs_annual_pat < 0:
        weaknesses.append(f"Annual PAT is negative (Rs.{_obs_annual_pat:,.0f}) — the project is loss-making under stated assumptions.")
    if display_promoter_contribution > 0 and display_loan_amount / max(display_promoter_contribution, 1) > 3:
        weaknesses.append("Leverage is high relative to promoter contribution.")
    # CA AUDIT: existing_monthly_emi (Section-A, existing business loan) and
    # promoter_net_worth.home_loan_emi (personal home loan) are both
    # pre-existing obligations, separate from the new term loan. They are
    # excluded from the PRIMARY Term Loan DSCR above (by design — that DSCR
    # is scoped to the new term loan only, per CA/RBI convention), but ARE
    # now reflected in the "Adjusted Term Loan DSCR" table in Section-N.
    _existing_emi = float(inp.get("existing_monthly_emi", 0) or 0)
    _home_loan_emi = float((cma.get("promoter_net_worth") or {}).get("home_loan_emi", 0) or 0)
    if _existing_emi > 0 or _home_loan_emi > 0:
        _emi_parts = []
        if _existing_emi > 0:
            _emi_parts.append(f"existing business loan EMI of Rs.{_existing_emi:,.0f}/month (Section-A)")
        if _home_loan_emi > 0:
            _emi_parts.append(f"personal home loan EMI of Rs.{_home_loan_emi:,.0f}/month")
        weaknesses.append(
            "Borrower carries a " + " and a ".join(_emi_parts) + " — pre-existing obligations NOT "
            "included in the primary Term Loan DSCR above (scoped to the new term loan only). See "
            f"'Adjusted Term Loan DSCR' in Section-N (average {dscr.get('average_adjusted_dscr', dscr.get('average', 0))}x) "
            "for debt-service capacity after ALL known obligations."
        )
    _funding_gap_total = sum(float(pb.get("short_term_funding", 0) or 0) for pb in pbs[1:] if float(pb.get("short_term_funding", 0) or 0) > 0)
    if not strengths:
        strengths.append("No specific strengths identified under current assumptions — revenue and cost assumptions should be revisited.")
    for s_ in strengths:
        story.append(Paragraph(f"• <b>Strength:</b> {s_}", ST["bullet"]))
    for w_ in weaknesses:
        story.append(Paragraph(f"• <b>Weakness/Risk:</b> {w_}", ST["bullet"]))
    if _funding_gap_total > 0:
        story.append(Paragraph(
            f"• <b>Funding Gap:</b> the model shows an unfunded cash shortfall building up to "
            f"Rs.{max(float(pb.get('short_term_funding',0) or 0) for pb in pbs[1:]):,.0f} by Year 5 "
            "(see Section-K, Balance Sheet — shown as \"Additional Funding Required\", not an arranged facility).",
            ST["bullet"]))
    story.append(Paragraph(
        f"• <b>Overall Assessment:</b> Viability Grade <b>{cma['credit_rating']}</b>, Risk Level <b>{cma['risk_level']}</b>. "
        + ("This is currently a high-risk proposal that should not be submitted without revising assumptions." if _is_not_bankable
           else "This proposal meets the platform's illustrative viability benchmarks."),
        ST["bullet"]))
    if cma.get("leverage_caveat"):
        story.append(Paragraph(
            f"• <b>Leverage Caveat:</b> {cma['leverage_caveat']}. Term Loan D:E "
            f"({cma.get('scorecard_de_ratio', 'N/A')} : 1) and/or Total Leverage "
            f"({cma.get('scorecard_total_leverage', 'N/A')} : 1) exceed this platform's own "
            f"&lt;2:1 / &lt;3:1 benchmarks (Section-U) — the Viability Grade above has already been "
            f"capped one notch to reflect this; it is not a bare pass on DSCR/ROI alone.",
            ST["bullet"]))
    story.append(Paragraph(_scheme_advisory(inp, cma), ST["bullet"]))
    NL(story, 3)
    story.append(Paragraph(
        "<i>Note: the above assessment is derived mechanically from the financial data and assumptions "
        "provided — it is not a substitute for a qualified CA's or the sanctioning bank's own appraisal.</i>",
        ST["small"]))
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # 1 / SECTION-A — APPLICANT & BUSINESS PROFILE
    # ════════════════════════════════════════════════════════════════════════════

    # ── SECTION 04 — APPLICANT & BUSINESS PROFILE ──────────────────────
    # (Includes the promoter's own profile — the input model carries a
    # single applicant/promoter, so a separate "Promoter Profile" page
    # would only restate these same fields; kept as one section instead
    # of an empty duplicate.)
    SEC("1 / SECTION-A: APPLICANT & BUSINESS PROFILE", story)

    H2("A1. Personal / Promoter Profile", story)
    appl = Table([
        ["Field","Details","Field","Details"],
        ["Full Name",      inp.get("full_name",""),          "Father's Name",   inp.get("fathers_name","")],
        ["Date of Birth",  inp.get("date_of_birth",""),      "Gender",          inp.get("gender","")],
        ["Education",      inp.get("education",""),          "Social Category", inp.get("social_category","")],
        ["PAN Number",     inp.get("pan_number",""),         "Aadhaar",         inp.get("aadhar_number","")],
        ["Mobile",         inp.get("mobile",""),             "Email",           Paragraph(inp.get("email","") or "—", ST["table_cell"])],
        ["Experience",     f"{inp.get('years_of_experience',0)} Years", "Business Status", inp.get("business_status","")],
        # BUG FIX: previous_employer/previous_role/address are free-text —
        # a real employer name (e.g. "Guntur Mirchi Yard — Commission Agent
        # Office") overflowed straight into the neighbouring "Previous
        # Role" cell since plain strings don't wrap in a ReportLab Table.
        ["Previous Employer", Paragraph(inp.get("previous_employer","") or "—", ST["table_cell"]),
         "Previous Role", Paragraph(inp.get("previous_role","") or "—", ST["table_cell"])],
        ["Address",        Paragraph(inp.get("address","") or "—", ST["table_cell"]), "", ""],
    ], colWidths=[30*mm,55*mm,30*mm,55*mm])
    appl.setStyle(BTS())
    story.append(appl)
    NL(story, 5)

    H2("A2. Business Overview", story)
    _impl_agency   = inp.get("implementing_agency", "") or ""
    _biz_status    = inp.get("business_status", "New Business")
    _biz_duration  = int(inp.get("business_duration_months", 0) or 0)
    _biz_status_str = (
        f"{_biz_status} ({_biz_duration // 12} yr {_biz_duration % 12} mo)"
        if _biz_duration > 0 else _biz_status
    )
    # BUG FIX: "Business Name" and "Nature of Business" are free-text fields
    # that can easily exceed this table's fixed 50mm Details columns —
    # ReportLab does not auto-wrap plain strings, so a longer value
    # overflowed past the table's own border. Both are Paragraph-wrapped.
    _commencement_display = inp.get("commencement_date", "") or (
        "Not yet commenced" if str(inp.get("business_status", "")).lower() == "new business" else "—"
    )
    biz = Table([
        ["Field","Details","Field","Details"],
        ["Business Name",     Paragraph(inp.get("business_name","") or "—", ST["table_cell"]),
         "Nature of Business", Paragraph(inp.get("nature_of_business","") or "—", ST["table_cell"])],
        ["Registration Type", inp.get("business_type",""),         "Industry",            str(inp.get("industry", inp.get("industry_type",""))).title()],
        ["Business Status",   _biz_status_str,                    "Location / District", location_district(inp)],
        ["Commencement Date", _commencement_display,               "Expected Employment", str(inp.get("expected_employment",0))+" persons"],
        ["Area Type",         inp.get("area_type","Rural"),        "Implementing Agency", _impl_agency or "—"],
        ["GST Number",        inp.get("gst_number","") or "—",    "MSME/Udyam No.",      inp.get("msme_number","") or "—"],
    ], colWidths=[35*mm,50*mm,35*mm,50*mm])
    biz.setStyle(BTS())
    story.append(biz)
    NL(story, 5)

    H2("A3. Product / Service Portfolio", story)
    prod_rows = [["Category / Product Description","Monthly Qty","Avg Price (Rs.)","Revenue (Rs./Mo)","Mix %"]]
    for p in cma.get("products", []):
        cat = p.get("category", "Product")
        if p.get("name") and p.get("name") != cat:
            cat = f"{cat} - {p['name']}"
        prod_rows.append([cat, r(p.get("units_per_month", 0)), r(p.get("avg_price", 0)),
                          r(p.get("monthly_revenue", 0)), rp2(p.get("mix_pct", 0))])
    if not cma.get("products"):
         prod_rows.append(["No products entered", "-", "-", "-", "-"])
    prod_rows.append(["TOTAL PORTFOLIO REVENUE","","",r(cma["gross_monthly_revenue"]),"100.0%"])
    prod_t = Table(prod_rows, colWidths=[75*mm,20*mm,22*mm,33*mm,20*mm])
    prod_t.setStyle(BTS()); prod_t.setStyle(TOT(len(prod_rows)-1))
    story.append(prod_t)
    NL(story, 6)

    _competitors = inp.get("competitors") or []
    if _competitors:
        H2("A4. Competitive Analysis", story)
        _comp_rows = [["Competitor", "Type", "Distance", "Their Strengths", "Our Advantage"]]
        for _c in _competitors:
            _name  = str(_c.get("name", "") or "")
            _type  = str(_c.get("type", "") or "")
            _dist  = str(_c.get("distance", "") or "")
            _str   = str(_c.get("strengths", "") or "")
            _weak  = str(_c.get("weaknesses", "") or "")
            if _name:
                # BUG FIX: free-text strengths/weaknesses are user-entered and
                # can run to a full sentence — plain strings don't wrap in a
                # ReportLab Table cell, so a long entry overflowed straight
                # into the next column with no visible separation.
                _comp_rows.append([
                    Paragraph(_name, ST["table_cell"]), Paragraph(_type, ST["table_cell"]),
                    Paragraph(_dist, ST["table_cell"]), Paragraph(_str, ST["table_cell"]),
                    Paragraph(_weak, ST["table_cell"]),
                ])
        if len(_comp_rows) > 1:
            _comp_t = Table(_comp_rows, colWidths=[35*mm, 22*mm, 20*mm, 45*mm, 48*mm])
            _comp_t.setStyle(BTS())
            story.append(_comp_t)
            NL(story, 4)

    H2("A5. Existing Banking & Borrowings", story)
    NL(story, 3)
    _ex_turnover = float(inp.get("existing_annual_turnover", 0) or 0)
    _ex_profit   = float(inp.get("existing_annual_profit", 0) or 0)
    _ex_emi      = float(inp.get("existing_monthly_emi", 0) or 0)
    if "existing" in str(_biz_status).lower() and (_ex_turnover or _ex_profit or _ex_emi):
        exbiz = Table([
            ["Field","Details","Field","Details"],
            ["Last FY Turnover",   f"Rs. {r(_ex_turnover)}",  "Last FY Net Profit", f"Rs. {r(_ex_profit)}"],
            ["Existing Loan EMI",  f"Rs. {r(_ex_emi)} / mo",  "Net Margin",
                (f"{(_ex_profit / _ex_turnover * 100):.1f}%" if _ex_turnover else "—")],
        ], colWidths=[35*mm,50*mm,35*mm,50*mm])
        exbiz.setStyle(BTS())
        story.append(exbiz)
    else:
        story.append(Paragraph("No existing banking facilities reported by the applicant.", ST["normal"]))
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # 2 / SECTION-B — PROJECT DETAILS
    # ════════════════════════════════════════════════════════════════════════════

    # ── SECTION 06 — PROJECT OVERVIEW ──────────────────────────────────
    SEC("2 / SECTION-B: PROJECT DETAILS", story)
    H2("B1. Project Overview", story)
    # BUG FIX: both rows below used to show/truncate free-text
    # nature_of_business as a plain string — a long business description
    # either overflowed this table's 120mm Details column or got silently
    # cut at 60 characters with no ellipsis. Paragraph-wrapped, untruncated.
    _overview_rows = [
        ["Field", "Details"],
        ["Nature of Project",   Paragraph(inp.get("nature_of_business","") or "—", ST["table_cell"])],
        ["Business Model",      Paragraph(_industry_str + (f" | {_nature_biz}" if _nature_biz else ""), ST["table_cell"])],
        ["Location",             location_district(inp)],
        ["Area Type",            inp.get("area_type", "Rural")],
        ["Capacity Schedule (Y1-Y5)", f"{rp(inp.get('capacity_y1',0.5))} / {rp(inp.get('capacity_y2',0.6))} / {rp(inp.get('capacity_y3',0.7))} / {rp(inp.get('capacity_y4',0.75))} / {rp(inp.get('capacity_y5',0.8))}"],
        ["Expected Employment",  f"{inp.get('expected_employment',0)} persons"],
    ]
    ov_t = Table(_overview_rows, colWidths=[50*mm, 120*mm])
    ov_t.setStyle(BTS())
    story.append(ov_t)

    H2("B2. Initial Project Investment", story)
    NL(story, 3)
    cost_rows = [["Sl.","Particulars","Amount (Rs.)","% of Total"]]
    for item in cma["project_cost_items"]:
        cost_rows.append([str(item["code"]), item["particulars"],
                          r(item["amount"]), pof(item["amount"], cma["total_project_cost"])])
    cost_rows.append(["","TOTAL (Initial Project Investment)", r(cma["total_project_cost"]), "100.0%"])
    cost_t = Table(cost_rows, colWidths=[10*mm,90*mm,38*mm,28*mm])
    cost_t.setStyle(BTS()); cost_t.setStyle(TOT(len(cost_rows)-1))
    story.append(cost_t)

    H2("B3. Means of Finance – Fixed Project Funding", story)
    NL(story, 3)
    _b2_margin_money = pc.get("margin_money", 0) or cma.get("margin_money", 0)
    _b2_wc_loan      = R(cma.get("working_capital_loan", pc.get("wc_loan", 0)) or 0, 2)
    _b2_wc_margin    = R(float(wc[0].get("margin", 0) if wc else 0), 2)
    _b2_wc_total     = R(_b2_wc_margin + _b2_wc_loan, 2)

    _box("A. Fixed Project Funding", story)
    if _b2_margin_money:
        _b2_promoter_cash = R(display_promoter_fixed_equity, 2)
        finance_total_a   = R(_b2_promoter_cash + _b2_margin_money + pc["term_loan"], 2)
        mof_rows = [
            ["Source","Amount (Rs.)","% of Fixed Cost"],
            ["Equity Capital (Promoter Cash)",      rs(_b2_promoter_cash),  pof(_b2_promoter_cash,  finance_total_a)],
            [f"{_subsidy_label}{' (Margin Money)' if _is_pmegp else ''}", rs(_b2_margin_money),   pof(_b2_margin_money,   finance_total_a)],
            ["Term Loan from Bank",                 rs(pc["term_loan"]),    pof(pc["term_loan"],    finance_total_a)],
            ["TOTAL (Fixed Project Cost)",           rs(finance_total_a),    "100.0%"],
        ]
        mof = Table(mof_rows, colWidths=[95*mm,45*mm,30*mm])
        mof.setStyle(BTS()); mof.setStyle(TOT(4))
    else:
        _b2_promoter_cash = display_promoter_fixed_equity
        finance_total_a   = R(display_promoter_fixed_equity + pc["term_loan"], 2)
        mof_rows = [
            ["Source","Amount (Rs.)","% of Fixed Cost"],
            ["Equity Capital (Promoter)",       rs(display_promoter_fixed_equity), pof(display_promoter_fixed_equity, finance_total_a)],
            ["Term Loan from Bank",             rs(pc["term_loan"]),               pof(pc["term_loan"],               finance_total_a)],
            ["TOTAL (Fixed Project Cost)",      rs(finance_total_a),               "100.0%"],
        ]
        mof = Table(mof_rows, colWidths=[95*mm,45*mm,30*mm])
        mof.setStyle(BTS()); mof.setStyle(TOT(3))
    story.append(mof)
    NL(story, 5)

    if _b2_wc_total > 0:
        _box("B. Working Capital Funding", story)
        wc_fin_rows = [
            ["Source","Amount (Rs.)","% of WC Reqd."],
            ["Promoter WC Margin",   rs(_b2_wc_margin), pof(_b2_wc_margin, _b2_wc_total) if _b2_wc_total else "0.0%"],
            ["WC Bank Finance",      rs(_b2_wc_loan),   pof(_b2_wc_loan,   _b2_wc_total) if _b2_wc_total else "0.0%"],
            ["TOTAL WC",             rs(_b2_wc_total),  "100.0%"],
        ]
        wc_fin = Table(wc_fin_rows, colWidths=[70*mm,55*mm,45*mm])
        wc_fin.setStyle(BTS()); wc_fin.setStyle(TOT(3))
        story.append(wc_fin)
        NL(story, 2)
        story.append(Paragraph(
            "Working Capital Bank Finance is a revolving operational facility and is not included in fixed project cost.",
            ST["small"]))
        NL(story, 5)

        _box("C. Overall Funding", story)
        _total_bank_exp = pc["term_loan"] + _b2_wc_loan
        _total_funding  = display_promoter_contribution + _total_bank_exp + _b2_margin_money
        exp_rows = [
            ["Source",                              "Amount (Rs.)"],
            ["Total Promoter Funding",              rs(display_promoter_contribution)],
            ["Total Bank Funding",                  rs(_total_bank_exp)],
            ["Other Funding (Subsidy/TDR)",         rs(_b2_margin_money)],
            ["TOTAL FUNDING (Fixed Cost + Total WC Requirement)", rs(_total_funding)],
            ["Funding Gap (Arranged Sources)",       rs(0)],
        ]
        exp_t = Table(exp_rows, colWidths=[100*mm,70*mm])
        exp_t.setStyle(BTS()); exp_t.setStyle(TOT(4))
        story.append(exp_t)
        NL(story, 3)
        story.append(Paragraph(
            f"\"Funding Gap (Arranged Sources)\" is Rs.0 by construction — every rupee of Fixed Cost and "
            "WC Requirement above is funded by the sources listed. If the business subsequently runs a "
            "cash deficit from operating losses, that shows up as \"Additional Funding Required\" in the "
            "Balance Sheet (Section-K) and as a negative Closing Cash Balance in the Cash Flow Statement "
            "(Section-L) — it is a separate, operational shortfall, not a gap in the initial funding plan.",
            ST["small"]))
        NL(story, 2)
        story.append(Paragraph(
            f"<b>Note:</b> TOTAL FUNDING here (Rs.{_total_funding:,.0f}) is larger than \"Total Project Cost\" "
            f"shown on the cover page and in Section-B (Rs.{display_total_project_cost:,.0f}) by exactly the "
            f"WC Bank Finance amount (Rs.{_b2_wc_loan:,.0f}) — \"Total Project Cost\" deliberately excludes the "
            "WC bank loan (a revolving facility, not part of fixed project cost), while this total includes it "
            "since it covers the full WC Requirement, bank-funded portion included.",
            ST["small"]))
    NL(story, 5)
    _tl_de  = round(pc["term_loan"] / max(display_promoter_fixed_equity, 1), 2) if display_promoter_fixed_equity else 0
    _tot_de = round((pc["term_loan"] + _b2_wc_loan) / max(display_promoter_contribution, 1), 2) if display_promoter_contribution else 0
    story.append(Paragraph(
        f"<b>D:E (TL ÷ Promoter Fixed Equity): {_tl_de} : 1</b>"
        f" &nbsp;&nbsp;|&nbsp;&nbsp; "
        f"<b>Total Leverage ((TL + WC Bank) ÷ Total Promoter): {_tot_de} : 1</b>",
        ST["bold"]))
    story.append(Paragraph(
        "Formula: Term Loan D:E = TL / promoter fixed equity. "
        "Total leverage = total debt / total promoter contribution.",
        ST["small"]))
    if _b2_margin_money and _is_pmegp:
        NL(story, 3)
        story.append(Paragraph(
            f"<b>Margin Money Note:</b> Margin Money of Rs.{_b2_margin_money:,.0f} is held as TDR "
            "for 3 years as per PMEGP guidelines. "
            "Interest is charged on the full outstanding balance during the lock-in period.",
            ST["small"]))
    elif _b2_margin_money:
        NL(story, 3)
        # CA AUDIT: the exact accounting treatment of a government/state
        # capital subsidy (credited to Capital Reserve? Deferred Income?
        # netted against the asset's cost?) depends on the specific
        # scheme's own conditions and the applicable accounting framework
        # (e.g. Ind AS 20 / AS 12) — this platform cannot determine that
        # universally, so it must not assert one treatment as settled fact.
        story.append(Paragraph(
            f"<b>Subsidy Note:</b> State capital subsidy of Rs.{_b2_margin_money:,.0f} on fixed assets "
            "is treated here as a source of finance for project-cost purposes, reducing the amount split "
            "between promoter and bank. This treatment is <b>indicative</b> and subject to the specific "
            "subsidy scheme's own guidelines and the applicable accounting framework — whether it should "
            "be credited to Capital Reserve, Deferred Income, or adjusted against the relevant asset's "
            "cost is a determination for the sanction documentation and the applicant's CA, not this "
            "platform.",
            ST["small"]))
        _subsidy_scheme_details = str(inp.get("capital_subsidy_scheme_details", "") or "").strip()
        if _subsidy_scheme_details:
            NL(story, 2)
            story.append(Paragraph(
                f"<b>Subsidy Scheme Details:</b> {_subsidy_scheme_details}",
                ST["small"]))
        else:
            NL(story, 2)
            story.append(Paragraph(
                "<b>Subsidy Scheme Details:</b> not provided — for an actual bank submission, the "
                "scheme name, sanction order no., sanction date, eligible amount, and any conditions "
                "attached to the grant should be documented here.",
                ST["small"]))

    H2("B4. Working Capital Requirement — Assessment", story)
    NL(story, 3)
    _stock_days   = inp.get("stock_holding_days", inp.get("wc_raw_material_days", 30))
    _wip_days     = inp.get("wip_days",           inp.get("wc_wip_days", 15))
    _fg_days      = inp.get("fg_days",            inp.get("wc_finished_goods_days", 30))
    _debtor_days  = inp.get("debtor_days",        30)
    _creditor_days= inp.get("creditor_days",      15)

    def _wc(w, *keys):
        """Return first non-None numeric value found for the given key sequence."""
        for key in keys:
            val = w.get(key)
            if val is not None:
                try:
                    return float(val)
                except (TypeError, ValueError):
                    pass
        return 0.0

    _wc_industry   = str(inp.get("industry", inp.get("industry_type", "manufacturing"))).lower()
    _is_trading_wc = _wc_industry == "trading"
    _is_service_wc = _wc_industry in ("service", "services")
    _is_mfg_wc     = not (_is_trading_wc or _is_service_wc)
    _wc_rows = [["Particulars", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5"]]
    if _is_service_wc:
        _wc_rows += [
            [f"Receivables ({_debtor_days} day client billing cycle)"] + [r(_wc(w, "debtors")) for w in wc],
            ["Salary Float (30 days payroll)"]                         + [r(_wc(w, "salary_float")) for w in wc],
            ["Expense Float (30 days operating cost)"]                 + [r(_wc(w, "expense_float")) for w in wc],
            ["Cash Reserve (15 days operating buffer)"]                + [r(_wc(w, "cash_reserve")) for w in wc],
        ]
    else:
        _stock_label = "Stock of Goods" if _is_trading_wc else "Raw Material Stock"
        _wc_rows.append([f"{_stock_label} ({_stock_days} days)"] + [r(_wc(w, "rm_stock", "rm_wc", "stock")) for w in wc])
    if _is_mfg_wc:
        _wc_rows.append([f"Work in Progress ({_wip_days} days)"] + [r(_wc(w, "wip", "wip_wc")) for w in wc])
        _wc_rows.append([f"Finished Goods ({_fg_days} days)"]    + [r(_wc(w, "fg", "fg_wc"))   for w in wc])
    if not _is_service_wc:
        _wc_rows += [
            [f"Debtors ({_debtor_days} days)"] + [r(_wc(w, "debtors")) for w in wc],
            ["Less: Creditors"]               + [r(_wc(w, "creditors")) for w in wc],
        ]
    _wc_rows.append(["Total WC Required"] + [r(w["total"]) for w in wc])
    _wc_total_row_idx = len(_wc_rows) - 1
    wc_t = Table(_wc_rows, colWidths=[62*mm] + [21.6*mm] * 5)
    wc_t.setStyle(BTS())
    wc_t.setStyle(TOT(_wc_total_row_idx))
    story.append(wc_t)
    if _is_service_wc:
        NL(story, 3)
        story.append(Paragraph(
            "Service WC uses receivables, salary float, expense float, and cash reserve. "
            "Manufacturing/trading inventory norms are intentionally excluded.",
            ST["small"]))
    NL(story, 3)
    story.append(Paragraph(
        "<b>Note:</b> The holding-period assumptions above (stock, WIP, finished goods, debtor and "
        "creditor days) are applicant-provided / model assumptions specific to this project, not "
        "universal banking norms — they should be validated against the actual production and "
        "collection cycle before bank submission, and revised if the real cycle differs.",
        ST["small"]))

    H2("Working Capital Financing", story)
    NL(story, 3)
    wcfin_rows = [["Particulars", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5"]]
    wcfin_rows.append(["Total WC Requirement"]    + [r(w["total"]) for w in wc])
    wcfin_rows.append(["WC Margin (Promoter's Share)"] + [r(w["margin"]) for w in wc])
    wcfin_rows.append(["Bank WC Loan"]            + [r(w["bank_loan"]) for w in wc])
    wcfin_rows.append(["Margin %"]                + [pof(w["margin"], w["total"]) for w in wc])
    wcfin_rows.append(["Bank Finance %"]          + [pof(w["bank_loan"], w["total"]) for w in wc])
    wcfin_rows.append(["WC Interest"]             + [r(w["wc_interest"]) for w in wc])
    wcfin_t = Table(wcfin_rows, colWidths=[62*mm] + [21.6*mm] * 5)
    wcfin_t.setStyle(BTS()); wcfin_t.setStyle(TOT(1))
    story.append(wcfin_t)
    NL(story, 3)
    story.append(Paragraph(
        f"<b>Note:</b> WC Bank Loan (Rs. {wc[0]['bank_loan']:,.0f}) is a revolving credit facility -- "
        "not part of project cost. Renewed annually based on utilisation. This facility is separate "
        "from the term loan (Section-H) and is not amortised.",
        ST["small"]))

    H2("Working Capital Cycle", story)
    NL(story, 3)
    _cycle_flow = (
        "Service Delivery → Customer Billing → Receivables → Collection → Cash. "
        "Inventory assumptions are not used for this service business — see Section-B."
        if _is_service_wc else
        "Purchases → Inventory → Sales → Receivables → Cash, financed against Supplier Credit → Payables."
    )
    story.append(Paragraph(_cycle_flow, ST["normal"]))
    NL(story, 4)
    _cycle_rows = [["Component", "Days"]]
    if not _is_service_wc:
        _cycle_rows.append(["Stock / Inventory Holding Days", str(_stock_days)])
    if _is_mfg_wc:
        _cycle_rows.append(["Work-in-Progress Days", str(_wip_days)])
        _cycle_rows.append(["Finished Goods Holding Days", str(_fg_days)])
    _cycle_rows.append(["Receivable / Debtor Days", str(_debtor_days)])
    # CA AUDIT: Section-B's own WC model for a SERVICE business never
    # includes a Creditors/Payables line (there is no inventory purchased
    # on supplier credit) — but this section used to always show
    # "Less: Creditor/Payable Days" and net it against Receivable Days
    # regardless, producing a Net Operating Cycle netted against a
    # creditor figure that has no corresponding Rs. amount anywhere in
    # Section-B. Only show/net creditor days for non-service (mfg/trading)
    # businesses, where Section-B actually models a "Less: Creditors" Rs.
    # line — keeping both sections on the same WC model.
    if not _is_service_wc:
        _cycle_rows.append(["Less: Creditor / Payable Days", f"-{_creditor_days}"])
    _net_cycle = (
        (0 if _is_service_wc else int(_stock_days))
        + (int(_wip_days) + int(_fg_days) if _is_mfg_wc else 0)
        + int(_debtor_days) - (0 if _is_service_wc else int(_creditor_days))
    )
    _cycle_rows.append(["NET OPERATING CYCLE (Days)" if not _is_service_wc else "Operating (Receivable) Cycle (Days)", str(_net_cycle)])
    cycle_t = Table(_cycle_rows, colWidths=[130*mm, 40*mm])
    cycle_t.setStyle(BTS()); cycle_t.setStyle(TOT(len(_cycle_rows)-1))
    story.append(cycle_t)
    if _is_service_wc:
        NL(story, 3)
        story.append(Paragraph(
            "<b>Note:</b> This is a service business — the operating cycle above reflects only the "
            f"{_debtor_days}-day receivable/client-billing cycle used in Section-B. Inventory and "
            "trade-creditor cycles are not separately modelled for this business type (there is no "
            "stock purchased on supplier credit to net against).",
            ST["small"]))

    H2("B5. Promoter Contribution & Net Worth", story)
    NL(story, 3)
    # Three different % figures, each on a different denominator, were
    # previously all labelled "Promoter Contribution %" — labelled distinctly
    # here so a banker never has to guess which base a given % is measured against.
    # BUG FIX: this used to independently recompute "term_loan + promoter_
    # fixed_equity", the exact same bug already fixed for the Executive Credit Summary's
    # "Fixed Project Cost" — silently excluding the scheme's margin-money/
    # capital subsidy. Reuse display_fixed_project_cost (which already
    # includes it) instead of re-deriving a second, disagreeing figure.
    _pc_fixed_project_cost   = display_fixed_project_cost
    _pc_wc_requirement_total = float(wc[0].get("total", 0)) if wc else 0.0
    _pc_total_funding_reqd   = R(_pc_fixed_project_cost + _pc_wc_requirement_total, 2)
    _pc_promoter_share_total_funding = round(display_promoter_contribution / _pc_total_funding_reqd * 100, 1) if _pc_total_funding_reqd else 0
    pcontrib = Table([
        ["Particular", "Amount / %"],
        ["Fixed Project Promoter Contribution",  rs(display_promoter_fixed_equity)],
        ["Promoter WC Margin",                    rs(display_promoter_wc_margin)],
        ["Total Promoter Contribution",           rs(display_promoter_contribution)],
        ["Fixed Project Promoter Contribution % (÷ Fixed Project Cost)", rp2(cma["promoter_pct"])],
        ["Total Initial Investment Promoter Contribution % (÷ Initial Project Investment)", pof(display_promoter_contribution, display_total_project_cost)],
        ["Total Funding Requirement Promoter Share % (÷ Fixed Cost + Total WC Requirement)", rp2(_pc_promoter_share_total_funding)],
    ], colWidths=[130*mm, 40*mm])
    pcontrib.setStyle(BTS()); pcontrib.setStyle(TOT(3))
    story.append(pcontrib)
    NL(story, 5)

    pnw = cma.get("promoter_net_worth", {})
    if pnw and any(float(v or 0) > 0 for v in pnw.values()):
        H2("Promoter Net Worth Statement", story)
        _res_prop  = float(pnw.get("residential_property", 0) or 0)
        _fd        = float(pnw.get("fixed_deposits", 0) or 0)
        _savings   = float(pnw.get("savings_account", 0) or 0)
        _mf        = float(pnw.get("mutual_funds", 0) or 0)
        _hl_out    = float(pnw.get("home_loan_outstanding", 0) or 0)
        _hl_emi    = float(pnw.get("home_loan_emi", 0) or 0)
        _gross_nw  = _res_prop + _fd + _savings + _mf
        _net_nw    = _gross_nw - _hl_out
        nw_t = Table([
            ["Asset / Liability", "Amount (Rs.)", "Remarks"],
            ["Residential Property",      rs(_res_prop),  "Market value"],
            ["Fixed Deposits / NSC",      rs(_fd),        "Bank / Post Office"],
            ["Savings Account Balance",   rs(_savings),   "Current balance"],
            ["Mutual Funds / Investments",rs(_mf),        "At current NAV"],
            ["GROSS ASSETS",              rs(_gross_nw),  ""],
            ["Less: Home Loan Outstanding",rs(_hl_out),   f"EMI: Rs.{_hl_emi:,.0f}/month" if _hl_emi else ""],
            ["NET WORTH",                 rs(_net_nw),    "Available as additional security"],
        ], colWidths=[80*mm, 50*mm, 40*mm])
        nw_t.setStyle(BTS())
        nw_t.setStyle(TOT(5))
        nw_t.setStyle(TOT(7))
        story.append(nw_t)
        NL(story, 3)
        story.append(Paragraph(
            f"Promoter's net worth of Rs.{_net_nw:,.0f} provides additional comfort to the lending institution.",
            ST["small"]))

    H2("B6. Loan Proposal / Credit Structure", story)
    NL(story, 3)
    _morat_mo = inp.get("moratorium_months", inp.get("moratorium_years", 0) * 12)
    _morat_str = f"{_morat_mo} Month(s)" if _morat_mo > 0 else "None"
    H2("A. Term Loan", story)
    tl_prop = Table([
        ["Parameter","Value","Parameter","Value"],
        ["Amount",              rs(tl["amount"]),               "Purpose",           "Fixed Capital Expenditure"],
        ["Interest Rate",       rp(tl["interest_rate"]),         "Moratorium",        _morat_str],
        ["Repayment Frequency", "Half-yearly (reducing balance)", "Tenure",           f"{inp.get('loan_tenure_years',5)} Years"],
        # BUG FIX: this figure is the PRINCIPAL-only half-yearly repayment
        # (term_loan / repayment half-years, per calculations/loan_schedule.py)
        # — labelling it a bare "Instalment" reads as the full cash amount
        # payable each half-year, when the actual instalment is this plus
        # that period's own interest (shown per-period in Section-H's
        # schedule below, since interest declines as the balance amortises).
        ["Half-Yearly Principal Repayment", rs(tl["half_yearly_instalment"]), "Total Interest", rs(tl["total_interest"])],
    ], colWidths=[42*mm,43*mm,42*mm,43*mm])
    tl_prop.setStyle(BTS())
    story.append(tl_prop)
    NL(story, 3)
    # CA AUDIT: the half-yearly repayment schedule can only skip WHOLE
    # half-yearly instalments, so a moratorium not entered as a multiple of
    # 6 months (e.g. 9 months) is rounded to the nearest half-year — here
    # that is transparently disclosed, rather than the requested figure
    # being shown next to a schedule that actually applied a different one.
    _morat_requested = int(inp.get("moratorium_months_requested", _morat_mo) or 0)
    if _morat_requested != _morat_mo:
        story.append(Paragraph(
            f"<i>Note: {_morat_requested} month(s) moratorium was requested. The half-yearly repayment "
            f"schedule can only skip whole half-yearly instalments, so this has been rounded to the "
            f"nearest half-year — {_morat_mo} month(s) — which is the figure applied in the schedule "
            f"below and used throughout this report.</i>",
            ST["small"]))
        NL(story, 2)

    H2("B. Working Capital Facility", story)
    wc_prop = Table([
        ["Parameter","Value","Parameter","Value"],
        ["WC Requirement (Year 1)", rs(wc[0]["total"]) if wc else "—", "Facility Type", "Cash Credit / Overdraft (Revolving)"],
        ["Promoter WC Margin",      rs(_exec_wc_margin),               "Bank WC Finance", rs(_exec_wc_loan)],
    ], colWidths=[42*mm,43*mm,42*mm,43*mm])
    wc_prop.setStyle(BTS())
    story.append(wc_prop)
    NL(story, 3)
    story.append(Paragraph(
        "Working Capital Finance is a revolving operational facility, renewed annually based on "
        "utilisation, and is not part of the fixed project cost.",
        ST["small"]))

    H2("B7. Key Financial Assumptions", story)
    NL(story, 3)
    _assump_rows = [
        ["Assumption","Value","Assumption","Value"],
        # BUG FIX: this showed the raw term_loan_pct ASSUMPTION (e.g. 75%)
        # even for schemes with a capital subsidy, where that rate is
        # applied to the fixed cost NET of subsidy, not the gross Fixed
        # Project Cost shown elsewhere on this same page — a reader
        # checking Term Loan (Section-B) ÷ Fixed Project Cost (the Executive Credit Summary)
        # would get a different, lower %. Now derives the actual effective
        # rate directly, so it always matches what a reader can verify.
        ["Contingency Rate",         rp(inp.get("contingency_rate",0)),  "Term Loan % (of Fixed Cost)", rp(tl["amount"] / max(display_fixed_project_cost, 1))],
        ["WC Loan %",                rp(inp["wc_loan_pct"]),              "Term Loan Interest",   rp(inp["term_loan_interest"])],
        ["WC Interest Rate",         rp(inp["wc_interest_rate"]),         "Annual Salary Hike",   rp(inp["salary_increase_rate"])],
        ["Admin Expense Increase",   rp(inp["admin_increase_rate"]),      "Marketing % of Rev",   rp(inp["marketing_expense_pct"])],
        ["Building Dep (WDV)",       rp(inp["building_dep_rate_wdv"]),    "Asset Dep (WDV)" if _is_service else "Machinery Dep (WDV)", rp(inp["machinery_dep_rate_wdv"])],
        ["Revenue Growth (Escalation)", rp2(inp["revenue_growth_pct"]),   "Salary Hike (Escalation)", rp2(inp["salary_increase_pct"])],
    ]
    if _is_service:
        _assump_rows += [
            ["Client Billing Cycle", f"{inp['debtor_days']} days", "Cash Reserve", "30 days"],
            ["Expense Float", "30 days", "Tax Rate", rp2(inp["tax_rate_pct"])],
        ]
    else:
        _assump_rows += [
            ["Stock Holding Days",       str(inp["stock_holding_days"]),      "Debtor Days",          str(inp["debtor_days"])],
            ["Creditor Days",            str(inp["creditor_days"]),           "Tax Rate",             rp2(inp["tax_rate_pct"])],
        ]
        if str(inp.get("industry", inp.get("industry_type","manufacturing"))).lower() not in ("trading", "service", "services"):
            _assump_rows.append(["WIP Holding Days", str(inp.get("wip_days", 15)), "Finished Goods Days", str(inp.get("fg_days", 30))])
    _assump_rows.append([
        "Capacity Schedule (Y1-Y5)",
        f"{round(inp.get('capacity_y1',0.50)*100)}% / {round(inp.get('capacity_y2',0.60)*100)}% / {round(inp.get('capacity_y3',0.70)*100)}%",
        "Capacity (Y4-Y5)",
        f"{round(inp.get('capacity_y4',0.75)*100)}% / {round(inp.get('capacity_y5',0.80)*100)}%",
    ])
    assump = Table(_assump_rows, colWidths=[55*mm,30*mm,55*mm,30*mm])
    assump.setStyle(BTS())
    story.append(assump)
    NL(story, 3)
    # CA AUDIT: neither the WDV rates nor the tax rate above are statutory —
    # both are this platform's illustrative CMA-projection assumptions, and
    # presenting either as a mandatory/statutory figure is inaccurate.
    _biz_type_str = str(inp.get("business_type", "") or "").strip()
    _prop_note = (
        f" The applicant's constitution is <b>{_biz_type_str}</b> — a Proprietorship is taxed at the "
        "proprietor's own individual income-tax slab rates (not a flat rate), so the effective rate "
        "actually applicable may differ materially from the illustrative rate above."
        if _biz_type_str.lower() == "proprietorship" else
        f" The applicant's constitution is <b>{_biz_type_str}</b>; the applicable tax treatment for this "
        "constitution should be independently confirmed."
        if _biz_type_str else ""
    )
    story.append(Paragraph(
        f"<b>Note:</b> Tax Rate ({rp2(inp['tax_rate_pct'])}) is an <b>illustrative effective-tax assumption</b> "
        f"for this CMA projection, not a statutory rate.{_prop_note} Depreciation rates above (WDV) are this "
        "platform's generic projection assumption, kept deliberately separate from Companies Act Schedule II "
        "depreciation and Income Tax Act depreciation (each has its own, different rates and block-of-assets "
        "rules) — actual tax depreciation must be computed separately per the applicable Income Tax provisions.",
        ST["small"]))
    PB(story)


    # ════════════════════════════════════════════════════════════════════════════
    # 3 / SECTION-D — PRODUCTION PARAMETERS & MANUFACTURING SCHEDULE
    # ════════════════════════════════════════════════════════════════════════════
    # ════════════════════════════════════════════════════════════════
    # SECTION 11 — CAPACITY & REVENUE PROJECTION
    # ════════════════════════════════════════════════════════════════
    _sec11_title = (
        "3 / SECTION-D: SALES MODEL & CAPACITY / REVENUE PROJECTION" if _is_trading else
        "3 / SECTION-D: SERVICE REVENUE MODEL & CAPACITY / REVENUE PROJECTION" if _is_service else
        "3 / SECTION-D: PRODUCTION PARAMETERS & CAPACITY / REVENUE PROJECTION"
    )
    SEC(_sec11_title, story)

    if _is_trading_service:
        H2("D1. Operating Parameters", story)
        if _is_service:
            _d1_rows = [
                ["Parameter","Value","Unit"],
                ["Service Revenue Model", "Client/project billing (see Section-A, A3)", ""],
                ["Client Billing Cycle",  f"{inp.get('debtor_days', 30)} days", "Collection"],
                ["Hours of Operation / Day", str(inp["hours_of_operation"]), "Hours"],
                ["Annual Revenue (100% Cap, Year 1)", rs(ps["revenue_at_100pct"]), "Rs."],
            ]
        else:
            _d1_rows = [
                ["Parameter","Value","Unit"],
                ["Working Days per Year",     r(inp["working_days_per_year"]),  "Days"],
                ["Annual Revenue (100% Cap, Year 1)", rs(ps["revenue_at_100pct"]),      "Rs."],
                ["Revenue Model",             "Revenue-based (see Section-A, A3 for product details)", ""],
            ]
        prod_params = Table(_d1_rows, colWidths=[90*mm,55*mm,20*mm])
        prod_params.setStyle(BTS())
        story.append(prod_params)
        NL(story, 5)

        # CA AUDIT: renamed from "Annual Sales Realization (Year 1, at 100%
        # Capacity)" — a reviewer read that as implying the Year-1 actual
        # projected figure itself was the 100%-capacity figure. This table
        # is, and only ever was, the TRUE 100%-installed-capacity revenue;
        # the distinct Year-1-at-actual-capacity figure is called out
        # explicitly, separately, right after the per-year table below.
        H2("Annual Revenue at 100% Installed Capacity", story)
        products = inp.get("products_list") or cma.get("products") or []
        if _industry == "trading" and products and len(products) > 0 and products[0].get("category") != "Products/Services":
            # Header cells are Paragraph-wrapped, not plain strings — ReportLab
            # does not auto-wrap plain strings, so headers this long would
            # otherwise overflow past the page edge (as would a long product
            # name in the first column).
            _tr_hdr_style = _s("tr_hdr", fontSize=7.5, alignment=TA_CENTER, fontName="Helvetica-Bold", textColor=W, leading=9)
            sales_rows = [[Paragraph(h, _tr_hdr_style) for h in
                           ["Product Name", "Purchase Price", "Selling Price", "Qty/Month",
                            "Annual Revenue (Rs.)", "Annual COGS (Rs.)", "Annual Gross Profit (Rs.)"]]]
            # Entered units_per_month is the Year-1 (current-capacity) MONTHLY
            # quantity — scale it up to the true 100%-capacity annual total
            # (ps["revenue_at_100pct"], the same figure shown above and in the
            # per-year table below) so this table's total matches the header
            # it sits under, instead of silently showing an un-annualised,
            # un-scaled "Total per Month" figure labelled "Annual ... at 100%
            # Capacity".
            total_rev_y1 = sum(p.get("units_per_month", 0) * p.get("avg_price", 0) * 12 for p in products)
            total_rev_100pct = float(ps.get("revenue_at_100pct", 0) or 0) or total_rev_y1
            scale = (total_rev_100pct / total_rev_y1) if total_rev_y1 else 1
            tot_rev = 0
            tot_cogs = 0
            for p in products:
                qty_100 = p.get("units_per_month", 0) * scale
                sp = p.get("avg_price", 0)
                pp = p.get("purchase_price", 0)
                rev = qty_100 * sp * 12
                cogs = qty_100 * pp * 12
                gp = rev - cogs
                tot_rev += rev
                tot_cogs += cogs
                sales_rows.append([Paragraph(p.get("category", "Product"), ST["table_cell"]), r(pp), r(sp), r(qty_100), r(rev), r(cogs), r(gp)])
            sales_rows.append(["Total at 100% Capacity", "", "", "", r(tot_rev), r(tot_cogs), r(tot_rev - tot_cogs)])
            sales_t = Table(sales_rows, colWidths=[32*mm, 20*mm, 20*mm, 18*mm, 28*mm, 26*mm, 26*mm])
            sales_t.setStyle(BTS()); sales_t.setStyle(TOT(len(sales_rows)-1))
        else:
            sales_rows = [["Product / Service Category","Annual Revenue (Rs.)","% Mix"]]
            if products and len(products) > 0 and products[0].get("category") and products[0].get("category") != "Products/Services":
                # Entered monthly_revenue is the Year-1 (current-capacity) figure, not
                # 100%-capacity — scale every row to ps["revenue_at_100pct"] (the same
                # figure used above and in the P&L) so this table's total is never a
                # separate, silently-different basis.
                total_rev_y1 = sum(p.get("monthly_revenue", 0) * 12 for p in products)
                total_rev_100pct = float(ps.get("revenue_at_100pct", 0) or 0) or total_rev_y1
                scale = (total_rev_100pct / total_rev_y1) if total_rev_y1 else 1
                for p in products:
                    ann_rev_y1 = p.get("monthly_revenue", 0) * 12
                    # BUG FIX: product name/category can be long free text
                    # (e.g. a full nature-of-business sentence used as the
                    # synthetic fallback product's category) — plain
                    # strings don't wrap in a ReportLab Table, so this
                    # overflowed straight into the neighbouring columns.
                    name = Paragraph(p.get("name") or p.get("category") or "Product", ST["table_cell"])
                    mix = (ann_rev_y1 / total_rev_y1 * 100) if total_rev_y1 else 0
                    sales_rows.append([name, r(ann_rev_y1 * scale), rp2(mix)])
                sales_rows.append(["Total at 100% Capacity (Year 1)", r(total_rev_100pct), "100.0%"])
            else:
                sales_rows.append([Paragraph(primary_product, ST["table_cell"]), r(ps["revenue_at_100pct"]), "100.0%"])
                sales_rows.append(["Total at 100% Capacity (Year 1)", r(ps["revenue_at_100pct"]), "100.0%"])
            sales_t = Table(sales_rows, colWidths=[90*mm,50*mm,30*mm])
            sales_t.setStyle(BTS()); sales_t.setStyle(TOT(len(sales_rows)-1))
        story.append(sales_t)
        NL(story, 5)
        # 100%-capacity revenue is NOT constant across years — it grows with the
        # revenue-escalation assumption, independently of the capacity ramp-up.
        # Shown as an explicit per-year table (not just a note) so it's visibly
        # clear that a later year's revenue can exceed the Year-1 100%-capacity
        # figure even at a lower stated capacity %.
        story.append(Paragraph(
            "<b>Revenue Build-Up:</b> 100%-capacity revenue grows with the revenue escalation assumption "
            f"({rp2(inp.get('revenue_growth_pct', 0))}/year, Section-B), independently of the capacity "
            "ramp-up below.",
            ST["small"]))
        NL(story, 3)
        _cap_rows = [["Year", "100% Capacity Revenue (Rs.)", "Capacity %", "Projected Revenue (Rs.)"]]
        for _i, _cy in enumerate(cop):
            _cap_pct = float(_cy.get("capacity", 0) or 0)
            _cy_rev  = float(_cy.get("revenue", 0) or 0)
            _cap_rows.append([str(_cy.get("year", "")), r(_rev100_by_year[_i]), rp(_cap_pct), r(_cy_rev)])
        _cap_t = Table(_cap_rows, colWidths=[20*mm, 55*mm, 30*mm, 55*mm])
        _cap_t.setStyle(BTS())
        story.append(_cap_t)
        NL(story, 3)
        # CA AUDIT: state both Year-1 figures explicitly, side by side — see
        # the identical note in the manufacturing/agriculture branch below.
        if cop:
            _y1_cap_pct = float(cop[0].get("capacity", 0) or 0)
            _y1_proj_rev = float(cop[0].get("revenue", 0) or 0)
            story.append(Paragraph(
                f"<b>True Year 1, 100% Capacity Revenue = {rs(_rev100_by_year[0])}</b>  |  "
                f"<b>Year 1 Projected Revenue at {rp(_y1_cap_pct)} Capacity = {rs(_y1_proj_rev)}</b> "
                "— these are two different figures; the second is NOT the 100%-capacity figure.",
                ST["small"]))
    else:
        # Manufacturing / Agriculture: full production parameters
        H2("D1. Production Parameters", story)
        prod_params = Table([
            ["Parameter","Value","Unit"],
            ["Working Days per Year",    r(inp["working_days_per_year"]),   "Days"],
            ["Input Quantity / Day",     r(inp["fresh_leaves_per_day_kg"]), "Units"],
            ["Finished Output Yield",    rp(inp["yield_rate"]),             ""],
            ["Annual Output",            r(ps["annual_production_kg"]),     "Units"],
            ["Hours of Operation / Day", str(inp["hours_of_operation"]),    "Hours"],
            ["Average Selling Price",    rs(inp["selling_price_per_kg"]),   "Rs./Unit"],
        ], colWidths=[90*mm,45*mm,30*mm])
        prod_params.setStyle(BTS())
        story.append(prod_params)
        NL(story, 5)

        # CA AUDIT: renamed from "Annual Sales Realization (Year 1, at 100%
        # Capacity)" — a reviewer read that as implying the Year-1 actual
        # projected figure itself was the 100%-capacity figure. This table
        # is, and only ever was, the TRUE 100%-installed-capacity revenue;
        # the distinct Year-1-at-actual-capacity figure is called out
        # explicitly, separately, right after the per-year table below.
        H2("Annual Revenue at 100% Installed Capacity", story)
        products = inp.get("products_list") or cma.get("products") or []
        if products and len(products) > 0 and products[0].get("category") and products[0].get("category") != "Products/Services":
            sales_rows = [["Product","Price (Rs./Unit)","Quantity/Month","Annual Revenue (Rs.)"]]
            # Entered units_per_month is the Year-1 (current-capacity) figure, not
            # 100%-capacity — scale every row's quantity up to ps["annual_production_kg"]
            # (the same 100%-capacity figure used in Production Parameters above and in
            # the per-year table below) so this table's total is never a separate,
            # silently-different basis than the header it sits under.
            total_rev_y1 = sum(p.get("units_per_month", 0) * p.get("avg_price", p.get("selling_price", 0)) * 12 for p in products)
            total_rev_100pct = float(ps.get("revenue_at_100pct", 0) or 0) or total_rev_y1
            scale = (total_rev_100pct / total_rev_y1) if total_rev_y1 else 1
            total_rev = 0
            for p in products:
                qty_100 = p.get("units_per_month", 0) * scale
                sp = p.get("avg_price", p.get("selling_price", 0))
                ann_rev = qty_100 * sp * 12
                total_rev += ann_rev
                # BUG FIX: same overflow risk as the trading/service branch
                # above — a long free-text category (e.g. the synthetic
                # fallback product's nature-of-business sentence) overflows
                # an un-wrapped plain string straight into the price/qty
                # columns.
                name = Paragraph(p.get("name") or p.get("category") or "Product", ST["table_cell"])
                sales_rows.append([name, r(sp), r(qty_100), r(ann_rev)])
            sales_rows.append(["Total at 100% Capacity", "", "", r(total_rev)])
            sales_t = Table(sales_rows, colWidths=[65*mm,35*mm,35*mm,35*mm])
            sales_t.setStyle(BTS()); sales_t.setStyle(TOT(len(sales_rows)-1))
        else:
            sales_t = Table([
                ["Product","Price (Rs./Unit)","Quantity (Units)","Revenue (Rs.)"],
                [Paragraph(primary_product, ST["table_cell"]), r(inp.get("selling_price_per_kg", 0)), r(ps.get("annual_production_kg", 0)), r(ps.get("revenue_at_100pct", 0))],
                ["Total at 100% Capacity","","",r(ps.get("revenue_at_100pct", 0))],
            ], colWidths=[65*mm,35*mm,35*mm,35*mm])
            sales_t.setStyle(BTS()); sales_t.setStyle(TOT(2))
        story.append(sales_t)
        NL(story, 5)
        story.append(Paragraph(
            "<b>Revenue Build-Up:</b> 100%-capacity revenue grows with the revenue escalation assumption "
            f"({rp2(inp.get('revenue_growth_pct', 0))}/year, Section-B), independently of the capacity "
            "ramp-up below.",
            ST["small"]))
        NL(story, 3)
        _cap_rows = [["Year", "100% Capacity Revenue (Rs.)", "Capacity %", "Projected Revenue (Rs.)"]]
        for _i, _cy in enumerate(cop):
            _cap_rows.append([str(_cy.get("year", "")), r(_rev100_by_year[_i]), rp(float(_cy.get("capacity", 0) or 0)), r(_cy.get("revenue", 0))])
        _cap_t = Table(_cap_rows, colWidths=[20*mm, 55*mm, 30*mm, 55*mm])
        _cap_t.setStyle(BTS())
        story.append(_cap_t)
        NL(story, 3)
        # CA AUDIT: a reviewer read "Annual Sales Realization (Year 1, at
        # 100% Capacity)" as claiming the Year-1 ACTUAL projected figure
        # (at whatever capacity % Year 1 runs at) was itself the 100%-
        # capacity figure. State both explicitly, side by side, so there is
        # no reading in which they could be conflated.
        if cop:
            _y1_cap_pct = float(cop[0].get("capacity", 0) or 0)
            _y1_proj_rev = float(cop[0].get("revenue", 0) or 0)
            story.append(Paragraph(
                f"<b>True Year 1, 100% Capacity Revenue = {rs(_rev100_by_year[0])}</b>  |  "
                f"<b>Year 1 Projected Revenue at {rp(_y1_cap_pct)} Capacity = {rs(_y1_proj_rev)}</b> "
                "— these are two different figures; the second is NOT the 100%-capacity figure.",
                ST["small"]))

    H2("Cost of Operations", story)
    NL(story, 3)
    if _is_trading_service:
        H2("Direct Cost Structure", story)
        if _industry == "trading":
            story.append(Paragraph(
                "Purchase cost (COGS) is calculated based on the exact purchase price and mix "
                "of the individual trading products specified in the business model.",
                ST["normal"]))
        else:
            gm_val = float(cma.get("gross_margin_pct") or inp.get("gross_margin_pct") or 30)
            _cogs_pct = round(100 - gm_val, 1)
            if _is_service:
                story.append(Paragraph(
                    f"Direct service delivery cost is estimated at {_cogs_pct}% of service revenue. "
                    "Inventory assumptions are not used for service working capital.",
                    ST["normal"]))
            else:
                story.append(Paragraph(
                    f"Direct cost is estimated at {_cogs_pct}% of sales revenue based on "
                    f"calculated margins for this {_industry.capitalize()} business.",
                    ST["normal"]))
    else:
        H2("D3. Raw Materials & Consumables Cost (100% Capacity)", story)
        if rm.get("items"):
            rm_rows = [["Sl.","Item","Rate (Rs.)","Qty / Year","Cost (Rs.)"]]
            for i, item in enumerate(rm["items"]):
                rm_rows.append([str(i+1), item.get("name","Material"), r(item.get("unit_price",0)), r(item.get("annual_qty",0)), r(item.get("total_cost",0))])
            rm_rows.append(["","TOTAL","","",r(rm["total"])])
        else:
            # BUG FIX: "Consumables" and "Packing Material" are legacy rows
            # from a specific (leaf/tea-style) business model — for the
            # generic single-rate raw_material_cost_per_unit model used by
            # most businesses, generator.py always hardcodes both to 0
            # (never populated), so every such report showed two phantom
            # "Rs.0" rows with no meaning. Only show them when they
            # actually carry a nonzero cost.
            rm_rows = [["Sl.","Item","Rate (Rs.)","Qty / Year","Cost (Rs.)"],
                       ["1","Raw Material & Consumables", r(inp.get("cost_fresh_leaves_per_kg",0)),  r(rm.get("annual_leaves_qty",0)),       r(rm.get("leaves_cost",0))]]
            if float(rm.get("consumables_cost", 0) or 0) > 0:
                rm_rows.append([str(len(rm_rows)),"Consumables",      str(inp.get("cost_consumables_per_kg",0)), r(rm.get("annual_leaves_qty",0)),       r(rm.get("consumables_cost",0))])
            if float(rm.get("bottles_cost", 0) or 0) > 0:
                rm_rows.append([str(len(rm_rows)),"Packing Material", str(inp.get("cost_pet_bottle",0)),         r(ps.get("annual_production_kg",0)/10), r(rm.get("bottles_cost",0))])
            rm_rows.append(["","TOTAL","","",r(rm["total"])])
        rm_t = Table(rm_rows, colWidths=[10*mm,70*mm,28*mm,28*mm,30*mm])
        rm_t.setStyle(BTS()); rm_t.setStyle(TOT(len(rm_rows)-1))
        story.append(rm_t)
        _prim_rm   = inp.get("primary_raw_material", "")
        _rm_supp   = inp.get("raw_material_supplier", "")
        if _prim_rm or _rm_supp:
            NL(story, 3)
            _rm_note = []
            if _prim_rm: _rm_note.append(f"Primary Raw Material: <b>{_prim_rm}</b>")
            if _rm_supp: _rm_note.append(f"Supplier: <b>{_rm_supp}</b>")
            story.append(Paragraph("  |  ".join(_rm_note), ST["small"]))
    NL(story, 6)

    H2("Gross Profit (Year 1 → Year 5)", story)
    gp_rows = [["Particulars"] + [f"Year {cy['year']}" for cy in cop]]
    gp_rows.append(["Sales Revenue"] + [r(cy["revenue"]) for cy in cop])
    gp_rows.append(["Less: Direct Cost"] + [r(cy["raw_materials"]) for cy in cop])
    gp_rows.append(["GROSS PROFIT"] + [r(cy["revenue"] - cy["raw_materials"]) for cy in cop])
    gp_t = Table(gp_rows, colWidths=[40*mm]+[26*mm]*5)
    gp_t.setStyle(BTS()); gp_t.setStyle(TOT(3))
    story.append(gp_t)

    _sec19_title = (
        "D4. Shop Equipment, Fixtures & Interiors"    if _is_trading else
        "D4. Office Infrastructure & Service Setup"    if _is_service else
        "D4. Agricultural Equipment & Infrastructure"  if _is_agri   else
        "D4. Fixed Asset Schedule (Plant, Machinery & Equipment)"
    )
    H2(_sec19_title, story)
    _cont_pct = inp.get("contingency_rate", 0)
    _cont_item_word = "fixture/fitting" if _is_trading else ("equipment" if _is_service else "machinery")
    _cont_note = (
        f"{rp(_cont_pct)} loading/fitting charges applied on {_cont_item_word} items."
        if _cont_pct > 0 else
        f"No loading or fitting charges applied on {_cont_item_word} items."
    )
    story.append(Paragraph(f"Note: {_cont_note}", ST["small"]))
    NL(story, 3)
    mach_rows = [["Sl.","Description","Qty","Unit Price (Rs.)","Total (Rs.)"]]
    for i,m in enumerate(mc["items"]):
        # Paragraph-wrapped defensively — this column is wide enough for most
        # names, but a real user-entered machine name is unbounded free text.
        mach_rows.append([str(i+1), Paragraph(m["name"], ST["table_cell"]), str(m["qty"]), r(m["unit_price"]), r(m["total"])])
    mach_rows.append(["","TOTAL","","",r(mc["total"])])
    mach_t = Table(mach_rows, colWidths=[10*mm,85*mm,12*mm,35*mm,28*mm])
    mach_t.setStyle(BTS()); mach_t.setStyle(TOT(len(mach_rows)-1))
    story.append(mach_t)
    NL(story, 4)

    _supplier_rows = [["Sl.","Equipment / Asset","Supplier Name","City","Contact"]]
    for i, m in enumerate(mc["items"]):
        _sname = str(m.get("supplier_name", "") or "")
        _scity = str(m.get("supplier_city", "") or "")
        _sph   = str(m.get("supplier_phone", "") or "")
        if _sname or _scity or _sph:
            # BUG FIX: a real equipment name (e.g. "Automatic Jar Rinsing,
            # Filling & Capping Machine") easily exceeds this column's
            # width — plain strings don't wrap in a ReportLab Table, so it
            # overflowed straight into the Supplier Name column.
            _supplier_rows.append([str(i+1), Paragraph(m["name"], ST["table_cell"]), Paragraph(_sname or "—", ST["table_cell"]), _scity or "—", _sph or "—"])
    if len(_supplier_rows) > 1:
        story.append(Paragraph("Supplier / Vendor Reference (Banks require quotations for items above Rs. 50,000)", ST["small"]))
        NL(story, 2)
        _sup_t = Table(_supplier_rows, colWidths=[8*mm,55*mm,45*mm,27*mm,32*mm])
        _sup_t.setStyle(BTS())
        story.append(_sup_t)
        NL(story, 2)
        story.append(Paragraph(
            "<b>Note:</b> Vendor/supplier details above are indicative, as provided by the applicant, "
            "and are not verified quotations. Actual supplier quotations, proforma invoices and any "
            "bank-approved vendor documentation must be submitted separately before sanction.",
            ST["small"]))
        NL(story, 4)

    H2("Gross Block", story)
    _dep_building_label = (
        "Shop / Showroom Space"              if _is_trading else
        "Office / Service Premises"          if _is_service else
        "Farm Shed / Storage Infrastructure" if _is_agri   else
        "Building / Factory Shed"
    )
    _dep_machinery_label = (
        "Shop Equipment, Fixtures & Interiors (incl. fitting)" if _is_trading else
        "Service Equipment & Tools"                             if _is_service else
        "Agricultural Equipment & Implements"                   if _is_agri   else
        "Plant, Machinery & Equipment (incl. contingency)"
    )
    # BUG FIX: this row's "Year 1 Dep" is computed off pm_with_contingency +
    # fixtures_gross combined (calculations/depreciation.py pools P&M and
    # fixtures — computers/furniture/electrification/racks/transportation —
    # into one depreciation base at the same rate) — but the "Gross Value"
    # shown here used to be pm_with_contingency ALONE, silently omitting
    # fixtures_gross. That made the row self-contradictory (e.g. Rs.52,500
    # x 15% was displayed as Rs.127,875) even though "Total Gross Block"
    # below it already included fixtures_gross correctly.
    _dep_machinery_gross_display = R(
        dep.get("pm_with_contingency", dep["machinery_gross"]) + dep.get("fixtures_gross", 0), 2
    )
    gb_t = Table([
        ["Asset", "Gross Value (Rs.)", "Dep Rate", "Year 1 Dep (Rs.)"],
        [_dep_building_label, rs(dep["building_gross"]), rp(inp["building_dep_rate_wdv"]), rs(dep["dep_building_wdv"])],
        [_dep_machinery_label, rs(_dep_machinery_gross_display), rp(inp["machinery_dep_rate_wdv"]), rs(dep["dep_machinery_wdv"])],
        ["Total Gross Block", rs(dep["gross_block"]), "", rs(dep["total_per_year"])],
    ], colWidths=[70*mm, 40*mm, 28*mm, 32*mm])
    gb_t.setStyle(BTS()); gb_t.setStyle(TOT(3))
    story.append(gb_t)
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # SECTION-E — HR & MANPOWER
    # ════════════════════════════════════════════════════════════════════════════

    # ════════════════════════════════════════════════════════════════
    # SECTION 13 — OPERATING EXPENSES
    # ════════════════════════════════════════════════════════════════
    SEC("SECTION-E: HR & MANPOWER", story)
    H2("E1. Manpower & Wage Structure", story)
    total_staff = (man.get("num_skilled", 0) + man.get("num_semi", 0) + man.get("num_unskilled", 0))
    hr_rows = [
        ["Sl.", "Category", "Headcount", "Monthly Salary (Rs.)", "Annual Salary (Rs.)", "Annual Total (Rs.)"],
        ["1", "Promoter / Owner", "1", rs(0), rs(man.get("promoter_annual", 0)), rs(man.get("promoter_annual", 0))],
        ["2", "Skilled Worker",
         str(man.get("num_skilled", 0)),
         rs(man.get("skilled_per_annual", man.get("skilled_annual", 0)) / 12) if man.get("num_skilled", 0) else "—",
         rs(man.get("skilled_per_annual", man.get("skilled_annual", 0))),
         rs(man.get("skilled_total", 0))],
        ["3", "Semi-Skilled Worker",
         str(man.get("num_semi", 0)),
         rs(man.get("semi_skilled_per_annual", man.get("semi_skilled_annual", 0)) / 12) if man.get("num_semi", 0) else "—",
         rs(man.get("semi_skilled_per_annual", man.get("semi_skilled_annual", 0))),
         rs(man.get("semi_skilled_total", 0))],
        ["4", "Unskilled / Helper",
         str(man.get("num_unskilled", 0)),
         rs(man.get("unskilled_per_annual", man.get("unskilled_annual", 0)) / 12) if man.get("num_unskilled", 0) else "—",
         rs(man.get("unskilled_per_annual", man.get("unskilled_annual", 0))),
         rs(man.get("unskilled_total", 0))],
        ["", "PF / ESI / Benefits (10%)", "", "", "", rs(man.get("benefits", 0))],
        ["", f"TOTAL ({total_staff} staff)", "", "", "", rs(cma.get("annual_salary_total", man.get("total_wages", 0)))],
    ]
    hr_t = Table(hr_rows, colWidths=[8*mm, 42*mm, 18*mm, 28*mm, 32*mm, 32*mm])
    hr_t.setStyle(BTS())
    hr_t.setStyle(TOT(len(hr_rows) - 1))
    story.append(hr_t)
    if float(man.get("promoter_annual", 0) or 0) <= 0:
        NL(story, 3)
        story.append(Paragraph(
            "<b>Promoter remuneration not considered.</b> Profitability may be overstated because owner salary/drawings are not included as an operating cost.",
            ST["small"]))
    NL(story, 6)

    H2("E2. Operating Expenses Summary (Year 1 → Year 5)", story)
    _has_cgtmse_fee = any(float(cy.get("cgtmse_fee", 0) or 0) > 0 for cy in cop)
    opex_rows = [["Expense"] + [f"Year {cy['year']}" for cy in cop]]
    opex_rows.append(["Salary"] + [r(cma.get("annual_salary_total", cy["labour"]) if i==0 else cy["labour"]) for i,cy in enumerate(cop)])
    opex_rows.append(["Utilities / Power"] + [r(cy["power"]) for cy in cop])
    opex_rows.append(["Admin & Misc Expenses"] + [r(cy["admin_expenses"]) for cy in cop])
    opex_rows.append(["Marketing Expenses"] + [r(cy["marketing_expenses"]) for cy in cop])
    if _has_cgtmse_fee:
        opex_rows.append(["CGTMSE Guarantee Fee"] + [r(cy.get("cgtmse_fee", 0)) for cy in cop])
    _opex_total_row = len(opex_rows)
    opex_rows.append(["TOTAL OPEX"] + [
        r(cy["labour"] + cy["power"] + cy["admin_expenses"] + cy["marketing_expenses"] + cy.get("cgtmse_fee", 0))
        for cy in cop
    ])
    opex_t = Table(opex_rows, colWidths=[40*mm]+[26*mm]*5)
    opex_t.setStyle(BTS()); opex_t.setStyle(TOT(_opex_total_row))
    story.append(opex_t)
    if _has_cgtmse_fee:
        NL(story, 3)
        story.append(Paragraph(
            f"<b>CGTMSE Guarantee Fee:</b> {cma.get('cgtmse_agf_pct', 0)}% p.a. on the outstanding term loan "
            "balance (declines as the loan amortises) — an assumed CGTMSE-related guarantee fee provision, "
            "included as a fixed operating expense above, subject to applicable scheme terms and bank "
            "confirmation. The percentage is configurable and should be verified against the AGF slab "
            "actually applicable to this loan at sanction.",
            ST["small"]))
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # 4 / SECTION-K — PROJECTED BALANCE SHEET
    # ════════════════════════════════════════════════════════════════════════════
    # ════════════════════════════════════════════════════════════════
    # SECTION 24 — PROJECTED BALANCE SHEET
    # ════════════════════════════════════════════════════════════════
    _has_accumulated_losses = any(float(pb.get("reserves", 0) or 0) < 0 for pb in pbs)
    # A funding shortfall (arranged sources fall short of the cash the
    # business needs) is a real possibility once losses accumulate. It must
    # NEVER be shown as negative Cash — an asset cannot be negative — nor as
    # a fabricated liability (no such facility has actually been arranged).
    # Cash is floored at 0 for display; the shortfall itself is shown as a
    # separate, clearly-labelled "Additional Funding Required" memo BELOW
    # the table, kept out of both totals, and the whole sheet is titled
    # "Illustrative Before Additional Funding" whenever it applies.
    _additional_funding_required = [max(-float(pb.get("cash", 0) or 0), 0) + 0 for pb in pbs]
    _has_funding_shortfall = any(v > 0 for v in _additional_funding_required)
    # CA AUDIT: "Schedule III" is a Companies Act, 2013 presentation
    # framework — it applies to companies (Private Limited / OPC), not to
    # a Proprietorship, Partnership, LLP or HUF. Labelling every report
    # "Schedule III Format" regardless of constitution was inaccurate for
    # the majority of applicants on this platform.
    _is_company_constitution = any(
        t in _biz_type_str.lower() for t in ("private limited", "opc", "one person company")
    )
    _bs_format_label = "Schedule III Format" if _is_company_constitution else "Indicative CMA Format"
    _bs_title = (
        f"4 / SECTION-K: PROJECTED BALANCE SHEET (Illustrative Before Additional Funding — {_bs_format_label}, Amounts in Rs.)"
        if _has_funding_shortfall else
        f"4 / SECTION-K: PROJECTED BALANCE SHEET ({_bs_format_label}, Amounts in Rs.)"
    )
    SEC(_bs_title, story)
    _display_reserve = lambda pb: max(float(pb.get("reserves", 0) or 0), 0)
    _display_loss = lambda pb: abs(min(float(pb.get("reserves", 0) or 0), 0))
    _display_net_worth = lambda pb: (
        float(pb.get("equity", 0) or 0) + float(pb.get("promoter_wc_margin", 0) or 0) + float(pb.get("reserves", 0) or 0)
    )
    # Total Assets is recomputed here (floored cash) rather than read off
    # pb["total_assets"] (which uses the true, possibly-negative cash) —
    # this is the one deliberate exception to "read the engine's own
    # totals": it's a display-only floor, not a recalculation of any
    # underlying financial figure.
    _display_total_assets = [
        R(float(pb.get("land", 0) or 0) + float(pb.get("net_block", 0) or 0) + float(pb.get("other_assets", 0) or 0)
          + float(pb.get("current_assets", 0) or 0) + max(float(pb.get("cash", 0) or 0), 0), 2)
        for pb in pbs
    ]
    bs_rows = [
        ["Particulars","Year 0","Year 1","Year 2","Year 3","Year 4","Year 5"],
        ["I. EQUITY & LIABILITIES","","","","","",""],
        ["  (a) Owners' Funds","","","","","",""],
        ["  Equity / Promoter Capital"]  + [r(pb["equity"])                for pb in pbs],
        *(
            [["  Promoter's WC Margin"] + [r(pb.get("promoter_wc_margin", 0)) for pb in pbs]]
            if any(pb.get("promoter_wc_margin", 0) for pb in pbs) else []
        ),
        *(
            [[("  Govt Subsidy (PMEGP TDR)" if _is_pmegp else "  Govt Subsidy (Capital)")] + [r(pb.get("margin_money",0)) for pb in pbs]]
            if any(pb.get("margin_money", 0) for pb in pbs) else []
        ),
        ["  Reserves & Surplus"]         + [r(_display_reserve(pb))        for pb in pbs],
        *(
            [["  Less: Accumulated Losses"] + [r(_display_loss(pb))        for pb in pbs],
             ["  Net Worth (Equity - Losses)"] + [r(_display_net_worth(pb)) for pb in pbs]]
            if _has_accumulated_losses else []
        ),
        ["  (b) Long-Term Liabilities (Non-Current)","","","","","",""],
        ["  Term Loan (Bank)"]           + [r(pb["term_loan"])             for pb in pbs],
        ["  (c) Current Liabilities","","","","","",""],
        ["  Bank Borrowings — WC (CC/OD)"]+ [r(pb["wc_bank"])             for pb in pbs],
        ["TOTAL EQUITY & LIABILITIES"]  + [r(pb["total_liabilities"])      for pb in pbs],
        ["II. ASSETS","","","","","",""],
        ["  (a) Non-Current Assets","","","","","",""],
        ["  Land"]                       + [r(pb["land"])                  for pb in pbs],
        ["  Gross Block (Fixed Assets)"] + [r(pb["gross_block"])           for pb in pbs],
        ["  Less: Accumulated Dep."]     + [r(pb["accum_dep"])             for pb in pbs],
        ["  Net Block (NBV — WDV)"]      + [r(pb["net_block"])             for pb in pbs],
        ["  Other Long-Term Assets"]     + [r(pb["other_assets"])          for pb in pbs],
        ["  (b) Current Assets","","","","","",""],
        ["  Stock / Debtors / WC Assets"]+ [r(pb["current_assets"])        for pb in pbs],
        ["  Cash & Bank Balance"]        + [r(v) for v in [max(float(pb.get("cash", 0) or 0), 0) for pb in pbs]],
        ["TOTAL ASSETS"]                 + [r(v) for v in _display_total_assets],
    ]
    bs_t = Table(bs_rows, colWidths=[52*mm]+[19.7*mm]*6)
    bs_t.setStyle(BTS())
    total_liab_row = next((i for i, row in enumerate(bs_rows) if row[0] == "TOTAL EQUITY & LIABILITIES"), None)
    total_assets_row = next((i for i, row in enumerate(bs_rows) if row[0] == "TOTAL ASSETS"), None)
    if total_liab_row:  bs_t.setStyle(TOT(total_liab_row))
    if total_assets_row: bs_t.setStyle(TOT(total_assets_row))
    if _has_accumulated_losses:
        loss_row = next((i for i, row in enumerate(bs_rows) if row[0] == "  Less: Accumulated Losses"), None)
        nw_row = next((i for i, row in enumerate(bs_rows) if row[0] == "  Net Worth (Equity - Losses)"), None)
        if loss_row is not None:
            bs_t.setStyle(TableStyle([
                ("TEXTCOLOR", (0, loss_row), (-1, loss_row), colors.HexColor("#B71C1C")),
                ("FONTNAME",  (0, loss_row), (-1, loss_row), "Helvetica-Bold"),
            ]))
        if nw_row is not None:
            bs_t.setStyle(TOT(nw_row))
    story.append(bs_t)
    NL(story, 3)
    # CA AUDIT: "Other Long-Term Assets" is a residual (Fixed Project Cost -
    # Gross Block - Land) that mechanically includes preliminary/pre-
    # operative expenditure, held CONSTANT across all 5 years as a
    # simplifying projection assumption — it must not be read as asserting
    # that preliminary expenses are always capitalised as a permanent
    # long-term asset. Actual classification (expensed immediately per
    # AS-26/Ind AS 38, amortised over 5 years under Income Tax Act Sec 35D,
    # or otherwise) depends on the nature of the expenditure and the
    # accounting framework the applicant/CA actually applies.
    story.append(Paragraph(
        "<b>Note:</b> \"Other Long-Term Assets\" includes preliminary/pre-operative expenditure, held constant "
        "here as a projection simplification — this is not a classification opinion. Whether such expenditure "
        "is expensed immediately, amortised (e.g. over 5 years under Income Tax Act Section 35D), or otherwise "
        "treated depends on its nature and the accounting framework actually applied, and should be confirmed "
        "by a CA.",
        ST["small"]))

    if _has_funding_shortfall:
        NL(story, 4)
        H2("Memo: Additional Funding Required (Not Arranged)", story)
        story.append(Paragraph(
            "Not part of Total Assets or Total Equity & Liabilities above. This is the cash shortfall the "
            "term loan, WC bank finance, and promoter's WC margin already factored into this report do "
            "not cover — it is shown here as a memo, never as a negative asset or a fabricated liability.",
            ST["small"]))
        NL(story, 2)
        _afr_rows = [["Particulars","Year 0","Year 1","Year 2","Year 3","Year 4","Year 5"]]
        _afr_rows.append(["Additional Funding Required"] + [r(v) for v in _additional_funding_required])
        _afr_t = Table(_afr_rows, colWidths=[52*mm]+[19.7*mm]*6)
        _afr_t.setStyle(BTS())
        story.append(_afr_t)
        NL(story, 3)
        _fg_yrs = [
            f"Year {pb.get('year','?')}: Rs.{_additional_funding_required[i]:,.0f}"
            for i, pb in enumerate(pbs) if _additional_funding_required[i] > 0
        ]
        _fg_tbl = Table(
            [[Paragraph(
                "<b>Before bank submission:</b> " + " | ".join(_fg_yrs) + " of additional funding is needed "
                "beyond what this report's Means of Finance (Section-B) already arranges. Either increase "
                "promoter funding, arrange an additional CC/OD or unsecured-loan facility for this amount, "
                "or revise the revenue/cost assumptions driving the shortfall.",
                ST["small"]
            )]],
            colWidths=[170*mm]
        )
        _fg_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0,0),(-1,-1), RED),
            ("TOPPADDING",    (0,0),(-1,-1), 6),
            ("BOTTOMPADDING", (0,0),(-1,-1), 6),
            ("LEFTPADDING",   (0,0),(-1,-1), 8),
        ]))
        story.append(_fg_tbl)

    _neg_eq_yrs, _loss_yrs = [], []
    for _pb in pbs[1:]:
        _yr_num   = _pb.get("year", "?")
        _eq_total = _display_net_worth(_pb)
        _loss_amt = abs(min(float(_pb.get("reserves", 0) or 0), 0))
        if _loss_amt > 0:
            _loss_yrs.append(f"Year {_yr_num}: Accumulated Losses Rs.{_loss_amt:,.0f}")
        if _eq_total < 0:
            _neg_eq_yrs.append(f"Year {_yr_num}: Negative Net Worth Rs.{_eq_total:,.0f}")
    if _neg_eq_yrs or _loss_yrs:
        NL(story, 3)
        _cap_ero_tbl = Table(
            [[Paragraph(
                "<b>CAPITAL EROSION / ACCUMULATED LOSSES:</b> "
                + (" | ".join(_neg_eq_yrs) if _neg_eq_yrs else "Net worth remains positive, but accumulated losses are present")
                + (". " + " | ".join(_loss_yrs) if _loss_yrs else "")
                + ". The balance sheet separately presents Accumulated Losses instead of showing them as a negative liability. "
                "Revise revenue assumptions or increase promoter capital contribution before bank submission.",
                ST["small"]
            )]],
            colWidths=[170*mm]
        )
        _cap_ero_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0,0),(-1,-1), RED),
            ("TOPPADDING",    (0,0),(-1,-1), 6),
            ("BOTTOMPADDING", (0,0),(-1,-1), 6),
            ("LEFTPADDING",   (0,0),(-1,-1), 8),
        ]))
        story.append(_cap_ero_tbl)
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # 5 / SECTION-J — PROFIT & LOSS STATEMENT
    # ════════════════════════════════════════════════════════════════════════════

    # ════════════════════════════════════════════════════════════════
    # SECTION 14 — PROJECTED PROFIT & LOSS
    # ════════════════════════════════════════════════════════════════
    SEC("5 / SECTION-J: PROFIT & LOSS STATEMENT", story)
    _pl_cogs_label = (
        "Less: Purchase Cost (COGS)"          if _is_trading else
        "Less: Direct Service Delivery Cost"  if _is_service else
        "Less: COGS"
    )
    _cgtmse_fee_row = (["CGTMSE Guarantee Fee"] + [r(cy.get("cgtmse_fee", 0)) for cy in cop]) if _has_cgtmse_fee else None
    if _is_trading_service:
        pl_rows = [
            ["Particulars","Year 1","Year 2","Year 3","Year 4","Year 5"],
            ["Revenue at 100%"]       + [r(v) for v in _rev100_by_year],
            ["Capacity Utilisation"]  + [rp(cy["capacity"])          for cy in cop],
            ["Sales Revenue"]         + [r(cy["revenue"])            for cy in cop],
            [_pl_cogs_label]          + [r(cy["raw_materials"])      for cy in cop],
            ["Gross Profit"]          + [r(cy["revenue"] - cy["raw_materials"]) for cy in cop],
            ["Less: Operating Expenses", "","","","",""],
            ["Salary"]                + [r(cma.get("annual_salary_total", cy["labour"]) if i==0 else cy["labour"]) for i,cy in enumerate(cop)],
            ["Utilities / Power"]     + [r(cy["power"])              for cy in cop],
            ["Admin & Misc Expenses"] + [r(cy["admin_expenses"])     for cy in cop],
            ["Marketing Expenses"]    + [r(cy["marketing_expenses"]) for cy in cop],
        ]
        if _cgtmse_fee_row: pl_rows.append(_cgtmse_fee_row)
        _ebitda_row = len(pl_rows)
        pl_rows.append(["EBITDA"] + [r(cy.get("ebitda", 0)) for cy in cop])
        pl_rows += [
            ["Depreciation"]          + [r(cy["depreciation"])       for cy in cop],
            ["Interest on WC"]        + [r(cy["wc_interest"])        for cy in cop],
            ["Interest on Term Loan"] + [r(cy["tl_interest"])        for cy in cop],
        ]
        _total_exp_row = len(pl_rows)
        pl_rows.append(["TOTAL EXPENSES"] + [r(cy["total_expenses"]) for cy in cop])
        pl_rows += [
            ["Profit Before Tax"]     + [r(cy.get("profit_before_tax", cy["net_profit"])) for cy in cop],
            ["Less: Tax"]             + [r(cy.get("tax", 0))         for cy in cop],
        ]
        _pat_row = len(pl_rows)
        pl_rows.append(["NET PROFIT (PAT)"] + [r(cy["net_profit"]) for cy in cop])
        pl_rows.append(["Reserves & Surplus"] + [r(cy["reserves_surplus"]) for cy in cop])
        _cash_acc_row = len(pl_rows)
        pl_rows.append(["Cash Accruals"] + [r(cy["cash_accruals"]) for cy in cop])
        pl_t = Table(pl_rows, colWidths=[58*mm]+[22.4*mm]*5)
        pl_t.setStyle(BTS())
        for idx in [5, _ebitda_row, _total_exp_row, _pat_row, _cash_acc_row]: pl_t.setStyle(TOT(idx))
    else:
        pl_rows = [
            ["Particulars","Year 1","Year 2","Year 3","Year 4","Year 5"],
            ["Revenue at 100%"]             + [r(v) for v in _rev100_by_year],
            ["Capacity Utilisation"]        + [rp(cy["capacity"])                    for cy in cop],
            ["Gross Sales Revenue"]         + [r(cy["revenue"])                      for cy in cop],
            ["Less: Raw Materials / COGS"]  + [r(cy["raw_materials"])                for cy in cop],
            ["Gross Profit"]                + [r(cy.get("gross_profit", 0))          for cy in cop],
            ["Less: Utilities & Variable Exp"] + [r(cy["power"])                     for cy in cop],
            ["Less: Labour & Wages"]        + [r(cma.get("annual_salary_total", cy["labour"]) if i==0 else cy["labour"]) for i,cy in enumerate(cop)],
            ["Less: Admin & Overhead"]      + [r(cy["admin_expenses"])               for cy in cop],
            ["Less: Marketing Expenses"]    + [r(cy["marketing_expenses"])           for cy in cop],
        ]
        if _cgtmse_fee_row: pl_rows.append(_cgtmse_fee_row)
        _ebitda_row = len(pl_rows)
        pl_rows.append(["EBITDA"] + [r(cy.get("ebitda", 0)) for cy in cop])
        pl_rows += [
            ["Less: Depreciation"]          + [r(cy["depreciation"])                for cy in cop],
            ["Less: Interest on WC"]        + [r(cy["wc_interest"])                 for cy in cop],
            ["Less: Interest on Term Loan"] + [r(cy["tl_interest"])                 for cy in cop],
        ]
        _total_exp_row = len(pl_rows)
        pl_rows.append(["TOTAL EXPENSES"] + [r(cy["total_expenses"]) for cy in cop])
        pl_rows += [
            ["Profit Before Tax"]           + [r(cy.get("profit_before_tax", cy["net_profit"])) for cy in cop],
            ["Less: Tax"]                   + [r(cy.get("tax", 0))                  for cy in cop],
        ]
        _pat_row = len(pl_rows)
        pl_rows.append(["NET PROFIT (PAT)"] + [r(cy["net_profit"]) for cy in cop])
        pl_rows.append(["Reserves & Surplus"] + [r(cy["reserves_surplus"]) for cy in cop])
        _cash_acc_row = len(pl_rows)
        pl_rows.append(["Cash Accruals"] + [r(cy["cash_accruals"]) for cy in cop])
        pl_t = Table(pl_rows, colWidths=[58*mm]+[22.4*mm]*5)
        pl_t.setStyle(BTS())
        for idx in [5, _ebitda_row, _total_exp_row, _pat_row, _cash_acc_row]: pl_t.setStyle(TOT(idx))
    story.append(pl_t)

    H2("J2. Profitability & Return Analysis (Based on Year 3)", story)
    NL(story, 3)
    # "Capital Employed" (CA/ROCE convention) = Promoter Equity + Term Loan —
    # the long-term funds actually deployed — defined ONCE here and reused
    # for every return metric below and in the Assumptions & Methodology appendix's methodology table.
    # NOTE: the "Term Loan" column below is deliberately NOT total business
    # debt — Capital Employed (ROCE convention) = Promoter Equity + TERM
    # LOAN only, excluding the WC bank facility (a short-term revolving
    # facility, not part of long-term capital employed). See Section-H for
    # actual Total Debt (Term Loan + WC Bank Loan).
    # Header cells are Paragraph-wrapped, not plain strings — ReportLab does
    # NOT auto-wrap plain strings, so this longer header text would
    # otherwise overflow into the neighbouring column.
    _ref_hdr_style = _s("ref_hdr", fontSize=7.5, alignment=TA_CENTER, fontName="Helvetica-Bold", textColor=W, leading=9)
    ref_t = Table([
        [Paragraph(h, _ref_hdr_style) for h in
         ["Reference Sales (Rs.)", "Total Project Investment (Rs.)", "Promoter Equity (Rs.)",
          "Term Loan — Long-Term Debt (Rs.)", "Capital Employed (Rs.)"]],
        [r(prof["sales"]), r(prof["total_investment"]), r(prof.get("promoter_equity", 0)),
         r(prof.get("total_debt", 0)), r(prof["capital_employed"])],
    ], colWidths=[34*mm,38*mm,34*mm,30*mm,34*mm])
    ref_t.setStyle(BTS())
    story.append(ref_t)
    NL(story, 5)
    _t_capital_employed = max(prof["capital_employed"], 1)
    # Average Equity (for ROE) = average of Net Worth at the start and end of
    # Year 3 — Net Worth = Equity + Promoter WC Margin + Reserves, taken from
    # the projected Balance Sheet's own Year 2 (opening) and Year 3 (closing)
    # rows, so ROE is never computed against a static, unchanging equity
    # figure. Falls back to Promoter Equity only when Average Equity isn't
    # meaningful (zero or negative, e.g. accumulated losses have eroded it).
    # CA AUDIT: pb["equity"] is already Promoter Fixed Equity only — the
    # Government/state capital subsidy is tracked SEPARATELY in
    # pb["margin_money"] and is NEVER added in here, so this denominator
    # already excludes it. The report previously didn't say so explicitly,
    # leaving a reader to guess why ROE looked high relative to a Balance
    # Sheet that also shows the subsidy inside Owners' Funds.
    _net_worth = lambda pb: float(pb.get("equity", 0) or 0) + float(pb.get("promoter_wc_margin", 0) or 0) + float(pb.get("reserves", 0) or 0)
    _avg_equity = None
    if len(pbs) > 3:
        _avg_equity_calc = R((_net_worth(pbs[2]) + _net_worth(pbs[3])) / 2, 2)
        if _avg_equity_calc > 0:
            _avg_equity = _avg_equity_calc
    _roe_denom = _avg_equity if _avg_equity else max(prof.get("promoter_equity", 0), 1)
    _roe_basis = "Average Promoter Equity (Year 2→3, excl. Govt. Subsidy)" if _avg_equity else "Promoter Equity (Average Equity not meaningful; excl. Govt. Subsidy)"
    _pi_hdr_style = _s("pi_hdr", fontSize=7.5, alignment=TA_CENTER, fontName="Helvetica-Bold", textColor=W, leading=9)
    pi_t = Table([
        [Paragraph(h, _pi_hdr_style) for h in
         ["Metric", "Amount (Rs.)", "% of Sales", "ROCE = EBIT ÷ Capital Employed × 100",
          "ROE = PAT ÷ Avg. Promoter Equity × 100 (excl. Subsidy)", "ROI = PAT ÷ Initial Investment × 100"]],
        ["EBIT", rs(prof.get("ebit", 0)), rp2(R(prof.get("ebit", 0) / max(prof["sales"], 1) * 100, 2)),
         pof(prof.get("ebit", 0), _t_capital_employed), "—", "—"],
        ["PAT (Net Profit)", rs(prof["pat"]), rp2(prof["pat_pct_sales"]),
         "—", pof(prof['pat'], _roe_denom), pof(prof['pat'], max(prof['total_investment'],1))],
    ], colWidths=[24*mm,24*mm,18*mm,38*mm,30*mm,36*mm])
    pi_t.setStyle(BTS())
    story.append(pi_t)
    NL(story, 3)
    story.append(Paragraph(
        f"<b>ROCE</b> = EBIT ÷ Capital Employed (Promoter Equity + Term Loan) × 100 — return on all "
        "long-term funds deployed, before financing structure is considered. "
        f"<b>ROE</b> = PAT ÷ {_roe_basis} × 100 — return to the promoter specifically. "
        "<b>ROI</b> = PAT ÷ Initial Project Investment × 100. "
        "ROE/ROCE can legitimately run very high (or very negative) for a thinly-capitalised, "
        "highly-leveraged project, since a small equity base amplifies both gains and losses — "
        "a large magnitude is a leverage signal, not a calculation error.",
        ST["small"]))
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # 6 / SECTION-G — CALCULATION OF DEPRECIATION
    # ════════════════════════════════════════════════════════════════════════════

    # ════════════════════════════════════════════════════════════════
    # SECTION 20 — DEPRECIATION (WDV)
    # ════════════════════════════════════════════════════════════════
    SEC("6 / SECTION-G: CALCULATION OF DEPRECIATION (WDV METHOD)", story)
    story.append(Paragraph("<b>Selected Depreciation Method: Written Down Value (WDV)</b>", ST["bold"]))
    NL(story, 3)
    _dep_sched = dep.get("schedule") or []
    _sched_opening = [r(row["opening_wdv"]) for row in _dep_sched] or [r(dep["gross_block"])] * 5
    _sched_dep     = [r(row["depreciation"]) for row in _dep_sched] or [r(dep["total_per_year"])] * 5
    _sched_closing = [r(row["closing_wdv"]) for row in _dep_sched] or [r(dep["gross_block"])] * 5
    _accum = 0.0
    _sched_accum = []
    for row in (_dep_sched or []):
        _accum += float(row["depreciation"])
        _sched_accum.append(r(_accum))
    if not _sched_accum:
        _sched_accum = [r(dep["total_per_year"] * y) for y in range(1, 6)]
    dep_t = Table([
        ["Particulars",                "Year 1",       "Year 2",       "Year 3",       "Year 4",       "Year 5"],
        ["Opening WDV"]                 + _sched_opening,
        ["Depreciation (WDV × Rate)"]   + _sched_dep,
        ["Accumulated Depreciation"]    + _sched_accum,
        ["Closing WDV (Net Block)"]     + _sched_closing,
    ], colWidths=[60*mm] + [22*mm] * 5)
    dep_t.setStyle(BTS())
    dep_t.setStyle(TOT(4))
    story.append(dep_t)
    story.append(Paragraph(
        "WDV Method: each year's depreciation = Opening WDV × Rate; Closing WDV = Opening WDV − Depreciation, "
        "carried forward as next year's Opening WDV.",
        ST["small"]))
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # 7 / SECTION-L — PROJECTED CASH FLOW STATEMENT
    # ════════════════════════════════════════════════════════════════════════════

    # ════════════════════════════════════════════════════════════════
    # SECTION 23 — CASH FLOW STATEMENT
    # ════════════════════════════════════════════════════════════════
    SEC("7 / SECTION-L: PROJECTED CASH FLOW STATEMENT", story)
    cf_t = Table([
        ["Particulars","Year 1","Year 2","Year 3","Year 4","Year 5"],
        ["SOURCE OF FUNDS","","","","",""],
        ["Cash Accruals"]           + [r(p["cash_accruals"])      for p in pcf],
        ["Inc. in Bank Borrowings"] + [r(p["inc_wc_loan"])        for p in pcf],
        ["Inc. in Promoter's WC Margin"] + [r(p.get("inc_wc_margin", 0)) for p in pcf],
        ["Total Sources"]           + [r(p["total_sources"])       for p in pcf],
        ["USE OF FUNDS","","","","",""],
        ["Inc. in Current Assets"]  + [r(p["inc_current_assets"]) for p in pcf],
        ["Term Loan Repayment"]     + [r(p["tl_repayment"])       for p in pcf],
        ["Less: Promoter Drawings"] + [r(p.get("drawings", 0))    for p in pcf],
        ["Total Uses"]             + [r(p["total_uses"])           for p in pcf],
        ["Opening Cash Balance"]    + [r(p["opening_cash"])       for p in pcf],
        ["Surplus / Deficit"]       + [r(p["surplus"])            for p in pcf],
        ["Closing Cash Balance"]    + [r(p["closing_cash"])      for p in pcf],
    ], colWidths=[60*mm]+[22*mm]*5)
    cf_t.setStyle(BTS())
    cf_t.setStyle(TOT(5)); cf_t.setStyle(TOT(10)); cf_t.setStyle(TOT(13))
    story.append(cf_t)
    NL(story, 3)
    story.append(Paragraph(
        # A funding shortfall is never dressed up as an arranged borrowing
        # source — a negative Closing Cash Balance IS the shortfall.
        "<b>Note:</b> Closing Cash Balance is allowed to go negative when the term loan, WC bank finance, "
        "and promoter's WC margin already factored into this report don't cover the cash requirement — "
        "that negative figure IS the unarranged funding shortfall. It is deliberately not dressed up as a "
        "borrowing source above. If this figure is negative in any year, the applicant will need to "
        "either arrange additional promoter funding, secure a CC/OD or unsecured-loan enhancement, or "
        "revise the underlying revenue/cost assumptions before bank submission.",
        ST["small"]))
    PB(story)


    # ════════════════════════════════════════════════════════════════════════════
    # 8 / SECTION-H — TERM LOAN REPAYMENT & INTEREST SCHEDULE
    # ════════════════════════════════════════════════════════════════════════════

    # ════════════════════════════════════════════════════════════════
    # SECTION 21 — TERM LOAN SCHEDULE
    # ════════════════════════════════════════════════════════════════
    SEC("8 / SECTION-H: TERM LOAN REPAYMENT & INTEREST SCHEDULE", story)
    tl_meta = Table([
        ["Parameter","Value","Parameter","Value"],
        ["Term Loan Amount",       rs(tl["amount"]),              "Interest Rate",    rp(tl["interest_rate"])],
        ["Half-Yearly Principal Repayment", rs(tl["half_yearly_instalment"]),"Moratorium",    _morat_str],
        ["Total Interest Payable", rs(tl["total_interest"]),      "Loan Tenure",     f"{inp.get('loan_tenure_years',5)} Years"],
    ], colWidths=[50*mm,35*mm,50*mm,35*mm])
    tl_meta.setStyle(BTS())
    story.append(tl_meta)
    NL(story, 2)
    story.append(Paragraph(
        "<b>Note:</b> The Half-Yearly Principal Repayment above is the principal component only — the "
        "actual cash instalment payable each half-year is this amount PLUS that period's own interest "
        "(interest declines each period as the balance amortises; see the year-wise schedule below).",
        ST["small"]))
    NL(story, 3)
    tl_rows = [["Year","Opening Balance","Mid-Year Balance","Principal Repaid","Closing Balance","Interest H1","Interest H2","Total Interest"]]
    for row in tl["schedule"]:
        tl_rows.append([str(row["year"]),r(row["opening"]),r(row["mid"]),r(row["principal_repaid"]),r(row["closing"]),
                         r(row["int_h1"]),r(row["int_h2"]),r(row["total_interest"])])
    tl_t = Table(tl_rows, colWidths=[12*mm]+[22.5*mm]*7)
    tl_t.setStyle(BTS())
    story.append(tl_t)
    NL(story, 3)
    _morat_note_mo = int(inp.get("moratorium_months", inp.get("moratorium_years", 0) * 12) or 0)
    if _morat_note_mo > 0:
        story.append(Paragraph(
            f"Note: First {_morat_note_mo} month(s) are moratorium period — interest accrues but no principal repayment.",
            ST["small"]))

    H2("H2. Total Debt Schedule", story)
    NL(story, 3)
    # BUG FIX: this platform's CMA projection (P&L, DSCR, Cash Flow, Balance
    # Sheet, and the WC schedule itself) is always exactly 5 years — but a
    # Term Loan can run longer (e.g. 7 years here), and this table used to
    # keep listing TL years past Year 5 with WC Bank Loan silently shown as
    # "0", implying the working capital facility had been repaid off by
    # Year 6 — which is not true; WC simply isn't projected that far. Years
    # beyond the 5-year WC projection show "—" (not projected) instead of a
    # misleading zero, and Total Debt for those years is Term Loan only.
    _has_beyond_5yr = len(cma["yr_schedule"]) > len(wc)
    debt_rows = [["Year", "Term Loan Closing (Rs.)", "WC Bank Loan (Rs.)", "Total Debt (Rs.)"]]
    for i, y in enumerate(cma["yr_schedule"]):
        if i < len(wc):
            _wc_bank_yr = float(wc[i]["bank_loan"])
            debt_rows.append([str(y["year"]), r(y["closing_balance"]), r(_wc_bank_yr), r(y["closing_balance"] + _wc_bank_yr)])
        else:
            # CA AUDIT: showing "Rs.0*" here (Term Loan closing balance
            # happens to be 0 once fully amortised) reads as "Total Debt
            # is zero" — it isn't; the WC Bank Loan component is simply
            # unknown, not zero. A total can't be asserted when one of its
            # own components is unprojected, regardless of what the other
            # component's value happens to be.
            debt_rows.append([str(y["year"]), r(y["closing_balance"]), "— (not projected)", "Not Projected*"])
    debt_t = Table(debt_rows, colWidths=[20*mm, 45*mm, 45*mm, 35*mm])
    debt_t.setStyle(BTS())
    story.append(debt_t)
    NL(story, 3)
    _debt_note = (
        "Term Loan reduces to zero by the end of tenure (amortising facility); WC Bank Loan is a "
        "revolving facility renewed annually and does not amortise."
    )
    if _has_beyond_5yr:
        _debt_note += (
            " This platform's detailed CMA projection (P&amp;L, Balance Sheet, Cash Flow) covers 5 years; "
            "the Term Loan's own amortisation is shown beyond Year 5 for reference, but WC Bank Loan is "
            "not separately projected that far — marked with * (Total Debt cannot be stated when one of "
            "its two components, WC Bank Loan, is unprojected for that year)."
        )
    story.append(Paragraph(_debt_note, ST["small"]))
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # 9 / SECTION-M — BREAK EVEN POINT ANALYSIS
    # ════════════════════════════════════════════════════════════════════════════

    # ════════════════════════════════════════════════════════════════
    # SECTION 25 — BREAK-EVEN ANALYSIS
    # ════════════════════════════════════════════════════════════════
    SEC("9 / SECTION-M: BREAK EVEN POINT ANALYSIS", story)
    def _bep_val(b, key, na_key="bep_not_achievable"):
        if b.get(na_key):
            return "N/A"
        return r(b.get(key, 0))
    def _bep_pct_val(b, key="bep_pct", na_key="bep_not_achievable"):
        if b.get(na_key):
            return "N/A"
        return rp(b.get(key, 0))
    # CA AUDIT: "Fixed Expenses" here includes BOTH Depreciation and ALL
    # Interest (Term Loan + WC) — a bare "BEP Sales" label reads as a pure
    # OPERATING break-even to a CA/banker, when it's actually a FINANCIAL
    # break-even (the sales level needed to cover financing costs too, not
    # just operating costs). Both figures are now shown, correctly labelled,
    # so a reader isn't left guessing which one a bare "BEP" means.
    # Row labels are Paragraph-wrapped, not plain strings — several of the
    # new labels below are too long for this column at 68mm and would
    # otherwise overflow, unwrapped, straight into the Year 1 value cell
    # (ReportLab does not auto-wrap plain strings in a Table).
    _bep_lbl_style      = _s("bep_lbl",      fontSize=8.5, fontName="Helvetica",      textColor=BLK, leading=10.5)
    _bep_lbl_bold_style = _s("bep_lbl_bold", fontSize=8.5, fontName="Helvetica-Bold", textColor=BLK, leading=10.5)
    def _bep_lbl(text, bold=False):
        return Paragraph(text, _bep_lbl_bold_style if bold else _bep_lbl_style)
    bep_t = Table([
        ["Particulars","Year 1","Year 2","Year 3","Year 4","Year 5"],
        [_bep_lbl("Income from Operations")]    + [r(b["revenue"])            for b in bep],
        [_bep_lbl("Variable Expenses")]         + [r(b["variable_expenses"])  for b in bep],
        [_bep_lbl("Contribution", True)]        + [r(b["contribution"])       for b in bep],
        [_bep_lbl("Contribution Margin %")]     + [rp(b["contribution_pct"])  for b in bep],
        [_bep_lbl("Operating Fixed Expenses (incl. Dep, excl. Interest)")] + [r(b.get("operating_fixed_expenses", 0)) for b in bep],
        [_bep_lbl("Operating Break-Even Sales (Excl. Financing Costs)", True)] + [_bep_val(b, "operating_bep_sales", "operating_bep_not_achievable") for b in bep],
        [_bep_lbl("Operating BEP as % of Capacity")]                       + [_bep_pct_val(b, "operating_bep_pct", "operating_bep_not_achievable") for b in bep],
        [_bep_lbl("Financial Fixed Expenses (incl. Dep & Interest)")]      + [r(b["fixed_expenses"])     for b in bep],
        [_bep_lbl("Financial Break-Even Sales (Incl. Dep & Interest)", True)] + [_bep_val(b, "bep_sales")   for b in bep],
        [_bep_lbl("Financial BEP as % of Capacity")]                       + [_bep_pct_val(b)            for b in bep],
    ], colWidths=[68*mm]+[20.4*mm]*5)
    bep_t.setStyle(BTS())
    for _bep_idx in [3, 6, 9]: bep_t.setStyle(TOT(_bep_idx))
    story.append(bep_t)
    NL(story, 3)
    story.append(Paragraph(
        "<b>Operating Break-Even</b> is the sales level needed to cover operating costs only "
        "(variable costs + admin/labour + depreciation), before financing costs. "
        "<b>Financial Break-Even</b> additionally covers Term Loan and WC Interest — the sales "
        "level needed to service both operations AND the financing structure. Financial BEP is "
        "always ≥ Operating BEP for a project carrying any debt.",
        ST["small"]))
    if any(b.get("bep_not_achievable") or b.get("operating_bep_not_achievable") for b in bep):
        NL(story, 3)
        story.append(Paragraph(
            "<b>BEP not computable</b> in year(s) where Contribution Margin ≤ 0 — variable costs "
            "exceed revenue, so there is no sales level at which fixed costs can be covered "
            "under current assumptions.",
            ST["small"]))
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # 10 / SECTION-N — DEBT SERVICE COVERAGE RATIO
    # ════════════════════════════════════════════════════════════════════════════

    # ════════════════════════════════════════════════════════════════
    # SECTION 28 — DSCR & DEBT SERVICING
    # ════════════════════════════════════════════════════════════════
    SEC("10 / SECTION-N: DEBT SERVICE COVERAGE RATIO", story)
    dr = dscr["years"]
    dscr_t = Table([
        ["Particulars","Year 1","Year 2","Year 3","Year 4","Year 5"],
        ["(A) Cash Accruals (PAT + Dep)"] + [r(d["cash_accruals"])  for d in dr],
        ["(A) Add: Interest on TL"]       + [r(d["tl_interest"])    for d in dr],
        ["Total (A) — Numerator"]         + [r(d["total_a"])         for d in dr],
        ["(B) TL Principal Repayment"]    + [r(d["tl_repayment"])   for d in dr],
        ["(B) Add: Interest on TL"]       + [r(d["tl_interest"])    for d in dr],
        ["Total (B) — Denominator"]       + [r(d["total_b"])         for d in dr],
        ["Term Loan DSCR (A ÷ B)"]        + [str(d["dscr"])          for d in dr],
    ], colWidths=[60*mm]+[22*mm]*5)
    dscr_t.setStyle(BTS())
    for idx in [3, 6]: dscr_t.setStyle(TOT(idx))
    story.append(dscr_t)
    NL(story, 5)
    min_req = 1.25
    avg = dscr["average"]
    status = "ABOVE" if avg >= min_req else "BELOW"
    rep_rows = [
        ["Metric","Value","Benchmark","Status"],
        ["Average Term Loan DSCR (5-Year)",  str(cma.get("avg_dscr_5yr", cma.get("avg_dscr", 0))),  ">= 1.25 (illustrative)", cma["dscr_label"]],
        ["Payback Period (months)", _fmt_payback(cma), "< 24 mo", ("Not Achievable" if (cma.get("payback_not_achievable") or str(cma.get("breakeven_months","")).upper()=="N/A" or float(cma.get("breakeven_months",0) if isinstance(cma.get("breakeven_months"),(int,float)) else 0)==0) else ("Good" if float(cma.get("breakeven_months",0))<24 else "Monitor"))],
        ["Margin of Safety",       rp2(cma["margin_of_safety"]),"> 0",    "Positive" if cma["margin_of_safety"]>0 else "Negative"],
    ]
    rep_t = Table(rep_rows, colWidths=[70*mm,35*mm,35*mm,30*mm])
    rep_t.setStyle(BTS())
    story.append(rep_t)
    NL(story, 4)

    # CA AUDIT: existing_monthly_emi (Section-A, an existing-business loan)
    # and promoter_net_worth.home_loan_emi (Section-B/personal net worth)
    # are pre-existing obligations that draw on the same cash accruals as
    # the new term loan above but were never deducted anywhere. Adjusted
    # DSCR below re-runs the SAME term_loan_dscr() formula with those
    # combined EMIs subtracted from cash accruals first — a genuine
    # after-all-obligations debt-service view, shown only when such EMIs
    # exist so an unaffected report's Section-N is unchanged.
    if dscr.get("has_existing_emi"):
        H2("Adjusted Term Loan DSCR (Including Existing EMI Obligations)", story)
        _existing_emi_mo = dscr["existing_annual_emi"] / 12
        # BUG FIX: this caption used to unconditionally claim BOTH an
        # "existing business loan EMI" AND a "personal home loan EMI"
        # regardless of which one(s) actually contributed a nonzero
        # figure — for a New Business (Section-A correctly shows "No
        # existing banking facilities"), the combined EMI is entirely the
        # promoter's personal home loan, but this caption still claimed a
        # business loan EMI existed too, reading as a direct contradiction
        # of Section-A's own, correct disclosure. Built from the same two
        # components (and the same >0 checks) as the Credit Assessment
        # weakness bullet, so the two can never again disagree.
        _dscr_existing_biz_emi  = float(inp.get("existing_monthly_emi", 0) or 0)
        _dscr_home_loan_emi     = float((cma.get("promoter_net_worth") or {}).get("home_loan_emi", 0) or 0)
        _dscr_emi_source_parts = []
        if _dscr_existing_biz_emi > 0:
            _dscr_emi_source_parts.append("existing business loan EMI (Section-A)")
        if _dscr_home_loan_emi > 0:
            _dscr_emi_source_parts.append("the promoter's personal home loan EMI (Section-B)")
        story.append(Paragraph(
            f"<b>Combined existing EMI:</b> Rs.{_existing_emi_mo:,.0f}/month "
            f"(Rs.{dscr['existing_annual_emi']:,.0f}/year) — " + " plus ".join(_dscr_emi_source_parts) +
            ", a pre-existing obligation not related to the new term loan being appraised here.",
            ST["small"]))
        NL(story, 2)
        adj_t = Table([
            ["Particulars","Year 1","Year 2","Year 3","Year 4","Year 5"],
            ["(A) Cash Accruals (PAT + Dep)"]        + [r(d["cash_accruals"])          for d in dr],
            ["(A) Less: Existing EMI (Annualised)"]  + [r(d["existing_emi_annual"])     for d in dr],
            ["(A) Adjusted Cash Accruals"]           + [r(d["adjusted_cash_accruals"])  for d in dr],
            ["(A) Add: Interest on TL"]              + [r(d["tl_interest"])             for d in dr],
            ["Adjusted Total (A) — Numerator"]       + [r(d["adjusted_total_a"])        for d in dr],
            ["Total (B) — Denominator (unchanged)"]  + [r(d["total_b"])                 for d in dr],
            ["Adjusted Term Loan DSCR"]              + [str(d["adjusted_dscr"])         for d in dr],
        ], colWidths=[60*mm]+[22*mm]*5)
        adj_t.setStyle(BTS())
        for idx in [3, 5]: adj_t.setStyle(TOT(idx))
        story.append(adj_t)
        NL(story, 3)
        story.append(Paragraph(
            f"<b>Average Adjusted DSCR (5-Year):</b> {dscr['average_adjusted_dscr']} "
            f"({dscr['adjusted_dscr_label']}) vs. the primary Average Term Loan DSCR of {avg} above — "
            "this is the more conservative, real-world debt-service capacity after ALL known "
            "obligations, not just the new term loan.",
            ST["normal"]))
        NL(story, 4)
    # CA AUDIT: Payback Period must show its own working, not just assert a
    # number — a cumulative cash-flow recovery walk against the Initial
    # Investment, using each year's own (declining or growing) Cash Accrual.
    _pbc = cma.get("payback_calculation")
    if _pbc:
        H2("Payback Period — Cumulative Cash-Flow Calculation", story)
        story.append(Paragraph(f"<b>Formula:</b> {_pbc['formula']}", ST["small"]))
        NL(story, 2)
        story.append(Paragraph(
            f"<b>Initial Investment</b> (Total Project Cost) = {rs(_pbc['initial_investment'])}",
            ST["small"]))
        NL(story, 2)
        # Header cells are Paragraph-wrapped, not plain strings — ReportLab
        # does not auto-wrap plain strings, and each of these headers is
        # wider than its column at 8pt bold.
        _pb_hdr_style = _s("pb_hdr", fontSize=7.5, alignment=TA_CENTER, fontName="Helvetica-Bold", textColor=W, leading=9)
        _pb_rows = [[Paragraph(h, _pb_hdr_style) for h in
                     ["Year", "Annual Cash Accrual (Rs.)", "Monthly Cash Accrual (Rs.)",
                      "Cumulative Cash Accrual (Rs.)", "Investment Recovered?"]]]
        for _yr_calc in _pbc["by_year"]:
            _recovered = (
                "Yes — this year" if _yr_calc["year"] == _pbc.get("recovered_in_year")
                else ("Yes" if (_pbc.get("recovered_in_year") and _yr_calc["year"] > _pbc["recovered_in_year"]) else "No")
            )
            _pb_rows.append([
                str(_yr_calc["year"]), r(_yr_calc["annual_cash_accrual"]),
                r(_yr_calc["monthly_cash_accrual"]), r(_yr_calc["cumulative_cash_accrual"]),
                _recovered,
            ])
        _pb_t = Table(_pb_rows, colWidths=[15*mm, 42*mm, 40*mm, 42*mm, 31*mm])
        _pb_t.setStyle(BTS())
        story.append(_pb_t)
        NL(story, 3)
        if _pbc.get("not_achievable"):
            story.append(Paragraph(
                "<b>Result:</b> Initial Investment is NOT fully recovered from cumulative cash accruals "
                "within the 5-year projection window — Payback Period is shown as Not Achievable, not forced "
                "to a number.",
                ST["small"]))
        else:
            story.append(Paragraph(
                f"<b>Result:</b> Cumulative Cash Accrual first reaches the Initial Investment during Year "
                f"{_pbc['recovered_in_year']} → Payback Period = <b>{cma.get('breakeven_months')} months</b> "
                f"(interpolated within Year {_pbc['recovered_in_year']} using that year's own monthly cash-accrual rate).",
                ST["small"]))
        NL(story, 4)
    story.append(Paragraph(
        f"<b>Note:</b> This is the <b>Term Loan DSCR</b> — it covers only the term loan's own principal and "
        f"interest, and deliberately excludes Working Capital interest (a separate revolving facility, "
        f"serviced out of the same cash accruals but not amortised like a term loan). "
        f"1.25x is this platform's illustrative benchmark, not a universal bank/RBI requirement — the "
        f"sanctioning bank's own norm governs. "
        f"The average of {avg} is <b>{status}</b> this illustrative benchmark.",
        ST["normal"]))
    NL(story, 3)
    # D:E leverage warning (moved here from the old Q2) — flag aggressive
    # leverage without blocking generation.
    _r_tl_de  = round(pc["term_loan"] / max(display_promoter_fixed_equity, 1), 2) if display_promoter_fixed_equity else 0
    _r_tot_de = round((pc["term_loan"] + pc.get("wc_loan", 0)) / max(display_promoter_contribution, 1), 2) if display_promoter_contribution else 0
    if _r_tl_de > 3 or _r_tot_de > 4:
        _de_warn_parts = []
        if _r_tl_de > 3:
            _de_warn_parts.append(f"Term Loan D:E of {_r_tl_de}:1 exceeds 3:1")
        if _r_tot_de > 4:
            _de_warn_parts.append(f"Total Debt D:E of {_r_tot_de}:1 exceeds 4:1")
        _de_warn_tbl = Table(
            [[Paragraph(
                "⚠ High Leverage: " + " | ".join(_de_warn_parts) + ". "
                "High leverage may reduce loan approval probability. "
                "Consider increasing promoter equity or reducing borrowing.",
                ST["small"]
            )]],
            colWidths=[170*mm]
        )
        _de_warn_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0,0),(-1,-1), AMB),
            ("TOPPADDING",    (0,0),(-1,-1), 5),
            ("BOTTOMPADDING", (0,0),(-1,-1), 5),
            ("LEFTPADDING",   (0,0),(-1,-1), 8),
        ]))
        story.append(_de_warn_tbl)
    _trend_warnings = []
    for _i, _yr in enumerate(cma.get("projections_5yr", []), start=1):
        _yr_ebitda = float(_yr.get("ebitda", 0) or 0)
        _yr_pat    = float(_yr.get("net_profit", _yr.get("profit_after_tax", 0)) or 0)
        _yr_dscr   = float(_yr.get("dscr", 0) or 0)
        if _yr_ebitda < 0:
            _trend_warnings.append(f"Year {_i}: EBITDA turns negative (Rs.{_yr_ebitda:,.0f})")
        elif _yr_pat < 0:
            _trend_warnings.append(f"Year {_i}: PAT turns negative (Rs.{_yr_pat:,.0f})")
        elif _yr_dscr > 0 and _yr_dscr < 1.0:
            _trend_warnings.append(f"Year {_i}: DSCR falls below 1.0 ({_yr_dscr}x)")
    if _trend_warnings:
        NL(story, 2)
        _trend_tbl = Table(
            [[Paragraph(
                "⚠ Projected Financial Stress in Later Years: " + " | ".join(_trend_warnings) + ". "
                "Review long-term revenue growth and cost assumptions.",
                ST["small"]
            )]],
            colWidths=[170*mm]
        )
        _trend_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0,0),(-1,-1), AMB),
            ("TOPPADDING",    (0,0),(-1,-1), 5),
            ("BOTTOMPADDING", (0,0),(-1,-1), 5),
            ("LEFTPADDING",   (0,0),(-1,-1), 8),
        ]))
        story.append(_trend_tbl)
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # 11 / SECTION-S — RISK ANALYSIS
    # ════════════════════════════════════════════════════════════════════════════

    # ════════════════════════════════════════════════════════════════
    # SECTION 27 — RISK ASSESSMENT
    # ════════════════════════════════════════════════════════════════
    SEC("11 / SECTION-S: RISK ANALYSIS", story)
    H2("S1. Risk Assessment", story)
    _risk_cell_style = _s("risk_cell", fontSize=8, alignment=TA_LEFT, fontName="Helvetica", textColor=BLK, leading=10)
    risk_rows = [["Category","Risk Description","Probability","Impact","Net Risk"]]
    _risk_matrix_display = _display_risk_matrix(_industry)
    for i,rm_ in enumerate(_risk_matrix_display):
        risk_rows.append([Paragraph(str(rm_["category"]), _risk_cell_style),
                           Paragraph(str(rm_["description"]), _risk_cell_style),
                           rm_["probability"], rm_["impact"], rm_["net_risk"]])
    risk_t = Table(risk_rows, colWidths=[32*mm,64*mm,24*mm,24*mm,26*mm])
    risk_t.setStyle(BTS())
    for i,rm_ in enumerate(_risk_matrix_display):
        risk_t.setStyle(RISK_COLOR(i+1, rm_["net_risk"]))
    story.append(risk_t)
    NL(story, 4)
    story.append(Paragraph(f"<b>Overall Risk Level: {cma['risk_level']}</b>", ST["bold"]))

    H2("S2. Sensitivity Analysis", story)
    NL(story, 3)
    story.append(Paragraph(
        "<b>Base Case</b> = Year 1 monthly values from the master financial engine. "
        "Variable costs scale proportionally with revenue; fixed costs remain constant. "
        "<b>Revenue, COGS, EBITDA and PAT in this table are MONTHLY figures</b> — TL DSCR, however, is "
        "an annual debt-service measure, calculated by re-running the full 5-year loan schedule under "
        "each scenario's changed assumption and taking that scenario's Year 1 annual DSCR "
        "(PAT + Dep + Term Loan Interest) / (Term Loan Principal + Term Loan Interest); it is not derived "
        "from the monthly figures shown alongside it in the same row.",
        ST["small"]))
    NL(story, 2)
    # Reduced from 6 to 5 scenarios — the +20% "Best Case" extreme added a
    # row without changing the reading; Optimistic/Base/Conservative/
    # Pessimistic/Worst already span the meaningful range.
    _sens_scenarios = [s for s in cma["sensitivity"] if s.get("scenario") != "Best Case"]
    sens_rows = [["Scenario","Chg %","Revenue (Rs.)","COGS (Rs.)","EBITDA (Rs.)","PAT (Rs.)","TL DSCR","Status"]]
    for s in _sens_scenarios:
        _is_structural = s.get("type") == "structural"
        _chg_display = "—" if (_is_structural and not s.get("change_pct")) else f"{s.get('change_pct',0)}%"
        sens_rows.append([
            Paragraph(s["scenario"], ST["table_cell"]), _chg_display,
            r(s["monthly_revenue"]),
            r(s.get("monthly_cogs", 0)),
            r(s.get("monthly_ebitda", s.get("monthly_revenue",0) - s.get("monthly_variable",0) - s.get("monthly_fixed",0))),
            r(s["monthly_profit"]),
            str(s["dscr"]),
            s["status"],
        ])
    sens_t = Table(sens_rows, colWidths=[30*mm,12*mm,23*mm,20*mm,23*mm,20*mm,17*mm,20*mm])
    sens_t.setStyle(BTS())
    story.append(sens_t)
    NL(story, 3)
    story.append(Paragraph(
        "<b>Structural scenarios</b> (Raw Material Cost, Salary, Receivable Days, Interest Rate, Combined Downside) "
        "re-run the full loan schedule / working capital / income statement engine with the stated single input "
        "changed — e.g. \"Raw Material Cost +10%\" recomputes COGS, EBITDA, tax, PAT, and the resulting Term Loan "
        "DSCR from an input where purchase/raw-material cost is 10% higher, holding revenue constant. "
        "\"Combined Downside\" applies raw material +10%, salary +10%, receivable days +15, and interest rate +2pp "
        "together with a 10% revenue decline — a single scenario stressing multiple levers at once, not just revenue.",
        ST["small"]))
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # 12 / EXECUTIVE SUMMARY — 5-YEAR FINANCIAL HIGHLIGHTS
    # ════════════════════════════════════════════════════════════════════════════
    SEC("12 / EXECUTIVE SUMMARY: 5-YEAR FINANCIAL HIGHLIGHTS", story)
    # NEW SECTION: your outline places a dedicated 5-year highlights page
    # here (distinct from the Executive Credit Summary at the front, which
    # carries the credit recommendation) — pulled together from the same
    # P&L/DSCR/Balance-Sheet rows already computed above, not recalculated.
    _hl_rows = [
        ["Metric", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5"],
        ["Revenue"]            + [r(cy["revenue"])              for cy in cop],
        ["EBITDA"]             + [r(cy.get("ebitda", 0))         for cy in cop],
        ["Net Profit (PAT)"]   + [r(cy["net_profit"])            for cy in cop],
        ["Cash Accruals"]      + [r(cy["cash_accruals"])         for cy in cop],
        ["Term Loan DSCR"]     + [str(dv["dscr"])                for dv in dscr["years"]],
        ["Closing Cash Balance"] + [r(max(float(pbs[i+1].get("cash", 0) or 0), 0)) if i+1 < len(pbs) else "—" for i in range(5)],
    ]
    _hl_t = Table(_hl_rows, colWidths=[46*mm]+[24.8*mm]*5)
    _hl_t.setStyle(BTS())
    for idx in [1, 2, 3]: _hl_t.setStyle(TOT(idx))
    story.append(_hl_t)
    NL(story, 4)
    _hl_pat_growth = R((cop[-1]["net_profit"] / cop[0]["net_profit"] - 1) * 100, 1) if cop and cop[0]["net_profit"] else 0
    story.append(Paragraph(
        f"<b>PAT growth, Year 1 → Year 5:</b> {_hl_pat_growth}%  |  "
        f"<b>Average Term Loan DSCR:</b> {cma.get('avg_dscr_5yr', cma.get('avg_dscr', 0))}  |  "
        f"<b>Payback Period:</b> {_fmt_payback(cma)}" + (" months" if _fmt_payback(cma) != "N/A" else ""),
        ST["small"]))
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # 13 / SECTION-U — KEY FINANCIAL RATIOS SUMMARY
    # ════════════════════════════════════════════════════════════════════════════

    # ════════════════════════════════════════════════════════════════
    # SECTION 29 — FINANCIAL RATIO ANALYSIS
    # ════════════════════════════════════════════════════════════════
    SEC("13 / SECTION-U: KEY FINANCIAL RATIOS SUMMARY", story)
    _q2_cash_accrual_less_tl_principal = R(cma.get("surplus_monthly", 0) * 12, 2)
    ratios = Table([
        ["Ratio","Value","Benchmark","Assessment"],
        ["Current Ratio (Balance Sheet Basis)", r2(_true_current_ratio), "> 1.33 (illustrative)", "Good" if _true_current_ratio>1.33 else "Monitor"],
        ["WC Bank Finance Coverage", r2(_wc_bank_coverage) + "x", "—", "—"],
        ["D:E (TL ÷ Promoter Fixed Equity)",          str(_r_tl_de) + " : 1",  "< 2", "Good" if _r_tl_de < 2 else "High"],
        ["Total Leverage ((TL+WC) ÷ Total Promoter)", str(_r_tot_de) + " : 1", "< 3", "Good" if _r_tot_de < 3 else "High"],
        ["EBITDA Margin (EBITDA / Sales)",     rp2(cma["ebitda_margin_pct"]), "> 20%", "Good" if cma["ebitda_margin_pct"]>20 else "Monitor"],
        ["Net Profit Margin (PAT / Sales)",    rp2(cma["net_margin_pct"]),    "> 10%", "Good" if cma["net_margin_pct"]>10 else "Monitor"],
        ["ROI (EBITDA)",               rp2(cma["roi_ebitda_pct"]),    "> 15%",  "Good" if cma["roi_ebitda_pct"]>15 else "Monitor"],
        ["ROI (PAT)",                  rp2(cma["roi_pat_pct"]),       "> 10%",  "Good" if cma["roi_pat_pct"]>10 else "Monitor"],
        ["Interest Coverage (EBITDA / Int)",   r2(cma.get("interest_coverage_y1", 0)), "> 2", "Good" if cma.get("interest_coverage_y1", 0)>2 else "Monitor"],
        ["Asset Turnover (Sales / Investment)",r2(cma.get("asset_turnover_y1", 0)),    "> 1", "Good" if cma.get("asset_turnover_y1", 0)>1 else "Monitor"],
        ["Total TL Interest Outgo",    rs(cma["total_interest_outgo"]), "—", "—"],
        ["Cash Accrual Less Term Loan Principal", rs(_q2_cash_accrual_less_tl_principal), "> 0", "Positive" if _q2_cash_accrual_less_tl_principal>0 else "Negative"],
    ], colWidths=[65*mm,28*mm,30*mm,47*mm])
    ratios.setStyle(BTS())
    story.append(ratios)
    NL(story, 2)
    story.append(Paragraph(
        "ROI (EBITDA) = EBITDA / Initial Project Investment x 100  |  ROI (PAT) = PAT / Initial Project Investment x 100  |  "
        "Margins = Profit / Sales Revenue x 100  |  D:E: Term Loan D:E = TL / promoter fixed equity; "
        "Total leverage = total debt / total promoter contribution. Current Ratio (Balance Sheet Basis) is computed "
        "directly from the projected Balance Sheet's own Year 1 Current Assets and Current Liabilities (Section-K) — "
        "not a bank's own WC assessment methodology (e.g. Tandon Committee MPBF). WC Bank Finance Coverage is a "
        "separate figure — WC Requirement ÷ WC Bank Finance — showing how many times the assessed WC requirement "
        "is the arranged WC bank facility; it is not a Current Ratio. Cash Accrual Less Term Loan Principal = "
        "PAT + Depreciation − Term Loan Principal Repaid.",
        ST["small"]))
    NL(story, 5)

    H2("Overall Interpretation", story)
    _fa_cell_style = _s("fa_cell", fontSize=9, alignment=TA_CENTER, fontName="Helvetica-Bold", textColor=BLK, leading=12)
    fa_t = Table([
        ["Viability Grade","Feasibility Assessment","Risk Level","Weighted Score"],
        [Paragraph(str(cma["credit_rating"]), _fa_cell_style), Paragraph(str(_rec_display), _fa_cell_style),
         Paragraph(str(cma["risk_level"]), _fa_cell_style), Paragraph(str(cma["total_score"]), _fa_cell_style)],
    ], colWidths=[32*mm,68*mm,32*mm,38*mm])
    fa_t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),_theme_color("dark")),("TEXTCOLOR",(0,0),(-1,0),W),
        ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("FONTSIZE",(0,0),(-1,0),10),
        ("ALIGN",(0,0),(-1,-1),"CENTER"),("VALIGN",(0,0),(-1,-1),"MIDDLE"),("BACKGROUND",(0,1),(-1,1),_theme_color("light")),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8),
        ("GRID",(0,0),(-1,-1),0.5,W),
    ]))
    story.append(fa_t)
    NL(story, 2)
    story.append(Paragraph(
        "Subjective factors such as market opportunity, competitive position, and business model are excluded "
        "from the ratio table above. The Viability Grade, Risk Level and Weighted Score are model-derived "
        "indicators computed from the stated assumptions — they are not a bank sanction rating, credit "
        "grade, or lending decision, and do not substitute for the sanctioning bank's own credit appraisal.",
        ST["small"]))
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # APPENDIX — ASSUMPTIONS & METHODOLOGY
    # ════════════════════════════════════════════════════════════════════════════

    # ════════════════════════════════════════════════════════════════
    # PART III — METHODOLOGY & AUDIT TRAIL  (Sections 30-32)
    # ════════════════════════════════════════════════════════════════

    # ── SECTION 30 — ASSUMPTIONS & METHODOLOGY ─────────────────────────
    SEC("ASSUMPTIONS & METHODOLOGY", story)
    story.append(Paragraph(
        "The following formulas and conventions are based on the financial modelling methodology "
        "selected for this report. The benchmarks shown below are this platform's configured/"
        "illustrative thresholds, not a universal regulatory requirement. Applicable accounting, "
        "taxation, banking, government scheme and lender-specific requirements should be "
        "independently verified by the sanctioning bank.",
        ST["normal"]))
    NL(story, 3)
    # BUG FIX: these cells used to be plain strings with manually-inserted
    # "\n" breaks, on the assumption that ReportLab only needed help at
    # chosen points — but several individual line-fragments were still
    # longer than the 100mm middle column could hold, and a plain string
    # never wraps on its own, so those fragments overflowed straight into
    # the "Benchmark" column, garbling both. Every cell is now a
    # Paragraph, which word-wraps to the real column width regardless of
    # exactly how long any given line is.
    _fdef_label_style = _s("fdef_label", fontSize=7.5, fontName="Helvetica-Bold", textColor=BLK, leading=10)
    _fdef_body_style  = _s("fdef_body",  fontSize=7.5, fontName="Helvetica",      textColor=BLK, leading=10)
    _fdef_bench_style = _s("fdef_bench", fontSize=7.5, fontName="Helvetica",      textColor=BLK, leading=10)

    def _fdef_row(label, body, bench):
        return [Paragraph(label, _fdef_label_style), Paragraph(body, _fdef_body_style), Paragraph(bench, _fdef_bench_style)]

    _fdef_rows = [
        ["Ratio / Formula", "Definition & Method", "Benchmark"],
        _fdef_row(
            "DSCR (Term Loan Debt Service Coverage Ratio)",
            "= (PAT + Depreciation + Term Loan Interest) / (Term Loan Principal + Term Loan Interest). "
            "Measures ability to repay the TERM LOAN from operating cash flow. Deliberately excludes "
            "Working Capital interest — WC is a separate revolving facility, not amortised like a term loan.",
            ">= 1.25x (illustrative, term-loan only)"),
        _fdef_row(
            "ROI — EBITDA / PAT",
            "= Annual EBITDA (or PAT) / Initial Project Investment × 100. "
            # CA AUDIT: previously described the denominator as "Fixed
            # Assets + Promoter WC Margin" — Fixed Assets (the depreciable
            # block) is narrower than what Section-B/15 actually use as
            # Initial Project Investment, which also includes preliminary/
            # pre-operative expenditure (not a depreciable fixed asset, but
            # still part of fixed project cost). That gap (e.g. Rs.20,000
            # of preliminary expenses on a live report) made the stated
            # denominator not add up to the Initial Project Investment
            # figure Section-J actually divides by.
            "Initial Project Investment comprises eligible fixed project cost, preliminary/pre-operative "
            "expenditure where applicable, and promoter-funded working-capital margin. "
            "Measures operational / net return on the initial investment.",
            "> 15% / > 10%"),
        _fdef_row(
            "ROCE",
            "= EBIT ÷ Capital Employed (Promoter Equity + Term Loan) × 100. "
            "One exact formula, used consistently everywhere in this report (Section-J). EBIT = EBITDA − Depreciation. "
            "Return on all long-term funds deployed, before financing structure is considered.",
            "Illustrative"),
        _fdef_row(
            "ROE",
            "= PAT ÷ Average Promoter Equity × 100. "
            "Average Promoter Equity = average of (Promoter Fixed Equity + Promoter WC Margin + Reserves & "
            "Surplus) at the start and end of the reference year (from the projected Balance Sheet). "
            "<b>Government/state capital subsidy is deliberately EXCLUDED from this denominator</b> — it is "
            "the promoter's own return being measured, not a return on subsidy funds; if a bank's own "
            "policy instead treats the subsidy as part of owners' funds for this purpose, ROE should be "
            "recalculated on that wider base. Falls back to Promoter Equity alone if Average Promoter Equity "
            "is not meaningful (zero or negative). Can legitimately be extreme for a thinly-capitalised, "
            "highly-leveraged project; a large magnitude is a leverage signal, not an error.",
            "Illustrative"),
        _fdef_row(
            "Current Ratio (Balance Sheet basis)",
            "= Total Current Assets / Total Current Liabilities, taken directly from the Year 1 projected "
            "Balance Sheet (Section-K) — not a bank's own WC assessment methodology (e.g. Tandon "
            "Committee MPBF), which each bank/scheme should apply separately.",
            "> 1.33x (illustrative)"),
        _fdef_row(
            "WC Bank Finance Coverage",
            "= WC Requirement / WC Bank Finance — how many times the assessed WC requirement is the "
            "arranged WC bank facility. This is NOT a Current Ratio.",
            "—"),
        _fdef_row(
            "D:E Ratio (Term Loan D:E)",
            "= Term Loan Amount / Promoter Fixed Equity",
            "< 2 : 1"),
        _fdef_row(
            "Total Leverage (D:E — All Debt)",
            "= (Term Loan + WC Bank Finance) / Total Promoter Contribution",
            "< 3 : 1"),
        _fdef_row(
            "EBITDA Margin / Net Profit Margin",
            "= EBITDA (or PAT) / Sales Revenue × 100",
            "> 20% / > 10%"),
        _fdef_row(
            "Operating Break-Even Sales",
            "= Operating Fixed Costs (Admin/Labour + Depreciation, excl. Interest) / (1 − Variable Cost "
            "Ratio). Sales needed to cover operations only, before financing costs. "
            "Not computable when Contribution Margin ≤ 0 (shown as N/A, not forced to a number).",
            "< Monthly Revenue"),
        _fdef_row(
            "Financial Break-Even Sales",
            "= Financial Fixed Costs (Admin/Labour + Depreciation + Term Loan &amp; WC Interest) / "
            "(1 − Variable Cost Ratio). Sales needed to cover operations AND service the financing "
            "structure — always ≥ Operating Break-Even Sales. "
            "Not computable when Contribution Margin ≤ 0 (shown as N/A, not forced to a number).",
            "< Monthly Revenue"),
        _fdef_row(
            "Cash Accruals",
            "= PAT + Annual Depreciation — the operating cash flow available for debt service",
            "> Annual TL Debt Service"),
        _fdef_row(
            "Interest Coverage",
            "= EBITDA / Total Interest (TL + WC)",
            "> 2x"),
        _fdef_row(
            "Asset Turnover",
            "= Annual Revenue / Initial Project Investment",
            "> 1x"),
    ]
    _fdef_t = Table(_fdef_rows, colWidths=[38*mm, 100*mm, 32*mm])
    _fdef_t.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(-1, 0), _theme_color("accent")),
        ("TEXTCOLOR",     (0,0),(-1, 0), W),
        ("FONTNAME",      (0,0),(-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0,0),(-1,-1), 7.5),
        ("GRID",          (0,0),(-1,-1), 0.4, GRY),
        ("TOPPADDING",    (0,0),(-1,-1), 3),
        ("BOTTOMPADDING", (0,0),(-1,-1), 3),
        ("LEFTPADDING",   (0,0),(-1,-1), 4),
        ("RIGHTPADDING",  (0,0),(-1,-1), 4),
        ("VALIGN",        (0,0),(-1,-1), "TOP"),
        ("ROWBACKGROUNDS",(0,1),(-1,-1), [W, ALT]),
    ]))
    story.append(_fdef_t)
    NL(story, 5)
    story.append(Paragraph(
        "<b>Sensitivity Analysis:</b> Variable costs scale proportionally with revenue; fixed costs remain "
        "constant. Five scenarios shown: Optimistic (+10%) / Base (0%) / Conservative (−10%) / "
        "Pessimistic (−20%) / Worst (−30%). Its DSCR uses the exact same Term Loan DSCR formula and "
        "calculation function as the DSCR schedule in Section-N.",
        ST["small"]))
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # APPENDIX — FINANCIAL MODEL RECONCILIATION
    # ════════════════════════════════════════════════════════════════════════════

    # ── SECTION 31 — FINANCIAL MODEL RECONCILIATION ────────────────────
    # Two DELIBERATELY separate concerns, previously conflated into one raw
    # warning count (which mixed genuine calculation bugs with normal
    # business-risk facts like "DSCR is below 1 this year" — the latter is a
    # correct, expected OUTCOME for a loss-making scenario, not a reconciliation
    # failure, and showing it as "20 item(s) flagged" was misleading):
    #   1. Structural checks — pure arithmetic identities (does every total
    #      equal the sum of its own parts, does every roll-forward tie
    #      opening to closing). A FAIL here is a genuine calculation-integrity
    #      bug and blocks report generation entirely.
    #   2. Business-risk signals (negative DSCR/PAT/cash, sensitivity
    #      anomalies) — surfaced via validate_cma_dpr for internal logging
    #      only; they are already shown to the reader in the Executive
    #      Credit Summary, DSCR, and Balance Sheet sections, so they inform
    #      "PASS WITH WARNINGS" here but are never re-listed.
    SEC("FINANCIAL MODEL RECONCILIATION", story)
    _structural_checks = structural_reconciliation(cma, dpr)
    _structural_all_pass = all(c["passed"] for c in _structural_checks)
    if not _structural_all_pass:
        _failed = [c for c in _structural_checks if not c["passed"]]
        raise StructuralReconciliationError(
            "Report generation blocked — financial model failed structural reconciliation:\n" +
            "\n".join(f"  • {c['name']}: {c['detail']}" for c in _failed)
        )

    _val_warnings = validate_cma_dpr(inp, cma, dpr)
    import logging as _logging
    _val_logger = _logging.getLogger("pdf_builder.validator")
    for _w in _val_warnings:
        _val_logger.warning(_w)
    _has_business_risk_warnings = len(_val_warnings) > 0

    _recon_label = (
        "✓ FINANCIAL MODEL VALIDATION: PASS" if not _has_business_risk_warnings else
        "✓ FINANCIAL MODEL VALIDATION: PASS WITH WARNINGS (see Executive Credit Summary / DSCR / Balance Sheet for risk items)"
    )
    recon_tbl = Table([[Paragraph(_recon_label, ST["rec_box"])]], colWidths=[170*mm])
    recon_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0,0),(-1,-1), GRN if not _has_business_risk_warnings else AMB),
        ("TOPPADDING",    (0,0),(-1,-1), 8),
        ("BOTTOMPADDING", (0,0),(-1,-1), 8),
    ]))
    story.append(recon_tbl)
    NL(story, 4)

    H2("Structural Reconciliation Checks", story)
    # Check names are Paragraph-wrapped, not plain strings — a plain
    # string that's too wide for this column would otherwise overflow
    # straight into the neighbouring Status cell instead of wrapping
    # (ReportLab does not auto-wrap plain strings in a Table), and the
    # longest check name here now runs longer than any of this table's
    # original rows.
    _recon_lbl_style = _s("recon_lbl", fontSize=8.5, fontName="Helvetica", textColor=BLK, leading=10.5)
    _recon_rows = [["Check", "Status"]]
    for c in _structural_checks:
        # Paragraph parses its text as markup — an unescaped "&" (e.g. in
        # "P&L Roll-Forward") is read as the start of an XML entity, which
        # ReportLab renders back out mangled (literally "P&L;"). Escape
        # before wrapping, not just for this row's own known names.
        _recon_name_esc = c["name"].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        _recon_rows.append([Paragraph(_recon_name_esc, _recon_lbl_style), "PASS" if c["passed"] else "FAIL"])
    _recon_t = Table(_recon_rows, colWidths=[130*mm, 40*mm])
    _recon_t.setStyle(BTS())
    story.append(_recon_t)
    NL(story, 4)
    story.append(Paragraph(
        "These are pure arithmetic-identity checks (every total equals the sum of its own parts, every "
        "roll-forward schedule ties opening to closing) — not a judgement on whether the business is "
        "profitable. A loss-making year, a DSCR below the benchmark, or a funding shortfall are valid, "
        "correctly-computed business outcomes, shown elsewhere in this report as risk warnings, not as "
        "reconciliation failures here.",
        ST["small"]))
    PB(story)

    # ════════════════════════════════════════════════════════════════════════════
    # APPENDIX — DECLARATION & DISCLAIMER
    # ════════════════════════════════════════════════════════════════════════════

    # ── SECTION 32 — DECLARATION & DISCLAIMER ──────────────────────────
    SEC("DECLARATION & DISCLAIMER", story)
    NL(story, 8)
    story.append(Paragraph(
        "This Business Loan Feasibility Report (indicative financial assessment) has been prepared "
        "based on the information and data furnished by the applicant/entrepreneur. All financial projections "
        "are indicative and based on stated assumptions. Actual results may vary due to market conditions, "
        "regulatory changes, or operational factors beyond the scope of this report.",
        ST["normal"]))
    NL(story, 4)
    story.append(Paragraph(
        "The financial institution / bank is advised to independently verify all data, conduct its own "
        "due diligence, and apply its standard credit appraisal norms before sanctioning any loan. "
        "This is a preliminary borrower feasibility report, not a certified bank CMA. "
        f"This report is valid for {inp.get('report_validity_days', 120)} days from the date of preparation.",
        ST["normal"]))
    NL(story, int(20*mm))
    sig_t = Table([
        ["Prepared By","Verified By","Authorised By"],
        ["\n\n\n________________________","\n\n\n________________________","\n\n\n________________________"],
        [f"Name: {_prepared_by}","Name:","Name:"],
        ["Designation:","Designation:","Designation:"],
        ["Date:","Date:","Date:"],
    ], colWidths=[56.7*mm]*3)
    sig_t.setStyle(TableStyle([
        ("ALIGN",(0,0),(-1,-1),"CENTER"),("FONTSIZE",(0,0),(-1,-1),8),
        ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("GRID",(0,0),(-1,-1),0.3,GRY),
        ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    story.append(sig_t)
    NL(story, int(8*mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_theme_color("accent")))
    NL(story, 2)
    story.append(Paragraph(
        f"Report Reference: {ref_no}  |  Generated: {datetime.now().strftime('%d %b %Y %H:%M')}  |  "
        "Platform: GTAB — Government Loan Assistance Platform  |  CONFIDENTIAL",
        ST["small"]))

    doc.build(story)


def build_pdf(inp: dict, cma: dict, dpr: dict, output_path: str):
    theme = _REPORT_THEMES.get(str(inp.get("report_theme", "Navy")), _REPORT_THEMES["Navy"])
    token = _ACTIVE_REPORT_THEME.set(theme)
    try:
        return _build_pdf_content(inp, cma, dpr, output_path)
    finally:
        _ACTIVE_REPORT_THEME.reset(token)
