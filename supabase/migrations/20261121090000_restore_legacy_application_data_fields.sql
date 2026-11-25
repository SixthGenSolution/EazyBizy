BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text;

ALTER TABLE public.loan_applications
  ADD COLUMN IF NOT EXISTS loan_amount_required numeric,
  ADD COLUMN IF NOT EXISTS plant_machinery_cost numeric,
  ADD COLUMN IF NOT EXISTS negative_list_check boolean,
  ADD COLUMN IF NOT EXISTS industry_specific_data jsonb;

ALTER TABLE public.gtab_applications
  ADD COLUMN IF NOT EXISTS loan_amount_required numeric,
  ADD COLUMN IF NOT EXISTS plant_machinery_cost numeric;

COMMIT;
