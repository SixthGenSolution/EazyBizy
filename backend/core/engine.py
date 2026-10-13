import json, math, uuid, traceback
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime

# ── Per-scheme benchmarks (PDF §5) ───────────────────────────────────────────
# Used by scorecard.py and validator.py to apply scheme-specific pass/fail thresholds.
SCHEME_BENCHMARKS = {
    "pmegp": {
        "dscr_avg":         1.25,
        "current_ratio":    1.33,
        "debt_equity":      3.0,
        "ebitda_margin":    20.0,
        "net_margin":       10.0,
        "interest_coverage": 2.0,
        "tol_tnw":          4.0,
        "promoter_pct":     10.0,
    },
    "mudra_shishu": {
        "dscr_avg":         1.10,
        "current_ratio":    1.20,
        "debt_equity":      4.0,
        "ebitda_margin":    15.0,
        "net_margin":        8.0,
        "interest_coverage": 1.5,
        "tol_tnw":          5.0,
        "promoter_pct":     10.0,
    },
    "mudra_kishor": {
        "dscr_avg":         1.10,
        "current_ratio":    1.20,
        "debt_equity":      4.0,
        "ebitda_margin":    15.0,
        "net_margin":        8.0,
        "interest_coverage": 1.5,
        "tol_tnw":          5.0,
        "promoter_pct":     10.0,
    },
    "mudra_tarun": {
        "dscr_avg":         1.25,
        "current_ratio":    1.33,
        "debt_equity":      3.0,
        "ebitda_margin":    20.0,
        "net_margin":       10.0,
        "interest_coverage": 2.0,
        "tol_tnw":          4.0,
        "promoter_pct":     10.0,
    },
    "mudra_tarunplus": {
        "dscr_avg":         1.25,
        "current_ratio":    1.33,
        "debt_equity":      3.0,
        "ebitda_margin":    20.0,
        "net_margin":       10.0,
        "interest_coverage": 2.0,
        "tol_tnw":          4.0,
        "promoter_pct":     10.0,
    },
    "cgtmse": {
        "dscr_avg":         1.25,
        "current_ratio":    1.33,
        "debt_equity":      3.0,
        "ebitda_margin":    20.0,
        "net_margin":       10.0,
        "interest_coverage": 2.0,
        "tol_tnw":          4.0,
        "promoter_pct":     10.0,
    },
    "msme_psu": {
        "dscr_avg":         1.25,
        "current_ratio":    1.33,
        "debt_equity":      3.0,
        "ebitda_margin":    20.0,
        "net_margin":       10.0,
        "interest_coverage": 2.0,
        "tol_tnw":          4.0,
        "promoter_pct":     20.0,  # MSME requires 20-25% promoter
    },
    "default": {
        "dscr_avg":         1.25,
        "current_ratio":    1.33,
        "debt_equity":      3.0,
        "ebitda_margin":    20.0,
        "net_margin":       10.0,
        "interest_coverage": 2.0,
        "tol_tnw":          4.0,
        "promoter_pct":     10.0,
    },
}

def get_scheme_benchmarks(scheme: str) -> dict:
    """
    Return benchmark thresholds for the given scheme (case-insensitive).

    Sourced from the Rules & Rates engine (rules/engine.py) — the dict
    above is kept only as a defensive fallback if the engine raises
    unexpectedly; it is never the primary source once wired.
    """
    key = scheme.strip().lower().replace("-", "_").replace(" ", "_") if scheme else "default"
    try:
        from rules import get_default_engine
        return get_default_engine().get_scorecard_benchmarks(key)
    except Exception:
        return SCHEME_BENCHMARKS.get(key, SCHEME_BENCHMARKS["default"])


# ── Industry-specific calculation defaults (CA standard norms) ───────────────
#
# Manufacturing : COGS = raw materials + power + packing (variable, 50-60%)
#                 Fixed = labour + admin (20-25%)
#                 WC    = stock 30 d | debtors 30 d | creditors 15 d
#
# Service       : COGS = direct delivery cost (5-15%)
#                 Fixed = salaries + rent (50-65%)
#                 WC    = NO stock | debtors 30-45 d | creditors 15 d
#
# Trading       : COGS = purchase price (65-75%)
#                 Fixed = overheads (8-12%)
#                 WC    = stock 30-45 d | debtors 30 d | creditors 30 d
#
with (Path(__file__).resolve().parents[2] / "capacity_schedule.json").open(encoding="utf-8") as _capacity_file:
    DEFAULT_CAPACITY_SCHEDULE = tuple(
        float(value) / 100 for value in json.load(_capacity_file)["capacity_schedule_pct"]
    )

INDUSTRY_DEFAULTS = {
    "manufacturing": {
        "cogs_ratio":         0.55,   # raw materials + power + packing
        "fixed_ratio":        0.20,   # labour + admin
        "marketing_ratio":    0.025,
        "gross_margin":       0.45,   # for reference
        "stock_days":         30,
        "debtor_days":        30,
        "creditor_days":      15,
        "wc_loan_pct":        0.60,
        "capacity_schedule":  DEFAULT_CAPACITY_SCHEDULE,
    },
    "service": {
        "cogs_ratio":         0.10,   # direct cost of service delivery
        "fixed_ratio":        0.55,   # salaries dominate
        "marketing_ratio":    0.05,
        "gross_margin":       0.75,
        "stock_days":         0,      # no physical stock
        "debtor_days":        30,
        "creditor_days":      15,
        "wc_loan_pct":        0.60,
        "capacity_schedule":  DEFAULT_CAPACITY_SCHEDULE,
    },
    "trading": {
        "cogs_ratio":         0.70,   # purchase price of goods
        "fixed_ratio":        0.10,   # overheads
        "marketing_ratio":    0.02,
        "gross_margin":       0.30,
        "stock_days":         45,     # inventory-heavy
        "debtor_days":        0,      # retail = cash sales; wholesale users override manually
        "creditor_days":      30,
        "wc_loan_pct":        0.65,
        "capacity_schedule":  DEFAULT_CAPACITY_SCHEDULE,
    },
    "agriculture": {
        "cogs_ratio":         0.45,
        "fixed_ratio":        0.25,
        "marketing_ratio":    0.03,
        "gross_margin":       0.55,
        "stock_days":         15,
        "debtor_days":        15,
        "creditor_days":      10,
        "wc_loan_pct":        0.60,
        "capacity_schedule":  DEFAULT_CAPACITY_SCHEDULE,
    },
    "default": {
        "cogs_ratio":         0.55,
        "fixed_ratio":        0.20,
        "marketing_ratio":    0.025,
        "gross_margin":       0.45,
        "stock_days":         30,
        "debtor_days":        30,
        "creditor_days":      15,
        "wc_loan_pct":        0.60,
        "capacity_schedule":  DEFAULT_CAPACITY_SCHEDULE,
    },
}

def get_industry_defaults(industry_type: str) -> dict:
    key = industry_type.strip().lower() if industry_type else "default"
    return INDUSTRY_DEFAULTS.get(key, INDUSTRY_DEFAULTS["default"])


# ── Global field unit labels (shown next to inputs in UI and PDF) ─────────────
FIELD_UNITS = {
    # Financial rates
    "term_loan_interest_pct":   "% p.a.",
    "wc_interest_pct":          "% p.a.",
    "interest_rate_pct":        "% p.a.",
    "tax_rate_pct":             "% of PBT",
    "depreciation_building_pct":"% p.a. (SLM)",
    "depreciation_machinery_pct":"% p.a. (SLM)",
    "depreciation_furniture_pct":"% p.a. (SLM)",
    "revenue_growth_pct":       "% p.a.",
    "term_loan_pct":            "% of fixed capital",
    "wc_loan_pct":              "% of WC requirement",
    "marketing_pct_revenue":    "% of revenue",
    "contingency_pct":          "% of capex",
    # Time periods
    "tenure_months":            "months",
    "moratorium_months":        "months",
    "loan_tenure_years":        "years",
    "stock_holding_days":       "days",
    "debtor_days":              "days",
    "creditor_days":            "days",
    "working_days_per_year":    "days/year",
    "hours_per_day":            "hours/day",
    # Production
    "input_qty_per_day":        "units/day",
    "output_yield_pct":         "% of input",
    "selling_price_per_unit":   "Rs/unit",
    "raw_material_cost_per_unit":"Rs/unit",
    # Project costs
    "land_cost":                "Rs.",
    "building_cost":            "Rs.",
    "machinery_cost":           "Rs.",
    "preliminary_expenses":     "Rs.",
    # People
    "expected_employment":      "persons",
    "num_employees":            "persons",
    "salary_per_employee":      "Rs/month/person",
    "daily_wage":               "Rs/day",
    "benefits_pct":             "% of wages (PF+ESI+Bonus)",
    # Working capital
    "monthly_rent":             "Rs/month",
    "raw_material_monthly":     "Rs/month",
}


def get_field_unit(field_name: str) -> str:
    return FIELD_UNITS.get(field_name, "")


def R(val, decimals=0):
    try:
        d = Decimal(str(float(val))).quantize(Decimal(10)**-decimals, rounding=ROUND_HALF_UP)
        return float(d)
    except: return float(val)

def R100(val): return float(round(float(val)/100)*100)
def R1000(val): return float(round(float(val)/1000)*1000)

def pct_fraction(val):
    """Accept either 10 or 0.10 style rates and return a fraction."""
    try:
        num = float(val)
    except:
        return 0.0
    return num / 100 if abs(num) > 1 else num

def calc_emi(principal, annual_rate_pct, months):
    if months <= 0: return 0.0
    if annual_rate_pct == 0: return principal/months
    r = annual_rate_pct/100/12
    return (principal*r*(1+r)**months)/((1+r)**months-1)

def calc_amortization(principal, annual_rate_pct, months):
    r = annual_rate_pct/100/12
    emi = calc_emi(principal, annual_rate_pct, months)
    sched, bal = [], principal
    for m in range(1, months+1):
        interest = bal*r; pp = emi-interest; bal = max(bal-pp, 0)
        sched.append({"month":m,"opening_balance":R(bal+pp,2),"emi":R(emi,2),
                      "interest":R(interest,2),"principal":R(pp,2),"closing_balance":R(bal,2)})
    return sched, R(emi,2)

def calculate_tax(profit_before_tax, year_number, business_type, industry, tax_rate_pct, revenue=0):
    """
    Expert Indian CA Tax Calculation for CMA/DPR.
    Rules:
    1. If PBT <= 0: Tax = 0
    2. Proprietorship/Individual: Use Slabs
    3. Startup Exemption (80-IC/PMEGP): Year 1-2 = 0 for Manufacturing
    4. Pvt Ltd / LLP: 25% or 30% based on Turnover (4cr threshold)
    """
    if profit_before_tax <= 0:
        return 0.0
    
    b_type = str(business_type).lower()
    ind = str(industry).lower()
    
    # 1. Startup Exemption (Manufacturing / PMEGP units) - Year 1 & 2
    if (ind == "manufacturing" or "pmegp" in b_type) and year_number <= 2:
        return 0.0

    # 2. Proprietorship / Individual - Slabs
    if "proprietorship" in b_type or "individual" in b_type:
        pbt = profit_before_tax
        tax = 0.0
        # Up to 2,50,000: 0%
        # 2,50,001 to 5,00,000: 5%
        # 5,00,001 to 10,00,000: 20%
        # Above 10,00,000: 30%
        if pbt > 1000000:
            tax += (pbt - 1000000) * 0.30
            pbt = 1000000
        if pbt > 500000:
            tax += (pbt - 500000) * 0.20
            pbt = 500000
        if pbt > 250000:
            tax += (pbt - 250000) * 0.05
        return R(tax, 2)

    # 3. Pvt Ltd / LLP - Turnover based
    if "pvt ltd" in b_type or "llp" in b_type:
        # Turnover < 4 crore: 25%, else 30%
        rate = 0.25 if revenue < 40000000 else 0.30
        return R(profit_before_tax * rate, 2)

    # Default - use provided rate
    return R(profit_before_tax * (tax_rate_pct / 100), 2)


