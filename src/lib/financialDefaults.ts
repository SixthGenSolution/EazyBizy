import financialDefaults from "../../financial_defaults.json";

export const DEFAULT_WC_INTEREST_RATE_PCT = financialDefaults.wc_interest_rate_pct;

export function resolveWcInterestRatePct(value: number | string | null | undefined): number {
  return value === null || value === undefined || value === ""
    ? DEFAULT_WC_INTEREST_RATE_PCT
    : Number(value);
}
