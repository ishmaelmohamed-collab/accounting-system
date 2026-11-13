-- ============================================================================
-- Accounting Database — Attachments & Prepayments (migration 010)
-- PostgreSQL 17
-- REQUIRES: 001_core_schema.sql, 005_users.sql
-- ============================================================================

-- Prepaid expenses account (asset) for prepayment amortization
INSERT INTO accounts (code, name, type, normal_balance)
VALUES ('1400', 'Prepaid Expenses', 'asset', 'debit')
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Attachments (documents linked to any entity)
-- ----------------------------------------------------------------------------
CREATE TABLE attachments (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type  TEXT NOT NULL,
    entity_id    BIGINT,
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL,
    content      BYTEA NOT NULL,
    uploaded_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- Prepayments (spread an upfront payment over N months)
-- ----------------------------------------------------------------------------
CREATE TABLE prepayments (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    description      TEXT NOT NULL,
    account_code     TEXT NOT NULL REFERENCES accounts(code),  -- expense account to recognize
    total_amount     NUMERIC(20,2) NOT NULL CHECK (total_amount > 0),
    months           INTEGER NOT NULL CHECK (months > 0),
    start_date       DATE NOT NULL,
    amortized_months INTEGER NOT NULL DEFAULT 0 CHECK (amortized_months >= 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prepayments_start ON prepayments(start_date);
