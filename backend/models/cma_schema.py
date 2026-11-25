from pydantic import BaseModel
from typing import List, Optional

class CMAHistoricalFinancial(BaseModel):
    year: str
    sales: float
    cogs: float
    operating_expenses: float
    interest: float
    depreciation: float
    tax: float
    net_profit: float

class CMADepreciationRates(BaseModel):
    building: float = 5.0
    machinery: float = 15.0
    furniture: float = 10.0
    computers: float = 40.0
    vehicles: float = 15.0

class CMAAssumptions(BaseModel):
    sales_growth: float = 10.0
    expense_growth: float = 5.0
    tax_rate: float = 25.0
    interest_rate: float = 9.5
    depreciation_rates: CMADepreciationRates

class CMAWorkingCapitalNorms(BaseModel):
    stock_days: int = 60
    debtors_days: int = 45
    creditors_days: int = 30
    cash_days: int = 15

class CMAAssetRegisterItem(BaseModel):
    id: str
    name: str
    category: str
    cost: float
    purchase_date: str

class CMALoanStructure(BaseModel):
    term_loan_amount: float
    term_loan_tenure_years: int
    term_loan_moratorium_months: int
    wc_limit: float
    promoter_contribution: float

class CMASensitivitySettings(BaseModel):
    sales_variation: float = 10.0
    cost_variation: float = 5.0

class CMAPayload(BaseModel):
    application_id: str
    business_name: Optional[str] = "N/A"
    promoter_name: Optional[str] = "N/A"
    historical_financials: List[CMAHistoricalFinancial]
    assumptions: CMAAssumptions
    working_capital_norms: CMAWorkingCapitalNorms
    asset_register: List[CMAAssetRegisterItem]
    loan_structure: CMALoanStructure
    sensitivity_settings: CMASensitivitySettings
