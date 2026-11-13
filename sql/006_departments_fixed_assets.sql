-- ============================================================================
-- Accounting Database — Depth: Departments & Fixed Assets (migration 006)
-- PostgreSQL 17
-- REQUIRES: 001_core_schema.sql (set_updated_at, accounts)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Departments (cost centers) — for segmented / departmental reporting
-- ----------------------------------------------------------------------------
CREATE TABLE departments (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE journal_entry_lines ADD COLUMN department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL;

CREATE INDEX idx_lines_department ON journal_entry_lines(department_id);
CREATE INDEX idx_invoices_department ON invoices(department_id);

-- ----------------------------------------------------------------------------
-- 2. Fixed assets — for a fixed-asset register and straight-line depreciation
-- ----------------------------------------------------------------------------
CREATE TABLE fixed_assets (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name              TEXT NOT NULL,
    account_id        BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    purchase_date     DATE NOT NULL,
    cost              NUMERIC(20,2) NOT NULL CHECK (cost >= 0),
    salvage_value     NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
    useful_life_years INTEGER NOT NULL CHECK (useful_life_years > 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fixed_assets_account ON fixed_assets(account_id);

CREATE TRIGGER trg_fixed_assets_updated_at BEFORE UPDATE ON fixed_assets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
