-- ============================================================================
-- Accounting Database — Ledger Hardening (migration 003)
-- PostgreSQL 17
-- Adds: idempotency keys, entry reversals, and fiscal-period locks
-- REQUIRES: 001_core_schema.sql, 002_invoicing.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Idempotency key — a client-supplied unique key to prevent duplicate
--    postings (retrying the same request must not double-post).
-- ----------------------------------------------------------------------------
ALTER TABLE journal_entries ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_entries_idempotency
    ON journal_entries (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Reversals — link a reversing entry to the entry it reverses.
-- ----------------------------------------------------------------------------
ALTER TABLE journal_entries ADD COLUMN reversal_of_id BIGINT
    REFERENCES journal_entries(id) ON DELETE SET NULL;

CREATE INDEX idx_entries_reversal ON journal_entries(reversal_of_id);

-- ----------------------------------------------------------------------------
-- 3. Fiscal periods — closed periods reject new postings.
-- ----------------------------------------------------------------------------
CREATE TABLE fiscal_periods (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date   DATE NOT NULL,
    is_closed  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fiscal_periods_range_ck CHECK (end_date >= start_date)
);

CREATE TRIGGER trg_fiscal_periods_updated_at BEFORE UPDATE ON fiscal_periods
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
