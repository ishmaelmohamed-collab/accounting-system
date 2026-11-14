-- ============================================================================
-- Accounting Database — Expense Management (migration 012)
-- PostgreSQL 17
-- REQUIRES: 001_core_schema.sql, 005_users.sql, 008 (numbering_sequences)
-- ============================================================================

-- Liability account for reimbursements due to employees
INSERT INTO accounts (code, name, type, normal_balance)
VALUES ('2200', 'Expenses Payable', 'liability', 'credit')
ON CONFLICT (code) DO NOTHING;

-- Expense claims (employee expense → approve → reimburse)
CREATE TABLE expense_claims (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    claim_number     TEXT NOT NULL UNIQUE,
    description      TEXT NOT NULL,
    account_code     TEXT NOT NULL REFERENCES accounts(code),   -- expense account to charge
    amount           NUMERIC(20,2) NOT NULL CHECK (amount > 0),
    expense_date     DATE NOT NULL,
    submitted_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    status           TEXT NOT NULL DEFAULT 'submitted'
                     CHECK (status IN ('submitted','approved','reimbursed','rejected')),
    journal_entry_id BIGINT REFERENCES journal_entries(id),
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_claims_status ON expense_claims(status);

INSERT INTO numbering_sequences (name, prefix, next_value, pad_length)
VALUES ('expense_claim', 'EXP-', 0, 4)
ON CONFLICT (name) DO NOTHING;