def yearly_amortization(sched, total_months):
    years = math.ceil(total_months/12); result = []
    for y in range(1, years+1):
        ms = sched[(y-1)*12:y*12]
        if not ms: break
        result.append({"year":y,"opening_balance":R(ms[0]["opening_balance"],2),
                       "emi_paid":R(sum(m["emi"] for m in ms),2),
                       "interest_paid":R(sum(m["interest"] for m in ms),2),
                       "principal_paid":R(sum(m["principal"] for m in ms),2),
                       "closing_balance":R(ms[-1]["closing_balance"],2)})
    return result

def calc_term_loan_schedule(principal, annual_rate, tenure_years=5, moratorium_years=1, margin_money=0, lock_in_years=3):
    """
    Expert Indian Banking TL Schedule.
    Handles:
    - Interest-only moratorium
    - Half-yearly instalments
    - PMEGP Margin Money lock-in: After lock_in_years, principal reduces by margin_money.
    """
    repay_years = max(tenure_years - moratorium_years, 0)
    # Principal spread over remaining years
    half_inst = R(principal / (repay_years * 2), 2) if repay_years else 0.0
    
    schedule, balance, total_interest = [], R(principal, 2), 0.0
    
    for yr in range(1, tenure_years + 1):
        opening = balance
        
        # PMEGP Rule: Release Margin Money after lock-in
        if yr == (lock_in_years + 1):
            opening = R(opening - margin_money, 2)
            # Re-calculate instalment based on new balance? 
            # Usually the bank keeps the EMI same but tenure reduces, or vice-versa.
            # Bank norms: Usually the principal outstanding is adjusted.
        
        if yr <= moratorium_years:
            mid, closing, repaid = opening, opening, 0.0
        else:
            mid = R(max(opening - half_inst, 0), 2)
            closing = R(max(mid - half_inst, 0), 2)
            repaid = R(opening - closing, 2)
            
        # Interest is charged on the outstanding balance
        ih1 = R(opening * annual_rate / 2, 2)
        ih2 = R(mid * annual_rate / 2, 2)
        ti = R(ih1 + ih2, 2)
        total_interest = R(total_interest + ti, 2)
        
        schedule.append({
            "year": yr,
            "opening": opening,
            "mid": mid,
            "closing": closing,
            "int_h1": ih1,
            "int_h2": ih2,
            "total_interest": ti,
            "principal_repaid": repaid,
        })
        balance = closing
        
    return schedule, half_inst, total_interest

def dscr_label(d):
    if d>=2: return "Excellent"
    if d>=1.5: return "Very Good"
    if d>=1.25: return "Good"
    if d>=1: return "Acceptable"
    return "Poor"

def interest_coverage_ratio(ebitda: float, tl_interest: float, wc_interest: float) -> float:
    """CA-standard Interest Coverage Ratio, single source of truth:
        Interest Coverage = EBITDA / (Term Loan Interest + Working Capital Interest)
    Every report section (Section 29's ratio table, pdf/generator.py's cma
    sync) must call this — not re-derive the ratio independently — so the
    displayed figure can never diverge from this exact formula.
    """
    total_interest = float(tl_interest or 0) + float(wc_interest or 0)
    return R(ebitda / total_interest, 2) if total_interest else 0.0

def credit_rating(s):
    """Internal viability grade — NOT an external credit agency rating."""
    if s >= 9:  return "Excellent"
    if s >= 8:  return "Strong"
    if s >= 7:  return "Good"
    if s >= 6:  return "Moderate"
    if s >= 5:  return "Borderline"
    return "Weak"

def recommendation(s):
    if s>=8.5: return "APPROVED"
    if s>=6.5: return "APPROVE"
    if s>=5.5: return "APPROVE WITH CONDITIONS"
    if s>=4.5: return "REFER FOR REVIEW"
    return "REJECT"

def risk_level(s):
    """Internal risk label — plain language, not external-agency style."""
    if s >= 8:  return "Low Risk"
    if s >= 6:  return "Moderate Risk"
    if s >= 4:  return "High Risk"
    return "Very High Risk"

def net_risk(prob, impact):
    p,i = prob.lower(), impact.lower()
    if p=="low" and i=="low": return "LOW"
    if p=="low" and i=="medium": return "LOW"
    if p=="low" and i=="high": return "MEDIUM"
    if p=="medium" and i=="low": return "LOW"
    if p=="medium": return "MEDIUM"
    return "HIGH"

def _project_cost_amount(inp, code, default=0.0):
    try:
        for item in inp.get("project_cost_items", []):
            if int(item.get("code", 0)) == int(code):
                return R(item.get("amount", default))
    except:
        pass
    return R(default)

def _project_cost_amount_by_terms(inp, include_terms, exclude_terms=(), default=0.0):
    total = 0.0
    for item in inp.get("project_cost_items", []):
        particulars = str(item.get("particulars", "")).lower()
        if any(term in particulars for term in exclude_terms):
            continue
        if any(term in particulars for term in include_terms):
            total += R(item.get("amount", 0))
    return R(total or default)

def _depreciable_assets_from_project_cost(inp, building_default=0.0, machinery_default=0.0):
    building, machinery = 0.0, 0.0
    excluded = ("land", "working capital", "initial expenditure", "preoperative", "pre-operative")
    building_terms = ("building", "factory", "shed", "renovation")
    machinery_terms = (
        "machinery", "machine", "plant", "equipment", "furniture", "fixture",
        "computer", "peripheral", "electrification", "wiring", "racks",
        "storage", "vehicle", "tools", "installation",
    )

    for item in inp.get("project_cost_items", []):
        particulars = str(item.get("particulars", "")).lower()
        amount = R(item.get("amount", 0))
        if not amount or any(term in particulars for term in excluded):
            continue
        if any(term in particulars for term in building_terms):
            building += amount
        elif any(term in particulars for term in machinery_terms):
            machinery += amount

    return R(building or building_default), R(machinery or machinery_default)

def _tally_projected_balance_sheet(rows):
    """Keep projected balance sheet rows in balance after WC/depreciation flows.

    CA rule:
      Assets = Equity + Liabilities

    BUG FIX: a funding shortfall used to be inserted as a fake "Short-Term
    Funding Gap" LIABILITY — a facility that was explicitly disclosed as
    "not arranged" in the very next sentence, which is self-contradictory:
    an unarranged facility is not a liability. Cash is now the single
    balancing figure and is allowed to go NEGATIVE (an overdrawn/unfunded
    cash position) when arranged equity + liabilities fall short of the
    assets the business needs — this is the standard way an unfunded
    shortfall is shown on a projected balance sheet, and it never invents a
    liability that doesn't exist. "short_term_funding"/"funding_gap" are
    kept as informational fields (the shortfall's magnitude) but are no
    longer added into total_liabilities.
    """
    for row in rows:
        equity     = row.get("equity",             0)
        mm         = row.get("margin_money",       0)
        tl         = row.get("term_loan",          0)
        reserves   = row.get("reserves",           0)
        wc_bank    = row.get("wc_bank",             0)
        wc_margin  = row.get("promoter_wc_margin",  0)

        base_equity_liabilities = R(equity + mm + reserves + tl + wc_bank + wc_margin, 2)

        non_cash_assets = R(
            row.get("land",           0)
            + row.get("net_block",    0)
            + row.get("other_assets", 0)
            + row.get("current_assets", 0),
            2,
        )
        cash_or_gap = R(base_equity_liabilities - non_cash_assets, 2)

        # Cash is simply the balancing figure — negative means an unfunded
        # shortfall, not a real liability to add on the other side.
        cash = cash_or_gap
        short_term_funding = R(abs(cash_or_gap), 2) if cash_or_gap < 0 else 0.0

        row["cash"] = cash
        row["short_term_funding"] = short_term_funding
        row["funding_gap"] = short_term_funding
        row["total_assets"] = R(non_cash_assets + cash, 2)
        row["total_liabilities"] = R(base_equity_liabilities, 2)
        row["total_equity_liabilities"] = row["total_liabilities"]
        row["check"] = R(row["total_assets"] - row["total_liabilities"], 2)
    return rows

def validate_reconciliation(result):
    """Raise clear section-level errors when generated report sections drift."""
    pc = result["project_cost"]
    pbs = result["balance_sheet_years"]
    cop = result["profit_and_loss_years"]
    bep = result["breakeven_years"]
    man = result["manpower"]
    cma = result.get("cma_summary", {})
    errors = []

    def close(a, b, tol=2.0):
        return abs(R(a, 2) - R(b, 2)) <= tol

    if not close(pc["total_project_cost"], pc["total_finance"]):
        errors.append(f"Section B1/B2 mismatch: project cost {pc['total_project_cost']} vs finance {pc['total_finance']}")
    if pbs and not close(pc["total_project_cost"], pbs[0]["total_assets"]):
        errors.append(f"Section B/K mismatch: project cost {pc['total_project_cost']} vs Year 0 BS assets {pbs[0]['total_assets']}")
    if cop:
        y1 = cop[0]
        if not close(y1["profit_before_tax"] - y1["tax"], y1["net_profit"]):
            errors.append(f"Section J tax/PAT mismatch: PBT {y1['profit_before_tax']} - tax {y1['tax']} != PAT {y1['net_profit']}")
    if cop and bep:
        if not close(bep[0]["variable_expenses"] + bep[0]["fixed_expenses"], cop[0]["total_expenses"]):
            errors.append(f"Section M/J cost mismatch: BEP costs {bep[0]['variable_expenses'] + bep[0]['fixed_expenses']} vs J expenses {cop[0]['total_expenses']}")
    if cma:
        if not close(cma.get("fixed_salary", 0), man["total_wages"] / 12):
            errors.append(f"Section E/O wage mismatch: E wages/12 {man['total_wages'] / 12} vs O salary {cma.get('fixed_salary', 0)}")
    if errors:
        raise ValueError("; ".join(errors))

def validate_manpower(inp, total_wages, annual_revenue_100pct):
    expected = int(inp.get("expected_employment", 0) or 0)
    headcount = int(1 + inp.get("num_skilled_workers", 0) + inp.get("num_semi_skilled_workers", 0))
    if expected and headcount != expected:
        raise ValueError("Headcount mismatch: Section E total != expected_employment")

    warnings = []
    y1_capacity = pct_fraction(inp.get("capacity_y1", 0))
    y1_revenue = R(annual_revenue_100pct * y1_capacity, 2)
    if y1_revenue and total_wages > R(y1_revenue * 0.40, 2):
        warnings.append("Labour cost exceeds 40% of Year 1 revenue — business may not be viable")
    return warnings

