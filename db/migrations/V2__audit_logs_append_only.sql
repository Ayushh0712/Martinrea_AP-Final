-- =============================================================================
-- PRD DAT-04: Audit_Logs is append-only - no UPDATE or DELETE permitted.
-- Enforced at the database level via a trigger so the guarantee holds even if
-- an application bug (or a different service) attempts a mutation.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_logs_no_mutate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_block_update ON audit_logs;
CREATE TRIGGER trg_audit_logs_block_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_no_mutate();

DROP TRIGGER IF EXISTS trg_audit_logs_block_delete ON audit_logs;
CREATE TRIGGER trg_audit_logs_block_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_no_mutate();
