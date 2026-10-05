"""
models/input_schema.py
======================
Structured Pydantic models for the scheme router.

These nested models are used by CMAReportInput (accepted by POST /scheme/route).
They sit alongside the flat MasterInput in main_master.py without replacing it.
"""

from __future__ import annotations
from enum import Enum
from typing import List, Literal, Optional
from pydantic import BaseModel, Field


# ── Enumerations ──────────────────────────────────────────────────────────────

class SchemeType(str, Enum):
    PMEGP           = "pmegp"
    Mudra_Shishu    = "mudra_shishu"
    Mudra_Kishor    = "mudra_kishor"
    Mudra_Tarun     = "mudra_tarun"
    Mudra_TarunPlus = "mudra_tarunplus"
    CGTMSE          = "cgtmse"
    MSME_PSU        = "msme_psu"


class SocialCategory(str, Enum):
    SC           = "SC"
    ST           = "ST"
    OBC          = "OBC"
    Minority     = "Minority"
    Women        = "Women"
    ExServiceman = "ExServiceman"
    PwD          = "PwD"
    General      = "General"


# ── Sub-models ────────────────────────────────────────────────────────────────

class MachineryItem(BaseModel):
    name:          str   = Field(default="Machinery")
    quantity:      float = Field(default=1)
    unit_price:    float = Field(default=0)
    supplier_name: str   = Field(default="", description="Supplier / vendor name")
    supplier_city: str   = Field(default="", description="Supplier city")
    supplier_phone: str  = Field(default="", description="Supplier contact phone")


class ProductItem(BaseModel):
    """Product/service line from Step 9 revenue section — used in PDF Sections A3 and D."""
    category:        str   = Field(default="Products/Services")
    units_per_month: float = Field(default=0)
    avg_price:       float = Field(default=0)
    purchase_price:  float = Field(default=0,  description="Purchase cost per unit (trading only)")
    monthly_revenue: float = Field(default=0)
    mix_pct:         float = Field(default=0,  description="Revenue mix % for this line")


class ApplicantInfo(BaseModel):
    full_name:        str            = Field(default="")
    fathers_name:     str            = Field(default="")
    date_of_birth:    str            = Field(default="1985-01-01")
    gender:           str            = Field(default="Male")
    education:        str            = Field(default="Graduate")
    social_category:  SocialCategory = Field(default=SocialCategory.General)
    area_type:        str            = Field(default="Rural",
                          description="Urban or Rural — determines PMEGP margin money rate")
    pan_number:       str            = Field(default="")
    aadhar_number:    str            = Field(default="")
    mobile:           str            = Field(default="")
    email:            str            = Field(default="")
    address:          str            = Field(default="")
    years_experience: int            = Field(default=0)
    previous_employer: str           = Field(default="")
    previous_role:    str            = Field(default="")


class BusinessInfo(BaseModel):
    business_name:      str = Field(default="Proposed Business")
    nature_of_business: str = Field(default="")
    business_type:      str = Field(default="Proprietorship")
    industry_type:      str = Field(default="manufacturing",
                            description="manufacturing / service / trading / agriculture / others")
    business_status:    str = Field(default="New Business",
                            description="'New Business' or 'Existing Business'")
    commencement_date:  str = Field(default="")
    location:           str = Field(default="")
    district:           str = Field(default="")
    expected_employment:  int  = Field(default=0)
    implementing_agency:  str  = Field(default="",    description="PMEGP implementing agency (KVIC/KVIB/DIC)")
    is_second_loan:       bool = Field(default=False, description="True if second PMEGP loan")
    gst_number:               str  = Field(default="",  description="GST registration number")
    msme_number:              str  = Field(default="",  description="MSME/Udyam registration number")
    bank_name:                str  = Field(default="",  description="Preferred bank for the loan")
    business_duration_months: int  = Field(default=0,   description="How long the existing business has been operating (months)")
    existing_annual_turnover: float = Field(default=0.0, description="Existing business: last FY audited annual turnover (Rs.)")
    existing_annual_profit:   float = Field(default=0.0, description="Existing business: last FY net profit after tax (Rs.)")
    existing_monthly_emi:     float = Field(default=0.0, description="Existing business: total current loan EMI obligations per month (Rs.)")
    scheme_label:             str  = Field(default="",  description="Custom scheme name when loan_scheme is 'other' — overrides PDF display label")
    primary_raw_material:     str  = Field(default="",  description="Primary raw material / input material name")
    raw_material_supplier:    str  = Field(default="",  description="Primary raw material supplier name")
    collateral_details:       str  = Field(default="Hypothecation of assets", description="Collateral / security details for Section P1")
    guarantor_name:           str  = Field(default="",  description="Guarantor full name (blank = not applicable)")
    guarantor_relation:       str  = Field(default="",  description="Guarantor relationship to promoter")
    processing_fee_pct:       float = Field(default=0.0, description="Loan processing fee as % of term loan amount")


