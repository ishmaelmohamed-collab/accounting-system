-- ============================================================================
-- Accounting Database — CRM & Manufacturing (migration 011)
-- PostgreSQL 17
-- REQUIRES: 002_invoicing.sql (invoices, parties), 007_... (inventory_items)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- CRM: customer/vendor groups
-- ----------------------------------------------------------------------------
CREATE TABLE party_groups (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- CRM: payment terms (auto-compute invoice due date)
-- ----------------------------------------------------------------------------
CREATE TABLE payment_terms (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    days        INTEGER NOT NULL CHECK (days >= 0),
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO payment_terms (name, days, description) VALUES
    ('Due on receipt', 0, 'Payable immediately'),
    ('Net 15', 15, 'Due 15 days after invoice'),
    ('Net 30', 30, 'Due 30 days after invoice'),
    ('Net 60', 60, 'Due 60 days after invoice')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE parties ADD COLUMN group_id BIGINT REFERENCES party_groups(id) ON DELETE SET NULL;
ALTER TABLE parties ADD COLUMN payment_term_id BIGINT REFERENCES payment_terms(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN payment_term_id BIGINT REFERENCES payment_terms(id) ON DELETE SET NULL;

CREATE INDEX idx_parties_group ON parties(group_id);

-- ----------------------------------------------------------------------------
-- Manufacturing: bill of materials + production orders
-- ----------------------------------------------------------------------------
CREATE TABLE boms (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    finished_item_id BIGINT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bom_lines (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bom_id            BIGINT NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
    component_item_id BIGINT NOT NULL REFERENCES inventory_items(id),
    quantity          NUMERIC(20,2) NOT NULL CHECK (quantity > 0),
    line_no           INTEGER NOT NULL
);

CREATE TABLE production_orders (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bom_id          BIGINT NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
    quantity        NUMERIC(20,2) NOT NULL CHECK (quantity > 0),
    status          TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','completed')),
    production_date DATE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bom_lines_bom ON bom_lines(bom_id);
CREATE INDEX idx_production_orders_bom ON production_orders(bom_id);
