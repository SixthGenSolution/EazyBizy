"""
calculations/loan_schedule.py — Term Loan amortisation (CA standard)

BUG 7 FIX: Use half-yearly reducing balance schedule:
  HalfYearlyInstalment = TermLoan / RepaymentHalfYears
  Interest_HalfYearN   = BalanceAtStartOfHalfYear × (interestRate / 2)
  PrincipalRepaid_HalfYearN = HalfYearlyInstalment (0 during moratorium)
  ClosingBalance_HalfYearN  = BalanceAtStartOfHalfYear − PrincipalRepaid_HalfYearN

BUG FIX (moratorium granularity): moratorium used to be converted to whole
years via math.ceil(moratorium_months / 12) — a 6-month moratorium was
silently ROUNDED UP to a full 12-month moratorium (doubling it), while every
display in the report kept showing the original "6 Month(s)" the applicant
actually entered. Moratorium is now tracked in HALF-YEAR units (rounded to
the nearest half-year, since repayment already happens on a half-yearly
cycle), so a 6-month moratorium correctly skips principal for exactly one
half-year, not a full year.
"""
import math
from core.engine import R

_ZERO_YEAR = lambda y: {
    "year": y, "opening_balance": 0.0, "emi_paid": 0.0,
    "interest_paid": 0.0, "principal_paid": 0.0, "closing_balance": 0.0,
    "half_yearly_instalment": 0.0,
    "mid_year_balance": 0.0, "interest_h1": 0.0, "interest_h2": 0.0,
    "moratorium_months_effective": 0,
}


def calculate_loan_schedule(data, scheme_data: dict) -> list:
    """
    Build a 5-year term loan repayment schedule (half-yearly reducing balance).
    Always returns exactly 5 rows.
    """
    term_loan        = float(scheme_data.get("term_loan", 0) or 0)
    rate_pct         = float(getattr(data.assumptions, "interest_rate_pct", 9.5) or 9.5)
    tenure_mo        = int(getattr(data.assumptions, "tenure_months", 60) or 60)
    moratorium_mo    = int(getattr(data.assumptions, "moratorium_months", 0) or 0)

    if term_loan <= 0 or tenure_mo <= 0:
        return [_ZERO_YEAR(y) for y in range(1, 6)]

    annual_rate         = rate_pct / 100
    half_rate           = annual_rate / 2
    tenure_years        = math.ceil(tenure_mo / 12)
    total_half_years    = tenure_years * 2
    # Nearest half-year unit — repayment already runs on a half-yearly cycle,
    # so this is the finest granularity a moratorium can be honoured at.
    moratorium_half_yrs = min(round(moratorium_mo / 6), total_half_years)
    repay_half_years    = max(total_half_years - moratorium_half_yrs, 1)

    # Rounded to the nearest whole rupee — not paisa — because every
    # per-period principal figure in the report (including this flat
    # instalment shown in Section 03) is DISPLAYED in whole rupees. A CA
    # reviewer will naturally cross-check "instalment x count", so the
    # figure actually repaid each period must equal the figure shown, not
    # a paisa-precise value that displays differently. The final period
    # below then absorbs whatever residual this rounding leaves, exactly
    # as a bank's own amortisation schedule adjusts its last instalment.
    half_inst = float(round(term_loan / repay_half_years))

    rows    = []
    balance = term_loan

    for yr in range(1, tenure_years + 1):
        opening = R(balance, 2)
        bal = opening

        # Half-year 1 of this year
        hy1 = 2 * yr - 1
        ih1 = R(bal * half_rate, 2)
        is_last_h1 = hy1 == total_half_years
        repaid_h1 = 0.0 if hy1 <= moratorium_half_yrs else (bal if is_last_h1 else min(half_inst, bal))
        bal = R(max(bal - repaid_h1, 0), 2)

        # Half-year 2 of this year
        hy2 = 2 * yr
        ih2 = R(bal * half_rate, 2)
        is_last_h2 = hy2 == total_half_years
        repaid_h2 = 0.0 if hy2 <= moratorium_half_yrs else (bal if is_last_h2 else min(half_inst, bal))
        closing = R(max(bal - repaid_h2, 0), 2)

        repaid    = R(repaid_h1 + repaid_h2, 2)
        total_int = R(ih1 + ih2, 2)
        emi_paid  = R(repaid + total_int, 2)

        rows.append({
            "year":                   yr,
            "opening_balance":        opening,
            "emi_paid":               emi_paid,
            "interest_paid":          total_int,
            "principal_paid":         repaid,
            "closing_balance":        closing,
            "half_yearly_instalment": half_inst,
            # The TRUE balance after H1 / before H2 — NOT the arithmetic
            # mean of opening and closing. In a year that transitions out
            # of moratorium mid-year (H1 still in moratorium, H2 repaying),
            # the balance is unchanged after H1, so averaging opening and
            # closing would understate it.
            "mid_year_balance":       bal,
            "interest_h1":            ih1,
            "interest_h2":            ih2,
            # CA AUDIT: a 9-month moratorium (not a clean multiple of 6)
            # rounds to the NEAREST half-year — here, 2 half-years = 12
            # months, not 9 — since this schedule can only skip whole
            # half-yearly instalments. Exposed so the report can display
            # what was ACTUALLY applied (Year 1 shows 0 principal repaid
            # either way), instead of silently repeating the raw, now-
            # inaccurate applicant input next to a schedule that disagrees
            # with it — the same class of bug fixed earlier for scheme-
            # mandated moratorium overrides.
            "moratorium_months_effective": moratorium_half_yrs * 6,
        })
        balance = closing

    # Pad to minimum 5 rows so income statement (5-year projection) always has data
    while len(rows) < 5:
        rows.append(_ZERO_YEAR(len(rows) + 1))
    # Return all rows (not capped to 5) — Section H displays the full schedule
    return rows