class CompetitorItem(BaseModel):
    """Competitor entry from Step 9 — appears in PDF competitive analysis."""
    name:       str = Field(default="")
    type:       str = Field(default="Organized", description="Organized / Unorganized / Online")
    distance:   str = Field(default="",  description="Distance from business location")
    strengths:  str = Field(default="",  description="Competitor's strengths")
    weaknesses: str = Field(default="",  description="Competitor's weaknesses / gaps we can exploit")


class ProjectInfo(BaseModel):
    land_cost:            float             = Field(default=0)
    building_cost:        float             = Field(default=0)
    machinery_items:      List[MachineryItem] = Field(default_factory=list)
    tools_installation:   float             = Field(default=0)
    # Fixed assets — depreciable (NOT pre-operative)
    computers_cost:       float             = Field(default=0, description="Computers & IT equipment")
    furniture_cost:       float             = Field(default=0, description="Furniture & fixtures")
    electrification_cost: float             = Field(default=0, description="Electrification & wiring")
    racks_storage_cost:   float             = Field(default=0, description="Racks, shelving & storage")
    transportation_cost:  float             = Field(default=0, description="Vehicles & transportation")
    # True pre-operative expense (not depreciable — written off in Y1)
    preliminary_expenses: float             = Field(default=0, description="Other pre-operative / preliminary expenses only")


class ProductionUnit(str, Enum):
    """Unit of measurement for production input and output."""
    kg         = "kg"
    litre      = "litre"
    unit       = "unit"
    metre      = "metre"
    tonne      = "tonne"
    piece      = "piece"
    box        = "box"
    service    = "service"    # for service industry
    month      = "month"      # monthly billing unit
    hour       = "hour"       # hourly billing


class ProductionInfo(BaseModel):
    """Production parameters — works for manufacturing, service, and trading."""
    # ── Quantity & yield (manufacturing / trading) ──────────────────────────
    input_qty_per_day:      float        = Field(default=0,
                                description="Raw input qty per day. Set to 0 for service (use selling_price_per_unit as monthly revenue).")
    output_yield_pct:       float        = Field(default=100,
                                description="Output as % of input (manufacturing yield). 100 = no loss (service/trading).")
    unit:                   ProductionUnit = Field(default=ProductionUnit.unit,
                                description="Unit for input/output quantity (kg, litre, unit, service...)")
    # ── Working calendar ────────────────────────────────────────────────────
    working_days_per_year:  int          = Field(default=300,
                                description="Operating days per year (250-365)")
    hours_of_operation:     float        = Field(default=8,
                                description="Operating hours per day (hours/day)")
    # ── Pricing ─────────────────────────────────────────────────────────────
    selling_price_per_unit: float        = Field(default=0,
                                description="Selling price per unit (Rs/kg, Rs/unit, Rs/service). "
                                            "For service: use as monthly revenue if input_qty_per_day=0.")
    raw_material_cost_per_unit: float    = Field(default=0,
                                description="Direct cost per unit (Rs/kg, Rs/unit). Used for accurate COGS in manufacturing.")


