-- =============================================================================
-- One-time cleanup: keep ONLY invoices that originated from the OCI bucket's
-- AP-Accepted/ prefix (the single source per the OCI auto-ingest poller).
--
-- Rationale: the workflow `public.invoices` table accumulated dummy rows from
-- past `npm run seed:invoices` (and related seeds). The OCI poller writes
-- straight into `ocr.invoices` (Prisma) and the bridge mirrors those rows into
-- `public.invoices` (Sequelize) using the SAME id. So the authoritative
-- "keeper" set is exactly the current contents of `ocr.invoices`. Anything in
-- `public.invoices` whose id is NOT in `ocr.invoices` is a seed/manual/stale
-- record and must go.
--
-- Idempotent: rerunning the script is a no-op once the dummies are gone.
-- Run as the `postgres` superuser:
--   $env:PGPASSWORD = '<pwd>'
--   psql -h localhost -p 5434 -U postgres -d mreai -f db/cleanup-dummy-invoices.sql
-- =============================================================================

BEGIN;

-- The dev DB does NOT have the V2 append-only trigger installed
-- (see db/migrations/V2__audit_logs_append_only.sql). DISABLE/ENABLE the
-- trigger conditionally so the script also works if a future apply installs
-- it. ALTER ... DISABLE TRIGGER is a no-op when the trigger is absent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.audit_logs'::regclass
       AND tgname LIKE 'trg_audit_logs_block_%'
  ) THEN
    EXECUTE 'ALTER TABLE public.audit_logs DISABLE TRIGGER USER';
  END IF;
END $$;

-- Authoritative "real" invoice set: ids currently in the OCR Prisma table,
-- which is the only landing zone for files pulled from AP-Accepted/.
CREATE TEMP TABLE keepers ON COMMIT DROP AS
  SELECT id::uuid AS id FROM ocr.invoices;

-- Optional sanity log: how many invoices we're keeping vs. about to drop.
DO $$
DECLARE
  v_total int;
  v_keep  int;
BEGIN
  SELECT count(*) INTO v_total FROM public.invoices;
  SELECT count(*) INTO v_keep  FROM public.invoices WHERE id IN (SELECT id FROM keepers);
  RAISE NOTICE 'cleanup: workflow invoices total=% keep=% drop=%', v_total, v_keep, v_total - v_keep;
END $$;

-- Order matters: drop children before parents, even though most parents are
-- not declared FK-cascading (the canonical schema lists very few FK targets).
DELETE FROM public.audit_logs
 WHERE invoice_id IS NOT NULL
   AND invoice_id NOT IN (SELECT id FROM keepers);

DELETE FROM public.match_discrepancies
 WHERE match_record_id IN (
   SELECT id FROM public.match_records
    WHERE invoice_id NOT IN (SELECT id FROM keepers)
 );

DELETE FROM public.match_records
 WHERE invoice_id NOT IN (SELECT id FROM keepers);

DELETE FROM public.invoice_line_items
 WHERE invoice_id NOT IN (SELECT id FROM keepers);

DELETE FROM public.ocr_results
 WHERE invoice_id NOT IN (SELECT id FROM keepers);

-- Hard-delete (bypasses Sequelize paranoid soft-delete).
DELETE FROM public.invoices
 WHERE id NOT IN (SELECT id FROM keepers);

-- Re-enable the append-only trigger if it was disabled above.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.audit_logs'::regclass
       AND tgname LIKE 'trg_audit_logs_block_%'
  ) THEN
    EXECUTE 'ALTER TABLE public.audit_logs ENABLE TRIGGER USER';
  END IF;
END $$;

COMMIT;

-- Post-condition: every remaining workflow invoice id must exist in ocr.invoices.
SELECT
  (SELECT count(*) FROM public.invoices)                                          AS wf_invoices_after,
  (SELECT count(*) FROM ocr.invoices)                                             AS ocr_invoices_after,
  (SELECT count(*) FROM public.invoices wi
     WHERE wi.id::text NOT IN (SELECT id::text FROM ocr.invoices))                AS orphans_after;
