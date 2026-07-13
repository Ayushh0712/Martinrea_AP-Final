-- =============================================================================
-- Martinrea AP Phase 1 - Drop CFDI columns from invoices
-- Flyway migration V4.
--
-- Mexico CFDI validation (PRD INT-04) has been removed from the platform:
-- the SAT/CFDI validation service, the OCR CFDI detector, the PENDING_MATCH ->
-- MATCHED compliance guard, and all related UI have been deleted. This drops
-- the now-unused CFDI columns introduced in V1 so the schema matches the
-- Sequelize entities (which no longer declare them).
--
-- Uses DROP COLUMN IF EXISTS so it is a no-op on databases where a given
-- column was never created (cfdi_uuid / cfdi_sat_status / cfdi_violation_reason
-- only ever existed in dev via Sequelize `synchronize`, not in the canonical
-- V1 schema).
-- =============================================================================

ALTER TABLE invoices DROP COLUMN IF EXISTS cfdi_valid;
ALTER TABLE invoices DROP COLUMN IF EXISTS cfdi_detected;
ALTER TABLE invoices DROP COLUMN IF EXISTS cfdi_uuid;
ALTER TABLE invoices DROP COLUMN IF EXISTS cfdi_sat_status;
ALTER TABLE invoices DROP COLUMN IF EXISTS cfdi_violation_reason;
