-- ============================================================================
-- Accounting Database — Budgets (migration 004)
-- PostgreSQL 17
-- REQUIRES: 001_core_schema.sql (set_updated_at(), accounts)
-- ============================================================================

CREATE TABLE budgets (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id   BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end   DATE NOT NULL,
    amount       NUMERIC(20,2) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT budgets_range_ck CHECK (period_end >= period_start)
);

CREATE UNIQUE INDEX idx_budgets_unique ON budgets (account_id, period_start, period_end);
CREATE INDEX idx_budgets_account ON budgets (account_id);

CREATE TRIGGER trg_budgets_updated_at BEFORE UPDATE ON budgets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
