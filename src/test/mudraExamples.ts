/**
 * Mudra Loan Scheme Examples
 * Demonstrates Mudra scheme validation and eligibility checking
 */

import {
  getMudraSchemeByAmount,
  validateMudraEligibility,
  checkMudraSchemeEligibility,
} from '../lib/loanRulesEngine';
import type { ApplicantData } from '../lib/loanRulesEngine';
import type { GTABIndustryType } from '../types/gtab';

const createExampleApplicant = (
  full_name: string,
  date_of_birth: string,
  repaid_previous_mudra: boolean,
): ApplicantData => ({
  full_name,
  fathers_name: 'Example Parent',
  date_of_birth,
  gender: 'undisclosed',
  educational_qual: 'graduate',
  social_category: 'general',
  pan_number: 'ABCDE1234F',
  aadhaar_number: '000000000000',
  mobile_number: '0000000000',
  address: 'Example address',
  repaid_previous_mudra,
});

// Example 1: Mudra Shishu (up to ₹50,000)
export function exampleMudraShishu() {
  const loanAmount = 30000;
  const applicant = createExampleApplicant('John Doe', '1990-01-01', true);
  const industryType: GTABIndustryType = 'manufacturing';

  const scheme = getMudraSchemeByAmount(loanAmount);
  const validation = validateMudraEligibility(
    scheme!,
    loanAmount,
    applicant,
    industryType
  );

  return {
    loanAmount,
    recommendedScheme: scheme,
    ...validation,
  };
}

// Example 2: Mudra Kishor (₹50,001 to ₹5,00,000)
export function exampleMudraKishor() {
  const loanAmount = 200000;
  const applicant = createExampleApplicant('Jane Smith', '1985-05-15', true);
  const industryType: GTABIndustryType = 'service';

  const scheme = getMudraSchemeByAmount(loanAmount);
  const validation = validateMudraEligibility(
    scheme!,
    loanAmount,
    applicant,
    industryType
  );

  return {
    loanAmount,
    recommendedScheme: scheme,
    ...validation,
  };
}

// Example 3: Mudra Tarun (₹5,00,001 to ₹10,00,000)
export function exampleMudraTarun() {
  const loanAmount = 750000;
  const applicant = createExampleApplicant('Raj Kumar', '1980-03-20', true);
  const industryType: GTABIndustryType = 'trading';

  const scheme = getMudraSchemeByAmount(loanAmount);
  const validation = validateMudraEligibility(
    scheme!,
    loanAmount,
    applicant,
    industryType
  );

  return {
    loanAmount,
    recommendedScheme: scheme,
    ...validation,
  };
}

// Example 4: Mudra Tarun Plus (₹10,00,001 to ₹20,00,000)
export function exampleMudraTarunPlus() {
  const loanAmount = 1500000;
  const applicant = createExampleApplicant('Priya Singh', '1975-08-10', true);
  const industryType: GTABIndustryType = 'manufacturing';

  const scheme = getMudraSchemeByAmount(loanAmount);
  const validation = validateMudraEligibility(
    scheme!,
    loanAmount,
    applicant,
    industryType
  );

  return {
    loanAmount,
    recommendedScheme: scheme,
    ...validation,
  };
}

// Example 5: Mudra Tarun Plus without prior repayment (should fail)
export function exampleMudraTarunPlusNoRepayment() {
  const loanAmount = 1500000;
  const applicant = createExampleApplicant('Amit Patel', '1975-08-10', false);
  const industryType: GTABIndustryType = 'service';

  const scheme = getMudraSchemeByAmount(loanAmount);
  const validation = validateMudraEligibility(
    scheme!,
    loanAmount,
    applicant,
    industryType
  );

  return {
    loanAmount,
    recommendedScheme: scheme,
    ...validation,
  };
}

// Example 6: Comprehensive scheme eligibility check
export function exampleComprehensiveMudraCheck() {
  const loanAmount = 800000;
  const applicant = createExampleApplicant('Sunita Sharma', '1982-11-25', true);
  const industryType: GTABIndustryType = 'manufacturing';
  const financialRatios = {
    debt_equity_ratio: 1.5,
    dscr: 1.8,
    roe: 25,
    current_ratio: 1.8,
    gross_margin: 35,
  };

  const result = checkMudraSchemeEligibility(
    loanAmount,
    applicant,
    industryType,
    financialRatios
  );

  return {
    loanAmount,
    ...result,
  };
}

// Example 7: Invalid loan amount (too high)
export function exampleInvalidLoanAmount() {
  const loanAmount = 2500000; // Above ₹20 lakhs limit
  const applicant = createExampleApplicant('Vikram Singh', '1970-01-01', true);
  const industryType: GTABIndustryType = 'manufacturing';

  const result = checkMudraSchemeEligibility(
    loanAmount,
    applicant,
    industryType
  );

  return {
    loanAmount,
    ...result,
  };
}

// Example usage in React component:
/*
import { exampleComprehensiveMudraCheck } from './mudraExamples';

function MudraEligibilityChecker() {
  const mudraResult = exampleComprehensiveMudraCheck();

  return (
    <div className="mudra-checker">
      <h3>Mudra Scheme Eligibility</h3>

      <div className="result-summary">
        <p><strong>Loan Amount:</strong> ₹{mudraResult.loanAmount.toLocaleString()}</p>
        <p><strong>Recommended Scheme:</strong> {mudraResult.recommendedScheme?.toUpperCase()}</p>
        <p><strong>Eligible:</strong> {mudraResult.isEligible ? 'Yes' : 'No'}</p>
      </div>

      {mudraResult.errors.length > 0 && (
        <div className="errors">
          <h4>Issues:</h4>
          <ul>
            {mudraResult.errors.map((error, index) => (
              <li key={index} className="text-red-600">{error}</li>
            ))}
          </ul>
        </div>
      )}

      {mudraResult.warnings.length > 0 && (
        <div className="warnings">
          <h4>Warnings:</h4>
          <ul>
            {mudraResult.warnings.map((warning, index) => (
              <li key={index} className="text-yellow-600">{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {mudraResult.recommendations.length > 0 && (
        <div className="recommendations">
          <h4>Recommendations:</h4>
          <ul>
            {mudraResult.recommendations.map((rec, index) => (
              <li key={index} className="text-blue-600">{rec}</li>
            ))}
          </ul>
        </div>
      )}

      {mudraResult.alternatives.length > 0 && (
        <div className="alternatives">
          <h4>Alternative Schemes:</h4>
          <ul>
            {mudraResult.alternatives.map((alt, index) => (
              <li key={index}>{alt.toUpperCase()}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
*/