def calculate_scorecard(inp, dscr_y1, roi_ebitda, be_months, prom_pct):
    try:
        # Robustness: Handle "N/A" or string values
        def safe_float(val, default=0.0):
            try:
                if val in [None, "N/A", "", "NaN"]: return default
                return float(val)
            except:
                return default

        dscr_val = safe_float(dscr_y1, 0.0)
        roi_val = safe_float(roi_ebitda, 0.0)
        be_val = safe_float(be_months, 999.0)
        prom_val = safe_float(prom_pct, 0.0)

        s_dscr=(10 if dscr_val>=2 else 8 if dscr_val>=1.5 else 6 if dscr_val>=1.25 else 4 if dscr_val>=1 else 2 if dscr_val>0 else 0)
        s_roi=(10 if roi_val>=100 else 8 if roi_val>=50 else 6 if roi_val>=25 else 4 if roi_val>=10 else 2 if roi_val>0 else 0)
        # FIX 3: 0 when not achievable (be_val=999 sentinel), never give partial credit for unachievable payback
        s_be=(0 if be_val>=999 else 10 if 0<be_val<=3 else 9 if be_val<=6 else 8 if be_val<=12 else 6 if be_val<=24 else 4)
        
        scorecard=[
            {"parameter":f"DSCR ({dscr_val:.2f}x)","weight":25,"score":s_dscr,"weighted":round(0.25*s_dscr,2)},
            {"parameter":f"ROI ({roi_val:.2f}%)","weight":20,"score":s_roi,"weighted":round(0.20*s_roi,2)},
            {"parameter":f"Payback Period ({'N/A' if be_val >= 999 else f'{be_val:.1f}'} mo)","weight":15,"score":s_be,"weighted":round(0.15*s_be,2)},
            {"parameter":"Market Opportunity","weight":10,"score":inp.get("sc_market",8),"weighted":round(0.10*inp.get("sc_market",8),2)},
            {"parameter":"Competitive Position","weight":10,"score":inp.get("sc_competitive",8),"weighted":round(0.10*inp.get("sc_competitive",8),2)},
            {"parameter":"Business Model","weight":10,"score":inp.get("sc_business_model",8),"weighted":round(0.10*inp.get("sc_business_model",8),2)},
            {"parameter":"Promoter Experience","weight":5,"score":inp.get("sc_promoter_exp",9),"weighted":round(0.05*inp.get("sc_promoter_exp",9),2)},
            {"parameter":f"Financial Contribution ({prom_val:.1f}%)","weight":5,"score":inp.get("sc_fin_contrib",9),"weighted":round(0.05*inp.get("sc_fin_contrib",9),2)},
        ]
        total_score=round(sum(float(s["weighted"]) for s in scorecard),2)
        return scorecard,total_score
    except Exception:
        return [], 0.0

def score_dscr(d: float) -> float:
    if d >= 2.0: return 10.0
    if d >= 1.5: return 8.0
    if d >= 1.25: return 6.0
    if d >= 1.0: return 4.0
    return 3.0

def score_roi(r: float) -> float:
    if r >= 100: return 10.0
    if r >= 50:  return 8.0
    if r >= 25:  return 6.0
    if r >= 10:  return 4.0
    return 3.0

def score_breakeven(m: float) -> float:
    if m <= 3:  return 10.0
    if m <= 6:  return 9.0
    if m <= 12: return 8.0
    if m <= 24: return 6.0
    return 4.0

def annual_revenue_from_prod(prod, industry_type: str = "manufacturing") -> float:
    """
    Compute 100%-capacity annual revenue from production parameters.

    Manufacturing / Trading:
        revenue = input_qty_per_day × (output_yield_pct/100) × working_days × selling_price

    Service (input_qty_per_day == 0):
        selling_price_per_unit is treated as daily revenue (Rs/day) × working_days
        OR if selling_price_per_unit is large (>10000), treat as monthly → × 12
    """
    try:
        if hasattr(prod, 'input_qty_per_day'):
            qty    = float(prod.input_qty_per_day   or 0)
            yield_ = float(prod.output_yield_pct    or 100) / 100
            days   = float(prod.working_days_per_year or 300)
            price  = float(prod.selling_price_per_unit or 0)
        else:
            qty    = float(prod.get("fresh_leaves_per_day_kg", 0))
            yield_ = float(prod.get("yield_rate", 1))
            days   = float(prod.get("working_days_per_year", 300))
            price  = float(prod.get("selling_price_per_kg", 0))

        if qty > 0:
            return qty * yield_ * days * price

        # Fallback for all industries when qty=0 — selling_price_per_unit = monthly revenue
        # buildCMAReportInput.ts sets selling_price_per_unit = expected_monthly_revenue when
        # production parameters are not filled (covers manufacturing, service, trading, agriculture)
        if price > 0:
            # If price looks like a monthly figure (> Rs.5000), treat as monthly × 12
            if price > 5000:
                return price * 12
            # Otherwise treat as daily revenue × working days
            return price * days

        return 0.0
    except Exception:
        return 0.0

def calculate_risk_matrix():
    risk_matrix=[
        {"category":"Market Risk","description":"Competition / Price Wars","probability":"Medium","impact":"Medium"},
        {"category":"Market Risk","description":"Demand Fluctuation","probability":"Low","impact":"Low"},
        {"category":"Operational","description":"Inventory Management","probability":"Low","impact":"Medium"},
        {"category":"Operational","description":"Supplier Dependency","probability":"Low","impact":"Medium"},
        {"category":"Financial","description":"Revenue Shortfall","probability":"Medium","impact":"High"},
        {"category":"Financial","description":"Cost Overruns","probability":"Low","impact":"Medium"},
        {"category":"External","description":"Economic Slowdown","probability":"Medium","impact":"High"},
        {"category":"External","description":"Regulatory / GST Changes","probability":"Low","impact":"Low"},
    ]
    for rm in risk_matrix:
        rm["net_risk"]=net_risk(rm["probability"],rm["impact"])
    return risk_matrix

def generate_ai_observations(cma, inp):
    """
    Generate AI observations strictly from computed financial metrics.
    All observations must reflect actual calculated values — no generic positives
    when fundamentals are weak.
    """
    obs = []
    recommendations = []

    avg_dscr     = float(cma.get("avg_dscr", 0) or 0)
    dscr_y1_raw  = cma.get("dscr_y1", 0)
    dscr_y1      = float(dscr_y1_raw) if isinstance(dscr_y1_raw, (int, float)) else 0.0
    annual_pat   = float(cma.get("annual_pat", 0) or 0)
    pat_margin   = float(cma.get("net_margin_pct", 0) or 0)
    ebitda_m     = float(cma.get("ebitda_monthly", 0) or 0)
    current_ratio = float(cma.get("current_ratio", 0) or 0)
    prom_pct     = float(cma.get("promoter_pct", 0) or 0)
    be_months    = cma.get("breakeven_months")
    recommendation = cma.get("recommendation", "")
    is_reject    = "REJECT" in str(recommendation).upper()
    cash_negative = any(
        float(p.get("closing_cash", 0) or 0) < 0
        for p in (cma.get("projections_5yr") or [])
    )

    # ── Viability gate ────────────────────────────────────────────────
    project_viable = (avg_dscr >= 1.0 and annual_pat >= 0 and not is_reject)

    # 1. DSCR — must reflect actual value
    if avg_dscr >= 2.0:
        obs.append(f"Excellent debt service capacity: Average DSCR of {round(avg_dscr, 2)}x is well above the 1.25x bank benchmark.")
    elif avg_dscr >= 1.25:
        obs.append(f"Adequate debt service coverage: Average DSCR of {round(avg_dscr, 2)}x meets the bank benchmark of 1.25x.")
    elif avg_dscr >= 1.0:
        obs.append(f"WARNING — DSCR of {round(avg_dscr, 2)}x is below the 1.25x benchmark. Cash flow is barely sufficient to service debt; close monitoring required.")
        recommendations.append("Increase revenue or reduce fixed costs to raise DSCR above 1.25x.")
    else:
        obs.append(f"CRITICAL — Average DSCR of {round(avg_dscr, 2)}x is below 1.0. The project CANNOT service its debt obligations from projected cash flows.")
        recommendations.append("Revise the business model: increase revenue, reduce borrowing, or raise promoter equity to bring DSCR above 1.25x.")

    # 2. Profitability — only positive if PAT is actually positive
    if annual_pat < 0:
        obs.append(f"CRITICAL — Project is loss-making with a negative Annual PAT of Rs. {annual_pat:,.0f}. The project does NOT demonstrate financial viability.")
        recommendations.append("Reduce total costs or increase revenue to achieve positive PAT before seeking bank finance.")
    elif pat_margin >= 15.0:
        obs.append(f"Strong profitability: Net margin of {round(pat_margin, 1)}% indicates efficient cost management and high value-addition.")
    elif pat_margin >= 5.0:
        obs.append(f"Sustainable profitability: Net margin of {round(pat_margin, 1)}% is aligned with industry averages.")
    else:
        obs.append(f"Thin margins: Net margin of {round(pat_margin, 1)}% leaves limited buffer for cost overruns or revenue shortfalls.")
        recommendations.append("Improve margins by reducing COGS ratio or increasing selling prices.")

    # 3. EBITDA — only positive if actually positive
    if ebitda_m < 0:
        obs.append(f"CRITICAL — Monthly EBITDA is negative (Rs. {ebitda_m:,.0f}). Operating expenses exceed revenue even before interest and depreciation.")
        recommendations.append("Reduce operating expenses or increase revenue capacity to achieve positive EBITDA.")

    # 4. Liquidity
    if current_ratio >= 1.33:
        obs.append(f"Strong liquidity: Current ratio of {round(current_ratio, 2)} meets the Tandon Committee norm of 1.33.")
    elif current_ratio >= 1.0:
        obs.append(f"Adequate liquidity: Current ratio of {round(current_ratio, 2)} is above 1.0 but below the 1.33 norm.")
        recommendations.append("Improve working capital management to raise current ratio to at least 1.33.")
    else:
        obs.append(f"WARNING — Current ratio of {round(current_ratio, 2)} is below 1.0, indicating working capital stress.")
        recommendations.append("Increase promoter working capital contribution or reduce short-term borrowings.")

    # 5. Cash flow
    if cash_negative:
        obs.append("WARNING — Projected closing cash balance turns negative in one or more years; additional liquidity support may be required.")
        recommendations.append("Build a cash buffer through higher promoter contribution or a working capital overdraft limit.")

    # 6. Promoter contribution
    if prom_pct >= 25.0:
        obs.append(f"Strong promoter commitment: {round(prom_pct, 1)}% contribution provides significant cushion to lenders.")
    elif prom_pct >= 10.0:
        obs.append(f"Adequate promoter contribution of {round(prom_pct, 1)}% meets minimum scheme requirements.")
    else:
        obs.append(f"WARNING — Promoter contribution of {round(prom_pct, 1)}% is below the recommended 10% minimum.")
        recommendations.append(f"Increase promoter equity to at least 10% of total project cost to improve credit rating.")

    # 7. Break-even
    if isinstance(be_months, (int, float)) and be_months > 0:
        if be_months <= 12:
            obs.append(f"Rapid payback: project recovers investment within {round(be_months, 1)} months of operations.")
        elif be_months <= 36:
            obs.append(f"Reasonable payback period of {round(be_months, 1)} months within 3 years of operations.")
        else:
            obs.append(f"Long payback period of {round(be_months, 1)} months — consider strategies to accelerate revenue ramp-up.")
            recommendations.append("Accelerate capacity utilisation in early years to shorten payback period.")
    elif str(be_months).upper() == "N/A" or not be_months:
        obs.append("Break-even / payback period is NOT achievable under current projections — project cash accruals are insufficient.")
        recommendations.append("Restructure costs or increase revenue to generate positive cash accruals for debt repayment.")

    # 8. Viability summary
    if not project_viable:
        obs.append("OVERALL ASSESSMENT: Project does NOT demonstrate financial viability under current assumptions. Loan cannot be recommended.")
    else:
        obs.append("OVERALL ASSESSMENT: Project demonstrates financial viability under base-case assumptions and meets debt-service requirements.")

    # 9. Credit score improvement recommendations
    if recommendations:
        obs.append("── CREDIT SCORE IMPROVEMENT ACTIONS ──")
        for i, rec in enumerate(recommendations, 1):
            obs.append(f"  {i}. {rec}")

    return obs