class AssumptionsInfo(BaseModel):
    term_loan_pct:         float = Field(default=75.0, description="% of fixed capital financed by term loan")
    wc_loan_pct:           float = Field(default=60.0, description="% of WC financed by bank")
    capital_subsidy_pct:   float = Field(default=0.0,  description="MSME state capital-investment subsidy % on fixed assets (land+building+P&M). 0 = none.")
    capital_subsidy_scheme_details: str = Field(default="",
                                description="Subsidy scheme name / sanction order no. / sanction date / eligible "
                                            "amount / conditions attached — free text, for bank submission "
                                            "supporting documentation. Optional; shown in the report only when provided.")
    interest_rate_pct:     float = Field(default=10.5)
    tenure_months:         int   = Field(default=60)
    moratorium_months:     int   = Field(default=0)
    revenue_growth_pct:    float = Field(default=7.0)
    expense_growth_pct:    float = Field(default=5.0,  description="Fixed expense growth % p.a. (admin inflation)")
    tax_rate_pct:          float = Field(default=0.0)
    depreciation_pct:      float = Field(default=10.0, description="Machinery WDV depreciation %")
    building_dep_rate_pct: float = Field(default=5.0,  description="Building WDV depreciation % (CA: half of machinery rate)")
    stock_holding_days:    int   = Field(default=0,    description="0 = use industry default (Mfg:30d, Service:0d, Trading:45d)")
    debtor_days:           int   = Field(default=0,    description="0 = use industry default (30d for most)")
    creditor_days:         int   = Field(default=0,    description="0 = use industry default (15d Mfg/Svc, 30d Trading)")
    wip_days:              int   = Field(default=15,   description="WIP holding days for WC calc")
    fg_days:               int   = Field(default=30,   description="Finished goods holding days")
    salary_increase_pct:   float = Field(default=10.0, description="Annual salary hike %")
    contingency_pct:       float = Field(default=0.0,  description="Contingency on P&M as %")
    # Capacity utilisation schedule — 0 = use industry default
    capacity_y1_pct:       float = Field(default=0.0,  description="Year 1 capacity % (0 = industry default: Mfg 50%, Svc 60%)")
    capacity_y2_pct:       float = Field(default=0.0)
    capacity_y3_pct:       float = Field(default=0.0)
    capacity_y4_pct:       float = Field(default=0.0)
    capacity_y5_pct:       float = Field(default=0.0)
    # COGS override — 0 = use industry default (Mfg 55%, Trading 70%, Service 10%)
    cogs_pct_override:     float = Field(default=0.0,  description="Actual COGS % of revenue (0 = use industry default)")
    # Promoter drawings — CA standard: Closing Reserves = Opening + PAT − Drawings.
    # 0 = no drawings assumed (common conservative default for a new/greenfield
    # project's first 5 years) — never invented; explicit user/CA input.
    promoter_drawings_pct: float = Field(default=0.0,  description="% of each year's PAT drawn by the promoter/partners for personal use. 0 = full retention.")
    # Working-capital bank-finance method — banks vary; never hardcode one.
    wc_finance_method:      str   = Field(default="simple_margin",
                                description="'simple_margin' (Bank Finance = WC Requirement x wc_loan_pct) or "
                                            "'drawing_power' (DP = paid-for stock/debtors after margin, less creditors).")
    wc_margin_pct:          float = Field(default=25.0,
                                description="Margin % banks apply to stock/debtors when computing Drawing Power (Tandon-committee-era convention: commonly 25%). Only used when wc_finance_method='drawing_power'.")


class ExpensesInfo(BaseModel):
    """Monthly operating expenses entered by the user (all in Rs./month)."""
    # CA FIX: raw_materials is the single most important COGS input.
    # When production unit-cost params are absent, annual_RM = raw_materials × 12
    # is used as the COGS base, scaled by capacity each year.
    raw_materials:        float = Field(default=0, description="Monthly raw material / purchase cost (Rs./month). Used as COGS base when unit costs not provided.")
    rent:                 float = Field(default=0, description="Monthly rent / lease (Rs./month)")
    electricity_water:    float = Field(default=0)
    repair_maintenance:   float = Field(default=0)
    transport_conveyance: float = Field(default=0)
    telephone_internet:   float = Field(default=0)
    marketing:            float = Field(default=0)
    miscellaneous:        float = Field(default=0)
    stationery:           float = Field(default=0)


class ManpowerInfo(BaseModel):
    """Employee head-count and monthly salary per category."""
    skilled_count:          int   = Field(default=0)
    skilled_salary:         float = Field(default=0,  description="Monthly salary per skilled worker (Rs.)")
    semi_skilled_count:     int   = Field(default=0)
    semi_skilled_salary:    float = Field(default=0,  description="Monthly salary per semi-skilled worker (Rs.)")
    unskilled_count:        int   = Field(default=0)
    unskilled_salary:       float = Field(default=0,  description="Monthly wage per unskilled worker (Rs.)")


