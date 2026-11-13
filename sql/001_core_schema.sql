-- ============================================================================
-- Accounting Database — Core Schema (migration 001)
-- PostgreSQL 17
-- Double-entry bookkeeping foundation
-- ----------------------------------------------------------------------------
-- How to apply:
--   psql -h 127.0.0.1 -p 5433 -U accounting_app -d accounting -f 001_core_schema.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Chart of Accounts
--    Every ledger account lives here. An account is either debit-normal
--    (assets, expenses) or credit-normal (liabilities, equity, revenue).
-- ----------------------------------------------------------------------------
CREATE TABLE accounts (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL
                   CHECK (type IN ('asset','liability','equity','revenue','expense')),
    normal_balance TEXT NOT NULL
                   CHECK (normal_balance IN ('debit','credit')),
    parent_id      BIGINT REFERENCES accounts(id) ON DELETE RESTRICT,
    description    TEXT,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- integrity: debit-normal = asset/expense; credit-normal = liability/equity/revenue
    CONSTRAINT accounts_normal_balance_ck CHECK (
        (type IN ('asset','expense') AND normal_balance = 'debit') OR
        (type IN ('liability','equity','revenue') AND normal_balance = 'credit')
    )
);

-- ----------------------------------------------------------------------------
-- 2. Journal Entries
--    One financial transaction. Starts as 'draft', becomes 'posted' once it
--    balances. Posted entries are immutable (except description metadata).
-- ----------------------------------------------------------------------------
CREATE TABLE journal_entries (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entry_date  DATE NOT NULL,
    reference   TEXT,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','posted')),
    posted_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. Journal Entry Lines
--    The debit/credit legs of an entry. Debits must equal credits when posted.
-- ----------------------------------------------------------------------------
CREATE TABLE journal_entry_lines (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    journal_entry_id BIGINT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id       BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    line_type        TEXT NOT NULL CHECK (line_type IN ('debit','credit')),
    amount           NUMERIC(20,2) NOT NULL CHECK (amount >= 0),
    description      TEXT,
    line_no          INTEGER NOT NULL CHECK (line_no > 0),
    UNIQUE (journal_entry_id, line_no)
);

-- ----------------------------------------------------------------------------
-- 4. Parties (customers & vendors)
-- ----------------------------------------------------------------------------
CREATE TABLE parties (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'customer'
               CHECK (type IN ('customer','vendor','both')),
    email      TEXT,
    phone      TEXT,
    address    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX idx_accounts_type     ON accounts(type);
CREATE INDEX idx_accounts_parent   ON accounts(parent_id);
CREATE INDEX idx_entries_date      ON journal_entries(entry_date);
CREATE INDEX idx_entries_status    ON journal_entries(status);
CREATE INDEX idx_lines_entry       ON journal_entry_lines(journal_entry_id);
CREATE INDEX idx_lines_account     ON journal_entry_lines(account_id);
CREATE INDEX idx_parties_type      ON parties(type);

-- ============================================================================
-- Functions & triggers
-- ============================================================================

-- Keep updated_at fresh on any UPDATE ----------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_entries_updated_at BEFORE UPDATE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_parties_updated_at BEFORE UPDATE ON parties
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Prevent changing the lines of an already-posted entry ----------------------
CREATE OR REPLACE FUNCTION prevent_posted_line_changes()
RETURNS TRIGGER AS $$
DECLARE
    entry_id BIGINT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        entry_id := OLD.journal_entry_id;
    ELSE
        entry_id := NEW.journal_entry_id;
    END IF;

    IF EXISTS (SELECT 1 FROM journal_entries WHERE id = entry_id AND status = 'posted') THEN
        RAISE EXCEPTION 'Cannot modify lines of a posted journal entry (%)', entry_id;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_posted_line_changes
BEFORE INSERT OR UPDATE OR DELETE ON journal_entry_lines
FOR EACH ROW EXECUTE FUNCTION prevent_posted_line_changes();

-- Enforce debits = credits when an entry is posted ---------------------------
CREATE OR REPLACE FUNCTION enforce_balanced_entry()
RETURNS TRIGGER AS $$
DECLARE
    total_debit  NUMERIC;
    total_credit NUMERIC;
BEGIN
    -- a posted entry cannot be un-posted
    IF OLD.status = 'posted' AND NEW.status <> 'posted' THEN
        RAISE EXCEPTION 'Cannot unpost journal entry %', NEW.id;
    END IF;

    -- when moving to 'posted', the entry must balance
    IF NEW.status = 'posted' AND OLD.status <> 'posted' THEN
        SELECT
            COALESCE(SUM(amount) FILTER (WHERE line_type = 'debit'),  0),
            COALESCE(SUM(amount) FILTER (WHERE line_type = 'credit'), 0)
        INTO total_debit, total_credit
        FROM journal_entry_lines
        WHERE journal_entry_id = NEW.id;

        IF total_debit = 0 AND total_credit = 0 THEN
            RAISE EXCEPTION 'Journal entry % has no lines', NEW.id;
        END IF;

        IF total_debit <> total_credit THEN
            RAISE EXCEPTION 'Journal entry % is not balanced: debits % <> credits %',
                NEW.id, total_debit, total_credit;
        END IF;

        NEW.posted_at := now();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_balanced_entry
BEFORE UPDATE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION enforce_balanced_entry();

-- ============================================================================
-- Seed data: a starter chart of accounts
-- ============================================================================
INSERT INTO accounts (code, name, type, normal_balance) VALUES
    ('1000', 'Cash',                'asset',    'debit'),
    ('1100', 'Accounts Receivable', 'asset',    'debit'),
    ('1200', 'Inventory',           'asset',    'debit'),
    ('2000', 'Accounts Payable',    'liability','credit'),
    ('3000', 'Owner''s Equity',     'equity',   'credit'),
    ('4000', 'Sales Revenue',       'revenue',  'credit'),
    ('5000', 'Cost of Goods Sold',  'expense',  'debit'),
    ('6000', 'Rent Expense',        'expense',  'debit'),
    ('6100', 'Salaries Expense',    'expense',  'debit'),
    ('6200', 'Utilities Expense',   'expense',  'debit');
