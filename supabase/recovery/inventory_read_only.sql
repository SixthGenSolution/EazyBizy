-- READ-ONLY inventory only. Run separately against source and target projects.
-- Do not run any import from this file.
-- Replace each placeholder in a private SQL Editor query copy. The Dashboard
-- may autosave query text; do not save or share a query containing the email.
-- No application form values, financial values, personal names, emails,
-- document paths, or file URLs are selected.

-- 1) In each project, replace the email placeholder to verify the identity.
-- Compare the returned auth_user_id/profile_user_id between projects privately.
WITH email_input AS (
  SELECT lower('<VERIFIED_ACCOUNT_EMAIL>') AS email
)
SELECT
  u.id AS auth_user_id,
  p.user_id AS profile_user_id,
  (p.user_id = u.id) AS profile_is_linked_to_auth,
  (SELECT count(*) FROM auth.users u2, email_input e2
   WHERE lower(u2.email) = e2.email) AS auth_matches_for_email,
  (SELECT count(*) FROM public.profiles p2, email_input e2
   WHERE lower(p2.email) = e2.email) AS profile_matches_for_email
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
CROSS JOIN email_input e
WHERE lower(u.email) = e.email;

-- 2) Compare live columns, types, nullability, and defaults in each project.
SELECT table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles', 'loan_types', 'loan_applications', 'gtab_applications',
    'user_loan_documents'
  )
ORDER BY table_name, ordinal_position;

-- 3) Compare live foreign keys in each project.
SELECT tc.table_name, kcu.column_name, ccu.table_name AS referenced_table,
       ccu.column_name AS referenced_column, tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_catalog = kcu.constraint_catalog
 AND tc.constraint_schema = kcu.constraint_schema
 AND tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_catalog = tc.constraint_catalog
 AND ccu.constraint_schema = tc.constraint_schema
 AND ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.constraint_schema = 'public'
  AND tc.table_name IN (
    'profiles', 'loan_types', 'loan_applications', 'gtab_applications',
    'user_loan_documents'
  )
ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;

-- 4) Compare relevant enum labels in each project.
SELECT t.typname AS enum_type, e.enumlabel, e.enumsortorder
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typname IN (
    'application_decision', 'gtab_application_status', 'gtab_gender',
    'gtab_education', 'gtab_social_category', 'gtab_registration_type',
    'gtab_business_type', 'gtab_industry_type', 'gtab_loan_scheme',
    'gtab_loan_purpose', 'gtab_working_capital_period'
  )
ORDER BY t.typname, e.enumsortorder;

-- 5) Source only: replace the sentinel UUID with the verified SOURCE auth UUID.
-- This reports row-level identifiers and metadata, not form values.
WITH source_owner AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS user_id
)
SELECT 'loan_applications' AS source_table, a.id, a.user_id, a.loan_type_id,
       a.status, a.decision_status::text AS decision_status,
       a.created_at, a.updated_at, a.submitted_at, a.current_step,
       (a.project_report_inputs IS NOT NULL
        AND a.project_report_inputs <> '{}'::jsonb) AS has_report_payload,
       (a.project_report_inputs ? 'uploaded_documents') AS has_document_reference_key
FROM public.loan_applications a
CROSS JOIN source_owner o
WHERE a.user_id = o.user_id
ORDER BY a.created_at, a.id;

-- 6) Source only: same verified SOURCE auth UUID. GTAB owner has no FK in
-- the checked-in base migration, so validate this owner mapping separately.
WITH source_owner AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS user_id
)
SELECT 'gtab_applications' AS source_table, a.id, a.user_id, a.status::text,
       a.current_step, a.submitted_at, a.created_at, a.updated_at
FROM public.gtab_applications a
CROSS JOIN source_owner o
WHERE a.user_id = o.user_id
ORDER BY a.created_at, a.id;

-- 7) Source only: status aggregates and possible ID overlap between tables.
-- Run only after replacing the source owner UUID in both CTEs.
WITH source_owner AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS user_id
)
SELECT 'loan_applications' AS source_table,
       a.status || '/' || coalesce(a.decision_status::text, '<null>') AS state,
       count(*) AS row_count
FROM public.loan_applications a
CROSS JOIN source_owner o
WHERE a.user_id = o.user_id
GROUP BY a.status, a.decision_status
UNION ALL
SELECT 'gtab_applications',
       a.status::text,
       count(*)
FROM public.gtab_applications a
CROSS JOIN source_owner o
WHERE a.user_id = o.user_id
GROUP BY a.status
ORDER BY source_table, state;

WITH source_owner AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS user_id
)
SELECT count(*) AS same_id_rows_in_both_source_tables
FROM public.loan_applications l
JOIN public.gtab_applications g ON g.id = l.id
CROSS JOIN source_owner o
WHERE l.user_id = o.user_id
  AND g.user_id = o.user_id;

-- 8) Source only: payload/document-reference counts; values are not returned.
WITH source_owner AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS user_id
)
SELECT count(*) AS owned_loan_rows,
       count(*) FILTER (
         WHERE project_report_inputs IS NOT NULL
           AND project_report_inputs <> '{}'::jsonb
       ) AS rows_with_report_payload,
       count(*) FILTER (
         WHERE project_report_inputs ? 'uploaded_documents'
       ) AS rows_with_uploaded_documents_key
FROM public.loan_applications a
CROSS JOIN source_owner o
WHERE a.user_id = o.user_id;

-- 9) Source only: check whether the optional document metadata table exists.
SELECT to_regclass('public.user_loan_documents') AS user_loan_documents_table;

-- Only if the preceding query returns public.user_loan_documents, run this
-- separate query after replacing the source UUID. It returns counts only.
-- SELECT document_type::text, status::text, count(*) AS row_count
-- FROM public.user_loan_documents
-- WHERE user_id = '00000000-0000-0000-0000-000000000000'::uuid
-- GROUP BY document_type, status
-- ORDER BY document_type, status;

-- 10) Source only: private Storage object counts by bucket and old user folder.
-- This does not return object names, metadata, or URLs.
WITH source_owner AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS user_id
)
SELECT o.bucket_id, count(*) AS object_count
FROM storage.objects o
CROSS JOIN source_owner u
WHERE o.bucket_id IN ('loan-documents', 'profile-documents')
  AND split_part(o.name, '/', 1) = u.user_id::text
GROUP BY o.bucket_id
ORDER BY o.bucket_id;

-- 11) Target only: destination conflict and lookup preflight.
-- Replace the sentinel UUID with the verified TARGET auth UUID.
WITH target_owner AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS user_id
)
SELECT
  (SELECT count(*) FROM public.loan_applications) AS target_loan_rows,
  (SELECT count(*) FROM public.gtab_applications) AS target_gtab_rows,
  (SELECT count(*) FROM public.profiles p
   CROSS JOIN target_owner u WHERE p.user_id = u.user_id) AS target_profile_rows;

-- Loan-type IDs/names are lookup metadata needed for FK mapping; do not
-- insert or change them as part of this inventory.
SELECT id, name FROM public.loan_types ORDER BY name, id;

-- End: every statement above is SELECT-only. No application or Storage data
-- is created, changed, or deleted by this file.
