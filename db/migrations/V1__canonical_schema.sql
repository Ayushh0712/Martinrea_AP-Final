-- =============================================================================
-- Martinrea AP Phase 1 - Canonical PostgreSQL schema (PRD DAT-01)
-- Flyway migration V1. Single source of truth for all services.
--
-- Every table carries: id (uuid), created_at, updated_at, and (where soft
-- delete applies) deleted_at. Owned by the Data & Repository track; the
-- per-service ORMs (Sequelize / Prisma / TypeORM) map onto these tables and
-- must run with synchronize disabled in non-dev environments.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- Roles (PRD WF-01 / WF-03)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        varchar(50) NOT NULL UNIQUE,
  description varchar(255),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO roles (name, description) VALUES
  ('AP_Clerk',         'Creates and edits invoices; cannot approve'),
  ('Plant_Manager',    'First approver for invoices over $10,000'),
  ('Finance_Director', 'Sole approver up to $10,000; second approver above'),
  ('VP_Finance',       'Final approver in the over-$50,000 chain')
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Users (PRD WF-01)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         varchar(255) NOT NULL UNIQUE,
  full_name     varchar(120) NOT NULL,
  password_hash varchar(255) NOT NULL,
  role          varchar(50)  NOT NULL,
  plant_id      varchar(50),
  manager_id    uuid REFERENCES users(id),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ----------------------------------------------------------------------------
-- Suppliers (PRD INT-01)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_code varchar(50) NOT NULL,
  vendor_code   varchar(50),
  name          varchar(255) NOT NULL,
  country       varchar(50),
  currency      varchar(3) NOT NULL DEFAULT 'USD',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT uq_suppliers_code UNIQUE (supplier_code)
);

-- ----------------------------------------------------------------------------
-- Purchase Orders (PRD INT-02)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number              varchar(60) NOT NULL UNIQUE,
  supplier_code          varchar(50) NOT NULL,
  vendor_code            varchar(50),
  supplier_name          varchar(255) NOT NULL,
  plant_id               varchar(50),
  currency               varchar(3) NOT NULL DEFAULT 'USD',
  total_amount           numeric(14,2) NOT NULL DEFAULT 0,
  status                 varchar(24) NOT NULL DEFAULT 'OPEN',
  issued_date            date,
  expected_delivery_date date,
  notes                  varchar(500),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);
CREATE INDEX IF NOT EXISTS idx_po_supplier_code ON purchase_orders(supplier_code);

-- ----------------------------------------------------------------------------
-- Goods Receipts (PRD INT-03)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goods_receipts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number     varchar(60) NOT NULL,
  instance_id   integer,
  line_no       integer,
  description   varchar(500),
  received_qty  numeric(14,4),
  unit_price    numeric(14,4),
  line_total    numeric(14,2),
  received_date date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_gr_po_number ON goods_receipts(po_number);

-- ----------------------------------------------------------------------------
-- Invoices (PRD DAT-01 / OCR / WF-02 / WF-03)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number         varchar(100),
  supplier_name          varchar(255),
  supplier_id            varchar(50),
  po_number              varchar(60),
  subtotal               numeric(14,2),
  tax_amount             numeric(14,2),
  total_amount           numeric(14,2),
  currency               varchar(3) NOT NULL DEFAULT 'USD',
  status                 varchar(30) NOT NULL DEFAULT 'RECEIVED',
  -- OCR metadata
  confidence_score       numeric(5,2) DEFAULT 0,
  requires_review        boolean NOT NULL DEFAULT false,
  review_reason          text,
  document_type          varchar(30) DEFAULT 'INVOICE',
  language               varchar(20),
  cfdi_detected          boolean NOT NULL DEFAULT false,
  cfdi_valid             boolean,
  -- ingestion / workflow metadata
  ingestion_channel      varchar(50),
  plant_id               varchar(50),
  current_approver_id    uuid REFERENCES users(id),
  approval_chain         jsonb,
  approvals_completed    jsonb,
  rejection_reason       varchar(500),
  pending_approval_since timestamptz,
  last_escalated_at      timestamptz,
  -- document metadata
  file_path              varchar(1024),
  original_filename      varchar(512),
  mime_type              varchar(120),
  file_size              integer,
  raw_ocr_text           text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);
-- DAT-01 required indexes.
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier_id    ON invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_invoices_po_number       ON invoices(po_number);
CREATE INDEX IF NOT EXISTS idx_invoices_status          ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at      ON invoices(created_at);

-- ----------------------------------------------------------------------------
-- Invoice Lines (PRD OCR-03)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description varchar(500),
  quantity    numeric(14,4),
  unit_price  numeric(14,4),
  line_total  numeric(14,2),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines(invoice_id);

-- ----------------------------------------------------------------------------
-- Approval Rules / Rules_Engine (PRD WF-03)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name   varchar(100) NOT NULL UNIQUE,
  min_amount  numeric(14,2),
  max_amount  numeric(14,2),
  role_chain  jsonb NOT NULL,
  priority    integer NOT NULL DEFAULT 100,
  is_active   boolean NOT NULL DEFAULT true,
  description varchar(500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Audit Logs (PRD DAT-04) - append-only (see V2 trigger).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type  varchar(60) NOT NULL,
  invoice_id   uuid,
  performed_by uuid,
  old_value    jsonb,
  new_value    jsonb,
  notes        varchar(500),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_invoice_id  ON audit_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at  ON audit_logs(created_at);
