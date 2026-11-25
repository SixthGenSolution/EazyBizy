# Loan application recovery report

**Current status: Database and Storage recovery completed; draft-field restoration remains unverified.** This outcome supersedes the pre-import hold and approval gate recorded below. The import proceeded only after the user's explicit authorization.

## Completed recovery

- Imported the 488 verified account-owned `loan_applications` rows and 12 account-owned `gtab_applications` rows from `oufwdhgzozngsdhqmdui` to `ehhysszoqeomgwhgihoo`. Original application IDs, saved column/JSON data, statuses, and timestamps were preserved; ownership was mapped to the verified target account. The source project was not modified.
- The target's read-only post-import query confirmed 465 loan drafts, 23 submitted loans, 12 GTAB drafts, and loan decision statuses of 487 pending plus one `documents_required`. RLS is enabled on `loan_applications`, `gtab_applications`, and `profiles`.
- The signed-in app was refreshed: Applications displayed 500 records (477 drafts and 23 submitted); the dashboard displayed 500 total applications and populated Recent Applications.
- Applied the additive compatibility migration [`20261121090000_restore_legacy_application_data_fields.sql`](../migrations/20261121090000_restore_legacy_application_data_fields.sql). The database transfer used one duplicate-gated transaction; ownership, IDs, lookup mappings, and payload hashes were checked before commit.
- Copied 13 private Storage files (11,766,651 bytes) to the target account's folder. Compared source and target contents: all 13 SHA-256 hashes, paths, and sizes matched. The source project's 14th Storage object was an empty-folder placeholder, not a content file.
- The temporary protected staging table remains in the target with 503 staged rows (488 loans, 12 GTAB applications, one profile, and two loan-type rows). It is separate from the application tables and is not included in the 500 application count. It was not dropped because that would delete data; any cleanup requires a separate explicit decision. Private session-local exports and the extracted file copy were removed after checksum validation. No source records were deleted or changed, and RLS was not disabled.

## Remaining limitation

Opening a draft launched the wizard, but the observed draft showed only 1 of 17 native fields populated. This check does not establish whether the remaining fields were blank in that particular source record or are not being mapped into the editor. Do not treat draft-field repopulation or editing as fully verified, and do not infer that the saved data was lost: the imported data was preserved and validated at the database level. No frontend code was changed as part of this recovery.

## Historical preparation plan

The sections below document the pre-import verification and staging plan. Their statements that no import had occurred describe the earlier preparation phase, not the current state.

**Historical status before explicit approval: HOLD — inventory and staging only.**

This plan does not change `.env`, Supabase project links, source data, target data, or RLS. It must not be used to import into either live project.

## What is known, and what is not

- Source project: `oufwdhgzozngsdhqmdui` (`gtab-loan-aggregate-application`).
- Current project: `ehhysszoqeomgwhgihoo`.
- The latest prior read-only checks found 498 source `loan_applications` rows, of which 488 matched the displayed profile (465 `draft`, 23 `submitted`), and 13 source `gtab_applications` rows, of which 12 matched that profile. The target application tables were previously found empty.
- These are **500 candidate table rows, not a certified number of distinct eligible applications**. The account email/auth identity has not been reverified, and overlap between the two source tables has not been checked. The remaining GTAB row is excluded from the candidate set.
- Both project dashboards are accessible in the current Supabase Dashboard session. A read-only identity preflight using that Dashboard account returned zero matching `auth.users` and zero linked profiles/owned application rows in the source project. This proves that the Dashboard account is not a verified source applicant identity; it does not prove that the source has no applications. The shared EazyBizy page still displays its public “Join EazyBizy” screen, so the original applicant account has not been authenticated in the app. Do not substitute the Dashboard account, organization name, or a displayed profile for the applicant identity.
- A fresh target preflight found 0 rows in both target application tables, 6 target loan-type rows, and 3 target profiles. No target data was changed. The older candidate counts below remain prior findings, not a fresh identity-scoped inventory.
- No source export, complete source schema comparison, document/file inventory, staging import, or production import has been performed in this attempt. The only fresh source query was read-only and returned no rows for the Dashboard identity; the query was not saved.
- The older project's Backups page previously showed that its Free plan does not include scheduled backups; Point-in-Time Recovery is a paid add-on. The live older database, not a backup, is the candidate source.
- A prior read-only probe returned `42P01` for `public.user_loan_documents` in the older project. This does not establish that no files exist: Storage objects and JSON document references still need inventory.

