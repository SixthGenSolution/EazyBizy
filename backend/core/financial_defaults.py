import json
from pathlib import Path


with (Path(__file__).resolve().parents[2] / "financial_defaults.json").open(encoding="utf-8") as defaults_file:
    DEFAULT_WC_INTEREST_RATE_PCT = float(json.load(defaults_file)["wc_interest_rate_pct"])

DEFAULT_WC_INTEREST_RATE = DEFAULT_WC_INTEREST_RATE_PCT / 100


def resolve_wc_interest_rate_pct(value: float | str | None) -> float:
    if value is None or value == "":
        return DEFAULT_WC_INTEREST_RATE_PCT
    return float(value)


def resolve_wc_interest_rate(value: float | str | None) -> float:
    if value is None or value == "":
        return DEFAULT_WC_INTEREST_RATE
    return float(value)