def run_dpr(inp):
    # Fix Error: Could not find name `scheme`
    scheme = get_scheme_params(inp.get("scheme", "PMEGP"))
    
    m1=R(inp["machine1_base_price"]*1.2); m2=R(inp["machine2_base_price"]*1.2)
    m3=R(inp["machine3_base_price"]*1.2); m4=R(inp["machine4_price"])
    machinery_items=[
        {"name":inp["machine1_name"],"qty":inp["machine1_qty"],"unit_price":m1,"total":R(m1*inp["machine1_qty"])},
        {"name":inp["machine2_name"],"qty":inp["machine2_qty"],"unit_price":m2,"total":R(m2*inp["machine2_qty"])},
        {"name":inp["machine3_name"],"qty":inp["machine3_qty"],"unit_price":m3,"total":R(m3*inp["machine3_qty"])},
    ]
    tools_installation=R(m4*inp["machine4_qty"])
    section_c_total=R(sum(item["qty"]*item["unit_price"] for item in machinery_items)+tools_installation)

    frontend_monthly_rev = 0
    frontend_cogs = 0
    # Products collection from all industry-specific sources
    source_products = (
        inp.get("products", []) or
        inp.get("manufacturing_products", []) or
        inp.get("trading_products", []) or
        inp.get("service_products", []) or
        inp.get("agriculture_products", []) or
        []
    )
    frontend_products = []
    for p in source_products:
        p = dict(p) # work on a copy
        qty = float(p.get("units_per_month", 0))
        price = float(p.get("avg_price", 0) or p.get("selling_price", 0) or 0)
        pprice = float(p.get("purchase_price", 0))
        calc_rev = qty * price
        if calc_rev > 0:
            p["monthly_revenue"] = calc_rev
            frontend_monthly_rev += calc_rev
            frontend_cogs += qty * pprice
            frontend_products.append(p)

    caps=[inp.get(f"capacity_y{i + 1}", DEFAULT_CAPACITY_SCHEDULE[i]) for i in range(5)]

    annual_prod_kg=R(inp.get("fresh_leaves_per_day_kg", 0)*inp.get("working_days_per_year", 300)*inp.get("yield_rate", 1),2)
    annual_leaves_kg=R(inp.get("fresh_leaves_per_day_kg", 0)*inp.get("working_days_per_year", 300))
    revenue_100=R(inp["selling_price_per_kg"]*annual_prod_kg)
    rm_leaves=R(inp["cost_fresh_leaves_per_kg"]*annual_leaves_kg)
    rm_cons=R(inp["cost_consumables_per_kg"]*annual_leaves_kg)
    rm_bottles=R(inp["cost_pet_bottle"]*(annual_prod_kg/10))
    rm_total=R(rm_leaves+rm_cons+rm_bottles)

    if frontend_monthly_rev > 0:
        capacity_y1 = caps[0] or DEFAULT_CAPACITY_SCHEDULE[0]
        revenue_100 = R(frontend_monthly_rev * 12 / capacity_y1)
        if frontend_cogs > 0:
            rm_total = R(frontend_cogs * 12 / capacity_y1)

    promoter_ann=R(inp.get("promoter_daily_wage", 0)*inp.get("working_days_per_year", 300))
    skilled_ann=R(inp.get("skilled_worker_daily_wage", 0)*inp.get("working_days_per_year", 300))
    semi_ann=R(inp.get("semi_skilled_daily_wage", 0)*inp.get("working_days_per_year", 300))
    base_wages=R(promoter_ann+skilled_ann*inp.get("num_skilled_workers", 0)+semi_ann*inp.get("num_semi_skilled_workers", 0))
    
    if base_wages == 0 and inp.get("salary_per_employee", 0) > 0:
        skilled_ann = R(inp.get("salary_per_employee", 0) * 12)
        inp["num_skilled_workers"] = inp.get("num_employees", 0)
        base_wages = R(skilled_ann * inp["num_skilled_workers"])
        
    benefits=R(base_wages*inp.get("hr_perquisites_rate", 0.10)); total_wages=R(base_wages+benefits)
    
    # Fix Error: Could not find name `power_100`
    power_100=R(inp["connected_load_kw"]*inp["hours_of_load_operation"]*inp["load_factor"]*inp["working_days_per_year"]*inp["power_rate_per_unit"])
    
    # Fix Prompt 11 & Bug 7: Unified Contingency and Initial Expenditure
    pre_op_exp = _project_cost_amount(inp, 4, 0.0) 
    input_building_cost = _project_cost_amount(inp, 2, R(inp.get("cost_per_sqft", 0) * inp.get("built_up_area_sqft", 0)))
    building_cost = input_building_cost
    machinery_total = section_c_total
    
    # Fix Prompt 11: Contingency Calculation Base (Civil + Plant only)
    contingency_base = building_cost + machinery_total
    contingency_pct = pct_fraction(inp.get("contingency_rate", 0))
    contingency = R(contingency_base * contingency_pct, 2)
    
    # Bug 7: Building the definitive project cost breakdown
    land_cost = _project_cost_amount(inp, 1, 0.0)
    
    # Fix Error: Could not find name `promoter_working_capital`
    promoter_working_capital = _project_cost_amount_by_terms(
        inp, ("working capital",), default=_project_cost_amount(inp, 6, 0.0)
    )
    # Fix Error: Could not find name `input_working_capital`
    input_working_capital = R(promoter_working_capital or inp.get("total_working_capital_requirement", 0))

    synced_project_cost_items = []
    synced_project_cost_items.append({"code": 1, "particulars": "Land & Site Development", "amount": land_cost})
    synced_project_cost_items.append({"code": 2, "particulars": "Building & Civil Works", "amount": building_cost})
    synced_project_cost_items.append({"code": 3, "particulars": "Plant & Machinery", "amount": machinery_total})
    synced_project_cost_items.append({"code": 4, "particulars": "Contingency (on Civil/Plant)", "amount": contingency})
    synced_project_cost_items.append({"code": 5, "particulars": "Pre-operative Expenses", "amount": pre_op_exp})
    
    # Fixed Project Cost is the sum of these capital items
    fixed_project_cost = R(land_cost + building_cost + machinery_total + contingency + pre_op_exp, 2)
    
    # Fix Error: Could not find name `other_project_assets`
    other_project_assets = R(contingency + pre_op_exp, 2)
    
    # Gross block for depreciation (usually Civil + Plant)
    building_gross = R(building_cost, 2)
    machinery_gross = R(machinery_total, 2)
    gross_block = R(building_gross + machinery_gross)
    
    dep_building = R(building_gross * pct_fraction(inp["building_dep_rate_slm"]), 2)
    dep_machinery = R(machinery_gross * pct_fraction(inp["machinery_dep_rate_slm"]), 2)
    total_dep = R(dep_building + dep_machinery, 2)
    
    max_term_loan_finance = R(fixed_project_cost * inp["term_loan_pct"], 2) if fixed_project_cost > 0 else 0.0
    fallback_term_loan = R1000(inp["term_loan_pct"] * fixed_project_cost)
    requested_term_loan = R(inp.get("term_loan_amount", 0) or fallback_term_loan)
    term_loan = R(min(requested_term_loan, max_term_loan_finance or fixed_project_cost, fixed_project_cost))

    # Fix Prompt 3: Margin Money Treatment
    margin_money = float(scheme.get("margin_money", 0) or 0)
    lock_in = int(inp.get("margin_money_lock_in_years", 3))

    tl_sched, half_inst, total_tl_int = calc_term_loan_schedule(
        term_loan, inp["term_loan_interest"], inp["loan_tenure_years"], inp["moratorium_years"],
        margin_money=margin_money, lock_in_years=lock_in
    )
    hike = pct_fraction(inp.get("salary_increase_rate", inp.get("salary_increase_pct", 0.10)))
    cop = []
    for i, cap in enumerate(caps):
        yr = i + 1
        rev = R(revenue_100 * cap, 2)
        # Bug 5: RM cost MUST scale with capacity
        rm_cost = R(rm_total * cap, 2)
        power = R(power_100 * cap, 2)
        
        # Bug 2: Correct compounding salary
        # Year 1 should be exactly total_wages (if capacity is 1.0) 
        # but if user says Y1 66000, then Y1 = total_wages.
        # Bank Norm: Salary is fixed cost, doesn't drop with capacity.
        labour = R(total_wages * (1 + hike)**(yr - 1), 2)
        
        total_var = R(rm_cost + power, 2)
        admin = R((inp.get("admin_expense_per_month", 0) + inp.get("monthly_rent", inp.get("rent", 0))) * 12 * (1 + pct_fraction(inp.get("admin_increase_rate", 0)))**(yr - 1), 2)
        mktg = R(pct_fraction(inp["marketing_expense_pct"]) * rev, 2)
        tl_int = tl_sched[i]["total_interest"]
        
        cop.append({
            "year": yr, 
            "capacity": cap, 
            "revenue": rev, 
            "raw_materials": rm_cost, 
            "power": power,
            "labour": labour, 
            "total_variable": total_var, 
            "depreciation": total_dep,
            "admin_expenses": admin, 
            "marketing_expenses": mktg, 
            "tl_interest": tl_int
        })
    wc_years_initial=[]
    for i,cy in enumerate(cop):
        rm_wc=R100((cy["raw_materials"]/inp["working_days_per_year"])*inp["wc_raw_material_days"])
        wip_wc=R100((cy["total_variable"]/inp["working_days_per_year"])*inp["wc_wip_days"])
        fg_wc=R100(((cy["total_variable"]+cy["admin_expenses"]+cy["tl_interest"])/inp["working_days_per_year"])*inp["wc_finished_goods_days"])
        we_wc=R100(((cy["power"]+cy["labour"])/365)*inp["wc_working_expenses_days"])
        total=R(rm_wc+wip_wc+fg_wc+we_wc)
        wc_years_initial.append({"rm_wc":rm_wc,"wip_wc":wip_wc,"fg_wc":fg_wc,"we_wc":we_wc,"total":total})
    wc_y1=R(input_working_capital or wc_years_initial[0]["total"])
    max_wc_bank_finance=R(wc_y1*inp.get("wc_loan_pct", 0.60)) if wc_y1 > 0 else 0.0
    explicit_wc_loan=R(min(inp.get("working_capital_loan", 0) or 0, max_wc_bank_finance, wc_y1))
    wc_loan_ratio=(explicit_wc_loan/wc_y1) if wc_y1 > 0 and explicit_wc_loan > 0 else inp.get("wc_loan_pct", 0.60)
    wc_years=[]
    for i,cy in enumerate(cop):
        w = wc_years_initial[i]
        bank=R(w["total"]*wc_loan_ratio)
        wc_years.append({"year":cy["year"],"rm_wc":w["rm_wc"],"wip_wc":w["wip_wc"],"fg_wc":w["fg_wc"],"we_wc":w["we_wc"],
                          "total":w["total"],"bank_loan":bank,"margin":R(w["total"]-bank),
                          "wc_interest":R(bank*inp.get("wc_interest_rate", 0.12))})
    # Fix Prompt 4: P&L Structure (No double counting)
    # Bug 3 & 4: Total Expenses & PAT (No double counting)
    cumulative = 0.0
    for i, cy in enumerate(cop):
        cy["wc_interest"] = wc_years[i]["wc_interest"]
        # Bug 3 Formula: salary + utilities + admin + marketing + depreciation + wc_interest + term_interest + COGS
        # utilities = power, COGS = raw_materials
        cy["fixed_expenses"] = R(cy["labour"] + cy["admin_expenses"] + cy["marketing_expenses"] + cy["depreciation"] + cy["wc_interest"] + cy["tl_interest"], 2)
        cy["total_expenses"] = R(cy["raw_materials"] + cy["power"] + cy["fixed_expenses"], 2)
        
        # Bug 4: PAT computation
        cy["profit_before_tax"] = R(cy["revenue"] - cy["total_expenses"], 2)
        
        # Fix Prompt 2: Professional Tax Calculation
        cy["tax"] = calculate_tax(
            cy["profit_before_tax"], 
            cy["year"], 
            inp.get("business_type", "Proprietorship"), 
            inp.get("industry", "Manufacturing"), 
            inp.get("tax_rate_pct", 25),
            revenue=cy["revenue"]
        )
        
        cy["net_profit"]=R(cy["profit_before_tax"]-cy["tax"])
        
        # Fix Prompt 1: Cash Accruals = PAT + Depreciation ONLY
        cy["cash_accruals"]=R(cy["net_profit"]+cy["depreciation"])
        
        cumulative+=cy["net_profit"]
        cy["reserves_surplus"]=R(cumulative)

    wc_bank_y1 = R(wc_years[0]["bank_loan"], 2)
    
    # Bug 1 & 7: MoF Reconciliation (Promoter + Term Loan + WC must equal total)
    # Total Project Cost = All assets + WC Margin + WC Bank Share
    total_proj = R(fixed_project_cost + promoter_working_capital + wc_bank_y1, 2)
    equity = R(total_proj - term_loan - wc_bank_y1, 2)
    
    # Update breakdown with the correct WC parts
    project_cost_items = synced_project_cost_items + [
        {"code": 6, "particulars": "Working Capital Margin (Equity)", "amount": promoter_working_capital},
        {"code": 7, "particulars": "Working Capital - Bank Share", "amount": wc_bank_y1}
    ]
    
    pc = {
        "building_cost": building_cost, 
        "machinery_cost": machinery_total, 
        "contingency": contingency,
        "working_capital": R(promoter_working_capital + wc_bank_y1, 2),
        "wc_bank_share": wc_bank_y1, 
        "total_project_cost": total_proj, 
        "equity_capital": equity,
        "term_loan": term_loan, 
        "wc_loan": wc_bank_y1, 
        "total_finance": R(equity + term_loan + wc_bank_y1, 2),
        # FIX 5: D:E must include WC loan — both TL and WC are bank debt against promoter equity
        "debt_equity_ratio": round((term_loan + wc_bank_y1) / equity, 2) if equity else 0
    }
    # Fix Prompt 5 & 3: Balance Sheet with Margin Money and growing Net Block
    pbs = [{
        "year": 0, 
        "equity": equity, 
        "margin_money": margin_money, 
        "term_loan": term_loan, 
        "reserves": 0.0, 
        "wc_bank": wc_bank_y1,
        "land": land_cost, 
        "gross_block": gross_block, 
        "other_assets": other_project_assets,
        "accum_dep": 0.0, 
        "net_block": gross_block, 
        "current_assets": R(promoter_working_capital + wc_bank_y1), 
        "cash": 0.0
    }]
    
    accum_dep = 0.0
    for i, cy in enumerate(cop):
        accum_dep = R(accum_dep + cy["depreciation"], 2)
        # Margin money release logic
        current_mm = margin_money if cy["year"] <= lock_in else 0.0
        
        pbs.append({
            "year": cy["year"],
            "equity": equity,
            "margin_money": current_mm,
            "term_loan": tl_sched[i]["closing"],
            "reserves": cy["reserves_surplus"],
            "wc_bank": wc_years[i]["bank_loan"],
            "land": land_cost,
            "gross_block": gross_block,
            "other_assets": other_project_assets,
            "accum_dep": accum_dep,
            "net_block": R(gross_block - accum_dep, 2),
            "current_assets": wc_years[i]["total"],
            "cash": 0.0
        })
    pcf, closing_cash = [], 0.0
    for i,cy in enumerate(cop):
        opening=closing_cash
        prev_wc_bank=wc_years[i-1]["bank_loan"] if i>0 else wc_bank_y1
        inc_wc_loan=R(wc_years[i]["bank_loan"]-prev_wc_bank)
        prev_ca=wc_years[i-1]["total"] if i>0 else wc_y1
        inc_ca=R(wc_years[i]["total"]-prev_ca)
        tl_repaid=tl_sched[i]["principal_repaid"]
        sources=R(cy["cash_accruals"]+inc_wc_loan); uses=R(inc_ca+tl_repaid)
        surplus=R(sources-uses); closing_cash=R(opening+surplus)
        pcf.append({"year":cy["year"],"opening_cash":opening,"cash_accruals":cy["cash_accruals"],
                    "inc_wc_loan":inc_wc_loan,"total_sources":sources,"inc_current_assets":inc_ca,
                    "tl_repayment":tl_repaid,"total_uses":uses,"surplus":surplus,"closing_cash":closing_cash})
        pbs[i+1]["cash"]=closing_cash
    _tally_projected_balance_sheet(pbs)
    # Fix Prompt 7: Break-Even Analysis (Professional Formulas)
    bep = []
    revenue_100 = R(revenue_100, 2)
    for cy in cop:
        # Variable Costs = RM + Power + Variable Labour (assume 50% of labour is variable for production workers) + Marketing
        var_labour = R(cy["labour"] * 0.5, 2)
        fix_labour = R(cy["labour"] * 0.5, 2)
        
        var = R(cy["raw_materials"] + cy["power"] + var_labour + cy["marketing_expenses"], 2)
        fix = R(fix_labour + cy["admin_expenses"] + cy["depreciation"] + cy["wc_interest"] + cy["tl_interest"], 2)
        
        contrib = R(cy["revenue"] - var, 2)
        contrib_pct = round(contrib / cy["revenue"], 4) if cy["revenue"] > 0 else 0
        
        bep_sales = R(fix / contrib_pct, 2) if contrib_pct > 0 else 0.0
        bep_not_achievable = (var > cy["revenue"] or contrib <= 0)
        
        margin_of_safety = round((cy["revenue"] - bep_sales) / cy["revenue"] * 100, 2) if cy["revenue"] > bep_sales and cy["revenue"] > 0 else 0.0
        
        bep.append({
            "year": cy["year"],
            "revenue": cy["revenue"],
            "variable_expenses": var,
            "fixed_expenses": fix,
            "contribution": contrib,
            "contribution_pct": contrib_pct,
            "bep_sales": bep_sales,
            "bep_pct": round(bep_sales / (revenue_100 if revenue_100 > 0 else cy["revenue"]) * 100, 2) if bep_sales > 0 else 0,
            "margin_of_safety": margin_of_safety,
            "bep_not_achievable": bep_not_achievable
        })
    # Fix Prompt 1: Professional DSCR Calculation (RBI/IBA Standards)
    dscr_rows = []
    dscr_values_for_avg = []
    moratorium_years = int(inp.get("moratorium_years", 0))

    for i, cy in enumerate(cop):
        cash_acc = cy["cash_accruals"]
        tl_int = cy["tl_interest"]
        tl_repay = tl_sched[i]["principal_repaid"]
        
        total_a = R(cash_acc + tl_int, 2)
        total_b = R(tl_repay + tl_int, 2)
        
        is_morat = (cy["year"] <= moratorium_years)
        
        if is_morat or total_b == 0:
            dv = "N/A"
        else:
            dv = round(total_a / total_b, 2)
            dscr_values_for_avg.append(dv)
            
        dscr_rows.append({
            "year": cy["year"],
            "cash_accruals": cash_acc,
            "tl_interest": tl_int,
            "total_a": total_a,
            "tl_repayment": tl_repay,
            "total_b": total_b,
            "dscr": dv,
            "is_moratorium": is_morat
        })
    
    avg_dscr = round(sum(dscr_values_for_avg) / len(dscr_values_for_avg), 2) if dscr_values_for_avg else 0.0
    y3,pb3=cop[2],pbs[3]
    tot_inv=R(pb3["equity"]+pb3["term_loan"]+pb3["current_assets"])
    cap_emp=R(pb3["equity"]+pb3["reserves"])
    pbidt=R(y3["net_profit"]+y3["tl_interest"]+y3["wc_interest"]+y3["depreciation"])
    monthly_revenue_y1=R(cop[0]["revenue"]/12,2)
    monthly_variable_y1=R(bep[0]["variable_expenses"]/12,2)
    monthly_fixed_y1=R(R(total_wages/12, 2) + inp.get("monthly_rent", inp.get("rent", 0)), 2)
    monthly_exp_y1=R(cop[0]["total_expenses"]/12,2)
    monthly_dep=R(total_dep/12,2)
    monthly_interest_y1=R((cop[0]["tl_interest"]+cop[0]["wc_interest"])/12,2)
    monthly_pat_y1=R(cop[0]["net_profit"]/12,2)
    monthly_principal_y1=R(tl_sched[0]["principal_repaid"]/12,2)
    net_cash_surplus_monthly=R(monthly_pat_y1+monthly_dep-monthly_principal_y1,2)
    annual_tl_service_y1=R(tl_sched[0]["principal_repaid"]+tl_sched[0]["total_interest"],2)
    payback_months=R(total_proj/(cop[0]["revenue"]-bep[0]["variable_expenses"]-bep[0]["fixed_expenses"]+cop[0]["depreciation"]) * 12,2) if (cop[0]["revenue"]-bep[0]["variable_expenses"]-bep[0]["fixed_expenses"]+cop[0]["depreciation"]) > 0 else 0.0
    promoter_pct=R(equity/total_proj*100 if total_proj else 0,2)
    roi_ebitda_y1=R((cop[0]["revenue"]-cop[0]["raw_materials"]-cop[0]["power"]-cop[0]["labour"]-cop[0]["admin_expenses"]-cop[0]["marketing_expenses"])/total_proj*100 if total_proj else 0,2)
    scorecard,total_score=calculate_scorecard(inp, dscr_rows[0]["dscr"], roi_ebitda_y1, payback_months, promoter_pct)
    risk_matrix=calculate_risk_matrix()
    projections=[]
    for i,cy in enumerate(cop):
        tl_service=R(tl_sched[i]["principal_repaid"]+tl_sched[i]["total_interest"],2)
        ebitda=R(cy["revenue"]-cy["raw_materials"]-cy["power"]-cy["labour"]-cy["admin_expenses"]-cy["marketing_expenses"],2)
        projections.append({
            "year": cy["year"],
            "sales": cy["revenue"],
            "expenses": R(cy["total_expenses"],2),
            "ebitda": ebitda,
            "depreciation": cy["depreciation"],
            "interest": R(cy["tl_interest"]+cy["wc_interest"],2),
            "profit_before_tax": cy["profit_before_tax"],
            "tax": cy["tax"],
            "profit_after_tax": cy["net_profit"],
            "emi_paid": tl_service,
            "net_surplus": R(cy["net_profit"]+cy["depreciation"]-tl_sched[i]["principal_repaid"],2),
            "dscr": dscr_rows[i]["dscr"],
            "emi_coverage_ratio": R(ebitda/tl_service,2) if tl_service else 0.0,
        })
    # Fix Prompt 7: Professional Sensitivity Analysis (4 Scenarios)
    sensitivity = []
    base_rev = cop[0]["revenue"]
    base_var = bep[0]["variable_expenses"]
    base_fixed = bep[0]["fixed_expenses"]
    base_cogs = cop[0]["raw_materials"]  # FIX: need for monthly_cogs in sensitivity

    # We use Year 1 for sensitivity as requested
    scenarios = [
        ("Revenue drops 10%", -0.10, 0.0, "Stress"),
        ("Revenue drops 20%", -0.20, 0.0, "Monitor"),
        ("Costs increase 10%", 0.0, 0.10, "Stress"),
        ("Revenue -10% & Costs +5%", -0.10, 0.05, "Critical")
    ]
    
    for label, rev_chg, cost_chg, status_base in scenarios:
        s_rev = R(base_rev * (1 + rev_chg), 2)
        # Variable costs move with revenue, fixed costs increase by cost_chg
        s_var = R(base_var * (1 + rev_chg), 2)
        s_fix = R(base_fixed * (1 + cost_chg), 2)
        
        s_pbt = R(s_rev - s_var - s_fix, 2)
        s_tax = calculate_tax(s_pbt, 1, inp.get("business_type", ""), inp.get("industry", ""), inp.get("tax_rate_pct", 25), revenue=s_rev)
        s_pat = R(s_pbt - s_tax, 2)
        
        # DSCR for sensitivity
        # Total A = PAT + Dep + TL Int
        # Total B = TL Repay + TL Int
        s_num = R(s_pat + cop[0]["depreciation"] + cop[0]["tl_interest"], 2)
        s_den = R(tl_sched[0]["principal_repaid"] + cop[0]["tl_interest"], 2)
        s_dscr = round(s_num / s_den, 2) if s_den > 0 else 0.0
        
        status = "Viable" if s_dscr >= 1.25 else "Monitor" if s_dscr >= 1.0 else "Stress"
        
        sensitivity.append({
            "scenario": label,
            "monthly_revenue": R(s_rev / 12, 2),
            # FIX: monthly_cogs and monthly_ebitda required by PDF sensitivity table
            "monthly_cogs": R(base_cogs * (1 + rev_chg) / 12, 2),
            "monthly_ebitda": R((s_rev - s_var - s_fix) / 12, 2),
            "monthly_profit": R(s_pat / 12, 2),
            "dscr": s_dscr,
            "status": status
        })
    project_cost_items=[
        *synced_project_cost_items,
        {"code": 998, "particulars": "Working Capital - Bank Share", "amount": wc_bank_y1},
    ]
    cma_summary={
        "gross_monthly_revenue": monthly_revenue_y1,
        "net_monthly_revenue": monthly_revenue_y1,
        "gross_profit_monthly": R((cop[0]["revenue"]-cop[0]["raw_materials"])/12,2),
        "cogs_monthly": R(cop[0]["raw_materials"]/12,2),
        "fixed_salary": R(total_wages/12,2),
        "fixed_total": monthly_fixed_y1,
        "mktg_monthly": R(cop[0]["marketing_expenses"]/12,2),
        "variable_total": monthly_variable_y1,
        "operating_monthly_exp": R(monthly_fixed_y1+monthly_variable_y1,2),
        "total_monthly_exp": monthly_exp_y1,
        "ebitda_monthly": R((cop[0]["revenue"]-cop[0]["raw_materials"]-cop[0]["power"]-cop[0]["labour"]-cop[0]["admin_expenses"]-cop[0]["marketing_expenses"])/12,2),
        "ebitda_margin_pct": R(((cop[0]["revenue"]-cop[0]["raw_materials"]-cop[0]["power"]-cop[0]["labour"]-cop[0]["admin_expenses"]-cop[0]["marketing_expenses"])/cop[0]["revenue"]*100) if cop[0]["revenue"] else 0,2),
        "gross_margin_pct": R(((cop[0]["revenue"]-cop[0]["raw_materials"])/cop[0]["revenue"]*100) if cop[0]["revenue"] else 0,2),
        "monthly_dep": monthly_dep,
        "annual_dep": total_dep,
        "monthly_int_y1": monthly_interest_y1,
        "current_principal_monthly": monthly_principal_y1,
        "pbt_monthly": R(cop[0]["profit_before_tax"]/12,2),
        "tax_monthly": R(cop[0]["tax"]/12,2),
        "pat_monthly": monthly_pat_y1,
        "surplus_monthly": net_cash_surplus_monthly,
        "annual_revenue": cop[0]["revenue"],
        "annual_ebitda": R((cop[0]["revenue"]-cop[0]["raw_materials"]-cop[0]["power"]-cop[0]["labour"]-cop[0]["admin_expenses"]-cop[0]["marketing_expenses"]),2),
        "annual_pat": cop[0]["net_profit"],
        "annual_emi": annual_tl_service_y1,
        "net_margin_pct": R(cop[0]["net_profit"]/cop[0]["revenue"]*100 if cop[0]["revenue"] else 0,2),
        "roi_ebitda_pct": roi_ebitda_y1,
        "roi_pat_pct": R(cop[0]["net_profit"]/total_proj*100 if total_proj else 0,2),
        "breakeven_months": payback_months if payback_months > 0 else "N/A",
        "payback_not_achievable": True if payback_months <= 0 else False,
        "breakeven_revenue": bep[0]["bep_sales"]/12 if bep[0]["bep_sales"] > 0 else 0.0,
        "margin_of_safety": R(((monthly_revenue_y1 - (bep[0]["bep_sales"]/12)) / monthly_revenue_y1 * 100), 2) if monthly_revenue_y1 > 0 and bep[0]["bep_sales"] > 0 else 0.0,
        "dscr_y1": dscr_rows[0]["dscr"],
        "dscr_label": dscr_label(dscr_rows[0]["dscr"]),
        "avg_dscr_5yr": avg_dscr,
        "dscr_label": dscr_label(dscr_rows[0]["dscr"]),
        "stock_req": wc_years[0]["rm_wc"]+wc_years[0]["wip_wc"]+wc_years[0]["fg_wc"],
        "debtors": wc_years[0]["fg_wc"],
        "cash_min": 0,
        "total_ca": wc_years[0]["total"],
        "creditors": 0,
        "current_portion_tl": tl_sched[1]["principal_repaid"] if len(tl_sched)>1 else 0,
        "total_cl": R(wc_years[0]["bank_loan"]+(tl_sched[1]["principal_repaid"] if len(tl_sched)>1 else 0),2),
        "net_wc": wc_years[0]["total"],
        "current_ratio": R(wc_years[0]["total"]/(wc_years[0]["bank_loan"]+(tl_sched[1]["principal_repaid"] if len(tl_sched)>1 else 0)),2) if (wc_years[0]["bank_loan"]+(tl_sched[1]["principal_repaid"] if len(tl_sched)>1 else 0)) else 0,
        "total_project_cost": total_proj,
        "term_loan": term_loan,
        "working_capital_loan": wc_bank_y1,
        "total_loan": R(term_loan+wc_bank_y1,2),
        "emi": R(annual_tl_service_y1/12,2),
        "promoter_contribution": equity,
        "promoter_pct": promoter_pct,
        "yr_schedule": [{"year": r["year"],"opening_balance": r["opening"],"emi_paid": R(r["principal_repaid"]+r["total_interest"],2),"interest_paid": r["total_interest"],"principal_paid": r["principal_repaid"],"closing_balance": r["closing"]} for r in tl_sched],
        "monthly_schedule_y1": [],
        "projections_5yr": projections,
        "avg_dscr": avg_dscr,
        "scorecard": scorecard,
        "total_score": total_score,
        "credit_rating": credit_rating(total_score),
        "recommendation": recommendation(total_score),
        "risk_level": risk_level(total_score),
        "risk_matrix": risk_matrix,
        "sensitivity": sensitivity,
        "processing_fee": 0,
        "total_interest_outgo": total_tl_int,
        "interest_coverage_y1": R((cop[0]["revenue"]-cop[0]["raw_materials"]-cop[0]["power"]-cop[0]["labour"]-cop[0]["admin_expenses"]-cop[0]["marketing_expenses"])/cop[0]["tl_interest"],2) if cop[0]["tl_interest"] else 0,
        "asset_turnover_y1": R(cop[0]["revenue"]/total_proj,2) if total_proj else 0,
        "yr1_interest": cop[0]["tl_interest"],
        "products": frontend_products if frontend_products else [{"category": inp.get("primary_product", "Production"), "units_per_month": R(annual_prod_kg*caps[0]/12,2), "avg_price": inp.get("selling_price_per_kg", 0), "monthly_revenue": monthly_revenue_y1, "mix_pct": 100}],
        "project_cost_items": project_cost_items,
    }
    # Fix Prompt 9: Generate Form IV
    form_iv = generate_form_iv(wc_years, pbs, tl_sched, cop, inp)
    
    # Fix: Generate AI Observations for Section 9
    ai_obs = generate_ai_observations(cma_summary, inp)
    cma_summary["ai_observations"] = ai_obs

    # Fix Prompt 12: Internal Validation
    # We call it here so it's available in the JSON response too
    warnings = validate_cma_dpr(inp, cma_summary, {
        "balance_sheet_years": pbs,
        "dscr": {"years": dscr_rows},
        "cash_flow_years": pcf,
        "profit_and_loss_years": cop,
        "project_cost": pc
    })
    
    result = {
        "project_summary":{"entrepreneur_name":inp.get("entrepreneur_name",""),"title":inp.get("title",""),
                            "location":inp.get("location",""),"district":inp.get("district",""),
                            "annual_production_kg":annual_prod_kg,"revenue_at_100pct":revenue_100},
        "machinery":{"items":[
            *machinery_items,
            {"name":inp["machine4_name"],"qty":inp["machine4_qty"],"unit_price":m4,"total":tools_installation},
        ],"tools_installation":tools_installation,"section_c_total":section_c_total,"total":machinery_total},
        "raw_materials":{"leaves_cost":rm_leaves,"consumables_cost":rm_cons,"bottles_cost":rm_bottles,
                         "total":rm_total,"annual_leaves_qty":annual_leaves_kg},
        "manpower":{"promoter_annual":promoter_ann,"skilled_annual":skilled_ann,"semi_skilled_annual":semi_ann,
                    "skilled_total":R(skilled_ann * inp.get("num_skilled_workers", 0)),
                    "semi_skilled_total":R(semi_ann * inp.get("num_semi_skilled_workers", 0)),
                    "unskilled_total": 0,
                    "num_skilled":inp.get("num_skilled_workers", 0),"num_semi":inp.get("num_semi_skilled_workers", 0),
                    "base_wages":base_wages,"benefits":benefits,"total_wages":total_wages},
        "project_cost":pc,
        "depreciation":{"building_gross":building_gross,"machinery_gross":machinery_gross,"gross_block":gross_block,
                        "dep_building_slm":dep_building,"dep_machinery_slm":dep_machinery,"total_per_year":total_dep},
        "term_loan":{"amount":term_loan,"interest_rate":inp["term_loan_interest"],"half_yearly_instalment":half_inst,
                     "total_interest":R(total_tl_int),"schedule":tl_sched},
        "working_capital_years":wc_years,"profit_and_loss_years":cop,"balance_sheet_years":pbs,
        "cash_flow_years":pcf,"breakeven_years":bep,
        "dscr":{"years":dscr_rows,"average":avg_dscr},
        "profitability":{"reference_year":3,"sales":y3["revenue"],"total_investment":tot_inv,
                         "capital_employed":cap_emp,"pbidt":pbidt,
                         "pbidt_pct_sales":round(pbidt/y3["revenue"],4) if y3["revenue"] else 0,
                         "pat":y3["net_profit"],"pat_pct_sales":round(y3["net_profit"]/y3["revenue"],4) if y3["revenue"] else 0},
        "cma_summary": cma_summary,
        "form_iv": form_iv,
        "warnings": warnings,
    }
    validate_reconciliation(result)
    return result

