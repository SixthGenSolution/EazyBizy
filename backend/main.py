"""
GTAB Master CMA + DPR Report API  v4.0
=======================================
Single endpoint that accepts all inputs and returns:
  - Full JSON (CMA + DPR)
  - Download link for combined 22-section PDF

POST /master/generate-report   → JSON + PDF download link
GET  /master/download/{id}     → Download the PDF
POST /master/calculate         → JSON only (no PDF)

All original endpoints preserved.
Run: uvicorn main_master:app --reload --port 8000
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Any, cast
from datetime import datetime
import os, uuid, tempfile, json, math, re

_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', re.IGNORECASE)
_SAFE_NAME_RE = re.compile(r'[^a-zA-Z0-9 _-]')

def _safe_filename(name: str, max_len: int = 64) -> str:
    """Strip path-traversal characters from a user-supplied name before using in os.path.join."""
    sanitized = _SAFE_NAME_RE.sub('', name).replace(' ', '_')
    return sanitized[:max_len] or 'unknown'

from core.engine import DEFAULT_CAPACITY_SCHEDULE, run_dpr, run_cma, R, _tally_projected_balance_sheet
from core.financial_defaults import DEFAULT_WC_INTEREST_RATE, resolve_wc_interest_rate
from pdf.builder import build_pdf
from schemes.pmegp import calculate_pmegp_finance, PMEGPValidationError
from schemes.router import route_scheme
from models.input_schema import CMAReportInput
from api.report import router as report_router
from api.cma import router as cma_router
import glob
import time

app = FastAPI(title="GTAB Master CMA+DPR API", version="4.0.0")

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins if _allowed_origins else ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

REPORTS_DIR = "generated_reports"
os.makedirs(REPORTS_DIR, exist_ok=True)

# Register the CA-compliant CMA report router
# Adds: POST /api/v1/report/generate, GET /api/v1/report/{id}/download,
#       POST /api/v1/report/validate, GET /api/v1/report/schemes, etc.
app.include_router(report_router)
app.include_router(cma_router)

INDUSTRY_ALIASES = {
    "manufacturing": "manufacturing",
    "manufacture": "manufacturing",
    "manufracting": "manufacturing",
    "service": "service",
    "services": "service",
    "trading": "trading",
    "trade": "trading",
    "wholesale": "trading",
    "retail": "trading",
    "distribution": "trading",
    "shop": "trading",
    "store": "trading",
    "fmcg": "trading",
    "agriculture": "agriculture",
    "agri": "agriculture",
    "farming": "agriculture",
}


# ─────────────────────────────────────────────────────────────────────────────
# PRODUCT ITEM
# ─────────────────────────────────────────────────────────────────────────────
class ProductItem(BaseModel):
    category: str = "Green Tea (500g pack)"
    units_per_month: float = 500
    avg_price: float = 420
    purchase_price: float = Field(default=0.0)
    monthly_revenue: float = 210000
    mix_pct: float = 100.0

class ProjectCostLine(BaseModel):
    code: int
    particulars: str
    amount: float


# ─────────────────────────────────────────────────────────────────────────────
# MASTER INPUT MODEL  (all fields your website form needs to send)
# ─────────────────────────────────────────────────────────────────────────────
class MasterInput(BaseModel):

    # ── ENTREPRENEUR / APPLICANT ──────────────────────────────────────────────
    entrepreneur_name: str = Field(default="", description="Full name of entrepreneur")
    title: str = Field(default="", description="Title: Ms. / Mr. / Mrs.")
    full_name: str = Field(default="", description="Full legal name (for applicant section)")
    fathers_name: str = Field(default="")
    date_of_birth: str = Field(default="1985-01-01")
    gender: str = Field(default="Female")
    education: str = Field(default="Graduate")
    social_category: str = Field(default="OBC")
    pan_number: str = Field(default="")
    aadhar_number: str = Field(default="")
    mobile: str = Field(default="")
    email: str = Field(default="")
    address: str = Field(default="")
    years_of_experience: int = Field(default=10)
    previous_employer: str = Field(default="Self / own setup")
    previous_role: str = Field(default="Promoter / Proprietor")
    business_status: str = Field(default="New / Proposed Business")

    # ── BUSINESS ─────────────────────────────────────────────────────────────
    business_name: str = Field(default="Proposed Business")
    nature_of_business: str = Field(default="Green Tea Processing")
    business_type: str = Field(default="Proprietorship")
    industry: str = Field(default="Food Processing")
    commencement_date: str = Field(default="2026-04-01")
    store_address: str = Field(default="")
    primary_location: str = Field(default="")
    market_size: str = Field(default="Regional / State level")
    market_growth: str = Field(default="10-15% annually")
    expected_employment: int = Field(default=4)
    gross_margin_pct: float = Field(default=100.0, description="Gross margin %. 100 = no COGS deduction")

    # ── PRODUCTS ─────────────────────────────────────────────────────────────
    products: List[ProductItem] = Field(default=[ProductItem()])
    project_cost_items: List[ProjectCostLine] = Field(default=[
        ProjectCostLine(code=1, particulars="Land", amount=0),
        ProjectCostLine(code=2, particulars="Factory / Shed", amount=200000),
        ProjectCostLine(code=3, particulars="Plant & Machinery", amount=300000),
        ProjectCostLine(code=4, particulars="Initial Expenditure", amount=50000),
        ProjectCostLine(code=5, particulars="Working Capital", amount=90900),
    ])

    # ── LOAN ─────────────────────────────────────────────────────────────────
    scheme: str = Field(default="PMEGP")
    loan_type: str = Field(default="Term Loan")
    term_loan_amount: float = Field(default=385000)
    working_capital_loan: float = Field(default=56000)
    term_loan_amount_override: Optional[float] = None
    working_capital_loan_override: Optional[float] = None
    margin_money_override: Optional[float] = None
    promoter_contribution_override: Optional[float] = None
    loan_interest_rate_pct: float = Field(default=9.5, description="CMA loan interest rate %")
    tenure_months: int = Field(default=60)
    moratorium_months: int = Field(default=0)
    processing_fee_pct: float = Field(default=1.0)
    collateral: str = Field(default="Hypothecation of current and fixed assets")
    guarantor: str = Field(default="As per sanction terms")
    promoter_contribution: float = Field(default=199900)
    total_working_capital_requirement: float = Field(default=90900)

    # ── EXPENSES (CMA) ────────────────────────────────────────────────────────
    rent: float = Field(default=0)
    num_employees: int = Field(default=4)
    salary_per_employee: float = Field(default=10000)
    stationery: float = Field(default=2000)
    electricity_water: float = Field(default=32424)
    repair_maintenance: float = Field(default=2000)
    transport_conveyance: float = Field(default=5000)
    telephone_internet: float = Field(default=1500)
    marketing_advertising: float = Field(default=31500)
    miscellaneous: float = Field(default=3000)
    raw_material_monthly: float = Field(default=340350)
    marketing_expense_pct_cma: float = Field(default=0, description="If >0, overrides marketing_advertising")

    # ── CMA DEPRECIATION ASSETS ───────────────────────────────────────────────
    cma_building_assets: float = Field(default=200000, description="Building asset value for CMA dep calculation")
    cma_machinery_assets: float = Field(default=300000, description="Machinery asset value for CMA dep calculation")
    cma_building_dep_pct: float = Field(default=5.0)
    cma_machinery_dep_pct: float = Field(default=10.0)
    cma_dep_rate_pct: float = Field(default=10.0, description="WDV dep rate for 5-yr CMA projections")

    # ── CMA GROWTH ASSUMPTIONS ────────────────────────────────────────────────
    revenue_growth_pct: float = Field(default=7.0)
    salary_increase_pct: float = Field(default=10.0)
    admin_increase_pct: float = Field(default=5.0)
    tax_rate_pct: float = Field(default=0.0)
    stock_holding_days: int = Field(default=30)
    debtor_days: int = Field(default=30)
    creditor_days: int = Field(default=15)
    minimum_cash_balance: float = Field(default=50000)

    # ── SCORECARD OVERRIDES ───────────────────────────────────────────────────
    sc_market: float = Field(default=8.0, ge=1, le=10)
    sc_competitive: float = Field(default=8.0, ge=1, le=10)
    sc_business_model: float = Field(default=8.0, ge=1, le=10)
    sc_promoter_exp: float = Field(default=9.0, ge=1, le=10)
    sc_fin_contrib: float = Field(default=9.0, ge=1, le=10)

    # ── DPR — MACHINES (1-3 get 20% loading, 4 does not) ─────────────────────
    machine1_name: str = Field(default="Steamer for Green Tea")
    machine2_name: str = Field(default="Rolling Table")
    machine3_name: str = Field(default="Sorting Machine")
    machine4_name: str = Field(default="Tools, Trays, Racks & Electrification")
    machine1_qty: int = Field(default=1)
    machine2_qty: int = Field(default=1)
    machine3_qty: int = Field(default=1)
    machine4_qty: int = Field(default=1)
    machine1_base_price: float = Field(default=70000, description="Base price before 20% loading")
    machine2_base_price: float = Field(default=110000)
    machine3_base_price: float = Field(default=40000)
    machine4_price: float = Field(default=36000, description="Direct price, no loading")

    # ── DPR — PRODUCTION ─────────────────────────────────────────────────────
    working_days_per_year: int = Field(default=300)
    fresh_leaves_per_day_kg: float = Field(default=100, description="Fresh leaves processed per day (kg)")
    yield_rate: float = Field(default=0.20, description="Decimal: 0.20 = 20%")
    hours_of_operation: float = Field(default=8)

    # ── DPR — PRICING & RAW MATERIAL ─────────────────────────────────────────
    selling_price_per_kg: float = Field(default=420)
    cost_fresh_leaves_per_kg: float = Field(default=20)
    cost_consumables_per_kg: float = Field(default=2.5)
    cost_pet_bottle: float = Field(default=9.5)

    # ── DPR — BUILDING ───────────────────────────────────────────────────────
    cost_per_sqft: float = Field(default=500)
    built_up_area_sqft: float = Field(default=400)

    # ── DPR — HR & WAGES ─────────────────────────────────────────────────────
    promoter_daily_wage: float = Field(default=900)
    skilled_worker_daily_wage: float = Field(default=500)
    num_skilled_workers: int = Field(default=2)
    semi_skilled_daily_wage: float = Field(default=400)
    num_semi_skilled_workers: int = Field(default=1)
    hr_perquisites_rate: float = Field(default=0.10, description="Fraction: 0.10 = 10%")
    admin_expense_per_month: float = Field(default=2500)

    # ── DPR — FINANCIAL ASSUMPTIONS ──────────────────────────────────────────
    contingency_rate: float = Field(default=0.10)
    term_loan_pct: float = Field(default=0.70)
    wc_loan_pct: float = Field(default=0.60)
    term_loan_interest: float = Field(default=0.095, description="Decimal: 0.095 = 9.5%")
    wc_interest_rate: Optional[float] = Field(default=DEFAULT_WC_INTEREST_RATE)
    salary_increase_rate: float = Field(default=0.10)
    admin_increase_rate: float = Field(default=0.05)
    marketing_expense_pct: float = Field(default=0.025, description="Fraction of revenue")

    # ── DPR — POWER ──────────────────────────────────────────────────────────
    power_rate_per_unit: float = Field(default=9.65)
    connected_load_kw: float = Field(default=7)
    load_factor: float = Field(default=0.8)
    hours_of_load_operation: float = Field(default=4)

    # ── DPR — DEPRECIATION ───────────────────────────────────────────────────
    building_dep_rate_slm: float = Field(default=0.05)
    machinery_dep_rate_slm: float = Field(default=0.10)

    # ── DPR — WORKING CAPITAL HOLDING DAYS ───────────────────────────────────
    wc_raw_material_days: int = Field(default=1)
    wc_wip_days: int = Field(default=5)
    wc_finished_goods_days: int = Field(default=15)
    wc_working_expenses_days: int = Field(default=30)

    # ── DPR — CAPACITY UTILISATION PER YEAR ──────────────────────────────────
    capacity_y1: float = Field(default=DEFAULT_CAPACITY_SCHEDULE[0])
    capacity_y2: float = Field(default=DEFAULT_CAPACITY_SCHEDULE[1])
    capacity_y3: float = Field(default=DEFAULT_CAPACITY_SCHEDULE[2])
    capacity_y4: float = Field(default=DEFAULT_CAPACITY_SCHEDULE[3])
    capacity_y5: float = Field(default=DEFAULT_CAPACITY_SCHEDULE[4])

    # ── DPR — LOAN TENURE ────────────────────────────────────────────────────
    loan_tenure_years: int = Field(default=5)
    moratorium_years: int = Field(default=1)

    # ── PMEGP ─────────────────────────────────────────────────────────────────
    area_type: str = Field(default="Rural", description="Urban or Rural — determines PMEGP margin money rate")

    # ── BANK / LENDER ────────────────────────────────────────────────────────────
    bank_name:      str = Field(default="", description="Preferred bank / lender (from Step 9)")
    preferred_bank: str = Field(default="", description="Alias for bank_name")

    # ── DPR — LOCATION (shared with entrepreneur fields above) ────────────────
    location: str = Field(default="")
    district: str = Field(default="")
    input_summary: Optional[dict[str, Any]] = Field(
        default=None,
        description="Optional non-calculation metadata showing industry-specific customer inputs for reporting/audit display.",
    )


# ─── CLEANUP UTILITIES ────────────────────────────────────────────────────────

def cleanup_stale_reports(entrepreneur_name: Optional[str] = None):
    """
    1. Removes JSON files in REPORTS_DIR for the same entrepreneur (if name provided).
    2. Removes ANY PDF or JSON files in REPORTS_DIR or TEMP that are older than 2 hours.
    """
    now = time.time()
    two_hours_ago = now - (2 * 3600)

    # 1. Clean up same-name reports (keep only the newest one)
    if entrepreneur_name:
        safe_name = _safe_filename(entrepreneur_name)
        pattern = os.path.join(REPORTS_DIR, f"*cma_{safe_name}_*.json")
        for old_json in glob.glob(pattern):
            try:
                os.remove(old_json)
            except:
                pass

    # 2. General cleanup for stale files (> 2 hours)
    # JSONs in REPORTS_DIR
    for f in os.listdir(REPORTS_DIR):
        path = os.path.join(REPORTS_DIR, f)
        if os.path.isfile(path) and os.path.getmtime(path) < two_hours_ago:
            try:
                os.remove(path)
            except:
                pass

    # PDFs in TEMP
    temp_dir = tempfile.gettempdir()
    for f in os.listdir(temp_dir):
        if f.startswith("cma_dpr_") and f.endswith(".pdf"):
            path = os.path.join(temp_dir, f)
            if os.path.isfile(path) and os.path.getmtime(path) < two_hours_ago:
                try:
                    os.remove(path)
                except:
                    pass

# ─────────────────────────────────────────────────────────────────────────────
# CORE FUNCTION
# ─────────────────────────────────────────────────────────────────────────────

def master_calculate(inp: MasterInput) -> dict:
    """Runs both DPR and CMA engines on the input and returns combined result."""
    return master_calculate_for_industry(inp, None)


def resolve_industry(inp: MasterInput, industry: Optional[str] = None) -> str:
    raw = (industry or inp.industry or "").strip().lower()
    for key, value in INDUSTRY_ALIASES.items():
        if key in raw:
            return value
    return "manufacturing"


def normalize_industry_input(d: dict, industry: str) -> dict:
    """Normalize non-manufacturing inputs without changing the original manufacturing path."""
    if industry == "manufacturing":
        return d

    normalized = dict(d)
    normalized["industry_type"] = industry
    normalized["working_days_per_year"] = 365 if industry in ("service", "trading") else normalized.get("working_days_per_year", 300)
    normalized["fresh_leaves_per_day_kg"] = 0
    normalized["yield_rate"] = 1
    normalized["hours_of_operation"] = 0
    normalized["cost_fresh_leaves_per_kg"] = 0
    normalized["cost_consumables_per_kg"] = 0
    normalized["cost_pet_bottle"] = 0
    normalized["power_rate_per_unit"] = 0
    normalized["connected_load_kw"] = 0
    normalized["load_factor"] = 0
    normalized["hours_of_load_operation"] = 0
    normalized["wc_wip_days"] = 0

    if industry == "service":
        normalized["stock_holding_days"] = 0
        normalized["wc_raw_material_days"] = 0
        normalized["wc_finished_goods_days"] = 0
        normalized["gross_margin_pct"] = normalized.get("gross_margin_pct") or 100
    elif industry == "trading":
        normalized["wc_raw_material_days"] = normalized.get("stock_holding_days", 30)
        normalized["wc_finished_goods_days"] = normalized.get("stock_holding_days", 30)
    elif industry == "agriculture":
        normalized["wc_raw_material_days"] = normalized.get("stock_holding_days", 30)
        normalized["wc_finished_goods_days"] = normalized.get("stock_holding_days", 30)
        
        # Avoid manufacturing labour double-counting
        normalized["skilled_worker_daily_wage"] = 0
        normalized["semi_skilled_daily_wage"] = 0
        normalized["unskilled_daily_wage"] = 0
        normalized["promoter_daily_wage"] = 0
        
        products = d.get("products", [])
        if products:
            total_rev = sum(p.get("units_per_month", 0) * p.get("avg_price", 0) for p in products)
            total_cogs = sum(p.get("units_per_month", 0) * p.get("purchase_price", 0) for p in products)
            if total_rev > 0:
                normalized["raw_material_monthly"] = total_cogs
                normalized["cogs_monthly"] = total_cogs
                normalized["cogs_pct_override"] = (total_cogs / total_rev) * 100
                normalized["gross_margin_pct"] = 100
                normalized["selling_price_per_unit"] = total_rev
                normalized["expected_monthly_revenue"] = total_rev

    return normalized


def dpr_from_cma(d: dict, cma: dict, industry: str) -> dict:
    """Builds a DPR-compatible response from CMA results for non-production industries."""
    total_project_cost = R(cma.get("total_project_cost", 0), 2)
    term_loan = R(cma.get("term_loan", 0), 2)
    wc_loan = R(cma.get("working_capital_loan", 0), 2)
    promoter = R(cma.get("promoter_contribution", max(total_project_cost - term_loan - wc_loan, 0)), 2)
    debt_equity = round((term_loan + wc_loan) / promoter, 2) if promoter else 0
    annual_dep = R(cma.get("annual_dep", 0), 2)
    building_assets = R(d.get("cma_building_assets", 0), 2)
    machinery_assets = R(d.get("cma_machinery_assets", 0), 2)
    gross_block = R(building_assets + machinery_assets, 2)
    years = cma.get("projections_5yr", [])
    yr_schedule = cma.get("yr_schedule", [])
    products = d.get("products", [])
    project_items = cma.get("project_cost_items") or d.get("project_cost_items", [])
    equipment_items = [
        item for item in project_items
        if not any(term in str(item.get("particulars", "")).lower() for term in ("land", "working capital"))
    ]
    if not equipment_items:
        equipment_items = [{"particulars": "Fixed Assets / Equipment", "amount": gross_block}]

    machinery = {
        "items": [
            {
                "name": item.get("particulars", "Fixed Assets / Equipment"),
                "qty": 1,
                "unit_price": R(item.get("amount", 0), 2),
                "total": R(item.get("amount", 0), 2),
            }
            for item in equipment_items[:4]
        ],
        "total": R(sum(float(item.get("amount", 0) or 0) for item in equipment_items), 2),
    }

    p_and_l = []
    reserves = 0.0
    base_sales = R(cma.get("annual_revenue", 0), 2)
    base_cogs = R(cma.get("cogs_monthly", 0) * 12, 2)
    
    base_labour = R(cma.get("fixed_salary", 0) * 12, 2)
    base_salary = R(base_labour / (1 + d.get("hr_perquisites_rate", 0)), 2) if d.get("hr_perquisites_rate", 0) else base_labour
    base_benefits = R(base_labour - base_salary, 2)
    
    base_marketing = R(cma.get("mktg_monthly", 0) * 12, 2)
    base_power = R(d.get("electricity_water", 0) * 12, 2)
    sal_hike = float(d.get("salary_increase_pct", 10) or 10) / 100
    # Separate WC interest from TL interest (CMA engine provides combined in "interest")
    base_wc_interest_annual = R(
        cma.get("working_capital_loan", 0) * resolve_wc_interest_rate(d.get("wc_interest_rate")), 2
    )
    base_tl_interest_annual = R(cma.get("yr1_interest", cma.get("annual_emi", 0)), 2)
    for row in years:
        sales = R(row.get("sales", 0), 2)
        sales_factor = sales / base_sales if base_sales else 1
        yr_num = len(p_and_l) + 1
        raw_materials = R(base_cogs * sales_factor, 2)
        # Salary grows at salary_hike rate, compounded from year 1
        labour = R(base_labour * (1 + sal_hike) ** (yr_num - 1), 2)
        marketing = R(base_marketing * sales_factor, 2)
        power = R(base_power * sales_factor, 2)
        total_interest = R(row.get("interest", 0), 2)
        # Split combined interest: WC portion vs TL portion
        wc_int  = R(base_wc_interest_annual, 2)
        tl_int  = R(max(total_interest - wc_int, 0), 2)
        dep_yr  = R(row.get("depreciation", annual_dep), 2)
        operating_expenses = R(row.get("expenses", 0), 2)
        admin_expenses = R(max(operating_expenses - raw_materials - labour - marketing - power, 0), 2)
        pat = R(row.get("profit_after_tax", 0), 2)
        reserves = R(reserves + pat, 2)
        p_and_l.append({
            "year":              yr_num,
            "capacity":          row.get("capacity", d.get(f"capacity_y{yr_num}", DEFAULT_CAPACITY_SCHEDULE[yr_num - 1])),
            "revenue":           sales,
            "raw_materials":     raw_materials,
            "power":             power,
            "labour":            labour,
            "total_variable":    R(raw_materials + power, 2),
            "depreciation":      dep_yr,
            "admin_expenses":    admin_expenses,
            "marketing_expenses":marketing,
            "wc_interest":       wc_int,
            "tl_interest":       tl_int,
            "total_expenses":    R(operating_expenses + dep_yr + total_interest, 2),
            "net_profit":        pat,
            "profit_before_tax": R(row.get("profit_before_tax", pat), 2),
            "tax":               R(row.get("tax", 0), 2),
            "reserves_surplus":  reserves,
            "cash_accruals":     R(pat + dep_yr, 2),
        })

    if not p_and_l:
        p_and_l = [{
            "year": 1, "capacity": d.get("capacity_y1", DEFAULT_CAPACITY_SCHEDULE[0]), "revenue": R(cma.get("annual_revenue", 0), 2),
            "raw_materials": 0.0, "power": 0.0, "labour": 0.0,
            "total_variable": R(cma.get("total_monthly_exp", 0) * 12, 2),
            "depreciation": annual_dep, "admin_expenses": R(cma.get("total_monthly_exp", 0) * 12, 2),
            "marketing_expenses": 0.0, "wc_interest": 0.0, "tl_interest": R(cma.get("yr1_interest", 0), 2),
            "total_expenses": R(cma.get("total_monthly_exp", 0) * 12 + annual_dep + cma.get("yr1_interest", 0), 2),
            "net_profit": R(cma.get("annual_pat", 0), 2), "reserves_surplus": R(cma.get("annual_pat", 0), 2),
            "cash_accruals": R(cma.get("annual_pat", 0) + annual_dep, 2),
        }]

    while len(p_and_l) < 5:
        prev = p_and_l[-1]
        next_row = dict(prev)
        next_row["year"] = len(p_and_l) + 1
        p_and_l.append(next_row)

    wc_years = []
    base_wc = R(max(cma.get("input_working_capital", 0), cma.get("total_ca", 0), 0), 2)
    wc_ratio = wc_loan / base_wc if base_wc else 0
    for idx, row in enumerate(p_and_l[:5]):
        sales_factor = row["revenue"] / base_sales if base_sales else 1
        stock = R(cma.get("stock_req", 0) * sales_factor, 2) if industry != "service" else 0.0
        debtors = R(cma.get("debtors", 0) * sales_factor, 2)
        creditors = R(cma.get("creditors", 0) * sales_factor, 2)
        cash_min = R(cma.get("cash_min", 0), 2)
        total_ca = R(stock + debtors + cash_min, 2)
        total_wc = R(max(total_ca, base_wc if idx == 0 else 0), 2)
        bank_loan = R(min(total_wc * wc_ratio, total_wc), 2)
        wc_years.append({
            "year": row["year"],
            "rm_wc": stock,
            "wip_wc": 0.0,
            "fg_wc": debtors,
            "we_wc": cash_min,
            "total": total_wc,
            "bank_loan": bank_loan,
            "margin": R(max(total_wc - bank_loan, 0), 2),
            "wc_interest": R(bank_loan * resolve_wc_interest_rate(d.get("wc_interest_rate")), 2),
        })

    opening_current_assets = wc_years[0]["total"] if wc_years else base_wc

    balance_sheet = [{
        "year": 0,
        "equity": promoter,
        "term_loan": term_loan,
        "reserves": 0.0,
        "wc_bank": wc_years[0]["bank_loan"] if wc_years else wc_loan,
        "land": 0.0 if industry != "manufacturing" else R(d.get("project_cost_items", [{}])[0].get("amount", 0), 2),
        "gross_block": gross_block,
        "other_assets": R(max(total_project_cost - gross_block - opening_current_assets, 0), 2),
        "accum_dep": 0.0,
        "net_block": gross_block,
        "current_assets": opening_current_assets,
        "cash": 0.0,
    }]

    accum_dep = 0.0
    for idx, row in enumerate(p_and_l[:5]):
        schedule = yr_schedule[idx] if idx < len(yr_schedule) else {}
        accum_dep = R(accum_dep + row.get("depreciation", annual_dep), 2)
        balance_sheet.append({
            "year": row["year"],
            "equity": promoter,
            "term_loan": R(schedule.get("closing_balance", max(term_loan - idx * (term_loan / 5 if term_loan else 0), 0)), 2),
            "reserves": row.get("reserves_surplus", 0),
            "wc_bank": wc_years[idx]["bank_loan"] if idx < len(wc_years) else wc_loan,
            "land": balance_sheet[0]["land"],
            "gross_block": gross_block,
            "other_assets": balance_sheet[0]["other_assets"],
            "accum_dep": accum_dep,
            "net_block": R(max(gross_block - accum_dep, 0), 2),
            "current_assets": wc_years[idx]["total"] if idx < len(wc_years) else opening_current_assets,
            "cash": 0.0,
        })

    _tally_projected_balance_sheet(balance_sheet)

    cash_flow = []
    opening_cash = 0.0
    for idx, row in enumerate(p_and_l[:5]):
        schedule = yr_schedule[idx] if idx < len(yr_schedule) else {}
        prev_wc_bank = balance_sheet[idx]["wc_bank"] if idx < len(balance_sheet) else wc_loan
        curr_wc_bank = balance_sheet[idx + 1]["wc_bank"] if idx + 1 < len(balance_sheet) else prev_wc_bank
        prev_current_assets = balance_sheet[idx]["current_assets"] if idx < len(balance_sheet) else opening_current_assets
        curr_current_assets = balance_sheet[idx + 1]["current_assets"] if idx + 1 < len(balance_sheet) else prev_current_assets
        inc_wc_loan = R(curr_wc_bank - prev_wc_bank, 2)
        inc_current_assets = R(curr_current_assets - prev_current_assets, 2)
        sources = R(row.get("cash_accruals", 0) + max(inc_wc_loan, 0), 2)
        uses = R(schedule.get("principal_paid", 0) + max(inc_current_assets, 0), 2)
        surplus = R(sources - uses, 2)
        closing_cash = R(opening_cash + surplus, 2)
        cash_flow.append({
            "year": row["year"],
            "opening_cash": opening_cash,
            "cash_accruals": sources,
            "inc_wc_loan": inc_wc_loan,
            "total_sources": sources,
            "inc_current_assets": inc_current_assets,
            "tl_repayment": uses,
            "total_uses": uses,
            "surplus": surplus,
            "closing_cash": closing_cash,
        })
        opening_cash = closing_cash

    dscr_years = []
    for idx, row in enumerate(p_and_l[:5]):
        schedule = yr_schedule[idx] if idx < len(yr_schedule) else {}
        total_a = R(row.get("cash_accruals", 0) + schedule.get("interest_paid", 0), 2)
        total_b = R(schedule.get("principal_paid", 0) + schedule.get("interest_paid", 0), 2)
        dscr_years.append({
            "year": row["year"],
            "cash_accruals": row.get("cash_accruals", 0),
            "tl_interest": R(schedule.get("interest_paid", 0), 2),
            "total_a": total_a,
            "tl_repayment": R(schedule.get("principal_paid", 0), 2),
            "total_b": total_b,
            "dscr": R(total_a / total_b, 2) if total_b else 0.0,
        })

    annual_revenue = R(cma.get("annual_revenue", 0), 2)
    break_even_years = []
    for row in p_and_l[:5]:
        contribution = R(row["revenue"] - row["total_variable"], 2)
        operating_fixed = R(
            row.get("depreciation", 0)
            + row.get("wc_interest", 0)
            + row.get("tl_interest", 0),
            2,
        )
        break_even_years.append({
            "year": row["year"],
            "revenue": row["revenue"],
            "variable_expenses": row["total_variable"],
            "contribution": contribution,
            "contribution_pct": R(contribution / row["revenue"], 4) if row["revenue"] else 0,
            "operating_fixed_expenses": operating_fixed,
            "net_profit": R(contribution - operating_fixed, 2),
            "fixed_expenses": R(row["depreciation"] + row["tl_interest"], 2),
            "bep_sales": R(cma.get("breakeven_revenue", 0), 2),
            "bep_pct": R(cma.get("breakeven_revenue", 0) / annual_revenue, 4) if annual_revenue else 0,
        })

    return {
        "project_summary": {
            "entrepreneur_name": d.get("entrepreneur_name", ""),
            "title": d.get("title", ""),
            "location": d.get("location", ""),
            "district": d.get("district", ""),
            "annual_production_kg": 0.0,
            "revenue_at_100pct": annual_revenue,
        },
        "machinery": machinery,
        "raw_materials": {"leaves_cost": 0.0, "consumables_cost": 0.0, "bottles_cost": 0.0, "total": 0.0, "annual_leaves_qty": 0.0},
        "manpower": {
            "promoter_annual": 0.0,
            "skilled_annual": R(d.get("salary_per_employee", 0) * 12, 2),
            "semi_skilled_annual": 0.0,
            "num_skilled": d.get("num_employees", 0),
            "num_semi": 0,
            "base_wages": base_salary,
            "benefits": base_benefits,
            "total_wages": base_labour,
        },
        "project_cost": {
            "building_cost": building_assets,
            "machinery_cost": machinery_assets,
            "contingency": R(sum(item.get("amount", 0) for item in project_items if "initial" in str(item.get("particulars", "")).lower()), 2),
            "working_capital": R(cma.get("input_working_capital", cma.get("net_wc", 0)), 2),
            "total_project_cost": total_project_cost,
            "equity_capital": promoter,
            "term_loan": term_loan,
            "wc_loan": wc_loan,
            "total_finance": R(promoter + term_loan + wc_loan, 2),
            "debt_equity_ratio": debt_equity,
        },
        "depreciation": {
            "building_gross": building_assets,
            "machinery_gross": machinery_assets,
            "gross_block": gross_block,
            "dep_building_slm": R(building_assets * d.get("building_dep_rate_slm", 0), 2),
            "dep_machinery_slm": R(machinery_assets * d.get("machinery_dep_rate_slm", 0), 2),
            "total_per_year": annual_dep,
        },
        "term_loan": {
            "amount": term_loan,
            "interest_rate": d.get("term_loan_interest", 0),
            # Read off the actual schedule rather than recomputing term_loan/(tenure*2) —
            # that formula ignores moratorium and disagrees with the schedule's own
            # principal_repaid figures whenever moratorium > 0.
            "half_yearly_instalment": R(yr_schedule[0].get("half_yearly_instalment", 0), 2) if yr_schedule else 0.0,
            "total_interest": R(cma.get("total_interest_outgo", 0), 2),
            "schedule": [
                {
                    "year": row.get("year", idx + 1),
                    "opening": R(row.get("opening_balance", 0), 2),
                    "mid": R((row.get("opening_balance", 0) + row.get("closing_balance", 0)) / 2, 2),
                    "closing": R(row.get("closing_balance", 0), 2),
                    "int_h1": R(row.get("interest_paid", 0) / 2, 2),
                    "int_h2": R(row.get("interest_paid", 0) / 2, 2),
                    "total_interest": R(row.get("interest_paid", 0), 2),
                    "principal_repaid": R(row.get("principal_paid", 0), 2),
                }
                for idx, row in enumerate(yr_schedule[:5])
            ],
        },
        "working_capital_years": wc_years,
        "profit_and_loss_years": p_and_l[:5],
        "balance_sheet_years": balance_sheet,
        "cash_flow_years": cash_flow,
        "breakeven_years": break_even_years,
        "dscr": {"years": dscr_years, "average": R(cma.get("avg_dscr", cma.get("avg_dscr_5yr", 0)), 2)},
        "profitability": {
            "reference_year": 3,
            "sales": R(p_and_l[2]["revenue"] if len(p_and_l) > 2 else annual_revenue, 2),
            "total_investment": total_project_cost,
            "capital_employed": promoter,
            "pbidt": R(cma.get("annual_ebitda", 0), 2),
            "pbidt_pct_sales": R(cma.get("ebitda_margin_pct", 0) / 100, 4),
            "pat": R(cma.get("annual_pat", 0), 2),
            "pat_pct_sales": R(cma.get("net_margin_pct", 0) / 100, 4),
        },
    }


def master_calculate_for_industry(inp: MasterInput, industry: Optional[str] = None) -> dict:
    """Runs industry-aware calculations. Manufacturing remains the original path."""
    d = inp.model_dump()
    d["products"] = [p.model_dump() for p in inp.products]
    d["project_cost_items"] = [i.model_dump() for i in inp.project_cost_items]
    resolved_industry = resolve_industry(inp, industry)
    d = normalize_industry_input(d, resolved_industry)

    if resolved_industry == "manufacturing":
        dpr_result: Any = run_dpr(d)
    else:
        dpr_result = None

    cma_result: Any = dpr_result.get("cma_summary") if dpr_result else None
    if cma_result is None:
        cma_result = run_cma(d)

    if dpr_result is None:
        dpr_result = dpr_from_cma(d, cma_result, resolved_industry)
    
    # Ensure they are dicts for the IDE
    cma_result = cast(dict, cma_result) if cma_result else {}
    dpr_result = cast(dict, dpr_result) if dpr_result else {}

    warnings: list = []
    dscr_y1 = cma_result.get("dscr_y1", 0)
    annual_pat = cma_result.get("annual_pat", 0)
    # CA Rule: REJECT recommendation is set in scorecard; do NOT block PDF generation.
    # The PDF must always render so the applicant and banker can see the issues.
    if dscr_y1 < 1.0 or annual_pat < 0:
        warnings.append(
            f"FINANCIAL VIABILITY WARNING: DSCR={dscr_y1:.2f}x (min 1.0), "
            f"Annual PAT=Rs.{annual_pat:,.0f}. Recommendation will be REJECT."
        )

    if resolved_industry == "trading":
        # 1. Preliminary Expense Validation
        project_items = d.get("project_cost_items", [])
        pre_op = sum(float(i.get("amount", 0) or 0) for i in project_items if "pre-operative" in str(i.get("particulars", "")).lower() or "initial" in str(i.get("particulars", "")).lower())
        total_pc = float(dpr_result.get("project_cost", {}).get("total_project_cost", 0))
        if total_pc > 0 and pre_op > 0.15 * total_pc:
            raise ValueError(f"For trading businesses, preliminary expenses cannot exceed 15% of the total project cost. Currently at {round((pre_op/total_pc)*100, 2)}%.")
            
        # 2. Revenue and COGS Validation (Block generation if mismatch)
        products = d.get("products", [])
        if products:
            calc_rev = sum(float(p.get("units_per_month", 0) or 0) * float(p.get("avg_price", 0) or 0) for p in products)
            calc_cogs = sum(float(p.get("units_per_month", 0) or 0) * float(p.get("purchase_price", 0) or 0) for p in products)
            cma_rev = float(cma_result.get("net_monthly_revenue") or cma_result.get("gross_monthly_revenue") or 0)
            cma_cogs = float(cma_result.get("raw_material_monthly") or cma_result.get("cogs_monthly") or 0)
            # Tolerance = 5% of calculated revenue (not a fixed ±2 rupees)
            rev_tolerance = max(calc_rev * 0.05, 10.0)
            cogs_tolerance = max(calc_cogs * 0.05, 10.0)
            if calc_rev > 0 and abs(cma_rev - calc_rev) > rev_tolerance:
                warnings.append(
                    f"Revenue mismatch: Product lines sum Rs.{calc_rev:,.0f} "
                    f"but CMA engine used Rs.{cma_rev:,.0f} — check gross_margin_pct."
                )
            if calc_cogs > 0 and abs(cma_cogs - calc_cogs) > cogs_tolerance:
                warnings.append(
                    f"COGS mismatch: Product lines imply Rs.{calc_cogs:,.0f} "
                    f"but CMA engine used Rs.{cma_cogs:,.0f}."
                )

    # Collect warnings from both DPR and any viability checks above
    existing_warnings = dpr_result.get("warnings", [])
    warnings = warnings + existing_warnings if warnings else existing_warnings

    # ── PMEGP Finance Split ───────────────────────────────────────────────────
    pmegp_finance = None
    if d.get("scheme", "").strip().lower() == "pmegp":
        pc = cast(dict, dpr_result["project_cost"])
        # PMEGP subsidy applies to fixed capital only (total minus WC bank loan)
        pmegp_project_cost = R(
            float(pc.get("total_project_cost") or 0) - float(pc.get("wc_loan") or 0), 2
        )
        pmegp_finance = calculate_pmegp_finance(
            pmegp_project_cost,
            d.get("social_category", "General"),
            d.get("area_type", "Rural"),
            resolved_industry,
            d.get("business_status", ""),
        )
        expected_amounts = {
            "term_loan_amount_override": pmegp_finance["term_loan"],
            "margin_money_override": pmegp_finance["margin_money"],
            "promoter_contribution_override": pmegp_finance["promoter_amount"],
        }
        for key, expected_amount in expected_amounts.items():
            entered_amount = d.get(key)
            if entered_amount is not None and abs(float(entered_amount) - float(expected_amount)) > 1:
                warnings.append(
                    f"PMEGP {key.removesuffix('_override').replace('_', ' ')} is "
                    f"Rs.{float(entered_amount):,.0f}; the scheme-based amount is "
                    f"Rs.{float(expected_amount):,.0f}. Verify against the sanction."
                )

        term_loan = pmegp_finance["term_loan"] if d.get("term_loan_amount_override") is None else max(float(d["term_loan_amount_override"]), 0)
        margin_money = pmegp_finance["margin_money"] if d.get("margin_money_override") is None else max(float(d["margin_money_override"]), 0)
        promoter_amount = pmegp_finance["promoter_amount"] if d.get("promoter_contribution_override") is None else max(float(d["promoter_contribution_override"]), 0)
        # Override dpr project_cost with PMEGP split
        pc["equity_capital"]   = promoter_amount
        pc["margin_money"]     = margin_money
        pc["margin_money_pct"] = R((margin_money / pmegp_project_cost) * 100, 2) if pmegp_project_cost else 0
        pc["term_loan"]        = term_loan
        pc["total_project_cost"] = R(term_loan + float(pc.get("wc_loan", 0) or 0) + promoter_amount, 2)
        pc["total_finance"]    = R(
            promoter_amount
            + margin_money
            + term_loan
            + pc.get("wc_loan", 0),
            2,
        )
        pc["debt_equity_ratio"] = (
            round(term_loan / promoter_amount, 2)
            if promoter_amount else 0
        )
        # Propagate into CMA summary
        cma_result["margin_money"]     = margin_money
        cma_result["margin_money_pct"] = pc["margin_money_pct"]
        cma_result["promoter_contribution"] = promoter_amount
        cma_result["promoter_pct"]     = pmegp_finance["promoter_pct"]
        cma_result["tdr_note"]         = pmegp_finance["tdr_note"]

    # Ensure CMA loan figures perfectly match DPR project cost (handles PMEGP overrides and WC drifts)
    if dpr_result and "project_cost" in dpr_result:
        pc = cast(dict, dpr_result["project_cost"])
        cma_result["term_loan"] = float(pc.get("term_loan") or cma_result.get("term_loan") or 0)
        cma_result["working_capital_loan"] = float(pc.get("wc_loan") or cma_result.get("working_capital_loan") or 0)
        cma_result["total_loan"] = R(float(cma_result["term_loan"] or 0) + float(cma_result["working_capital_loan"] or 0), 2)

    return {
        "meta": {
            "report_id":        str(uuid.uuid4()),
            "industry":         resolved_industry,
            "entrepreneur_name": inp.entrepreneur_name,
            "business_name":    inp.business_name,
            "generated_on":     datetime.now().strftime("%d %b %Y %H:%M"),
            "total_project_cost": dpr_result["project_cost"]["total_project_cost"],
            "pmegp_finance":    pmegp_finance,
            "warnings":         warnings,
        },
        "dpr": dpr_result,
        "cma": cma_result,
        "warnings": warnings,
    }


# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {
        "name": "GTAB Master CMA+DPR API", "version": "4.0.0",
        "endpoints": {
            "POST /master/calculate":      "Full JSON (CMA + DPR) — no PDF",
            "POST /master/generate-report":"Full JSON + generates PDF — returns download link",
            "POST /master/{industry}/calculate": "Industry-specific calculation for manufacturing/service/trading/agriculture",
            "POST /master/{industry}/generate-report": "Industry-specific calculation + generated PDF",
            "GET  /master/download/{id}":  "Download the generated PDF",
        },
        "docs": "/docs"
    }

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.post("/master/calculate", tags=["Master Report"],
          summary="Calculate CMA + DPR — returns full JSON")
def api_calculate(inp: MasterInput):
    """
    Submit all inputs → get complete CMA + DPR calculations as JSON.
    No PDF generated. Use this for live preview on your website.
    """
    try:
        result = master_calculate_for_industry(inp)
        return {"success": True, "data": result}
    except PMEGPValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        print(f"[ERROR] /master/calculate: {e}")
        raise HTTPException(500, "Calculation failed. Check server logs.")


@app.post("/master/{industry}/calculate", tags=["Industry Reports"],
          summary="Calculate industry-specific CMA + DPR-compatible JSON")
def api_calculate_by_industry(industry: str, inp: MasterInput):
    try:
        result = master_calculate_for_industry(inp, industry)
        return {"success": True, "data": result}
    except PMEGPValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        print(f"[ERROR] /master/{{industry}}/calculate ({industry}): {e}")
        raise HTTPException(500, "Calculation failed. Check server logs.")


@app.post("/master/generate-report", tags=["Master Report"],
          summary="Calculate + Generate combined CMA+DPR PDF")
def api_generate_report(inp: MasterInput):
    """
    1. Runs full CMA + DPR calculations
    2. Generates a 22-section formal PDF report
    3. Returns JSON + download link

    PDF Sections: Cover | Executive Summary | A.Applicant | B.Project Details |
    C.Machinery | D.Production & Sales | E.HR | F.Assumptions | G.Depreciation |
    H.Term Loan | I.Working Capital | J.P&L | K.Balance Sheet | L.Cash Flow |
    M.BEP | N.DSCR | O.Monthly P&L | P.Loan Schedule | Q.Ratios |
    R.5-Yr Projections | S.Risk Analysis | T.Scorecard | U.Key Ratios |
    V.Profitability Index | Disclaimer
    """
    try:
        combined = master_calculate_for_industry(inp)
        d = inp.model_dump()
        d["products"] = [p.model_dump() for p in inp.products]
        d["project_cost_items"] = [i.model_dump() for i in inp.project_cost_items]
        d = normalize_industry_input(d, combined["meta"]["industry"])

        # Clean up previous reports for this entrepreneur before generating new one
        cleanup_stale_reports(inp.entrepreneur_name)

        report_id = combined["meta"]["report_id"]
        pdf_path  = os.path.join(tempfile.gettempdir(), f"cma_dpr_{report_id}.pdf")

        build_pdf(d, combined["cma"], combined["dpr"], pdf_path)

        # Save JSON copy
        json_path = os.path.join(REPORTS_DIR,
                    f"cma_{_safe_filename(inp.entrepreneur_name)}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(combined, f, indent=2, ensure_ascii=False)

        return {
            "success":      True,
            "report_id":    report_id,
            "download_url": f"/master/download/{report_id}",
            "saved_as":     os.path.basename(json_path),
            "data":         combined,
        }
    except PMEGPValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        print(f"[ERROR] /master/generate-report: {e}")
        raise HTTPException(500, "Report generation failed. Check server logs.")


@app.post("/master/{industry}/generate-report", tags=["Industry Reports"],
          summary="Calculate + generate industry-specific CMA+DPR-compatible PDF")
def api_generate_report_by_industry(industry: str, inp: MasterInput):
    try:
        resolved_industry = resolve_industry(inp, industry)
        combined = master_calculate_for_industry(inp, resolved_industry)
        d = inp.model_dump()
        d["products"] = [p.model_dump() for p in inp.products]
        d["project_cost_items"] = [i.model_dump() for i in inp.project_cost_items]
        d = normalize_industry_input(d, resolved_industry)

        # Clean up previous reports for this entrepreneur before generating new one
        cleanup_stale_reports(inp.entrepreneur_name)

        report_id = combined["meta"]["report_id"]
        pdf_path = os.path.join(tempfile.gettempdir(), f"cma_dpr_{report_id}.pdf")
        build_pdf(d, combined["cma"], combined["dpr"], pdf_path)

        json_path = os.path.join(
            REPORTS_DIR,
            f"{resolved_industry}_cma_{_safe_filename(inp.entrepreneur_name)}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
        )
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(combined, f, indent=2, ensure_ascii=False)

        return {
            "success": True,
            "report_id": report_id,
            "download_url": f"/master/download/{report_id}",
            "saved_as": os.path.basename(json_path),
            "data": combined,
        }
    except Exception as e:
        print(f"[ERROR] /master/{{industry}}/generate-report ({industry}): {e}")
        raise HTTPException(500, "Report generation failed. Check server logs.")


@app.get("/master/download/{report_id}", tags=["Master Report"],
         summary="Download the generated PDF")
def api_download(report_id: str):
    """Download the PDF generated by /master/generate-report."""
    if not _UUID_RE.match(report_id):
        raise HTTPException(400, "Invalid report ID format")
    path = os.path.join(tempfile.gettempdir(), f"cma_dpr_{report_id}.pdf")
    if not os.path.exists(path):
        raise HTTPException(404, "PDF not found. Please generate it first via POST /master/generate-report")
    name = f"CMA_DPR_Report_{report_id[:8]}.pdf"
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=name,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.post("/scheme/route", tags=["Scheme Router"],
          summary="Route any scheme (PMEGP / MUDRA / CGTMSE / MSME) → financing split")
def api_route_scheme(data: CMAReportInput):
    """
    Universal scheme router.  Pass a structured CMAReportInput and get back
    the correct financing split for whichever scheme is selected.

    Supported schemes
    -----------------
    - pmegp           → Promoter equity + Margin Money subsidy + Term Loan
    - mudra_shishu    → Simplified micro-loan (up to Rs.50K)
    - mudra_kishor    → Light CMA (up to Rs.5L)
    - mudra_tarun     → Full CMA (up to Rs.10L)
    - mudra_tarunplus → Full CMA (up to Rs.20L)
    - cgtmse          → Standard loan + CGTMSE guarantee fee
    - msme_psu        → Standard MSME bank finance
    """
    try:
        result = route_scheme(data)
        return {"success": True, "finance": result}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        print(f"[ERROR] /scheme/calculate: {e}")
        raise HTTPException(status_code=500, detail="Scheme routing failed. Check server logs.")


@app.post("/pmegp/calculate", tags=["PMEGP"],
          summary="Calculate PMEGP financing split (promoter equity, margin money, term loan)")
def pmegp_calculate(
    project_cost: float,
    social_category: str = "General",
    area_type: str = "Rural",
    industry: str = "Manufacturing",
    business_status: str = "New Business",
):
    """
    Standalone PMEGP finance calculator.

    Returns the three-way split of project cost under PMEGP scheme:
    - Promoter Equity (10% General / 5% Special)
    - Margin Money Subsidy (15–35% depending on category + area)
    - Term Loan from Bank (balance)

    Raises 422 if the project violates PMEGP eligibility rules.
    """
    try:
        result = calculate_pmegp_finance(
            project_cost=project_cost,
            social_category=social_category,
            area_type=area_type,
            industry=industry,
            business_status=business_status,
        )
        return {"success": True, "pmegp_finance": result}
    except PMEGPValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        print(f"[ERROR] /pmegp/calculate: {e}")
        raise HTTPException(500, "PMEGP calculation failed. Check server logs.")

# All /api/v1/report/* routes are handled by api/report.py (app.include_router at startup).


@app.get("/reports", tags=["Storage"])
def list_reports():
    files = []
    for f in os.listdir(REPORTS_DIR):
        if f.endswith(".json"):
            path = os.path.join(REPORTS_DIR, f)
            files.append({"filename": f, "size_kb": round(os.path.getsize(path)/1024, 2),
                           "created": datetime.fromtimestamp(os.path.getctime(path)).isoformat()})
    files.sort(key=lambda x: x["created"], reverse=True)
    return {"total": len(files), "reports": files}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
