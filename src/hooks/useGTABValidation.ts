/**
 * GTAB Validation Hook
 * Integrates the loan rules engine with the GTAB form wizard
 * Provides real-time validation, warnings, and eligibility checks
 */

import { useMemo } from 'react';
import { GTABFormData } from '@/types/gtab';
import {
  validateApplicant,
  validateIndustryInputs,
  validateSchemeEligibility,
  validateFinancialRatios,
  validateBusinessRules,
  generateWarnings,
  calculateFinancialRatios,
  generateBankScore,
  type ValidationResult,
  type SchemeEligibilityResult,
  type BankScoreResult,
  type ApplicantData,
  type IndustryInputs,
  type SchemeDetails,
} from '@/lib/loanRulesEngine';
import { getYear1LoanFigures } from '@/lib/loanSchedule';

export interface GTABValidationResult {
  applicant: ValidationResult;
  industry: ValidationResult;
  scheme: SchemeEligibilityResult;
  financial: ValidationResult;
  bankScore: BankScoreResult;
  allWarnings: string[];
  isOverallValid: boolean;
  isEligible: boolean;
}

export function useGTABValidation(formData: GTABFormData): GTABValidationResult {
  return useMemo(() => {
    const pri = formData.project_report_inputs;
    const wc  = pri?.working_capital;

    // Applicant data — use actual GTABFormData field names
    const applicant: ApplicantData = {
      full_name: [formData.first_name, formData.middle_name, formData.last_name].filter(Boolean).join(' '),
      fathers_name: pri?.promoter?.fathers_name || '',
      date_of_birth: pri?.promoter?.date_of_birth || '',
      gender: formData.gender,
      educational_qual: formData.education,
      social_category: formData.social_category,
      pan_number: pri?.promoter?.pan_number || '',
      aadhaar_number: pri?.promoter?.aadhar_number || '',
      mobile_number: formData.contact_mobile || '',
      address: [formData.address_line_1, formData.address_line_2, formData.city, formData.state, formData.pincode]
        .filter(Boolean).join(', '),
      existing_borrower: false,
      repaid_previous_mudra: false,
      rural_urban: formData.area_type || 'urban',
    };

    // Industry inputs — use correct GTABFormData fields
    const industryInputs: IndustryInputs = {
      industry_type: formData.industry_type,
      // Manufacturing
      raw_materials_annual: (formData.raw_material_cost || 0) * 12,
      machinery_cost: formData.plant_machinery?.reduce((s, m) => s + (Number(m.cost) || 0), 0) || 0,
      production_capacity: formData.production_capacity_units || 0,
      working_days: pri?.dpr?.working_days_per_year || 300,
      power_cost_monthly: formData.electricity_water_cost || 0,
      labour_cost_monthly: formData.total_monthly_salary || 0,
      inventory_days: wc?.stock_days || 0,
      debtor_days: wc?.debtors_days || 0,
      creditor_days: wc?.creditors_days || 0,
      // Service
      employee_cost_monthly: formData.total_monthly_salary || 0,
      rent_monthly: formData.monthly_rent || 0,
      utilities_monthly: formData.electricity_water_cost || 0,
      software_tools_cost: formData.computers_cost || 0,
      monthly_recurring_revenue: formData.expected_monthly_revenue || 0,
      // Trading
      inventory_purchase_cost: formData.average_inventory_value || formData.raw_material_cost || 0,
      stock_holding_days: wc?.stock_days || 0,
      supplier_credit_days: formData.supplier_credit_days || wc?.creditors_days || 0,
      sales_turnover_monthly: formData.expected_monthly_revenue || 0,
      gross_margin_pct: formData.gross_margin || pri?.revenue?.gross_margin_pct || 0,
      // Agriculture
      crop_type: formData.main_crop || '',
      land_owned: formData.land_area_acres || 0,
      land_leased: 0,
      seasonal_cycle_months: 6,
      irrigation_cost: formData.irrigation_cost || 0,
      fertilizer_cost: formData.fertilizer_pesticide_cost || 0,
      labour_cost: formData.labour_cost_seasonal || 0,
      harvest_yield_units: formData.expected_annual_yield || 0,
    };

    // Scheme details
    const schemeDetails: SchemeDetails = {
      loan_scheme: formData.loan_scheme,
      loan_amount_requested: formData.eligible_loan_amount || 0,
      promoter_contribution: formData.margin_money || 0,
      project_cost: formData.total_project_cost || 0,
      industry_type: formData.industry_type,
      is_second_loan: formData.is_second_loan || false,
      area_type: formData.area_type || 'rural',
    };

    // Run validations
    const applicantValidation  = validateApplicant(applicant);
    const industryValidation   = validateIndustryInputs(formData.industry_type, industryInputs);
    const businessValidation   = validateBusinessRules(formData);
    const schemeValidation     = validateSchemeEligibility(
      formData.loan_scheme,
      schemeDetails,
      formData.social_category,
      formData.area_type === 'rural',
    );

    // Merge business rule errors into industry validation
    const mergedIndustry: ValidationResult = {
      is_valid: industryValidation.is_valid && businessValidation.is_valid,
      errors: [...industryValidation.errors, ...businessValidation.errors],
      warnings: [...industryValidation.warnings, ...businessValidation.warnings],
    };

    // Financial ratios
    let financialValidation: ValidationResult = { is_valid: true, errors: [], warnings: [] };
    let bankScore: BankScoreResult = {
      credit_score: 50,
      risk_level: 'medium',
      recommendation: 'REVIEW',
    };

    const annualRevenue = (formData.expected_monthly_revenue || 0) * 12;
    const annualExpense = (formData.total_monthly_expenses || 0) * 12;

    if (annualRevenue > 0 && annualExpense > 0) {
      const loanAmt     = formData.eligible_loan_amount || 0;
      const rate        = pri?.loan?.interest_rate_pct || 9.5;
      const tenure      = pri?.loan?.tenure_months || 60;
      const moratorium  = pri?.loan?.moratorium_months || 0;
      // Year-1 interest/principal from the same half-yearly equal-principal,
      // reducing-balance schedule the backend actually uses — not an EMI approximation.
      const { interestPaid, principalPaid } = getYear1LoanFigures(loanAmt, rate, tenure, moratorium);

      const ratios = calculateFinancialRatios(
        formData.total_project_cost || 0,
        loanAmt,
        formData.margin_money || 0,
        annualRevenue,
        annualExpense,
        principalPaid,
        interestPaid,
      );

      financialValidation = validateFinancialRatios(ratios, formData.loan_scheme);

      const applicantAge = pri?.promoter?.date_of_birth
        ? new Date().getFullYear() - new Date(pri.promoter.date_of_birth).getFullYear()
        : 35;

      bankScore = generateBankScore(
        applicantValidation,
        mergedIndustry,
        schemeValidation,
        ratios,
        applicantAge,
        (formData.business_duration_months || 0) / 12,
        formData.loan_scheme,
      );
    }

    const allWarnings = generateWarnings(
      applicantValidation,
      mergedIndustry,
      schemeValidation,
      financialValidation,
    );

    return {
      applicant: applicantValidation,
      industry: mergedIndustry,
      scheme: schemeValidation,
      financial: financialValidation,
      bankScore,
      allWarnings,
      isOverallValid:
        applicantValidation.is_valid &&
        mergedIndustry.is_valid &&
        schemeValidation.is_valid &&
        financialValidation.is_valid,
      isEligible: schemeValidation.eligible && bankScore.risk_level !== 'very_high',
    };
  }, [formData]);
}
