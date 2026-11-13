-- ============================================================================
-- Accounting Database — Depth: Inventory, Bank Reconciliation, Recurring
-- Entries, Year-End Close (migration 007)
-- PostgreSQL 17
-- REQUIRES: 001_core_schema.sql, 003_ledger_hardening.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Inventory (items + stock movements for moving-average costing)
-- ----------------------------------------------------------------------------
CREATE TABLE inventory_items (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku        TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    unit       TEXT NOT NULL DEFAULT 'each',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stock_movements (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id       BIGINT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    movement_date DATE NOT NULL,
    quantity      NUMERIC(20,2) NOT NULL,          -- positive = in, negative = out
    unit_cost     NUMERIC(20,2) NOT NULL CHECK (unit_cost >= 0),
    reference     TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_item ON stock_movements(item_id);

-- ----------------------------------------------------------------------------
-- 2. Bank statements (external lines for reconciliation)
-- ----------------------------------------------------------------------------
CREATE TABLE bank_transactions (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id       BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    transaction_date DATE NOT NULL,
    description      TEXT NOT NULL,
    amount           NUMERIC(20,2) NOT NULL,       -- positive = deposit, negative = withdrawal
    reference        TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bank_transactions_account ON bank_transactions(account_id);

-- ----------------------------------------------------------------------------
-- 3. Recurring entries (templates for month-end accruals and repeats)
-- ----------------------------------------------------------------------------
CREATE TABLE recurring_entries (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    description   TEXT NOT NULL,
    frequency     TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
    next_run_date DATE NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recurring_entry_lines (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recurring_entry_id BIGINT NOT NULL REFERENCES recurring_entries(id) ON DELETE CASCADE,
    account_code       TEXT NOT NULL REFERENCES accounts(code),
    line_type          TEXT NOT NULL CHECK (line_type IN ('debit','credit')),
    amount             NUMERIC(20,2) NOT NULL CHECK (amount >= 0),
    description        TEXT,
    line_no            INTEGER NOT NULL
);

CREATE INDEX idx_recurring_lines_entry ON recurring_entry_lines(recurring_entry_id);

-- ----------------------------------------------------------------------------
-- 4. Year-end closures (record the closing entry + lock the year)
-- ----------------------------------------------------------------------------
CREATE TABLE year_end_closures (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    year             INTEGER NOT NULL UNIQUE,
    net_income       NUMERIC(20,2) NOT NULL,
    journal_entry_id BIGINT NOT NULL REFERENCES journal_entries(id),
    closed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Retained earnings account (used by the year-end close)
INSERT INTO accounts (code, name, type, normal_balance)
VALUES ('3100', 'Retained Earnings', 'equity', 'credit')
ON CONFLICT (code) DO NOTHING;