## Schema and compatibility assessment

The local migration history and generated types describe the intended/current application schema, but they are not a substitute for querying both live databases. The older project's visible migration history ended at `20260425043000`; this checkout contains later migrations through `20260909190000`.

Known dependencies and risks:

1. `loan_applications.user_id` references `auth.users(id)`. Auth UUIDs are project-specific, so source ownership must be mapped to the matching target auth user by exact email verified in both projects. `profiles.user_id` is the auth ID; `profiles.id` is a different UUID and must not be used as the owner mapping.
2. `gtab_applications.user_id` has no FK in the checked-in base migration. Validate its value against the source auth user before including a row, then map it explicitly to the target auth ID.
3. `loan_applications.loan_type_id` references `loan_types.id`. The seed migrations can generate different UUIDs in separate projects. Map only to one unique target loan type with the same verified stable meaning; do not copy/insert a substitute loan type automatically.
4. The legacy `gtab_applications.status` is an enum, while `loan_applications.status` is text and `decision_status` is a separate enum. Preserve each field as stored; compare target enum labels before import. Never infer `decision_status` from `status`.
5. `loan_applications` gained GTAB fields and JSONB report/DPR fields over several migrations; later migrations add CMA, salary, narrative, scheme, and other columns. The source may lack columns added after its last applied migration. A source-only field containing data must block import until an explicit, lossless target mapping is approved.
6. There is a discrepancy between checked-in generated types and the migration history around `project_report_inputs` on `gtab_applications`. Inspect the live columns; do not assume the generated type proves the source column exists.
7. `user_loan_documents` is absent from the source according to the prior probe, despite a checked-in migration that creates it. Check `project_report_inputs.uploaded_documents`, `profile-documents`, and `loan-documents` separately. Storage object paths may begin with the old auth UUID; changing the owner UUID requires remapping paths and references while keeping buckets private and RLS enabled.
8. The `gtab_applications` and `loan_applications` tables may contain the same logical application or the same UUID. Count ID overlap and inspect only metadata before deciding whether rows are duplicates or separate records.

### Planned field mapping

| Source field/data | Target handling |
|---|---|
| `id` in either application table | Preserve the exact UUID. Reject the staged import if that ID already exists in the same target table. Do not merge tables or deduplicate by guesswork. |
| `user_id` | Replace with the verified target `auth.users.id`; keep a private source-to-target mapping. Use the same rule for GTAB despite its missing FK. |
| `loan_type_id` | Map to a unique target `loan_types.id` by a verified stable loan-type key/name. If missing or ambiguous, stop; do not create a dummy lookup row. |
| `status`, `decision_status`, `submitted_at`, `reviewed_at` | Copy values and nulls exactly after confirming target enum labels/types. No status inference or normalization. |
| `created_at`, `updated_at` | Preserve source values explicitly; do not let target defaults or update triggers replace them during import. |
| Same-named scalar, enum, and JSONB application fields | Copy explicitly when the target type supports the exact source value. For source-only/non-empty fields, block until a lossless target mapping is approved. |
| `reviewed_by`, `verified_by` | These are actor identifiers, not guaranteed FKs. Map only after verifying the corresponding actor in the target; otherwise block the affected record or retain a separately documented historical source ID only with explicit approval. |
| `user_loan_documents` rows | No source table was found in the prior probe. Transfer only if a fresh source inventory confirms the table and links each row to an eligible application. |
| JSON document references and Storage objects | Copy files privately, verify checksums, map old user-folder prefixes to the target auth UUID, and rewrite only the target copy's references to the new bucket/object location. Preserve the source object and manifest. |

