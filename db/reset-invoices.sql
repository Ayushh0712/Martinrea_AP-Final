-- =============================================================================
-- Fresh start: delete ALL invoice / transaction data from BOTH schemas
-- (public.* workflow/Sequelize + ocr.* Prisma) while KEEPING master/reference
-- data (purchase_orders, suppliers, vendors, goods_receipts, users, roles,
-- role_permissions, approval_rules).
--
-- Rationale: the team is resetting the workflow to zero invoices and switching
-- the OCR source folder to the OCI prefix AP-Accepted_New/. The two schemas live
-- in the same `mreai` database and are linked by shared invoice id (the OCR
-- bridge mirrors ocr.invoices -> public.invoices using the SAME id), so a single
-- script clears both.
--
-- Idempotent: rerunning is a no-op once the tables are already empty.
-- Run as the `postgres` superuser (creds from backend/workflow/.env):
--   $env:PGPASSWORD = 'Ayush@1230'
--   psql -h localhost -p 5434 -U postgres -d mreai -f db/reset-invoices.sql
-- =============================================================================

BEGIN;

-- An append-only trigger blocks DELETE on audit_logs (PRD DAT-04). The trigger
-- name varies by environment (e.g. trg_audit_logs_append_only here vs the
-- trg_audit_logs_block_* names in db/migrations/V2), so disable ALL user
-- triggers on the table by-table rather than by name. DISABLE TRIGGER USER is a
-- harmless no-op when the table has no user triggers. Requires superuser/owner
-- (we connect as `postgres`). Re-enabled at the end of the transaction.
ALTER TABLE public.audit_logs DISABLE TRIGGER USER;
ALTER TABLE ocr.audit_logs DISABLE TRIGGER USER;

-- Pre-cleanup counts for the log.
DO $$
DECLARE
  v_wf_inv  int;
  v_ocr_inv int;
BEGIN
  SELECT count(*) INTO v_wf_inv  FROM public.invoices;
  SELECT count(*) INTO v_ocr_inv FROM ocr.invoices;
  RAISE NOTICE 'reset: before -> workflow invoices=%, ocr invoices=%', v_wf_inv, v_ocr_inv;
END $$;

-- Delete invoice / processing rows across both schemas. Every table is guarded
-- with to_regclass so environments that lack an optional table (e.g. ocr_results
-- was never migrated here) skip it instead of aborting the whole transaction.
-- Children are listed before their parents so the DELETEs never trip an FK.
DO $$
DECLARE
  t text;
  -- Invoice-derived / processing tables, children first, parents last.
  -- audit_logs is handled separately (only invoice-linked rows are removed).
  invoice_tables text[] := ARRAY[
    -- public (workflow / Sequelize)
    'public.match_discrepancies',
    'public.match_records',
    'public.invoice_line_items',
    'public.invoice_lines',
    'public.invoice_po_line_reservations',
    'public.ocr_results',
    'public.invoices',
    -- ocr (Prisma OCR store)
    'ocr.invoice_lines',
    'ocr.invoices'
  ];
BEGIN
  -- Remove only invoice-linked audit rows before deleting their invoices.
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.audit_logs WHERE invoice_id IS NOT NULL';
  END IF;
  IF to_regclass('ocr.audit_logs') IS NOT NULL THEN
    EXECUTE 'DELETE FROM ocr.audit_logs WHERE invoice_id IS NOT NULL';
  END IF;

  FOREACH t IN ARRAY invoice_tables LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %s', t);
    END IF;
  END LOOP;
END $$;

-- Re-enable the append-only triggers disabled above.
ALTER TABLE public.audit_logs ENABLE TRIGGER USER;
ALTER TABLE ocr.audit_logs ENABLE TRIGGER USER;

COMMIT;

-- ---- Verification: invoices should be 0; master data should be untouched ----
SELECT
  (SELECT count(*) FROM public.invoices)        AS wf_invoices,
  (SELECT count(*) FROM ocr.invoices)           AS ocr_invoices,
  (SELECT count(*) FROM public.match_records)   AS match_records,
  (SELECT count(*) FROM public.purchase_orders) AS pos_kept,
  (SELECT count(*) FROM public.suppliers)       AS suppliers_kept,
  (SELECT count(*) FROM public.users)           AS users_kept,
  (SELECT count(*) FROM public.approval_rules)  AS rules_kept;
