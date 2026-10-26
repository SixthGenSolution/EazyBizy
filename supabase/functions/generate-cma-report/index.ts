import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parsePlantMachinery, type GTABApplicationRow } from '../_shared/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { applicationId } = await req.json();

    if (!applicationId) {
      return new Response(
        JSON.stringify({ error: 'Application ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating CMA report for application:', applicationId);

    // Fetch application data
    const { data: application, error: fetchError } = await supabase
      .from('loan_applications')
      .select('*')
      .eq('id', applicationId)
      .single();

    if (fetchError || !application) {
      console.error('Error fetching application:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Application not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const app = application as GTABApplicationRow;
    const projectReportInputs = (app.project_report_inputs ?? {}) as Record<string, any>;
    const promoterInputs = (projectReportInputs.promoter ?? {}) as Record<string, any>;
    const businessInputs = (projectReportInputs.business ?? {}) as Record<string, any>;
    const loanInputs = (projectReportInputs.loan ?? {}) as Record<string, any>;
    const dprInputs = (projectReportInputs.dpr ?? {}) as Record<string, any>;
    const promoterContributionInputs = (projectReportInputs.promoter_contribution ?? {}) as Record<string, any>;
    const workingCapitalInputs = (projectReportInputs.working_capital ?? {}) as Record<string, any>;
    const revenueInputs = (projectReportInputs.revenue ?? {}) as Record<string, any>;
    const promoterAssetsInputs = (projectReportInputs.promoter_assets ?? {}) as Record<string, any>;
    const competitors = Array.isArray(projectReportInputs.competitors)
      ? projectReportInputs.competitors
      : [];

    // Calculate totals
    const plantMachinery = parsePlantMachinery(app.plant_machinery);
    const machineryLineTotal = plantMachinery.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
    const toolsInstallation = Number(app.machinery_installation_cost || 0);
    const machineryTotal = machineryLineTotal + toolsInstallation;

    const totalProjectCost =
      Number(app.land_cost || 0) +
      Number(app.shed_building_cost || 0) +
      machineryTotal +
      Number(app.computers_cost || 0) +
      Number(app.furniture_cost || 0) +
      Number(app.electrification_cost || 0) +
      Number(app.racks_storage_cost || 0) +
      Number(app.transportation_cost || 0) +
      Number(app.other_initial_expenditure || 0);

    const promoterContribution =
      Number(promoterContributionInputs.own_savings || 0) +
      Number(promoterContributionInputs.family_contribution || 0) +
      Number(promoterContributionInputs.other_sources || 0);
    const marginMoney = promoterContribution > 0 ? promoterContribution : totalProjectCost * 0.25;
    const eligibleLoanAmount = totalProjectCost - marginMoney;
    const effectiveLoanAmount = Number(loanInputs.loan_amount || 0) || eligibleLoanAmount;
    const effectiveInterestRate = Number(loanInputs.interest_rate_pct || 0) || 10.5;
    const effectiveTenureMonths = Number(loanInputs.tenure_months || 0) || 60;

    const totalMonthlySalary = Number(app.employee_count || 0) * Number(app.salary_per_employee || 0);

    const totalMonthlyExpenses =
      Number(app.monthly_rent || 0) +
      totalMonthlySalary +
      Number(app.raw_material_cost || 0) +
      Number(app.stationery_cost || 0) +
      Number(app.electricity_water_cost || 0) +
      Number(app.repair_maintenance_cost || 0) +
      Number(app.transport_cost || 0) +
      Number(app.telephone_internet_cost || 0) +
      Number(app.marketing_cost || 0) +
      Number(app.miscellaneous_cost || 0);

    const annualExpenses = totalMonthlyExpenses * 12;
    const workingCapitalAnnual = app.working_capital_period === 'annual'
      ? Number(app.working_capital_required || 0)
      : Number(app.working_capital_required || 0) * 12;

    // Format currency for report
    const formatINR = (amount: number) => {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(amount);
    };

    const formatOverride = (label: string, value: unknown) =>
      value === undefined || value === null || !Number.isFinite(Number(value))
        ? ""
        : `- ${label}: ${formatINR(Number(value))}`;
    const manualFinancingOverrides = [
      formatOverride("Term Loan Amount", dprInputs.term_loan_amount_override),
      formatOverride("Working Capital Loan Amount", dprInputs.working_capital_loan_override),
      formatOverride("Government Subsidy — Margin Money", dprInputs.margin_money_override),
      formatOverride("Promoter's Contribution", dprInputs.promoter_contribution_override),
    ].filter(Boolean).join("\n") || "No manual amount overrides were entered.";

    // Generate the CMA Report using Lovable AI
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    const prompt = `Generate a professional Credit Monitoring Arrangement (CMA) Report for a ${app.loan_scheme?.toUpperCase() || 'MSME'} loan application with the following details:

**APPLICANT INFORMATION:**
- Name: ${app.first_name} ${app.middle_name || ''} ${app.last_name}
- Gender: ${app.gender}
- Education: ${app.education?.replace('_', ' ')}
- Social Category: ${app.social_category?.toUpperCase()}
- Contact: ${app.contact_mobile} | ${app.contact_email}
- PAN: ${promoterInputs.pan_number || 'N/A'}
- Aadhaar: ${promoterInputs.aadhar_number || 'N/A'}
- Date of Birth: ${promoterInputs.date_of_birth || 'N/A'}
- Father's Name: ${promoterInputs.fathers_name || 'N/A'}
- Years of Experience: ${promoterInputs.years_experience || 'N/A'}

**BUSINESS DETAILS:**
- Business Name: ${businessInputs.business_name || app.business_entity_name || 'N/A'}
- Type of Business: ${businessInputs.nature_of_business || app.type_of_business || 'N/A'}
- Industry: ${businessInputs.industry || app.industry_type?.charAt(0).toUpperCase()}${app.industry_type?.slice(1) || 'N/A'}
- Registration Type: ${app.registration_type || 'Proprietorship'}
- Business Status: ${app.business_type === 'existing_business' ? `Existing Business (${app.business_duration_months} months)` : 'New Business'}
- Business Description: ${app.business_description || 'N/A'}
- Products/Services: ${app.products_services || 'N/A'}
- Target Market: ${businessInputs.target_market || app.target_market || 'N/A'}
- Target Areas: ${Array.isArray(businessInputs.target_areas) ? businessInputs.target_areas.join(', ') : 'N/A'}
- GST Number: ${businessInputs.gst_number || 'N/A'}
- MSME Number: ${businessInputs.msme_number || 'N/A'}
- Competitive Advantage: ${app.competitive_advantage || 'N/A'}
- Market Size (Crores): ${businessInputs.market_size_crores || 'N/A'}
- Market Growth %: ${businessInputs.market_growth_pct || 'N/A'}

**LOCATION:**
${businessInputs.store_address || app.address_line_1 || 'N/A'}
${app.address_line_2 || ''}
${businessInputs.store_city || app.city || 'N/A'}, ${businessInputs.store_state || app.state || 'N/A'} - ${businessInputs.store_pincode || app.pincode || 'N/A'}

**PROJECT COST BREAKUP:**
1. Land Cost: ${formatINR(Number(app.land_cost) || 0)}
2. Shed/Building: ${formatINR(Number(app.shed_building_cost) || 0)}
3. Plant & Machinery incl. Tools/Installation: ${formatINR(machineryTotal)}
4. Computers & IT: ${formatINR(Number(app.computers_cost) || 0)}
5. Furniture & Fixtures: ${formatINR(Number(app.furniture_cost) || 0)}
6. Electrification: ${formatINR(Number(app.electrification_cost) || 0)}
7. Racks & Storage: ${formatINR(Number(app.racks_storage_cost) || 0)}
8. Transportation: ${formatINR(Number(app.transportation_cost) || 0)}
9. Installation included in Plant & Machinery: ${formatINR(toolsInstallation)}
10. Other Expenditure: ${formatINR(Number(app.other_initial_expenditure) || 0)}

**TOTAL PROJECT COST: ${formatINR(totalProjectCost)}**
**PROMOTER CONTRIBUTION: ${formatINR(marginMoney)}**
**ELIGIBLE LOAN AMOUNT: ${formatINR(effectiveLoanAmount)}**

**USER-ENTERED MEANS OF FINANCE AMOUNTS (use these exact values; do not replace with defaults or recalculate):**
${manualFinancingOverrides}

**MONTHLY OPERATING EXPENSES:**
- Rent: ${formatINR(Number(app.monthly_rent) || 0)}
- Salaries (${app.employee_count || 0} employees): ${formatINR(totalMonthlySalary)}
- Raw Materials: ${formatINR(Number(app.raw_material_cost) || 0)}
- Electricity & Water: ${formatINR(Number(app.electricity_water_cost) || 0)}
- Transport: ${formatINR(Number(app.transport_cost) || 0)}
- Marketing: ${formatINR(Number(app.marketing_cost) || 0)}
- Others: ${formatINR(Number(app.stationery_cost) + Number(app.repair_maintenance_cost) + Number(app.telephone_internet_cost) + Number(app.miscellaneous_cost) || 0)}

**TOTAL MONTHLY EXPENSES: ${formatINR(totalMonthlyExpenses)}**
**ANNUAL EXPENSES: ${formatINR(annualExpenses)}**

**WORKING CAPITAL REQUIREMENT:**
- Required: ${formatINR(Number(app.working_capital_required) || 0)} (${app.working_capital_period})
- Annual Working Capital: ${formatINR(workingCapitalAnnual)}

**EXPECTED REVENUE:**
- Monthly Revenue: ${formatINR(Number(app.expected_monthly_revenue) || 0)}
- Expected Employment: ${app.expected_employment || 'N/A'} persons
- Gross Margin %: ${revenueInputs.gross_margin_pct || 'N/A'}
- Revenue Growth %: ${revenueInputs.revenue_growth_pct || 'N/A'}
- Expense Growth %: ${revenueInputs.expense_growth_pct || 'N/A'}
- Tax Rate %: ${revenueInputs.tax_rate_pct || 'N/A'}
- Projection Years: ${revenueInputs.projection_years || 'N/A'}

**LOAN DETAILS:**
- Scheme: ${loanInputs.loan_scheme || app.loan_scheme?.toUpperCase() || 'MSME'}${app.loan_scheme === 'other_scheme' ? ` (${app.loan_scheme_other})` : ''}
- Purpose: ${loanInputs.loan_type || app.loan_purpose?.replace(/_/g, ' ').toUpperCase() || 'TERM LOAN'}
- Interest Rate: ${effectiveInterestRate}%
- Tenure: ${effectiveTenureMonths} months
- Moratorium: ${loanInputs.moratorium_months || 0} months
- Processing Fee: ${loanInputs.processing_fee_pct || 0}%
- Preferred Bank: ${loanInputs.bank_name || 'N/A'}
- Collateral: ${loanInputs.collateral_details || 'N/A'}
- Guarantor: ${loanInputs.guarantor_name || 'N/A'} (${loanInputs.guarantor_relation || 'N/A'})

**WORKING CAPITAL ASSUMPTIONS:**
- Stock Days: ${workingCapitalInputs.stock_days || 'N/A'}
- Debtors Days: ${workingCapitalInputs.debtors_days || 'N/A'}
- Creditors Days: ${workingCapitalInputs.creditors_days || 'N/A'}
- Cash Balance: ${formatINR(Number(workingCapitalInputs.cash_balance) || 0)}

**PROMOTER ASSETS:**
- Residential Property: ${formatINR(Number(promoterAssetsInputs.residential_property) || 0)}
- Fixed Deposits: ${formatINR(Number(promoterAssetsInputs.fixed_deposits) || 0)}
- Mutual Funds: ${formatINR(Number(promoterAssetsInputs.mutual_funds) || 0)}
- Savings Account: ${formatINR(Number(promoterAssetsInputs.savings_account) || 0)}
- Home Loan Outstanding: ${formatINR(Number(promoterAssetsInputs.home_loan_outstanding) || 0)}

**COMPETITOR SNAPSHOT:**
${competitors.length > 0
  ? competitors
      .map(
        (item: Record<string, unknown>, index: number) =>
          `${index + 1}. ${item.name || 'Competitor'} | ${item.type || 'N/A'} | ${item.distance || 'N/A'} | Strengths: ${item.strengths || 'N/A'} | Weaknesses: ${item.weaknesses || 'N/A'}`
      )
      .join('\n')
  : 'No competitors captured'}

Please start the report with the following sentence exactly:
"Powered by EazyBizy and prepared for internal appraisal, credit review and authorized banking use only."

Please generate a professional, bank-ready CMA report following RBI guidelines. Include:
1. Executive Summary
2. Promoter Background (based on experience info: ${app.promoter_experience || 'N/A'})
3. Project Overview
4. Means of Finance (showing Term Loan vs Working Capital split)
5. Cost of Project (detailed breakup)
6. Projected Profitability Statement (Year 1-3)
7. Cash Flow Projections
8. Break-Even Analysis
9. DSCR (Debt Service Coverage Ratio) Calculation
10. Risk Assessment & Mitigation
11. Recommendations

Format the output as a clean, professional report suitable for bank submission.`;

    const aiResponse = await fetch('https://api.lovable.dev/api/v2/models/google/gemini-2.5-flash', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt,
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiResult = await aiResponse.json();
    const report = aiResult.response || aiResult.text || aiResult.content;

    if (!report) {
      throw new Error('No report generated from AI');
    }

    // Save report to database
    const { error: updateError } = await supabase
      .from('loan_applications')
      .update({ 
        bank_formatted_report: report,
        updated_at: new Date().toISOString()
      })
      .eq('id', applicationId);

    if (updateError) {
      console.error('Error saving report:', updateError);
    }

    console.log('CMA report generated successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        report: report 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in generate-cma-report function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