def run_cma(inp):
    gross_monthly_rev = 0
    calculated_cogs = 0
    for p in inp.get("products", []):
        qty = float(p.get("units_per_month", 0) or 0)
        price = float(p.get("avg_price", 0) or p.get("selling_price", 0) or 0)
        pprice = float(p.get("purchase_price", 0) or 0)
        calc_rev = qty * price
        if calc_rev > 0:
            p["monthly_revenue"] = calc_rev
        gross_monthly_rev += float(p.get("monthly_revenue", 0))
        calculated_cogs += qty * pprice
        
    if not gross_monthly_rev:
        gross_monthly_rev = inp.get("expected_monthly_revenue", 0)
        
    gross_margin_pct=inp["gross_margin_pct"]/100
    gross_profit_monthly=gross_monthly_rev*gross_margin_pct
    raw_material_monthly=R(inp.get("raw_material_monthly", 0), 2)
    if calculated_cogs > 0:
        cogs_monthly = R(calculated_cogs)
    else:
        cogs_monthly=R(max(gross_monthly_rev-gross_profit_monthly, raw_material_monthly if gross_margin_pct >= 0.99 else 0))
    net_monthly_rev=gross_monthly_rev

    promoter_ann = R(inp.get("promoter_daily_wage", 0) * inp.get("working_days_per_year", 300))
    skilled_ann = R(inp.get("skilled_worker_daily_wage", 0) * inp.get("working_days_per_year", 300))
    semi_ann = R(inp.get("semi_skilled_daily_wage", 0) * inp.get("working_days_per_year", 300))
    base_wages_ann = R(promoter_ann + skilled_ann * inp.get("num_skilled_workers", 0) + semi_ann * inp.get("num_semi_skilled_workers", 0))
    
    if base_wages_ann == 0 and inp.get("salary_per_employee", 0) > 0:
        base_salary = inp.get("num_employees", 1) * inp.get("salary_per_employee", 0)
    else:
        base_salary = base_wages_ann / 12 if base_wages_ann > 0 else 0

    benefits_monthly=base_salary*inp.get("hr_perquisites_rate", 0)
    fixed_salary=R(base_salary+benefits_monthly)
    fixed_total=inp["rent"]+fixed_salary
    mktg_pct=inp.get("marketing_expense_pct_cma",0)
    mktg_monthly=(net_monthly_rev*mktg_pct/100) if mktg_pct>0 else inp["marketing_advertising"]
    variable_total=(inp["stationery"]+inp["electricity_water"]+inp["repair_maintenance"]+
                    inp["transport_conveyance"]+inp["telephone_internet"]+mktg_monthly+inp["miscellaneous"])
    operating_monthly_exp=fixed_total+variable_total
    total_monthly_exp=operating_monthly_exp+cogs_monthly
    ebitda_monthly=net_monthly_rev-total_monthly_exp
    building_assets,machinery_assets=_depreciable_assets_from_project_cost(
        inp, inp["cma_building_assets"], inp["cma_machinery_assets"]
    )
    annual_dep=R(building_assets*inp["cma_building_dep_pct"]/100+machinery_assets*inp["cma_machinery_dep_pct"]/100)
    monthly_dep=annual_dep/12
    total_proj_cost_input=sum(i["amount"] for i in inp["project_cost_items"])
    project_working_capital=_project_cost_amount_by_terms(inp, ("working capital",), default=0.0)
    input_working_capital=R(max(project_working_capital, inp.get("total_working_capital_requirement", 0) or 0))
    # Bug 7: Detailed Project Cost for CMA
    fixed_project_cost = R(max(total_proj_cost_input - project_working_capital, 0), 2)
    total_proj_cost = R(fixed_project_cost + input_working_capital, 2)
    max_term_loan_finance=R(fixed_project_cost*inp["term_loan_pct"]) if fixed_project_cost > 0 else 0.0
    max_wc_bank_finance=R(input_working_capital*inp["wc_loan_pct"]) if input_working_capital > 0 else 0.0
    term_loan = R(min(inp.get("term_loan_amount", 0) or max_term_loan_finance, max_term_loan_finance or fixed_project_cost, fixed_project_cost), 2)
    wc_loan = R(input_working_capital, 2)
    total_loan = R(term_loan + wc_loan, 2)
    monthly_sched,emi=calc_amortization(total_loan,inp["loan_interest_rate_pct"],inp["tenure_months"])
    yr_sched=yearly_amortization(monthly_sched,inp["tenure_months"])
    yr1_interest=yr_sched[0]["interest_paid"] if yr_sched else 0
    monthly_int_y1=yr1_interest/12
    ebit=ebitda_monthly-monthly_dep; pbt=ebit-monthly_int_y1
    tax=max(pbt*inp["tax_rate_pct"]/100,0); pat=pbt-tax; surplus=pat-emi
    annual_rev=net_monthly_rev*12; annual_ebitda=ebitda_monthly*12; annual_pat=pat*12; annual_emi=emi*12
    ebitda_margin=(ebitda_monthly/net_monthly_rev*100) if net_monthly_rev else 0
    net_margin=(pat/net_monthly_rev*100) if net_monthly_rev else 0
    roi_ebitda=(annual_ebitda/total_proj_cost*100) if total_proj_cost else 0
    roi_pat=(annual_pat/total_proj_cost*100) if total_proj_cost else 0
    be_months = round(total_proj_cost / ebitda_monthly, 1) if ebitda_monthly > 0 else "N/A"
    be_revenue = (fixed_total / (net_monthly_rev - variable_total) * net_monthly_rev) if (net_monthly_rev - variable_total) > 0 else 0
    dscr_y1=ebitda_monthly/emi if emi else 0
    daily_rev=net_monthly_rev/30; daily_exp=total_monthly_exp/30
    daily_cogs=max(cogs_monthly, raw_material_monthly, total_monthly_exp if inp["stock_holding_days"] and not cogs_monthly else 0)/30
    stock_req=daily_cogs*inp["stock_holding_days"]; debtors=daily_rev*inp["debtor_days"]
    cash_min=inp["minimum_cash_balance"]; total_ca=stock_req+debtors+cash_min
    creditors=daily_exp*inp["creditor_days"]; total_cl=creditors+emi
    net_wc=total_ca-total_cl; curr_ratio=total_ca/total_cl if total_cl else 0
    capacity_schedule = [
        float(inp.get(f"capacity_y{i + 1}") or DEFAULT_CAPACITY_SCHEDULE[i])
        for i in range(5)
    ]
    capacity_y1 = capacity_schedule[0]
    revenue_at_100pct = annual_rev / capacity_y1
    cogs_at_100pct = cogs_monthly * 12 / capacity_y1
    projections=[]; sal=fixed_salary*12; cogs=cogs_monthly*12
    adm=(inp["rent"]+inp["stationery"]+inp["electricity_water"]+inp["repair_maintenance"]+
         inp["transport_conveyance"]+inp["telephone_internet"]+inp["miscellaneous"])*12
    mkt=mktg_monthly*12; dep=annual_dep
    rev_g=inp["revenue_growth_pct"]/100; sal_g=inp["salary_increase_pct"]/100; adm_g=inp["admin_increase_pct"]/100
    for y, capacity in enumerate(capacity_schedule, start=1):
        if y>1:
            sal*=(1+sal_g); adm*=(1+adm_g)
            dep*=(1-inp["cma_dep_rate_pct"]/100)
        rev = revenue_at_100pct * capacity * (1 + rev_g) ** (y - 1)
        cogs = cogs_at_100pct * capacity * (1 + rev_g) ** (y - 1)
        mkt=rev*mktg_pct/100 if mktg_pct>0 else (mktg_monthly*12)*(1+adm_g)**(y-1)
        exp=cogs+sal+adm+mkt
        yr_int=yr_sched[y-1]["interest_paid"] if y<=len(yr_sched) else 0
        yr_emi=yr_sched[y-1]["emi_paid"] if y<=len(yr_sched) else 0
        yr_ebitda=rev-exp; yr_ebit=yr_ebitda-dep; yr_pbt=yr_ebit-yr_int
        yr_tax=max(yr_pbt*inp["tax_rate_pct"]/100,0); yr_pat=yr_pbt-yr_tax; yr_net=yr_pat-yr_emi
        yr_dscr=yr_ebitda/yr_emi if yr_emi else 0
        projections.append({"year":y,"capacity":capacity,"sales":R(rev,2),"expenses":R(exp,2),"ebitda":R(yr_ebitda,2),
                             "depreciation":R(dep,2),"interest":R(yr_int,2),"profit_before_tax":R(yr_pbt,2),
                             "tax":R(yr_tax,2),"profit_after_tax":R(yr_pat,2),"emi_paid":R(yr_emi,2),
                             "net_surplus":R(yr_net,2),"dscr":R(yr_dscr,2)})
    avg_dscr=sum(p["dscr"] for p in projections)/len(projections) if projections else 0
    promoter_contribution=R(max(total_proj_cost-total_loan, 0))
    prom_pct=(promoter_contribution/total_proj_cost*100) if total_proj_cost else 0
    scorecard,total_score=calculate_scorecard(inp, dscr_y1, roi_ebitda, be_months, prom_pct)
    # Bug 5: Sensitivity in run_cma must scale COGS
    sensitivity = []
    for label, chg in [("Best Case", 0.20), ("Optimistic", 0.10), ("Base Case", 0.0),
                      ("Conservative", -0.10), ("Pessimistic", -0.20), ("Worst Case", -0.30)]:
        s_rev = net_monthly_rev * (1 + chg)
        # Scale COGS with revenue
        s_cogs = cogs_monthly * (1 + chg)
        s_variable = variable_total * (1 + chg) # assume semi-variable
        s_total_exp = s_cogs + s_variable + fixed_total
        
        s_ebitda = s_rev - s_total_exp
        s_ebit = s_ebitda - monthly_dep
        s_pbt = s_ebit - monthly_int_y1
        s_pat = s_pbt - max(s_pbt * inp["tax_rate_pct"] / 100, 0)
        
        s_dscr_v = s_ebitda / emi if emi else 0
        sensitivity.append({
            "scenario": label,
            "change_pct": int(chg * 100),
            "monthly_revenue": R(s_rev, 2),
            # FIX: monthly_cogs and monthly_ebitda for PDF sensitivity table
            "monthly_cogs": R(s_cogs, 2),
            "monthly_ebitda": R(s_ebitda, 2),
            "monthly_profit": R(s_pat, 2),
            "dscr": R(s_dscr_v, 2),
            "status": dscr_label(s_dscr_v)
        })
    proc_fee=total_loan*inp.get("processing_fee_pct",1.0)/100
    total_int_outgo=sum(y["interest_paid"] for y in yr_sched)
    icr_y1=ebitda_monthly/monthly_int_y1 if monthly_int_y1 else 0
    at_y1=annual_rev/total_proj_cost if total_proj_cost else 0
    return {
        "gross_monthly_revenue":R(gross_monthly_rev,2),"net_monthly_revenue":R(net_monthly_rev,2),
        "gross_profit_monthly":R(gross_profit_monthly,2),"cogs_monthly":R(cogs_monthly,2),
        "fixed_salary":fixed_salary,"fixed_total":R(fixed_total,2),"mktg_monthly":R(mktg_monthly,2),
        "variable_total":R(variable_total,2),"operating_monthly_exp":R(operating_monthly_exp,2),"total_monthly_exp":R(total_monthly_exp,2),
        "ebitda_monthly":R(ebitda_monthly,2),"ebitda_margin_pct":R(ebitda_margin,2),
        "monthly_dep":R(monthly_dep,2),"annual_dep":annual_dep,
        "monthly_int_y1":R(monthly_int_y1,2),"pbt_monthly":R(pbt,2),"tax_monthly":R(tax,2),
        "pat_monthly":R(pat,2),"surplus_monthly":R(surplus,2),
        "annual_revenue":R(annual_rev,2),"annual_ebitda":R(annual_ebitda,2),"annual_pat":R(annual_pat,2),
        "annual_emi":R(annual_emi,2),"net_margin_pct":R(net_margin,2),"ebitda_margin_pct":R(ebitda_margin,2),
        "roi_ebitda_pct":R(roi_ebitda,2),"roi_pat_pct":R(roi_pat,2),
        "breakeven_months": be_months,
        "breakeven_revenue": R(be_revenue, 2),
        "margin_of_safety": R(net_monthly_rev - be_revenue, 2) if be_revenue > 0 else "N/A",
        "dscr_y1":R(dscr_y1,2),"avg_dscr_5yr":R(avg_dscr,2),"dscr_label":dscr_label(dscr_y1),
        "stock_req":R(stock_req,2),"debtors":R(debtors,2),"cash_min":cash_min,
        "total_ca":R(total_ca,2),"creditors":R(creditors,2),"total_cl":R(total_cl,2),
        "net_wc":R(net_wc,2),"current_ratio":R(curr_ratio,2),
        "fixed_project_cost":fixed_project_cost,"input_working_capital":input_working_capital,
        "total_project_cost":total_proj_cost,"term_loan":term_loan,"working_capital_loan":wc_loan,
        "total_loan":total_loan,"emi":R(emi,2),
        "promoter_contribution":promoter_contribution,"promoter_pct":R(prom_pct,2),
        "yr_schedule":yr_sched,"monthly_schedule_y1":monthly_sched[:12],
        "projections_5yr":projections,"avg_dscr":R(avg_dscr,2),
        "scorecard":scorecard,"total_score":total_score,
        "credit_rating":credit_rating(total_score),"recommendation":recommendation(total_score),
        "risk_level":risk_level(total_score),"risk_matrix":calculate_risk_matrix(),"sensitivity":sensitivity,
        "processing_fee":R(proc_fee,2),"total_interest_outgo":R(total_int_outgo,2),
        "interest_coverage_y1":R(icr_y1,2),"asset_turnover_y1":R(at_y1,2),
        "yr1_interest":R(yr1_interest,2),"products":inp["products"],
        "project_cost_items":[
            *[
                item for item in inp["project_cost_items"]
                if "working capital" not in str(item.get("particulars", "")).lower()
            ],
            {"code": 999, "particulars": "Working Capital Requirement", "amount": input_working_capital},
        ],
    }
