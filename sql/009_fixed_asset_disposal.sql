-- ============================================================================
-- Accounting Database — Fixed Asset Disposal (migration 009)
-- PostgreSQL 17
-- REQUIRES: 006_departments_fixed_assets.sql
-- ============================================================================

ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS disposal_date DATE;
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS disposal_proceeds NUMERIC(20,2) NOT NULL DEFAULT 0;
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS disposal_method TEXT;

-- Accumulated depreciation (contra-asset, credited in disposal) + gain/loss account
INSERT INTO accounts (code, name, type, normal_balance) VALUES
    ('1501', 'Accumulated Depreciation - Vehicles', 'asset', 'debit'),
    ('6300', 'Gain/Loss on Asset Disposal', 'expense', 'debit')
ON CONFLICT (code) DO NOTHING;
