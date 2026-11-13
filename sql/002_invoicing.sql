-- ============================================================================
-- Accounting Database — Invoicing, Payments & Taxes (migration 002)
-- PostgreSQL 17
-- REQUIRES: 001_core_schema.sql (depends on set_updated_at(), parties, etc.)
-- ----------------------------------------------------------------------------
-- How to apply:
--   psql -h 127.0.0.1 -p 5433 -U accounting_app -d accounting -f 002_invoicing.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tax rates (VAT, withholding, etc.)
-- ----------------------------------------------------------------------------
CREATE TABLE tax_rates (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    rate       NUMERIC(6,3) NOT NULL CHECK (rate >= 0),  -- percent, e.g. 16.000
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. Invoices (sales or purchases)
--    When an invoice is issued, the application creates a journal entry
--    (for a sale: debit AR, credit Revenue + Tax Payable) and stores its id
--    in journal_entry_id.
-- ----------------------------------------------------------------------------
CREATE TABLE invoices (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_number   TEXT NOT NULL UNIQUE,
    party_id         BIGINT NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    invoice_type     TEXT NOT NULL CHECK (invoice_type IN ('sale','purchase')),
    issue_date       DATE NOT NULL,
    due_date         DATE NOT NULL,
    status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','issued','paid','void')),
    subtotal         NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    tax_amount       NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total            NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    notes            TEXT,
    journal_entry_id BIGINT REFERENCES journal_entries(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invoices_total_ck CHECK (total = subtotal + tax_amount)
);

-- ----------------------------------------------------------------------------
-- 3. Invoice line items
-- ----------------------------------------------------------------------------
CREATE TABLE invoice_lines (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id  BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    quantity    NUMERIC(15,3) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    unit_price  NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
    amount      NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
    tax_rate_id BIGINT REFERENCES tax_rates(id) ON DELETE RESTRICT,
    line_no     INTEGER NOT NULL CHECK (line_no > 0),
    UNIQUE (invoice_id, line_no)
);

-- ----------------------------------------------------------------------------
-- 4. Payments (money in or out)
-- ----------------------------------------------------------------------------
CREATE TABLE payments (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_date     DATE NOT NULL,
    party_id         BIGINT NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    direction        TEXT NOT NULL DEFAULT 'incoming'
                     CHECK (direction IN ('incoming','outgoing')),
    amount           NUMERIC(20,2) NOT NULL CHECK (amount > 0),
    method           TEXT NOT NULL DEFAULT 'bank'
                     CHECK (method IN ('cash','bank','mobile_money','other')),
    reference        TEXT,
    journal_entry_id BIGINT REFERENCES journal_entries(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 5. Payment allocation — which invoices a payment settles (supports partial
--    payments and one payment covering multiple invoices)
-- ----------------------------------------------------------------------------
CREATE TABLE invoice_payments (
    invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    amount     NUMERIC(20,2) NOT NULL CHECK (amount > 0),
    PRIMARY KEY (invoice_id, payment_id)
);

-- ----------------------------------------------------------------------------
-- 6. Extend journal entry lines with an optional party, for AR/AP tracking
--    (e.g. "what does customer X owe?")
-- ----------------------------------------------------------------------------
ALTER TABLE journal_entry_lines
    ADD COLUMN party_id BIGINT REFERENCES parties(id) ON DELETE RESTRICT;

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX idx_invoices_party   ON invoices(party_id);
CREATE INDEX idx_invoices_status  ON invoices(status);
CREATE INDEX idx_invoices_date    ON invoices(issue_date);
CREATE INDEX idx_invlines_invoice ON invoice_lines(invoice_id);
CREATE INDEX idx_invlines_account ON invoice_lines(account_id);
CREATE INDEX idx_payments_party   ON payments(party_id);
CREATE INDEX idx_payments_date    ON payments(payment_date);
CREATE INDEX idx_invpay_payment   ON invoice_payments(payment_id);
CREATE INDEX idx_lines_party      ON journal_entry_lines(party_id);

-- ============================================================================
-- updated_at triggers for the new tables (function defined in migration 001)
-- ============================================================================
CREATE TRIGGER trg_tax_rates_updated_at BEFORE UPDATE ON tax_rates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- Seed: additional accounts + a default VAT rate (Kenya)
-- ============================================================================
INSERT INTO accounts (code, name, type, normal_balance) VALUES
    ('1005', 'Bank',         'asset',    'debit'),
    ('1010', 'Mobile Money', 'asset',    'debit'),
    ('2100', 'VAT Payable',  'liability','credit');

INSERT INTO tax_rates (name, rate) VALUES
    ('VAT 16%', 16.000);