def generate_form_iv(working_capital_years, balance_sheet_years, tl_schedule, cop, inp):
    """
    Expert Indian CA: Form IV - Comparative Statement of Current Assets & Liabilities.
    Required by Indian Banks for CMA.
    """
    form_iv = []
    for i in range(5):
        yr_idx = i + 1
        wc = working_capital_years[i] if i < len(working_capital_years) else {}
        bs = balance_sheet_years[yr_idx] if yr_idx < len(balance_sheet_years) else {}
        tls = tl_schedule[i] if i < len(tl_schedule) else {}
        pnl = cop[i] if i < len(cop) else {}
        
        # Current Assets
        rm_stock = wc.get("rm_wc", 0)
        wip = wc.get("wip_wc", 0)
        fg_stock = wc.get("fg_wc", 0)
        debtors = wc.get("fg_wc", 0) # Usually debtors are derived from sales
        cash_bank = bs.get("cash", 0)
        other_ca = 0.0
        
        total_ca = R(rm_stock + wip + fg_stock + debtors + cash_bank + other_ca, 2)
        
        # Current Liabilities
        # Sundry Creditors (creditor_days of purchases / 365)
        purchases = pnl.get("raw_materials", 0)
        creditors = R(purchases * int(inp.get("creditor_days", 15)) / 365, 2)
        wc_bank = bs.get("wc_bank", 0)
        # Current Portion of Term Loan (next year's repayment)
        cp_tl = tl_schedule[i+1]["principal_repaid"] if (i+1) < len(tl_schedule) else 0
        other_cl = 0.0
        
        total_cl = R(creditors + wc_bank + cp_tl + other_cl, 2)
        
        nwc = R(total_ca - total_cl, 2)
        current_ratio = round(total_ca / total_cl, 2) if total_cl > 0 else 0.0
        
        form_iv.append({
            "year": yr_idx,
            "rm_stock": rm_stock,
            "wip": wip,
            "fg_stock": fg_stock,
            "debtors": debtors,
            "advance_payments": 0.0,
            "cash_bank": cash_bank,
            "other_ca": other_ca,
            "total_ca": total_ca,
            "creditors": creditors,
            "wc_bank": wc_bank,
            "cp_tl": cp_tl,
            "other_cl": other_cl,
            "total_cl": total_cl,
            "nwc": nwc,
            "current_ratio": current_ratio
        })
    return form_iv


