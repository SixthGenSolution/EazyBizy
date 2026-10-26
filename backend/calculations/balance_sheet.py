"""calculations/balance_sheet.py — Projected balance sheet (Year 0–5)."""
from core.engine import R, _tally_projected_balance_sheet


def calculate_balance_sheet(
    data, scheme_data: dict, income: list, dep: dict,
    loan_schedule: list, wc_schedule: list,
) -> list:
    """
    Build projected balance sheet for Year 0 through Year 5.

    loan_schedule and wc_schedule are expected to have exactly 5 rows.
    """
    term_loan_0   = float(scheme_data.get("term_loan",        0) or 0)
    wc_loan_0     = float(scheme_data.get("wc_loan",          0) or 0)
    promoter      = float(scheme_data.get("promoter_amount",  0) or 0)
    margin_money  = float(scheme_data.get("margin_money",     0) or 0)   # PMEGP subsidy (TDR)
    gross_block   = float(dep.get("gross_block",              0) or 0)
    annual_dep    = float(dep.get("annual_dep",               0) or 0)
    # Fixed project cost only (excludes WC) — WC is already fully represented via
    # current_assets (asset side) and wc_bank/promoter_wc_margin (liability side),
    # so it must NOT also be subtracted here. Using "project_cost" (which nets in
    # only the promoter's WC margin) instead of "fixed_project_cost" made this go
    # negative and clamp to 0, silently dropping preliminary/fixture costs from
    # the asset side and creating a phantom "Short-Term Funding Gap".
    fixed_proj    = float(scheme_data.get("fixed_project_cost", scheme_data.get("project_cost", gross_block)) or 0)
    land          = float(getattr(getattr(data, "project", None), "land_cost", 0) or 0)

    wc_y1_total  = float(wc_schedule[0]["total"])     if wc_schedule else wc_loan_0
    wc_y1_bank   = float(wc_schedule[0]["bank_loan"]) if wc_schedule else wc_loan_0
    wc_y1_margin = float(wc_schedule[0].get("margin", 0)) if wc_schedule else 0.0
    other_assets = R(max(fixed_proj - gross_block - land, 0))

    rows = [{
        "year":               0,
        "equity":             promoter,
        "margin_money":       margin_money,   # PMEGP: shown as Govt Subsidy (TDR)
        "term_loan":          term_loan_0,
        "reserves":           0.0,
        "wc_bank":            wc_y1_bank,
        # Promoter's own working-capital margin — funds part of current_assets
        # on the asset side, so it must appear as owners' funds here too.
        "promoter_wc_margin": wc_y1_margin,
        "land":               land,
        "gross_block":        gross_block,
        "other_assets":       other_assets,
        "accum_dep":          0.0,
        "net_block":          gross_block,
        "current_assets":     wc_y1_total,
        "cash":               0.0,
    }]

    accum_dep = 0.0
    for i, yr in enumerate(income):
        dep_yr     = float(yr.get("depreciation", annual_dep) or annual_dep)
        accum_dep  = R(accum_dep + dep_yr)
        rows.append({
            "year":               yr["year"],
            "equity":             promoter,
            "margin_money":       margin_money,   # PMEGP: TDR released after 3 years
            "term_loan":          R(float(loan_schedule[i]["closing_balance"])),
            "reserves":           R(float(yr.get("reserves_surplus", 0) or 0)),
            "wc_bank":            R(wc_y1_bank),
            "promoter_wc_margin": R(float(wc_schedule[i].get("margin", 0))) if i < len(wc_schedule) else wc_y1_margin,
            "land":               land,
            "gross_block":        gross_block,
            "other_assets":       other_assets,
            "accum_dep":          R(accum_dep),
            "net_block":          R(max(gross_block - accum_dep, 0)),
            "current_assets":     R(float(wc_schedule[i]["total"])) if i < len(wc_schedule) else wc_y1_total,
            "cash":               0.0,
        })

    _tally_projected_balance_sheet(rows)
    return rows
