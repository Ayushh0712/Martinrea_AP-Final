-- =============================================================================
-- Martinrea AP Phase 1 - Match Records (PRD UI-B / WF-02 3-way match)
-- Flyway migration V3.
--
-- Backs the server-side match gate: InvoicesService.submitMatch() persists the
-- 2-way (Invoice <-> PO) verdict here and refuses to route an invoice for
-- approval while any blocking discrepancy is open. Mirrors the Sequelize
-- entities in backend/workflow/src/match-records/entities/*. Enum-like columns
-- use varchar to match the V1 convention (status/role) so the ORM maps cleanly
-- with synchronize disabled in non-dev environments.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Match Records - one per invoice (result of a 2-way / 3-way match)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE CASCADE,
  po_id             uuid REFERENCES purchase_orders(id),
  grn_id            uuid,
  matched_by_user   uuid,
  match_type        varchar(20) NOT NULL,
  match_status      varchar(20) NOT NULL DEFAULT 'PENDING',
  amount_match      boolean,
  quantity_match    boolean,
  vendor_match      boolean,
  po_number_match   boolean,
  invoice_amount    numeric(16,2),
  po_amount         numeric(16,2),
  grn_amount        numeric(16,2),
  tolerance_pct     numeric(6,2),
  discrepancy_count integer NOT NULL DEFAULT 0,
  matched_by        varchar(20),
  matched_at        timestamptz,
  exception_reason  varchar(1000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_match_records_invoice_id   ON match_records(invoice_id);
CREATE INDEX IF NOT EXISTS idx_match_records_match_status ON match_records(match_status);

-- ----------------------------------------------------------------------------
-- Match Discrepancies - field-level findings within a match record
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_discrepancies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_record_id   uuid NOT NULL REFERENCES match_records(id) ON DELETE CASCADE,
  field_name        varchar(100) NOT NULL,
  invoice_value     varchar(255),
  po_value          varchar(255),
  grn_value         varchar(255),
  difference_amount numeric(16,2),
  difference_pct    numeric(10,2),
  severity          varchar(20) NOT NULL DEFAULT 'MEDIUM',
  discrepancy_type  varchar(30) NOT NULL DEFAULT 'OTHER',
  resolved          boolean NOT NULL DEFAULT false,
  resolved_at       timestamptz,
  resolved_by       uuid,
  resolution_note   varchar(1000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_match_discrepancies_record_id ON match_discrepancies(match_record_id);