def validate_cma_dpr(inp, cma, dpr):
    """
    PDF Consistency Validator — run before rendering.
    Asserts:
    1. Term Loan + WC Facility + Promoter Contribution == Total Project Cost
      2. Salary progression matches salary_increase_pct assumption
      3. PAT matches Revenue − Total Expenses for each year
      4. Sensitivity is monotonically sane (higher revenue → better profit)
      5. AI narrative matches financial metrics (no false positives)
    """
    warnings = []

    # ── 1. Means of Finance reconciliation ───────────────────────────
    pc = dpr.get("project_cost", {})
    # Include the revolving WC facility in Total Project Cost; the separate
    # scheme subsidy remains an additional funding source, not promoter money.
    promoter  = float(cma.get("promoter_contribution", pc.get("equity_capital", 0)) or 0)
    term_loan = float(cma.get("term_loan", pc.get("term_loan", 0)) or 0)
    wc_loan   = float(cma.get("working_capital_loan", pc.get("wc_loan", 0)) or 0)
    mof_sum   = R(promoter + term_loan + wc_loan, 2)
    proj_cost = float(cma.get("total_project_cost", pc.get("total_project_cost", 0)) or 0)
    if proj_cost > 0 and abs(mof_sum - proj_cost) > 100:
        warnings.append(
            f"VALIDATOR[Funding]: Term Loan + WC Facility + Promoter Contribution ({mof_sum:,.0f}) "
            f"≠ Total Project Cost ({proj_cost:,.0f}). "
            f"Diff = {abs(mof_sum - proj_cost):,.0f}. Check promoter/loan split."
        )

    # ── FIX 4: Project cost line items completeness ───────────────────
    pc_items = cma.get("project_cost_items", [])
    if pc_items and proj_cost > 0:
        items_sum = R(sum(float(item.get("amount", 0) or 0) for item in pc_items), 2)
        if abs(items_sum - proj_cost) > 100:
            warnings.append(
                f"VALIDATOR[ProjectCost]: Sum of cost line items ({items_sum:,.0f}) ≠ "
                f"Total Project Cost ({proj_cost:,.0f}). Hidden amount = {abs(items_sum - proj_cost):,.0f}."
            )

    # ── FIX 5: Debt-equity ratio formula consistency ──────────────────
    # D:E = total bank debt (term loan + WC loan) / promoter's TOTAL equity
    # contribution (fixed equity + WC margin) — same formula the report stores.
    de_ratio  = float(pc.get("debt_equity_ratio", 0) or 0)
    tl_pc     = float(pc.get("term_loan", 0) or 0)
    wc_debt   = float(cma.get("working_capital_loan", pc.get("wc_loan", 0)) or 0)
    eq_pc     = float(cma.get("promoter_contribution", pc.get("total_promoter_contribution", pc.get("equity_capital", 0))) or 0)
    if eq_pc > 0 and de_ratio > 0:
        expected_de = R((tl_pc + wc_debt) / eq_pc, 2)
        if abs(de_ratio - expected_de) > 0.15:
            warnings.append(
                f"VALIDATOR[D:E]: Stored D:E ratio ({de_ratio}) ≠ (TL+WC)/Equity ({expected_de})."
            )

    # ── 2. Balance Sheet check ────────────────────────────────────────
    for i, pb in enumerate(dpr.get("balance_sheet_years", [])):
        if abs(pb.get("check", 0)) > 10:
            warnings.append(f"VALIDATOR[BS]: Year {i}: Balance Sheet does not balance. Diff = {pb['check']:,.0f}")

    # ── 3. DSCR below 1.0 in repayment years ─────────────────────────
    dscr_data = dpr.get("dscr", {})
    for d in dscr_data.get("years", []):
        try:
            dv = float(d["dscr"])
        except (TypeError, ValueError):
            continue
        if dv < 1.0:
            warnings.append(f"VALIDATOR[DSCR]: Year {d['year']}: DSCR {dv} below 1.0 — project cannot service debt")

    # ── 4. PAT formula consistency ────────────────────────────────────
    for i, cy in enumerate(dpr.get("profit_and_loss_years", [])):
        rev  = float(cy.get("revenue", 0) or 0)
        texp = float(cy.get("total_expenses", 0) or 0)
        pbt  = float(cy.get("profit_before_tax", 0) or 0)
        tax  = float(cy.get("tax", 0) or 0)
        pat  = float(cy.get("net_profit", cy.get("pat", 0)) or 0)
        # PBT must equal Revenue − Total Expenses
        if abs((rev - texp) - pbt) > 1:
            warnings.append(
                f"VALIDATOR[PAT]: Year {cy['year']}: PBT formula mismatch. "
                f"Revenue({rev:,.0f}) - TotalExp({texp:,.0f}) = {rev-texp:,.0f} but PBT = {pbt:,.0f}"
            )
        # PAT must equal PBT − Tax
        if abs((pbt - tax) - pat) > 1:
            warnings.append(
                f"VALIDATOR[PAT]: Year {cy['year']}: PAT formula mismatch. "
                f"PBT({pbt:,.0f}) - Tax({tax:,.0f}) = {pbt-tax:,.0f} but PAT = {pat:,.0f}"
            )
        if i >= 0 and pat < 0:
            warnings.append(f"VALIDATOR[PAT]: Year {cy['year']}: Net Profit is negative ({pat:,.0f})")

    # ── 5. Salary progression sanity ─────────────────────────────────
    pnl = dpr.get("profit_and_loss_years", [])
    if len(pnl) >= 2:
        sal_hike = float(inp.get("salary_increase_pct", inp.get("salary_increase_rate", 0.10) * 100) or 10.0) / 100
        y1_lab = float(pnl[0].get("labour", 0) or 0)
        y2_lab = float(pnl[1].get("labour", 0) or 0)
        if y1_lab > 0 and y2_lab > 0:
            actual_hike = (y2_lab - y1_lab) / y1_lab
            if abs(actual_hike - sal_hike) > 0.02:
                warnings.append(
                    f"VALIDATOR[Salary]: Y1={y1_lab:,.0f} → Y2={y2_lab:,.0f} "
                    f"implies {actual_hike*100:.1f}% hike but assumption is {sal_hike*100:.1f}%."
                )

    # ── 6. Sensitivity monotonic sanity ──────────────────────────────
    sensitivity = cma.get("sensitivity", [])
    sorted_sens = sorted(sensitivity, key=lambda s: s.get("change_pct", 0))
    for j in range(1, len(sorted_sens)):
        prev, curr = sorted_sens[j-1], sorted_sens[j]
        prev_rev = float(prev.get("monthly_revenue", 0) or 0)
        curr_rev = float(curr.get("monthly_revenue", 0) or 0)
        prev_pat = float(prev.get("monthly_profit", 0) or 0)
        curr_pat = float(curr.get("monthly_profit", 0) or 0)
        if curr_rev > prev_rev and curr_pat < prev_pat - 1:
            warnings.append(
                f"VALIDATOR[Sensitivity]: Higher revenue scenario ('{curr['scenario']}') has lower PAT "
                f"({curr_pat:,.0f}) than lower revenue scenario ('{prev['scenario']}', {prev_pat:,.0f}). "
                "Check variable cost model."
            )

    # ── 7. AI narrative vs metrics consistency ────────────────────────
    avg_dscr   = float(cma.get("avg_dscr", 0) or 0)
    annual_pat = float(cma.get("annual_pat", 0) or 0)
    rec        = str(cma.get("recommendation", ""))
    obs_list   = cma.get("ai_observations", [])
    obs_text   = " ".join(obs_list).lower()
    if avg_dscr < 1.0 and "viability" in obs_text and "not" not in obs_text:
        warnings.append(
            f"VALIDATOR[AI]: DSCR={avg_dscr} but observations claim viability — narrative does not match metrics."
        )
    if annual_pat < 0 and any("strong" in o.lower() or "sustainable" in o.lower() for o in obs_list):
        warnings.append(
            f"VALIDATOR[AI]: PAT is negative ({annual_pat:,.0f}) but observations contain positive language."
        )

    # ── 8. Negative closing cash ──────────────────────────────────────
    for i, pcf in enumerate(dpr.get("cash_flow_years", [])):
        if float(pcf.get("closing_cash", 0) or 0) < -1:
            warnings.append(f"VALIDATOR[Cash]: Year {i+1}: Closing cash is negative ({pcf.get('closing_cash'):,.0f})")

    return warnings
