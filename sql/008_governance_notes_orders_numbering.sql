-- ============================================================================
-- Accounting Database — Governance, Notes, Orders, Numbering (migration 008)
-- PostgreSQL 17
-- REQUIRES: 001_core_schema.sql, 002_invoicing.sql, 005_users.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. User roles (admin / accountant / viewer)
-- ----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'accountant'
    CHECK (role IN ('admin','accountant','viewer'));

-- Existing admin gets the admin role
UPDATE users SET role = 'admin' WHERE username = 'admin';

-- ----------------------------------------------------------------------------
-- 2. Audit trail
-- ----------------------------------------------------------------------------
CREATE TABLE audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    username    TEXT,
    action      TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   BIGINT,
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. Document numbering sequences
-- ----------------------------------------------------------------------------
CREATE TABLE numbering_sequences (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    prefix     TEXT NOT NULL,
    next_value BIGINT NOT NULL DEFAULT 1,
    pad_length INTEGER NOT NULL DEFAULT 4
);

INSERT INTO numbering_sequences (name, prefix, next_value, pad_length) VALUES
    ('invoice', 'INV-', 0, 4),
    ('purchase_order', 'PO-', 0, 4),
    ('sales_order', 'SO-', 0, 4),
    ('credit_note', 'CN-', 0, 4);

-- ----------------------------------------------------------------------------
-- 4. Credit / debit notes (returns, allowances, additional charges)
-- ----------------------------------------------------------------------------
CREATE TABLE credit_notes (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    note_number      TEXT NOT NULL UNIQUE,
    party_id         BIGINT NOT NULL REFERENCES parties(id),
    note_type        TEXT NOT NULL CHECK (note_type IN ('credit','debit')),
    issue_date       DATE NOT NULL,
    reason           TEXT,
    invoice_id       BIGINT REFERENCES invoices(id) ON DELETE SET NULL,
    subtotal         NUMERIC(20,2) NOT NULL CHECK (subtotal >= 0),
    tax_rate_id      BIGINT REFERENCES tax_rates(id),
    tax_amount       NUMERIC(20,2) NOT NULL DEFAULT 0,
    total            NUMERIC(20,2) NOT NULL CHECK (total >= 0),
    journal_entry_id BIGINT REFERENCES journal_entries(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_notes_party ON credit_notes(party_id);

-- ----------------------------------------------------------------------------
-- 5. Purchase / sales orders
-- ----------------------------------------------------------------------------
CREATE TABLE orders (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_number  TEXT NOT NULL UNIQUE,
    order_type    TEXT NOT NULL CHECK (order_type IN ('purchase','sale')),
    party_id      BIGINT NOT NULL REFERENCES parties(id),
    order_date    DATE NOT NULL,
    expected_date DATE,
    status        TEXT NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('draft','confirmed','billed','cancelled')),
    subtotal      NUMERIC(20,2) NOT NULL DEFAULT 0,
    tax_rate_id   BIGINT REFERENCES tax_rates(id),
    tax_amount    NUMERIC(20,2) NOT NULL DEFAULT 0,
    total         NUMERIC(20,2) NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_lines (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id     BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    description  TEXT NOT NULL,
    account_code TEXT NOT NULL REFERENCES accounts(code),
    quantity     NUMERIC(20,2) NOT NULL DEFAULT 1,
    unit_price   NUMERIC(20,2) NOT NULL DEFAULT 0,
    amount       NUMERIC(20,2) NOT NULL,
    line_no      INTEGER NOT NULL
);

CREATE INDEX idx_order_lines_order ON order_lines(order_id);
CREATE INDEX idx_orders_party ON orders(party_id);
