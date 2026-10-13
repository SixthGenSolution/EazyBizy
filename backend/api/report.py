"""
routers/report.py
=================
Main CMA report API — generate, validate, download, and list schemes.

Register in main.py:
    from api.report import router as report_router
    app.include_router(report_router)
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional  # noqa: F401 — kept for type hints in other modules

from models.input_schema import CMAReportInput
from schemes.router import route_scheme
from core.engine import DEFAULT_CAPACITY_SCHEDULE, get_scheme_benchmarks
from rules import get_default_engine, MissingRuleError
from calculations.depreciation    import calculate_depreciation
from calculations.loan_schedule   import calculate_loan_schedule
from calculations.working_capital import calculate_wc_by_year
from calculations.income_statement import calculate_income_statement
from calculations.dscr             import calculate_dscr
from calculations.monthly_pnl     import calculate_monthly_pnl
from calculations.break_even      import calculate_break_even
from calculations.balance_sheet   import calculate_balance_sheet
from calculations.scorecard       import calculate_scorecard
from calculations.sensitivity     import calculate_sensitivity
from calculations.validator       import validate_report
from pdf.generator import generate_pdf

import uuid, os, re

router = APIRouter(prefix="/api/v1/report", tags=["report"])

_SAFE_REPORT_ID = re.compile(r'^[0-9A-Fa-f]{8}$')

# Use /tmp on Linux/Mac, %TEMP% on Windows
_TMP = os.environ.get("TEMP", "/tmp")

_LEGACY_CAPACITY_SCHEDULES = {
    "manufacturing": (50, 60, 70, 75, 80),
    "service":       (60, 70, 80, 85, 90),
    "trading":       (60, 70, 80, 85, 90),
    "agriculture":   (80, 85, 90, 95, 100),
}


def _migrate_legacy_capacity_schedule(data: CMAReportInput) -> None:
    industry = str(getattr(data.business, "industry_type", "manufacturing") or "manufacturing").lower()
    legacy = _LEGACY_CAPACITY_SCHEDULES.get(industry)
    if not legacy:
        return

    fields = [f"capacity_y{year}_pct" for year in range(1, 6)]
    current = tuple(float(getattr(data.assumptions, field, 0) or 0) for field in fields)
    if current == legacy:
        for field, capacity in zip(fields, DEFAULT_CAPACITY_SCHEDULE):
            setattr(data.assumptions, field, round(capacity * 100, 2))


def _purge_old_pdfs():
    """Remove CMA PDF files in TEMP older than 2 hours."""
    import time as _t
    cutoff = _t.time() - 7200
    for f in os.listdir(_TMP):
        if f.startswith("CMA_") and f.endswith(".pdf"):
            path = os.path.join(_TMP, f)
            try:
                if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                    os.remove(path)
            except OSError:
                pass

# ── POST /api/v1/report/generate ─────────────────────────────────────────────

@router.post("/generate", summary="Generate full CMA+DPR PDF report")
async def generate_report(data: CMAReportInput):
    """
    Full pipeline: scheme routing → calculations → validation → PDF.

    Returns report_id, download URL, validation status, and key metrics.
    """
    try:
        _migrate_legacy_capacity_schedule(data)
        # 1. Route scheme → get financing structure
        scheme_data = route_scheme(data)

        # BUG FIX: route_scheme() resolves a scheme-specific moratorium
        # (e.g. CGTMSE / Mudra tiers default to their own moratorium via
        # the Rules engine, distinct from whatever the applicant typed)
        # into scheme_data["moratorium_months"] — but nothing downstream
        # ever read that key. calculate_loan_schedule() (and every PDF
        # display, via generator.py's inp dict) read
        # data.assumptions.moratorium_months directly, so the scheme's own
        # mandated moratorium was silently ignored in favour of whatever
        # value happened to be in the raw input. Apply it once here so the
        # rest of the pipeline is consistent with what route_scheme()
        # actually decided.
        _scheme_moratorium = scheme_data.get("moratorium_months")
        if _scheme_moratorium is not None:
            data.assumptions.moratorium_months = int(_scheme_moratorium)

        # 2. Run calculations in dependency order
        dep            = calculate_depreciation(data, scheme_data)
        loan_schedule  = calculate_loan_schedule(data, scheme_data)
        wc_schedule    = calculate_wc_by_year(data, scheme_data)

        # CA AUDIT: route_scheme() (via _compute_project_cost) can only
        # estimate Year-1 working capital with a crude heuristic ("1.5
        # months of Year-1 capacity revenue") — the REAL, detailed Tandon-
        # style WC requirement (stock/debtors/WIP/FG minus creditors,
        # actual days) isn't available until calculate_wc_by_year() runs,
        # a step later in this same pipeline. Every downstream consumer of
        # scheme_data["project_cost"]/"wc_margin"/"wc_loan"
        # (calculate_scorecard's ROI, calculate_break_even's Payback Period
        # Initial Investment, calculate_monthly_pnl, validator checks) was
        # silently using that CRUDE estimate — e.g. one live report showed
        # Section 07's own Total Project Cost as Rs.15,01,700 while Section
        # 28's Payback Period used Rs.15,15,300 for the same "Initial
        # Investment", because the two figures came from different WC
        # bases. Overwrite scheme_data's WC-derived fields with the real
        # ones now that they exist, exactly like the moratorium-override
        # fix above — one correction here, before anything downstream
        # reads it, instead of patching each consumer separately.
        _real_wc_margin = float(wc_schedule[0].get("margin", 0) or 0) if wc_schedule else 0.0
        _real_wc_loan   = float(wc_schedule[0].get("bank_loan", 0) or 0) if wc_schedule else 0.0
        scheme_data["wc_margin"] = round(_real_wc_margin)
        scheme_data["wc_loan"]   = round(_real_wc_loan)
        scheme_data["project_cost"] = round(
            float(scheme_data.get("term_loan", 0) or 0)
            + float(scheme_data.get("promoter_amount", 0) or 0)
            + _real_wc_margin
            + _real_wc_loan
        )

        income         = calculate_income_statement(data, scheme_data, dep, loan_schedule, wc_schedule)
        # CA AUDIT: business.existing_monthly_emi (an existing-business loan
        # already being serviced) and promoter_net_worth.home_loan_emi (the
        # promoter's own personal home loan) are two SEPARATE pre-existing
        # obligations, both drawing on the same cash accruals as the new
        # term loan being appraised — combine them into one Adjusted DSCR
        # input rather than deducting only one or leaving both unmodelled.
        _existing_biz_emi  = float(getattr(data.business, "existing_monthly_emi", 0) or 0)
        _existing_home_emi = float(getattr(data.promoter_net_worth, "home_loan_emi", 0) or 0)
        _combined_existing_emi = _existing_biz_emi + _existing_home_emi
        dscr           = calculate_dscr(income, loan_schedule, scheme_data,
                                         existing_monthly_emi=_combined_existing_emi)
        # Backfill per-year DSCR into income rows (pdf_builder reads income[i]["dscr"])
        for i, row in enumerate(income):
            row["dscr"] = dscr["years"][i]["dscr"] if i < len(dscr["years"]) else 0.0
        monthly        = calculate_monthly_pnl(data, scheme_data, dep, loan_schedule, wc_schedule)
        bep            = calculate_break_even(income, data, scheme_data)
        bs             = calculate_balance_sheet(data, scheme_data, income, dep, loan_schedule, wc_schedule)
        scorecard      = calculate_scorecard(data, income, dscr, bep, scheme_data, wc_schedule)
        sensitivity    = calculate_sensitivity(data, scheme_data, monthly, income, dep)

        # 3. Bundle all computed data
        report_data = {
            "input":            data.model_dump(mode="json"),  # mode=json serialises Enum→value string
            "scheme_data":      scheme_data,
            "depreciation":     dep,
            "loan_schedule":    loan_schedule,
            "wc_schedule":      wc_schedule,
            "income_statement": income,
            "dscr":             dscr,
            "monthly_pnl":      monthly,
            "break_even":       bep,
            "balance_sheet":    bs,
            "scorecard":        scorecard,
            "sensitivity":      sensitivity,
        }

        # 4. Validate — most issues are collected as warnings and do NOT block
        #    PDF generation (they're advisory: a low DSCR or thin margin is a
        #    business risk to flag, not a reason to refuse the report).
        #    V13 is the one hard exception: an "Existing Business" whose
        #    commencement date is today/future while claiming N months of
        #    prior operation is an internally-contradictory INPUT, not a
        #    business-risk outcome — the applicant must fix one of the two
        #    fields before any report (which would otherwise show a
        #    fabricated "N yr M mo" figure) is generated at all.
        validation_issues = []
        try:
            validate_report(report_data)
        except Exception as ve:
            if "V13 FAIL" in str(ve):
                # Re-raise: the outer `except ValueError` handler below turns
                # this into a clean 422 with the original message. Raising an
                # HTTPException directly here would instead be swallowed by
                # the outer `except Exception` handler and turned into a
                # generic 500.
                raise ve
            # Other validation issues — collect them as warnings, still generate PDF
            validation_issues = [str(ve)]
        # 5. Generate PDF regardless of validation issues
        _purge_old_pdfs()
        report_id = str(uuid.uuid4())[:8].upper()
        pdf_path  = os.path.join(_TMP, f"CMA_{report_id}.pdf")
        generate_pdf(report_data, pdf_path)

        # Include warnings collected by both the calculation validator and the
        # PDF consistency validator. Preserve order while avoiding duplicates.
        for issue in report_data.get("validation_warnings", []):
            if issue not in validation_issues:
                validation_issues.append(issue)

        validation_status = "WARNINGS" if validation_issues else "PASS"

        return {
            "report_id":          report_id,
            "pdf_url":            f"/api/v1/report/{report_id}/download",
            "validation_status":  validation_status,
            "validation_warnings": validation_issues,
            "key_metrics": {
                "dscr_average":   dscr["average"],
                "recommendation": scorecard["recommendation"],
                "credit_rating":  scorecard["credit_rating"],
                "payback_months": (None if (bep and bep[0].get("payback_not_achievable")) else (bep[0]["payback_months"] if bep else None)),
                "scheme":         scheme_data["scheme"],
                "report_type":    scheme_data["report_type"],
            },
        }

    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        print(f"[ERROR] /api/v1/report: {e}")
        raise HTTPException(status_code=500, detail="Report generation failed. Check server logs.")


# ── GET /api/v1/report/{report_id}/download ───────────────────────────────────

@router.get("/{report_id}/download", summary="Download generated PDF")
async def download_report(report_id: str):
    """Download the PDF generated by POST /generate."""
    if not _SAFE_REPORT_ID.match(report_id):
        raise HTTPException(status_code=400, detail="Invalid report ID format")
    safe_id = report_id.upper()
    path = os.path.join(_TMP, f"CMA_{safe_id}.pdf")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Report not found or expired")
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=f"CMA_Report_{safe_id}.pdf",
    )


# ── POST /api/v1/report/validate ─────────────────────────────────────────────

@router.post("/validate", summary="Validate inputs without generating PDF")
async def validate_only(data: CMAReportInput):
    """
    Run the full calculation pipeline and return a validation summary.
    No PDF is generated — useful for a live preview / pre-check.
    """
    try:
        _migrate_legacy_capacity_schedule(data)
        scheme_data   = route_scheme(data)
        dep           = calculate_depreciation(data, scheme_data)
        loan_schedule = calculate_loan_schedule(data, scheme_data)
        wc_schedule   = calculate_wc_by_year(data, scheme_data)
        income        = calculate_income_statement(data, scheme_data, dep, loan_schedule, wc_schedule)
        dscr          = calculate_dscr(income, loan_schedule, scheme_data)
        report_data   = {
            "input": data.model_dump(), "scheme_data": scheme_data,
            "income_statement": income, "dscr": dscr, "balance_sheet": [],
        }
        validate_report(report_data)
        return {
            "valid":    True,
            "errors":   [],
            "warnings": [],
            "preview": {
                "dscr_average":   dscr["average"],
                "year1_revenue":  income[0]["revenue"] if income else 0,
                "year1_pat":      income[0]["pat"]     if income else 0,
            },
        }
    except ValueError as e:
        return {"valid": False, "errors": str(e).split("\n"), "warnings": []}


# ── GET /api/v1/report/schemes ────────────────────────────────────────────────

@router.get("/schemes", summary="List supported loan schemes")
async def get_schemes():
    """Return metadata for all supported MSME / government schemes."""
    return {"schemes": [
        {"id": "pmegp",          "name": "PMEGP",          "max_loan": 5_000_000,
         "subsidy_pct": "15-35%", "cma_required": True,    "min_dscr": 1.25},
        {"id": "mudra_shishu",   "name": "Mudra Shishu",   "max_loan": 50_000,
         "subsidy_pct": "0%",     "cma_required": False,   "min_dscr": None},
        {"id": "mudra_kishor",   "name": "Mudra Kishor",   "max_loan": 500_000,
         "subsidy_pct": "0%",     "cma_required": "light", "min_dscr": 1.10},
        {"id": "mudra_tarun",    "name": "Mudra Tarun",    "max_loan": 1_000_000,
         "subsidy_pct": "0%",     "cma_required": True,    "min_dscr": 1.25},
        {"id": "mudra_tarunplus","name": "Mudra Tarun+",   "max_loan": 2_000_000,
         "subsidy_pct": "0%",     "cma_required": True,    "min_dscr": 1.25},
        {"id": "cgtmse",         "name": "CGTMSE",         "max_loan": 50_000_000,
         "subsidy_pct": "0%",     "cma_required": True,    "min_dscr": 1.25},
        {"id": "msme_psu",       "name": "MSME PSU Bank",  "max_loan": 100_000_000,
         "subsidy_pct": "0%",     "cma_required": True,    "min_dscr": 1.25},
    ]}


# ── GET /api/v1/report/schemes/{scheme_id}/rules ─────────────────────────────

def _financing_defaults(sid: str) -> dict:
    """
    Resolve the Rules & Rates engine's financing-split numbers for a scheme.
    Every key is attempted independently — a scheme with no configured
    value for a given key (e.g. moratorium override) simply omits it,
    rather than failing the whole response. This is the same engine
    schemes/*.py and calculations/dscr.py use to compute the actual PDF,
    so this endpoint can never disagree with the generated report.
    """
    engine = get_default_engine()
    out: dict = {}

    try:
        out["dscr_benchmark"] = engine.get_dscr_benchmark(sid)
    except MissingRuleError:
        pass

    if sid == "pmegp":
        try:
            out["subsidy_matrix"] = {
                "General_Urban": {
                    "promoter_pct": round(engine.get_promoter_contribution_pct(sid, "general") * 100, 1),
                    "subsidy_pct":  round(engine.get_margin_money_subsidy_pct("General", "Urban", sid) * 100, 1),
                },
                "General_Rural": {
                    "promoter_pct": round(engine.get_promoter_contribution_pct(sid, "general") * 100, 1),
                    "subsidy_pct":  round(engine.get_margin_money_subsidy_pct("General", "Rural", sid) * 100, 1),
                },
                "Special_Urban": {
                    "promoter_pct": round(engine.get_promoter_contribution_pct(sid, "special") * 100, 1),
                    "subsidy_pct":  round(engine.get_margin_money_subsidy_pct("Special", "Urban", sid) * 100, 1),
                },
                "Special_Rural": {
                    "promoter_pct": round(engine.get_promoter_contribution_pct(sid, "special") * 100, 1),
                    "subsidy_pct":  round(engine.get_margin_money_subsidy_pct("Special", "Rural", sid) * 100, 1),
                },
            }
        except MissingRuleError:
            pass
    elif sid.startswith("mudra"):
        try:
            out["promoter_contribution_pct"] = round(engine.get_promoter_contribution_pct(sid) * 100, 1)
        except MissingRuleError:
            pass
        moratorium = engine.get_moratorium_months_default(sid)
        if moratorium is not None:
            out["moratorium_months_default"] = moratorium
    elif sid == "cgtmse":
        try:
            out["term_loan_pct_default"] = round(engine.get_term_loan_pct_default(sid) * 100, 1)
        except MissingRuleError:
            pass
        moratorium = engine.get_moratorium_months_default(sid)
        if moratorium is not None:
            out["moratorium_months_default"] = moratorium
    elif sid == "msme_psu":
        for key, getter in (
            ("term_loan_pct_default", lambda: engine.get_term_loan_pct_default(sid)),
            ("wc_loan_pct_default", lambda: engine.get_wc_loan_pct_default(sid)),
            ("interest_rate_pct_default", lambda: engine.get_interest_rate_pct_default(sid)),
            ("promoter_floor_pct", lambda: engine.get_promoter_floor_pct(sid)),
        ):
            try:
                value = getter()
                out[key] = round(value * 100, 1) if key != "interest_rate_pct_default" else value
            except MissingRuleError:
                pass

    return out


@router.get("/schemes/{scheme_id}/rules", summary="Full rules for a specific scheme")
async def get_scheme_rules(scheme_id: str):
    """
    Return complete rules for a scheme: subsidy matrix, DSCR benchmarks,
    eligibility conditions, max loan, moratorium, interest range.

    The financing-split numbers (subsidy_matrix, promoter_contribution_pct,
    term_loan_pct_default, wc_loan_pct_default, interest_rate_pct_default,
    moratorium_months_default, promoter_floor_pct, dscr_benchmark) are
    resolved live from the Rules & Rates engine (see _financing_defaults)
    — the same engine schemes/*.py uses to build the actual PDF — rather
    than hardcoded here, so this endpoint can never drift from the report.
    Everything else (eligibility text, collateral notes, CGTMSE fee
    slabs) is scheme metadata, not a financing rate, and stays static.
    """
    _RULES = {
        "pmegp": {
            "name": "PMEGP — Prime Minister's Employment Generation Programme",
            "implementing_body": "KVIC / KVIB / DIC",
            "max_loan_mfg":   5_000_000,
            "max_loan_svc":   2_000_000,
            "max_loan_2nd":  10_000_000,
            "interest_range": "10–12% (normal bank rate)",
            "tenure_years":   "3–7 after moratorium",
            "moratorium":     "6–12 months (bank decides)",
            "collateral":     "None — CGTMSE covers risk",
            "eligible":       "New businesses only",
            "special_categories": ["SC","ST","OBC","Minority","Women","Ex-Serviceman","PwD"],
            "negative_list": ["Tobacco","Alcohol","Pan Masala","Pure Trading (no value addition)"],
            "tdr_lock_in_years": 3,
            "benchmarks": get_scheme_benchmarks("pmegp"),
        },
        "mudra_shishu": {
            "name": "Mudra Shishu",
            "max_loan": 50_000,
            "interest_range": "1–12% (bank decides)",
            "tenure_years": "Up to 5",
            "collateral": "None (CGFMU backed)",
            "cma_required": False,
            "processing_fee": "Nil",
            "benchmarks": get_scheme_benchmarks("mudra_shishu"),
        },
        "mudra_kishor": {
            "name": "Mudra Kishor",
            "min_loan": 50_001, "max_loan": 500_000,
            "interest_range": "8–12%",
            "tenure_years": "Up to 5",
            "collateral": "None",
            "cma_required": "Light CMA",
            "processing_fee": "Nil",
            "benchmarks": get_scheme_benchmarks("mudra_kishor"),
        },
        "mudra_tarun": {
            "name": "Mudra Tarun",
            "min_loan": 500_001, "max_loan": 1_000_000,
            "interest_range": "8–12%",
            "tenure_years": "Up to 7",
            "collateral": "None",
            "cma_required": "Full CMA mandatory",
            "processing_fee": "0.50% of loan amount",
            "benchmarks": get_scheme_benchmarks("mudra_tarun"),
        },
        "mudra_tarunplus": {
            "name": "Mudra TarunPlus",
            "min_loan": 1_000_001, "max_loan": 2_000_000,
            "interest_range": "8–12%",
            "tenure_years": "Up to 7",
            "collateral": "None",
            "cma_required": "Full CMA mandatory",
            "eligibility": "Only for borrowers who fully repaid a Tarun loan",
            "benchmarks": get_scheme_benchmarks("mudra_tarunplus"),
        },
        "cgtmse": {
            "name": "CGTMSE — Credit Guarantee Fund Trust for MSEs",
            "max_loan": 50_000_000,
            "coverage": {"General": "75%", "Women/NER/ZED": "80%", "Special": "85%"},
            "agf_slabs": {
                "Up to Rs. 10L":    "0.75% p.a.",
                "Rs. 10L – 1 Cr":  "1.00% p.a.",
                "Rs. 1 Cr – 5 Cr": "1.35% p.a.",
            },
            "lock_in_months": 18,
            "eligible": "New AND Existing Micro and Small Enterprises",
            "pan_mandatory_above": 500_000,
            "benchmarks": get_scheme_benchmarks("cgtmse"),
        },
        "msme_psu": {
            "name": "MSME PSU Bank Loan",
            "max_loan": "No fixed limit",
            "interest_range": "9–14%",
            "tenure_years": "5–10 with 6–12 months moratorium",
            "cma_required": "Full CMA for all amounts",
            "benchmarks": get_scheme_benchmarks("msme_psu"),
        },
    }
    sid = scheme_id.lower().replace("-", "_")
    # Same aliases the calculation engine uses (rules.normalize_scheme_id) —
    # a bare "mudra" or the frontend's "normal_msme" must resolve to the
    # same scheme metadata the PDF is built from, not 404.
    sid = {"mudra": "mudra_kishor", "normal_msme": "msme_psu"}.get(sid, sid)
    if sid not in _RULES:
        raise HTTPException(404, f"Scheme '{scheme_id}' not found. Available: {list(_RULES.keys())}")

    rules = {**_RULES[sid], **_financing_defaults(sid)}
    return {"scheme_id": sid, "rules": rules}


# ── POST /api/v1/report/schemes/{scheme_id}/eligibility ───────────────────────

class EligibilityInput(BaseModel):
    project_cost:     float
    social_category:  str         = "General"
    area_type:        str         = "Rural"
    industry_type:    str         = "manufacturing"
    business_status:  str         = "New Business"
    experience_years: int         = 0
    is_second_loan:   bool        = False

@router.post("/schemes/{scheme_id}/eligibility", summary="Check scheme eligibility")
async def check_eligibility(scheme_id: str, body: EligibilityInput):
    """
    Check if an applicant is eligible for a scheme and return subsidy %.
    Returns eligible: true/false with reasons and applicable subsidy.
    """
    sid = scheme_id.lower().replace("-", "_")
    reasons = []
    eligible = True

    if sid == "pmegp":
        from schemes.pmegp import validate_pmegp, PMEGPValidationError, calculate_pmegp_finance
        max_cost = 10_000_000 if body.is_second_loan else 5_000_000
        try:
            validate_pmegp(body.project_cost, body.industry_type, body.business_status)
        except PMEGPValidationError as e:
            eligible = False
            reasons.append(str(e))

        subsidy = None
        if eligible:
            cat = "Special" if body.social_category.lower() in (
                "sc","st","obc","minority","women","ex-serviceman","pwd"
            ) else "General"
            finance = calculate_pmegp_finance(body.project_cost, cat, body.area_type)
            subsidy = {
                "promoter_pct":     finance["promoter_pct"],
                "margin_money_pct": finance["margin_money_pct"],
                "term_loan_pct":    finance["term_loan_pct"],
                "margin_money_rs":  finance["margin_money"],
                "tdr_note":         finance["tdr_note"],
            }
        return {"scheme_id": sid, "eligible": eligible, "reasons": reasons, "subsidy": subsidy}

    elif sid.startswith("mudra"):
        from schemes.mudra import validate_mudra, MudraValidationError
        try:
            validate_mudra(body.project_cost, sid)
        except MudraValidationError as e:
            eligible = False
            reasons.append(str(e))
        if "existing" in body.business_status.lower() and sid in ("mudra_shishu",):
            reasons.append("Note: Mudra Shishu preferred for new/informal micro enterprises")
        return {"scheme_id": sid, "eligible": eligible, "reasons": reasons, "subsidy": None}

    elif sid == "cgtmse":
        if "agriculture" in body.industry_type.lower():
            eligible = False
            reasons.append("Agriculture is NOT eligible under CGTMSE")
        return {"scheme_id": sid, "eligible": eligible, "reasons": reasons, "subsidy": None}

    return {"scheme_id": sid, "eligible": True, "reasons": [], "subsidy": None}


# ── GET /api/v1/industries ────────────────────────────────────────────────────

@router.get("/field-units", summary="Unit labels for all input fields")
async def get_field_units():
    """
    Returns the unit for every financial / production input field.
    Use in the frontend to show units next to inputs.
    """
    from core.engine import FIELD_UNITS
    return {"field_units": FIELD_UNITS}


@router.get("/industry-defaults/{industry_type}", summary="CA calculation defaults for an industry")
async def get_industry_calc_defaults(industry_type: str):
    """Return COGS ratio, fixed cost ratio, WC norms for the specified industry."""
    from core.engine import get_industry_defaults
    defaults = get_industry_defaults(industry_type)
    return {
        "industry": industry_type,
        "cogs_pct":        round(defaults["cogs_ratio"]     * 100, 1),
        "fixed_cost_pct":  round(defaults["fixed_ratio"]    * 100, 1),
        "gross_margin_pct":round(defaults["gross_margin"]   * 100, 1),
        "marketing_pct":   round(defaults["marketing_ratio"]* 100, 1),
        "stock_days":      defaults["stock_days"],
        "debtor_days":     defaults["debtor_days"],
        "creditor_days":   defaults["creditor_days"],
        "wc_loan_pct":     round(defaults["wc_loan_pct"]    * 100, 1),
        "capacity_schedule": [round(c * 100) for c in defaults["capacity_schedule"]],
        "note": {
            "manufacturing": "COGS = raw materials + power + packing (variable). Fixed = labour + admin.",
            "service":       "COGS = direct delivery cost only. Fixed costs dominate (salaries). No stock.",
            "trading":       "COGS = purchase price of goods (high). Fixed = overheads. High stock holding.",
        }.get(industry_type.lower(), "Standard MSME norms applied."),
    }


@router.get("/industries", summary="Industry list with PMEGP eligibility and capacity norms")
async def get_industries():
    """Return industry list with default margin %, capacity norms, and PMEGP eligibility."""
    from core.engine import DEFAULT_CAPACITY_SCHEDULE

    return {"industries": [
        {"id": "manufacturing",  "label": "Manufacturing",     "pmegp_eligible": True,
         "max_project_pmegp": 5_000_000,  "default_cogs_pct": 50, "capacity_yr1": round(DEFAULT_CAPACITY_SCHEDULE[0] * 100)},
        {"id": "service",        "label": "Service",           "pmegp_eligible": True,
         "max_project_pmegp": 2_000_000,  "default_cogs_pct": 20, "capacity_yr1": round(DEFAULT_CAPACITY_SCHEDULE[0] * 100)},
        {"id": "trading",        "label": "Trading",           "pmegp_eligible": False,
         "note": "Pure trading (no value addition) NOT eligible under PMEGP",
         "default_cogs_pct": 70, "capacity_yr1": round(DEFAULT_CAPACITY_SCHEDULE[0] * 100)},
        {"id": "agro_processing","label": "Agro-Processing",   "pmegp_eligible": True,
         "max_project_pmegp": 5_000_000, "default_cogs_pct": 55, "capacity_yr1": round(DEFAULT_CAPACITY_SCHEDULE[0] * 100)},
        {"id": "agriculture",    "label": "Agriculture",       "pmegp_eligible": True,
         "note": "Agricultural activities eligible if value-addition is involved",
         "default_cogs_pct": 60, "capacity_yr1": round(DEFAULT_CAPACITY_SCHEDULE[0] * 100)},
    ]}
