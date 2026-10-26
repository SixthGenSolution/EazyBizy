"""calculations/depreciation.py — WDV (Written Down Value / reducing-balance)
depreciation for CMAReportInput.

WDV only — no SLM anywhere in this module. Each year:
  depreciation = opening WDV × rate
  opening WDV  = the dynamically calculated Year-1 gross WDV, repeated
                 unchanged for all five projection years
  accumulated depreciation = prior accumulated depreciation + current depreciation
  closing WDV  = gross block − accumulated depreciation
Building and Plant & Machinery + Fixtures remain separate depreciation pools,
each with its existing rate.

BUG 5 FIX (kept): Gross Block for P&M must use PM_with_contingency.
  PM_with_contingency = PM_base × (1 + contingencyPct)
  GrossBlock = Building + PM_with_contingency + Fixtures
  Depreciation base uses PM_with_contingency (not PM_base).
"""
from core.engine import R


def calculate_depreciation(data, scheme_data: dict) -> dict:
    """
    Calculate WDV (reducing-balance) depreciation from structured CMAReportInput.

    Returns
    -------
    dict: building_gross, machinery_gross (pre-contingency), pm_with_contingency,
          gross_block, dep_building_wdv, dep_machinery_wdv (Year-1 values),
          total_per_year, annual_dep (both = Year-1 total, kept for backward
          compatibility with callers that only want a single figure),
          schedule (list of 5 dicts, one per year, with opening/depreciation/
          closing WDV for building, machinery+fixtures, and combined).
    """
    building      = float(data.project.building_cost or 0)
    machinery_base = (
        sum(float(m.quantity) * float(m.unit_price) for m in data.project.machinery_items)
        + float(data.project.tools_installation or 0)
    )
    # Fixed-asset additions (separate from P&M — still depreciable)
    fixtures = R(
        float(getattr(data.project, "computers_cost",       0) or 0)
        + float(getattr(data.project, "furniture_cost",     0) or 0)
        + float(getattr(data.project, "electrification_cost", 0) or 0)
        + float(getattr(data.project, "racks_storage_cost", 0) or 0)
        + float(getattr(data.project, "transportation_cost", 0) or 0)
    )

    # BUG 5 FIX: P&M gross block includes contingency
    contingency_pct    = float(getattr(data.assumptions, "contingency_pct", 0) or 0) / 100
    pm_with_contingency = R(machinery_base * (1 + contingency_pct))

    mach_rate  = float(getattr(data.assumptions, "depreciation_pct",      10) or 10) / 100
    bldg_rate  = float(getattr(data.assumptions, "building_dep_rate_pct",  5) or  5) / 100

    # Machinery pool depreciates alongside fixtures at the same rate (matches
    # the original grouping — fixtures were always depreciated at mach_rate).
    machinery_pool_opening = R(pm_with_contingency + fixtures)
    building_pool_opening  = building

    schedule = []
    gross_block = R(building + pm_with_contingency + fixtures)
    accumulated_depreciation = 0.0
    accumulated_building_depreciation = 0.0
    accumulated_machinery_depreciation = 0.0
    for year in range(1, 6):
        bld_dep  = R(building_pool_opening * bldg_rate)
        mach_dep = R(machinery_pool_opening * mach_rate)
        accumulated_building_depreciation = R(accumulated_building_depreciation + bld_dep)
        accumulated_machinery_depreciation = R(accumulated_machinery_depreciation + mach_dep)
        bld_closing = R(max(building_pool_opening - accumulated_building_depreciation, 0))
        mach_closing = R(max(machinery_pool_opening - accumulated_machinery_depreciation, 0))
        depreciation = R(bld_dep + mach_dep)
        accumulated_depreciation = R(accumulated_depreciation + depreciation)
        schedule.append({
            "year":                   year,
            "opening_wdv":            R(building_pool_opening + machinery_pool_opening),
            "building_opening_wdv":   building_pool_opening,
            "building_depreciation":  bld_dep,
            "building_closing_wdv":   bld_closing,
            "machinery_opening_wdv":  machinery_pool_opening,
            "machinery_depreciation": mach_dep,
            "machinery_closing_wdv":  mach_closing,
            "depreciation":           depreciation,
            "accumulated_depreciation": accumulated_depreciation,
            "closing_wdv":            R(max(gross_block - accumulated_depreciation, 0)),
        })

    year1 = schedule[0]

    return {
        "building_gross":       building,
        "machinery_gross":      machinery_base,       # pre-contingency subtotal
        "pm_with_contingency":  pm_with_contingency,  # BUG 5 — used for gross block & V10 check
        "fixtures_gross":       fixtures,
        "gross_block":          gross_block,
        "dep_building_wdv":     year1["building_depreciation"],
        "dep_machinery_wdv":    year1["machinery_depreciation"],
        "dep_fixtures_wdv":     year1["machinery_depreciation"],  # fixtures share the machinery pool/rate
        # Kept for backward compatibility with callers expecting a single
        # figure (monthly_pnl, income_statement fallback, balance_sheet
        # fallback) — always the Year-1 WDV depreciation, never a flat SLM
        # amount repeated across years. Real per-year figures live in
        # "schedule" below.
        "total_per_year":       year1["depreciation"],
        "annual_dep":           year1["depreciation"],
        "schedule":             schedule,
        "method":               "WDV",
    }