## Read-only inventory

Use [`inventory_read_only.sql`](./inventory_read_only.sql) separately in the SQL Editor for each project. First establish the exact account email in the UI, then replace only the marked placeholders in a private query copy. Supabase may autosave query text; do not save or share a query containing the actual email. The script returns IDs, ownership UUIDs, status/timestamps, schema metadata, and payload/document-presence counts only; it does not select form values, amounts, names, email addresses, file paths, or file URLs.

Do not treat the current candidate count as final until:

- each project's email lookup returns exactly one `auth.users` row and the expected linked profile;
- source row ownership matches that source auth UUID;
- cross-table ID overlap is understood;
- target IDs are checked for conflicts;
- source and target column, FK, and enum inventories are compared;
- saved-payload presence and document-reference/object counts are recorded.

## Staging procedure

1. **Freeze the source.** Keep the older project online and unchanged. Capture a restricted, encrypted source export and target schema/data snapshot before any test. Do not include other users' rows.
2. **Confirm identity.** Match the exact email in `auth.users` in both projects. Confirm the source `profiles.user_id` equals the source auth ID. Record the source-to-target auth UUID mapping in a secure staging-only manifest, not in Git or logs.
3. **Build the manifest.** Include original table, application ID, source owner UUID, source status fields, `created_at`, `updated_at`, any submitted/review timestamps, foreign-key UUIDs, and booleans/counts for JSON payload/document references. Do not put payload values in logs.
4. **Compare schemas.** Compare live columns/types/nullability/defaults, enum labels, RLS policies, FKs, and required lookup rows. Explicitly decide each non-empty source-only column and each enum/FK mismatch. Stop on any unhandled field.
5. **Stage records and files.** Load the scoped source export into an isolated staging project with the target schema. Preserve primary IDs and timestamps. For loan types, map by a unique verified business key. For Storage, copy private objects and verify content checksums before staging the rewritten target references. Do not delete source objects.
6. **Test in one database transaction.** Use explicit column lists; never use `SELECT *`, `ON CONFLICT DO NOTHING`, or blind upserts. Before inserting, fail if any candidate application ID already exists or any required mapping is missing/non-unique. Insert parent dependencies before applications and document metadata after applications. Keep the existing RLS policies enabled.
7. **Validate in staging.** Require exact per-table expected counts; no duplicate IDs; equal ID/status/timestamp sets; equal JSON payload hashes; valid ownership and `loan_type_id` references; no lost source columns; matching document/object counts and checksums; and successful authenticated, user-scoped reads after refresh.
8. **Rollback staging tests.** Run the test import in `BEGIN`/`ROLLBACK` first and prove the staging tables return to their prior counts. Storage operations are not part of a PostgreSQL transaction: keep copied files under a staging-only prefix until the DB test passes, and do not automatically delete objects on rollback.
9. **Production remains gated.** After staging passes, produce a reviewed execution script and before/after manifest. No production transaction, Storage upload, config change, migration, or import occurs without your separate explicit approval.

### Transaction and rollback rules for a future approved import

- Capture and verify a restorable target snapshot first.
- Run all database inserts in one explicit transaction with a duplicate gate that raises an error; do not silently skip conflicts.
- Validate all counts, ownerships, FKs, statuses, timestamps, and payload hashes before `COMMIT`.
- Issue `ROLLBACK` if any pre-commit check fails. Do not attempt a compensating delete after commit; preserve the source and use the verified target snapshot or a separately approved forward correction.
- Because Storage is non-transactional, stage and checksum files separately, keep a manifest of old/new object keys, and attach references only after file validation.

## Historical approval boundary (superseded)

This plan and inventory file are the only deliverables prepared now. No live row, file, schema, policy, environment setting, or project link has been changed. A complete row-level eligibility count and a production-ready transfer script remain blocked on authenticated access to both projects and the read-only gates above.