class NarrativeInfo(BaseModel):
    """Step 4 narrative texts — appear verbatim in PDF project report sections."""
    business_description:    str = Field(default="", description="Business overview paragraph")
    products_services:       str = Field(default="", description="Products / services description")
    target_market:           str = Field(default="", description="Target market / customers")
    competitive_advantage:   str = Field(default="", description="Competitive advantage / USP")
    promoter_experience:     str = Field(default="", description="Promoter background & experience")
    introduction_text:       str = Field(default="", description="INTRODUCTION section text")
    market_aspects_text:     str = Field(default="", description="MARKET ASPECTS section text")
    management_aspects_text: str = Field(default="", description="MANAGEMENT ASPECTS section text")
    technical_aspects_text:  str = Field(default="", description="TECHNICAL ASPECTS section text")
    financial_aspects_text:  str = Field(default="", description="FINANCIAL ASPECTS section text")


class PromoterNetWorthInfo(BaseModel):
    """Promoter's net worth — required by banks for credit assessment (Section Q of PDF)."""
    residential_property:   float = Field(default=0, description="Market value of residential property (Rs.)")
    fixed_deposits:         float = Field(default=0, description="FDs / term deposits (Rs.)")
    savings_account:        float = Field(default=0, description="Savings account balance (Rs.)")
    mutual_funds:           float = Field(default=0, description="Mutual funds / shares / investments (Rs.)")
    home_loan_outstanding:  float = Field(default=0, description="Existing home loan outstanding (Rs.)")
    home_loan_emi:          float = Field(default=0, description="Existing home loan EMI per month (Rs.)")

    @property
    def net_worth(self) -> float:
        gross = self.residential_property + self.fixed_deposits + self.savings_account + self.mutual_funds
        return gross - self.home_loan_outstanding


# ── Master structured input ───────────────────────────────────────────────────

class CMAReportInput(BaseModel):
    """
    Structured input for POST /api/v1/report/generate.

    Field data flow (every field that reaches the bank report):
      expenses.raw_materials → COGS (P&L Years 1–5, WC Section)
      manpower.*             → Salary line (P&L + Manpower table)
      production.*           → Revenue + RM at 100% capacity
      assumptions.*          → All 5-year projection parameters
      promoter_net_worth.*   → Section Q (bank credit assessment)
    """
    scheme:               SchemeType          = Field(default=SchemeType.PMEGP)
    prepared_by:          str                 = Field(default="", description="Name shown in the report Prepared By field")
    report_theme:         Literal["Navy", "Teal", "Royal Blue", "Burgundy", "Forest Green", "Charcoal"] = Field(default="Navy")
    to_bank:              str                 = Field(default="", description="Report recipient selected in the customization dialog")
    loan_purpose:         str                 = Field(default="term_loan")
    applicant:            ApplicantInfo        = Field(default_factory=ApplicantInfo)
    business:             BusinessInfo         = Field(default_factory=BusinessInfo)
    project:              ProjectInfo          = Field(default_factory=ProjectInfo)
    production:           ProductionInfo       = Field(default_factory=ProductionInfo)
    assumptions:          AssumptionsInfo      = Field(default_factory=AssumptionsInfo)
    expenses:             ExpensesInfo         = Field(default_factory=ExpensesInfo)
    manpower:             ManpowerInfo         = Field(default_factory=ManpowerInfo)
    promoter_net_worth:   PromoterNetWorthInfo = Field(default_factory=PromoterNetWorthInfo,
                                                       description="Promoter net worth for bank credit assessment")
    products:             Optional[List[ProductItem]] = Field(default=None,
                                                       description="Product/service lines from Step 9 (A3 & D in PDF)")
    narrative:            NarrativeInfo        = Field(default_factory=NarrativeInfo,
                                                       description="Step 4 narrative texts for PDF project report sections")
    competitors:          Optional[List[CompetitorItem]] = Field(default=None,
                                                       description="Competitor analysis from Step 9 — PDF Section A6")
